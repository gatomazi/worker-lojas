#!/usr/bin/env node
// Prévia INTERATIVA (local): abre um Chrome visível com as PDPs REAIS da INK passando pelo Worker LOCAL (Miniflare) com auto-recommendations ligada.
// /api/recommendations/** vai ao storefront LOCAL (RECO_STOREFRONT); navbar/cidades ao storefront de produção (GET públicos). Nada é publicado.
//   PW_PATH=<dir com playwright-core> RECO_STOREFRONT=http://127.0.0.1:3107 node scripts/preview-recommendations.mjs [sul|norte|centro] [caminho]
// Feche a janela para encerrar. Navegue à vontade dentro da loja (Turbo incluído); NÃO finalize pedidos.
import { createRequire } from 'node:module';
import { shellPageKind } from '../src/scope.js';
import { STORES } from '../src/stores.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const { workerModules } = await import('../test/helpers.js');

const LOCAL_SF = (process.env.RECO_STOREFRONT || 'http://127.0.0.1:3107').replace(/\/$/, '');
const storeId = process.argv[2] || 'sul';
const store = STORES[storeId];
const start = process.argv[3] || (storeId === 'sul' ? '/usesul/product/florianopolis-origem-sc-0faeb956-3b10-4a06-8f93-2c9cff8d1afb' : store.inkBase);
const upstream = new Map(); // url -> { html, status }
const mf = new Miniflare({
  ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
  bindings: { STORE_ID: storeId, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,auto-recommendations' },
  outboundService: async (req) => {
    const url = new URL(req.url);
    if (url.host === 'useorigens.com.br' && url.pathname.startsWith('/api/recommendations/')) return fetch(LOCAL_SF + url.pathname, { headers: { accept: 'application/json' } });
    if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
    const page = upstream.get(url.href) || { html: '', status: 502 };
    return new Response(page.html, { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
});
// MOBILE=1: emula um celular (390×844, toque, DPR 3, user agent de iPhone) para ver o carrossel.
const MOBILE = process.env.MOBILE === '1';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: [MOBILE ? '--window-size=430,960' : '--window-size=1440,900'] });
const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
  : { viewport: null, locale: 'pt-BR' });
await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar/, (r) => r.abort());
await ctx.route('**/__origens/**', async (route) => {
  const req = route.request();
  const res = await mf.dispatchFetch(req.url(), { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '' }, body: req.method() === 'POST' ? req.postData() : undefined });
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});
const productRe = new RegExp('^' + store.inkBase + '/product/[^/]+$');
await ctx.route((u) => u.host === store.inkHost && (productRe.test(u.pathname) || shellPageKind(u.pathname, store.inkBase) !== null), async (route) => {
  if (route.request().resourceType() !== 'document') return route.continue();
  const res = await route.fetch({ maxRedirects: 0 });
  if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
  upstream.set(route.request().url(), { html: await res.text(), status: res.status() });
  const out = await mf.dispatchFetch(route.request().url());
  await route.fulfill({ response: res, body: await out.text() });
});
const page = await ctx.newPage();
console.log('Abrindo https://' + store.inkHost + start + ' — feche a janela para encerrar.');
await page.goto('https://' + store.inkHost + start, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((resolve) => browser.on('disconnected', resolve));
await mf.dispose();
