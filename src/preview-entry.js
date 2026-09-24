// SOMENTE PREVIEW (wrangler.preview.toml). Roda o Worker de produção (src/worker.js) contra uma origem de fixture
// para exercitá-lo no edge, já que workers.dev não é o host www.usesul.com.br. NÃO é usado em produção.
//
//   GET  /__origens/health                       health real do Worker
//   *    /__preview/fixture/default/<caminho>    fixture; env como implantado
//   *    /__preview/fixture/allowlisted/<caminho> fixture; allowlist = serra-catarinense
//   GET  /__preview/live                         GET público de UMA página da INK; devolve só metadados (sem corpo, sem cookies)
//
// ENABLE_WIDGET é FIXO em "false" nos cenários de fixture e no live: nenhuma requisição ao preview consegue ligar
// a injeção, mesmo que a variável implantada mude.
import { createWorker } from './worker.js';
import { fixtureFetch } from './preview-fixtures.js';

const REAL_HOST = 'https://www.usesul.com.br';
const LIVE_PATH = '/usesul/product/serra-catarinense';
const FIXTURE_ALLOWLIST = '/usesul/product/serra-catarinense';
const FIXTURE_METHODS = new Set(['GET', 'HEAD', 'POST']);

const production = createWorker((request, init) => fetch(request, init));
const onFixtures = createWorker(fixtureFetch);

function fixtureEnv(variant, env) {
  return {
    ENABLE_WIDGET: 'false',
    WIDGET_ALLOWLIST: variant === 'allowlisted' ? FIXTURE_ALLOWLIST : String(env.WIDGET_ALLOWLIST ?? '')
  };
}

async function live(env) {
  // Origem REAL, mas só o caminho fixo acima, só GET, sem cabeçalhos do cliente e sem repassar corpo nem cookies.
  const request = new Request(REAL_HOST + LIVE_PATH, { headers: { accept: 'text/html', 'accept-encoding': 'gzip, br' } });
  const response = await production.fetch(request, { ENABLE_WIDGET: 'false', WIDGET_ALLOWLIST: String(env.WIDGET_ALLOWLIST ?? '') });
  const text = await response.clone().text();
  const bytes = (await response.arrayBuffer()).byteLength;
  const h = (name) => response.headers.get(name);
  return Response.json({
    note: 'metadata only; body and cookie values are never returned',
    status: response.status,
    content_type: h('content-type'),
    content_encoding_seen_by_worker: h('content-encoding'),
    content_length_header: h('content-length'),
    cache_control: h('cache-control'),
    csp_present: h('content-security-policy') !== null,
    etag_present: h('etag') !== null,
    set_cookie_names: response.headers.getSetCookie().map((cookie) => cookie.split('=')[0]),
    body_bytes_seen: bytes,
    body_looks_like_html: /^\s*<!doctype html/i.test(text),
    has_native_cta: text.includes('id=\'add-to-cart-desk\'') || text.includes('id="add-to-cart-desk"'),
    loader_present: text.includes('data-use-origens-widget')
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__origens/health') return production.fetch(request, env);

    if (url.pathname === '/__preview/live') {
      return request.method === 'GET' ? live(env) : new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
    }

    const match = url.pathname.match(/^\/__preview\/fixture\/(default|allowlisted)(\/usesul\/.*)$/);
    if (match) {
      if (!FIXTURE_METHODS.has(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
      // Só método, caminho, query, Turbo-Frame e Accept-Encoding importam; o resto do pedido não é repassado.
      const headers = new Headers();
      for (const name of ['accept', 'accept-encoding', 'turbo-frame']) {
        if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      }
      const target = new Request(REAL_HOST + match[2] + url.search, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? request.body : undefined,
        redirect: 'manual'
      });
      return onFixtures.fetch(target, fixtureEnv(match[1], env));
    }

    return new Response('Preview only: /__origens/health, /__preview/fixture/{default|allowlisted}/usesul/..., /__preview/live', { status: 404 });
  }
};
