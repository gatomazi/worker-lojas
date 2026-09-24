// Loader entregue pelo próprio Worker, no mesmo hostname da loja (www.usesul.com.br).
// Fase 2A: monta somente o link "← Voltar a procurar". Não intercepta o CTA, o drawer, o carrinho
// nem chama APIs. Qualquer falha é engolida: a INK continua funcionando sem o widget.
export const LOADER_VERSION = '2a.1';

export const LOADER_SOURCE = String.raw`(() => {
  'use strict';

  // Turbo pode re-executar este script ao navegar entre páginas; só a primeira execução vale.
  if (window.__useOrigensLoader) return;
  window.__useOrigensLoader = '${LOADER_VERSION}';

  const PRODUCT_PATH = /^\/usesul\/product\/[^/]+\/?$/;
  // Rota canônica verificada do storefront. www.usesul.com.br/sul NÃO serve: responde 302 para /usesul.
  const STOREFRONT_ORIGIN = 'https://useorigens.com.br';
  const DEFAULT_RETURN = STOREFRONT_ORIGIN + '/sul';

  // Aceita apenas https://useorigens.com.br/sul[/...] sem credenciais nem porta: evita open redirect.
  // Preparado para o futuro; hoje nada no storefront produz origens_return (purchaseUrl não o envia).
  function safeReturnUrl(candidate) {
    if (!candidate) return null;
    try {
      const url = new URL(candidate);
      const okPath = url.pathname === '/sul' || url.pathname.startsWith('/sul/');
      if (url.origin === STOREFRONT_ORIGIN && okPath && !url.username && !url.password) return url.href;
    } catch (_) { /* parâmetro inválido: usar o destino padrão */ }
    return null;
  }

  function getReturnUrl() {
    const param = new URL(window.location.href).searchParams.get('origens_return');
    return safeReturnUrl(param) || DEFAULT_RETURN;
  }

  function isProductPage() {
    return window.location.hostname === 'www.usesul.com.br' && PRODUCT_PATH.test(window.location.pathname);
  }

  function insideFixed(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).position === 'fixed') return true;
    }
    return false;
  }

  // Âncora: o CTA "em fluxo" da página. Observado no DOM real: #add-to-cart-desk fica visível em desktop
  // e mobile; #add-to-cart-mob é uma barra fixa no rodapé e NÃO é âncora (o link ficaria preso nela).
  function findAnchor() {
    const byId = document.getElementById('add-to-cart-desk');
    if (byId && byId.getClientRects().length > 0) return byId;
    const byClass = document.querySelector('.form-product-options__add-to-cart-btn');
    if (byClass && byClass.getClientRects().length > 0 && !insideFixed(byClass)) return byClass;
    // Último recurso, por rótulo. Se a INK mudar tudo, o widget simplesmente não aparece.
    const scope = document.querySelector('main') || document;
    for (const button of scope.querySelectorAll('button')) {
      if (/adicionar ao carrinho/i.test(button.textContent || '') &&
          !button.closest('header, footer') && button.getClientRects().length > 0 && !insideFixed(button)) {
        return button;
      }
    }
    return null;
  }

  // Cada widget: { id, mount() }. A futura busca do drawer entra aqui como novo item, sem novo loader.
  const returnLink = {
    id: 'use-origens-return-link',
    mount() {
      if (document.getElementById(this.id)) return;
      const anchor = findAnchor();
      if (!anchor) return;
      const link = document.createElement('a');
      link.id = this.id;
      link.href = getReturnUrl();
      link.textContent = '← Voltar a procurar';
      link.setAttribute('aria-label', 'Voltar a procurar outra cidade na Use Origens');
      Object.assign(link.style, {
        display: 'block',
        alignSelf: 'center',
        maxWidth: '100%',
        padding: '8px 4px',
        color: 'inherit',
        fontSize: '14px',
        fontWeight: '500',
        lineHeight: '1.4',
        textAlign: 'center',
        textDecoration: 'underline',
        textUnderlineOffset: '3px'
      });
      anchor.insertAdjacentElement('afterend', link);
    }
  };
  const widgets = [returnLink];

  let scheduled = false;
  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    // setTimeout, não rAF: rAF não dispara em aba oculta e o widget só apareceria ao voltar para a aba.
    setTimeout(() => {
      scheduled = false;
      if (!isProductPage()) return;
      for (const widget of widgets) {
        try { widget.mount(); } catch (err) {
          console.warn('[Use Origens] widget ' + widget.id + ' failed (non-critical):', err);
        }
      }
    }, 50);
  }

  function start() {
    scheduleMount();
    // A INK re-renderiza o turbo-frame do carrinho e navega via Turbo: remonta se o link sumir.
    // Observa <html>: o Turbo Drive troca o <body> inteiro e um observer preso ao body antigo ficaria órfão.
    new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('turbo:load', scheduleMount);
    document.addEventListener('turbo:render', scheduleMount);
    document.addEventListener('turbo:frame-render', scheduleMount);
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } catch (err) {
    console.warn('[Use Origens] loader failed (non-critical):', err);
  }
})();`;
