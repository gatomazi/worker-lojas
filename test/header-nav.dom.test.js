import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures } from '../src/features.js';

// header-nav: cabeçalho da INK aproximado do storefront + busca textual redirecionada (jsdom, HTML REAL do cabeçalho da INK como fixture).
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HEADER = readFileSync(new URL('./fixtures/ink-header.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/serra-catarinense';
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav'];
const NAV_ONLY = ['header-nav'];
const WITH_MIRROR = ['cart-mirror', 'header-nav'];
const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';

const CONFIG = { v: 1, collections: [{ name: 'Seu Lugar', slug: 'seu-lugar' }, { name: 'Do Nosso Jeito', slug: 'do-nosso-jeito' }, { name: 'Da Nossa Terra', slug: 'da-nossa-terra' }] };
const SEVEN = { v: 1, collections: ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete'].map((s) => ({ name: 'Coleção ' + s, slug: 'colecao-' + s })) };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const cartHtml = '<div class="cart-drawer"><turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="1"></span></span></div><div class="cart-drawer__main"><ul>' +
  '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>Serra Catarinense</p><p>Preta</p><p>M</p></div><div class="price-details"><div class="price"><span>R$ 109,90</span></div></div>' +
  '<form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M"><input class="quantity-input" type="text" value="1" name="cart_item[quantity]"></form></li></ul></div>' +
  '<div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="109.9"><p>Total</p><div><p>R$ 109,90</p></div></div></div></div></turbo-frame></div>';
const EMPTY_CART = '<div class="cart-drawer"><turbo-frame id="cart"><div><header class="cart-drawer__header"><span>(0 produtos)</span></header><div class="empty-cart"><span>Seu carrinho está vazio</span></div></div></turbo-frame></div>';

function page({ header = HEADER, cart = '' } = {}) {
  return PRODUCT.replace(/(<body[^>]*>)/, '$1' + header).replace('</main>', cart + '</main>');
}

function setup({ features = NAV_ONLY, config = CONFIG, cart = '', header = HEADER, path = PATH, fetchImpl, carry = null } = {}) {
  const virtualConsole = new VirtualConsole();
  const t = { navs: [], lastLink: null, fetches: [], navigations: [] };
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) t.navs.push(t.lastLink ? t.lastLink.href : null); });
  const dom = new JSDOM(page({ header, cart }), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden')) return []; } return [{}]; };
  if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), method: options.method || 'GET', credentials: options.credentials, headers: options.headers, body: options.body });
    if (fetchImpl) return fetchImpl(String(url), options);
    if (String(url).includes('cart-ref')) return json({ ref: REF, ttl: 1800 }, 201);
    if (String(url).includes('/__origens/navbar')) return json(config);
    return new Response('nope', { status: 404 });
  };
  // Cliques que o navegador seguiria sozinho (não interceptados pelo cart-mirror).
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.getAttribute('href')) { t.lastLink = a; if (!e.defaultPrevented) { t.navigations.push(a.href); e.preventDefault(); } } });
  Object.assign(t, { w, doc: w.document, dom });
  w.eval(buildLoaderSource([PATH], features, 'allowlist'));
  t.q = (sel) => w.document.querySelector(sel);
  t.all = (sel) => [...w.document.querySelectorAll(sel)];
  t.navFetches = () => t.fetches.filter((f) => f.url.includes('/__origens/navbar'));
  t.posts = () => t.fetches.filter((f) => f.url.includes('cart-ref'));
  return t;
}
const click = (t, el, init = {}) => { const e = new t.w.MouseEvent('click', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
const type = (t, text) => { const input = t.q('#o-nav-q'); input.value = text; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); };
const enter = (t) => t.q('#o-nav-search').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
const desktopLupa = (t) => t.q('[data-origens-nav="desktop"] .o-nav-lupa');
const mobileLupa = (t) => t.q('.navbar__top .o-nav-lupa');

test('header-nav is a known feature; the bundle contains the module only when it is enabled (fail-closed list unchanged)', () => {
  assert.deepEqual(parseFeatures(ALL.join(',')).features, ALL);
  assert.equal(parseFeatures('header-nav,nao-existe').status, 'invalid');
  assert.match(buildLoaderSource([PATH], NAV_ONLY), /id: 'header-nav'/);
  assert.doesNotMatch(buildLoaderSource([PATH], ['return-link', 'cart-mirror']), /id: 'header-nav'|__origens\/navbar/);
  const src = buildLoaderSource([PATH], NAV_ONLY);
  assert.ok(!src.includes('__NAV_STORE__'));
  assert.ok(src.includes('"search":"https://useorigens.com.br/sul/busca"') && src.includes('"inkBase":"/usesul"'));
});

test('mounts once: our logo, the CMS collections, Cidades, one search lupa per breakpoint and ONE search form; native account/cart untouched', async () => {
  const t = setup(); await tick(300);
  const desk = t.q('[data-origens-nav="desktop"]');
  assert.ok(desk, 'desktop block');
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1);
  assert.equal(t.all('#o-nav-search').length, 1);
  const links = [...desk.querySelectorAll('.o-nav-links a')].map((a) => [a.textContent, a.getAttribute('href')]);
  assert.deepEqual(links, [['Seu Lugar', '/usesul/collections/seu-lugar'], ['Do Nosso Jeito', '/usesul/collections/do-nosso-jeito'], ['Da Nossa Terra', '/usesul/collections/da-nossa-terra'], ['Cidades', 'https://useorigens.com.br/sul#estados']]);
  const logo = desk.querySelector('.o-nav-logo');
  assert.equal(logo.getAttribute('href'), 'https://useorigens.com.br/sul');
  assert.equal(logo.querySelector('img').getAttribute('src'), t.q('a.brand img').getAttribute('src'), 'reuses the store logo the INK page already loads');
  // mobile: logo + lupa in the top strip, collections at the top of the native side menu
  assert.equal(t.q('.navbar__top .o-nav-logo').getAttribute('href'), 'https://useorigens.com.br/sul');
  assert.ok(mobileLupa(t) && desktopLupa(t));
  assert.deepEqual([...t.q('[data-origens-nav="menu"]').querySelectorAll('a')].map((a) => a.textContent), ['Seu Lugar', 'Do Nosso Jeito', 'Da Nossa Terra', 'Cidades']);
  // native pieces are never REMOVED (hidden by CSS only while ours exists) and account / cart are not touched at all
  for (const sel of ['a.brand', 'ul.navbar-list', '#shopping-cart-menu-mob', '.menu-icons', '#menu-hamburger', '#navbar-list-mobile', 'button[aria-label="Pesquisar"]', '#mobile_search']) assert.ok(t.q(sel), sel);
  const css = t.q('style[data-origens-nav]').textContent;
  assert.match(css, /header:has\(\[data-origens-nav\]\) nav\.navbar:not\(\[data-controller\]\) > ul\.navbar-list/);
  assert.ok(!/menu-icons|menu-user|shopping-cart|checkout/.test(css), 'the stylesheet never targets account or cart');
  assert.match(css, /@media \(max-width:1023px\)\{\.o-nav-word\{position:absolute/, 'mobile shows the logo only; the wordmark stays for screen readers');
  assert.match(css, /\.navbar__top \.o-nav-logo\{position:absolute;left:50%;top:50%;transform:translate\(-50%,-50%\)/, 'the mobile logo is centered in the strip (not pushed by the different widths of the side groups)');
  assert.match(css, /\.navbar__top \.o-nav-logo img\{height:48px\}/);
  assert.equal(t.q('.navbar__top .o-nav-logo').getAttribute('aria-label'), 'Use Sul, página inicial');
});

test('a config with more than five collections keeps five inline and puts the rest in "Mais"', async () => {
  const t = setup({ config: SEVEN }); await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"] .o-nav-links > a').length, 5 + 1, 'five collections + Cidades');
  assert.deepEqual([...t.all('.o-nav-more .o-nav-pop a')].map((a) => a.textContent), ['Coleção seis', 'Coleção sete']);
  assert.equal(t.all('[data-origens-nav="menu"] a').length, 7 + 1, 'the mobile menu lists all of them');
});

test('collection names are plain text (no markup from the config is ever interpreted)', async () => {
  const t = setup({ config: { v: 1, collections: [{ name: '<img src=x onerror=alert(1)>Kits', slug: 'kits' }] } }); await tick(300);
  const link = t.q('.o-nav-links a');
  assert.equal(link.textContent, '<img src=x onerror=alert(1)>Kits');
  assert.equal(link.querySelector('img'), null);
});

test('the search is closed by default; the lupa opens ONE text field and focuses it; Escape closes it and gives the focus back', async () => {
  const t = setup(); await tick(300);
  const form = t.q('#o-nav-search'); const input = t.q('#o-nav-q');
  assert.equal(form.hidden, true); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'false');
  assert.equal(t.all('input[type="search"][name="q"]').length, 1, 'a single field of ours');
  click(t, desktopLupa(t));
  assert.equal(form.hidden, false); assert.equal(t.doc.activeElement, input); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'true');
  assert.equal(input.getAttribute('enterkeyhint'), 'search'); assert.equal(input.getAttribute('autocomplete'), 'off');
  assert.equal(t.q('label[for="o-nav-q"]').textContent, 'Buscar produtos');
  input.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(form.hidden, true); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'false');
  assert.equal(t.doc.activeElement, desktopLupa(t));
});

