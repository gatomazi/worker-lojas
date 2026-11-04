import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { buscaImage, buscaLink, buscaQueryKey, normalizeBusca } from '../src/busca-gateway.js';
import { STORES, withInkDomain } from '../src/stores.js';

// Gateway das sugestões da busca do cabeçalho (/__origens/busca -> /api/busca do storefront) no workerd REAL. O storefront é um stub (outboundService).
const HOST = 'https://www.usesul.com.br';
const SF = 'https://useorigens.com.br';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const item = (over = {}) => ({ key: 'k', kind: 'locality', region: 'sul', title: 'Pelotas', subtitle: 'Rio Grande do Sul · Sudeste Rio-grandense', tag: 'Cidade', href: '/sul/rs/pelotas', city: 'Pelotas', uf: 'RS', ...over });
// O formato real do storefront (campos a mais: key, city, uf, minPrice, inkProductId, umaPenca… o gateway repassa só o necessário).
const GOOD = {
  query: 'pelotas', region: 'sul', total: 4,
  groups: [
    { group: 'places', total: 1, items: [item()] },
    { group: 'designs', total: 9, items: [
      item({ kind: 'design', title: 'Pelotas · Território', subtitle: 'R$ 109,90', tag: 'Estampa', href: 'https://www.usesul.com.br/usesul/product/pelotas-territorio', external: true, image: IMG, inkProductId: '1', minPrice: 109.9 }),
      item({ kind: 'design', title: 'Pelotas · Caneca', subtitle: 'R$ 72,90', tag: 'Caneca', href: 'https://artigos.useorigens.com.br/caneca/la-de-pelotas-rs-446524.html', external: true, image: 'https://umapenca.imgix.net/446524/x.jpg?auto=compress', umaPenca: { id: '446524', kind: 'caneca' } }),
      item({ kind: 'design', title: 'Fora', href: 'https://evil.example/x' })
    ] },
    { group: 'editorial', total: 1, items: [item({ kind: 'page', title: 'Black Week', tag: 'Página', href: '/sul/p/black-week', image: '/media/93846b3e47e5a3f39ea4d8a.jpg' })] }
  ],
  others: [item({ region: 'norte', title: 'Pelotas do Norte', href: '/norte/pa/x' })]
};
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
        calls.push({ host: url.host, path: url.pathname, search: url.search, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization') });
        if (url.host === 'useorigens.com.br') return storefront(request);
        return new Response(inkPage, { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const ON = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: 'return-link,header-nav' };
const get = async (bindings, path, init = {}) => { const mf = await worker(bindings); calls.length = 0; return mf.dispatchFetch(HOST + path, init); };

test('gateway: the storefront search for the store region and the normalized text only, without the visitor headers; each result by destination class; cacheable 60 s', async () => {
  const res = await get(ON, '/__origens/busca?q=%20%20Pelotas%20%20&region=norte&url=https://evil.example', { headers: { cookie: 'session=secret', authorization: 'Bearer x' } });
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].host, calls[0].path, calls[0].search, calls[0].method], ['useorigens.com.br', '/api/busca', '?region=sul&q=pelotas', 'GET']);
  assert.equal(calls[0].cookie, null); assert.equal(calls[0].authorization, null);
  const body = await res.json();
  assert.deepEqual(body.groups.map((g) => [g.group, g.total, g.items.map((i) => [i.title, i.href, i.dest])]), [
    ['places', 1, [['Pelotas', SF + '/sul/rs/pelotas', 'site']]],
    ['designs', 9, [['Pelotas · Território', 'https://www.usesul.com.br/usesul/product/pelotas-territorio', 'ink'], ['Pelotas · Caneca', 'https://artigos.useorigens.com.br/caneca/la-de-pelotas-rs-446524.html', 'external']]],
    ['editorial', 1, [['Black Week', SF + '/sul/p/black-week', 'site']]]
  ]);
  assert.equal(body.groups[2].items[0].image, SF + '/media/93846b3e47e5a3f39ea4d8a.jpg');
  assert.deepEqual(Object.keys(body.groups[1].items[0]).sort(), ['dest', 'href', 'image', 'kind', 'region', 'subtitle', 'tag', 'title'], 'only public display fields');
  assert.deepEqual(body.others.map((i) => [i.title, i.href, i.region]), [['Pelotas do Norte', SF + '/norte/pa/x', 'norte']], 'other regions are kept');
});

