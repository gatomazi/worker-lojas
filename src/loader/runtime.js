// runtime: escopo por rota (allowlist embutida), ciclo de vida Turbo, montagem/desmontagem idempotentes.
// Regra inegociável: um loader vivo (o Turbo mantém o JS entre páginas) NÃO pode deixar UI nem agir fora da allowlist.
export const RUNTIME_HEAD = String.raw`(() => {
  'use strict';

  // Turbo pode re-executar este script ao navegar entre páginas; só a primeira execução vale.
  if (window.__useOrigensLoader) return;
  window.__useOrigensLoader = '__VERSION__';

  const ALLOWED_PATHS = __ALLOWED_PATHS__;
  const FEATURES = __FEATURES__;
  // "allowlist" (padrão): só ALLOWED_PATHS. "product-catalog": qualquer página verdadeira de produto (slug canônico + formulário nativo).
  const SCOPE_MODE = __SCOPE_MODE__;
  const CATALOG_PRODUCT_PATH = /^\/usesul\/product\/[a-z0-9][a-z0-9_-]{0,127}$/;
  // Páginas "de casca" (home, listagem, coleções, sobre, conta/pedidos): só widgets marcados com shell:true (header-nav, FAB, ponte do carrinho) rodam ali.
  // Ligado só com o escopo de catálogo + header-nav. A função vem do Worker (src/scope.js), uma única definição.
  const SHELL_ENABLED = __SHELL_ENABLED__;
  const INK_BASE = __INK_BASE__;
  __SHELL_FN__
  const PRODUCT_PATH = /^\/usesul\/product\/[^/]+$/;
  // Rota canônica verificada do storefront. www.usesul.com.br/sul NÃO serve: responde 302 para /usesul.
  const STOREFRONT_ORIGIN = 'https://useorigens.com.br';
  const DEFAULT_RETURN = STOREFRONT_ORIGIN + '/sul';

  const widgets = [];
  const teardownCallbacks = [];
  let timer = null;
  let active = false;

  // allowlist: só caminho exato; lista vazia => nunca monta. product-catalog: slug canônico de produto (a URL de destino do Turbo).
  function pathAllowed(pathname) {
    if (window.location.hostname !== 'www.usesul.com.br' || !PRODUCT_PATH.test(pathname)) return false;
    return SCOPE_MODE === 'product-catalog' ? CATALOG_PRODUCT_PATH.test(pathname) : ALLOWED_PATHS.includes(pathname);
  }
  // No modo catálogo a página ATUAL também precisa ter o formulário nativo de compra (404/página estranha com URL de produto = nada nosso).
  function allowedNow() {
    if (!pathAllowed(window.location.pathname)) return false;
    return SCOPE_MODE !== 'product-catalog' || !!document.querySelector('form[id^="form-product-"]');
  }
  // Página de casca (não transacional) desta loja? Nunca login, carrinho nem checkout.
  function shellPath(pathname) { return SHELL_ENABLED && window.location.hostname === 'www.usesul.com.br' && shellPageKind(pathname, INK_BASE) !== null; }
  // 'product' | 'shell' | null: o que a página ATUAL permite montar. pageNow() = qualquer um dos dois (usada pelos widgets shell:true).
  function currentKind() { return allowedNow() ? 'product' : (shellPath(window.location.pathname) ? 'shell' : null); }
  function pageNow() { return currentKind() !== null; }

  // Desmonta TUDO nosso: UI, estilos, observers, timers e requisições. Idempotente.
  function teardown() {
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
    while (teardownCallbacks.length) { try { teardownCallbacks.pop()(); } catch (_) { /* nunca quebra a INK */ } }
    for (const widget of widgets) { try { widget.unmount(); } catch (_) { /* idem */ } }
  }
  function sync() {
    timer = null;
    const kind = currentKind();
    if (!kind) { if (active) teardown(); return; }
    active = true;
    for (const widget of widgets) {
      try {
        // Na página de casca só os widgets shell:true; os de produto (descoberta, retorno, drawer) saem se ainda estiverem montados (Turbo produto -> coleção).
        if (kind === 'product' || widget.shell) widget.mount(); else widget.unmount();
      } catch (err) { console.warn('[Use Origens] widget ' + widget.id + ' failed (non-critical):', err); }
    }
  }
  // setTimeout, não rAF: rAF não dispara em aba oculta.
  function schedule() {
    if (!pageNow()) { if (active) teardown(); return; }
    if (timer) return;
    timer = setTimeout(sync, 50);
  }
  function register(widget) { widgets.push(widget); }

  // Âncora de compra compartilhada (return-link e product-discovery): o CTA nativo "em fluxo".
  function insideFixed(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  }
  // Âncora: o CTA "em fluxo". #add-to-cart-mob é uma barra fixa no rodapé e NÃO é âncora.
  function findAnchor() {
    const byId = document.getElementById('add-to-cart-desk');
    if (byId && byId.getClientRects().length > 0) return byId;
    const byClass = document.querySelector('.form-product-options__add-to-cart-btn');
    if (byClass && byClass.getClientRects().length > 0 && !insideFixed(byClass)) return byClass;
    const scope = document.querySelector('main') || document;
    for (const button of scope.querySelectorAll('button')) {
      if (/adicionar ao carrinho/i.test(button.textContent || '') &&
          !button.closest('header, footer') && button.getClientRects().length > 0 && !insideFixed(button)) {
        return button;
      }
    }
    return null;
  }

  // Interface mínima para módulos carregados sob demanda. Congelada.
  window.__useOrigens = Object.freeze({
    version: '__VERSION__',
    features: FEATURES.slice(),
    storefront: STOREFRONT_ORIGIN,
    allowed: allowedNow,
    onTeardown(fn) { teardownCallbacks.push(fn); },
    requestSync: schedule
  });
`;

export const RUNTIME_TAIL = String.raw`
  function start() {
    schedule();
    // Observa <html>: o Turbo Drive troca o <body> inteiro e um observer preso ao body antigo ficaria órfão.
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    // Saída da rota: desmonta na hora, sem esperar o próximo tick.
    document.addEventListener('turbo:visit', (event) => {
      try {
        const url = event.detail && event.detail.url;
        if (url) { const target = new URL(url, window.location.href).pathname; if (!pathAllowed(target) && !shellPath(target)) teardown(); }
      } catch (_) { /* ignora */ }
    });
    document.addEventListener('turbo:before-cache', () => { if (active) teardown(); });
    for (const name of ['turbo:before-render', 'turbo:render', 'turbo:load', 'turbo:frame-render', 'turbo:frame-load']) document.addEventListener(name, schedule);
    for (const name of ['popstate', 'pageshow']) window.addEventListener(name, schedule);
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } catch (err) {
    console.warn('[Use Origens] loader failed (non-critical):', err);
  }
})();`;
