import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STORES, STORE_IDS, resolveStore, productPagePattern, catalogProductPattern, clientStore } from '../src/stores.js';
import { parseAllowlist } from '../src/allowlist.js';
import { inScope, isCatalogProductPath, shellEnabled, parseScopeMode } from '../src/scope.js';
import { validateIndex } from '../src/search-gateway.js';
import { searchCities, prepareCities } from '../src/search-rank.js';
import { createCartRefs } from '../src/cart-ref.js';

const SAMPLES = JSON.parse(readFileSync(new URL('../scripts/store-samples.json', import.meta.url), 'utf8'));
const toml = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const tomlValue = (text, key) => new RegExp('^' + key + '\\s*=\\s*"([^"]*)"', 'm').exec(text)?.[1] ?? null;
const routes = (text) => [...text.matchAll(/\[\[routes\]\]\s*\npattern = "([^"]+)"\s*\nzone_name = "([^"]+)"/g)].map((m) => ({ pattern: m[1], zone: m[2] }));

test('every store is internally consistent and no field is shared with another store (host, prefix, region, KV binding, GA4, worker name)', () => {
  assert.deepEqual(STORE_IDS, ['sul', 'norte', 'centro']);
  const seen = { inkHost: new Set(), inkBase: new Set(), region: new Set(), kvBinding: new Set(), ga: new Set(), workerName: new Set(), storefrontBase: new Set() };
  for (const id of STORE_IDS) {
    const s = STORES[id];
    assert.equal(s.id, id); assert.ok(Object.isFrozen(s));
    assert.match(s.inkHost, /^www\.use[a-z]+\.com\.br$/); assert.equal(s.inkBase, '/' + s.inkHost.split('.')[1]);
    assert.equal(s.storefrontBase, '/' + s.region); assert.equal(s.navbarApi, '/api/navbar/' + s.region); assert.equal(s.citiesApi, '/api/cidades/' + s.region);
    assert.equal(s.storefront, 'https://useorigens.com.br');
    assert.match(s.workerName, /^use-[a-z]+-widget$/); assert.match(s.kvBinding, /^[A-Z_]*CART_REFS$/); assert.match(s.ga, /^G-[A-Z0-9]{10}$/);
    assert.deepEqual(Object.keys(s.stateNames).sort(), [...s.ufs].sort(), 'state names cover exactly the region UFs');
    for (const key of Object.keys(seen)) { assert.equal(seen[key].has(s[key]), false, id + ' shares ' + key); seen[key].add(s[key]); }
  }
  assert.equal(STORES.sul.kvBinding, 'CART_REFS', 'the Sul binding name is unchanged');
  assert.equal(STORES.norte.kvBinding, 'NORTE_CART_REFS'); assert.equal(STORES.centro.kvBinding, 'CENTRO_CART_REFS');
  assert.equal(STORES.sul.shellPages, true); assert.equal(STORES.norte.shellPages, false); assert.equal(STORES.centro.shellPages, false);
  const c = clientStore(STORES.centro);
  assert.equal(c.home, 'https://useorigens.com.br/centro-oeste'); assert.equal(c.search, 'https://useorigens.com.br/centro-oeste/busca'); assert.equal(c.cities, 'https://useorigens.com.br/centro-oeste#estados');
});

test('resolveStore: absent = Use Sul; known ids (trimmed) = ok; anything else = no store', () => {
  for (const raw of [undefined, null, '']) assert.deepEqual([resolveStore(raw).id, resolveStore(raw).status], ['sul', 'default']);
  for (const id of STORE_IDS) assert.deepEqual([resolveStore(id).id, resolveStore(' ' + id + ' ').status, resolveStore(id).store], [id, 'ok', STORES[id]]);
  for (const bad of ['Norte', 'nort', 'sul,norte', 'use-norte', '__proto__', 'constructor', 'toString', 7, {}, [], true]) { const r = resolveStore(bad); assert.deepEqual([r.id, r.store, r.status], [null, null, 'invalid'], String(bad)); }
});

