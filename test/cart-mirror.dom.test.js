import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// Leitor estrutural do carrinho da INK (turbo-frame#cart) + sincronização com o backend cart-ref (jsdom).
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const ALLOWED = '/usesul/product/serra-catarinense'; const OTHER = '/usesul/product/vida-no-sul-estancia-edition'; const HOST = 'https://www.usesul.com.br';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';

const item = (id, qty, price, name = 'Serra Catarinense') => '<li class="main-list__item"><img src="' + IMG + '" alt="Imagem do produto"><div class="item-wrapper"><header><div class="item-details"><p>' + name + '</p><p>Preta</p><p>M</p></div>' +
  '<div class="price-details"><div class="price"><span>' + price + '</span></div></div></header><div class="item-details__footer"><form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M" data-ink-store--cart-id-value="cart_item_' + id + '" action="/usesul/cart/item" method="post">' +
  '<div id="quantity-buttons"><input class="quantity-input" type="text" value="' + qty + '" name="cart_item[quantity]"></div></form></div></div></li>';
const frame = (n, rows, subtotal) => '<turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="' + n + '">(' + n + ' produto' + (n === 1 ? '' : 's') + ')</span></span></div>' +
  '<div class="cart-drawer__main"><ul>' + rows + '</ul></div><div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="' + subtotal + '"><span id="amount">x</span></div></div></div></turbo-frame>';
const ONE = frame(1, item(1, 1, 'R$ 109,90'), '109.9');
const TWO_QTY = frame(2, item(1, 2, 'R$ 219,80'), '219.8');
const EMPTY = '<turbo-frame id="cart"><turbo-frame id="cart"><div><header class="cart-drawer__header"><span>(0 produtos)</span></header><div class="empty-cart"><span>Seu carrinho está vazio</span></div></div></turbo-frame></turbo-frame>';
const PAGE = (cart) => PRODUCT.replace('</main>', '<div class="cart-drawer">' + cart + '</div></main>');

function setup({ cart = ONE, path = ALLOWED, features = ['return-link', 'cart-mirror'], fetchImpl } = {}) {
  const dom = new JSDOM(PAGE(cart), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  const posts = [];
  w.fetch = async (url, options = {}) => { posts.push({ url: String(url), method: options.method, credentials: options.credentials, headers: options.headers, body: options.body }); if (options.signal && options.signal.aborted) throw new w.DOMException('aborted', 'AbortError'); return (fetchImpl || (() => new Response(JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }), { status: 201 })))(); };
  const navigations = []; w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { navigations.push(a.href); e.preventDefault(); } });
  w.eval(buildLoaderSource([ALLOWED], features));
  return { w, doc: w.document, posts, navigations };
}
const setCart = (doc, html) => { doc.querySelector('.cart-drawer').innerHTML = html; };
const REF = 'AbCdEfGhIjKlMnOpQrStUv';

test('reads the real-shaped cart structurally and syncs ONE snapshot (credentials omitted, no Cookie/CSRF anywhere)', async () => {
  const t = setup(); await tick(1300);
  assert.equal(t.posts.length, 1);
  const p = t.posts[0];
  assert.equal(p.url, '/__origens/cart-ref'); assert.equal(p.method, 'POST'); assert.equal(p.credentials, 'omit'); assert.deepEqual(Object.keys(p.headers), ['content-type']);
  const body = JSON.parse(p.body);
  assert.deepEqual(body, { v: 1, count: 1, items: [{ productId: '4932916', name: 'Serra Catarinense', color: 'Preta', size: 'M', variant: 'Preta-Masculino-M', quantity: 1, linePriceText: 'R$ 109,90', linePrice: 109.9, image: IMG }], subtotal: 109.9, discount: 0 });
  assert.ok(!/csrf|authenticity|cookie|token/i.test(p.body));
});

test('a quantity change is a new snapshot; identical state does not re-post (idempotent, debounced)', async () => {
  const t = setup(); await tick(1300); assert.equal(t.posts.length, 1);
  for (let i = 0; i < 5; i++) { t.doc.querySelector('.cart-drawer').setAttribute('data-x', String(i)); }
  await tick(1200); assert.equal(t.posts.length, 1, 'mutations that do not change the cart do not post');
  setCart(t.doc, TWO_QTY); await tick(1300);
  assert.equal(t.posts.length, 2);
  const body = JSON.parse(t.posts[1].body); assert.equal(body.count, 2); assert.equal(body.items[0].quantity, 2); assert.equal(body.items[0].linePriceText, 'R$ 219,80'); assert.equal(body.subtotal, 219.8);
});

