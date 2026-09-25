#!/usr/bin/env node
// QA da expansão GLOBAL (escopo product-catalog) contra as páginas REAIS da INK, em navegador visível, sessão anônima descartável.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-global.mjs            -> local: Worker+KV em Miniflare (nada publicado)
//   PW_PATH=... node scripts/qa-global.mjs --live                               -> produção (só para o release; sem finalizar pedido)
//   node scripts/qa-global.mjs --allowlist                                      -> local no modo padrão (cinco produtos)
// Bloqueia as tags de analytics da INK (nenhum evento real). Os eventos NOSSOS são capturados no dataLayer. Não abre checkout.
// Mede o custo do KV pelo navegador: cada POST /__origens/cart-ref aceito (201) = 1 KV.put.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const LIVE = process.argv.includes('--live'); const MODE = process.argv.includes('--allowlist') ? 'allowlist' : 'product-catalog';
const { Miniflare } = LIVE ? { Miniflare: null } : await import(process.env.MINIFLARE || 'miniflare');
const HOST = 'https://www.usesul.com.br';
const sample = JSON.parse(readFileSync(new URL('./catalog-sample.json', import.meta.url), 'utf8')).products.map((p) => ({ ...p, short: p.slug.slice(0, 22) }));
const FIVE = ['serra-catarinense', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a'];
const path = (p) => '/usesul/product/' + p.slug;
const EVIDENCE = new URL('../docs/evidence/expansao-global/', import.meta.url).pathname; mkdirSync(EVIDENCE, { recursive: true });
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery';
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
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
  const page = await ctx.newPage(); const s = { ctx, page, attempts: 0, created: 0, refs: [], evlog: [], cookieSent: false };
  await page.exposeFunction('__qaEvent', (name, params) => s.evlog.push([name, params]));
  await page.addInitScript(() => { const dl = window.dataLayer = window.dataLayer || []; const push = dl.push.bind(dl); dl.push = function () { for (const a of arguments) { if (a && a[0] === 'event' && String(a[1]).startsWith('origens_')) window.__qaEvent(a[1], JSON.parse(JSON.stringify(a[2]))); } return push.apply(null, arguments); }; });
  ctx.on('request', async (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/__origens/cart-ref') { s.attempts++; const h = await req.allHeaders(); if (h.cookie) s.cookieSent = true; } });
  ctx.on('response', async (res) => { if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/__origens/cart-ref' && res.status() === 201) { s.created++; try { s.refs.push((await res.json()).ref); } catch (_) { /* ignora */ } } });
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
    await page.route('https://useorigens.com.br/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>storefront (stub local)</h1></body></html>' }));
  }
  return s;
}
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible()) { await n.first().click(); await wait(page, 400); } };
const readRef = async (ref) => { const r = LIVE ? await fetch(HOST + '/__origens/cart-ref/' + ref) : await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref); return { status: r.status, body: r.status === 200 ? await r.json() : null }; };
const checkoutVisible = (page) => page.evaluate(() => { const els = [...document.querySelectorAll('.cart-drawer a, .cart-drawer button')].filter((e) => /finalizar compra/i.test(e.textContent || '')); if (!els.length) return { found: false }; const r = els[0].getBoundingClientRect(); return { found: true, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1 }; });

