// Harness da prévia do tema da compra (usado por preview-tema.mjs e estados-tema.mjs): páginas REAIS da INK passando pelo Worker LOCAL (Miniflare,
// mesmo worker.js/HTMLRewriter/loader de produção) com a configuração do tema vinda de um arquivo (rascunho do painel). Nada é publicado.
// TRAVA: no navegador, qualquer não-GET para <loja>/checkout é ABORTADA (nunca chega à INK); as do carrinho também, salvo allowCart.
import { createRequire } from 'node:module';
import { shellPageKind } from '../../src/scope.js';
import { STORES } from '../../src/stores.js';
import { checkoutPageKind } from '../../src/theme.js';

export const REFERENCE_THEME = {
  v: 1, region: 'sul', surfaces: { pdp: true, cart: true, checkout: true },
  tokens: { action: '#000000', onAction: '#ffffff', selected: '#4d543d', onSelected: '#ffffff', ground: '#ffffff', surface: '#ffffff', paper: '#f2f2f0', photo: '#e5e5e5', ink: '#000000', inkSoft: '#33332f', inkMute: '#56564f', line: '#b3b3b0', radius: 0, font: 'origens' }
};
export const LIVE_FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide,size-fit';
export const DEFAULT_PDP = '/usesul/product/florianopolis-legado-sc-b88373a3-9f47-418d-a6b4-f27757ac3fa4';
export const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
// Campos e blocos com dados pessoais do checkout: mascarados em TODA captura (inclusive "antes").
// Campos com valor vindo do servidor (contato/endereço) são mascarados; os VAZIOS (cartão, cobrança) ficam visíveis para avaliar o estilo — nada é digitado.
const PII = ['[data-controller="ink-store--checkout"] input[value]:not([value=""]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"])', '[data-controller="ink-store--checkout"] select:has(option[selected]:not([value=""]))', '.md\\:hidden.flex.flex-col .text-sm.font-normal', '.md\\:hidden.flex.flex-col .text-lg', '.md\\:flex.md\\:flex-col.items-center small', '.md\\:hidden.flex.md\\:flex-col small', '#saved_address_offer', 'turbo-frame#cart_summary + * small'];

// `config` é lido A CADA pedido do Worker ao storefront: mudar o objeto durante a sessão simula uma nova publicação no painel (o Worker ainda guarda 60 s
// por isolate). `themeFeatures` troca as features de tema do deploy (padrão: as três).
export async function createHarness({ config = REFERENCE_THEME, off = false, headed = false, allowCart = false, themeFeatures = 'theme-pdp,theme-cart,theme-checkout' } = {}) {
  const require = createRequire((process.env.PW_PATH || '.') + '/');
  const { chromium } = require('playwright-core');
  const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
  const { workerModules } = await import('../../test/helpers.js');
  const store = STORES.sul;
  const HOST = 'https://' + store.inkHost;
  const features = off || !themeFeatures ? LIVE_FEATURES : LIVE_FEATURES + ',' + themeFeatures;
  const upstream = { html: '', status: 200 };
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
    bindings: { STORE_ID: 'sul', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: features },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.host === 'useorigens.com.br' && url.pathname === store.inkThemeApi) return Response.json(config);
      if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
      return new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !headed });
  const blocked = [];
  async function session({ name, width, height }) {
    const mobile = width < 600;
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar|kdt|konduto/, (r) => r.abort());
    await ctx.route((u) => u.host === store.inkHost && !u.pathname.startsWith('/cdn-cgi/') && !u.pathname.startsWith('/__origens/'), async (route) => {
      const req = route.request();
      if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback();
      const path = new URL(req.url()).pathname;
      if (path.includes('/checkout') || !allowCart) { blocked.push(name + ' ' + req.method() + ' ' + path.replace(/[0-9a-f-]{36}/g, '<uuid>').replace(/\d{5,}/g, '<id>')); return route.abort(); }
      return route.fallback();
    });
    await ctx.route('**/__origens/**', async (route) => {
      const req = route.request();
      const res = await mf.dispatchFetch(req.url(), { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '', origin: req.headers().origin || '', referer: req.headers().referer || '' }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    const productRe = new RegExp('^' + store.inkBase + '/product/[^/]+$');
    await ctx.route((u) => u.host === store.inkHost && (productRe.test(u.pathname) || shellPageKind(u.pathname, store.inkBase) !== null || checkoutPageKind(u.pathname, store.inkBase) !== null), async (route) => {
      const req = route.request();
      // Documento E visitas Turbo (fetch com Accept text/html): em produção a rota do Worker cobre o caminho seja qual for o tipo de pedido. Frames
      // (header Turbo-Frame) também passam pelo Worker, que os devolve intactos — como no real.
      const kind = req.resourceType();
      if (req.method() !== 'GET' || !(kind === 'document' || ((kind === 'fetch' || kind === 'xhr') && /text\/html/.test(req.headers().accept || '')))) return route.fallback();
      const res = await route.fetch({ maxRedirects: 0, timeout: 60000 });
      if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
      upstream.html = await res.text(); upstream.status = res.status();
      const fwd = { accept: req.headers().accept || 'text/html' };
      if (req.headers()['turbo-frame']) fwd['turbo-frame'] = req.headers()['turbo-frame'];
      const out = await mf.dispatchFetch(req.url(), { headers: fwd });
      const headers = { ...res.headers() }; delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
      await route.fulfill({ status: out.status, headers, body: await out.text() });
    });
    const page = await ctx.newPage();
    return { ctx, page, mobile, name };
  }
  const acceptCookies = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /aceitar cookies/i.test(x.textContent || '')); if (b) b.click(); });
  const pii = (page) => [...PII.map((s) => page.locator(s)), page.locator('div:has(> div > a[aria-label="Editar endereço de entrega"]), div:has(> a[aria-label="Editar endereço de entrega"])'), page.locator('li', { hasText: /Entrega para/ })];
  const shot = (page, path, full = false) => page.screenshot({ path, fullPage: full, mask: pii(page), maskColor: '#ff5fa2' });
  const close = async () => { await browser.close(); await mf.dispose(); };
  return { session, browser, mf, blocked, HOST, store, acceptCookies, shot, close };
}
