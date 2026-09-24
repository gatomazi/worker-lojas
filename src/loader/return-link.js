// return-link: "← Voltar a procurar" abaixo do CTA nativo em fluxo (#add-to-cart-desk). Comportamento do piloto preservado.
export const RETURN_LINK = String.raw`
  // Aceita apenas https://useorigens.com.br/sul[/...] sem credenciais nem porta: evita open redirect.
  // Hoje nada no storefront produz origens_return (purchaseUrl não o envia).
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

  register({
    id: 'return-link',
    mount() {
      if (document.getElementById('use-origens-return-link')) return;
      const anchor = findAnchor();
      if (!anchor) return;
      const link = document.createElement('a');
      link.id = 'use-origens-return-link';
      link.href = getReturnUrl();
      link.textContent = '← Voltar a procurar';
      link.setAttribute('aria-label', 'Voltar a procurar outra cidade na Use Origens');
      // Alvo de toque ≥ 44 px no mobile; desktop mantém a aparência do piloto.
      const touch = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
      Object.assign(link.style, {
        display: touch ? 'flex' : 'block',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        maxWidth: '100%',
        minHeight: touch ? '44px' : '',
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
    },
    unmount() {
      const link = document.getElementById('use-origens-return-link');
      if (link) link.remove();
    }
  });
`;
