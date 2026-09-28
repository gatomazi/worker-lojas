import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { STORES } from '../src/stores.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// Um Worker por loja no workerd REAL (Norte e Centro-Oeste), com URLs REAIS de produto de cada loja (scripts/store-samples.json).
// A INK e o storefront são stubs (outboundService): o isolamento entre lojas é do Worker.
const SAMPLES = JSON.parse(readFileSync(new URL('../scripts/store-samples.json', import.meta.url), 'utf8'));
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session';
const INK_HTML = (base) => '<!doctype html><html><head><title>Produto</title></head><body><main><form id="form-product-3844110" class="form-product-options" action="' + base + '/cart?product_id=1" method="post"><button type="submit">Adicionar ao carrinho</button></form></main></body></html>';
const NAV_HTML = '<!doctype html><html><head><title>Casca</title></head><body><header><nav class="navbar"></nav></header></body></html>';
const LOADER_RE = /\/__origens\/loader\.js\?v=/g;
const count = (text) => (text.match(LOADER_RE) || []).length;
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const snapshot = (id) => ({ v: 1, count: 1, items: [{ productId: id, name: 'Camiseta', color: 'Preta', size: 'M', variant: 'Preta-M', quantity: 1, linePriceText: 'R$ 109,90', linePrice: 109.9, image: IMG }], subtotal: 109.9, discount: null });

const outbound = (store, storefront = () => new Response('{}', { status: 404 })) => async (request) => {
  const url = new URL(request.url);
  if (url.host === 'useorigens.com.br') return storefront(url, request);
  if (url.host === store.inkHost) {
    if (url.pathname.startsWith(store.inkBase + '/product/')) return new Response(INK_HTML(store.inkBase), { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'sess=abc; Path=/' } });
    return new Response(NAV_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response('unexpected host ' + url.host, { status: 599 });
};

const sharedKv = mkdtempSync(join(tmpdir(), 'uo-kv-'));
const instances = [];
async function worker(store, { bindings = {}, kv = 'own', storefront } = {}) {
  const base = { STORE_ID: store.id, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: SAMPLES[store.id].allowlist.join(','), WIDGET_FEATURES: FEATURES };
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', bindings: { ...base, ...bindings },
    ...(kv === 'own' ? { kvNamespaces: [store.kvBinding] } : kv === 'shared' ? { kvNamespaces: { [store.kvBinding]: 'shared-namespace' }, kvPersist: sharedKv } : {}),
    outboundService: outbound(store, storefront)
  });
  instances.push(mf);
  return mf;
}
after(async () => { for (const mf of instances) await mf.dispose(); });
const url = (store, path) => 'https://' + store.inkHost + path;

