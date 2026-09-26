// Loader entregue pelo próprio Worker, no mesmo hostname da loja (www.usesul.com.br). Um ÚNICO ponto de entrada,
// composto por módulos independentes (src/loader/*): runtime, return-link, post-add-discovery e cart-discovery (estes carregam
// discovery.js sob demanda). Só entram no bundle os módulos liberados por WIDGET_FEATURES.
// A allowlist é embutida na entrega (defesa em profundidade): o Turbo Drive mantém o JS vivo entre páginas.
import { RUNTIME_HEAD, RUNTIME_TAIL } from './loader/runtime.js';
import { RETURN_LINK } from './loader/return-link.js';
import { DRAWER_WATCH } from './loader/drawer-watch.js';
import { CART_WATCH } from './loader/cart-watch.js';
import { DISCOVERY_LOADER } from './loader/discovery-loader.js';
import { CART_MIRROR } from './loader/cart-mirror.js';
import { TRACKING } from './loader/tracking.js';
import { PRODUCT_DISCOVERY } from './loader/product-discovery.js';
import { HEADER_NAV } from './loader/header-nav.js';
import { clientStore } from './stores.js';
import { buildDiscoverySource } from './loader/discovery-ui.js';
import { DEFAULT_FEATURES } from './features.js';
import { shellPageKind, shellEnabled } from './scope.js';
import { ACTIVE_STORE } from './stores.js';

export const LOADER_VERSION = '4.6';
export { buildDiscoverySource };

// Hash de CONTEÚDO (cyrb53, 53 bits): o nome do arquivo muda quando o conteúdo muda, então o navegador pode guardá-lo por um ano
// (imutável) sem risco de servir uma versão velha após deploy, troca de escopo ou rollback. Determinístico e sem segredo.
export function contentHash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Opções do discovery.js derivadas das features (mesma regra do Worker e do loader).
export const discoveryOptions = (features) => ({ search: features.includes('city-search'), postAdd: features.includes('post-add-discovery'), cart: features.includes('cart-discovery'), product: features.includes('product-discovery') });

const memo = new Map(); // por isolate: a configuração (features/escopo/allowlist) quase nunca muda; evita refazer a string e o hash a cada pedido
const memoize = (key, make) => { if (!memo.has(key)) { if (memo.size > 64) memo.clear(); memo.set(key, make()); } return memo.get(key); };
export const discoveryQuery = (features) => memoize('d:' + features.join(','), () => 'v=' + LOADER_VERSION + '&c=' + contentHash(buildDiscoverySource(discoveryOptions(features))));

// allowedPaths e features já vêm validados (parseAllowlist/parseFeatures): só [a-z0-9_/-] e nomes conhecidos,
// então JSON.stringify é seguro aqui.
export function buildLoaderSource(allowedPaths = [], features = DEFAULT_FEATURES, scopeMode = 'allowlist') {
  const parts = [RUNTIME_HEAD];
  // Medição dos cliques nos nossos links: só quando algum módulo que cria links para o storefront está ligado.
  if (features.includes('return-link') || features.includes('post-add-discovery') || features.includes('cart-discovery') || features.includes('product-discovery')) parts.push(TRACKING);
  if (features.includes('return-link')) parts.push(RETURN_LINK);
  if (features.includes('post-add-discovery') || features.includes('cart-discovery') || features.includes('product-discovery')) parts.push(DISCOVERY_LOADER);
  if (features.includes('post-add-discovery')) parts.push(DRAWER_WATCH);
  if (features.includes('cart-discovery')) parts.push(CART_WATCH);
  if (features.includes('cart-mirror')) parts.push(CART_MIRROR);
  if (features.includes('product-discovery')) parts.push(PRODUCT_DISCOVERY);
  if (features.includes('header-nav')) parts.push(HEADER_NAV);
  parts.push(RUNTIME_TAIL);
  return parts.join('')
    .replace('__DISCOVERY_QUERY__', () => discoveryQuery(features))
    .replaceAll('__VERSION__', () => LOADER_VERSION)
    .replace('__NAV_STORE__', () => JSON.stringify(clientStore()))
    .replace('__SHELL_FN__', () => shellPageKind.toString())
    .replace('__SHELL_ENABLED__', () => String(shellEnabled(scopeMode, features)))
    .replace('__INK_BASE__', () => JSON.stringify(ACTIVE_STORE.inkBase))
    .replace('__ALLOWED_PATHS__', () => JSON.stringify(allowedPaths))
    .replace('__FEATURES__', () => JSON.stringify(features))
    .replace('__SCOPE_MODE__', () => JSON.stringify(scopeMode === 'product-catalog' ? 'product-catalog' : 'allowlist'));
}

export const loaderQuery = (allowedPaths, features, scopeMode) => memoize('l:' + JSON.stringify([allowedPaths, features, scopeMode]), () => 'v=' + LOADER_VERSION + '&c=' + contentHash(buildLoaderSource(allowedPaths, features, scopeMode)));

// Sem allowlist embutida: nunca monta. Mantido para compatibilidade e testes de fail-closed.
export const LOADER_SOURCE = buildLoaderSource([]);
