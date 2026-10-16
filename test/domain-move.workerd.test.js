import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { STORES } from '../src/stores.js';

// Mudança de domínio da loja única no workerd real: com SINGLE_STORE_DOMAIN=next a Use Sul atende em loja.useorigens.com.br/useorigens, o domínio
// antigo redireciona com o caminho e TODOS os parâmetros (é a mesma loja), e as lojas antigas mandam direto para o domínio novo.
const sul = STORES.sul;
const NEW = 'https://loja.useorigens.com.br';
const INK_HTML = '<!doctype html><html><head><title>Produto</title></head><body><main><form id="form-product-1" class="form-product-options" action="/useorigens/cart?product_id=1" method="post"><button type="submit">Adicionar ao carrinho</button></form></main></body></html>';
const instances = [];
after(async () => { for (const mf of instances) await mf.dispose(); });
async function worker(bindings, kv = [sul.kvBinding]) {
  const seen = [];
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: kv,
    bindings: { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: 'return-link,header-nav', ...bindings },
    outboundService: async (request) => { seen.push(request.url); return new Response(INK_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
  });
  instances.push(mf);
  return { mf, seen };
}
const go = (mf, href, init = {}) => mf.dispatchFetch(href, { redirect: 'manual', ...init });

test('with SINGLE_STORE_DOMAIN=next, the old Sul host sends every path to the same place on the new domain, with all parameters and no INK call', async () => {
  const { mf, seen } = await worker({ STORE_ID: 'sul', SINGLE_STORE_DOMAIN: 'next', SERVE_REGIONS: 'sul,norte,centro-oeste' });
  const cases = [
    ['/usesul/product/acara-origem-pa-123?variant=99&utm_source=meta&coupon=X', NEW + '/useorigens/product/acara-origem-pa-123?variant=99&utm_source=meta&coupon=X'],
    ['/usesul', NEW + '/useorigens'],
    ['/usesul/', NEW + '/useorigens/'],
    ['/', NEW + '/useorigens'],
    ['/usesul/collections/fala-daqui', NEW + '/useorigens/collections/fala-daqui'],
    ['/usesul/orders/ABC123', NEW + '/useorigens/orders/ABC123'],
    ['/usesul/cart', NEW + '/useorigens/cart'],
    ['/checkout?step=2', NEW + '/checkout?step=2'],
    ['/usesul-outra', NEW + '/usesul-outra']
  ];
  for (const [path, location] of cases) {
    const res = await go(mf, 'https://' + sul.inkHost + path);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), location, path);
  }
  assert.deepEqual(seen, [], 'the old domain never reaches INK');
  // A região que estava no cookie do domínio antigo vai como parâmetro; a do link vence; a da própria loja não precisa ir.
  assert.equal((await go(mf, 'https://' + sul.inkHost + '/usesul/product/x', { headers: { cookie: 'origens_r=norte' } })).headers.get('location'), NEW + '/useorigens/product/x?origens_r=norte');
  assert.equal((await go(mf, 'https://' + sul.inkHost + '/usesul/product/x?origens_r=centro-oeste', { headers: { cookie: 'origens_r=norte' } })).headers.get('location'), NEW + '/useorigens/product/x?origens_r=centro-oeste');
  assert.equal((await go(mf, 'https://' + sul.inkHost + '/usesul/product/x', { headers: { cookie: 'origens_r=sul' } })).headers.get('location'), NEW + '/useorigens/product/x');
  // POST mantém o método (307).
  assert.equal((await go(mf, 'https://' + sul.inkHost + '/usesul/cart?product_id=1', { method: 'POST', body: 'a=1' })).status, 307);
  // O health continua respondendo no domínio antigo (para conferir o deploy).
  const health = await (await mf.dispatchFetch('https://' + sul.inkHost + '/__origens/health')).json();
  assert.equal(health.ink_host, 'loja.useorigens.com.br');
  assert.equal(health.former_ink_host, 'www.usesul.com.br');
  assert.equal(health.ink_domain_status, 'ok');
});

test('on the new domain the Sul Worker works as before, with the new prefix', async () => {
  const { mf, seen } = await worker({ STORE_ID: 'sul', SINGLE_STORE_DOMAIN: 'next' });
  const res = await mf.dispatchFetch(NEW + '/useorigens/product/belem-territorio-pa');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /\/__origens\/loader\.js\?/, 'the loader is injected on the new domain');
  assert.equal(seen[0], NEW + '/useorigens/product/belem-territorio-pa');
  const src = /src="(\/__origens\/loader\.js\?[^"]+)"/.exec(html)[1];
  assert.match(await (await mf.dispatchFetch(NEW + src)).text(), /"inkHost":"loja\.useorigens\.com\.br","inkBase":"\/useorigens"/);
  // O caminho antigo no host novo não é página de produto: só repassa.
  const old = await mf.dispatchFetch(NEW + '/usesul/product/belem-territorio-pa');
  assert.doesNotMatch(await old.text(), /__origens\/loader/);
  assert.equal(seen.at(-1), NEW + '/usesul/product/belem-territorio-pa');
});

test('a permanent move is 301/308; without SINGLE_STORE_DOMAIN (today) or with an unknown value nothing changes', async () => {
  const { mf: permanent } = await worker({ STORE_ID: 'sul', SINGLE_STORE_DOMAIN: 'next', DOMAIN_MOVE_STATUS: '301' });
  assert.equal((await go(permanent, 'https://' + sul.inkHost + '/usesul/product/x')).status, 301);
  assert.equal((await go(permanent, 'https://' + sul.inkHost + '/usesul/cart', { method: 'POST', body: 'a=1' })).status, 308);
  for (const value of [undefined, 'current', 'proxima']) {
    const { mf } = await worker({ STORE_ID: 'sul', ...(value ? { SINGLE_STORE_DOMAIN: value } : {}) });
    const res = await go(mf, 'https://' + sul.inkHost + '/usesul/product/belem-territorio-pa');
    assert.equal(res.status, 200, String(value));
    const health = await (await mf.dispatchFetch('https://' + sul.inkHost + '/__origens/health')).json();
    assert.equal(health.ink_host, 'www.usesul.com.br');
    assert.equal(health.ink_domain_status, value === 'proxima' ? 'invalid' : value ? 'ok' : 'default');
  }
});

test('the old Norte store sends a mapped product straight to the new domain when SINGLE_STORE_DOMAIN=next', async () => {
  const norte = STORES.norte;
  const { mf } = await worker({ STORE_ID: 'norte', LEGACY_REDIRECT: 'on', SINGLE_STORE_DOMAIN: 'next' }, [norte.kvBinding, 'LEGACY_MAP']);
  await (await mf.getKVNamespace('LEGACY_MAP')).put('acara-origem-pa-51b9a32f', 'acara-origem-pa-novo-123');
  const res = await go(mf, 'https://' + norte.inkHost + norte.inkBase + '/product/acara-origem-pa-51b9a32f?utm_source=meta');
  assert.equal(res.headers.get('location'), NEW + '/useorigens/product/acara-origem-pa-novo-123?origens_r=norte&utm_source=meta');
  // A loja antiga continua no domínio dela (SINGLE_STORE_DOMAIN não a move).
  assert.equal((await (await mf.dispatchFetch('https://' + norte.inkHost + '/__origens/health')).json()).ink_host, norte.inkHost);
});
