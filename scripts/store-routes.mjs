#!/usr/bin/env node
// Rotas do Worker de UMA loja (norte|centro) na zona dela (API da Cloudflare). Só toca nas duas rotas da loja; nunca em DNS, KV, WAF, regras, outra loja ou a Use Sul.
//   node scripts/store-routes.mjs <loja> snapshot <arquivo>   grava TODAS as rotas da zona (id, padrão, Worker) com schema, contagem e digest — SOMENTE LEITURA
//   node scripts/store-routes.mjs <loja> list                 imprime as rotas da zona — SOMENTE LEITURA
//   node scripts/store-routes.mjs <loja> verify [--stage=baseline|final|shell-staged|shell]    estado + segurança estática (exit 1 se divergir) — SOMENTE LEITURA
//   node scripts/store-routes.mjs <loja> apply [--stage=product|shell-staged|shell]   cria SÓ o que falta, na ordem segura (exclusão e home com barra antes; a abrangente por último); nunca apaga
//   node scripts/store-routes.mjs <loja> retire [--scope=all|shell] --snapshot=<arquivo>   desfaz: `all` (loja nova) remove as rotas dela; `shell` remove só a casca (exclusão + 7) e mantém as duas de produto
//   node scripts/store-routes.mjs <loja> restore <snapshot>   volta o host da loja ao snapshot VÁLIDO e NÃO vazio; snapshot ilegível, vazio, adulterado ou divergente é recusado
//   node scripts/store-routes.mjs <loja> probe [--stage=product|shell-staged|shell]   EVIDÊNCIA DE EXECUÇÃO (wrangler tail + requisições com User-Agent único)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cf, zoneOf, listRoutes } from './lib/cf-api.mjs';
import { releaseStore, buildSnapshot, validateSnapshot, routeState, safetyProblems, planApply, planRetire, planRestore, probeSet } from './lib/store-lib.mjs';

