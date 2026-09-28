#!/usr/bin/env node
// QA em NAVEGADOR REAL de UMA loja (norte|centro) contra as páginas REAIS da INK dela. Só os cenários críticos (sem stress).
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-store.mjs <norte|centro> --local-worker   ENSAIO FIEL: Worker local (Miniflare, KV local) na frente da INK REAL;
//                                                                                                  o HTML de produto passa pelo Worker (mesma tag, mesmo Turbo do real)
//   PW_PATH=... node scripts/qa-store.mjs <norte|centro> --live [--shell]   (--shell: as páginas de casca também são cobertas: início, listagem, coleção, sobre, rastreio)
//   PW_PATH=... node scripts/qa-store.mjs <norte|centro> --live                                     AO VIVO (depois do deploy): Worker PUBLICADO, POST de cart-ref e KV VERDADEIROS
// Opções: --out <dir> (evidências)  --viewports 1280,390,320  --only <nome>  --no-cart (pula o fluxo de carrinho)
// Sessão ANÔNIMA descartável por viewport. NÃO faz compra: adiciona UM item ao carrinho anônimo, abre o drawer, confere que "Finalizar compra" está visível e habilitado
// (nunca clica) e remove o item no fim. Bloqueia as tags de analytics. Nunca imprime cookies, tokens de carrinho nem conteúdo de carrinho (só contagens e o formato do token).
// Exit 0 = tudo PASS. As falhas são CLASSIFICADAS: [Worker] [INK] [Storefront] [QA].
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildLoaderSource, LOADER_VERSION } from '../src/loader-source.js';
import { STORES } from '../src/stores.js';
import { shellPageKind } from '../src/scope.js';
import { STORE_FEATURES } from './lib/store-lib.mjs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const storeId = argv[0];
if (!['norte', 'centro'].includes(storeId)) { console.error('uso: node scripts/qa-store.mjs <norte|centro> (--local-worker|--live)'); process.exit(2); }
const LIVE = argv.includes('--live'); const LOCALW = argv.includes('--local-worker'); const SHELL = argv.includes('--shell');
if (LIVE === LOCALW) { console.error('escolha exatamente um: --local-worker ou --live'); process.exit(2); }
const opt = (n, d) => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : d; };
const store = STORES[storeId];
const SAMPLES = JSON.parse(readFileSync(new URL('./store-samples.json', import.meta.url), 'utf8'))[storeId];
const OUT = (opt('--out', new URL(`../docs/evidence/norte-centro/${storeId}-${LIVE ? 'live' : 'local'}/`, import.meta.url).pathname) + '/').replace(/\/+$/, '/'); mkdirSync(OUT, { recursive: true });
const VIEWPORTS = opt('--viewports', '1280,390,320').split(',').map(Number).filter(Boolean);
const HOST = 'https://' + store.inkHost; const HOME = store.storefront + store.storefrontBase;
const P0 = SAMPLES.allowlist[0]; const P1 = SAMPLES.allowlist[1];
const REF_RE = /^[A-Za-z0-9_-]{22}$/;
// Literais de OUTRAS lojas/regiões que nunca podem aparecer no que é nosso (host da INK, prefixo, base do storefront, GA4).
const FOREIGN = Object.values(STORES).filter((x) => x.id !== store.id).flatMap((x) => [x.inkHost, x.inkBase + '/', 'useorigens.com.br' + x.storefrontBase + '/', 'useorigens.com.br' + x.storefrontBase + '"', x.ga]);
const results = []; const failures = [];
const check = (name, ok, detail = '', cls = 'Worker') => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300), cls }); if (!ok) failures.push(`[${cls}] ${name}`); console.log((ok ? 'PASS ' : 'FAIL ') + (ok ? '' : `[${cls}] `) + name + (detail ? '  — ' + String(detail).slice(0, 300) : '')); };
const info = (n) => console.log('INFO ' + n);
process.on('unhandledRejection', (e) => info('rejeição não tratada: ' + String(e && e.message).split('\n')[0]));
const wait = (page, ms) => page.waitForTimeout(ms);

let mf = null; const upstreamInk = { html: '', status: 200 };
if (LOCALW) {
  const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
  const { workerModules } = await import('../test/helpers.js');
  mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: [store.kvBinding],
    bindings: { STORE_ID: storeId, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: SAMPLES.allowlist.join(','), WIDGET_FEATURES: STORE_FEATURES.join(',') },
    // A INK é a página real (buscada pelo navegador); o storefront de PRODUÇÃO responde a navbar e o índice de cidades (o gateway lê os mesmos endpoints do real).
    outboundService: async (req) => (new URL(req.url).host === 'useorigens.com.br' ? fetch(req.url, { headers: { accept: 'application/json' } }) : new Response(upstreamInk.html, { status: upstreamInk.status, headers: { 'content-type': 'text/html; charset=utf-8' } }))
  });
}
const health = async () => (LOCALW ? (await mf.dispatchFetch(HOST + '/__origens/health')).json() : (await fetch(HOST + '/__origens/health')).json());
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });

