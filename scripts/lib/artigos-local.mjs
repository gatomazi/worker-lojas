// O Worker do artigos rodando LOCAL (Miniflare, o workerd de verdade) na frente da loja REAL da Uma Penca, e o encanamento para um navegador (Playwright) usá-lo.
// Só os documentos HTML do artigos passam pelo Worker; o resto da página (imagens, scripts, APIs) vem direto da Uma Penca, como em produção. Nada é publicado.
// Usado por scripts/qa-artigos.mjs (conferências e capturas) e scripts/ver-artigos.mjs (janelas abertas para ver ao vivo).
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';

export const HOST = 'https://artigos.useorigens.com.br';
export const PRODUCT = '/caneca/la-de-chapeco-sc-444855.html';
const SRC = new URL('../../src/', import.meta.url).pathname;
const FIXTURE_NAVBAR = new URL('../../test/fixtures/artigos-navbar-sul.json', import.meta.url);
const MODULES = ['artigos/worker.js', 'artigos/escopo.js', 'artigos/site.js', 'artigos/rewrite.js', 'artigos/topo.js', 'navbar-gateway.js', 'stores.js'].map((file) => ({ type: 'ESModule', path: SRC + file }));

// `fixture: true` usa o payload guardado em test/fixtures no lugar do /api/navbar/sul real de produção.
export function startLocalWorker({ fixture = false } = {}) {
  return new Miniflare({
    modulesRoot: SRC, modules: MODULES, compatibilityDate: '2026-08-01', bindings: { ARTIGOS_TOPO: 'true' },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.host === 'useorigens.com.br' && fixture) return new Response(readFileSync(FIXTURE_NAVBAR), { headers: { 'content-type': 'application/json' } });
      // O fetch do Node não aceita o Request do Miniflare: refaz o pedido pela URL, sem os cabeçalhos internos (host, cf-worker).
      const headers = {}; request.headers.forEach((v, k) => { if (!['host', 'cf-worker'].includes(k)) headers[k] = v; });
      return fetch(request.url, { method: request.method, headers, redirect: 'manual' });
    }
  });
}

// Faz os DOCUMENTOS do artigos passarem pelo Worker local; todo o resto segue direto para a Uma Penca.
export const routeThroughWorker = (page, mf) => page.route(HOST + '/**', async (r) => {
  const req = r.request();
  if (req.resourceType() !== 'document' || req.method() !== 'GET') return r.continue();
  const headers = { ...req.headers() }; delete headers.host;
  const res = await mf.dispatchFetch(req.url(), { headers, redirect: 'manual' });
  const body = Buffer.from(await res.arrayBuffer());
  const out = {}; res.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) out[k] = v; });
  return r.fulfill({ status: res.status, headers: out, body });
});
