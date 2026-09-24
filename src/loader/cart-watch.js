// cart-discovery (lado leve): detecta o drawer do CARRINHO da INK aberto (pelo ícone do cabeçalho ou por "Ver carrinho") e monta
// um bloco compacto na área rolável dele. Só observa: nunca altera itens, quantidades, cupom, frete, totais nem o checkout.
// Fonte estrutural (auditada): div.cart-drawer.open > turbo-frame#cart > .cart-drawer__main (itens) | .empty-cart (vazio).
export const CART_WATCH = String.raw`
  register({
    id: 'cart-discovery',
    host: null,
    observer: null,
    ac: null,
    mounted: false,

    mount() {
      if (!allowedNow()) return this.unmount();
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
