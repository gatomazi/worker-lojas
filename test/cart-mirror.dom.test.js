import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { CART_MIRROR } from '../src/loader/cart-mirror.js';

// Leitor estrutural do carrinho da INK (turbo-frame#cart) + transferência SOB DEMANDA para o backend cart-ref (jsdom).
// Custo do KV: cada POST = 1 KV.put. Visitas, drawers, mutações e buscas NÃO gravam; só a saída por um link nosso, e só se o estado mudou.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const ALLOWED = '/usesul/product/serra-catarinense'; const OTHER = '/usesul/product/vida-no-sul-estancia-edition'; const HOST = 'https://www.usesul.com.br';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';

const item = (id, qty, price, name = 'Serra Catarinense') => '<li class="main-list__item"><img src="' + IMG + '" alt="Imagem do produto"><div class="item-wrapper"><header><div class="item-details"><p>' + name + '</p><p>Preta</p><p>M</p></div>' +
  '<div class="price-details"><div class="price"><span>' + price + '</span></div></div></header><div class="item-details__footer"><form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M" data-ink-store--cart-id-value="cart_item_' + id + '" action="/usesul/cart/item" method="post">' +
  '<div id="quantity-buttons"><input class="quantity-input" type="text" value="' + qty + '" name="cart_item[quantity]"></div></form></div></div></li>';
const frame = (n, rows, subtotal, discount = '0.0', total = '') => '<turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="' + n + '">(' + n + ' produto' + (n === 1 ? '' : 's') + ')</span></span></div>' +
  '<div class="cart-drawer__main"><ul>' + rows + '</ul></div><div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="' + discount + '" data-ink-store--cart-subtotal-value="' + subtotal + '"><span id="amount">x</span>' + (total ? '<div class="flex justify-between"><p>Total</p><span class="flex flex-col"><p>' + total + '</p><span>ou 5x de R$ 79,92</span></span></div>' : '') + '</div></div></div></turbo-frame>';
const ONE = frame(1, item(1, 1, 'R$ 109,90'), '109.9');
const promoItem = (id) => '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>Serra Catarinense</p><p>Preta</p><p>M</p></div><div class="price-details"><div class="price"><span><del>R$ 109,90</del></span><span>R$ 99,90</span></div></div><form data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="v' + id + '"><input name="cart_item[quantity]" value="1"></form></li>';
const PROMO = frame(4, [1, 2, 3, 4].map(promoItem).join(''), '439.6', '40.0', 'R$ 399,60');
const TWO_QTY = frame(2, item(1, 2, 'R$ 219,80'), '219.8');
const EMPTY = '<turbo-frame id="cart"><turbo-frame id="cart"><div><header class="cart-drawer__header"><span>(0 produtos)</span></header><div class="empty-cart"><span>Seu carrinho está vazio</span></div></div></turbo-frame></turbo-frame>';
const PAGE = (cart) => PRODUCT.replace('</main>', '<div class="cart-drawer">' + cart + '</div></main>');

const REF = 'AbCdEfGhIjKlMnOpQrStUv'; const REF2 = 'ZyXwVuTsRqPoNmLkJiHgFe'; const HOUR = 60 * 60 * 1000;
const ok = (ref = REF) => () => new Response(JSON.stringify({ ref, ttl: 1800 }), { status: 201 });

