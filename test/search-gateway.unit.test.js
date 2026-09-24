import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSearchGateway, validateIndex } from '../src/search-gateway.js';

const INDEX = readFileSync(new URL('./fixtures/search/cidades-sul.json', import.meta.url), 'utf8');
const ok = () => new Response(INDEX, { headers: { 'content-type': 'application/json' } });
const req = (q) => new Request('https://www.usesul.com.br/__origens/search?q=' + encodeURIComponent(q));

test('validateIndex drops malformed entries (XSS-ish names, bad UF/slug, wrong types) but keeps the good ones', () => {
  const data = JSON.parse(INDEX);
  const dirty = [...data,
    { n: '<img src=x onerror=alert(1)>', u: 'XX', s: 'ok' }, { n: 'Ok', u: 'SC', s: '../etc' }, { n: 'Ok', u: 'SC', s: 'A_B' },
    { n: 'x'.repeat(61), u: 'SC', s: 'longo' }, { n: 'Ok', u: 'sc', s: 'minusculo' }, null, 'str', 7, { n: 5, u: 'SC', s: 'num' }];
  const clean = validateIndex(dirty);
  assert.equal(clean.length, data.length);
  assert.ok(clean.every((c) => /^[A-Z]{2}$/.test(c.u) && /^[a-z0-9-]+$/.test(c.s)));
  assert.equal(validateIndex({ not: 'an array' }), null);
  assert.equal(validateIndex(data.slice(0, 50)), null); // pequeno demais para ser o índice real
  assert.equal(validateIndex(new Array(6000).fill(data[0])), null);
});

test('validateIndex keeps only public fields and bounds alias lists', () => {
  const data = JSON.parse(INDEX).map((c) => ({ ...c, secret: 'X', a: c.a ? [...c.a, 5, 'y'.repeat(41)] : c.a }));
  const clean = validateIndex(data);
  assert.ok(clean.every((c) => !('secret' in c)));
  assert.ok(clean.filter((c) => c.a).every((c) => c.a.length <= 8 && c.a.every((x) => typeof x === 'string' && x.length <= 40)));
});

test('index is fetched once for concurrent queries (in-flight dedupe) and reused inside the TTL', async () => {
  let fetches = 0;
  const gw = createSearchGateway({ upstream: async () => { fetches++; return ok(); } });
  const results = await Promise.all([gw.handle(req('curitiba')), gw.handle(req('joinville')), gw.handle(req('pelotas'))]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(fetches, 1);
  await gw.handle(req('blumenau'));
  assert.equal(fetches, 1);
});

test('after the TTL the index is refreshed; if the refresh fails the stale index still answers (up to 24h)', async () => {
  let t = 1_000_000; let mode = 'ok'; let fetches = 0;
  const gw = createSearchGateway({ now: () => t, upstream: async () => { fetches++; return mode === 'ok' ? ok() : new Response('x', { status: 503 }); } });
  assert.equal((await gw.handle(req('curitiba'))).status, 200);
  t += 6 * 60 * 1000; mode = 'down';
  const stale = await gw.handle(req('curitiba'));
  assert.equal(stale.status, 200);
  assert.equal(fetches, 2);
  t += 25 * 60 * 60 * 1000; // além de 24 h: sem índice utilizável
  assert.equal((await gw.handle(req('curitiba'))).status, 502);
});

test('a hanging storefront is aborted after 3 s and answered as 502 (no hang), logging no query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines = [];
  const warn = console.warn; console.warn = (line) => lines.push(String(line));
  try {
    const gw = createSearchGateway({ upstream: (_r, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    const pending = gw.handle(req('curitiba SEGREDO'));
    await Promise.resolve();
    t.mock.timers.tick(3000);
    const res = await pending;
    assert.equal(res.status, 502);
  } finally { console.warn = warn; }
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['event', 'reason']);
  assert.ok(!/curitiba|SEGREDO/.test(lines[0]));
});

test('the request sent upstream has no visitor headers and asks JSON; results are capped at 5', async () => {
  let seen;
  const gw = createSearchGateway({ upstream: async (request) => { seen = request; return ok(); } });
  const visitor = new Request('https://www.usesul.com.br/__origens/search?q=santa', { headers: { cookie: 'a=SEGREDO', authorization: 'Bearer SEGREDO' } });
  const body = await (await gw.handle(visitor)).json();
  assert.equal(body.results.length, 5);
  assert.equal(seen.url, 'https://useorigens.com.br/api/cidades/sul');
  assert.equal(seen.headers.get('cookie'), null);
  assert.equal(seen.headers.get('authorization'), null);
  assert.equal(seen.headers.get('accept'), 'application/json');
});
