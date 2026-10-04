import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// Rota /__origens/recommendations/<id> no workerd REAL, com o storefront e a INK como stubs (outboundService).
const HOST = 'https://www.usesul.com.br';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id) => ({ productId: String(id), title: 'Item ' + id, image: IMG + id + '.webp', price: 109.9, href: HOST + '/usesul/product/item-' + id, reason: 'same-uf' });
const calls = [];
const inkProduct = '<!doctype html><html><head></head><body><form id="form-product-3789929" action="/usesul/cart?product_id=3789929" method="post"></form></body></html>';
const instances = new Map();
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, cookie: request.headers.get('cookie') });
        if (url.host === 'useorigens.com.br') return Response.json({ v: 1, region: 'sul', productId: url.pathname.split('/').pop(), status: 'ok', items: [item(1), item(2), item(3)] });
        if (url.pathname.startsWith('/__origens/')) return new Response('INK 404', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response(inkProduct, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const BASE = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '' };
const ON = { ...BASE, WIDGET_FEATURES: 'return-link,auto-recommendations' };
const OFF = { ...BASE, WIDGET_FEATURES: 'return-link' };

test('flag ON: the route serves the validated list from the storefront, without the visitor cookie', async () => {
  const mf = await worker(ON); calls.length = 0;
  const res = await mf.dispatchFetch(HOST + '/__origens/recommendations/3789929', { headers: { cookie: 'session=secret' } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).items.map((i) => i.productId), ['1', '2', '3']);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(calls.map((c) => [c.host, c.path, c.cookie]), [['useorigens.com.br', '/api/recommendations/sul/3789929', null]]);
});

test('flag OFF (rollback): the route is INK\'s own 404 and the loader carries no recommendations module', async () => {
  const mf = await worker(OFF); calls.length = 0;
  const res = await mf.dispatchFetch(HOST + '/__origens/recommendations/3789929');
  assert.equal(res.status, 404); assert.equal(await res.text(), 'INK 404');
  assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'), 'the storefront is never called');
  const page = await (await mf.dispatchFetch(HOST + '/usesul/product/florianopolis-origem-sc')).text();
  const src = page.match(/src="(\/__origens\/loader\.js\?[^"]+)"/)[1];
  const loader = await (await mf.dispatchFetch(HOST + src)).text();
  assert.ok(!loader.includes('/__origens/recommendations/'), 'no request code at all');
  assert.ok(!loader.includes('data-origens-reco'), 'no DOM code at all');
});

test('flag ON: the loader includes the module; health lists the feature and the new version; ENABLE_WIDGET=false kills everything', async () => {
  const mf = await worker(ON);
  const health = await (await mf.dispatchFetch(HOST + '/__origens/health')).json();
  assert.deepEqual(health.widget_features, ['return-link', 'auto-recommendations']);
  assert.equal(health.version, LOADER_VERSION);
  const page = await (await mf.dispatchFetch(HOST + '/usesul/product/florianopolis-origem-sc')).text();
  const src = page.match(/src="(\/__origens\/loader\.js\?[^"]+)"/)[1];
  const loader = await (await mf.dispatchFetch(HOST + src)).text();
  assert.ok(loader.includes("id: 'auto-recommendations'"));
  const killed = await worker({ ...ON, ENABLE_WIDGET: 'false' }); calls.length = 0;
  assert.equal((await killed.dispatchFetch(HOST + '/__origens/recommendations/3789929')).status, 404);
  assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'));
});

test('an unknown feature name still invalidates the whole list (fail-closed contract unchanged)', async () => {
  const mf = await worker({ ...BASE, WIDGET_FEATURES: 'auto-recommendations,auto-recomendations' });
  const health = await (await mf.dispatchFetch(HOST + '/__origens/health')).json();
  assert.equal(health.features_status, 'invalid'); assert.deepEqual(health.widget_features, []);
});
