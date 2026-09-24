import test from 'node:test';
import assert from 'node:assert/strict';
import { createCartRefs, validateSnapshot, CART_REF_TTL_SECONDS, MAX_ITEMS } from '../src/cart-ref.js';

const ORIGIN = 'https://www.usesul.com.br';
const ALLOWED = ['/usesul/product/serra-catarinense'];
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const snapshot = (over = {}) => ({ v: 1, count: 2, items: [{ productId: '4932916', name: 'Serra Catarinense', color: 'Preta', size: 'M', variant: 'Preta-Masculino-M', quantity: 2, linePriceText: 'R$ 219,80', linePrice: 219.8, image: IMG }], subtotal: 219.8, discount: 0, ...over });

function fakeKv() {
  const store = new Map(); const puts = [];
  return { store, puts, async put(key, value, options) { puts.push({ key, options }); store.set(key, value); }, async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); } };
}
const post = (body, headers = {}) => new Request(ORIGIN + '/__origens/cart-ref', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', origin: ORIGIN, referer: ORIGIN + ALLOWED[0] + '?x=1', 'sec-fetch-site': 'same-origin', ...headers } });
const ctxFor = (kv) => ({ kv, allowedPaths: ALLOWED, origin: ORIGIN });

test('validateSnapshot accepts the real-shaped snapshot and keeps only known fields', () => {
  const clean = validateSnapshot({ ...snapshot(), cookie: 'SEGREDO', csrf: 'x', extra: 1 });
  assert.deepEqual(Object.keys(clean).sort(), ['count', 'discount', 'items', 'subtotal', 'v']);
  assert.deepEqual(Object.keys(clean.items[0]).sort(), ['color', 'image', 'linePrice', 'linePriceText', 'name', 'productId', 'quantity', 'size', 'variant']);
  assert.equal(clean.items[0].image, IMG);
  assert.ok(!JSON.stringify(clean).includes('SEGREDO'));
});

test('validateSnapshot rejects malformed structures (nothing is stored)', () => {
  const bad = [null, 'x', 7, [], {}, { v: 2 }, snapshot({ v: 2 }), snapshot({ count: -1 }), snapshot({ count: 1.5 }), snapshot({ items: 'x' }),
    snapshot({ items: Array.from({ length: MAX_ITEMS + 1 }, () => snapshot().items[0]) }), snapshot({ items: [null] }),
    snapshot({ items: [{ ...snapshot().items[0], quantity: 0 }] }), snapshot({ items: [{ ...snapshot().items[0], quantity: 100 }] }), snapshot({ items: [{ ...snapshot().items[0], quantity: '2' }] }),
    snapshot({ items: [{ ...snapshot().items[0], name: '' }] }), snapshot({ items: [{ ...snapshot().items[0], productId: 'abc' }] }), snapshot({ items: [{ ...snapshot().items[0], linePrice: -1 }] }),
    snapshot({ items: [{ ...snapshot().items[0], linePrice: NaN }] }), snapshot({ subtotal: 'x' }), snapshot({ subtotal: -3 }), snapshot({ discount: 1e9 })];
  for (const input of bad) assert.equal(validateSnapshot(input), null, JSON.stringify(input).slice(0, 80));
});

test('validateSnapshot sanitizes text and drops any image that is not an INK CDN https URL', () => {
  const item = { ...snapshot().items[0], name: '  <b>Serra</b>\u0000   Catarinense  ', color: 'x'.repeat(100) };
  const clean = validateSnapshot(snapshot({ items: [item] }));
  assert.equal(clean.items[0].name, 'bSerra/b Catarinense'.replace('/b', '/b'));
  assert.ok(!/[<>\u0000]/.test(clean.items[0].name)); assert.equal(clean.items[0].color.length, 40);
  for (const image of ['http://gcp-images.majestic.ink.rsvcloud.com/images/a.jpg', 'https://evil.example/images/a.jpg', 'https://gcp-images.majestic.ink.rsvcloud.com.evil.example/images/a.jpg', IMG + '?x=1', 'https://user:pw@gcp-images.majestic.ink.rsvcloud.com/images/a.jpg', 'javascript:alert(1)', 'https://gcp-images.majestic.ink.rsvcloud.com/other/a.jpg', 5]) {
    assert.equal(validateSnapshot(snapshot({ items: [{ ...snapshot().items[0], image }] })).items[0].image, undefined, String(image));
  }
});

test('an empty cart is a valid snapshot (used to clear the mirror)', () => {
  assert.deepEqual(validateSnapshot({ v: 1, count: 0, items: [], subtotal: null, discount: null }), { v: 1, count: 0, items: [], subtotal: null, discount: null });
});

test('POST stores the snapshot under a random 128-bit token with a 30 min TTL and returns {ref, ttl}', async () => {
  const kv = fakeKv(); const refs = createCartRefs({ now: () => 1_000_000 });
  const res = await refs.create(post(snapshot()), ctxFor(kv));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.ref, /^[A-Za-z0-9_-]{22}$/); assert.equal(body.ttl, CART_REF_TTL_SECONDS); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(kv.puts.length, 1); assert.equal(kv.puts[0].key, 'cartref:' + body.ref); assert.deepEqual(kv.puts[0].options, { expirationTtl: 1800 });
  const stored = JSON.parse(kv.store.get('cartref:' + body.ref));
  assert.equal(stored.savedAt, 1_000_000); assert.equal(stored.items[0].name, 'Serra Catarinense');
  assert.ok(!/cookie|csrf|authorization|session|token/i.test(JSON.stringify(stored)));
});

