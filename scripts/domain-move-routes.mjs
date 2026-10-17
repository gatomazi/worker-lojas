#!/usr/bin/env node
// Exclusões de zona (rotas SEM Worker) da mudança de domínio da loja única. O `wrangler deploy` só declara rotas COM Worker; as exclusões vivem na zona.
// Só toca nestas duas rotas; nunca em DNS, KV, regras, outras rotas ou outras lojas.
//   node scripts/domain-move-routes.mjs plan                       mostra as rotas dos dois hosts e o que cada passo faria — SOMENTE LEITURA
//   node scripts/domain-move-routes.mjs apply --step=new-exclusion   ANTES do deploy: cria loja.useorigens.com.br/useorigens/* sem Worker (login, carrinho, checkout fora do Worker)
//   node scripts/domain-move-routes.mjs apply --step=drop-old        DEPOIS do deploy: apaga www.usesul.com.br/usesul/* sem Worker (senão ela vence o www.usesul.com.br/* do redirect)
//   node scripts/domain-move-routes.mjs apply --step=restore-old     rollback: recria www.usesul.com.br/usesul/* sem Worker
//   node scripts/domain-move-routes.mjs apply --step=copy-extra      DEPOIS do deploy: recria no host novo as rotas COM Worker do host antigo que não estão no TOML
//                                                                    (ex.: as duas telas do checkout do tema, criadas na zona por um PR próprio)
import { readFileSync } from 'node:fs';
import { cf, zoneOf, listRoutes } from './lib/cf-api.mjs';
import { STORES } from '../src/stores.js';

const { inkHost, inkBase, nextInk } = STORES.sul;
const OLD = { zone: inkHost.replace(/^www\./, ''), host: inkHost, exclusion: inkHost + inkBase + '/*' };
const NEW = { zone: nextInk.host.split('.').slice(-3).join('.'), host: nextInk.host, exclusion: nextInk.host + nextInk.base + '/*' };
const cmd = process.argv[2];
const step = (process.argv.find((a) => a.startsWith('--step=')) || '').slice(7);

const zones = {};
for (const side of [OLD, NEW]) {
  const z = await zoneOf(side.zone);
  if (z.status !== 'active') { console.error(`zona ${side.zone} não está ativa (${z.status})`); process.exit(1); }
  zones[side.zone] = z.id;
}
const routesOf = async (side) => (await listRoutes(zones[side.zone])).filter((r) => r.pattern.startsWith(side.host + '/'));
const exclusionOf = (routes, side) => routes.find((r) => r.pattern === side.exclusion && !r.script);
// Rotas com Worker do host antigo que o wrangler.production.toml não declara (criadas direto na zona): o `wrangler deploy` do domínio novo não as leva.
const tomlPatterns = new Set([...readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8').matchAll(/^pattern = "([^"]+)"$/gm)].map((m) => m[1]));
const translate = (pattern) => {
  const path = pattern.slice(OLD.host.length);
  return NEW.host + (path === inkBase || path.startsWith(inkBase + '/') || path.startsWith(inkBase + '*') ? nextInk.base + path.slice(inkBase.length) : path);
};
const extrasOf = (routes) => routes.filter((r) => r.script && !tomlPatterns.has(r.pattern) && r.pattern !== OLD.host + '/*').map((r) => ({ from: r.pattern, to: translate(r.pattern), script: r.script }));

if (cmd === 'plan') {
  for (const side of [OLD, NEW]) {
    const routes = await routesOf(side);
    console.log(`${side.host} (${routes.length} rota(s))`);
    for (const r of routes.sort((a, b) => a.pattern.localeCompare(b.pattern))) console.log(`   ${r.pattern} -> ${r.script || '(sem Worker)'}`);
  }
  console.log('\nnew-exclusion: ' + (exclusionOf(await routesOf(NEW), NEW) ? 'já existe' : 'criaria ' + NEW.exclusion));
  console.log('drop-old:      ' + (exclusionOf(await routesOf(OLD), OLD) ? 'apagaria ' + OLD.exclusion : 'já não existe'));
  const extras = extrasOf(await routesOf(OLD));
  const have = new Set((await routesOf(NEW)).map((r) => r.pattern));
  if (!extras.length) console.log('copy-extra:    nenhuma rota com Worker fora do TOML no host antigo');
  for (const e of extras) console.log(`copy-extra:    \x1b[33mATENÇÃO\x1b[0m ${e.from} (fora do TOML) -> ${have.has(e.to) ? 'já existe ' : 'criaria '}${e.to} -> ${e.script}`);
} else if (cmd === 'apply' && step === 'new-exclusion') {
  if (exclusionOf(await routesOf(NEW), NEW)) console.log('já existe: ' + NEW.exclusion);
  else { await cf('POST', `/zones/${zones[NEW.zone]}/workers/routes`, { pattern: NEW.exclusion }); console.log('criada: ' + NEW.exclusion + ' (sem Worker)'); }
} else if (cmd === 'apply' && step === 'drop-old') {
  const routes = await routesOf(OLD);
  if (!routes.some((r) => r.pattern === OLD.host + '/*' && r.script)) { console.error(`recusado: ${OLD.host}/* ainda não chama o Worker (faça o deploy antes)`); process.exit(1); }
  const ex = exclusionOf(routes, OLD);
  if (!ex) console.log('já não existe: ' + OLD.exclusion);
  else { await cf('DELETE', `/zones/${zones[OLD.zone]}/workers/routes/${ex.id}`); console.log('apagada: ' + OLD.exclusion); }
} else if (cmd === 'apply' && step === 'copy-extra') {
  const newRoutes = await routesOf(NEW);
  if (!newRoutes.some((r) => r.script)) { console.error('recusado: o host novo ainda não tem rotas com Worker (faça o deploy antes)'); process.exit(1); }
  if (!exclusionOf(newRoutes, NEW)) { console.error('recusado: falta a exclusão ' + NEW.exclusion + ' (rode --step=new-exclusion)'); process.exit(1); }
  const have = new Set(newRoutes.map((r) => r.pattern));
  const extras = extrasOf(await routesOf(OLD));
  if (!extras.length) console.log('nenhuma rota extra para copiar');
  for (const e of extras) {
    if (have.has(e.to)) { console.log('já existe: ' + e.to); continue; }
    await cf('POST', `/zones/${zones[NEW.zone]}/workers/routes`, { pattern: e.to, script: e.script });
    console.log(`criada: ${e.to} -> ${e.script} (de ${e.from})`);
  }
} else if (cmd === 'apply' && step === 'restore-old') {
  if (exclusionOf(await routesOf(OLD), OLD)) console.log('já existe: ' + OLD.exclusion);
  else { await cf('POST', `/zones/${zones[OLD.zone]}/workers/routes`, { pattern: OLD.exclusion }); console.log('recriada: ' + OLD.exclusion + ' (sem Worker)'); }
} else {
  console.error('uso: node scripts/domain-move-routes.mjs plan | apply --step=new-exclusion|drop-old|copy-extra|restore-old');
  process.exit(1);
}
