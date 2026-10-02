import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures, FEATURE_NAMES } from '../src/features.js';
import { STORES } from '../src/stores.js';

// promo-fab: o botão de cupons nas páginas da INK (jsdom; página de produto REAL da INK como fixture). Sem layout no jsdom: os retângulos que importam
// (CTA fixo, aviso de cookies, controles do formulário) são simulados por elemento.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HEADER = readFileSync(new URL('./fixtures/ink-header.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/serra-catarinense';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LEVE = { id: 'leve-mais', type: 'coupon', title: 'LEVE MAIS', code: 'LEVEMAIS', description: '3 peças: R$ 30 OFF · 4 peças: R$ 50 OFF · 5 ou mais: R$ 75 OFF', callout: 'Um cupom por pedido.', order: 1 };
const PRIMEIRA = { id: 'primeira-compra', type: 'coupon', title: 'PRIMEIRA COMPRA', code: 'PRIMEIRA5', description: '5% OFF na sua primeira compra', badgeLabel: 'Novo', order: 2 };
const FRETE = { id: 'frete-gratis', type: 'promotion', title: 'Semana do Frete Grátis', description: '1 peça RJ ou 2 peças demais estados', callout: 'Com limite de R$ 29,90 por frete', order: 3 };
const PAYLOAD = { v: 1, items: [LEVE, PRIMEIRA, FRETE], theme: { primary: '#4d543d', onPrimary: '#ffffff' } };

const windows = [];
// Every jsdom window is closed at the end (its timers would otherwise keep the process alive).
after(() => { for (const w of windows) w.close(); });

function setup({ payload = PAYLOAD, features = ['promo-fab'], fetchImpl, width = 390, height = 844, rects = {}, reduced = false, clipboard = true, carry = null, header = '' } = {}) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(PRODUCT.replace(/(<body[^>]*>)/, '$1' + header), { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  windows.push(w);
  const t = { w, doc: w.document, fetches: [], copied: [], gtag: [] };
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none' || n.classList.contains('hidden')) return []; } return [{}]; };
  // Retângulos simulados por seletor; o resto mede zero (fora do caminho).
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    for (const [selector, r] of Object.entries(t.rects)) if (this.matches(selector)) return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top };
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  t.rects = rects;
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(w.document.documentElement, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(w.document.documentElement, 'clientHeight', { configurable: true, get: () => height });
  w.matchMedia = (q) => ({ matches: /reduce/.test(q) ? reduced : /coarse/.test(q) ? width < 640 : false, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, 'isSecureContext', { configurable: true, value: true });
  if (clipboard) Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { t.copied.push(text); } } });
  w.document.execCommand = () => false;
  if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), credentials: options.credentials, method: options.method || 'GET' });
    if (fetchImpl) return fetchImpl(String(url), options);
    if (String(url).includes('/__origens/promotions')) return json(payload);
    return new Response('nope', { status: 404 });
  };
  w.eval(buildLoaderSource([PATH], features, 'allowlist'));
  t.q = (sel) => w.document.querySelector(sel);
  t.all = (sel) => [...w.document.querySelectorAll(sel)];
  t.fab = () => t.q('#o-promo .o-promo-fab');
  t.click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  t.key = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  t.promoFetches = () => t.fetches.filter((f) => f.url.includes('/__origens/promotions'));
  return t;
}

test('feature: promo-fab is a known flag; the bundle only carries the module when it is on', () => {
  assert.ok(FEATURE_NAMES.includes('promo-fab'));
  assert.equal(parseFeatures('header-nav,promo-fab').status, 'ok');
  assert.match(buildLoaderSource([PATH], ['promo-fab']), /id: 'promo-fab'/);
  assert.doesNotMatch(buildLoaderSource([PATH], ['header-nav']), /id: 'promo-fab'|__origens\/promotions/);
  for (const id of Object.keys(STORES)) assert.equal(STORES[id].promotionsApi, '/api/promotions/' + STORES[id].region);
});

