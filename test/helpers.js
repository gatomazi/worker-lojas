// Módulos do Worker para o Miniflare (workerd real). O Miniflare resolve imports relativos a partir de modulesRoot.
const SRC = new URL('../src/', import.meta.url).pathname;
const CORE = ['worker.js', 'allowlist.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js',
  'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const toModules = (files) => files.map((file) => ({ type: 'ESModule', path: SRC + file }));
export const workerModules = () => ({ modulesRoot: SRC, modules: toModules(CORE) });
export const previewModules = () => ({ modulesRoot: SRC, modules: toModules(['preview-entry.js', 'preview-fixtures.js', ...CORE]) });
