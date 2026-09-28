#!/usr/bin/env node
// RELEASE DE UMA LOJA (norte | centro): um comando, UM Worker. Nunca toca na Use Sul nem na outra loja; nunca faz push/merge.
//
//   node scripts/release-store.mjs <norte|centro> --check       SOMENTE LEITURA: pré-condições (storefront, INK, Cloudflare, Wrangler), plano, dry-run local. Exit 0 = APTO.
//   node scripts/release-store.mjs <norte|centro> --deploy      ÚNICA forma de publicar. Trava dupla: --deploy E a frase de confirmação (RELEASE_CONFIRM=PUBLICAR-<LOJA>-INK ou digitada).
//   node scripts/release-store.mjs <norte|centro> --rollback    desfaz a loja: volta à fase anterior ou, se só houve a 1ª fase, retira as duas rotas (frase REVERTER-<LOJA>-INK).
//
// Exige `npx wrangler login` FEITO PELO PROPRIETÁRIO (OAuth) na conta esperada. Credenciais nunca são pedidas nem impressas.
// Ordem do --deploy (cada passo é conferido antes do próximo; qualquer falha crítica => evidência ANTES, depois desfazer SÓ esta loja):
//   0. --check completo (sem nenhum FAIL)
//   1. snapshot das rotas da zona DA LOJA (schema, contagem, digest; validado; ilegível/divergente bloqueia tudo)
//   2. KV `use-<loja>-cart-refs` (cria só se não existir) e TOML resolvido com o id REAL em .release/<loja>/
//   3. FASE 1 (conservadora): Worker + duas rotas, escopo allowlist com 3 produtos reais, oito features; espera de propagação; health, rotas, execução (wrangler tail), smoke
//   4. FASE 2: escopo product-catalog SÓ neste domínio; health, smoke e QA em navegador REAL ao vivo (1280/390/320, carrinho real, cart_ref, negativos)
//   5. falha na fase 2 => `wrangler rollback` para a versão da fase 1; falha na fase 1 => `store-routes.mjs retire` (rotas voltam ao snapshot). A outra loja e a Sul nunca são tocadas.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { STORES } from '../src/stores.js';
import { LOADER_VERSION } from '../src/loader-source.js';
import { cf, zoneOf, listRoutes } from './lib/cf-api.mjs';
import { parseActiveVersion } from './lib/release-lib.mjs';
import { releaseStore, configProblems, resolveToml, releaseVars, deployArgs, buildSnapshot, validateSnapshot, routeState, safetyProblems, evaluateStoreHealth, countLoaders, probeSet, STORE_FEATURES, CONSERVATIVE, CATALOG } from './lib/store-lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const EXPECTED_ACCOUNT_EMAIL = process.env.EXPECTED_ACCOUNT_EMAIL || 'tomazi.brand@gmail.com';
const PROPAGATION_WAIT_S = Number(process.env.ROUTES_PROPAGATION_WAIT || 50); // medido na Use Sul: rota nova leva mais de 8 s para valer
const [, , storeId, mode] = process.argv;
const log = (...a) => console.log(...a);
const usage = () => log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
if (!['--check', '--deploy', '--rollback'].includes(mode)) { usage(); log('\nNada foi feito (falta --check, --deploy ou --rollback).'); process.exit(2); }
let rel; try { rel = releaseStore(storeId); } catch (e) { log(e.message); process.exit(2); }
const { store } = rel;
const SAMPLES = JSON.parse(readFileSync(new URL('./store-samples.json', import.meta.url), 'utf8'));
const WORK = `${ROOT}/.release/${rel.id}`; mkdirSync(WORK, { recursive: true, mode: 0o700 });
const HOST = 'https://' + store.inkHost;
// O TOML resolvido fica na RAIZ (o `main` do Wrangler é relativo ao arquivo) e é ignorado pelo git (.gitignore: wrangler.*.resolved.toml).
const RESOLVED = `${ROOT}/wrangler.${rel.id}.resolved.toml`;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const FAILS = []; const WARNS = []; const NEEDS = [];
const ok = (m) => log('  OK    ' + m); const warn = (m) => { WARNS.push(m); log('  WARN  ' + m); }; const bad = (m) => { FAILS.push(m); log('  FAIL  ' + m); };
const need = (m) => { NEEDS.push(m); log('  CRIA  ' + m + '   (criado pelo --deploy, só com a sua confirmação)'); };
const die = (m) => { log('PARADO: ' + m); process.exit(1); };

