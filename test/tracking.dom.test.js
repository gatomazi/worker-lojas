import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// Medição dos cliques nos nossos links (tracking) e abertura do drawer nativo: contrato GA4 v1 (jsdom, gtag da INK simulado).
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATHS = ['/usesul/product/serra-catarinense', '/usesul/product/aaa-um', '/usesul/product/bbb-dois', '/usesul/product/ccc-tres', '/usesul/product/ddd-quatro'];
const GA = 'G-8GYTEJ1F77';
const FEATURES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror'];
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const plain = (value) => JSON.parse(JSON.stringify(value)); // objetos do jsdom vêm de outro realm

function setup({ path = PATHS[0], search = '', features = FEATURES, gtag = true, gaScript = true, extraBody = '' } = {}) {
  let html = FIXTURE.replace('</main>', extraBody + '</main>');
  if (gaScript) html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + path + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  const events = [];
  if (gtag) w.gtag = function () { events.push([...arguments]); };
  w.fetch = async () => new Response(JSON.stringify({ ref: REF, ttl: 1800 }), { status: 201 });
  const nav = []; let prevented = 0;
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) { nav.push(a.href); if (e.defaultPrevented) prevented++; e.preventDefault(); } });
  w.eval(buildLoaderSource(PATHS, features));
  return { w, doc: w.document, events, nav, get prevented() { return prevented; } };
}
const block = (kind) => '<section data-origens-discovery="' + kind + '"><a class="o-cta" href="https://useorigens.com.br/sul">Explorar</a><a class="o-other" href="https://outro.example/x">outro</a></section>';
const click = (w, el, type = 'click', init = {}) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
const sf = (href) => new URL(href);

test('return link: marks the URL with the fixed enum + slug and emits exactly ONE event with only the allowed params', async () => {
  const t = setup(); await tick();
  const link = t.doc.getElementById('use-origens-return-link');
  click(t.w, link);
  assert.equal(t.events.length, 1);
  assert.deepEqual(plain(t.events[0]), ['event', 'origens_explore_storefront_click', { send_to: GA, entry_point: 'ink_product_return', region: 'sul', transport_type: 'beacon', product_slug: 'serra-catarinense' }]);
  const u = sf(link.href);
  assert.equal(u.origin + u.pathname, 'https://useorigens.com.br/sul');
  assert.equal(u.searchParams.get('origens_src'), 'ink_product_return'); assert.equal(u.searchParams.get('origens_p'), 'serra-catarinense');
  assert.equal(t.prevented, 0, 'the loader never cancels the navigation');
  click(t.w, link); assert.equal(t.events.length, 2, 'one click = one event (a second click is a second event, never a duplicate of the first)');
});

const DRAWER = '<div class="cart-drawer"><turbo-frame id="cart"><div class="cart-drawer__main"><ul></ul></div></turbo-frame></div><button id="shopping-cart-menu-desk" type="button">carrinho</button>';
const NOTICE = '<div class="cookie-acceptance" data-controller="ink-store--cookie-acceptance"><button id="accept">Aceitar cookies</button></div>';
test('with the INK cookie notice still on screen nothing is measured (the origin marker is still set); once the visitor accepts it, measurement starts', async () => {
  const t = setup({ extraBody: NOTICE }); await tick();
  const link = t.doc.getElementById('use-origens-return-link');
  click(t.w, link);
  assert.equal(t.events.length, 0); assert.equal(sf(link.href).searchParams.get('origens_src'), 'ink_product_return');
  t.doc.querySelector('.cookie-acceptance').remove(); // o controller da INK remove o aviso ao aceitar
  click(t.w, link); assert.equal(t.events.length, 1);
  const off = setup({ search: '?origens_open_cart=1', extraBody: NOTICE + DRAWER }); off.doc.getElementById('shopping-cart-menu-desk').addEventListener('click', () => off.doc.querySelector('.cart-drawer').classList.add('open')); await tick(2500);
  assert.equal(off.events.filter((e) => e[1] === 'origens_native_cart_opened').length, 0, 'the native-cart event also waits for the notice to be accepted');
});

test('cart drawer and post-add blocks use their own entry_point; the cart_ref token never reaches the event', async () => {
  const t = setup({ extraBody: block('cart') + block('post-add') }); await tick(1400);
  const [cart, post] = [...t.doc.querySelectorAll('[data-origens-discovery]')];
  click(t.w, cart.querySelector('.o-cta')); click(t.w, post.querySelector('.o-cta'));
  assert.deepEqual(t.events.map((e) => e[2].entry_point), ['ink_cart_drawer', 'ink_post_add']);
  assert.ok(!JSON.stringify(t.events).includes(REF) && !/cart_ref|http|useorigens/i.test(JSON.stringify(t.events)));
  const u = sf(cart.querySelector('.o-cta').href);
  assert.equal(u.searchParams.get('origens_src'), 'ink_cart_drawer');
});

test('foreign links, storefront links outside our blocks and non-storefront links inside them are untouched and silent', async () => {
  const t = setup({ extraBody: block('cart') + '<a id="out" href="https://useorigens.com.br/sul">fora</a><a id="ink" href="/usesul/cart">carrinho</a>' }); await tick();
  const before = t.doc.getElementById('out').href;
  click(t.w, t.doc.querySelector('.o-other')); click(t.w, t.doc.getElementById('out')); click(t.w, t.doc.getElementById('ink'));
  assert.equal(t.events.length, 0); assert.equal(t.doc.getElementById('out').href, before);
  assert.equal(t.doc.querySelector('.o-other').href, 'https://outro.example/x');
});

