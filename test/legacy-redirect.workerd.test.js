import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { STORES } from '../src/stores.js';

// Lojas antigas depois da loja única, no workerd real: com LEGACY_REDIRECT=on, produto vai para o mesmo produto na usesul (mapa no KV
// LEGACY_MAP) com a região de origem; home/listagens/coleções vão para a região no storefront; pedidos e o resto seguem para a INK.
const norte = STORES.norte;
const instances = [];
after(async () => { for (const mf of instances) await mf.dispose(); });
async function worker(extra = {}, map = { 'acara-origem-pa-51b9a32f': 'acara-origem-pa-novo-123' }) {
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: [norte.kvBinding, 'LEGACY_MAP'],
    bindings: { STORE_ID: 'norte', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: 'return-link', ...extra },
    outboundService: async () => new Response('<!doctype html><html><head></head><body>INK</body></html>', { headers: { 'content-type': 'text/html' } })
  });
  instances.push(mf);
  const kv = await mf.getKVNamespace('LEGACY_MAP');
  for (const [k, v] of Object.entries(map)) await kv.put(k, v);
  return mf;
}
const at = (path) => 'https://' + norte.inkHost + path;
const go = (mf, path) => mf.dispatchFetch(at(path), { redirect: 'manual' });

test('with LEGACY_REDIRECT=on, a mapped product goes to the same product in the single store, as Norte, with the campaign; 302 by default', async () => {
  const mf = await worker({ LEGACY_REDIRECT: 'on' });
  const res = await go(mf, norte.inkBase + '/product/acara-origem-pa-51b9a32f?utm_source=meta&fbclid=abc&variant=99');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://www.usesul.com.br/usesul/product/acara-origem-pa-novo-123?origens_r=norte&utm_source=meta&fbclid=abc');
  const health = await (await mf.dispatchFetch(at('/__origens/health'))).json();
  assert.equal(health.legacy_redirect, true);
  assert.equal(health.legacy_map_bound, true);
});

test('an unmapped product and the store pages go to the Norte home of the storefront; orders, cart and other paths stay on INK', async () => {
  const mf = await worker({ LEGACY_REDIRECT: 'on' });
  for (const path of [norte.inkBase + '/product/nao-existe', norte.inkBase, norte.inkBase + '/', norte.inkBase + '/products', norte.inkBase + '/collections/made-in-norte', norte.inkBase + '/about']) {
    const res = await go(mf, path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), 'https://useorigens.com.br/norte', path);
  }
  for (const path of [norte.inkBase + '/orders', norte.inkBase + '/orders/ABC123', norte.inkBase + '/cart', '/checkout']) {
    const res = await go(mf, path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('location'), null, path);
  }
});

test('LEGACY_REDIRECT_STATUS=301 makes it permanent; without LEGACY_REDIRECT nothing changes', async () => {
  const permanent = await worker({ LEGACY_REDIRECT: 'on', LEGACY_REDIRECT_STATUS: '301' });
  assert.equal((await go(permanent, norte.inkBase + '/product/acara-origem-pa-51b9a32f')).status, 301);
  const off = await worker();
  const res = await go(off, norte.inkBase + '/product/acara-origem-pa-51b9a32f');
  assert.equal(res.status, 200);
  assert.equal((await (await off.dispatchFetch(at('/__origens/health'))).json()).legacy_redirect, false);
});
