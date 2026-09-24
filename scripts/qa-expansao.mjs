#!/usr/bin/env node
// QA da EXPANSÃO para 5 produtos contra as páginas REAIS da INK, com Worker + KV LOCAIS (nada é publicado, nenhum deploy).
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-expansao.mjs
// O Worker local injeta o loader nas cinco páginas (mesmo papel do HTMLRewriter de produção); /__origens/** é atendido pelo Miniflare local.
// Sessão anônima descartável, janela visível. Bloqueia as tags de analytics da INK (nenhum evento real chega à propriedade GA4 de
// produção): os eventos que NÓS emitimos são capturados no dataLayer da página. Não abre checkout e não finaliza pedido.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const HOST = 'https://www.usesul.com.br';
const PRODUCTS = [
  { name: 'Serra Catarinense', uf: 'SC', slug: 'serra-catarinense', short: 'serra' },
  { name: 'Made in Rio Grande do Sul', uf: 'RS', slug: 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', short: 'made-rs' },
  { name: 'Made in Santa Catarina', uf: 'SC', slug: 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', short: 'made-sc' },
  { name: 'Paranaense | Essência', uf: 'PR', slug: 'paranaense-essencia', short: 'paranaense' },
  { name: 'Made in Paraná', uf: 'PR', slug: 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a', short: 'made-pr' }
];
const path = (p) => '/usesul/product/' + p.slug;
const EVIDENCE = new URL('../docs/evidence/expansao-5/', import.meta.url).pathname; mkdirSync(EVIDENCE, { recursive: true });
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror';
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
const mf = new Miniflare({
  modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'],
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: PRODUCTS.map(path).join(','), WIDGET_FEATURES: FEATURES },
  outboundService: async (req) => (new URL(req.url).host === 'useorigens.com.br' ? new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } }) : new Response('no', { status: 502 }))
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const LOADER_TAG = '<script src="/__origens/loader.js?v=4.1" defer></script>';

async function newSession(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick/, (r) => r.abort());
  const page = await ctx.newPage(); const state = { refs: [], posts: [], events: [], ctx, page };
  await page.addInitScript(() => { window.__events = []; const dl = window.dataLayer = window.dataLayer || []; const push = dl.push.bind(dl); dl.push = function () { for (const a of arguments) { if (a && a[0] === 'event' && String(a[1]).startsWith('origens_')) window.__events.push(JSON.parse(JSON.stringify([a[1], a[2]]))); } return push.apply(null, arguments); }; });
  await page.route('**/__origens/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const h = req.headers();
    const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': h['content-type'] || '', origin: h['origin'] || '', referer: h['referer'] || '', 'sec-fetch-site': h['sec-fetch-site'] || '' }, body: req.method() === 'POST' ? req.postData() : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    if (url.pathname === '/__origens/cart-ref' && req.method() === 'POST') { state.posts.push({ status: res.status, cookieSent: !!h['cookie'] }); try { const j = JSON.parse(buf.toString()); if (j.ref) state.refs.push(j.ref); } catch (_) { /* ignora */ } }
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: buf });
  });
  // Injeção local do loader nas cinco páginas (só HTML de documento da allowlist), como o Worker de produção faz.
  await page.route((u) => PRODUCTS.some((p) => u.pathname === path(p)) && u.host === 'www.usesul.com.br', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch(); const html = await res.text();
    // Como o HTMLRewriter de produção: não duplica se a página já traz o loader (a Serra já recebe a tag do Worker publicado).
    const body = html.includes('/__origens/loader.js') ? html : html.replace('</head>', LOADER_TAG + '</head>');
    await route.fulfill({ response: res, body });
  });
  return state;
}
const wait = (page, ms) => page.waitForTimeout(ms);
const readRef = async (ref) => { const r = await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref); return { status: r.status, body: r.status === 200 ? await r.json() : null }; };
const events = (s) => s.page.evaluate(() => window.__events.slice());
const checkoutVisible = (page) => page.evaluate(() => { const els = [...document.querySelectorAll('.cart-drawer a, .cart-drawer button')].filter((e) => /finalizar compra/i.test(e.textContent || '')); if (!els.length) return { found: false }; const r = els[0].getBoundingClientRect(); return { found: true, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1 }; });

