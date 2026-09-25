#!/usr/bin/env node
// QA do ESPELHO do carrinho (cart-mirror) contra a página REAL da INK, com Worker + KV LOCAIS (nada é publicado).
//   PW_PATH=/tmp/pw node scripts/qa-mirror.mjs
// Sessão anônima descartável, janela visível. Lê o carrinho REAL (turbo-frame#cart), confere o snapshot gravado no KV local,
// muda a quantidade e remove o item pelos controles nativos, e abre o storefront real pelo NOSSO link (com ?cart_ref=).
// Não abre checkout, não finaliza pedido, não aceita cookies. Sem KV de produção: a ponte só é habilitada localmente.
// DEPRECATED: os checks assumem o espelho gravando ao adicionar/alterar o carrinho (removido: agora é sob demanda). Use scripts/qa-global.mjs (local/--live). Para reexecutar esta versão histórica: QA_LEGACY=1.
if (process.env.QA_LEGACY !== '1') { console.error('qa-mirror.mjs está DEPRECATED (semântica antiga do espelho). Use scripts/qa-global.mjs.'); process.exit(2); }
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense';
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'navbar-gateway.js', 'stores.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/header-nav.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
const mf = new Miniflare({
  modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'],
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: P, WIDGET_FEATURES: 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror' },
  outboundService: async (req) => (new URL(req.url).host === 'useorigens.com.br' ? new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } }) : new Response('no', { status: 404 }))
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' }); const page = await ctx.newPage();
const refs = []; const posts = [];
await page.route('**/__origens/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const h = req.headers();
  const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': h['content-type'] || '', origin: h['origin'] || '', referer: h['referer'] || '', 'sec-fetch-site': h['sec-fetch-site'] || '', cookie: h['cookie'] || '' }, body: req.method() === 'POST' ? req.postDataBuffer() : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  if (url.pathname === '/__origens/cart-ref' && req.method() === 'POST') { posts.push({ status: res.status, cookieSent: !!h['cookie'], body: req.postData() }); try { const j = JSON.parse(buf.toString()); if (j.ref) refs.push(j.ref); } catch (_) { /* ignora */ } }
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: buf });
});
const wait = (ms) => page.waitForTimeout(ms);
const readRef = async (ref) => { const r = await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref); return { status: r.status, body: r.status === 200 ? await r.json() : null }; };
const domCart = () => page.evaluate(() => { const f = document.querySelector('.cart-drawer turbo-frame#cart'); return { header: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), name: f?.querySelector('.item-details p')?.textContent.trim(), price: [...(f?.querySelectorAll('.price-details span') || [])].filter((x) => !x.querySelector('del') && !x.closest('del')).pop()?.textContent.trim(), qty: f?.querySelector('input[name="cart_item[quantity]"]')?.value, img: f?.querySelector('li.main-list__item img')?.getAttribute('src'), subtotal: document.getElementById('amount')?.textContent.trim() }; });