test('tokens are unique and unpredictable (no counters/timestamps)', async () => {
  const kv = fakeKv(); const refs = createCartRefs();
  const tokens = new Set();
  for (let i = 0; i < 200; i++) tokens.add((await (await refs.create(post(snapshot(), { 'cf-connecting-ip': '198.51.100.' + (i % 250) + '.' + i }), ctxFor(kv))).json()).ref);
  assert.equal(tokens.size, 200);
  const first = [...tokens][0];
  assert.ok(![...tokens].some((t) => t.slice(0, 6) === first.slice(0, 6) && t !== first && t.slice(0, 12) === first.slice(0, 12)));
});

test('POST is refused unless it is same-origin, from the allowlisted page, JSON, small and well-formed', async () => {
  const kv = fakeKv(); const refs = createCartRefs();
  const cases = [
    [post(snapshot(), { origin: 'https://evil.example' }), 403], [post(snapshot(), { origin: '' }), 403],
    [post(snapshot(), { referer: 'https://evil.example/usesul/product/serra-catarinense' }), 403], [post(snapshot(), { referer: ORIGIN + '/usesul/product/outro' }), 403],
    [post(snapshot(), { referer: '' }), 403], [post(snapshot(), { 'sec-fetch-site': 'cross-site' }), 403],
    [post(snapshot(), { 'content-type': 'text/plain' }), 400], [post('não é json'), 400], [post({ v: 1 }), 400], [post('x'.repeat(9000)), 413]
  ];
  for (const [request, status] of cases) assert.equal((await refs.create(request, ctxFor(kv))).status, status, request.headers.get('referer') + ' ' + request.headers.get('origin'));
  assert.equal(kv.puts.length, 0);
  assert.equal((await refs.create(new Request(ORIGIN + '/__origens/cart-ref', { method: 'GET' }), ctxFor(kv))).status, 405);
});

test('without the CART_REFS binding the feature answers 501 not_configured and stores nothing', async () => {
  const refs = createCartRefs();
  const res = await refs.create(post(snapshot()), ctxFor(undefined));
  assert.equal(res.status, 501); assert.deepEqual(await res.json(), { error: 'not_configured' });
  assert.equal((await refs.read(new Request(ORIGIN + '/__origens/cart-ref/aaaaaaaaaaaaaaaaaaaaaa'), { kv: undefined, token: 'aaaaaaaaaaaaaaaaaaaaaa' })).status, 501);
});

