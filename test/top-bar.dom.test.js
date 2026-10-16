import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures, FEATURE_NAMES } from '../src/features.js';

// top-bar: a "Faixa do topo" do CMS na faixa preta do cabeçalho REAL da INK (jsdom). Páginas de casca (escopo de catálogo + header-nav) e de produto.
const read = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const HEADER = read('ink-header.html');
const PRODUCT = read('product-page.html');
const HOST = 'https://www.usesul.com.br';
const PRODUCT_PATH = '/usesul/product/serra-catarinense';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NATAL = { id: 'prazo-natal', text: 'Peça até 06/12 e receba a tempo do Natal · produção em 7 dias úteis', endsAt: '2099-12-07T00:00:00-03:00' };
const BF = { id: 'black-friday', text: 'Black Friday: faltam 2 dias', href: 'https://useorigens.com.br/sul/h/black-friday' };
const PAYLOAD = { v: 1, style: 'rotate', messages: [NATAL, BF] };
const MARQUEE = { v: 1, style: 'marquee', messages: [NATAL, BF] };
const NAV = { v: 2, states: [], top: [], more: [] };
const SHELL_PAGE = '<!doctype html><html><head><title>INK</title></head><body>' + HEADER + '<main><h1>Novidades</h1></main></body></html>';

const windows = [];
after(() => { for (const w of windows) w.close(); });

function setup({ path = '/usesul/collections/novidades', html = SHELL_PAGE, features = ['header-nav', 'top-bar'], scope = 'product-catalog', allow = [], payload = PAYLOAD, fetchImpl, reduced = false } = {}) {
  const dom = new JSDOM(html, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  windows.push(w);
  const t = { w, doc: w.document, fetches: [] };
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none' || n.classList.contains('hidden')) return []; } return [{}]; };
  w.matchMedia = (q) => ({ matches: /reduce/.test(q) ? reduced : false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), credentials: options.credentials });
    if (fetchImpl) return fetchImpl(String(url));
    if (String(url).includes('/__origens/top-bar')) return json(payload);
    if (String(url).includes('/__origens/navbar')) return json(NAV);
    return new Response('nope', { status: 404 });
  };
  w.eval(buildLoaderSource(allow, features, scope));
  t.q = (s) => w.document.querySelector(s);
  t.all = (s) => [...w.document.querySelectorAll(s)];
  t.bar = () => t.q('header .header-benefits');
  t.line = () => t.q('header .header-benefits > .o-top-bar > *');
  t.items = (copy) => t.all('header .o-top-bar-group:nth-child(' + (copy + 1) + ') > .o-top-bar-item');
  t.barFetches = () => t.fetches.filter((f) => f.url.includes('/__origens/top-bar'));
  return t;
}
const goto = async (t, path) => { t.w.history.pushState({}, '', path); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(300); };

test('feature: top-bar is a known opt-in flag; the bundle only carries the module when it is on', () => {
  assert.ok(FEATURE_NAMES.includes('top-bar'));
  assert.equal(parseFeatures('header-nav,top-bar').status, 'ok');
  assert.match(buildLoaderSource([PRODUCT_PATH], ['top-bar']), /id: 'top-bar'/);
  assert.doesNotMatch(buildLoaderSource([PRODUCT_PATH], ['promo-fab']), /id: 'top-bar'|__origens\/top-bar/);
});

test('rotate: given live messages, then the native phrases are hidden (still in the DOM) and the first message takes their place, text only, one fetch without cookies', async () => {
  const t = setup(); await tick(400);
  const bar = t.bar();
  assert.ok(bar.hasAttribute('data-origens-top-bar'));
  assert.equal(bar.querySelectorAll(':scope > span').length, 3, 'the INK phrases stay in the DOM');
  assert.ok(t.q('#o-top-bar-css').textContent.includes('.header-benefits[data-origens-top-bar]>span{display:none!important}'));
  assert.equal(t.line().tagName, 'DIV', 'never a span: the INK styles every span of the strip');
  assert.equal(t.line().textContent, NATAL.text);
  assert.equal(t.barFetches().length, 1);
  assert.equal(t.barFetches()[0].credentials, 'omit');
  // A mutation elsewhere (the navbar, the runtime's observer) never repaints or duplicates it.
  t.doc.body.appendChild(t.doc.createElement('div')); await tick(200);
  assert.equal(t.all('.o-top-bar').length, 1);
  assert.equal(t.all('#o-top-bar-css').length, 1);
});

test('rotate: more than one message take turns every 5 s, a link opens the storefront page; reduced motion keeps the first one', async () => {
  const t = setup();
  const still = setup({ reduced: true });
  await tick(5400);
  assert.equal(t.line().tagName, 'A');
  assert.equal(t.line().getAttribute('href'), BF.href);
  assert.equal(t.line().textContent, BF.text);
  assert.equal(still.line().textContent, NATAL.text);
});

test('rotate: hover pauses the turns', async () => {
  const t = setup(); await tick(300);
  t.bar().dispatchEvent(new t.w.MouseEvent('mouseenter'));
  await tick(5400);
  assert.equal(t.line().textContent, NATAL.text);
});

