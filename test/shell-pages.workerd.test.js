import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';

// Páginas "de casca" no workerd REAL: a navbar acompanha o cliente por home, listagem, coleções, sobre e conta/pedidos, mas só com o escopo de catálogo E a
// feature header-nav; login, carrinho e checkout nunca. A origem (INK) é um stub que devolve o HTML do cabeçalho real.
const HOST = 'https://www.usesul.com.br';
const NAV_HTML = '<!doctype html><html><head><title>INK</title></head><body class="x"><header class="header"><nav class="navbar lg:!flex !hidden"><ul class="navbar-list"></ul></nav></header><main><h1>Pagina</h1></main></body></html>';
const NO_NAV_HTML = '<!doctype html><html><head><title>INK</title></head><body><main><h1>Sem cabecalho</h1></main></body></html>';
const PRODUCT_HTML = '<!doctype html><html><head></head><body><header><nav class="navbar"></nav></header><form id="form-product-1" class="form-product-options"></form></body></html>';
let last = null;
let origin = (req, url) => new Response(NAV_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': '_session=abc; Path=/; HttpOnly' } });

const instances = new Map();
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) instances.set(key, new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings,
    outboundService: async (request) => { const url = new URL(request.url); last = { path: url.pathname + url.search, cookie: request.headers.get('cookie'), method: request.method, turbo: request.headers.get('turbo-frame') }; return origin(request, url); }
  }));
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav';
const ON = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: FEATURES };
const loaders = (html) => (html.match(/\/__origens\/loader\.js\?v=/g) || []).length;
const get = async (bindings, path, init = {}) => { const mf = await worker(bindings); return mf.dispatchFetch(HOST + path, init); };
const count = async (bindings, path, init) => loaders(await (await get(bindings, path, init)).text());

test('shell pages get exactly ONE loader (catalog scope + header-nav): home, listing, collections, about, orders, order detail, trackings — with or without a query string', async () => {
  for (const path of ['/usesul', '/usesul/products', '/usesul/products?product_type=1&page=2', '/usesul/collections/novidades', '/usesul/collections/fala-daqui', '/usesul/about', '/usesul/orders', '/usesul/orders/9876543', '/usesul/orders/trackings']) {
    assert.equal(await count(ON, path), 1, path);
  }
});

test('login, cart, checkout and every other path never get the loader; the shape of a product page is unchanged', async () => {
  for (const path of ['/usesul/store_sessions/new', '/usesul/store_sessions', '/usesul/cart', '/usesul/cart/checkout_cart_items', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/usesul/orders/1/2', '/usesul/orders/guest_reviews/new', '/usesul/collections', '/usesul/api/v1/orders', '/usesul/product', '/outra']) {
    assert.equal(await count(ON, path), 0, path);
  }
  origin = () => new Response(PRODUCT_HTML, { headers: { 'content-type': 'text/html' } });
  assert.equal(await count(ON, '/usesul/product/qualquer-produto'), 1, 'product pages keep working exactly as before');
  origin = () => new Response(NAV_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': '_session=abc; Path=/; HttpOnly' } });
});

test('not enabled without the catalog scope AND header-nav: allowlist scope, no header-nav, disabled, dry-run and an invalid feature list all leave shell pages untouched', async () => {
  for (const bindings of [{ ...ON, WIDGET_SCOPE_MODE: 'allowlist' }, { ...ON, WIDGET_FEATURES: FEATURES.replace(',header-nav', '') }, { ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: FEATURES + ',evil' }, { ...ON, WIDGET_SCOPE_MODE: 'todo' }]) {
    for (const path of ['/usesul', '/usesul/collections/novidades', '/usesul/orders']) assert.equal(await count(bindings, path), 0, path + ' ' + JSON.stringify(bindings).slice(60, 140));
  }
});

test('fail-closed on the page: without the native header the HTML is byte-identical; only GET, 200, HTML, no Turbo-Frame, no attachment', async () => {
  origin = () => new Response(NO_NAV_HTML, { headers: { 'content-type': 'text/html' } });
  const noNav = await (await get(ON, '/usesul/about')).text();
  assert.equal(noNav, NO_NAV_HTML); assert.equal(loaders(noNav), 0);
  origin = () => new Response(NAV_HTML, { headers: { 'content-type': 'text/html' } });
  assert.equal(await count(ON, '/usesul/about', { headers: { 'Turbo-Frame': 'cart' } }), 0, 'Turbo-Frame fragments are out of scope');
  assert.equal(last.turbo, 'cart');
  const post = await get(ON, '/usesul/orders', { method: 'POST', body: 'x=1' }); assert.equal(loaders(await post.text()), 0); assert.equal(last.method, 'POST');
  origin = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); assert.equal(await (await get(ON, '/usesul/orders')).text(), '{"ok":true}');
  origin = () => new Response(null, { status: 302, headers: { location: '/usesul/store_sessions/new' } });
  const redirect = await get(ON, '/usesul/orders', { redirect: 'manual' }); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/usesul/store_sessions/new');
  origin = () => new Response(NAV_HTML, { status: 404, headers: { 'content-type': 'text/html' } }); assert.equal(await count(ON, '/usesul/about'), 0, 'a 404 is passed through');
  origin = () => new Response(NAV_HTML, { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=x.html' } }); assert.equal(await count(ON, '/usesul/about'), 0);
  origin = () => new Response(NAV_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': '_session=abc; Path=/; HttpOnly' } });
});

test('account pages keep the visitor\'s cookies and the origin\'s Set-Cookie untouched; the response is not cached by us; a loader already present is not duplicated', async () => {
  const res = await get(ON, '/usesul/orders/555', { headers: { cookie: '_session=visitante; theme=x' } });
  assert.equal(last.cookie, '_session=visitante; theme=x', 'the origin receives the visitor\'s own request (we never alter or store it)');
  assert.match(res.headers.get('set-cookie') || '', /_session=abc/, 'Set-Cookie from the origin reaches the visitor');
  assert.equal(loaders(await res.text()), 1);
  origin = () => new Response(NAV_HTML.replace('</body>', '<script src="/__origens/loader.js?v=4.3&c=x" data-use-origens-widget="4.3"></script></body>'), { headers: { 'content-type': 'text/html' } });
  assert.equal(await count(ON, '/usesul/about'), 1, 'the marker script already there: no second tag');
  origin = () => new Response(NAV_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': '_session=abc; Path=/; HttpOnly' } });
});

test('health reports shell_pages; the loader knows the shell scope only when it is on and carries the single shared classifier', async () => {
  const on = await (await get(ON, '/__origens/health')).json();
  assert.equal(on.shell_pages, true); assert.equal(on.version, '4.6'); assert.equal(on.scope_mode, 'product-catalog');
  const off = await (await get({ ...ON, WIDGET_SCOPE_MODE: 'allowlist' }, '/__origens/health')).json();
  assert.equal(off.shell_pages, false);
  const loader = await (await get(ON, '/__origens/loader.js')).text();
  assert.match(loader, /const SHELL_ENABLED = true;/); assert.match(loader, /function shellPageKind\(pathname, base\)/); assert.match(loader, /const INK_BASE = "\/usesul";/);
  const loaderOff = await (await get({ ...ON, WIDGET_SCOPE_MODE: 'allowlist' }, '/__origens/loader.js')).text();
  assert.match(loaderOff, /const SHELL_ENABLED = false;/);
});
