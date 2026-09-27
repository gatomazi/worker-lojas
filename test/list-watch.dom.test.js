import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures } from '../src/features.js';

// list-session (list-watch.js): "Sua próxima camiseta" no drawer pós-adição, ligada à sessão de "Meus Lugares".
// Mesmo desenho de teste de discovery.dom.test.js: jsdom sem layout real, getClientRects simulado, o Worker é
// só o dono do id do produto no path (o gateway /__origens/list-session é testado à parte, no workerd).
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const ALLOWED = '/usesul/product/serra-catarinense';
const HOST = 'https://www.usesul.com.br';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));

const DRAWER = '<div id="modal-wrapper" class="add-product-modal" role="dialog" aria-modal="true"><div class="relative w-full"><div class="w-full p-4">' +
  '<div class="flex"><h3>Produto adicionado ao carrinho</h3><button id="modal-close-button"></button></div>' +
  '<div class="flex flex-col add-product-modal__modal-content__footer"><button class="flex checkout-btn"><span>Ver carrinho</span></button><button id="continue-shopping-button"><span>Continuar comprando</span></button></div>' +
  '<turbo-frame id="most_sold_frame"><h3>As mais vendidas</h3></turbo-frame></div></div></div>';
const PAGE = PRODUCT.replace('</main>', '<turbo-frame id="last_added_product"></turbo-frame></main>');

const TOKEN = 'eyJ2IjoxLCJzIjoidXNlLXN1bCIsInAiOlsiMTExIl0sInQiOjF9.abcdef0123456789';
const NEXT = { inkProductId: '222', title: 'Feito em Florianópolis', imageUrl: 'https://gcp-images.majestic.ink.rsvcloud.com/images/x.jpg', url: 'https://www.usesul.com.br/usesul/product/produto-222' };
const GOOD = { next: NEXT, position: 0, total: 2 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup({ path = ALLOWED, search = '', features = ['return-link', 'list-session'], fetchImpl, carry = null } = {}) {
  const dom = new JSDOM(PAGE, { url: HOST + path + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; }
    return [{}];
  };
  if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
  const fetchCalls = [];
  w.fetch = (url, options = {}) => {
    fetchCalls.push({ url: String(url), credentials: options.credentials, headers: options.headers });
    return Promise.resolve((fetchImpl || (() => json(GOOD)))(String(url)));
  };
  w.eval(buildLoaderSource([ALLOWED], features));
  return { dom, w, doc: w.document, fetchCalls };
}

const openDrawer = (doc) => { doc.getElementById('last_added_product').innerHTML = DRAWER; };
const closeDrawer = (doc) => { doc.getElementById('last_added_product').innerHTML = ''; };
const card = (doc) => doc.querySelector('[data-origens-list-session]');
const lsCalls = (t) => t.fetchCalls.filter((f) => f.url.includes('/__origens/list-session'));

test('list-session is a known feature; the bundle contains the module only when it is enabled', () => {
  assert.equal(parseFeatures('list-session').status, 'ok');
  assert.match(buildLoaderSource([ALLOWED], ['list-session']), /id: 'list-session'/);
  assert.doesNotMatch(buildLoaderSource([ALLOWED], ['return-link', 'cart-mirror']), /id: 'list-session'|origens-list-session/);
});

test('without ?ls= and nothing carried over, opening the drawer does nothing (no fetch, no card, native drawer intact)', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc); await tick(200);
  assert.equal(card(t.doc), null);
  assert.equal(lsCalls(t).length, 0);
});

test('with ?ls=<token>, a confirmed add mounts the card between the native buttons and "As mais vendidas", and strips ?ls from the URL', async () => {
  const t = setup({ search: '?ls=' + TOKEN }); await tick();
  assert.equal(t.w.location.search, '', '?ls is removed before the drawer even opens (mirrors ?cart_ref stripping)');
  assert.equal(t.w.sessionStorage.getItem('origens:ls'), TOKEN);
  openDrawer(t.doc); await tick(200);
  const root = card(t.doc);
  assert.ok(root);
  const wrapper = t.doc.getElementById('modal-wrapper');
  assert.equal(root.previousElementSibling, wrapper.querySelector('.add-product-modal__modal-content__footer'));
  assert.equal(root.nextElementSibling, wrapper.querySelector('#most_sold_frame'));
  assert.equal(root.querySelector('.o-ls-eyebrow').textContent, 'Sua próxima camiseta');
  assert.equal(root.querySelector('.o-ls-title').textContent, NEXT.title);
  assert.equal(root.querySelector('.o-ls-progress').textContent, '1 de 2');
  assert.equal(root.querySelector('img').getAttribute('src'), NEXT.imageUrl);
  const cta = root.querySelector('.o-ls-cta');
  assert.equal(cta.textContent, 'Ver próxima →');
  assert.equal(new URL(cta.href).origin + new URL(cta.href).pathname, NEXT.url);
  assert.equal(new URL(cta.href).searchParams.get('ls'), TOKEN, 'the token rides along to the next product page too');
});

