import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// auto-recommendations no navegador (jsdom): PDP com a estrutura real auditada (formulário nativo + "Compre Junto" com um 2º form no modal).
const FIXTURE = readFileSync(new URL('./fixtures/product-page-buy-together.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/florianopolis-origem-sc-0faeb956-3b10-4a06-8f93-2c9cff8d1afb';
const GA = 'G-8GYTEJ1F77';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id, extra = {}) => ({ productId: String(id), title: 'Florianópolis · Feito em ' + id, image: IMG + id + '.webp', price: 109.9, href: HOST + '/usesul/product/feito-em-' + id, reason: 'same-locality:feito-em', ...extra });
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const block = (doc) => doc.querySelectorAll('[data-origens-reco]');

function setup({ features = ['auto-recommendations'], items = [item(1), item(2), item(3), item(4)], status = 200, html = FIXTURE, hang = false, cookieNotice = false } = {}) {
  html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  if (cookieNotice) html = html.replace('<main>', '<div class="cookie-acceptance"><button>Aceitar cookies</button></div><main>');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const fetchCalls = [];
  w.fetch = (url, options = {}) => {
    fetchCalls.push({ url: String(url), credentials: options.credentials, method: options.method || 'GET' });
    if (hang) return new Promise((_, reject) => options.signal && options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return Promise.resolve(new Response(JSON.stringify({ items }), { status, headers: { 'content-type': 'application/json' } }));
  };
  const navigations = []; w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { navigations.push(a.href); e.preventDefault(); } });
  w.eval(buildLoaderSource([], features, 'product-catalog'));
  return { w, doc: w.document, events, fetchCalls, navigations };
}

test('renders "Você também pode gostar" with 4 cards (image, title, price, "Ver produto"), right after the native "Compre Junto", before the description', async () => {
  const t = setup(); await tick();
  assert.equal(block(t.doc).length, 1);
  const root = block(t.doc)[0];
  assert.equal(root.querySelector('h2').textContent, 'Você também pode gostar');
  const cards = root.querySelectorAll('a.o-reco-card');
  assert.equal(cards.length, 4);
  assert.equal(cards[0].getAttribute('href'), HOST + '/usesul/product/feito-em-1');
  assert.equal(cards[0].querySelector('img').getAttribute('src'), IMG + '1.webp');
  assert.equal(cards[0].querySelector('img').getAttribute('loading'), 'lazy');
  assert.equal(cards[0].querySelector('.o-reco-name').textContent, 'Florianópolis · Feito em 1');
  assert.match(cards[0].querySelector('.o-reco-price').textContent, /R\$\s?109,90/);
  assert.equal(cards[0].querySelector('.o-reco-cta').textContent, 'Ver produto');
  assert.equal(root.querySelectorAll('button, form, input').length, 0, 'no cart button, no form');
  const together = t.doc.querySelector('section.buy-together');
  assert.equal(together.nextElementSibling, root, 'right after the native "Compre Junto"');
  assert.ok(root.compareDocumentPosition(t.doc.querySelector('.product-page__description')) & t.w.Node.DOCUMENT_POSITION_FOLLOWING, 'before the description');
  assert.ok(!together.hidden && together.isConnected, 'the native block is kept (V1: side by side for comparison)');
});

test('identifies the CURRENT product from the native form, never from the "Compre Junto" modal form; asks once, same origin, no credentials', async () => {
  const t = setup(); await tick();
  t.doc.body.appendChild(t.doc.createElement('div')); await tick(); // mutations re-run sync: still one request
  assert.deepEqual(t.fetchCalls.map((c) => [c.url, c.credentials, c.method]), [['/__origens/recommendations/3789929', 'omit', 'GET']]);
});

test('the purchase form, CSRF token, size selection and CTA are untouched', async () => {
  const before = new JSDOM(FIXTURE).window.document;
  const t = setup(); await tick();
  for (const sel of ['#form-product-3789929', '#form-product-3791940', 'section.buy-together']) assert.equal(t.doc.querySelector(sel).outerHTML, before.querySelector(sel).outerHTML, sel);
  assert.equal(t.doc.querySelector('input[name="authenticity_token"]').value, 'csrf-token-fixture');
  assert.ok(!t.doc.querySelector('#form-product-3789929').contains(block(t.doc)[0]));
});

test('fewer than 2 valid items, HTTP error, timeout or invalid links/images/prices: no DOM at all (PDP stays as INK draws it)', async () => {
  const cases = [
    { items: [item(1)] },
    { items: [] },
    { status: 500 },
    { items: [item(1, { href: 'https://evil.example/usesul/product/x' }), item(2, { image: 'http://insecure/x.jpg' }), item(3, { price: 0 }), item(4)] },
    { items: [item(3789929), item(5)] }
  ];
  for (const c of cases) {
    const t = setup(c); await tick();
    assert.equal(block(t.doc).length, 0, JSON.stringify(c).slice(0, 80));
    assert.equal(t.doc.getElementById('use-origens-reco-style'), null, 'not even the style');
  }
  const slow = setup({ hang: true }); await tick(3300);
  assert.equal(block(slow.doc).length, 0, 'timeout: nothing, no infinite skeleton');
});

