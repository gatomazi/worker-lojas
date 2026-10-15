import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { normalizeGuide, guideQuery, storefrontPage, validateItem } from '../src/guide-gateway.js';
import { STORES } from '../src/stores.js';

// Rota /__origens/guia no workerd REAL, com o storefront e a INK como stubs (outboundService). O guia só existe com a flag pdp-guide.
const HOST = 'https://www.usesul.com.br';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id, extra = {}) => ({ productId: String(id), title: 'Item ' + id, image: IMG + id + '.jpg', price: 109.9, href: HOST + '/usesul/product/item-' + id, ...extra });
const city = { name: 'Florianópolis', uf: 'SC', slug: 'florianopolis', kind: 'city', url: 'https://www.useorigens.com.br/sul/sc/florianopolis' };
const collection = (slug, extra = {}) => ({ id: 1, name: 'Da Nossa Terra', slug, url: 'https://www.useorigens.com.br/sul/colecoes/' + slug, image: IMG + 'c.jpg', total: 73, ...extra });
const calls = [];
const inkProduct = '<!doctype html><html><head></head><body><form id="form-product-3789929" action="/usesul/cart?product_id=3789929" method="post"></form></body></html>';
const instances = new Map();
let storefront = () => Response.json({ v: 1, region: 'sul', collections: [collection('da-nossa-terra')] });
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname + url.search, cookie: request.headers.get('cookie') });
        if (url.host === 'useorigens.com.br') return storefront(url);
        if (url.pathname.startsWith('/__origens/')) return new Response('INK 404', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response(inkProduct, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const BASE = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '' };
const ON = { ...BASE, WIDGET_FEATURES: 'return-link,city-search,product-discovery,pdp-guide' };
const OFF = { ...BASE, WIDGET_FEATURES: 'return-link,city-search,product-discovery' };

test('guideQuery: only closed-format parameters reach the storefront; anything else is a 400', () => {
  assert.deepEqual(guideQuery(new URLSearchParams('')), { kind: 'colecoes', query: '' });
  assert.deepEqual(guideQuery(new URLSearchParams('produto=123')), { kind: 'produto', query: 'produto=123' });
  assert.deepEqual(guideQuery(new URLSearchParams('cidade=sc/florianopolis&produto=123')), { kind: 'cidade', query: 'cidade=sc/florianopolis&produto=123' });
  assert.deepEqual(guideQuery(new URLSearchParams('colecao=da-nossa-terra&foo=bar')), { kind: 'colecao', query: 'colecao=da-nossa-terra' });
  for (const bad of ['produto=abc', 'produto=0', 'cidade=SC/Floripa', 'cidade=sc/../x', 'colecao=Da%20Nossa', 'cidade=sc/florianopolis&produto=x']) assert.equal(guideQuery(new URLSearchParams(bad)), null, bad);
});

test('storefrontPage: only pages of THIS region on the storefront, www or not, normalized to the origin the loader already uses', () => {
  assert.equal(storefrontPage('https://www.useorigens.com.br/sul/sc/florianopolis'), 'https://useorigens.com.br/sul/sc/florianopolis');
  assert.equal(storefrontPage('https://useorigens.com.br/sul'), 'https://useorigens.com.br/sul');
  for (const bad of ['https://useorigens.com.br/norte/am', 'https://evil.example/sul', 'http://useorigens.com.br/sul', 'https://useorigens.com.br/sul?x=1', 'https://useorigens.com.br/sul#a', 'https://user:pw@useorigens.com.br/sul', 'https://useorigens.com.br/sulx']) assert.equal(storefrontPage(bad), null, bad);
  assert.equal(storefrontPage('https://useorigens.com.br/norte/am/manaus', STORES.norte), 'https://useorigens.com.br/norte/am/manaus');
});

test('validateItem/normalizeGuide: every product is re-validated (host, path, image host, price); bad ones drop one by one, never the payload', () => {
  assert.ok(validateItem(item(1)).item);
  assert.equal(validateItem(item(1, { href: 'https://www.usenorte.com.br/usenorte/product/x' })).drop, 'href');
  assert.equal(validateItem(item(1, { href: HOST + '/usesul/product/x?cart_ref=abc' })).drop, 'href');
  assert.equal(validateItem(item(1, { image: 'https://evil.example/a.jpg' })).drop, 'image');
  assert.equal(validateItem(item(1, { price: 0 })).drop, 'price');
  assert.equal(validateItem(item(1, { title: '<b>x</b>' })).drop, 'title');
  const r = normalizeGuide('cidade', { v: 1, region: 'sul', city, items: [item(1), item(1), item(2, { price: -1 }), item(3), item(4), item(5)], total: 8 });
  assert.deepEqual(r.body.items.map((i) => i.productId), ['1', '3', '4']);
  assert.deepEqual(r.dropped, { duplicate: 1, price: 1 });
  assert.equal(r.body.city.url, 'https://useorigens.com.br/sul/sc/florianopolis');
  assert.deepEqual(normalizeGuide('cidade', { v: 1, region: 'norte', city, items: [item(1)] }).body, { ok: false, kind: 'cidade' }, 'another region: refused');
  assert.deepEqual(normalizeGuide('produto', { v: 1, region: 'sul', productId: '1', city: null }).body, { ok: true, kind: 'produto', city: null });
  const cols = normalizeGuide('colecoes', { v: 1, region: 'sul', collections: [collection('a'), collection('a'), collection('b', { url: 'https://evil.example/sul/colecoes/b' }), collection('c', { image: 'https://evil.example/x.jpg' })] });
  assert.deepEqual(cols.body.collections.map((c) => [c.slug, !!c.image]), [['a', true], ['c', false]]);
  const col = normalizeGuide('colecao', { v: 1, region: 'sul', collection: collection('a'), items: [item(1), item(2), item(3), item(4), item(5)], total: 73 });
  assert.equal(col.body.items.length, 4); assert.equal(col.body.total, 73);
});

test('flag ON: the route serves the validated payload from the storefront, without the visitor cookie, with the right cache; 404 of the storefront is an honest miss', async () => {
  const mf = await worker(ON); calls.length = 0;
  storefront = (url) => url.search === '?cidade=sc/florianopolis&produto=3789929' ? Response.json({ v: 1, region: 'sul', city, items: [item(1), item(2), item(3)], total: 8 }) : Response.json({ v: 1, region: 'sul', error: 'unknown city' }, { status: 404 });
  const res = await mf.dispatchFetch(HOST + '/__origens/guia?cidade=sc/florianopolis&produto=3789929&foo=bar', { headers: { cookie: 'session=secret' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true); assert.deepEqual(body.items.map((i) => i.productId), ['1', '2', '3']); assert.equal(body.city.name, 'Florianópolis');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(calls.map((c) => [c.host, c.path, c.cookie]), [['useorigens.com.br', '/api/guia/sul?cidade=sc/florianopolis&produto=3789929', null]]);
  const miss = await (await mf.dispatchFetch(HOST + '/__origens/guia?cidade=sc/nao-existe')).json();
  assert.deepEqual(miss, { ok: false, kind: 'cidade', notFound: true });
  const bad = await mf.dispatchFetch(HOST + '/__origens/guia?produto=abc');
  assert.equal(bad.status, 400);
});

test('storefront down or slow: the route still answers 200 with ok:false (no-store), never a Cloudflare error page', async () => {
  const mf = await worker(ON);
  storefront = () => new Response('boom', { status: 500 });
  const res = await mf.dispatchFetch(HOST + '/__origens/guia');
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: false, kind: 'colecoes' }); assert.equal(res.headers.get('cache-control'), 'no-store');
  storefront = () => Response.json({ v: 1, region: 'sul', collections: [collection('da-nossa-terra')] });
});

test('flag OFF (rollback): the route is INK\'s own 404 and the loader carries the previous "Continue explorando" block, not the guide; flag ON swaps them', async () => {
  const off = await worker(OFF); calls.length = 0;
  const res = await off.dispatchFetch(HOST + '/__origens/guia');
  assert.equal(res.status, 404); assert.equal(await res.text(), 'INK 404');
  assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'), 'the storefront is never called');
  const loaderOf = async (mf) => { const page = await (await mf.dispatchFetch(HOST + '/usesul/product/florianopolis-origem-sc')).text(); const src = page.match(/src="(\/__origens\/loader\.js\?[^"]+)"/)[1]; return (await mf.dispatchFetch(HOST + src)).text(); };
  const offLoader = await loaderOf(off);
  assert.ok(!offLoader.includes("id: 'pdp-guide'") && !offLoader.includes('/__origens/guia'), 'no guide module at all');
  assert.ok(offLoader.includes("id: 'product-discovery'"), 'the previous block stays');
  const on = await worker(ON);
  const onLoader = await loaderOf(on);
  assert.ok(onLoader.includes('data-origens-guide') && onLoader.includes("id: 'pdp-guide'"));
  assert.ok(!onLoader.includes("id: 'product-discovery'"), 'never both blocks');
  const health = await (await on.dispatchFetch(HOST + '/__origens/health')).json();
  assert.deepEqual(health.widget_features, ['return-link', 'city-search', 'product-discovery', 'pdp-guide']); assert.equal(health.version, '5.2');
});