// Cada janela = uma aba (sessionStorage próprio). `carry` copia o sessionStorage de outra aba (recarregar a mesma aba = mesma sessão).
function setup({ cart = ONE, path = ALLOWED, features = ['return-link', 'cart-mirror'], fetchImpl, carry = null, allowed = [ALLOWED] } = {}) {
  const navs = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) navs.push({ at: Date.now(), href: t.lastLink ? t.lastLink.href : null }); });
  const dom = new JSDOM(PAGE(cart), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
  const posts = [];
  w.fetch = async (url, options = {}) => { posts.push({ url: String(url), method: options.method, credentials: options.credentials, headers: options.headers, body: options.body }); if (options.signal && options.signal.aborted) throw new w.DOMException('aborted', 'AbortError'); return (fetchImpl || ok())(options); };
  const navigations = []; // cliques que o navegador seguiria sozinho (não interceptados)
  const t = { w, doc: w.document, posts, navigations, navs, lastLink: null, dom };
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { t.lastLink = a; e.__prevented = e.defaultPrevented; if (!e.defaultPrevented) { navigations.push(a.href); e.preventDefault(); } } });
  w.eval(buildLoaderSource(allowed, features));
  t.stats = () => JSON.parse(JSON.stringify(w.__useOrigensMirrorStats || {}));
  t.storage = () => Object.fromEntries(Array.from({ length: w.sessionStorage.length }, (_, i) => [w.sessionStorage.key(i), w.sessionStorage.getItem(w.sessionStorage.key(i))]));
  return t;
}
const setCart = (doc, html) => { doc.querySelector('.cart-drawer').innerHTML = html; };
const addOurLink = (t, id = 'ours', href = 'https://useorigens.com.br/sul', kind = 'cart') => { if (!t.doc.getElementById(id)) t.doc.body.insertAdjacentHTML('beforeend', '<section data-origens-discovery="' + kind + '"><a id="' + id + '" href="' + href + '">x</a></section>'); return t.doc.getElementById(id); };
// "Sair" = pressionar (pointerdown) e clicar. Devolve o evento de clique (para saber se foi interceptado).
const press = (t, el, init = {}) => el.dispatchEvent(new t.w.MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
const clickEvent = (t, el, init = {}) => { const e = new t.w.MouseEvent('click', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
const exit = async (t, el, { wait = 60 } = {}) => { press(t, el); const e = clickEvent(t, el); await tick(wait); return e; };
const total = (tabs) => tabs.reduce((n, t) => n + t.posts.length, 0);

test('mounts and READS the real-shaped cart, but a page with a cart writes NOTHING by itself (0 posts, no listener work)', async () => {
  const t = setup(); await tick(400);
  assert.equal(t.posts.length, 0);
  setCart(t.doc, TWO_QTY); await tick(1300);
  assert.equal(t.posts.length, 0, 'a quantity change alone never writes');
});

test('the transferred snapshot is the real-shaped cart (credentials omitted, no Cookie/CSRF anywhere) and it is created ON EXIT', async () => {
  const t = setup(); await tick(200);
  const link = addOurLink(t);
  const e = await exit(t, link, { wait: 200 });
  assert.equal(t.posts.length, 1); assert.equal(e.__prevented, true, 'the click waits (bounded) for the token');
  const p = t.posts[0];
  assert.equal(p.url, '/__origens/cart-ref'); assert.equal(p.method, 'POST'); assert.equal(p.credentials, 'omit'); assert.deepEqual(Object.keys(p.headers), ['content-type']);
  assert.deepEqual(JSON.parse(p.body), { v: 1, count: 1, items: [{ productId: '4932916', name: 'Serra Catarinense', color: 'Preta', size: 'M', variant: 'Preta-Masculino-M', quantity: 1, linePriceText: 'R$ 109,90', linePrice: 109.9, listPriceText: '', listPrice: null, image: IMG }], subtotal: 109.9, discount: 0, totalText: '', total: null });
  assert.ok(!/csrf|authenticity|cookie|token/i.test(p.body));
  assert.equal(t.navs.length, 1); assert.equal(new URL(t.navs[0].href).searchParams.get('cart_ref'), REF, 'navigates WITH the token');
  assert.deepEqual(t.stats().writes, 1);
});

test('KV: 100 product pageviews (full loads) with an unchanged cart => 0 writes', async () => {
  let posts = 0;
  for (let batch = 0; batch < 5; batch++) {
    const tabs = Array.from({ length: 20 }, () => setup({ cart: promoCart() }));
    await tick(200);
    posts += total(tabs);
  }
  assert.equal(posts, 0);
});
const promoCart = () => PROMO;

test('KV: opening and closing the drawer 20 times, Turbo frame events, searches and Turbo visits => 0 writes', async () => {
  const t = setup(); await tick(200);
  const drawer = t.doc.querySelector('.cart-drawer');
  for (let i = 0; i < 20; i++) {
    drawer.classList.add('open'); for (const n of ['turbo:frame-render', 'turbo:frame-load', 'turbo:before-stream-render']) t.doc.dispatchEvent(new t.w.Event(n)); await tick(40);
    drawer.classList.remove('open'); t.doc.dispatchEvent(new t.w.Event('turbo:load'));
  }
  for (let i = 0; i < 10; i++) { t.w.history.pushState({}, '', ALLOWED); t.doc.dispatchEvent(new t.w.Event('turbo:render')); }
  await tick(1300);
  assert.equal(t.posts.length, 0); assert.deepEqual(t.stats().writes, 0);
});

test('KV: the SAME cart transferred 5 times in a row (and after a reload of the tab) => exactly 1 write; the token is reused, never renewed', async () => {
  const t = setup(); await tick(200);
  const link = addOurLink(t);
  await exit(t, link, { wait: 150 });
  assert.equal(t.posts.length, 1);
  const hrefs = [];
  for (let i = 0; i < 4; i++) { const e = await exit(t, link, { wait: 20 }); assert.equal(e.__prevented, false, 'reuse never waits nor intercepts'); hrefs.push(new URL(link.href).searchParams.get('cart_ref')); }
  assert.equal(t.posts.length, 1); assert.deepEqual(hrefs, [REF, REF, REF, REF]); assert.equal(t.stats().reused, 4);
  // recarregar a MESMA aba (sessionStorage preservado) e sair de novo: continua 1 write no total
  const again = setup({ carry: t.storage() }); await tick(200);
  const l2 = addOurLink(again); await exit(again, l2, { wait: 20 });
  assert.equal(again.posts.length, 0); assert.equal(new URL(l2.href).searchParams.get('cart_ref'), REF);
  const stored = JSON.parse(again.storage()['origens:mirror:v1']); assert.deepEqual(Object.keys(stored).sort(), ['at', 'fp', 'ref']);
  assert.ok(!JSON.stringify(stored).match(/Serra|R\$|Preta/), 'the session holds only a fingerprint, the token and a timestamp');
});

test('KV: a CHANGED cart (quantity, then another item) => one new write per transferred state, never per event; the token TTL is never extended', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 1);
  const at1 = JSON.parse(t.storage()['origens:mirror:v1']).at;
  setCart(t.doc, TWO_QTY); await tick(1200); assert.equal(t.posts.length, 1, 'the mutation alone does not write');
  await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 2);
  assert.equal(JSON.parse(t.posts[1].body).items[0].quantity, 2); assert.equal(JSON.parse(t.posts[1].body).items[0].linePriceText, 'R$ 219,80'); assert.equal(JSON.parse(t.posts[1].body).subtotal, 219.8);
  await exit(t, link, { wait: 20 }); await exit(t, link, { wait: 20 }); assert.equal(t.posts.length, 2);
  setCart(t.doc, PROMO); await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 3);
  assert.equal(JSON.parse(t.storage()['origens:mirror:v1']).at >= at1, true);
});

