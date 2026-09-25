// cart-ref: ponte INK -> storefront para o ESPELHO do carrinho (feature cart-mirror). NÃO é um carrinho: guarda só um resumo
// (nome, variante, quantidade, preço da linha, imagem) do último estado LIDO NO DOM da INK, por poucos minutos, atrás de um
// token aleatório (128 bits). O carrinho verdadeiro continua sendo o da INK. Nenhum cookie/sessão/CSRF/dado pessoal é aceito ou guardado.
//   POST /__origens/cart-ref            (só a página autorizada da INK; JSON validado; devolve {ref, ttl})
//   GET  /__origens/cart-ref/<token>    (lido pelo SERVIDOR do storefront; sem CORS; no-store)
// Armazenamento: KV `CART_REFS` (expirationTtl). Sem o binding, a feature responde 501 "not_configured" e nada é gravado.
export const CART_REF_TTL_SECONDS = 1800;
export const MAX_ITEMS = 20;
const MAX_BODY_CHARS = 8192;
const TOKEN = /^[A-Za-z0-9_-]{22}$/; // 16 bytes em base64url
const INK_IMAGE_HOST = 'gcp-images.majestic.ink.rsvcloud.com';
const INK_IMAGE_PATH = /^\/images\/[A-Za-z0-9_\/.-]{1,200}$/;
const PRICE_TEXT = /^R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f<>]/g;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const clean = (value, max) => (typeof value === 'string' ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);
const money = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 999999 ? Math.round(value * 100) / 100 : null);

// Valida e NORMALIZA o resumo. Qualquer coisa fora do formato => null (nada é gravado). Só campos conhecidos sobrevivem.
export function validateSnapshot(input) {
  if (!input || typeof input !== 'object' || input.v !== 1) return null;
  const count = int(input.count, 0, 999);
  if (count === null || !Array.isArray(input.items) || input.items.length > MAX_ITEMS) return null;
  const items = [];
  for (const raw of input.items) {
    if (!raw || typeof raw !== 'object') return null;
    const name = clean(raw.name, 120);
    const quantity = int(raw.quantity, 1, 99);
    const linePrice = money(raw.linePrice);
    if (!name || quantity === null || linePrice === null || typeof raw.productId !== 'string' || !/^\d{1,12}$/.test(raw.productId)) return null;
    const item = { productId: raw.productId, name, color: clean(raw.color, 40), size: clean(raw.size, 40), variant: clean(raw.variant, 120), quantity, linePrice };
    if (typeof raw.linePriceText === 'string' && PRICE_TEXT.test(raw.linePriceText.trim())) item.linePriceText = raw.linePriceText.trim();
    // Preço cheio riscado (promoção por quantidade), opcional.
    if (typeof raw.listPriceText === 'string' && PRICE_TEXT.test(raw.listPriceText.trim())) item.listPriceText = raw.listPriceText.trim();
    const listPrice = money(raw.listPrice); if (listPrice !== null && item.listPriceText) item.listPrice = listPrice;
    if (typeof raw.image === 'string') {
      try {
        const url = new URL(raw.image);
        if (url.protocol === 'https:' && url.host === INK_IMAGE_HOST && !url.username && !url.password && !url.search && !url.hash && INK_IMAGE_PATH.test(url.pathname)) item.image = url.href;
      } catch (_) { /* imagem descartada */ }
    }
    items.push(item);
  }
  const subtotal = input.subtotal === null || input.subtotal === undefined ? null : money(input.subtotal);
  const discount = input.discount === null || input.discount === undefined ? null : money(input.discount);
  if (subtotal === undefined || (input.subtotal != null && subtotal === null) || (input.discount != null && discount === null)) return null;
  // Total EXIBIDO pela INK (opcional): guardado só como informação, nunca calculado aqui.
  const out = { v: 1, count, items, subtotal, discount };
  if (input.total !== null && input.total !== undefined) { const total = money(input.total); if (total === null) return null; out.total = total; }
  if (typeof input.totalText === 'string' && PRICE_TEXT.test(input.totalText.trim())) out.totalText = input.totalText.trim();
  return out;
}

