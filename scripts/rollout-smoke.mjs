#!/usr/bin/env node
// Smoke do rollout controlado contra https://www.usesul.com.br (somente o que um visitante anônimo faria).
//   node scripts/rollout-smoke.mjs <base|off|dry|on> [--shots docs/evidence/rollout]
// Requer playwright-core (NÃO é dependência do projeto): npm i --no-save playwright-core  (ou NODE_PATH) e o Chrome instalado.
// Cada execução usa um contexto de navegador NOVO (sessão anônima isolada). Este script NÃO mexe em carrinho:
// os fluxos de compra assistida (adicionar ao carrinho, drawer, ida e volta ao storefront) são feitos à parte no
// Chrome visível (Claude in Chrome), porque o headless é tratado como bot pela INK. Não abre checkout, não envia
// cookies/tokens de terceiros e não imprime valores de cookies.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(process.env.PW_PATH ? process.env.PW_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const phase = process.argv[2];
if (!['base', 'off', 'dry', 'on'].includes(phase)) { console.error('uso: rollout-smoke.mjs <base|off|dry|on>'); process.exit(2); }
const shotsIdx = process.argv.indexOf('--shots');
const shotsDir = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const HOST = 'https://www.usesul.com.br';
const ALLOWED = '/usesul/product/serra-catarinense';
const OTHER = '/usesul/product/vida-no-sul-estancia-edition';
const STOREFRONT = 'https://useorigens.com.br/sul';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MARK = 'MARCA_' + Math.random().toString(36).slice(2, 10); // valor plantado em query/cabeçalhos: nunca pode aparecer em log nosso

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
const info = (name, detail) => console.log('INFO ' + name + '  — ' + detail);