for (const id of ['norte', 'centro']) {
  const store = STORES[id];
  const products = SAMPLES[id].allowlist;
  const other = STORES[id === 'norte' ? 'centro' : 'norte'];

  test(`[${id}] real product pages get exactly one loader; fail-open on non-200 and non-HTML; UTM keeps working, trailing slash stays native`, async () => {
    const mf = await worker(store);
    for (const path of [...products, ...SAMPLES[id].extraProducts]) {
      const res = await mf.dispatchFetch(url(store, path));
      assert.equal(res.status, 200, path); assert.equal(count(await res.text()), 1, path);
      assert.match(res.headers.get('set-cookie') || '', /sess=abc/, 'origin cookies survive the rewrite');
    }
    assert.equal(count(await (await mf.dispatchFetch(url(store, products[0] + '?utm_source=qa&utm_medium=x'))).text()), 1, 'UTM');
    // A INK serve a URL com barra final (200, sem redirect), mas o escopo é o do slug canônico (igual à Use Sul): sem loader, página nativa intacta.
    const slash = await mf.dispatchFetch(url(store, products[0] + '/'));
    assert.equal(slash.status, 200); assert.equal(count(await slash.text()), 0, 'trailing slash stays native');
    // product-catalog: any true product page of the store is covered, not only the allowlist
    assert.equal(count(await (await mf.dispatchFetch(url(store, store.inkBase + '/product/qualquer-produto-real'))).text()), 1);
  });

  test(`[${id}] transactional, admin and shell paths are never touched; POST and Turbo-Frame pass through; other stores' paths are not this store's product`, async () => {
    const mf = await worker(store);
    const untouched = [store.inkBase + '/cart', store.inkBase + '/cart?x=1', store.inkBase + '/checkout', store.inkBase + '/checkout/contact_and_shipping_details', store.inkBase + '/store_sessions/new',
      store.inkBase + '/login', store.inkBase + '/admin', store.inkBase + '/orders/a/b', store.inkBase + '/products/x', store.inkBase + '/collections/A', store.inkBase + '/collections/a/b', '/admin', '/',
      other.inkBase + '/product/x', store.inkBase + '/product/x/y', store.inkBase + '/product/', store.inkBase + '/product/__origens'];
    for (const path of untouched) { const res = await mf.dispatchFetch(url(store, path)); assert.equal(count(await res.text()), 0, path); }
    assert.equal(count(await (await mf.dispatchFetch(url(store, products[0]), { method: 'POST', body: 'a=1' })).text()), 0, 'POST');
    assert.equal(count(await (await mf.dispatchFetch(url(store, products[0]), { headers: { 'Turbo-Frame': 'x' } })).text()), 0, 'Turbo-Frame');
  });

  test(`[${id}] shell pages (home, listing, collections, about, account) get ONE loader only with product-catalog + header-nav; health says so; the allowlist scope and a missing header-nav keep them native`, async () => {
    const mf = await worker(store);
    const health = await (await mf.dispatchFetch(url(store, '/__origens/health'))).json();
    assert.equal(health.shell_pages, true);
    const shell = [store.inkBase, store.inkBase + '/', store.inkBase + '/products', store.inkBase + '/collections/' + SAMPLES[id].collection, store.inkBase + '/about', store.inkBase + '/orders', store.inkBase + '/orders/trackings', store.inkBase + '/orders/123'];
    for (const path of shell) assert.equal(count(await (await mf.dispatchFetch(url(store, path))).text()), 1, path);
    assert.equal(count(await (await mf.dispatchFetch(url(store, store.inkBase + '/products?product_type=1&utm_source=x'))).text()), 1, 'with a query string');
    const allow = await worker(store, { bindings: { WIDGET_SCOPE_MODE: 'allowlist' } });
    assert.equal((await (await allow.dispatchFetch(url(store, '/__origens/health'))).json()).shell_pages, false);
    for (const path of shell) assert.equal(count(await (await allow.dispatchFetch(url(store, path))).text()), 0, 'allowlist scope: ' + path);
    const noNav = await worker(store, { bindings: { WIDGET_FEATURES: 'return-link,cart-mirror' } });
    for (const path of shell) assert.equal(count(await (await noNav.dispatchFetch(url(store, path))).text()), 0, 'no header-nav: ' + path);
    // a non-HTML or header-less page is never rewritten
    assert.equal((await mf.dispatchFetch(url(store, store.inkBase + '/about'), { method: 'POST', body: 'a=1' })).status, 200);
    assert.equal(count(await (await mf.dispatchFetch(url(store, store.inkBase + '/about'), { method: 'POST', body: 'a=1' })).text()), 0, 'POST');
    assert.equal(count(await (await mf.dispatchFetch(url(store, store.inkBase + '/about'), { headers: { 'Turbo-Frame': 'x' } })).text()), 0, 'Turbo-Frame');
  });

  test(`[${id}] health: own identity, version, KV binding present, features; an unrelated host is refused`, async () => {
    const mf = await worker(store);
    const health = await (await mf.dispatchFetch(url(store, '/__origens/health'))).json();
    assert.equal(health.service, store.workerName); assert.equal(health.store, id); assert.equal(health.store_status, 'ok');
    assert.equal(health.version, LOADER_VERSION); assert.equal(health.widget_mode, 'true'); assert.equal(health.scope_mode, 'product-catalog');
    assert.equal(health.kv_bound, true); assert.equal(health.allowlist_size, 3); assert.equal(health.widget_features.length, 8);
    assert.equal(JSON.stringify(health).includes(store.kvBinding), false, 'the binding name/id never appears in the health');
    const bare = await worker(store, { kv: 'none' });
    assert.equal((await (await bare.dispatchFetch(url(store, '/__origens/health'))).json()).kv_bound, false);
    assert.equal((await mf.dispatchFetch('https://' + other.inkHost + products[0])).status, 404, 'a request for another store host is not mirrored');
    assert.equal((await mf.dispatchFetch('https://www.usesul.com.br/usesul/product/serra-catarinense')).status, 404);
  });

  test(`[${id}] the loader carries ONLY this store: host, prefix, storefront base and GA4; nothing of the other stores`, async () => {
    const mf = await worker(store);
    const page = await (await mf.dispatchFetch(url(store, products[0]))).text();
    const src = /\/__origens\/loader\.js\?[^"]+/.exec(page)[0];
    const loader = await (await mf.dispatchFetch(url(store, src))).text();
    assert.match(loader, new RegExp('"inkHost":"' + store.inkHost.replaceAll('.', '\\.') + '"')); assert.match(loader, new RegExp('"inkBase":"' + store.inkBase + '"'));
    assert.ok(loader.includes('"base":"' + store.storefrontBase + '"')); assert.ok(loader.includes('"ga":"' + store.ga + '"')); assert.ok(loader.includes('"region":"' + store.region + '"'));
    assert.match(loader, /const SHELL_ENABLED = true;/);
    for (const foreign of [STORES.sul, other]) {
      for (const literal of [foreign.inkHost, foreign.inkBase, foreign.ga, '"base":"' + foreign.storefrontBase + '"']) assert.equal(loader.includes(literal), false, 'foreign literal ' + literal);
    }
    assert.match((await mf.dispatchFetch(url(store, src))).headers.get('cache-control'), /immutable/, 'own content hash => immutable');
  });

  test(`[${id}] navbar gateway reads ONLY /api/navbar/${store.region}; the other region's payload, a Sul link or a foreign path is refused (503, native header stays)`, async () => {
    const calls = [];
    const good = { v: 2, region: store.region, states: store.ufs.map((uf) => ({ uf, name: store.stateNames[uf], path: store.storefrontBase + '/' + uf.toLowerCase() })), top: [], more: [] };
    let payload = good;
    const mf = await worker(store, { storefront: (u, req) => { calls.push(u.pathname + '|' + (req.headers.get('cookie') || '')); return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }); } });
    const ok = await mf.dispatchFetch(url(store, '/__origens/navbar'));
    assert.equal(ok.status, 200); assert.deepEqual((await ok.json()).states.map((s) => s.uf), store.ufs);
    assert.deepEqual(calls, ['/api/navbar/' + store.region + '|']);
    for (const bad of [{ ...good, region: other.region }, { ...good, region: 'sul' }, { ...good, states: [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }] },
      { ...good, top: [{ id: 1, title: 'Sul', slug: 'sul', url: 'https://www.usesul.com.br/usesul/collections/sul' }] },
      { ...good, top: [{ id: 1, title: 'Outra', slug: 'outra', url: 'https://' + other.inkHost + other.inkBase + '/collections/outra' }] }]) {
      payload = bad; assert.equal((await mf.dispatchFetch(url(store, '/__origens/navbar'))).status, 503, JSON.stringify(bad).slice(0, 80));
    }
    const down = await worker(store, { storefront: () => new Response('x', { status: 502 }) });
    assert.equal((await down.dispatchFetch(url(store, '/__origens/navbar'))).status, 503, 'storefront down => the loader simply does not mount the navbar');
  });

  test(`[${id}] city search reads ONLY /api/cidades/${store.region}, answers with links to this region and drops cities of other regions`, async () => {
    const s = SAMPLES[id].search;
    const cities = Array.from({ length: 120 }, (_, i) => ({ n: 'Cidade ' + i, u: store.ufs[i % store.ufs.length], s: 'cidade-' + i }));
    cities.push({ n: s.city, u: s.uf, s: s.href.split('/').pop() }, { n: 'Curitiba', u: 'PR', s: 'curitiba' });
    const calls = [];
    const mf = await worker(store, { storefront: (u) => { calls.push(u.pathname); return new Response(JSON.stringify(cities), { headers: { 'content-type': 'application/json' } }); } });
    const res = await mf.dispatchFetch(url(store, '/__origens/search?q=' + encodeURIComponent(s.query)));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.results[0].href, s.href); assert.deepEqual(calls, ['/api/cidades/' + store.region]);
    const curitiba = await (await mf.dispatchFetch(url(store, '/__origens/search?q=curitiba'))).json();
    assert.deepEqual(curitiba.results, [], 'a Sul city never shows up in another region');
    const state = await (await mf.dispatchFetch(url(store, '/__origens/search?q=' + encodeURIComponent(store.stateNames[store.ufs[0]].slice(0, 4))))).json();
    assert.ok(state.results.some((r) => r.type === 'state' && r.href === 'https://useorigens.com.br' + store.storefrontBase + '/' + store.ufs[0].toLowerCase()));
    assert.equal((await mf.dispatchFetch(url(store, '/__origens/search?q=a'))).status, 400);
  });

  test(`[${id}] cart mirror: own KV binding only; foreign Referer/Origin refused; same-store token round-trips; missing binding = 501 (KV outage = 503 is covered in cart-ref.unit.test.js)`, async () => {
    const mf = await worker(store);
    const headers = (path, host = store.inkHost) => ({ 'content-type': 'application/json', origin: 'https://' + host, referer: 'https://' + host + path, 'sec-fetch-site': 'same-origin' });
    const post = (path, host, body = snapshot('4932916')) => mf.dispatchFetch(url(store, '/__origens/cart-ref'), { method: 'POST', headers: headers(path, host), body: JSON.stringify(body) });
    const created = await post(products[0]);
    assert.equal(created.status, 201); const { ref } = await created.json(); assert.match(ref, /^[A-Za-z0-9_-]{22}$/);
    const read = await mf.dispatchFetch(url(store, '/__origens/cart-ref/' + ref));
    assert.equal(read.status, 200); const body = await read.json(); assert.equal(body.items[0].name, 'Camiseta'); assert.ok(!('store' in body), 'the store marker never leaks to the storefront');
    assert.equal((await post(other.inkBase + '/product/x', other.inkHost)).status, 403, 'referer of another store');
    assert.equal((await post('/usesul/product/serra-catarinense', 'www.usesul.com.br')).status, 403, 'referer of the Sul');
    assert.equal((await post(store.inkBase + '/cart')).status, 403, 'a transactional page is not an authorized origin');
    const noKv = await worker(store, { kv: 'none' });
    assert.equal((await noKv.dispatchFetch(url(store, '/__origens/cart-ref'), { method: 'POST', headers: headers(products[0]), body: JSON.stringify(snapshot('1')) })).status, 501);
    const wrongBinding = await new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings: { STORE_ID: store.id, ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: products.join(','), WIDGET_FEATURES: FEATURES }, outboundService: outbound(store) });
    instances.push(wrongBinding);
    assert.equal((await wrongBinding.dispatchFetch(url(store, '/__origens/cart-ref'), { method: 'POST', headers: headers(products[0]), body: JSON.stringify(snapshot('1')) })).status, 501, 'the Sul binding name is never used as a fallback');
  });
}