test('the current page\'s product id is marked done and sent to the gateway (the drawer opening IS the confirmed-add signal)', async () => {
  const t = setup({ search: '?ls=' + TOKEN }); await tick();
  openDrawer(t.doc); await tick(200);
  const call = lsCalls(t)[0];
  assert.ok(call, 'one call to the gateway');
  const url = new URL(call.url, HOST);
  assert.equal(url.searchParams.get('ls'), TOKEN);
  assert.equal(url.searchParams.get('done'), '0', 'form-product-0 on this fixture: the product just confirmed added');
  assert.equal(call.credentials, 'omit');
});

test('a session carried over from a previous page (sessionStorage, no ?ls in this URL) still works', async () => {
  const t = setup({ carry: { 'origens:ls': TOKEN } }); await tick();
  openDrawer(t.doc); await tick(200);
  assert.ok(card(t.doc));
  assert.equal(lsCalls(t)[0] && new URL(lsCalls(t)[0].url, HOST).searchParams.get('ls'), TOKEN);
});

test('every item already done (gateway returns next:null): no card, no false suggestion, drawer stays native', async () => {
  const t = setup({ search: '?ls=' + TOKEN, fetchImpl: () => json({ next: null, position: 2, total: 2 }) }); await tick();
  openDrawer(t.doc); await tick(200);
  assert.equal(card(t.doc), null);
});

test('gateway error/timeout/garbage never throws and never shows a card', async () => {
  for (const impl of [() => json({ error: 'x' }, 503), () => new Response('nope', { status: 500 }), () => { throw new Error('offline'); }]) {
    const t = setup({ search: '?ls=' + TOKEN, fetchImpl: impl });
    await tick();
    openDrawer(t.doc); await tick(200);
    assert.equal(card(t.doc), null);
  }
});

test('a malformed ?ls= in the URL is dropped (not persisted, no fetch) — same discipline as ?cart_ref', async () => {
  const t = setup({ search: '?ls=not valid!!' }); await tick();
  assert.equal(t.w.sessionStorage.getItem('origens:ls'), null);
  openDrawer(t.doc); await tick(200);
  assert.equal(lsCalls(t).length, 0);
});

test('idempotent: a minor DOM change inside the SAME wrapper never duplicates the card or refetches while it is already showing', async () => {
  const t = setup({ search: '?ls=' + TOKEN }); await tick();
  openDrawer(t.doc); await tick(200);
  assert.equal(t.doc.querySelectorAll('[data-origens-list-session]').length, 1);
  const calls1 = lsCalls(t).length;
  // A mutation inside the SAME wrapper (INK re-rendering a sibling, e.g.) re-triggers the observer, but the card
  // is still right there: check() must see it and return early, not fetch or insert a second one.
  t.doc.getElementById('modal-wrapper').setAttribute('data-noise', '1'); await tick(150);
  assert.equal(t.doc.querySelectorAll('[data-origens-list-session]').length, 1);
  assert.equal(lsCalls(t).length, calls1);
  closeDrawer(t.doc); await tick(100);
  assert.equal(card(t.doc), null, 'unmounts when the drawer really closes');
});

test('a whole new drawer (Turbo replaces #last_added_product) ends with exactly one card, never two', async () => {
  const t = setup({ search: '?ls=' + TOKEN }); await tick();
  openDrawer(t.doc); await tick(200);
  openDrawer(t.doc); await tick(200); // a fresh wrapper node entirely: legitimately re-fetched and re-rendered
  assert.equal(t.doc.querySelectorAll('[data-origens-list-session]').length, 1);
});

test('not mounted on a page outside the allowlist', async () => {
  const t = setup({ path: '/usesul/product/outro-produto', search: '?ls=' + TOKEN }); await tick(200);
  openDrawer(t.doc); await tick(200);
  assert.equal(card(t.doc), null);
  assert.equal(lsCalls(t).length, 0);
});