function run(cmd, args, { timeout = 180000, input, cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, input, maxBuffer: 20 * 1024 * 1024 });
  return { code: r.status === null ? 124 : r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const wrangler = (args, opts) => run('npx', ['wrangler', ...args], opts);
const jsonFrom = (text) => { const i = text.search(/[\[{]/); if (i < 0) return null; try { return JSON.parse(text.slice(i)); } catch (_) { return null; } };
const get = async (url, init = {}) => { try { return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init }); } catch (_) { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const healthNow = async () => { const r = await get(HOST + '/__origens/health'); if (!r || r.status !== 200 || !/json/i.test(r.headers.get('content-type') || '')) return null; return r.json().catch(() => null); };

// ── A. configuração local (sem rede) ────────────────────────────────────────────────────────────────────────────────────────────────────────
function staticChecks() {
  log('== configuração local ==');
  const toml = readFileSync(`${ROOT}/${rel.tomlFile}`, 'utf8');
  const problems = configProblems(toml, rel);
  problems.length ? problems.forEach((p) => bad('TOML: ' + p)) : ok(`${rel.tomlFile}: Worker ${store.workerName}, STORE_ID=${rel.id}, 2 rotas (produto + /__origens), KV ${store.kvBinding}, fail-closed`);
  const list = SAMPLES[rel.id].allowlist;
  list.length >= 3 && list.every((p) => p.startsWith(store.inkBase + '/product/')) ? ok(`${list.length} produtos reais de amostra (${list.map((p) => p.slice(store.inkBase.length + 9, store.inkBase.length + 29)).join(', ')}…)`) : bad('amostras insuficientes em scripts/store-samples.json');
  const git = run('git', ['status', '--porcelain', '--', 'src', 'scripts', `${rel.tomlFile}`]);
  git.stdout.trim() ? warn('há alterações NÃO commitadas em src/scripts/TOML: o release deve sair de um commit conhecido') : ok(`árvore limpa em src/scripts/TOML (${run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()}, branch ${run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()}); loader ${LOADER_VERSION}`);
  return toml;
}
// ── B. storefront (somente leitura) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function storefrontChecks() {
  log(`== storefront regional (${store.storefront}${store.storefrontBase}) ==`);
  const nav = await get(store.storefront + store.navbarApi); const navJson = nav && nav.status === 200 ? await nav.json().catch(() => null) : null;
  const statesOk = navJson && navJson.v === 2 && navJson.region === store.region && Array.isArray(navJson.states) && navJson.states.length === store.ufs.length && navJson.states.every((s) => store.ufs.includes(s.uf) && s.path === store.storefrontBase + '/' + s.uf.toLowerCase());
  statesOk ? ok(`${store.navbarApi} (v2): ${navJson.states.length} estados; coleções: ${navJson.top.length} no topo, ${navJson.more.length} em demais`) : bad(`${store.navbarApi} indisponível ou fora do contrato v2 da região`);
  if (statesOk && navJson.top.length + navJson.more.length === 0) warn(`o CMS de ${rel.id} não tem coleções em "Topo"/"Demais" (a navbar monta só com logo, Regiões, Cidades e busca; configure no CMS, sem deploy do Worker)`);
  const cities = await get(store.storefront + store.citiesApi); const cj = cities && cities.status === 200 ? await cities.json().catch(() => null) : null;
  Array.isArray(cj) && cj.length >= 100 && cj.every((c) => store.ufs.includes(c.u)) ? ok(`${store.citiesApi}: ${cj.length} cidades, todas de ${store.ufs.join('/')}`) : bad(`${store.citiesApi} indisponível ou com UF fora da região`);
  const q = SAMPLES[rel.id].search.query; const busca = await get(`${store.storefront}${store.storefrontBase}/busca?q=${q}`);
  busca && busca.status === 200 ? ok(`${store.storefrontBase}/busca?q=${q}: 200`) : bad(`${store.storefrontBase}/busca?q=${q}: HTTP ${busca && busca.status}`);
  const ml = await get(`${store.storefront}${store.storefrontBase}/meus-lugares`); ml && ml.status === 200 ? ok(`${store.storefrontBase}/meus-lugares: 200 (list-session)`) : warn(`${store.storefrontBase}/meus-lugares: HTTP ${ml && ml.status}`);
  log('  INFO  espelho do carrinho: o storefront precisa consultar o Worker DESTA região (PR regional do storefront). Só o QA ao vivo prova a volta ao carrinho; sem ele, o QA reprova [Storefront].');
}
// ── C. INK real (somente leitura) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function inkChecks() {
  log(`== INK real (${store.inkHost}) ==`);
  for (const path of SAMPLES[rel.id].allowlist) {
    const r = await get(HOST + path); const html = r && r.status === 200 ? await r.text() : '';
    r && r.status === 200 && /id="form-product-\d+"/.test(html) ? ok(`${path.slice(0, 60)}: 200 com formulário nativo` + (html.includes('data-use-origens-widget') ? ' (JÁ traz o loader: release em andamento?)' : '')) : bad(`${path}: HTTP ${r && r.status} ou sem formulário nativo de compra`);
  }
  for (const path of [`${store.inkBase}/cart`, `${store.inkBase}/store_sessions/new`, `${store.inkBase}/products`]) { const r = await get(HOST + path); r && r.status < 500 ? ok(`${path}: HTTP ${r.status} (nativo)`) : bad(`${path}: HTTP ${r && r.status}`); }
}
// ── D. Cloudflare + Wrangler ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function cloudflareChecks() {
  log('== Cloudflare / Wrangler ==');
  const who = wrangler(['whoami']);
  who.out.includes(EXPECTED_ACCOUNT_EMAIL) ? ok(`wrangler autenticado como ${EXPECTED_ACCOUNT_EMAIL}`) : bad('wrangler NÃO autenticado como ' + EXPECTED_ACCOUNT_EMAIL + ' (o proprietário roda `npx wrangler login`)');
  let zone; let sul;
  try {
    zone = await zoneOf(rel.zoneName); sul = await zoneOf('usesul.com.br');
    zone.status === 'active' ? ok(`zona ${rel.zoneName} ativa`) : bad(`zona ${rel.zoneName}: ${zone.status}`);
    zone.account === sul.account ? ok('a zona está na MESMA conta Workers Paid da Use Sul (franquias de Worker/KV compartilhadas)') : bad('a zona está em OUTRA conta');
    const routes = await listRoutes(zone.id); const st = routeState(routes, rel); const sp = safetyProblems(routes, rel);
    sp.length || st.conflicts.length ? [...sp, ...st.conflicts].forEach((p) => bad('rotas: ' + p)) : ok(`rotas da zona: estágio '${st.stage}' (${routes.length} rota(s) na zona)` + (st.foreignOnStoreHost.length ? `; outras no host da loja (intocadas): ${st.foreignOnStoreHost.join(', ')}` : ''));
    const snap = buildSnapshot({ rel, zoneId: zone.id, routes }); const v = validateSnapshot(snap, rel, { zoneId: zone.id });
    v.ok ? ok(`snapshot das rotas capturável e VÁLIDO (${snap.count} rota(s), digest ${snap.digest.slice(0, 12)}…)`) : bad('snapshot inválido: ' + v.problems.join('; '));
  } catch (e) { bad('Cloudflare (API): ' + e.message); }
  // O host precisa estar PROXIED: rota de Worker só vale para tráfego que passa pela Cloudflare.
  const head = await get(`${HOST}${store.inkBase}`, { method: 'HEAD' });
  const proxied = !!head && (/cloudflare/i.test(head.headers.get('server') || '') || head.headers.has('cf-ray'));
  proxied ? ok(`${store.inkHost} passa pela Cloudflare (proxied): as rotas terão efeito`) : bad(`${store.inkHost} está DNS-only (server: ${head && head.headers.get('server')}, sem cf-ray): Workers Routes NÃO valem. ITEM QUE EXIGE CONFIRMAÇÃO: no DNS da zona ${rel.zoneName}, trocar o registro CNAME do host "www" de "somente DNS" para "Proxied" (o token OAuth do wrangler não tem permissão de DNS: é uma ação do proprietário no painel). Confirme depois que a INK segue abrindo e o SSL da zona é Full`);
  const dep = wrangler(['deployments', 'list', '--name', store.workerName]);
  const exists = !/does not exist|10007/.test(dep.out) && dep.code === 0;
  exists ? ok(`Worker ${store.workerName} JÁ existe (modo atualização); versão ativa ${parseActiveVersion(dep.out) || '?'}`) : need(`Worker ${store.workerName} (não existe; primeiro deploy, fase 1 conservadora)`);
  const kv = wrangler(['kv', 'namespace', 'list']); const kvList = jsonFrom(kv.stdout) || jsonFrom(kv.out);
  const found = Array.isArray(kvList) ? kvList.find((n) => n.title === rel.kvTitle) : null;
  found ? ok(`KV ${rel.kvTitle} existe (${found.id.slice(0, 8)}…)`) : (Array.isArray(kvList) ? need(`KV namespace "${rel.kvTitle}" (binding ${store.kvBinding}; um namespace por loja, nunca compartilhado)`) : bad('não consegui listar os namespaces KV'));
  const routesNow = zone ? routeState(await listRoutes(zone.id).catch(() => []), rel) : null;
  if (routesNow && routesNow.stage === 'baseline') need(`duas Workers Routes em ${rel.zoneName}: ${rel.routePatterns.join(' e ')} (só produto e /__origens; nada de login, carrinho, checkout, pedidos, pagamentos ou administração)`);
  // dry-run local do build/bundle com o TOML resolvido por um id fictício (nada é publicado)
  const dry = RESOLVED;
  writeFileSync(dry, resolveToml(readFileSync(`${ROOT}/${rel.tomlFile}`, 'utf8'), rel, found ? found.id : '0'.repeat(32)), { mode: 0o600 });
  const vars = releaseVars(rel, CONSERVATIVE, SAMPLES);
  const r = wrangler([...deployArgs(rel, dry, vars).slice(1), '--dry-run', '--outdir', `${WORK}/dry`]);
  r.code === 0 && /--dry-run: exiting now/.test(r.out) ? ok(`dry-run do bundle (fase 1: allowlist com ${SAMPLES[rel.id].allowlist.length} produtos, ${STORE_FEATURES.length} features, STORE_ID=${rel.id}): compila e valida os bindings`) : bad('dry-run falhou: ' + r.out.split('\n').filter((l) => /error|erro/i.test(l)).slice(0, 2).join(' | '));
  return { zone, exists, kvFound: found };
}
async function check() {
  staticChecks(); await storefrontChecks(); await inkChecks(); const ctx = await cloudflareChecks();
  log('\n== RESUMO ==');
  log(`loja: ${rel.id} (${store.workerName}) — ${FAILS.length} FAIL, ${WARNS.length} WARN, ${NEEDS.length} item(ns) a criar`);
  if (NEEDS.length) { log('o --deploy criaria (só com a frase de confirmação):'); NEEDS.forEach((n) => log('   • ' + n)); }
  if (FAILS.length) { log('BLOQUEADO — corrija antes de publicar:'); FAILS.forEach((f) => log('   ✗ ' + f)); log(`\nBLOCKED ${rel.id}`); } else log(`\nREADY ${rel.id} — para publicar: RELEASE_CONFIRM=${rel.confirmPhrase} node scripts/release-store.mjs ${rel.id} --deploy`);
  return { ready: FAILS.length === 0, ...ctx };
}

