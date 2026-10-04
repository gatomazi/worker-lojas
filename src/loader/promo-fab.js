// promo-fab: o botão de cupons da Use Origens nas páginas da INK cobertas pelo Worker (produto e casca), o MESMO conceito do storefront.
//   Dados:    /__origens/promotions (o Worker lê /api/promotions/<região> do storefront no servidor; contrato v1). Uma busca por minuto no máximo
//             (sessionStorage), validada de novo aqui. Erro, timeout, JSON inválido ou lista vazia => NADA aparece (sem botão, sem espaço, sem nova tentativa
//             em loop). Nada da INK depende disto: navbar, produto, carrinho e checkout seguem idênticos.
//   Botão:    canto inferior ESQUERDO (WhatsApp e Ajuda ficam na direita), ícone de ticket, selo = cupons COPIÁVEIS (9+ acima de nove; avisos sem código
//             não contam; só avisos = sem selo). Cor = a do cabeçalho da região (tema publicado no CMS).
//   Painel:   "Cupons e ofertas"; celular = folha inferior (modal, foco preso, rolagem da página travada); telas maiores = cartão ancorado ao botão.
//             Copiar SÓ copia (Clipboard API e, sem ela, execCommand; sem nenhum, o código fica selecionado). Nunca toca no campo de cupom da INK, nunca envia
//             POST, nunca aplica nem calcula desconto: quem valida e aplica é o carrinho da INK.
//   Espaço:   sobe acima do CTA fixo (#add-to-cart-mob) e do aviso de cookies; some com o carrinho, um modal, o menu, o painel do Ajuda, o teclado virtual, sem
//             espaço sob o cabeçalho ou quando cobriria controles do formulário de compra (variantes, quantidade, Adicionar ao carrinho).
//   Atenção:  uma "mexidinha" curta (2 oscilações, ~560 ms) a cada 6–8 s (decisão do proprietário), sem limite por página e sem ser adiada por rolagem, clique ou
//             digitação; pulada com painel/menu/carrinho/modal abertos, digitando, aba oculta ou botão escondido; nunca com prefers-reduced-motion; e nunca mais na
//             sessão depois de ABRIR o painel.
// Todo texto vem do CMS e entra só por textContent.
export const PROMO_FAB = String.raw`
  const PROMO_ENDPOINT = '/__origens/promotions';
  const PROMO_CACHE_KEY = 'origens:promo:v1';
  const PROMO_QUIET_KEY = 'origens:promo:quiet';
  const PROMO_CACHE_MS = 60 * 1000;
  const PROMO_FETCH_MS = 4000;
  const PROMO_MAX = 20;
  const PROMO_SIZE = 56;
  const PROMO_MARGIN = 16;
  const PROMO_GAP = 8;
  // Igual à aba de WhatsApp: acima do slide ativo do carrossel de imagens (z-index 30) e abaixo de qualquer modal real da INK.
  const PROMO_Z = 31;
  const PROMO_EVERY = [6000, 8000];
  const PROMO_NUDGE_MS = 560;
  const PROMO_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const PROMO_CODE = /^[A-Za-z0-9_-]{2,40}$/;
  const PROMO_HEX = /^#[0-9a-fA-F]{6}$/;
  const PROMO_CONTROL = /[\u0000-\u001f\u007f<>]/;

  function promoText(value, max) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 1 && text.length <= max && !PROMO_CONTROL.test(text) ? text : null;
  }
  // O mesmo contrato que o gateway já aplicou; repetido aqui porque o sessionStorage é do visitante. Qualquer desvio => null (nada aparece).
  function promoValidate(data) {
    if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.items) || data.items.length > PROMO_MAX) return null;
    const items = []; const ids = new Set(); const now = Date.now();
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') return null;
      const type = raw.type === 'coupon' || raw.type === 'promotion' ? raw.type : null;
      const title = promoText(raw.title, 60); const description = promoText(raw.description, 200);
      if (!type || typeof raw.id !== 'string' || !PROMO_ID.test(raw.id) || ids.has(raw.id) || !title || !description) return null;
      if (type === 'coupon' && (typeof raw.code !== 'string' || !PROMO_CODE.test(raw.code))) return null;
      const callout = raw.callout === undefined || raw.callout === null || raw.callout === '' ? null : promoText(raw.callout, 160);
      if (raw.callout && !callout) return null;
      if (typeof raw.endsAt === 'string' && !(Date.parse(raw.endsAt) > now)) continue; // acabou enquanto estava em cache
      ids.add(raw.id);
      items.push({ id: raw.id, type: type, title: title, description: description, code: type === 'coupon' ? raw.code : null, callout: callout, badgeLabel: type === 'coupon' ? promoText(raw.badgeLabel, 24) : null });
    }
    const t = data.theme;
    const theme = t && PROMO_HEX.test(t.primary) && PROMO_HEX.test(t.onPrimary) ? { primary: t.primary, onPrimary: t.onPrimary } : { primary: '#111827', onPrimary: '#ffffff' };
    return { items: items, theme: theme };
  }
  function promoReadCache() {
    try {
      const raw = window.sessionStorage.getItem(PROMO_CACHE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored || stored.region !== STORE.region || typeof stored.at !== 'number' || Date.now() - stored.at > PROMO_CACHE_MS || stored.at > Date.now()) return undefined;
      return stored.data === null ? null : promoValidate(stored.data) || undefined;
    } catch (_) { return undefined; }
  }
  function promoWriteCache(data) { try { window.sessionStorage.setItem(PROMO_CACHE_KEY, JSON.stringify({ at: Date.now(), region: STORE.region, data: data })); } catch (_) { /* sem storage: só não há cache */ } }
  // Uma busca por vida da página (o Turbo mantém o JS entre páginas): a promessa é reaproveitada; uma falha também é lembrada (null) por um minuto.
  let promoPending = null; let promoPendingAt = 0;
  function promoLoad() {
    const cached = promoReadCache();
    if (cached !== undefined) return Promise.resolve(cached);
    if (promoPending && Date.now() - promoPendingAt < PROMO_CACHE_MS) return promoPending;
    promoPendingAt = Date.now();
    promoPending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROMO_FETCH_MS);
      try {
        const response = await fetch(PROMO_ENDPOINT, { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        const clean = promoValidate(data);
        if (!clean) throw new Error('schema');
        promoWriteCache(data);
        return clean;
      } catch (_) {
        promoWriteCache(null);
        return null;
      } finally { clearTimeout(timer); }
    })();
    return promoPending;
  }

  const promoQuiet = () => { try { return window.sessionStorage.getItem(PROMO_QUIET_KEY) === '1'; } catch (_) { return false; } };
  const promoSetQuiet = () => { try { window.sessionStorage.setItem(PROMO_QUIET_KEY, '1'); } catch (_) { /* idem */ } };
  const promoReduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const promoShown = (selector) => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0; };
  const promoHits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const promoTyping = (el) => !!el && el.closest && !el.closest('#o-promo') && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image|hidden)$/i.test(el.type || '')));
  const promoSheet = () => document.documentElement.clientWidth < 640;
  // Base REAL dos elementos fixos. Uma página mais larga que a tela (a própria INK passa de 390 px no celular) faz o navegador reduzir o zoom: os fixos
  // passam a ser medidos contra um viewport de layout MAIS ALTO que clientHeight. Medimos uma sonda fixa em bottom:0 (sem tamanho, invisível); sem
  // medida (ambiente sem layout), clientHeight.
  function promoViewportBottom() {
    const probe = document.querySelector('#o-promo .o-promo-probe');
    const top = probe ? probe.getBoundingClientRect().top : 0;
    return top > 0 ? top : document.documentElement.clientHeight;
  }

  // Medição: só com o gtag da PRÓPRIA INK para a propriedade da região na página e com o aviso de cookies da INK aceito (a mesma regra de tracking.js).
  function promoTrack(name, promoId) {
    try {
      if (typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + STORE.ga + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      const params = { send_to: STORE.ga, region: STORE.region, surface: 'ink', transport_type: 'beacon' };
      if (promoId) params.promo_id = promoId;
      window.gtag('event', name, params);
    } catch (_) { /* medir nunca quebra a INK */ }
  }

  async function promoCopy(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* tenta o plano B */ }
    try {
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
      const active = document.activeElement;
      document.body.appendChild(area); area.select(); area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      if (active && active.focus) active.focus({ preventScroll: true });
      return !!ok;
    } catch (_) { return false; }
  }

  const PROMO_TICKET = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5a2.5 2.5 0 0 0 0-5Z"/><path d="M14.5 5v2M14.5 11v2M14.5 17v2"/></svg>';
  const PROMO_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const PROMO_CSS = [
    '#o-promo{--o-promo-bg:#111827;--o-promo-fg:#fff;font-family:inherit;color:#111827}',
    '#o-promo *{box-sizing:border-box}',
    '#o-promo .o-promo-fab{position:fixed;z-index:' + PROMO_Z + ';display:flex;align-items:center;justify-content:center;width:' + PROMO_SIZE + 'px;height:' + PROMO_SIZE + 'px;padding:0;margin:0;border:0;border-radius:12px;background:var(--o-promo-bg);color:var(--o-promo-fg);box-shadow:0 6px 18px rgba(0,0,0,.24);cursor:pointer;outline-offset:4px;-webkit-tap-highlight-color:transparent}',
    '#o-promo .o-promo-fab[hidden]{display:none}',
    '#o-promo .o-promo-badge{position:absolute;top:-6px;right:-6px;display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 4px;border-radius:999px;border:2px solid var(--o-promo-bg);background:#fff;color:#000;font-size:12px;font-weight:800;line-height:1}',
    '@keyframes o-promo-wiggle{0%,100%{transform:rotate(0)}18%{transform:rotate(-9deg)}40%{transform:rotate(7deg)}62%{transform:rotate(-4deg)}82%{transform:rotate(2deg)}}',
    '#o-promo .o-promo-wiggle{animation:o-promo-wiggle ' + PROMO_NUDGE_MS + 'ms cubic-bezier(.36,.07,.19,.97) both;transform-origin:50% 60%}',
    '@media (prefers-reduced-motion: reduce){#o-promo .o-promo-wiggle{animation:none!important}}',
    '#o-promo .o-promo-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45)}',
    '#o-promo .o-promo-panel{position:fixed;z-index:2147483001;display:flex;flex-direction:column;background:#f2f2f0;color:#111827;box-shadow:0 18px 40px rgba(0,0,0,.28);text-align:left;font-size:15px;line-height:1.35}',
    '#o-promo .o-promo-panel.is-sheet{left:0;right:0;bottom:0;max-height:min(82vh,640px);border-top:2px solid #111827;padding-bottom:env(safe-area-inset-bottom,0px)}',
    '#o-promo .o-promo-panel.is-pop{width:360px;max-width:calc(100vw - 32px);max-height:min(70vh,544px);border:2px solid #111827}',
    '#o-promo .o-promo-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 4px 16px;border-bottom:2px solid #111827}',
    '#o-promo .o-promo-head h2{margin:0;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.01em;line-height:1;color:#111827}',
    '#o-promo .o-promo-x{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;background:transparent;color:#111827;cursor:pointer}',
    '#o-promo .o-promo-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px}',
    '#o-promo .o-promo-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}',
    '#o-promo .o-promo-coupon{border:2px solid #111827;background:#fff;padding:16px}',
    '#o-promo .o-promo-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
    '#o-promo .o-promo-coupon h3{margin:0;font-size:21px;font-weight:800;text-transform:uppercase;line-height:.98;letter-spacing:.01em;overflow-wrap:anywhere;color:#111827}',
    '#o-promo .o-promo-tag{flex-shrink:0;margin-top:2px;padding:2px 6px;background:var(--o-promo-bg);color:var(--o-promo-fg);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;line-height:1.2}',
    '#o-promo .o-promo-code{display:flex;margin-top:12px}',
    '#o-promo .o-promo-code span{flex:1;min-width:0;display:flex;align-items:center;min-height:44px;padding:0 12px;border:2px dashed #111827;border-right:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:700;letter-spacing:.08em;overflow-wrap:anywhere;-webkit-user-select:all;user-select:all}',
    '#o-promo .o-promo-copy{flex-shrink:0;min-height:44px;padding:0 16px;border:2px solid #111827;background:#111827;color:#fff;font:inherit;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}',
    '#o-promo .o-promo-copy:hover{background:#fff;color:#111827}',
    '#o-promo .o-promo-desc{margin:12px 0 0;font-size:15px;line-height:1.35}',
    '#o-promo .o-promo-callout{margin:6px 0 0;font-size:13px;line-height:1.35;color:#56564f}',
    '#o-promo .o-promo-fail{margin:8px 0 0;font-size:13px;font-weight:600}',
    '#o-promo .o-promo-notice{border-left:4px solid var(--o-promo-bg);background:rgba(0,0,0,.045);padding:14px 16px}',
    '#o-promo .o-promo-notice h3{margin:0;font-size:17px;font-weight:800;line-height:1.2;overflow-wrap:anywhere;color:#111827}',
    '#o-promo .o-promo-notice .o-promo-desc{margin-top:4px}',
    '#o-promo .o-promo-probe{position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none}',
    '#o-promo .o-promo-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}'
  ].join('');

  function promoEl(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  register({
    id: 'promo-fab',
    shell: true,
    ac: null,
    data: null,
    loading: false,
    timer: null,
    nudgeTimer: null,
    quiet: false,
    open: false,
    copyTimer: null,

    mount() {
      if (!pageNow()) return this.unmount();
      if (document.getElementById('o-promo')) { this.place(); return; }
      if (this.loading) return;
      this.loading = true;
      promoLoad().then((data) => {
        this.loading = false;
        if (!data || data.items.length === 0 || !pageNow() || document.getElementById('o-promo')) return;
        this.data = data;
        this.build();
      }).catch(() => { this.loading = false; });
    },

    build() {
      const data = this.data;
      const coupons = data.items.filter((i) => i.type === 'coupon').length;
      const root = promoEl('div', { id: 'o-promo', 'data-origens-promo': '' });
      root.style.setProperty('--o-promo-bg', data.theme.primary);
      root.style.setProperty('--o-promo-fg', data.theme.onPrimary);
      root.appendChild(promoEl('style', null, PROMO_CSS));
      root.appendChild(promoEl('span', { class: 'o-promo-probe', 'aria-hidden': 'true' }));
      const fab = promoEl('button', { type: 'button', class: 'o-promo-fab', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'o-promo-panel', title: 'Cupons e ofertas',
        'aria-label': coupons > 0 ? 'Cupons e ofertas: ' + coupons + (coupons === 1 ? ' cupom disponível' : ' cupons disponíveis') : 'Cupons e ofertas' });
      fab.innerHTML = PROMO_TICKET;
      if (coupons > 0) fab.appendChild(promoEl('span', { class: 'o-promo-badge', 'aria-hidden': 'true' }, coupons > 9 ? '9+' : String(coupons)));
      root.appendChild(fab);
      root.appendChild(promoEl('p', { class: 'o-promo-sr', 'aria-live': 'polite', 'data-promo-live': '' }));
      document.body.appendChild(root);

      this.ac = new AbortController();
      const signal = this.ac.signal;
      const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.place(), 60); };
      // Sem observers (iguais às abas de WhatsApp/Ajuda): cliques abrem/fecham carrinho, menu e modais; rolagem/resize movem barras fixas; o teclado muda o viewport.
      window.addEventListener('resize', later, { signal: signal });
      window.addEventListener('scroll', later, { passive: true, signal: signal });
      document.addEventListener('click', later, { capture: true, signal: signal });
      document.addEventListener('keydown', later, { signal: signal });
      document.addEventListener('focusin', later, { signal: signal });
      document.addEventListener('focusout', later, { signal: signal });
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', later, { signal: signal }); window.visualViewport.addEventListener('scroll', later, { signal: signal }); }
      fab.addEventListener('click', () => (this.open ? this.close(true) : this.show()), { signal: signal });
      this.place();
      if (!promoQuiet() && !promoReduced()) this.scheduleNudge();
    },

    // Abaixo à esquerda; recua acima do CTA fixo e do aviso de cookies; some quando a página precisa do espaço ou da atenção.
    place() {
      const root = document.getElementById('o-promo');
      if (!root) return;
      const fab = root.querySelector('.o-promo-fab');
      const vh = promoViewportBottom();
      // A parte VISÍVEL da página (viewport visual). Numa página mais larga que a tela SEM zoom reduzido (INK a 320 px: 358 de layout), o viewport de layout
      // passa da tela e um fixo em bottom/left do layout cairia fora da vista: ancoramos no que o visitante vê.
      const vv = window.visualViewport;
      const visibleBottom = vv && vv.height > 0 ? Math.min(vh, (vv.offsetTop || 0) + vv.height) : vh;
      const left = PROMO_MARGIN + (vv && vv.offsetLeft > 0 ? vv.offsetLeft : 0);
      let bottom = PROMO_MARGIN + Math.max(0, vh - visibleBottom);
      for (const selector of ['#add-to-cart-mob', '.cookie-acceptance']) {
        const el = document.querySelector(selector);
        if (!el || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.left < left + PROMO_SIZE && r.right > left && r.bottom > vh - bottom - PROMO_SIZE && r.top < visibleBottom) bottom = Math.max(bottom, vh - r.top + PROMO_GAP);
      }
      fab.style.left = 'max(' + left + 'px, calc(' + (left - PROMO_MARGIN) + 'px + env(safe-area-inset-left, 0px)))';
      fab.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
      const ours = { left: left, right: left + PROMO_SIZE, top: vh - bottom - PROMO_SIZE, bottom: vh - bottom };
      const header = document.querySelector('header');
      const noRoom = ours.top < (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + PROMO_GAP;
      const burger = document.getElementById('menu-hamburger');
      const menuOpen = !!burger && burger.getAttribute('aria-expanded') === 'true';
      // Teclado virtual: só existe com um campo de texto focado. O viewport visual sozinho engana (página mais larga que a tela => zoom reduzido => ele já é
      // bem menor que innerHeight sem teclado nenhum).
      const keyboard = promoTyping(document.activeElement) && !!window.visualViewport && window.visualViewport.height < window.innerHeight - 120;
      const typing = promoTyping(document.activeElement) && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      const helpOpen = promoShown('[data-controller~="ink-store--help-button"] [data-ink-store--help-button-target="linksList"]');
      // Controles essenciais da compra que estariam debaixo do botão (variantes, quantidade, Adicionar ao carrinho em fluxo). Links simples não contam.
      let covers = false;
      for (const form of document.querySelectorAll('form[id^="form-product-"]')) {
        for (const control of form.querySelectorAll('button, label, select, input:not([type="hidden"])')) {
          if (control.getClientRects().length > 0 && promoHits(ours, control.getBoundingClientRect())) { covers = true; break; }
        }
        if (covers) break;
      }
      const overlay = promoShown('.cart-drawer.open') || promoShown('#modal-wrapper') || menuOpen || helpOpen;
      const blocked = overlay || keyboard || typing || noRoom || covers;
      // Diagnóstico (QA e suporte): por que o botão está fora do caminho agora.
      root.setAttribute('data-promo-hidden', blocked ? [overlay && 'overlay', keyboard && 'keyboard', typing && 'typing', noRoom && 'no-room', covers && 'purchase-controls'].filter(Boolean).join(' ') : '');
      this.hidden = blocked;
      fab.hidden = blocked && !this.open;
      this.overlay = overlay;
      if (this.open && (overlay || keyboard)) this.close(false);
      if (this.open) this.placePanel();
    },

    placePanel() {
      const panel = document.getElementById('o-promo-panel');
      const fab = document.querySelector('#o-promo .o-promo-fab');
      if (!panel || !fab) return;
      const sheet = promoSheet();
      panel.classList.toggle('is-sheet', sheet);
      panel.classList.toggle('is-pop', !sheet);
      const backdrop = document.querySelector('#o-promo .o-promo-backdrop');
      if (backdrop) backdrop.hidden = !sheet;
      if (sheet) {
        // A folha cobre só a parte VISÍVEL (mesma razão do botão: o viewport de layout pode passar da tela).
        const vv = window.visualViewport;
        const vh = promoViewportBottom();
        const visibleBottom = vv && vv.height > 0 ? Math.min(vh, (vv.offsetTop || 0) + vv.height) : vh;
        panel.style.left = (vv && vv.offsetLeft > 0 ? vv.offsetLeft : 0) + 'px';
        panel.style.right = 'auto';
        panel.style.width = (vv && vv.width > 0 ? vv.width : document.documentElement.clientWidth) + 'px';
        panel.style.bottom = Math.max(0, vh - visibleBottom) + 'px';
        return;
      }
      panel.style.right = ''; panel.style.width = '';
      const r = fab.getBoundingClientRect();
      panel.style.left = Math.max(PROMO_MARGIN, r.left) + 'px';
      panel.style.bottom = (promoViewportBottom() - r.top + PROMO_GAP) + 'px';
    },

    show() {
      const root = document.getElementById('o-promo');
      if (!root || this.open) return;
      this.open = true;
      promoSetQuiet();
      this.stopNudges();
      const signal = this.ac.signal;
      const panelAc = new AbortController();
      this.panelAc = panelAc;
      const backdrop = promoEl('div', { class: 'o-promo-backdrop', 'aria-hidden': 'true' });
      backdrop.addEventListener('click', () => this.close(false), { signal: panelAc.signal });
      const panel = promoEl('div', { id: 'o-promo-panel', class: 'o-promo-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'o-promo-title' });
      const head = promoEl('div', { class: 'o-promo-head' });
      head.appendChild(promoEl('h2', { id: 'o-promo-title' }, 'Cupons e ofertas'));
      const x = promoEl('button', { type: 'button', class: 'o-promo-x', 'aria-label': 'Fechar cupons e ofertas', 'data-promo-close': '' });
      x.innerHTML = PROMO_CLOSE;
      x.addEventListener('click', () => this.close(true), { signal: panelAc.signal });
      head.appendChild(x);
      const body = promoEl('div', { class: 'o-promo-body' });
      const list = promoEl('ul', { class: 'o-promo-list' });
      for (const item of this.data.items) list.appendChild(item.type === 'coupon' ? this.coupon(item, panelAc.signal) : this.notice(item));
      body.appendChild(list);
      panel.appendChild(head); panel.appendChild(body);
      root.insertBefore(backdrop, root.querySelector('.o-promo-fab'));
      root.insertBefore(panel, root.querySelector('.o-promo-fab'));
      const fab = root.querySelector('.o-promo-fab');
      fab.setAttribute('aria-expanded', 'true');
      fab.hidden = false;
      this.placePanel();
      // Celular: a página por trás da folha não rola enquanto ela está aberta.
      if (promoSheet()) { this.lock = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; this.locked = true; }
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); this.close(true); return; }
        if (event.key === 'Tab' && promoSheet()) {
          const focusable = Array.from(panel.querySelectorAll('button')).filter((el) => el.getClientRects().length > 0);
          if (!focusable.length) return;
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }, { signal: panelAc.signal });
      document.addEventListener('pointerdown', (event) => { const t = event.target; if (t && !panel.contains(t) && !fab.contains(t) && t !== backdrop) this.close(false); }, { capture: true, signal: panelAc.signal });
      void signal;
      x.focus({ preventScroll: true });
      promoTrack('promo_fab_open');
    },

    coupon(item, signal) {
      const li = promoEl('li', { class: 'o-promo-coupon', 'data-promo-id': item.id, 'data-promo-type': 'coupon' });
      const row = promoEl('div', { class: 'o-promo-row' });
      row.appendChild(promoEl('h3', null, item.title));
      if (item.badgeLabel) row.appendChild(promoEl('span', { class: 'o-promo-tag' }, item.badgeLabel));
      li.appendChild(row);
      const codeRow = promoEl('div', { class: 'o-promo-code' });
      const code = promoEl('span', { id: 'o-promo-code-' + item.id }, item.code);
      const button = promoEl('button', { type: 'button', class: 'o-promo-copy', 'aria-describedby': 'o-promo-code-' + item.id }, 'Copiar');
      button.addEventListener('click', () => this.copy(item, button, code, li), { signal: signal });
      codeRow.appendChild(code); codeRow.appendChild(button);
      li.appendChild(codeRow);
      li.appendChild(promoEl('p', { class: 'o-promo-desc' }, item.description));
      if (item.callout) li.appendChild(promoEl('p', { class: 'o-promo-callout' }, item.callout));
      return li;
    },

    notice(item) {
      const li = promoEl('li', { class: 'o-promo-notice', 'data-promo-id': item.id, 'data-promo-type': 'promotion' });
      li.appendChild(promoEl('h3', null, item.title));
      li.appendChild(promoEl('p', { class: 'o-promo-desc' }, item.description));
      if (item.callout) li.appendChild(promoEl('p', { class: 'o-promo-callout' }, item.callout));
      return li;
    },

    async copy(item, button, code, li) {
      const ok = await promoCopy(item.code);
      const live = document.querySelector('#o-promo [data-promo-live]');
      for (const other of document.querySelectorAll('#o-promo .o-promo-copy')) other.textContent = 'Copiar';
      for (const fail of document.querySelectorAll('#o-promo .o-promo-fail')) fail.remove();
      clearTimeout(this.copyTimer);
      if (ok) {
        button.textContent = 'Copiado';
        if (live) live.textContent = 'Código ' + item.code + ' copiado.';
        promoTrack('promo_coupon_copy', item.id);
        this.copyTimer = setTimeout(() => { button.textContent = 'Copiar'; }, 2000);
      } else {
        try { const range = document.createRange(); range.selectNodeContents(code); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch (_) { /* o código segue na tela */ }
        const fail = promoEl('p', { class: 'o-promo-fail', role: 'status' }, 'Não deu para copiar automaticamente: o código está selecionado, copie com o menu do aparelho.');
        code.parentElement.insertAdjacentElement('afterend', fail);
        this.copyTimer = setTimeout(() => fail.remove(), 6000);
      }
    },

    close(refocus) {
      if (!this.open) return;
      this.open = false;
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      for (const sel of ['#o-promo-panel', '#o-promo .o-promo-backdrop']) { const el = document.querySelector(sel); if (el) el.remove(); }
      if (this.locked) { document.documentElement.style.overflow = this.lock || ''; this.locked = false; }
      const fab = document.querySelector('#o-promo .o-promo-fab');
      if (fab) { fab.setAttribute('aria-expanded', 'false'); if (refocus) fab.focus({ preventScroll: true }); }
      promoTrack('promo_panel_close');
      this.place();
    },

    scheduleNudge() {
      clearTimeout(this.nudgeTimer); this.nudgeTimer = null;
      if (this.quiet || promoQuiet()) return;
      this.nudgeTimer = setTimeout(() => this.nudge(), Math.round(PROMO_EVERY[0] + Math.random() * (PROMO_EVERY[1] - PROMO_EVERY[0])));
    },
    stopNudges() { clearTimeout(this.nudgeTimer); this.nudgeTimer = null; this.quiet = true; },

    nudge() {
      this.nudgeTimer = null;
      const fab = document.querySelector('#o-promo .o-promo-fab');
      if (!fab || promoQuiet() || promoReduced()) return;
      const calm = !this.open && !this.hidden && !fab.hidden && fab.getClientRects().length > 0 && document.visibilityState === 'visible' && !promoTyping(document.activeElement) && !this.overlay;
      if (calm) {
        fab.classList.remove('o-promo-wiggle'); void fab.offsetWidth; fab.classList.add('o-promo-wiggle');
        setTimeout(() => fab.classList.remove('o-promo-wiggle'), PROMO_NUDGE_MS + 40);
      }
      this.scheduleNudge();
    },

    unmount() {
      clearTimeout(this.timer); clearTimeout(this.nudgeTimer); clearTimeout(this.copyTimer);
      this.nudgeTimer = null; this.quiet = false;
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      if (this.locked) { document.documentElement.style.overflow = this.lock || ''; this.locked = false; }
      this.open = false; this.data = null;
      const root = document.getElementById('o-promo');
      if (root) root.remove();
    }
  });
`;
