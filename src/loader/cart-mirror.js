// cart-mirror (cliente): LÊ o carrinho da INK (somente leitura) do DOM estrutural auditado e mantém um resumo no backend
// próprio (cart-ref) para o storefront exibir um ESPELHO do último estado conhecido. Nunca altera o carrinho nem o checkout.
// Fonte: turbo-frame#cart (renderizado pelo servidor da INK em toda página e atualizado por Turbo a cada mutação do carrinho):
//   #quantity-header[data-quantityheader]   -> quantidade total
//   li.main-list__item                        -> um item: form[data-ink-store--cart-product-id-value|-product-variant-value],
//                                                .item-details p (nome, cor, tamanho), input[name="cart_item[quantity]"],
//                                                .price-details span (preço da linha), img (imagem)
//   .footer-details[data-ink-store--cart-subtotal-value|-discount-value] + o texto do "Total" exibido pela INK
//   .empty-cart                               -> carrinho vazio
// Estrutura desconhecida => readCart() devolve null e NADA é espelhado. Não guarda cookies, CSRF, sessão nem dados pessoais.
export const CART_MIRROR = String.raw`
  const MIRROR_ENDPOINT = '/__origens/cart-ref';
  const MIRROR_DEBOUNCE_MS = 800;
  const REF_REFRESH_MS = 20 * 60 * 1000; // renova antes do TTL de 30 min
  const REF_MAX_AGE_MS = 25 * 60 * 1000; // não decora links com ref potencialmente expirado

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

  register({
    id: 'cart-mirror',
    ref: null,
    refAt: 0,
    lastKey: '',
    timer: null,
    abort: null,
    observer: null,
    host: null,
    ac: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      if (!this.ac) {
        this.ac = new AbortController();
        // Só os NOSSOS links para o storefront ganham ?cart_ref=, no instante do clique (nunca links da INK).
        document.addEventListener('click', (event) => this.decorate(event), { capture: true, signal: this.ac.signal });
        for (const name of ['turbo:frame-load', 'turbo:frame-render', 'turbo:before-stream-render']) {
          document.addEventListener(name, () => this.schedule(), { signal: this.ac.signal });
        }
      }
      // O frame do carrinho fica DENTRO de .cart-drawer (a página também tem um turbo-frame#cart no formulário de compra).
      const frame = document.querySelector('.cart-drawer turbo-frame#cart');
      if (frame && frame !== this.host) {
        if (this.observer) this.observer.disconnect();
        this.host = frame;
        this.observer = new MutationObserver(() => this.schedule());
        this.observer.observe(frame, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-quantityheader', 'value'] });
        this.schedule();
      }
    },

    schedule() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync(), MIRROR_DEBOUNCE_MS);
    },

    async sync() {
      this.timer = null;
      if (!allowedNow()) return;
      const snapshot = readCart();
      if (!snapshot) return;
      if (snapshot.items.length === 0 && !this.ref) return; // carrinho vazio e nada a limpar
      const key = JSON.stringify(snapshot);
      const fresh = !!this.ref && Date.now() - this.refAt < REF_REFRESH_MS;
      if (key === this.lastKey && fresh) return;
      if (this.abort) this.abort.abort();
      const controller = new AbortController();
      this.abort = controller;
      try {
        // Mesma origem, sem credenciais: nenhum cookie da INK vai junto e nada de sessão é guardado.
        const response = await fetch(MIRROR_ENDPOINT, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: key, signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!allowedNow() || controller.signal.aborted || !data || typeof data.ref !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(data.ref)) return;
        this.ref = data.ref; this.refAt = Date.now(); this.lastKey = key;
      } catch (_) { /* falha silenciosa: sem espelho, o carrinho da INK segue intacto */ }
    },

    decorate(event) {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || !this.ref || Date.now() - this.refAt > REF_MAX_AGE_MS) return;
      if (link.id !== 'use-origens-return-link' && !link.closest('[data-origens-discovery]')) return;
      try {
        const url = new URL(link.href);
        if (url.origin !== STOREFRONT_ORIGIN || (url.pathname !== '/sul' && !url.pathname.startsWith('/sul/'))) return;
        url.searchParams.set('cart_ref', this.ref);
        link.href = url.href;
      } catch (_) { /* ignora */ }
    },

    unmount() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.abort) { this.abort.abort(); this.abort = null; }
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.host = null; this.ref = null; this.refAt = 0; this.lastKey = '';
    }
  });
`;