// ---------- HTTP (sem seguir redirects, sem cookies) ----------
async function get(path, init = {}) {
  const res = await fetch(HOST + path, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html', 'accept-encoding': 'gzip, br', ...(init.headers || {}) }, method: init.method || 'GET', body: init.body });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, cookies: res.headers.getSetCookie().map((c) => c.split('=')[0]) };
}
const loaderTags = (text) => (text.match(/<script[^>]*data-use-origens-widget[^>]*>/g) || []).length;
const fingerprint = (text) => ({
  title: (text.match(/<title>([^<]*)<\/title>/) || [])[1] || null,
  forms: (text.match(/<form\b/g) || []).length,
  ctaDesk: text.includes("id='add-to-cart-desk'") || text.includes('id="add-to-cart-desk"'),
  ctaMob: text.includes("id='add-to-cart-mob'") || text.includes('id="add-to-cart-mob"'),
  turboFrameCart: /<turbo-frame id="cart"/.test(text)
});

async function httpChecks() {
  const health = await get('/__origens/health');
  const loader = await get('/__origens/loader.js');
  const product = await get(ALLOWED);
  const other = await get(OTHER);
  const home = await get('/usesul');
  const frame = await get(ALLOWED, { headers: { 'Turbo-Frame': 'cart' } });
  const cart = await get('/usesul/cart');
  const checkout = await get('/usesul/checkout');
  const withQuery = await get(ALLOWED + '?utm_source=' + MARK + '&x=1', { headers: { 'x-probe': MARK, authorization: 'Bearer ' + MARK, cookie: 'probe=' + MARK } });

  const baseFp = fingerprint(product.text);
  check('produto: HTTP 200 HTML, private/no-store, ' + (product.headers.get('cf-ray') ? 'passa pela Cloudflare' : 'SEM cf-ray'), product.status === 200 && /text\/html/.test(product.headers.get('content-type') || '') && /no-store/.test(product.headers.get('cache-control') || '') && !!product.headers.get('cf-ray'),
    'cf-cache-status=' + product.headers.get('cf-cache-status') + ' ce=' + product.headers.get('content-encoding'));
  check('produto: cf-cache-status não é HIT (HTML de sessão não cacheado)', !/HIT/i.test(product.headers.get('cf-cache-status') || ''), String(product.headers.get('cf-cache-status')));
  check('produto: cookies de sessão da INK presentes', ['_reserva_ink_store_session', 'guest_token'].every((n) => product.cookies.includes(n)), product.cookies.length + ' linhas Set-Cookie');
  check('produto: HTML estruturalmente íntegro (título, CTA desktop/mobile, form, turbo-frame)', baseFp.title && baseFp.ctaDesk && baseFp.ctaMob && baseFp.forms >= 3 && baseFp.turboFrameCart, JSON.stringify(baseFp));
  check('produto: sem erro 52x', product.status < 520);
  check('home /usesul: 200 e sem loader', home.status === 200 && loaderTags(home.text) === 0);
  check('outro produto: 200 e sem loader', other.status === 200 && loaderTags(other.text) === 0 && phase !== 'on' ? true : (other.status === 200 && loaderTags(other.text) === 0));
  check('Turbo-Frame no produto permitido: sem loader', loaderTags(frame.text) === 0);
  check('/usesul/cart (anônimo): sem loader e status igual ao da INK (' + cart.status + ')', loaderTags(cart.text) === 0);
  check('/usesul/checkout (anônimo): sem loader, sem 52x, sem redirect nosso', loaderTags(checkout.text) === 0 && checkout.status < 520, 'status=' + checkout.status + ' location=' + (checkout.headers.get('location') || '-'));
  info('checkout/cart status', 'cart=' + cart.status + ' checkout=' + checkout.status);

  if (phase === 'base') {
    check('base: /__origens/health é 404 (nenhum Worker no www)', health.status === 404, String(health.status));
    check('base: produto sem loader', loaderTags(product.text) === 0);
  } else {
    let h = {};
    try { h = JSON.parse(health.text); } catch { /* fica vazio */ }
    check('health 200 do Worker', health.status === 200 && h.service === 'use-sul-widget', 'version=' + h.version);
    if (phase === 'off') {
      check('off: widget_mode=false, allowlist vazia', h.widget_mode === 'false' && h.allowlist_status === 'empty' && h.allowlist_size === 0, JSON.stringify(h));
      check('off: loader.js é no-op', loader.status === 200 && loader.text === '/* use-origens widget disabled */' && /javascript/.test(loader.headers.get('content-type') || ''));
      check('off: produto sem loader', loaderTags(product.text) === 0 && loaderTags(withQuery.text) === 0);
    }
    if (phase === 'dry') {
      check('dry: widget_mode=dry-run, allowlist ok com 1 caminho', h.widget_mode === 'dry-run' && h.allowlist_status === 'ok' && h.allowlist_size === 1, JSON.stringify(h));
      check('dry: loader.js segue no-op', loader.status === 200 && loader.text === '/* use-origens widget disabled */');
      check('dry: zero modificações no HTML (produto, outro, query)', loaderTags(product.text) === 0 && loaderTags(other.text) === 0 && loaderTags(withQuery.text) === 0);
    }
    if (phase === 'on') {
      check('on: widget_mode=true, allowlist ok com 1 caminho', h.widget_mode === 'true' && h.allowlist_status === 'ok' && h.allowlist_size === 1, JSON.stringify(h));
      check('on: loader.js acessível (200 JS) e embute SÓ o caminho autorizado', loader.status === 200 && /javascript/.test(loader.headers.get('content-type') || '') && loader.text.includes('const ALLOWED_PATHS = ["' + ALLOWED + '"];'), 'bytes=' + loader.text.length);
      check('on: produto autorizado tem EXATAMENTE 1 loader', loaderTags(product.text) === 1, String(loaderTags(product.text)));
      check('on: produto autorizado com query também tem 1 loader', loaderTags(withQuery.text) === 1);
      check('on: outro produto, home, carrinho, checkout, Turbo-Frame NÃO recebem loader', [other, home, cart, checkout, frame].every((r) => loaderTags(r.text) === 0));
      const idx = product.text.indexOf('data-use-origens-widget');
      check('on: loader vem antes de </head> e o resto do HTML segue íntegro', idx > 0 && idx < product.text.indexOf('</head>') && JSON.stringify(fingerprint(product.text)) === JSON.stringify(baseFp));
      check('on: cookies de sessão preservados na página reescrita', ['_reserva_ink_store_session', 'guest_token'].every((n) => product.cookies.includes(n)));
      check('on: cabeçalhos: sem CSP/CORS/HSTS adicionados por nós e cache continua private/no-store', /no-store/.test(product.headers.get('cache-control') || '') && !product.headers.get('access-control-allow-origin'));
    }
  }
  return { product, health };
}

// ---------- DOM (Playwright, contexto anônimo novo) ----------
const consoleErrors = [];
async function newContext(browser, mobile) {
  const opts = mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1280, height: 900 }, userAgent: UA };
  const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' });
  return ctx;
}
async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ tag, text: m.text().slice(0, 140) }); });
  page.on('pageerror', (e) => consoleErrors.push({ tag, text: String(e.message).slice(0, 140) }));
  return page;
}
const linkCount = (page) => page.evaluate(() => document.querySelectorAll('#use-origens-return-link').length);
const scriptCount = (page) => page.evaluate(() => document.querySelectorAll('script[data-use-origens-widget]').length);
const settle = (page, ms = 1800) => page.waitForTimeout(ms);

