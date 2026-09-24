import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Miniflare } from 'miniflare';
import { JSDOM } from 'jsdom';

// HTMLRewriter REAL do runtime workerd. A origem (INK) é um stub via outboundService: nenhuma rede.
// Isto valida o Worker no runtime; NÃO valida o edge Cloudflare nem a INK real.
const PAGE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const LOADER_TAG_RE = /<script src="\/__origens\/loader\.js\?v=[^"]+" defer data-cfasync="false" data-use-origens-widget="[^"]+"><\/script>/g;

// Fail-closed: 'true' só injeta em caminhos da allowlist. Slugs abaixo cobrem os cenários dos testes.
const ALLOW = ['serra-catarinense', 'nao-existe', 'x', 'data', 'p'].map((slug) => '/usesul/product/' + slug).join(',');
const MODULES = ['worker.js', 'loader-source.js', 'allowlist.js']
  .map((file) => ({ type: 'ESModule', path: new URL('../src/' + file, import.meta.url).pathname }));

let origin = { calls: [], respond: () => new Response('unset', { status: 500 }) };
const instances = new Map();
// Saída do runtime (console.* do Worker), para conferir o que é registrado e o que NÃO pode ser.
const logs = [];
const captureStdio = (stdout, stderr) => { for (const stream of [stdout, stderr]) stream.on('data', (chunk) => logs.push(String(chunk))); };

async function worker(mode, allowlist = ALLOW) {
  const key = mode + '|' + allowlist;
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      modules: MODULES,
      compatibilityDate: '2026-08-01',
      handleRuntimeStdio: captureStdio,
      bindings: { ENABLE_WIDGET: mode, WIDGET_ALLOWLIST: allowlist },
      outboundService: async (request) => {
        origin.calls.push({ method: request.method, url: request.url, body: await request.clone().text() });
        return origin.respond(request);
      }
    }));
  }
  return instances.get(key);
}

function htmlResponse(body = PAGE, extra = {}) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', etag: 'W/"abc"', 'cache-control': 'private, no-store' });
  headers.append('set-cookie', 'a=1; path=/; HttpOnly');
  headers.append('set-cookie', 'b=2; path=/; Secure');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(body, { status: 200, headers });
}

async function get(mode, path, init = {}, allowlist) {
  const mf = await worker(mode, allowlist);
  origin.calls = [];
  return mf.dispatchFetch(HOST + path, { redirect: 'manual', ...init });
}

beforeEach(() => { origin.respond = () => htmlResponse(); logs.length = 0; });
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
    modules: MODULES,
    compatibilityDate: '2026-08-01',
    bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW },
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

// ---- WIDGET_ALLOWLIST no runtime workerd real
const SERRA = '/usesul/product/serra-catarinense';
const OUTRO = '/usesul/product/vida-no-sul-estancia-edition';
const ONLY_SERRA = SERRA;
const injected = (text) => (text.match(LOADER_TAG_RE) || []).length;

test('allowlist: true with empty, missing or malformed list injects nothing (fail-closed)', async () => {
  for (const list of ['', '   ', '/usesul/product/*', '/usesul/*', SERRA + ',', SERRA + ',/usesul/cart', 'lixo', SERRA + '?a=1']) {
    const res = await get('true', SERRA, {}, list);
    assert.equal(await res.text(), PAGE, JSON.stringify(list));
    assert.equal(origin.calls.length, 1);
  }
});

test('allowlist: true injects only on the allowlisted exact path', async () => {
  assert.equal(injected(await (await get('true', SERRA, {}, ONLY_SERRA)).text()), 1);
  assert.equal(await (await get('true', OUTRO, {}, ONLY_SERRA)).text(), PAGE);
});

test('allowlist: query string never changes the decision', async () => {
  assert.equal(injected(await (await get('true', SERRA + '?utm_source=x&origens_return=/sul', {}, ONLY_SERRA)).text()), 1);
  assert.equal(await (await get('true', OUTRO + '?next=' + encodeURIComponent(SERRA), {}, ONLY_SERRA)).text(), PAGE);
  assert.equal(await (await get('true', OUTRO + '?' + SERRA, {}, ONLY_SERRA)).text(), PAGE);
});

test('allowlist: trailing slash, case and encoded variants are not allowlisted', async () => {
  for (const variant of [SERRA + '/', '/usesul/product/Serra-Catarinense', '/usesul/product/serra%2Dcatarinense', SERRA + '/extra']) {
    assert.equal(await (await get('true', variant, {}, ONLY_SERRA)).text(), PAGE, variant);
  }
});

test('allowlist: multiple entries are honored independently', async () => {
  const both = SERRA + ',' + OUTRO;
  assert.equal(injected(await (await get('true', SERRA, {}, both)).text()), 1);
  assert.equal(injected(await (await get('true', OUTRO, {}, both)).text()), 1);
  assert.equal(await (await get('true', '/usesul/product/x', {}, both)).text(), PAGE);
});

test('allowlist: false never injects, even for an allowlisted path', async () => {
  assert.equal(await (await get('false', SERRA, {}, ONLY_SERRA)).text(), PAGE);
});