async function addToCart(s, p) {
  const page = s.page; await page.goto(HOST + path(p), { waitUntil: 'load' }); await wait(page, 3500); await acceptNotice(page);
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
// Sai pelo link "Explorar todas as estampas" do drawer: mede a espera, o destino e quantos writes essa saída causou.
async function exitViaDrawer(s, path0) {
  await s.page.goto(HOST + path0, { waitUntil: 'load' }); await wait(s.page, 3200); await openCartIcon(s.page);
  const before = { attempts: s.attempts, created: s.created }; const t0 = Date.now();
  await Promise.all([s.page.waitForURL(/useorigens\.com\.br\/sul/, { timeout: 20000 }).catch(() => null), s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-cta').click({ noWaitAfter: true })]);
  const elapsed = Date.now() - t0; await wait(s.page, 600);
  const url = new URL(s.page.url());
  return { arrived: /useorigens\.com\.br$/.test(url.hostname), url, elapsed, attempts: s.attempts - before.attempts, created: s.created - before.created, ref: url.searchParams.get('cart_ref') };
}

// ── A) amostra do catálogo: 1 loader, 6 features, 1 bloco, CTA/sticky livres (1280 todos; 390 e 320×640 numa subamostra mista) ──
const SUB = [...sample.filter((p) => p.family !== 'merch').slice(0, 3), ...sample.filter((p) => p.family === 'merch').slice(0, 3)];
for (const [w, h, list] of [[1280, 900, sample], [390, 844, SUB], [320, 640, SUB]]) {
  const s = await newSession({ width: w, height: h });
  for (const [i, p] of list.entries()) {
    await s.page.goto(HOST + path(p), { waitUntil: 'load' }); await wait(s.page, 3600);
    if (i === 0) await acceptNotice(s.page);
    const info = await s.page.evaluate(() => {
      const block = document.querySelector('[data-origens-discovery="product"]');
      const covered = (sel) => { const el = document.querySelector(sel); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); const t = document.elementFromPoint(Math.min(innerWidth - 2, r.left + r.width / 2), Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2))); return !!t && !!t.closest('[data-origens-discovery]'); };
      let overflowWithout = null; const overflow = document.documentElement.scrollWidth > innerWidth + 1; if (block) { block.style.display = 'none'; overflowWithout = document.documentElement.scrollWidth > innerWidth + 1; block.style.display = ''; }
      return { loader: window.__useOrigensLoader, features: window.__useOrigens && window.__useOrigens.features, scripts: document.querySelectorAll('script[src*="/__origens/loader.js"]').length, blocks: document.querySelectorAll('[data-origens-discovery="product"]').length, oldLink: !!document.getElementById('use-origens-return-link'), title: block && block.querySelector('.o-title').textContent, cta: block && block.querySelector('.o-cta').textContent,
        nativeCta: !!document.querySelector('#add-to-cart-desk, #add-to-cart-mob'), overflow, overflowWithout, deskCovered: covered('#add-to-cart-desk'), mobCovered: covered('#add-to-cart-mob') };
    });
    const ok = info.loader === '4.3' && info.scripts === 1 && info.features && info.features.length === 6 && info.blocks === 1 && !info.oldLink && info.title === 'Continue explorando' && info.cta === 'Explorar todas as estampas' && info.nativeCta && (!info.overflow || info.overflowWithout) && info.deskCovered !== true && info.mobCovered !== true;
    check(`[${w}] ${p.kind}/${p.short}: 1 loader 4.3, 6 features, 1 bloco, CTA/sticky livres`, ok, ok ? '' : JSON.stringify(info));
    if (w === 1280 && i % 5 === 0) await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + `produto-${p.kind.replace(/[^a-z]/gi, '')}-${w}.png` });
  }
  await s.ctx.close();
}

