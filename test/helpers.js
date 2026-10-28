// Módulos do Worker para o Miniflare (workerd real). O Miniflare resolve imports relativos a partir de modulesRoot.
const SRC = new URL('../src/', import.meta.url).pathname;
const CORE = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'navbar-gateway.js', 'promotions-gateway.js', 'top-bar-gateway.js', 'list-session.js', 'recommendations-gateway.js', 'guide-gateway.js', 'assistant-gateway.js', 'kit-gateway.js', 'legacy-redirect.js', 'domain-move.js', 'stores.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js',
  'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/header-nav.js', 'loader/list-watch.js', 'loader/promo-fab.js', 'loader/recommendations.js', 'loader/pdp-extras.js', 'loader/size-fit.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js', 'loader/pdp-guide.js', 'loader/pdp-offers.js', 'loader/top-bar.js', 'loader/assistant.js', 'loader/post-add-kit.js', 'theme.js', 'loader/theme-ui.js'];
const toModules = (files) => files.map((file) => ({ type: 'ESModule', path: SRC + file }));
export const workerModules = () => ({ modulesRoot: SRC, modules: toModules(CORE) });
export const previewModules = () => ({ modulesRoot: SRC, modules: toModules(['preview-entry.js', 'preview-fixtures.js', ...CORE]) });