test('allowlist: dry-run never rewrites; logs only the path, never query, cookie or headers', async () => {
  const res = await get('dry-run', SERRA + '?email=a@b.c&token=SEGREDO123', { headers: { cookie: 'sessao=COOKIE_SECRETO', authorization: 'Bearer XYZ' } }, ONLY_SERRA);
  assert.equal(await res.text(), PAGE);
  assert.equal(res.headers.getSetCookie().length, 2);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const out = logs.join('');
  const line = out.split('\n').find((l) => l.includes('use-origens.dry-run'));
  assert.ok(line, 'dry-run log line present');
  assert.match(line, /"path":"\/usesul\/product\/serra-catarinense"/);
  assert.match(line, /"would_inject":true/);
  for (const secret of ['email', 'token', 'SEGREDO123', 'COOKIE_SECRETO', 'Bearer', 'XYZ', 'a@b.c']) assert.ok(!out.includes(secret), secret);
});

test('allowlist: dry-run on a non-allowlisted page logs would_inject=false and rewrites nothing', async () => {
  const res = await get('dry-run', OUTRO, {}, ONLY_SERRA);
  assert.equal(await res.text(), PAGE);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(logs.join(''), /"would_inject":false/);
});

test('allowlist: Turbo Drive sequence is stateless (allowed, blocked, frame request, allowed again)', async () => {
  assert.equal(injected(await (await get('true', SERRA, {}, ONLY_SERRA)).text()), 1);
  assert.equal(injected(await (await get('true', OUTRO, {}, ONLY_SERRA)).text()), 0);
  assert.equal(injected(await (await get('true', SERRA, { headers: { 'Turbo-Frame': 'cart' } }, ONLY_SERRA)).text()), 0);
  assert.equal(injected(await (await get('true', SERRA, { headers: { accept: 'text/vnd.turbo-stream.html, text/html' } }, ONLY_SERRA)).text()), 1);
});

test('allowlist: publishing the loader does not authorize injecting it elsewhere', async () => {
  const loader = await (await get('true', '/__origens/loader.js', {}, '')).text();
  assert.match(loader, /const ALLOWED_PATHS = \[\];/);
  assert.equal(await (await get('true', SERRA, {}, '')).text(), PAGE);
});

test('allowlist: the served loader embeds exactly the validated list', async () => {
  const loader = await (await get('true', '/__origens/loader.js', {}, SERRA + ',' + OUTRO)).text();
  assert.ok(loader.includes('const ALLOWED_PATHS = ["' + SERRA + '","' + OUTRO + '"];'));
  const invalid = await (await get('true', '/__origens/loader.js', {}, SERRA + ',/usesul/product/*')).text();
  assert.match(invalid, /const ALLOWED_PATHS = \[\];/);
  const off = await (await get('false', '/__origens/loader.js', {}, ONLY_SERRA)).text();
  assert.equal(off, '/* use-origens widget disabled */');
  const dry = await (await get('dry-run', '/__origens/loader.js', {}, ONLY_SERRA)).text();
  assert.equal(dry, '/* use-origens widget disabled */');
});

test('allowlist: health reports mode and list status without paths', async () => {
  const body = await (await get('true', '/__origens/health', {}, SERRA + ',' + OUTRO)).json();
  assert.equal(body.widget_mode, 'true');
  assert.equal(body.allowlist_status, 'ok');
  assert.equal(body.allowlist_size, 2);
  assert.doesNotMatch(JSON.stringify(body), /usesul\/product/);
  const bad = await (await get('true', '/__origens/health', {}, '*')).json();
  assert.equal(bad.allowlist_status, 'invalid');
  assert.equal(bad.allowlist_size, 0);
});

test('encoded body: logs a safe technical note and passes the page through unchanged', async () => {
  origin.respond = () => htmlResponse(gzipSync(PAGE), { 'content-encoding': 'gzip' });
  const res = await get('true', SERRA + '?token=SEGREDO123', { headers: { cookie: 'sessao=COOKIE_SECRETO' } }, ONLY_SERRA);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(!bytes.toString('latin1').includes('data-use-origens-widget'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const out = logs.join('');
  assert.match(out, /use-origens\.skip-encoded-body/);
  assert.match(out, /"encoding":"gzip"/);
  for (const secret of ['token', 'SEGREDO123', 'COOKIE_SECRETO']) assert.ok(!out.includes(secret), secret);
});

test('end to end: HTML from workerd + loader from workerd, executed in jsdom, mounts once only where allowed', async () => {
  const both = SERRA;
  async function visit(path) {
    const html = await (await get('true', path, {}, both)).text();
    const loaderJs = await (await get('true', '/__origens/loader.js', {}, both)).text();
    const dom = new JSDOM(html, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    const scriptTags = dom.window.document.querySelectorAll('script[data-use-origens-widget]').length;
    if (scriptTags > 0) { dom.window.eval(loaderJs); dom.window.eval(loaderJs); }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { scriptTags, links: dom.window.document.querySelectorAll('#use-origens-return-link').length };
  }
  assert.deepEqual(await visit(SERRA), { scriptTags: 1, links: 1 });
  assert.deepEqual(await visit(OUTRO), { scriptTags: 0, links: 0 });
});