test('middle click counts; the context menu only marks (open in a new tab keeps the attribution) and never counts', async () => {
  const t = setup(); await tick();
  const link = t.doc.getElementById('use-origens-return-link');
  click(t.w, link, 'contextmenu', { button: 2 }); assert.equal(t.events.length, 0); assert.equal(sf(link.href).searchParams.get('origens_src'), 'ink_product_return');
  click(t.w, link, 'auxclick', { button: 1 }); assert.equal(t.events.length, 1);
  click(t.w, link, 'auxclick', { button: 2 }); assert.equal(t.events.length, 1);
});

test('without gtag, or without the property script on the page: no event and no error, the link is still marked and the navigation intact', async () => {
  for (const opts of [{ gtag: false }, { gaScript: false }]) {
    const t = setup(opts); await tick();
    const link = t.doc.getElementById('use-origens-return-link');
    click(t.w, link);
    assert.equal(t.events.length, 0); assert.equal(t.nav.length, 1); assert.equal(sf(link.href).searchParams.get('origens_src'), 'ink_product_return');
  }
  const throwing = setup({ gtag: false }); throwing.w.gtag = () => { throw new Error('blocked'); }; await tick();
  assert.doesNotThrow(() => click(throwing.w, throwing.doc.getElementById('use-origens-return-link')));
  assert.equal(throwing.nav.length, 1);
});

test('the marker slug is the CURRENT allowlisted page for each of the five products; nothing is added off the allowlist', async () => {
  for (const path of PATHS) {
    const t = setup({ path }); await tick();
    const link = t.doc.getElementById('use-origens-return-link'); click(t.w, link);
    assert.equal(t.events[0][2].product_slug, path.split('/').pop()); assert.equal(sf(link.href).searchParams.get('origens_p'), path.split('/').pop());
  }
  const off = setup({ path: '/usesul/product/fora-da-lista' }); await tick();
  assert.equal(off.doc.getElementById('use-origens-return-link'), null); assert.equal(off.doc.querySelectorAll('style[data-origens], [data-origens-discovery]').length, 0);
});

test('Turbo: allowed A -> allowed B -> not allowed -> Serra: mounted where allowed, ZERO of our UI/listeners on the not-allowed page', async () => {
  const t = setup({ path: PATHS[1] }); await tick();
  const visit = async (path) => { t.w.history.pushState({}, '', path); for (const n of ['turbo:render', 'turbo:load']) t.doc.dispatchEvent(new t.w.Event(n)); await tick(200); };
  assert.ok(t.doc.getElementById('use-origens-return-link'));
  await visit(PATHS[2]); assert.ok(t.doc.getElementById('use-origens-return-link'));
  // Turbo troca o <body>: repõe a página sem o link e com um bloco solto nosso simulando resto de UI.
  await visit('/usesul/product/nao-permitido');
  assert.equal(t.doc.getElementById('use-origens-return-link'), null);
  t.doc.body.insertAdjacentHTML('beforeend', block('cart'));
  click(t.w, t.doc.querySelector('.o-cta')); assert.equal(t.events.length, 0, 'no listener acts off the allowlist'); assert.equal(sf(t.doc.querySelector('.o-cta').href).search, '');
  await visit(PATHS[0]); assert.ok(t.doc.getElementById('use-origens-return-link'));
  click(t.w, t.doc.getElementById('use-origens-return-link')); assert.equal(t.events.length, 1); assert.equal(t.events[0][2].product_slug, 'serra-catarinense');
});

test('origens_native_cart_opened: only AFTER the native drawer is really open, once, entry_point storefront_return; the param is consumed', async () => {
  const t = setup({ search: '?origens_open_cart=1', extraBody: DRAWER });
  const opener = t.doc.getElementById('shopping-cart-menu-desk');
  opener.addEventListener('click', () => setTimeout(() => t.doc.querySelector('.cart-drawer').classList.add('open'), 300));
  await tick(300); assert.equal(t.events.filter((e) => e[1] === 'origens_native_cart_opened').length, 0, 'the URL parameter alone emits nothing');
  await tick(1800);
  const opened = t.events.filter((e) => e[1] === 'origens_native_cart_opened');
  assert.equal(opened.length, 1);
  assert.deepEqual(plain(opened[0][2]), { send_to: GA, entry_point: 'storefront_return', region: 'sul', transport_type: 'beacon', product_slug: 'serra-catarinense' });
  assert.equal(t.w.location.search, '');
});

test('origens_native_cart_opened is NOT emitted when the drawer never opens', async () => {
  const t = setup({ search: '?origens_open_cart=1', extraBody: DRAWER }); await tick(5200);
  assert.equal(t.events.filter((e) => e[1] === 'origens_native_cart_opened').length, 0);
});

test('with no link-creating feature the tracking module is not even in the bundle', () => {
  assert.ok(!buildLoaderSource(PATHS, ['city-search']).includes('origens_explore_storefront_click'));
  assert.ok(buildLoaderSource(PATHS, ['return-link']).includes('origens_explore_storefront_click'));
});
