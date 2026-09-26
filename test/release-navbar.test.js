import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluateHealth, parseVersionBindings, planNavbarRelease, sameNavbarConfig, SIX_FEATURES, SEVEN_FEATURES, FIVE_SLUGS } from '../scripts/lib/release-lib.mjs';

// Release da navbar: seis features + header-nav, configuração REAL capturada, sem relaxar nada do release global.
const ALLOW = FIVE_SLUGS.map((s) => '/usesul/product/' + s);
const health = (over = {}) => ({ service: 'use-sul-widget', version: '4.3', widget_mode: 'true', allowlist_status: 'ok', allowlist_size: 5, scope_mode: 'product-catalog', scope_status: 'ok', features_status: 'ok', widget_features: SIX_FEATURES, ...over });
const vars = (over = {}) => ({ ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW.join(','), WIDGET_FEATURES: SIX_FEATURES.join(','), WIDGET_SCOPE_MODE: 'product-catalog', ...over });
const captured = (v = vars(), bindings = [{ type: 'kv_namespace', name: 'CART_REFS' }]) => ({ vars: v, bindings });
const plan = (over = {}) => planNavbarRelease({ health: health(), captured: captured(), tomlBindings: ['CART_REFS'], ...over });

test('evaluateHealth: exactly the six by default, exactly the seven for the navbar state; one more or one less is always reported', () => {
  assert.equal(evaluateHealth(health(), 'catalog').ok, true);
  const seven = health({ widget_features: SEVEN_FEATURES });
  assert.match(evaluateHealth(seven, 'catalog').problems.join(';'), /feature inesperada: header-nav/, 'the six-feature state refuses header-nav (a generic deploy can never sneak it in)');
  assert.equal(evaluateHealth(seven, 'catalog', { features: SEVEN_FEATURES }).ok, true);
  assert.match(evaluateHealth(health(), 'catalog', { features: SEVEN_FEATURES }).problems.join(';'), /feature ausente: header-nav/);
  const noMirror = evaluateHealth(health({ widget_features: SEVEN_FEATURES.filter((f) => f !== 'cart-mirror') }), 'catalog', { features: SEVEN_FEATURES });
  assert.match(noMirror.problems.join(';'), /cart-mirror/, 'the six stay mandatory in the seven-feature state');
  assert.match(evaluateHealth(health({ widget_features: [...SEVEN_FEATURES, 'evil'] }), 'catalog', { features: SEVEN_FEATURES }).problems.join(';'), /inesperada: evil/);
  assert.equal(evaluateHealth(health({ allowlist_size: 8 }), 'catalog', { allowlistSize: 8 }).ok, true, 'the allowlist size is the CAPTURED one, not a presumed five');
  assert.equal(evaluateHealth(health({ allowlist_size: 8 }), 'catalog').ok, false);
});

test('parseVersionBindings: finds vars and non-var bindings at any depth of the JSON; refuses anything it cannot read', () => {
  const api = { id: 'v', resources: { script: {}, bindings: [{ type: 'plain_text', name: 'ENABLE_WIDGET', text: 'true' }, { type: 'plain_text', name: 'WIDGET_FEATURES', text: 'a,b' }, { type: 'kv_namespace', name: 'CART_REFS', namespace_id: 'x' }] } };
  assert.deepEqual(parseVersionBindings(JSON.stringify(api)), { vars: { ENABLE_WIDGET: 'true', WIDGET_FEATURES: 'a,b' }, bindings: [{ type: 'kv_namespace', name: 'CART_REFS' }] });
  assert.deepEqual(parseVersionBindings(JSON.stringify({ bindings: [{ type: 'plain_text', name: 'X', value: 'y' }] })).vars, { X: 'y' });
  for (const bad of ['', 'not json', '{}', '{"bindings":"x"}', '{"bindings":[1]}', null, undefined]) assert.equal(parseVersionBindings(bad), null, String(bad));
});