async function session(width) {
  const height = width >= 1024 ? 900 : (width < 360 ? 640 : 844);
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', ...(width < 768 ? { deviceScaleFactor: 2, hasTouch: true } : {}) });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms/, (r) => r.abort());
  const page = await ctx.newPage();
  const s = { ctx, page, width, height, ours: [], posts: 0, storefrontDocs: [], errors: [] };
  page.on('console', (m) => { if (m.type() === 'error') s.errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => s.errors.push(String(e.message).slice(0, 140)));
  ctx.on('requestfinished', async (req) => { const u = new URL(req.url()); if (req.method() === 'POST' && u.pathname === '/__origens/cart-ref') { const t = req.timing(); s.postMs = Math.round((t.responseEnd > 0 ? t.responseEnd : 0) - Math.max(0, t.requestStart)); } });
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host === store.inkHost && u.pathname.startsWith('/__origens/')) { s.ours.push(req.method() + ' ' + u.pathname); if (req.method() === 'POST' && u.pathname === '/__origens/cart-ref') s.posts++; }
    if (u.host === 'useorigens.com.br' && req.resourceType() === 'document') { s.storefrontDocs.push(u.pathname); s.lastStorefrontUrl = req.url(); } // o storefront tira o cart_ref da barra de endereço logo ao carregar: lê-se o token do PEDIDO
  });
  if (LOCALW) {
    await page.route('**/__origens/**', async (route) => {
      const req = route.request(); const url = new URL(req.url()); const h = req.headers();
      const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': h['content-type'] || '', origin: h['origin'] || '', referer: h['referer'] || '', 'sec-fetch-site': h['sec-fetch-site'] || '' }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    // O HTML de produto passa pelo Worker de verdade (mesma reescrita do HTMLRewriter de produção).
    await page.route((u) => u.host === store.inkHost && (new RegExp('^' + store.inkBase + '/product/[^/]+$').test(u.pathname) || (SHELL && shellPageKind(u.pathname, store.inkBase) !== null)), async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      try {
        const res = await route.fetch({ maxRedirects: 0, timeout: 60000 });
        if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
        upstreamInk.html = await res.text(); upstreamInk.status = res.status();
        const out = await mf.dispatchFetch(route.request().url()); await route.fulfill({ response: res, body: await out.text() });
      } catch (e) { info('INK instável ao buscar o HTML de produto (' + String(e.message).split('\n')[0] + '): a página segue nativa nesta tentativa'); await route.continue().catch(() => {}); }
    });
  }
  return s;
}
async function open(s, path, { attempts = 2, mount = true } = {}) {
  for (let n = 1; n <= attempts; n++) {
    try {
      await s.page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
      break;
    } catch (e) { if (n === attempts) throw e; info(`navegação para ${path} falhou (${String(e.message).split('\n')[0]}); nova tentativa ${n + 1}/${attempts}`); await wait(s.page, 2000); }
  }
  if (mount) await s.page.waitForSelector('header [data-origens-nav]', { timeout: 25000 }).catch(() => {});
  await wait(s.page, 800);
}
const shot = (s, name) => s.page.screenshot({ path: `${OUT}${name}-${s.width}.png` }).catch(() => {});
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible().catch(() => false)) { await n.first().click().catch(() => {}); await wait(page, 300); } };
const state = (page) => page.evaluate(({ base }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const ours = [...document.querySelectorAll('[data-origens-nav], [data-origens-discovery], #o-wa-fab, #use-origens-return-link')];
  return {
    loaderTags: document.querySelectorAll('script[src*="/__origens/loader.js"]').length, loaderVersion: window.__useOrigensLoader || null, features: window.__useOrigens ? window.__useOrigens.features : null,
    oursOverflow: ours.filter((e) => vis(e)).map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width > 0 && (b.right > document.documentElement.clientWidth + 1 || b.left < -1)).map(({ e, b }) => (e.id || e.getAttribute('data-origens-nav') || e.getAttribute('data-origens-discovery') || e.tagName) + ' [' + Math.round(b.left) + ',' + Math.round(b.right) + ']'),
    navHeaders: document.querySelectorAll('[data-origens-nav="desktop"], .navbar__top [data-origens-nav]').length, navMounted: !!document.querySelector('header [data-origens-nav]'),
    logoHref: (document.querySelector('a.o-nav-logo') || {}).href || null, oursHtml: ours.map((e) => e.outerHTML).join('\n'), forms: document.querySelectorAll('#o-nav-search').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, discoveryRoots: document.querySelectorAll('[data-origens-discovery]').length, path: location.pathname, host: location.host,
    styleTags: document.querySelectorAll('style[data-origens-nav="style"]').length, hasProductForm: !!document.querySelector('form[id^="form-product-"]'), visLupa: [...document.querySelectorAll('.o-nav-lupa')].filter(vis).length
  };
}, { base: store.inkBase });

