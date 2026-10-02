import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STORES } from '../src/stores.js';
import { FEATURE_NAMES } from '../src/features.js';
import { LOADER_VERSION } from '../src/loader-source.js';
import { RELEASABLE, releaseStore, configProblems, resolveToml, releaseVars, deployArgs, buildSnapshot, validateSnapshot, snapshotDigest, routeState, safetyProblems, planApply, planRetire, planRestore, evaluateStoreHealth, probeSet, countLoaders, STORE_FEATURES, CONSERVATIVE, CATALOG } from '../scripts/lib/store-lib.mjs';

// Release por loja: funções puras (sem rede/Wrangler/Cloudflare). Norte e Centro-Oeste com as URLs REAIS de scripts/store-samples.json.
const SAMPLES = JSON.parse(readFileSync(new URL('../scripts/store-samples.json', import.meta.url), 'utf8'));
const toml = (id) => readFileSync(new URL('../wrangler.' + id + '.toml', import.meta.url), 'utf8');
const hex = (n) => n.toString(16).padStart(32, '0');
const ZONE = { norte: '166285001b8af3c2e5ec315797daf55d', centro: '9c6f4636407d2887ea0b09f4a1632717' };
const route = (n, pattern, script) => ({ id: hex(n), pattern, script });

test('only ONE known store per release: "sul", "all", unknown, empty and non-string are refused (a command never updates two Workers)', () => {
  assert.deepEqual(RELEASABLE, ['norte', 'centro']);
  for (const bad of ['sul', 'all', 'norte,centro', 'Norte', ' norte', '', undefined, null, 7, ['norte'], '--all', '*']) assert.throws(() => releaseStore(bad), /loja inválida/, String(bad));
  const n = releaseStore('norte'); const c = releaseStore('centro');
  assert.deepEqual([n.store.workerName, n.zoneName, n.kvTitle, n.confirmPhrase, n.tomlFile], ['use-norte-widget', 'usenorte.com.br', 'use-norte-cart-refs', 'PUBLICAR-NORTE-INK', 'wrangler.norte.toml']);
  assert.deepEqual([c.store.workerName, c.zoneName, c.kvTitle, c.confirmPhrase, c.tomlFile], ['use-centro-widget', 'usecentro.com.br', 'use-centro-cart-refs', 'PUBLICAR-CENTRO-INK', 'wrangler.centro.toml']);
  assert.notEqual(n.confirmPhrase, c.confirmPhrase, 'the confirmation of one store never releases the other');
});

test('configProblems: the shipped TOMLs are clean; a TOML of the OTHER store, a wrong name/STORE_ID/route/binding/zone, or an enabled default are all refused', () => {
  for (const id of RELEASABLE) assert.deepEqual(configProblems(toml(id), releaseStore(id)), [], id);
  const n = releaseStore('norte'); const c = releaseStore('centro');
  assert.ok(configProblems(toml('centro'), n).length >= 5, 'Centro TOML under a Norte release');
  assert.ok(configProblems(toml('norte'), c).length >= 5, 'Norte TOML under a Centro release');
  const t = toml('norte');
  const mutate = (from, to) => configProblems(t.replace(from, to), n);
  assert.match(mutate('name = "use-norte-widget"', 'name = "use-sul-widget"').join(';'), /name do TOML/);
  assert.match(mutate('STORE_ID = "norte"', 'STORE_ID = "centro"').join(';'), /STORE_ID/);
  assert.match(mutate('STORE_ID = "norte"', 'STORE_ID = "sul"').join(';'), /STORE_ID/);
  assert.match(mutate('www.usenorte.com.br/usenorte/product/*', 'www.usenorte.com.br/usenorte*').join(';'), /rotas do TOML/);
  assert.match(mutate('www.usenorte.com.br/__origens/*', 'www.usesul.com.br/__origens/*').join(';'), /rotas do TOML|outra loja/);
  assert.match(mutate('zone_name = "usenorte.com.br"', 'zone_name = "usesul.com.br"').join(';'), /zone_name/);
  assert.match(mutate('binding = "NORTE_CART_REFS"', 'binding = "CART_REFS"').join(';'), /bindings KV/);
  assert.match(mutate('ENABLE_WIDGET = "false"', 'ENABLE_WIDGET = "true"').join(';'), /fail-closed/);
  assert.match(configProblems(t + '\n# www.usesul.com.br\n', n).join(';'), /outra loja/);
  assert.match(configProblems(t + '\n[[routes]]\npattern = "www.usenorte.com.br/usenorte/cart"\nzone_name = "usenorte.com.br"\n', n).join(';'), /rotas do TOML/);
});

