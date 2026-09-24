import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/worker.js';
import { LOADER_SOURCE, LOADER_VERSION } from '../src/loader-source.js';

const host = 'https://www.usesul.com.br';
// Fail-closed: 'true' só injeta em caminhos da allowlist. Estes slugs cobrem os cenários abaixo.
const ALLOW = ['serra-catarinense', 'data'].map((slug) => '/usesul/product/' + slug).join(',');
const html = '<!doctype html><html><head><title>INK</title></head><body><main><button>Adicionar ao Carrinho</button></main></body></html>';

function mockEnvironment(body = html, contentType = 'text/html; charset=utf-8') {
  let originCalls = 0;
  let method = null;
  globalThis.fetch = async request => {
    originCalls++;
    method = request.method;
    return new Response(body, { headers: { 'content-type': contentType } });
  };
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
    transform(response) {
      let text = null;
      const rewriter = this;
      const body = new ReadableStream({
        async start(controller) {
          text = await response.text();
          let insert = '';
          let onEnd = null;
          for (const { selector, handler } of rewriter.handlers) {
            if (selector === 'head') handler.element({ onEndTag(cb) { onEnd = cb; } });
            else if (selector.startsWith('script[data-use-origens-widget]') && text.includes('data-use-origens-widget')) handler.element({});
          }
          if (onEnd) onEnd({ before(s, opts) { assert.deepEqual(opts, { html: true }); insert += s; } });
          controller.enqueue(new TextEncoder().encode(text.replace('</head>', insert + '</head>')));
          controller.close();
        }
      });
      return new Response(body, { status: response.status, headers: response.headers });
    }
  };
  return { get originCalls() { return originCalls; }, get method() { return method; } };
}

test('widget JS parses and contains only the first POC behavior', () => {
  assert.doesNotThrow(() => new vm.Script(LOADER_SOURCE));
  assert.match(LOADER_SOURCE, /Voltar a procurar/);
  assert.doesNotMatch(LOADER_SOURCE, /fetch\(/); // nenhuma chamada de carrinho ou API
});

test('health is available before DNS cutover', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request('https://test.workers.dev/__origens/health'), { ENABLE_WIDGET: 'false' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).widget_mode, 'false');
  assert.equal(ctx.originCalls, 0);
});

test('disabled worker forwards product HTML unchanged', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/usesul/product/serra-catarinense'), { ENABLE_WIDGET: 'false' });
  assert.equal(await response.text(), html);
  assert.equal(ctx.originCalls, 1);
});

test('enabled worker injects loader only on product HTML', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/usesul/product/serra-catarinense'), { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW });
  const text = await response.text();
  assert.ok(text.includes('src="/__origens/loader.js?v=' + LOADER_VERSION + '"'));
  assert.match(text, /data-cfasync="false"/);
  assert.equal(text.match(/data-use-origens-widget/g)?.length, 1);
  assert.equal(ctx.originCalls, 1);
});

test('asset is served directly at a path covered by the product route', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/__origens/loader.js'), { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /turbo:load/);
  assert.equal(ctx.originCalls, 0);
});

test('checkout and cart paths are forwarded without rewriting', async () => {
  const ctx = mockEnvironment();
  for (const path of ['/usesul/cart', '/usesul/checkout', '/usesul/', '/usesul/api/v1/orders']) {
    const response = await worker.fetch(new Request(host + path), { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW });
    assert.equal(await response.text(), html);
  }
  assert.equal(ctx.originCalls, 4);
});

test('a POST to the product is forwarded intact', async () => {
  const ctx = mockEnvironment();
  const req = new Request(host + '/usesul/product/serra-catarinense', { method: 'POST', body: 'test' });
  const response = await worker.fetch(req, { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW });
  assert.equal(await response.text(), html);
  assert.equal(ctx.method, 'POST');
});

test('non-HTML product response is passed through', async () => {
  const ctx = mockEnvironment('{"ok":true}', 'application/json');
  const response = await worker.fetch(new Request(host + '/usesul/product/data'), { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(ctx.originCalls, 1);
});

// ---- WIDGET_ALLOWLIST (fail-closed)
const SERRA = host + '/usesul/product/serra-catarinense';

async function bodyFor(url, env) {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(url), env);
  return { text: await response.text(), ctx };
}

test('given true with an empty, missing or malformed allowlist, then nothing is injected', async () => {
  for (const allow of [undefined, '', '   ', '/usesul/product/*', '/usesul/product/serra-catarinense,,x']) {
    const { text, ctx } = await bodyFor(SERRA, { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: allow });
    assert.equal(text, html, JSON.stringify(allow));
    assert.equal(ctx.originCalls, 1);
  }
});

test('given true, then only allowlisted product paths are injected', async () => {
  const env = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' };
  assert.match((await bodyFor(SERRA, env)).text, /data-use-origens-widget/);
  assert.equal((await bodyFor(host + '/usesul/product/outro', env)).text, html);
});

test('given true and a query string, then matching uses the path only', async () => {
  const env = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' };
  assert.match((await bodyFor(SERRA + '?utm_source=x', env)).text, /data-use-origens-widget/);
  assert.equal((await bodyFor(host + '/usesul/product/outro?x=/usesul/product/serra-catarinense', env)).text, html);
});

test('given false, then an allowlisted path is not injected', async () => {
  const { text } = await bodyFor(SERRA, { ENABLE_WIDGET: 'false', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' });
  assert.equal(text, html);
});

test('given an unknown flag value, then it disables injection', async () => {
  for (const flag of ['TRUE ', 'yes', '1', 'on', '']) {
    const { text } = await bodyFor(SERRA, { ENABLE_WIDGET: flag, WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' });
    assert.equal(text, html, flag);
  }
});

test('given dry-run, then HTML is untouched and a safe log line is written', async () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    const { text } = await bodyFor(SERRA + '?email=a@b.c&token=zzz',
      { ENABLE_WIDGET: 'dry-run', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense' });
    assert.equal(text, html);
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(entry, { event: 'use-origens.dry-run', path: '/usesul/product/serra-catarinense', allowlisted: true, would_inject: true, allowlist_status: 'ok' });
  assert.doesNotMatch(lines[0], /email|token|zzz/);
});

test('given health, then it reports the allowlist status without exposing paths', async () => {
  mockEnvironment();
  const response = await worker.fetch(new Request('https://x.workers.dev/__origens/health'), { ENABLE_WIDGET: 'false', WIDGET_ALLOWLIST: '/usesul/product/a,/usesul/product/b' });
  const body = await response.json();
  assert.equal(body.allowlist_status, 'ok');
  assert.equal(body.allowlist_size, 2);
  assert.doesNotMatch(JSON.stringify(body), /usesul\/product/);
});