await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3500);
check('build local ativo com cart-mirror', await page.evaluate(() => window.__useOrigens.features.includes('cart-mirror')));
check('carrinho anônimo vazio ao chegar: nada é espelhado (0 POST)', posts.length === 0);
await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click(); await page.locator('label[for="4932916-color-Preta"]').click(); await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
await page.evaluate(() => document.querySelector('#add-to-cart-desk').click());
await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 });
await page.waitForFunction(() => true); await wait(2500);
// 1) sincronização depois de adicionar
check('adicionar item na INK → 1 snapshot enviado (mesma origem, sem Cookie)', posts.length === 1 && posts[0].status === 201 && !posts[0].cookieSent, JSON.stringify({ n: posts.length, status: posts[0] && posts[0].status }));
const dom1 = await domCart();
let snap = await readRef(refs[0]);
check('KV: snapshot bate com o carrinho REAL (nome, cor, tamanho, qtd, preço, subtotal, imagem da CDN da INK)', snap.status === 200 && snap.body.count === Number(dom1.header) && snap.body.items[0].name === dom1.name && snap.body.items[0].quantity === Number(dom1.qty) && snap.body.items[0].linePriceText === dom1.price && snap.body.items[0].color === 'Preta' && snap.body.items[0].size === 'M' && snap.body.items[0].image === dom1.img && /^R\$/.test(snap.body.items[0].linePriceText), JSON.stringify(snap.body && { count: snap.body.count, item: snap.body.items[0] && { n: snap.body.items[0].name, c: snap.body.items[0].color, s: snap.body.items[0].size, q: snap.body.items[0].quantity, p: snap.body.items[0].linePriceText } }));
check('snapshot sem cookie/CSRF/sessão/dados pessoais', !/cookie|csrf|authenticity|session|token|email|cpf|cep|telefone/i.test(JSON.stringify(snap.body)) && snap.body.items[0].productId === '4932916');
// 2) ir ao storefront pelo NOSSO link, com cart_ref; o carrinho da INK continua o mesmo
await page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click());
await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 15000 }); await wait(500);
const linkHref = await page.evaluate(() => { const a = document.querySelector('.cart-drawer [data-origens-discovery="cart"] .o-cta'); a.addEventListener('click', (e) => e.preventDefault(), { once: true, capture: false }); return a.href; });
await page.locator('.cart-drawer [data-origens-discovery="cart"] .o-cta').click({ noWaitAfter: true }); await wait(300);
const decorated = await page.evaluate(() => document.querySelector('.cart-drawer [data-origens-discovery="cart"] .o-cta').href);
check('link "Explorar vitrine" ganha ?cart_ref= no clique (só o nosso link)', new URL(decorated).searchParams.get('cart_ref') === refs[0] && new URL(decorated).pathname === '/sul', decorated.replace(refs[0], '<ref>'));
const inkLink = await page.evaluate(() => [...document.querySelectorAll('a[href*="useorigens"]')].filter((a) => !a.closest('[data-origens-discovery]') && a.id !== 'use-origens-return-link').map((a) => a.href));
check('nenhum link nativo da INK foi decorado', inkLink.every((h) => !/cart_ref/.test(h)), String(inkLink.length));
await Promise.all([page.waitForURL(/useorigens\.com\.br\/sul/, { timeout: 25000 }), page.evaluate(() => { document.querySelector('.cart-drawer [data-origens-discovery="cart"] .o-cta').click(); })]);
const sfRes = await page.request.get(page.url());
check('storefront real abre com ?cart_ref= (200; o storefront ainda ignora o parâmetro)', sfRes.status() === 200 && /cart_ref=/.test(page.url()), page.url().replace(/cart_ref=[^&]+/, 'cart_ref=<ref>') + ' ' + sfRes.status());
check('o snapshot continua legível pelo token (leitura pelo servidor do storefront)', (await readRef(refs[0])).status === 200);
// 3) voltar à INK, mudar a quantidade (nativo) e sincronizar de novo
await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3500);
check('voltar à INK na mesma sessão: carrinho preservado e re-sincronizado (novo token)', posts.length === 2 && refs.length === 2 && refs[1] !== refs[0], String(posts.length));
await page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); }); await wait(1500);
await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]').click());
await page.waitForFunction(() => document.getElementById('quantity-header')?.getAttribute('data-quantityheader') === '2', null, { timeout: 15000 }); await wait(2200);
check('mudar quantidade na INK → nova sincronização', posts.length === 3, String(posts.length));
snap = await readRef(refs[refs.length - 1]); const dom2 = await domCart();
check('novo snapshot reflete a nova quantidade e o novo preço da linha (2 × R$ 109,90)', snap.body.count === 2 && snap.body.items[0].quantity === 2 && snap.body.items[0].linePriceText === dom2.price, JSON.stringify(snap.body.items[0] && { q: snap.body.items[0].quantity, p: snap.body.items[0].linePriceText }));
const old = await readRef(refs[0]);
check('o token ANTIGO continua mostrando o estado ANTIGO (snapshot; não é tempo real)', old.status === 200 && old.body.items[0].quantity === 1);
// 4) remover pelos controles nativos → snapshot vazio
for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="decrement"]')?.click()); await wait(1800); }
await page.waitForFunction(() => !!document.querySelector('.cart-drawer .empty-cart'), null, { timeout: 15000 }); await wait(2200);
snap = await readRef(refs[refs.length - 1]);
check('remover o item → snapshot vazio (o espelho deixa de listar o item)', snap.status === 200 && snap.body.count === 0 && snap.body.items.length === 0, JSON.stringify(snap.body && { count: snap.body.count, items: snap.body.items.length }));
check('nenhum POST levou Cookie da INK', posts.every((p) => !p.cookieSent));
console.log('INFO posts:', posts.length, 'tokens:', refs.length);
await browser.close(); await mf.dispose();
console.log('RESUMO qa-mirror: ' + results.filter(Boolean).length + ' PASS, ' + results.filter((x) => !x).length + ' FAIL');
process.exit(results.every(Boolean) ? 0 : 1);