// Seleção genérica de variantes (o modelo da INK é o mesmo nas lojas): tenta combinações até o product_variant_id ficar > 0.
async function selectVariants(page) {
  await page.waitForFunction(() => !!document.querySelector('form[id^="form-product-"] input[type=radio]'), null, { timeout: 30000 });
  const attempt = async (pick) => page.evaluate((pickIndex) => {
    const form = [...document.querySelectorAll('form[id^="form-product-"]')].find((f) => f.getClientRects().length > 0) || document.querySelector('form[id^="form-product-"]');
    const groups = ['style', 'color', 'size'].map((n) => [...form.querySelectorAll('input[type=radio][name="' + n + '"]')].filter((r) => !r.disabled));
    groups.forEach((radios, gi) => { if (!radios.length) return; const r = radios[gi === 2 ? pickIndex % radios.length : (pickIndex >> 1) % radios.length]; const label = form.querySelector('label[for="' + r.id + '"]'); (label || r).click(); });
    const input = form.querySelector('input[name="product_variant_id"]'); return input ? Number(input.value) : -1;
  }, pick);
  for (let i = 0; i < 12; i++) { await attempt(i); await wait(page, 500); const v = await page.evaluate(() => { const f = [...document.querySelectorAll('form[id^="form-product-"]')].find((x) => x.getClientRects().length > 0) || document.querySelector('form[id^="form-product-"]'); const inp = f && f.querySelector('input[name="product_variant_id"]'); return inp ? Number(inp.value) : -1; }); if (v > 0) return true; }
  return false;
}
const clickAdd = (page, mobile) => page.evaluate((m) => { const btn = [...document.querySelectorAll(m ? '#add-to-cart-mob, #add-to-cart-desk' : '#add-to-cart-desk, #add-to-cart-mob')].find((b) => b.getClientRects().length > 0) || document.querySelector('#add-to-cart-desk'); if (btn) btn.click(); return !!btn; }, mobile);
const cartGeometry = (page) => page.evaluate(() => {
  const btn = document.getElementById('checkout-btn'); const drawer = document.querySelector('.cart-drawer');
  const r = btn ? btn.getBoundingClientRect() : null;
  const mid = r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
  const top = mid ? document.elementFromPoint(mid.x, mid.y) : null;
  const ours = [...document.querySelectorAll('[data-origens-nav], #o-wa-fab, [data-origens-discovery]')].filter((e) => e.getClientRects().length > 0 && !(drawer && drawer.contains(e)));
  // "Encobre" = algo NOSSO é o elemento do topo em algum ponto do botão (centro e quatro cantos internos). Elementos nossos atrás do overlay do drawer não contam.
  const points = r ? [[0.5, 0.5], [0.1, 0.2], [0.9, 0.2], [0.1, 0.8], [0.9, 0.8]].map(([fx, fy]) => document.elementFromPoint(Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy))) : [];
  const inter = points.filter((el) => el && el.closest('[data-origens-nav], [data-origens-discovery], #o-wa-fab, #use-origens-return-link') && !(drawer && drawer.contains(el))).map((el) => el.tagName + '.' + String(el.className).slice(0, 30));
  return { open: !!(drawer && drawer.classList.contains('open')), btn: !!btn, text: btn ? btn.textContent.trim() : null, enabled: !!btn && !btn.disabled, visible: !!r && r.top >= 0 && r.bottom <= innerHeight && r.height > 0 && r.left >= 0 && r.right <= innerWidth, covered: !!top && !(btn && (top === btn || btn.contains(top))), overlapsOurs: inter, items: document.querySelectorAll('turbo-frame#cart li.main-list__item').length, rootInDrawer: document.querySelectorAll('.cart-drawer [data-origens-discovery="cart"]').length };
});

