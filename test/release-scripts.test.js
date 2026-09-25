import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseActiveVersion, evaluateHealth, sameConfig, countLoaders, SIX_FEATURES } from '../scripts/lib/release-lib.mjs';

const V1 = '5790535f-b7f4-439e-beac-1a8ee257b050'; const V0 = '81ce3c6f-47f4-408f-a4f3-e168dc99d395';
const HEALTH = { service: 'use-sul-widget', version: '4.2', widget_mode: 'true', allowlist_status: 'ok', allowlist_size: 5, features_status: 'ok', widget_features: SIX_FEATURES };

test('parseActiveVersion: JSON (newest deployment at 100%) and the text format both resolve to the active version', () => {
  const json = JSON.stringify([{ created_on: '2026-09-24T21:00:00Z', versions: [{ version_id: V0, percentage: 100 }] }, { created_on: '2026-09-25T01:00:00Z', versions: [{ version_id: V1, percentage: 100 }] }]);
  assert.equal(parseActiveVersion(json), V1);
  assert.equal(parseActiveVersion(JSON.stringify({ deployments: [{ created_on: '2026-09-25T01:00:00Z', versions: [{ version_id: V1, percentage: 100 }] }] })), V1);
  const text = `Created:     2026-09-24T16:26:50.679Z\nVersion(s):  (100%) ${V0}\n\nCreated:     2026-09-24T21:09:53.517Z\nVersion(s):  (100%) ${V1}\n`;
  assert.equal(parseActiveVersion(text), V1);
  for (const bad of ['', 'not authenticated', '[]', '{"x":1}', null, undefined]) assert.equal(parseActiveVersion(bad), null, String(bad));
});

test('parseActiveVersion refuses a gradual deployment split (no single 100% version)', () => {
  const split = JSON.stringify([{ created_on: '2026-09-25T01:00:00Z', versions: [{ version_id: V1, percentage: 60 }, { version_id: V0, percentage: 40 }] }]);
  assert.equal(parseActiveVersion(split), null);
});

test('evaluateHealth: the protected state passes; anything else is reported precisely', () => {
  assert.deepEqual(evaluateHealth(HEALTH, 'allowlist'), { ok: true, problems: [] });
  assert.equal(evaluateHealth({ ...HEALTH, scope_mode: 'allowlist', scope_status: 'default' }, 'allowlist').ok, true);
  assert.equal(evaluateHealth({ ...HEALTH, version: '4.3', scope_mode: 'product-catalog', scope_status: 'ok' }, 'catalog', { loaderVersion: '4.3' }).ok, true);
  const noMirror = evaluateHealth({ ...HEALTH, widget_features: SIX_FEATURES.filter((f) => f !== 'cart-mirror') }, 'allowlist');
  assert.equal(noMirror.ok, false); assert.match(noMirror.problems.join(';'), /cart-mirror/);
  assert.match(evaluateHealth({ ...HEALTH, allowlist_size: 1 }, 'allowlist').problems.join(';'), /allowlist/);
  assert.match(evaluateHealth({ ...HEALTH, widget_mode: 'false' }, 'allowlist').problems.join(';'), /widget_mode/);
  assert.match(evaluateHealth(HEALTH, 'catalog').problems.join(';'), /scope_mode/);
  assert.match(evaluateHealth({ ...HEALTH, scope_mode: 'product-catalog' }, 'allowlist').problems.join(';'), /scope_mode/);
  assert.match(evaluateHealth({ ...HEALTH, scope_mode: 'allowlist', scope_status: 'invalid' }, 'allowlist').problems.join(';'), /invalid/);
  assert.equal(evaluateHealth(null, 'allowlist').ok, false); assert.match(evaluateHealth(HEALTH, 'allowlist', { loaderVersion: '9.9' }).problems.join(';'), /version/);
});

test('sameConfig confirms a rollback: identical scope, features and version; a different scope or version is not the same', () => {
  assert.equal(sameConfig(HEALTH, { ...HEALTH }), true);
  assert.equal(sameConfig(HEALTH, { ...HEALTH, scope_mode: 'allowlist' }), true, 'a health without scope_mode means the five-product scope');
  assert.equal(sameConfig(HEALTH, { ...HEALTH, scope_mode: 'product-catalog' }), false);
  assert.equal(sameConfig(HEALTH, { ...HEALTH, version: '4.3' }), false);
  assert.equal(sameConfig(HEALTH, { ...HEALTH, widget_features: SIX_FEATURES.slice(0, 5) }), false);
  assert.equal(sameConfig(HEALTH, null), false);
});

