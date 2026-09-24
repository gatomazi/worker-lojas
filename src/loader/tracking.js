// tracking: mede os cliques nos NOSSOS links da INK para o storefront (GA4 custom event `origens_explore_storefront_click`) e marca
// esses links com um ENUM fixo de origem (`origens_src`, `origens_p`) para o storefront contar a chegada (`origens_storefront_arrived`).
// Caminho de despacho ÚNICO: o `gtag` que a própria INK já carrega, com `send_to` = a propriedade GA4 já presente na página (a mesma do
// storefront). Não instala nenhuma tag, não cria cookie nem armazenamento e nunca bloqueia a navegação: tudo é melhor esforço e falha calado.
// Consentimento: a INK só tem um aviso informativo de cookies (`.cookie-acceptance`, com o botão "Aceitar cookies"; ele NÃO condiciona as tags
// dela). Como único sinal existente, as medições aqui só saem depois que o visitante aceitou esse aviso (o elemento some da página); o
// marcador de origem nos links vai sempre, porque não é medição: quem conta a chegada é o storefront, sob o consentimento dele.
// Para medir também sem aceite, basta trocar REQUIRE_INK_COOKIE_NOTICE_ACCEPTED para false.
// Nunca envia: cart_ref, conteúdo do carrinho, URL completa/query, texto de busca, cookies ou qualquer dado pessoal.
export const TRACKING = String.raw`
  const GA_MEASUREMENT_ID = 'G-8GYTEJ1F77';
  const REQUIRE_INK_COOKIE_NOTICE_ACCEPTED = true;
  const ENTRY_POINTS = ['ink_cart_drawer', 'ink_post_add', 'ink_product_return', 'storefront_return'];
  const SRC_PARAM = 'origens_src';
  const PRODUCT_PARAM = 'origens_p';

  // O aviso de cookies da INK ainda na tela = o visitante não aceitou (ao aceitar, o próprio controller da INK remove o elemento).
  function inkCookieNoticeAccepted() {
    return !REQUIRE_INK_COOKIE_NOTICE_ACCEPTED || !document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]');
  }
  // Só mede se a INK realmente carregou o gtag.js dessa propriedade nesta página (senão o evento iria para o vazio ou para outra propriedade).
  function gaWired() {
    return typeof window.gtag === 'function' && !!document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID + '"]');
  }
  // Slug do produto atual, somente quando a rota é uma das páginas da allowlist (exatas); caso contrário omite.
  function currentProductSlug() {
    const pathname = window.location.pathname;
    return allowedNow() ? pathname.slice(pathname.lastIndexOf('/') + 1) : null;
  }
  // Parâmetros de baixa cardinalidade e sem dados pessoais. Retorna se o evento foi entregue ao gtag.
  function track(name, entryPoint) {
    try {
      if (!allowedNow() || !ENTRY_POINTS.includes(entryPoint) || !gaWired() || !inkCookieNoticeAccepted()) return false;
      const params = { send_to: GA_MEASUREMENT_ID, entry_point: entryPoint, region: 'sul', transport_type: 'beacon' };
      const slug = currentProductSlug();
      if (slug) params.product_slug = slug;
      window.gtag('event', name, params);
      return true;
    } catch (_) { return false; /* medir nunca quebra a INK nem a navegação */ }
  }
  function entryPointOf(link) {
    if (link.id === 'use-origens-return-link') return 'ink_product_return';
    const root = link.closest('[data-origens-discovery]');
    if (!root) return null;
    return root.getAttribute('data-origens-discovery') === 'cart' ? 'ink_cart_drawer' : 'ink_post_add';
  }
  function isStorefrontLink(link) {
    try {
      const url = new URL(link.href);
      return url.protocol === 'https:' && url.origin === STOREFRONT_ORIGIN && (url.pathname === '/sul' || url.pathname.startsWith('/sul/'));
    } catch (_) { return false; }
  }

  register({
    id: 'tracking',
    ac: null,

    mount() {
      if (this.ac) return;
      this.ac = new AbortController();
      const options = { capture: true, signal: this.ac.signal };
      // clique normal e botão do meio medem e marcam; o menu de contexto (abrir em nova aba) só marca, sem contar como clique.
      document.addEventListener('click', (event) => this.onLink(event, event.button === 0), options);
      document.addEventListener('auxclick', (event) => this.onLink(event, event.button === 1), options);
      document.addEventListener('contextmenu', (event) => this.onLink(event, false), options);
    },

    onLink(event, emit) {
      try {
        if (!allowedNow()) return;
        const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (!link || !isStorefrontLink(link)) return;
        const entryPoint = entryPointOf(link);
        if (!entryPoint) return; // só links nossos; qualquer outro link da INK passa intacto
        const url = new URL(link.href);
        url.searchParams.set(SRC_PARAM, entryPoint);
        const slug = currentProductSlug();
        if (slug) url.searchParams.set(PRODUCT_PARAM, slug);
        link.href = url.href;
        if (emit) track('origens_explore_storefront_click', entryPoint);
      } catch (_) { /* ignora */ }
    },

    unmount() {
      if (this.ac) { this.ac.abort(); this.ac = null; }
    }
  });
`;