test('flag off: no request and no DOM', async () => {
  const t = setup({ features: ['return-link'] }); await tick();
  assert.equal(t.fetchCalls.filter((c) => c.url.includes('recommendations')).length, 0);
  assert.equal(block(t.doc).length, 0);
});

test('click navigates normally (same tab, real INK link) and sends ONE custom GA4 event only after the cookie notice was accepted', async () => {
  const t = setup(); await tick();
  const card = block(t.doc)[0].querySelectorAll('a.o-reco-card')[1];
  card.querySelector('.o-reco-name').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.deepEqual(t.navigations, [HOST + '/usesul/product/feito-em-2']);
  assert.equal(card.getAttribute('target'), null);
  assert.deepEqual(t.events, [['event', 'origens_recommendation_click', { send_to: GA, region: 'sul', transport_type: 'beacon', source_product_id: '3789929', recommended_product_id: '2', position: 2, reason: 'same-locality:feito-em' }]]);
  assert.ok(!t.events.some((e) => /add_to_cart|view_item|purchase|AddToCart|ViewContent|Purchase/.test(JSON.stringify(e))));
  const gated = setup({ cookieNotice: true }); await tick();
  block(gated.doc)[0].querySelector('a.o-reco-card').dispatchEvent(new gated.w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(gated.events.length, 0, 'no measurement before the INK cookie notice is accepted');
  assert.equal(gated.navigations.length, 1, 'navigation is never blocked');
});

test('Turbo: leaving to a non-product page removes the block; coming back re-renders from memory without a new request', async () => {
  const t = setup(); await tick();
  assert.equal(block(t.doc).length, 1);
  const main = t.doc.querySelector('main');
  const saved = main.innerHTML;
  t.w.history.pushState({}, '', '/usesul/collections/fala-daqui'); main.innerHTML = '<h1>Coleção</h1>'; await tick();
  assert.equal(block(t.doc).length, 0);
  t.w.history.pushState({}, '', PATH); main.innerHTML = saved; await tick();
  assert.equal(block(t.doc).length, 1);
  assert.equal(t.fetchCalls.length, 1, 'cached per product id');
});

test('the block is built with textContent only (a hostile title is text, not markup)', async () => {
  const t = setup({ items: [item(1, { title: '<b>x</b> & "y"' }), item(2)] }); await tick();
  const name = block(t.doc)[0].querySelector('.o-reco-name');
  assert.equal(name.textContent, '<b>x</b> & "y"'); assert.equal(name.querySelector('b'), null);
});

// Layout: jsdom não calcula geometria; as caixas da galeria e dos detalhes são simuladas (lado a lado = desktop; empilhadas = mobile).
function layout(t, sideBySide, detailsHeight = 1584) {
  const box = (left, width, top, height) => ({ left, width, top, height, right: left + width, bottom: top + height, x: left, y: top });
  t.doc.querySelector('section.section-product-v2').getBoundingClientRect = () => (sideBySide ? box(66, 562, 176, 562) : box(16, 358, 176, 400));
  t.doc.querySelector('section.section-details').getBoundingClientRect = () => (sideBySide ? box(652, 562, 176, detailsHeight) : box(16, 358, 600, 1500));
}
// offsetHeight do bloco (jsdom devolve 0): ~340 px como no desktop real.
function blockHeight(t, h = 340) { Object.defineProperty(t.w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.hasAttribute && this.hasAttribute('data-origens-reco') ? h : 0; } }); }

test('desktop (two columns side by side): the block goes right below the product image, inside the gallery column', async () => {
  const t = setup();
  layout(t, true); blockHeight(t);
  await tick();
  const root = block(t.doc)[0];
  const gallery = t.doc.querySelector('section.section-product-v2');
  assert.equal(root.parentElement, gallery);
  assert.equal(gallery.lastElementChild, root, 'after the image carousel');
  assert.equal(root.getAttribute('data-placement'), 'gallery');
  assert.ok(!t.doc.querySelector('section.section-details').contains(root), 'nothing pushed in the purchase column');
  assert.ok(t.doc.querySelector('section.buy-together').isConnected, 'native "Compre Junto" kept');
});

test('resizing between two columns and stacked moves the SAME block (no new request, no duplicate)', async () => {
  const t = setup();
  layout(t, true);
  await tick();
  const root = block(t.doc)[0];
  layout(t, false); t.w.dispatchEvent(new t.w.Event('resize')); await tick();
  assert.equal(block(t.doc).length, 1);
  assert.equal(block(t.doc)[0], root);
  assert.equal(t.doc.querySelector('section.buy-together').nextElementSibling, root);
  assert.equal(root.getAttribute('data-placement'), 'flow');
  layout(t, true); t.w.dispatchEvent(new t.w.Event('resize')); await tick();
  assert.equal(root.parentElement, t.doc.querySelector('section.section-product-v2'));
  assert.equal(t.fetchCalls.length, 1);
});

test('desktop without enough empty space under the image (short purchase column): falls back to the flow position, never overlaps', async () => {
  const t = setup();
  layout(t, true, 700); blockHeight(t); // vão de 138 px < 340 + 32
  await tick();
  const root = block(t.doc)[0];
  assert.equal(root.getAttribute('data-placement'), 'flow');
  assert.equal(t.doc.querySelector('section.buy-together').nextElementSibling, root);
});
