import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// Escopo do Worker (workerd real): modo allowlist (padrão) x product-catalog. A origem é um stub que fabrica a resposta por caminho.
const HOST = 'https://www.usesul.com.br';
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery';
const FIVE = ['serra-catarinense', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241'];
const ALLOW = FIVE.map((s) => '/usesul/product/' + s).join(',');
const PRODUCT_HTML = '<!doctype html><html><head><title>Produto</title></head><body class="x"><main><form id="form-product-3844110" class="form-product-options" action="/usesul/cart?product_id=1" method="post"><turbo-frame id="product_variants_options_frame"></turbo-frame></form></main><script>var a = 1;</script></body></html>';
const NO_FORM_HTML = '<!doctype html><html><head><title>Lista</title></head><body><main><h1>Não é produto</h1></main></body></html>';
const LOADER_RE = /\/__origens\/loader\.js\?v=/g;
const count = (html) => (html.match(LOADER_RE) || []).length;

// resposta da origem por caminho/pedido (o stub NÃO conhece a allowlist: o isolamento é do Worker)
function origin(req) {
  const u = new URL(req.url);
  const headers = { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'sess=abc; Path=/' };
  if (u.pathname === '/usesul/product/produto-404') return new Response(PRODUCT_HTML, { status: 404, headers });
  if (u.pathname === '/usesul/product/produto-500') return new Response(PRODUCT_HTML, { status: 500, headers });
  if (u.pathname === '/usesul/product/produto-302') return new Response(null, { status: 302, headers: { location: '/usesul' } });
  if (u.pathname === '/usesul/product/produto-json') return new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/usesul/product/produto-texto') return new Response(PRODUCT_HTML, { status: 200, headers: { 'content-type': 'text/plain' } });
  if (u.pathname === '/usesul/product/produto-anexo') return new Response(PRODUCT_HTML, { status: 200, headers: { ...headers, 'content-disposition': 'attachment; filename=x.html' } });
  if (u.pathname === '/usesul/product/produto-sem-form') return new Response(NO_FORM_HTML, { status: 200, headers });
  if (u.pathname === '/usesul/product/produto-com-loader') return new Response(PRODUCT_HTML.replace('</head>', '<script src="/__origens/loader.js?v=old" data-use-origens-widget="old"></script></head>'), { status: 200, headers });
  if (u.pathname === '/usesul/product/produto-grande') return new Response(PRODUCT_HTML.replace('<main>', '<main>' + '<p>' + 'x'.repeat(400) + '</p>'.repeat(1) + '<div>filler</div>'.repeat(3000)), { status: 200, headers });
  if (u.pathname === '/usesul' || u.pathname === '/usesul/products' || u.pathname.startsWith('/usesul/cart') || u.pathname.startsWith('/usesul/checkout') || u.pathname.startsWith('/admin')) return new Response(PRODUCT_HTML, { status: 200, headers }); // mesmo HTML "de produto": o caminho decide
  return new Response(PRODUCT_HTML, { status: 200, headers });
}
const instances = new Map();
async function mf(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) instances.set(key, new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', bindings, kvNamespaces: ['CART_REFS'], outboundService: async (req) => origin(req) }));
  return instances.get(key);
}
after(async () => { for (const m of instances.values()) await m.dispose(); });
const base = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW, WIDGET_FEATURES: FEATURES };
const CATALOG = { ...base, WIDGET_SCOPE_MODE: 'product-catalog' };
const get = async (b, path, init) => (await mf(b)).dispatchFetch(HOST + path, init);
const html = async (b, path, init) => { const r = await get(b, path, init); return { r, body: await r.text() }; };

