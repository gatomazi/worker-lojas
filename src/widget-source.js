// Código JavaScript entregue pelo próprio Worker, no mesmo domínio da loja.
// POC: acrescenta somente o link de retorno, sem interagir com o carrinho.
export const WIDGET_SOURCE = String.raw`(() => {
  'use strict';

  const LINK_ID = 'use-origens-return-link';
  const DEFAULT_RETURN = 'https://useorigens.com.br/sul';
  const PRODUCT_PATH = /^\/usesul\/product\/[^/]+\/?$/;
  let observer = null;
  let scheduled = false;

  // Aceita apenas um destino nosso. Não permite redirecionamentos arbitrários.
  function getReturnUrl() {
    const candidate = new URL(window.location.href).searchParams.get('origens_return');
    if (!candidate) return DEFAULT_RETURN;
    try {
      const url = new URL(candidate);
      if (url.origin === 'https://useorigens.com.br' &&
          (url.pathname === '/sul' || url.pathname.startsWith('/sul/'))) {
        return url.href;
      }
    } catch (_) { /* parâmetro inválido: usar destino padrão */ }
    return DEFAULT_RETURN;
  }

  function isTargetPage() {
    return window.location.hostname === 'www.usesul.com.br' &&
      PRODUCT_PATH.test(window.location.pathname);
  }

  function findProductCta() {
    const scopes = [document.querySelector('main'), document];
    for (const scope of scopes) {
      if (!scope) continue;
      const buttons = scope.querySelectorAll('button, input[type="submit"]');
      for (const button of buttons) {
        const label = (button.value || button.textContent || '').trim();
        if (/adicionar ao carrinho/i.test(label) &&
            !button.closest('header, footer') &&
            button.getClientRects().length > 0) {
          return button;
        }
      }
    }
    return null;
  }

  function mount() {
    if (!isTargetPage() || document.getElementById(LINK_ID)) return;
    const cta = findProductCta();
    if (!cta) return;

    const link = document.createElement('a');
    link.id = LINK_ID;
    link.href = getReturnUrl();
    link.textContent = '← Voltar a procurar outra cidade';
    link.setAttribute('aria-label', 'Voltar à busca da Use Origens');
    Object.assign(link.style, {
      display: 'block',
      width: 'fit-content',
      maxWidth: '100%',
      margin: '12px auto 16px',
      padding: '8px 4px',
      color: '#454E36',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '1.4',
      textAlign: 'center',
      textDecoration: 'underline',
      textUnderlineOffset: '3px'
    });
    cta.insertAdjacentElement('afterend', link);
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { mount(); } catch (err) {
        console.warn('[Use Origens] Falha não crítica no widget:', err);
      }
    });
  }

  function init() {
    if (observer) observer.disconnect();
    scheduleMount();
    if (document.body) {
      observer = new MutationObserver(scheduleMount);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  // A INK usa Turbo; este evento reinicializa após navegação sem reload.
  document.addEventListener('turbo:load', init);
  document.addEventListener('turbo:frame-load', scheduleMount);
})();`;