test('given coupons and an announcement, then ONE button bottom-left with badge = copyable coupons, region colour and an accessible name', async () => {
  const t = setup();
  await tick();
  assert.equal(t.all('#o-promo').length, 1);
  const fab = t.fab();
  assert.equal(fab.hidden, false);
  assert.equal(fab.getAttribute('aria-label'), 'Cupons e ofertas: 2 cupons disponíveis');
  assert.equal(t.q('#o-promo .o-promo-badge').textContent, '2');
  assert.match(fab.style.left, /16px/); assert.match(fab.style.bottom, /16px/);
  assert.equal(t.q('#o-promo').style.getPropertyValue('--o-promo-bg'), '#4d543d');
  assert.equal(t.promoFetches().length, 1);
  assert.equal(t.promoFetches()[0].credentials, 'omit');
  assert.equal(t.promoFetches()[0].url, '/__origens/promotions', 'same-origin gateway, no CORS');
});

test('badge: 9+ above nine; only announcements = button without badge', async () => {
  const many = setup({ payload: { v: 1, items: Array.from({ length: 12 }, (_, i) => ({ ...LEVE, id: 'c' + i, code: 'CODE' + i })) } });
  await tick();
  assert.equal(many.q('#o-promo .o-promo-badge').textContent, '9+');
  const notices = setup({ payload: { v: 1, items: [FRETE] } });
  await tick();
  assert.ok(notices.fab());
  assert.equal(notices.q('#o-promo .o-promo-badge'), null);
  assert.equal(notices.fab().getAttribute('aria-label'), 'Cupons e ofertas');
});

test('panel: cards from the CMS only, callout only when present, no Copiar on announcements; Copiar copies the exact code; Escape closes and refocuses', async () => {
  const t = setup();
  await tick();
  t.click(t.fab());
  await tick(20);
  const panel = t.q('#o-promo-panel');
  assert.ok(panel);
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(t.q('#o-promo-title').textContent, 'Cupons e ofertas');
  assert.equal(t.fab().getAttribute('aria-expanded'), 'true');
  assert.deepEqual(t.all('#o-promo-panel h3').map((h) => h.textContent), ['LEVE MAIS', 'PRIMEIRA COMPRA', 'Semana do Frete Grátis']);
  const [leve, primeira, frete] = t.all('#o-promo-panel li');
  assert.equal(leve.querySelector('.o-promo-callout').textContent, 'Um cupom por pedido.');
  assert.equal(primeira.querySelector('.o-promo-callout'), null, 'no empty line when there is no callout');
  assert.equal(primeira.querySelector('.o-promo-tag').textContent, 'Novo');
  assert.equal(frete.querySelector('.o-promo-copy'), null);
  assert.equal(frete.querySelector('.o-promo-callout').textContent, 'Com limite de R$ 29,90 por frete');
  // Nothing global and hardcoded under the cards.
  assert.doesNotMatch(panel.textContent, /Consulte as regras/);
  t.click(leve.querySelector('.o-promo-copy'));
  await tick(20);
  assert.deepEqual(t.copied, ['LEVEMAIS']);
  assert.equal(leve.querySelector('.o-promo-copy').textContent, 'Copiado');
  assert.equal(t.q('#o-promo [data-promo-live]').textContent, 'Código LEVEMAIS copiado.');
  t.key('Escape');
  await tick(20);
  assert.equal(t.q('#o-promo-panel'), null);
  assert.equal(t.doc.activeElement, t.fab());
  assert.equal(t.w.sessionStorage.getItem('origens:promo:quiet'), '1', 'quiet for the rest of the session');
});

test('copy without any clipboard: the code is selected and a hint says to copy by hand (never a silent failure)', async () => {
  const t = setup({ clipboard: false });
  await tick();
  t.click(t.fab()); await tick(20);
  t.click(t.q('#o-promo-panel .o-promo-copy')); await tick(20);
  assert.match(t.q('#o-promo .o-promo-fail').textContent, /código está selecionado/);
  assert.equal(String(t.w.getSelection()), 'LEVEMAIS');
});