// ── B) jornada + custo do KV: dois produtos (cidade + não geográfico), pageviews/abertas sem write, saídas sob demanda, falha do KV ──
const cityP = sample.find((p) => p.family !== 'merch'); const geoFree = sample.find((p) => p.family === 'merch' && /dizeres|retrato|gaucho|bah|tche/.test(p.slug)) || sample.find((p) => p.family === 'merch');
const s = await newSession({ width: 1280, height: 900 });
await addToCart(s, cityP); await addToCart(s, geoFree);
check('adicionar dois produtos de coleções diferentes (cidade + não geográfico): 0 writes', s.attempts === 0, `tentativas ${s.attempts}`);
for (let i = 0; i < 3; i++) { await s.page.goto(HOST + path(i % 2 ? geoFree : cityP), { waitUntil: 'load' }); await wait(s.page, 2200); }
for (let i = 0; i < 4; i++) { await openCartIcon(s.page); await closeDrawer(s.page); await wait(s.page, 250); }
check('3 recargas de produto com carrinho + 4 aberturas do drawer: 0 writes', s.attempts === 0, `tentativas ${s.attempts}`);
await openCartIcon(s.page);
const two = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), names: [...document.querySelectorAll('turbo-frame#cart li.main-list__item .item-details p:first-child')].map((e) => e.textContent.trim()) }));
check('drawer com 2 produtos diferentes + bloco de descoberta; "Finalizar compra" visível', two.header === '2' && new Set(two.names).size === 2 && (await checkoutVisible(s.page)).visible, JSON.stringify(two));
await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + 'drawer-dois-produtos-1280.png' });
const e1 = await exitViaDrawer(s, path(geoFree));
check('1ª saída ("Explorar todas as estampas"): navegou ao storefront com token, 1 write, espera curta', e1.arrived && /^[A-Za-z0-9_-]{22}$/.test(e1.ref || '') && e1.created === 1 && e1.elapsed < 4000 && e1.url.searchParams.get('origens_src') === 'ink_cart_drawer', `arrived ${e1.arrived}, writes ${e1.created}, ${e1.elapsed}ms, src ${e1.url.searchParams.get('origens_src')}`);
const snap = e1.ref ? await readRef(e1.ref) : { status: 0 };
check('snapshot transferido (lido da INK): os 2 produtos com variantes', snap.status === 200 && snap.body.items.length === 2 && new Set(snap.body.items.map((i) => i.productId)).size === 2 && snap.body.items.every((i) => i.variant && i.color && i.size), JSON.stringify(snap.body && snap.body.items.map((i) => [i.name, i.color, i.size, i.quantity])));
let storefrontOk = true;
if (LIVE) { // storefront real: Meu carrinho -> Ir para meu carrinho -> drawer nativo
  await s.page.waitForSelector('[data-testid="cart-mirror-trigger"]', { timeout: 15000 }).catch(() => { storefrontOk = false; });
  if (storefrontOk) { await s.page.locator('[data-testid="cart-mirror-trigger"]').click(); await wait(s.page, 1500); const items = await s.page.locator('[data-testid="cart-mirror-item"]').count(); check('storefront REAL: "Meu carrinho" mostra os 2 produtos; token saiu do endereço', items === 2 && !/cart_ref|origens_src|origens_p/.test(s.page.url()), `${items} itens, ${s.page.url()}`); await s.page.screenshot({ path: EVIDENCE + 'live-storefront-meu-carrinho-1280.png' }); await s.page.locator('[data-testid="cart-mirror-go"]').click(); await s.page.waitForURL(/usesul\.com\.br\/usesul\/product\//, { timeout: 20000 }); await s.page.waitForSelector('.cart-drawer.open', { timeout: 20000 }); await wait(s.page, 1500); const back = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), search: location.search })); check('"Ir para meu carrinho" → drawer nativo aberto com os 2 itens; parâmetro consumido', back.header === '2' && back.search === '', JSON.stringify(back)); }
}
const e2 = await exitViaDrawer(s, path(cityP));
check('2ª saída com o MESMO carrinho (página nova): reutiliza o token, 0 writes novos', e2.arrived && e2.created === 0 && e2.attempts === 0 && e2.ref === e1.ref, `writes ${e2.created}, mesmo token ${e2.ref === e1.ref}`);
const e3 = await exitViaDrawer(s, path(cityP));
check('3ª saída igual: continua 0 writes novos (total 1)', e3.created === 0 && s.created === 1, `total ${s.created}`);
await s.page.goto(HOST + path(cityP), { waitUntil: 'load' }); await wait(s.page, 3000); await openCartIcon(s.page);
await s.page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]')?.click()); await s.page.waitForFunction(() => document.getElementById('quantity-header')?.getAttribute('data-quantityheader') === '3', null, { timeout: 15000 }); await wait(s.page, 1800);
check('alterar a quantidade (3 peças, promoção da INK) NÃO grava por si só', s.attempts === 1, `tentativas ${s.attempts}`);
const e4 = await exitViaDrawer(s, path(cityP));
check('saída com o carrinho ALTERADO: exatamente 1 write novo, token novo', e4.arrived && e4.created === 1 && e4.ref && e4.ref !== e1.ref, `writes ${e4.created}`);
const snap3 = e4.ref ? await readRef(e4.ref) : { status: 0 };
check('3 peças: total e desconto vêm da INK (não calculados pelo widget)', snap3.status === 200 && snap3.body.items.reduce((n, i) => n + i.quantity, 0) === 3 && !!snap3.body.totalText, JSON.stringify(snap3.body && { totalText: snap3.body.totalText, subtotal: snap3.body.subtotal, discount: snap3.body.discount }));
// falha do armazenamento: o POST devolve 503; a saída navega SEM token e a compra segue intacta
await s.page.goto(HOST + path(cityP), { waitUntil: 'load' }); await wait(s.page, 3000); await openCartIcon(s.page);
await s.page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]')?.click()); await wait(s.page, 2200);
await s.page.route('**/__origens/cart-ref', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }) : route.fallback()));
const e5 = await exitViaDrawer(s, path(cityP));
check('KV indisponível (503): a saída navega ao storefront SEM token, sem travar (< 4 s)', e5.arrived && !e5.ref && e5.elapsed < 4000, `arrived ${e5.arrived}, ref ${e5.ref}, ${e5.elapsed}ms`);
await s.page.unroute('**/__origens/cart-ref');
await s.page.goto(HOST + path(cityP), { waitUntil: 'load' }); await wait(s.page, 3000); await openCartIcon(s.page);
const after = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader') }));
check('depois da falha do KV: carrinho nativo intacto e "Finalizar compra" visível', Number(after.header) >= 3 && (await checkoutVisible(s.page)).visible, JSON.stringify(after));
// 3+ peças com a busca aberta em três larguras
for (const [w, h] of [[1280, 900], [390, 844], [320, 640]]) {
  await s.page.setViewportSize({ width: w, height: h }); await wait(s.page, 900);
  const toggle = s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-toggle'); if (await toggle.count() && await toggle.isVisible()) { await toggle.click().catch(() => {}); await wait(s.page, 600); }
  const co = await checkoutVisible(s.page); check(`[${w}×${h}] 3+ peças, busca aberta: "Finalizar compra" visível`, co.found && co.visible, JSON.stringify(co));
  await s.page.screenshot({ path: EVIDENCE + (LIVE ? 'live-' : '') + `drawer-3pecas-busca-${w}x${h}.png` });
}
check('nenhum POST do espelho levou Cookie da INK', !s.cookieSent);
const ev = s.evlog; const explore = ev.filter((e) => e[0] === 'origens_explore_storefront_click');
check('eventos: 1 origens_explore_storefront_click por saída (5 saídas), parâmetros fechados, sem token/URL', explore.length === 5 && ev.every((e) => Object.keys(e[1]).every((k) => ['send_to', 'entry_point', 'region', 'transport_type', 'product_slug'].includes(k))) && !/cart_ref|http/i.test(JSON.stringify(ev)), `${explore.length} eventos`);
if (!LIVE) { const h = await (await mf.dispatchFetch(HOST + '/__origens/health')).json(); check('health local: scope_mode e contadores de KV coerentes (writes = 2 criados)', h.scope_mode === MODE && h.cart_ref_stats.writes === s.created && s.created === 2, JSON.stringify({ scope: h.scope_mode, stats: h.cart_ref_stats })); }
console.log('KV_JORNADA ' + JSON.stringify({ tentativas: s.attempts, writes_criados: s.created }));
await browser.close(); if (mf) await mf.dispose();
const failed = results.filter((r) => !r).length; console.log(`\n${results.length - failed}/${results.length} PASS`); process.exit(failed ? 1 : 0);