test('resolveToml swaps ONLY the KV marker for a real 32-hex id; anything else is refused', () => {
  const n = releaseStore('norte'); const id = 'abcdef0123456789abcdef0123456789';
  const out = resolveToml(toml('norte'), n, id);
  assert.match(out, new RegExp('binding = "NORTE_CART_REFS"\\nid = "' + id + '"')); assert.equal(out.includes('REPLACE_WITH'), false);
  for (const bad of ['', 'zz', id.slice(1), id + '0', id.toUpperCase(), undefined, null, 'REPLACE_WITH_NORTE_CART_REFS_NAMESPACE_ID']) assert.throws(() => resolveToml(toml('norte'), n, bad), /inválido/, String(bad));
  assert.throws(() => resolveToml(toml('norte').replace('REPLACE_WITH_NORTE_CART_REFS_NAMESPACE_ID', id), n, id), /marcador/);
});

test('releaseVars/deployArgs: eight features, two phases, own allowlist of real products; the args bind file, --name and STORE_ID to the same store', () => {
  assert.equal(STORE_FEATURES.length, 8); assert.deepEqual(STORE_FEATURES, FEATURE_NAMES.filter((f) => f !== 'promo-fab'), 'a routine release never turns a new opt-in flag on');
  for (const id of RELEASABLE) {
    const rel = releaseStore(id);
    const a = releaseVars(rel, CONSERVATIVE, SAMPLES); const b = releaseVars(rel, CATALOG, SAMPLES);
    assert.deepEqual([a.WIDGET_SCOPE_MODE, b.WIDGET_SCOPE_MODE, a.STORE_ID, a.ENABLE_WIDGET], ['allowlist', 'product-catalog', id, 'true']);
    assert.equal(a.WIDGET_ALLOWLIST.split(',').length, 3); assert.ok(a.WIDGET_ALLOWLIST.split(',').every((p) => p.startsWith(rel.store.inkBase + '/product/')));
    const args = deployArgs(rel, rel.tomlFile, a);
    assert.deepEqual(args.slice(0, 6), ['wrangler', 'deploy', '-c', rel.tomlFile, '--name', rel.store.workerName]);
    assert.ok(args.includes('STORE_ID:' + id)); assert.ok(args.includes('WIDGET_FEATURES:' + STORE_FEATURES.join(',')));
    assert.throws(() => releaseVars(rel, 'depois', SAMPLES), /fase inválida/);
    assert.throws(() => deployArgs(rel, rel.tomlFile, { ...a, STORE_ID: id === 'norte' ? 'centro' : 'norte' }), /STORE_ID/);
    assert.throws(() => deployArgs(rel, 'wrangler.production.toml', a), /não é o da loja/);
    assert.throws(() => deployArgs(rel, id === 'norte' ? 'wrangler.centro.toml' : 'wrangler.norte.toml', a), /não é o da loja/);
    assert.equal(args.join(' ').includes('use-sul-widget'), false);
  }
  const rel = releaseStore('norte');
  assert.throws(() => releaseVars(rel, CATALOG, { norte: { allowlist: ['/usenorte/product/a'] } }), /pelo menos 3/);
  assert.throws(() => releaseVars(rel, CATALOG, { norte: { allowlist: [...SAMPLES.norte.allowlist.slice(0, 2), '/usecentro/product/x'] } }), /fora do prefixo/);
});

