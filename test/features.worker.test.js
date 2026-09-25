import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// WIDGET_FEATURES no Worker (workerd real): health, loader, discovery.js e injeção. Origem = stub.
const HOST = 'https://www.usesul.com.br';
const PAGE = '<!doctype html><html><head><title>x</title></head><body>ink</body></html>';
const instances = new Map();
async function mf(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) instances.set(key, new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', bindings, outboundService: async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }) }));
  return instances.get(key);
}
after(async () => { for (const m of instances.values()) await m.dispose(); });
const base = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' };
const get = async (b, path, init) => (await mf(b)).dispatchFetch(HOST + path, init);
const ALL = 'return-link,post-add-discovery,city-search';

test('health reports features and their status without paths', async () => {
  const h = await (await get({ ...base, WIDGET_FEATURES: ALL }, '/__origens/health')).json();
  assert.equal(h.version, LOADER_VERSION);
  assert.deepEqual(h.widget_features, ['return-link', 'post-add-discovery', 'city-search']); assert.equal(h.features_status, 'ok');
  const d = await (await get(base, '/__origens/health')).json();
  assert.deepEqual(d.widget_features, ['return-link']); assert.equal(d.features_status, 'default');
  const bad = await (await get({ ...base, WIDGET_FEATURES: 'return-link,evil' }, '/__origens/health')).json();
  assert.deepEqual(bad.widget_features, []); assert.equal(bad.features_status, 'invalid');
  assert.doesNotMatch(JSON.stringify(h), /usesul\/product/);
});

test('loader route serves only the enabled modules; flag off/dry-run is a no-op', async () => {
  const link = await (await get({ ...base, WIDGET_FEATURES: 'return-link' }, '/__origens/loader.js')).text();
  assert.match(link, /id: 'return-link'/); assert.doesNotMatch(link, /post-add-discovery/);
  const all = await (await get({ ...base, WIDGET_FEATURES: ALL }, '/__origens/loader.js')).text();
  assert.match(all, /id: 'post-add-discovery'/); assert.ok(all.includes('const FEATURES = ["return-link","post-add-discovery","city-search"];'));
  for (const mode of ['false', 'dry-run']) assert.equal(await (await get({ ...base, ENABLE_WIDGET: mode, WIDGET_FEATURES: ALL }, '/__origens/loader.js')).text(), '/* use-origens widget disabled */');
  const res = await get({ ...base, WIDGET_FEATURES: ALL }, '/__origens/loader.js');
  assert.match(res.headers.get('content-type'), /javascript/); assert.equal((await get({ ...base, WIDGET_FEATURES: ALL }, '/__origens/loader.js', { method: 'POST', body: 'x' })).status, 405);
});

test('discovery.js is served only with post-add-discovery (search flag follows city-search)', async () => {
  const withSearch = await (await get({ ...base, WIDGET_FEATURES: ALL }, '/__origens/discovery.js')).text();
  assert.match(withSearch, /const SEARCH = true;/); assert.match(withSearch, /data-origens-discovery/);
  const noSearch = await (await get({ ...base, WIDGET_FEATURES: 'return-link,post-add-discovery' }, '/__origens/discovery.js')).text();
  assert.match(noSearch, /const SEARCH = false;/);
  for (const b of [{ ...base, WIDGET_FEATURES: 'return-link' }, { ...base, WIDGET_FEATURES: '' }, { ...base, ENABLE_WIDGET: 'false', WIDGET_FEATURES: ALL }, { ...base, ENABLE_WIDGET: 'dry-run', WIDGET_FEATURES: ALL }]) {
    assert.equal(await (await get(b, '/__origens/discovery.js')).text(), '/* use-origens widget disabled */', JSON.stringify(b));
  }
});

test('injection: default features inject the loader (pilot compatible); empty or invalid features inject NOTHING', async () => {
  const tags = async (b, path = '/usesul/product/serra-catarinense') => (((await (await get(b, path)).text()).match(/data-use-origens-widget="([^"]+)"/g)) || []).length;
  assert.equal(await tags(base), 1);
  assert.equal(await tags({ ...base, WIDGET_FEATURES: ALL }), 1);
  assert.equal(await tags({ ...base, WIDGET_FEATURES: '' }), 0);
  assert.equal(await tags({ ...base, WIDGET_FEATURES: 'return-link,evil' }), 0);
  assert.equal(await tags({ ...base, WIDGET_FEATURES: ALL }, '/usesul/product/outro'), 0);
  assert.equal(await tags({ ...base, WIDGET_ALLOWLIST: '', WIDGET_FEATURES: ALL }), 0);
});

test('the injected tag carries the current loader version (cache-buster for the loader URL)', async () => {
  const html = await (await get({ ...base, WIDGET_FEATURES: ALL }, '/usesul/product/serra-catarinense')).text();
  assert.ok(html.includes('src="/__origens/loader.js?v=' + LOADER_VERSION + '"'));
});

test('product-discovery: health lists it, the loader carries the module, discovery.js serves mountProduct only when the flag is on; no flag = the pilot link', async () => {
  const on = { ...base, WIDGET_FEATURES: 'return-link,city-search,product-discovery' };
  const h = await (await get(on, '/__origens/health')).json();
  assert.deepEqual(h.widget_features, ['return-link', 'city-search', 'product-discovery']); assert.equal(h.features_status, 'ok');
  const loader = await (await get(on, '/__origens/loader.js')).text();
  assert.match(loader, /id: 'product-discovery'/); assert.match(loader, /discovery\.js\?v=/);
  const disc = await (await get(on, '/__origens/discovery.js')).text();
  assert.match(disc, /const PRODUCT = true;/); assert.match(disc, /mountProduct/);
  const off = { ...base, WIDGET_FEATURES: 'return-link,city-search' };
  const loaderOff = await (await get(off, '/__origens/loader.js')).text();
  assert.doesNotMatch(loaderOff, /id: 'product-discovery'/);
  const none = await (await get(off, '/__origens/discovery.js')).text();
  assert.doesNotMatch(none, /mountProduct/);
  const page = await (await get(on, '/usesul/product/serra-catarinense')).text();
  assert.equal((page.match(/__origens\/loader\.js/g) || []).length, 1, 'exactly one loader tag');
});
