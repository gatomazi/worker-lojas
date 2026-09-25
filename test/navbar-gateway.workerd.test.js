import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { normalizeNavbar } from '../src/navbar-gateway.js';

// Gateway da configuração pública da navbar no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const GOOD = { v: 1, region: 'sul', collections: [{ name: 'Seu Lugar', slug: 'seu-lugar' }, { name: 'Da Nossa Terra', slug: 'da-nossa-terra' }] };
const calls = [];
let storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
const inkPage = '<!doctype html><html><head></head><body>INK</body></html>';

const instances = new Map();
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization'), headers: [...request.headers.keys()] });
        if (url.host === 'useorigens.com.br') return storefront(request);
        return new Response(inkPage, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,header-nav' };
const get = async (bindings, init = {}) => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(HOST + '/__origens/navbar', init); };

test('gateway: returns only the validated public fields, cacheable for 60 s, from the FIXED storefront URL', async () => {
  const res = await get(ON, { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { v: 1, collections: GOOD.collections });
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].host, calls[0].path, calls[0].method], ['useorigens.com.br', '/api/navbar/sul', 'GET']);
  assert.equal(calls[0].cookie, null); assert.equal(calls[0].authorization, null, 'visitor headers are never forwarded');
});

test('gateway: HEAD is allowed without a body; POST is refused; the visitor cannot choose any URL', async () => {
  const head = await get(ON, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const post = await get(ON, { method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
  const mf = await worker(ON); calls.length = 0;
  await mf.dispatchFetch(HOST + '/__origens/navbar?region=norte&url=https://evil.example/x');
  assert.ok(calls.every((c) => c.host === 'useorigens.com.br' && c.path === '/api/navbar/sul'));
});

test('gateway: an upstream that fails, is not JSON, has the wrong region/schema, or is oversized answers 503 (no-store) and never leaks it', async () => {
  const bad = [
    () => new Response('boom', { status: 500 }),
    () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response(JSON.stringify({ ...GOOD, region: 'norte' }), { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify({ v: 1, region: 'sul', collections: [{ name: 'X', slug: '../../etc' }] }), { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify({ v: 1, region: 'sul', collections: new Array(9).fill({ name: 'X', slug: 'x' }) }), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{"v":1,"region":"sul","collections":[],"pad":"' + 'x'.repeat(9000) + '"}', { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('network'); }
  ];
  for (const impl of bad) {
    storefront = impl;
    const res = await get(ON);
    assert.equal(res.status, 503); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
  storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
});

test('gateway: only with ENABLE_WIDGET=true AND the header-nav feature; otherwise the INK answers (nothing of ours, no storefront call)', async () => {
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link' }, { ...ON, WIDGET_FEATURES: 'header-nav,evil' }]) {
    const res = await get(bindings);
    assert.equal(await res.text(), inkPage, JSON.stringify(bindings));
    assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'));
  }
});

test('the health endpoint lists the feature and the loader carries it (loader 4.4)', async () => {
  const mf = await worker(ON);
  const health = await (await mf.dispatchFetch(HOST + '/__origens/health')).json();
  assert.deepEqual(health.widget_features, ['return-link', 'header-nav']); assert.equal(health.features_status, 'ok'); assert.equal(health.version, '4.4');
  const loader = await (await mf.dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(loader, /id: 'header-nav'/); assert.match(loader, /"search":"https:\/\/useorigens\.com\.br\/sul\/busca"/);
});

test('normalizeNavbar: strict shape, de-duplicates slugs, plain-text names only', () => {
  assert.deepEqual(normalizeNavbar(GOOD), { v: 1, collections: GOOD.collections });
  assert.equal(normalizeNavbar(null), null); assert.equal(normalizeNavbar({ ...GOOD, v: 2 }), null); assert.equal(normalizeNavbar({ ...GOOD, collections: 'x' }), null);
  assert.equal(normalizeNavbar({ ...GOOD, collections: [{ name: '<b>x</b>', slug: 'x' }] }), null);
  assert.equal(normalizeNavbar({ ...GOOD, collections: [{ name: '', slug: 'x' }] }), null);
  assert.equal(normalizeNavbar({ ...GOOD, collections: [{ name: 'A', slug: 'a' }, { name: 'A2', slug: 'a' }] }).collections.length, 1);
  assert.deepEqual(normalizeNavbar({ ...GOOD, collections: [{ name: '  Fala   Daqui ', slug: 'fala-daqui' }] }).collections, [{ name: 'Fala Daqui', slug: 'fala-daqui' }]);
});
