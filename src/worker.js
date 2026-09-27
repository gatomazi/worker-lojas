import { buildLoaderSource, buildDiscoverySource, discoveryOptions, discoveryQuery, loaderQuery, LOADER_VERSION } from './loader-source.js';
import { parseAllowlist } from './allowlist.js';
import { parseFeatures } from './features.js';
import { createSearchGateway } from './search-gateway.js';
import { createCartRefs } from './cart-ref.js';
import { createNavbarGateway, NAVBAR_PATH } from './navbar-gateway.js';
import { parseScopeMode, inScope, isCatalogProductPath, CATALOG_MODE, shellPageKind, shellEnabled } from './scope.js';
import { ACTIVE_STORE } from './stores.js';

const HOST = 'www.usesul.com.br';
// Página de produto exata: /usesul/product/<slug>. Sem subcaminhos, sem __origens.
const PRODUCT_PAGE = /^\/usesul\/product\/(?!__)[^/]+\/?$/;
const LOADER_PATH = '/__origens/loader.js';
const DISCOVERY_PATH = '/__origens/discovery.js';
const SEARCH_PATH = '/__origens/search';
const CART_REF_PATH = '/__origens/cart-ref';
const HEALTH_PATH = '/__origens/health';
// A URL do loader leva o HASH DO CONTEÚDO (?v=<versão>&c=<hash>): mudou o código, o escopo, as features ou a allowlist => URL nova.
// Por isso o navegador guarda o arquivo por um ano (imutável) e o Worker é invocado para o loader/discovery só na 1ª visita por
// configuração, não a cada visualização de produto. Rollback restaura URLs antigas cujo conteúdo continua o mesmo.
const loaderTag = (query) => '<script src="' + LOADER_PATH + '?' + query + '" defer data-cfasync="false" data-use-origens-widget="' + LOADER_VERSION + '"></script>';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=60'; // pedido sem hash (tag antiga) ou com hash de outra configuração: serve o conteúdo ATUAL, sem imutabilidade

// ENABLE_WIDGET: "false" (padrão; qualquer valor desconhecido também) | "dry-run" | "true".
function widgetMode(env) {
  const value = String(env.ENABLE_WIDGET ?? 'false').toLowerCase();
  return value === 'true' || value === 'dry-run' ? value : 'false';
}

// Só GET, HTML de página de produto OU (com header-nav + catálogo) de página "de casca" não transacional: home, listagem, coleções, sobre, conta/pedidos.
// Login, carrinho, checkout e qualquer outro caminho nunca. Turbo-Frame devolve fragmento sem <head>: fora do escopo.
const shellKindOf = (url) => shellPageKind(url.pathname, ACTIVE_STORE.inkBase);
function isEligibleRequest(request, url, shellOn) {
  if (request.method !== 'GET' || request.headers.has('Turbo-Frame')) return false;
  return PRODUCT_PAGE.test(url.pathname) || (shellOn && shellKindOf(url) !== null);
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
  constructor(tag) { this.alreadyPresent = false; this.tag = tag; }
  element(head) {
    // onEndTag corre depois de todo o conteúdo do <head>, então a detecção abaixo já terminou.
    head.onEndTag((end) => {
      if (!this.alreadyPresent) end.before(this.tag, { html: true });
    });
  }
}

// Modo product-catalog: só injeta se o HTML tem o formulário NATIVO de compra da INK (form#form-product-<id>), visto no MESMO
// passe de streaming (nada é bufferizado nem duplicado). O ponto de injeção é o fim do <body>, quando a detecção já terminou;
// sem </body> ou sem formulário, o HTML segue intacto.
class ProductFormDetector {
  constructor(state) { this.state = state; }
  element() { this.state.product = true; }
}
class BodyLoaderInjector {
  constructor(state) { this.state = state; }
  element(body) {
    body.onEndTag((end) => {
      if (this.state.product && !this.state.alreadyPresent) end.before(this.state.tag, { html: true });
    });
  }
}
// Página de casca: só injeta se o HTML tem o cabeçalho nativo da INK (nav.navbar), visto no MESMO passe; sem ele o HTML segue intacto.
class ShellHeaderDetector {
  constructor(state) { this.state = state; }
  element() { this.state.product = true; }
}
class ExistingLoaderMarker {
  constructor(state) { this.state = state; }
  element() { this.state.alreadyPresent = true; }
}