// ── evidência e desfazer ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function captureEvidence(reason) {
  const dir = `${WORK}/evidence/${stamp()}`; mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(`${dir}/reason.txt`, `quando: ${new Date().toISOString()}\nmotivo exato: ${reason}\ngit: ${run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()}\n`);
  writeFileSync(`${dir}/health.json`, JSON.stringify(await healthNow(), null, 1));
  writeFileSync(`${dir}/deployments.txt`, wrangler(['deployments', 'list', '--name', store.workerName]).out.split('\n').slice(-30).join('\n'));
  try { writeFileSync(`${dir}/routes.txt`, (await listRoutes((await zoneOf(rel.zoneName)).id)).map((r) => `${r.pattern} -> ${r.script || '(sem Worker)'}`).join('\n')); } catch (_) { /* melhor esforço */ }
  log(`   evidência salva em ${dir.replace(ROOT + '/', '')}`); return dir;
}
async function retireRoutes(snapFile) {
  const r = run('node', ['scripts/store-routes.mjs', rel.id, 'retire', `--snapshot=${snapFile}`]); log(r.out.trim().split('\n').map((l) => '   ' + l).join('\n')); return r.code === 0;
}
async function confirm(phrase) {
  if (process.env.RELEASE_CONFIRM === phrase) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout }); const answer = await rl.question(`Digite exatamente ${phrase} para continuar: `); rl.close(); return answer.trim() === phrase;
}

