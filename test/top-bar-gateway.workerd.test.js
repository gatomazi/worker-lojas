import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { normalizeTopBar, storefrontPathOk } from '../src/top-bar-gateway.js';
import { STORES, storeView } from '../src/stores.js';

// Gateway da "Faixa do topo" no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const NATAL = { id: 'prazo-natal', text: 'Peça até 06/12 e receba a tempo do Natal · produção em 7 dias úteis', endsAt: '2099-12-07T00:00:00-03:00' };
const BF = { id: 'black-friday', text: 'Black Friday: faltam 2 dias', href: '/sul/h/black-friday', endsAt: '2099-12-01T00:00:00-03:00' };
const PARCELE = { id: 'parcele', text: 'Parcele em até 5x sem juros' };
const GOOD = { v: 1, region: 'sul', messages: [NATAL, BF, PARCELE] };
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

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,top-bar' };
const get = async (bindings, init = {}, path = '/__origens/top-bar') => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(HOST + path, init); };
const reset = () => { storefront = () => Response.json(GOOD); };

test('gateway: v1 messages, already filled in; the link becomes the storefront URL; 30 s cache; FIXED storefront URL; no visitor headers', async () => {
  reset();
  const res = await get(ON, { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
  assert.deepEqual(await res.json(), {
    v: 1,
    style: 'marquee',
    messages: [
      { id: 'prazo-natal', text: NATAL.text, endsAt: NATAL.endsAt },
      { id: 'black-friday', text: BF.text, href: 'https://useorigens.com.br/sul/h/black-friday', endsAt: BF.endsAt },
      { id: 'parcele', text: PARCELE.text }
    ]
  });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].host, calls[0].path, calls[0].method], ['useorigens.com.br', '/api/top-bar/sul', 'GET']);
  assert.equal(calls[0].cookie, null); assert.equal(calls[0].authorization, null);
});

test('gateway: HEAD without a body; POST refused; the visitor cannot choose a region or a URL; no message is a valid empty answer', async () => {
  reset();
  const head = await get(ON, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await get(ON, { method: 'POST', body: '{}' })).status, 405);
  await get(ON, {}, '/__origens/top-bar?region=norte&url=https://evil.example/x');
  assert.ok(calls.every((c) => c.host === 'useorigens.com.br' && c.path === '/api/top-bar/sul'));
  storefront = () => Response.json({ v: 1, region: 'sul', messages: [] });
  assert.deepEqual(await (await get(ON)).json(), { v: 1, style: 'marquee', messages: [] });
  storefront = () => Response.json({ ...GOOD, style: 'rotate' });
  assert.equal((await (await get(ON)).json()).style, 'rotate');
  reset();
});

test('gateway fail-open: invalid JSON, wrong schema, another region, markup, a link outside the region, HTML, 5xx, redirect or too large => 503 JSON', async () => {
  const cases = [
    () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ ...GOOD, v: 2 }),
    () => Response.json({ ...GOOD, region: 'norte' }),
    () => Response.json({ ...GOOD, style: 'blink' }),
    () => Response.json({ ...GOOD, messages: [{ ...PARCELE, text: '<img src=x onerror=alert(1)>' }] }),
    () => Response.json({ ...GOOD, messages: [{ ...PARCELE, text: 'x'.repeat(121) }] }),
    () => Response.json({ ...GOOD, messages: [{ ...BF, href: '/norte/h/black-friday' }] }),
    () => Response.json({ ...GOOD, messages: [{ ...BF, href: 'https://evil.example/sul' }] }),
    () => Response.json({ ...GOOD, messages: [{ ...BF, href: '/sul/../admin' }] }),
    () => Response.json({ ...GOOD, messages: [PARCELE, PARCELE] }),
    () => Response.json({ ...GOOD, messages: Array.from({ length: 11 }, (_, i) => ({ id: 'm' + i, text: 'oi' })) }),
    () => new Response('<html>erro</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('oops', { status: 502 }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    () => new Response(JSON.stringify({ ...GOOD, pad: 'x'.repeat(20000) }), { headers: { 'content-type': 'application/json' } })
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

test('gateway only exists with ENABLE_WIDGET=true AND top-bar: otherwise the INK answers the path itself', async () => {
  reset();
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, ENABLE_WIDGET: 'dry-run' }, { ...ON, WIDGET_FEATURES: 'return-link,promo-fab' }]) {
    const res = await get(bindings);
    assert.equal(await res.text(), inkPage);
    assert.ok(calls.every((c) => c.host === 'www.usesul.com.br'), 'the storefront is not called');
  }
});

test('a message that already ended (cached upstream) leaves the list without invalidating the others; each region reads only its own', () => {
  const now = Date.parse('2026-12-02T12:00:00-03:00');
  const out = normalizeTopBar({ v: 1, region: 'sul', messages: [{ ...BF, endsAt: '2026-12-01T00:00:00-03:00' }, PARCELE] }, STORES.sul, now);
  assert.deepEqual(out, { v: 1, style: 'marquee', messages: [{ id: 'parcele', text: PARCELE.text }] });
  for (const id of Object.keys(STORES)) assert.equal(STORES[id].topBarApi, '/api/top-bar/' + STORES[id].region);
  // Loja única: a Sul vista por um visitante do Norte lê a faixa do Norte e só aceita links do Norte.
  const norte = storeView(STORES.sul, 'norte');
  assert.equal(norte.topBarApi, '/api/top-bar/norte');
  assert.equal(normalizeTopBar(GOOD, norte, now), null);
  assert.ok(storefrontPathOk('/norte/h/natal', norte) && !storefrontPathOk('/sul/h/natal', norte));
  assert.ok(storefrontPathOk('/centro-oeste', STORES.centro ?? storeView(STORES.sul, 'centro-oeste')));
});
