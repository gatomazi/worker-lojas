import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { createCartRefs } from '../src/cart-ref.js';

// Custo do KV ponta a ponta: o cliente REAL (jsdom) fala com o módulo cart-ref REAL (o mesmo do Worker) sobre um KV instrumentado.
// Cada KV.put é contado no armazenamento, não no cliente.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/bah-dizeres'; const OTHER = '/usesul/product/paranaense-essencia';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const row = (id, qty, price, variant = 'Preta-Masculino-M', name = 'Bah') => '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>' + name + '</p><p>Preta</p><p>M</p></div><div class="price-details"><span>' + price + '</span></div><form data-ink-store--cart-product-id-value="' + id + '" data-ink-store--cart-product-variant-value="' + variant + '"><input name="cart_item[quantity]" value="' + qty + '"></form></li>';
const frame = (n, rows, subtotal) => '<turbo-frame id="cart"><div><span id="quantity-header" data-quantityheader="' + n + '">(' + n + ')</span><div class="cart-drawer__main"><ul>' + rows + '</ul></div><div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="' + subtotal + '"></div></div></div></turbo-frame>';
const CART1 = frame(1, row(4932916, 1, 'R$ 109,90'), '109.9');
const CART2 = frame(2, row(4932916, 2, 'R$ 219,80'), '219.8');
const PAGE = (cart) => PRODUCT.replace('</main>', '<div class="cart-drawer">' + cart + '</div></main>');

function world({ failKv = false } = {}) {
  const puts = []; const store = new Map();
  const kv = { async put(key, value, options) { if (failKv) throw new Error('KV put limit'); puts.push({ key, ttl: options.expirationTtl }); store.set(key, value); }, async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); } };
  const refs = createCartRefs();
  const backend = (url, options) => refs.create(new Request(HOST + url, { method: options.method, body: options.body, headers: { 'content-type': 'application/json', origin: HOST, referer: HOST + P, 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.7' } }), { kv, allowedPaths: [], pathAllowed: (p) => /^\/usesul\/product\/[a-z0-9_-]+$/.test(p), origin: HOST });
  const tab = ({ cart = CART1, path = P, carry = null } = {}) => {
    const navs = []; let last = null;
    const virtualConsole = new (JSDOM.VirtualConsole || (class { on() {} }))();
    const dom = new JSDOM(PAGE(cart), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
    w.fetch = async (url, options = {}) => backend(String(url), options);
    const t = { w, doc: w.document, navs };
    w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) { last = a; if (!e.defaultPrevented) { navs.push(a.href); e.preventDefault(); } } });
    w.eval(buildLoaderSource([], ['return-link', 'cart-mirror'], 'product-catalog'));
    t.link = () => { if (!w.document.getElementById('o')) w.document.body.insertAdjacentHTML('beforeend', '<section data-origens-discovery="cart"><a id="o" href="https://useorigens.com.br/sul">x</a></section>'); return w.document.getElementById('o'); };
    t.exit = async () => { const a = t.link(); a.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await tick(120); };
    t.session = () => Object.fromEntries(Array.from({ length: w.sessionStorage.length }, (_, i) => [w.sessionStorage.key(i), w.sessionStorage.getItem(w.sessionStorage.key(i))]));
    return t;
  };
  return { puts, store, refs, tab };
}

test('KV puts, end to end (catalog scope, real client + real cart-ref module): 100 pageviews => 0; 20 drawer opens => 0; 5 unchanged transfers => 1; 1 changed transfer => +1', async () => {
  const w = world(); const report = {};
  // 100 pageviews de produtos diferentes com carrinho (nenhum vira write)
  for (let b = 0; b < 5; b++) { const tabs = Array.from({ length: 20 }, (_, i) => w.tab({ path: i % 2 ? P : OTHER })); await tick(200); }
  report.pageviews100 = w.puts.length;
  const t = w.tab(); await tick(200);
  for (let i = 0; i < 20; i++) { t.doc.querySelector('.cart-drawer').classList.toggle('open'); t.doc.dispatchEvent(new t.w.Event('turbo:frame-render')); }
  await tick(1200); report.opens20 = w.puts.length;
  for (let i = 0; i < 5; i++) await t.exit();
  report.sameCart5 = w.puts.length;
  t.doc.querySelector('.cart-drawer').innerHTML = CART2; await tick(1000); assert.equal(w.puts.length, 1, 'the mutation itself did not write');
  await t.exit(); report.afterChange = w.puts.length;
  console.log('KV_REPORT ' + JSON.stringify(report));
  assert.deepEqual(report, { pageviews100: 0, opens20: 0, sameCart5: 1, afterChange: 2 });
  assert.ok(w.puts.every((p) => p.ttl === 1800), 'every key keeps the 30 min TTL');
  assert.deepEqual(w.refs.stats().writes, 2);
});

test('KV down (put throws): every exit still navigates to the storefront, the cart is untouched, and nothing throws in the page', async () => {
  const w = world({ failKv: true }); const t = w.tab(); await tick(200);
  const errors = []; t.w.addEventListener('error', (e) => errors.push(e.message));
  await t.exit(); await t.exit();
  assert.equal(w.puts.length, 0); assert.equal(errors.length, 0);
  assert.equal(t.doc.querySelectorAll('li.main-list__item').length, 1);
  assert.deepEqual(w.refs.stats().write_failures, 1, 'one attempt, then the client cool-down (no hammering)');
});

test('the storefront can read what the client wrote: the reused token still resolves to the same snapshot', async () => {
  const w = world(); const t = w.tab(); await tick(200); await t.exit(); await t.exit();
  const ref = new URL(t.link().href).searchParams.get('cart_ref');
  const res = await w.refs.read(new Request(HOST + '/__origens/cart-ref/' + ref), { kv: { get: async (k, ty) => JSON.parse(w.store.get(k)) }, token: ref });
  assert.equal(res.status, 200); const body = await res.json(); assert.equal(body.items[0].quantity, 1); assert.equal(w.puts.length, 1);
});
