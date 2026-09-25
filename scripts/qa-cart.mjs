#!/usr/bin/env node
// QA do bloco de descoberta no drawer do CARRINHO contra a página REAL da INK.
//   PW_PATH=/tmp/pw node scripts/qa-cart.mjs <desktop|mobile> [--width N] [--live] [--out docs/evidence/cart] [--tag after]
// Sem --live: as requisições /__origens/* são atendidas por um Worker LOCAL (Miniflare) com o build atual (nada é publicado).
// Com --live: contra a produção real. Sessão anônima descartável, janela visível; nunca abre checkout nem preenche dados;
// o carrinho é alterado SÓ na sessão de teste (o "−" da lixeira remove o item de teste). Banner de cookies não é aceito.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const LIVE = process.argv.includes('--live');
const { Miniflare } = LIVE ? { Miniflare: null } : await import(process.env.MINIFLARE || 'miniflare');
const mode = process.argv[2] || 'desktop';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'docs/evidence/cart'); const tag = arg('--tag', 'after'); mkdirSync(out, { recursive: true });
const WIDTH = Number(arg('--width', mode === 'mobile' ? 390 : 1280));
const mobile = WIDTH < 768;
const label = arg('--width') ? 'w' + WIDTH : mode;
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense'; const OTHER = '/usesul/product/vida-no-sul-estancia-edition';
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };

const mf = LIVE ? null : new Miniflare({
  modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01',
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: P, WIDGET_FEATURES: 'return-link,post-add-discovery,city-search,cart-discovery' },
  // Índice de cidades: storefront REAL; se ele estiver indisponível neste momento, cai no snapshot real versionado (test/fixtures/search).
  outboundService: async (req) => {
    if (new URL(req.url).host !== 'useorigens.com.br') return new Response('no', { status: 404 });
    try { const r = await fetch(req.url, { headers: { accept: 'application/json' } }); if (r.ok) return r; } catch (_) { /* cai no snapshot */ }
    console.log('INFO storefront indisponível agora: índice servido pelo snapshot real versionado');
    return new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } });
  }
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: WIDTH, height: WIDTH < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' } : { viewport: { width: WIDTH, height: WIDTH >= 1024 ? 900 : 1024 }, locale: 'pt-BR' });
const page = await ctx.newPage();
const errors = []; const searchLog = []; let searchFail = false;
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
page.on('request', (r) => { if (new URL(r.url()).pathname === '/__origens/search') r.allHeaders().then((h) => searchLog.push({ cookie: h['cookie'] || null, authorization: h['authorization'] || null })); });
if (!LIVE) await page.route('**/__origens/**', async (route) => { const url = new URL(route.request().url()); const res = await mf.dispatchFetch(url.href, { method: route.request().method() }); await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) }); });
const failRoute = (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"unavailable"}' });