test('quick click right after a mutation (still inside any debounce) transfers the NEW state, never a stale one; two rapid clicks dedupe to one write', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  setCart(t.doc, TWO_QTY); // sem esperar nada
  press(t, link); clickEvent(t, link); clickEvent(t, link); // duas saídas simultâneas do mesmo estado
  await tick(200);
  assert.equal(t.posts.length, 1, 'concurrent exits share one write');
  assert.equal(JSON.parse(t.posts[0].body).items[0].quantity, 2);
  assert.equal(t.navs.length >= 1, true);
});

test('KV: two tabs are independent (no cross-tab claim): each tab that transfers writes once; a tab never reuses another tab\'s token', async () => {
  const a = setup({ fetchImpl: ok(REF) }); const b = setup({ fetchImpl: ok(REF2) }); await tick(200);
  await exit(a, addOurLink(a), { wait: 150 }); await exit(b, addOurLink(b), { wait: 150 });
  assert.equal(a.posts.length, 1); assert.equal(b.posts.length, 1);
  assert.equal(new URL(a.navs[0].href).searchParams.get('cart_ref'), REF); assert.equal(new URL(b.navs[0].href).searchParams.get('cart_ref'), REF2);
});

test('empty cart: no prior token => nothing written and a plain link; after a non-empty transfer, emptying the cart writes ONE empty snapshot (then reuses it)', async () => {
  const fresh = setup({ cart: EMPTY }); await tick(200);
  const l = addOurLink(fresh); const e = await exit(fresh, l, { wait: 30 });
  assert.equal(fresh.posts.length, 0); assert.equal(e.__prevented, false); assert.equal(new URL(l.href).searchParams.has('cart_ref'), false);
  const t = setup(); await tick(200); const link = addOurLink(t);
  await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 1);
  setCart(t.doc, EMPTY); await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 2);
  assert.deepEqual(JSON.parse(t.posts[1].body), { v: 1, count: 0, items: [], subtotal: null, discount: null, totalText: '', total: null });
  await exit(t, link, { wait: 20 }); await exit(t, link, { wait: 20 }); assert.equal(t.posts.length, 2, 'empty-cart opens/exits never keep creating empty snapshots');
});

