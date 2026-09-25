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
  register({
    id: 'return-link',
    mount() {
      if (document.getElementById('use-origens-return-link')) return;
      // Com product-discovery ligada o bloco de descoberta substitui este link (nunca os dois); ele só volta como plano B quando o
      // módulo de descoberta não pôde ser carregado.
      const replaced = FEATURES.includes('product-discovery');
      if (replaced && !(typeof productFallback !== 'undefined' && productFallback)) return;
      const anchor = findAnchor();
      if (!anchor) return;
      const link = document.createElement('a');
      link.id = 'use-origens-return-link';
      link.href = getReturnUrl();
      link.textContent = replaced ? 'Explorar todas as estampas' : '← Voltar a procurar';
      link.setAttribute('aria-label', replaced ? 'Explorar todas as estampas da Use Origens' : 'Voltar a procurar outra cidade na Use Origens');
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