class ExistingLoaderDetector {
  constructor(injector) { this.injector = injector; }
  element() { this.injector.alreadyPresent = true; }
}

function javascript(request, body, cache) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': cache }
  });
}
const DISABLED_JS = '/* use-origens widget disabled */';

// Publicar o loader NÃO autoriza injetá-lo: quem autoriza páginas é só a allowlist, aplicada em
// injectLoader e reaplicada dentro do próprio loader (embutida aqui). Só entram os módulos de WIDGET_FEATURES.
function serveLoader(request, url, mode, allowlist, features, scope) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  // Com a flag desligada (ou dry-run) o loader vira no-op: páginas em cache no navegador não quebram.
  if (mode !== 'true') return javascript(request, DISABLED_JS, 'no-store');
  const expected = loaderQuery(allowlist.paths, features.features, scope.mode);
  const cache = url.searchParams.get('c') === expected.split('&c=')[1] && url.searchParams.get('v') === LOADER_VERSION ? IMMUTABLE : SHORT;
  return javascript(request, buildLoaderSource(allowlist.paths, features.features, scope.mode), cache);
}

// Módulo de descoberta carregado sob demanda pelo loader, só quando o drawer pós-adição abre.
function serveDiscovery(request, url, mode, features) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const postAdd = features.features.includes('post-add-discovery');
  const cart = features.features.includes('cart-discovery');
  const product = features.features.includes('product-discovery');
  if (mode !== 'true' || (!postAdd && !cart && !product)) return javascript(request, DISABLED_JS, 'no-store');
  const cache = url.searchParams.get('c') === discoveryQuery(features.features).split('&c=')[1] && url.searchParams.get('v') === LOADER_VERSION ? IMMUTABLE : SHORT;
  return javascript(request, buildDiscoverySource(discoveryOptions(features.features)), cache);
}

async function injectLoader(request, url, mode, allowlist, features, scope, upstream) {
  const shell = !PRODUCT_PAGE.test(url.pathname); // só chega aqui uma página de produto ou de casca (isEligibleRequest)
  const allowlisted = shell ? shellEnabled(scope.mode, features.features) : inScope(scope, allowlist, url.pathname);

  // Fail-closed: fora do escopo nada é reescrito, e nem sequer se olha a resposta.
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

  let transformed;
  if (scope.mode === CATALOG_MODE) {
    const state = { product: false, alreadyPresent: false, tag: loaderTag(loaderQuery(allowlist.paths, features.features, scope.mode)) };
    transformed = new HTMLRewriter()
      .on('script[data-use-origens-widget]', new ExistingLoaderMarker(state))
      .on(shell ? 'nav.navbar' : 'form[id^="form-product-"]', shell ? new ShellHeaderDetector(state) : new ProductFormDetector(state))
      .on('body', new BodyLoaderInjector(state))
      .transform(response);
  } else {
    const injector = new LoaderInjector(loaderTag(loaderQuery(allowlist.paths, features.features, scope.mode)));
    transformed = new HTMLRewriter()
      .on('script[data-use-origens-widget]', new ExistingLoaderDetector(injector))
      .on('head', injector)
      .transform(response);
  }

  // Copia status/headers (incluindo múltiplos Set-Cookie) e remove só o que deixa de valer após reescrever.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(transformed.body, { status: response.status, statusText: response.statusText, headers });
}

