import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, TOML_ROUTES, WORKER, EXCLUSION, BROAD, diffRoutes, planToStage, planRestore, resolveRoute, matchesPattern, safetyProblems, probeSet, bySignature } from '../scripts/lib/routes-lib.mjs';
import { shellPageKind } from '../src/scope.js';

// Rotas da zona (modelo puro). A prova REAL de especificidade é o ensaio com wrangler tail (zone-routes.mjs rehearse); aqui se trava o desenho e a lógica de snapshot/restauração.
const zone = (stage, extra = []) => [...STAGES[stage].map((r, i) => ({ id: 'id' + i, pattern: r.pattern, script: r.worker ? WORKER : null })), ...extra];
const H = 'www.usesul.com.br';

test('final plan: the exclusion has no Worker, every other route has it, and none carries a query string (Cloudflare error 10022)', () => {
  assert.equal(EXCLUSION.worker, false);
  assert.deepEqual(STAGES.final.filter((r) => !r.worker).map((r) => r.pattern), [H + '/usesul/*']);
  assert.ok(STAGES.final.every((r) => !r.pattern.includes('?')));
  assert.equal(TOML_ROUTES.length, STAGES.final.length - 1, 'the TOML carries all with-Worker routes and never the exclusion');
  assert.ok(!TOML_ROUTES.includes(EXCLUSION.pattern));
});

