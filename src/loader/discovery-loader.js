// Carregador compartilhado do módulo sob demanda (/__origens/discovery.js): usado por post-add-discovery e cart-discovery.
// Carrega no máximo uma vez; falhou = nunca tenta de novo (o drawer nativo continua sozinho).
export const DISCOVERY_LOADER = String.raw`
  let discoveryLoading = null;
  let discoveryFailed = false;
  function loadDiscovery() {
    if (window.__useOrigensDiscovery) return Promise.resolve(window.__useOrigensDiscovery);
    if (discoveryFailed) return Promise.resolve(null);
    if (!discoveryLoading) {
      discoveryLoading = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '/__origens/discovery.js?v=__VERSION__';
        script.async = true;
        script.setAttribute('data-use-origens-discovery', '__VERSION__');
        script.onload = () => { const api = window.__useOrigensDiscovery || null; if (!api) discoveryFailed = true; resolve(api); };
        script.onerror = () => { discoveryFailed = true; resolve(null); };
        document.head.appendChild(script);
      });
    }
    return discoveryLoading;
  }
`;