test('typing, opening and closing without submitting: no request, no cart snapshot, no navigation', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  const before = t.fetches.length;
  click(t, mobileLupa(t)); await tick(50);
  for (const text of ['c', 'ch', 'chi', 'chimarrão']) type(t, text);
  await tick(700);
  click(t, t.q('#o-nav-q')); // clicking inside the field is not a submit
  t.q('#o-nav-q').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  click(t, mobileLupa(t)); type(t, ''); click(t, mobileLupa(t));
  await tick(300);
  assert.equal(t.fetches.length, before, 'zero requests after mount');
  assert.equal(t.posts().length, 0); assert.equal(t.navs.length + t.navigations.length, 0);
});

test('Enter goes to /sul/busca?q=<encoded text> on the storefront (accents and symbols encoded, spaces collapsed)', async () => {
  const t = setup(); await tick(300);
  click(t, desktopLupa(t)); type(t, '  Florianópolis  ');
  enter(t); await tick(80);
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/busca?q=Florian%C3%B3polis']);
  const u = new URL(t.navigations[0]); assert.equal(u.origin, 'https://useorigens.com.br'); assert.equal(u.pathname, '/sul/busca'); assert.equal(u.searchParams.get('q'), 'Florianópolis');
  type(t, 'a&b=c #x  y'); enter(t); await tick(80);
  assert.equal(new URL(t.navigations[1]).searchParams.get('q'), 'a&b=c #x y');
  assert.equal(new URL(t.navigations[1]).searchParams.getAll('q').length, 1); assert.equal(new URL(t.navigations[1]).hash, '');
  type(t, 'x'.repeat(200)); enter(t); await tick(80);
  assert.equal(new URL(t.navigations[2]).searchParams.get('q').length, 80);
});

