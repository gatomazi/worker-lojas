#!/usr/bin/env node
// QA da expansão GLOBAL (escopo product-catalog) contra as páginas REAIS da INK, em navegador visível, sessão anônima descartável.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-global.mjs            -> local: Worker+KV em Miniflare (nada publicado)
//   PW_PATH=... node scripts/qa-global.mjs --live                               -> produção (só para o release; sem finalizar pedido)
//   node scripts/qa-global.mjs --allowlist                                      -> local no modo padrão (cinco produtos)
// Bloqueia as tags de analytics da INK (nenhum evento real). Os eventos NOSSOS são capturados no dataLayer. Não abre checkout.
// Mede o custo do KV pelo navegador: cada POST /__origens/cart-ref aceito (201) = 1 KV.put.
// Variáveis: QA_ONLY=journey (pula a amostra), QA_REAL_STOREFRONT=1 (local: navega ao storefront REAL em vez do stub),
//            QA_EVIDENCE_DIR=<dir> (em qualquer falha grava screenshot, URL, eventos de navegação, resumo do carrinho, resposta do
//            storefront e o motivo EXATO em <dir>; o release usa .release/evidence/<ts>). Toda falha é CLASSIFICADA: QA | INK | Worker | Storefront.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const LIVE = process.argv.includes('--live'); const ONLY = process.env.QA_ONLY || ''; const REAL_SF = process.env.QA_REAL_STOREFRONT === '1'; const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR || ''; const MODE = process.argv.includes('--allowlist') ? 'allowlist' : 'product-catalog';
const { Miniflare } = LIVE ? { Miniflare: null } : await import(process.env.MINIFLARE || 'miniflare');
const HOST = 'https://www.usesul.com.br';
const sample = JSON.parse(readFileSync(new URL('./catalog-sample.json', import.meta.url), 'utf8')).products.map((p) => ({ ...p, short: p.slug.slice(0, 22) }));
const FIVE = ['serra-catarinense', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a'];
const path = (p) => '/usesul/product/' + p.slug;
const EVIDENCE = new URL('../docs/evidence/expansao-global/', import.meta.url).pathname; mkdirSync(EVIDENCE, { recursive: true });
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'navbar-gateway.js', 'stores.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/header-nav.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery';
let CUR = null; const failures = [];
const results = []; const check = (n, ok, d = '', kind = 'QA') => { results.push(!!ok); if (CUR) CUR.lastCheck = n; if (!ok) failures.push({ n, kind, d: String(d).slice(0, 400) }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '') + (ok ? '' : `  [classe: ${kind}]`)); };
const upstream = { html: '', status: 200 };
const mf = LIVE ? null : new Miniflare({
  modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'],
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: FIVE.map((s) => '/usesul/product/' + s).join(','), WIDGET_FEATURES: FEATURES, ...(MODE === 'product-catalog' ? { WIDGET_SCOPE_MODE: 'product-catalog' } : {}) },
  outboundService: async (req) => (new URL(req.url).host === 'useorigens.com.br' ? new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } }) : new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } }))
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const wait = (page, ms) => page.waitForTimeout(ms);

