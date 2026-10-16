// GET /__origens/top-bar — gateway SOMENTE LEITURA para a "Faixa do topo" publicada no CMS do storefront (/api/top-bar/<região>, contrato v1). As mensagens
// da faixa preta do cabeçalho da INK mudam sem novo deploy do Worker, e o storefront não envia CORS para os domínios da INK: só o SERVIDOR (este Worker) lê
// o storefront e re-serve no mesmo domínio. Mesmo desenho de promotions-gateway.js: origem FIXA vinda de stores.js (nenhuma URL vem do visitante), sem
// repassar Cookie/Authorization, timeout, limite de tamanho, validação ESTRITA de esquema e só os campos de exibição. Cache curto (30 s: uma mensagem
// agendada entra ou sai em cerca de um minuto). Falha => 503 e o cliente simplesmente NÃO troca a faixa (a da INK segue intacta).
// O texto já vem preenchido pelo storefront ({producao}, {faltam}); aqui nada é calculado.
// Contrato v1: { v:1, region, style?:'marquee'|'rotate', colors?:{ background, text }, messages:[{ id, text, href?, endsAt? }] } (style ausente = 'marquee', o
// letreiro; colors ausente = a faixa preta de sempre; o contraste já foi conferido no painel). `href` é um caminho do storefront DESTA região; sai como URL absoluta do storefront.
import { ACTIVE_STORE } from './stores.js';

export const TOP_BAR_PATH = '/__origens/top-bar';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 16384;
export const MAX_MESSAGES = 10; // o mesmo teto do storefront
export const MAX_TEXT = 120; // 90 digitados + o que {producao}/{faltam} acrescentam
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SEGMENTS = /^(\/[a-z0-9-]+){1,4}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
// Texto puro de uma linha; `<` e `>` também são recusados (o cliente usa textContent, isto é defesa em profundidade).
const CONTROL = /[\u0000-\u001f\u007f<>]/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

// Um caminho do storefront desta região: a própria base (/sul) ou até quatro segmentos abaixo dela, sem host, query nem "..".
export const storefrontPathOk = (href, store) =>
  typeof href === 'string' && href.length <= 120 && (href === store.storefrontBase || (href.startsWith(store.storefrontBase + '/') && SEGMENTS.test(href.slice(store.storefrontBase.length))));

// Uma mensagem. Qualquer campo fora do formato => null (e o payload inteiro é recusado: contrato estrito, o storefront já validou tudo).
function normalizeMessage(message, store, now) {
  if (!message || typeof message !== 'object') return null;
  const text = cleanText(message.text, MAX_TEXT);
  if (typeof message.id !== 'string' || !ID.test(message.id) || !text) return null;
  const out = { id: message.id, text };
  if (message.href !== undefined) {
    if (!storefrontPathOk(message.href, store)) return null;
    out.href = store.storefront + message.href;
  }
  if (message.endsAt !== undefined) {
    if (typeof message.endsAt !== 'string' || !INSTANT.test(message.endsAt) || !Number.isFinite(Date.parse(message.endsAt))) return null;
    if (Date.parse(message.endsAt) <= now) return 'expired'; // já acabou (cache do storefront): sai da lista sem invalidar o resto
    out.endsAt = message.endsAt;
  }
  return out;
}

// Aceita só o v1 DESTA região; qualquer coisa fora dele => null (a faixa da INK fica como está). Ids repetidos invalidam o payload.
export function normalizeTopBar(data, store = ACTIVE_STORE, now = Date.now()) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || !Array.isArray(data.messages) || data.messages.length > MAX_MESSAGES) return null;
  if (data.style !== undefined && data.style !== 'marquee' && data.style !== 'rotate') return null;
  const messages = [];
  const ids = new Set();
  for (const raw of data.messages) {
    const message = normalizeMessage(raw, store, now);
    if (message === null || (message !== 'expired' && ids.has(message.id))) return null;
    if (message === 'expired') continue;
    ids.add(message.id);
    messages.push(message);
  }
  const out = { v: 1, style: data.style === 'rotate' ? 'rotate' : 'marquee', messages };
  const c = data.colors;
  if (c !== undefined) {
    if (!c || typeof c !== 'object' || !HEX.test(c.background) || !HEX.test(c.text)) return null;
    out.colors = { background: c.background.toLowerCase(), text: c.text.toLowerCase() };
  }
  return out;
}

export function createTopBarGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
        const response = await upstream(new Request(store.storefront + store.topBarApi, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 30, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeTopBar(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(clean), {
          status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' }
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.top-bar-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
