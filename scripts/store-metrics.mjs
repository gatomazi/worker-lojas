#!/usr/bin/env node
// Contadores de Workers e KV da conta (Cloudflare GraphQL Analytics), SOMENTE LEITURA: agregado da conta e por Worker/namespace.
// As franquias de Worker e KV são da CONTA (o plano Workers Paid é único): a medição por Worker mostra quem consome.
//   node scripts/store-metrics.mjs [--hours=24] [--json]
import { token } from './lib/cf-api.mjs';
import { STORES } from '../src/stores.js';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'bc4a9ac9a48cb621ef943c89e46c54d4'; // identifica a conta (não é credencial)
const arg = (n, d) => (process.argv.find((a) => a.startsWith('--' + n + '=')) || '').split('=')[1] || d;
const hours = Number(arg('hours', '24')); const asJson = process.argv.includes('--json');
const until = new Date(); const since = new Date(until.getTime() - hours * 3600e3);
const q = `query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) {
  workersInvocationsAdaptive(limit:100, filter:{datetime_geq:"${since.toISOString()}", datetime_leq:"${until.toISOString()}"}) { dimensions { scriptName status } sum { requests errors subrequests } }
  kvOperationsAdaptiveGroups(limit:100, filter:{datetime_geq:"${since.toISOString()}", datetime_leq:"${until.toISOString()}"}) { dimensions { namespaceId actionType } sum { requests } } } } }`;
const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
const body = await res.json().catch(() => ({}));
if (!res.ok || body.errors) { console.error('GraphQL indisponível: HTTP ' + res.status + ' ' + JSON.stringify(body.errors || {}).slice(0, 200)); process.exit(1); }
const acc = body.data.viewer.accounts[0] || { workersInvocationsAdaptive: [], kvOperationsAdaptiveGroups: [] };
const byWorker = {}; for (const r of acc.workersInvocationsAdaptive) { const w = (byWorker[r.dimensions.scriptName] ||= { requests: 0, errors: 0, subrequests: 0 }); w.requests += r.sum.requests; w.errors += r.sum.errors; w.subrequests += r.sum.subrequests; }
const byKv = {}; for (const r of acc.kvOperationsAdaptiveGroups) { const k = (byKv[r.dimensions.namespaceId] ||= { read: 0, write: 0, other: 0 }); k[r.dimensions.actionType === 'read' ? 'read' : r.dimensions.actionType === 'write' ? 'write' : 'other'] += r.sum.requests; }
const total = Object.values(byWorker).reduce((a, w) => ({ requests: a.requests + w.requests, errors: a.errors + w.errors, subrequests: a.subrequests + w.subrequests }), { requests: 0, errors: 0, subrequests: 0 });
const out = { window: { since: since.toISOString(), until: until.toISOString(), hours }, account_total: total, workers: byWorker, kv: byKv, our_workers: Object.values(STORES).map((s) => s.workerName) };
if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`janela: últimas ${hours} h (${out.window.since} → ${out.window.until})`);
  console.log(`CONTA (agregado): ${total.requests} requisições, ${total.errors} erros, ${total.subrequests} subrequisições`);
  for (const [name, w] of Object.entries(byWorker).sort()) console.log(`  Worker ${name}${out.our_workers.includes(name) ? '' : ' (outro projeto)'}: ${w.requests} req, ${w.errors} erros, ${w.subrequests} subreq`);
  for (const [id, k] of Object.entries(byKv)) console.log(`  KV ${id.slice(0, 8)}…: ${k.read} leituras, ${k.write} escritas, ${k.other} outras`);
}
