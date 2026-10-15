#!/usr/bin/env node
// QA do size-fit ("Informar medidas") em NAVEGADOR REAL contra PDPs REAIS da INK, sem publicar nada:
//   PW_PATH=<dir com playwright-core> node scripts/qa-size-fit.mjs
// Mesmo desenho de qa-pdp-extras.mjs: o HTML real de produto passa pelo Worker LOCAL (Miniflare, mesmo HTMLRewriter/loader de produção) e
// /__origens/** é respondido por ele. Sessão anônima descartável; tags de analytics bloqueadas; nada é adicionado ao carrinho. Computador
// (1440×900) e celular (390×844). Capturas em QA_EVIDENCE_DIR (padrão docs/evidence/informar-medidas/).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { shellPageKind } from '../src/scope.js';
import { STORES } from '../src/stores.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const { workerModules } = await import('../test/helpers.js');

const OUT = ((process.env.QA_EVIDENCE_DIR || new URL('../docs/evidence/informar-medidas/', import.meta.url).pathname) + '/').replace(/\/+$/, '/');
mkdirSync(OUT, { recursive: true });
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,size-fit';
const failures = [];
const check = (n, ok, d = '') => { if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 300) : '')); };

const CASES = [
  { store: 'sul', path: '/usesul/product/paranaense-pe-vermelho', label: 'classica', model: 'Masculino', width: '55,5', length: '74', expect: 'G' },
  { store: 'sul', path: '/usesul/product/churrasco-e-cerveja-treino-p-b', label: 'oversized', model: null, width: '63', length: '', expect: 'M' }
];
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];

const upstream = { html: '', status: 200 };
const mf = new Miniflare({
  ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
  bindings: { STORE_ID: 'sul', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: FEATURES },
  outboundService: async (req) => {
    const url = new URL(req.url);
    if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
    return new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(viewport) {
  const store = STORES.sul;
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'pt-BR', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar/, (r) => r.abort());
  const page = await ctx.newPage();
  const posts = [];
  ctx.on('request', (req) => { const u = new URL(req.url()); if (req.method() === 'POST' && u.host === store.inkHost && !u.pathname.startsWith('/cdn-cgi/')) posts.push(u.pathname); });
  await page.route('**/__origens/**', async (route) => {
    const req = route.request();
    const res = await mf.dispatchFetch(req.url(), { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '' }, body: req.method() === 'POST' ? req.postData() : undefined });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  const productRe = new RegExp('^' + store.inkBase + '/product/[^/]+$');
  await page.route((u) => u.host === store.inkHost && (productRe.test(u.pathname) || shellPageKind(u.pathname, store.inkBase) !== null), async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch({ maxRedirects: 0 });
    if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
    upstream.html = await res.text(); upstream.status = res.status();
    const out = await mf.dispatchFetch(route.request().url());
    await route.fulfill({ response: res, body: await out.text() });
  });
  await page.route('https://useorigens.com.br/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>stub</body></html>' }));
  return { ctx, page, store, mobile, posts };
}

// Toque: confere por elementFromPoint que nada cobre o alvo e ativa com el.click() (no celular emulado o toque sintético cai ~35 px abaixo).
async function press(page, selector, label) {
  await page.evaluate((sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await wait(page, 500);
  const pts = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
    const r = el.getBoundingClientRect();
    return [0.1, 0.5, 0.9].map((fx) => { const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2); return e === el || el.contains(e) ? 'ok' : (e ? e.tagName + '.' + String(e.className).slice(0, 40) : 'null'); });
  }, selector);
  check(label + ': área livre', pts.every((p) => p === 'ok'), pts.join(' | '));
  await page.evaluate((sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length).click(), selector);
  await wait(page, 400);
}