async function newSession(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick/, (r) => r.abort());
  const page = await ctx.newPage(); const s = { ctx, page, attempts: 0, created: 0, refs: [], evlog: [], cookieSent: false, nav: [], gotos: [], storefront: null, lastCheck: '' };
  // Registro de navegação (últimos eventos ficam na evidência): principal frame, falhas de requisição, erros de página, consoles de erro, respostas de documento.
  const note = (e, extra = {}) => { s.nav.push({ t: new Date().toISOString().slice(11, 23), e, ...extra }); if (s.nav.length > 200) s.nav.shift(); };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) note('framenavigated', { url: f.url() }); });
  page.on('requestfailed', (r) => note('requestfailed', { url: r.url().slice(0, 120), err: r.failure() && r.failure().errorText, doc: r.resourceType() === 'document' }));
  page.on('pageerror', (e) => note('pageerror', { msg: String(e).slice(0, 160) }));
  page.on('console', (m) => { if (m.type() === 'error') note('console.error', { msg: m.text().slice(0, 160) }); });
  page.on('response', (r) => { if (r.request().resourceType() === 'document' && r.frame() === page.mainFrame()) { note('doc', { url: r.url(), status: r.status() }); if (/useorigens\.com\.br$/.test(new URL(r.url()).hostname)) s.storefront = { url: r.url(), status: r.status() }; } });
  s.note = note; CUR = s;
  page.on('request', (r) => { if (r.resourceType() === 'document' && /useorigens\.com\.br$/.test(new URL(r.url()).hostname)) { s.sfRequestUrl = r.url(); note('storefront-request', { url: r.url().replace(/cart_ref=[^&]+/, 'cart_ref=<ref>') }); } });
  await page.exposeFunction('__qaEvent', (name, params) => s.evlog.push([name, params]));
  await page.addInitScript(() => { const dl = window.dataLayer = window.dataLayer || []; const push = dl.push.bind(dl); dl.push = function () { for (const a of arguments) { if (a && a[0] === 'event' && String(a[1]).startsWith('origens_')) window.__qaEvent(a[1], JSON.parse(JSON.stringify(a[2]))); } return push.apply(null, arguments); }; });
  ctx.on('request', async (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/__origens/cart-ref') { s.attempts++; s.postT0 = Date.now(); s.lastPost = { status: 'pendente', ms: null }; const h = await req.allHeaders(); if (h.cookie) s.cookieSent = true; } });
  ctx.on('response', async (res) => { if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/__origens/cart-ref') s.lastPost = { status: res.status(), ms: Date.now() - (s.postT0 || Date.now()) }; if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/__origens/cart-ref' && res.status() === 201) { s.created++; try { s.refs.push((await res.json()).ref); } catch (_) { /* ignora */ } } });
  if (!LIVE) {
    await page.route('**/__origens/**', async (route) => {
      const req = route.request(); const url = new URL(req.url()); const h = req.headers();
      const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': h['content-type'] || '', origin: h['origin'] || '', referer: h['referer'] || '', 'sec-fetch-site': h['sec-fetch-site'] || '' }, body: req.method() === 'POST' ? req.postData() : undefined });
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    // O HTML de produto passa pelo Worker de verdade (mesma reescrita do HTMLRewriter de produção): a origem é o HTML real buscado pelo navegador.
    await page.route((u) => u.host === 'www.usesul.com.br' && /^\/usesul\/product\/[^/]+$/.test(u.pathname), async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch(); upstream.html = await res.text(); upstream.status = res.status();
      const out = await mf.dispatchFetch(route.request().url()); await route.fulfill({ response: res, body: await out.text() });
    });
    // Storefront local: uma página estática (a navegação nossa termina aqui; o storefront real é testado no --live).
    if (!REAL_SF) await page.route('https://useorigens.com.br/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>storefront (stub local)</h1></body></html>' }));
  }
  return s;
}
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible()) { await n.first().click(); await wait(page, 400); } };
const readRef = async (ref) => { const r = LIVE ? await fetch(HOST + '/__origens/cart-ref/' + ref) : await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref); return { status: r.status, body: r.status === 200 ? await r.json() : null }; };
const checkoutVisible = (page) => page.evaluate(() => { const els = [...document.querySelectorAll('.cart-drawer a, .cart-drawer button')].filter((e) => /finalizar compra/i.test(e.textContent || '')); if (!els.length) return { found: false }; const r = els[0].getBoundingClientRect(); return { found: true, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1 }; });

