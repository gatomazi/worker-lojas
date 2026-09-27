import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScopeMode, isCatalogProductPath, inScope, CATALOG_MODE } from '../src/scope.js';
import { parseAllowlist } from '../src/allowlist.js';

test('scope mode is OFF by default and fails closed: only the exact value "product-catalog" widens the scope', () => {
  for (const raw of [undefined, null, '']) assert.deepEqual(parseScopeMode(raw), { mode: 'allowlist', status: 'default' });
  assert.deepEqual(parseScopeMode('allowlist'), { mode: 'allowlist', status: 'ok' });
  assert.deepEqual(parseScopeMode(' product-catalog '), { mode: CATALOG_MODE, status: 'ok' });
  for (const bad of ['Product-Catalog', 'product_catalog', 'all', '*', 'true', 'catalog', 'product-catalog,allowlist', 7, {}, true]) assert.deepEqual(parseScopeMode(bad), { mode: 'allowlist', status: 'invalid' }, String(bad));
});

test('catalog product path: canonical slugs only, no subpaths, traversal, placeholders, encodings or other routes', () => {
  const good = ['/usesul/product/serra-catarinense', '/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', '/usesul/product/bah-dizeres', '/usesul/product/a', '/usesul/product/9x', '/usesul/product/a_b-c', '/usesul/product/' + 'a'.repeat(128)];
  for (const p of good) assert.equal(isCatalogProductPath(p), true, p);
  const bad = ['/usesul', '/usesul/', '/usesul/products', '/usesul/product', '/usesul/product/', '/usesul/product//x', '/usesul/product/a/b', '/usesul/product/a/', '/usesul/product/UPPER', '/usesul/product/Serra', '/usesul/product/a b', '/usesul/product/%2e%2e', '/usesul/product/..', '/usesul/product/a%2fb', '/usesul/product/-x', '/usesul/product/_x', '/usesul/product/__origens', '/usesul/product/a.b', '/usesul/product/' + 'a'.repeat(129), '/usesul/cart', '/usesul/cart/item', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/admin/x', '/__origens/health', '/sul', '/product/x', '/usesul/product/x?y=1', '/usesul/product/x#z', '', null, undefined, 5];
  for (const p of bad) assert.equal(isCatalogProductPath(p), false, String(p));
});

test('inScope: allowlist mode = exact list only (five stay five); catalog mode = any canonical product path, independent of the list', () => {
  const five = parseAllowlist('/usesul/product/serra-catarinense,/usesul/product/paranaense-essencia');
  const allow = { mode: 'allowlist' }; const catalog = { mode: CATALOG_MODE };
  assert.equal(inScope(allow, five, '/usesul/product/serra-catarinense'), true);
  assert.equal(inScope(allow, five, '/usesul/product/qualquer-outro'), false);
  assert.equal(inScope(catalog, five, '/usesul/product/qualquer-outro'), true);
  assert.equal(inScope(catalog, { paths: [] }, '/usesul/product/qualquer-outro'), true);
  assert.equal(inScope(catalog, five, '/usesul/cart'), false); assert.equal(inScope(catalog, five, '/usesul/checkout/x'), false);
});

// ── falha ABERTA do Worker (Node não tem HTMLRewriter: a reescrita lança e a página original da INK precisa sair intacta) ──────────────────
import createDefault, { createWorker } from '../src/worker.js';
test('fail-open: if OUR rewrite throws, the original INK page is returned untouched (catalog and allowlist modes) — the purchase never depends on the widget', async () => {
  const html = '<!doctype html><html><head></head><body><form id="form-product-1"></form></body></html>';
  const upstream = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const worker = createWorker(upstream);
  for (const env of [{ ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/x', WIDGET_FEATURES: 'return-link', WIDGET_SCOPE_MODE: 'product-catalog' }, { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/x', WIDGET_FEATURES: 'return-link' }]) {
    const res = await worker.fetch(new Request('https://www.usesul.com.br/usesul/product/x'), env, { waitUntil() {} });
    assert.equal(res.status, 200); assert.equal(await res.text(), html);
  }
});

test('an unexpected error inside the cart-ref endpoints answers 503 JSON (never an unhandled exception page)', async () => {
  const worker = createWorker(async () => new Response('x'));
  const env = { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/x', WIDGET_FEATURES: 'cart-mirror', CART_REFS: { async put() { throw new Error('boom'); }, async get() { throw new Error('boom'); } } };
  const res = await worker.fetch(new Request('https://www.usesul.com.br/__origens/cart-ref/AbCdEfGhIjKlMnOpQrStUv'), env, { waitUntil() {} });
  assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'unavailable' });
  assert.equal(typeof createDefault.fetch, 'function');
});

// ── páginas de casca (shell): navbar em home, listagem, coleções, sobre e conta/pedidos; nunca login, carrinho ou checkout ─────────────────────────
import { shellPageKind, shellEnabled } from '../src/scope.js';
test('shellPageKind: exactly the non-transactional pages of the store; login, cart, checkout and everything else are never shell pages', () => {
  const kind = (p) => shellPageKind(p, '/usesul');
  assert.equal(kind('/usesul'), 'home'); assert.equal(kind('/usesul/'), 'home');
  assert.equal(kind('/usesul/products'), 'products'); assert.equal(kind('/usesul/products/'), 'products');
  assert.equal(kind('/usesul/collections/novidades'), 'collection'); assert.equal(kind('/usesul/collections/fala-daqui/'), 'collection');
  assert.equal(kind('/usesul/about'), 'about');
  assert.equal(kind('/usesul/orders'), 'orders');
  assert.equal(kind('/usesul/orders/123456'), 'order'); assert.equal(kind('/usesul/orders/trackings'), 'order'); assert.equal(kind('/usesul/orders/A1b2_c3-d4'), 'order');
  for (const bad of ['/usesul/store_sessions/new', '/usesul/store_sessions', '/usesul/cart', '/usesul/cart/checkout_cart_items', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details',
    '/usesul/product/serra-catarinense', '/usesul/orders/guest_reviews/new', '/usesul/orders/1/2', '/usesul/orders//', '/usesul/collections', '/usesul/collections/', '/usesul/collections/A', '/usesul/collections/a/b',
    '/usesul/collections/-x', '/usesul/aboutx', '/usesul/products/1', '/usesul//', '/usesulx', '/outra', '/', '', '/usesul/api/v1/orders', '/usesul/orders/%2e%2e', '/usesul/orders/a b', '/usesul/orders/' + 'x'.repeat(65),
    '/usesul/collections/' + 'x'.repeat(129), '/USESUL', '/usesul/about/extra', '/usesul/users/sign_in', '/usesul/account']) assert.equal(kind(bad), null, bad);
  assert.equal(shellPageKind('/usesul', ''), null); assert.equal(shellPageKind(null, '/usesul'), null); assert.equal(shellPageKind('/usesul', undefined), null);
  assert.equal(shellPageKind('/loja/about', '/loja'), 'about', 'the store prefix comes from the per-store config');
});

test('shellEnabled: only with the catalog scope AND header-nav (never in the five-product allowlist scope, never without the feature)', () => {
  assert.equal(shellEnabled('product-catalog', ['cart-mirror', 'header-nav']), true);
  assert.equal(shellEnabled('allowlist', ['header-nav']), false);
  assert.equal(shellEnabled('product-catalog', ['cart-mirror']), false);
  assert.equal(shellEnabled('product-catalog', []), false); assert.equal(shellEnabled('product-catalog', undefined), false);
});