for (const [name, impl] of [
  ['429', () => new Response('{"error":"rate_limited"}', { status: 429 })],
  ['500', () => new Response('x', { status: 500 })],
  ['503 (KV down)', () => new Response('{"error":"unavailable"}', { status: 503 })],
  ['invalid JSON', () => new Response('lixo', { status: 201 })],
  ['bad token shape', () => new Response(JSON.stringify({ ref: '../../x' }), { status: 201 })],
  ['network error', () => { throw new Error('rede'); }]
]) {
  test('KV failure (' + name + '): the exit navigates normally WITHOUT a token, the cart is untouched, no retry loop', async () => {
    const t = setup({ fetchImpl: impl }); await tick(200); const link = addOurLink(t);
    await exit(t, link, { wait: 200 });
    assert.equal(t.navs.length, 1); assert.equal(new URL(t.navs[0].href).searchParams.has('cart_ref'), false);
    assert.equal(t.doc.querySelectorAll('li.main-list__item').length, 1);
    await exit(t, link, { wait: 200 }); await exit(t, link, { wait: 200 });
    assert.equal(t.posts.length, 1, 'cool-down: no hammering after a failure for the same state');
    assert.ok(t.stats().failures >= 1);
  });
}

test('KV timeout: a POST that never answers holds the exit for at most ~1.2 s, then navigates without a token', async () => {
  const t = setup({ fetchImpl: () => new Promise(() => {}) }); await tick(200); const link = addOurLink(t);
  const t0 = Date.now(); press(t, link); clickEvent(t, link);
  while (t.navs.length === 0 && Date.now() - t0 < 3000) await tick(50);
  const waited = Date.now() - t0;
  assert.equal(t.navs.length, 1); assert.ok(waited >= 1100 && waited < 1800, 'waited ' + waited + ' ms');
  assert.equal(new URL(t.navs[0].href).searchParams.has('cart_ref'), false);
});

test('an expired token (older than 25 min) is discarded: the next exit writes a fresh snapshot instead of reusing it', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  await exit(t, link, { wait: 150 }); const session = JSON.parse(t.storage()['origens:mirror:v1']);
  const old = setup({ carry: { 'origens:mirror:v1': JSON.stringify({ ...session, at: Date.now() - 26 * 60 * 1000 }) }, fetchImpl: ok(REF2) }); await tick(200);
  const l2 = addOurLink(old); await exit(old, l2, { wait: 150 });
  assert.equal(old.posts.length, 1); assert.equal(new URL(old.navs[0].href).searchParams.get('cart_ref'), REF2);
  const stale = setup({ carry: { 'origens:mirror:v1': 'não é json' } }); await tick(200);
  await exit(stale, addOurLink(stale), { wait: 150 }); assert.equal(stale.posts.length, 1, 'a corrupt session entry is ignored');
});

test('new-tab / shortcut clicks never wait or write; with a reusable token they are decorated, without one they go plain', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) { const e = clickEvent(t, link, init); assert.equal(e.__prevented, false); }
  assert.equal(t.posts.length, 0); assert.equal(new URL(link.href).searchParams.has('cart_ref'), false);
  await exit(t, link, { wait: 150 });
  const e = clickEvent(t, link, { ctrlKey: true }); assert.equal(e.__prevented, false); assert.equal(new URL(link.href).searchParams.get('cart_ref'), REF); assert.equal(t.posts.length, 1);
});

test('only OUR links to the storefront are touched; INK links, other hosts and other storefront paths never are', async () => {
  const t = setup(); await tick(200);
  t.doc.body.insertAdjacentHTML('beforeend', '<section data-origens-discovery="cart"><a id="city" href="https://useorigens.com.br/sul/sc/florianopolis">y</a><a id="evil" href="https://evil.example/sul">z</a><a id="other" href="https://useorigens.com.br/outra">o</a></section><a id="ink" href="https://useorigens.com.br/sul">nativo</a>');
  for (const id of ['evil', 'other', 'ink']) { const e = await exit(t, t.doc.getElementById(id), { wait: 20 }); assert.equal(e.__prevented, false); }
  assert.equal(t.posts.length, 0); assert.equal(t.doc.getElementById('ink').href, 'https://useorigens.com.br/sul'); assert.equal(t.doc.getElementById('evil').href, 'https://evil.example/sul');
  await exit(t, t.doc.getElementById('city'), { wait: 150 });
  assert.equal(t.posts.length, 1); assert.equal(new URL(t.navs.at(-1).href).pathname, '/sul/sc/florianopolis'); assert.equal(new URL(t.navs.at(-1).href).searchParams.get('cart_ref'), REF);
});