async function viewportPass(width) {
  const mobile = width < 768; const tag = `${storeId} ${width}px`;
  const s = await session(width);
  try {
    // ── 1. produto real: loader único, identidade da loja, sem nada de outra loja ─────────────────────────────────────────────────────────────
    await open(s, P0); await acceptNotice(s.page);
    let st = await state(s.page);
    check(`${tag}: produto real ${P0.slice(-28)} → 1 loader (v${LOADER_VERSION}) e a navbar montada`, st.loaderTags === 1 && st.loaderVersion === LOADER_VERSION && st.navMounted && st.navHeaders >= 1, JSON.stringify({ tags: st.loaderTags, v: st.loaderVersion, nav: st.navMounted, headers: st.navHeaders }));
    check(`${tag}: as ${STORE_FEATURES.length} features do Worker da loja chegaram ao navegador`, Array.isArray(st.features) && JSON.stringify(st.features) === JSON.stringify(STORE_FEATURES), JSON.stringify(st.features));
    check(`${tag}: identidade — logo/Cidades/estados levam a ${store.storefrontBase} no storefront; nada de outra loja/região no que é nosso`, st.logoHref === HOME && FOREIGN.every((f) => !st.oursHtml.includes(f)) && st.oursHtml.includes(HOME + '/' + store.ufs[0].toLowerCase()), JSON.stringify({ logo: st.logoHref, foreignFound: FOREIGN.filter((f) => st.oursHtml.includes(f)) }));
    // O scrollWidth da INK NATIVA já passa da tela (drawer do carrinho fora da tela: +3 px em 390, +38 px em 320, medido SEM Worker nas três lojas): o que se confere é que NADA NOSSO ultrapassa a largura.
    check(`${tag}: nada nosso ultrapassa a largura da tela e sem duplicação (1 cabeçalho, 1 estilo, 1 formulário de busca)`, st.oursOverflow.length === 0 && st.styleTags === 1 && st.forms === 1, JSON.stringify({ oursOverflow: st.oursOverflow, pageOverflowNativoIncluido: st.overflowX, styles: st.styleTags, forms: st.forms }));
    const opened = s.ours.slice();
    check(`${tag}: requisições nossas por abertura de produto (loader + navbar; busca só se o visitante buscar)`, opened.filter((x) => x.includes('/loader.js')).length <= 1 && opened.filter((x) => x.includes('/navbar')).length <= 1 && !opened.some((x) => x.includes('/search') || x.includes('cart-ref')), opened.join(' | '));
    await shot(s, 'produto');

    // ── 2. digitar / abrir menu: nenhuma requisição, nenhuma escrita no KV ────────────────────────────────────────────────────────────────────
    const h0 = await health(); const postsAtStart = s.posts; const reqBefore = s.ours.length; const docsBefore = s.storefrontDocs.length;
    const lupa = s.page.locator('.o-nav-lupa:visible').first();
    await lupa.click(); await s.page.locator('#o-nav-q').waitFor({ state: 'visible', timeout: 5000 });
    await s.page.locator('#o-nav-q').pressSequentially(SAMPLES.search.query, { delay: 60 }); await wait(s.page, 1200);
    check(`${tag}: digitar na busca não faz nenhuma requisição (nem storefront, nem Worker) e não grava carrinho`, s.ours.length === reqBefore && s.storefrontDocs.length === docsBefore && s.posts === 0, `ours +${s.ours.length - reqBefore}, posts ${s.posts}`);
    await shot(s, 'busca-aberta');
    // ── 3. Enter → resultados no storefront DA MESMA loja ─────────────────────────────────────────────────────────────────────────────────────
    await Promise.all([s.page.waitForURL((u) => u.host === 'useorigens.com.br', { timeout: 30000 }), s.page.locator('#o-nav-q').press('Enter')]);
    const dest = new URL(s.page.url());
    check(`${tag}: Enter leva a ${store.storefrontBase}/busca?q=${SAMPLES.search.query} (sem cart_ref: carrinho vazio)`, dest.origin + dest.pathname === HOME + '/busca' && dest.searchParams.get('q') === SAMPLES.search.query && !dest.searchParams.has('cart_ref'), dest.pathname + dest.search);
    await s.page.waitForLoadState('domcontentloaded'); await wait(s.page, 1500);
    const body = (await s.page.locator('body').innerText()).slice(0, 4000);
    check(`${tag}: a busca do storefront da região respondeu (produtos ou "nenhum") e o título é do storefront`, /produto|Nenhum/i.test(body) && (await s.page.title()).length > 0, body.slice(0, 80).replace(/\s+/g, ' '), 'Storefront');
    await shot(s, 'storefront-busca');
    await open(s, P0);
    const h1 = await health();
    // Testemunha das escritas no KV: o ÚNICO caminho é o POST /__origens/cart-ref, observado no navegador (zero POST em abertura, digitação, busca e menu).
    // O contador do health é POR ISOLATE: ao vivo, duas leituras podem cair em isolates diferentes (0→1→0), então só vale como prova no Worker local (um único isolate).
    check(`${tag}: zero escritas no KV por abertura, digitação e abertura da busca (nenhum POST cart-ref; contador do Worker${LOCALW ? '' : ' só informativo ao vivo: por isolate'})`, s.posts === postsAtStart && (!LOCALW || (h1.cart_ref_stats && h1.cart_ref_stats.writes) === (h0.cart_ref_stats && h0.cart_ref_stats.writes)), JSON.stringify({ posts: s.posts - postsAtStart, counterBefore: h0.cart_ref_stats && h0.cart_ref_stats.writes, counterAfter: h1.cart_ref_stats && h1.cart_ref_stats.writes }));

    // ── 4. menu (desktop: Regiões; mobile: hambúrguer) sem requisição ─────────────────────────────────────────────────────────────────────────
    const before = s.ours.length;
    if (mobile) { await s.page.locator('#menu-hamburger').click({ timeout: 5000 }).catch(() => {}); } else { await s.page.locator('[data-origens-nav="desktop"] [data-dd="regioes"] button').first().click({ timeout: 5000 }).catch(() => {}); }
    await wait(s.page, 800); await shot(s, 'menu');
    const menuLinks = await s.page.evaluate(() => [...document.querySelectorAll('[data-origens-nav] a[href]')].map((a) => a.href));
    check(`${tag}: abrir o menu não faz requisição e os links de região são da loja`, s.ours.length === before && store.ufs.every((uf) => menuLinks.includes(HOME + '/' + uf.toLowerCase())), `requests +${s.ours.length - before}`);
    await s.page.keyboard.press('Escape').catch(() => {});
    if (argv.includes('--no-cart')) return;

    // ── 5. carrinho nativo: variantes → adicionar → Finalizar compra íntegro ──────────────────────────────────────────────────────────────────
    await open(s, P0); await acceptNotice(s.page);
    await s.page.evaluate(() => document.querySelector('#add-to-cart-desk, #add-to-cart-mob')?.scrollIntoView({ block: 'center' }));
    const variant = await selectVariants(s.page);
    check(`${tag}: variantes nativas selecionáveis (product_variant_id > 0)`, variant, '', 'INK');
    if (!variant) return;
    check(`${tag}: "Adicionar ao carrinho" nativo encontrado`, await clickAdd(s.page, mobile), '', 'INK');
    const postAdd = await s.page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 25000 }).then(() => true).catch(() => false);
    check(`${tag}: o modal nativo "Produto adicionado" abriu (INK)`, postAdd, '', 'INK'); if (!postAdd) return;
    await wait(s.page, 1500);
    const block = await s.page.evaluate((home) => { const r = document.querySelector('#modal-wrapper [data-origens-discovery="post-add"]'); return r ? { cta: (r.querySelector('.o-cta') || {}).href || null, native: !!document.querySelector('#modal-wrapper .checkout-btn') && !!document.querySelector('#continue-shopping-button') } : null; }, HOME);
    check(`${tag}: bloco pós-adição montado uma vez, CTA para ${store.storefrontBase}; botões nativos intactos`, !!block && block.cta === HOME && block.native, JSON.stringify(block));
    await shot(s, 'pos-adicao');
    await s.page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click());
    await s.page.waitForSelector('.cart-drawer.open', { timeout: 15000 }); await s.page.waitForSelector('#checkout-btn', { timeout: 15000 }).catch(() => {}); await wait(s.page, 1200);
    const g = await cartGeometry(s.page);
    check(`${tag}: drawer do carrinho — "Finalizar compra" visível, habilitado, não coberto, e a navbar/descoberta não o encobrem`, g.open && g.btn && /Finalizar compra/i.test(g.text || '') && g.enabled && g.visible && !g.covered && g.overlapsOurs.length === 0, JSON.stringify(g));
    check(`${tag}: bloco de descoberta do carrinho no drawer (1) e itens nativos presentes`, g.rootInDrawer === 1 && g.items >= 1, `blocos ${g.rootInDrawer}, itens ${g.items}`);
    await shot(s, 'carrinho');

    // ── 6. sair para o storefront COM cart_ref (uma escrita), voltar ao carrinho nativo da MESMA loja ─────────────────────────────────────────
    const postsBefore = s.posts;
    const cta = s.page.locator('.cart-drawer [data-origens-discovery="cart"] .o-cta').first();
    const usingCta = await cta.count() > 0 && await cta.isVisible().catch(() => false);
    await Promise.all([s.page.waitForURL((u) => u.host === 'useorigens.com.br', { timeout: 30000 }), (usingCta ? cta : s.page.locator('a.o-nav-logo:visible').first()).click()]);
    const out = new URL(s.lastStorefrontUrl || s.page.url()); const ref = out.searchParams.get('cart_ref');
    check(`${tag}: saída ${usingCta ? '"Explorar todas as estampas"' : 'logo'} → ${store.storefrontBase} com cart_ref válido; exatamente UMA escrita (${s.posts - postsBefore})`, out.origin + out.pathname === HOME && REF_RE.test(ref || '') && s.posts - postsBefore === 1, out.pathname + ' ref=' + (REF_RE.test(ref || '') ? '<22 chars ok>' : 'AUSENTE') + ' posts=' + (s.posts - postsBefore) + ' POST≈' + (s.postMs ?? '?') + 'ms (teto de espera da saída: 1200 ms)');
    if (ref) {
      const worker = LOCALW ? await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref) : await fetch(HOST + '/__origens/cart-ref/' + ref);
      const snap = await worker.json().catch(() => ({}));
      check(`${tag}: o Worker da loja devolve o resumo do carrinho (itens ${Array.isArray(snap.items) ? snap.items.length : '-'}) só para o token da PRÓPRIA loja`, worker.status === 200 && Array.isArray(snap.items) && snap.items.length >= 1 && !('store' in snap), 'status ' + worker.status);
      for (const other of Object.values(STORES).filter((x) => x.id !== storeId)) {
        const r = await fetch('https://' + other.inkHost + '/__origens/cart-ref/' + ref).then((x) => x.status).catch(() => 'erro');
        check(`${tag}: o mesmo token NÃO existe em ${other.inkHost} (${r})`, r !== 200, 'HTTP ' + r);
      }
      await wait(s.page, 2500);
      const trigger = s.page.locator('[data-testid="cart-mirror-trigger"]').first();
      const mirror = await trigger.isVisible().catch(() => false);
      check(`${tag}: storefront regional reconheceu o token (Meu carrinho visível) — exige o storefront com o espelho REGIONAL`, mirror, mirror ? '' : 'sem "Meu carrinho": o storefront em produção ainda consulta só o Worker da Sul (PR regional pendente)', 'Storefront');
      if (mirror) {
        await trigger.click(); await s.page.waitForSelector('[data-testid="cart-mirror-item"]', { timeout: 10000 }).catch(() => {});
        const items = await s.page.locator('[data-testid="cart-mirror-item"]').count();
        const goHref = await s.page.locator('[data-testid="cart-mirror-go"]').getAttribute('href').catch(() => null);
        check(`${tag}: "Meu carrinho" mostra os itens da INK da loja (${items}) e "Ir para meu carrinho" volta à INK DESTA loja`, items >= 1 && !!goHref && new URL(goHref).host === store.inkHost && new URL(goHref).pathname.startsWith(store.inkBase + '/product/') && new URL(goHref).searchParams.get('origens_open_cart') === '1', goHref ? new URL(goHref).host + new URL(goHref).pathname : 'sem link', 'Storefront');
        await shot(s, 'storefront-meu-carrinho');
        if (goHref) {
          await Promise.all([s.page.waitForURL((u) => u.host === store.inkHost, { timeout: 30000 }), s.page.locator('[data-testid="cart-mirror-go"]').click()]);
          await s.page.waitForSelector('.cart-drawer.open', { timeout: 20000 }).catch(() => {}); await wait(s.page, 1500);
          const back = await cartGeometry(s.page);
          check(`${tag}: de volta à INK: drawer NATIVO aberto com os itens preservados e "Finalizar compra" íntegro`, back.open && back.items >= 1 && back.enabled && /Finalizar compra/i.test(back.text || ''), JSON.stringify({ open: back.open, items: back.items }), 'INK');
          await shot(s, 'volta-carrinho');
        }
      }
    }
    // ── limpeza: esvazia o carrinho ANÔNIMO de teste ──────────────────────────────────────────────────────────────────────────────────────────
    await open(s, P0, { mount: false });
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); if (b) b.click(); }); await wait(s.page, 1500);
    for (let i = 0; i < 4; i++) { const more = await s.page.evaluate(() => { const b = document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="decrement"]'); if (b) { b.click(); return true; } return false; }); if (!more) break; await wait(s.page, 1500); }
  } catch (e) {
    check(`${tag}: execução do QA sem exceção`, false, String(e.message).split('\n')[0], 'QA');
    await shot(s, 'erro');
  } finally {
    const ours = s.errors.filter((e) => /use.?origens|__origens|origens-/i.test(e));
    check(`${tag}: console sem erro atribuível ao nosso código`, ours.length === 0, ours.join(' | '));
    await s.ctx.close();
  }
}