test('GET returns the stored snapshot with its age; unknown, malformed or expired tokens are indistinguishable 404s', async () => {
  const kv = fakeKv(); let t = 5_000_000; const refs = createCartRefs({ now: () => t });
  const { ref } = await (await refs.create(post(snapshot()), ctxFor(kv))).json();
  const get = (token) => refs.read(new Request(ORIGIN + '/__origens/cart-ref/' + token), { kv, token });
  t += 90_000;
  const ok = await get(ref); const body = await ok.json();
  assert.equal(ok.status, 200); assert.equal(body.ageSeconds, 90); assert.equal(body.expiresInSeconds, CART_REF_TTL_SECONDS - 90);
  assert.equal(body.items[0].name, 'Serra Catarinense'); assert.ok(!('savedAt' in body));
  assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal(ok.headers.get('access-control-allow-origin'), null); // sem CORS: só o servidor do storefront lê
  for (const bad of ['', 'curto', ref + 'x', ref.slice(0, 21), '../../etc/passwd', 'a'.repeat(22).replace(/a/g, '!'), 'desconhecidodesconhecid']) assert.equal((await get(bad)).status, 404, bad);
  t += (CART_REF_TTL_SECONDS + 1) * 1000; // além do TTL, mesmo que o KV ainda devolva
  assert.equal((await get(ref)).status, 404);
  assert.equal((await refs.read(new Request(ORIGIN + '/__origens/cart-ref/' + ref, { method: 'POST' }), { kv, token: ref })).status, 405);
});

test('a per-IP limiter slows down trivial abuse (POST 20/min, GET 120/min)', async () => {
  const kv = fakeKv(); let t = 0; const refs = createCartRefs({ now: () => t });
  const ip = { 'cf-connecting-ip': '203.0.113.9' };
  let last;
  for (let i = 0; i < 21; i++) last = await refs.create(post(snapshot(), ip), ctxFor(kv));
  assert.equal(last.status, 429); assert.equal(last.headers.get('retry-after'), '60');
  assert.equal((await refs.create(post(snapshot(), { 'cf-connecting-ip': '203.0.113.10' }), ctxFor(kv))).status, 201); // outro IP
  t += 61_000;
  assert.equal((await refs.create(post(snapshot(), ip), ctxFor(kv))).status, 201); // janela renovada
});

test('promotion fields: list price and the displayed total are kept when well-formed, dropped/rejected when not', () => {
  const item = { ...snapshot().items[0], linePriceText: 'R$ 99,90', linePrice: 99.9, listPriceText: 'R$ 109,90', listPrice: 109.9 };
  const clean = validateSnapshot(snapshot({ items: [item], subtotal: 439.6, discount: 40, total: 399.6, totalText: 'R$ 399,60' }));
  assert.equal(clean.items[0].listPriceText, 'R$ 109,90'); assert.equal(clean.items[0].listPrice, 109.9); assert.equal(clean.total, 399.6); assert.equal(clean.totalText, 'R$ 399,60');
  const dropped = validateSnapshot(snapshot({ items: [{ ...item, listPriceText: 'lixo', listPrice: 5 }], totalText: '<b>x</b>', total: null }));
  assert.equal(dropped.items[0].listPriceText, undefined); assert.equal(dropped.items[0].listPrice, undefined); assert.equal(dropped.totalText, undefined); assert.equal(dropped.total, undefined);
  assert.equal(validateSnapshot(snapshot({ total: -1 })), null); assert.equal(validateSnapshot(snapshot({ total: 'x' })), null);
});

test('a real-sized cart (12 different variants) is accepted; 21 are refused', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ ...snapshot().items[0], variant: 'v' + i, color: 'c' + i }));
  assert.equal(validateSnapshot(snapshot({ count: 12, items: rows(12) })).items.length, 12);
  assert.equal(validateSnapshot(snapshot({ count: 21, items: rows(21) })), null);
});