test('snapshot: built and validated with schema, identity, count and digest; unreadable, foreign, tampered or wrong-zone snapshots are refused; an empty one is valid but NEVER restores', () => {
  const rel = releaseStore('norte');
  const routes = [route(1, 'www.usenorte.com.br/foo', 'outro-worker'), route(2, 'www.usenorte.com.br/bar', null)];
  const snap = buildSnapshot({ rel, zoneId: ZONE.norte, routes, now: new Date('2026-09-28T01:00:00Z') });
  assert.deepEqual(validateSnapshot(snap, rel, { zoneId: ZONE.norte }), { ok: true, empty: false, problems: [] });
  assert.equal(JSON.stringify(validateSnapshot(JSON.parse(JSON.stringify(snap)), rel, { zoneId: ZONE.norte }).ok), 'true', 'survives a JSON round trip (file on disk)');
  const empty = buildSnapshot({ rel, zoneId: ZONE.norte, routes: [] });
  assert.deepEqual(validateSnapshot(empty, rel, { zoneId: ZONE.norte }), { ok: true, empty: true, problems: [] });
  const bad = (mutate) => { const s = JSON.parse(JSON.stringify(snap)); mutate(s); return validateSnapshot(s, rel, { zoneId: ZONE.norte }); };
  for (const [what, mutate, re] of [
    ['other store', (s) => { s.store = 'centro'; }, /outra loja/], ['other zone', (s) => { s.zone = 'usecentro.com.br'; }, /outra zona/], ['zone id', (s) => { s.zone_id = ZONE.centro; }, /zona ativa/],
    ['count', (s) => { s.count = 5; }, /count/], ['tampered pattern', (s) => { s.routes[0].pattern = 'www.usenorte.com.br/x'; }, /digest/], ['dropped route', (s) => { s.routes.pop(); s.count = 1; }, /digest/],
    ['no routes field', (s) => { delete s.routes; }, /routes ausente/], ['old format', (s) => { delete s.schema; }, /schema/], ['bad id', (s) => { s.routes[0].id = 'x'; }, /malformada/], ['bad date', (s) => { s.captured_at = 'ontem'; }, /captured_at/]]) {
    const r = bad(mutate); assert.equal(r.ok, false, what); assert.match(r.problems.join(';'), re, what);
  }
  for (const junk of [null, undefined, 'x', 7, [], { routes: [] }, JSON.parse('{"routes":[{"pattern":"a"}]}')]) assert.equal(validateSnapshot(junk, rel, { zoneId: ZONE.norte }).ok, false, JSON.stringify(junk));
  assert.notEqual(snapshotDigest(routes), snapshotDigest(routes.slice(1)));
  assert.equal(snapshotDigest(routes), snapshotDigest([...routes].reverse()), 'order independent');
  // restore: refuses invalid and EMPTY snapshots
  assert.throws(() => planRestore(empty, [], rel, { zoneId: ZONE.norte }), /snapshot vazio/);
  assert.throws(() => planRestore({ routes: [] }, [], rel), /restore recusado/);
  assert.throws(() => planRestore(buildSnapshot({ rel: releaseStore('centro'), zoneId: ZONE.centro, routes }), [], rel), /restore recusado/);
});

test('planRestore: brings only the store host back to the validated snapshot (removes ours, recreates lost ones) and never touches other hosts', () => {
  const rel = releaseStore('norte'); const w = rel.store.workerName;
  const snap = buildSnapshot({ rel, zoneId: ZONE.norte, routes: [route(1, 'www.usenorte.com.br/foo', 'outro-worker'), route(2, 'blog.usenorte.com.br/x', null)] });
  const current = [route(10, 'www.usenorte.com.br/usenorte/product/*', w), route(11, 'www.usenorte.com.br/__origens/*', w), route(12, 'www.usenorte.com.br/foo', 'outro-worker'), route(13, 'api.usenorte.com.br/z', 'terceiro')];
  const plan = planRestore(snap, current, rel, { zoneId: ZONE.norte });
  assert.deepEqual(plan.remove.map((r) => r.pattern).sort(), ['www.usenorte.com.br/__origens/*', 'www.usenorte.com.br/usenorte/product/*']);
  assert.deepEqual([plan.create.length, plan.update.length], [0, 0], 'the foreign-host route in the snapshot is not ours to recreate; the intact one stays');
});