// ── páginas de casca (só com --shell): início, listagem, coleção, sobre e rastreio recebem a navbar; login/carrinho não ────────────────────────────────────────────
async function shellPass(width) {
  const tag = `${storeId} casca ${width}px`; const s = await session(width); const b = store.inkBase;
  try {
    const pages = [['inicio', b], ['listagem', b + '/products'], ['colecao', `${b}/collections/${SAMPLES.collection}`], ['sobre', b + '/about'], ['rastreio', b + '/orders/trackings']];
    for (const [name, path] of pages) {
      await s.page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await s.page.waitForSelector('header [data-origens-nav]', { timeout: 25000 }).catch(() => {}); await wait(s.page, 1000);
      const st = await state(s.page);
      check(`${tag}: ${name} (${path.replace(b, '<base>') || '<base>'}) → 1 loader, navbar montada, logo → ${store.storefrontBase}, sem duplicar, nada nosso além da tela`, st.loaderTags === 1 && st.navMounted && st.logoHref === HOME && st.forms === 1 && st.styleTags === 1 && st.oursOverflow.length === 0 && FOREIGN.every((f) => !st.oursHtml.includes(f)), JSON.stringify({ tags: st.loaderTags, nav: st.navMounted, logo: st.logoHref, forms: st.forms, styles: st.styleTags, overflow: st.oursOverflow }));
      if (name === 'inicio' || name === 'colecao') await shot(s, 'casca-' + name);
    }
    // busca a partir de uma página de casca: Enter → storefront da MESMA região
    await s.page.goto(HOST + b, { waitUntil: 'domcontentloaded', timeout: 45000 }); await s.page.waitForSelector('header [data-origens-nav]', { timeout: 25000 }).catch(() => {}); await wait(s.page, 800);
    await s.page.locator('.o-nav-lupa:visible').first().click(); await s.page.locator('#o-nav-q').pressSequentially(SAMPLES.search.query, { delay: 50 });
    await Promise.all([s.page.waitForURL((u) => u.host === 'useorigens.com.br', { timeout: 30000 }), s.page.locator('#o-nav-q').press('Enter')]);
    const dest = new URL(s.page.url());
    check(`${tag}: busca a partir do início → ${store.storefrontBase}/busca?q=${SAMPLES.search.query}`, dest.origin + dest.pathname === HOME + '/busca' && dest.searchParams.get('q') === SAMPLES.search.query, dest.pathname + dest.search);
    // Turbo: produto → início → produto (sem duplicar) e início → login (nada nosso)
    await open(s, P0);
    await s.page.evaluate((p) => window.Turbo && window.Turbo.visit(p), b); await s.page.waitForURL('**' + b, { timeout: 20000 }).catch(() => {}); await wait(s.page, 2500);
    const t1 = await state(s.page); check(`${tag}: Turbo produto → início: 1 cabeçalho, 1 estilo, 1 busca`, t1.path === b && t1.navHeaders >= 1 && t1.styleTags === 1 && t1.forms === 1, JSON.stringify({ path: t1.path, styles: t1.styleTags, forms: t1.forms }));
    await s.page.evaluate((p) => window.Turbo && window.Turbo.visit(p), b + '/store_sessions/new'); await s.page.waitForURL('**/store_sessions/new*', { timeout: 20000 }).catch(() => {}); await wait(s.page, 2500);
    const t2 = await state(s.page); check(`${tag}: Turbo início → login: nada nosso fica na tela`, !t2.navMounted && t2.styleTags === 0, JSON.stringify({ nav: t2.navMounted, styles: t2.styleTags }));
    await s.page.goto(HOST + b + '/orders', { waitUntil: 'domcontentloaded', timeout: 45000 }); await wait(s.page, 1500);
    const t3 = await state(s.page); check(`${tag}: conta/pedidos sem sessão → redireciona ao login da INK e nada nosso fica (${t3.path})`, /store_sessions|login/.test(t3.path) && !t3.navMounted && t3.loaderTags === 0, t3.path);
  } catch (e) { check(`${tag}: execução do QA sem exceção`, false, String(e.message).split('\n')[0], 'QA'); await shot(s, 'erro-casca'); } finally { await s.ctx.close(); }
}