async function addToCart(s, p) {
  const page = s.page; await page.goto(HOST + path(p), { waitUntil: 'load' }); await wait(page, 3200);
  // Aviso de cookies da INK: o visitante aceita (a medição do lado da INK só sai depois disso); some da página e não volta na sessão.
  const notice = page.locator('.cookie-acceptance button'); if (await notice.count() && await notice.first().isVisible()) { await notice.first().click(); await wait(page, 400); }
  await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
  const pid = await page.waitForFunction(() => { const m = document.querySelector('input[type=radio][id$="-model-Masculino"]'); return m ? m.id.split('-')[0] : null; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  for (const [g, prefer] of [['model', 'Masculino'], ['color', 'Preta'], ['size', 'M']]) {
    const id = await page.evaluate(({ pid, g, prefer }) => { const all = [...document.querySelectorAll('input[type=radio][id^="' + pid + '-' + g + '-"]')].filter((e) => !e.disabled); const pick = all.find((e) => e.id.endsWith('-' + prefer)) || all[0]; return pick && pick.id; }, { pid, g, prefer });
    await page.locator('label[for="' + id + '"]').click();
  }
  await page.waitForFunction((pid) => document.getElementById('product-variant-id-' + pid)?.value > 0, pid);
  const before = s.posts.length;
  await page.evaluate(() => document.querySelector('#add-to-cart-desk').click());
  await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(page, 2500);
  return { pid, synced: s.posts.length > before };
}

// ── A) as cinco páginas: loader único, cinco features, link de retorno, CTA nativo; captura em 1280 e 390 ────────────────────────
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const s = await newSession({ width: w, height: h });
  for (const [i, p] of PRODUCTS.entries()) {
    await s.page.goto(HOST + path(p), { waitUntil: 'load' }); await wait(s.page, 3500);
    const info = await s.page.evaluate(() => ({ loader: window.__useOrigensLoader, features: window.__useOrigens && window.__useOrigens.features, scripts: document.querySelectorAll('script[src*="/__origens/loader.js"]').length, ret: !!document.getElementById('use-origens-return-link'), cta: !!document.querySelector('#add-to-cart-desk, #add-to-cart-mob'), nativeSizes: document.querySelectorAll('input[type=radio][id*="-size-"]').length }));
    check(`[${w}] ${p.short}: loader 4.1 único, 5 features, "← Voltar a procurar" e CTA nativo da INK`, info.loader === '4.1' && info.scripts === 1 && info.features && info.features.length === 5 && info.ret && info.cta && (w < 768 || info.nativeSizes > 0), JSON.stringify(info));
    await s.page.screenshot({ path: EVIDENCE + `produto-${i + 1}-${p.short}-${w}.png` });
  }
  await s.ctx.close();
}

// ── B) jornada: dois produtos DIFERENTES no mesmo carrinho, INK → drawer → vitrine, dois caminhos de abertura ────────────────────
const s = await newSession({ width: 1280, height: 900 });
const p1 = PRODUCTS[0]; const p2 = PRODUCTS[3];
const a1 = await addToCart(s, p1); check(`adicionar ${p1.short} → 1 snapshot (POST same-origin, sem Cookie)`, a1.synced && s.posts.at(-1).status === 201 && !s.posts.at(-1).cookieSent);
const a2 = await addToCart(s, p2);
check(`adicionar ${p2.short} (outro produto) → novo snapshot`, a2.synced && a1.pid !== a2.pid);
await wait(s.page, 1000);
const postAdd = await s.page.evaluate(() => { const b = document.querySelector('#modal-wrapper [data-origens-discovery="post-add"]'); return b ? { cta: b.querySelector('.o-cta')?.textContent } : null; });
check('pós-adição: bloco de descoberta presente ("Explorar outras camisetas")', postAdd && /explorar/i.test(postAdd.cta));
await s.page.evaluate(() => { const a = document.querySelector('#modal-wrapper [data-origens-discovery="post-add"] .o-cta'); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); });
await s.page.locator('#modal-wrapper [data-origens-discovery="post-add"] .o-cta').click({ noWaitAfter: true }); await wait(s.page, 300);
let ev = await events(s); const postAddHref = await s.page.evaluate(() => document.querySelector('#modal-wrapper [data-origens-discovery="post-add"] .o-cta').href);
const postAddEvent = ev.find((e) => e[0] === 'origens_explore_storefront_click' && e[1].entry_point === 'ink_post_add');
check('clique no CTA pós-adição: 1 evento origens_explore_storefront_click (ink_post_add) e link marcado', !!postAddEvent && ev.filter((e) => e[1].entry_point === 'ink_post_add').length === 1 && new URL(postAddHref).searchParams.get('origens_src') === 'ink_post_add' && new URL(postAddHref).searchParams.get('origens_p') === p2.slug, postAddHref.replace(/cart_ref=[^&]+/, 'cart_ref=<ref>'));
check('evento sem cart_ref/URL/PII (parâmetros fechados)', ev.every((e) => Object.keys(e[1]).every((k) => ['send_to', 'entry_point', 'region', 'transport_type', 'product_slug'].includes(k))) && !/cart_ref|http/i.test(JSON.stringify(ev)));
// caminho 1: "Ver carrinho" pós-adição
await s.page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click());
await s.page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(s.page, 800);
const two = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), names: [...document.querySelectorAll('turbo-frame#cart li.main-list__item .item-details p:first-child')].map((e) => e.textContent.trim()) }));
check('drawer (via "Ver carrinho"): 2 produtos diferentes + bloco de descoberta', two.header === '2' && new Set(two.names).size === 2, JSON.stringify(two));
const co1 = await checkoutVisible(s.page); check('"Finalizar compra" visível no drawer com o bloco montado (1280)', co1.found && co1.visible, JSON.stringify(co1));
await s.page.screenshot({ path: EVIDENCE + 'drawer-dois-produtos-1280.png' });
const lastRef = s.refs.at(-1); const snap = await readRef(lastRef);
check('espelho (KV): snapshot com os DOIS produtos e suas variantes, lido da INK', snap.status === 200 && snap.body.items.length === 2 && new Set(snap.body.items.map((i) => i.productId)).size === 2 && snap.body.items.every((i) => i.variant && i.color && i.size), JSON.stringify(snap.body && snap.body.items.map((i) => [i.name, i.color, i.size, i.quantity])));
await s.page.evaluate(() => { const a = document.querySelector('.cart-drawer [data-origens-discovery="cart"] .o-cta'); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); });
await s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-cta').click({ noWaitAfter: true }); await wait(s.page, 300);
ev = await events(s); const cartHref = await s.page.evaluate(() => document.querySelector('.cart-drawer [data-origens-discovery="cart"] .o-cta').href); const u = new URL(cartHref);
check('"Explorar vitrine" do drawer: evento ink_cart_drawer, marcador + cart_ref no link, storefront /sul', ev.some((e) => e[0] === 'origens_explore_storefront_click' && e[1].entry_point === 'ink_cart_drawer') && u.searchParams.get('origens_src') === 'ink_cart_drawer' && u.searchParams.get('cart_ref') === lastRef && u.pathname === '/sul' && u.origin === 'https://useorigens.com.br');
// caminho 2: ícone do cabeçalho (recarrega a página; o carrinho da INK persiste na sessão)
await s.page.goto(HOST + path(p1), { waitUntil: 'load' }); await wait(s.page, 3500);
await s.page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); });
await s.page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 });
check('drawer (via ícone do cabeçalho): bloco montado e "Finalizar compra" visível', (await checkoutVisible(s.page)).visible);
// ida e volta: ?origens_open_cart=1 abre o drawer nativo, itens preservados, evento só depois de aberto, parâmetro consumido
await s.page.evaluate(() => { window.__events.length = 0; });
await s.page.goto(HOST + path(p1) + '?origens_open_cart=1', { waitUntil: 'load' });
await s.page.waitForSelector('.cart-drawer.open', { timeout: 15000 }); await wait(s.page, 1500);
const back = await s.page.evaluate(() => ({ search: location.search, header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader') }));
ev = await events(s); const opened = ev.filter((e) => e[0] === 'origens_native_cart_opened');
check('retorno do storefront (?origens_open_cart=1): drawer nativo aberto, 2 itens, parâmetro consumido', back.header === '2' && back.search === '');
check('origens_native_cart_opened: 1 evento (storefront_return) só após o drawer abrir', opened.length === 1 && opened[0][1].entry_point === 'storefront_return' && opened[0][1].product_slug === p1.slug, JSON.stringify(opened));

// ── C) 3+ peças (promoção da INK): valores lidos da INK; "Finalizar compra" visível em 390×844 e 320×640 mesmo com a busca aberta ──
await s.page.evaluate(() => { const inc = document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]'); inc && inc.click(); }); await wait(s.page, 2500);
const three = await s.page.evaluate(() => ({ header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), total: [...document.querySelectorAll('.cart-drawer__footer p, .cart-drawer__footer span')].map((e) => e.textContent.trim()).filter((t) => /R\$/.test(t)).slice(0, 4), promo: /LEVANDO|PE[ÇC]AS/i.test(document.querySelector('.cart-drawer')?.textContent || '') }));
await wait(s.page, 1500); const snap3 = await readRef(s.refs.at(-1));
const pieces = snap3.body ? snap3.body.items.reduce((n, i) => n + i.quantity, 0) : 0;
check('3+ peças: o espelho lê a INK (peças somam 3+) e o total exibido vem da INK, não do widget', pieces >= 3, JSON.stringify({ header: three.header, promo: three.promo, totalText: snap3.body && snap3.body.totalText, subtotal: snap3.body && snap3.body.subtotal }));
for (const [w, h, tag] of [[1280, 900, '1280'], [390, 844, '390'], [320, 640, '320x640']]) {
  await s.page.setViewportSize({ width: w, height: h }); await wait(s.page, 1200);
  const toggle = s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-toggle'); if (await toggle.count() && await toggle.isVisible()) { await toggle.click().catch(() => {}); await wait(s.page, 700); }
  const co = await checkoutVisible(s.page);
  check(`[${tag}] 3+ peças, busca aberta: "Finalizar compra" continua visível`, co.found && co.visible, JSON.stringify(co));
  await s.page.screenshot({ path: EVIDENCE + `drawer-3pecas-busca-${tag}.png` });
}
check('nenhum POST do espelho levou Cookie da INK', s.posts.every((p) => !p.cookieSent));
await browser.close();
const failed = results.filter((r) => !r).length; console.log(`\n${results.length - failed}/${results.length} PASS`); process.exit(failed ? 1 : 0);