test('mobile: bottom sheet with backdrop, page scroll locked while open; desktop: anchored popover without backdrop', async () => {
  const phone = setup({ width: 390 });
  await tick();
  phone.click(phone.fab()); await tick(20);
  assert.ok(phone.q('#o-promo-panel').classList.contains('is-sheet'));
  assert.equal(phone.q('#o-promo .o-promo-backdrop').hidden, false);
  assert.equal(phone.doc.documentElement.style.overflow, 'hidden');
  phone.click(phone.q('#o-promo .o-promo-backdrop')); await tick(20);
  assert.equal(phone.q('#o-promo-panel'), null);
  assert.equal(phone.doc.documentElement.style.overflow, '');

  const desk = setup({ width: 1280, height: 800 });
  await tick();
  desk.click(desk.fab()); await tick(20);
  assert.ok(desk.q('#o-promo-panel').classList.contains('is-pop'));
  assert.equal(desk.q('#o-promo .o-promo-backdrop').hidden, true);
  assert.equal(desk.doc.documentElement.style.overflow, '');
});

test('collisions: above the sticky Adicionar ao carrinho and the cookie notice; hidden over essential purchase controls, with the cart drawer, a modal, the menu or the keyboard', async () => {
  const H = 844;
  const t = setup({ height: H, rects: { '#add-to-cart-mob': { left: 0, right: 390, top: H - 72, bottom: H } } });
  await tick();
  assert.match(t.fab().style.bottom, /80px/, 'sticky CTA top (72px) + 8px gap');
  assert.equal(t.fab().hidden, false);

  t.rects = { '#add-to-cart-mob': { left: 0, right: 390, top: H - 72, bottom: H }, '#add-to-cart-desk': { left: 0, right: 390, top: H - 160, bottom: H - 110 } };
  t.w.dispatchEvent(new t.w.Event('scroll')); await tick(120);
  assert.equal(t.fab().hidden, true, 'an essential purchase control (in-flow Adicionar ao carrinho, variants) under the button => it steps aside');

  t.rects = {};
  t.doc.body.insertAdjacentHTML('beforeend', '<div class="cart-drawer open">carrinho</div>');
  t.w.dispatchEvent(new t.w.Event('resize')); await tick(120);
  assert.equal(t.fab().hidden, true, 'cart drawer open => hidden (never over Finalizar compra)');
  t.q('.cart-drawer').remove();
  t.doc.body.insertAdjacentHTML('beforeend', '<div id="modal-wrapper">modal</div>');
  t.w.dispatchEvent(new t.w.Event('resize')); await tick(120);
  assert.equal(t.fab().hidden, true, 'modal => hidden');
  t.q('#modal-wrapper').remove();
  t.w.dispatchEvent(new t.w.Event('resize')); await tick(120);
  assert.equal(t.fab().hidden, false);

  Object.defineProperty(t.w, 'visualViewport', { configurable: true, value: { height: 400, addEventListener() {}, removeEventListener() {} } });
  t.w.dispatchEvent(new t.w.Event('resize')); await tick(120);
  assert.equal(t.fab().hidden, false, 'a smaller visual viewport alone is a zoomed-out page, not a keyboard');
  t.doc.body.insertAdjacentHTML('beforeend', '<input id="cep" type="text">');
  t.q('#cep').focus();
  t.w.dispatchEvent(new t.w.Event('resize')); await tick(120);
  assert.equal(t.fab().hidden, true, 'virtual keyboard (text field focused + smaller viewport) => hidden');
  assert.match(t.q('#o-promo').getAttribute('data-promo-hidden'), /keyboard/);
});

test('collisions: the INK mobile menu open => hidden; the INK cookie notice in the corner => the button sits above it', async () => {
  const H = 844;
  const t = setup({ header: HEADER, height: H, rects: { '.cookie-acceptance': { left: 0, right: 390, top: H - 120, bottom: H } } });
  t.doc.body.insertAdjacentHTML('beforeend', '<div class="cookie-acceptance">cookies</div>');
  await tick();
  assert.match(t.fab().style.bottom, /128px/);
  t.q('#menu-hamburger').setAttribute('aria-expanded', 'true');
  t.click(t.doc.body); await tick(120);
  assert.equal(t.fab().hidden, true);
});

