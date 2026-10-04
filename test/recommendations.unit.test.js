import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecommendationsGateway, normalizeRecommendations, productIdOf, validateItem, REASONS, MAX_ITEMS } from '../src/recommendations-gateway.js';
import { STORES } from '../src/stores.js';

// Gateway das recomendações (puro + handle com upstream injetado). Cada regra de segurança de link do MD §17 tem um caso.
const SUL = STORES.sul;
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id, extra = {}) => ({ productId: String(id), title: 'Florianópolis · Feito em ' + id, image: IMG + id + '.webp', price: 109.9, href: 'https://www.usesul.com.br/usesul/product/feito-em-' + id, reason: 'same-locality:feito-em', ...extra });
const payload = (items, extra = {}) => ({ v: 1, region: 'sul', productId: '3789929', status: 'ok', items, ...extra });

test('productIdOf: only a canonical numeric id directly under the path', () => {
  assert.equal(productIdOf('/__origens/recommendations/3789929'), '3789929');
  for (const bad of ['/__origens/recommendations/', '/__origens/recommendations/0', '/__origens/recommendations/12a', '/__origens/recommendations/1/2', '/__origens/recommendations/..%2f', '/__origens/recommendations/12345678901234567']) assert.equal(productIdOf(bad), null, bad);
});

test('a valid item passes and is reduced to the public contract', () => {
  const r = validateItem(item(1), '3789929', SUL);
  assert.deepEqual(r.item, { productId: '1', title: 'Florianópolis · Feito em 1', image: IMG + '1.webp', price: 109.9, href: 'https://www.usesul.com.br/usesul/product/feito-em-1', reason: 'same-locality:feito-em' });
});

test('11. invalid links are dropped: http, other host, credentials, port, query, fragment, non-product path', () => {
  const bad = [
    'http://www.usesul.com.br/usesul/product/x', 'https://evil.example/usesul/product/x', 'https://www.usesul.com.br.evil.example/usesul/product/x',
    'https://user:pw@www.usesul.com.br/usesul/product/x', 'https://www.usesul.com.br:8443/usesul/product/x', 'https://www.usesul.com.br/usesul/product/x?utm=1',
    'https://www.usesul.com.br/usesul/product/x#y', 'https://www.usesul.com.br/usesul/cart', 'https://www.usesul.com.br/usesul/product/x/y', 'https://www.usesul.com.br/usesul/product/../checkout',
    'javascript:alert(1)', '//www.usesul.com.br/usesul/product/x', ''
  ];
  for (const href of bad) assert.equal(validateItem(item(2, { href }), '3789929', SUL).drop, 'href', href);
});

test('12. invalid images are dropped: http, foreign host, credentials, port', () => {
  for (const image of ['http://gcp-images.majestic.ink.rsvcloud.com/x.webp', 'https://evil.example/x.webp', 'https://a:b@gcp-images.majestic.ink.rsvcloud.com/x.webp', 'https://gcp-images.majestic.ink.rsvcloud.com:444/x.webp', 'data:image/png;base64,AAAA', 42]) {
    assert.equal(validateItem(item(3, { image }), '3789929', SUL).drop, 'image', String(image));
  }
});

test('13. invalid prices are dropped: missing, string, zero, negative, NaN, absurd', () => {
  for (const price of [undefined, '109.90', 0, -1, Number.NaN, Infinity, 50000]) assert.equal(validateItem(item(4, { price }), '3789929', SUL).drop, 'price', String(price));
});

test('14. another store is rejected: a Sul list never reaches the Norte Worker and its links never pass the Norte host', () => {
  const sulList = payload([item(5), item(6)]);
  assert.deepEqual(normalizeRecommendations(sulList, '3789929', STORES.norte).items, [], 'region mismatch drops the payload');
  assert.equal(validateItem(item(5), '3789929', STORES.norte).drop, 'href');
});