// ── navegação estável e classificação de falhas ─────────────────────────────────────────────────────────────────────────────────────────────
// O sinal de "produto carregado" NÃO é o evento `load` (a INK tem recursos de terceiros que às vezes o seguram por dezenas de segundos):
// é a resposta 2xx do documento + `domcontentloaded` + o formulário nativo de compra + a URL canônica. Um erro de rede do navegador
// (chrome-error://, ERR_*) ou timeout do documento recebe UMA nova tentativa, sempre registrada e verificada por HTTP fora do navegador; falha
// persistente reprova (o gate não é relaxado).
class QaFailure extends Error { constructor(kind, message, detail = {}) { super(message); this.kind = kind; this.detail = detail; } }
const NETWORKISH = /chrome-error|ERR_[A-Z_]+|Timeout|net::|interrupted by another navigation/i;
async function probeHttp(url, expectLoader) {
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'use-origens-qa-probe/1' } }); const body = await r.text();
    const loaders = (body.match(/\/__origens\/loader\.js\?v=/g) || []).length; const complete = /<\/html>\s*$/i.test(body); const form = /id="form-product-/.test(body);
    const healthy = r.status === 200 && form && complete && (expectLoader === undefined || loaders === expectLoader);
    return { status: r.status, bytes: body.length, form, complete, loaders, healthy, cfRay: r.headers.get('cf-ray') };
  } catch (e) { return { error: String(e.message).slice(0, 120), healthy: false }; }
}
async function gotoProduct(s, p, { attempts = 2 } = {}) {
  const url = HOST + path(p); const record = { to: url, from: s.page.url(), attempts: [] };
  for (let n = 1; n <= attempts; n++) {
    const t0 = Date.now(); const mark = s.nav.length; let err = null;
    try { await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 25000 }); } catch (e) { err = String(e.message).split('\n')[0]; }
    const finalUrl = s.page.url(); const ok = !err && new URL(finalUrl).pathname === path(p);
    record.attempts.push({ n, ms: Date.now() - t0, err, finalUrl, events: s.nav.slice(mark).slice(-12) });
    if (ok) { s.gotos.push(record); s.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {}); return; }
    if (n < attempts && NETWORKISH.test(err || 'sem-formulario')) { s.note('goto-retry', { slug: p.slug, err }); await wait(s.page, 2000); continue; }
    break;
  }
  s.gotos.push(record);
  const probe = await probeHttp(url, LIVE && MODE === 'product-catalog' ? 1 : undefined);
  // Classificação: HTTP fora do navegador saudável => problema de navegador/rede (QA); HTML incompleto/sem formulário/sem loader => Worker/INK.
  const kind = probe.healthy ? 'QA' : (probe.status && probe.status !== 200) || probe.error ? 'INK' : (LIVE && MODE === 'product-catalog' && probe.loaders !== 1) ? 'Worker' : 'INK';
  throw new QaFailure(kind, `navegação para ${p.slug} falhou após ${record.attempts.length} tentativa(s): ${record.attempts.at(-1).err || 'formulário nativo ausente / URL final ' + record.attempts.at(-1).finalUrl}`, { record, probe });
}
async function captureEvidence(s, reason, kind, detail = {}) {
  if (!EVIDENCE_DIR || !s) return;
  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await s.page.screenshot({ path: EVIDENCE_DIR + '/screenshot.png', timeout: 8000 }).catch(() => {});
    const cart = await s.page.evaluate(() => { const f = document.querySelector('turbo-frame#cart'); const footer = document.querySelector('.cart-drawer turbo-frame#cart .footer-details'); return { url: location.href, header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), items: [...document.querySelectorAll('.cart-drawer li.main-list__item')].map((li) => ({ name: (li.querySelector('.item-details p') || {}).textContent, qty: (li.querySelector('input[name="cart_item[quantity]"]') || {}).value })), subtotal: footer && footer.getAttribute('data-ink-store--cart-subtotal-value'), discount: footer && footer.getAttribute('data-ink-store--cart-discount-value'), footerText: footer && footer.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), hasFrame: !!f }; }).catch((e) => ({ error: String(e.message).slice(0, 100) }));
    let storefront = s.storefront; if (storefront) { try { const r = await fetch(storefront.url.split('?')[0], { redirect: 'manual' }); storefront = { ...storefront, reprobe_status: r.status }; } catch (e) { storefront = { ...storefront, reprobe_error: String(e.message).slice(0, 80) }; } }
    writeFileSync(EVIDENCE_DIR + '/qa-failure.json', JSON.stringify({ at: new Date().toISOString(), mode: LIVE ? 'live' : 'local', scope: MODE, reason, classified_as: kind, last_check: s.lastCheck, url: s.page.url(), created_writes: s.created, post_attempts: s.attempts, storefront_response: storefront, cart_summary: cart, detail, recent_gotos: s.gotos.slice(-4), navigation_events: s.nav.slice(-60), our_events: s.evlog.slice(-20) }, null, 1));
  } catch (_) { /* a evidência nunca impede o rollback */ }
}

