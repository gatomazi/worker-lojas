// GET /__origens/guia?produto=<id> | ?cidade=<uf>/<slug>[&produto=<id>] | ?colecao=<slug> | (nada) — gateway SOMENTE LEITURA do guia da página de
// produto ("Procurando sua cidade ou outra estampa?"). Os dados vêm de GET <storefront>/api/guia/<região> (catálogo e coleções sincronizados + configuração
// publicada do CMS; nunca a INK em tempo de pedido), que não envia CORS para o host da INK: só o SERVIDOR (este Worker) lê e re-serve no mesmo domínio.
// Garantias (mesmo desenho de recommendations-gateway.js): origem FIXA vinda de stores.js (o visitante só escolhe parâmetros de formato fechado), sem repassar
// Cookie/Authorization, timeout curto, limite de tamanho e validação item a item: um produto SÓ é aceito se o link for https, no host DESTA loja, no caminho
// canônico de produto, com imagem https no host de imagens da INK e preço válido; um link de página (cidade, coleção) só na origem do storefront, na base
// da região. Qualquer falha => resposta vazia e honesta (`ok:false`), nunca um erro da Cloudflare: o cliente mostra a saída para a vitrine e a INK segue intacta.
import { ACTIVE_STORE, catalogProductPattern } from './stores.js';

export const GUIDE_PATH = '/__origens/guia';
const FETCH_TIMEOUT_MS = 2500;
const MAX_CHARS = 24576;
export const MAX_CITY_ITEMS = 3;
export const MAX_COLLECTION_ITEMS = 4;
export const MAX_COLLECTIONS = 8;
const PRODUCT_ID = /^[1-9][0-9]{0,15}$/;
const CITY = /^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_HOSTS = new Set(['gcp-images.majestic.ink.rsvcloud.com']);
const CONTROL = /[\u0000-\u001f\u007f<>]/;
const CACHE_OK = 'public, max-age=300';
const CACHE_MISS = 'public, max-age=60';

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try { return new URL(value); } catch (_) { return null; }
}
// Página do storefront DESTA região: <origem>/<base>[/...], https, sem credenciais, porta, query nem fragmento. O host do storefront (com ou sem www)
// é NORMALIZADO para a origem que a loja já usa em todos os outros links (stores.js): só o caminho vem do payload.
const storefrontHosts = (store) => { const h = new URL(store.storefront).hostname; return new Set([h, h.startsWith('www.') ? h.slice(4) : 'www.' + h]); };
export function storefrontPage(value, store = ACTIVE_STORE) {
  const url = safeUrl(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!storefrontHosts(store).has(url.hostname)) return null;
  const base = store.storefrontBase;
  if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return null;
  if (!/^[a-z0-9/_-]+$/.test(url.pathname)) return null;
  return store.storefront + url.pathname;
}
// Um produto do guia: link para a página de produto DESTA loja, imagem da INK, preço válido. { item } ou { drop }.
export function validateItem(raw, store = ACTIVE_STORE) {
  if (!raw || typeof raw !== 'object') return { drop: 'shape' };
  const productId = typeof raw.productId === 'string' ? raw.productId : (Number.isSafeInteger(raw.productId) ? String(raw.productId) : '');
  if (!PRODUCT_ID.test(productId)) return { drop: 'product-id' };
  const title = cleanText(raw.title, 90);
  if (!title) return { drop: 'title' };
  const context = raw.context === undefined || raw.context === null ? null : cleanText(raw.context, 60);
  if (raw.context && !context) return { drop: 'context' };
  const href = safeUrl(raw.href);
  if (!href || href.protocol !== 'https:' || href.username || href.password || href.port || href.hostname !== store.inkHost || href.search || href.hash || !catalogProductPattern(store).test(href.pathname)) return { drop: 'href' };
  const image = safeUrl(raw.image);
  if (!image || image.protocol !== 'https:' || image.username || image.password || image.port || !IMAGE_HOSTS.has(image.hostname)) return { drop: 'image' };
  const price = raw.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 2000) return { drop: 'price' };
  const listPrice = typeof raw.listPrice === 'number' && Number.isFinite(raw.listPrice) && raw.listPrice > price && raw.listPrice <= 2000 ? Math.round(raw.listPrice * 100) / 100 : null;
  return { item: { productId, title, ...(context ? { context } : {}), image: image.href, price: Math.round(price * 100) / 100, ...(listPrice ? { listPrice } : {}), href: href.href } };
}
function validateItems(list, max, store) {
  const items = []; const seen = new Set(); const dropped = {};
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 12)) {
    const r = validateItem(raw, store);
    if (r.drop) { dropped[r.drop] = (dropped[r.drop] || 0) + 1; continue; }
    if (seen.has(r.item.productId) || seen.has(r.item.href)) { dropped.duplicate = (dropped.duplicate || 0) + 1; continue; }
    seen.add(r.item.productId); seen.add(r.item.href);
    items.push(r.item);
    if (items.length === max) break;
  }
  return { items, dropped };
}
function validateCity(raw, store) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name, 60); const url = storefrontPage(raw.url, store);
  if (!name || !url || typeof raw.uf !== 'string' || !store.ufs.includes(raw.uf) || typeof raw.slug !== 'string' || !SLUG.test(raw.slug) || raw.slug.length > 60) return null;
  return { name, uf: raw.uf, slug: raw.slug, kind: raw.kind === 'ra' ? 'ra' : 'city', url };
}
function validateCollection(raw, store) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name, 60); const url = storefrontPage(raw.url, store);
  if (!name || !url || typeof raw.slug !== 'string' || !SLUG.test(raw.slug) || raw.slug.length > 60) return null;
  const image = raw.image === undefined ? null : safeUrl(raw.image);
  const okImage = image && image.protocol === 'https:' && IMAGE_HOSTS.has(image.hostname) && !image.username && !image.password && !image.port ? image.href : null;
  const total = Number.isSafeInteger(raw.total) && raw.total >= 0 ? raw.total : 0;
  return { name, slug: raw.slug, url, ...(okImage ? { image: okImage } : {}), total };
}