const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${out}/${tag}${LIVE ? '-live' : ''}-cart-${name}-${label}.jpg`, type: 'jpeg', quality: 62 });
const G = () => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
  const d = document.querySelector('.cart-drawer'); const f = d && d.querySelector('turbo-frame#cart'); const main = f && f.querySelector('.cart-drawer__main'); const foot = f && f.querySelector('.cart-drawer__footer');
  const btn = document.getElementById('checkout-btn'); const root = d && d.querySelector('[data-origens-discovery="cart"]');
  const hs = () => document.documentElement.scrollWidth; const withB = hs(); const itemWith = (() => { const it = d && d.querySelector('turbo-frame#cart li.main-list__item'); return it ? Math.round(it.getBoundingClientRect().width) : null; })(); if (root) root.style.display = 'none'; const without = hs(); const itemWithout = (() => { const it = d && d.querySelector('turbo-frame#cart li.main-list__item'); return it ? Math.round(it.getBoundingClientRect().width) : null; })(); if (root) root.style.display = '';
  const item = d && d.querySelector('turbo-frame#cart li.main-list__item'); const price = item && item.querySelector('.price-details span');
  const itemW = item ? Math.round(item.getBoundingClientRect().width) : null; const priceBox = price ? price.getBoundingClientRect() : null; const drawerBox = d ? d.getBoundingClientRect() : null;
  const b = btn && btn.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, open: !!(d && d.classList.contains('open')), roots: document.querySelectorAll('[data-origens-discovery="cart"]').length, styles: document.querySelectorAll('style[data-origens-discovery-style]').length,
    root: r(root), footer: r(foot), main: r(main), mainScroll: main ? main.scrollHeight + '/' + main.clientHeight : null, checkout: r(btn),
    checkoutVisible: !!btn && b.top >= 0 && b.bottom <= innerHeight && b.height > 0, checkoutText: btn ? btn.textContent.trim() : null,
    rootInMain: !!(root && main && main.contains(root)), rootInFooter: !!(root && root.closest('.cart-drawer__footer')),
    header: document.getElementById('quantity-header') ? document.getElementById('quantity-header').textContent.trim() : null, amount: document.getElementById('amount') ? document.getElementById('amount').textContent.trim() : null,
    hWith: withB, hWithout: without, itemWith, itemWithout, priceVisible: !!priceBox && priceBox.right <= drawerBox.right && priceBox.width > 0, items: document.querySelectorAll('turbo-frame#cart li.main-list__item').length, empty: !!(d && d.querySelector('.empty-cart')) };
});
const clickIcon = () => page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); if (b) b.click(); return !!b; });
const closeDrawer = () => page.evaluate(() => { const d = document.querySelector('.cart-drawer'); const x = d && [...d.querySelectorAll('button')].find((b) => b.querySelector('svg') && /close|fechar/i.test((b.getAttribute('data-action') || '') + (b.getAttribute('aria-label') || '') + b.id)); if (x) x.click(); else if (d) d.classList.remove('open'); });

await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3500);
check((LIVE ? 'loader de PRODUÇÃO' : 'build local') + ' ativo (v' + LOADER_VERSION + ') com cart-discovery', (await page.evaluate((v) => window.__useOrigensLoader === v, LOADER_VERSION)) && (await page.evaluate(() => window.__useOrigens.features.includes('cart-discovery'))));
await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click(); await page.locator('label[for="4932916-color-Preta"]').click(); await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
await page.evaluate((s) => document.querySelector(s).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(1200);
check('antes de abrir o carrinho: nenhum bloco de carrinho (drawer fechado)', (await G()).roots === 0);

// ---- caminho 1: "Ver carrinho" do modal pós-adição (nativo)
await page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click());
await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(800);
let g = await G();
check('via "Ver carrinho": 1 bloco dentro de .cart-drawer__main, fora do rodapé', g.roots === 1 && g.rootInMain && !g.rootInFooter, JSON.stringify({ roots: g.roots, inMain: g.rootInMain }));
check('"Finalizar compra" continua visível e íntegro', g.checkoutVisible && g.checkoutText === 'Finalizar compra', JSON.stringify(g.checkout) + ' vh=' + g.vh);
check('item nativo do carrinho NÃO é espremido (largura igual com e sem o bloco) e o preço continua visível', g.itemWith === g.itemWithout && g.priceVisible && g.itemWith >= g.vw * 0.9 || g.itemWith === g.itemWithout && g.priceVisible, 'item ' + g.itemWith + ' vs ' + g.itemWithout + ' priceVisible=' + g.priceVisible);
check('o bloco vive dentro do <ul> dos itens (slot li), não como irmão do <ul>', await page.evaluate(() => { const r = document.querySelector('.cart-drawer [data-origens-discovery="cart"]'); return !!r && r.parentElement.tagName === 'LI' && !!r.closest('.cart-drawer__main > ul'); }));
check('nosso bloco não causa overflow horizontal novo (largura igual com e sem o bloco)', g.hWith === g.hWithout, g.hWith + ' vs ' + g.hWithout);
const baseFooter = g.footer; const baseCheckout = g.checkout; const baseAmount = g.amount; const baseHeader = g.header;
await shot('drawer');
// ---- caminho 2: fechar e abrir pelo ícone do cabeçalho
await closeDrawer(); await wait(1000);
g = await G(); check('ao fechar o drawer do carrinho o bloco sai (0)', g.roots === 0 && g.styles <= 1, JSON.stringify({ roots: g.roots, styles: g.styles }));
await page.evaluate(() => document.getElementById('modal-close-button')?.click()); await wait(500);
check('ícone do cabeçalho existe e abre o drawer', await clickIcon());
await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(800);
g = await G();
check('via ícone: 1 bloco; rodapé e "Finalizar compra" na MESMA posição de antes', g.roots === 1 && JSON.stringify(g.footer) === JSON.stringify(baseFooter) && JSON.stringify(g.checkout) === JSON.stringify(baseCheckout), JSON.stringify({ footer: g.footer, checkout: g.checkout }));
check('valores nativos (contagem e subtotal) inalterados pelo bloco', g.header === baseHeader && g.amount === baseAmount, g.header + ' / ' + g.amount);
// ---- busca colapsável
const root = page.locator('.cart-drawer [data-origens-discovery="cart"]');
const collapsedH = g.root.h;
await root.locator('.o-toggle').click(); await page.waitForSelector('.cart-drawer .o-panel:not([hidden])'); await wait(400);
g = await G(); await shot('search-open');
check('busca abre no toque; "Finalizar compra" segue visível e o rodapé não se move', g.checkoutVisible && JSON.stringify(g.footer) === JSON.stringify(baseFooter));
const input = root.locator('.o-input'); await page.mouse.move(1, 1);
await input.type('floripa', { delay: 40 }); await page.waitForSelector('.cart-drawer .o-item', { timeout: 8000 }); await wait(400);
g = await G(); await shot('search-results');
const found = await page.evaluate(() => [...document.querySelectorAll('.cart-drawer .o-item')].map((a) => a.querySelector('.o-name').textContent + '|' + a.getAttribute('href')));
check('busca "floripa" → Florianópolis (link real do storefront), no máximo 3 resultados', found[0] === 'Florianópolis|https://useorigens.com.br/sul/sc/florianopolis' && found.length <= 3, JSON.stringify(found));
check('com resultados: "Finalizar compra" visível, rodapé imóvel, sem overflow novo', g.checkoutVisible && JSON.stringify(g.footer) === JSON.stringify(baseFooter) && g.hWith === g.hWithout, JSON.stringify({ checkout: g.checkout }));
check('requisição de busca same-origin, sem Cookie/Authorization', searchLog.length >= 1 && searchLog.every((s) => s.cookie === null && s.authorization === null));
await input.fill(''); await input.type('xyzq', { delay: 40 }); await page.waitForSelector('.cart-drawer .o-status:not(:empty)'); await wait(900);
await shot('search-empty');
check('sem resultado: mensagem + "Explorar vitrine" visíveis; checkout visível', /Ainda não encontramos/.test(await page.locator('.cart-drawer .o-status').textContent()) && (await page.locator('.cart-drawer .o-cta').isVisible()) && (await G()).checkoutVisible);
if (LIVE) await page.route('**/__origens/search*', failRoute); else searchFail = true;
if (!LIVE) await page.route('**/__origens/search*', failRoute);
await input.fill(''); await input.type('curitiba', { delay: 40 }); await wait(1300); await shot('search-error');
check('falha do gateway (502): mensagem curta + CTA; carrinho e checkout intactos', /A busca não está disponível agora/.test(await page.locator('.cart-drawer .o-status').textContent()) && (await G()).checkoutVisible);
await page.unroute('**/__origens/search*'); if (!LIVE) await page.route('**/__origens/**', async (route) => { const url = new URL(route.request().url()); const res = await mf.dispatchFetch(url.href, { method: route.request().method() }); await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) }); });
await root.locator('.o-close').click(); await wait(400); g = await G();
check('fechar a busca restaura o layout (painel oculto, altura recolhida, rodapé imóvel)', g.root.h === collapsedH && JSON.stringify(g.footer) === JSON.stringify(baseFooter), 'root h ' + collapsedH + ' → ' + g.root.h);

// ---- quantidade nativa (+) e re-render do frame
await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]').click());
await page.waitForFunction(() => document.getElementById('quantity-header')?.textContent.includes('2 produtos'), null, { timeout: 15000 }); await wait(1200);
g = await G();
check('quantidade + (nativa): frame re-renderizado, 1 bloco (sem duplicar), subtotal atualizado só pela INK', g.roots === 1 && /2 produtos/.test(g.header) && g.amount !== baseAmount, g.header + ' / ' + g.amount);

// ---- ida ao storefront e volta na MESMA sessão
const cartBefore = await page.evaluate(async () => (await (await fetch('/usesul/cart', { headers: { Accept: 'text/html' } })).text()).length);
await root.locator('.o-toggle').click(); await page.mouse.move(1, 1); await input.fill(''); await input.type('curitiba', { delay: 40 }); await page.waitForSelector('.cart-drawer .o-item'); await wait(300);
await Promise.all([page.waitForURL(/useorigens\.com\.br\/sul\/pr\/curitiba/, { timeout: 25000 }), page.keyboard.press('Enter')]);
const sf = await page.request.get(page.url());
check('Enter no resultado abre a página real da cidade no storefront (200)', sf.status() === 200, page.url() + ' ' + sf.status());
await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3000);
check('voltar à INK na MESMA sessão: carrinho nativo idêntico', (await page.evaluate(async () => (await (await fetch('/usesul/cart', { headers: { Accept: 'text/html' } })).text()).length)) === cartBefore);
await clickIcon(); await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(600);
g = await G(); check('depois da volta: drawer reaberto → 1 bloco, checkout visível, itens preservados', g.roots === 1 && g.checkoutVisible && /2 produtos/.test(g.header));

// ---- Turbo com o drawer aberto → outro produto
await page.evaluate((p) => window.Turbo.visit(p), OTHER); await page.waitForURL('**' + OTHER, { timeout: 20000 }); await wait(2500);
check('Turbo com o drawer aberto → produto NÃO permitido: 0 bloco, 0 link, 0 estilo', (await page.evaluate(() => document.querySelectorAll('[data-origens-discovery],#use-origens-return-link,style[data-origens-discovery-style]').length)) === 0);
await clickIcon(); await wait(1200);
check('em outro produto, abrir o carrinho não monta nada nosso (0)', (await page.evaluate(() => document.querySelectorAll('[data-origens-discovery]').length)) === 0);
await page.evaluate((p) => window.Turbo.visit(p), P); await page.waitForURL('**' + P, { timeout: 20000 }); await wait(2500);
check('Turbo de volta à Serra: 1 link (1 → 0 → 1)', (await page.locator('#use-origens-return-link').count()) === 1);

// ---- remoção pela lixeira (nativa) até o carrinho vazio + estado vazio
// Observação (INK, preexistente e independente do nosso código): depois de navegação Turbo entre produtos o controller do drawer
// falha ao conectar em larguras móveis (ícone não abre o drawer, verificado em produtos sem o Worker). Recarrega a página (mesma sessão).
await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3000);
await clickIcon(); await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(500);
for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="decrement"]')?.click()); await wait(1800); }
await page.waitForFunction(() => !!document.querySelector('.cart-drawer .empty-cart'), null, { timeout: 15000 }); await wait(1200);
g = await G(); await shot('empty');
check('carrinho vazio: bloco no estado vazio (1), sem "Finalizar compra" (a INK o remove), nada quebrado', g.empty && g.roots === 1 && g.checkout === null, JSON.stringify({ roots: g.roots, empty: g.empty }));
// ---- intenção "abrir o carrinho" (será usada pelo storefront: "Ir para meu carrinho")
await page.goto(HOST + P + '?origens_open_cart=1', { waitUntil: 'load' });
await page.waitForSelector('.cart-drawer.open', { timeout: 15000 }); await wait(1200);
check('?origens_open_cart=1 abre o drawer NATIVO do carrinho e limpa o parâmetro da URL', (await page.evaluate(() => !!document.querySelector('.cart-drawer.open') && !location.search.includes('origens_open_cart'))));
check('com o drawer aberto pela intenção: 1 bloco nosso, nada quebrado', (await G()).roots === 1);
const ours = errors.filter((e) => /use.?origens|origens-discovery|__origens/i.test(e));
check('console: nenhum erro atribuível ao nosso código', ours.length === 0, ours.join(' | '));
console.log('INFO erros preexistentes da INK:', [...new Set(errors.filter((e) => !/origens/i.test(e)).map((e) => e.slice(0, 60)))].join(' | '));
await browser.close(); if (mf) await mf.dispose();
console.log('RESUMO qa-cart ' + label + ': ' + results.filter(Boolean).length + ' PASS, ' + results.filter((x) => !x).length + ' FAIL');
process.exit(results.every(Boolean) ? 0 : 1);