async function addToCart(s, p) {
  const page = s.page; await gotoProduct(s, p); await wait(page, 3000); await acceptNotice(page);
  await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
  const pid = await page.waitForFunction(() => { const m = document.querySelector('input[type=radio][id*="-model-"]'); return m ? m.id.split('-')[0] : null; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  for (const [g, prefer] of [['model', 'Masculino'], ['color', 'Preta'], ['size', 'M']]) {
    const id = await page.evaluate(({ pid, g, prefer }) => { const all = [...document.querySelectorAll('input[type=radio][id^="' + pid + '-' + g + '-"]')].filter((e) => !e.disabled); const pick = all.find((e) => e.id.endsWith('-' + prefer)) || all[0]; return pick && pick.id; }, { pid, g, prefer });
    await page.locator('label[for="' + id + '"]').click();
  }
  await page.waitForFunction((pid) => document.getElementById('product-variant-id-' + pid)?.value > 0, pid);
  await page.evaluate(() => document.querySelector('#add-to-cart-desk').click());
  await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(page, 2200);
  return pid;
}
const openCartIcon = async (page) => { await page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); }); await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(page, 500); };
const closeDrawer = (page) => page.evaluate(() => { const d = document.querySelector('.cart-drawer'); const x = d && d.querySelector('[data-action*="closeDrawer"], .cart-drawer__close, button[aria-label*="echar"]'); x ? x.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) : d && d.classList.remove('open'); });
// ── A) amostra do catálogo: 1 loader, 6 features, 1 bloco, CTA/sticky livres (1280 todos; 390 e 320×640 numa subamostra mista) ──
const SUB = [...sample.filter((p) => p.family !== 'merch').slice(0, 3), ...sample.filter((p) => p.family === 'merch').slice(0, 3)];
async function sampleSection() {
  for (const [w, h, list] of [[1280, 900, sample], [390, 844, SUB], [320, 640, SUB]]) {
    const s = await newSession({ width: w, height: h });
    for (const [i, p] of list.entries()) {
      await gotoProduct(s, p); await wait(s.page, 2600);
      if (i === 0) await acceptNotice(s.page);
      const info = await s.page.evaluate(() => {
        const block = document.querySelector('[data-origens-discovery="product"]');
        const covered = (sel) => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); const t = document.elementFromPoint(Math.min(innerWidth - 2, r.left + r.width / 2), Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2))); return !!t && !!t.closest('[data-origens-discovery]'); };
        let overflowWithout = null; const overflow = document.documentElement.scrollWidth > innerWidth + 1; if (block) { block.style.display = 'none'; overflowWithout = document.documentElement.scrollWidth > innerWidth + 1; block.style.display = ''; }
        return { loader: window.__useOrigensLoader, features: window.__useOrigens && window.__useOrigens.features, scripts: document.querySelectorAll('script[src*="/__origens/loader.js"]').length, blocks: document.querySelectorAll('[data-origens-discovery="product"]').length, oldLink: !!document.getElementById('use-origens-return-link'), title: block && block.querySelector('.o-title').textContent, cta: block && block.querySelector('.o-cta').textContent,
          nativeCta: !!document.querySelector('#add-to-cart-desk, #add-to-cart-mob'), overflow, overflowWithout, deskCovered: covered('#add-to-cart-desk'), mobCovered: covered('#add-to-cart-mob') };
      });
      const ok = info.loader === LOADER_VERSION && info.scripts === 1 && info.features && info.features.length === 6 && info.blocks === 1 && !info.oldLink && info.title === 'Continue explorando' && info.cta === 'Explorar todas as estampas' && info.nativeCta && (!info.overflow || info.overflowWithout) && info.deskCovered !== true && info.mobCovered !== true;
      check(`[${w}] ${p.kind}/${p.short}: 1 loader ${LOADER_VERSION}, 6 features, 1 bloco, CTA/sticky livres`, ok, ok ? '' : JSON.stringify(info), 'Worker');
      if (w === 1280 && i % 5 === 0) await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + `produto-${p.kind.replace(/[^a-z]/gi, '')}-${w}.png` });
    }
    await s.ctx.close();
  }
}

