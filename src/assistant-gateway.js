// GET|POST /__origens/assistente — gateway do assistente "Pergunte aqui" (o chat do storefront, sem IA) nas páginas da INK, onde ele fica no lugar do botão
// "Ajuda?" e do WhatsApp da própria INK. Os dados vêm do storefront (/api/assistente/<região>, contrato v1: respostas da loja publicadas no CMS, busca do
// catálogo sincronizado, páginas de pedidos da INK), que não envia CORS para o host da INK: só o SERVIDOR (este Worker) fala com ele e re-serve no
// mesmo domínio. Mesmo desenho de guide-gateway.js:
//   - origem FIXA vinda de stores.js; o visitante só manda a mensagem (texto, com limite e sem controle);
//   - nada de Cookie/Authorization do visitante; o storefront recebe só um hash do endereço (x-origens-visitor) para o limite por visitante;
//   - timeout curto, limite de tamanho e validação ITEM A ITEM do que volta: produto só com link canônico DESTA loja na INK e imagem do CDN da INK;
//     página só do storefront desta região; os links de pedidos são REMONTADOS aqui a partir da loja (o payload só escolhe o tipo); WhatsApp só wa.me.
// A mensagem nunca é registrada (nem em log). Qualquer falha => 503 JSON e o cliente mostra "não consegui responder" (a INK segue intacta).
import { ACTIVE_STORE, catalogProductPattern } from './stores.js';
import { storefrontPage } from './guide-gateway.js';

export const ASSISTANT_PATH = '/__origens/assistente';
const FETCH_TIMEOUT_MS = 5000;
const MAX_CHARS = 24576;
const MAX_BODY = 2048;
export const MAX_MESSAGE = 300;
export const MAX_ITEMS = 4;
const MAX_LINKS = 4;
const MAX_SUGGESTIONS = 4;
// O texto do botão e os temas fixos acima do campo (opcionais no v1). Tetos um pouco acima dos do painel (18 e 28), para um ajuste lá não sumir aqui.
const MAX_LABEL = 24;
const MAX_TOPIC = 40;
const MAX_TOPICS = 4;
const KINDS = new Set(['greeting', 'answer', 'designs', 'order', 'handoff', 'refuse', 'ask', 'not-found', 'fallback', 'chat']);
// page = página do storefront; collection = página de uma categoria NA INK (uma que o storefront não tem); orders/tracking = pedidos da INK.
const LINK_KINDS = new Set(['page', 'collection', 'orders', 'tracking', 'whatsapp', 'search']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_HOSTS = new Set(['gcp-images.majestic.ink.rsvcloud.com']);
const PRODUCT_ID = /^[1-9][0-9]{0,15}$/;
const WHATSAPP = /^\/55[1-9][0-9]{9,10}$/;
// Uma linha, sem controle nem marcação; o texto da resposta pode ter quebras de linha (\n) e nada mais abaixo de 0x20.
const CONTROL = /[\u0000-\u001f\u007f<>]/;
const TEXT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f<>]/;

const cleanLine = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};
const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  return text.length >= 1 && text.length <= max && !TEXT_CONTROL.test(text) ? text : null;
};
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null; } catch (_) { return null; }
}
const storefrontHosts = (store) => { const h = new URL(store.storefront).hostname; return new Set([h, h.startsWith('www.') ? h.slice(4) : 'www.' + h]); };

// A mensagem do visitante: texto de uma linha, até MAX_MESSAGE. null = recusada (400).
export function cleanMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE * 2) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length <= MAX_MESSAGE && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

