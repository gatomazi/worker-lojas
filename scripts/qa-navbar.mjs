#!/usr/bin/env node
// Compatibilidade: o QA local da navbar agora é o ENSAIO do roteiro ao vivo (mesmos cenários críticos, contra a página real da INK, sem escrever KV).
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-navbar.mjs
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [new URL('./qa-navbar-live.mjs', import.meta.url).pathname, '--rehearse', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(result.status === null ? 1 : result.status);
