// GET /__origens/promotions — gateway SOMENTE LEITURA para os cupons e promoções publicados no CMS do storefront (/api/promotions/<região>, contrato v1).
// O botão de cupons desenhado na INK muda sem novo deploy do Worker, e o storefront não envia CORS para os domínios da INK: só o SERVIDOR (este Worker)
// lê o storefront e re-serve no mesmo domínio. Mesmo desenho de navbar-gateway.js: origem FIXA vinda de stores.js (nenhuma URL vem do visitante), sem
// repassar Cookie/Authorization, timeout, limite de tamanho, validação ESTRITA de esquema e só os campos de exibição. Cache curto (30 s: um item
// agendado entra ou sai em cerca de um minuto). Falha => 503 e o cliente simplesmente NÃO monta o botão (a página da INK segue intacta).
// O CMS descreve a promoção; a INK executa: aqui não há valor, regra nem cálculo de desconto, só textos e o código que o botão Copiar copia.
// Contrato v1: { v:1, region, theme?:{primary,onPrimary}, items:[{ id, type:'coupon'|'promotion', title, code?, description, callout?, badgeLabel?, order, endsAt? }] }.
import { ACTIVE_STORE } from './stores.js';

export const PROMOTIONS_PATH = '/__origens/promotions';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 32768;
export const MAX_ITEMS = 20; // o mesmo teto do storefront
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CODE = /^[A-Za-z0-9_-]{2,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
// Texto puro de uma linha; `<` e `>` também são recusados (o cliente usa textContent, isto é defesa em profundidade).
const CONTROL = /[\u0000-\u001f\u007f<>]/;
const LIMITS = { title: 60, description: 200, callout: 160, badgeLabel: 24 };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

// Um item. Qualquer campo fora do formato => null (e o payload inteiro é recusado: contrato estrito, o storefront já validou tudo).
function normalizeItem(item, index, now) {
  if (!item || typeof item !== 'object') return null;
  const type = item.type === 'coupon' || item.type === 'promotion' ? item.type : null;
  const title = cleanText(item.title, LIMITS.title);
  const description = cleanText(item.description, LIMITS.description);
  if (!type || typeof item.id !== 'string' || !ID.test(item.id) || !title || !description) return null;
  const out = { id: item.id, type, title, description, order: index + 1 };
  if (type === 'coupon') {
    if (typeof item.code !== 'string' || !CODE.test(item.code)) return null;
    out.code = item.code;
    if (item.badgeLabel !== undefined && item.badgeLabel !== null) { const badge = cleanText(item.badgeLabel, LIMITS.badgeLabel); if (!badge) return null; out.badgeLabel = badge; }
  } else if (item.code !== undefined) return null; // um aviso com código pareceria um cupom
  // `callout`: string, null ou ausente. Vazio/null/ausente = sem a linha.
  if (item.callout !== undefined && item.callout !== null && item.callout !== '') { const callout = cleanText(item.callout, LIMITS.callout); if (!callout) return null; out.callout = callout; }
  if (item.endsAt !== undefined) {
    if (typeof item.endsAt !== 'string' || !INSTANT.test(item.endsAt) || !Number.isFinite(Date.parse(item.endsAt))) return null;
    if (Date.parse(item.endsAt) <= now) return 'expired'; // já acabou (cache do storefront): sai da lista sem invalidar o resto
    out.endsAt = item.endsAt;
  }
  return out;
}

// Aceita só o v1 DESTA loja; qualquer coisa fora dele => null (o botão não monta). Ids repetidos invalidam o payload.
export function normalizePromotions(data, store = ACTIVE_STORE, now = Date.now()) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || !Array.isArray(data.items) || data.items.length > MAX_ITEMS) return null;
  const items = [];
  const ids = new Set();
  for (const [index, raw] of data.items.entries()) {
    const item = normalizeItem(raw, index, now);
    if (item === null || (item !== 'expired' && ids.has(item.id))) return null;
    if (item === 'expired') continue;
    ids.add(item.id);
    items.push({ ...item, order: items.length + 1 });
  }
  const out = { v: 1, items };
  const t = data.theme;
  if (t !== undefined) {
    if (!t || typeof t !== 'object' || !HEX.test(t.primary) || !HEX.test(t.onPrimary)) return null;
    out.theme = { primary: t.primary.toLowerCase(), onPrimary: t.onPrimary.toLowerCase() };
  }
  return out;
}

export function createPromotionsGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
        const response = await upstream(new Request(store.storefront + store.promotionsApi, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 30, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizePromotions(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(clean), {
          status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30' }
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.promotions-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