// Um cartão: produto da INK DESTA loja ou página do storefront desta região, sempre com foto do CDN da INK.
export function validateItem(raw, store = ACTIVE_STORE) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanLine(raw.title, 90);
  const image = safeUrl(raw.image);
  if (!title || !image || !IMAGE_HOSTS.has(image.hostname)) return null;
  const href = safeUrl(raw.href);
  if (!href || href.search || href.hash) return null;
  let link = null;
  if (href.hostname === store.inkHost && catalogProductPattern(store).test(href.pathname)) link = href.href;
  else link = storefrontPage(href.href, store);
  if (!link) return null;
  const out = { title, image: image.href, href: link };
  if (raw.context !== undefined) { const context = cleanLine(raw.context, 60); if (!context) return null; out.context = context; }
  if (raw.price !== undefined) { if (typeof raw.price !== 'number' || !Number.isFinite(raw.price) || raw.price <= 0 || raw.price > 2000) return null; out.price = Math.round(raw.price * 100) / 100; }
  if (raw.productId !== undefined) { if (typeof raw.productId !== 'string' || !PRODUCT_ID.test(raw.productId)) return null; out.productId = raw.productId; }
  return out;
}

// Um botão. Pedidos: o link é REMONTADO da loja (o payload só diz qual). Busca: /<base>/busca?q= no storefront. WhatsApp: wa.me/<número>?text=.
export function validateLink(raw, store = ACTIVE_STORE) {
  if (!raw || typeof raw !== 'object' || !LINK_KINDS.has(raw.kind)) return null;
  const label = cleanLine(raw.label, 60);
  if (!label) return null;
  const ink = 'https://' + store.inkHost + store.inkBase;
  if (raw.kind === 'orders') return { kind: 'orders', label, href: ink + '/orders' };
  if (raw.kind === 'tracking') return { kind: 'tracking', label, href: ink + '/orders/trackings' };
  const url = safeUrl(raw.href);
  if (!url) return null;
  if (raw.kind === 'whatsapp') {
    if (url.hostname !== 'wa.me' || !WHATSAPP.test(url.pathname) || url.hash) return null;
    const text = url.searchParams.get('text');
    const keys = [...url.searchParams.keys()];
    if (keys.some((k) => k !== 'text') || (text !== null && text.length > 400)) return null;
    return { kind: 'whatsapp', label, href: 'https://wa.me' + url.pathname + (text ? '?text=' + encodeURIComponent(text) : '') };
  }
  if (raw.kind === 'collection') {
    const slug = url.pathname.startsWith(store.inkBase + '/collections/') ? url.pathname.slice((store.inkBase + '/collections/').length) : '';
    if (url.hostname !== store.inkHost || url.search || url.hash || !SLUG.test(slug) || slug.length > 80) return null;
    return { kind: 'collection', label, href: 'https://' + store.inkHost + store.inkBase + '/collections/' + slug };
  }
  if (raw.kind === 'search') {
    const q = url.searchParams.get('q');
    if (!storefrontHosts(store).has(url.hostname) || url.pathname !== store.storefrontBase + '/busca' || url.hash || !q || q.length > 80 || [...url.searchParams.keys()].some((k) => k !== 'q')) return null;
    return { kind: 'search', label, href: store.storefront + store.storefrontBase + '/busca?q=' + encodeURIComponent(q) };
  }
  const page = storefrontPage(url.href, store);
  return page ? { kind: 'page', label, href: page } : null;
}

// A resposta (v1). Um cartão ou botão fora do formato cai sozinho; o texto fora do formato derruba a resposta inteira.
export function normalizeReply(data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.v !== 1 || !KINDS.has(data.kind)) return null;
  const text = cleanText(data.text, 1000);
  if (!text) return null;
  const out = { v: 1, kind: data.kind, text };
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 8).map((i) => validateItem(i, store)).filter(Boolean).slice(0, MAX_ITEMS);
  if (items.length) out.items = items;
  const seen = new Set();
  const links = (Array.isArray(data.links) ? data.links : []).slice(0, 8).map((l) => validateLink(l, store)).filter((l) => l && !seen.has(l.kind + l.href) && seen.add(l.kind + l.href)).slice(0, MAX_LINKS);
  if (links.length) out.links = links;
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 8).map((s) => cleanLine(s, 140)).filter(Boolean).slice(0, MAX_SUGGESTIONS);
  if (suggestions.length) out.suggestions = suggestions;
  return out;
}

