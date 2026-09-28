// list-session: "Sua próxima camiseta" — card no drawer pós-adição, ligado à sessão de compra que o storefront
// cria em "Meus Lugares" (docs/buy-session-contract.md). Reaproveita o MESMO sinal confiável de post-add-discovery
// (drawer-watch.js) para "produto realmente adicionado": nunca avança por uma simples visita à página ou clique.
// Sem sessionStorage com dado sensível: só o id opaco (assinado pelo storefront, sem significado para nós) e os
// ids de produto já confirmados NESTA aba. Nada de innerHTML com dado externo — só textContent/atributos, href
// sempre revalidado (o Worker já filtrou por host em list-session.js; o cliente confere de novo, defesa em
// profundidade). Sem card possível (sem `ls`, sessão inválida/expirada, sem módulo ativo) o drawer nativo segue
// exatamente como está — nunca um estado de erro visível.
export const LIST_WATCH = String.raw`
  const LS_STORAGE_KEY = 'origens:ls';
  const LS_DONE_KEY = 'origens:ls:done';
  const LS_ENDPOINT = '/__origens/list-session';
  const LS_FETCH_MS = 2500;
  const LS_ID_FORMAT = /^[A-Za-z0-9_-]{1,700}\.[A-Za-z0-9_-]{1,50}$/;
  const LS_PRODUCT_ID = /^[A-Za-z0-9_-]{1,40}$/;
  const OLIVE = '#4d543d';

  function lsRead(key) {
    try { return window.sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function lsWrite(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (_) { /* segue sem persistir: a sessão só dura a página atual */ }
  }
  function lsDoneSet() {
    try { const raw = JSON.parse(lsRead(LS_DONE_KEY) || '[]'); return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []); } catch (_) { return new Set(); }
  }
  function lsMarkDone(productId) {
    const set = lsDoneSet();
    if (set.has(productId)) return;
    set.add(productId);
    lsWrite(LS_DONE_KEY, JSON.stringify([...set].slice(-100)));
  }

  // Captura ?ls= da URL (uma vez) e some com o parâmetro, como o storefront já faz com ?cart_ref=. Sem ?ls= na URL,
  // usa o que já estiver guardado nesta aba (permite navegar por outros produtos da INK sem perder a sessão).
  function lsToken() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('ls');
    if (fromUrl && LS_ID_FORMAT.test(fromUrl)) {
      lsWrite(LS_STORAGE_KEY, fromUrl);
      params.delete('ls');
      const rest = params.toString();
      const clean = window.location.pathname + (rest ? '?' + rest : '') + window.location.hash;
      try { window.history.replaceState(null, '', clean); } catch (_) { /* ignora */ }
      return fromUrl;
    }
    const stored = lsRead(LS_STORAGE_KEY);
    return stored && LS_ID_FORMAT.test(stored) ? stored : null;
  }

  function lsCurrentProductId() {
    const form = document.querySelector('form[id^="form-product-"]');
    if (!form) return null;
    const id = form.id.slice('form-product-'.length);
    return LS_PRODUCT_ID.test(id) ? id : null;
  }

  function lsSafeUrl(value, allowedProtocol) {
    try {
      const url = new URL(value);
      return url.protocol === allowedProtocol ? url.href : null;
    } catch (_) { return null; }
  }

  // Chave estável para comparar "a mesma pergunta" (mesma sessão, mesmo conjunto done) independente da ordem de
  // inserção do Set. Usada tanto para decidir se um pré-fetch já cobre o que check() precisa quanto para nunca
  // repetir o mesmo pré-fetch em montagens seguidas da mesma página (Turbo pode chamar mount() mais de uma vez).
  function lsKey(token, doneArray) {
    return token + '|' + doneArray.slice().sort().join(',');
  }

  function lsFetchNext(token, doneArray, signal) {
    return fetch(LS_ENDPOINT + '?ls=' + encodeURIComponent(token) + '&done=' + encodeURIComponent(doneArray.join(',')), {
      credentials: 'omit', headers: { accept: 'application/json' }, signal
    }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
  }

  function lsEnsureStyle() {
    let style = document.querySelector('style[data-origens-list-session-style]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-origens-list-session-style', '');
      style.textContent = [
        '[data-origens-list-session]{box-sizing:border-box;display:flex;gap:12px;align-items:center;margin:16px 0 4px;padding:12px;background:#f6f4ec;border:1px solid #d9d5c3;border-radius:12px;font-family:inherit;color:#111827;text-align:left}',
        '[data-origens-list-session] *{box-sizing:border-box;font-family:inherit}',
        '[data-origens-list-session] .o-ls-photo{width:56px;height:56px;flex:0 0 auto;border-radius:8px;object-fit:cover;background:#e5e5e5}',
        '[data-origens-list-session] .o-ls-body{min-width:0;flex:1 1 auto}',
        '[data-origens-list-session] .o-ls-eyebrow{margin:0;font-size:11px;font-weight:600;letter-spacing:.04em;color:' + OLIVE + '}',
        '[data-origens-list-session] .o-ls-title{margin:2px 0 0;font-size:14px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '[data-origens-list-session] .o-ls-progress{margin:2px 0 0;font-size:12px;color:#4b5563}',
        '[data-origens-list-session] .o-ls-cta{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border:1px solid ' + OLIVE + ';border-radius:8px;background:transparent;color:' + OLIVE + ';font-size:13px;font-weight:600;line-height:20px;text-decoration:none}',
        '[data-origens-list-session] .o-ls-cta:hover{background:' + OLIVE + ';color:#fff}',
        '[data-origens-list-session] .o-ls-cta:focus-visible{outline:2px solid ' + OLIVE + ';outline-offset:2px}',
        '@media (max-width:767px){[data-origens-list-session]{margin:12px 0 0;padding:10px}}'
      ].join('');
      document.head.appendChild(style);
    }
    return style;
  }

  function lsBuildCard(next, position, total, token) {
    const root = document.createElement('section');
    root.setAttribute('data-origens-list-session', '');
    root.setAttribute('aria-label', 'Sua próxima camiseta da sua seleção');
    const img = document.createElement('img');
    img.className = 'o-ls-photo';
    img.alt = '';
    const safeImage = lsSafeUrl(next.imageUrl, 'https:');
    if (safeImage) img.src = safeImage;
    const body = document.createElement('div');
    body.className = 'o-ls-body';
    const eyebrow = document.createElement('p'); eyebrow.className = 'o-ls-eyebrow'; eyebrow.textContent = 'Sua próxima camiseta';
    const title = document.createElement('p'); title.className = 'o-ls-title'; title.textContent = next.title;
    const progress = document.createElement('p'); progress.className = 'o-ls-progress';
    progress.textContent = total > 0 ? (position + 1) + ' de ' + total : '';
    body.appendChild(eyebrow); body.appendChild(title); body.appendChild(progress);
    const cta = document.createElement('a');
    cta.className = 'o-ls-cta';
    cta.textContent = 'Ver próxima →';
    // Único link MESMA ORIGEM (INK -> INK) que este código já injeta — todo outro CTA (return-link,
    // discovery, product-discovery) sai para o storefront, origem diferente, onde o Turbo Drive da INK nunca
    // intercepta o clique. Aqui intercepta: sem isto, o clique vira uma visita Turbo que a INK trata como
    // navegação (fechando/esmaecendo o drawer) sem completar o carregamento real da próxima página.
    cta.setAttribute('data-turbo', 'false');
    const safeHref = lsSafeUrl(next.url, 'https:');
    if (safeHref) {
      const withToken = new URL(safeHref);
      withToken.searchParams.set('ls', token); // carrega a sessão para a próxima página mesmo que o sessionStorage falhe
      cta.href = withToken.href;
    }
    root.appendChild(img); root.appendChild(body); root.appendChild(cta);
    return root;
  }

  register({
    id: 'list-session',
    host: null,
    observer: null,
    ac: null,
    mounted: false,
    seq: 0,
    prefetchKey: null,
    prefetchPromise: null,
    prefetchController: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      // Captura e limpa ?ls= da URL assim que a página carrega — igual ao ?cart_ref do storefront — independente
      // de o drawer já estar aberto ou não, para o parâmetro nunca sobreviver nem aparecer em analytics.
      lsToken();
      if (!this.ac) {
        this.ac = new AbortController();
        for (const name of ['turbo:frame-load', 'turbo:frame-render', 'turbo:before-stream-render']) {
          document.addEventListener(name, () => setTimeout(() => this.check(), 30), { signal: this.ac.signal });
        }
      }
      const host = document.getElementById('last_added_product');
      if (host && host !== this.host) {
        if (this.observer) this.observer.disconnect();
        this.host = host;
        this.observer = new MutationObserver(() => this.check());
        this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
      this.prefetchNext();
      this.check();
    },

    // Aposta: o produto DESTA página é o que o visitante está prestes a adicionar. Busca a resposta para o
    // conjunto "done" que passaria a valer se essa aposta se confirmar, ANTES de o drawer abrir — na maioria dos
    // casos reais (escolher variante/tamanho leva mais que os ~300ms da ida e volta) a resposta já está pronta
    // quando o add é confirmado, e check() só lê o cache em vez de esperar uma requisição nova. Não marca nada
    // como feito de verdade (isso continua só em check(), no add confirmado) e nunca aparece nada se a aposta
    // não se confirmar: só evita repetir uma requisição já em voo/pronta para a MESMA pergunta.
    prefetchNext() {
      const token = lsToken();
      const current = lsCurrentProductId();
      if (!token || !current) return;
      const done = [...lsDoneSet()];
      if (!done.includes(current)) done.push(current);
      const key = lsKey(token, done);
      if (this.prefetchKey === key) return;
      if (this.prefetchController) this.prefetchController.abort();
      this.prefetchKey = key;
      this.prefetchController = new AbortController();
      const timeout = setTimeout(() => this.prefetchController.abort(), LS_FETCH_MS);
      this.prefetchPromise = lsFetchNext(token, done, this.prefetchController.signal);
      this.prefetchPromise.then(() => clearTimeout(timeout));
    },

    // Mesmo critério de post-add-discovery: drawer existe, visível, confirmação da INK e botões nativos presentes.
    isOpen(wrapper) {
      return !!wrapper && wrapper.getClientRects().length > 0 && /Produto adicionado/i.test(wrapper.textContent || '') &&
        !!wrapper.querySelector('.checkout-btn, #continue-shopping-button');
    },

    check() {
      if (!allowedNow()) return this.unmount();
      const wrapper = document.getElementById('modal-wrapper');
      if (!this.isOpen(wrapper)) { this.mounted = false; return; }
      if (wrapper.querySelector('[data-origens-list-session]')) return;

      const token = lsToken();
      if (!token) return; // sem sessão: nada a mostrar, drawer nativo intacto

      // O produto desta página acabou de ser confirmado adicionado (o drawer só abre assim) — idempotente: marcar
      // o mesmo id várias vezes (reabertura, evento repetido) não muda o resultado.
      const current = lsCurrentProductId();
      if (current) lsMarkDone(current);

      const doneNow = [...lsDoneSet()];
      const key = lsKey(token, doneNow);
      const mySeq = ++this.seq;

      const render = (data) => {
        if (mySeq !== this.seq || !allowedNow()) return; // resposta atrasada/rota trocada: descartada
        const wrapperNow = document.getElementById('modal-wrapper');
        if (!this.isOpen(wrapperNow) || wrapperNow.querySelector('[data-origens-list-session]')) return;
        if (!data || !data.next) { this.mounted = false; return; } // terminou ou sessão inválida: sem sugestão falsa
        const footer = wrapperNow.querySelector('.add-product-modal__modal-content__footer');
        const mostSold = wrapperNow.querySelector('#most_sold_frame');
        if (!footer && !mostSold) return;
        const card = lsBuildCard(data.next, data.position || 0, data.total || 0, token);
        lsEnsureStyle();
        if (footer) footer.insertAdjacentElement('afterend', card); else mostSold.insertAdjacentElement('beforebegin', card);
        this.mounted = true;
      };

      // A aposta do prefetchNext() se confirmou: mesma sessão, mesmo conjunto done resultante — usa a resposta já
      // pronta (ou quase) em vez de repetir a mesma pergunta com uma requisição nova.
      if (this.prefetchKey === key && this.prefetchPromise) {
        this.prefetchPromise.then(render);
        return;
      }
      // A aposta errou (ex.: troca de variante mudou o produto desta página entre o mount() e a confirmação).
      // Registra ESTA busca como a resposta corrente para a chave real — sem isto, o próximo mount() (o
      // observer global do runtime chama sync()/mount() de novo a cada mutação do documento, não só a nossa)
      // veria prefetchKey desatualizado e repetiria a mesma requisição outra vez, mesmo já tendo a resposta certa.
      if (this.prefetchController) this.prefetchController.abort();
      this.prefetchController = new AbortController();
      const timeout = setTimeout(() => this.prefetchController.abort(), LS_FETCH_MS);
      this.prefetchKey = key;
      this.prefetchPromise = lsFetchNext(token, doneNow, this.prefetchController.signal);
      this.prefetchPromise.then(() => clearTimeout(timeout));
      this.prefetchPromise.then(render);
    },

    unmount() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      if (this.prefetchController) { this.prefetchController.abort(); this.prefetchController = null; }
      this.prefetchKey = null;
      this.prefetchPromise = null;
      this.host = null;
      this.seq++; // invalida qualquer fetch em voo
      this.mounted = false;
    }
  });
`;
