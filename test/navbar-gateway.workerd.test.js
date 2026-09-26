import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { normalizeNavbar } from '../src/navbar-gateway.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// Gateway da configuração pública da navbar no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const INK = 'https://www.usesul.com.br/usesul/collections/';
const STATES = [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }, { uf: 'SC', name: 'Santa Catarina', path: '/sul/sc' }, { uf: 'RS', name: 'Rio Grande do Sul', path: '/sul/rs' }];
const entry = (id, title, slug, order) => ({ id, title, slug, url: INK + slug, order });
// O storefront devolve id, url e order além do necessário; o gateway repassa só o contrato mínimo (sem url: o loader monta o destino).
const GOOD = { v: 2, region: 'sul', states: STATES, top: [entry(1, 'Novidades', 'novidades', 1), entry(2, 'Do Nosso Jeito', 'do-nosso-jeito', 2)], more: [entry(3, 'Seu Lugar', 'seu-lugar', 1)] };
const CLEAN = { v: 2, states: STATES, top: [{ id: 1, title: 'Novidades', slug: 'novidades', order: 1 }, { id: 2, title: 'Do Nosso Jeito', slug: 'do-nosso-jeito', order: 2 }], more: [{ id: 3, title: 'Seu Lugar', slug: 'seu-lugar', order: 1 }] };
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
  assert.deepEqual(await res.json(), CLEAN);
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
  const ok = (body) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const bad = [
    () => new Response('boom', { status: 500 }),
    () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ok({ ...GOOD, region: 'norte' }),
    ok({ ...GOOD, top: [{ ...entry(1, 'X', 'x', 1), slug: '../../etc' }] }),
    ok({ ...GOOD, top: [{ ...entry(1, 'X', 'x', 1), url: 'https://evil.example/usesul/collections/x' }] }),
    ok({ ...GOOD, top: [entry(1, 'Kits', 'kits', 1)], more: [entry(2, 'Kits', 'kits', 1)] }), // a collection on both groups
    ok({ ...GOOD, top: Array.from({ length: 61 }, (_, i) => entry(i + 1, 'C' + i, 'c' + i, i + 1)) }),
    ok({ ...GOOD, states: [{ uf: 'PR', name: 'Paraná', path: 'https://evil.example/pr' }] }),
    ok({ ...GOOD, states: [{ uf: 'PR', name: 'Paraná', path: '/sul/sc' }] }),
    ok({ ...GOOD, top: [{ ...entry(1, '<b>x</b>', 'x', 1) }] }),
    ok({ v: 3, region: 'sul' }),
    () => new Response('{"v":2,"region":"sul","states":[],"top":[],"more":[],"pad":"' + 'x'.repeat(70000) + '"}', { headers: { 'content-type': 'application/json' } }),
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
  assert.deepEqual(health.widget_features, ['return-link', 'header-nav']); assert.equal(health.features_status, 'ok'); assert.equal(health.version, LOADER_VERSION);
  const loader = await (await mf.dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(loader, /id: 'header-nav'/); assert.match(loader, /"search":"https:\/\/useorigens\.com\.br\/sul\/busca"/);
});

test('normalizeNavbar: strict v2 shape; free groups (no limit of one/five), in the given order; one collection, one place; plain-text names; v1 still accepted as Topo', () => {
  assert.deepEqual(normalizeNavbar(GOOD), CLEAN);
  const many = { ...GOOD, top: Array.from({ length: 12 }, (_, i) => entry(i + 1, 'Coleção ' + (i + 1), 'colecao-' + (i + 1), i + 1)), more: Array.from({ length: 20 }, (_, i) => entry(100 + i, 'Outra ' + (i + 1), 'outra-' + (i + 1), i + 1)) };
  const out = normalizeNavbar(many);
  assert.equal(out.top.length, 12); assert.equal(out.more.length, 20); assert.deepEqual(out.top.map((e) => e.order), out.top.map((_, i) => i + 1));
  assert.equal(normalizeNavbar(null), null); assert.equal(normalizeNavbar({ ...GOOD, v: 3 }), null); assert.equal(normalizeNavbar({ ...GOOD, top: 'x' }), null);
  assert.equal(normalizeNavbar({ ...GOOD, top: [{ ...entry(1, '<b>x</b>', 'x', 1) }] }), null);
  assert.equal(normalizeNavbar({ ...GOOD, top: [entry(1, '', 'x', 1)] }), null);
  assert.equal(normalizeNavbar({ ...GOOD, top: [entry(1, 'Kits', 'kits', 1)], more: [entry(2, 'Kits', 'kits', 1)] }), null, 'never on both groups');
  assert.equal(normalizeNavbar({ ...GOOD, top: [entry(1, 'A', 'a', 1), entry(2, 'A2', 'a', 2)] }).top.length, 1, 'a repeated slug inside a group is dropped');
  assert.deepEqual(normalizeNavbar({ ...GOOD, top: [entry(1, '  Fala   Daqui ', 'fala-daqui', 1)], more: [] }).top, [{ id: 1, title: 'Fala Daqui', slug: 'fala-daqui', order: 1 }]);
  // no special role for any name: "Novidades" and a launch coexist with the rest, in the owner's order
  assert.deepEqual(normalizeNavbar({ ...GOOD, top: [entry(9, 'Lançamento', 'lancamento', 1), entry(1, 'Novidades', 'novidades', 2), entry(2, 'Kits', 'kits', 3)], more: [] }).top.map((e) => e.title), ['Lançamento', 'Novidades', 'Kits']);
  // legacy single list (an old storefront answering during a rollout) is a Topo group, with no states
  assert.deepEqual(normalizeNavbar({ v: 1, region: 'sul', collections: [{ name: 'Seu Lugar', slug: 'seu-lugar' }] }), { v: 2, states: [], top: [{ id: null, title: 'Seu Lugar', slug: 'seu-lugar', order: 1 }], more: [] });
  assert.equal(normalizeNavbar({ v: 2, region: 'sul', states: STATES, top: [], more: [] }).top.length, 0, 'empty groups are a valid configuration');
});