test('the "Buscar" button and the lupa (when already open with text) submit too; with an empty field neither navigates and the focus returns', async () => {
  const t = setup(); await tick(300);
  click(t, desktopLupa(t));
  const go = t.q('.o-nav-go');
  assert.equal(go.hasAttribute('href'), false, 'no href, no navigation, for an empty query');
  click(t, go); assert.equal(t.navigations.length + t.navs.length, 0); assert.equal(t.doc.activeElement, t.q('#o-nav-q'));
  type(t, '   '); assert.equal(go.hasAttribute('href'), false, 'whitespace only');
  enter(t); assert.equal(t.navigations.length, 0); assert.equal(t.doc.activeElement, t.q('#o-nav-q'));
  click(t, desktopLupa(t)); // open + empty: closes
  assert.equal(t.q('#o-nav-search').hidden, true);
  click(t, desktopLupa(t)); type(t, 'chimarrao');
  click(t, go); await tick(60);
  assert.equal(new URL(t.navigations[0]).searchParams.get('q'), 'chimarrao');
  click(t, desktopLupa(t)); await tick(60); // open + text: submits
  assert.equal(t.navigations.length, 2);
});

test('with a non-empty cart, Enter waits for ONE snapshot and navigates with cart_ref AND q; nothing was written while typing', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  click(t, desktopLupa(t)); type(t, 'gramado'); await tick(500);
  assert.equal(t.posts().length, 0);
  enter(t); await tick(250);
  assert.equal(t.posts().length, 1);
  assert.equal(t.posts()[0].credentials, 'omit');
  const dest = new URL(t.navs.at(-1));
  assert.equal(dest.origin + dest.pathname, 'https://useorigens.com.br/sul/busca');
  assert.equal(dest.searchParams.get('q'), 'gramado'); assert.equal(dest.searchParams.get('cart_ref'), REF);
  assert.ok(!/Serra|109|Preta/.test(dest.href), 'no raw cart data in any URL');
});