test('removing the last item posts the empty snapshot (so the mirror clears); an empty cart with no prior ref posts nothing', async () => {
  const t = setup(); await tick(1300); setCart(t.doc, EMPTY); await tick(1300);
  assert.equal(t.posts.length, 2); assert.deepEqual(JSON.parse(t.posts[1].body), { v: 1, count: 0, items: [], subtotal: null, discount: null });
  const fresh = setup({ cart: EMPTY }); await tick(1300); assert.equal(fresh.posts.length, 0);
});

test('unknown structure (no rows and no empty state, or rows without the expected form) is never mirrored', async () => {
  const weird = setup({ cart: '<turbo-frame id="cart"><div>carregando…</div></turbo-frame>' }); await tick(1300); assert.equal(weird.posts.length, 0);
  const noForm = setup({ cart: '<turbo-frame id="cart"><ul><li class="main-list__item"><p>x</p></li></ul></turbo-frame>' }); await tick(1300); assert.equal(noForm.posts.length, 0);
});

test('only OUR links to the storefront get ?cart_ref=, at click time; INK links and other hosts never do', async () => {
  const t = setup(); await tick(1300);
  t.doc.body.insertAdjacentHTML('beforeend', '<section data-origens-discovery="cart"><a id="ours" href="https://useorigens.com.br/sul">x</a><a id="ours-city" href="https://useorigens.com.br/sul/sc/florianopolis">y</a><a id="ours-evil" href="https://evil.example/sul">z</a></section><a id="ink" href="https://useorigens.com.br/sul">nativo</a>');
  t.doc.getElementById('ours').click(); t.doc.getElementById('ours-city').click(); t.doc.getElementById('ours-evil').click(); t.doc.getElementById('ink').click();
  t.doc.getElementById('use-origens-return-link').click();
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul?cart_ref=' + REF, 'https://useorigens.com.br/sul/sc/florianopolis?cart_ref=' + REF, 'https://evil.example/sul', 'https://useorigens.com.br/sul', 'https://useorigens.com.br/sul?cart_ref=' + REF]);
});

test('no ref (backend down, 501, bad payload) => plain links, cart untouched, no errors surface', async () => {
  for (const impl of [() => new Response('{"error":"not_configured"}', { status: 501 }), () => new Response('lixo', { status: 201 }), () => new Response(JSON.stringify({ ref: '../../x' }), { status: 201 }), () => { throw new Error('rede'); }]) {
    const t = setup({ fetchImpl: impl }); await tick(1300);
    t.doc.getElementById('use-origens-return-link').click();
    assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul']);
    assert.equal(t.doc.querySelectorAll('li.main-list__item').length, 1);
  }
});

test('leaving the allowlisted route stops everything: no more posts, no decoration, ref forgotten', async () => {
  const t = setup(); await tick(1300); assert.equal(t.posts.length, 1);
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + OTHER } })); t.w.history.pushState({}, '', OTHER);
  setCart(t.doc, TWO_QTY); await tick(1300);
  assert.equal(t.posts.length, 1);
  t.doc.body.insertAdjacentHTML('beforeend', '<section data-origens-discovery="cart"><a id="ours" href="https://useorigens.com.br/sul">x</a></section>');
  t.doc.getElementById('ours').click(); assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul']);
});

test('another product / cart / checkout never reads or posts anything', async () => {
  for (const path of [OTHER, '/usesul/cart', '/usesul/checkout', '/usesul']) { const t = setup({ path }); await tick(1300); assert.equal(t.posts.length, 0, path); }
});

test('the mirror module reads only: no click interception on native controls, no storage/cookies, no HTML injection, no cart mutation endpoints', () => {
  const src = buildLoaderSource([ALLOWED], ['return-link', 'cart-mirror']);
  const module = src.slice(src.indexOf('MIRROR_ENDPOINT'));
  for (const forbidden of [/document\.cookie|localStorage|sessionStorage|indexedDB/, /innerHTML|insertAdjacentHTML|document\.write|\beval\(/, /\/usesul\/cart\/item|checkout_cart_items|\/usesul\/cart\?/, /authenticity_token|csrf/i, /\.click\(\)|\.submit\(/]) assert.doesNotMatch(module, forbidden, String(forbidden));
  assert.match(module, /credentials: 'omit'/);
});
