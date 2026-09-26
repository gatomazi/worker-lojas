// header-nav: aproxima o cabeçalho da INK do storefront Use Origens nas páginas de produto cobertas pelo Worker.
//   - logo -> home da Use Sul no storefront; coleções (definidas no CMS do storefront) -> páginas da própria loja; "Cidades" -> escolha de estado;
//   - lupa: abre UM campo de texto, sem sugestão, sem consulta remota e sem requisição a cada tecla. Enter/"Buscar" leva a /sul/busca?q=... no storefront.
//   A busca "Buscar cidade ou estado" do bloco de descoberta é outra coisa e continua separada.
// Fail-aberto: o cabeçalho NATIVO da INK só é escondido (por CSS, enquanto o nosso existir no mesmo <header>) depois que tudo montou. Conta,
// carrinho e o menu lateral nativo nunca são removidos. Sem configuração, estrutura desconhecida ou qualquer erro => nada muda.
// Saída para o storefront (logo, Cidades, Buscar): links reais com [data-origens-nav]; o espelho do carrinho (cart-mirror) já trata esses
// links como nossos, então o snapshot é gravado UMA vez na saída, reaproveitado se o carrinho não mudou, e nunca durante digitação/abrir/fechar.
// Consulta e token do carrinho são independentes: nada do carrinho vai em URL além do cart_ref que o próprio espelho acrescenta.
export const HEADER_NAV = String.raw`
  const NAV = __NAV_STORE__;
  const NAV_ENDPOINT = '/__origens/navbar';
  const NAV_CACHE_KEY = 'origens:nav:v1';
  const NAV_CACHE_MS = 5 * 60 * 1000;
  const NAV_FETCH_MS = 4000;
  const NAV_INLINE_MAX = 5;
  const NAV_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
  const NAV_QUERY_MAX = 80;
  let navConfig = null;
  let navLoading = null;
  let navFailed = false;

  function navValidate(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.collections) || data.collections.length > 8) return null;
    const list = [];
    for (const item of data.collections) {
      if (!item || typeof item.name !== 'string' || typeof item.slug !== 'string' || !NAV_SLUG.test(item.slug)) return null;
      const name = item.name.replace(/\s+/g, ' ').trim();
      if (!name || name.length > 60) return null;
      list.push({ name: name, slug: item.slug });
    }
    return { collections: list };
  }
  function navReadCache() {
    try {
      const raw = window.sessionStorage.getItem(NAV_CACHE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored && Number.isFinite(stored.at) && Date.now() - stored.at < NAV_CACHE_MS) return navValidate(stored.data);
    } catch (_) { /* sem armazenamento: só memória */ }
    return null;
  }
  function navWriteCache(data) { try { window.sessionStorage.setItem(NAV_CACHE_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (_) { /* idem */ } }

  // Uma única tentativa por carregamento de página: falhou => a navegação nativa segue sozinha, sem laço de tentativas.
  function loadNav() {
    if (navConfig) return Promise.resolve(navConfig);
    if (navFailed) return Promise.resolve(null);
    const cached = navReadCache();
    if (cached) { navConfig = cached; return Promise.resolve(cached); }
    if (!navLoading) {
      navLoading = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NAV_FETCH_MS);
        try {
          const response = await fetch(NAV_ENDPOINT, { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal });
          if (!response.ok) throw new Error('status');
          const data = await response.json();
          const clean = navValidate(data);
          if (!clean) throw new Error('schema');
          navConfig = clean;
          navWriteCache(data);
          return clean;
        } catch (_) {
          navFailed = true;
          return null;
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return navLoading;
  }

  function navEl(tag, props, text) {
    const node = document.createElement(tag);
    for (const key of Object.keys(props || {})) node.setAttribute(key, props[key]);
    if (text) node.textContent = text;
    return node;
  }
  function navSvgSearch() {
    const wrap = navEl('span', { 'aria-hidden': 'true' });
    wrap.innerHTML = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.75 14.75L10.25 10.25M11.75 6.5C11.75 8.1 11.1 9.6 10.2 10.2 9.6 11.1 8.1 11.75 6.5 11.75 3.6 11.75 1.25 9.4 1.25 6.5 1.25 3.6 3.6 1.25 6.5 1.25 9.4 1.25 11.75 3.6 11.75 6.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return wrap;
  }
  // Destino de saída para o storefront: link real, marcado como NOSSO (cart-mirror decora com cart_ref no clique).
  function navOut(href, cls, text) { return navEl('a', { href: href, class: cls, 'data-origens-nav': 'link' }, text); }
  function navCollectionHref(slug) { return NAV.inkBase + '/collections/' + slug; }

  const NAV_CSS = [
    'header:has([data-origens-nav]) nav.navbar:not([data-controller]) > ul.navbar-list,header:has([data-origens-nav]) nav.navbar:not([data-controller]) > a.brand,header:has([data-origens-nav]) nav.navbar:not([data-controller]) form[data-controller~="ink-store--input-search"]{display:none!important}',
    'header:has([data-origens-nav]) nav.navbar[data-controller] .navbar__top > a.brand,header:has([data-origens-nav]) nav.navbar[data-controller] .navbar__top button[aria-label="Pesquisar"],header:has([data-origens-nav]) nav.navbar[data-controller] #mobile_search{display:none!important}',
    'header:has([data-origens-nav="menu"]) #navbar-list-mobile li[data-drawer-target="collection-sidebar"]{display:none!important}',
    '[data-origens-nav]{box-sizing:border-box;font-family:inherit}',
    '[data-origens-nav="desktop"]{display:flex;align-items:center;gap:20px;flex:1 1 auto;min-width:0;color:inherit}',
    '.o-nav-logo{display:flex;align-items:center;gap:8px;min-height:44px;color:inherit;text-decoration:none;flex:0 0 auto}',
    '.o-nav-logo img{display:block;height:36px;width:auto;max-width:none;object-fit:contain}',
    '.o-nav-word{font:800 24px/1 "Big Shoulders Display","Arial Narrow",Impact,sans-serif;letter-spacing:.02em;text-transform:uppercase}',
    // Mobile: só o logo, MAIOR e CENTRALIZADO na faixa (absoluto no meio: hambúrguer à esquerda e busca+carrinho à direita têm larguras diferentes, então
    // um flex com space-between o deslocaria). O texto fica para leitores de tela.
    '@media (max-width:1023px){.o-nav-word{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.navbar__top{position:relative}.navbar__top .o-nav-logo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;min-height:48px}.navbar__top .o-nav-logo img{height:48px}}',
    '.o-nav-links{display:flex;align-items:center;justify-content:center;gap:22px;flex:1 1 auto;min-width:0}',
    '.o-nav-links a,.o-nav-more>summary{display:inline-flex;align-items:center;min-height:44px;color:inherit;font-size:15px;font-weight:500;line-height:1.2;text-decoration:none;white-space:nowrap;cursor:pointer;list-style:none}',
    '.o-nav-more>summary::-webkit-details-marker{display:none}',
    '.o-nav-links a:hover,.o-nav-more>summary:hover{text-decoration:underline;text-underline-offset:4px}',
    '[data-origens-nav] a:focus-visible,[data-origens-nav] button:focus-visible,[data-origens-nav] summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    '.o-nav-more{position:relative}',
    '.o-nav-pop{position:absolute;left:0;top:100%;z-index:60;min-width:200px;padding:6px 0;background:#fff;color:#111827;box-shadow:0 8px 24px rgba(0,0,0,.18);border-radius:8px}',
    '.o-nav-pop a{display:flex;min-height:44px;padding:0 16px;color:#111827}',
    '.o-nav-pop a:hover{background:#f3f4f6;text-decoration:none}',
    '.o-nav-lupa{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;flex:0 0 auto}',
    '[data-origens-nav="menu"]{display:grid;grid-template-columns:1fr 1fr;column-gap:12px;row-gap:0;padding:0 0 8px;margin:0 0 4px;border-bottom:1px solid rgba(255,255,255,.25)}',
    '[data-origens-nav="menu"] .o-nav-title{grid-column:1/-1;margin:0 0 2px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.8}',
    '[data-origens-nav="menu"] a{display:flex;align-items:center;min-height:40px;color:inherit;font-size:15px;font-weight:500;line-height:1.2;text-decoration:none}',
    '[data-origens-nav="search"]{display:flex;align-items:center;gap:8px;width:100%;padding:8px 16px 14px;color:inherit}',
    '[data-origens-nav="search"][hidden]{display:none}',
    '[data-origens-nav="search"] .o-nav-input{flex:1 1 auto;min-width:0;height:48px;margin:0;padding:0 18px;border:1px solid #d1d5db!important;border-radius:9999px;background:#fff;color:#111827!important;font-size:16px;line-height:1.2;-webkit-appearance:none;appearance:none;box-shadow:none!important}',
    '[data-origens-nav="search"] .o-nav-input:focus,[data-origens-nav="search"] .o-nav-input:focus-visible{border-color:#fff!important;box-shadow:none!important;outline:2px solid #fff!important;outline-offset:2px}',
    '[data-origens-nav="search"] .o-nav-input::placeholder{color:#6b7280}',
    '[data-origens-nav="search"] .o-nav-go{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:44px;height:48px;padding:0 20px;border-radius:9999px;background:#fff!important;color:#1f2937!important;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}',
    '[data-origens-nav="search"] .o-nav-go:not([href]){opacity:.7;cursor:default}',
    '[data-origens-nav="search"] .o-nav-go:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '@media (min-width:1024px){[data-origens-nav="search"]{justify-content:flex-end;padding-right:24px}[data-origens-nav="search"] .o-nav-input{flex:0 1 420px}}',
    '@media (max-width:1023px){[data-origens-nav="desktop"]{display:none}}',
    '.o-nav-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('');

  register({
    id: 'header-nav',
    loading: false,
    ac: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      // Idempotente pela existência do nosso conteúdo no <header> atual (o Turbo troca o <body> e o cabeçalho vem novo).
      if (document.querySelector('header [data-origens-nav]')) return;
      if (this.loading || navFailed) return;
      if (!this.parts()) return; // estrutura desconhecida: a INK segue sozinha
      this.loading = true;
      loadNav().then((config) => {
        this.loading = false;
        if (!config || !allowedNow() || document.querySelector('header [data-origens-nav]')) return;
        const parts = this.parts();
        if (!parts) return;
        try { this.build(parts, config); } catch (err) { console.warn('[Use Origens] header-nav failed (non-critical):', err); navFailed = true; this.unmount(); }
      });
    },

    parts() {
      const header = document.querySelector('header.header') || document.querySelector('header');
      if (!header) return null;
      const desktop = header.querySelector('nav.navbar:not([data-controller])');
      const mobile = header.querySelector('nav.navbar[data-controller]');
      const top = mobile ? mobile.querySelector('.navbar__top') : null;
      if (!desktop && !top) return null;
      return { header: header, desktop: desktop, mobile: mobile, top: top, menu: mobile ? mobile.querySelector('#navbar-list-mobile') : null };
    },

    build(parts, config) {
      if (this.ac) this.ac.abort();
      this.ac = new AbortController();
      const signal = this.ac.signal;
      const header = parts.header;
      const nativeLogo = header.querySelector('a.brand img');
      const logoSrc = nativeLogo ? nativeLogo.getAttribute('src') : '';
      const collections = config.collections;
      const lupas = [];

      const style = navEl('style', { 'data-origens-nav': 'style' });
      style.textContent = NAV_CSS;
      header.insertBefore(style, header.firstChild);

      const logo = (cls) => {
        const link = navOut(NAV.home, cls, '');
        link.setAttribute('aria-label', NAV.name + ', página inicial');
        if (logoSrc) link.appendChild(navEl('img', { src: logoSrc, alt: '' }));
        link.appendChild(navEl('span', { class: 'o-nav-word', translate: 'no' }, 'Use Origens'));
        return link;
      };
      const makeLupa = () => {
        const button = navEl('button', { type: 'button', class: 'o-nav-lupa', 'aria-label': 'Buscar produtos', 'aria-expanded': 'false', 'aria-controls': 'o-nav-search', 'data-origens-nav': 'lupa' });
        button.appendChild(navSvgSearch());
        lupas.push(button);
        return button;
      };

      // Campo de busca único (desktop e mobile), logo abaixo da faixa principal do cabeçalho.
      const form = navEl('form', { id: 'o-nav-search', role: 'search', 'data-origens-nav': 'search', hidden: '', action: NAV.search, method: 'get' });
      const label = navEl('label', { for: 'o-nav-q', class: 'o-nav-sr' }, 'Buscar produtos');
      const input = navEl('input', { id: 'o-nav-q', class: 'o-nav-input', type: 'search', name: 'q', maxlength: String(NAV_QUERY_MAX), enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Buscar cidade, estampa ou coleção' });
      const go = navEl('a', { class: 'o-nav-go', 'data-origens-nav': 'link' }, 'Buscar');
      form.append(label, input, go);
      header.appendChild(form);

      const isOpen = () => !form.hidden;
      const closeNativeMenu = () => {
        const burger = document.getElementById('menu-hamburger');
        if (burger && burger.getAttribute('aria-expanded') === 'true') burger.click();
      };
      const setOpen = (open, focus) => {
        if (open === isOpen()) { if (open && focus) input.focus(); return; }
        if (open) closeNativeMenu(); // busca e menu lateral nunca abertos juntos
        form.hidden = !open;
        for (const button of lupas) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) input.focus();
        else if (focus) { const visible = lupas.find((b) => b.getClientRects().length > 0) || lupas[0]; if (visible) visible.focus(); }
      };
      const query = () => input.value.replace(/\s+/g, ' ').trim().slice(0, NAV_QUERY_MAX);
      // O "Buscar" só é um link quando há texto: sem href não há navegação (nem snapshot do carrinho) para consulta vazia.
      const sync = () => {
        const text = query();
        if (!text) { go.removeAttribute('href'); return; }
        const url = new URL(NAV.search);
        url.searchParams.set('q', text);
        go.setAttribute('href', url.href);
      };
      const submit = () => {
        sync();
        if (!go.hasAttribute('href')) { input.focus(); return; } // vazio ou só espaços: não navega, devolve o foco
        go.click();
      };
      input.addEventListener('input', sync, { signal });
      input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false, true); } }, { signal });
      form.addEventListener('submit', (event) => { event.preventDefault(); submit(); }, { signal });
      go.addEventListener('click', (event) => { if (!go.hasAttribute('href')) { event.preventDefault(); input.focus(); } }, { signal });
      const onLupa = () => { if (isOpen() && query()) submit(); else setOpen(!isOpen(), true); };

      // Desktop: logo, coleções (até NAV_INLINE_MAX; o resto em "Mais"), Cidades e a lupa; conta e carrinho nativos ficam onde estão.
      if (parts.desktop) {
        const block = navEl('div', { 'data-origens-nav': 'desktop' });
        block.appendChild(logo('o-nav-logo'));
        const links = navEl('nav', { class: 'o-nav-links', 'aria-label': 'Coleções' });
        for (const item of collections.slice(0, NAV_INLINE_MAX)) links.appendChild(navEl('a', { href: navCollectionHref(item.slug) }, item.name));
        if (collections.length > NAV_INLINE_MAX) {
          const more = navEl('details', { class: 'o-nav-more' });
          more.appendChild(navEl('summary', {}, 'Mais'));
          const pop = navEl('div', { class: 'o-nav-pop' });
          for (const item of collections.slice(NAV_INLINE_MAX)) pop.appendChild(navEl('a', { href: navCollectionHref(item.slug) }, item.name));
          more.appendChild(pop);
          links.appendChild(more);
          document.addEventListener('click', (event) => { if (!more.contains(event.target)) more.removeAttribute('open'); }, { capture: true, signal });
          more.addEventListener('keydown', (event) => { if (event.key === 'Escape') { more.removeAttribute('open'); const summary = more.querySelector('summary'); if (summary) summary.focus(); } }, { signal });
        }
        links.appendChild(navOut(NAV.cities, '', 'Cidades'));
        block.appendChild(links);
        block.appendChild(makeLupa());
        parts.desktop.insertBefore(block, parts.desktop.firstElementChild);
      }

      // Mobile: hambúrguer e carrinho nativos; logo e lupa nossos; coleções e Cidades no topo do menu lateral nativo.
      if (parts.top) {
        const nativeBrand = parts.top.querySelector('a.brand');
        const mobileLogo = logo('o-nav-logo');
        mobileLogo.setAttribute('data-origens-nav', 'link');
        if (nativeBrand) nativeBrand.insertAdjacentElement('beforebegin', mobileLogo); else parts.top.appendChild(mobileLogo);
        const nativeSearch = parts.top.querySelector('button[aria-label="Pesquisar"]');
        const lupa = makeLupa();
        if (nativeSearch) nativeSearch.insertAdjacentElement('beforebegin', lupa); else parts.top.appendChild(lupa);
        if (parts.menu && collections.length > 0) {
          const section = navEl('section', { 'data-origens-nav': 'menu', 'aria-label': 'Coleções' });
          section.appendChild(navEl('p', { class: 'o-nav-title' }, 'Coleções'));
          for (const item of collections) section.appendChild(navEl('a', { href: navCollectionHref(item.slug) }, item.name));
          section.appendChild(navOut(NAV.cities, '', 'Cidades'));
          parts.menu.insertBefore(section, parts.menu.firstChild);
        }
      }

      for (const button of lupas) button.addEventListener('click', onLupa, { signal });
      // Abrir o menu lateral nativo fecha a busca (sem sobreposição).
      document.addEventListener('click', (event) => { if (event.target && event.target.closest && event.target.closest('#menu-hamburger') && isOpen()) setOpen(false, false); }, { capture: true, signal });
    },

    unmount() {
      this.loading = false;
      if (this.ac) { this.ac.abort(); this.ac = null; }
      for (const node of document.querySelectorAll('[data-origens-nav]')) node.remove();
    }
  });
`;