test('marquee (the default, also without style): every message in one scrolling line, two identical groups, only the first pass readable and reachable', async () => {
  for (const payload of [MARQUEE, { v: 1, messages: [NATAL, BF] }]) {
    const t = setup({ payload }); await tick(400);
    const box = t.q('header .header-benefits > .o-top-bar');
    assert.ok(box.classList.contains('o-top-bar-marquee'));
    assert.equal(t.all('header .o-top-bar-group').length, 2);
    assert.equal(t.all('header .o-top-bar-group')[1].getAttribute('aria-hidden'), 'true');
    const first = t.items(0);
    assert.ok(first.length >= 2 && first.length % 2 === 0, 'each group repeats whole passes');
    assert.deepEqual(first.slice(0, 2).map((i) => i.textContent), [NATAL.text, BF.text]);
    assert.equal(first[0].hasAttribute('aria-hidden'), false);
    assert.equal(first[1].querySelector('a').getAttribute('href'), BF.href);
    assert.equal(first[1].querySelector('a').hasAttribute('tabindex'), false);
    for (const item of [...first.slice(2), ...t.items(1)]) {
      assert.equal(item.getAttribute('aria-hidden'), 'true');
      const a = item.querySelector('a'); if (a) assert.equal(a.getAttribute('tabindex'), '-1');
    }
    assert.match(box.style.getPropertyValue('--o-top-bar-seconds'), /^\d+s$/);
    assert.ok(t.q('#o-top-bar-css').textContent.includes('animation-play-state:paused'));
    assert.equal(t.all('header .header-benefits .o-top-bar span').length, 0, 'never a span: the INK styles every span of the strip');
    // Repainting (runtime observer) never rebuilds nor duplicates it.
    const track = t.q('.o-top-bar-track');
    t.doc.body.appendChild(t.doc.createElement('div')); await tick(200);
    assert.equal(t.q('.o-top-bar-track'), track);
  }
});

test('colours from the panel paint the whole strip while a message is on; leaving the scope gives the INK its black strip back', async () => {
  const t = setup({ payload: { ...MARQUEE, colors: { background: '#b3121f', text: '#ffffff' } } }); await tick(400);
  assert.equal(t.bar().style.getPropertyValue('--o-top-bar-bg'), '#b3121f');
  assert.equal(t.bar().style.getPropertyValue('--o-top-bar-fg'), '#ffffff');
  assert.ok(t.q('#o-top-bar-css').textContent.includes('background-color:var(--o-top-bar-bg,#000)!important'));
  await goto(t, '/usesul/cart');
  assert.equal(t.bar().style.getPropertyValue('--o-top-bar-bg'), '');
  const plain = setup({ payload: MARQUEE }); await tick(400);
  assert.equal(plain.bar().style.getPropertyValue('--o-top-bar-bg'), '', 'no colours = the black strip');
});

test('marquee with reduced motion: nothing moves, the first message stays', async () => {
  const t = setup({ payload: MARQUEE, reduced: true }); await tick(400);
  assert.equal(t.all('.o-top-bar-track').length, 0);
  assert.equal(t.line().textContent, NATAL.text);
});

test('fail-open: an error, an empty list or a payload outside the contract leave the INK strip exactly as it came', async () => {
  const cases = [
    { fetchImpl: (url) => (url.includes('top-bar') ? json({ error: 'unavailable' }, 503) : json(NAV)) },
    { payload: { v: 1, messages: [] } },
    { payload: { v: 1, messages: [{ ...BF, href: 'https://evil.example/sul' }] } },
    { payload: { v: 1, messages: [{ ...BF, href: 'https://useorigens.com.br/norte/h/natal' }] } },
    { payload: { v: 1, messages: [{ id: 'x', text: '<b>oi</b>' }] } },
    { payload: { v: 1, style: 'blink', messages: [NATAL] } },
    { payload: { v: 1, colors: { background: 'red', text: '#fff' }, messages: [NATAL] } }
  ];
  for (const c of cases) {
    const t = setup(c); await tick(400);
    assert.equal(t.bar().hasAttribute('data-origens-top-bar'), false);
    assert.equal(t.all('.o-top-bar, #o-top-bar-css').length, 0);
    assert.match(t.bar().textContent, /Frete grátis para PR, RS, SC/);
  }
});

test('Turbo: the next page\'s header gets the message BEFORE it is painted (no flash of the INK phrase), only when the destination is in scope', async () => {
  const t = setup(); await tick(400);
  const next = new JSDOM('<body>' + HEADER + '</body>').window.document.body;
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + '/usesul/about' } }));
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:before-render', { detail: { newBody: next } }));
  assert.equal(next.querySelector('.header-benefits > .o-top-bar > div').textContent, NATAL.text);
  const checkout = new JSDOM('<body>' + HEADER + '</body>').window.document.body;
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + '/usesul/checkout/abc' } }));
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:before-render', { detail: { newBody: checkout } }));
  assert.equal(checkout.querySelector('.o-top-bar'), null, 'out of scope: the INK strip is left alone');
});

test('leaving the scope removes everything of ours; coming back paints again from the same data (no new fetch)', async () => {
  const t = setup(); await tick(400);
  await goto(t, '/usesul/cart');
  assert.equal(t.all('.o-top-bar').length, 0);
  assert.equal(t.bar().hasAttribute('data-origens-top-bar'), false);
  await goto(t, '/usesul/about');
  assert.equal(t.line().textContent, NATAL.text);
  assert.equal(t.barFetches().length, 1);
});

test('product page (allowlist scope): the same strip on the product header', async () => {
  const t = setup({ path: PRODUCT_PATH, html: PRODUCT.replace(/(<body[^>]*>)/, '$1' + HEADER), features: ['top-bar'], scope: 'allowlist', allow: [PRODUCT_PATH] });
  await tick(400);
  assert.equal(t.line().textContent, NATAL.text);
});