// Aceita só o formato conhecido, da região DESTA loja. Devolve o corpo a servir (sempre com `ok`) e o que foi descartado (só motivos, nunca conteúdo).
export function normalizeGuide(kind, data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region) return { body: { ok: false, kind }, dropped: { payload: 1 } };
  if (kind === 'produto') {
    const city = data.city === null ? null : validateCity(data.city, store);
    if (data.city && !city) return { body: { ok: true, kind, city: null }, dropped: { city: 1 } };
    return { body: { ok: true, kind, city }, dropped: {} };
  }
  if (kind === 'cidade') {
    const city = validateCity(data.city, store);
    if (!city) return { body: { ok: false, kind }, dropped: { city: 1 } };
    const { items, dropped } = validateItems(data.items, MAX_CITY_ITEMS, store);
    return { body: { ok: true, kind, city, items, total: Number.isSafeInteger(data.total) && data.total >= items.length ? data.total : items.length }, dropped };
  }
  if (kind === 'colecao') {
    const collection = validateCollection(data.collection, store);
    if (!collection) return { body: { ok: false, kind }, dropped: { collection: 1 } };
    const { items, dropped } = validateItems(data.items, MAX_COLLECTION_ITEMS, store);
    return { body: { ok: true, kind, collection, items, total: Number.isSafeInteger(data.total) && data.total >= items.length ? data.total : items.length }, dropped };
  }
  const collections = []; const dropped = {}; const seen = new Set();
  for (const raw of (Array.isArray(data.collections) ? data.collections : []).slice(0, 24)) {
    const c = validateCollection(raw, store);
    if (!c) { dropped.collection = (dropped.collection || 0) + 1; continue; }
    if (seen.has(c.slug)) { dropped.duplicate = (dropped.duplicate || 0) + 1; continue; }
    seen.add(c.slug); collections.push(c);
    if (collections.length === MAX_COLLECTIONS) break;
  }
  return { body: { ok: true, kind: 'colecoes', collections }, dropped };
}

// Só os parâmetros de formato fechado passam ao storefront; qualquer outra coisa é ignorada. null = pedido malformado (400).
export function guideQuery(searchParams) {
  const produto = searchParams.get('produto'); const cidade = searchParams.get('cidade'); const colecao = searchParams.get('colecao');
  if (produto !== null && !PRODUCT_ID.test(produto)) return null;
  if (cidade !== null) { if (!CITY.test(cidade) || cidade.length > 70) return null; return { kind: 'cidade', query: 'cidade=' + cidade + (produto ? '&produto=' + produto : '') }; }
  if (colecao !== null) { if (!SLUG.test(colecao) || colecao.length > 60) return null; return { kind: 'colecao', query: 'colecao=' + colecao }; }
  if (produto !== null) return { kind: 'produto', query: 'produto=' + produto };
  return { kind: 'colecoes', query: '' };
}

const log = (level, event, fields) => console[level](JSON.stringify({ event: 'use-origens.' + event, ...fields }));

export function createGuideGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  const json = (request, body, status, cache) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-origens-guia': body.ok ? 'ok' : 'empty' } });
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const q = guideQuery(new URL(request.url).searchParams);
      if (!q) return json(request, { ok: false, kind: 'invalid' }, 400, 'no-store');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization. A URL é montada aqui (origem e região da loja + parâmetros validados).
        const response = await upstream(new Request(store.storefront + '/api/guia/' + store.region + (q.query ? '?' + q.query : ''), { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true }
        });
        if (response.status === 404 && /json/i.test(response.headers.get('content-type') || '')) return json(request, { ok: false, kind: q.kind, notFound: true }, 200, CACHE_MISS);
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const { body, dropped } = normalizeGuide(q.kind, JSON.parse(text), store);
        if (Object.keys(dropped).length) log('warn', 'guia-dropped', { kind: q.kind, dropped });
        return json(request, body, 200, body.ok ? CACHE_OK : CACHE_MISS);
      } catch (error) {
        log('warn', 'guia-unavailable', { kind: q.kind, reason: String(error && error.message).slice(0, 40) });
        return json(request, { ok: false, kind: q.kind }, 200, 'no-store');
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
