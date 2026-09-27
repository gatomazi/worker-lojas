#!/usr/bin/env node
// Rotas do Worker na ZONA usesul.com.br (API da Cloudflare). Só toca nas rotas do host www.usesul.com.br; nunca em DNS, KV, WAF, regras ou outras lojas.
//   snapshot <arquivo>          grava as rotas atuais (id, padrão, Worker) — SOMENTE LEITURA
//   list                        imprime as rotas atuais — SOMENTE LEITURA
//   verify --stage=baseline|staged|final   compara com o estado esperado + segurança estática (exit 1 se divergir) — SOMENTE LEITURA
//   apply --stage=staged        cria as rotas que faltam do estágio (a exclusão /usesul/* SEM Worker e a home com barra); nunca apaga
//   restore <snapshot>          volta as rotas nossas ao snapshot (apaga as novas, recria as que sumiram) e confere o resultado
//   probe --stage=... [--base=/usesul]      EVIDÊNCIA DE EXECUÇÃO: `wrangler tail` + requisições com um User-Agent único; mostra quem executou e quem não
//   rehearse                    ensaio da REGRA de especificidade num prefixo inofensivo (/usesul-rt), com limpeza garantida
// Token: CLOUDFLARE_API_TOKEN, ou o OAuth do `wrangler login` do proprietário (nunca impresso). Precisa de workers_routes (write) e zone (read).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ZONE_NAME, WORKER, HOST, STAGES, normalize, bySignature, diffRoutes, planToStage, planRestore, isOurs, safetyProblems, probeSet } from './lib/routes-lib.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const log = (...a) => console.log(...a);

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const f of [homedir() + '/Library/Preferences/.wrangler/config/default.toml', homedir() + '/.config/.wrangler/config/default.toml', homedir() + '/.wrangler/config/default.toml']) {
    try { const m = /^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync(f, 'utf8')); if (m) return m[1]; } catch (_) { /* próximo */ }
  }
  throw new Error('sem credencial Cloudflare: rode `npx wrangler login` (proprietário) ou exporte CLOUDFLARE_API_TOKEN');
}
let refreshed = false;
async function cf(method, path, body) {
  const go = () => fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let r = await go();
  if ((r.status === 401 || r.status === 403) && !refreshed) { refreshed = true; spawnSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' }); r = await go(); } // o wrangler renova o OAuth ao ser usado
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`Cloudflare ${method} ${path.replace(/\/zones\/[0-9a-f]+/, '/zones/<id>')}: HTTP ${r.status} ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.result;
}
async function zoneId() { const z = await cf('GET', '/zones?name=' + ZONE_NAME); if (!z.length) throw new Error('zona não encontrada: ' + ZONE_NAME); return z[0].id; }
const listRoutes = async (Z) => cf('GET', `/zones/${Z}/workers/routes`);
const body = ({ pattern, worker, script }) => ((worker ?? !!script) ? { pattern, script: WORKER } : { pattern });

const arg = (n) => (process.argv.find((a) => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=') || null;
const cmd = process.argv[2];
const Z = await zoneId();

async function verify(stage) {
  const cur = await listRoutes(Z);
  const d = diffRoutes(cur, stage); const s = safetyProblems(cur);
  for (const l of bySignature(cur)) log('   ' + l);
  if (d.ok && !s.length) { log(`OK rotas no estágio '${stage}' (${cur.length} rota(s)); segurança estática ok`); return true; }
  for (const m of d.missing) log('FAIL falta: ' + m);
  for (const m of d.extra) log('FAIL a mais: ' + m);
  for (const m of d.wrongScript) log('FAIL Worker: ' + m);
  for (const m of s) log('FAIL segurança: ' + m);
  return false;
}

// Evidência de execução com `wrangler tail`. probes: [{ url, exec }]. Retorna [{ url, exec, executed, ok }].
async function probe(probes) {
  const nonce = randomBytes(4).toString('hex');
  const tail = spawn('npx', ['wrangler', 'tail', WORKER, '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let exited = null;
  const feed = (d) => { out += d.toString(); };
  tail.stdout.on('data', feed); tail.stderr.on('data', feed); tail.on('exit', (c) => { exited = c; });
  // Em --format json o wrangler não avisa quando conecta, e a conexão leva de ~5 a 30 s: envia-se um CANÁRIO (/__origens/health, sempre executa) a cada 3 s
  // até o tail mostrá-lo. Só então as sondas saem (um tail tardio já fez as primeiras sondas parecerem "sem invocação").
  const canary = `route-probe/${nonce}-canary`; const t0 = Date.now(); let live = false;
  while (Date.now() - t0 < 90000 && exited === null) {
    await fetch('https://' + HOST + '/__origens/health', { headers: { 'user-agent': canary } }).then((r) => r.text()).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    if (out.includes(canary)) { live = true; break; }
  }
  if (!live) { tail.kill(); throw new Error('wrangler tail não confirmou conexão (canário não visto): ' + (exited !== null ? 'encerrou ' + exited + ' ' : '') + out.replace(/\s+/g, ' ').slice(0, 200)); }
  const sent = [];
  for (const [i, p] of probes.entries()) {
    const ua = `route-probe/${nonce}-${i}`;
    const res = await fetch('https://' + HOST + p.url, { redirect: 'manual', headers: { 'user-agent': ua } }).then((r) => r.status).catch(() => 'erro');
    sent.push({ ...p, ua, status: res });
  }
  await new Promise((r) => setTimeout(r, 10000));
  tail.kill();
  const seen = new Set();
  for (const m of out.matchAll(/route-probe\/[0-9a-f]{8}-\d+/g)) seen.add(m[0]);
  return sent.map((s) => { const executed = seen.has(s.ua); return { url: s.url, exec: s.exec, executed, status: s.status, ok: s.exec === null || executed === s.exec }; });
}
function printProbe(rows) {
  let bad = 0;
  for (const r of rows) {
    if (r.exec === null) { log(`INFO ${r.executed ? '[Worker invocado]  ' : '[sem invocação]    '} HTTP ${r.status}  ${r.url}  (sem veredito: lacuna conhecida)`); continue; }
    if (!r.ok) bad++; log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.exec ? 'executa ' : 'NÃO exec'} ${r.executed ? '[Worker invocado]  ' : '[sem invocação]    '} HTTP ${r.status}  ${r.url}`); }
  return bad === 0;
}
const toProbes = (set) => [...set.exec.map((url) => ({ url, exec: true })), ...set.skip.map((url) => ({ url, exec: false })), ...(set.info || []).map((url) => ({ url, exec: null }))];