test('1. the current product never comes back; titles with markup/control chars are dropped; unknown reasons are stripped', () => {
  assert.equal(validateItem(item(3789929), '3789929', SUL).drop, 'self');
  assert.equal(validateItem(item(7, { title: '<img src=x onerror=alert(1)>' }), '3789929', SUL).drop, 'title');
  assert.equal(validateItem(item(7, { title: 'a'.repeat(91) }), '3789929', SUL).drop, 'title');
  assert.equal('reason' in validateItem(item(7, { reason: 'evil' }), '3789929', SUL).item, false);
  assert.ok(REASONS.includes('same-locality:coordinates'));
});

test('payload rules: version, region, product id must match; duplicates removed; max 4; fewer than 2 valid => empty (block hidden)', () => {
  assert.deepEqual(normalizeRecommendations(payload([item(1), item(2)], { v: 2 }), '3789929', SUL).items, []);
  assert.deepEqual(normalizeRecommendations(payload([item(1), item(2)], { productId: '1' }), '3789929', SUL).items, []);
  const dup = normalizeRecommendations(payload([item(1), item(1), item(2, { href: item(1).href })]), '3789929', SUL);
  assert.deepEqual(dup.items, [], 'only one distinct product survived');
  assert.equal(dup.dropped.duplicate, 2);
  const many = normalizeRecommendations(payload([1, 2, 3, 4, 5, 6].map((n) => item(n))), '3789929', SUL);
  assert.equal(many.items.length, MAX_ITEMS);
  const mixed = normalizeRecommendations(payload([item(1), item(2, { price: 0 }), item(3, { href: 'https://evil.example/usesul/product/x' }), item(4)]), '3789929', SUL);
  assert.deepEqual(mixed.items.map((i) => i.productId), ['1', '4']);
  assert.deepEqual(mixed.dropped, { price: 1, href: 1 });
});

const res = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

test('handle: fixed storefront URL, no visitor headers, cacheable 5 min; GET/HEAD only', async () => {
  const calls = [];
  const gw = createRecommendationsGateway({ store: SUL, upstream: async (req) => { calls.push({ url: req.url, cookie: req.headers.get('cookie'), auth: req.headers.get('authorization') }); return res(payload([item(1), item(2)])); } });
  const r = await gw.handle(new Request('https://www.usesul.com.br/__origens/recommendations/3789929?url=https://evil.example', { headers: { cookie: 'session=1', authorization: 'Bearer x' } }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(r.headers.get('x-origens-reco'), 'ok');
  assert.deepEqual((await r.json()).items.map((i) => i.productId), ['1', '2']);
  assert.deepEqual(calls, [{ url: 'https://useorigens.com.br/api/recommendations/sul/3789929', cookie: null, auth: null }]);
  assert.equal((await gw.handle(new Request('https://www.usesul.com.br/__origens/recommendations/3789929', { method: 'POST', body: '{}' }))).status, 405);
  const head = await gw.handle(new Request('https://www.usesul.com.br/__origens/recommendations/3789929', { method: 'HEAD' }));
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await gw.handle(new Request('https://www.usesul.com.br/__origens/recommendations/abc'))).status, 404);
});

test('10./fallback: missing index, upstream error, bad JSON, oversized body, timeout => 200 { items: [] } (fail closed, short cache)', async () => {
  const cases = [
    [() => res({ v: 1, region: 'sul', productId: '3789929', status: 'no-index', items: [] }), 'no-index'],
    [() => res('oops', { status: 502 }), 'unavailable'],
    [() => res('{not json'), 'unavailable'],
    [() => res('x'.repeat(20000)), 'unavailable'],
    [() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'unavailable'],
    [(req, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))), 'unavailable']
  ];
  for (const [upstream, status] of cases) {
    const gw = createRecommendationsGateway({ store: SUL, upstream: async (req, init) => upstream(req, init) });
    const started = Date.now();
    const r = await gw.handle(new Request('https://www.usesul.com.br/__origens/recommendations/3789929'));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { items: [] }); assert.equal(r.headers.get('x-origens-reco'), status);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    assert.ok(Date.now() - started < 2500, 'timeout is short');
  }
});
