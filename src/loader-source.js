// Loader entregue pelo próprio Worker, no mesmo hostname da loja (www.usesul.com.br). Um ÚNICO ponto de entrada,
// composto por módulos independentes (src/loader/*): runtime, return-link e post-add-discovery (este carrega
// discovery.js sob demanda). Só entram no bundle os módulos liberados por WIDGET_FEATURES.
// A allowlist é embutida na entrega (defesa em profundidade): o Turbo Drive mantém o JS vivo entre páginas.
import { RUNTIME_HEAD, RUNTIME_TAIL } from './loader/runtime.js';
import { RETURN_LINK } from './loader/return-link.js';
import { DRAWER_WATCH } from './loader/drawer-watch.js';
import { buildDiscoverySource } from './loader/discovery-ui.js';
import { DEFAULT_FEATURES } from './features.js';

export const LOADER_VERSION = '3.0';
export { buildDiscoverySource };

// allowedPaths e features já vêm validados (parseAllowlist/parseFeatures): só [a-z0-9_/-] e nomes conhecidos,
// então JSON.stringify é seguro aqui.
export function buildLoaderSource(allowedPaths = [], features = DEFAULT_FEATURES) {
  const parts = [RUNTIME_HEAD];
  if (features.includes('return-link')) parts.push(RETURN_LINK);
  if (features.includes('post-add-discovery')) parts.push(DRAWER_WATCH);
  parts.push(RUNTIME_TAIL);
  return parts.join('')
    .replaceAll('__VERSION__', () => LOADER_VERSION)
    .replace('__ALLOWED_PATHS__', () => JSON.stringify(allowedPaths))
    .replace('__FEATURES__', () => JSON.stringify(features));
}

// Sem allowlist embutida: nunca monta. Mantido para compatibilidade e testes de fail-closed.
export const LOADER_SOURCE = buildLoaderSource([]);