// ── smoke público (sem navegador) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function smoke(phase) {
  const problems = []; const samples = SAMPLES[rel.id];
  for (const p of samples.allowlist) { const r = await get(HOST + p); const html = r ? await r.text() : ''; if (!r || r.status !== 200 || countLoaders(html) !== 1) problems.push(`${p.slice(0, 50)}…: HTTP ${r && r.status}, ${countLoaders(html)} loader(s) (esperado 1)`); }
  const utm = await get(HOST + samples.allowlist[0] + '?utm_source=smoke'); const utmHtml = utm ? await utm.text() : ''; if (countLoaders(utmHtml) !== 1) problems.push('produto com UTM sem exatamente 1 loader');
  const extra = samples.extraProducts[0]; const er = await get(HOST + extra); const eh = er ? await er.text() : '';
  const wantExtra = phase === CATALOG ? 1 : 0; if (!er || er.status !== 200 || countLoaders(eh) !== wantExtra) problems.push(`produto fora da allowlist: ${countLoaders(eh)} loader(s) (esperado ${wantExtra} na fase ${phase})`);
  for (const path of [`${store.inkBase}/cart`, `${store.inkBase}/store_sessions/new`, `${store.inkBase}/login`, `${store.inkBase}/products`, store.inkBase, `${store.inkBase}/orders/trackings`, store.inkBase + '/product/zz-nao-existe-smoke']) { const r = await get(HOST + path); const h = r && r.status === 200 ? await r.text() : ''; if (countLoaders(h) !== 0) problems.push(`${path}: o loader apareceu onde não devia`); if (r && r.status >= 500) problems.push(`${path}: HTTP ${r.status}`); }
  const nav = await get(HOST + '/__origens/navbar'); const nj = nav && nav.status === 200 ? await nav.json().catch(() => null) : null; if (!nj || nj.v !== 2 || nj.states.length !== store.ufs.length) problems.push('/__origens/navbar não devolveu os estados da região');
  const sr = await get(HOST + '/__origens/search?q=' + encodeURIComponent(samples.search.query)); const sj = sr && sr.status === 200 ? await sr.json().catch(() => null) : null; if (!sj || !sj.results || sj.results[0].href !== samples.search.href) problems.push('/__origens/search não devolveu a cidade da região com o link certo');
  const cr = await get(HOST + '/__origens/cart-ref/AAAAAAAAAAAAAAAAAAAAAA'); if (!cr || cr.status !== 404) problems.push('cart-ref de token desconhecido != 404 (HTTP ' + (cr && cr.status) + ')');
  return problems;
}