test('routeState/planApply/planRetire: a fresh store is "baseline"; apply creates only the two routes; conflicts block; retire removes ONLY the two own routes', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const w = rel.store.workerName; const [product, origens] = rel.routePatterns;
    assert.deepEqual(rel.routePatterns, [rel.store.inkHost + rel.store.inkBase + '/product/*', rel.store.inkHost + '/__origens/*']);
    assert.equal(routeState([], rel).stage, 'baseline');
    assert.deepEqual(planApply([], rel), { create: [{ pattern: product, script: w }, { pattern: origens, script: w }], problems: [] });
    const final = [route(1, product, w), route(2, origens, w), route(3, 'www.' + 'other.com.br/x', 'zzz')];
    assert.equal(routeState(final, rel).stage, 'final'); assert.deepEqual(planApply(final, rel), { create: [], problems: [] });
    assert.deepEqual(planRetire(final, rel).remove.map((r) => r.pattern), [product, origens]);
    assert.equal(routeState([route(1, product, w)], rel).stage, 'parcial');
    const conflict = [route(1, product, 'use-sul-widget')];
    assert.match(planApply(conflict, rel).problems.join(';'), /existe com use-sul-widget/);
    assert.deepEqual(planRetire(conflict, rel).remove, [], 'a route bound to another Worker is never removed');
    assert.deepEqual(planRetire([route(1, product, null)], rel).remove, [], 'nor an exclusion (no Worker)');
  }
});

test('safetyProblems: nothing with a Worker may sit on cart, checkout, login, orders, admin, payments or be a wildcard for the store; only the two known routes are allowed', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const w = rel.store.workerName; const h = rel.store.inkHost; const b = rel.store.inkBase;
    assert.deepEqual(safetyProblems(rel.routePatterns.map((p, i) => route(i + 1, p, w)), rel), []);
    for (const pattern of [h + b + '/cart', h + b + '/cart*', h + b + '/checkout/*', h + b + '/store_sessions/*', h + b + '/login', h + b + '/admin/*', h + b + '/payments*', h + '/*', h + b + '/product/*/cart', h + b + '/orders/*', h + b + '/collections*']) {
      assert.ok(safetyProblems([route(1, pattern, w)], rel).length >= 1, pattern);
    }
    // a abrangente da casca só é aceita COM a exclusão ativa
    assert.match(safetyProblems([route(1, rel.shell.broad, w)], rel).join(';'), /SEM a exclusão/);
    assert.deepEqual(safetyProblems([route(1, rel.shell.broad, w), route(2, rel.shell.exclusion, null)], rel), []);
    assert.match(safetyProblems([route(1, rel.shell.exclusion, w)], rel).join(';'), /TEM de ser SEM Worker/);
    assert.deepEqual(safetyProblems([route(1, h + b + '/cart', null)], rel), [], 'an exclusion (no Worker) is not a problem');
    assert.deepEqual(safetyProblems([route(1, 'www.outro.com.br/cart', 'x')], rel), [], 'other hosts are not ours to judge');
  }
});

