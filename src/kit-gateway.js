// GET /__origens/kit — gateway SOMENTE LEITURA do "Monte seu kit" publicado no CMS do storefront (/api/post-add-kit/<região>, contrato v1): a promoção
// progressiva da INK que o modal "Produto adicionado ao carrinho" mostra, com as faixas que a PRÓPRIA INK tem agora (o storefront as lê da API da INK).
// Mesmo desenho de promotions-gateway.js: origem FIXA vinda de stores.js (nenhuma URL vem do visitante), sem repassar Cookie/Authorization, timeout, limite
// de tamanho, validação ESTRITA do esquema e só os campos de exibição. Cache curto (60 s). Falha => 503 e o cliente simplesmente NÃO monta o bloco.
// Diferente dos cupons, aqui há números: as faixas (peças e desconto) vêm da INK, e o cliente só multiplica pelo preço da peça adicionada. Quem aplica o
// desconto continua sendo o carrinho da INK.
// Contrato v1: { v:1, region, kit: null | { id, code, auto, kind:'value'|'percentage', tiers:[{ items, discount }], endsAt?, eyebrow, title, lead } }.
import { ACTIVE_STORE } from './stores.js';

export const KIT_PATH = '/__origens/kit';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 8192;
export const MAX_TIERS = 6; // o mesmo teto do storefront
const CODE = /^[A-Za-z0-9_-]{2,40}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
// Texto puro de uma linha; `<` e `>` também são recusados (o cliente usa textContent, isto é defesa em profundidade).
const CONTROL = /[\u0000-\u001f\u007f<>]/;
const LIMITS = { eyebrow: 40, title: 60, lead: 160 };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const cleanText = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};

// Faixas por quantidade, da menor para a maior, sem repetir: 2..999 peças; desconto > 0 (e < 100 quando é percentual). Fora disso => null.
export function normalizeTiers(tiers, kind) {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > MAX_TIERS) return null;
  const out = [];
  for (const t of tiers) {
    if (!t || typeof t !== 'object' || Object.keys(t).some((k) => k !== 'items' && k !== 'discount')) return null;
    const { items, discount } = t;
    if (!Number.isInteger(items) || items < 2 || items > 999 || typeof discount !== 'number' || !Number.isFinite(discount) || discount <= 0 || discount > 100000) return null;
    if (kind === 'percentage' && discount >= 100) return null;
    if (out.length && items <= out[out.length - 1].items) return null;
    out.push({ items, discount });
  }
  return out;
}

// Aceita só o v1 DESTA região; qualquer coisa fora dele => null (o bloco não monta). `kit: null` é válido: nada a mostrar.
export function normalizeKit(data, store = ACTIVE_STORE, now = Date.now()) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || !('kit' in data)) return null;
  const k = data.kit;
  if (k === null) return { v: 1, kit: null };
  if (!k || typeof k !== 'object') return null;
  if (!Number.isInteger(k.id) || k.id < 1 || typeof k.code !== 'string' || !CODE.test(k.code) || typeof k.auto !== 'boolean') return null;
  if (k.kind !== 'value' && k.kind !== 'percentage') return null;
  const tiers = normalizeTiers(k.tiers, k.kind);
  if (!tiers) return null;
  const kit = { id: k.id, code: k.code, auto: k.auto, kind: k.kind, tiers };
  for (const key of Object.keys(LIMITS)) {
    const text = cleanText(k[key], LIMITS[key]);
    if (!text) return null;
    kit[key] = text;
  }
  if (k.endsAt !== undefined) {
    if (typeof k.endsAt !== 'string' || !INSTANT.test(k.endsAt) || !Number.isFinite(Date.parse(k.endsAt))) return null;
    if (Date.parse(k.endsAt) <= now) return { v: 1, kit: null }; // já acabou (cache do storefront)
    kit.endsAt = k.endsAt;
  }
  return { v: 1, kit };
}

export function createKitGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
        const response = await upstream(new Request(store.storefront + store.kitApi, { method: 'GET', headers: { accept: 'application/json' } }), {
          redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeKit(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(clean), {
          status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' }
        });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.kit-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
