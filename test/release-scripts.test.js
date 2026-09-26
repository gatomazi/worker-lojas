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
  assert.equal(real.length, 2, 'deploy_worker (release global, six features) and deploy_worker_navbar (release da navbar, test/release-navbar.test.js)');
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

// ── hotfix pós-release abortado: evidência antes do rollback, precondição do storefront, QA com navegação estável e falhas classificadas ──────
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const bash = (script, env = {}) => spawnSync('bash', ['-c', script], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, ...env } });

test('release: the exact gate reason and the evidence are saved BEFORE the rollback, which is never skipped; storefront reachability is checked before any deploy', () => {
  const r = read('scripts/release-global.sh');
  const failFn = r.match(/^fail\(\) \{.*$/m)[0];
  assert.ok(failFn.indexOf('capture_evidence') !== -1 && failFn.indexOf('capture_evidence') < failFn.indexOf('rollback "$1"'), 'evidence first, then rollback');
  assert.match(failFn, /\|\| true; rollback/, 'a failing evidence capture can never prevent the rollback');
  assert.match(r, /QA_EVIDENCE_DIR="\$EVID\/qa"/); assert.match(r, /tee "\$EVID\/qa-output\.log"/); assert.match(r, /QA_FALHA_CLASSIFICADA/);
  assert.ok(r.indexOf('storefront_ok || die') < r.indexOf('deploy_worker allowlist ||'), 'the storefront precondition comes before the first deploy (nothing to roll back)');
  assert.match(read('scripts/preflight-global.sh'), /storefront_ok/);
});

// Hermético: NADA de rede real nem de Wrangler autenticado (o teste antigo chamava `wrangler deployments list` de verdade e levava ~23 s,
// perto do limite de 30 s por teste: na máquina do proprietário estourou e bloqueou o preflight).
const HERMETIC = { UO_TEST_MODE: '1', UO_TEST_HEALTH_URL: 'http://127.0.0.1:9/health', UO_TEST_SITE_URL: 'http://127.0.0.1:9', UO_TEST_STOREFRONT_URL: 'http://127.0.0.1:9', UO_TEST_WRANGLER_CMD: 'echo wrangler-stub' };
test('capture_evidence writes reason/health/probes/deployments and returns even when everything else fails; run_limited enforces its time limit — hermetic and fast', () => {
  const dir = '/tmp/release-evidence-test-' + process.pid; const t0 = Date.now();
  const res = bash(`source scripts/global-common.sh; capture_evidence "${dir}" "smoke após B: FAIL exemplo"; echo rc=$?; cat "${dir}/reason.txt"; cat "${dir}/http-probes.txt"; cat "${dir}/deployments.txt"; ls "${dir}"`, HERMETIC);
  assert.match(res.stdout, /rc=0/); assert.match(res.stdout, /motivo exato do gate: smoke após B: FAIL exemplo/);
  assert.match(res.stdout, /storefront: .*http=000/); assert.match(res.stdout, /produto da allowlist: .*(http=000|Failed to connect|Connection refused)/i);
  assert.match(res.stdout, /wrangler-stub deployments list --name use-sul-widget/, 'the deployments listing goes through the (stubbed) wrangler command with the right arguments');
  for (const f of ['reason.txt', 'health.json', 'http-probes.txt', 'deployments.txt']) assert.match(res.stdout, new RegExp(f.replace('.', '\\.')));
  // Sem asserção de tempo: a correção da função não depende de velocidade, e uma máquina carregada (load average > 100 medido nesta rodada) tornava
  // qualquer limite de relógio uma fonte de falha intermitente. O teste é hermético (nada de rede/Wrangler), então o custo já é mínimo.
  bash(`rm -rf "${dir}"`);
  // run_limited: o comando de 90 s (folga p/ máquina muito carregada) é interrompido pelo limite de 1 s. Prova por EFEITO (o marcador do fim do comando nunca aparece) e pelo código de
  // saída não zero, sem medir relógio.
  const marker = '/tmp/run-limited-marker-' + process.pid;
  const lim = bash(`source scripts/global-common.sh; rm -f "${marker}"; run_limited 1 bash -c 'sleep 90; echo fim > "${marker}"'; echo rc=$?; [ -e "${marker}" ] && echo MARCADOR-EXISTE || echo comando-interrompido`);
  assert.match(lim.stdout, /rc=\d+/); assert.doesNotMatch(lim.stdout, /rc=0/); assert.match(lim.stdout, /comando-interrompido/); bash(`rm -f "${marker}"`);
});

test('the test-mode overrides are ignored WITHOUT UO_TEST_MODE: an exported URL/command can never redirect the release checks or the deploy tooling', () => {
  const res = bash('source scripts/global-common.sh; echo "$HEALTH_URL|$SITE_URL|$STOREFRONT_URL|$WRANGLER_CMD"', { UO_TEST_HEALTH_URL: 'http://evil/h', UO_TEST_SITE_URL: 'http://evil', UO_TEST_STOREFRONT_URL: 'http://evil', UO_TEST_WRANGLER_CMD: 'echo hacked', UO_TEST_MODE: '' });
  assert.equal(res.stdout.trim(), 'https://www.usesul.com.br/__origens/health|https://www.usesul.com.br|https://useorigens.com.br|npx wrangler');
  const deploy = read('scripts/global-common.sh').split('\n').filter((l) => /npx wrangler deploy -c/.test(l));
  assert.equal(deploy.length, 4, 'real deploy and dry-run of BOTH release kinds keep the literal command (not overridable)');
});

test('qa-global: product navigation does not depend on the load event; one bounded retry with an HTTP probe; failures are classified and leave evidence; snapshots are read patiently', () => {
  const q = read('scripts/qa-global.mjs');
  assert.doesNotMatch(q.slice(q.indexOf('async function gotoProduct'), q.indexOf('async function captureEvidence')), /waitUntil: 'load'/, 'gotoProduct never requires the load event');
  assert.match(q, /waitUntil: 'domcontentloaded'/); assert.match(q, /form\[id\^="form-product-"\]/); assert.match(q, /attempts = 2/);
  assert.match(q, /probeHttp\(/); assert.match(q, /QA_FALHA_CLASSIFICADA/); assert.match(q, /classe: \$\{kind\}/); assert.match(q, /'Storefront'/); assert.match(q, /'Worker'/); assert.match(q, /'INK'/);
  for (const name of ['framenavigated', 'requestfailed', 'pageerror', 'console']) assert.ok(q.includes(name), name);
  assert.match(q, /readRefPatient/); assert.match(q, /controlTotals/); assert.match(q, /widgetFree/);
  assert.match(q, /waitUntil: 'commit'/, 'arrival = commit + 200, independent of load and of analytics');
  assert.match(q, /function info\(/, 'analytics/URL-cleaning are informational, kept apart from the functional criterion');
});
