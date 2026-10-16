// Loja antiga depois da loja única: gera wrangler.<loja>.legado.resolved.toml a partir do TOML RESOLVIDO da loja (mesmas rotas, mesmo KV do carrinho),
// acrescentando o KV do mapa de produtos (LEGACY_MAP) e LEGACY_REDIRECT="on" (src/legacy-redirect.js). Não publica nada.
//   node scripts/legacy-toml.mjs <norte|centro> <id do namespace LEGACY_MAP (32 hex)>
// O arquivo gerado é ignorado pelo git (wrangler.*.resolved.toml). Deploy, com as --var da versão no ar: ver docs/redirect-lojas-antigas.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [loja, kvId] = process.argv.slice(2);
if (!['norte', 'centro'].includes(loja)) { console.error('uso: node scripts/legacy-toml.mjs <norte|centro> <id do KV LEGACY_MAP>'); process.exit(1); }
if (!/^[0-9a-f]{32}$/.test(kvId || '')) { console.error('id do namespace KV inválido (32 hex)'); process.exit(1); }
const source = new URL(`../wrangler.${loja}.resolved.toml`, import.meta.url);
if (!existsSync(source)) { console.error(`falta wrangler.${loja}.resolved.toml (gerado pelo release da loja)`); process.exit(1); }
let toml = readFileSync(source, 'utf8');
if (/LEGACY_MAP|LEGACY_REDIRECT/.test(toml)) { console.error('o TOML resolvido já tem LEGACY_*: confira antes de gerar de novo'); process.exit(1); }
if (!/^\[vars\]$/m.test(toml)) { console.error('TOML sem [vars]'); process.exit(1); }
toml = toml.replace(/^\[vars\]$/m, '[vars]\n# Loja antiga: produto -> mesmo produto na loja única; home/listagens/coleções -> região no storefront (src/legacy-redirect.js).\nLEGACY_REDIRECT = "on"');
toml += `\n# Mapa slug antigo -> slug novo na usesul (gerado da reconciliação da loja única).\n[[kv_namespaces]]\nbinding = "LEGACY_MAP"\nid = "${kvId}"\n`;
const out = new URL(`../wrangler.${loja}.legado.resolved.toml`, import.meta.url);
writeFileSync(out, toml);
console.log(`gerado ${out.pathname}`);