test('evaluateStoreHealth: the expected state passes; any deviation (identity, KV, scope, allowlist, features, shell, version) is named', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id);
    const health = { service: rel.store.workerName, store: id, store_status: 'ok', version: LOADER_VERSION, widget_mode: 'true', allowlist_status: 'ok', allowlist_size: 3, scope_mode: CONSERVATIVE, scope_status: 'ok', shell_pages: false, features_status: 'ok', widget_features: STORE_FEATURES, kv_bound: true };
    const ok = (over, opts = {}) => evaluateStoreHealth({ ...health, ...over }, rel, { scope: CONSERVATIVE, allowlistSize: 3, version: LOADER_VERSION, ...opts });
    assert.deepEqual(ok({}), { ok: true, problems: [] });
    assert.equal(evaluateStoreHealth({ ...health, scope_mode: CATALOG }, rel, { scope: CATALOG, allowlistSize: 3 }).ok, true);
    for (const [over, re] of [[{ service: 'use-sul-widget' }, /service/], [{ store: id === 'norte' ? 'centro' : 'norte' }, /store /], [{ store_status: 'default' }, /store /], [{ widget_mode: 'dry-run' }, /widget_mode/], [{ kv_bound: false }, /KV/],
      [{ scope_mode: CATALOG }, /scope/], [{ allowlist_size: 5 }, /allowlist/], [{ widget_features: STORE_FEATURES.slice(1) }, /ausente/], [{ widget_features: [...STORE_FEATURES, 'x'] }, /inesperada/], [{ shell_pages: true }, /shell_pages/], [{ version: '9.9' }, /version/], [{ features_status: 'invalid' }, /features_status/]]) {
      const r = ok(over); assert.equal(r.ok, false, JSON.stringify(over)); assert.match(r.problems.join(';'), re, JSON.stringify(over));
    }
    assert.equal(evaluateStoreHealth(null, rel, { scope: CONSERVATIVE, allowlistSize: 3 }).ok, false);
  }
});

test('probeSet: the real product pages (and UTM) MUST execute the Worker; login, cart, checkout, orders, home, listings and collections must NOT', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const { exec, skip } = probeSet(rel, SAMPLES); const b = rel.store.inkBase;
    for (const p of SAMPLES[id].allowlist) assert.ok(exec.includes(p));
    assert.ok(exec.includes('/__origens/health')); assert.ok(exec.some((p) => p.includes('?utm_source=')));
    for (const p of [`${b}/cart`, `${b}/cart?x=1`, `${b}/checkout`, `${b}/store_sessions/new`, `${b}/login`, `${b}/orders`, b, b + '/', `${b}/products`]) assert.ok(skip.includes(p), p);
    assert.equal(skip.some((p) => p.includes('/product/')), false);
  }
  assert.equal(countLoaders('<script src="/__origens/loader.js?v=4.7&c=x"></script>'), 1); assert.equal(countLoaders('<html></html>'), 0);
});

test('shell patterns mirror the Use Sul design: exclusion <base>/* (no Worker), seven Worker routes, the broad one last; nothing else', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const h = rel.store.inkHost; const b = rel.store.inkBase; const sh = rel.shell;
    assert.equal(sh.exclusion, h + b + '/*'); assert.equal(sh.homeSlash, h + b + '/'); assert.equal(sh.broad, h + b + '*');
    assert.deepEqual([...sh.specific], [h + b, h + b + '/products*', h + b + '/collections/*', h + b + '/about*', h + b + '/orders*']);
    assert.deepEqual([...sh.workerRoutes], [h + b + '/', h + b, h + b + '/products*', h + b + '/collections/*', h + b + '/about*', h + b + '/orders*', h + b + '*']);
    assert.equal(sh.workerRoutes.at(-1), sh.broad, 'the broad route is created last');
    assert.equal(sh.workerRoutes.some((p) => /cart|checkout|store_sessions|login/.test(p)), false);
    assert.equal(new Set([rel.shell.exclusion, ...sh.workerRoutes, ...rel.routePatterns]).size, 10);
  }
});