test('design model: the exclusion beats the broad route for everything transactional, with and without query; the authorised pages still reach the Worker', () => {
  const routes = zone('final');
  const via = (u) => resolveRoute(routes, H + u);
  for (const u of ['/usesul/cart', '/usesul/cart?x=1', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details?x=1', '/usesul/store_sessions/new', '/usesul/store_sessions/new?next=%2Fusesul%2Forders', '/usesul/login?x=1', '/usesul/anything-else']) {
    assert.equal(via(u).script, null, u + ' must resolve to the route without Worker');
  }
  for (const u of ['/usesul', '/usesul?utm_source=x', '/usesul/', '/usesul/products', '/usesul/products?product_type=1', '/usesul/collections/novidades', '/usesul/about', '/usesul/orders', '/usesul/orders/trackings', '/usesul/product/serra-catarinense', '/__origens/health']) {
    assert.equal(via(u).script, WORKER, u + ' must reach the Worker');
  }
  // Lacuna conhecida e documentada: home com barra E query cai na exclusão (fail-open, cabeçalho nativo).
  assert.equal(via('/usesul/?utm_source=x').script, null);
});

test('code layer stays independent of the routes: pathname is exact, so even a Worker call on a transactional path does nothing', () => {
  for (const p of ['/usesul/cart', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/usesul/store_sessions/new', '/usesul/login', '/usesul/orders/1/2', '/usesul/orders/1/checkout', '/usesulfoo', '/usesul/collections', '/usesul/%63art']) {
    assert.equal(shellPageKind(p, '/usesul'), null, p);
  }
  assert.equal(shellPageKind('/usesul', '/usesul'), 'home');
  assert.equal(shellPageKind('/usesul/', '/usesul'), 'home');
});

test('diffRoutes: reports missing, extra and wrong Worker; a route that gains a Worker on the exclusion is a failure', () => {
  assert.equal(diffRoutes(zone('baseline'), 'baseline').ok, true);
  const d = diffRoutes(zone('baseline'), 'final');
  assert.deepEqual(d.missing.sort(), [EXCLUSION.pattern, BROAD.pattern, H + '/usesul/'].sort());
  const withWorker = zone('final').map((r) => (r.pattern === EXCLUSION.pattern ? { ...r, script: WORKER } : r));
  assert.match(diffRoutes(withWorker, 'final').wrongScript.join(), /SEM Worker/);
  assert.match(diffRoutes(zone('final', [{ id: 'x', pattern: H + '/usesul/cart', script: WORKER }]), 'final').extra.join(), /usesul\/cart/);
});

test('safetyProblems: a with-Worker route outside the authorised list, or the broad route without the exclusion, is blocked', () => {
  assert.deepEqual(safetyProblems(zone('final')), []);
  assert.match(safetyProblems([...zone('baseline'), { id: 'b', pattern: BROAD.pattern, script: WORKER }]).join(), /SEM a exclusão/);
  assert.match(safetyProblems([...zone('final'), { id: 'x', pattern: H + '/usesul/cart', script: WORKER }]).join(), /fora da lista autorizada/);
  assert.match(safetyProblems([...zone('final'), { id: 'y', pattern: H + '/usesul/checkout*', script: WORKER }]).join(), /fora da lista autorizada/);
});

test('planToStage creates only what is missing and refuses to overwrite: the exclusion with a Worker, or one of our routes bound to another script, blocks', () => {
  const p = planToStage(zone('baseline'), 'staged');
  assert.deepEqual(p.create.map((r) => r.pattern).sort(), [EXCLUSION.pattern, H + '/usesul/'].sort());
  assert.deepEqual(p.problems, []);
  assert.deepEqual(planToStage(zone('staged'), 'staged').create, []);
  assert.match(planToStage(zone('staged').map((r) => (r.pattern === EXCLUSION.pattern ? { ...r, script: WORKER } : r)), 'staged').problems.join(), /COM Worker/);
  assert.match(planToStage(zone('baseline').map((r, i) => (i === 0 ? { ...r, script: 'other-store-worker' } : r)), 'staged').problems.join(), /other-store-worker/);
});

test('planRestore: removes our new routes, recreates missing ones, fixes changed scripts, and never touches other hosts', () => {
  const snapshot = zone('baseline');
  const current = [...zone('final'), { id: 'foreign', pattern: 'loja-x.example.com/*', script: 'other' }];
  const r = planRestore(snapshot, current);
  assert.deepEqual(r.remove.map((x) => x.pattern).sort(), [EXCLUSION.pattern, BROAD.pattern, H + '/usesul/'].sort());
  assert.ok(!r.remove.some((x) => x.id === 'foreign'), 'other hosts are never removed');
  assert.deepEqual(r.create, []);
  const lost = planRestore(snapshot, snapshot.slice(1));
  assert.equal(lost.create.length, 1);
  const changed = planRestore(snapshot, snapshot.map((x, i) => (i === 0 ? { ...x, script: null } : x)));
  assert.equal(changed.update.length, 1);
  assert.equal(changed.update[0].script, WORKER);
  assert.deepEqual(bySignature(planRestore(snapshot, snapshot).remove), []);
});

test('planRestore refuses an unreadable, empty or Worker-less snapshot instead of deleting every route', () => {
  for (const bad of [undefined, null, {}, [], [{ id: 'x', pattern: H + '/usesul/*', script: null }], [{ id: 'y', pattern: 'loja-x.example.com/*', script: 'other' }]]) assert.throws(() => planRestore(bad, zone('final')), /restauração recusada/);
});

test('probeSet: transactional probes always include query-string variants; the final stage adds the home forms; the gap is informational', () => {
  const s = probeSet('final');
  for (const u of ['/usesul/cart?x=1', '/usesul/checkout/contact_and_shipping_details?x=1', '/usesul/store_sessions/new?next=%2Fusesul%2Forders', '/usesul/login?x=1']) assert.ok(s.skip.includes(u), u);
  for (const u of ['/usesul', '/usesul?utm_source=probe', '/usesul/']) assert.ok(s.exec.includes(u), u);
  assert.deepEqual(s.info, ['/usesul/?utm_source=probe']);
  assert.ok(!probeSet('baseline').exec.includes('/usesul/'), 'the baseline has no trailing-slash route yet');
  assert.ok(probeSet('final', '/usesul-rt').exec.every((u) => u.startsWith('/usesul-rt')), 'the rehearsal prefix is harmless');
});

test('matchesPattern: * spans / and ?, everything else is literal (dots are not wildcards)', () => {
  assert.equal(matchesPattern(H + '/usesul*', H + '/usesul?a=1'), true);
  assert.equal(matchesPattern(H + '/usesul', H + '/usesul?a=1'), false);
  assert.equal(matchesPattern(H + '/usesul/', H + '/usesul/'), true);
  assert.equal(matchesPattern('www.usesul.com.br/x', 'wwwXusesulYcomZbr/x'), false);
});
