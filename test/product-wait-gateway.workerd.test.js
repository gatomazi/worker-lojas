import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { jobIdOf, normalizeJob, productUrl, PRODUCT_WAIT_PATH } from '../src/product-wait-gateway.js';
import { STORES, withInkDomain } from '../src/stores.js';

// Rota /__origens/produto/<id> no workerd REAL, com o storefront e a INK como stubs (outboundService), na loja única do domínio novo
// (SINGLE_STORE_DOMAIN=next: loja.useorigens.com.br/useorigens). O gateway só existe com ENABLE_WIDGET=true + product-wait.
const NEXT = withInkDomain(STORES.sul, 'next').store;
const HOST = 'https://loja.useorigens.com.br';
const ID = '01JB8Z6Q4M0000000000000001';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/42.jpg';
const URL_OK = HOST + '/useorigens/product/silva-natal-em-familia-universitario';
const job = (extra = {}) => ({ id: ID, label: 'Universitário', status: 'creating', url: null, image: null, ...extra });
const ready = (extra = {}) => job({ status: 'ready', url: URL_OK, image: IMG, ...extra });

const calls = [];
const instances = new Map();
let storefront = () => Response.json(job());
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization'), visitor: request.headers.get('x-origens-visitor') });
        if (url.host === 'useorigens.com.br') return storefront(request, url);
        if (url.pathname.startsWith('/__origens/')) return new Response('INK 404', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response('<!doctype html><html><head></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const BASE = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', SINGLE_STORE_DOMAIN: 'next', SERVE_REGIONS: 'sul,norte,centro-oeste' };
const ON = { ...BASE, WIDGET_FEATURES: 'return-link,promo-fab,assistant,product-wait' };
const OFF = { ...BASE, WIDGET_FEATURES: 'return-link,promo-fab,assistant' };
const sfCalls = () => calls.filter((c) => c.host === 'useorigens.com.br');

test('jobIdOf: only a ULID right after /__origens/produto/ (the cookie format); anything else is refused', () => {
  assert.equal(PRODUCT_WAIT_PATH, '/__origens/produto/');
  assert.equal(jobIdOf('/__origens/produto/' + ID), ID);
  for (const bad of ['/__origens/produto/', '/__origens/produto/' + ID.toLowerCase(), '/__origens/produto/' + ID + '/x', '/__origens/produto/' + ID.slice(1), '/__origens/produto/01JB8Z6Q4M000000000000000I', '/__origens/produto/../health', '/__origens/produtos/' + ID]) {
    assert.equal(jobIdOf(bad), null, bad);
  }
});

test('normalizeJob: the contract field by field; link only to a product page of THIS store on INK, photo only from INK\'s CDN, both only when ready', () => {
  assert.deepEqual(normalizeJob(job({ extra: 'x', error: 'internal' }), ID, NEXT), { id: ID, label: 'Universitário', status: 'creating', url: null, image: null }, 'extra fields never pass');
  assert.deepEqual(normalizeJob(ready(), ID, NEXT), { id: ID, label: 'Universitário', status: 'ready', url: URL_OK, image: IMG });
  assert.deepEqual(normalizeJob(job({ label: '  Eu vim   pela ceia · Infantil ' }), ID, NEXT).label, 'Eu vim pela ceia · Infantil');
  // "ready" sem link e sem foto é válido (o storefront anula um link que não reconhece): o cliente mostra o aviso.
  assert.deepEqual(normalizeJob(ready({ url: null, image: null }), ID, NEXT), { id: ID, label: 'Universitário', status: 'ready', url: null, image: null });
  for (const status of ['queued', 'photos', 'failed', 'check']) assert.equal(normalizeJob(job({ status }), ID, NEXT).status, status);
  for (const [why, bad] of [
    ['other id', job({ id: '01JB8Z6Q4M0000000000000002' })],
    ['unknown status', job({ status: 'done' })],
    ['markup in the label', job({ label: '<b>x</b>' })],
    ['label too long', job({ label: 'x'.repeat(91) })],
    ['empty label', job({ label: '   ' })],
    ['link before ready', job({ url: URL_OK })],
    ['photo before ready', job({ image: IMG })],
    ['the old Sul host', ready({ url: 'https://www.usesul.com.br/usesul/product/silva' })],
    ['another store', ready({ url: 'https://www.usenorte.com.br/usenorte/product/silva' })],
    ['http', ready({ url: 'http://loja.useorigens.com.br/useorigens/product/silva' })],
    ['query', ready({ url: URL_OK + '?cart_ref=1' })],
    ['fragment', ready({ url: URL_OK + '#x' })],
    ['not a product page', ready({ url: HOST + '/useorigens/collections/natal' })],
    ['credentials', ready({ url: 'https://u:p@loja.useorigens.com.br/useorigens/product/silva' })],
    ['photo elsewhere', ready({ image: 'https://evil.example/a.jpg' })],
    ['javascript', ready({ url: 'javascript:alert(1)' })],
    ['not an object', [job()]]
  ]) assert.equal(normalizeJob(bad, ID, NEXT), null, why);
  assert.equal(productUrl(URL_OK, NEXT), URL_OK);
  assert.equal(productUrl(URL_OK, STORES.sul), null, 'before the domain move the store answers on www.usesul.com.br');
});

test('feature off, or the widget not "true": the route is INK\'s (its 404); nothing reaches the storefront', async () => {
  for (const bindings of [OFF, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, ENABLE_WIDGET: 'false' }]) {
    const mf = await worker(bindings); calls.length = 0;
    const res = await mf.dispatchFetch(HOST + '/__origens/produto/' + ID);
    assert.equal(res.status, 404, JSON.stringify(bindings));
    assert.equal(await res.text(), 'INK 404');
    assert.equal(sfCalls().length, 0);
  }
});