test('planNavbarRelease: preserves the captured scope, allowlist and ENABLE_WIDGET and adds ONLY header-nav', () => {
  const p = plan();
  assert.equal(p.ok, true);
  assert.deepEqual(p.deploy, { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW.join(','), WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_FEATURES: SEVEN_FEATURES.join(','), expect: 'catalog', allowlistSize: 5 });
  // production still on the five-product scope? then that is what is preserved (nothing is presumed either way)
  const five = planNavbarRelease({ health: health({ scope_mode: 'allowlist' }), captured: captured(vars({ WIDGET_SCOPE_MODE: 'allowlist' })), tomlBindings: ['CART_REFS'] });
  assert.equal(five.ok, true); assert.equal(five.deploy.WIDGET_SCOPE_MODE, 'allowlist'); assert.equal(five.deploy.expect, 'allowlist');
  // a different allowlist size than five is preserved and cross-checked with the health
  const three = planNavbarRelease({ health: health({ allowlist_size: 3 }), captured: captured(vars({ WIDGET_ALLOWLIST: ALLOW.slice(0, 3).join(',') })), tomlBindings: ['CART_REFS'] });
  assert.equal(three.ok, true); assert.equal(three.deploy.allowlistSize, 3); assert.equal(three.deploy.WIDGET_ALLOWLIST, ALLOW.slice(0, 3).join(','));
  // a missing scope var means the five-product scope, like the Worker itself
  assert.equal(planNavbarRelease({ health: health({ scope_mode: undefined }), captured: captured(vars({ WIDGET_SCOPE_MODE: undefined })), tomlBindings: ['CART_REFS'] }).deploy.WIDGET_SCOPE_MODE, 'allowlist');
});

test('planNavbarRelease refuses (and publishes nothing) whenever production is not exactly what the release expects', () => {
  const refuse = (over, re) => { const p = plan(over); assert.equal(p.ok, false); assert.equal(p.deploy, null); assert.match(p.problems.join(' | '), re); };
  refuse({ captured: captured(vars({ WIDGET_FEATURES: SEVEN_FEATURES.join(',') })) }, /header-nav JÁ está ativa/);
  refuse({ captured: captured(vars({ WIDGET_FEATURES: SIX_FEATURES.slice(0, 5).join(',') })) }, /exatamente as seis/);
  refuse({ captured: captured(vars({ WIDGET_FEATURES: [...SIX_FEATURES, 'evil'].join(',') })) }, /exatamente as seis/);
  refuse({ captured: captured(vars({ ENABLE_WIDGET: 'dry-run' })) }, /ENABLE_WIDGET/);
  refuse({ captured: captured(vars({ WIDGET_SCOPE_MODE: 'everything' })) }, /WIDGET_SCOPE_MODE/);
  refuse({ captured: captured(vars({ WIDGET_ALLOWLIST: '' })) }, /ALLOWLIST/);
  refuse({ captured: captured(vars({ WIDGET_ALLOWLIST: '/usesul/product/ok,/usesul/product/../x' })) }, /ALLOWLIST/);
  refuse({ captured: captured(vars({ WIDGET_ALLOWLIST: ALLOW[0] + ',' + ALLOW[0] })) }, /ALLOWLIST/);
  refuse({ health: health({ scope_mode: 'allowlist' }) }, /health x captura: scope_mode/);
  refuse({ health: health({ allowlist_size: 4 }) }, /health x captura: allowlist/);
  refuse({ health: health({ widget_features: SIX_FEATURES.slice(0, 5) }) }, /health x captura/);
  refuse({ health: health({ widget_mode: 'false' }) }, /widget_mode/);
  refuse({ health: null }, /health ilegível/);
  refuse({ captured: null }, /ilegíveis/);
  refuse({ captured: captured(vars(), [{ type: 'kv_namespace', name: 'CART_REFS' }, { type: 'kv_namespace', name: 'OUTRO' }]) }, /bindings da versão ativa/);
  refuse({ tomlBindings: ['CART_REFS', 'NOVO'] }, /bindings da versão ativa/);
});