function newToken(random) {
  const bytes = random(new Uint8Array(16));
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Limite simples por IP (memória do isolate): freia abuso trivial sem estado global. Não substitui uma regra de rate limit da zona.
function createLimiter({ now, windowMs = 60_000 }) {
  const hits = new Map();
  return (key, max) => {
    const t = now();
    const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= windowMs) hits.delete(k);
    return true;
  };
}

export function createCartRefs({ now = () => Date.now(), random = (a) => crypto.getRandomValues(a) } = {}) {
  const allow = createLimiter({ now });
  // Contadores AGREGADOS por isolate (sem PII, sem tokens, sem caminhos): diagnóstico de custo do KV. Zeram quando o isolate recicla.
  const counters = { writes: 0, write_failures: 0, reads: 0, read_hits: 0, read_misses: 0, rate_limited: 0, rejected: 0 };
  const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

  return {
    // POST: só da página autorizada da INK (mesma origem, Referer na allowlist). `kv` = env.CART_REFS.
    async create(request, { kv, allowedPaths, origin, pathAllowed = null }) {
      if (!kv) return json({ error: 'not_configured' }, 501);
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      const site = request.headers.get('sec-fetch-site');
      let referer = null; try { referer = new URL(request.headers.get('referer') || ''); } catch (_) { /* ausente */ }
      if ((site && site !== 'same-origin') || request.headers.get('origin') !== origin || !referer || referer.origin !== origin || !(allowedPaths.includes(referer.pathname) || (pathAllowed && pathAllowed(referer.pathname)))) { counters.rejected++; return json({ error: 'forbidden' }, 403); }
      if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return json({ error: 'bad_request' }, 400);
      if (!allow('post:' + ipOf(request), 20)) { counters.rate_limited++; return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' }); }
      const text = await request.text();
      if (text.length > MAX_BODY_CHARS) return json({ error: 'too_large' }, 413);
      let parsed; try { parsed = JSON.parse(text); } catch (_) { return json({ error: 'bad_request' }, 400); }
      const snapshot = validateSnapshot(parsed);
      if (!snapshot) return json({ error: 'bad_request' }, 400);
      const ref = newToken(random);
      const savedAt = now();
      try {
        await kv.put('cartref:' + ref, JSON.stringify({ ...snapshot, savedAt }), { expirationTtl: CART_REF_TTL_SECONDS });
      } catch (_) {
        counters.write_failures++; // KV indisponível/limite: o cliente segue sem espelho; nada quebra a compra
        return json({ error: 'unavailable' }, 503);
      }
      counters.writes++;
      return json({ ref, ttl: CART_REF_TTL_SECONDS }, 201);
    },

    // GET: lido pelo servidor do storefront. Token desconhecido/expirado/malformado => 404 (sem distinguir).
    async read(request, { kv, token }) {
      if (!kv) return json({ error: 'not_configured' }, 501);
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      if (!allow('get:' + ipOf(request), 120)) { counters.rate_limited++; return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' }); }
      if (!TOKEN.test(token)) return json({ error: 'not_found' }, 404);
      counters.reads++;
      let stored;
      try { stored = await kv.get('cartref:' + token, 'json'); } catch (_) { return json({ error: 'unavailable' }, 503); }
      if (!stored || typeof stored.savedAt !== 'number') { counters.read_misses++; return json({ error: 'not_found' }, 404); }
      counters.read_hits++;
      const ageSeconds = Math.max(0, Math.round((now() - stored.savedAt) / 1000));
      if (ageSeconds > CART_REF_TTL_SECONDS) return json({ error: 'not_found' }, 404);
      const { savedAt, ...snapshot } = stored;
      return json({ ...snapshot, ageSeconds, expiresInSeconds: Math.max(0, CART_REF_TTL_SECONDS - ageSeconds) });
    },

    stats() { return { ...counters }; }
  };
}