// ── helpers da jornada ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Lê a URL do token/etc. do POST e da requisição de navegação; sinais SEPARADOS: clique -> href final -> POST (só quando necessário) -> commit no
// storefront -> resposta 200 -> URL limpa. `arrived` = navegação concluída (commit + 200), independente de analytics (GA4 é conferido à parte).
async function exitViaDrawer(s, p) {
  await gotoProduct(s, p); await wait(s.page, 2200); await openCartIcon(s.page);
  const before = { attempts: s.attempts, created: s.created }; s.storefront = null; s.sfRequestUrl = null; s.lastPost = null; const mark = s.nav.length; const t0 = Date.now();
  const link = s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-cta');
  const hrefAtClick = await link.getAttribute('href');
  await link.click({ noWaitAfter: true }); s.note('click', { target: 'drawer-cta', hrefAtClick: (hrefAtClick || '').replace(/cart_ref=[^&]+/, 'cart_ref=<ref>') });
  let committed = false; try { await s.page.waitForURL((u) => /(^|\.)useorigens\.com\.br$/.test(u.hostname), { timeout: 25000, waitUntil: 'commit' }); committed = true; } catch (_) { /* fica committed=false */ }
  const elapsed = Date.now() - t0;
  await s.page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}); await wait(s.page, 1500);
  const sfUrl = s.sfRequestUrl ? new URL(s.sfRequestUrl) : null; const finalUrl = new URL(s.page.url());
  const cleaned = !/cart_ref|origens_src|origens_p/.test(finalUrl.search);
  return { clicked: true, committed, arrived: committed && !!s.storefront && s.storefront.status === 200, storefrontStatus: s.storefront && s.storefront.status, elapsed, ref: sfUrl && sfUrl.searchParams.get('cart_ref'), src: sfUrl && sfUrl.searchParams.get('origens_src'), sfPath: sfUrl && sfUrl.pathname, cleaned, attempts: s.attempts - before.attempts, created: s.created - before.created, post: s.lastPost, events: s.nav.slice(mark).filter((x) => !/googletag|facebook|tiktok|newrelic|Failed to load resource/.test(JSON.stringify(x))).slice(0, 14) };
}
// Uma saída que NÃO chegou: se o storefront não responde fora do navegador, é Storefront/rede; se responde, o clique/POST/navegação é do Worker.
const exitKind = async (e) => (e.arrived ? 'Worker' : (await probeStorefront()).ok ? 'Worker' : 'Storefront');
const describeExit = (e) => `clique ok, commit ${e.committed}, storefront ${e.storefrontStatus}, ${e.elapsed}ms, POST ${e.attempts}/writes ${e.created}${e.post ? ' (status ' + e.post.status + ' em ' + e.post.ms + 'ms)' : ''}, token ${e.ref ? 'sim' : 'não'}, src ${e.src}, url limpa ${e.cleaned}`;
// O KV é eventualmente consistente entre regiões: uma chave recém-criada pode dar 404 por até ~60 s+. Lê com espera limitada e REGISTRA as tentativas.
async function readRefPatient(ref, { maxMs = LIVE ? 90000 : 3000 } = {}) {
  const t0 = Date.now(); let attempts = 0; let last = { status: 0 };
  while (true) { attempts++; last = await readRef(ref); if (last.status === 200 || Date.now() - t0 > maxMs) break; await new Promise((r) => setTimeout(r, LIVE ? 4000 : 500)); }
  return { ...last, attempts, waitedMs: Date.now() - t0 };
}
// Totais exibidos pela INK (atributos do rodapé + texto "Total" e a linha de desconto), lidos do DOM — nunca calculados aqui.
const readTotals = (page) => page.evaluate(() => { const f = document.querySelector('.cart-drawer turbo-frame#cart .footer-details') || document.querySelector('turbo-frame#cart .footer-details'); if (!f) return null; const num = (a) => { const v = parseFloat(f.getAttribute(a)); return Number.isFinite(v) ? v : null; }; const label = [...f.querySelectorAll('p')].find((el) => el.textContent.trim() === 'Total'); const box = label && label.nextElementSibling; const tp = box && box.querySelector('p'); const pieces = [...document.querySelectorAll('turbo-frame#cart li.main-list__item input[name="cart_item[quantity]"]')].reduce((n, i) => n + (parseInt(i.value, 10) || 0), 0); return { subtotal: num('data-ink-store--cart-subtotal-value'), discount: num('data-ink-store--cart-discount-value'), totalText: tp ? tp.textContent.replace(/\s+/g, ' ').trim() : '', pieces, promoBanner: /LEVANDO|PE[ÇC]AS/i.test((document.querySelector('.cart-drawer') || {}).textContent || '') }; });
// Página de CONTROLE (mesma sessão, com o nosso loader bloqueado): o que a INK mostra ANTES de qualquer widget nosso.
async function controlTotals(s, p) {
  const page = await s.ctx.newPage();
  await page.route('**/__origens/**', (r) => r.abort());
  try { await page.goto(HOST + path(p), { waitUntil: 'domcontentloaded', timeout: 40000 }); await page.waitForSelector('turbo-frame#cart .footer-details', { timeout: 25000, state: 'attached' }); const widgetFree = await page.evaluate(() => !window.__useOrigensLoader && !document.querySelector('[data-origens-discovery]')); const t = await readTotals(page); return { ...t, widgetFree }; }
  finally { await page.close().catch(() => {}); }
}