test('leaving the allowlisted route stops everything: no more posts, no decoration, no interception', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + OTHER } })); t.w.history.pushState({}, '', OTHER); await tick(200);
  const e = await exit(t, link, { wait: 50 });
  assert.equal(t.posts.length, 0); assert.equal(e.__prevented, false); assert.equal(link.href, 'https://useorigens.com.br/sul');
});

test('another product / cart / checkout never reads or posts anything', async () => {
  for (const path of [OTHER, '/usesul/cart', '/usesul/checkout', '/usesul']) { const t = setup({ path }); await tick(200); const l = addOurLink(t); await exit(t, l, { wait: 30 }); assert.equal(t.posts.length, 0, path); }
});

test('unknown structure (no rows and no empty state, or rows without the expected form) is never transferred', async () => {
  for (const html of ['<turbo-frame id="cart"><p>carregando</p></turbo-frame>', frame(1, '<li class="main-list__item"><p>x</p></li>', '1')]) {
    const t = setup({ cart: html }); await tick(200); const l = addOurLink(t); const e = await exit(t, l, { wait: 40 });
    assert.equal(t.posts.length, 0); assert.equal(e.__prevented, false);
  }
});

test('quantity promotion: the EFFECTIVE line price is read (not the struck list price), list price and the displayed total are kept separately', async () => {
  const t = setup({ cart: PROMO }); await tick(200); await exit(t, addOurLink(t), { wait: 150 });
  assert.equal(t.posts.length, 1);
  const body = JSON.parse(t.posts[0].body);
  assert.equal(body.count, 4); assert.equal(body.items.length, 4);
  for (const it of body.items) { assert.equal(it.linePriceText, 'R$ 99,90'); assert.equal(it.linePrice, 99.9); assert.equal(it.listPriceText, 'R$ 109,90'); assert.equal(it.listPrice, 109.9); }
  assert.deepEqual(body.items.map((i) => i.variant), ['v1', 'v2', 'v3', 'v4']);
  assert.equal(body.subtotal, 439.6); assert.equal(body.discount, 40); assert.equal(body.totalText, 'R$ 399,60'); assert.equal(body.total, 399.6);
});

test('a cart with 20 lines (the server limit) is sent whole in ONE write', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => promoItem(i + 1)).join('');
  const t = setup({ cart: frame(20, rows, '2196', '0.0', 'R$ 2.196,00') }); await tick(200); await exit(t, addOurLink(t), { wait: 150 });
  assert.equal(t.posts.length, 1); assert.equal(JSON.parse(t.posts[0].body).items.length, 20);
});

test('the fingerprint ignores cosmetic DOM changes (classes, image src, whitespace) but reacts to variant, quantity and displayed prices', async () => {
  const t = setup(); await tick(200); const link = addOurLink(t);
  await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 1);
  const li = t.doc.querySelector('li.main-list__item'); li.className += ' novo-estilo'; li.querySelector('img').setAttribute('src', IMG + '?x=1'); li.querySelector('.item-details p').textContent = '  Serra   Catarinense ';
  await exit(t, link, { wait: 20 }); assert.equal(t.posts.length, 1, 'cosmetic changes do not write');
  t.doc.querySelector('form[data-ink-store--cart-product-variant-value]').setAttribute('data-ink-store--cart-product-variant-value', 'Branca-Masculino-M');
  await exit(t, link, { wait: 150 }); assert.equal(t.posts.length, 2, 'a variant change does');
});

test('the mirror module reads only: no cookie/localStorage/indexedDB, sessionStorage only under its single key, no HTML injection, no cart mutation endpoints', () => {
  const module = CART_MIRROR;
  for (const forbidden of [/document\.cookie|localStorage|indexedDB/, /innerHTML|insertAdjacentHTML|document\.write|\beval\(/, /\/usesul\/cart\/item|checkout_cart_items|\/usesul\/cart\?/, /authenticity_token|csrf/i]) assert.doesNotMatch(module, forbidden, String(forbidden));
  assert.equal((module.match(/sessionStorage/g) || []).length, 2, 'exactly one read and one write of the session entry');
  assert.match(module, /const SESSION_KEY = 'origens:mirror:v1'/); assert.match(module, /credentials: 'omit'/);
  assert.doesNotMatch(module, /setInterval|MutationObserver/, 'no polling, no observers: nothing runs unless the visitor exits');
});