test('countLoaders counts the injected tag only', () => {
  assert.equal(countLoaders('<script src="/__origens/loader.js?v=4.3" defer></script>'), 1);
  assert.equal(countLoaders('<html></html>'), 0); assert.equal(countLoaders(null), 0);
});

// ── as travas dos scripts (sem rede e sem Wrangler: só leitura do texto e execução dos caminhos que NÃO publicam) ─────────────────────────
const sh = (args, env = {}) => spawnSync('bash', args, { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, ...env }, encoding: 'utf8', input: '' });

test('release-global.sh never publishes by default: no argument / unknown argument exit 2; --deploy without confirmation stops (no TTY)', () => {
  assert.equal(sh(['scripts/release-global.sh']).status, 2);
  assert.equal(sh(['scripts/release-global.sh', '--publish']).status, 2);
  const noConfirm = sh(['scripts/release-global.sh', '--deploy'], { RELEASE_CONFIRM: '', WORKERS_PAID_CONFIRMED: '' });
  assert.equal(noConfirm.status, 1); assert.match(noConfirm.stdout, /PARADO: sem terminal interativo e sem RELEASE_CONFIRM/);
  const wrongPhrase = sh(['scripts/release-global.sh', '--deploy'], { RELEASE_CONFIRM: 'sim', WORKERS_PAID_CONFIRMED: '1' });
  assert.equal(wrongPhrase.status, 1); assert.match(wrongPhrase.stdout, /PARADO/);
  const noPlan = sh(['scripts/release-global.sh', '--deploy'], { RELEASE_CONFIRM: 'PUBLICAR-CATALOGO-COMPLETO', WORKERS_PAID_CONFIRMED: '' });
  assert.equal(noPlan.status, 1); assert.match(noPlan.stdout, /WORKERS_PAID_CONFIRMED/);
  assert.equal(sh(['scripts/rollout-cart.sh']).status, 2, 'the obsolete rollout script is blocked');
});

test('every real deploy goes through deploy_worker with the FULL variable set; nothing else in scripts can publish', () => {
  const common = readFileSync(new URL('../scripts/global-common.sh', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../scripts/release-global.sh', import.meta.url), 'utf8');
  assert.equal((release.match(/wrangler deploy/g) || []).length, 0, 'release-global.sh calls deploy_worker only');
  const real = common.split('\n').filter((l) => /npx wrangler deploy -c/.test(l) && !/--dry-run/.test(l));
  assert.equal(real.length, 1);
  for (const needle of ['--var ENABLE_WIDGET:true', '--var "WIDGET_ALLOWLIST:$ALLOW"', '--var "WIDGET_FEATURES:$FEATURES"', '--var "WIDGET_SCOPE_MODE:$scope"']) assert.ok(real[0].includes(needle), needle);
  assert.match(common, /FEATURES="return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery"/);
  assert.match(common, /assert_deploy_vars "\$scope" \|\| return 1/);
  // o rollback restaura a versão CAPTURADA (com cart-mirror), nunca "a anterior" às cegas
  assert.match(release, /wrangler rollback "\$PREV_VERSION"/); assert.doesNotMatch(release, /wrangler rollback --name|rollback\s*$/m);
  for (const other of ['scripts/preflight-global.sh']) { const t = readFileSync(new URL('../' + other, import.meta.url), 'utf8'); assert.doesNotMatch(t, /npx wrangler (deploy(?! -c)|rollback|login)/, other); assert.match(t, /dry-run/); }
});

test('assert_deploy_vars refuses incomplete configurations (it is the gate in front of every deploy)', () => {
  const run = (setup) => spawnSync('bash', ['-c', `source scripts/global-common.sh; ${setup}; assert_deploy_vars product-catalog`], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
  assert.equal(run('true').status, 0);
  assert.equal(run('FEATURES="return-link,post-add-discovery,city-search,cart-discovery,product-discovery"').status, 1, 'without cart-mirror');
  assert.equal(run('FEATURES="return-link"').status, 1);
  assert.equal(run('ALLOW="/usesul/product/a"').status, 1, 'allowlist must keep exactly five paths');
  assert.equal(run('ALLOW="${ALLOW},/usesul/product/sexto"').status, 1, 'never widen the allowlist');
  assert.equal(spawnSync('bash', ['-c', 'source scripts/global-common.sh; assert_deploy_vars all'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }).status, 1);
});
