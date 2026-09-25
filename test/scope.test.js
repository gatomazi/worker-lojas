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