test('cross-store token: a token minted by the Norte Worker is never returned by the Centro-Oeste Worker (separate namespaces AND, if a namespace were shared by mistake, the store marker)', async () => {
  const norte = STORES.norte; const centro = STORES.centro;
  const headers = { 'content-type': 'application/json', origin: 'https://' + norte.inkHost, referer: 'https://' + norte.inkHost + SAMPLES.norte.allowlist[0], 'sec-fetch-site': 'same-origin' };
  const a = await worker(norte, { kv: 'shared' });
  const created = await a.dispatchFetch(url(norte, '/__origens/cart-ref'), { method: 'POST', headers, body: JSON.stringify(snapshot('111')) });
  assert.equal(created.status, 201); const { ref } = await created.json();
  assert.equal((await a.dispatchFetch(url(norte, '/__origens/cart-ref/' + ref))).status, 200, 'own store reads it');
  // mesmo namespace subjacente ligado por engano ao Worker da outra loja: o marcador de loja recusa
  const b = await worker(centro, { kv: 'shared' });
  assert.equal((await b.dispatchFetch(url(centro, '/__origens/cart-ref/' + ref))).status, 404, 'the marker rejects a foreign token even in a shared namespace');
  // namespaces separados (o desenho real): nem existe
  const c = await worker(centro);
  assert.equal((await c.dispatchFetch(url(centro, '/__origens/cart-ref/' + ref))).status, 404);
  const sulLike = new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: { CART_REFS: 'shared-namespace' }, kvPersist: sharedKv, bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: FEATURES }, outboundService: outbound(STORES.sul) });
  instances.push(sulLike);
  assert.equal((await sulLike.dispatchFetch('https://www.usesul.com.br/__origens/cart-ref/' + ref)).status, 404, 'the Sul (default store) refuses a Norte token too');
});

