import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { STORES } from '../src/stores.js';

// Coleções antigas da loja única, no workerd real: a sigla do estado e o modelo que a INK não tem mais (404) vão para a página equivalente
// no storefront (301); uma coleção que a INK tem segue normal, e nada disso vale com o Worker desligado.
const sul = STORES.sul;
const host = sul.nextInk.host;
const base = sul.nextInk.base;
const instances = [];
after(async () => { for (const mf of instances) await mf.dispose(); });
async function worker(extra = {}, existing = ['/collections/santa-catarina', '/collections/rs-novo']) {
  const seen = [];
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: [sul.kvBinding],
    bindings: { STORE_ID: 'sul', SINGLE_STORE_DOMAIN: 'next', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: 'return-link', ...extra },
    outboundService: async (request) => {
      const path = new URL(request.url).pathname;
      seen.push(request.method + ' ' + path);
      const found = !path.includes('/collections/') || existing.some((p) => path === base + p);
      return new Response(found ? '<!doctype html><html><head></head><body>INK</body></html>' : 'not found', { status: found ? 200 : 404, headers: { 'content-type': 'text/html' } });
    }
  });
  instances.push(mf);
  return { mf, seen };
}
const go = (mf, path, method = 'GET') => mf.dispatchFetch('https://' + host + base + path, { method, redirect: 'manual' });

test('a state by its old code goes to its state page in its region, permanently, keeping the campaign', async () => {
  const { mf } = await worker();
  const rs = await go(mf, '/collections/rs?utm_source=google&variant=9');
  assert.equal(rs.status, 301);
  assert.equal(rs.headers.get('location'), sul.storefront + '/sul/rs?utm_source=google');
  const am = await go(mf, '/collections/am/');
  assert.equal(am.status, 301);
  assert.equal(am.headers.get('location'), sul.storefront + '/norte/am');
  const df = await go(mf, '/collections/df', 'HEAD');
  assert.equal(df.status, 301);
  assert.equal(df.headers.get('location'), sul.storefront + '/centro-oeste/df');
});

test('an old design collection goes to the storefront search for that design', async () => {
  const { mf } = await worker();
  for (const [slug, name] of [['territorio', 'Território'], ['ponto-origem', 'Ponto de Origem'], ['traco', 'Traço'], ['gentilico', 'Gentílico']]) {
    const res = await go(mf, '/collections/' + slug);
    assert.equal(res.status, 301, slug);
    const target = new URL(res.headers.get('location'));
    assert.equal(target.origin + target.pathname, sul.storefront + '/sul/busca');
    assert.equal(target.searchParams.get('q'), name);
  }
});

test('a collection the store has, a slug outside the map and the kill switch reach the store as before', async () => {
  const { mf, seen } = await worker({}, ['/collections/sc']);
  const sc = await go(mf, '/collections/sc');
  assert.equal(sc.status, 200);
  assert.equal(await sc.text().then((t) => t.includes('INK')), true);
  const other = await go(mf, '/collections/nao-existe');
  assert.equal(other.status, 404);
  assert.equal(seen.includes('HEAD ' + base + '/collections/nao-existe'), false);

  const { mf: off } = await worker({ ENABLE_WIDGET: 'false' });
  assert.equal((await go(off, '/collections/rs')).status, 404);
});

test('orders, cart and products never go through it', async () => {
  const { mf, seen } = await worker();
  await go(mf, '/cart');
  await go(mf, '/product/camiseta-rs');
  assert.equal(seen.some((s) => s.startsWith('HEAD')), false);
});
