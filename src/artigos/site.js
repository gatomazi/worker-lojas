// O `site` da vitrine (o topo como o storefront o desenha), lido no servidor e validado pelo MESMO normalizador da INK (src/navbar-gateway.js).
// Origem FIXA (stores.js), pedido novo sem Cookie/Authorization do visitante, timeout, limite de tamanho e esquema estrito. Guardado no isolate por 60 s;
// vários pedidos juntos dividem uma leitura; vitrine instável: usa o último `site` bom por até 10 min em vez de voltar ao topo nativo.
import { normalizeNavbar } from '../navbar-gateway.js';
import { STORES } from '../stores.js';

const STORE = STORES.sul; // loja única: a vitrine da Sul entrega o topo das três regiões
export const FETCH_TIMEOUT_MS = 1500; // a página nunca espera mais que isso pela vitrine: passou, sai com o topo nativo
const MAX_CHARS = 65536;
export const FRESH_MS = 60 * 1000;
export const STALE_MS = 10 * 60 * 1000;

export const log = (level, event, fields) => console[level](JSON.stringify({ event: 'use-origens.artigos-' + event, ...fields }));

export function createSiteSource({ upstream = (request, init) => fetch(request, init), now = () => Date.now() } = {}) {
  let cached = null;
  let at = 0;
  let inflight = null;
  async function refresh() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await upstream(new Request(STORE.storefront + STORE.navbarApi, { method: 'GET', headers: { accept: 'application/json' } }), {
        redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true }
      });
      if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
      const text = await response.text();
      if (text.length > MAX_CHARS) throw new Error('too large');
      const clean = normalizeNavbar(JSON.parse(text), STORE);
      if (!clean || !clean.site) throw new Error('schema');
      cached = clean.site;
      at = now();
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async get() {
      if (cached && now() - at < FRESH_MS) return cached;
      try {
        if (!inflight) inflight = refresh().finally(() => { inflight = null; });
        await inflight;
      } catch (error) {
        log('warn', 'site-error', { reason: String(error && error.message).slice(0, 40) });
      }
      return cached && now() - at < STALE_MS ? cached : null;
    }
  };
}
