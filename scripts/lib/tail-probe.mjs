// Evidência de EXECUÇÃO de rotas com `wrangler tail` (a mesma técnica do zone-routes.mjs, aqui com host e Worker por parâmetro): cada sonda sai com um
// User-Agent único e o tail mostra quais delas invocaram o Worker. Só GET, sem seguir redirecionamentos: o roteamento da zona não depende do método,
// então um GET num caminho que só aceita POST prova o mesmo que o POST, sem mandar nada para o checkout.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** probes: [{ url, exec }] (exec: true = deve executar, false = não deve, null = só informa). Retorna [{ url, exec, executed, status, ok }]. */
export async function probeExecution({ worker, host, probes }) {
  const nonce = randomBytes(4).toString('hex');
  const tail = spawn('npx', ['wrangler', 'tail', worker, '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let exited = null;
  const feed = (d) => { out += d.toString(); };
  tail.stdout.on('data', feed); tail.stderr.on('data', feed); tail.on('exit', (c) => { exited = c; });
  // O wrangler não avisa quando o tail conecta (leva de ~5 a 30 s): um CANÁRIO no health (sempre executa) a cada 3 s até aparecer no tail.
  const canary = `route-probe/${nonce}-canary`; const t0 = Date.now(); let live = false;
  while (Date.now() - t0 < 90000 && exited === null) {
    await fetch('https://' + host + '/__origens/health', { headers: { 'user-agent': canary } }).then((r) => r.text()).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    if (out.includes(canary)) { live = true; break; }
  }
  if (!live) { tail.kill(); throw new Error('wrangler tail não confirmou conexão (canário não visto): ' + (exited !== null ? 'encerrou ' + exited + ' ' : '') + out.replace(/\s+/g, ' ').slice(0, 200)); }
  const sent = [];
  for (const [i, p] of probes.entries()) {
    const ua = `route-probe/${nonce}-${i}`;
    const status = await fetch('https://' + host + p.url, { redirect: 'manual', headers: { 'user-agent': ua } }).then((r) => r.status).catch(() => 'erro');
    sent.push({ ...p, ua, status });
  }
  await new Promise((r) => setTimeout(r, 10000));
  tail.kill();
  const seen = new Set();
  for (const m of out.matchAll(/route-probe\/[0-9a-f]{8}-\d+/g)) seen.add(m[0]);
  return sent.map((s) => { const executed = seen.has(s.ua); return { url: s.url, exec: s.exec, executed, status: s.status, ok: s.exec === null || executed === s.exec }; });
}

/** Imprime o resultado; true quando todas as sondas com veredito conferem. */
export function printProbe(rows, log = console.log) {
  let bad = 0;
  for (const r of rows) {
    if (r.exec === null) { log(`INFO ${r.executed ? '[Worker invocado]  ' : '[sem invocação]    '} HTTP ${r.status}  ${r.url}`); continue; }
    if (!r.ok) bad++;
    log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.exec ? 'executa ' : 'NÃO exec'} ${r.executed ? '[Worker invocado]  ' : '[sem invocação]    '} HTTP ${r.status}  ${r.url}`);
  }
  return bad === 0;
}