// ── negativos e rotas (independentes de viewport) ─────────────────────────────────────────────────────────────────────────────────────────────
async function negatives() {
  const s = await session(1280); const tag = `${storeId} negativos`;
  try {
    const st0 = await (async () => { await open(s, P0 + '?utm_source=qa&utm_medium=teste'); return state(s.page); })();
    check(`${tag}: produto com UTM → 1 loader e navbar`, st0.loaderTags === 1 && st0.navMounted, JSON.stringify({ tags: st0.loaderTags }));
    // barra final: a INK serve a página (200), o escopo é o do slug canônico → página NATIVA, sem loader (igual à Use Sul)
    await s.page.goto(HOST + P0 + '/', { waitUntil: 'domcontentloaded', timeout: 45000 }); await wait(s.page, 2500);
    const slash = await state(s.page);
    check(`${tag}: URL com barra final → página nativa da INK intacta (sem loader, sem navbar nossa)`, slash.hasProductForm && slash.loaderTags === 0 && !slash.navMounted, JSON.stringify({ tags: slash.loaderTags, nav: slash.navMounted }), 'INK');
    // slug inexistente
    const missing = await s.page.goto(HOST + store.inkBase + '/product/zz-nao-existe-qa-9x', { waitUntil: 'domcontentloaded', timeout: 45000 }); await wait(s.page, 1500);
    const ms = await state(s.page);
    check(`${tag}: slug inexistente → resposta da INK (${missing && missing.status()}) sem loader e sem nada nosso`, ms.loaderTags === 0 && !ms.navMounted, 'HTTP ' + (missing && missing.status()));
    // páginas transacionais e de casca: nada nosso
    // /orders SEM sessão é redirecionado pela INK ao login (a página que responde é a de login): nada nosso. /orders/trackings é pública e recebe a navbar.
    const covered = (path) => SHELL && shellPageKind(path, store.inkBase) !== null && path !== store.inkBase + '/orders';
    for (const path of [store.inkBase + '/cart', store.inkBase + '/store_sessions/new', store.inkBase + '/login', store.inkBase + '/checkout', store.inkBase + '/orders', store.inkBase, store.inkBase + '/products', store.inkBase + '/orders/trackings']) {
      const r = await s.page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      if (covered(path)) await s.page.waitForSelector('header [data-origens-nav]', { timeout: 20000 }).catch(() => {});
      await wait(s.page, 1200);
      const t = await state(s.page); const want = covered(path);
      check(`${tag}: ${path.replace(store.inkBase, '<base>') || '<base>'} → ${want ? 'casca COM a navbar (1 loader)' : 'nada nosso'} (loader ${t.loaderTags}, navbar ${t.navMounted}) [HTTP ${r && r.status()}]`, want ? (t.loaderTags === 1 && t.navMounted && t.forms === 1 && t.styleTags === 1) : (t.loaderTags === 0 && !t.navMounted && (r === null || r.status() < 500)));
    }
    // Turbo: produto → produto → página não coberta → volta; sem duplicar e sem restos
    await open(s, P0);
    await s.page.evaluate((p) => window.Turbo && window.Turbo.visit(p), P1); await s.page.waitForURL('**' + P1, { timeout: 20000 }).catch(() => {}); await wait(s.page, 2500);
    const t1 = await state(s.page);
    check(`${tag}: Turbo produto → produto: 1 cabeçalho, 1 estilo, 1 busca (sem duplicar)`, t1.path === P1 && t1.navHeaders >= 1 && t1.styleTags === 1 && t1.forms === 1, JSON.stringify({ path: t1.path, styles: t1.styleTags, forms: t1.forms }));
    const uncovered = SHELL ? store.inkBase + '/store_sessions/new' : store.inkBase + '/products';
    await s.page.evaluate((p) => window.Turbo && window.Turbo.visit(p), uncovered); await s.page.waitForURL('**' + uncovered, { timeout: 20000 }).catch(() => {}); await wait(s.page, 2500);
    const t2 = await state(s.page);
    check(`${tag}: Turbo para uma página não coberta → nada nosso fica na tela`, !t2.navMounted && t2.discoveryRoots === 0 && t2.styleTags === 0, JSON.stringify({ nav: t2.navMounted, styles: t2.styleTags }));
    await s.page.goBack().catch(() => {}); await wait(s.page, 3000);
    const t3 = await state(s.page);
    check(`${tag}: voltar ao produto remonta uma única vez`, t3.navHeaders >= 1 && t3.styleTags <= 1 && t3.forms <= 1, JSON.stringify({ styles: t3.styleTags, forms: t3.forms }));
    // outra loja: o Worker desta loja não espelha outro host
    for (const other of Object.values(STORES).filter((x) => x.id !== storeId)) {
      const r = await fetch('https://' + other.inkHost + other.inkBase + '/product/x').then(async (x) => ({ s: x.status, loader: (await x.text()).includes('/__origens/loader.js') })).catch(() => ({ s: 'erro', loader: false }));
      check(`${tag}: ${other.inkHost} não recebe o loader desta loja (HTTP ${r.s})`, !r.loader);
    }
  } catch (e) { check(`${tag}: execução do QA sem exceção`, false, String(e.message).split('\n')[0], 'QA'); await shot(s, 'erro-negativos'); } finally { await s.ctx.close(); }
}