test('gateway: an empty query is refused without calling the storefront; POST is refused; an upstream failure or an unknown shape answers 503 no-store', async () => {
  for (const q of ['', '?q=', '?q=%20%20']) {
    const res = await get(ON, '/__origens/busca' + q);
    assert.equal(res.status, 400); assert.equal(calls.length, 0);
  }
  assert.equal((await get(ON, '/__origens/busca?q=a', { method: 'POST', body: '{}' })).status, 405);
  const ok = (body) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  for (const impl of [() => new Response('boom', { status: 500 }), () => new Response('<html>', { headers: { 'content-type': 'text/html' } }), ok({ groups: 'x' }), ok({ groups: [{ group: 'evil', items: [] }] }), () => { throw new Error('network'); }]) {
    storefront = impl;
    const res = await get(ON, '/__origens/busca?q=pel');
    assert.equal(res.status, 503); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.deepEqual(await res.json(), { error: 'unavailable' });
  }
  storefront = () => new Response(JSON.stringify(GOOD), { headers: { 'content-type': 'application/json' } });
});

test('gateway: only with ENABLE_WIDGET=true AND the header-nav feature; otherwise the INK answers (no storefront call)', async () => {
  for (const bindings of [{ ...ON, ENABLE_WIDGET: 'false' }, { ...ON, WIDGET_FEATURES: 'return-link' }]) {
    const res = await get(bindings, '/__origens/busca?q=pel');
    assert.equal(await res.text(), inkPage);
    assert.ok(calls.every((c) => c.host !== 'useorigens.com.br'));
  }
});

test('buscaLink / buscaImage / buscaQueryKey: destination classes, nothing else', () => {
  const store = STORES.sul;
  assert.deepEqual(buscaLink('/sul/rs/pelotas', store), { href: SF + '/sul/rs/pelotas', dest: 'site' });
  assert.deepEqual(buscaLink('https://www.useorigens.com.br/norte/x#y', store), { href: SF + '/norte/x#y', dest: 'site' });
  assert.deepEqual(buscaLink('https://www.usesul.com.br/usesul/product/x', store), { href: 'https://www.usesul.com.br/usesul/product/x', dest: 'ink' });
  assert.equal(buscaLink('https://www.usesul.com.br/outra/product/x', store), null, 'the INK host outside the store base');
  // The single store on its new domain (production: SINGLE_STORE_DOMAIN=next): the storefront links loja.useorigens.com.br/useorigens; the old domain still passes.
  const moved = withInkDomain(store, 'next').store;
  assert.deepEqual(buscaLink('https://loja.useorigens.com.br/useorigens/product/x', moved), { href: 'https://loja.useorigens.com.br/useorigens/product/x', dest: 'ink' });
  assert.equal(buscaLink('https://www.usesul.com.br/usesul/product/x', moved).dest, 'ink');
  assert.equal(buscaLink('https://loja.useorigens.com.br/useorigens/product/x', store), null, 'not this store\'s INK before the move');
  assert.equal(buscaLink('https://artigos.useorigens.com.br/caneca/x.html', store).dest, 'external');
  for (const bad of ['//evil.example/x', 'javascript:alert(1)', 'http://useorigens.com.br/sul', 'https://user:pw@useorigens.com.br/sul', 'https://evil.example/sul', '/sul\\x', '/sul x', 42]) assert.equal(buscaLink(bad, store), null, String(bad));
  assert.equal(buscaImage('/media/x.jpg', store), SF + '/media/x.jpg');
  assert.equal(buscaImage(IMG, store), IMG);
  for (const bad of ['https://evil.example/x.jpg', 'http://umapenca.imgix.net/x.jpg', '//umapenca.imgix.net/x.jpg', '/media/x".jpg']) assert.equal(buscaImage(bad, store), null, bad);
  assert.equal(buscaQueryKey('  São   PAULO '), 'são paulo');
  assert.equal(buscaQueryKey('x'.repeat(200)).length, 80);
  assert.equal(buscaQueryKey('   '), null); assert.equal(buscaQueryKey(null), null); assert.equal(buscaQueryKey('a\u0000b'), null);
  assert.equal(normalizeBusca({ groups: [{ group: 'places', items: [] }] }, store).groups.length, 0, 'an empty group is dropped');
  assert.equal(normalizeBusca({ groups: [{ group: 'places', items: [] }, { group: 'places', items: [] }] }, store), null, 'a repeated group');
});