// A abertura do chat (GET). Desligado = { v:1, enabled:false } e o cliente deixa a INK como está.
export function normalizeBoot(data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || typeof data.enabled !== 'boolean') return null;
  if (!data.enabled) return { v: 1, enabled: false };
  const opening = normalizeReply(data.opening, store);
  if (!opening || opening.kind !== 'greeting') return null;
  const out = { v: 1, enabled: true, opening };
  // O atalho do WhatsApp (sempre à mão no cabeçalho do chat): o mesmo filtro dos botões de WhatsApp; fora do formato = sem atalho.
  const whatsapp = typeof data.whatsapp === 'string' ? validateLink({ kind: 'whatsapp', label: 'WhatsApp', href: data.whatsapp }, store) : null;
  if (whatsapp) out.whatsapp = whatsapp.href;
  // Texto do botão fora do formato = o padrão do cliente ("Pergunte aqui"). Um tema fora do formato cai sozinho; lista ausente = sem temas.
  const label = cleanLine(data.label, MAX_LABEL);
  if (label) out.label = label;
  if (Array.isArray(data.topics)) out.topics = [...new Set(data.topics.slice(0, 8).map((t) => cleanLine(t, MAX_TOPIC)).filter(Boolean))].slice(0, MAX_TOPICS);
  return out;
}

// Hash do endereço do visitante (nunca o endereço): o limite por visitante do storefront, sem identificar ninguém. Sem endereço = sem cabeçalho.
// O mesmo hash vai no acompanhamento da camiseta em criação (product-wait-gateway.js).
export async function visitorKey(request, store) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip || !globalThis.crypto || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('origens-assistente|' + store.id + '|' + ip));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

const log = (level, event, fields) => console[level](JSON.stringify({ event: 'use-origens.' + event, ...fields }));

export function createAssistantGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  const json = (request, body, status, cache) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });
  const api = () => store.storefront + '/api/assistente/' + store.region;

  async function read(response, normalize) {
    if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
    const text = await response.text();
    if (text.length > MAX_CHARS) throw new Error('too large');
    const clean = normalize(JSON.parse(text), store);
    if (!clean) throw new Error('schema');
    return clean;
  }

  return {
    async handle(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        if (request.method === 'GET' || request.method === 'HEAD') {
          // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
          const response = await upstream(new Request(api(), { method: 'GET', headers: { accept: 'application/json' } }), { redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true } });
          return json(request, await read(response, normalizeBoot), 200, 'public, max-age=60');
        }
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
        if (!/application\/json/i.test(request.headers.get('content-type') || '')) return json(request, { error: 'json only' }, 415, 'no-store');
        const raw = await request.text();
        if (raw.length > MAX_BODY) return json(request, { error: 'too long' }, 413, 'no-store');
        let message = null;
        try { message = cleanMessage(JSON.parse(raw).message); } catch (_) { message = null; }
        if (message === null) return json(request, { error: 'invalid message' }, 400, 'no-store');
        const headers = { accept: 'application/json', 'content-type': 'application/json' };
        const visitor = await visitorKey(request, store);
        if (visitor) headers['x-origens-visitor'] = visitor;
        const response = await upstream(new Request(api(), { method: 'POST', headers, body: JSON.stringify({ message }) }), { redirect: 'manual', signal: controller.signal });
        if (response.status === 429) return json(request, { error: 'slow down' }, 429, 'no-store');
        return json(request, await read(response, normalizeReply), 200, 'no-store');
      } catch (error) {
        log('warn', 'assistente-unavailable', { method: request.method, reason: String(error && error.message).slice(0, 40) });
        return json(request, { error: 'unavailable' }, 503, 'no-store');
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