test('the real sample URLs of each store belong to that store only: page pattern, catalog scope and allowlist', () => {
  for (const id of ['norte', 'centro']) {
    const store = STORES[id]; const foreign = STORE_IDS.filter((x) => x !== id).map((x) => STORES[x]);
    const all = [...SAMPLES[id].allowlist, ...SAMPLES[id].extraProducts];
    assert.ok(SAMPLES[id].allowlist.length >= 3, 'at least three real products per store');
    assert.ok(SAMPLES[id].storefrontHome.startsWith(store.storefront + store.storefrontBase));
    for (const path of all) {
      assert.equal(productPagePattern(store).test(path), true, path); assert.equal(isCatalogProductPath(path, store), true, path);
      for (const other of foreign) { assert.equal(productPagePattern(other).test(path), false, path + ' vs ' + other.id); assert.equal(isCatalogProductPath(path, other), false); }
    }
    const parsed = parseAllowlist(SAMPLES[id].allowlist.join(','), store);
    assert.deepEqual([parsed.status, parsed.paths.length], ['ok', SAMPLES[id].allowlist.length]);
    for (const other of foreign) assert.equal(parseAllowlist(SAMPLES[id].allowlist.join(','), other).status, 'invalid', 'a list of ' + id + ' paths is invalid for ' + other.id);
    assert.equal(parseAllowlist(SAMPLES[id].allowlist[0] + ',' + SAMPLES[foreign[0].id === 'sul' ? (id === 'norte' ? 'centro' : 'norte') : foreign[0].id].allowlist[0], store).status, 'invalid');
    const s = SAMPLES[id].search; assert.ok(s.href.startsWith(store.storefront + store.storefrontBase + '/' + s.uf.toLowerCase() + '/')); assert.ok(store.ufs.includes(s.uf));
  }
});

test('product patterns: canonical slugs only; no transactional path, subpath, trailing slash, encoding or traversal is ever a product', () => {
  for (const id of ['norte', 'centro']) {
    const store = STORES[id]; const b = store.inkBase;
    for (const bad of [b, b + '/', b + '/product', b + '/product/', b + '/cart', b + '/checkout', b + '/store_sessions/new', b + '/login', b + '/orders', b + '/admin', b + '/product/a/b', b + '/product/A', b + '/product/%2e%2e', b + '/product/..',
      b + '/product/x?y=1', b + '/product/-x', '/usesul/product/x', '/product/x', '/__origens/health']) assert.equal(isCatalogProductPath(bad, store), false, bad);
    assert.equal(isCatalogProductPath(b + '/product/' + 'a'.repeat(128), store), true); assert.equal(isCatalogProductPath(b + '/product/' + 'a'.repeat(129), store), false);
    const catalog = parseScopeMode('product-catalog'); const allow = parseScopeMode('allowlist');
    assert.equal(inScope(catalog, { paths: [] }, b + '/product/qualquer', store), true); assert.equal(inScope(allow, { paths: [] }, b + '/product/qualquer', store), false);
    assert.equal(shellEnabled('product-catalog', ['header-nav'], store.shellPages), false, 'shell pages stay off for ' + id);
  }
  assert.equal(shellEnabled('product-catalog', ['header-nav'], STORES.sul.shellPages), true);
  assert.equal(shellEnabled('product-catalog', ['header-nav']), true, 'default keeps the Sul behavior');
});

