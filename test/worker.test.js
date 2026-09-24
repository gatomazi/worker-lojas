import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/worker.js';
import { LOADER_SOURCE } from '../src/loader-source.js';

const host = 'https://www.usesul.com.br';
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
  const response = await worker.fetch(new Request(host + '/usesul/product/serra-catarinense'), { ENABLE_WIDGET: 'true' });
  const text = await response.text();
  assert.match(text, /src="\/__origens\/loader\.js\?v=2a\.1"/);
  assert.match(text, /data-cfasync="false"/);
  assert.equal(text.match(/data-use-origens-widget/g)?.length, 1);
  assert.equal(ctx.originCalls, 1);
});

test('asset is served directly at a path covered by the product route', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/__origens/loader.js'), { ENABLE_WIDGET: 'true' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /turbo:load/);
  assert.equal(ctx.originCalls, 0);
});

test('checkout and cart paths are forwarded without rewriting', async () => {
  const ctx = mockEnvironment();
  for (const path of ['/usesul/cart', '/usesul/checkout', '/usesul/', '/usesul/api/v1/orders']) {
    const response = await worker.fetch(new Request(host + path), { ENABLE_WIDGET: 'true' });
    assert.equal(await response.text(), html);
  }
  assert.equal(ctx.originCalls, 4);
});

test('a POST to the product is forwarded intact', async () => {
  const ctx = mockEnvironment();
  const req = new Request(host + '/usesul/product/serra-catarinense', { method: 'POST', body: 'test' });
  const response = await worker.fetch(req, { ENABLE_WIDGET: 'true' });
  assert.equal(await response.text(), html);
  assert.equal(ctx.method, 'POST');
});

test('non-HTML product response is passed through', async () => {
  const ctx = mockEnvironment('{"ok":true}', 'application/json');
  const response = await worker.fetch(new Request(host + '/usesul/product/data'), { ENABLE_WIDGET: 'true' });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(ctx.originCalls, 1);
});