// ── B) jornada + custo do KV ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Alcançabilidade do storefront (pré-condição da ida e volta): TLS/rede fora do navegador. Falha aqui = classe Storefront, não Worker.
async function probeStorefront() {
  try { const r = await fetch('https://useorigens.com.br/api/ready', { redirect: 'manual', signal: AbortSignal.timeout(12000) }); return { ok: r.status === 200, status: r.status }; }
  catch (e) { return { ok: false, error: String(e.cause && (e.cause.code || e.cause.message) || e.message).slice(0, 100) }; }
}
async function journey() {
  if (LIVE || REAL_SF) { const sf = await probeStorefront(); if (!sf.ok) throw new QaFailure('Storefront', 'storefront inacessível antes da jornada (' + (sf.error || 'HTTP ' + sf.status) + '): a ida e volta INK → storefront → INK não pode ser validada', { probe: sf }); }
  const cityP = sample.find((p) => p.family !== 'merch'); const geoFree = sample.find((p) => p.family === 'merch' && /dizeres|retrato|gaucho|bah|tche/.test(p.slug)) || sample.find((p) => p.family === 'merch');
  const s = await newSession({ width: 1280, height: 900 });
  await addToCart(s, cityP); await addToCart(s, geoFree);
  check('adicionar dois produtos de coleções diferentes (cidade + não geográfico): 0 writes', s.attempts === 0, `tentativas ${s.attempts}`, 'Worker');
  for (let i = 0; i < 3; i++) await gotoProduct(s, i % 2 ? geoFree : cityP);
  for (let i = 0; i < 4; i++) { await openCartIcon(s.page); await closeDrawer(s.page); await wait(s.page, 250); }
  check('3 recargas de produto com carrinho + 4 aberturas do drawer: 0 writes', s.attempts === 0, `tentativas ${s.attempts}`, 'Worker');
  await openCartIcon(s.page);
  const two = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), names: [...document.querySelectorAll('turbo-frame#cart li.main-list__item .item-details p:first-child')].map((e) => e.textContent.trim()) }));
  check('drawer com 2 produtos diferentes + bloco de descoberta; "Finalizar compra" visível', two.header === '2' && new Set(two.names).size === 2 && (await checkoutVisible(s.page)).visible, JSON.stringify(two), 'Worker');
  await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + 'drawer-dois-produtos-1280.png' });
  const e1 = await exitViaDrawer(s, geoFree);
  check('1ª saída ("Explorar todas as estampas"): navegação concluída ao storefront (commit + 200), token, 1 write, espera curta', e1.arrived && /^[A-Za-z0-9_-]{22}$/.test(e1.ref || '') && e1.created === 1 && e1.elapsed < 8000 && e1.src === 'ink_cart_drawer', describeExit(e1), await exitKind(e1));
  if (LIVE || REAL_SF) info('storefront: parâmetros de origem/token removidos do endereço após a chegada', e1.cleaned);
  const snap = e1.ref ? await readRefPatient(e1.ref) : { status: 0, attempts: 0 };
  check('snapshot transferido (lido da INK): os 2 produtos com variantes' + (snap.attempts > 1 ? ` [KV consistente após ${snap.attempts} leituras/${snap.waitedMs}ms]` : ''), snap.status === 200 && snap.body.items.length === 2 && new Set(snap.body.items.map((i) => i.productId)).size === 2 && snap.body.items.every((i) => i.variant && i.color && i.size), JSON.stringify(snap.body ? snap.body.items.map((i) => [i.name, i.color, i.size, i.quantity]) : { status: snap.status, leituras: snap.attempts, esperou_ms: snap.waitedMs }), 'Worker');
  if (LIVE) { // storefront real: Meu carrinho -> Ir para meu carrinho -> drawer nativo
    const ok = await s.page.waitForSelector('[data-testid="cart-mirror-trigger"]', { timeout: 15000 }).then(() => true).catch(() => false);
    if (ok) { await s.page.locator('[data-testid="cart-mirror-trigger"]').click(); await wait(s.page, 1500); const items = await s.page.locator('[data-testid="cart-mirror-item"]').count(); check('storefront REAL: "Meu carrinho" mostra os 2 produtos; token saiu do endereço', items === 2 && !/cart_ref|origens_src|origens_p/.test(s.page.url()), `${items} itens, ${s.page.url()}`, 'Storefront'); await s.page.screenshot({ path: EVIDENCE + 'live-storefront-meu-carrinho-1280.png' }); await s.page.locator('[data-testid="cart-mirror-go"]').click(); await s.page.waitForURL(/usesul\.com\.br\/usesul\/product\//, { timeout: 30000, waitUntil: 'commit' }); await s.page.waitForSelector('.cart-drawer.open', { timeout: 30000 }); await wait(s.page, 1500); const back = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), search: location.search })); check('"Ir para meu carrinho" → drawer nativo aberto com os 2 itens; parâmetro consumido', back.header === '2' && back.search === '', JSON.stringify(back), 'Worker'); }
    else check('storefront REAL: "Meu carrinho" apareceu', false, s.page.url(), 'Storefront');
  }
  const e2 = await exitViaDrawer(s, cityP);
  check('2ª saída com o MESMO carrinho (página nova): reutiliza o token, 0 writes novos', e2.arrived && e2.created === 0 && e2.attempts === 0 && e2.ref === e1.ref, describeExit(e2) + `, mesmo token ${e2.ref === e1.ref}`, await exitKind(e2));
  const e3 = await exitViaDrawer(s, cityP);
  check('3ª saída igual: continua 0 writes novos (total 1)', e3.arrived && e3.created === 0 && s.created === 1, `total ${s.created}; ${describeExit(e3)}`, 'Worker');
  await gotoProduct(s, cityP); await wait(s.page, 2500); await openCartIcon(s.page);
  await s.page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]')?.click()); await s.page.waitForFunction(() => document.getElementById('quantity-header')?.getAttribute('data-quantityheader') === '3', null, { timeout: 15000 }); await wait(s.page, 1800);
  check('alterar a quantidade (3 peças, promoção da INK) NÃO grava por si só', s.attempts === 1, `tentativas ${s.attempts}`, 'Worker');
  // 3 peças: o que a INK mostra SEM nosso widget (controle) x COM o widget montado x o snapshot transferido
  const withWidget = await readTotals(s.page); const control = await controlTotals(s, cityP);
  check('3 peças: promoção nativa ativa e página de controle SEM widget (INK pura)', !!control && control.widgetFree && control.pieces === 3 && control.discount > 0 && control.promoBanner && !!control.totalText, JSON.stringify(control), 'INK');
  check('3 peças: subtotal, desconto e total IGUAIS antes/depois de montar o widget (INK pura x com widget)', !!withWidget && !!control && withWidget.subtotal === control.subtotal && withWidget.discount === control.discount && withWidget.totalText === control.totalText, JSON.stringify({ controle: control && { s: control.subtotal, d: control.discount, t: control.totalText }, comWidget: withWidget && { s: withWidget.subtotal, d: withWidget.discount, t: withWidget.totalText } }), 'Worker');
  const e4 = await exitViaDrawer(s, cityP);
  check('saída com o carrinho ALTERADO: exatamente 1 write novo, token novo', e4.arrived && e4.created === 1 && !!e4.ref && e4.ref !== e1.ref, describeExit(e4), await exitKind(e4));
  const snap3 = e4.ref ? await readRefPatient(e4.ref) : { status: 0, attempts: 0 };
  const b3 = snap3.body;
  check('3 peças: total, subtotal e desconto do snapshot vêm da INK (== DOM da INK; nenhum valor calculado pelo widget)' + (snap3.attempts > 1 ? ` [KV consistente após ${snap3.attempts} leituras/${snap3.waitedMs}ms]` : ''), snap3.status === 200 && b3.items.reduce((n, i) => n + i.quantity, 0) === 3 && b3.totalText === control.totalText && b3.subtotal === control.subtotal && b3.discount === control.discount, JSON.stringify(b3 ? { snap: { s: b3.subtotal, d: b3.discount, t: b3.totalText }, ink: { s: control.subtotal, d: control.discount, t: control.totalText } } : { status: snap3.status, token: !!e4.ref, leituras: snap3.attempts, esperou_ms: snap3.waitedMs }), b3 ? 'Worker' : 'Worker');
  // falha do armazenamento: o POST devolve 503; a saída navega SEM token e a compra segue intacta
  await gotoProduct(s, cityP); await wait(s.page, 2500); await openCartIcon(s.page);
  await s.page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]')?.click()); await wait(s.page, 2200);
  await s.page.route('**/__origens/cart-ref', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }) : route.fallback()));
  const e5 = await exitViaDrawer(s, cityP);
  check('KV indisponível (503): a saída navega ao storefront SEM token, sem travar (< 8 s)', e5.arrived && !e5.ref && e5.elapsed < 8000, describeExit(e5), 'Worker');
  await s.page.unroute('**/__origens/cart-ref');
  await gotoProduct(s, cityP); await wait(s.page, 2500); await openCartIcon(s.page);
  const after = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader') }));
  check('depois da falha do KV: carrinho nativo intacto e "Finalizar compra" visível', Number(after.header) >= 3 && (await checkoutVisible(s.page)).visible, JSON.stringify(after), 'Worker');
  for (const [w, h] of [[1280, 900], [390, 844], [320, 640]]) {
    await s.page.setViewportSize({ width: w, height: h }); await wait(s.page, 900);
    const toggle = s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-toggle'); if (await toggle.count() && await toggle.isVisible()) { await toggle.click().catch(() => {}); await wait(s.page, 600); }
    const co = await checkoutVisible(s.page); check(`[${w}×${h}] 3+ peças, busca aberta: "Finalizar compra" visível`, co.found && co.visible, JSON.stringify(co), 'Worker');
    await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + `drawer-3pecas-busca-${w}x${h}.png` });
  }
  check('nenhum POST do espelho levou Cookie da INK', !s.cookieSent, '', 'Worker');
  // analytics: conferido À PARTE do critério funcional (a chegada já foi validada por commit+200); aqui só os eventos da INK no dataLayer
  const explore = s.evlog.filter((e) => e[0] === 'origens_explore_storefront_click');
  info(`eventos: ${explore.length} origens_explore_storefront_click nas 5 saídas; parâmetros fechados e sem token/URL`, explore.length === 5 && s.evlog.every((e) => Object.keys(e[1]).every((k) => ['send_to', 'entry_point', 'region', 'transport_type', 'product_slug'].includes(k))) && !/cart_ref|http/i.test(JSON.stringify(s.evlog)));
  if (!LIVE) { const h = await (await mf.dispatchFetch(HOST + '/__origens/health')).json(); check('health local: scope_mode e contadores de KV coerentes (writes = 2 criados)', h.scope_mode === MODE && h.cart_ref_stats.writes === s.created && s.created === 2, JSON.stringify({ scope: h.scope_mode, stats: h.cart_ref_stats }), 'Worker'); }
  console.log('KV_JORNADA ' + JSON.stringify({ tentativas: s.attempts, writes_criados: s.created }));
  return s;
}
// Informativo (analytics/limpeza de URL): registrado e NÃO reprova a jornada funcional.
function info(name, ok) { console.log((ok ? 'INFO ok   ' : 'INFO !!   ') + name); }

