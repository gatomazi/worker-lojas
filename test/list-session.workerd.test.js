import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { LOADER_VERSION } from '../src/loader-source.js';

// Gateway da sessão de compra ("Meus Lugares") no workerd REAL. O storefront é um stub (outboundService); o Worker
// nunca minta nem interpreta o id — só repassa e reexpõe a resposta no mesmo domínio da INK.
const HOST = 'https://www.usesul.com.br';
const NEXT = { inkProductId: '111', title: 'Ponto de Origem', imageUrl: 'https://gcp-images.majestic.ink.rsvcloud.com/images/x.jpg', url: 'https://www.usesul.com.br/usesul/product/produto-111' };
const GOOD = { next: NEXT, position: 0, total: 3 };
const DONE = { next: null, position: 3, total: 3 };
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
        calls.push({ host: url.host, path: url.pathname, search: url.search, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization') });
        if (url.host === 'useorigens.com.br') return storefront(request);
        return new Response(inkPage, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,list-session' };
const TOKEN = 'eyJ2IjoxfQ.abcdef0123456789';
const get = async (bindings, qs, init = {}) => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(HOST + '/__origens/list-session' + qs, init); };

test('gateway: relays the id to the FIXED storefront URL, forwarding `done`, no cookies/authorization', async () => {
  const res = await get(ON, '?ls=' + TOKEN + '&done=1,2', { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), GOOD);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'useorigens.com.br');
  assert.equal(calls[0].path, '/api/buy-session/' + TOKEN);
  assert.equal(calls[0].search, '?done=1%2C2');
  assert.equal(calls[0].cookie, null);
  assert.equal(calls[0].authorization, null, 'visitor headers are never forwarded');
});

test('gateway: an all-done session comes back as next:null with position/total intact', async () => {
  storefront = () => new Response(JSON.stringify(DONE), { headers: { 'content-type': 'application/json' } });
  const res = await get(ON, '?ls=' + TOKEN);
  assert.deepEqual(await res.json(), DONE);
  storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
});

test('gateway: a malformed `ls` or `done` never reaches the storefront', async () => {
  for (const qs of ['', '?ls=not valid', '?ls=' + TOKEN + '&done=<script>', '?ls=' + 'x'.repeat(2000)]) {
    const res = await get(ON, qs);
    assert.deepEqual(await res.json(), { next: null });
    assert.equal(calls.length, 0, qs);
  }
});

test('gateway: an upstream that fails, is not JSON, points to a foreign host/protocol, or is oversized answers next:null (never breaks the drawer)', async () => {
  const ok = (body) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const bad = [
    () => new Response('boom', { status: 500 }),
    () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ok({ next: { ...NEXT, url: 'https://evil.example/usesul/product/produto-111' }, position: 0, total: 1 }),
    ok({ next: { ...NEXT, url: 'http://www.usesul.com.br/usesul/product/produto-111' }, position: 0, total: 1 }), // not https
    ok({ next: { ...NEXT, imageUrl: 'not a url' }, position: 0, total: 1 }),
    ok({ next: { ...NEXT, inkProductId: '../../etc' }, position: 0, total: 1 }),
    ok({ next: NEXT }), // missing position/total
    ok({}),
    () => new Response('{"next":null,"position":0,"total":1,"pad":"' + 'x'.repeat(70000) + '"}', { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('network'); }
  ];
  for (const impl of bad) {
    storefront = impl;
    const res = await get(ON, '?ls=' + TOKEN);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { next: null }, JSON.stringify(impl));
  }
  storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
});

test('gateway: only with ENABLE_WIDGET=true AND the list-session feature; otherwise the INK answers (no storefront call)', async () => {
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link' }]) {
    const res = await get(bindings, '?ls=' + TOKEN);
    assert.equal(await res.text(), inkPage, JSON.stringify(bindings));
    assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'));
  }
});

test('POST is refused', async () => {
  const res = await get(ON, '?ls=' + TOKEN, { method: 'POST', body: '{}' });
  assert.equal(res.status, 405);
});

test('the health endpoint lists the feature and the loader carries it', async () => {
  const mf = await worker(ON);
  const health = await (await mf.dispatchFetch(HOST + '/__origens/health')).json();
  assert.deepEqual(health.widget_features, ['return-link', 'list-session']);
  assert.equal(health.version, LOADER_VERSION);
  const loader = await (await mf.dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(loader, /id: 'list-session'/);
});
