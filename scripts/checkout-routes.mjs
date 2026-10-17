#!/usr/bin/env node
// Rotas do CHECKOUT do tema na zona da loja única: as DUAS telas de documento do checkout (contato/entrega e pagamento), e só elas, passam a chamar o
// Worker. Ele só age com `theme-checkout` e em GET de documento inteiro (sem Turbo-Frame); em exceção a Cloudflare entrega a origem. Os envios do
// checkout (buyer, shipping_address, process_payment, payment_discount), o carrinho e o login continuam na exclusão `/useorigens/*`: direto na INK.
// Só toca nestas duas rotas; nunca em DNS, KV, regras, outras rotas ou outras lojas. Plano e decisões: docs/tema-fluxo-ink.md.
// As duas estão DECLARADAS no wrangler.production.toml: o deploy as cria e as mantém (ele apaga as rotas do Worker que o TOML não declara). `apply` e
// `remove` servem para conferir/desfazer sem deploy (o rollback do release-tema.sh usa o `remove`; o próximo deploy as recria pelo TOML).
//   node scripts/checkout-routes.mjs plan     as rotas do host e o que apply/remove fariam — SOMENTE LEITURA
//   node scripts/checkout-routes.mjs apply    cria as duas rotas com o Worker (recusa sem a exclusão ou com outra rota no caminho da compra)
//   node scripts/checkout-routes.mjs remove   apaga as duas (o checkout volta inteiro para a INK)
//   node scripts/checkout-routes.mjs probe    EVIDÊNCIA (wrangler tail): as duas telas executam o Worker; envios, carrinho e login NÃO (só GET)
import { cf, zoneOf, listRoutes } from './lib/cf-api.mjs';
import { probeExecution, printProbe } from './lib/tail-probe.mjs';
import { checkoutRoutesState, checkoutProbeSet } from './lib/theme-release-lib.mjs';
import { STORES } from '../src/stores.js';

const WORKER = 'use-sul-widget';
const { host, base } = STORES.sul.nextInk;
const ZONE = host.split('.').slice(-3).join('.');
const cmd = process.argv[2];

const zone = await zoneOf(ZONE);
if (zone.status !== 'active') { console.error(`zona ${ZONE} não está ativa (${zone.status})`); process.exit(1); }
const routesOfHost = async () => (await listRoutes(zone.id)).filter((r) => r.pattern.startsWith(host + '/'));
const stateNow = async () => { const routes = await routesOfHost(); return { routes, state: checkoutRoutesState(routes, { host, base, worker: WORKER }) }; };

if (cmd === 'plan') {
  const { routes, state } = await stateNow();
  console.log(`${host} (${routes.length} rota(s))`);
  for (const r of routes.sort((a, b) => a.pattern.localeCompare(b.pattern))) console.log(`   ${r.pattern} -> ${r.script || '(sem Worker)'}`);
  console.log('');
  for (const p of state.wanted) console.log(`checkout: ${state.have.includes(p) ? 'já existe' : 'apply criaria'} ${p} -> ${WORKER}`);
  for (const p of state.problems) console.log('PROBLEMA: ' + p);
  process.exit(state.problems.length ? 1 : 0);
} else if (cmd === 'apply') {
  const { state } = await stateNow();
  if (state.problems.length) { console.error('recusado:\n  ' + state.problems.join('\n  ')); process.exit(1); }
  for (const p of state.missing) { await cf('POST', `/zones/${zone.id}/workers/routes`, { pattern: p, script: WORKER }); console.log(`criada: ${p} -> ${WORKER}`); }
  for (const p of state.have) console.log('já existe: ' + p);
  const after = (await stateNow()).state;
  if (after.missing.length || after.problems.length) { console.error('as rotas não conferem depois do apply: ' + [...after.missing, ...after.problems].join('; ')); process.exit(1); }
  console.log('conferido: as duas rotas do checkout chamam o Worker. Prova de execução: node scripts/checkout-routes.mjs probe (a propagação leva ~1 min)');
} else if (cmd === 'remove') {
  const routes = await routesOfHost();
  const wanted = checkoutRoutesState(routes, { host, base, worker: WORKER }).wanted;
  for (const r of routes.filter((x) => wanted.includes(x.pattern))) { await cf('DELETE', `/zones/${zone.id}/workers/routes/${r.id}`); console.log('apagada: ' + r.pattern); }
  const left = (await routesOfHost()).filter((x) => wanted.includes(x.pattern));
  if (left.length) { console.error('ainda existem: ' + left.map((x) => x.pattern).join(', ')); process.exit(1); }
  console.log('conferido: nenhuma rota do checkout; as telas voltam inteiras para a INK.');
} else if (cmd === 'probe') {
  const rows = await probeExecution({ worker: WORKER, host, probes: checkoutProbeSet(base) });
  process.exit(printProbe(rows) ? 0 : 1);
} else {
  console.error('uso: node scripts/checkout-routes.mjs plan | apply | remove | probe');
  process.exit(2);
}