// Fábrica: permite trocar só a origem (fixtures no preview e nos testes). O Worker de produção
// (src/worker.js como `main`) usa sempre o fetch global; nada de preview é importado aqui.
export function createWorker(upstream, { gateway = createSearchGateway(), cartRefs = createCartRefs(), navbar = createNavbarGateway() } = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const mode = widgetMode(env);
      const allowlist = parseAllowlist(env.WIDGET_ALLOWLIST);
      const features = parseFeatures(env.WIDGET_FEATURES);
      const scope = parseScopeMode(env.WIDGET_SCOPE_MODE);

      // Health não depende da origem: valida a publicação antes de qualquer ativação.
      if (url.pathname === HEALTH_PATH || (url.pathname === '/__health' && url.hostname !== HOST)) {
        return Response.json({
          service: 'use-sul-widget',
          version: LOADER_VERSION,
          widget_mode: mode,
          allowlist_status: allowlist.status,
          allowlist_size: allowlist.paths.length,
          scope_mode: scope.mode,
          scope_status: scope.status,
          shell_pages: shellEnabled(scope.mode, features.features),
          features_status: features.status,
          widget_features: features.features,
          cart_ref_stats: cartRefs.stats()
        });
      }

      // workers.dev não é espelho da INK.
      if (url.hostname !== HOST) {
        return new Response('Test host: use /__health. The integration requires a Worker Route on www.', { status: 404 });
      }

      if (url.pathname === LOADER_PATH) return serveLoader(request, url, mode, allowlist, features, scope);
      if (url.pathname === DISCOVERY_PATH) return serveDiscovery(request, url, mode, features);
      // Gateway de busca: só com a flag ligada E a feature city-search; caso contrário a INK responde (404 dela).
      // Ponte do espelho do carrinho: só com true + cart-mirror (e o KV CART_REFS provisionado); senão a INK responde.
      if (url.pathname === CART_REF_PATH || url.pathname.startsWith(CART_REF_PATH + '/')) {
        if (mode !== 'true' || !features.features.includes('cart-mirror')) return passThrough(request, upstream);
        try {
          if (url.pathname === CART_REF_PATH) return await cartRefs.create(request, { kv: env.CART_REFS, allowedPaths: allowlist.paths, pathAllowed: scope.mode === CATALOG_MODE ? isCatalogProductPath : null, origin: 'https://' + HOST });
          return await cartRefs.read(request, { kv: env.CART_REFS, token: url.pathname.slice(CART_REF_PATH.length + 1) });
        } catch (_) {
          // O espelho é opcional: erro inesperado = 503 JSON (o cliente navega sem token); nunca uma página de erro da Cloudflare.
          logEvent('error', 'cart-ref-failed', {});
          return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
        }
      }
      // Configuração pública da navbar (coleções do CMS): só com true + header-nav; caso contrário a INK responde (404 dela).
      if (url.pathname === NAVBAR_PATH) {
        return mode === 'true' && features.features.includes('header-nav') ? navbar.handle(request) : passThrough(request, upstream);
      }
      if (url.pathname === SEARCH_PATH) {
        return mode === 'true' && features.features.includes('city-search') ? gateway.handle(request, ctx) : passThrough(request, upstream);
      }

      // Sem nenhum módulo liberado não há o que injetar (fail-closed).
      if (mode === 'false' || features.features.length === 0 || !isEligibleRequest(request, url, shellEnabled(scope.mode, features.features))) return passThrough(request, upstream);
      // Falha ABERTA: qualquer erro nosso ao reescrever devolve a página original da INK (a compra nunca depende do widget).
      try {
        return await injectLoader(request, url, mode, allowlist, features, scope, upstream);
      } catch (_) {
        logEvent('error', 'inject-failed', { path: url.pathname });
        return passThrough(request, upstream);
      }
    }
  };
}

// O fetch global é resolvido a cada chamada (os testes com mock substituem globalThis.fetch).
export default createWorker((request, init) => fetch(request, init));
