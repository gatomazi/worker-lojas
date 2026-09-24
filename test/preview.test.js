import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { FIXTURE_PAGE } from '../src/preview-fixtures.js';

// Entrada de PREVIEW (fixtures) rodando no workerd local. O env é HOSTIL de propósito
// (ENABLE_WIDGET=true e allowlist cheia): a entrada de preview precisa ignorá-lo e nunca injetar.
const MODULES = ['preview-entry.js', 'worker.js', 'allowlist.js', 'loader-source.js', 'preview-fixtures.js']
  .map((file) => ({ type: 'ESModule', path: new URL('../src/' + file, import.meta.url).pathname }));
const BASE = 'https://preview.example.workers.dev';

const liveCalls = [];
const mf = new Miniflare({
  modules: MODULES,
  compatibilityDate: '2026-08-01',
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense,/usesul/product/outro' },
  outboundService: async (request) => {
    liveCalls.push({ method: request.method, url: request.url, cookie: request.headers.get('cookie') });
    const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', etag: 'W/"x"' });
    headers.append('set-cookie', 'sessao=VALOR_SECRETO_1; Path=/');
    headers.append('set-cookie', 'guest_token=VALOR_SECRETO_2; Path=/');
    return new Response('<!DOCTYPE html><html><head></head><body><button id=\'add-to-cart-desk\'>x</button></body></html>', { headers });
  }
});
after(() => mf.dispose());

const get = (path, init = {}) => mf.dispatchFetch(BASE + path, { redirect: 'manual', ...init });
const fixture = (variant, path) => '/__preview/fixture/' + variant + path;

test('health is the real Worker health', async () => {
  const body = await (await get('/__origens/health')).json();
  assert.equal(body.service, 'use-sul-widget');
  assert.equal(body.widget_mode, 'true'); // env do teste; no preview implantado é "false"
});

test('fixture default: product HTML is untouched and both cookies are preserved, even with a hostile env', async () => {
  const res = await get(fixture('default', '/usesul/product/serra-catarinense'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FIXTURE_PAGE);
  assert.deepEqual(res.headers.getSetCookie(), ['fixture_a=1; Path=/; HttpOnly; Secure', 'fixture_b=2; Path=/; Secure']);
  assert.equal(res.headers.get('etag'), 'W/"fixture-etag"');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('fixture allowlisted: path on the allowlist with the flag forced off is untouched', async () => {
  for (const path of ['/usesul/product/serra-catarinense', '/usesul/product/outro']) {
    const text = await (await get(fixture('allowlisted', path))).text();
    assert.equal(text, FIXTURE_PAGE, path);
    assert.ok(!text.includes('data-use-origens-widget'));
  }
});

test('redirect, JSON, 404, 500, cart and checkout pass through untouched', async () => {
  const redirect = await get(fixture('default', '/usesul/product/redirect'));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/usesul/product/serra-catarinense');
  assert.equal(redirect.headers.getSetCookie().length, 2);
  assert.deepEqual(await (await get(fixture('default', '/usesul/product/data'))).json(), { fixture: 'json' });
  assert.equal((await get(fixture('default', '/usesul/product/missing'))).status, 404);
  assert.equal((await get(fixture('default', '/usesul/product/boom'))).status, 500);
  for (const path of ['/usesul/cart', '/usesul/checkout']) assert.equal(await (await get(fixture('default', path))).text(), FIXTURE_PAGE, path);
});

test('POST is forwarded intact (method and body size) and Turbo-Frame requests are untouched', async () => {
  const post = await get(fixture('default', '/usesul/cart'), { method: 'POST', body: 'abcde' });
  assert.equal(post.status, 201);
  assert.deepEqual(await post.json(), { fixture: 'post', method: 'POST', path: '/usesul/cart', body_bytes: 5 });
  const frame = await get(fixture('allowlisted', '/usesul/product/serra-catarinense'), { headers: { 'Turbo-Frame': 'cart' } });
  assert.equal(await frame.text(), FIXTURE_PAGE);
});

test('encoded-header fixture is delivered decodable and unmodified (guard path)', async () => {
  const res = await get(fixture('default', '/usesul/product/gzip'), { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(await res.text(), FIXTURE_PAGE);
});

test('unknown scenarios, other methods and non-fixture paths are refused', async () => {
  assert.equal((await get('/')).status, 404);
  assert.equal((await get('/usesul/product/serra-catarinense')).status, 404);
  assert.equal((await get('/__preview/fixture/other/usesul/cart')).status, 404);
  assert.equal((await get('/__preview/fixture/default/etc/passwd')).status, 404);
  assert.equal((await get(fixture('default', '/usesul/cart'), { method: 'PUT', body: 'x' })).status, 405);
  assert.equal((await get('/__preview/live', { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await get(fixture('default', '/usesul/nope'))).status, 404);
});

test('live probe: fixed real path, GET only, no client headers, metadata only, no cookie values', async () => {
  liveCalls.length = 0;
  const res = await get('/__preview/live?path=/usesul/cart', { headers: { cookie: 'cliente=COOKIE_DO_CLIENTE', authorization: 'Bearer X' } });
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.status, 200);
  assert.equal(body.has_native_cta, true);
  assert.equal(body.loader_present, false);
  assert.equal(body.body_looks_like_html, true);
  assert.deepEqual(body.set_cookie_names, ['sessao', 'guest_token']);
  for (const secret of ['VALOR_SECRETO', 'COOKIE_DO_CLIENTE', 'Bearer']) assert.ok(!text.includes(secret), secret);
  assert.equal(liveCalls.length, 1);
  assert.equal(liveCalls[0].method, 'GET');
  assert.equal(liveCalls[0].url, 'https://www.usesul.com.br/usesul/product/serra-catarinense'); // ?path= ignorado
  assert.equal(liveCalls[0].cookie, null);
});

// ---- isolamento entre preview e produção (configuração)
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('preview config is isolated: own name, no routes, no bindings, safe vars in both blocks', () => {
  const preview = read('wrangler.preview.toml');
  const prod = read('wrangler.production.toml');
  const name = (text) => text.match(/^name\s*=\s*"([^"]+)"/m)[1];
  assert.notEqual(name(preview), name(prod));
  assert.equal(name(preview), 'use-sul-widget-preview');
  assert.match(preview, /^main\s*=\s*"src\/preview-entry\.js"/m);
  assert.match(prod, /^main\s*=\s*"src\/worker\.js"/m);
  assert.match(preview, /^workers_dev\s*=\s*true/m);
  assert.match(preview, /^preview_urls\s*=\s*true/m);
  const code = preview.replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(code, /routes|\broute\b|custom_domain|zone_name|zone_id|kv_namespaces|d1_databases|r2_buckets|queues|services|secrets|hyperdrive|durable_objects|\[assets\]|\.melioffice|usesul\.com\.br/i);
  for (const block of ['vars', 'previews.vars']) {
    const section = code.split('[' + block + ']')[1].split(/^\[/m)[0];
    assert.match(section, /ENABLE_WIDGET\s*=\s*"false"/);
    assert.match(section, /WIDGET_ALLOWLIST\s*=\s*""/);
  }
});

test('production entry never imports preview code', () => {
  for (const file of ['src/worker.js', 'src/allowlist.js', 'src/loader-source.js']) {
    assert.doesNotMatch(read(file), /preview-(entry|fixtures)/, file);
  }
  assert.doesNotMatch(read('wrangler.production.toml'), /preview-entry|preview-fixtures/);
});
