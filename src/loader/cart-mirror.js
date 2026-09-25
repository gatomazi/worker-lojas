// cart-mirror (cliente): LÊ o carrinho da INK (somente leitura) do DOM estrutural auditado e, SÓ QUANDO O CLIENTE SAI POR UM LINK NOSSO
// para o storefront, transfere um resumo (cart-ref) para o espelho do último estado conhecido. Nunca altera o carrinho nem o checkout.
// Fonte: turbo-frame#cart (renderizado pelo servidor da INK em toda página e atualizado por Turbo a cada mutação do carrinho):
//   #quantity-header[data-quantityheader]   -> quantidade total
//   li.main-list__item                        -> um item: form[data-ink-store--cart-product-id-value|-product-variant-value],
//                                                .item-details p (nome, cor, tamanho), input[name="cart_item[quantity]"],
//                                                .price-details span (preço da linha), img (imagem)
//   .footer-details[data-ink-store--cart-subtotal-value|-discount-value] + o texto do "Total" exibido pela INK
//   .empty-cart                               -> carrinho vazio
// Estrutura desconhecida => readCart() devolve null e NADA é espelhado. Não guarda cookies, CSRF, sessão nem dados pessoais.
//
// CUSTO DO KV (cada snapshot é 1 KV.put): visitas, aberturas de drawer, mutações do carrinho, buscas e navegação Turbo NÃO gravam nada.
// Um snapshot só é criado ao SAIR por um link nosso, e só se o estado efetivo mudou (fingerprint) ou o token da aba venceu:
//   - o último {fingerprint, token, criação} vive só em sessionStorage desta aba, neste domínio (nunca compartilhado com o storefront);
//   - o mesmo carrinho transferido de novo reutiliza o token (0 writes) e NUNCA estende o TTL (30 min no servidor; reuso até 25 min);
//   - o snapshot é lido do DOM no instante do clique (nunca um estado ainda em debounce) e chamadas concorrentes se deduplicam;
//   - a navegação espera no máximo EXIT_WAIT_MS; falha/429/timeout/resposta inválida => navega SEM token novo (a compra não depende disto).
export const CART_MIRROR = String.raw`
  const MIRROR_ENDPOINT = '/__origens/cart-ref';
  const REF_MAX_AGE_MS = 25 * 60 * 1000;   // reuso/decoração só com token ainda válido no servidor (TTL 30 min); NUNCA renova nem alonga
  const REF_TTL_MS = 30 * 60 * 1000;
  const EXIT_WAIT_MS = 1200;               // espera máxima de uma navegação nossa pelo snapshot
  const POST_TIMEOUT_MS = 4000;
  const FAILURE_COOLDOWN_MS = 15000;       // após uma falha do mesmo estado, não insiste por 15 s
  const SESSION_KEY = 'origens:mirror:v1';
  const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
  // Contadores só em memória (sem PII, nada é enviado): writes / reaproveitados / falhas, para diagnóstico e testes.
  const mirrorStats = window.__useOrigensMirrorStats = window.__useOrigensMirrorStats || { writes: 0, reused: 0, failures: 0, rate_limited: 0, timeouts: 0 };

  function parseMoney(text) {
    const m = /R\$\s?([\d.]+),(\d{2})/.exec(text || '');
    return m ? Number(m[1].replace(/\./g, '') + '.' + m[2]) : null;
  }

  // Lê o carrinho do DOM. null = estrutura desconhecida ou ainda carregando (não espelha).
  function readCart() {
    const frame = document.querySelector('.cart-drawer turbo-frame#cart') || document.querySelector('turbo-frame#cart');
    if (!frame) return null;
    const rows = frame.querySelectorAll('li.main-list__item');
    const empty = !!frame.querySelector('.empty-cart');
    if (!rows.length && !empty) return null;
    const items = [];
    for (const li of rows) {
      const form = li.querySelector('form[data-ink-store--cart-product-id-value]');
      const qtyInput = li.querySelector('input[name="cart_item[quantity]"]');
      if (!form || !qtyInput) return null;
      const lines = [...li.querySelectorAll('.item-details p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());
      // Com promoção por quantidade a INK mostra o preço cheio riscado (<del>) e, em outro <span>, o preço efetivo da linha.
      const priceBox = li.querySelector('.price-details');
      const struck = priceBox ? priceBox.querySelector('del') : null;
      const spans = priceBox ? [...priceBox.querySelectorAll('span')].filter((el) => !el.querySelector('del') && !el.closest('del')) : [];
      const priceEl = spans.length ? spans[spans.length - 1] : null;
      const img = li.querySelector('img');
      const priceText = priceEl ? priceEl.textContent.replace(/\s+/g, ' ').trim() : '';
      const listText = struck ? struck.textContent.replace(/\s+/g, ' ').trim() : '';
      items.push({
        productId: form.getAttribute('data-ink-store--cart-product-id-value') || '',
        name: lines[0] || '', color: lines[1] || '', size: lines[2] || '',
        variant: form.getAttribute('data-ink-store--cart-product-variant-value') || '',
        quantity: parseInt(qtyInput.value, 10),
        linePriceText: priceText, linePrice: parseMoney(priceText),
        listPriceText: listText, listPrice: listText ? parseMoney(listText) : null,
        image: img ? img.getAttribute('src') || '' : ''
      });
    }
    const header = frame.querySelector('#quantity-header');
    const declared = header ? parseInt(header.getAttribute('data-quantityheader'), 10) : NaN;
    const summed = items.reduce((n, it) => n + (Number.isInteger(it.quantity) ? it.quantity : 0), 0);
    const footer = frame.querySelector('.footer-details');
    // Total EXIBIDO pela INK (subtotal − desconto, calculado por ela): só lemos o texto, nunca calculamos.
    const totalLabel = footer ? [...footer.querySelectorAll('p')].find((el) => el.textContent.trim() === 'Total') : null;
    const totalBox = totalLabel ? totalLabel.nextElementSibling : null;
    const totalEl = totalBox ? totalBox.querySelector('p') : null;
    const totalText = totalEl ? totalEl.textContent.replace(/\s+/g, ' ').trim() : '';
    const num = (attr) => { const v = footer ? parseFloat(footer.getAttribute(attr)) : NaN; return Number.isFinite(v) ? v : null; };
    return {
      v: 1,
      count: Number.isInteger(declared) ? declared : summed,
      items: items,
      subtotal: num('data-ink-store--cart-subtotal-value'),
      discount: num('data-ink-store--cart-discount-value'),
      totalText: totalText,
      total: totalText ? parseMoney(totalText) : null
    };
  }

  // Hash determinístico de 53 bits (cyrb53): identifica o ESTADO EFETIVO do carrinho sem guardar o conteúdo.
  function hash53(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  // Só o que muda a transferência: produto, variante, quantidade e os valores EXIBIDOS pela INK (linha, cheio riscado, total, desconto).
  // Imagem, marcação e classes (cosméticos) ficam de fora.
  function fingerprintOf(snapshot) {
    if (!snapshot.items.length) return 'empty';
    const rows = snapshot.items.map((it) => [it.productId, it.variant, it.quantity, it.linePriceText, it.listPriceText].join('|'));
    return hash53(rows.join(';') + '#' + snapshot.count + '#' + snapshot.totalText + '#' + snapshot.subtotal + '#' + snapshot.discount);
  }
  function loadSession() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s && typeof s.fp === 'string' && TOKEN_RE.test(s.ref) && Number.isFinite(s.at)) return { fp: s.fp, ref: s.ref, at: s.at };
    } catch (_) { /* sem armazenamento: só memória */ }
    return null;
  }
  function saveSession(s) { try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) { /* idem */ } }

  register({
    id: 'cart-mirror',
    session: null,      // { fp, ref, at }: último estado transferido nesta aba
    inflight: null,     // { fp, promise }
    coolFp: '',
    coolUntil: 0,
    ac: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      if (this.ac) return;
      this.session = loadSession();
      this.ac = new AbortController();
      const options = { capture: true, signal: this.ac.signal };
      // pointerdown: adianta o snapshot enquanto o dedo/mouse ainda está pressionado (a espera do clique encolhe); click: decide e navega.
      document.addEventListener('pointerdown', (event) => this.onPress(event), options);
      document.addEventListener('click', (event) => this.onExit(event), options);
    },

    // Só os NOSSOS links para o storefront (resultado, "Explorar todas as estampas", link de retorno): nunca links da INK.
    ourLink(event) {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || (link.id !== 'use-origens-return-link' && !link.closest('[data-origens-discovery]'))) return null;
      try {
        const url = new URL(link.href);
        if (url.origin !== STOREFRONT_ORIGIN || (url.pathname !== '/sul' && !url.pathname.startsWith('/sul/'))) return null;
      } catch (_) { return null; }
      return link;
    },

    reusable(fp) {
      const s = this.session;
      return s && s.fp === fp && Date.now() - s.at < REF_MAX_AGE_MS ? s.ref : null;
    },

    // Há algo a transferir? Carrinho com itens: sim. Vazio: só se ESTA aba já transferiu um carrinho com itens (para o espelho deixar de
    // mostrá-lo); sem token anterior não há o que limpar e nada é gravado.
    needsSnapshot(cart, fp) {
      if (cart.items.length > 0) return true;
      const s = this.session;
      return !!s && s.fp !== 'empty' && Date.now() - s.at < REF_TTL_MS && fp === 'empty';
    },

    ensure(cart) {
      if (!cart) return Promise.resolve(null);
      const fp = fingerprintOf(cart);
      const reuse = this.reusable(fp);
      if (reuse) { mirrorStats.reused++; return Promise.resolve(reuse); }
      if (!this.needsSnapshot(cart, fp)) return Promise.resolve(null);
      if (this.inflight && this.inflight.fp === fp) return this.inflight.promise; // deduplica cliques e pressionamentos do mesmo estado
      if (fp === this.coolFp && Date.now() < this.coolUntil) return Promise.resolve(null);
      const promise = this.post(cart, fp).finally(() => { if (this.inflight && this.inflight.promise === promise) this.inflight = null; });
      this.inflight = { fp: fp, promise: promise };
      return promise;
    },

    async post(cart, fp) {
      const controller = new AbortController();
      const timer = setTimeout(() => { mirrorStats.timeouts++; controller.abort(); }, POST_TIMEOUT_MS);
      try {
        // Mesma origem, sem credenciais: nenhum cookie da INK vai junto e nada de sessão é guardado.
        const response = await fetch(MIRROR_ENDPOINT, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cart), signal: controller.signal });
        if (response.status === 429) mirrorStats.rate_limited++;
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        if (!data || typeof data.ref !== 'string' || !TOKEN_RE.test(data.ref)) throw new Error('bad payload');
        this.session = { fp: fp, ref: data.ref, at: Date.now() };
        saveSession(this.session);
        mirrorStats.writes++;
        return data.ref;
      } catch (_) {
        mirrorStats.failures++; // falha silenciosa: sem espelho, o carrinho e o checkout da INK seguem intactos
        this.coolFp = fp; this.coolUntil = Date.now() + FAILURE_COOLDOWN_MS;
        return null;
      } finally {
        clearTimeout(timer);
      }
    },

    decorate(link, ref) {
      try {
        const url = new URL(link.href);
        url.searchParams.set('cart_ref', ref);
        link.href = url.href;
      } catch (_) { /* ignora */ }
    },

    onPress(event) {
      if (!allowedNow() || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!this.ourLink(event)) return;
      const cart = readCart();
      if (!cart || this.reusable(fingerprintOf(cart))) return; // token ainda válido para este estado: nada a adiantar
      this.ensure(cart);
    },

    onExit(event) {
      if (!allowedNow()) return;
      const link = this.ourLink(event);
      if (!link) return;
      const cart = readCart(); // estado NO INSTANTE do clique (nunca um estado ainda em debounce)
      if (!cart) return;
      const fp = fingerprintOf(cart);
      const reuse = this.reusable(fp);
      if (reuse) { mirrorStats.reused++; this.decorate(link, reuse); return; }
      if (!this.needsSnapshot(cart, fp)) return; // nada a transferir: link normal, sem espera
      // Nova aba, atalho ou botão do meio: não dá para esperar. Segue sem token novo (a escrita só existe para uma navegação real).
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank' || event.defaultPrevented) return;
      const pending = this.ensure(cart);
      event.preventDefault();
      let done = false;
      const finish = (token) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (token) this.decorate(link, token);
        window.location.assign(link.href); // navegação normal, com ou sem token
      };
      const timer = setTimeout(() => finish(null), EXIT_WAIT_MS);
      pending.then(finish, () => finish(null));
    },

    unmount() {
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.session = null; this.inflight = null;
    }
  });
`;
