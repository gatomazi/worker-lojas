import { buildLoaderSource, LOADER_VERSION } from './loader-source.js';
import { parseAllowlist } from './allowlist.js';

const HOST = 'www.usesul.com.br';
// Página de produto exata: /usesul/product/<slug>. Sem subcaminhos, sem __origens.
const PRODUCT_PAGE = /^\/usesul\/product\/(?!__)[^/]+\/?$/;
const LOADER_PATH = '/__origens/loader.js';
const HEALTH_PATH = '/__origens/health';
const LOADER_TAG = '<script src="' + LOADER_PATH + '?v=' + LOADER_VERSION +
  '" defer data-cfasync="false" data-use-origens-widget="' + LOADER_VERSION + '"></script>';

// ENABLE_WIDGET: "false" (padrão; qualquer valor desconhecido também) | "dry-run" | "true".
function widgetMode(env) {
  const value = String(env.ENABLE_WIDGET ?? 'false').toLowerCase();
  return value === 'true' || value === 'dry-run' ? value : 'false';
}

// Só GET, HTML de página de produto. Turbo-Frame devolve fragmento sem <head>: fora do escopo.
function isEligibleRequest(request, url) {
  return request.method === 'GET' && PRODUCT_PAGE.test(url.pathname) && !request.headers.has('Turbo-Frame');
}

// Redirects e erros da origem chegam ao cliente sem serem seguidos nem alterados.
// `upstream` é o fetch da origem; em produção é o fetch global (ver createWorker).
function passThrough(request, upstream) {
  return upstream(request, { redirect: 'manual' });
}

// Logs estruturados sem cookie, sessão nem query string: só o caminho do produto (público).
function logEvent(level, event, fields) {
  console[level](JSON.stringify({ event: 'use-origens.' + event, ...fields }));
}

class LoaderInjector {
  constructor() { this.alreadyPresent = false; }
  element(head) {
    // onEndTag corre depois de todo o conteúdo do <head>, então a detecção abaixo já terminou.
    head.onEndTag((end) => {
      if (!this.alreadyPresent) end.before(LOADER_TAG, { html: true });
    });
  }
}

class ExistingLoaderDetector {
  constructor(injector) { this.injector = injector; }
  element() { this.injector.alreadyPresent = true; }
}

// Publicar o loader NÃO autoriza injetá-lo: quem autoriza páginas é só a allowlist, aplicada em
// injectLoader e reaplicada dentro do próprio loader (embutida aqui).
function serveLoader(request, mode, allowlist) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  // Com a flag desligada (ou dry-run) o loader vira no-op: páginas em cache no navegador não quebram.
  const body = mode === 'true' ? buildLoaderSource(allowlist.paths) : '/* use-origens widget disabled */';
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': mode === 'true' ? 'public, max-age=60' : 'no-store'
    }
  });
}

async function injectLoader(request, url, mode, allowlist, upstream) {
  const allowlisted = allowlist.paths.includes(url.pathname);

  // Fail-closed: fora da allowlist nada é reescrito, e nem sequer se olha a resposta.
  if (mode === 'true' && !allowlisted) return passThrough(request, upstream);

  const response = await passThrough(request, upstream);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (response.status !== 200 || !contentType.startsWith('text/html')) return response;
  if (/attachment/i.test(response.headers.get('content-disposition') || '')) return response;

  if (mode === 'dry-run') {
    // Só observabilidade: mesmo pedido à origem, corpo e cabeçalhos intactos, um log por página elegível.
    logEvent('log', 'dry-run', {
      path: url.pathname,
      allowlisted,
      would_inject: allowlisted,
      allowlist_status: allowlist.status
    });
    return response;
  }

  // Se o runtime não decodificou o corpo (Content-Encoding ainda presente), reescrever corromperia a página.
  const encoding = response.headers.get('content-encoding');
  if (encoding) {
    logEvent('warn', 'skip-encoded-body', { path: url.pathname, encoding: encoding.slice(0, 16) });
    return response;
  }

  const injector = new LoaderInjector();
  const transformed = new HTMLRewriter()
    .on('script[data-use-origens-widget]', new ExistingLoaderDetector(injector))
    .on('head', injector)
    .transform(response);

  // Copia status/headers (incluindo múltiplos Set-Cookie) e remove só o que deixa de valer após reescrever.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(transformed.body, { status: response.status, statusText: response.statusText, headers });
}

// Fábrica: permite trocar só a origem (fixtures no preview e nos testes). O Worker de produção
// (src/worker.js como `main`) usa sempre o fetch global; nada de preview é importado aqui.
export function createWorker(upstream) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const mode = widgetMode(env);
      const allowlist = parseAllowlist(env.WIDGET_ALLOWLIST);

      // Health não depende da origem: valida a publicação antes de qualquer ativação.
      if (url.pathname === HEALTH_PATH || (url.pathname === '/__health' && url.hostname !== HOST)) {
        return Response.json({
          service: 'use-sul-widget',
          version: LOADER_VERSION,
          widget_mode: mode,
          allowlist_status: allowlist.status,
          allowlist_size: allowlist.paths.length
        });
      }

      // workers.dev não é espelho da INK.
      if (url.hostname !== HOST) {
        return new Response('Test host: use /__health. The integration requires a Worker Route on www.', { status: 404 });
      }

      if (url.pathname === LOADER_PATH) return serveLoader(request, mode, allowlist);

      if (mode === 'false' || !isEligibleRequest(request, url)) return passThrough(request, upstream);
      return injectLoader(request, url, mode, allowlist, upstream);
    }
  };
}

// O fetch global é resolvido a cada chamada (os testes com mock substituem globalThis.fetch).
export default createWorker((request, init) => fetch(request, init));