test('STORE_ID: absent = Use Sul (backward compatible); unknown = fail-closed (only health answers, everything else goes straight to the INK)', async () => {
  const sul = STORES.sul;
  const def = new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link' }, outboundService: outbound(sul) });
  instances.push(def);
  const h = await (await def.dispatchFetch('https://www.usesul.com.br/__origens/health')).json();
  assert.equal(h.service, 'use-sul-widget'); assert.equal(h.store, 'sul'); assert.equal(h.store_status, 'default'); assert.equal(h.kv_bound, true);
  assert.equal(count(await (await def.dispatchFetch('https://www.usesul.com.br/usesul/product/serra-catarinense')).text()), 1);
  for (const bad of ['Norte', 'norte ', 'nort', 'sul,norte', '../centro', 'use-norte']) {
    const mf = new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings: { STORE_ID: bad, ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usenorte/product/x', WIDGET_FEATURES: 'return-link' }, outboundService: outbound(STORES.norte) });
    instances.push(mf);
    const health = await (await mf.dispatchFetch('https://www.usenorte.com.br/__origens/health')).json();
    if (bad === 'norte ') { assert.equal(health.store, 'norte', 'surrounding whitespace is trimmed'); continue; }
    assert.equal(health.store_status, 'invalid', bad); assert.equal(health.widget_mode, 'false'); assert.deepEqual(health.widget_features, []);
    assert.equal(count(await (await mf.dispatchFetch('https://www.usenorte.com.br/usenorte/product/x')).text()), 0, bad);
    assert.notEqual((await mf.dispatchFetch('https://www.usenorte.com.br/__origens/loader.js')).headers.get('content-type'), 'application/javascript; charset=utf-8', bad);
  }
});

test('an allowlist entry from another store invalidates the whole list (fail-closed): the Norte Worker refuses /usecentro/... paths', async () => {
  const mf = await worker(STORES.norte, { bindings: { WIDGET_SCOPE_MODE: 'allowlist', WIDGET_ALLOWLIST: SAMPLES.norte.allowlist[0] + ',' + SAMPLES.centro.allowlist[0] } });
  const health = await (await mf.dispatchFetch(url(STORES.norte, '/__origens/health'))).json();
  assert.equal(health.allowlist_status, 'invalid'); assert.equal(health.allowlist_size, 0);
  assert.equal(count(await (await mf.dispatchFetch(url(STORES.norte, SAMPLES.norte.allowlist[0]))).text()), 0);
});
