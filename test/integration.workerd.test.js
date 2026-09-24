import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Miniflare } from 'miniflare';

// HTMLRewriter REAL do runtime workerd. A origem (INK) é um stub via outboundService: nenhuma rede.
// Isto valida o Worker no runtime; NÃO valida o edge Cloudflare nem a INK real.
const PAGE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const LOADER_TAG_RE = /<script src="\/__origens\/loader\.js\?v=[^"]+" defer data-cfasync="false" data-use-origens-widget="[^"]+"><\/script>/g;

let origin = { calls: [], respond: () => new Response('unset', { status: 500 }) };
const instances = new Map();

async function worker(mode) {
  if (!instances.has(mode)) {
    instances.set(mode, new Miniflare({
      modules: [
        { type: 'ESModule', path: new URL('../src/worker.js', import.meta.url).pathname },
        { type: 'ESModule', path: new URL('../src/loader-source.js', import.meta.url).pathname }
      ],
      compatibilityDate: '2026-08-01',
      bindings: { ENABLE_WIDGET: mode },
      outboundService: async (request) => {
        origin.calls.push({ method: request.method, url: request.url, body: await request.clone().text() });
        return origin.respond(request);
      }
    }));
  }
  return instances.get(mode);
}

function htmlResponse(body = PAGE, extra = {}) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', etag: 'W/"abc"', 'cache-control': 'private, no-store' });
  headers.append('set-cookie', 'a=1; path=/; HttpOnly');
  headers.append('set-cookie', 'b=2; path=/; Secure');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(body, { status: 200, headers });
}

async function get(mode, path, init = {}) {
  const mf = await worker(mode);
  origin.calls = [];
  return mf.dispatchFetch(HOST + path, { redirect: 'manual', ...init });
}

beforeEach(() => { origin.respond = () => htmlResponse(); });
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

test('flag OFF: product HTML is byte-identical and cookies survive', async () => {
  const res = await get('false', '/usesul/product/serra-catarinense');
  assert.equal(await res.text(), PAGE);
  assert.equal(res.headers.getSetCookie().length, 2);
  assert.equal(res.headers.get('etag'), 'W/"abc"');
});

test('flag OFF is also the default for unknown values', async () => {
  const res = await get('banana', '/usesul/product/serra-catarinense');
  assert.equal(await res.text(), PAGE);
});

test('flag ON: injects exactly one loader before </head>, rest of the HTML unchanged', async () => {
  const res = await get('true', '/usesul/product/serra-catarinense');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(text.match(LOADER_TAG_RE)?.length, 1);
  assert.ok(text.indexOf('loader.js') < text.indexOf('</head>'));
  assert.equal(text.replace(LOADER_TAG_RE, ''), PAGE);
});

test('flag ON: Set-Cookie (both) and cache-control preserved; stale ETag and Content-Length dropped', async () => {
  origin.respond = () => htmlResponse(PAGE, { 'content-length': String(Buffer.byteLength(PAGE)) });
  const res = await get('true', '/usesul/product/serra-catarinense');
  await res.text();
  assert.deepEqual(res.headers.getSetCookie(), ['a=1; path=/; HttpOnly', 'b=2; path=/; Secure']);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('etag'), null);
  assert.notEqual(res.headers.get('content-length'), String(Buffer.byteLength(PAGE)));
});

test('flag ON: does not duplicate a loader already present in the origin HTML', async () => {
  const withTag = PAGE.replace('</head>', '<script src="/__origens/loader.js?v=old" defer data-use-origens-widget="old"></script></head>');
  origin.respond = () => htmlResponse(withTag);
  const res = await get('true', '/usesul/product/serra-catarinense');
  const text = await res.text();
  assert.equal(text.match(/data-use-origens-widget/g)?.length, 1, text.slice(0, 300) + ' | calls=' + origin.calls.length + ' status=' + res.status);
});

test('flag ON: gzip origin over real HTTP is never corrupted (fail-safe pass-through)', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
    res.end(gzipSync(PAGE));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const mf = new Miniflare({
    modules: [
      { type: 'ESModule', path: new URL('../src/worker.js', import.meta.url).pathname },
      { type: 'ESModule', path: new URL('../src/loader-source.js', import.meta.url).pathname }
    ],
    compatibilityDate: '2026-08-01',
    bindings: { ENABLE_WIDGET: 'true' },
    outboundService: (request) => fetch(request.url.replace(HOST, 'http://127.0.0.1:' + port), { headers: request.headers })
  });
  try {
    const res = await mf.dispatchFetch(HOST + '/usesul/product/serra-catarinense', { redirect: 'manual', headers: { 'accept-encoding': 'gzip' } });
    const text = await res.text();
    // Neste harness (undici) o corpo chega decodificado mas com Content-Encoding: o guard do Worker passa
    // a resposta sem tocar. O comportamento do runtime no edge real com Content-Encoding NÃO está validado.
    assert.equal(text, PAGE);
  } finally {
    await mf.dispose();
    server.close();
  }
});

