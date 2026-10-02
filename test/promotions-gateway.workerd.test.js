import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { createPromotionsGateway, normalizePromotions } from '../src/promotions-gateway.js';
import { STORES } from '../src/stores.js';

// Gateway dos cupons e promoções no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const LEVE = { id: 'leve-mais', type: 'coupon', title: 'LEVE MAIS', code: 'LEVEMAIS', description: '3 peças: R$ 30 OFF · 4 peças: R$ 50 OFF · 5 ou mais: R$ 75 OFF', callout: 'Um cupom por pedido.', order: 1 };
const PRIMEIRA = { id: 'primeira-compra', type: 'coupon', title: 'PRIMEIRA COMPRA', code: 'PRIMEIRA5', description: '5% OFF na sua primeira compra', order: 2 };
const FRETE = { id: 'frete-gratis', type: 'promotion', title: 'Semana do Frete Grátis', description: '1 peça RJ ou 2 peças demais estados', callout: 'Com limite de R$ 29,90 por frete', order: 3 };
const GOOD = { v: 1, region: 'sul', theme: { primary: '#4D543D', onPrimary: '#ffffff' }, items: [LEVE, PRIMEIRA, FRETE] };
const calls = [];
let storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
const inkPage = '<!doctype html><html><head></head><body>INK</body></html>';

const instances = new Map();
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization') });
        if (url.host === 'useorigens.com.br') return storefront(request);
        return new Response(inkPage, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,promo-fab' };
const get = async (bindings, init = {}, host = HOST) => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(host + '/__origens/promotions', init); };
const reset = () => { storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } }); };

test('gateway: v1 payload with callout, without callout and an announcement; only display fields; 30 s cache; FIXED storefront URL; no visitor headers', async () => {
  reset();
  const res = await get(ON, { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  assert.deepEqual(await res.json(), {
    v: 1,
    items: [
      { id: 'leve-mais', type: 'coupon', title: 'LEVE MAIS', description: LEVE.description, order: 1, code: 'LEVEMAIS', callout: 'Um cupom por pedido.' },
      { id: 'primeira-compra', type: 'coupon', title: 'PRIMEIRA COMPRA', description: PRIMEIRA.description, order: 2, code: 'PRIMEIRA5' },
      { id: 'frete-gratis', type: 'promotion', title: 'Semana do Frete Grátis', description: FRETE.description, order: 3, callout: 'Com limite de R$ 29,90 por frete' }
    ],
    theme: { primary: '#4d543d', onPrimary: '#ffffff' }
  });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].host, calls[0].path, calls[0].method], ['useorigens.com.br', '/api/promotions/sul', 'GET']);
  assert.equal(calls[0].cookie, null); assert.equal(calls[0].authorization, null);
});

test('gateway: HEAD without a body; POST refused; the visitor cannot choose a region or a URL', async () => {
  reset();
  const head = await get(ON, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await get(ON, { method: 'POST', body: '{}' })).status, 405);
  const mf = await worker(ON); calls.length = 0;
  await mf.dispatchFetch(HOST + '/__origens/promotions?region=norte&url=https://evil.example/x');
  assert.ok(calls.every((c) => c.host === 'useorigens.com.br' && c.path === '/api/promotions/sul'));
});

test('gateway: zero items is a valid, empty answer (the client then draws nothing)', async () => {
  storefront = () => Response.json({ v: 1, region: 'sul', items: [] });
  const res = await get(ON);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { v: 1, items: [] });
  reset();
});

