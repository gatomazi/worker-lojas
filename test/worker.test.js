import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/worker.js';
import { WIDGET_SOURCE } from '../src/widget-source.js';

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
    on(selector, handler) { this.selector = selector; this.handler = handler; return this; }
    async transform(response) {
      assert.equal(this.selector, 'head');
      let insert = '';
      this.handler.element({ append(s, opts) { assert.deepEqual(opts, { html: true }); insert += s; } });
      return new Response((await response.text()).replace('</head>', insert + '</head>'), {
        status: response.status,
        headers: response.headers
      });
    }
  };
  return { get originCalls() { return originCalls; }, get method() { return method; } };
}

test('widget JS parses and contains only the first POC behavior', () => {
  assert.doesNotThrow(() => new vm.Script(WIDGET_SOURCE));
  assert.match(WIDGET_SOURCE, /Voltar a procurar outra cidade/);
  assert.doesNotMatch(WIDGET_SOURCE, /fetch\(/); // nenhuma chamada de carrinho ou API
});

test('health is available before DNS cutover', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request('https://test.workers.dev/__health'), { WIDGET_ENABLED: 'false' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).widget_enabled, false);
  assert.equal(ctx.originCalls, 0);
});

test('disabled worker forwards product HTML unchanged', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/usesul/product/serra-catarinense'), { WIDGET_ENABLED: 'false' });
  assert.equal(await response.text(), html);
  assert.equal(ctx.originCalls, 1);
});

test('enabled worker injects loader only on product HTML', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/usesul/product/serra-catarinense'), { WIDGET_ENABLED: 'true' });
  const text = await response.text();
  assert.match(text, /src="\/usesul\/product\/__origens-widget\.js"/);
  assert.match(text, /data-cfasync="false"/);
  assert.equal(text.match(/data-use-origens-widget/g)?.length, 1);
  assert.equal(ctx.originCalls, 1);
});

test('asset is served directly at a path covered by the product route', async () => {
  const ctx = mockEnvironment();
  const response = await worker.fetch(new Request(host + '/usesul/product/__origens-widget.js'), { WIDGET_ENABLED: 'true' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /turbo:load/);
  assert.equal(ctx.originCalls, 0);
});

test('checkout and cart paths are forwarded without rewriting', async () => {
  const ctx = mockEnvironment();
  for (const path of ['/usesul/cart', '/usesul/checkout', '/usesul/', '/usesul/api/v1/orders']) {
    const response = await worker.fetch(new Request(host + path), { WIDGET_ENABLED: 'true' });
    assert.equal(await response.text(), html);
  }
  assert.equal(ctx.originCalls, 4);
});

test('a POST to the product is forwarded intact', async () => {
  const ctx = mockEnvironment();
  const req = new Request(host + '/usesul/product/serra-catarinense', { method: 'POST', body: 'test' });
  const response = await worker.fetch(req, { WIDGET_ENABLED: 'true' });
  assert.equal(await response.text(), html);
  assert.equal(ctx.method, 'POST');
});

test('non-HTML product response is passed through', async () => {
  const ctx = mockEnvironment('{"ok":true}', 'application/json');
  const response = await worker.fetch(new Request(host + '/usesul/product/data'), { WIDGET_ENABLED: 'true' });
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(ctx.originCalls, 1);
});