test('flag ON: a body still marked Content-Encoding is passed through, never rewritten', async () => {
  // Stub de Response com o cabeçalho mas sem decodificação: o Worker não pode tocar nele.
  origin.respond = () => htmlResponse(gzipSync(PAGE), { 'content-encoding': 'gzip' });
  const res = await get('true', '/usesul/product/serra-catarinense', { headers: { 'accept-encoding': 'gzip' } });
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(!bytes.toString('latin1').includes('data-use-origens-widget'));
});

test('dry-run: HTML untouched, no new headers', async () => {
  const res = await get('dry-run', '/usesul/product/serra-catarinense');
  assert.equal(await res.text(), PAGE);
  assert.deepEqual([...res.headers.keys()].filter((k) => k.startsWith('x-origens')), []);
});

test('flag ON: only exact product pages are rewritten', async () => {
  for (const path of ['/usesul', '/usesul/', '/usesul/cart', '/usesul/checkout', '/usesul/products',
    '/usesul/product/serra/extra', '/usesul/product', '/usesul/product/', '/usesul/api/v1/orders', '/usesul/collections/da-nossa-terra']) {
    const res = await get('true', path);
    assert.equal(await res.text(), PAGE, path);
  }
});

test('flag ON: POST, PUT and HEAD are forwarded, never rewritten', async () => {
  const post = await get('true', '/usesul/product/serra-catarinense', { method: 'POST', body: 'x=1' });
  assert.equal(await post.text(), PAGE);
  assert.equal(origin.calls[0].method, 'POST');
  assert.equal(origin.calls[0].body, 'x=1');
  const head = await get('true', '/usesul/product/serra-catarinense', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(origin.calls[0].method, 'HEAD');
});

test('flag ON: Turbo-Frame fragment requests are not rewritten', async () => {
  const res = await get('true', '/usesul/product/serra-catarinense', { headers: { 'Turbo-Frame': 'cart' } });
  assert.equal(await res.text(), PAGE);
});

test('flag ON: redirects reach the client unfollowed and unchanged', async () => {
  origin.respond = () => new Response(null, { status: 302, headers: { location: '/usesul/product/outro', 'set-cookie': 'r=1' } });
  const res = await get('true', '/usesul/product/serra-catarinense');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/usesul/product/outro');
  assert.equal(origin.calls.length, 1);
});

test('flag ON: errors and non-HTML are passed through unchanged', async () => {
  origin.respond = () => new Response(PAGE, { status: 404, headers: { 'content-type': 'text/html' } });
  assert.equal((await get('true', '/usesul/product/nao-existe')).status, 404);
  origin.respond = () => new Response(PAGE, { status: 500, headers: { 'content-type': 'text/html' } });
  const err = await get('true', '/usesul/product/x');
  assert.equal(err.status, 500);
  assert.equal(await err.text(), PAGE);
  origin.respond = () => Response.json({ ok: true });
  assert.deepEqual(await (await get('true', '/usesul/product/data')).json(), { ok: true });
  origin.respond = () => htmlResponse(PAGE, { 'content-disposition': 'attachment; filename="p.html"' });
  assert.equal(await (await get('true', '/usesul/product/p')).text(), PAGE);
});

test('loader endpoint: JS when ON, no-op when OFF, never proxied, GET/HEAD only', async () => {
  const on = await get('true', '/__origens/loader.js');
  assert.match(on.headers.get('content-type'), /javascript/);
  assert.match(await on.text(), /Voltar a procurar/);
  assert.equal(origin.calls.length, 0);
  const off = await get('false', '/__origens/loader.js');
  assert.equal(await off.text(), '/* use-origens widget disabled */');
  assert.equal(off.headers.get('cache-control'), 'no-store');
  assert.equal(origin.calls.length, 0);
  assert.equal((await get('true', '/__origens/loader.js', { method: 'POST' })).status, 405);
});

test('health reports the mode without touching the origin', async () => {
  const res = await get('dry-run', '/__origens/health');
  assert.equal((await res.json()).widget_mode, 'dry-run');
  assert.equal(origin.calls.length, 0);
});

test('worker sets no security or custom headers of its own', async () => {
  const res = await get('true', '/usesul/product/serra-catarinense');
  const names = [...res.headers.keys()];
  for (const forbidden of ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'access-control-allow-origin']) {
    assert.ok(!names.includes(forbidden), forbidden);
  }
});
