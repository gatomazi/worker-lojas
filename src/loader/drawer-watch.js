// post-add-discovery (lado leve): detecta o drawer/modal pós-adição JÁ RENDERIZADO pela INK e só então carrega,
// sob demanda, /__origens/discovery.js. Não intercepta cliques nem POST; nunca mexe no drawer nativo.
export const DRAWER_WATCH = String.raw`
  register({
    id: 'post-add-discovery',
    host: null,
    observer: null,
    ac: null,
    loading: null,
    failed: false,
    mounted: false,

    mount() {
      if (!allowedNow()) return this.unmount();
      if (!this.ac) {
        this.ac = new AbortController();
        for (const name of ['turbo:frame-load', 'turbo:frame-render', 'turbo:before-stream-render']) {
          document.addEventListener(name, () => setTimeout(() => this.check(), 30), { signal: this.ac.signal });
        }
      }
      // Observa só o subárvore do frame onde a INK renderiza o drawer; reata se o frame for trocado.
      const host = document.getElementById('last_added_product');
      if (host && host !== this.host) {
        if (this.observer) this.observer.disconnect();
        this.host = host;
        this.observer = new MutationObserver(() => this.check());
        this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
      this.check();
    },

    // Drawer "aberto de verdade": existe, está visível, mostra a confirmação da INK e os botões nativos.
    isOpen(wrapper) {
      return !!wrapper && wrapper.getClientRects().length > 0 && /Produto adicionado/i.test(wrapper.textContent || '') &&
        !!wrapper.querySelector('.checkout-btn, #continue-shopping-button');
    },

    check() {
      if (!allowedNow()) return this.unmount();
      const wrapper = document.getElementById('modal-wrapper');
      if (!this.isOpen(wrapper)) {
        if (this.mounted && window.__useOrigensDiscovery) { try { window.__useOrigensDiscovery.unmount(); } catch (_) { /* ignora */ } }
        this.mounted = false;
        return;
      }
      if (wrapper.querySelector('[data-origens-discovery]')) return;
      this.ensureApi().then((api) => {
        if (!api) return;
        const current = document.getElementById('modal-wrapper');
        // Revalida depois do carregamento assíncrono: rota, drawer ainda aberto e sem duplicar.
        if (!allowedNow() || !this.isOpen(current) || current.querySelector('[data-origens-discovery]')) return;
        api.mount({ wrapper: current });
        this.mounted = true;
      });
    },

    ensureApi() {
      if (window.__useOrigensDiscovery) return Promise.resolve(window.__useOrigensDiscovery);
      if (this.failed) return Promise.resolve(null);
      if (!this.loading) {
        this.loading = new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = '/__origens/discovery.js?v=__VERSION__';
          script.async = true;
          script.setAttribute('data-use-origens-discovery', '__VERSION__');
          script.onload = () => { const api = window.__useOrigensDiscovery || null; if (!api) this.failed = true; resolve(api); };
          script.onerror = () => { this.failed = true; resolve(null); };
          document.head.appendChild(script);
        });
      }
      return this.loading;
    },

    unmount() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.host = null;
      if (window.__useOrigensDiscovery) { try { window.__useOrigensDiscovery.unmount(); } catch (_) { /* ignora */ } }
      this.mounted = false;
    }
  });
`;
