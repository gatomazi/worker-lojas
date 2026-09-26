// GET /__origens/navbar — gateway SOMENTE LEITURA para a configuração pública da navbar (coleções escolhidas no CMS do storefront).
// Motivo: o header desenhado na INK precisa mudar sem novo deploy do Worker, e /api/navbar/<região> não envia CORS para www.usesul.com.br.
// Garantias (mesmo desenho de search-gateway.js): origem FIXA vinda de stores.js (nenhuma URL vem do visitante), sem repassar
// Cookie/Authorization, timeout, limite de tamanho, validação estrita de esquema, só campos públicos. Só o servidor lê o storefront.
// Resposta cacheável por 60 s (o CMS publica devagar); falha => 503 e o cliente simplesmente NÃO monta a navbar (a da INK segue intacta).
import { ACTIVE_STORE } from './stores.js';

export const NAVBAR_PATH = '/__origens/navbar';
const FETCH_TIMEOUT_MS = 3000;
const MAX_CHARS = 8192;
export const MAX_COLLECTIONS = 8;
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const CONTROL = /[\u0000-\u001f\u007f<>]/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// Aceita só o formato conhecido; qualquer coisa fora dele => null (a navbar não monta). Nomes são texto puro (o cliente usa textContent).
export function normalizeNavbar(data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region || !Array.isArray(data.collections) || data.collections.length > MAX_COLLECTIONS) return null;
  const collections = [];
  const seen = new Set();
  for (const item of data.collections) {
    if (!item || typeof item !== 'object') return null;
    const name = typeof item.name === 'string' ? item.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 1 || name.length > 60 || CONTROL.test(name) || typeof item.slug !== 'string' || !SLUG.test(item.slug)) return null;
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    collections.push({ name, slug: item.slug });
  }
  return { v: 1, collections };
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
