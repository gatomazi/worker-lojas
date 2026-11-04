// GET /__origens/busca?q=  — gateway SOMENTE LEITURA para a busca do storefront (/api/busca: lugares, estampas e páginas), a MESMA que a vitrine mostra
// enquanto a pessoa digita. O cabeçalho que o Worker desenha na INK mostra essas sugestões; /api/busca não envia CORS para o host da INK, então só o
// SERVIDOR (este Worker) a lê e re-serve no mesmo domínio. Mesmo desenho de navbar-gateway.js / search-gateway.js:
//   - origem e região FIXAS (stores.js, a região do visitante já resolvida); do visitante só vem o texto, normalizado e limitado;
//   - sem repassar Cookie/Authorization, timeout, limite de tamanho, validação estrita, só campos públicos;
//   - cada link é conferido por CLASSE de destino: caminho do storefront (`site`), página de produto desta loja na INK (`ink`) ou um artigo da Uma Penca
//     em artigos.useorigens.com.br (`external`). Um item com destino desconhecido sai sozinho; a resposta continua. Imagem de host desconhecido some.
// A consulta normalizada é a chave do cache de borda (60 s): a mesma busca de muitos visitantes vai ao storefront uma vez por minuto. Não registra a
// consulta em log. Falha => 503 e o cliente mostra só o campo, que leva à página de resultados do storefront, como antes.

export const BUSCA_PATH = '/__origens/busca';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 200_000;
export const BUSCA_QUERY_MAX = 80; // o mesmo teto do storefront (MAX_GLOBAL_QUERY)
const MAX_ITEMS = 12;
const GROUPS = ['places', 'designs', 'editorial'];
const KINDS = ['state', 'locality', 'design', 'page'];
const REGION = /^[a-z][a-z-]{1,24}$/;
const CONTROL = /[\u0000-\u001f\u007f<>]/;
const ARTIGOS_HOST = 'artigos.useorigens.com.br';
const IMAGE_HOSTS = ['gcp-images.majestic.ink.rsvcloud.com', 'umapenca.imgix.net'];

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

/** O texto da busca como chave estável: espaços colapsados, minúsculas, até o teto. Vazio ou com caracteres de controle => null. */
export function buscaQueryKey(raw) {
  const text = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR').slice(0, BUSCA_QUERY_MAX).trim();
  return text.length >= 1 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

const storefrontHosts = (store) => { const h = new URL(store.storefront).hostname; return [h, h.startsWith('www.') ? h.slice(4) : 'www.' + h]; };
const inkPlaces = (store) => [{ host: store.inkHost, base: store.inkBase }, ...(store.formerInk ? [store.formerInk] : [])];

/** O destino de um resultado, ou null (destino desconhecido: o item sai). */
export function buscaLink(href, store) {
  if (typeof href !== 'string' || href.length > 500) return null;
  // Caminho do storefront ("/sul/rs/pelotas", "/norte/…" em outras regiões): nunca "//host".
  if (href.startsWith('/') && !href.startsWith('//')) return /[\s\\]/.test(href) ? null : { href: store.storefront + href, dest: 'site' };
  let url;
  try { url = new URL(href); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (storefrontHosts(store).includes(url.hostname)) return { href: store.storefront + url.pathname + url.search + url.hash, dest: 'site' };
  // Uma página desta loja na INK (o domínio atual, ou o antigo durante a mudança, que só redireciona): o próprio endereço.
  if (inkPlaces(store).some((p) => url.hostname === p.host && url.pathname.startsWith(p.base + '/'))) return { href: url.href, dest: 'ink' };
  if (url.hostname === ARTIGOS_HOST) return { href: url.href, dest: 'external' };
  return null;
}

/** A miniatura: uma mídia do storefront ou de um host de imagens conhecido (INK, Uma Penca); qualquer outra coisa some. */
export function buscaImage(src, store) {
  if (typeof src !== 'string' || src.length > 600) return null;
  if (src.startsWith('/') && !src.startsWith('//')) return /[\s\\"'()]/.test(src) ? null : store.storefront + src;
  let url;
  try { url = new URL(src); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return IMAGE_HOSTS.includes(url.hostname) || storefrontHosts(store).includes(url.hostname) ? url.href : null;
}

function normalizeItem(item, store) {
  if (!item || typeof item !== 'object' || !KINDS.includes(item.kind)) return null;
  const title = cleanText(item.title, 100);
  const link = buscaLink(item.href, store);
  if (!title || !link || typeof item.region !== 'string' || !REGION.test(item.region)) return null;
  const out = { kind: item.kind, region: item.region, title, href: link.href, dest: link.dest };
  const subtitle = cleanText(item.subtitle, 160); if (subtitle) out.subtitle = subtitle;
  const tag = cleanText(item.tag, 40); if (tag) out.tag = tag;
  const image = buscaImage(item.image, store); if (image) out.image = image;
  return out;
}
const normalizeItems = (list, store) => (Array.isArray(list) ? list.slice(0, MAX_ITEMS).map((i) => normalizeItem(i, store)).filter(Boolean) : null);

/** A resposta do storefront no contrato que o loader lê, ou null (formato desconhecido). */
export function normalizeBusca(data, store) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.groups) || data.groups.length > GROUPS.length) return null;
  const groups = [];
  const seen = new Set();
  for (const g of data.groups) {
    if (!g || !GROUPS.includes(g.group) || seen.has(g.group)) return null;
    seen.add(g.group);
    const items = normalizeItems(g.items, store);
    if (!items) return null;
    const total = Number.isInteger(g.total) && g.total >= items.length ? g.total : items.length;
    if (items.length > 0) groups.push({ group: g.group, total, items });
  }
  const others = data.others === undefined ? [] : normalizeItems(data.others, store);
  if (!others) return null;
  return { v: 1, groups, others };
}

export function createBuscaGateway({ upstream = (request, init) => fetch(request, init), store }) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const q = buscaQueryKey(new URL(request.url).searchParams.get('q'));
      if (!q) return json({ error: 'query' }, 400);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization. A URL só tem a região da loja e o texto normalizado.
        const target = store.storefront + '/api/busca?' + new URLSearchParams({ region: store.region, q });
        const response = await upstream(new Request(target, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeBusca(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(clean), {
          status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.busca-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