test('flag ON, bad id: 400 JSON here, never a storefront call', async () => {
  const mf = await worker(ON); calls.length = 0;
  for (const path of ['/__origens/produto/', '/__origens/produto/abc', '/__origens/produto/' + ID.toLowerCase(), '/__origens/produto/' + ID + '/x']) {
    const res = await mf.dispatchFetch(HOST + path);
    assert.equal(res.status, 400, path);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { error: 'invalid id' });
  }
  assert.equal(sfCalls().length, 0);
  assert.equal((await mf.dispatchFetch(HOST + '/__origens/produto/' + ID, { method: 'POST', body: '{}' })).status, 405);
});

test('flag ON: the fixed storefront endpoint, without the visitor cookie or authorization, with only a visitor hash; the answer is revalidated and never cached', async () => {
  const mf = await worker(ON); calls.length = 0;
  storefront = () => Response.json({ ...ready(), surname: 'Silva', inkProductId: 123 }, { headers: { 'cache-control': 'no-store' } });
  const res = await mf.dispatchFetch(HOST + '/__origens/produto/' + ID + '?origens_r=norte', { headers: { cookie: 'uo_produtos=' + ID + '; _session=secret', authorization: 'Bearer x', 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { id: ID, label: 'Universitário', status: 'ready', url: URL_OK, image: IMG });
  const sent = sfCalls();
  assert.deepEqual(sent.map((c) => [c.method, c.path, c.cookie, c.authorization]), [['GET', '/api/personalizar/produto/' + ID, null, null]]);
  assert.match(sent[0].visitor, /^[a-f0-9]{32}$/, 'the same hash as the assistant (the storefront accepts 16–64 hex)');
  assert.doesNotMatch(sent[0].visitor, /203/);
  const head = await mf.dispatchFetch(HOST + '/__origens/produto/' + ID, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('flag ON: the storefront\'s 404 JSON stays a 404; anything else off the contract (junk fields, HTML, errors, redirects, too large, a failed fetch) is a 503 JSON', async () => {
  const mf = await worker(ON);
  const get = () => mf.dispatchFetch(HOST + '/__origens/produto/' + ID);
  storefront = () => Response.json({ error: 'not found' }, { status: 404 });
  let res = await get();
  assert.equal(res.status, 404); assert.deepEqual(await res.json(), { error: 'not found' }); assert.equal(res.headers.get('cache-control'), 'no-store');
  for (const [why, answer] of [
    ['junk url', () => Response.json(ready({ url: 'https://evil.example/useorigens/product/x' }))],
    ['junk image', () => Response.json(ready({ image: 'https://evil.example/a.jpg' }))],
    ['junk status', () => Response.json(job({ status: 'hacked' }))],
    ['junk label', () => Response.json(job({ label: '<script>alert(1)</script>' }))],
    ['another job', () => Response.json(job({ id: '01JB8Z6Q4M0000000000000002' }))],
    ['a 404 page (route not deployed)', () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } })],
    ['html 200', () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })],
    ['502', () => new Response('down', { status: 502 })],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })],
    ['too large', () => Response.json({ ...job(), pad: 'x'.repeat(5000) })],
    ['not JSON', () => new Response('{nope', { headers: { 'content-type': 'application/json' } })],
    ['upstream throws', () => { throw new Error('boom'); }]
  ]) {
    storefront = answer;
    res = await get();
    assert.equal(res.status, 503, why);
    assert.deepEqual(await res.json(), { error: 'unavailable' }, why);
    assert.equal(res.headers.get('cache-control'), 'no-store', why);
  }
});

test('the loader this Worker serves carries the module only with product-wait on', async () => {
  const on = await (await (await worker(ON)).dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(on, /id: 'product-wait'/);
  const off = await (await (await worker(OFF)).dispatchFetch(HOST + '/__origens/loader.js')).text();
  assert.match(off, /id: 'assistant'/, 'a real loader');
  assert.doesNotMatch(off, /id: 'product-wait'|uo_produtos/);
});