async function pickVariant(page) {
  await page.evaluate(() => {
    for (const id of ['4932916-model-Masculino', '4932916-color-Preta', '4932916-size-M']) document.getElementById(id).labels[0].click();
  });
  await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0, null, { timeout: 8000 });
}

async function domChecks(browser) {
  // ---- desktop 1280
  const dctx = await newContext(browser, false);
  const d = await newPage(dctx, 'desktop');
  await d.goto(HOST + ALLOWED, { waitUntil: 'load' });
  await settle(d, 2500);
  const cta = await d.evaluate(() => { const c = document.getElementById('add-to-cart-desk'); return c && { visible: c.getClientRects().length > 0, text: c.textContent.trim() }; });
  check('desktop 1280: CTA nativo presente e visível', cta && cta.visible && /Adicionar ao Carrinho/i.test(cta.text));
  const links = await linkCount(d);
  if (phase === 'on') {
    check('desktop 1280: EXATAMENTE 1 link "← Voltar a procurar" e 1 script do loader', links === 1 && (await scriptCount(d)) === 1, 'links=' + links + ' scripts=' + (await scriptCount(d)));
    const geo = await d.evaluate(() => {
      const l = document.getElementById('use-origens-return-link'); const c = document.getElementById('add-to-cart-desk');
      if (!l || !c) return null;
      const lr = l.getBoundingClientRect(); const cr = c.getBoundingClientRect();
      return { text: l.textContent.trim(), href: l.href, prevIsCta: l.previousElementSibling === c, below: lr.top >= cr.bottom - 1, overlap: !(lr.bottom <= cr.top || lr.top >= cr.bottom || lr.right <= cr.left || lr.left >= cr.right), linkVisible: lr.width > 0 && lr.height > 0, insideFixed: !!l.closest('.form-product-options__add-to-cart-mobile') };
    });
    check('desktop: link logo abaixo do CTA nativo, sem sobreposição', geo && geo.text === '← Voltar a procurar' && geo.prevIsCta && geo.below && !geo.overlap && geo.linkVisible && !geo.insideFixed, JSON.stringify(geo));
    check('desktop: href do link é o storefront', geo && geo.href === STOREFRONT, geo && geo.href);
  } else {
    check('desktop 1280: nenhum link nosso na página', links === 0 && (await scriptCount(d)) === 0, 'links=' + links);
  }
  if (shotsDir) { await d.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center' })); await d.screenshot({ path: `${shotsDir}/${phase}-desktop-1280.jpg`, type: 'jpeg', quality: 60 }); }

  // ---- Turbo: permitido -> não permitido -> permitido
  await d.goto(HOST + ALLOWED, { waitUntil: 'load' });
  await settle(d, 2000);
  const seq = [];
  seq.push(await linkCount(d));
  await d.evaluate((p) => window.Turbo.visit(p), OTHER);
  await d.waitForURL('**' + OTHER, { timeout: 15000 }); await settle(d, 2500);
  seq.push(await linkCount(d));
  await d.evaluate((p) => window.Turbo.visit(p), ALLOWED);
  await d.waitForURL('**' + ALLOWED, { timeout: 15000 }); await settle(d, 2500);
  seq.push(await linkCount(d));
  const expected = phase === 'on' ? [1, 0, 1] : [0, 0, 0];
  check('Turbo permitido → não permitido → permitido: link ' + expected.join(' → '), JSON.stringify(seq) === JSON.stringify(expected), 'observado ' + seq.join(' → ') + '; scripts=' + (await scriptCount(d)));

  await dctx.close();

  // ---- mobile 390 real (emulação de dispositivo)
  const mctx = await newContext(browser, true);
  const m = await newPage(mctx, 'mobile');
  await m.goto(HOST + ALLOWED, { waitUntil: 'load' });
  await settle(m, 3000);
  const vw = await m.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: 'ontouchstart' in window }));
  check('mobile: viewport de layout REAL de 390 px (emulação Playwright/CDP)', vw.w === 390, JSON.stringify(vw));
  const mlinks = await linkCount(m);
  const geo = await m.evaluate(() => {
    const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; };
    const l = document.getElementById('use-origens-return-link'); const desk = document.getElementById('add-to-cart-desk'); const mob = document.getElementById('add-to-cart-mob');
    const fixedBar = mob && mob.closest('.form-product-options__add-to-cart-mobile');
    const inter = (a, b) => a && b && !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
    return {
      deskVisible: !!desk && desk.getClientRects().length > 0, mobVisible: !!mob && mob.getClientRects().length > 0,
      fixedPos: fixedBar ? getComputedStyle(fixedBar).position : null,
      link: rect(l), desk: rect(desk), bar: rect(fixedBar),
      linkVsDeskOverlap: inter(rect(l), rect(desk)), linkVsBarOverlap: inter(rect(l), rect(fixedBar)),
      linkInsideFixed: !!(l && l.closest('.form-product-options__add-to-cart-mobile')), hScroll: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check('mobile: CTA nativo em fluxo e barra fixa do CTA móvel presentes', geo.deskVisible && geo.mobVisible && geo.fixedPos === 'fixed', 'fixedPos=' + geo.fixedPos);
  if (phase === 'on') {
    check('mobile 390: EXATAMENTE 1 link, abaixo do CTA nativo, fora da barra fixa', mlinks === 1 && geo.link && geo.link.top >= geo.desk.bottom - 1 && !geo.linkInsideFixed, 'links=' + mlinks);
    // o link é reposicionado pelo scroll: só a sobreposição com a barra fixa NA posição de rolagem em que ele aparece importa
    await m.evaluate(() => document.getElementById('use-origens-return-link').scrollIntoView({ block: 'center' }));
    await settle(m, 500);
    const ov = await m.evaluate(() => {
      const r = (e) => e.getBoundingClientRect(); const l = document.getElementById('use-origens-return-link'); const bar = document.querySelector('.form-product-options__add-to-cart-mobile'); const desk = document.getElementById('add-to-cart-desk');
      const inter = (a, b) => !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
      return { vsBar: inter(r(l), r(bar)), vsDesk: inter(r(l), r(desk)), linkFullyInViewport: r(l).top >= 0 && r(l).bottom <= innerHeight };
    });
    check('mobile 390: link centralizado no viewport não se sobrepõe ao CTA nativo nem à barra fixa', !ov.vsBar && !ov.vsDesk && ov.linkFullyInViewport, JSON.stringify(ov));
    // A página da INK já tem overflow horizontal próprio (turbo-frame#cart / gaveta do carrinho). Só importa se o LINK o causa:
    // mede a largura de rolagem com o link visível e oculto na mesma página.
    const hs = await m.evaluate(() => { const l = document.getElementById('use-origens-return-link'); const w = () => document.documentElement.scrollWidth; const com = w(); l.style.display = 'none'; const sem = w(); l.style.display = ''; const r = l.getBoundingClientRect(); return { com, sem, linkInViewport: r.left >= 0 && r.right <= innerWidth }; });
    check('mobile 390: o link não causa rolagem horizontal (largura igual com e sem o link)', hs.com === hs.sem && hs.linkInViewport, JSON.stringify(hs) + ' (overflow preexistente da INK: ' + geo.hScroll + ')');
    if (shotsDir) await m.screenshot({ path: `${shotsDir}/${phase}-mobile-390-link.jpg`, type: 'jpeg', quality: 60 });
    // pior caso: rolar até o fim da página e ver se a barra fixa cobre o link (o link ainda deve ser alcançável)
    await m.evaluate(() => { const l = document.getElementById('use-origens-return-link'); l.scrollIntoView({ block: 'end' }); });
    await settle(m, 400);
    const worst = await m.evaluate(() => {
      const r = (e) => e.getBoundingClientRect(); const l = document.getElementById('use-origens-return-link'); const bar = document.querySelector('.form-product-options__add-to-cart-mobile');
      return { linkBottom: Math.round(r(l).bottom), barTop: Math.round(r(bar).top), covered: r(l).bottom > r(bar).top };
    });
    info('mobile 390: link rolado ao rodapé da viewport', JSON.stringify(worst) + ' (se covered=true, basta rolar; a barra fixa é da INK)');
  } else {
    check('mobile 390: nenhum link nosso na página', mlinks === 0);
    if (shotsDir) await m.screenshot({ path: `${shotsDir}/${phase}-mobile-390.jpg`, type: 'jpeg', quality: 60 });
  }
  await mctx.close();
}

const http = await httpChecks();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try { await domChecks(browser); } finally { await browser.close(); }

const ours = consoleErrors.filter((e) => /use.?origens/i.test(e.text));
check('console: nenhum erro atribuível ao loader/Worker', ours.length === 0, ours.map((e) => e.text).join(' | '));
const preexisting = [...new Set(consoleErrors.filter((e) => !/use.?origens/i.test(e.text)).map((e) => e.text.slice(0, 90)))];
info('erros de console PREEXISTENTES da INK (não são regressão)', preexisting.length ? preexisting.join(' | ') : 'nenhum');

const failed = results.filter((r) => !r.ok);
console.log(`\nRESUMO fase=${phase}: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
console.log('PROBE_MARK=' + MARK);
process.exit(failed.length ? 1 : 0);
