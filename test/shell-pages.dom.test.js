import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// Páginas de casca no navegador (jsdom): a navbar, o FAB e a ponte do carrinho acompanham home, listagem, coleções, sobre e conta/pedidos; NENHUM módulo de
// produto (retorno, descoberta, drawer) monta ali; login, carrinho e checkout nunca; e a transição Turbo entre os tipos de página não duplica nem deixa lixo.
const read = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const PRODUCT = read('product-page.html'); const HEADER = read('ink-header.html'); const HEADER_IN = read('ink-header-logged-in.html'); const HELP = read('ink-help.html');
const HOST = 'https://www.usesul.com.br';
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav'];
const WITHOUT_NAV = ALL.filter((f) => f !== 'header-nav');
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const STATES = [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }, { uf: 'SC', name: 'Santa Catarina', path: '/sul/sc' }, { uf: 'RS', name: 'Rio Grande do Sul', path: '/sul/rs' }];
const CONFIG = { v: 2, states: STATES, top: [{ id: 1, title: 'Novidades', slug: 'novidades', order: 1 }], more: [{ id: 2, title: 'Seu Lugar', slug: 'seu-lugar', order: 1 }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CART = '<div class="cart-drawer"><turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="1"></span></span></div><div class="cart-drawer__main"><ul>' +
  '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>Serra Catarinense</p><p>Preta</p><p>M</p></div><div class="price-details"><div class="price"><span>R$ 109,90</span></div></div>' +
  '<form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M"><input class="quantity-input" type="text" value="1" name="cart_item[quantity]"></form></li></ul></div>' +
  '<div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="109.9"><p>Total</p><div><p>R$ 109,90</p></div></div></div></div></turbo-frame></div>';
const SHELL_PAGE = (header) => '<!doctype html><html><head><title>INK</title></head><body class="font-poppins">' + header + '<main><h1>Minha conta</h1></main>' + CART + HELP + '</body></html>';

function setup({ path, features = ALL, scope = 'product-catalog', html, header = HEADER, fetchImpl } = {}) {
  const virtualConsole = new VirtualConsole(); const t = { navs: [], lastLink: null, fetches: [], navigations: [], scripts: [] };
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) t.navs.push(t.lastLink ? t.lastLink.href : null); });
  const dom = new JSDOM(html || SHELL_PAGE(header), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none' || n.classList.contains('hidden')) return []; } return [{}]; };
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), method: options.method || 'GET' });
    if (fetchImpl) return fetchImpl(String(url), options);
    if (String(url).includes('cart-ref')) return json({ ref: REF, ttl: 1800 }, 201);
    if (String(url).includes('/__origens/navbar')) return json(CONFIG);
    return new Response('nope', { status: 404 });
  };
  const head = w.document.head; const original = head.appendChild.bind(head);
  head.appendChild = (node) => { if (node.tagName === 'SCRIPT') t.scripts.push(node.src); return original(node); };
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.getAttribute('href')) { t.lastLink = a; if (!e.defaultPrevented) { t.navigations.push(a.href); e.preventDefault(); } } });
  Object.assign(t, { w, doc: w.document });
  w.eval(buildLoaderSource([], features, scope));
  t.q = (s) => w.document.querySelector(s); t.all = (s) => [...w.document.querySelectorAll(s)];
  t.ours = () => t.all('[data-origens-nav], #o-wa-fab, [data-origens-discovery], #use-origens-return-link').length;
  t.navFetches = () => t.fetches.filter((f) => f.url.includes('/__origens/navbar')); t.posts = () => t.fetches.filter((f) => f.url.includes('cart-ref'));
  return t;
}
const goto = async (t, path) => { t.w.history.pushState({}, '', path); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(300); };
const click = (t, el) => el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));
const stubHelp = (t) => { t.q('[data-controller~="ink-store--help-button"]').getBoundingClientRect = () => ({ top: 700, right: 1260, bottom: 748, left: 1132, width: 128, height: 48 }); Object.defineProperty(t.w, 'innerWidth', { configurable: true, value: 1280 }); Object.defineProperty(t.w, 'innerHeight', { configurable: true, value: 800 }); };

const SHELL_PATHS = ['/usesul', '/usesul/products', '/usesul/collections/novidades', '/usesul/about', '/usesul/orders', '/usesul/orders/987654', '/usesul/orders/trackings'];
test('every shell page mounts the navbar (one header, one form) and the WhatsApp FAB; the config is fetched once', async () => {
  for (const path of SHELL_PATHS) {
    const t = setup({ path }); stubHelp(t); await tick(400);
    assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, path); assert.equal(t.all('#o-nav-search').length, 1, path); assert.equal(t.all('[data-origens-nav="menu"]').length, 1, path);
    assert.equal(t.all('#o-wa-fab').length, 1, path); assert.equal(t.navFetches().length, 1, path);
    assert.deepEqual([...t.q('.o-nav-full [data-dd="regioes"] .o-dd-panel').querySelectorAll('a')].map((a) => a.textContent), ['Paraná', 'Santa Catarina', 'Rio Grande do Sul', 'Ver estados'], path);
  }
});

