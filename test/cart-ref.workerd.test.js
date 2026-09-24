import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';

// cart-ref no workerd REAL, com um KV local (Miniflare) no lugar do binding CART_REFS.
const HOST = 'https://www.usesul.com.br';
const ALLOWED = '/usesul/product/serra-catarinense';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const SNAP = { v: 1, count: 1, items: [{ productId: '4932916', name: 'Serra Catarinense', color: 'Preta', size: 'M', variant: 'Preta-Masculino-M', quantity: 1, linePriceText: 'R$ 109,90', linePrice: 109.9, image: IMG }], subtotal: 109.9, discount: 0 };
const INK = '<!doctype html><html><head></head><body>INK</body></html>';
const outbound = async () => new Response(INK, { headers: { 'content-type': 'text/html' } });

const instances = new Map();
async function worker(bindings, { kv = true } = {}) {
  const key = JSON.stringify([bindings, kv]);
  if (!instances.has(key)) instances.set(key, new Miniflare({ ...workerModules(), compatibilityDate: '2026-08-01', bindings, ...(kv ? { kvNamespaces: ['CART_REFS'] } : {}), outboundService: outbound }));
  return instances.get(key);
}
after(async () => { for (const m of instances.values()) await m.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOWED, WIDGET_FEATURES: 'return-link,cart-discovery,cart-mirror' };
const postHeaders = { 'content-type': 'application/json', origin: HOST, referer: HOST + ALLOWED, 'sec-fetch-site': 'same-origin' };
const post = async (b, body = SNAP, headers = postHeaders, opts) => (await worker(b, opts)).dispatchFetch(HOST + '/__origens/cart-ref', { method: 'POST', headers, body: JSON.stringify(body) });
const get = async (b, token, opts) => (await worker(b, opts)).dispatchFetch(HOST + '/__origens/cart-ref/' + token);

test('full flow: POST from the authorized page stores a snapshot; GET by token returns it (no CORS, no-store)', async () => {
  const created = await post(ON);
  assert.equal(created.status, 201);
  const { ref, ttl } = await created.json();
  assert.match(ref, /^[A-Za-z0-9_-]{22}$/); assert.equal(ttl, 1800);
  const read = await get(ON, ref);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('access-control-allow-origin'), null); assert.equal(read.headers.get('cache-control'), 'no-store');
  const body = await read.json();
  assert.equal(body.items[0].name, 'Serra Catarinense'); assert.equal(body.items[0].image, IMG); assert.equal(body.count, 1); assert.equal(body.subtotal, 109.9);
  assert.ok(body.ageSeconds >= 0 && body.expiresInSeconds <= 1800); assert.ok(!('savedAt' in body));
  assert.equal((await get(ON, 'aaaaaaaaaaaaaaaaaaaaaa')).status, 404);
  assert.equal((await get(ON, 'curto')).status, 404);
});

test('POST refusals in the real runtime: wrong Origin/Referer/Content-Type/body never reach the KV', async () => {
  for (const [headers, status] of [
    [{ ...postHeaders, origin: 'https://evil.example' }, 403], [{ ...postHeaders, referer: HOST + '/usesul/product/outro' }, 403],
    [{ ...postHeaders, referer: 'https://evil.example' + ALLOWED }, 403], [{ ...postHeaders, 'sec-fetch-site': 'cross-site' }, 403], [{ ...postHeaders, 'content-type': 'text/plain' }, 400]
  ]) assert.equal((await post(ON, SNAP, headers)).status, status, JSON.stringify(headers));
  assert.equal((await post(ON, { v: 1, count: 1, items: [{ name: 'x' }] })).status, 400);
  assert.equal((await post(ON, { ...SNAP, cookie: 'SEGREDO' })).status, 201); // campo extra é descartado, não gravado
  const { ref } = await (await post(ON)).json();
  assert.ok(!JSON.stringify(await (await get(ON, ref)).json()).includes('SEGREDO'));
});

test('the feature is fail-closed: flag off, dry-run or no cart-mirror => the INK answers (nothing stored, nothing read)', async () => {
  for (const b of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link,cart-discovery' }, { ...ON, WIDGET_FEATURES: '' }, { ...ON, WIDGET_FEATURES: 'cart-mirror,evil' }]) {
    assert.equal(await (await post(b)).text(), INK, JSON.stringify(b));
    assert.equal(await (await get(b, 'aaaaaaaaaaaaaaaaaaaaaa')).text(), INK, JSON.stringify(b));
  }
});

test('without the CART_REFS binding, the enabled feature answers 501 not_configured', async () => {
  const bindings = { ...ON, WIDGET_ALLOWLIST: ALLOWED + ',/usesul/product/sem-kv' };
  const res = await post(bindings, SNAP, postHeaders, { kv: false });
  assert.equal(res.status, 501); assert.deepEqual(await res.json(), { error: 'not_configured' });
  assert.equal((await get(bindings, 'aaaaaaaaaaaaaaaaaaaaaa', { kv: false })).status, 501);
});

test('the loader only carries the mirror module when cart-mirror is enabled; cart-mirror does not widen the allowlist', async () => {
  const mf = await worker(ON);
  const withMirror = await (await mf.dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(withMirror, /id: 'cart-mirror'/); assert.ok(withMirror.includes('const ALLOWED_PATHS = ["' + ALLOWED + '"];'));
  const without = await (await (await worker({ ...ON, WIDGET_FEATURES: 'return-link,cart-discovery' })).dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.doesNotMatch(without, /cart-mirror|MIRROR_ENDPOINT/);
  const tags = async (path) => (((await (await mf.dispatchFetch(HOST + path)).text()).match(/data-use-origens-widget/g)) || []).length;
  assert.equal(await tags(ALLOWED), 1); for (const p of ['/usesul/product/outro', '/usesul', '/usesul/cart']) assert.equal(await tags(p), 0, p);
});

test('health lists cart-mirror only when enabled by deploy', async () => {
  const h = await (await (await worker(ON)).dispatchFetch(HOST + '/__origens/health')).json();
  assert.deepEqual(h.widget_features, ['return-link', 'cart-discovery', 'cart-mirror']);
  const off = await (await (await worker({ ...ON, WIDGET_FEATURES: 'return-link,cart-discovery' })).dispatchFetch(HOST + '/__origens/health')).json();
  assert.ok(!off.widget_features.includes('cart-mirror'));
});
