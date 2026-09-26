import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAllowlist, MAX_ALLOWLIST_ENTRIES } from '../src/allowlist.js';

const P = (slug) => '/usesul/product/' + slug;

test('missing, null and blank allowlists are empty (fail-closed)', () => {
  for (const raw of [undefined, null, '', '   ', '\n']) {
    assert.deepEqual(parseAllowlist(raw), { status: 'empty', paths: [] }, JSON.stringify(raw));
  }
});

test('a single exact product path is accepted', () => {
  assert.deepEqual(parseAllowlist(P('serra-catarinense')), { status: 'ok', paths: [P('serra-catarinense')] });
});

test('several paths with spaces are accepted and de-duplicated', () => {
  const raw = ` ${P('a')} , ${P('b_2')},${P('a')} `;
  assert.deepEqual(parseAllowlist(raw), { status: 'ok', paths: [P('a'), P('b_2')] });
});

test('wildcards, prefixes and broad paths are invalid', () => {
  for (const raw of ['/usesul/product/*', '/usesul/product/', '/usesul/product', '/usesul/*', '/usesul', '/*', '*', '/usesul/product/a*',
    '/usesul/product/**', '/usesul/products/a', '/usesul/cart', '/usesul/checkout', '/usesul/product/a/b']) {
    assert.equal(parseAllowlist(raw).status, 'invalid', raw);
  }
});

test('query strings, fragments, trailing slash, case and encoding are invalid', () => {
  for (const raw of ['/usesul/product/a?x=1', '/usesul/product/a#f', '/usesul/product/a/', '/usesul/product/A', '/usesul/product/Serra',
    '/usesul/product/a%2Fb', '/usesul/product/a%20b', '/usesul/product/../cart', '/usesul/product/a b', '/usesul/product/__origens',
    '/usesul/product/-a', 'https://www.usesul.com.br/usesul/product/a', 'usesul/product/a']) {
    assert.equal(parseAllowlist(raw).status, 'invalid', raw);
  }
});

test('one malformed entry invalidates the WHOLE list', () => {
  for (const raw of [P('a') + ',/usesul/product/*', P('a') + ',', ',' + P('a'), P('a') + ',,' + P('b'), P('a') + ',garbage']) {
    assert.deepEqual(parseAllowlist(raw), { status: 'invalid', paths: [] }, raw);
  }
});

test('size and type limits are enforced', () => {
  const many = Array.from({ length: MAX_ALLOWLIST_ENTRIES + 1 }, (_, i) => P('p' + i)).join(',');
  assert.equal(parseAllowlist(many).status, 'invalid');
  const atLimit = Array.from({ length: MAX_ALLOWLIST_ENTRIES }, (_, i) => P('p' + i)).join(',');
  assert.equal(parseAllowlist(atLimit).status, 'ok');
  assert.equal(parseAllowlist(P('x'.repeat(3000))).status, 'invalid');
  for (const raw of [123, {}, [P('a')], true]) assert.equal(parseAllowlist(raw).status, 'invalid');
});

// Evita divergência dev/produção: valores padrão idênticos e seguros.
function vars(file) {
  const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const block = text.split(/^\[vars\]\s*$/m)[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"\s*$/gm)].map((m) => [m[1], m[2]]));
}

test('wrangler dev and production ship the same safe defaults', () => {
  const dev = vars('wrangler.dev.toml');
  const prod = vars('wrangler.production.toml');
  assert.deepEqual(dev, prod);
  assert.equal(prod.ENABLE_WIDGET, 'false');
  assert.equal(prod.WIDGET_ALLOWLIST, '');
});

test('production routes are exactly the two www routes; staging has none', () => {
  const prod = readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8');
  const patterns = [...prod.matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(patterns, ['www.usesul.com.br/usesul/product/*', 'www.usesul.com.br/__origens/*', 'www.usesul.com.br/usesul', 'www.usesul.com.br/usesul/products*', 'www.usesul.com.br/usesul/collections/*', 'www.usesul.com.br/usesul/about*', 'www.usesul.com.br/usesul/orders*']);
  // Nunca uma rota que ponha o Worker no caminho da compra ou do login, nem um curinga amplo sobre a loja toda.
  for (const pattern of patterns) { assert.doesNotMatch(pattern, /cart|checkout|store_sessions/, pattern); assert.ok(!['www.usesul.com.br/usesul/*', 'www.usesul.com.br/usesul*', 'www.usesul.com.br/*'].includes(pattern), pattern); }
  const dev = readFileSync(new URL('../wrangler.dev.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(dev, /^\s*(pattern|\[\[routes\]\])/m);
});

test('given exactly five real product paths, then all five are allowed; one malformed/missing-slug entry fails the whole list closed', () => {
  const five = ['serra-catarinense', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a'].map((s) => '/usesul/product/' + s);
  const ok = parseAllowlist(five.join(','));
  assert.equal(ok.status, 'ok'); assert.deepEqual(ok.paths, five);
  for (const bad of [[...five, '/usesul/product/'], [...five, '/usesul/product/Maiuscula'], [...five, '/usesul/product/a/b'], [...five, '/usesul/product/*'], [...five, '/usesul/product/x?y=1'], [...five, '']]) {
    assert.deepEqual(parseAllowlist(bad.join(',')), { status: 'invalid', paths: [] }, bad.at(-1));
  }
});