test('login, cart, checkout and other paths mount NOTHING and make no request; a bogus order path does not count as an order', async () => {
  for (const path of ['/usesul/store_sessions/new', '/usesul/store_sessions', '/usesul/cart', '/usesul/cart/checkout_cart_items', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/usesul/orders/1/2', '/usesul/orders/guest_reviews/new', '/usesul/collections', '/usesul/product', '/outra']) {
    const t = setup({ path }); stubHelp(t); await tick(400);
    assert.equal(t.ours(), 0, path); assert.equal(t.fetches.length, 0, path);
  }
});

test('the shell scope needs the catalog scope AND header-nav: allowlist scope or a feature list without header-nav leaves the page alone', async () => {
  for (const [features, scope] of [[ALL, 'allowlist'], [WITHOUT_NAV, 'product-catalog']]) {
    const t = setup({ path: '/usesul/about', features, scope }); stubHelp(t); await tick(400);
    assert.equal(t.ours(), 0); assert.equal(t.fetches.length, 0);
  }
});

test('NO product module runs on a shell page: no return link, no discovery block, no discovery.js, no drawer/cart observers, no tracking marks', async () => {
  const t = setup({ path: '/usesul/collections/novidades' }); stubHelp(t); await tick(600);
  assert.equal(t.q('#use-origens-return-link'), null); assert.equal(t.q('[data-origens-discovery]'), null);
  assert.ok(!t.scripts.some((src) => /discovery\.js/.test(src)), 'discovery.js is never requested');
  // even opening the native cart drawer (which the product modules watch) creates nothing
  t.q('.cart-drawer').classList.add('open'); await tick(700); assert.equal(t.q('[data-origens-discovery]'), null);
  assert.equal(t.fetches.filter((f) => !f.url.includes('/__origens/navbar')).length, 0, 'only the one navbar config request exists');
});

test('the search and the logo leave through the cart bridge from a shell page: one snapshot, q kept, the token reused; internal INK links get no token', async () => {
  const t = setup({ path: '/usesul/orders' }); await tick(400);
  t.q('.o-nav-lupa').click(); const input = t.q('#o-nav-q'); input.value = 'chimarrão'; input.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  t.q('#o-nav-search').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true })); await tick(300);
  const dest = new URL(t.navs.at(-1)); assert.equal(dest.pathname, '/sul/busca'); assert.equal(dest.searchParams.get('q'), 'chimarrão'); assert.equal(dest.searchParams.get('cart_ref'), REF); assert.equal(t.posts().length, 1);
  click(t, t.q('.o-nav-logo')); await tick(200);
  assert.equal(t.posts().length, 1, 'same cart => same token'); assert.equal(new URL(t.navigations.at(-1)).searchParams.get('cart_ref'), REF);
  const before = t.navigations.length; click(t, t.q('.o-nav-full > a[href^="/usesul/collections/"]')); click(t, t.q('a[href="/usesul/orders"]'));
  for (const href of t.navigations.slice(before)) assert.equal(new URL(href).searchParams.has('cart_ref'), false);
  assert.equal(t.posts().length, 1);
});

test('logged-in account pages (/orders, /orders/<pedido>): navbar mounted, greeting/Meus pedidos/Sair kept, Dashboard without a destination hidden', async () => {
  for (const path of ['/usesul/orders', '/usesul/orders/123']) {
    const t = setup({ path, header: HEADER_IN }); await tick(400);
    assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, path);
    const account = t.q('#navbar-list-mobile > section.absolute');
    assert.match(account.textContent, /Olá, Maria/); assert.ok([...account.querySelectorAll('li')].some((li) => li.textContent.trim() === 'Meus pedidos' && !li.hasAttribute('data-origens-hide')));
    assert.ok([...account.querySelectorAll('li')].some((li) => li.textContent.trim() === 'Sair' && !li.hasAttribute('data-origens-hide')));
    assert.ok([...account.querySelectorAll('li')].find((li) => /Dashboard/.test(li.textContent)).hasAttribute('data-origens-hide'));
  }
});

test('Turbo between page kinds: product -> collection keeps ONE header and drops the product modules; -> login removes everything; -> product mounts all again', async () => {
  const t = setup({ path: '/usesul/product/serra-catarinense', features: ['return-link', 'cart-mirror', 'header-nav'], html: PRODUCT.replace(/(<body[^>]*>)/, '$1' + HEADER).replace('</main>', CART + '</main>').replace('</body>', HELP + '</body>') });
  stubHelp(t); await tick(600);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.ok(t.q('#use-origens-return-link'), 'the return link (a product module) is present on the product page');
  await goto(t, '/usesul/collections/novidades');
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, 'still exactly one header'); assert.equal(t.all('#o-nav-search').length, 1); assert.equal(t.all('#o-wa-fab').length, 1);
  assert.equal(t.q('#use-origens-return-link'), null, 'product-only modules leave'); assert.equal(t.q('[data-origens-discovery]'), null);
  await goto(t, '/usesul/orders/55'); assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-wa-fab').length, 1);
  await goto(t, '/usesul/store_sessions/new'); assert.equal(t.ours(), 0, 'login: everything of ours is gone');
  await goto(t, '/usesul/cart'); assert.equal(t.ours(), 0);
  await goto(t, '/usesul/about'); assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, 'a shell page mounts again');
  await goto(t, '/usesul/product/serra-catarinense'); await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.ok(t.q('#use-origens-return-link'), 'back on a product page the product modules return');
  assert.equal(t.navFetches().length, 1, 'the config is fetched once for the whole visit');
});

test('a native header swap (Turbo body replacement) on a shell page rebuilds once; a config failure leaves the native header and the FAB', async () => {
  const t = setup({ path: '/usesul/collections/novidades' }); stubHelp(t); await tick(400);
  t.q('header').outerHTML = HEADER; await tick(400);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('style[data-origens-nav]').length, 1);
  const failing = setup({ path: '/usesul/orders', fetchImpl: () => json({ error: 'unavailable' }, 503) }); stubHelp(failing); await tick(500);
  assert.equal(failing.all('[data-origens-nav]').length, 0); assert.ok(failing.q('ul.navbar-list') && failing.q('a.brand'), 'native header intact'); assert.equal(failing.all('#o-wa-fab').length, 1);
});
