import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';

// Gateway de busca no workerd REAL. O storefront é um stub (outboundService) com o snapshot real do índice.
const INDEX = readFileSync(new URL('./fixtures/search/cidades-sul.json', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const calls = [];
let storefront = () => new Response(INDEX, { headers: { 'content-type': 'application/json' } });
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
        return new Response(inkPage, { headers: { 'content-type': 'text/html' } }); // INK
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,post-add-discovery,city-search' };
const search = async (bindings, q, init = {}) => {
  const mf = await worker(bindings);
  calls.length = 0;
  return mf.dispatchFetch(HOST + '/__origens/search' + (q === undefined ? '' : '?q=' + encodeURIComponent(q)), init);
};

test('gateway: real query returns validated public fields and links built by the Worker', async () => {
  const res = await search(ON, 'floripa');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['results']);
  assert.deepEqual(body.results[0], { type: 'city', name: 'Florianópolis', uf: 'SC', meso: 'Grande Florianópolis', href: 'https://useorigens.com.br/sul/sc/florianopolis' });
});

test('gateway: state and city results, max 5, only known keys', async () => {
  const body = await (await search(ON, 'sc')).json();
  assert.equal(body.results[0].type, 'state');
  assert.deepEqual(body.results[0], { type: 'state', name: 'Santa Catarina', uf: 'SC', meso: null, href: 'https://useorigens.com.br/sul/sc' });
  const many = await (await search(ON, 'santa')).json();
  assert.ok(many.results.length <= 5 && many.results.length > 1);
  for (const r of many.results) {
    assert.deepEqual(Object.keys(r).sort(), ['href', 'meso', 'name', 'type', 'uf']);
    assert.match(r.href, /^https:\/\/useorigens\.com\.br\/sul(\/[a-z]{2}(\/[a-z0-9-]+)?)?$/);
  }
});

test('gateway: empty result is a normal 200 with an empty list', async () => {
  const res = await search(ON, 'xyzq');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { results: [] });
});

test('gateway: invalid queries are rejected with 400 before touching the storefront', async () => {
  for (const q of [undefined, '', ' ', 'a', 'x'.repeat(41), '<script>', 'a;b', 'a\nb', 'a/b', 'a?b', '%00ab', '🙂🙂']) {
    const res = await search(ON, q);
    assert.equal(res.status, 400, JSON.stringify(q));
  }
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0);
});

test('gateway: only GET; POST/PUT/DELETE are 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await search(ON, 'curitiba', { method, body: method === 'DELETE' ? undefined : 'x' });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET');
  }
});

test('gateway: outbound request is FIXED (origin, path), carries no visitor Cookie/Authorization/custom headers', async () => {
  const res = await search({ ...ON, WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' }, 'blumenau', { headers: { cookie: 'sessao=SEGREDO', authorization: 'Bearer SEGREDO', 'x-probe': 'SEGREDO' } });
  assert.equal(res.status, 200);
  const out = calls.filter((c) => c.host === 'useorigens.com.br');
  for (const c of out) {
    assert.equal(c.path, '/api/cidades/sul');
    assert.equal(c.method, 'GET');
    assert.equal(c.cookie, null);
    assert.equal(c.authorization, null);
    assert.ok(!c.headers.includes('x-probe'));
  }
  assert.ok(!(await res.text()).includes('SEGREDO'));
});

test('gateway: user input can never choose the upstream URL (no SSRF)', async () => {
  const mf = await worker(ON);
  calls.length = 0;
  for (const path of ['/__origens/search?q=curitiba&url=https://evil.example/', '/__origens/search/https://evil.example', '/__origens/search?q=https://evil.example']) {
    await mf.dispatchFetch(HOST + path);
  }
  assert.ok(calls.every((c) => c.host === 'useorigens.com.br' && c.path === '/api/cidades/sul' || c.host === 'www.usesul.com.br'));
  assert.ok(!calls.some((c) => c.host.includes('evil')));
});

test('gateway: gated by ENABLE_WIDGET=true AND the city-search feature (else the INK answers)', async () => {
  for (const b of [
    { ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, ENABLE_WIDGET: 'yes' },
    { ...ON, WIDGET_FEATURES: 'return-link,post-add-discovery' }, { ...ON, WIDGET_FEATURES: '' }, { ...ON, WIDGET_FEATURES: 'city-search,evil' }
  ]) {
    const res = await search(b, 'curitiba');
    assert.equal(await res.text(), inkPage, JSON.stringify(b));
    assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0, JSON.stringify(b));
  }
  // Recurso independente da página: mesmo com allowlist vazia o endpoint segue as flags de deploy.
  assert.equal((await search({ ...ON, WIDGET_ALLOWLIST: '' }, 'curitiba')).status, 200);
});

test('gateway: upstream failures return 502 {error} without leaking details or the query', async () => {
  const scenarios = [
    () => new Response('boom SEGREDO', { status: 500 }),
    () => new Response('not json', { headers: { 'content-type': 'application/json' } }),
    () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify([{ n: 'X', u: 'PR', s: 'x' }]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(INDEX, { headers: { 'content-type': 'text/html' } }),
    () => new Response('x'.repeat(700_000), { headers: { 'content-type': 'application/json' } })
  ];
  for (const [i, make] of scenarios.entries()) {
    storefront = make;
    const res = await search({ ...ON, WIDGET_ALLOWLIST: '/usesul/product/fail-' + i }, 'curitiba');
    const text = await res.text();
    assert.equal(res.status, 502, 'scenario ' + i);
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' });
    assert.ok(!/SEGREDO|curitiba|boom/.test(text));
  }
  storefront = () => new Response(INDEX, { headers: { 'content-type': 'application/json' } });
});

test('gateway: the index is cached in memory (second query does not hit the storefront again)', async () => {
  const bindings = { ...ON, WIDGET_ALLOWLIST: '/usesul/product/cache-case' };
  assert.equal((await search(bindings, 'curitiba')).status, 200);
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 1);
  assert.equal((await search(bindings, 'joinville')).status, 200);
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0);
  storefront = () => new Response('down', { status: 503 });
  assert.equal((await search(bindings, 'pelotas')).status, 200); // ainda dentro do TTL: serve da memória
  storefront = () => new Response(INDEX, { headers: { 'content-type': 'application/json' } });
});

test('worker: publishing the search gateway does not change page injection (Serra 1 loader, others 0)', async () => {
  const mf = await worker(ON);
  const html = '<!doctype html><html><head></head><body>x</body></html>';
  const orig = storefront;
  const ink = new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', bindings: ON, outboundService: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
  try {
    const tags = async (path) => ((await (await ink.dispatchFetch(HOST + path)).text()).match(/data-use-origens-widget/g) || []).length;
    assert.equal(await tags('/usesul/product/serra-catarinense'), 1);
    for (const p of ['/usesul/product/outro', '/usesul', '/usesul/cart', '/usesul/checkout', '/usesul/product/serra-catarinense/extra']) assert.equal(await tags(p), 0, p);
  } finally { await ink.dispose(); }
  void mf; void orig;
});