test('sameNavbarConfig: after the deploy only header-nav may differ; after a rollback nothing may', () => {
  const before = health();
  assert.equal(sameNavbarConfig(before, health({ version: '4.4', widget_features: SEVEN_FEATURES }), { withNavbar: true }), true);
  assert.equal(sameNavbarConfig(before, health({ version: '4.4', widget_features: SEVEN_FEATURES, scope_mode: 'allowlist' }), { withNavbar: true }), false, 'scope changed');
  assert.equal(sameNavbarConfig(before, health({ version: '4.4', widget_features: SEVEN_FEATURES, allowlist_size: 4 }), { withNavbar: true }), false, 'allowlist changed');
  assert.equal(sameNavbarConfig(before, health({ version: '4.4', widget_features: SIX_FEATURES }), { withNavbar: true }), false, 'header-nav did not turn on');
  assert.equal(sameNavbarConfig(before, health(), { withNavbar: false }), true);
  assert.equal(sameNavbarConfig(before, health({ version: '4.4' }), { withNavbar: false }), false, 'a rollback must restore the captured version');
  assert.equal(sameNavbarConfig(null, before, { withNavbar: false }), false);
});

// ── shell: sem rede real, sem Wrangler autenticado ────────────────────────────────────────────────────────────────────────────────────
const cwd = new URL('..', import.meta.url).pathname;
const bash = (script, env = {}) => spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', input: '', env: { ...process.env, ...env } });
const HERMETIC = { UO_TEST_MODE: '1', UO_TEST_HEALTH_URL: 'http://127.0.0.1:9/health', UO_TEST_SITE_URL: 'http://127.0.0.1:9', UO_TEST_STOREFRONT_URL: 'http://127.0.0.1:9', UO_TEST_WRANGLER_CMD: 'bash test/fixtures/wrangler-stub.sh' };

test('release-navbar.sh never publishes by default: no argument / unknown argument exit 2; --deploy stops before any deploy when production prerequisites fail', () => {
  const none = bash('bash scripts/release-navbar.sh'); assert.equal(none.status, 2); assert.match(none.stdout, /Nada foi feito/);
  assert.equal(bash('bash scripts/release-navbar.sh --publish').status, 2);
  assert.equal(bash('bash scripts/release-navbar.sh --help').status, 0);
  // hermetic: the storefront/health are unreachable => the prerequisites fail and --deploy dies with PARADO, never reaching a confirmation or a deploy
  const dep = bash('bash scripts/release-navbar.sh --deploy', { ...HERMETIC, RELEASE_CONFIRM: 'PUBLICAR-NAVBAR-INK' });
  assert.equal(dep.status, 1); assert.match(dep.stdout, /PARADO: pré-condições em produção reprovadas/); assert.doesNotMatch(dep.stdout, /deploy da navbar|A\. captura/);
  const chk = bash('bash scripts/release-navbar.sh --check', HERMETIC);
  assert.equal(chk.status, 1); assert.match(chk.stdout, /BLOCKED/); assert.match(chk.stdout, /\/api\/navbar\/sul indisponível/);
});

