import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatures, FEATURE_NAMES, DEFAULT_FEATURES } from '../src/features.js';
import { buildLoaderSource, buildDiscoverySource, LOADER_VERSION } from '../src/loader-source.js';

test('missing WIDGET_FEATURES keeps the current pilot behavior (return-link only)', () => {
  assert.deepEqual(parseFeatures(undefined), { status: 'default', features: ['return-link'] });
  assert.deepEqual(parseFeatures(null), { status: 'default', features: ['return-link'] });
  assert.deepEqual(DEFAULT_FEATURES, ['return-link']);
});

test('empty WIDGET_FEATURES means no module at all', () => {
  for (const raw of ['', '   ']) assert.deepEqual(parseFeatures(raw), { status: 'empty', features: [] });
});

test('known names are accepted, trimmed, ordered and de-duplicated', () => {
  assert.deepEqual(parseFeatures(' city-search , return-link,post-add-discovery,return-link '), { status: 'ok', features: ['return-link', 'post-add-discovery', 'city-search'] });
  assert.deepEqual(parseFeatures('cart-discovery,city-search'), { status: 'ok', features: ['city-search', 'cart-discovery'] });
  assert.deepEqual(parseFeatures('post-add-discovery'), { status: 'ok', features: ['post-add-discovery'] });
});

test('any unknown or malformed name invalidates the WHOLE list (fail-closed)', () => {
  for (const raw of ['return-link,evil', 'RETURN-LINK', 'return-link;city-search', 'return-link,,city-search', 'all', '*', 'return_link', 123, {}, ['return-link'], 'x'.repeat(300)]) {
    assert.deepEqual(parseFeatures(raw), { status: 'invalid', features: [] }, JSON.stringify(raw));
  }
});

test('loader bundles ONLY the enabled modules', () => {
  const paths = ['/usesul/product/serra-catarinense'];
  const link = buildLoaderSource(paths, ['return-link']);
  const both = buildLoaderSource(paths, ['return-link', 'post-add-discovery', 'city-search']);
  const none = buildLoaderSource(paths, []);
  assert.match(link, /id: 'return-link'/); assert.doesNotMatch(link, /post-add-discovery|discovery\.js/);
  assert.match(both, /id: 'return-link'/); assert.match(both, /id: 'post-add-discovery'/); assert.match(both, /discovery\.js\?v=/);
  assert.doesNotMatch(none, /id: 'return-link'|id: 'post-add-discovery'/);
  assert.ok(both.includes('const FEATURES = ["return-link","post-add-discovery","city-search"];'));
  assert.ok(both.includes('const ALLOWED_PATHS = ["/usesul/product/serra-catarinense"];'));
  assert.ok(!both.includes('__VERSION__') && !both.includes('__ALLOWED_PATHS__') && !both.includes('__FEATURES__'));
  assert.ok(both.includes("window.__useOrigensLoader = '" + LOADER_VERSION + "'"));
});

// Desde o loader 4.1 o núcleo ESCUTA cliques (medição + marcador de origem em capture), mas nunca intercepta: sem preventDefault/stopPropagation.
test('the core loader stays free of network calls, click interception, cookies and storage', () => {
  const core = buildLoaderSource(['/usesul/product/serra-catarinense'], ['return-link', 'post-add-discovery', 'city-search']);
  for (const forbidden of [/fetch\(/, /XMLHttpRequest/, /sendBeacon/, /preventDefault|stopPropagation|stopImmediatePropagation/, /document\.cookie/, /localStorage|sessionStorage|indexedDB/, /\.submit\(/, /innerHTML|insertAdjacentHTML|document\.write|\beval\(/]) {
    assert.doesNotMatch(core, forbidden, String(forbidden));
  }
});

test('discovery module: no HTML injection, no cookies/storage, no external hosts, no polling', () => {
  const src = buildDiscoverySource({ search: true });
  for (const forbidden of [/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, /document\.cookie|localStorage|sessionStorage|indexedDB/, /setInterval/, /https?:\/\/(?!www\.w3\.org)/, /@import|url\(/, /googleapis|gstatic|cdn\./i]) {
    assert.doesNotMatch(src, forbidden, String(forbidden));
  }
  assert.match(src, /credentials: 'omit'/);
  assert.match(buildDiscoverySource({ search: false }), /const SEARCH = false;/);
  assert.match(src, /const SEARCH = true;/);
});
