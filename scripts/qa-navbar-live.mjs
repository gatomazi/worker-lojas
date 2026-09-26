#!/usr/bin/env node
// QA AO VIVO da navbar da INK (header-nav), contra o Worker PUBLICADO e a página REAL da INK. Chamado por scripts/release-navbar.sh depois do deploy.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-navbar-live.mjs            -> ao vivo: nada é injetado nem simulado (POST de cart-ref e leitura do KV VERDADEIROS)
//   PW_PATH=... node scripts/qa-navbar-live.mjs --rehearse                          -> ENSAIO antes do deploy: injeta o loader LOCAL e responde /__origens/navbar e cart-ref por
//                                                                                      page.route (nenhum KV real é escrito); serve para validar o próprio roteiro
// Sessão anônima descartável. NÃO faz compra: só adiciona UM item ao carrinho anônimo, abre o drawer e confere que "Finalizar compra" está
// visível e habilitado (nunca clica). Bloqueia as tags de analytics da INK. Evidência em QA_EVIDENCE_DIR (padrão docs/evidence/navbar-ink-search/live/).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLoaderSource, LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const REHEARSE = process.argv.includes('--rehearse');
const HOST = 'https://www.usesul.com.br';
const SF = 'https://useorigens.com.br';
const PRODUCT = '/usesul/product/paranaense-essencia';
const OUT = process.env.QA_EVIDENCE_DIR || new URL('../docs/evidence/navbar-ink-search/live/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const results = []; const failures = [];
const check = (n, ok, d = '') => { results.push(!!ok); if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 300) : '')); };
const REF_RE = /^[A-Za-z0-9_-]{22}$/;
const REHEARSAL_CONFIG = { v: 1, collections: ['Seu Lugar', 'Da Nossa Terra', 'Fala Daqui'].map((name) => ({ name, slug: name.toLowerCase().replace(/ /g, '-') })) };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms/, (r) => r.abort());
  const page = await ctx.newPage();
  const s = { ctx, page, ours: [], posts: [], sfDocs: [], log: [] };
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host === 'www.usesul.com.br' && u.pathname.startsWith('/__origens/')) { s.ours.push(req.method() + ' ' + u.pathname); if (req.method() === 'POST' && u.pathname === '/__origens/cart-ref') s.posts.push(Date.now()); }
    if (u.host === 'useorigens.com.br' && req.resourceType() === 'document') s.sfDocs.push(req.url());
  });
  if (REHEARSE) {
    await page.route('**/__origens/navbar', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REHEARSAL_CONFIG) }));
    await page.route('**/__origens/cart-ref', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }) }));
    await page.route(SF + '/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Buscar estampas (stub do ensaio)</h1></body></html>' }));
  }
  return s;
}
async function openProduct(s) {
  await s.page.goto(HOST + PRODUCT, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
  if (REHEARSE) { await s.page.evaluate(() => { delete window.__useOrigensLoader; delete window.__useOrigens; }); await s.page.addScriptTag({ content: buildLoaderSource([], ['header-nav', 'cart-mirror'], 'product-catalog') }); }
  await s.page.waitForSelector('header [data-origens-nav]', { timeout: 25000 }).catch(() => {});
}
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible()) { await n.first().click(); await wait(page, 400); } };
const geometry = (page) => page.evaluate(() => {
  const vis = (e) => e && e.getClientRects().length > 0;
  const box = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, r: b.right, y: b.y, b: b.bottom }; };
  const overlap = (list) => list.some((a, i) => list.some((c, j) => j > i && a.x < c.r - 1 && c.x < a.r - 1 && a.y < c.b - 1 && c.y < a.b - 1));
  const top = document.querySelector('.navbar__top'); const mobile = top && vis(top) ? [...top.querySelectorAll('#menu-hamburger, .o-nav-logo, .o-nav-lupa, #shopping-cart-menu-mob')].filter(vis).map(box) : [];
  const desk = document.querySelector('[data-origens-nav="desktop"]'); const deskItems = desk && vis(desk) ? [...desk.querySelectorAll('.o-nav-logo, .o-nav-links a, .o-nav-lupa'), ...document.querySelectorAll('.menu-icons')].filter(vis).map(box) : [];
  return { vw: innerWidth, sw: document.documentElement.scrollWidth, overlap: overlap(mobile) || overlap(deskItems), nativeSearchHidden: [...document.querySelectorAll('button[aria-label="Pesquisar"], #mobile_search, form[data-controller~="ink-store--input-search"]')].every((e) => !vis(e)), cartVisible: vis(document.querySelector(innerWidth >= 1024 ? '.menu-icons' : '#shopping-cart-menu-mob')), loader: window.__useOrigensLoader, features: (window.__useOrigens || {}).features || [] };
});
async function addToCart(page) {
  await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
  const pid = await page.waitForFunction(() => { const m = document.querySelector('input[type=radio][id*="-model-"]'); return m ? m.id.split('-')[0] : null; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  for (const [g, prefer] of [['model', 'Masculino'], ['color', 'Preta'], ['size', 'M']]) {
    const id = await page.evaluate(({ pid, g, prefer }) => { const all = [...document.querySelectorAll('input[type=radio][id^="' + pid + '-' + g + '-"]')].filter((e) => !e.disabled); const pick = all.find((e) => e.id.endsWith('-' + prefer)) || all[0]; return pick && pick.id; }, { pid, g, prefer });
    await page.locator('label[for="' + id + '"]').click();
  }
  await page.waitForFunction((pid) => document.getElementById('product-variant-id-' + pid)?.value > 0, pid);
  await page.evaluate(() => document.querySelector('#add-to-cart-desk').click());
  await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(page, 2200);
}
// O KV é eventualmente consistente entre regiões: a chave recém-criada pode dar 404 por um tempo. Leitura com espera limitada (registrada).
async function readRef(ref, maxMs = 90000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < maxMs) { const r = await fetch(HOST + '/__origens/cart-ref/' + ref); last = r.status; if (r.status === 200) return { status: 200, body: await r.json(), ms: Date.now() - t0 }; await new Promise((res) => setTimeout(res, 3000)); }
  return { status: last, body: null, ms: Date.now() - t0 };
}

try {
  // ── 1280: cabeçalho, coleções reais, busca e saída com carrinho ───────────────────────────────────────────────────────────────────────
  const d = await session({ width: 1280, height: 800 });
  await openProduct(d);
  const g0 = await geometry(d.page);
  check('[1280] navbar montada pelo Worker' + (REHEARSE ? ' (ENSAIO: loader local)' : ' PUBLICADO') + `: loader ${g0.loader}, header-nav ativa, 1 formulário de busca`, g0.loader === LOADER_VERSION && g0.features.includes('header-nav') && await d.page.locator('#o-nav-search').count() === 1, JSON.stringify({ loader: g0.loader, features: g0.features }));
  check('[1280] cabeçalho sem sobreposição, pesquisa nativa escondida, conta e carrinho nativos visíveis', !g0.overlap && g0.nativeSearchHidden && g0.cartVisible && await d.page.locator('.menu-icons #menu-user-link, .menu-icons .menu-user').count() > 0, JSON.stringify(g0));
  await d.page.screenshot({ path: OUT + 'cabecalho-1280.png', clip: { x: 0, y: 0, width: 1280, height: 200 } });
  const links = await d.page.$$eval('[data-origens-nav="desktop"] .o-nav-links a, .o-nav-pop a', (as) => as.map((a) => ({ text: a.textContent, href: a.getAttribute('href') })));
  const collections = links.filter((l) => l.href && l.href.startsWith('/usesul/collections/'));
  check('[1280] coleções do CMS presentes, logo e "Cidades" apontam para o storefront', collections.length >= (REHEARSE ? 3 : 0) && await d.page.locator('.o-nav-logo').first().getAttribute('href') === SF + '/sul' && links.some((l) => l.text === 'Cidades' && l.href === SF + '/sul#estados'), JSON.stringify(collections.map((c) => c.href)));
  const statuses = []; for (const c of collections.slice(0, 8)) statuses.push((await fetch(HOST + c.href, { redirect: 'manual' })).status);
  check('[1280] cada coleção da navbar tem página pública na INK (200)', statuses.every((x) => x === 200), statuses.join(','));
  if (!REHEARSE) {
    const cfg = await (await fetch(HOST + '/__origens/navbar')).json(); const sf = await (await fetch(SF + '/api/navbar/sul')).json();
    check('[1280] a lista do Worker é a do storefront (mesma fonte) e o DOM a mostra na mesma ordem', JSON.stringify(cfg.collections) === JSON.stringify(sf.collections) && JSON.stringify(collections.map((c) => c.href)) === JSON.stringify(cfg.collections.map((c) => '/usesul/collections/' + c.slug)));
  }
  const more = d.page.locator('.o-nav-more summary');
  if (await more.count()) { await more.click(); check('[1280] "Mais" abre e lista o resto das coleções', await d.page.locator('.o-nav-pop a').first().isVisible()); await d.page.keyboard.press('Escape'); }

  // Navegação Turbo (a INK é um app Turbo): produto → outro produto → página que não é produto → produto. Um único cabeçalho nosso, nunca duplicado.
  const turbo = async (path) => { const ok = await d.page.evaluate((p) => { if (!window.Turbo) return false; window.Turbo.visit(p); return true; }, path); await wait(d.page, 3500); return ok; };
  const nav = () => d.page.evaluate(() => ({ desktop: document.querySelectorAll('[data-origens-nav="desktop"]').length, forms: document.querySelectorAll('#o-nav-search').length, any: document.querySelectorAll('[data-origens-nav]').length, path: location.pathname }));
  if (await turbo('/usesul/product/serra-catarinense')) {
    const a = await nav(); check('[1280] Turbo produto → produto: exatamente um cabeçalho nosso (sem duplicar)', a.path.endsWith('serra-catarinense') && a.desktop === 1 && a.forms === 1, JSON.stringify(a));
    await turbo('/usesul/about'); const b = await nav(); check('[1280] Turbo para página que não é produto: nada nosso fica e o cabeçalho nativo é o da INK', b.any === 0 && await d.page.locator('nav.navbar:not([data-controller]) > ul.navbar-list').first().isVisible(), JSON.stringify(b));
    await turbo(PRODUCT);
    // No ENSAIO o loader local só existe na página em que foi injetado: se a INK fez uma carga completa (comum entre tipos de página), reinjeta como o Worker faria.
    if (REHEARSE && !(await d.page.evaluate(() => !!(window.__useOrigens && window.__useOrigens.features.includes('header-nav'))))) { await d.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 }); await d.page.evaluate(() => { delete window.__useOrigensLoader; delete window.__useOrigens; }); await d.page.addScriptTag({ content: buildLoaderSource([], ['header-nav', 'cart-mirror'], 'product-catalog') }); await wait(d.page, 2500); }
    const c = await nav(); check('[1280] Turbo de volta ao produto: monta de novo, uma vez', c.desktop === 1 && c.forms === 1, JSON.stringify(c));
  } else check('[1280] Turbo disponível na página da INK', false);

  // carrinho anônimo com 1 item (sem compra) e a página recarregada com o carrinho
  await acceptNotice(d.page); await addToCart(d.page);
  await openProduct(d); await wait(d.page, 2500);
  const ourBefore = d.ours.length; const postsBefore = d.posts.length;
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click();
  await d.page.keyboard.type('chimarrao', { delay: 60 }); await wait(d.page, 800);
  await d.page.keyboard.press('Escape'); await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click(); await d.page.keyboard.press('Escape');
  check('[1280] abrir, digitar e fechar a lupa: 0 requisições nossas e 0 POST/KV', d.ours.length === ourBefore && d.posts.length === postsBefore, d.ours.slice(ourBefore).join(','));
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click(); await d.page.fill('#o-nav-q', '   '); await d.page.keyboard.press('Enter'); await wait(d.page, 300);
  check('[1280] busca vazia/só espaços não navega e não grava nada', d.page.url().startsWith(HOST) && d.posts.length === postsBefore);
  await d.page.fill('#o-nav-q', 'chimarrao');
  const t0 = Date.now(); await d.page.keyboard.press('Enter');
  await d.page.waitForURL((u) => u.hostname === 'useorigens.com.br', { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
  await d.page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}); await wait(d.page, 1500);
  const sfReq = d.sfDocs.find((u) => /\/sul\/busca/.test(u)); const sfUrl = sfReq ? new URL(sfReq) : null;
  const ref = sfUrl && sfUrl.searchParams.get('cart_ref');
  check('[1280] Enter → useorigens.com.br/sul/busca?q=chimarrao COM cart_ref (e a navegação não esperou mais que o limite seguro)', !!sfUrl && sfUrl.pathname === '/sul/busca' && sfUrl.searchParams.get('q') === 'chimarrao' && REF_RE.test(ref || '') && Date.now() - t0 < 12000, sfReq && sfReq.replace(/cart_ref=[^&]+/, 'cart_ref=<ref>'));
  check('[1280] exatamente UM POST de cart-ref na saída (nada ao digitar/abrir/fechar)', d.posts.length - postsBefore === 1, `${d.posts.length - postsBefore} POST(s)`);
  if (!REHEARSE) {
    const stored = await readRef(ref);
    check('[1280] o token é VERDADEIRO: o servidor devolve o resumo do carrinho (1 item) — leitura como o storefront faz', stored.status === 200 && stored.body && stored.body.count === 1 && stored.body.items.length === 1, `status ${stored.status} após ${stored.ms} ms`);
    const title = await d.page.locator('h1').first().textContent().catch(() => '');
    const cards = await d.page.locator('main ul li').count();
    check('[1280] a página de resultados do storefront respondeu com produtos reais', /Buscar estampas/i.test(title || '') && cards >= 1, `h1 "${title}", ${cards} cards`);
    await d.page.screenshot({ path: OUT + 'resultados-1280.png' });
  }
  // logo com o carrinho INALTERADO: reaproveita o token (0 novo POST)
  await openProduct(d); await wait(d.page, 2500);
  const p1 = d.posts.length; d.sfDocs.length = 0;
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-logo').click({ noWaitAfter: true });
  await d.page.waitForURL((u) => u.hostname === 'useorigens.com.br', { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
  const logoUrl = d.sfDocs[0] ? new URL(d.sfDocs[0]) : null;
  check('[1280] logo → /sul reaproveita o MESMO token (carrinho inalterado: 0 novo POST)', !!logoUrl && logoUrl.pathname === '/sul' && logoUrl.searchParams.get('cart_ref') === ref && d.posts.length === p1, logoUrl && logoUrl.pathname);
  // volta à INK: drawer nativo e "Finalizar compra" acessíveis (nunca clicado)
  await openProduct(d); await wait(d.page, 2500);
  await d.page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); });
  await d.page.waitForSelector('.cart-drawer.open', { timeout: 20000 }); await wait(d.page, 800);
  const checkout = await d.page.evaluate(() => { const el = [...document.querySelectorAll('.cart-drawer a, .cart-drawer button')].find((e) => /finalizar compra/i.test(e.textContent || '')); if (!el) return { found: false }; const r = el.getBoundingClientRect(); return { found: true, visible: r.width > 0 && r.height > 0, enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true', covered: !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) && !el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
  check('[1280] drawer nativo abre e "Finalizar compra" está visível, habilitado e descoberto (não clicado)', checkout.found && checkout.visible && checkout.enabled && !checkout.covered, JSON.stringify(checkout));
  await d.page.screenshot({ path: OUT + 'drawer-1280.png' });
  await d.ctx.close();

  // ── 390 e 320: cabeçalho, busca e menu lateral ────────────────────────────────────────────────────────────────────────────────────────
  for (const [w, vp] of [['390', { width: 390, height: 844 }], ['320', { width: 320, height: 640 }], ['500', { width: 500, height: 800 }]]) {
    const m = await session(vp); await openProduct(m);
    const base = await m.page.evaluate(() => document.documentElement.scrollWidth); const g = await geometry(m.page);
    check(`[${w}] header montado, sem sobreposição, pesquisa nativa escondida, carrinho nativo, sem overflow novo (${g.sw})`, g.features.includes('header-nav') && !g.overlap && g.nativeSearchHidden && g.cartVisible, JSON.stringify(g));
    await m.page.screenshot({ path: OUT + `cabecalho-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 200 } });
    const before = m.ours.length; await m.page.locator('.navbar__top .o-nav-lupa').click(); await m.page.keyboard.type('bah', { delay: 50 }); await wait(m.page, 500);
    const g2 = await geometry(m.page);
    check(`[${w}] busca abre abaixo da faixa, sem requisição ao digitar e sem overflow novo`, await m.page.locator('#o-nav-q').evaluate((e) => document.activeElement === e) && m.ours.length === before && !g2.overlap && g2.sw <= Math.max(base, g2.vw) + 1);
    await m.page.screenshot({ path: OUT + `busca-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 260 } });
    await m.page.keyboard.press('Escape'); await m.page.click('#menu-hamburger'); await wait(m.page, 500);
    const menu = await m.page.evaluate(() => { const list = document.getElementById('navbar-list-mobile'); const ours = document.querySelector('[data-origens-nav="menu"]'); const acct = list && [...list.querySelectorAll('a')].find((a) => /Entrar|Sair|Dashboard/i.test(a.textContent)); const b = (e) => e.getBoundingClientRect(); return { open: list.getClientRects().length > 0, searchClosed: document.getElementById('o-nav-search').hidden, ours: !!ours, clear: !ours || !acct || b(ours).bottom <= b(acct).top + 1 }; });
    check(`[${w}] menu lateral nativo abre (busca fechada), coleções no topo e sem sobrepor a conta`, menu.open && menu.searchClosed && menu.ours && menu.clear, JSON.stringify(menu));
    await m.page.screenshot({ path: OUT + `menu-${w}.png` });
    await m.ctx.close();
  }
} catch (e) {
  check('roteiro concluído sem exceção', false, e && e.message);
}
await browser.close();
writeFileSync(OUT + 'resultado.json', JSON.stringify({ mode: REHEARSE ? 'rehearse' : 'live', at: new Date().toISOString(), checks: results.length, passed: results.filter(Boolean).length, failures }, null, 1));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks (${REHEARSE ? 'ENSAIO' : 'AO VIVO'})`);
process.exit(results.length > 0 && failures.length === 0 ? 0 : 1);
