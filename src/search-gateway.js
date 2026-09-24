// GET /__origens/search?q=  — gateway SOMENTE LEITURA para o índice público de cidades do storefront.
// Motivo: /api/cidades/sul não envia CORS para www.usesul.com.br, então o navegador não pode consumi-lo diretamente.
// Garantias: origem FIXA (useorigens.com.br), sem SSRF (nenhuma URL vem do visitante), sem repassar Cookie/Authorization,
// timeout, limite de tamanho, validação de esquema, só campos públicos, links montados aqui (nunca vindos do índice).
// Não registra a consulta em log. Resposta `no-store`; só o índice público é cacheado (memória + cache de borda, TTL curto).
import { prepareCities, searchCities, STATE_NAMES } from './search-rank.js';

const ORIGIN = 'https://useorigens.com.br';
const INDEX_URL = ORIGIN + '/api/cidades/sul';
const INDEX_TTL_MS = 5 * 60 * 1000;
const INDEX_STALE_MS = 24 * 60 * 60 * 1000;
const INDEX_TIMEOUT_MS = 3000;
const INDEX_MAX_CHARS = 600_000;
const INDEX_MAX_ITEMS = 5000;
const INDEX_MIN_ITEMS = 100;
export const MAX_RESULTS = 5;
const QUERY = /^[\p{L}\p{M}\p{N} .,'’\-]{2,40}$/u;
const UF = /^(PR|SC|RS)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// Aceita só entradas com o formato conhecido; descarta o resto. Devolve null se o índice não parece o real.
export function validateIndex(data) {
  if (!Array.isArray(data) || data.length > INDEX_MAX_ITEMS) return null;
  const clean = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { n, u, s, m, a } = item;
    if (typeof n !== 'string' || n.length === 0 || n.length > 60 || typeof u !== 'string' || !UF.test(u) || typeof s !== 'string' || s.length > 60 || !SLUG.test(s)) continue;
    const entry = { n, u, s };
    if (typeof m === 'string' && m.length <= 80) entry.m = m;
    if (Array.isArray(a)) entry.a = a.filter((x) => typeof x === 'string' && x.length <= 40).slice(0, 8);
    clean.push(entry);
  }
  return clean.length >= INDEX_MIN_ITEMS ? clean : null;
}

export function createSearchGateway({ upstream = (request, init) => fetch(request, init), now = () => Date.now() } = {}) {
  let cache = null; // { prepared, at }
  let inflight = null;

  async function loadIndex() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INDEX_TIMEOUT_MS);
    try {
      // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization.
      const response = await upstream(new Request(INDEX_URL, { method: 'GET', headers: { accept: 'application/json' } }), {
        redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('index status ' + response.status);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > INDEX_MAX_CHARS) throw new Error('index too large');
      const text = await response.text();
      if (text.length > INDEX_MAX_CHARS) throw new Error('index too large');
      const clean = validateIndex(JSON.parse(text));
      if (!clean) throw new Error('index schema');
      return { prepared: prepareCities(clean), at: now() };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getIndex() {
    if (cache && now() - cache.at < INDEX_TTL_MS) return cache.prepared;
    inflight ??= loadIndex().then(
      (fresh) => { cache = fresh; inflight = null; return fresh; },
      (error) => { inflight = null; throw error; }
    );
    try {
      return (await inflight).prepared;
    } catch (error) {
      // Índice velho é melhor que nenhum resultado, por até 24 h.
      if (cache && now() - cache.at < INDEX_STALE_MS) return cache.prepared;
      throw error;
    }
  }

  return {
    async handle(request) {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      const q = new URL(request.url).searchParams.get('q');
      const query = typeof q === 'string' ? q.trim() : '';
      if (!QUERY.test(query)) return json({ error: 'bad_request' }, 400);

      let prepared;
      try {
        prepared = await getIndex();
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.search-index-error', reason: String(error && error.message).slice(0, 40) }));
        return json({ error: 'unavailable' }, 502);
      }
      const results = searchCities(prepared, query, { limit: MAX_RESULTS }).map((r) =>
        r.type === 'city'
          ? { type: 'city', name: r.city.n, uf: r.city.u, meso: r.city.m ?? null, href: ORIGIN + '/sul/' + r.city.u.toLowerCase() + '/' + r.city.s }
          : { type: 'state', name: STATE_NAMES[r.uf], uf: r.uf, meso: null, href: ORIGIN + '/sul/' + r.uf.toLowerCase() }
      );
      return json({ results });
    }
  };
}