test('fail-open: 503, invalid JSON, wrong contract, timeout-like rejection or zero items => nothing at all, and no retry loop', async () => {
  const cases = [
    () => json({ error: 'unavailable' }, 503),
    () => new Response('{oops', { headers: { 'content-type': 'application/json' } }),
    () => json({ v: 2, items: [LEVE] }),
    () => json({ v: 1, items: [{ ...LEVE, code: 'NO SPACES' }] }),
    () => json({ v: 1, items: [{ ...LEVE, title: '<b>x</b>' }] }),
    () => Promise.reject(new Error('aborted')),
    () => json({ v: 1, items: [] })
  ];
  for (const make of cases) {
    const t = setup({ fetchImpl: (url) => (url.includes('/__origens/promotions') ? make() : new Response('', { status: 404 })) });
    await tick();
    assert.equal(t.q('#o-promo'), null);
    // DOM churn (Turbo, the INK's own scripts) keeps calling mount(): the failure is remembered, no new request.
    for (let i = 0; i < 5; i++) { t.doc.body.appendChild(t.doc.createElement('div')); await tick(80); }
    assert.equal(t.promoFetches().length, 1);
    // The INK page is untouched: native purchase form and CTA still there.
    assert.ok(t.q('#add-to-cart-desk')); assert.ok(t.q('form#form-product-0'));
  }
});

test('session cache: a second page view within a minute reuses the answer; another region\'s cache is ignored', async () => {
  const first = setup();
  await tick();
  const stored = first.w.sessionStorage.getItem('origens:promo:v1');
  const again = setup({ carry: { 'origens:promo:v1': stored } });
  await tick();
  assert.ok(again.fab());
  assert.equal(again.promoFetches().length, 0);
  const other = setup({ carry: { 'origens:promo:v1': stored.replace('"region":"sul"', '"region":"norte"') } });
  await tick();
  assert.equal(other.promoFetches().length, 1);
});

test('Turbo: before-cache tears the button down (no duplicate in the snapshot); remount yields exactly one', async () => {
  const t = setup();
  await tick();
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  await tick(20);
  assert.equal(t.q('#o-promo'), null);
  t.doc.dispatchEvent(new t.w.Event('turbo:load'));
  await tick(250);
  assert.equal(t.all('#o-promo').length, 1);
  assert.equal(t.all('#o-promo .o-promo-fab').length, 1);
});

test('wiggle: once after 4–6 s when calm, never with reduced motion, never once the visitor interacted in this session', async () => {
  // Shrink time: the first delay is read from Math.random (0 => 4 s); run timers fast by patching setTimeout for long delays.
  const run = async (opts) => {
    const t = setup(opts);
    const real = t.w.setTimeout.bind(t.w);
    t.w.setTimeout = (fn, ms, ...a) => real(fn, ms >= 4000 ? 30 : ms, ...a);
    t.wiggles = 0;
    const add = t.w.DOMTokenList.prototype.add;
    t.w.DOMTokenList.prototype.add = function (...names) { if (names.includes('o-promo-wiggle')) t.wiggles++; return add.apply(this, names); };
    await tick(600);
    return t;
  };
  assert.ok((await run({})).wiggles >= 1);
  assert.equal((await run({ reduced: true })).wiggles, 0);
  assert.equal((await run({ carry: { 'origens:promo:quiet': '1' } })).wiggles, 0);
  const calm = await run({});
  assert.equal(calm.wiggles, 3, 'never more than three per page view (all three fired: the clock was fast-forwarded)');
});

test('security: CMS text only ever lands as text, never as markup', async () => {
  const t = setup({ payload: { v: 1, items: [{ ...LEVE, description: 'R$ 30 & mais "aspas" \'simples\'' }] } });
  await tick();
  t.click(t.fab()); await tick(20);
  assert.equal(t.q('#o-promo-panel .o-promo-desc').textContent, 'R$ 30 & mais "aspas" \'simples\'');
  assert.equal(t.all('#o-promo-panel script, #o-promo-panel img').length, 0);
});