test('an unchanged cart reuses the token: logo, Cidades and a second search add ZERO writes', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  click(t, t.q('[data-origens-nav="desktop"] .o-nav-logo')); await tick(250);
  assert.equal(t.posts().length, 1);
  assert.equal(new URL(t.navs.at(-1)).searchParams.get('cart_ref'), REF);
  click(t, desktopLupa(t)); type(t, 'bah'); enter(t); await tick(200);
  click(t, t.q('.o-nav-links a[href^="https://useorigens.com.br"]')); await tick(200);
  assert.equal(t.posts().length, 1, 'same cart => same token');
  // the token is already valid, so these two exits are plain (decorated) link clicks, no waiting
  assert.equal(t.navigations.length, 2);
  for (const href of t.navigations) assert.equal(new URL(href).searchParams.get('cart_ref'), REF);
  assert.equal(new URL(t.navigations[0]).searchParams.get('q'), 'bah'); assert.equal(new URL(t.navigations[1]).pathname, '/sul');
});

test('an empty cart writes nothing and the link stays clean; a failing snapshot still navigates (search keeps working) without a token', async () => {
  const empty = setup({ features: WITH_MIRROR, cart: EMPTY_CART }); await tick(300);
  click(empty, desktopLupa(empty)); type(empty, 'gramado'); enter(empty); await tick(100);
  assert.equal(empty.posts().length, 0); assert.equal(empty.navigations[0], 'https://useorigens.com.br/sul/busca?q=gramado');

  const failing = setup({ features: WITH_MIRROR, cart: cartHtml, fetchImpl: (url) => (url.includes('cart-ref') ? json({ error: 'unavailable' }, 503) : json(CONFIG)) }); await tick(300);
  click(failing, desktopLupa(failing)); type(failing, 'gramado'); enter(failing); await tick(300);
  const dest = new URL(failing.navs.at(-1));
  assert.equal(dest.searchParams.get('q'), 'gramado'); assert.equal(dest.searchParams.has('cart_ref'), false);
});

test('without the cart-mirror feature the same links are plain links (no snapshot machinery involved)', async () => {
  const t = setup({ cart: cartHtml }); await tick(300);
  click(t, desktopLupa(t)); type(t, 'gramado'); enter(t); await tick(80);
  assert.equal(t.posts().length, 0); assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/busca?q=gramado']);
});

test('opening the search closes an open native side menu, and opening the menu closes the search (never both)', async () => {
  const t = setup(); await tick(300);
  const burger = t.q('#menu-hamburger'); let burgerClicks = 0;
  burger.addEventListener('click', () => { burgerClicks++; burger.setAttribute('aria-expanded', burger.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); });
  burger.setAttribute('aria-expanded', 'true');
  click(t, mobileLupa(t));
  assert.equal(burgerClicks, 1); assert.equal(burger.getAttribute('aria-expanded'), 'false'); assert.equal(t.q('#o-nav-search').hidden, false);
  click(t, burger);
  assert.equal(t.q('#o-nav-search').hidden, true); assert.equal(burgerClicks, 2);
});

