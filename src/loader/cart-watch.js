// cart-discovery (lado leve): detecta o drawer do CARRINHO da INK aberto (pelo ícone do cabeçalho ou por "Ver carrinho") e monta
// um bloco compacto na área rolável dele. Só observa: nunca altera itens, quantidades, cupom, frete, totais nem o checkout.
// Fonte estrutural (auditada): div.cart-drawer.open > turbo-frame#cart > .cart-drawer__main (itens) | .empty-cart (vazio).
export const CART_WATCH = String.raw`
  // Intenção "abrir o carrinho" vinda do storefront (?origens_open_cart=1 na URL da página AUTORIZADA): ativa o próprio botão nativo do
  // carrinho (o drawer da INK), no máximo 8 tentativas em ~4 s, e remove o parâmetro da URL. Não altera o carrinho.
  // Motivo: GET /usesul/cart NÃO é uma página utilizável (é o fragmento do drawer sem layout); o carrinho real da INK é o drawer.
  function consumeOpenCartIntent() {
    if (!allowedNow()) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('origens_open_cart') !== '1') return;
    url.searchParams.delete('origens_open_cart');
    try { window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); } catch (_) { /* ignora */ }
    let tries = 0;
    // Aberto de verdade (classe "open" da INK + visível). O evento só sai DEPOIS disso, nunca pela mera presença do parâmetro na URL.
    const drawerOpen = () => { const drawer = document.querySelector('.cart-drawer.open'); return !!drawer && drawer.getClientRects().length > 0; };
    const opened = () => { if (typeof track === 'function') track('origens_native_cart_opened', 'storefront_return'); };
    const attempt = () => {
      if (!allowedNow()) return;
      if (drawerOpen()) return opened();
      const opener = [...document.querySelectorAll('[id^="shopping-cart-menu"]')].find((el) => el.getClientRects().length > 0);
      if (opener) opener.click();
      if (++tries < 8) setTimeout(attempt, 500);
      else setTimeout(() => { if (allowedNow() && drawerOpen()) opened(); }, 600);
    };
    setTimeout(attempt, 400);
  }

  register({
    intentDone: false,
    id: 'cart-discovery',
    host: null,
    observer: null,
    ac: null,
    mounted: false,

    mount() {
      if (!allowedNow()) return this.unmount();
      if (!this.intentDone) { this.intentDone = true; consumeOpenCartIntent(); }
      if (!this.ac) {
        this.ac = new AbortController();
        for (const name of ['turbo:frame-load', 'turbo:frame-render', 'turbo:before-stream-render']) {
          document.addEventListener(name, () => setTimeout(() => this.check(), 30), { signal: this.ac.signal });
        }
      }
      // Observa só o subárvore do drawer do carrinho; reata se o Turbo Drive trocar o <body> (novo .cart-drawer).
      const drawer = document.querySelector('.cart-drawer');
      if (drawer && drawer !== this.host) {
        if (this.observer) this.observer.disconnect();
        this.host = drawer;
        this.observer = new MutationObserver(() => this.check());
        this.observer.observe(drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
      this.check();
    },

    // Aberto de verdade: classe "open" da INK + visível.
    isOpen(drawer) {
      return !!drawer && drawer.classList.contains('open') && drawer.getClientRects().length > 0;
    },

    check() {
      if (!allowedNow()) return this.unmount();
      const drawer = document.querySelector('.cart-drawer');
      if (!this.isOpen(drawer)) {
        if (this.mounted && window.__useOrigensDiscovery && window.__useOrigensDiscovery.unmountCart) { try { window.__useOrigensDiscovery.unmountCart(); } catch (_) { /* ignora */ } }
        this.mounted = false;
        return;
      }
      if (drawer.querySelector('[data-origens-discovery="cart"]')) return;
      if (!drawer.querySelector('.cart-drawer__main, .empty-cart')) return; // sem âncora segura: nada é montado
      loadDiscovery().then((api) => {
        if (!api || !api.mountCart) return;
        const current = document.querySelector('.cart-drawer');
        // Revalida depois do carregamento assíncrono: rota, drawer ainda aberto e sem duplicar.
        if (!allowedNow() || !this.isOpen(current) || current.querySelector('[data-origens-discovery="cart"]')) return;
        api.mountCart({ drawer: current });
        this.mounted = true;
      });
    },

    unmount() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.host = null;
      if (window.__useOrigensDiscovery && window.__useOrigensDiscovery.unmountCart) { try { window.__useOrigensDiscovery.unmountCart(); } catch (_) { /* ignora */ } }
      this.mounted = false;
    }
  });
`;