// ── execução: qualquer falha é classificada e deixa evidência ANTES de o release decidir o rollback ──────────────────────────────────────────
let exitCode = 0;
try {
  if (ONLY !== 'journey') await sampleSection();
  await journey();
} catch (e) {
  exitCode = 1; const kind = e instanceof QaFailure ? e.kind : 'QA'; const detail = e instanceof QaFailure ? e.detail : { stack: String(e.stack || e).split('\n').slice(0, 6) };
  console.log(`FAIL exceção no QA: ${e.message}  [classe: ${kind}]`); if (e instanceof QaFailure) console.log('   sonda HTTP fora do navegador: ' + JSON.stringify(e.detail.probe));
  failures.push({ n: 'exceção: ' + e.message, kind, d: JSON.stringify(detail).slice(0, 600) });
  await captureEvidence(CUR, e.message, kind, detail);
}
const failed = results.filter((r) => !r).length;
if (failed && !exitCode) { exitCode = 1; await captureEvidence(CUR, failures.map((f) => f.n).join(' | '), [...new Set(failures.map((f) => f.kind))].join('+'), { failures }); }
console.log(`\n${results.length - failed}/${results.length} PASS`);
if (exitCode) console.log('QA_FALHA_CLASSIFICADA ' + JSON.stringify({ classes: [...new Set(failures.map((f) => f.kind))], primeira: failures[0] && failures[0].n }));
await browser.close().catch(() => {}); if (mf) await mf.dispose();
process.exit(exitCode);
