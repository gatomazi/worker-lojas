// top-bar: a "Faixa do topo" do CMS na faixa preta do cabeçalho da INK (.header-benefits), nas páginas cobertas pelo Worker (produto e casca).
//   Dados:    /__origens/top-bar (o Worker lê /api/top-bar/<região> do storefront no servidor; contrato v1, texto já preenchido). Uma busca por minuto no
//             máximo (sessionStorage), validada de novo aqui. Erro, timeout, JSON inválido ou nenhuma mensagem no ar => NADA muda: a faixa da INK (as frases
//             nativas e a animação dela) fica exatamente como veio.
//   Faixa:    com mensagem no ar, as frases nativas são escondidas (só CSS, o nó da INK continua lá) e as nossas entram no mesmo lugar, com a mesma cor e
//             altura mínima. Mais de uma = revezam a cada 5 s, na ordem do CMS, paradas sob o ponteiro ou com o foco; com prefers-reduced-motion fica a 1ª.
//             Link opcional = a página do storefront da região (o gateway já devolve a URL absoluta, aqui só se confere a origem).
//   Turbo:    a cada navegação o Turbo troca o <body> (e o cabeçalho com ele). Com dados em cache, a faixa nova é trocada ANTES de ser pintada
//             (turbo:before-render, no corpo novo): sem "piscar" a frase da INK entre uma página e outra.
// Todo texto vem do CMS e entra só por textContent.
export const TOP_BAR = String.raw`
  const BAR_ENDPOINT = '/__origens/top-bar';
  const BAR_CACHE_KEY = 'origens:top-bar:v1';
  const BAR_CACHE_MS = 60 * 1000;
  const BAR_FETCH_MS = 4000;
  const BAR_MAX = 10;
  const BAR_ROTATE_MS = 5000;
  const BAR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const BAR_CONTROL = /[\u0000-\u001f\u007f<>]/;
  const BAR_CSS = [
    '.header-benefits[data-origens-top-bar]{height:auto!important;min-height:30px}',
    '.header-benefits[data-origens-top-bar]>span{display:none!important}',
    '.o-top-bar{display:flex;align-items:center;justify-content:center;width:100%;min-height:30px;padding:4px 12px;text-align:center;font-size:13px;line-height:1.3;color:inherit}',
    '.o-top-bar a{color:inherit;text-decoration:underline;text-underline-offset:2px}',
    '.o-top-bar a:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    '.o-top-bar-in{animation:o-top-bar-in 320ms ease-out}',
    '@keyframes o-top-bar-in{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.o-top-bar-in{animation:none}}'
  ].join('');

  function barText(value) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 1 && text.length <= 120 && !BAR_CONTROL.test(text) ? text : null;
  }
  // Um link do storefront DESTA região (o gateway já montou a URL absoluta): nunca outro host, outra região, query ou fragmento.
  function barHref(value) {
    if (typeof value !== 'string') return null;
    try {
      const u = new URL(value);
      return u.origin === STOREFRONT_ORIGIN && !u.search && !u.hash && isStorefrontPath(u.pathname) && value === STOREFRONT_ORIGIN + u.pathname ? value : null;
    } catch (_) { return null; }
  }
  // O mesmo contrato que o gateway já aplicou; repetido aqui porque o sessionStorage é do visitante. Qualquer desvio => null (a faixa da INK fica).
  function barValidate(data) {
    if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.messages) || data.messages.length > BAR_MAX) return null;
    const messages = []; const ids = new Set(); const now = Date.now();
    for (const raw of data.messages) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !BAR_ID.test(raw.id) || ids.has(raw.id)) return null;
      const text = barText(raw.text);
      if (!text) return null;
      const href = raw.href === undefined ? null : barHref(raw.href);
      if (raw.href !== undefined && !href) return null;
      if (typeof raw.endsAt === 'string' && !(Date.parse(raw.endsAt) > now)) continue; // acabou enquanto estava em cache
      ids.add(raw.id);
      messages.push({ id: raw.id, text: text, href: href });
    }
    return { messages: messages };
  }
  function barReadCache() {
    try {
      const raw = window.sessionStorage.getItem(BAR_CACHE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored || stored.region !== STORE.region || typeof stored.at !== 'number' || Date.now() - stored.at > BAR_CACHE_MS || stored.at > Date.now()) return undefined;
      return stored.data === null ? null : barValidate(stored.data) || undefined;
    } catch (_) { return undefined; }
  }
  function barWriteCache(data) { try { window.sessionStorage.setItem(BAR_CACHE_KEY, JSON.stringify({ at: Date.now(), region: STORE.region, data: data })); } catch (_) { /* sem storage: só não há cache */ } }
  // Uma busca por vida da página (o Turbo mantém o JS entre páginas): a promessa é reaproveitada; uma falha também é lembrada (null) por um minuto.
  let barPending = null; let barPendingAt = 0;
  function barLoad() {
    const cached = barReadCache();
    if (cached !== undefined) return Promise.resolve(cached);
    if (barPending && Date.now() - barPendingAt < BAR_CACHE_MS) return barPending;
    barPendingAt = Date.now();
    barPending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BAR_FETCH_MS);
      try {
        const response = await fetch(BAR_ENDPOINT, { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        const clean = barValidate(data);
        if (!clean) throw new Error('schema');
        barWriteCache(data);
        return clean;
      } catch (_) {
        barWriteCache(null);
        return null;
      } finally { clearTimeout(timer); }
    })();
    return barPending;
  }
  const barReduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const barHost = (root) => root.querySelector('header .header-benefits');

  // Escreve a mensagem da vez dentro da faixa "host" (do documento atual ou do corpo novo do Turbo). Idempotente: mesma mensagem = nada muda.
  function barPaint(host, message) {
    const doc = host.ownerDocument;
    let box = host.querySelector(':scope > .o-top-bar');
    if (!box) {
      if (!doc.getElementById('o-top-bar-css')) { const css = doc.createElement('style'); css.id = 'o-top-bar-css'; css.textContent = BAR_CSS; doc.head.appendChild(css); }
      box = doc.createElement('div');
      box.className = 'o-top-bar';
      box.setAttribute('data-origens-top-bar', '');
      host.appendChild(box);
      host.setAttribute('data-origens-top-bar', '');
    }
    if (box.getAttribute('data-message') === message.id) return;
    box.setAttribute('data-message', message.id);
    const line = doc.createElement(message.href ? 'a' : 'span');
    line.className = 'o-top-bar-in';
    line.textContent = message.text;
    if (message.href) line.setAttribute('href', message.href);
    box.replaceChildren(line);
  }
  function barClear(root) {
    const host = barHost(root);
    if (!host) return;
    const box = host.querySelector(':scope > .o-top-bar');
    if (box) box.remove();
    host.removeAttribute('data-origens-top-bar');
  }

  // Estado do módulo (não do widget): o Turbo desmonta tudo em turbo:before-cache, ANTES de turbo:before-render, e a faixa do corpo novo ainda precisa
  // dos dados e da vez de cada mensagem. O ouvinte abaixo só age quando o DESTINO da visita é uma página onde o loader monta (mesma regra do runtime).
  const barState = { data: null, turn: 0, visit: null };
  const barCurrent = () => barState.data.messages[(barReduced() ? 0 : barState.turn) % barState.data.messages.length];
  document.addEventListener('turbo:visit', (event) => {
    try { barState.visit = new URL(event.detail.url, window.location.href).pathname; } catch (_) { barState.visit = null; }
  });
  document.addEventListener('turbo:before-render', (event) => {
    try {
      const body = event.detail && event.detail.newBody;
      const target = barState.visit || window.location.pathname;
      if (!body || !barState.data || barState.data.messages.length === 0 || (!pathAllowed(target) && !shellPath(target))) return;
      const host = barHost(body);
      if (host) barPaint(host, barCurrent());
    } catch (_) { /* nunca quebra a navegação da INK */ }
  });

  register({
    id: 'top-bar',
    shell: true,
    loading: false,
    paused: false,
    timer: null,
    ac: null,

    mount() {
      if (!pageNow()) return this.unmount();
      if (barState.data) { this.paint(); return; }
      if (this.loading) return;
      this.loading = true;
      barLoad().then((data) => {
        this.loading = false;
        if (!data || data.messages.length === 0 || !pageNow()) return;
        barState.data = data;
        this.paint();
      }).catch(() => { this.loading = false; });
    },

    paint() {
      const host = barHost(document);
      if (!host) return;
      barPaint(host, barCurrent());
      // Ouvintes de pausa só no cabeçalho atual (o Turbo troca o cabeçalho a cada página: um novo ganha os seus).
      if (!this.ac || this.ac.host !== host) {
        if (this.ac) this.ac.abort();
        this.ac = new AbortController();
        this.ac.host = host;
        this.paused = false;
        const signal = this.ac.signal;
        host.addEventListener('mouseenter', () => { this.paused = true; }, { signal: signal });
        host.addEventListener('mouseleave', () => { this.paused = false; }, { signal: signal });
        host.addEventListener('focusin', () => { this.paused = true; }, { signal: signal });
        host.addEventListener('focusout', () => { this.paused = false; }, { signal: signal });
      }
      if (barState.data.messages.length > 1 && !this.timer && !barReduced()) {
        this.timer = setInterval(() => {
          if (this.paused || document.hidden) return;
          barState.turn += 1;
          const now = barHost(document);
          if (now) barPaint(now, barCurrent());
        }, BAR_ROTATE_MS);
      }
    },

    unmount() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.paused = false;
      barClear(document);
    }
  });
`;
