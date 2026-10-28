// product-wait: a pílula da compra direta do storefront ("Criando camiseta…" / "Camiseta pronta!") nas páginas da INK cobertas pelo Worker (produto e casca).
//   Origem:   o storefront grava os ids dos trabalhos no cookie uo_produtos do domínio compartilhado (.useorigens.com.br, sem HttpOnly; até 6 ids ULID
//             separados por "."). Sem cookie, fora do domínio compartilhado ou sem nenhum id no formato => NADA nosso aparece. O cookie é a verdade
//             compartilhada de QUAIS camisetas a pessoa ainda acompanha: tirar uma daqui (abrir ou "Tirar da lista") tira também do storefront, e vice-versa.
//   Dados:    GET /__origens/produto/<id> (o Worker lê /api/personalizar/produto/<id> do storefront no servidor; contrato revalidado aqui). A cada 5 s, só
//             com a aba visível e só para as que ainda estão sendo feitas; pronta, sem conserto ou tirada da lista = para. 404 (id desconhecido, ou o
//             limite por visitante do storefront, que lá também é 404) e 503 = espera mais antes de perguntar de novo (15 s, 30 s, depois 60 s); um id NUNCA
//             sai do cookie por erro, só pelos dois toques da pessoa. A pílula só aparece quando ao menos uma camiseta respondeu (cookie velho = nada).
//   Pílula:   centro de baixo, entre o botão de cupons (esquerda) e o assistente (direita), largura limitada para não encostar neles no celular. Sobe
//             acima do CTA fixo do celular (#add-to-cart-mob e a barra dele) e do aviso de cookies, como eles; some com o carrinho, um modal, o menu, o
//             painel do assistente ou dos cupons, o teclado virtual, sem espaço sob o cabeçalho ou quando cobriria controles do formulário de compra.
//             Fazendo: borda de tinta, setas girando em volta de uma camiseta menor e um ponto amarelo pulsando. Pronta: cheia na cor da região, pulsando e com uma "mexidinha" a cada 2,8 s (a mesma
//             do storefront, em `rotate` para não brigar com o translate do centro). Com prefers-reduced-motion, nada se move.
//   Painel:   "Sua camiseta": por camiseta, o rótulo, os quatro passos com o atual marcado, a foto e "Ver minha camiseta" quando pronta, o aviso quando
//             não deu, e sempre "Tirar da lista". Não é modal: Esc, "Fechar" ou um toque fora fecham.
// Todo texto vem do storefront e entra só por textContent; link só a página de produto DESTA loja na INK, foto só do CDN da INK.
export const PRODUCT_WAIT = String.raw`
  const WAIT_ENDPOINT = '/__origens/produto/';
  const WAIT_COOKIE = 'uo_produtos';
  const WAIT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
  const WAIT_MAX = 6;
  const WAIT_POLL_MS = 5000;
  const WAIT_FETCH_MS = 4500;
  const WAIT_RETRY_MS = [15000, 30000, 60000];
  const WAIT_STATUSES = ['queued', 'creating', 'photos', 'ready', 'failed', 'check'];
  // Sem mais trabalho no storefront: pronta (com ou sem link), falhou ou "conferir" (a equipe assume).
  const WAIT_DONE = ['ready', 'failed', 'check'];
  // O passo atual de cada estado (0 a 3); 4 = os quatro feitos.
  const WAIT_STEP = { queued: 0, creating: 1, photos: 2, ready: 4 };
  const WAIT_STEPS = ['Arte com o nome', 'Camiseta criada na loja', 'Tirando as fotos', 'Abrindo a sua camiseta'];
  const WAIT_IMAGE_HOST = 'gcp-images.majestic.ink.rsvcloud.com';
  const WAIT_LINE = /[\u0000-\u001f\u007f<>]/;
  const WAIT_MARGIN = 16;
  const WAIT_GAP = 8;
  const WAIT_HEIGHT = 48;
  // Espaço reservado de cada lado no celular: o botão de cupons (16 + 56) e o assistente (16 + 48) com folga. O mesmo calc(100vw - 11rem) do storefront.
  const WAIT_SIDE = 88;
  // O mesmo z-index do botão de cupons e do assistente; o painel fica acima de tudo, como os painéis deles.
  const WAIT_Z = 31;
  const WAIT_PANEL_Z = 2147483001;
  // O domínio do cookie compartilhado: o do storefront, sem www (useorigens.com.br). A INK da loja única fica num subdomínio dele.
  const WAIT_DOMAIN = (() => { try { return new URL(STOREFRONT_ORIGIN).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
  const WAIT_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  const waitShared = () => !!WAIT_DOMAIN && (window.location.hostname === WAIT_DOMAIN || window.location.hostname.endsWith('.' + WAIT_DOMAIN));

  // Os ids do cookie compartilhado (no formato, sem repetição, até 6). Fora do domínio compartilhado = nenhum.
  function waitIds() {
    if (!waitShared()) return [];
    let raw = '';
    try {
      for (const part of String(document.cookie || '').split(/;\s*/)) { if (part.indexOf(WAIT_COOKIE + '=') === 0) { raw = part.slice(WAIT_COOKIE.length + 1); break; } }
    } catch (_) { return []; }
    const out = [];
    for (const id of raw.split('.')) if (WAIT_ID.test(id) && out.indexOf(id) < 0 && out.length < WAIT_MAX) out.push(id);
    return out;
  }
  // Regrava o cookie com os MESMOS atributos do storefront; vazio = apagado (Max-Age=0). O storefront lê o mesmo cookie.
  function waitWrite(ids) {
    if (!waitShared()) return;
    const value = ids.filter((id) => WAIT_ID.test(id)).slice(0, WAIT_MAX).join('.');
    try { document.cookie = WAIT_COOKIE + '=' + value + '; Domain=.' + WAIT_DOMAIN + '; Path=/; Max-Age=' + (value ? 86400 : 0) + '; SameSite=Lax; Secure'; } catch (_) { /* cookie bloqueado: só esta página esquece */ }
  }
  function waitHref(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === STORE.inkHost && !u.search && !u.hash && CATALOG_PRODUCT_PATH.test(u.pathname) ? 'https://' + STORE.inkHost + u.pathname : null;
    } catch (_) { return null; }
  }
  function waitImage(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === WAIT_IMAGE_HOST ? u.href : null; } catch (_) { return null; }
  }
  // O mesmo contrato que o gateway já aplicou, repetido aqui. Um link ou foto fora do formato some (a camiseta pronta sem link mostra o aviso).
  function waitJob(data, id) {
    if (!data || typeof data !== 'object' || data.id !== id || WAIT_STATUSES.indexOf(data.status) < 0) return null;
    const label = typeof data.label === 'string' ? data.label.replace(/\s+/g, ' ').trim() : '';
    if (!label || label.length > 90 || WAIT_LINE.test(label)) return null;
    const ready = data.status === 'ready';
    return { id: id, label: label, status: data.status, url: ready ? waitHref(data.url) : null, image: ready ? waitImage(data.image) : null };
  }

  // Estado da página inteira (o Turbo mantém o JS entre páginas): a pílula volta na hora depois de cada navegação, sem esperar a próxima consulta.
  const waitJobs = new Map();
  const waitLast = new Map();
  const waitTries = new Map();
  const waitBusy = new Set();
  const waitFinished = (job) => !!job && WAIT_DONE.indexOf(job.status) >= 0;
  function waitForget(id) {
    waitWrite(waitIds().filter((x) => x !== id));
    waitJobs.delete(id); waitLast.delete(id); waitTries.delete(id);
  }
  async function waitFetch(id) {
    waitBusy.add(id);
    waitLast.set(id, Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAIT_FETCH_MS);
    try {
      const response = await fetch(WAIT_ENDPOINT + id, { credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
      const job = response.ok ? waitJob(await response.json(), id) : null;
      if (!job) throw new Error('status ' + response.status);
      waitJobs.set(id, job);
      waitTries.delete(id);
    } catch (_) {
      // A última resposta boa continua valendo; só a próxima pergunta espera mais.
      const fails = ((waitTries.get(id) || {}).fails || 0) + 1;
      waitTries.set(id, { fails: fails, next: Date.now() + WAIT_RETRY_MS[Math.min(fails, WAIT_RETRY_MS.length) - 1] });
    } finally {
      clearTimeout(timer);
      waitBusy.delete(id);
    }
  }

  const waitShown = (selector) => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0; };
  const waitHits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const waitTyping = (el) => !!el && el.closest && !el.closest('#o-wait') && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image|hidden)$/i.test(el.type || '')));
  const waitPhone = () => document.documentElement.clientWidth < 640;
  // Base REAL dos elementos fixos (a mesma sonda do botão de cupons e do assistente): numa página mais larga que a tela, clientHeight engana.
  function waitViewportBottom() {
    const probe = document.querySelector('#o-wait .o-wait-probe');
    const top = probe ? probe.getBoundingClientRect().top : 0;
    return top > 0 ? top : document.documentElement.clientHeight;
  }
  // O texto da pílula (o mesmo do storefront).
  function waitLabel(jobs) {
    const ready = jobs.filter((j) => j.status === 'ready' && j.url).length;
    if (ready) return ready > 1 ? ready + ' camisetas prontas!' : 'Camiseta pronta!';
    return jobs.some((j) => !waitFinished(j)) ? 'Criando camiseta…' : 'Sua camiseta';
  }

  // Camiseta (a mesma do storefront); fazendo, as duas setas girando em volta dela, menor (o WorkingIcon do storefront); visto e estrela do passo atual.
  const WAIT_SHIRT_PATH = 'M8 3.5 4 5.5 2.5 10l3 1.2V20.5h13V11.2l3-1.2L20 5.5l-4-2c-.6 1.5-2.1 2.5-4 2.5S8.6 5 8 3.5Z';
  const WAIT_SHIRT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + WAIT_SHIRT_PATH + '"/></svg>';
  const WAIT_WORKING = '<svg class="o-wait-arrows" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>' +
    '<svg class="o-wait-shirt-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + WAIT_SHIRT_PATH + '"/></svg>';
  const WAIT_CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 10.5l4 4 8-9"/></svg>';
  const WAIT_STAR = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6L1.3 7.8l6.1-.7z"/></svg>';
  const WAIT_CSS = [
    '#o-wait{font-family:inherit;color:#111827}',
    '#o-wait *{box-sizing:border-box}',
    // O centro é um translate; a mexidinha é a propriedade rotate (as duas convivem).
    '#o-wait .o-wait-pill{position:fixed;z-index:' + WAIT_Z + ';display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:' + WAIT_HEIGHT + 'px;margin:0;padding:0 12px;border:2px solid #111827;border-radius:0;background:#f2f2f0;color:#111827;font:inherit;font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer;transform:translateX(-50%);outline-offset:4px;-webkit-tap-highlight-color:transparent}',
    '#o-wait .o-wait-pill[hidden]{display:none}',
    '#o-wait .o-wait-pill svg{width:20px;height:20px;flex-shrink:0}',
    '#o-wait .o-wait-icon{display:inline-flex;flex-shrink:0}',
    // Fazendo: uma caixa de 28px com as setas (28px, por cima) e a camiseta de 14px no centro.
    '#o-wait .o-wait-pill .o-wait-working{position:relative;align-items:center;justify-content:center;width:28px;height:28px}',
    '#o-wait .o-wait-pill .o-wait-arrows{position:absolute;inset:0;width:28px;height:28px}',
    '#o-wait .o-wait-pill .o-wait-shirt-sm{width:14px;height:14px}',
    '#o-wait .o-wait-pill [data-wait-label]{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '#o-wait .o-wait-dot{display:block;width:8px;height:8px;flex-shrink:0;border-radius:999px;background:#d8a800}',
    '#o-wait .o-wait-dot[hidden]{display:none}',
    '#o-wait .o-wait-pill.is-ready{border-color:' + WAIT_TINT + ';background:' + WAIT_TINT + ';color:#fff}',
    '@keyframes o-wait-pulse{50%{opacity:.5}}',
    '@keyframes uo-nudge{0%,70%,100%{rotate:0deg}74%{rotate:-5deg}78%{rotate:5deg}82%{rotate:-3deg}86%{rotate:3deg}90%{rotate:0deg}}',
    '@keyframes uo-glow{50%{opacity:.82}}',
    '@keyframes o-wait-spin{to{transform:rotate(360deg)}}',
    // Só com movimento liberado: o ponto e a estrela pulsam, as setas giram; a pronta pulsa e mexe. Com movimento reduzido, tudo parado.
    '@media (prefers-reduced-motion: no-preference){#o-wait .o-wait-dot,#o-wait .o-wait-star{animation:o-wait-pulse 2s cubic-bezier(.4,0,.6,1) infinite}#o-wait .o-wait-pill .o-wait-arrows{animation:o-wait-spin 1.6s linear infinite}#o-wait .o-wait-pill.o-wait-nudge{animation:uo-nudge 2.8s ease-in-out infinite,uo-glow 1.4s ease-in-out infinite}}',
    '#o-wait a:focus-visible,#o-wait button:focus-visible{outline:2px solid ' + WAIT_TINT + ';outline-offset:2px}',
    '#o-wait .o-wait-pill.is-ready:focus-visible{outline-color:#111827}',
    '#o-wait .o-wait-panel{position:fixed;z-index:' + WAIT_PANEL_Z + ';overflow-y:auto;overscroll-behavior:contain;padding:16px;border:2px solid #111827;background:#f2f2f0;color:#111827;box-shadow:0 18px 40px rgba(0,0,0,.28);text-align:left;font-size:15px;line-height:1.35}',
    '#o-wait .o-wait-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '#o-wait .o-wait-head h2{margin:0;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.01em;line-height:1.1;color:#111827}',
    '#o-wait .o-wait-close{min-height:44px;margin:0;padding:0 8px;border:0;background:transparent;color:#111827;font:inherit;font-size:15px;font-weight:700;text-decoration:underline;text-underline-offset:4px;cursor:pointer}',
    '#o-wait .o-wait-list{list-style:none;margin:8px 0 0;padding:0}',
    '#o-wait .o-wait-item{margin:0 0 4px;padding-top:12px;border-top:1px solid rgba(0,0,0,.22)}',
    '#o-wait .o-wait-name{margin:0;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
    '#o-wait .o-wait-steps{list-style:none;display:flex;flex-direction:column;gap:8px;margin:8px 0 0;padding:0}',
    '#o-wait .o-wait-steps li{display:flex;align-items:center;gap:12px;font-size:16px;color:#56564f}',
    '#o-wait .o-wait-steps li[data-step="done"],#o-wait .o-wait-steps li[data-step="current"]{font-weight:700;color:#111827}',
    '#o-wait .o-wait-steps svg{width:20px;height:20px;flex-shrink:0}',
    '#o-wait .o-wait-check,#o-wait .o-wait-star{display:flex;flex-shrink:0}#o-wait .o-wait-check{color:' + WAIT_TINT + '}#o-wait .o-wait-star{color:#d8a800}',
    '#o-wait .o-wait-todo{display:flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0}',
    '#o-wait .o-wait-todo::after{content:"";width:8px;height:8px;border-radius:999px;background:rgba(0,0,0,.22)}',
    '#o-wait .o-wait-photo{display:block;width:auto;max-width:100%;height:160px;margin:12px auto 0;background:#e5e5e5;object-fit:contain}',
    '#o-wait .o-wait-open{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:8px;padding:0 16px;border:2px solid #111827;background:#111827;color:#fff;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-decoration:none;transition:background-color .2s,color .2s}',
    '#o-wait .o-wait-open:hover{background:#fff;color:#111827}',
    '#o-wait .o-wait-note{margin:8px 0 0;font-size:15px}',
    '#o-wait .o-wait-remove{min-height:44px;margin:4px 0 0;padding:0;border:0;background:transparent;color:#56564f;font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:4px;cursor:pointer}',
    '#o-wait .o-wait-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '#o-wait .o-wait-probe{position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none}'
  ].join('');

  function waitEl(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  register({
    id: 'product-wait',
    shell: true,
    ac: null,
    panelAc: null,
    timer: null,
    placeTimer: null,
    ticking: false,
    open: false,
    sig: '',
    said: '',
    bottom: WAIT_MARGIN,

    mount() {
      if (!pageNow()) return this.unmount();
      const ids = waitIds();
      if (!ids.length) return this.unmount();
      if (!this.ac) this.start();
      // Uma camiseta nova no cookie (outra aba do storefront) ou a consulta parada: volta a perguntar.
      if (!this.timer && !this.ticking && ids.some((id) => !waitFinished(waitJobs.get(id)))) this.poll(0);
      this.render(ids);
    },

    start() {
      this.ac = new AbortController();
      const signal = this.ac.signal;
      const later = () => { clearTimeout(this.placeTimer); this.placeTimer = setTimeout(() => this.place(), 60); };
      // Sem observers (como o botão de cupons e o assistente): cliques abrem/fecham carrinho, menu e modais; rolagem/resize movem barras fixas.
      window.addEventListener('resize', later, { signal: signal });
      window.addEventListener('scroll', later, { passive: true, signal: signal });
      document.addEventListener('click', later, { capture: true, signal: signal });
      document.addEventListener('keydown', later, { signal: signal });
      document.addEventListener('focusin', later, { signal: signal });
      document.addEventListener('focusout', later, { signal: signal });
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', later, { signal: signal }); window.visualViewport.addEventListener('scroll', later, { signal: signal }); }
      // Aba de volta à vista: pergunta já (respeitando os 5 s e as esperas de erro).
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !this.ticking) this.poll(0); }, { signal: signal });
    },

    poll(delay) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick(), delay);
    },

    async tick() {
      this.timer = null;
      if (!this.ac || this.ticking) return;
      this.ticking = true;
      try {
        let ids = waitIds();
        for (const id of Array.from(waitJobs.keys())) if (ids.indexOf(id) < 0) waitJobs.delete(id);
        if (document.visibilityState === 'visible') {
          const now = Date.now();
          const due = ids.filter((id) => !waitFinished(waitJobs.get(id)) && !waitBusy.has(id) && now - (waitLast.get(id) || 0) >= WAIT_POLL_MS - 250 && (!waitTries.has(id) || waitTries.get(id).next <= now));
          if (due.length) await Promise.all(due.map((id) => waitFetch(id)));
          if (!this.ac) return;
          ids = waitIds();
        }
        if (!ids.length) { this.unmount(); return; }
        this.render(ids);
        if (ids.some((id) => !waitFinished(waitJobs.get(id)))) this.poll(WAIT_POLL_MS);
      } finally {
        this.ticking = false;
      }
    },

    // Desenha (ou atualiza) a pílula e, aberto, o painel. Nada muda no DOM se o estado é o mesmo: o runtime chama mount() a cada mutação da página.
    render(ids) {
      const jobs = ids.map((id) => waitJobs.get(id)).filter(Boolean);
      if (!jobs.length) { this.drop(); return; }
      const sig = JSON.stringify([jobs, this.open]);
      let root = document.getElementById('o-wait');
      if (root && sig === this.sig) { this.place(); return; }
      this.sig = sig;
      if (!root) root = this.build();
      const pill = root.querySelector('.o-wait-pill');
      const label = waitLabel(jobs);
      const ready = jobs.some((j) => j.status === 'ready' && j.url);
      pill.classList.toggle('is-ready', ready);
      // A atenção (pulso + mexidinha) só na pronta; fazendo, só o ponto amarelo.
      pill.classList.toggle('o-wait-nudge', ready);
      pill.setAttribute('data-wait-state', ready ? 'ready' : jobs.some((j) => !waitFinished(j)) ? 'making' : 'idle');
      pill.querySelector('[data-wait-label]').textContent = label;
      // Fazendo (nenhuma pronta e alguma em andamento): as setas girando e o ponto amarelo; senão, a camiseta simples (a mesma regra do storefront).
      const working = !ready && jobs.some((j) => !waitFinished(j));
      const icon = pill.querySelector('[data-wait-icon]');
      if (icon.getAttribute('data-wait-icon') !== (working ? 'working' : 'shirt')) {
        icon.setAttribute('data-wait-icon', working ? 'working' : 'shirt');
        icon.className = working ? 'o-wait-icon o-wait-working' : 'o-wait-icon';
        icon.innerHTML = working ? WAIT_WORKING : WAIT_SHIRT;
      }
      pill.querySelector('.o-wait-dot').hidden = !working;
      // Leitor de tela: anuncia a mudança (não a primeira pintura).
      if (this.said && this.said !== label) root.querySelector('[data-wait-live]').textContent = label;
      this.said = label;
      if (this.open) this.fill(jobs);
      this.place();
    },

    build() {
      const root = waitEl('div', { id: 'o-wait', 'data-origens-product-wait': '' });
      root.appendChild(waitEl('style', null, WAIT_CSS));
      root.appendChild(waitEl('span', { class: 'o-wait-probe', 'aria-hidden': 'true' }));
      root.appendChild(waitEl('p', { class: 'o-wait-sr', 'aria-live': 'polite', 'data-wait-live': '' }));
      const pill = waitEl('button', { type: 'button', class: 'o-wait-pill', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'o-wait-panel', 'data-wait-pill': '' });
      pill.appendChild(waitEl('span', { class: 'o-wait-icon', 'data-wait-icon': '', 'aria-hidden': 'true' }));
      pill.appendChild(waitEl('span', { 'data-wait-label': '' }));
      pill.appendChild(waitEl('span', { class: 'o-wait-dot', 'aria-hidden': 'true' }));
      pill.addEventListener('click', () => (this.open ? this.close(true) : this.show()), { signal: this.ac.signal });
      root.appendChild(pill);
      document.body.appendChild(root);
      return root;
    },

    // Centro de baixo do que o visitante vê; recua acima do CTA fixo e do aviso de cookies; some quando a página precisa do espaço ou da atenção.
    place() {
      const root = document.getElementById('o-wait');
      if (!root) return;
      const pill = root.querySelector('.o-wait-pill');
      const vh = waitViewportBottom();
      const vv = window.visualViewport;
      const visibleBottom = vv && vv.height > 0 ? Math.min(vh, (vv.offsetTop || 0) + vv.height) : vh;
      const vw = vv && vv.width > 0 ? vv.width : document.documentElement.clientWidth;
      const center = (vv && vv.offsetLeft > 0 ? vv.offsetLeft : 0) + vw / 2;
      const maxWidth = Math.max(140, vw - 2 * WAIT_SIDE);
      pill.style.maxWidth = maxWidth + 'px';
      const width = Math.min(pill.offsetWidth || maxWidth, maxWidth);
      const left = center - width / 2;
      let bottom = WAIT_MARGIN + Math.max(0, vh - visibleBottom);
      // A barra fixa do "Adicionar ao carrinho" no celular (o botão e a barra que o envolve) e o aviso de cookies: a pílula fica acima deles.
      for (const selector of ['#add-to-cart-mob', '.form-product-options__add-to-cart-mobile', '.cookie-acceptance']) {
        const el = document.querySelector(selector);
        if (!el || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.right > left && r.left < left + width && r.bottom > vh - bottom - WAIT_HEIGHT && r.top < visibleBottom) bottom = Math.max(bottom, vh - r.top + WAIT_GAP);
      }
      this.bottom = bottom;
      pill.style.left = center + 'px';
      pill.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
      const ours = { left: left, right: left + width, top: vh - bottom - WAIT_HEIGHT, bottom: vh - bottom };
      const header = document.querySelector('header');
      const noRoom = ours.top < (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + WAIT_GAP;
      const burger = document.getElementById('menu-hamburger');
      const menuOpen = !!burger && burger.getAttribute('aria-expanded') === 'true';
      const keyboard = waitTyping(document.activeElement) && !!window.visualViewport && window.visualViewport.height < window.innerHeight - 120;
      const typing = waitTyping(document.activeElement) && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      // Controles essenciais da compra (variantes, quantidade, Adicionar ao carrinho em fluxo) e os botões do guia nunca ficam debaixo da pílula.
      let covers = false;
      for (const control of document.querySelectorAll('form[id^="form-product-"] button, form[id^="form-product-"] label, form[id^="form-product-"] select, form[id^="form-product-"] input:not([type="hidden"]), [data-origens-guide="invite"] button, [data-origens-guide="reopen"] button')) {
        if (control.getClientRects().length > 0 && waitHits(ours, control.getBoundingClientRect())) { covers = true; break; }
      }
      const helpOpen = waitShown('[data-controller~="ink-store--help-button"] [data-ink-store--help-button-target="linksList"]');
      const overlay = waitShown('.cart-drawer.open') || waitShown('#modal-wrapper') || menuOpen || helpOpen || waitShown('#o-assist-panel') || waitShown('#o-promo-panel');
      const blocked = overlay || keyboard || typing || noRoom || covers;
      // Diagnóstico (QA e suporte): por que a pílula está fora do caminho agora.
      root.setAttribute('data-wait-hidden', blocked ? [overlay && 'overlay', keyboard && 'keyboard', typing && 'typing', noRoom && 'no-room', covers && 'purchase-controls'].filter(Boolean).join(' ') : '');
      pill.hidden = blocked && !this.open;
      if (this.open && (overlay || keyboard)) this.close(false);
      if (this.open) this.placePanel();
    },

    // Logo acima da pílula: no celular, a largura da tela menos as margens; maior, 352 px centrados.
    placePanel() {
      const panel = document.getElementById('o-wait-panel');
      if (!panel) return;
      const vv = window.visualViewport;
      const vw = vv && vv.width > 0 ? vv.width : document.documentElement.clientWidth;
      const offsetLeft = vv && vv.offsetLeft > 0 ? vv.offsetLeft : 0;
      const width = waitPhone() ? vw - 2 * WAIT_MARGIN : Math.min(352, vw - 2 * WAIT_MARGIN);
      panel.style.left = (offsetLeft + (vw - width) / 2) + 'px';
      panel.style.width = width + 'px';
      const bottom = this.bottom + WAIT_HEIGHT + WAIT_GAP;
      panel.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
      const header = document.querySelector('header');
      const top = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + WAIT_GAP;
      panel.style.maxHeight = Math.max(200, Math.min(512, Math.round(waitViewportBottom() * 0.7), waitViewportBottom() - bottom - top)) + 'px';
    },

    show() {
      const root = document.getElementById('o-wait');
      if (!root || this.open) return;
      this.open = true;
      this.panelAc = new AbortController();
      const signal = this.panelAc.signal;
      const panel = waitEl('div', { id: 'o-wait-panel', class: 'o-wait-panel', role: 'dialog', 'aria-labelledby': 'o-wait-title' });
      const head = waitEl('div', { class: 'o-wait-head' });
      head.appendChild(waitEl('h2', { id: 'o-wait-title' }));
      const close = waitEl('button', { type: 'button', class: 'o-wait-close', 'data-wait-close': '' }, 'Fechar');
      close.addEventListener('click', () => this.close(true), { signal: signal });
      head.appendChild(close);
      panel.appendChild(head);
      panel.appendChild(waitEl('ul', { class: 'o-wait-list', 'data-wait-list': '' }));
      const pill = root.querySelector('.o-wait-pill');
      root.insertBefore(panel, pill);
      pill.setAttribute('aria-expanded', 'true');
      pill.hidden = false;
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); this.close(true); } }, { signal: signal });
      document.addEventListener('pointerdown', (event) => { const t = event.target; if (t && !panel.contains(t) && !pill.contains(t)) this.close(false); }, { capture: true, signal: signal });
      this.sig = '';
      this.render(waitIds());
      if (this.open) close.focus({ preventScroll: true });
    },

    // O conteúdo do painel: uma entrada por camiseta, só com textContent.
    fill(jobs) {
      const panel = document.getElementById('o-wait-panel');
      if (!panel) return;
      panel.querySelector('#o-wait-title').textContent = jobs.length > 1 ? 'Suas camisetas' : 'Sua camiseta';
      const list = panel.querySelector('[data-wait-list]');
      list.textContent = '';
      const signal = this.panelAc ? this.panelAc.signal : undefined;
      for (const job of jobs) {
        const item = waitEl('li', { class: 'o-wait-item', 'data-wait-job': job.id, 'data-wait-status': job.status });
        item.appendChild(waitEl('p', { class: 'o-wait-name' }, job.label));
        const opens = job.status === 'ready' && !!job.url;
        if (waitFinished(job) && !opens) {
          item.appendChild(waitEl('p', { class: 'o-wait-note', 'data-wait-note': '' }, 'Não deu para criar agora. A equipe pode mandar o link.'));
        } else {
          const current = WAIT_STEP[job.status];
          const steps = waitEl('ol', { class: 'o-wait-steps', 'aria-label': 'Andamento', 'data-wait-steps': '' });
          WAIT_STEPS.forEach((text, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : 'todo';
            const step = waitEl('li', { 'data-step': state });
            if (state === 'current') step.setAttribute('aria-current', 'step');
            const icon = waitEl('span', { class: state === 'done' ? 'o-wait-check' : state === 'current' ? 'o-wait-star' : 'o-wait-todo', 'aria-hidden': 'true' });
            if (state !== 'todo') icon.innerHTML = state === 'done' ? WAIT_CHECK : WAIT_STAR;
            step.appendChild(icon);
            step.appendChild(waitEl('span', null, text + (state === 'current' ? '…' : '')));
            steps.appendChild(step);
          });
          item.appendChild(steps);
        }
        if (opens) {
          if (job.image) item.appendChild(waitEl('img', { class: 'o-wait-photo', src: job.image, alt: '', loading: 'lazy', decoding: 'async' }));
          const open = waitEl('a', { class: 'o-wait-open', href: job.url, 'data-wait-open': '' }, 'Ver minha camiseta');
          // Tira do cookie ANTES de seguir o link (o clique continua o da página: o Turbo da INK faz a visita). A pílula sai depois, sem mexer no link agora.
          open.addEventListener('click', () => { waitForget(job.id); setTimeout(() => { this.sig = ''; this.render(waitIds()); }, 0); }, { signal: signal });
          item.appendChild(open);
        }
        const remove = waitEl('button', { type: 'button', class: 'o-wait-remove', 'data-wait-remove': '' }, 'Tirar da lista');
        remove.addEventListener('click', () => {
          waitForget(job.id);
          const ids = waitIds();
          // Lista vazia = cookie apagado e tudo nosso sai; senão o painel continua com as outras (nenhuma respondida ainda = só a pílula some).
          if (!ids.length) { this.unmount(); return; }
          this.render(ids);
          const close = document.querySelector('#o-wait [data-wait-close]');
          if (close) close.focus({ preventScroll: true });
        }, { signal: signal });
        item.appendChild(remove);
        list.appendChild(item);
      }
    },

    close(refocus) {
      if (!this.open) return;
      this.open = false;
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      const panel = document.getElementById('o-wait-panel');
      if (panel) panel.remove();
      const pill = document.querySelector('#o-wait .o-wait-pill');
      if (pill) { pill.setAttribute('aria-expanded', 'false'); if (refocus) pill.focus({ preventScroll: true }); }
      this.sig = '';
      this.render(waitIds());
    },

    // Só a interface (a consulta continua): nenhuma camiseta respondeu ainda, ou a última respondida saiu da lista.
    drop() {
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      this.open = false; this.sig = ''; this.said = '';
      const root = document.getElementById('o-wait');
      if (root) root.remove();
    },

    unmount() {
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.placeTimer); this.placeTimer = null;
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.drop();
    }
  });
`;
