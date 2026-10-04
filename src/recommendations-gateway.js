// GET /__origens/recommendations/<inkProductId> — gateway SOMENTE LEITURA para a lista pré-calculada "Você também pode gostar" da página de produto.
// O índice é gerado no storefront (npm run recommendations:build, a partir dos snapshots locais: nunca a INK) e servido por
// GET <storefront>/api/recommendations/<região>/<id>, que não envia CORS para o host da INK: só o SERVIDOR (este Worker) lê e re-serve no mesmo domínio.
// Garantias (mesmo desenho de navbar-gateway.js): origem FIXA vinda de stores.js (o visitante só escolhe um id numérico), sem repassar
// Cookie/Authorization, timeout curto, limite de tamanho e validação item a item: um link SÓ é aceito se for https, no host DESTA loja, sem
// credenciais nem porta, no caminho canônico de produto da loja; imagem https no host de imagens da INK; preço válido; nunca o próprio produto.
// Qualquer falha => `{ items: [] }` (fail closed): o cliente não desenha nada e a página da INK segue intacta.
import { ACTIVE_STORE, catalogProductPattern } from './stores.js';

export const RECOMMENDATIONS_PATH = '/__origens/recommendations/';
const FETCH_TIMEOUT_MS = 1500;
const MAX_CHARS = 16384;
export const MAX_ITEMS = 4;
export const MIN_ITEMS = 2; // abaixo disto o bloco não aparece: o gateway nem devolve a lista
const PRODUCT_ID = /^[1-9][0-9]{0,15}$/;
const IMAGE_HOSTS = new Set(['gcp-images.majestic.ink.rsvcloud.com']);
const CONTROL = /[\u0000-\u001f\u007f<>]/;
// Vocabulário fechado (o mesmo de src/lib/recommendations/rank.ts no storefront). Desconhecido => o item continua, sem reason.
export const REASONS = ['same-locality:feito-em', 'same-locality:coordinates', 'same-locality:family', 'same-collection', 'same-line', 'same-theme', 'same-uf', 'same-region', 'shared-collection', 'shared-tokens', 'nearby-city'];

const CACHE_OK = 'public, max-age=300';
const CACHE_EMPTY = 'public, max-age=60';

export function productIdOf(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(RECOMMENDATIONS_PATH)) return null;
  const id = pathname.slice(RECOMMENDATIONS_PATH.length);
  return PRODUCT_ID.test(id) ? id : null;
}

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try { return new URL(value); } catch (_) { return null; }
}

// Um item. Devolve { item } ou { drop: '<motivo>' } (o motivo vai para o log agregado, nunca o conteúdo).
export function validateItem(raw, currentId, store = ACTIVE_STORE) {
  if (!raw || typeof raw !== 'object') return { drop: 'shape' };
  const productId = typeof raw.productId === 'string' ? raw.productId : (Number.isSafeInteger(raw.productId) ? String(raw.productId) : '');
  if (!PRODUCT_ID.test(productId)) return { drop: 'product-id' };
  if (productId === currentId) return { drop: 'self' };
  const title = cleanText(raw.title, 90);
  if (!title) return { drop: 'title' };
  const href = safeUrl(raw.href);
  if (!href || href.protocol !== 'https:' || href.username || href.password || href.port || href.hostname !== store.inkHost || href.search || href.hash || !catalogProductPattern(store).test(href.pathname)) return { drop: 'href' };
  const image = safeUrl(raw.image);
  if (!image || image.protocol !== 'https:' || image.username || image.password || image.port || !IMAGE_HOSTS.has(image.hostname)) return { drop: 'image' };
  const price = raw.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 2000) return { drop: 'price' };
  const reason = REASONS.includes(raw.reason) ? raw.reason : null;
  return { item: { productId, title, image: image.href, price: Math.round(price * 100) / 100, href: href.href, ...(reason ? { reason } : {}) } };
}

// Aceita só o formato conhecido, da região DESTA loja e do produto pedido. Itens inválidos saem um a um; repetidos (mesmo produto ou mesmo link) também.
export function normalizeRecommendations(data, currentId, store = ACTIVE_STORE) {
  const dropped = {};
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || data.productId !== currentId || !Array.isArray(data.items)) return { items: [], dropped: { payload: 1 } };
  const items = [];
  const seen = new Set();
  for (const raw of data.items.slice(0, 12)) {
    const result = validateItem(raw, currentId, store);
    if (result.drop) { dropped[result.drop] = (dropped[result.drop] || 0) + 1; continue; }
    if (seen.has(result.item.productId) || seen.has(result.item.href)) { dropped.duplicate = (dropped.duplicate || 0) + 1; continue; }
    seen.add(result.item.productId); seen.add(result.item.href);
    items.push(result.item);
    if (items.length === MAX_ITEMS) break;
  }
  return { items: items.length >= MIN_ITEMS ? items : [], dropped };
}

const log = (level, event, fields) => console[level](JSON.stringify({ event: 'use-origens.' + event, ...fields }));

export function createRecommendationsGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  const respond = (request, items, status) => new Response(request.method === 'HEAD' ? null : JSON.stringify({ items }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': items.length ? CACHE_OK : CACHE_EMPTY, 'x-origens-reco': status }
  });
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const id = productIdOf(new URL(request.url).pathname);
      if (!id) return new Response(JSON.stringify({ items: [] }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization. A URL é montada aqui (região e base da loja + id validado).
        const response = await upstream(new Request(store.storefront + '/api/recommendations/' + store.region + '/' + id, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const data = JSON.parse(text);
        const { items, dropped } = normalizeRecommendations(data, id, store);
        if (Object.keys(dropped).length) log('warn', 'reco-dropped', { product_id: id, dropped });
        if (!items.length) log('log', 'reco-empty', { product_id: id, index: data && data.status === 'no-index' ? 'missing' : 'ok' });
        return respond(request, items, items.length ? 'ok' : (data && data.status === 'no-index' ? 'no-index' : 'empty'));
      } catch (error) {
        log('warn', 'reco-unavailable', { reason: String(error && error.message).slice(0, 40) });
        return respond(request, [], 'unavailable');
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
