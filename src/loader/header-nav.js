// header-nav: aproxima o cabeçalho da INK do storefront Use Origens nas páginas de produto cobertas pelo Worker, e acrescenta o FAB de WhatsApp.
//   Desktop:  [logo] [Regiões ▾] [coleções do Topo] [Demais categorias ▾] [Cidades] [lupa] + conta e carrinho nativos da INK.
//   Mobile:   hambúrguer, logo central, lupa e carrinho; o menu lateral nativo ganha no topo Cidades, Regiões (accordion), as coleções do Topo e
//             "Demais categorias" (accordion fechado); a conta e o atendimento nativos continuam acessíveis (rolagem do menu inteiro).
//   Coleções: DOIS grupos livres escolhidos no CMS (top e more), qualquer quantidade, na ordem do proprietário. Nenhuma coleção é especial ("Novidades" é só
//             um nome). Regiões (estados) e Cidades são fixos. Sem largura para tudo, a APRESENTAÇÃO vira um único menu compacto; os grupos não mudam.
//   Busca:    lupa fechada por padrão; abre UM campo de texto (painel compacto ancorado, sem empurrar a página), sem sugestão nem requisição por tecla.
//             Enter/"Buscar" -> /sul/busca?q=... no storefront. A busca "Buscar cidade ou estado" do bloco de descoberta é outra coisa.
//   FAB:      botão verde de WhatsApp logo ACIMA do "Ajuda?" nativo (destino = o link de WhatsApp que a própria INK já publica na página; sem link, não aparece).
// Fail-aberto: o cabeçalho NATIVO só é escondido (CSS, enquanto o nosso existir no mesmo <header>) depois de montado. Conta, carrinho e o menu lateral nativo
// nunca são removidos. Sem configuração, estrutura desconhecida ou qualquer erro => nada muda.
// Saída para o storefront (logo, Cidades, Regiões, Buscar): links reais com [data-origens-nav]; o cart-mirror os trata como nossos (snapshot UMA vez na
// saída, token reaproveitado se o carrinho não mudou, nunca ao digitar/abrir/fechar). Links da INK (coleções, conta) não passam pela ponte.
export const HEADER_NAV = String.raw`
  const NAV = __NAV_STORE__;
  const NAV_ENDPOINT = '/__origens/navbar';
  const NAV_CACHE_KEY = 'origens:nav:v2';
  const NAV_CACHE_MS = 5 * 60 * 1000;
  const NAV_FETCH_MS = 4000;
  const NAV_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
  const NAV_MAX_GROUP = 60;
  const NAV_QUERY_MAX = 80;
  let navConfig = null;
  let navLoading = null;
  let navFailed = false;

  function navText(value, max) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 1 && text.length <= max ? text : null;
  }
  function navGroup(list) {
    if (!Array.isArray(list) || list.length > NAV_MAX_GROUP) return null;
    const out = []; const seen = new Set();
    for (const item of list) {
      if (!item || typeof item.slug !== 'string' || !NAV_SLUG.test(item.slug)) return null;
      const title = navText(item.title, 60);
      if (!title) return null;
      if (seen.has(item.slug)) continue;
      seen.add(item.slug); out.push({ title: title, slug: item.slug });
    }
    return out;
  }
  // Contrato v2 do gateway (já validado no servidor; o cliente valida de novo: defesa em profundidade e cache do sessionStorage).
  function navValidate(data) {
    if (!data || data.v !== 2 || !Array.isArray(data.states) || data.states.length > 8) return null;
    const top = navGroup(data.top); const more = navGroup(data.more);
    if (!top || !more || more.some((m) => top.some((t) => t.slug === m.slug))) return null;
    const states = [];
    for (const s of data.states) {
      const name = s && navText(s.name, 40);
      if (!s || typeof s.uf !== 'string' || !/^[A-Z]{2}$/.test(s.uf) || !name || s.path !== NAV.base + '/' + s.uf.toLowerCase()) return null;
      states.push({ uf: s.uf, name: name, path: s.path });
    }
    return { top: top, more: more, states: states };
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
  const NAV_SVG = {
    search: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.75 14.75L10.25 10.25M11.75 6.5C11.75 8.1 11.1 9.6 10.2 10.2 9.6 11.1 8.1 11.75 6.5 11.75 3.6 11.75 1.25 9.4 1.25 6.5 1.25 3.6 3.6 1.25 6.5 1.25 9.4 1.25 11.75 3.6 11.75 6.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="m6 9 6 6 6-6"/></svg>',
    whatsapp: '<svg width="28" height="28" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M16.02 3C9.4 3 4.03 8.37 4.03 14.99c0 2.11.55 4.17 1.6 5.99L4 29l8.2-1.6a11.95 11.95 0 0 0 3.82.62h.01c6.62 0 12-5.37 12-11.99C28.03 8.37 22.64 3 16.02 3Zm0 21.9h-.01c-1.2 0-2.37-.32-3.4-.93l-.24-.15-4.87.95.99-4.75-.16-.25a9.93 9.93 0 0 1-1.52-5.28c0-5.5 4.48-9.98 9.99-9.98 5.5 0 9.97 4.48 9.97 9.98 0 5.5-4.47 9.41-9.75 10.41Zm5.47-7.48c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.49-.9-.8-1.5-1.78-1.67-2.08-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z"/></svg>'
  };
  // Destino de saída para o storefront: link real, marcado como NOSSO (cart-mirror decora com cart_ref no clique).
  function navOut(href, cls, text) { return navEl('a', { href: href, class: cls, 'data-origens-nav': 'link' }, text); }
  const navCollectionHref = (slug) => NAV.inkBase + '/collections/' + slug;
  const navStateHref = (state) => NAV.origin + state.path;

  const NAV_CSS = [
    // Nativo escondido SOMENTE enquanto o nosso existir no mesmo <header> (o Turbo troca o <body>: o cabeçalho volta nativo até remontar).
    'header:has([data-origens-nav]) nav.navbar:not([data-controller]) > ul.navbar-list,header:has([data-origens-nav]) nav.navbar:not([data-controller]) > a.brand,header:has([data-origens-nav]) nav.navbar:not([data-controller]) form[data-controller~="ink-store--input-search"]{display:none!important}',
    'header:has([data-origens-nav]) nav.navbar[data-controller] .navbar__top > a.brand,header:has([data-origens-nav]) nav.navbar[data-controller] .navbar__top button[aria-label="Pesquisar"],header:has([data-origens-nav]) nav.navbar[data-controller] #mobile_search{display:none!important}',
    // Menu lateral: a navegação principal é a nossa (sem uma segunda vitrine "Loja/Produtos/Categorias"); Sobre, conta e atendimento nativos ficam.
    'header:has([data-origens-nav="menu"]) #navbar-list-mobile li:has(> a[href="/usesul"]),header:has([data-origens-nav="menu"]) #navbar-list-mobile li[data-drawer-target="product-sidebar"],header:has([data-origens-nav="menu"]) #navbar-list-mobile li[data-drawer-target="collection-sidebar"]{display:none!important}',
    // A área de conta/atendimento nativa era absoluta (bottom:150px): com muitas coleções ela cobriria a lista. Passa ao fluxo: o menu rola por inteiro e o bloco fica sempre alcançável.
    'header:has([data-origens-nav="menu"]) #navbar-list-mobile > section.absolute{position:static!important;bottom:auto!important;margin:8px 0 0!important;padding-bottom:32px}',
    '[data-origens-hide]{display:none!important}',
    '[data-origens-nav]{box-sizing:border-box;font-family:inherit}',
    '[data-origens-nav="desktop"]{display:flex;align-items:center;gap:16px;flex:1 1 auto;min-width:0;color:inherit}',
    '.o-nav-logo{display:flex;align-items:center;gap:8px;min-height:44px;color:inherit;text-decoration:none;flex:0 0 auto}',
    '.o-nav-logo img{display:block;height:36px;width:auto;max-width:none;object-fit:contain}',
    '.o-nav-word{font:800 24px/1 "Big Shoulders Display","Arial Narrow",Impact,sans-serif;letter-spacing:.02em;text-transform:uppercase}',
    // Mobile: só o logo, MAIOR e CENTRALIZADO na faixa (absoluto no meio: hambúrguer à esquerda e busca+carrinho à direita têm larguras diferentes).
    '@media (max-width:1023px){.o-nav-word{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.navbar__top{position:relative}.navbar__top .o-nav-logo{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;min-height:48px}.navbar__top .o-nav-logo img{height:48px}}',
    '.o-nav-links{display:flex;align-items:center;justify-content:center;gap:18px;flex:1 1 auto;min-width:0}',
    '.o-nav-links>*{flex:0 0 auto}',
    '.o-nav-links a,.o-dd-btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:15px;font-weight:500;line-height:1.2;text-decoration:none;white-space:nowrap;cursor:pointer}',
    '.o-nav-links a:hover,.o-dd-btn:hover{text-decoration:underline;text-underline-offset:4px}',
    '.o-dd-btn svg{transition:transform .15s}.o-dd-btn[aria-expanded="true"] svg{transform:rotate(180deg)}',
    '[data-origens-nav] a:focus-visible,[data-origens-nav] button:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    // Dropdown no estilo do storefront: painel branco, borda escura, itens de 44 px, rolagem interna quando a lista é longa.
    '.o-dd{position:relative}',
    '.o-dd-panel{position:absolute;left:0;top:100%;z-index:60;min-width:220px;max-width:min(340px,90vw);max-height:min(70vh,440px);overflow-y:auto;margin-top:4px;padding:4px 0;background:#fff;color:#111827;border:2px solid #111827;box-shadow:0 8px 24px rgba(0,0,0,.18)}',
    '.o-dd-panel[hidden]{display:none}',
    '.o-dd-panel a{display:flex;align-items:center;justify-content:flex-start;min-height:44px;padding:0 16px;color:#111827;font-size:15px;font-weight:600;white-space:normal;text-decoration:none}',
    '.o-dd-panel a:hover,.o-dd-panel a:focus-visible{background:#111827;color:#fff;text-decoration:none;outline:0}',
    '.o-dd-panel .o-dd-h{margin:0;padding:10px 16px 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}',
    '.o-dd-panel .o-dd-sep{margin:4px 0;border:0;border-top:1px solid #e5e7eb}',
    // Sem largura para tudo (medido por JS): só a APRESENTAÇÃO muda, tudo vai para um único menu; os grupos do CMS não mudam.
    '.o-nav-full{display:contents}',
    '[data-origens-nav="desktop"] .o-nav-compact{display:none}',
    '[data-origens-nav="desktop"][data-compact] .o-nav-full{display:none}',
    '[data-origens-nav="desktop"][data-compact] .o-nav-compact{display:block}',
    '.o-nav-lupa{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;flex:0 0 auto}',
    '@media (max-width:1023px){[data-origens-nav="desktop"]{display:none}}',
    // Menu lateral (mobile): CTA de cidades, Regiões e Demais categorias em accordion, coleções do Topo como links.
    '[data-origens-nav="menu"]{display:flex;flex-direction:column;gap:2px;padding:0 0 10px;margin:0 0 4px;border-bottom:1px solid rgba(255,255,255,.25)}',
    '[data-origens-nav="menu"] .o-nav-title{margin:8px 0 0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.8}',
    '[data-origens-nav="menu"] a.o-cta{display:flex;align-items:center;justify-content:center;min-height:48px;margin:0 0 8px;padding:0 16px;border-radius:9999px;background:#fff;color:#1f2937;font-size:16px;font-weight:700;text-decoration:none}',
    '[data-origens-nav="menu"] a:not(.o-cta),[data-origens-nav="menu"] .o-acc-btn{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;margin:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:16px;font-weight:500;line-height:1.2;text-align:left;text-decoration:none;cursor:pointer}',
    '[data-origens-nav="menu"] .o-acc-btn svg{transition:transform .15s}[data-origens-nav="menu"] .o-acc-btn[aria-expanded="true"] svg{transform:rotate(180deg)}',
    '[data-origens-nav="menu"] .o-acc-list{margin:0;padding:0 0 4px 14px;border-left:2px solid rgba(255,255,255,.3)}',
    '[data-origens-nav="menu"] .o-acc-list[hidden]{display:none}',
    // Busca: painel compacto ANCORADO logo abaixo do cabeçalho (não empurra a página nem cria uma faixa vazia).
    '[data-origens-nav="search"]{position:absolute;top:100%;left:8px;right:8px;z-index:70;display:flex;align-items:center;gap:8px;padding:10px;background:#fff;color:#111827;border:2px solid #111827;box-shadow:0 8px 24px rgba(0,0,0,.18)}',
    '[data-origens-nav="search"][hidden]{display:none}',
    '[data-origens-nav="search"] .o-nav-input{flex:1 1 auto;min-width:0;height:46px;margin:0;padding:0 14px;border:1px solid #6b7280!important;border-radius:0;background:#fff;color:#111827!important;font-size:16px;line-height:1.2;-webkit-appearance:none;appearance:none;box-shadow:none!important}',
    '[data-origens-nav="search"] .o-nav-input:focus,[data-origens-nav="search"] .o-nav-input:focus-visible{border-color:#111827!important;box-shadow:none!important;outline:2px solid #111827!important;outline-offset:1px}',
    '[data-origens-nav="search"] .o-nav-input::placeholder{color:#6b7280}',
    '[data-origens-nav="search"] .o-nav-go{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:44px;height:46px;padding:0 20px;background:#111827!important;color:#fff!important;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}',
    '[data-origens-nav="search"] .o-nav-go:not([href]){opacity:.6;cursor:default}',
    '[data-origens-nav="search"] .o-nav-go:focus-visible{outline:2px solid #111827;outline-offset:2px}',
    '@media (min-width:1024px){[data-origens-nav="search"]{left:auto;right:16px;width:min(440px,calc(100vw - 32px))}}',
    '.o-nav-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('');

  register({
    id: 'header-nav',
    shell: true, // também nas páginas de casca (home, coleções, conta/pedidos...)
    loading: false,
    ac: null,
    headerFix: null,
    fitTimer: null,

    mount() {
      if (!pageNow()) return this.unmount();
      // Idempotente pela existência do nosso conteúdo no <header> atual (o Turbo troca o <body> e o cabeçalho vem novo).
      if (document.querySelector('header [data-origens-nav]')) return;
      if (this.loading || navFailed) return;
      if (!this.parts()) return; // estrutura desconhecida: a INK segue sozinha
      this.loading = true;
      loadNav().then((config) => {
        this.loading = false;
        if (!config || !pageNow() || document.querySelector('header [data-origens-nav]')) return;
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
      const self = this;
      const header = parts.header;
      const nativeLogo = header.querySelector('a.brand img');
      const logoSrc = nativeLogo ? nativeLogo.getAttribute('src') : '';
      const lupas = [];
      const dropdowns = [];

      const style = navEl('style', { 'data-origens-nav': 'style' });
      style.textContent = NAV_CSS;
      header.insertBefore(style, header.firstChild);
      // O painel de busca é ancorado ao cabeçalho: ele precisa ser um contêiner de posicionamento.
      if (getComputedStyle(header).position === 'static') { header.style.position = 'relative'; this.headerFix = header; }

      const logo = (cls) => {
        const link = navOut(NAV.home, cls, '');
        link.setAttribute('aria-label', NAV.name + ', página inicial');
        if (logoSrc) link.appendChild(navEl('img', { src: logoSrc, alt: '' }));
        link.appendChild(navEl('span', { class: 'o-nav-word', translate: 'no' }, 'Use Origens'));
        return link;
      };
      const makeLupa = () => {
        const button = navEl('button', { type: 'button', class: 'o-nav-lupa', 'aria-label': 'Buscar produtos', 'aria-expanded': 'false', 'aria-controls': 'o-nav-search', 'data-origens-nav': 'lupa' });
        const icon = navEl('span', { 'aria-hidden': 'true' }); icon.innerHTML = NAV_SVG.search; button.appendChild(icon);
        lupas.push(button);
        return button;
      };

      // ── Busca: um único campo (painel compacto ancorado) ──────────────────────────────────────────────────────────────────────────────
      const form = navEl('form', { id: 'o-nav-search', role: 'search', 'data-origens-nav': 'search', hidden: '', action: NAV.search, method: 'get' });
      const label = navEl('label', { for: 'o-nav-q', class: 'o-nav-sr' }, 'Buscar produtos');
      const input = navEl('input', { id: 'o-nav-q', class: 'o-nav-input', type: 'search', name: 'q', maxlength: String(NAV_QUERY_MAX), enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Buscar cidade, estampa ou coleção' });
      const go = navEl('a', { class: 'o-nav-go', 'data-origens-nav': 'link' }, 'Buscar');
      form.append(label, input, go);
      header.appendChild(form);

      // ── Dropdowns (Regiões, Demais categorias, Menu compacto): clique/teclado, um aberto por vez ────────────────────────────────────────────
      const closeDropdowns = (except) => {
        for (const dd of dropdowns) if (dd !== except && !dd.panel.hidden) { dd.panel.hidden = true; dd.button.setAttribute('aria-expanded', 'false'); }
      };
      const makeDropdown = (id, text, fill) => {
        const root = navEl('div', { class: 'o-dd', 'data-dd': id });
        const button = navEl('button', { type: 'button', class: 'o-dd-btn', 'aria-expanded': 'false', 'aria-haspopup': 'true', 'aria-controls': 'o-dd-' + id });
        button.appendChild(document.createTextNode(text));
        const chevron = navEl('span', { 'aria-hidden': 'true' }); chevron.innerHTML = NAV_SVG.chevron; button.appendChild(chevron);
        const panel = navEl('div', { class: 'o-dd-panel', id: 'o-dd-' + id, hidden: '' });
        fill(panel);
        root.append(button, panel);
        const dd = { root: root, button: button, panel: panel };
        const links = () => Array.from(panel.querySelectorAll('a'));
        const open = (focusFirst) => {
          closeDropdowns(dd); setSearch(false, false);
          panel.hidden = false; button.setAttribute('aria-expanded', 'true');
          if (focusFirst) { const first = links()[0]; if (first) first.focus(); }
        };
        const close = (refocus) => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (refocus) button.focus(); };
        button.addEventListener('click', () => { if (panel.hidden) open(false); else close(false); }, { signal: signal });
        button.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); open(true); } }, { signal: signal });
        panel.addEventListener('keydown', (event) => {
          const items = links(); const at = items.indexOf(document.activeElement);
          if (event.key === 'Escape') { event.preventDefault(); close(true); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); (items[at + 1] || items[0]).focus(); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); (items[at - 1] || items[items.length - 1]).focus(); }
          else if (event.key === 'Home') { event.preventDefault(); items[0].focus(); }
          else if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
        }, { signal: signal });
        // Escolher um link fecha; sair do painel com Tab fecha.
        panel.addEventListener('click', (event) => { if (event.target && event.target.closest && event.target.closest('a')) close(false); }, { signal: signal });
        root.addEventListener('focusout', (event) => { if (!panel.hidden && event.relatedTarget && !root.contains(event.relatedTarget)) close(false); }, { signal: signal });
        dropdowns.push(dd);
        return root;
      };
      const linkList = (panel, items, hrefOf) => { for (const item of items) panel.appendChild(navEl('a', { href: hrefOf(item) }, item.title)); };
      const stateLinks = (panel) => {
        for (const state of config.states) panel.appendChild(navOut(navStateHref(state), '', state.name));
        panel.appendChild(navOut(NAV.cities, '', 'Ver estados'));
      };

      // ── Busca: abrir/fechar/enviar ────────────────────────────────────────────────────────────────────────────────────────────────────────
      const isOpen = () => !form.hidden;
      const closeNativeMenu = () => {
        const burger = document.getElementById('menu-hamburger');
        if (burger && burger.getAttribute('aria-expanded') === 'true') burger.click();
      };
      function setSearch(open, focus) {
        if (open === isOpen()) { if (open && focus) input.focus(); return; }
        if (open) { closeNativeMenu(); closeDropdowns(null); } // busca, menu lateral e dropdowns nunca abertos juntos
        form.hidden = !open;
        for (const button of lupas) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) input.focus();
        else if (focus) { const visible = lupas.find((b) => b.getClientRects().length > 0) || lupas[0]; if (visible) visible.focus(); }
      }
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
        if (!go.hasAttribute('href')) { input.focus(); return; } // vazio ou só espaços: não navega, devolve o foco ao campo
        go.click();
      };
      input.addEventListener('input', sync, { signal: signal });
      input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); setSearch(false, true); } }, { signal: signal });
      form.addEventListener('submit', (event) => { event.preventDefault(); submit(); }, { signal: signal });
      go.addEventListener('click', (event) => { if (!go.hasAttribute('href')) { event.preventDefault(); input.focus(); } }, { signal: signal });
      const onLupa = () => { if (isOpen() && query()) submit(); else setSearch(!isOpen(), true); };

      // ── Desktop ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
      if (parts.desktop) {
        const block = navEl('div', { 'data-origens-nav': 'desktop' });
        block.appendChild(logo('o-nav-logo'));
        const links = navEl('nav', { class: 'o-nav-links', 'aria-label': 'Principal' });
        // Layout completo: Regiões ▾, coleções do Topo, Demais categorias ▾ (só se houver), Cidades.
        const full = navEl('div', { class: 'o-nav-full' });
        full.appendChild(makeDropdown('regioes', 'Regiões', stateLinks));
        for (const item of config.top) full.appendChild(navEl('a', { href: navCollectionHref(item.slug) }, item.title));
        if (config.more.length > 0) full.appendChild(makeDropdown('demais', 'Demais categorias', (panel) => linkList(panel, config.more, (i) => navCollectionHref(i.slug))));
        links.appendChild(full);
        // Layout compacto (mesmos dados, uma só apresentação): Menu ▾ com Regiões, Coleções e Demais categorias.
        const compact = navEl('div', { class: 'o-nav-compact' });
        compact.appendChild(makeDropdown('menu', 'Menu', (panel) => {
          panel.appendChild(navEl('p', { class: 'o-dd-h' }, 'Regiões')); stateLinks(panel);
          if (config.top.length > 0) { panel.appendChild(navEl('hr', { class: 'o-dd-sep' })); panel.appendChild(navEl('p', { class: 'o-dd-h' }, 'Coleções')); linkList(panel, config.top, (i) => navCollectionHref(i.slug)); }
          if (config.more.length > 0) { panel.appendChild(navEl('hr', { class: 'o-dd-sep' })); panel.appendChild(navEl('p', { class: 'o-dd-h' }, 'Demais categorias')); linkList(panel, config.more, (i) => navCollectionHref(i.slug)); }
        }));
        links.appendChild(compact);
        links.appendChild(navOut(NAV.cities, '', 'Cidades'));
        block.appendChild(links);
        block.appendChild(makeLupa());
        parts.desktop.insertBefore(block, parts.desktop.firstElementChild);

        // Cabe tudo? Mede com o layout completo; se estoura, muda só a apresentação. Sem observers: carga, fontes, resize (debounce) e mudança de rota.
        const fit = () => {
          if (!block.isConnected) return;
          block.removeAttribute('data-compact');
          if (block.getClientRects().length > 0 && links.scrollWidth > links.clientWidth + 1) block.setAttribute('data-compact', '');
          closeDropdowns(null);
        };
        window.addEventListener('resize', () => { clearTimeout(self.fitTimer); self.fitTimer = setTimeout(fit, 120); }, { signal: signal });
        fit();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (block.isConnected) fit(); });
      }

      // ── Mobile ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
      if (parts.top) {
        const nativeBrand = parts.top.querySelector('a.brand');
        const mobileLogo = logo('o-nav-logo');
        if (nativeBrand) nativeBrand.insertAdjacentElement('beforebegin', mobileLogo); else parts.top.appendChild(mobileLogo);
        const nativeSearch = parts.top.querySelector('button[aria-label="Pesquisar"]');
        const lupa = makeLupa();
        if (nativeSearch) nativeSearch.insertAdjacentElement('beforebegin', lupa); else parts.top.appendChild(lupa);
        if (parts.menu) {
          const section = navEl('section', { 'data-origens-nav': 'menu', 'aria-label': 'Navegação principal' });
          section.appendChild(navOut(NAV.cities, 'o-cta', 'Encontrar minha cidade'));
          const accordion = (id, text, fill) => {
            const wrap = navEl('div', { class: 'o-acc' });
            const button = navEl('button', { type: 'button', class: 'o-acc-btn', 'aria-expanded': 'false', 'aria-controls': 'o-acc-' + id });
            button.appendChild(document.createTextNode(text));
            const chevron = navEl('span', { 'aria-hidden': 'true' }); chevron.innerHTML = NAV_SVG.chevron; button.appendChild(chevron);
            const list = navEl('div', { class: 'o-acc-list', id: 'o-acc-' + id, hidden: '' });
            fill(list);
            button.addEventListener('click', () => { const open = list.hidden; list.hidden = !open; button.setAttribute('aria-expanded', open ? 'true' : 'false'); }, { signal: signal });
            wrap.append(button, list);
            return wrap;
          };
          section.appendChild(accordion('regioes', 'Regiões', (list) => { for (const state of config.states) list.appendChild(navOut(navStateHref(state), '', state.name)); list.appendChild(navOut(NAV.cities, '', 'Ver estados')); }));
          if (config.top.length > 0) {
            section.appendChild(navEl('p', { class: 'o-nav-title' }, 'Coleções'));
            for (const item of config.top) section.appendChild(navEl('a', { href: navCollectionHref(item.slug) }, item.title));
          }
          if (config.more.length > 0) section.appendChild(accordion('demais', 'Demais categorias', (list) => linkList(list, config.more, (i) => navCollectionHref(i.slug))));
          parts.menu.insertBefore(section, parts.menu.firstChild);
          // "Dashboard" sem destino válido (bugado): some da vista; Meus pedidos, Sair, Entrar, Rastreio, Trocar pedido e WhatsApp nativos ficam.
          for (const a of parts.menu.querySelectorAll('li a')) {
            const href = a.getAttribute('href') || '';
            if (/^\s*dashboard\s*$/i.test(a.textContent || '') && (href === '' || href === '#' || /^javascript:/i.test(href))) { const item = a.closest('li'); if (item) item.setAttribute('data-origens-hide', ''); }
          }
        }
      }

      for (const button of lupas) button.addEventListener('click', onLupa, { signal: signal });
      // Cliques fora fecham os dropdowns; abrir o menu lateral nativo fecha a busca e os dropdowns (sem sobreposição).
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (dropdowns.some((dd) => !dd.panel.hidden && !dd.root.contains(target))) closeDropdowns(null);
        if (target && target.closest && target.closest('#menu-hamburger')) { if (isOpen()) setSearch(false, false); closeDropdowns(null); }
      }, { capture: true, signal: signal });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && dropdowns.some((dd) => !dd.panel.hidden)) closeDropdowns(null); }, { signal: signal });
      for (const name of ['turbo:visit', 'turbo:before-render', 'pagehide']) document.addEventListener(name, () => { closeDropdowns(null); if (isOpen()) setSearch(false, false); }, { signal: signal });
    },

    unmount() {
      this.loading = false;
      clearTimeout(this.fitTimer);
      if (this.ac) { this.ac.abort(); this.ac = null; }
      if (this.headerFix) { this.headerFix.style.position = ''; this.headerFix = null; }
      for (const node of document.querySelectorAll('[data-origens-nav]')) node.remove();
      for (const node of document.querySelectorAll('[data-origens-hide]')) node.removeAttribute('data-origens-hide');
    }
  });

  // ── FAB de WhatsApp, logo acima do "Ajuda?" nativo ─────────────────────────────────────────────────────────────────────────────────────────
  // Destino: o link de WhatsApp que a própria INK já publica na página (telefone e mensagem dela; nada inventado). Sem link ou sem o Ajuda, não aparece.
  // Posição: calculada a partir do retângulo REAL do Ajuda (que a INK já posiciona com margens próprias); recuada (acima do aviso de cookies) ou escondida, nunca os controles nativos.
  const WA_HOSTS = ['api.whatsapp.com', 'wa.me', 'web.whatsapp.com'];
  const WA_SIZE = 52;
  const WA_GAP = 12;
  function waHref() {
    for (const a of document.querySelectorAll('a[href*="whatsapp.com"], a[href^="https://wa.me/"]')) {
      if (a.id === 'o-wa-fab') continue;
      try {
        const url = new URL(a.getAttribute('href'), window.location.href);
        if (url.protocol === 'https:' && WA_HOSTS.indexOf(url.hostname) !== -1 && !url.username && !url.password) return url.href;
      } catch (_) { /* link inválido: ignora */ }
    }
    return null;
  }
  const waShown = (selector) => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0; };
  const waIntersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  register({
    id: 'whatsapp-fab',
    shell: true,
    ac: null,
    timer: null,

    mount() {
      if (!pageNow()) return this.unmount();
      const help = document.querySelector('[data-controller~="ink-store--help-button"]');
      const href = help ? waHref() : null;
      let fab = document.getElementById('o-wa-fab');
      if (!help || !href || help.getClientRects().length === 0) { if (fab) { fab.hidden = true; fab.style.display = 'none'; } return; }
      if (!fab) {
        fab = navEl('a', { id: 'o-wa-fab', href: href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Falar pelo WhatsApp', title: 'Falar pelo WhatsApp', 'data-origens-fab': '' });
        fab.style.cssText = 'position:fixed;z-index:29;display:flex;align-items:center;justify-content:center;width:' + WA_SIZE + 'px;height:' + WA_SIZE + 'px;border-radius:50%;background:#25d366;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);text-decoration:none;outline-offset:3px';
        fab.innerHTML = NAV_SVG.whatsapp;
        document.body.appendChild(fab);
        if (!this.ac) {
          this.ac = new AbortController();
          const signal = this.ac.signal;
          const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.place(), 60); };
          // Sem observers: só eventos (cliques abrem/fecham Ajuda, carrinho, menu e modal; rolagem/resize movem barras fixas; o teclado virtual muda o viewport).
          window.addEventListener('resize', later, { signal: signal });
          window.addEventListener('scroll', later, { passive: true, signal: signal });
          document.addEventListener('click', later, { capture: true, signal: signal });
          document.addEventListener('keydown', later, { signal: signal });
          if (window.visualViewport) window.visualViewport.addEventListener('resize', later, { signal: signal });
        }
      }
      if (fab.getAttribute('href') !== href) fab.setAttribute('href', href);
      this.place();
    },

    // Acima do Ajuda; escondido quando algo nativo precisa do espaço.
    place() {
      const fab = document.getElementById('o-wa-fab');
      const help = document.querySelector('[data-controller~="ink-store--help-button"]');
      if (!fab || !help) return;
      const rect = help.getBoundingClientRect();
      const panelOpen = waShown('[data-controller~="ink-store--help-button"] [data-ink-store--help-button-target="linksList"]');
      const burger = document.getElementById('menu-hamburger');
      const menuOpen = !!burger && burger.getAttribute('aria-expanded') === 'true';
      const keyboard = !!window.visualViewport && window.visualViewport.height < window.innerHeight - 120;
      // Âncora: o topo do Ajuda; se o aviso de cookies (que na INK cobre o Ajuda no mobile) ocupa aquela coluna, recuamos para ACIMA dele: nunca o cobrimos.
      let anchor = rect.top;
      const banner = document.querySelector('.cookie-acceptance');
      if (banner && banner.getClientRects().length > 0) { const b = banner.getBoundingClientRect(); if (b.left < rect.right && b.right > rect.left && b.top < rect.bottom) anchor = Math.min(anchor, b.top); }
      const bottom = window.innerHeight - anchor + WA_GAP;
      const right = Math.max(0, window.innerWidth - rect.right + (rect.width - WA_SIZE) / 2);
      fab.style.bottom = bottom + 'px';
      fab.style.right = right + 'px';
      const ours = { left: window.innerWidth - right - WA_SIZE, right: window.innerWidth - right, top: window.innerHeight - bottom - WA_SIZE, bottom: window.innerHeight - bottom };
      const header = document.querySelector('header');
      const noRoom = ours.top < (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + 8;
      const covered = ['#add-to-cart-mob'].some((sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0 && waIntersects(ours, el.getBoundingClientRect()); });
      const blocked = panelOpen || menuOpen || keyboard || noRoom || covered || waShown('.cart-drawer.open') || waShown('#modal-wrapper');
      fab.hidden = blocked;
      fab.style.display = blocked ? 'none' : 'flex';
    },

    unmount() {
      clearTimeout(this.timer);
      if (this.ac) { this.ac.abort(); this.ac = null; }
      const fab = document.getElementById('o-wa-fab');
      if (fab) fab.remove();
    }
  });
`;