test('routeState/planApply: final -> shell-staged -> shell in the SAFE order; retire scope=shell keeps the two product routes and removes the exclusion last', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const w = rel.store.workerName; const sh = rel.shell; let n = 1; let cur = rel.routePatterns.map((p) => route(n++, p, w));
    assert.equal(routeState(cur, rel).stage, 'final');
    const staged = planApply(cur, rel, 'shell-staged'); assert.deepEqual(staged.problems, []);
    assert.deepEqual(staged.create.map((c) => [c.pattern, c.script]), [[sh.exclusion, null], [sh.homeSlash, w]], 'exclusion first, then the home with slash');
    cur = [...cur, ...staged.create.map((c) => route(n++, c.pattern, c.script))];
    assert.equal(routeState(cur, rel).stage, 'shell-staged'); assert.deepEqual(safetyProblems(cur, rel), []);
    const full = planApply(cur, rel, 'shell'); assert.deepEqual(full.problems, []);
    assert.equal(full.create.length, 6); assert.equal(full.create.at(-1).pattern, sh.broad, 'broad last'); assert.ok(full.create.every((c) => c.script === w));
    assert.equal(full.create.some((c) => c.pattern === sh.exclusion), false);
    cur = [...cur, ...full.create.map((c) => route(n++, c.pattern, c.script))];
    assert.equal(routeState(cur, rel).stage, 'shell'); assert.deepEqual(safetyProblems(cur, rel), []);
    assert.deepEqual(planApply(cur, rel, 'shell').create, [], 'idempotent');
    const foreign = [...cur, route(90, 'www.outro.com.br/x', 'zzz'), route(91, rel.store.inkHost + '/blog/*', 'zzz')];
    const retire = planRetire(foreign, rel, 'shell').remove.map((r) => r.pattern);
    assert.equal(retire.length, 8); assert.equal(retire.at(-1), sh.exclusion, 'exclusion is removed LAST'); assert.equal(retire.includes(rel.routePatterns[0]), false); assert.equal(retire.includes('www.outro.com.br/x'), false);
    assert.equal(retire.includes(rel.store.inkHost + '/blog/*'), false, 'a foreign route on the store host is never removed');
    const all = planRetire(foreign, rel, 'all').remove.map((r) => r.pattern); assert.equal(all.length, 10); assert.equal(all.at(-1), sh.exclusion);
    assert.throws(() => planRetire(cur, rel, 'tudo'), /escopo inválido/); assert.throws(() => planApply(cur, rel, 'casca'), /estágio inválido/);
    // half-applied states are "parcial" and never look final
    assert.equal(routeState([...cur.slice(0, 2), route(50, sh.broad, w)], rel).stage, 'parcial');
    assert.equal(routeState([...cur.slice(0, 2), route(50, sh.exclusion, w)], rel).stage, 'parcial', 'an exclusion WITH a Worker is a conflict');
    assert.match(planApply([...cur.slice(0, 2), route(50, sh.exclusion, w)], rel, 'shell-staged').problems.join(';'), /SEM Worker/);
  }
});

test('planRestore only removes routes we own on the store host; a foreign route on the host stays even if absent from the snapshot', () => {
  const rel = releaseStore('norte'); const w = rel.store.workerName;
  const snap = buildSnapshot({ rel, zoneId: ZONE.norte, routes: rel.routePatterns.map((p, i) => route(i + 1, p, w)) });
  const current = [...rel.routePatterns.map((p, i) => route(i + 1, p, w)), route(20, rel.shell.exclusion, null), route(21, rel.shell.broad, w), route(22, rel.store.inkHost + '/blog/*', 'zzz')];
  const plan = planRestore(snap, current, rel, { zoneId: ZONE.norte });
  assert.deepEqual(plan.remove.map((r) => r.pattern).sort(), [rel.shell.broad, rel.shell.exclusion].sort());
});