if (cmd === 'snapshot') {
  const file = process.argv[3]; if (!file) { console.error('uso: snapshot <arquivo>'); process.exit(2); }
  const cur = await listRoutes(Z);
  writeFileSync(file, JSON.stringify({ captured_at: new Date().toISOString(), zone: ZONE_NAME, zone_id: Z, routes: normalize(cur) }, null, 1), { mode: 0o600 });
  log(`snapshot: ${cur.length} rota(s) em ${file}`); for (const l of bySignature(cur)) log('   ' + l);
} else if (cmd === 'list') {
  for (const l of bySignature(await listRoutes(Z))) log(l);
} else if (cmd === 'verify') {
  process.exit((await verify(arg('stage') || 'baseline')) ? 0 : 1);
} else if (cmd === 'apply') {
  const stage = arg('stage'); if (stage !== 'staged') { console.error('apply só aceita --stage=staged (a rota abrangente é criada pelo wrangler deploy, depois da validação)'); process.exit(2); }
  const cur = await listRoutes(Z); const plan = planToStage(cur, stage);
  const foreign = normalize(cur).filter((r) => !isOurs(r.pattern));
  if (foreign.length) log(`   (${foreign.length} rota(s) de outro host na zona: intocadas)`);
  if (plan.problems.length) { for (const p of plan.problems) log('FAIL conflito: ' + p); process.exit(1); }
  for (const c of plan.create) { await cf('POST', `/zones/${Z}/workers/routes`, body(c)); log(`criada: ${c.pattern} -> ${c.worker ? WORKER : '(sem Worker)'}`); }
  if (!plan.create.length) log('nada a criar (já no estágio)');
  process.exit((await verify(stage)) ? 0 : 1);
} else if (cmd === 'restore') {
  const file = process.argv[3]; if (!file) { console.error('uso: restore <snapshot>'); process.exit(2); }
  const snap = JSON.parse(readFileSync(file, 'utf8')).routes; if (!Array.isArray(snap)) { console.error('FAIL snapshot sem o campo routes (use o arquivo gerado por `zone-routes.mjs snapshot`); nada foi alterado'); process.exit(2); } const cur = await listRoutes(Z); const p = planRestore(snap, cur);
  for (const r of p.remove) { await cf('DELETE', `/zones/${Z}/workers/routes/${r.id}`); log('removida: ' + r.pattern); }
  for (const r of p.update) { await cf('PUT', `/zones/${Z}/workers/routes/${r.id}`, body({ pattern: r.pattern, script: r.script })); log('restaurada: ' + r.pattern); }
  for (const r of p.create) { await cf('POST', `/zones/${Z}/workers/routes`, body({ pattern: r.pattern, script: r.script })); log('recriada: ' + r.pattern); }
  const now = await listRoutes(Z); const a = bySignature(snap.filter((r) => isOurs(r.pattern))); const b = bySignature(now.filter((r) => isOurs(r.pattern)));
  const same = JSON.stringify(a) === JSON.stringify(b);
  log(same ? `OK rotas restauradas: idênticas ao snapshot (${a.length})` : 'FAIL as rotas atuais NÃO conferem com o snapshot:\n  snapshot: ' + a.join(' | ') + '\n  atual:    ' + b.join(' | '));
  process.exit(same ? 0 : 1);
} else if (cmd === 'probe') {
  const stage = arg('stage') || 'baseline'; const rows = await probe(toProbes(probeSet(stage, arg('base') || '/usesul')));
  process.exit(printProbe(rows) ? 0 : 1);
} else if (cmd === 'rehearse') {
  // Ensaio da regra na Cloudflare, longe da loja: mesmas 9 formas de rota do estado final, sob /usesul-rt (o INK responde 404; o Worker só repassa).
  const BASE = '/usesul-rt'; const before = await listRoutes(Z);
  if (normalize(before).some((r) => r.pattern.startsWith(HOST + BASE))) { log('FAIL sobrou rota de ensaio anterior; limpe antes'); process.exit(1); }
  const shapes = STAGES.final.filter((r) => r.pattern.startsWith(HOST + '/usesul')).map((r) => ({ ...r, pattern: r.pattern.replace(HOST + '/usesul', HOST + BASE) }));
  const created = []; let ok = false;
  try {
    for (const s of shapes) { const r = await cf('POST', `/zones/${Z}/workers/routes`, body(s)); created.push(r.id); }
    log(`ensaio: ${created.length} rota(s) temporária(s) em ${HOST}${BASE}*`);
    await new Promise((r) => setTimeout(r, Number(arg('wait') || 8) * 1000)); // propagação das rotas
    const set = probeSet('final', BASE);
    ok = printProbe(await probe(toProbes(set)));
  } catch (e) { log('FAIL ensaio: ' + e.message); } finally {
    for (const id of created) await cf('DELETE', `/zones/${Z}/workers/routes/${id}`).catch((e) => log('AVISO limpeza: ' + e.message));
    const after = await listRoutes(Z); const clean = JSON.stringify(bySignature(after)) === JSON.stringify(bySignature(before));
    log(clean ? 'OK limpeza: rotas idênticas às de antes do ensaio' : 'FAIL limpeza: as rotas NÃO voltaram ao estado anterior — restaure com o snapshot'); if (!clean) ok = false;
  }
  process.exit(ok ? 0 : 1);
} else { console.error('uso: node scripts/zone-routes.mjs snapshot|list|verify|apply|restore|probe|rehearse (veja o cabeçalho)'); process.exit(2); }
