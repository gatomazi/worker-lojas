// Comportamentos do tema da compra (theme-pdp / theme-cart) que CSS sozinho não faz. Nada aqui clica em compra, escolhe variante, cria item, lê carrinho
// ou envia evento: só os controles nativos da INK são acionados (pontos da galeria, "X" do carrinho), e os nós nativos movidos voltam ao lugar ao desligar.
//
// ESTADO EFETIVO (rodada 3): uma superfície só atua quando a feature do deploy (FEATURES) E a página ATUAL dizem que ela está ligada. O sinal da página é o
// atributo `data-origens-theme` do <body> que o Worker escreve em cada resposta, conforme a configuração publicada no painel. O <body> é trocado a cada
// visita Turbo, então o atributo é sempre o da página carregada (um <link> de CSS que o Turbo deixa no <head> ou um atributo de outra página não
// religam nada). Ao desligar (painel, feature ou navegação para uma página sem tema), tudo o que é exclusivo da superfície sai: miniaturas, classes,
// variável de posição, observadores, listeners e a ordem dos blocos.
// Restauração do cache do Turbo (voltar/avançar sem nova requisição): o <body> restaurado é o ANTIGO. Por isso vale o último estado vindo da REDE (carga
// inteira ou visita Turbo que buscou a página): numa restauração, o atributo do body é corrigido para ele — um tema desligado depois não volta pelo cache.
//
//   PDP  · Miniaturas da galeria: uma grade abaixo da foto com TODAS as fotos do conjunto nativo, na ordem nativa (mesmas URLs, carregamento preguiçoso).
//          Tocar numa miniatura aciona o ponto nativo correspondente (#dot-image-N); a seleção acompanha `aria-current` dos pontos (setas, swipe, troca de
//          cor/modelo — a INK pula para a foto da variante). Navegar por fotos NÃO muda a variante comprável (só os rádios mudam). Os pontos nativos só
//          somem (classe o-thumbs) depois de a grade estar montada; uma foto só = sem grade.
//        · Galeria fixa no computador: `--o-gal-top` = o menor entre 120 px e (altura da janela − altura da galeria), para as últimas miniaturas
//          continuarem alcançáveis em telas baixas.
//        · Ordem de leitura = ordem visual: "Guia/Informar medidas" antes da quantidade e prazo/cupom/"Também disponível em" depois da compra são
//          REPOSICIONADOS no DOM (mesmo pai; testado: nenhum frame recarrega e os modais seguem abrindo), em vez de `order` no CSS. Voltam ao lugar ao desligar.
//        · Barra fixa do celular some com o CTA principal à vista ou com teclado; toque na barra inerte leva à escolha que falta.
//        · No celular, flutuantes (Ajuda, WhatsApp, cupons) saem do caminho enquanto as escolhas e o CTA estão na tela.
//   Carrinho · Esc fecha o carrinho pelo "X" nativo e devolve o foco ao botão do carrinho.
export const THEME_UI = String.raw`
  const THEME_DEPLOY = { pdp: FEATURES.includes('theme-pdp'), cart: FEATURES.includes('theme-cart') };
  const THEME_NARROW = window.matchMedia ? window.matchMedia('(max-width: 1023px)') : null;
  // Superfície ligada AGORA: deploy E a página atual (atributo do <body> escrito pelo Worker para esta resposta).
  const themeOn = (surface) => THEME_DEPLOY[surface] && !!document.body && document.body.matches('[data-origens-theme~="' + surface + '"]');
  const themeBody = () => document.body;
  // Último estado efetivo vindo da rede e o tipo da visita Turbo em curso ('restore' = do cache, sem requisição).
  let themeNetwork = document.body ? (document.body.getAttribute('data-origens-theme') || '') : '';
  let themeVisit = 'load';
  document.addEventListener('turbo:visit', (event) => { themeVisit = (event.detail && event.detail.action) || 'advance'; });
  function themeTrustNetwork() {
    const body = themeBody(); if (!body) return;
    const here = body.getAttribute('data-origens-theme') || '';
    if (themeVisit === 'restore') {
      if (here !== themeNetwork) { if (themeNetwork) body.setAttribute('data-origens-theme', themeNetwork); else body.removeAttribute('data-origens-theme'); }
    } else themeNetwork = here;
  }
  let themeCta = null;
  let themeObserver = null;
  let themeListening = false;
  let themeOpener = null;
  let themeGallery = null;  // { host, list, grid, observer, body }
  let themeChoosing = null; // { targets, observer }
  let themeMoves = [];      // [{ node, restore }]
  let themeResize = null;

  // ── Barra fixa e teclado ──
  function themeStopCta() {
    if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
    if (themeBody()) themeBody().classList.remove('o-cta-inview');
    themeCta = null;
  }
  function themeWatchCta() {
    const cta = document.getElementById('add-to-cart-desk');
    if (cta === themeCta) return;
    themeStopCta();
    themeCta = cta;
    if (!cta || typeof IntersectionObserver !== 'function') return;
    themeObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) themeBody().classList.toggle('o-cta-inview', entry.isIntersecting && themeOn('pdp'));
    });
    themeObserver.observe(cta);
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
    if (!themeOn('pdp')) return;
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

  // ── Galeria: miniaturas ──
  function themeStopGallery() {
    const g = themeGallery;
    themeGallery = null;
    if (g) { g.observer.disconnect(); g.grid.remove(); }
    const body = themeBody();
    if (body) { body.classList.remove('o-thumbs'); body.style.removeProperty('--o-gal-top'); body.style.removeProperty('--o-thumbs-h'); }
    for (const stale of document.querySelectorAll('[data-origens-thumbs]')) stale.remove(); // sobra de um body antigo (Turbo)
  }
  function themeGalleryTop() {
    if (!themeGallery) return;
    const section = themeGallery.host.closest('.section-product-v2');
    if (!section) return;
    const top = Math.min(120, window.innerHeight - section.getBoundingClientRect().height - 16);
    themeBody().style.setProperty('--o-gal-top', Math.round(top) + 'px');
    // Altura da grade (com a margem): o selo nativo "Clique para dar zoom" é posicionado pela base da seção e sobe para cima da foto.
    const grid = themeGallery.grid.getBoundingClientRect();
    themeBody().style.setProperty('--o-thumbs-h', Math.round(grid.height + 10) + 'px');
  }
  function themeWatchGallery() {
    const host = document.querySelector('.section-product-v2 [data-controller~="ink-store--carousel"]');
    const list = host && host.querySelector('ul.absolute.z-30');
    if (themeGallery && themeGallery.host === host && themeGallery.list === list && themeGallery.body === themeBody() && themeGallery.grid.isConnected) return;
    themeStopGallery();
    if (!host || !list) return;
    const slides = [...host.querySelectorAll('ul.aspect-square > li')];
    const dots = [...list.querySelectorAll('button[id^="dot-image-"]')];
    if (slides.length < 2 || dots.length !== slides.length) return; // uma foto só (ou conjunto incoerente): sem grade, a INK fica como está
    const grid = document.createElement('div');
    grid.className = 'o-thumbs';
    grid.setAttribute('data-origens-thumbs', '');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Fotos do produto');
    slides.forEach((slide, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'o-thumb';
      const video = !!slide.querySelector('video');
      button.setAttribute('aria-label', (video ? 'Vídeo ' : 'Foto ') + (i + 1) + ' de ' + slides.length);
      const source = slide.querySelector('img');
      if (source && source.getAttribute('src')) {
        const img = document.createElement('img');
        img.src = source.getAttribute('src'); // a MESMA URL do slide (o CDN não redimensiona); o slide aberto depois sai do cache
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        button.appendChild(img);
      }
      if (video) { const badge = document.createElement('span'); badge.className = 'o-thumb-video'; badge.textContent = '▶'; badge.setAttribute('aria-hidden', 'true'); button.appendChild(badge); }
      button.addEventListener('click', () => { const dot = document.getElementById('dot-image-' + i); if (dot) dot.click(); });
      grid.appendChild(button);
    });
    const sync = () => {
      const current = [...list.querySelectorAll('button[id^="dot-image-"]')].findIndex((d) => d.getAttribute('aria-current') === 'true');
      grid.querySelectorAll('.o-thumb').forEach((b, i) => { if (i === current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    };
    const observer = new MutationObserver(sync);
    observer.observe(list, { attributes: true, attributeFilter: ['aria-current', 'class'], subtree: true });
    host.insertAdjacentElement('afterend', grid);
    themeGallery = { host, list, grid, observer, body: themeBody() };
    sync();
    // Só agora (grade montada e funcionando) os pontos nativos saem de cena.
    themeBody().classList.add('o-thumbs');
    themeGalleryTop();
  }

  // ── Ordem de leitura = ordem visual (DOM, mesmo pai) ──
  function themeRestoreMoves() {
    while (themeMoves.length) { const m = themeMoves.pop(); try { if (m.node.isConnected) m.restore(); } catch (_) { /* nó já trocado pela INK */ } }
  }
  function themeMove(node, place, restore) {
    if (!node || themeMoves.some((m) => m.node === node)) return;
    place();
    themeMoves.push({ node, restore });
  }
  function themeReorder() {
    themeMoves = themeMoves.filter((m) => m.node.isConnected); // nós que a INK re-renderizou não precisam voltar
    const form = document.querySelector('form[id^="form-product-"]');
    const frame = form && form.querySelector(':scope > #product_variants_options_frame');
    if (!frame) return;
    // Prazo, cupom e "Também disponível em" logo depois do quadro de compra, nessa ordem.
    let anchor = frame;
    for (const node of [form.querySelector(':scope > #delivery_estimates_frame'), form.querySelector(':scope > #product_promotions_frame'), form.querySelector(':scope > [data-controller="ink-store--modal"]')]) {
      if (!node) continue;
      // Frame carregando (o Turbo marca o atributo busy): mover agora DESCONECTA o frame e aborta o pedido da INK. Fica para o próximo ciclo (o fim do carregamento
      // muda o DOM e o runtime remonta), e o âncora não avança: os outros blocos entram logo depois do quadro de compra.
      if (node.hasAttribute('busy') || node.getAttribute('aria-busy') === 'true') continue;
      if (anchor.nextElementSibling !== node) {
        const prev = node.previousElementSibling; const parent = node.parentElement; const at = anchor;
        themeMove(node, () => at.after(node), () => (prev && prev.parentElement === parent ? prev.after(node) : parent.prepend(node)));
      }
      anchor = node;
    }
    // Guia/Informar medidas antes da quantidade (o quadro de variantes é re-renderizado pela INK: refeito a cada render).
    const type = frame.querySelector('.form-product-options__select-type');
    const links = type && [...type.children].find((c) => c.querySelector('#open-modal-size'));
    const qty = type && [...type.children].find((c) => c.querySelector(':scope > div.inline-flex'));
    if (links && qty && (qty.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      const prev = qty.previousElementSibling;
      themeMove(qty, () => links.after(qty), () => { if (prev && prev.isConnected) prev.after(qty); });
    }
  }

  // ── Flutuantes fora do caminho (celular) ──
  function themeStopChoosing() {
    if (themeChoosing) { themeChoosing.observer.disconnect(); themeChoosing = null; }
    if (themeBody()) themeBody().classList.remove('o-choosing');
  }
  function themeWatchChoosing() {
    // Áreas que os flutuantes não podem cobrir: as escolhas, o CTA e a grade de miniaturas.
    const targets = [document.querySelector('form[id^="form-product-"] .form-product-options__select-type'), document.querySelector('form[id^="form-product-"] .form-product-options__add-to-cart'), document.querySelector('[data-origens-thumbs]')].filter(Boolean);
    if (themeChoosing && targets.length === themeChoosing.targets.length && targets.every((t, i) => t === themeChoosing.targets[i])) return;
    themeStopChoosing();
    if (!targets.length || typeof IntersectionObserver !== 'function') return;
    const seen = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      themeBody().classList.toggle('o-choosing', themeOn('pdp') && !!(THEME_NARROW && THEME_NARROW.matches) && [...seen.values()].some(Boolean));
    });
    for (const t of targets) observer.observe(t);
    themeChoosing = { targets, observer };
  }

  // ── Carrinho: Esc; teclado aberto ──
  const themeTextField = (el) => !!el && el.matches && el.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select');
  function themeFocusIn(event) {
    if (themeOn('pdp') && themeTextField(event.target)) themeBody().classList.add('o-typing');
    if (themeOn('cart') && event.target && event.target.closest && event.target.closest('#shopping-cart-menu-desk,#shopping-cart-menu-mob')) themeOpener = event.target.closest('button');
  }
  function themeFocusOut(event) { if (themeTextField(event.target) && themeBody()) themeBody().classList.remove('o-typing'); }
  function themeKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || !themeOn('cart')) return;
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
  function themeListen(on) {
    if (on === themeListening) return;
    themeListening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('focusin', themeFocusIn, true);
    document[method]('focusout', themeFocusOut, true);
    document[method]('keydown', themeKeydown);
    document[method]('click', themeBarClick, true);
    if (on) { themeResize = () => themeGalleryTop(); window.addEventListener('resize', themeResize); }
    else if (themeResize) { window.removeEventListener('resize', themeResize); themeResize = null; }
  }

  function themeStopPdp() {
    themeStopCta(); themeStopGallery(); themeStopChoosing(); themeRestoreMoves();
    if (themeBody()) themeBody().classList.remove('o-typing');
  }
  register({
    id: 'theme-ui',
    shell: true,
    mount() {
      themeTrustNetwork();
      const pdp = themeOn('pdp') && allowedNow();
      const cart = themeOn('cart');
      themeListen(pdp || cart);
      if (pdp) { themeReorder(); themeWatchCta(); themeWatchGallery(); themeWatchChoosing(); themeGalleryTop(); }
      else themeStopPdp();
      if (!cart) themeOpener = null;
    },
    unmount() {
      themeListen(false);
      themeStopPdp();
      themeOpener = null;
    }
  });
`;