test('DEFAULT (no WIDGET_SCOPE_MODE): exactly the five allowlisted products are injected (in <head>); every other product page is untouched', async () => {
  for (const slug of FIVE) { const { r, body } = await html(base, '/usesul/product/' + slug); assert.equal(r.status, 200); assert.equal(count(body), 1, slug); assert.ok(body.indexOf('loader.js') < body.indexOf('</head>')); }
  for (const slug of ['outro-produto', 'bah-dizeres', 'santa-catarina-clean']) { const { body } = await html(base, '/usesul/product/' + slug); assert.equal(count(body), 0, slug); assert.equal(body, PRODUCT_HTML); }
  const h = await (await get(base, '/__origens/health')).json();
  assert.equal(h.scope_mode, 'allowlist'); assert.equal(h.scope_status, 'default'); assert.equal(h.allowlist_size, 5);
});

test('CATALOG mode: any canonical product page with the native form gets exactly ONE loader, at the end of <body>, the rest of the HTML byte-identical', async () => {
  for (const slug of [...FIVE, 'bah-dizeres', 'retrato-gaucho', 'pai-gaucho-gremista', 'produto-novo-de-amanha', 'vida-no-sul-litoral-edition', 'a']) {
    const { r, body } = await html(CATALOG, '/usesul/product/' + slug);
    assert.equal(r.status, 200); assert.equal(count(body), 1, slug);
    assert.ok(body.indexOf('loader.js') > body.indexOf('</main>') && body.indexOf('loader.js') < body.lastIndexOf('</body>'), 'before </body>');
    assert.equal(body.replace(/<script src="\/__origens\/loader\.js[^>]*><\/script>/, ''), PRODUCT_HTML, 'only the tag was added');
    assert.match(r.headers.get('set-cookie') || '', /sess=abc/); assert.equal(r.headers.get('content-length'), null);
  }
});

test('CATALOG mode: transactional routes, listings, admin and odd pathnames get ZERO injection and the origin response is preserved byte for byte', async () => {
  for (const path of ['/usesul', '/usesul/products', '/usesul/cart', '/usesul/cart/item', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/admin/x', '/usesul/product/a/b', '/usesul/product/UPPER', '/usesul/product/a/', '/usesul/product/%2e%2e', '/usesul/product/x.y', '/usesul/product/__origens']) {
    const { body } = await html(CATALOG, path); assert.equal(count(body), 0, path); assert.equal(body, PRODUCT_HTML, path);
  }
});

test('CATALOG mode: non-GET, Turbo-Frame, non-200, non-HTML, attachments and pages WITHOUT the native product form are never injected', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) { const { body } = await html(CATALOG, '/usesul/product/bah-dizeres', { method, body: method === 'DELETE' ? undefined : 'x=1' }); assert.equal(count(body), 0, method); }
  assert.equal(count((await html(CATALOG, '/usesul/product/bah-dizeres', { headers: { 'Turbo-Frame': 'cart' } })).body), 0);
  for (const slug of ['produto-404', 'produto-500', 'produto-json', 'produto-texto', 'produto-anexo', 'produto-sem-form']) { const { r, body } = await html(CATALOG, '/usesul/product/' + slug); assert.equal(count(body), 0, slug); assert.notEqual(r.headers.get('content-type'), null); }
  const redirect = await get(CATALOG, '/usesul/product/produto-302', { redirect: 'manual' }); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/usesul');
  assert.equal((await html(CATALOG, '/usesul/product/produto-sem-form')).body, NO_FORM_HTML);
});

test('CATALOG mode: one loader even if the origin already carries one; a large streamed body is not corrupted or duplicated', async () => {
  assert.equal(count((await html(CATALOG, '/usesul/product/produto-com-loader')).body), 1);
  const big = (await html(CATALOG, '/usesul/product/produto-grande')).body;
  assert.equal(count(big), 1); assert.equal((big.match(/<div>filler<\/div>/g) || []).length, 3000); assert.ok(big.endsWith('</script></body></html>'));
});

test('kill switch and fail-closed settings still win in catalog mode: ENABLE_WIDGET=false/dry-run/unknown, empty features, bad scope value', async () => {
  for (const off of [{ ENABLE_WIDGET: 'false' }, { ENABLE_WIDGET: 'dry-run' }, { ENABLE_WIDGET: 'sim' }, { WIDGET_FEATURES: '' }, { WIDGET_FEATURES: 'return-link,inventado' }]) {
    const { body } = await html({ ...CATALOG, ...off }, '/usesul/product/bah-dizeres'); assert.equal(count(body), 0, JSON.stringify(off)); assert.equal(body, PRODUCT_HTML);
  }
  for (const bad of ['Product-Catalog', 'all', 'true', 'product_catalog']) {
    const b = { ...base, WIDGET_SCOPE_MODE: bad };
    assert.equal(count((await html(b, '/usesul/product/bah-dizeres')).body), 0, bad); assert.equal(count((await html(b, '/usesul/product/' + FIVE[0])).body), 1, bad + ' keeps the five');
    assert.equal((await (await get(b, '/__origens/health')).json()).scope_status, 'invalid');
  }
});

test('health: reports scope_mode/scope_status/features/cart-ref counters with NO product list, no tokens, no KV id', async () => {
  const h = await (await get(CATALOG, '/__origens/health')).json();
  assert.equal(h.version, LOADER_VERSION); assert.equal(h.scope_mode, 'product-catalog'); assert.equal(h.scope_status, 'ok'); assert.equal(h.features_status, 'ok');
  assert.deepEqual(h.widget_features, ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery']);
  assert.deepEqual(Object.keys(h.cart_ref_stats).sort(), ['read_hits', 'read_misses', 'rate_limited', 'reads', 'rejected', 'write_failures', 'writes'].sort());
  assert.ok(Object.values(h.cart_ref_stats).every((n) => Number.isInteger(n)));
  assert.doesNotMatch(JSON.stringify(h), /usesul\/product|serra-catarinense|d399f7d6|cartref:/);
});

test('loader.js carries the scope mode (default allowlist, catalog when set) and still embeds the allowlist as the instant fallback', async () => {
  const def = await (await get(base, '/__origens/loader.js')).text(); const cat = await (await get(CATALOG, '/__origens/loader.js')).text();
  assert.match(def, /const SCOPE_MODE = "allowlist";/); assert.match(cat, /const SCOPE_MODE = "product-catalog";/);
  assert.match(cat, /const ALLOWED_PATHS = \["\/usesul\/product\/serra-catarinense"/);
  const off = await (await get({ ...CATALOG, ENABLE_WIDGET: 'false' }, '/__origens/loader.js')).text(); assert.match(off, /widget disabled/);
});

test('cart-ref POST Referer: allowlist mode accepts only the five; catalog mode accepts any canonical product page; never listings/cart/checkout/other origins', async () => {
  const post = (b, referer) => get(b, '/__origens/cart-ref', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, referer, 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '198.51.100.' + Math.floor(Math.random() * 250) }, body: JSON.stringify({ v: 1, count: 0, items: [], subtotal: null, discount: null }) });
  assert.equal((await post(base, HOST + '/usesul/product/' + FIVE[0])).status, 201);
  assert.equal((await post(base, HOST + '/usesul/product/bah-dizeres')).status, 403);
  assert.equal((await post(CATALOG, HOST + '/usesul/product/bah-dizeres?utm_source=x')).status, 201);
  for (const ref of [HOST + '/usesul', HOST + '/usesul/products', HOST + '/usesul/cart', HOST + '/usesul/checkout/x', HOST + '/usesul/product/a/b', 'https://evil.example/usesul/product/bah-dizeres', 'http://www.usesul.com.br/usesul/product/bah-dizeres', '']) assert.equal((await post(CATALOG, ref)).status, 403, ref);
  const h = await (await get(CATALOG, '/__origens/health')).json(); assert.ok(h.cart_ref_stats.writes >= 1 && h.cart_ref_stats.rejected >= 1);
});
