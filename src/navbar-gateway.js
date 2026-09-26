// GET /__origens/navbar — gateway SOMENTE LEITURA para a configuração pública da navbar (dois grupos de coleções escolhidos no CMS do storefront
// + os estados fixos de "Regiões"). O header desenhado na INK precisa mudar sem novo deploy do Worker e /api/navbar/<região> não envia CORS para
// www.usesul.com.br: só o SERVIDOR (este Worker) lê o storefront e re-serve no mesmo domínio.
// Garantias (mesmo desenho de search-gateway.js): origem FIXA vinda de stores.js (nenhuma URL vem do visitante), sem repassar Cookie/Authorization,
// timeout, limite de tamanho, validação estrita de esquema, só campos públicos. Resposta cacheável por 60 s; falha => 503 e o cliente simplesmente NÃO
// monta a navbar (a da INK segue intacta).
// Contrato v2: { v:2, region, states:[{uf,name,path}], top:[{id,title,slug,url,order}], more:[...] }. `top` e `more` são grupos LIVRES (qualquer quantidade),
// na ordem do proprietário; nenhuma coleção tem papel especial. v1 (lista única `collections`) ainda é aceito e tratado como `top`.
import { ACTIVE_STORE } from './stores.js';

export const NAVBAR_PATH = '/__origens/navbar';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 65536;
export const MAX_GROUP = 60; // teto de sanidade do payload (o mesmo do storefront), não um limite editorial
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const UF = /^[A-Z]{2}$/;
const CONTROL = /[\u0000-\u001f\u007f<>]/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

// Uma entrada de coleção. `url`, quando presente, TEM de ser a página pública da coleção na INK desta loja (senão o payload inteiro é recusado).
function normalizeEntry(item, index, store) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanText(item.title !== undefined ? item.title : item.name, 60);
  if (!title || typeof item.slug !== 'string' || !SLUG.test(item.slug)) return null;
  if (item.url !== undefined && item.url !== 'https://' + store.inkHost + store.inkBase + '/collections/' + item.slug) return null;
  const id = Number.isInteger(item.id) && item.id > 0 ? item.id : null;
  return { id, title, slug: item.slug, order: index + 1 };
}

function normalizeGroup(list, store) {
  if (!Array.isArray(list) || list.length > MAX_GROUP) return null;
  const out = [];
  for (const [index, item] of list.entries()) { const entry = normalizeEntry(item, index, store); if (!entry) return null; out.push(entry); }
  return out;
}

// Estados de "Regiões": caminhos DENTRO da base do storefront desta loja (nada de host, nada de fora).
function normalizeStates(list, store) {
  if (!Array.isArray(list) || list.length > 8) return null;
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || typeof item.uf !== 'string' || !UF.test(item.uf)) return null;
    const name = cleanText(item.name, 40);
    if (!name || item.path !== store.storefrontBase + '/' + item.uf.toLowerCase()) return null;
    out.push({ uf: item.uf, name, path: item.path });
  }
  return out;
}

// Aceita só o formato conhecido; qualquer coisa fora dele => null (a navbar não monta). Nomes são texto puro (o cliente usa textContent).
// Um slug repetido dentro de um grupo é descartado; o mesmo slug nos DOIS grupos invalida o payload (uma coleção, um lugar).
export function normalizeNavbar(data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.region !== store.region) return null;
  let top; let more; let states = [];
  if (data.v === 2) {
    top = normalizeGroup(data.top, store); more = normalizeGroup(data.more, store);
    const st = normalizeStates(data.states, store); if (!top || !more || !st) return null;
    states = st;
  } else if (data.v === 1) {
    top = normalizeGroup(data.collections, store); more = [];
    if (!top) return null;
  } else return null;
  const dedupe = (list) => { const seen = new Set(); return list.filter((e) => (seen.has(e.slug) ? false : (seen.add(e.slug), true))).map((e, i) => ({ ...e, order: i + 1 })); };
  top = dedupe(top); more = dedupe(more);
  if (more.some((e) => top.some((t) => t.slug === e.slug))) return null;
  return { v: 2, states, top, more };
}

export function createNavbarGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
        const response = await upstream(new Request(store.storefront + store.navbarApi, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeNavbar(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(clean), {
          status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.navbar-config-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
