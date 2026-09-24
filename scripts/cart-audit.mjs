#!/usr/bin/env node
// Auditoria (SOMENTE OBSERVAÇÃO) do carrinho da INK em sessão anônima descartável, janela visível.
// Registra requisições (método, URL, status, tipo, cabeçalhos relevantes) SEM valores de cookie/CSRF, estrutura do DOM do drawer
// do carrinho e a semântica do botão de finalizar compra. Nunca preenche dados nem conclui pedido.
//   PW_PATH=/tmp/pw node scripts/cart-audit.mjs <desktop|mobile> [--out /tmp/cartaudit]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const mode = process.argv[2] || 'desktop';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', '/tmp/cartaudit'); mkdirSync(out, { recursive: true });
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense';
const mobile = mode === 'mobile';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' } : { viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage();

let phase = 'load'; const log = [];
const REL = ['content-type', 'x-requested-with', 'turbo-frame', 'accept', 'location', 'cache-control', 'x-csrf-token', 'x-turbo-request-id', 'content-length'];
page.on('request', (r) => { if (/usesul\.com\.br/.test(r.url()) && !/\.(png|jpe?g|webp|svg|css|woff2?|ico)(\?|$)/i.test(r.url()) && !/(google|facebook|clarity|hotjar|rsvcloud|analytics|pixel|collect|gtm)/i.test(r.url())) {
  const h = r.headers(); const rel = {}; for (const k of REL) if (h[k]) rel[k] = k.includes('csrf') ? '<redacted>' : h[k].slice(0, 90);
  let body = null; try { body = r.postData(); } catch (_) {}
  const redactedBody = body ? body.replace(/(authenticity_token|_csrf|token)=[^&]*/gi, '$1=<redacted>').slice(0, 300) : null;
  log.push({ phase, dir: 'req', method: r.method(), url: r.url().replace(HOST, ''), type: r.resourceType(), hdr: rel, body: redactedBody });
} });
page.on('response', async (r) => { const req = r.request(); if (log.some((l) => l.dir === 'req' && l.url === req.url().replace(HOST, '') && l.phase === phase)) { const h = r.headers(); log.push({ phase, dir: 'res', status: r.status(), url: req.url().replace(HOST, ''), ct: (h['content-type'] || '').split(';')[0], loc: h['location'] || null, len: (h['content-length'] || '') }); } });

const wait = (ms) => page.waitForTimeout(ms);
await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3000);
await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click(); await page.locator('label[for="4932916-color-Preta"]').click(); await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
phase = 'add-to-cart';
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForFunction(() => document.getElementById('modal-wrapper')?.textContent.includes('Ver carrinho'), null, { timeout: 20000 }); await wait(1500);

const dump = (name) => page.evaluate((name) => {
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const attrs = (e) => [...e.attributes].filter((a) => /^(data-|action|method|href|role|aria-|src|name|type|for|form)/.test(a.name)).map((a) => a.name + '=' + (/csrf|token/i.test(a.name + a.value) ? '<redacted>' : String(a.value).slice(0, 70)));
  const tree = (e, d, max) => { const kids = [...e.children].filter((c) => !['SCRIPT', 'STYLE', 'PATH', 'SVG', 'IMG'].includes(c.tagName.toUpperCase())); const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 60); const line = '  '.repeat(d) + desc(e) + (own ? '  "' + own + '"' : '') + (attrs(e).length ? '  {' + attrs(e).join(' ') + '}' : ''); return d >= max ? [line] : [line, ...kids.flatMap((c) => tree(c, d + 1, max))]; };
  const root = document.querySelector(name);
  return root ? tree(root, 0, 9).slice(0, 140) : ['(não encontrado: ' + name + ')'];
}, name);

// 1) Ícone do carrinho no cabeçalho + drawer do carrinho (nativo) — inspeção estática
const icon = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('header a, header button, nav a, nav button')].filter((e) => e.getClientRects().length && (/cart|carrinho/i.test((e.getAttribute('href') || '') + (e.getAttribute('aria-label') || '') + (e.getAttribute('data-action') || '') + (e.id || '') + (typeof e.className === 'string' ? e.className : ''))));
  return cands.map((e) => ({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 80), href: e.getAttribute('href'), action: e.getAttribute('data-action'), aria: e.getAttribute('aria-label'), turbo: e.getAttribute('data-turbo-frame') || e.getAttribute('data-turbo'), text: e.textContent.trim().slice(0, 30) }));
});
writeFileSync(`${out}/${mode}-cart-icon-candidates.json`, JSON.stringify(icon, null, 1));
console.log('CART ICON CANDIDATES', JSON.stringify(icon, null, 1));
writeFileSync(`${out}/${mode}-http-log-add.json`, JSON.stringify(log.filter((l) => l.phase === 'add-to-cart'), null, 1));
console.log('--- rede durante a adição (phase add-to-cart)'); log.filter((l) => l.phase === 'add-to-cart').forEach((l) => console.log(JSON.stringify(l)));
const drawerTree = await dump('#modal-wrapper'); writeFileSync(`${out}/${mode}-post-add-modal.txt`, drawerTree.join('\n'));
const cartFrame = await dump('turbo-frame#cart'); writeFileSync(`${out}/${mode}-cart-frame-after-add.txt`, cartFrame.join('\n'));
console.log('--- turbo-frame#cart após adição'); console.log(cartFrame.join('\n'));
await browser.close();