test('gateway fail-open: invalid JSON, wrong schema, another region, HTML, 5xx, redirect, too large or a timeout => 503 JSON, never the upstream body', async () => {
  const cases = [
    () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ ...GOOD, v: 2 }),
    () => Response.json({ ...GOOD, region: 'norte' }),
    () => Response.json({ ...GOOD, items: [{ ...LEVE, code: 'LEVE MAIS' }] }),
    () => Response.json({ ...GOOD, items: [{ ...FRETE, code: 'FRETE' }] }),
    () => Response.json({ ...GOOD, items: [{ ...LEVE, title: '<img src=x onerror=alert(1)>' }] }),
    () => Response.json({ ...GOOD, items: [LEVE, LEVE] }),
    () => Response.json({ ...GOOD, theme: { primary: 'red', onPrimary: '#fff' } }),
    () => new Response('<html>erro</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('oops', { status: 502 }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    () => new Response(JSON.stringify({ ...GOOD, pad: 'x'.repeat(40000) }), { headers: { 'content-type': 'application/json' } })
  ];
  for (const make of cases) {
    storefront = make;
    const res = await get(ON);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
  reset();
});

test('gateway: storefront down (network error) => 503; nothing else of the INK is affected', async () => {
  storefront = () => { throw new Error('connection refused'); };
  assert.equal((await get(ON)).status, 503);
  const mf = await worker(ON); calls.length = 0;
  const page = await mf.dispatchFetch(HOST + '/usesul/collections/novidades');
  assert.equal(page.status, 200); assert.equal(await page.text(), inkPage);
  reset();
});

test('gateway only exists with ENABLE_WIDGET=true AND promo-fab: otherwise the INK answers the path itself', async () => {
  reset();
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link,header-nav' }]) {
    const res = await get(bindings);
    assert.equal(await res.text(), inkPage);
    assert.ok(calls.every((c) => c.host === 'www.usesul.com.br'), 'the storefront is not called');
  }
});

test('regional isolation: each store Worker reads ONLY its own region and refuses another region\'s payload', async () => {
  for (const [id, host] of [['norte', 'https://www.usenorte.com.br'], ['centro', 'https://www.usecentro.com.br']]) {
    const store = STORES[id];
    storefront = (request) => Response.json({ v: 1, region: new URL(request.url).pathname.split('/').pop(), items: [{ ...LEVE, code: id.toUpperCase() + '10' }] });
    const bindings = { ...ON, STORE_ID: id, WIDGET_ALLOWLIST: store.inkBase + '/product/x' };
    const res = await get(bindings, {}, host);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).items[0].code, id.toUpperCase() + '10');
    assert.deepEqual(calls.filter((c) => c.host === 'useorigens.com.br').map((c) => c.path), ['/api/promotions/' + store.region]);
    // The Sul payload never passes on another store's Worker.
    storefront = () => Response.json(GOOD);
    assert.equal((await get(bindings, {}, host)).status, 503);
  }
  reset();
});

test('normalizePromotions: callout string/null/absent, expired items dropped, order renumbered, unknown extras ignored', () => {
  const now = Date.parse('2026-10-02T15:00:00-03:00');
  const out = normalizePromotions({ v: 1, region: 'sul', items: [
    { ...LEVE, callout: null, enabled: true, startsAt: 'x' },
    { ...PRIMEIRA, endsAt: '2026-10-01T00:00:00-03:00' },
    { ...FRETE, callout: '' },
    { ...PRIMEIRA, id: 'semana', endsAt: '2026-10-09T23:59:00-03:00' }
  ] }, STORES.sul, now);
  assert.deepEqual(out.items.map((i) => [i.id, i.order, i.callout]), [['leve-mais', 1, undefined], ['frete-gratis', 2, undefined], ['semana', 3, undefined]]);
  assert.equal(out.items[2].endsAt, '2026-10-09T23:59:00-03:00');
  assert.equal('enabled' in out.items[0], false);
  assert.equal(normalizePromotions({ v: 1, region: 'sul', items: new Array(21).fill(LEVE) }, STORES.sul), null);
  assert.equal(normalizePromotions(null, STORES.sul), null);
});

test('gateway timeout: a storefront that never answers is aborted after 3 s => 503 (the button simply does not appear)', async () => {
  let aborted = false;
  const gateway = createPromotionsGateway({ store: STORES.sul, upstream: (_request, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })) });
  const started = Date.now();
  const res = await gateway.handle(new Request(HOST + '/__origens/promotions'));
  assert.equal(res.status, 503);
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 4500, 'answers within the timeout budget');
});