// ── deploy ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function deploy(ctx) {
  if (!(await confirm(rel.confirmPhrase))) die(`sem confirmação: exporte RELEASE_CONFIRM=${rel.confirmPhrase} ou digite a frase. Nada foi alterado.`);
  const zone = ctx.zone; const routes0 = await listRoutes(zone.id); const snap = buildSnapshot({ rel, zoneId: zone.id, routes: routes0 });
  const v = validateSnapshot(snap, rel, { zoneId: zone.id }); if (!v.ok) die('snapshot inválido: ' + v.problems.join('; '));
  const snapFile = `${WORK}/routes-snapshot-${stamp()}.json`; writeFileSync(snapFile, JSON.stringify(snap, null, 1), { mode: 0o600 });
  log(`\n== 1. snapshot das rotas: ${snap.count} rota(s), digest ${snap.digest.slice(0, 12)}… → ${snapFile.replace(ROOT + '/', '')}`);

  let kvId = ctx.kvFound && ctx.kvFound.id;
  if (!kvId) {
    log(`== 2. criando o KV ${rel.kvTitle}`); const c = wrangler(['kv', 'namespace', 'create', rel.kvTitle]);
    if (c.code !== 0) die('não consegui criar o KV: ' + c.out.split('\n').slice(-3).join(' '));
    const list = jsonFrom(wrangler(['kv', 'namespace', 'list']).stdout); kvId = (list || []).find((n) => n.title === rel.kvTitle)?.id; if (!kvId) die('KV criado mas não localizado na listagem');
  } else log(`== 2. KV ${rel.kvTitle} já existe (${kvId.slice(0, 8)}…)`);
  writeFileSync(RESOLVED, resolveToml(readFileSync(`${ROOT}/${rel.tomlFile}`, 'utf8'), rel, kvId), { mode: 0o600 });

  const before = wrangler(['deployments', 'list', '--name', store.workerName]); const firstRelease = /does not exist|10007/.test(before.out) || before.code !== 0;
  const rollbackTo = async (phase1Version, why) => {
    log(`\n!! FALHA CRÍTICA (${why}): evidência ANTES do desfazer`); await captureEvidence(why);
    if (phase1Version) { log(`   voltando SÓ ${rel.id} para a versão da fase 1 (${phase1Version.slice(0, 8)}…)`); const r = wrangler(['rollback', phase1Version, '--name', store.workerName, '-y', '--message', 'release-store: rollback automatico para a fase 1']); log('   ' + r.out.trim().split('\n').slice(-2).join(' | ')); await sleep(5000); const h = await healthNow(); const e = evaluateStoreHealth(h, rel, { scope: CONSERVATIVE, allowlistSize: SAMPLES[rel.id].allowlist.length }); log(e.ok ? '   OK health volta à fase 1 (allowlist)' : '   FAIL health após o rollback: ' + e.problems.join('; ')); }
    else { log('   fase 1 falhou: retirando SÓ as duas rotas desta loja'); const okRetire = await retireRoutes(snapFile); log(okRetire ? '   OK rotas voltaram ao snapshot; a INK segue nativa' : '   FAIL retire — rode: node scripts/store-routes.mjs ' + rel.id + ' retire --snapshot=' + snapFile); }
    log(`\nREVERTIDO ${rel.id}. Nenhuma outra loja foi tocada (use-sul-widget e a outra loja intactos).`); process.exit(1);
  };

  // FASE 1 ------------------------------------------------------------------------------------------------------------------------------
  log(`\n== 3. FASE 1 (${CONSERVATIVE}: ${SAMPLES[rel.id].allowlist.length} produtos reais) — Worker + rotas`);
  const v1 = releaseVars(rel, CONSERVATIVE, SAMPLES);
  const d1 = wrangler(deployArgs(rel, RESOLVED, v1).slice(1), { timeout: 300000 }); log(d1.out.trim().split('\n').slice(-6).map((l) => '   ' + l).join('\n'));
  if (d1.code !== 0) await rollbackTo(null, 'wrangler deploy da fase 1 falhou');
  log(`   aguardando ${PROPAGATION_WAIT_S}s a propagação das rotas…`); await sleep(PROPAGATION_WAIT_S * 1000);
  const phase1Version = parseActiveVersion(wrangler(['deployments', 'list', '--name', store.workerName, '--json']).out) || parseActiveVersion(wrangler(['deployments', 'list', '--name', store.workerName]).out);
  const h1 = await healthNow(); const e1 = evaluateStoreHealth(h1, rel, { scope: CONSERVATIVE, allowlistSize: SAMPLES[rel.id].allowlist.length, version: LOADER_VERSION });
  if (!e1.ok) await rollbackTo(null, 'health da fase 1: ' + e1.problems.join('; '));
  ok(`health fase 1: ${store.workerName} v${h1.version}, ${h1.widget_features.length} features, KV ligado, escopo allowlist`);
  const r1 = await listRoutes(zone.id); const st1 = routeState(r1, rel); const sp1 = safetyProblems(r1, rel);
  if (st1.stage !== 'final' || sp1.length) await rollbackTo(null, 'rotas da fase 1: ' + [st1.stage, ...sp1].join('; '));
  ok('rotas finais (produto + /__origens) e segurança estática ok');
  const probe = run('node', ['scripts/store-routes.mjs', rel.id, 'probe'], { timeout: 300000 }); log(probe.out.trim().split('\n').map((l) => '   ' + l).join('\n'));
  if (probe.code !== 0) await rollbackTo(null, 'execução do Worker fora do esperado (login/carrinho/checkout NÃO podem invocá-lo)');
  const s1 = await smoke(CONSERVATIVE); if (s1.length) await rollbackTo(null, 'smoke da fase 1: ' + s1.join(' | '));
  ok('smoke fase 1: produtos reais com 1 loader; transacionais/casca/slug inexistente sem loader; navbar, busca e cart-ref respondem');

  // FASE 2 ------------------------------------------------------------------------------------------------------------------------------
  log(`\n== 4. FASE 2 (${CATALOG}) — só o domínio ${store.inkHost}`);
  const v2 = releaseVars(rel, CATALOG, SAMPLES);
  const d2 = wrangler(deployArgs(rel, RESOLVED, v2).slice(1), { timeout: 300000 }); log(d2.out.trim().split('\n').slice(-4).map((l) => '   ' + l).join('\n'));
  if (d2.code !== 0) await rollbackTo(phase1Version, 'wrangler deploy da fase 2 falhou');
  await sleep(8000);
  const h2 = await healthNow(); const e2 = evaluateStoreHealth(h2, rel, { scope: CATALOG, allowlistSize: SAMPLES[rel.id].allowlist.length, version: LOADER_VERSION });
  if (!e2.ok) await rollbackTo(phase1Version, 'health da fase 2: ' + e2.problems.join('; '));
  ok('health fase 2: escopo product-catalog');
  const s2 = await smoke(CATALOG); if (s2.length) await rollbackTo(phase1Version, 'smoke da fase 2: ' + s2.join(' | '));
  ok('smoke fase 2: qualquer produto real recebe 1 loader; o resto continua sem');
  log('\n== 5. QA em navegador REAL ao vivo (1280/390/320, carrinho anônimo real, cart_ref, negativos)');
  const qa = run('node', ['scripts/qa-store.mjs', rel.id, '--live'], { timeout: 1500000 }); log(qa.out.trim().split('\n').slice(-40).map((l) => '   ' + l).join('\n'));
  if (qa.code !== 0) await rollbackTo(phase1Version, 'QA ao vivo reprovou (ver resultado.json em docs/evidence/norte-centro/' + rel.id + '-live/)');
  const h3 = await healthNow();
  log(`\nPUBLICADO ${rel.id}: ${store.workerName} v${h3.version}, versão ativa ${(parseActiveVersion(wrangler(['deployments', 'list', '--name', store.workerName]).out) || '?')}, escopo ${h3.scope_mode}, contadores do isolate ${JSON.stringify(h3.cart_ref_stats)}`);
  log(`rollback independente: RELEASE_CONFIRM=${rel.rollbackPhrase} node scripts/release-store.mjs ${rel.id} --rollback   (volta à fase 1; snapshot em ${snapFile.replace(ROOT + '/', '')})`);
  log('a Use Sul e a outra loja não foram tocadas.');
}