test('the TOML of each new store is bound to that store only: name, STORE_ID, host, routes (product + __origens, nothing else), zone and its own KV binding', () => {
  for (const id of ['norte', 'centro']) {
    const store = STORES[id]; const text = toml('wrangler.' + id + '.toml');
    assert.equal(tomlValue(text, 'name'), store.workerName); assert.equal(tomlValue(text, 'STORE_ID'), id);
    assert.equal(tomlValue(text, 'ENABLE_WIDGET'), 'false', 'a bare deploy is fail-closed'); assert.equal(tomlValue(text, 'WIDGET_FEATURES'), 'return-link'); assert.equal(tomlValue(text, 'WIDGET_ALLOWLIST'), '');
    assert.equal(text.includes('workers_dev = false'), true);
    const zone = store.inkHost.replace(/^www\./, '');
    assert.deepEqual(routes(text), [{ pattern: store.inkHost + store.inkBase + '/product/*', zone }, { pattern: store.inkHost + '/__origens/*', zone }]);
    assert.deepEqual([...text.matchAll(/^binding = "([^"]+)"/gm)].map((m) => m[1]), [store.kvBinding], 'exactly one KV binding, the store one');
    assert.match(text, new RegExp('id = "REPLACE_WITH_' + store.kvBinding + '_NAMESPACE_ID"'), 'the id is a placeholder until the release resolves the real namespace');
    for (const other of STORE_IDS.filter((x) => x !== id)) for (const literal of [STORES[other].inkHost, STORES[other].inkBase, STORES[other].workerName]) assert.equal(text.includes(literal), false, id + ' toml mentions ' + literal);
    for (const other of STORE_IDS.filter((x) => x !== id)) assert.equal(new RegExp('\\b' + STORES[other].kvBinding + '\\b').test(text), false, id + ' toml mentions the binding of ' + other);
  }
  // A Use Sul: o TOML de produção não foi tocado por esta rodada (sem STORE_ID, mesmo binding, mesmas rotas).
  const sul = toml('wrangler.production.toml');
  assert.equal(tomlValue(sul, 'name'), 'use-sul-widget'); assert.equal(tomlValue(sul, 'STORE_ID'), null); assert.match(sul, /binding = "CART_REFS"\nid = "d399f7d61d1c466a8d50211e67ed9eab"/);
});

test('city search per region: only the UFs of the store are indexed and ranked; a Sul city or state never leaks into Norte/Centro-Oeste', () => {
  const mk = (n, u, s) => ({ n, u, s });
  const cities = [mk('Belém', 'PA', 'belem'), mk('Manaus', 'AM', 'manaus'), mk('Curitiba', 'PR', 'curitiba'), mk('Goiânia', 'GO', 'goiania'), mk('Cuiabá', 'MT', 'cuiaba'), ...Array.from({ length: 100 }, (_, i) => mk('Cidade ' + i, 'TO', 'cidade-' + i))];
  const norte = validateIndex(cities, STORES.norte); assert.ok(norte.every((c) => STORES.norte.ufs.includes(c.u))); assert.equal(norte.some((c) => c.n === 'Curitiba' || c.n === 'Goiânia'), false);
  const centro = validateIndex([...cities, ...Array.from({ length: 100 }, (_, i) => mk('Cidade ' + i, 'GO', 'cidade-go-' + i))], STORES.centro); assert.ok(centro.every((c) => STORES.centro.ufs.includes(c.u)));
  assert.equal(validateIndex(cities, STORES.sul), null, 'fewer than 100 Sul cities => not the real index');
  const prepared = prepareCities(norte);
  const hit = searchCities(prepared, 'belem', { ufs: STORES.norte.ufs, stateNames: STORES.norte.stateNames, limit: 5 });
  assert.equal(hit[0].city.n, 'Belém');
  const states = searchCities(prepared, 'para', { ufs: STORES.norte.ufs, stateNames: STORES.norte.stateNames, limit: 5 });
  assert.ok(states.some((r) => r.type === 'state' && r.uf === 'PA' && r.name === 'Pará'));
  assert.equal(searchCities(prepared, 'parana', { ufs: STORES.norte.ufs, stateNames: STORES.norte.stateNames, limit: 5 }).some((r) => r.type === 'state'), false, 'Paraná is not a Norte state');
  assert.equal(searchCities(prepared, 'pr', { ufs: STORES.norte.ufs, stateNames: STORES.norte.stateNames }).some((r) => r.uf === 'PR'), false);
  const preparedCentro = prepareCities(centro); const dfs = searchCities(preparedCentro, 'distrito', { ufs: STORES.centro.ufs, stateNames: STORES.centro.stateNames });
  assert.ok(dfs.some((r) => r.type === 'state' && r.uf === 'DF' && r.name === 'Distrito Federal'));
});

test('cart-ref store marker (unit): a record of another store, or a legacy unmarked record read by a non-Sul store, is a 404; the Sul reads legacy records; the marker never leaves', async () => {
  const kv = new Map(); const fake = { async put(k, v) { kv.set(k, v); }, async get(k) { return kv.has(k) ? JSON.parse(kv.get(k)) : null; } };
  const refs = createCartRefs(); const now = Date.now();
  const snap = { v: 1, count: 0, items: [], subtotal: null, discount: null };
  const token = 'AAAAAAAAAAAAAAAAAAAAAA';
  kv.set('cartref:' + token, JSON.stringify({ ...snap, savedAt: now }));                    // registro antigo, sem marca (só a Sul gravava)
  const get = (store) => refs.read(new Request('https://x/__origens/cart-ref/' + token), { kv: fake, token, store });
  assert.equal((await get('sul')).status, 200); assert.equal((await get('norte')).status, 404); assert.equal((await get('centro')).status, 404);
  assert.equal((await get(null)).status, 200, 'without a store (legacy callers) nothing changes');
  kv.set('cartref:' + token, JSON.stringify({ ...snap, savedAt: now, store: 'norte' }));
  assert.equal((await get('norte')).status, 200); assert.equal((await get('centro')).status, 404); assert.equal((await get('sul')).status, 404);
  assert.ok(!('store' in await (await get('norte')).json()));
});