test('the only real `wrangler deploy` lines live in global-common.sh, one per release kind, each with the FULL variable set; the navbar one takes the CAPTURED allowlist/scope', () => {
  const common = readFileSync(new URL('../scripts/global-common.sh', import.meta.url), 'utf8');
  const real = common.split('\n').filter((l) => /npx wrangler deploy -c/.test(l) && !/--dry-run/.test(l));
  assert.equal(real.length, 2);
  for (const needle of ['--var ENABLE_WIDGET:true', '--var "WIDGET_ALLOWLIST:$ALLOW"', '--var "WIDGET_FEATURES:$FEATURES"', '--var "WIDGET_SCOPE_MODE:$scope"']) assert.ok(real[0].includes(needle), needle);
  for (const needle of ['--var ENABLE_WIDGET:true', '--var "WIDGET_ALLOWLIST:$allow"', '--var "WIDGET_FEATURES:$NAVBAR_FEATURES"', '--var "WIDGET_SCOPE_MODE:$scope"']) assert.ok(real[1].includes(needle), needle);
  assert.match(common, /NAVBAR_FEATURES="\$FEATURES,header-nav"/);
  for (const file of ['scripts/release-navbar.sh', 'scripts/release-global.sh', 'scripts/preflight-global.sh']) assert.equal((readFileSync(new URL('../' + file, import.meta.url), 'utf8').match(/^[^#\n]*npx wrangler deploy/gm) || []).length, 0, file + ' calls the deploy functions only');
  // the generic release still refuses a seventh feature, and the TOML stays fail-closed (a bare deploy can never enable header-nav)
  assert.equal(bash('source scripts/global-common.sh; FEATURES="$FEATURES,header-nav"; assert_deploy_vars product-catalog').status, 1);
  assert.match(readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8'), /^WIDGET_FEATURES = "return-link"$/m);
  assert.doesNotMatch(readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8'), /header-nav/);
});

test('assert_navbar_deploy_vars: exactly the six + header-nav, a valid captured allowlist and scope, CART_REFS; anything else is refused', () => {
  const run = (setup, allow = '/usesul/product/a-b', scope = 'product-catalog') => bash(`source scripts/global-common.sh; ${setup}; assert_navbar_deploy_vars "${allow}" "${scope}"`);
  assert.equal(run('true').status, 0);
  assert.equal(run('true', '/usesul/product/a-b,/usesul/product/c_d', 'allowlist').status, 0, 'the scope of production is preserved, either one');
  assert.equal(run('NAVBAR_FEATURES="$FEATURES"').status, 1, 'six only');
  assert.equal(run('NAVBAR_FEATURES="$FEATURES,header-nav,evil"').status, 1, 'eight');
  assert.equal(run('NAVBAR_FEATURES="header-nav,$FEATURES"').status, 1, 'order is part of the contract');
  assert.equal(run('FEATURES="return-link,post-add-discovery,city-search,cart-discovery,product-discovery"; NAVBAR_FEATURES="$FEATURES,header-nav"').status, 1, 'cart-mirror is still mandatory');
  assert.equal(run('true', '').status, 1); assert.equal(run('true', '/usesul/product/../x').status, 1); assert.equal(run('true', '/usesul/products').status, 1);
  assert.equal(run('true', '/usesul/product/a-b', 'everything').status, 1);
  assert.equal(bash('source scripts/global-common.sh; assert_navbar_deploy_vars "/usesul/product/a" allowlist; echo $?').stdout.trim(), '0');
});

test('capture_navbar_plan reads the ACTIVE version through wrangler (stubbed) and prints the plan; a stale or odd production stops it (exit 1, nothing else)', () => {
  const version = (v, bindings = [{ type: 'kv_namespace', name: 'CART_REFS' }]) => JSON.stringify({ resources: { bindings: [...Object.entries(v).map(([name, text]) => ({ type: 'plain_text', name, text })), ...bindings] } });
  const run = (stub, h = health()) => bash('source scripts/global-common.sh; capture_navbar_plan 5790535f-b7f4-439e-beac-1a8ee257b050 "$H"', { ...HERMETIC, STUB_VERSION_JSON: stub, H: JSON.stringify(h) });
  const good = run(version(vars()));
  assert.equal(good.status, 0, good.stderr + good.stdout); assert.deepEqual(JSON.parse(good.stdout.trim().split('\n').pop()), { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW.join(','), WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_FEATURES: SEVEN_FEATURES.join(','), expect: 'catalog', allowlistSize: 5 });
  const already = run(version(vars({ WIDGET_FEATURES: SEVEN_FEATURES.join(',') }))); assert.equal(already.status, 1); assert.match(already.stdout + already.stderr, /JÁ está ativa/);
  const drift = run(version(vars()), health({ scope_mode: 'allowlist' })); assert.equal(drift.status, 1); assert.match(drift.stdout + drift.stderr, /health x captura/);
  assert.equal(run('', health()).status, 1, 'wrangler could not read the version');
  assert.equal(run('{"nothing":true}').status, 1, 'unreadable bindings are never guessed');
});

test('deploy_worker_navbar compiles the real bundle with the seven features and the preserved configuration (dry-run: no login, nothing published)', () => {
  const res = bash('source scripts/global-common.sh; deploy_worker_navbar "/usesul/product/serra-catarinense" product-catalog --dry-run', { TMPDIR: '/tmp' });
  assert.equal(res.status, 0, res.stdout.slice(-400) + res.stderr.slice(-400));
  assert.match(res.stdout, /WIDGET_FEATURES=return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav/);
  assert.match(res.stdout, /WIDGET_SCOPE_MODE=product-catalog \(preservado da produção\)/); assert.match(res.stdout, /--dry-run|Total Upload/);
});