// ── rollback manual ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function rollback() {
  if (!(await confirm(rel.rollbackPhrase))) die(`sem confirmação: exporte RELEASE_CONFIRM=${rel.rollbackPhrase}. Nada foi alterado.`);
  const snaps = existsSync(WORK) ? run('bash', ['-c', `ls -1t "${WORK}"/routes-snapshot-*.json 2>/dev/null | head -1`]).stdout.trim() : '';
  if (!snaps) die('nenhum snapshot de rotas desta loja em ' + WORK.replace(ROOT + '/', ''));
  const dep = wrangler(['deployments', 'list', '--name', store.workerName]); const versions = [...dep.out.matchAll(/Version\(s\):\s+\(100%\)\s+([0-9a-f-]{36})/g)].map((m) => m[1]);
  log(`snapshot: ${snaps.replace(ROOT + '/', '')}; versões ativas (antiga→nova): ${versions.map((v) => v.slice(0, 8)).join(' → ') || '(nenhuma)'}`);
  const h = await healthNow();
  if (h && h.scope_mode === CATALOG && versions.length >= 2) {
    const target = versions[versions.length - 2]; log(`fase 2 ativa: voltando SÓ ${rel.id} para ${target.slice(0, 8)}… (fase 1)`);
    const r = wrangler(['rollback', target, '--name', store.workerName, '-y', '--message', 'release-store: rollback manual para a fase 1']); log(r.out.trim().split('\n').slice(-2).join(' | ')); return;
  }
  log('fase 1 (ou única): retirando as duas rotas da loja e devolvendo a INK ao estado nativo'); process.exit((await retireRoutes(snaps)) ? 0 : 1);
}

if (mode === '--check') { const r = await check(); process.exit(r.ready ? 0 : 1); }
if (mode === '--deploy') { const r = await check(); if (!r.ready) die('o --check não está limpo; nada foi publicado.'); await deploy(r); }
if (mode === '--rollback') await rollback();