test('probeSet by stage: product-only keeps the shell pages native; shell-staged executes only the home with slash; shell executes the authorized shell pages and never login/cart/checkout', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const b = rel.store.inkBase; const col = SAMPLES[id].collection; assert.match(col, /^[a-z0-9-]+$/);
    const p = probeSet(rel, SAMPLES, 'product'); assert.ok(p.skip.includes(b) && p.skip.includes(`${b}/products`) && p.skip.includes(`${b}/orders`)); assert.equal(p.exec.some((x) => x === b || x.startsWith(b + '/orders')), false);
    const st = probeSet(rel, SAMPLES, 'shell-staged'); assert.ok(st.exec.includes(`${b}/`)); assert.ok(st.skip.includes(`${b}/products`) && st.skip.includes(b) && st.skip.includes(`${b}/orders`)); assert.ok(st.info.length >= 1);
    const sh = probeSet(rel, SAMPLES, 'shell');
    for (const x of [b, `${b}/`, `${b}?utm_source=probe`, `${b}/products`, `${b}/products?product_type=1`, `${b}/collections/${col}`, `${b}/about`, `${b}/orders/trackings`, `${b}/orders?x=1`, ...SAMPLES[id].allowlist]) assert.ok(sh.exec.includes(x), x);
    for (const x of [`${b}/cart`, `${b}/cart?x=1`, `${b}/checkout`, `${b}/checkout/contact_and_shipping_details?x=1`, `${b}/store_sessions/new`, `${b}/login`]) assert.ok(sh.skip.includes(x), x);
    assert.equal(sh.exec.some((x) => /cart|checkout|store_sessions|login/.test(x)), false);
    assert.throws(() => probeSet(rel, SAMPLES, 'x'), /estágio inválido/);
    assert.deepEqual(new Set([...sh.exec, ...sh.skip]).size, sh.exec.length + sh.skip.length, 'no path is both required and forbidden');
  }
});

test('evaluateStoreHealth with shell:true expects shell_pages true; the phrases for the shell release are per store and distinct from the others', () => {
  const rel = releaseStore('norte');
  const health = { service: rel.store.workerName, store: 'norte', store_status: 'ok', version: LOADER_VERSION, widget_mode: 'true', allowlist_status: 'ok', allowlist_size: 3, scope_mode: CATALOG, scope_status: 'ok', shell_pages: true, features_status: 'ok', widget_features: STORE_FEATURES, kv_bound: true };
  assert.equal(evaluateStoreHealth(health, rel, { scope: CATALOG, allowlistSize: 3, shell: true }).ok, true);
  assert.match(evaluateStoreHealth(health, rel, { scope: CATALOG, allowlistSize: 3 }).problems.join(';'), /shell_pages true/);
  assert.match(evaluateStoreHealth({ ...health, shell_pages: false }, rel, { scope: CATALOG, allowlistSize: 3, shell: true }).problems.join(';'), /shell_pages false/);
  const c = releaseStore('centro');
  assert.equal(new Set([rel.confirmPhrase, rel.rollbackPhrase, rel.shellPhrase, rel.shellRollbackPhrase, c.confirmPhrase, c.rollbackPhrase, c.shellPhrase, c.shellRollbackPhrase]).size, 8);
  assert.equal(rel.shellPhrase, 'PUBLICAR-CASCA-NORTE-INK');
});

test('resolveToml: without shell only the two product routes are kept; with shell all nine (wrangler deploy syncs Worker routes to the file); the exclusion is refused in the TOML', () => {
  for (const id of RELEASABLE) {
    const rel = releaseStore(id); const kv = 'abcdef0123456789abcdef0123456789';
    const off = resolveToml(toml(id), rel, kv); const on = resolveToml(toml(id), rel, kv, { shell: true });
    const patterns = (t) => [...t.matchAll(/^pattern = "([^"]+)"/gm)].map((m) => m[1]);
    assert.deepEqual(patterns(off), rel.routePatterns); assert.deepEqual(patterns(on), [...rel.routePatterns, ...rel.shell.workerRoutes]);
    assert.equal(patterns(on).includes(rel.shell.exclusion), false);
    assert.ok(off.includes(`id = "${kv}"`) && on.includes(`id = "${kv}"`)); assert.equal(off.includes('zone_name = "' + rel.zoneName + '"'), true);
    assert.equal((off.match(/\[\[kv_namespaces\]\]/g) || []).length, 1); assert.equal((off.match(/\[vars\]/g) || []).length, 1);
    assert.match(configProblems(toml(id) + `\n[[routes]]\npattern = "${rel.shell.exclusion}"\nzone_name = "${rel.zoneName}"\n`, rel).join(';'), /exclusão/);
  }
});
