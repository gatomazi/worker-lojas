// product-discovery (lado leve): bloco compacto "Continue explorando" logo abaixo do CTA nativo de compra, no lugar do link
// "← Voltar a procurar" (nunca os dois). A UI vem do mesmo discovery.js sob demanda dos drawers (busca, gateway, ranking e destinos
// idênticos). Só observa/insere: não altera o formulário, as variantes, o CTA, o sticky mobile nem o checkout da INK.
// Plano B: se discovery.js não carregar, o return-link volta como link simples "Explorar todas as estampas".
export const PRODUCT_DISCOVERY = String.raw`
  let productFallback = false;

  register({
    id: 'product-discovery',
    loading: false,

    mount() {
      if (!allowedNow()) return this.unmount();
      // Idempotente pela EXISTÊNCIA do bloco, não pela posição: no mobile a INK alterna qual CTA está visível (barra fixa x CTA em fluxo) ao
      // rolar, então a âncora "de agora" pode mudar; remontar por isso derrubaria a busca aberta e o foco enquanto a pessoa digita.
      const current = document.querySelector('[data-origens-discovery="product"]');
      if (current && current.isConnected) return;
      const anchor = findAnchor();
      if (!anchor) return;
      if (productFallback || this.loading) return;
      this.loading = true;
      loadDiscovery().then((api) => {
        this.loading = false;
        // Revalida depois do carregamento assíncrono: rota, âncora e sem duplicar.
        if (!allowedNow()) return;
        if (!api || !api.mountProduct) { productFallback = true; window.__useOrigens.requestSync(); return; }
        const fresh = findAnchor();
        if (!fresh) return;
        const existing = document.querySelector('[data-origens-discovery="product"]');
        if (existing && existing.isConnected) return;
        api.mountProduct({ anchor: fresh });
      });
    },

    unmount() {
      this.loading = false;
      if (window.__useOrigensDiscovery && window.__useOrigensDiscovery.unmountProduct) { try { window.__useOrigensDiscovery.unmountProduct(); } catch (_) { /* ignora */ } }
    }
  });
`;