test('config unavailable (503), invalid, or absent: NOTHING is mounted, the native header is intact, and there is no retry loop', async () => {
  for (const fetchImpl of [() => json({ error: 'unavailable' }, 503), () => json({ v: 2, collections: [] }), () => json({ v: 1, collections: [{ name: 'X', slug: '../evil' }] }), () => json({ v: 1, collections: new Array(9).fill({ name: 'X', slug: 'x' }) }), () => { throw new Error('offline'); }]) {
    const t = setup({ fetchImpl }); await tick(500);
    assert.equal(t.all('[data-origens-nav]').length, 0);
    assert.ok(t.q('ul.navbar-list') && t.q('a.brand') && t.q('#mobile_search'));
    t.doc.body.appendChild(t.doc.createElement('div')); await tick(300);
    assert.equal(t.navFetches().length, 1, 'a single attempt per page load');
  }
});

test('an unknown header structure mounts nothing and does not throw', async () => {
  const t = setup({ header: '<header><nav class="x"><a href="/">home</a></nav></header>' }); await tick(400);
  assert.equal(t.all('[data-origens-nav]').length, 0);
  const none = setup({ header: '' }); await tick(400);
  assert.equal(none.all('[data-origens-nav]').length, 0);
});

test('no collections in the CMS: the header still mounts (logo, Cidades, search) and the native "Categorias" stays', async () => {
  const t = setup({ config: { v: 1, collections: [] } }); await tick(300);
  assert.ok(t.q('[data-origens-nav="desktop"]'));
  assert.deepEqual([...t.all('.o-nav-links a')].map((a) => a.textContent), ['Cidades']);
  assert.equal(t.q('[data-origens-nav="menu"]'), null, 'no menu section, so the CSS that hides native Categorias never applies');
});

test('idempotent and Turbo-safe: repeated syncs keep exactly one header; a fresh native header after a body swap is rebuilt once; a non-product page removes everything', async () => {
  const t = setup(); await tick(300);
  for (let i = 0; i < 5; i++) { t.doc.body.appendChild(t.doc.createElement('i')); await tick(70); }
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-nav-search').length, 1);
  // Turbo replaces the body: the new native header has none of our nodes
  t.q('header').outerHTML = HEADER; await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-nav-search').length, 1); assert.equal(t.all('style[data-origens-nav]').length, 1);
  assert.equal(t.navFetches().length, 1, 'config kept in memory across body swaps');
  t.w.history.pushState({}, '', '/usesul'); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  assert.equal(t.all('[data-origens-nav]').length, 0);
  t.w.history.pushState({}, '', PATH); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, 'back on the product page it mounts again');
});

test('the config is cached for the session: a second page load inside the window does not fetch it again', async () => {
  const first = setup(); await tick(300);
  const stored = { 'origens:nav:v1': first.w.sessionStorage.getItem('origens:nav:v1') };
  assert.ok(stored['origens:nav:v1']);
  const second = setup({ carry: stored }); await tick(300);
  assert.equal(second.navFetches().length, 0); assert.ok(second.q('[data-origens-nav="desktop"]'));
  const stale = JSON.parse(stored['origens:nav:v1']); stale.at = Date.now() - 10 * 60 * 1000;
  const third = setup({ carry: { 'origens:nav:v1': JSON.stringify(stale) } }); await tick(300);
  assert.equal(third.navFetches().length, 1, 'expired entry is refetched');
});

test('not mounted at all on a page the loader does not cover (allowlist mode, other path)', async () => {
  const t = setup({ path: '/usesul/product/outro-produto' }); await tick(400);
  assert.equal(t.all('[data-origens-nav]').length, 0); assert.equal(t.navFetches().length, 0);
});

test('coexists with product-discovery: the geographic "Buscar cidade ou estado" block is still separate and unchanged', async () => {
  const t = setup({ features: ALL }); await tick(600);
  assert.ok(t.q('[data-origens-nav="desktop"]'));
  const block = t.q('[data-origens-discovery="product"]');
  if (block) assert.equal(block.querySelector('.o-toggle').textContent, 'Buscar cidade ou estado');
  assert.equal(t.all('#o-nav-q').length, 1);
});
