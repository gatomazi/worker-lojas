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
import { buildDiscoverySource } from './loader/discovery-ui.js';
import { DEFAULT_FEATURES } from './features.js';

export const LOADER_VERSION = '4.1';
export { buildDiscoverySource };

// allowedPaths e features já vêm validados (parseAllowlist/parseFeatures): só [a-z0-9_/-] e nomes conhecidos,
// então JSON.stringify é seguro aqui.
export function buildLoaderSource(allowedPaths = [], features = DEFAULT_FEATURES) {
  const parts = [RUNTIME_HEAD];
  // Medição dos cliques nos nossos links: só quando algum módulo que cria links para o storefront está ligado.
  if (features.includes('return-link') || features.includes('post-add-discovery') || features.includes('cart-discovery')) parts.push(TRACKING);
  if (features.includes('return-link')) parts.push(RETURN_LINK);
  if (features.includes('post-add-discovery') || features.includes('cart-discovery')) parts.push(DISCOVERY_LOADER);
  if (features.includes('post-add-discovery')) parts.push(DRAWER_WATCH);
  if (features.includes('cart-discovery')) parts.push(CART_WATCH);
  if (features.includes('cart-mirror')) parts.push(CART_MIRROR);
  parts.push(RUNTIME_TAIL);
  return parts.join('')
    .replaceAll('__VERSION__', () => LOADER_VERSION)
    .replace('__ALLOWED_PATHS__', () => JSON.stringify(allowedPaths))
    .replace('__FEATURES__', () => JSON.stringify(features));
}

// Sem allowlist embutida: nunca monta. Mantido para compatibilidade e testes de fail-closed.
export const LOADER_SOURCE = buildLoaderSource([]);
