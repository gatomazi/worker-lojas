#!/usr/bin/env node
// Abre o topo do artigos para VER ao vivo, sem publicar nada: o Worker roda local (Miniflare) na frente da loja REAL da Uma Penca e duas janelas abertas
// mostram o resultado, a do computador (1440×900) e a do celular (390×844, emulação com toque), cada uma com a home e uma página de caneca em abas.
//   PW_PATH=<raiz com node_modules/playwright-core> node scripts/ver-artigos.mjs [--storefront=fixture] [--hold=<minutos, padrão 120>]
// Fica de pé até fechar as duas janelas (ou Ctrl+C, ou o tempo de --hold). Só LEITURA na Uma Penca: o carrinho é de uma sessão anônima descartável.
import { createRequire } from 'node:module';
import { HOST, PRODUCT, routeThroughWorker, startLocalWorker } from './lib/artigos-local.mjs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');

const arg = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').split('=')[1];
const mf = startLocalWorker({ fixture: arg('storefront') === 'fixture' });
const browser = await chromium.launch({ headless: false });
const windows = [
  ['computador 1440×900', { viewport: { width: 1440, height: 900 } }],
  ['celular 390×844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]
];
const contexts = [];
for (const [label, opts] of windows) {
  const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' });
  contexts.push(ctx);
  for (const path of ['/', PRODUCT]) {
    const page = await ctx.newPage();
    await routeThroughWorker(page, mf);
    page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('AVISO ' + label + ' ' + path + ': ' + String(e.message).slice(0, 100)));
  }
  console.log('Janela aberta: ' + label + ' (home + página de caneca)');
}
console.log('Pronto. Feche as duas janelas (ou Ctrl+C) para encerrar.');

const minutes = Number(arg('hold') || 120);
await new Promise((resolve) => {
  const timer = setTimeout(resolve, minutes * 60 * 1000);
  const poll = setInterval(() => { if (contexts.every((c) => c.pages().length === 0)) { clearTimeout(timer); clearInterval(poll); resolve(); } }, 2000);
  browser.on('disconnected', () => { clearTimeout(timer); clearInterval(poll); resolve(); });
  process.on('SIGINT', resolve);
});
await browser.close().catch(() => {});
await mf.dispose();
