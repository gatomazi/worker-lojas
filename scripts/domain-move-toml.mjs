// Mudança de domínio da loja única: gera wrangler.useorigens.resolved.toml a partir do wrangler.production.toml (Use Sul). Não publica nada.
//   - as rotas de www.usesul.com.br/usesul… passam a ser as de loja.useorigens.com.br/useorigens… (zona useorigens.com.br), na mesma forma;
//   - www.usesul.com.br/* inteiro chama o Worker, que só redireciona para o domínio novo (src/domain-move.js);
//   - SINGLE_STORE_DOMAIN = "next".
//   node scripts/domain-move-toml.mjs
// Ordem do deploy e das exclusões de zona: docs/mudanca-dominio-loja-unica.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { STORES } from '../src/stores.js';

const { inkHost, inkBase, nextInk } = STORES.sul;
const oldZone = inkHost.replace(/^www\./, '');
const newZone = nextInk.host.split('.').slice(-3).join('.');
let toml = readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8');
if (/SINGLE_STORE_DOMAIN/.test(toml)) { console.error('wrangler.production.toml já tem SINGLE_STORE_DOMAIN: confira antes de gerar'); process.exit(1); }
const routes = [...toml.matchAll(/^pattern = "([^"]+)"\nzone_name = "([^"]+)"$/gm)];
if (!routes.length || routes.some(([, p, z]) => z !== oldZone || !p.startsWith(inkHost + '/'))) { console.error('rotas inesperadas no wrangler.production.toml'); process.exit(1); }
for (const [line, pattern] of routes) {
  const path = pattern.slice(inkHost.length);
  const next = path === inkBase || path.startsWith(inkBase + '/') || path.startsWith(inkBase + '*') ? nextInk.base + path.slice(inkBase.length) : path;
  toml = toml.replace(line, `pattern = "${nextInk.host}${next}"\nzone_name = "${newZone}"`);
}
const firstRoute = toml.indexOf('[[routes]]');
toml = toml.slice(0, firstRoute) + `# Domínio antigo: tudo chama o Worker, que redireciona para ${nextInk.host} (src/domain-move.js). A exclusão ${inkHost}${inkBase}/* precisa sair da zona.\n[[routes]]\npattern = "${inkHost}/*"\nzone_name = "${oldZone}"\n\n` + toml.slice(firstRoute);
toml = toml.replace(/^\[vars\]$/m, `[vars]\n# A loja única mudou para ${nextInk.host}${nextInk.base} (src/stores.js withInkDomain).\nSINGLE_STORE_DOMAIN = "next"`);
const out = new URL('../wrangler.useorigens.resolved.toml', import.meta.url);
writeFileSync(out, toml);
console.log(`gerado ${out.pathname}`);
for (const [, p] of [...toml.matchAll(/^pattern = "([^"]+)"$/gm)]) console.log('  rota ' + p);