const log = (...a) => console.log(...a);
const [, , storeId, cmd, ...rest] = process.argv;
let rel;
try { rel = releaseStore(storeId); } catch (e) { console.error(e.message); process.exit(2); }
const SAMPLES = JSON.parse(readFileSync(new URL('./store-samples.json', import.meta.url), 'utf8'));
const arg = (n) => (rest.find((a) => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=') || null;
const sig = (routes) => routes.map((r) => `${r.pattern} -> ${r.script || '(sem Worker)'}`).sort();
const zone = await zoneOf(rel.zoneName);
if (zone.status !== 'active') { console.error(`zona ${rel.zoneName} não está ativa (${zone.status})`); process.exit(1); }

async function probe(stage) {
  const nonce = randomBytes(4).toString('hex'); const host = rel.store.inkHost; const set = probeSet(rel, SAMPLES, stage);
  const tail = spawn('npx', ['wrangler', 'tail', rel.store.workerName, '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let exited = null;
  const feed = (d) => { out += d.toString(); }; tail.stdout.on('data', feed); tail.stderr.on('data', feed); tail.on('exit', (c) => { exited = c; });
  // Em --format json o wrangler não avisa quando conecta (5 a 30 s): um CANÁRIO (/__origens/health) sai a cada 3 s até o tail mostrá-lo; só então as sondas.
  const canary = `route-probe/${nonce}-canary`; const t0 = Date.now(); let live = false;
  const liveWaitMs = Number(process.env.PROBE_LIVE_WAIT_S || 300) * 1000; // com a rede lenta o `wrangler tail` levou mais de 90 s para conectar
  while (Date.now() - t0 < liveWaitMs && exited === null) {
    await fetch('https://' + host + '/__origens/health', { headers: { 'user-agent': canary } }).then((r) => r.text()).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    if (out.includes(canary)) { live = true; break; }
  }
  if (!live) { tail.kill(); throw new Error('wrangler tail não confirmou conexão (canário não visto): ' + out.replace(/\s+/g, ' ').slice(0, 200)); }
  const sent = [];
  const probes = [...set.exec.map((url) => ({ url, exec: true })), ...set.skip.map((url) => ({ url, exec: false })), ...set.info.map((url) => ({ url, exec: null }))];
  for (const [i, p] of probes.entries()) {
    const ua = `route-probe/${nonce}-${i}`;
    const status = await fetch('https://' + host + p.url, { redirect: 'manual', headers: { 'user-agent': ua } }).then((r) => r.status).catch(() => 'erro');
    sent.push({ ...p, ua, status });
  }
  await new Promise((r) => setTimeout(r, 10000)); tail.kill();
  const seen = new Set(); for (const m of out.matchAll(/route-probe\/[0-9a-f]{8}-\d+/g)) seen.add(m[0]);
  let bad = 0;
  for (const s of sent) { const executed = seen.has(s.ua); if (s.exec === null) { log(`INFO ${executed ? '[Worker invocado]  ' : '[sem invocação]    '} HTTP ${s.status}  ${s.url}  (sem veredito: lacuna conhecida)`); continue; } const ok = executed === s.exec; if (!ok) bad++; log(`${ok ? 'OK  ' : 'FAIL'} ${s.exec ? 'executa ' : 'NÃO exec'} ${executed ? '[Worker invocado]' : '[sem invocação]  '} HTTP ${s.status}  ${s.url}`); }
  return bad === 0;
}

if (cmd === 'snapshot') {
  const file = rest[0]; if (!file) { console.error('uso: snapshot <arquivo>'); process.exit(2); }
  const snap = buildSnapshot({ rel, zoneId: zone.id, routes: await listRoutes(zone.id) });
  const v = validateSnapshot(snap, rel, { zoneId: zone.id }); if (!v.ok) { console.error('snapshot gerado inválido: ' + v.problems.join('; ')); process.exit(1); }
  writeFileSync(file, JSON.stringify(snap, null, 1), { mode: 0o600 });
  log(`snapshot: ${snap.count} rota(s) da zona ${rel.zoneName} em ${file} (digest ${snap.digest.slice(0, 12)}…${v.empty ? '; zona SEM rotas: o desfazer é `retire`, nunca `restore`' : ''})`); for (const l of sig(snap.routes)) log('   ' + l);
} else if (cmd === 'list') {
  for (const l of sig(await listRoutes(zone.id))) log(l);
} else if (cmd === 'verify') {
  const stage = arg('stage') || 'baseline'; if (!['baseline', 'final', 'shell-staged', 'shell'].includes(stage)) { console.error('estágio inválido'); process.exit(2); } const cur = await listRoutes(zone.id); const st = routeState(cur, rel); const sp = safetyProblems(cur, rel);
  for (const l of sig(cur)) log('   ' + l);
  for (const f of st.foreignOnStoreHost) log('INFO rota de outro Worker/padrão no host da loja (intocada): ' + f);
  const ok = st.stage === stage && !sp.length && !st.conflicts.length;
  log(ok ? `OK rotas da loja no estágio '${stage}'; segurança estática ok` : `FAIL estágio atual '${st.stage}' (esperado '${stage}')` + [...st.conflicts, ...sp].map((p) => '\n  ' + p).join(''));
  process.exit(ok ? 0 : 1);
} else if (cmd === 'apply') {
  const stage = arg('stage') || 'product'; let plan;
  try { plan = planApply(await listRoutes(zone.id), rel, stage); } catch (e) { console.error(e.message); process.exit(2); }
  if (plan.problems.length) { for (const p of plan.problems) log('FAIL conflito: ' + p); process.exit(1); }
  for (const c of plan.create) { await cf('POST', `/zones/${zone.id}/workers/routes`, c.script ? c : { pattern: c.pattern }); log(`criada: ${c.pattern} -> ${c.script || '(sem Worker)'}`); }
  if (!plan.create.length) log('nada a criar (já no estágio pedido)');
  const after = await listRoutes(zone.id); const want = { product: 'final', 'shell-staged': 'shell-staged', shell: 'shell' }[stage]; const st = routeState(after, rel).stage; log(`estágio agora: ${st} (esperado ${want})`); process.exit(st === want && !safetyProblems(after, rel).length ? 0 : 1);
} else if (cmd === 'retire') {
  const file = arg('snapshot'); if (!file) { console.error('uso: retire --snapshot=<arquivo do snapshot válido capturado ANTES do release>'); process.exit(2); }
  let snap; try { snap = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('snapshot ilegível: ' + e.message + ' — nada foi alterado'); process.exit(2); }
  const v = validateSnapshot(snap, rel, { zoneId: zone.id }); if (!v.ok) { console.error('retire recusado: ' + v.problems.join('; ') + ' — nada foi alterado'); process.exit(2); }
  const scope = arg('scope') || 'all'; let plan;
  try { plan = planRetire(await listRoutes(zone.id), rel, scope); } catch (e) { console.error(e.message); process.exit(2); }
  for (const r of plan.remove) { await cf('DELETE', `/zones/${zone.id}/workers/routes/${r.id}`); log('removida: ' + r.pattern); }
  if (!plan.remove.length) log('nada a remover');
  // o desfazer só vale se as rotas restantes do host da loja voltam ao que o snapshot registrou
  const now = await listRoutes(zone.id); const before = sig(snap.routes.filter((r) => r.pattern.startsWith(rel.store.inkHost + '/'))); const after = sig(now.filter((r) => r.pattern.startsWith(rel.store.inkHost + '/')));
  // o snapshot é o estado ANTERIOR ao passo desfeito: se as rotas do host da loja voltaram a ser exatamente as dele, o desfazer vale
  const same = JSON.stringify(before) === JSON.stringify(after);
  log(same ? `OK rotas do host da loja idênticas ao snapshot (${before.length})` : 'FAIL rotas atuais NÃO conferem com o snapshot:\n  snapshot: ' + before.join(' | ') + '\n  atual:    ' + after.join(' | '));
  process.exit(same ? 0 : 1);
} else if (cmd === 'restore') {
  const file = rest[0]; if (!file) { console.error('uso: restore <snapshot>'); process.exit(2); }
  let snap; try { snap = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('snapshot ilegível: ' + e.message + ' — nada foi alterado'); process.exit(2); }
  let plan; try { plan = planRestore(snap, await listRoutes(zone.id), rel, { zoneId: zone.id }); } catch (e) { console.error(e.message + ' — nada foi alterado'); process.exit(2); }
  for (const r of plan.remove) { await cf('DELETE', `/zones/${zone.id}/workers/routes/${r.id}`); log('removida: ' + r.pattern); }
  for (const r of plan.update) { await cf('PUT', `/zones/${zone.id}/workers/routes/${r.id}`, r.script ? { pattern: r.pattern, script: r.script } : { pattern: r.pattern }); log('restaurada: ' + r.pattern); }
  for (const r of plan.create) { await cf('POST', `/zones/${zone.id}/workers/routes`, r.script ? { pattern: r.pattern, script: r.script } : { pattern: r.pattern }); log('recriada: ' + r.pattern); }
  const now = await listRoutes(zone.id); const onHost = (rs) => sig(rs.filter((r) => r.pattern.startsWith(rel.store.inkHost + '/')));
  const same = JSON.stringify(onHost(snap.routes)) === JSON.stringify(onHost(now));
  log(same ? 'OK rotas restauradas: idênticas ao snapshot' : 'FAIL as rotas atuais NÃO conferem com o snapshot'); process.exit(same ? 0 : 1);
} else if (cmd === 'probe') {
  const stage = arg('stage') || 'product'; if (!['product', 'shell-staged', 'shell'].includes(stage)) { console.error('estágio inválido'); process.exit(2); }
  // Falha de CONEXÃO do tail (canário não visto) não é veredito de roteamento: uma nova tentativa antes de reprovar (o outro resultado, execução errada, reprova na hora).
  let okProbe; for (let attempt = 1; attempt <= 2; attempt++) { try { okProbe = await probe(stage); break; } catch (e) { console.log('AVISO: ' + String(e.message).slice(0, 160) + (attempt < 2 ? ' — nova tentativa' : '')); okProbe = false; } }
  process.exit(okProbe ? 0 : 1);
} else { console.error('uso: node scripts/store-routes.mjs <norte|centro> snapshot|list|verify|apply|retire|restore|probe (veja o cabeçalho)'); process.exit(2); }
