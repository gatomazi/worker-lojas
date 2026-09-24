#!/usr/bin/env node
// Auditoria (somente leitura, sessão anônima descartável, janela visível): adiciona 1 item ao carrinho anônimo, captura a estrutura
// e os estilos reais do drawer/modal pós-adição e salva capturas "antes". Nunca abre checkout. Uso:
//   PW_PATH=/tmp/pw node scripts/drawer-audit.mjs <desktop|mobile> [--out docs/evidence/drawer] [--tag before]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const mode = process.argv[2] || 'desktop';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'docs/evidence/drawer'); const tag = arg('--tag', 'before');
mkdirSync(out, { recursive: true });
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mobile = mode === 'mobile';
const browser = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' }
  : { viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage();
await page.goto(HOST + P, { waitUntil: 'load' }); await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('#add-to-cart-desk').scrollIntoView({ block: 'center' }));
await page.screenshot({ path: `${out}/${tag}-product-${mode}.jpg`, type: 'jpeg', quality: 60 });
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click();
await page.locator('label[for="4932916-color-Preta"]').click();
await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
const pre = await page.evaluate(() => ({ modalWrapper: !!document.getElementById('modal-wrapper'), lastAdded: !!document.getElementById('last_added_product') }));
// No mobile o banner de cookies da INK cobre a barra do CTA; não aceitamos consentimento em nome de ninguém: clique programático no botão.
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForFunction(() => document.getElementById('modal-wrapper')?.textContent.includes('Ver carrinho'), null, { timeout: 20000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}-drawer-${mode}.jpg`, type: 'jpeg', quality: 60 });
const audit = await page.evaluate(() => {
  const cs = (e, props) => { const s = getComputedStyle(e); return Object.fromEntries(props.map((p) => [p, s[p]])); };
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const desc = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const tree = (e, d = 0, max = 9) => {
    const kids = [...e.children].filter((c) => !['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(c.tagName.toUpperCase()));
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 50);
    const line = '  '.repeat(d) + desc(e) + (own ? '  "' + own + '"' : '') + (getComputedStyle(e).position !== 'static' ? '  [' + getComputedStyle(e).position + ']' : '');
    return d >= max ? [line] : [line, ...kids.flatMap((c) => tree(c, d + 1, max))];
  };
  const mw = document.getElementById('modal-wrapper');
  const la = document.getElementById('last_added_product');
  const btn = (re) => [...mw.querySelectorAll('a, button')].find((e) => re.test(e.textContent));
  const ver = btn(/Ver carrinho/), cont = btn(/Continuar comprando/);
  const cta = document.getElementById('add-to-cart-desk') || document.getElementById('add-to-cart-mob');
  const fontProps = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderRadius', 'lineHeight', 'letterSpacing', 'padding'];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    modalWrapper: { ...rect(mw), ...cs(mw, ['position', 'display', 'zIndex', 'overflow', 'backgroundColor']) },
    chain: (() => { const c = []; for (let e = la; e && e !== document.body; e = e.parentElement) c.push(desc(e) + ' ' + JSON.stringify(rect(e)) + ' ' + getComputedStyle(e).position); return c; })(),
    tree: tree(mw),
    verCarrinho: ver && { ...rect(ver), tag: ver.tagName, href: ver.getAttribute('href'), ...cs(ver, fontProps) },
    continuar: cont && { ...rect(cont), tag: cont.tagName, ...cs(cont, fontProps) },
    nativeCta: cta && cs(cta, fontProps),
    bodyFont: cs(document.body, ['fontFamily', 'fontSize', 'color']),
    scrollables: [...mw.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; }).map((e) => desc(e) + ' ' + e.scrollHeight + '/' + e.clientHeight),
    closeButtons: [...mw.querySelectorAll('button, a')].filter((e) => /close|fechar|×|✕/i.test((e.getAttribute('aria-label') || '') + (e.getAttribute('data-action') || '') + e.textContent)).map((e) => desc(e) + ' aria=' + e.getAttribute('aria-label') + ' action=' + e.getAttribute('data-action')),
    ariaRole: { role: mw.getAttribute('role'), ariaModal: mw.getAttribute('aria-modal'), dialogs: [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog')].map(desc) },
    bodyOverflow: getComputedStyle(document.body).overflow,
    hScroll: document.documentElement.scrollWidth
  };
});
audit.preAdd = pre;
writeFileSync(`${out}/${tag}-drawer-${mode}.audit.json`, JSON.stringify(audit, null, 1));
console.log('AUDIT', mode, JSON.stringify({ viewport: audit.viewport, mw: audit.modalWrapper, ver: audit.verCarrinho, cont: audit.continuar, scrollables: audit.scrollables, close: audit.closeButtons, aria: audit.ariaRole, pre }, null, 1));
console.log(audit.tree.join('\n'));
console.log('CHAIN', audit.chain.join('\n      '));
// fecha o drawer pelo controle nativo e mede o estado fechado
await browser.close();