// Aquece o KV local (a primeira escrita do workerd é lenta e passaria do teto de espera da saída, 1,2 s — em produção o KV responde em dezenas de ms).
if (LOCALW) await mf.dispatchFetch(HOST + '/__origens/cart-ref', { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST, referer: HOST + P0, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ v: 1, count: 0, items: [], subtotal: null, discount: null }) });
const h = await health().catch(() => null);
check(`health: Worker da loja no ar (${LIVE ? 'PRODUÇÃO' : 'local'}) com a identidade ${store.workerName}`, !!h && h.service === store.workerName && h.store === storeId && h.kv_bound === true && h.widget_mode === 'true' && h.shell_pages === SHELL, h ? JSON.stringify({ service: h.service, store: h.store, kv: h.kv_bound, mode: h.widget_mode, scope: h.scope_mode, shell: h.shell_pages, v: h.version }) : 'sem resposta (Worker/rotas ainda não publicados? DNS ainda sem proxy?)');
if (h && h.service === store.workerName) {
  for (const w of VIEWPORTS) await viewportPass(w);
  if (SHELL) for (const w of VIEWPORTS) await shellPass(w);
  await negatives();
}
await browser.close(); if (mf) await mf.dispose();
const pass = results.filter((r) => r.ok).length; const fail = results.length - pass;
writeFileSync(OUT + 'resultado.json', JSON.stringify({ when: new Date().toISOString(), store: storeId, mode: LIVE ? 'live' : 'local-worker', loader: LOADER_VERSION, pass, fail, failures, checks: results }, null, 1));
console.log(`RESUMO qa-store ${storeId} ${LIVE ? 'live' : 'local-worker'}: ${pass} PASS, ${fail} FAIL` + (fail ? '\n  ' + failures.join('\n  ') : ''));
process.exit(fail === 0 ? 0 : 1);
