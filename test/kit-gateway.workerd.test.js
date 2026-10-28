import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { normalizeKit } from '../src/kit-gateway.js';
import { STORES, storeView } from '../src/stores.js';
import { parseFeatures, FEATURE_NAMES } from '../src/features.js';

// Gateway do "Monte seu kit" no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const KIT = { id: 501, code: 'KITTESTE', auto: false, kind: 'value', tiers: [{ items: 3, discount: 25 }, { items: 4, discount: 40 }], eyebrow: 'Economize montando seu kit', title: 'Monte seu kit e pague menos', lead: 'Você pode combinar produtos participantes.' };
const GOOD = { v: 1, region: 'sul', kit: KIT };
const calls = [];
let storefront = () => Response.json(GOOD);
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

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,post-add-kit' };
const get = async (bindings, init = {}, path = '/__origens/kit') => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(HOST + path, init); };
const reset = () => { storefront = () => Response.json(GOOD); };

test('gateway: the v1 kit as the storefront publishes it (INK\'s tiers); 60 s cache; FIXED storefront URL; no visitor headers', async () => {
  reset();
  const res = await get(ON, { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.deepEqual(await res.json(), { v: 1, kit: KIT });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].host, calls[0].path, calls[0].method], ['useorigens.com.br', '/api/post-add-kit/sul', 'GET']);
  assert.equal(calls[0].cookie, null); assert.equal(calls[0].authorization, null);
});

test('gateway: HEAD without a body; POST refused; the visitor cannot choose a URL; `kit: null` is a valid answer (nothing to show)', async () => {
  reset();
  const head = await get(ON, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await get(ON, { method: 'POST', body: '{}' })).status, 405);
  await get(ON, {}, '/__origens/kit?url=https://evil.example/x');
  assert.ok(calls.every((c) => c.host === 'useorigens.com.br' && c.path === '/api/post-add-kit/sul'));
  storefront = () => Response.json({ v: 1, region: 'sul', kit: null });
  assert.deepEqual(await (await get(ON)).json(), { v: 1, kit: null });
  storefront = () => Response.json({ ...GOOD, kit: { ...KIT, kind: 'percentage', tiers: [{ items: 15, discount: 20 }], endsAt: '2099-12-01T03:00:00.000Z' } });
  assert.deepEqual((await (await get(ON)).json()).kit.tiers, [{ items: 15, discount: 20 }]);
  reset();
});

test('gateway fail-closed: invalid JSON, wrong schema, another region, bad tiers, markup, HTML, 5xx, redirect or too large => 503 JSON', async () => {
  const cases = [
    () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ ...GOOD, v: 2 }),
    () => Response.json({ ...GOOD, region: 'norte' }),
    () => Response.json({ v: 1, region: 'sul' }),
    () => Response.json({ ...GOOD, kit: { ...KIT, code: 'KIT TESTE' } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, kind: 'free' } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, auto: 'no' } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [{ items: 4, discount: 40 }, { items: 3, discount: 25 }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [{ items: 1, discount: 10 }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [{ items: 3, discount: -5 }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [{ items: 3, discount: '25' }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: [{ items: 3, discount: 25, extra: 1 }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, kind: 'percentage', tiers: [{ items: 3, discount: 100 }] } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, tiers: Array.from({ length: 7 }, (_, i) => ({ items: i + 2, discount: i + 1 })) } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, title: '<img src=x onerror=alert(1)>' } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, lead: 'x'.repeat(161) } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, eyebrow: undefined } }),
    () => Response.json({ ...GOOD, kit: { ...KIT, endsAt: 'amanhã' } }),
    () => new Response('<html>erro</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('oops', { status: 502 }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    () => new Response(JSON.stringify({ ...GOOD, pad: 'x'.repeat(9000) }), { headers: { 'content-type': 'application/json' } })
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

test('gateway only exists with ENABLE_WIDGET=true AND post-add-kit: otherwise the INK answers the path itself', async () => {
  reset();
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link,promo-fab' }]) {
    const res = await get(bindings);
    assert.equal(await res.text(), inkPage);
    assert.ok(calls.every((c) => c.host === 'www.usesul.com.br'), 'the storefront is not called');
  }
});

test('a promotion that already ended (cached upstream) means nothing to show; each region reads only its own kit; the feature list still fits', () => {
  assert.deepEqual(normalizeKit({ ...GOOD, kit: { ...KIT, endsAt: '2026-10-01T00:00:00-03:00' } }, STORES.sul, Date.parse('2026-10-27T12:00:00-03:00')), { v: 1, kit: null });
  for (const id of Object.keys(STORES)) assert.equal(STORES[id].kitApi, '/api/post-add-kit/' + STORES[id].region);
  // Loja única: a Sul vista por um visitante do Norte lê o kit do Norte.
  const norte = storeView(STORES.sul, 'norte');
  assert.equal(norte.kitApi, '/api/post-add-kit/norte');
  assert.equal(normalizeKit(GOOD, norte), null);
  // WIDGET_FEATURES com TODAS as chaves ainda cabe no teto de parseFeatures (acima dele a lista inteira cairia).
  assert.equal(parseFeatures(FEATURE_NAMES.join(',')).status, 'ok');
});