for (const vp of VIEWPORTS) {
  for (const c of CASES) {
    const tag = c.label + '-' + vp.name;
    const s = await session(vp);
    const { page } = s;
    await page.goto('https://' + s.store.inkHost + c.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center' }));
    const found = await page.waitForSelector('button[data-origens-fit]', { timeout: 25000 }).then(() => true).catch(() => false);
    check(tag + ': botão "Informar medidas" presente', found);
    if (!found) { await page.screenshot({ path: OUT + tag + '-sem-botao.png' }); await s.ctx.close(); continue; }
    const row = await page.evaluate(() => {
      const r = document.querySelector('[data-origens-fit-row]');
      const [a, b] = [...r.children].map((e) => e.getBoundingClientRect());
      return { sameLine: Math.abs(a.top - b.top) < 2, h: [Math.round(a.height), Math.round(b.height)], right: Math.round(Math.max(a.right, b.right)), cw: document.documentElement.clientWidth, guide: r.children[0].innerText.trim() };
    });
    check(tag + ': lado a lado com o Guia de medidas, mesma altura, dentro da tela', row.sameLine && row.h[0] === row.h[1] && row.right <= row.cw, JSON.stringify(row));
    await page.evaluate(() => document.querySelector('[data-origens-fit-row]').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await wait(page, 400);
    await page.screenshot({ path: OUT + tag + '-1-botao.png' });

    if (c.model) await page.evaluate((m) => [...document.querySelectorAll('input[name="style"]')].find((i) => i.value === m)?.click(), c.model);
    await page.evaluate(() => [...document.querySelectorAll('input[name="color"]')][0]?.click());
    await wait(page, 1200);
    await page.waitForSelector('button[data-origens-fit]', { timeout: 15000 });
    await press(page, 'button[data-origens-fit]', tag + ': abrir');
    const opened = await page.evaluate(() => { const p = document.querySelector('#o-fit .o-fit-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), cw: document.documentElement.clientWidth, focus: document.activeElement && document.activeElement.id }; });
    check(tag + ': painel aberto, dentro da largura visível, foco no campo', !!opened && opened.left >= 0 && opened.right <= opened.cw && opened.focus === 'o-fit-width', JSON.stringify(opened));
    const covered = await page.evaluate(() => {
      const p = document.querySelector('#o-fit .o-fit-panel'); const r = p.getBoundingClientRect();
      const y = Math.min(r.bottom, innerHeight) - 12;
      return [0.2, 0.5, 0.8].map((fx) => { const e = document.elementFromPoint(r.left + r.width * fx, y); return p.contains(e) ? 'ok' : (e ? e.tagName + '.' + String(e.className).slice(0, 50) + ' z=' + getComputedStyle(e.closest('[class]') || e).zIndex : 'null'); });
    });
    check(tag + ': nada da página por cima do painel', covered.every((c) => c === 'ok'), covered.join(' | '));
    await page.screenshot({ path: OUT + tag + '-2-painel.png' });

    await page.fill('#o-fit-width', c.width);
    if (c.length) await page.fill('#o-fit-length', c.length);
    await page.evaluate(() => document.querySelector('#o-fit form button[type=submit]').click());
    await wait(page, 400);
    const verdict = await page.evaluate(() => document.querySelector('#o-fit .o-fit-verdict')?.textContent || '');
    check(tag + ': resultado ' + c.expect, new RegExp('tamanho ' + c.expect + ' ').test(verdict), verdict);
    await page.evaluate(() => document.querySelector('#o-fit .o-fit-result').scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.screenshot({ path: OUT + tag + '-3-resultado.png' });

    const available = await page.evaluate((size) => {
      const opts = [...document.querySelectorAll('[data-controller~="ink-store--product--product-options"]')][0];
      const v = JSON.parse(opts.getAttribute('data-ink-store--product--product-options-variants-value'));
      const model = opts.querySelector('input[name="style"]:checked')?.value; const color = opts.querySelector('input[name="color"]:checked')?.value;
      return v.some((x) => x.size === size && x.is_available && (!model || x.model === model) && (!color || x.color === color));
    }, c.expect);
    await page.evaluate(() => document.querySelector('#o-fit .o-fit-actions .o-fit-cta').click());
    await wait(page, 800);
    const after = await page.evaluate(() => ({ dialog: !!document.getElementById('o-fit'), size: [...document.querySelectorAll('input[name="size"]:checked')].map((i) => i.value)[0] || null }));
    if (available) check(tag + ': "Usar tamanho ' + c.expect + '" marcou o tamanho na INK e fechou', !after.dialog && after.size === c.expect, JSON.stringify(after));
    else check(tag + ': tamanho indisponível não é marcado', after.dialog && after.size !== c.expect, JSON.stringify(after));
    await page.evaluate(() => document.querySelector('[data-origens-fit-row]')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await wait(page, 300);
    await page.screenshot({ path: OUT + tag + '-4-tamanho-marcado.png' });
    check(tag + ': nenhum POST para a INK (nada foi ao carrinho)', s.posts.length === 0, s.posts.join(','));
    await s.ctx.close();
  }
}

await browser.close();
await mf.dispose();
console.log(failures.length ? '\n' + failures.length + ' falha(s): ' + failures.join('; ') : '\nTudo certo.');
process.exit(failures.length ? 1 : 0);
