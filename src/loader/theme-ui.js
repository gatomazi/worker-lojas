// Comportamentos MÍNIMOS do tema da compra (theme-pdp / theme-cart) que CSS sozinho não faz. Nada aqui clica em compra, cria item, lê carrinho ou
// mexe em formulário: só classes no <html> e o fechamento do carrinho pelo MESMO controle nativo. Sem este módulo (JS falhou, feature desligada) a
// página continua utilizável: a barra fixa nativa fica sempre visível, como na INK, e o carrinho fecha pelo "X".
//   1. Atributo do tema: o <link data-origens-theme-css> diz as superfícies; se uma navegação Turbo veio de uma página da INK que não passou pelo
//      Worker (sem o atributo no <html>), o atributo é reposto a partir do link. Nunca inventa superfície.
//   2. (theme-pdp) Barra fixa "Adicionar ao Carrinho" do celular: escondida enquanto o botão principal (#add-to-cart-desk, o mesmo formulário) está
//      à vista ou enquanto um campo de texto tem foco (teclado aberto). IntersectionObserver só nesse botão; nenhuma varredura da página.
//   2b. (theme-pdp) No celular a INK deixa os botões de compra inertes (pointer-events-none) até a variante estar completa: um toque na barra não fazia
//      nada. Agora o toque (que cai no contêiner da barra) leva a tela e o foco até a PRIMEIRA escolha que falta (modelo, cor ou tamanho) e a destaca.
//      Nada é escolhido por nós: nenhuma variante presumida, nenhum item criado.
//   3. (theme-cart) Esc fecha o carrinho aberto disparando o clique no "X" nativo (#cart-drawer-close, ação ink-store--drawer#closeDrawer); o foco volta
//      ao botão do carrinho que estava focado antes.
export const THEME_UI = String.raw`
  const THEME_PDP = FEATURES.includes('theme-pdp');
  const THEME_CART = FEATURES.includes('theme-cart');
  const THEME_ROOT = document.documentElement;
  let themeCta = null;
  let themeObserver = null;
  let themeListening = false;
  let themeOpener = null;

  function themeSyncAttribute() {
    const link = document.querySelector('link[data-origens-theme-css]');
    if (!link) return;
    try {
      const wanted = (new URL(link.href, window.location.href).searchParams.get('s') || '').split(',').filter((s) => s === 'pdp' || s === 'cart').join(' ');
      if (wanted && THEME_ROOT.getAttribute('data-origens-theme') !== wanted) THEME_ROOT.setAttribute('data-origens-theme', wanted);
    } catch (_) { /* link estranho: deixa como está */ }
  }
  function themeStopCta() {
    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
    THEME_ROOT.classList.remove('o-cta-inview');
    themeCta = null;
  }
  function themeWatchCta() {
    const cta = document.getElementById('add-to-cart-desk');
    if (cta === themeCta) return;
    themeStopCta();
    themeCta = cta;
    if (!cta || typeof IntersectionObserver !== 'function') return;
    themeObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) THEME_ROOT.classList.toggle('o-cta-inview', entry.isIntersecting);
    });
    themeObserver.observe(cta);
  }
  const themeTextField = (el) => !!el && el.matches && el.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select');
  function themeFocusIn(event) {
    if (themeTextField(event.target)) THEME_ROOT.classList.add('o-typing');
    if (THEME_CART && event.target && event.target.closest && event.target.closest('#shopping-cart-menu-desk,#shopping-cart-menu-mob')) themeOpener = event.target.closest('button');
  }
  function themeFocusOut(event) { if (themeTextField(event.target)) THEME_ROOT.classList.remove('o-typing'); }
  function themeKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const drawer = document.querySelector('.cart-drawer.open');
    const close = drawer && document.getElementById('cart-drawer-close');
    if (!close) return;
    // Um modal por cima do carrinho (ex.: o pós-adição) fecha primeiro pelo próprio Esc da INK.
    const modal = document.getElementById('modal-wrapper');
    if (modal && !modal.hidden && modal.getClientRects().length > 0) return;
    close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const back = themeOpener && document.contains(themeOpener) ? themeOpener : null;
    if (back) setTimeout(() => { try { back.focus(); } catch (_) { /* ignora */ } }, 350);
  }
  function themeMissingChoice() {
    const form = document.querySelector('form[id^="form-product-"]');
    if (!form) return null;
    for (const name of ['style', 'color', 'size']) {
      const radios = [...form.querySelectorAll('input[type="radio"][name="' + name + '"]')];
      if (radios.length > 0 && !radios.some((r) => r.checked)) return { group: radios[0].closest('.flex.flex-col') || radios[0].parentElement, first: radios.find((r) => !r.disabled) || radios[0] };
    }
    return null;
  }
  function themeBarClick(event) {
    const bar = event.target && event.target.closest && event.target.closest('.form-product-options__add-to-cart-mobile');
    const button = bar && bar.querySelector('#add-to-cart-mob');
    if (!button || !button.classList.contains('pointer-events-none')) return; // botão ativo: o clique é da INK, intacto
    const missing = themeMissingChoice();
    if (!missing) {
      // Quadro de variantes ainda não carregado (é lazy: só carrega ao entrar na tela): rolar até ele já dispara o carregamento da INK.
      const frame = document.getElementById('product_variants_options_frame');
      if (frame && !frame.querySelector('input[type="radio"]')) frame.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    missing.group.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { missing.first.focus({ preventScroll: true }); } catch (_) { /* ignora */ }
    missing.group.classList.add('o-need-choice');
    setTimeout(() => missing.group.classList.remove('o-need-choice'), 2400);
  }
  function themeListen(on) {
    if (on === themeListening) return;
    themeListening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('focusin', themeFocusIn, true);
    document[method]('focusout', themeFocusOut, true);
    if (THEME_CART) document[method]('keydown', themeKeydown);
    if (THEME_PDP) document[method]('click', themeBarClick, true);
  }
  register({
    id: 'theme-ui',
    shell: true,
    mount() {
      themeSyncAttribute();
      themeListen(true);
      if (THEME_PDP && allowedNow()) themeWatchCta();
      else themeStopCta();
    },
    unmount() {
      themeListen(false);
      themeStopCta();
      themeOpener = null;
      THEME_ROOT.classList.remove('o-typing');
    }
  });
`;
