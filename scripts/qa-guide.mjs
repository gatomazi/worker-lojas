#!/usr/bin/env node
// QA do guia da página de produto (pdp-guide) em NAVEGADOR REAL contra PDPs REAIS da INK, sem publicar nada:
//   PW_PATH=<dir com playwright-core> GUIDE_API=http://127.0.0.1:3100 node scripts/qa-guide.mjs [--out=<dir>] [--label=depois] [--stores=sul,norte,centro]
// Ensaio fiel (mesmo desenho de qa-pdp-extras.mjs): o HTML real de produto passa pelo Worker LOCAL (Miniflare, mesmo HTMLRewriter/loader de produção) e
// /__origens/** é respondido por ele. /api/guia/<região> vem do storefront LOCAL (GUIDE_API, a rota ainda não publicada); o resto do storefront
// (índice de cidades) vem de produção. Sessão anônima descartável; tags de analytics bloqueadas; nada de checkout nem pagamento. Capturas em --out.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { shellPageKind } from '../src/scope.js';
import { STORES } from '../src/stores.js';
import { LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const { workerModules } = await import('../test/helpers.js');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const OUT = ((args.out || new URL('../docs/evidence/pdp-guide/', import.meta.url).pathname) + '/').replace(/\/+$/, '/');
const LABEL = args.label || 'depois';
const GUIDE_API = (process.env.GUIDE_API || 'http://127.0.0.1:3100').replace(/\/$/, '');
const STORE_IDS = (args.stores || 'sul,norte,centro').split(',');
mkdirSync(OUT, { recursive: true });
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide';
const failures = [];
const check = (n, ok, d = '') => { if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, process.env.QA_VERBOSE ? 4000 : 300) : '')); };
const info = (n) => console.log('INFO ' + n);

const PRODUCTS = {
  sul: { path: '/usesul/product/feito-em-florianopolis', id: '4714617', city: 'Florianópolis', query: 'floripa', region: 'sul' },
  norte: { path: '/usenorte/product/assis-brasil-origem-ac', city: 'Assis Brasil', query: 'manaus', region: 'norte' },
  centro: { path: '/usecentro/product/goiania-origem-go', city: 'Goiânia', query: 'taguatinga', region: 'centro-oeste' }
};
const workers = new Map();
const upstream = { html: '', status: 200 };
let guideFails = false;
function workerFor(storeId) {
  if (!workers.has(storeId)) {
    workers.set(storeId, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
      bindings: { STORE_ID: storeId, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: FEATURES },
      outboundService: async (req) => {
        const url = new URL(req.url);
        if (url.host === 'useorigens.com.br' && url.pathname.startsWith('/api/guia/')) {
          if (guideFails) return new Response('down', { status: 503 });
          return fetch(GUIDE_API + url.pathname + url.search, { headers: { accept: 'application/json' } });
        }
        if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
        return new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }));
  }
  return workers.get(storeId);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);
const REGION_OF = { sul: 'sul', norte: 'norte', centro: 'centro-oeste' };

async function session(storeId, viewport) {
  const store = STORES[storeId];
  const mf = workerFor(storeId);
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar/, (r) => r.abort());
  const page = await ctx.newPage();
  const s = { ctx, page, store, mobile, posts: [], storeId };
  ctx.on('request', (req) => { const u = new URL(req.url()); if (req.method() === 'POST' && u.host === store.inkHost) s.posts.push(u.pathname); });
  await page.route('**/__origens/**', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '' }, body: req.method() === 'POST' ? req.postData() : undefined });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  const productRe = new RegExp('^' + store.inkBase + '/product/[^/]+$');
  await page.route((u) => u.host === store.inkHost && (productRe.test(u.pathname) || shellPageKind(u.pathname, store.inkBase) !== null), async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch({ maxRedirects: 0 });
    if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
    upstream.html = await res.text(); upstream.status = res.status();
    const out = await mf.dispatchFetch(route.request().url());
    await route.fulfill({ response: res, body: await out.text() });
  });
  await page.route('https://useorigens.com.br/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>storefront (stub do ensaio)</h1></body></html>' }));
  return s;
}
async function open(s, path, query = '') {
  for (let n = 1; n <= 2; n++) {
    try {
      await s.page.goto('https://' + s.store.inkHost + path + query, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
      break;
    } catch (e) { if (n === 2) throw e; info('navegação falhou; nova tentativa'); await wait(s.page, 2000); }
  }
  await s.page.waitForSelector('[data-origens-guide]', { timeout: 20000 }).catch(() => {});
  await wait(s.page, 1200);
}
const acceptCookies = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('.cookie-acceptance button')].find((e) => /aceitar/i.test(e.textContent)); if (b) b.click(); return !!b; });
const jsClick = (page, sel) => page.evaluate((x) => { const el = [...document.querySelectorAll(x)].find((e) => e.getClientRects().length); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.click(); return true; }, sel);
const shot = (page, name) => page.screenshot({ path: OUT + name + '-' + LABEL + '.png' });
const state = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const rect = (e) => { if (!vis(e)) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
  const invite = document.querySelector('[data-origens-guide="invite"]'); const reopen = document.querySelector('[data-origens-guide="reopen"]');
  const panel = document.getElementById('o-guide');
  const form = [...document.querySelectorAll('form[id^="form-product-"]')].find((f) => !f.closest('.modal-buy-together, #quick_add_frame, #modal-wrapper'));
  const cta = document.getElementById('add-to-cart-desk');
  const cw = document.documentElement.clientWidth;
  const ours = [...document.querySelectorAll('[data-origens-guide], #o-guide .o-g-sheet, [data-origens-guide] .o-g-btn')].filter(vis);
  return {
    loader: window.__useOrigensLoader, features: (window.__useOrigens && window.__useOrigens.features) || [],
    invite: rect(invite), reopen: rect(reopen), afterForm: !!invite && !!form && form.nextElementSibling === invite && !form.contains(invite),
    buttons: invite ? [...invite.querySelectorAll('.o-g-btn')].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) })) : [],
    title: invite ? invite.querySelector('.o-g-title')?.textContent : null, x: invite ? rect(invite.querySelector('.o-g-x')) : null,
    discovery: !!document.querySelector('[data-origens-discovery="product"]'), returnLink: !!document.getElementById('use-origens-return-link'),
    cta: rect(cta), panel: !!panel, panelTitle: panel ? panel.querySelector('#o-g-title')?.textContent : null, sheet: panel ? rect(panel.querySelector('.o-g-sheet')) : null,
    cards: panel ? [...panel.querySelectorAll('a.o-g-card')].map((a) => ({ href: a.href, label: a.getAttribute('aria-label'), img: a.querySelector('img')?.naturalWidth || 0 })) : [],
    options: panel ? [...panel.querySelectorAll('.o-g-item')].map((o) => o.textContent.trim()) : [], tiles: panel ? [...panel.querySelectorAll('.o-g-tile')].length : 0,
    after: panel ? panel.querySelector('.o-g-after a')?.textContent : null, afterHref: panel ? panel.querySelector('.o-g-after a')?.href : null,
    alert: panel ? panel.querySelector('[role="alert"]')?.textContent : null, status: panel ? panel.querySelector('.o-g-status')?.textContent : null,
    focused: document.activeElement ? (document.activeElement.tagName + '.' + String(document.activeElement.className).split(' ')[0]) : null, focusInPanel: !!panel && panel.contains(document.activeElement),
    overflow: ours.some((e) => e.getBoundingClientRect().right > cw + 0.5 || e.getBoundingClientRect().left < -0.5),
    sheetInside: panel ? (() => { const r = panel.querySelector('.o-g-sheet').getBoundingClientRect(); return r.left >= -0.5 && r.right <= cw + 0.5 && r.bottom <= innerHeight + 0.5; })() : null,
    storage: (() => { try { return localStorage.getItem('origens:guia:v1:dispensado'); } catch (_) { return 'n/a'; } })(),
    promoHidden: document.getElementById('o-promo')?.getAttribute('data-promo-hidden') ?? null, cookie: vis(document.querySelector('.cookie-acceptance'))
  };
});

for (const storeId of STORE_IDS) {
  const P = PRODUCTS[storeId]; const region = REGION_OF[storeId];
  const viewports = storeId === 'sul' ? [['desktop-1440', { width: 1440, height: 900 }], ['mobile-390', { width: 390, height: 844 }], ['mobile-375', { width: 375, height: 812 }], ['mobile-320', { width: 320, height: 640 }]] : [['desktop-1440', { width: 1440, height: 900 }], ['mobile-390', { width: 390, height: 844 }]];
  for (const [vp, viewport] of viewports) {
    const s = await session(storeId, viewport); const { page } = s; const tag = region + '-pdp-cidade-guia';
    const full = vp === 'desktop-1440' || vp === 'mobile-390';
    try {
      await open(s, P.path);
      // 1. Convite na primeira visita (aviso de cookies da INK ainda na tela): o cupom espera o aviso sair no celular.
      await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 900);
      let st = await state(page);
      check(storeId + ' ' + vp + ': loader ' + LOADER_VERSION + ' com pdp-guide', st.loader === LOADER_VERSION && st.features.includes('pdp-guide'), st.loader);
      check(storeId + ' ' + vp + ': convite logo depois do formulário nativo (fora dele), bloco antigo e link de retorno ausentes', st.afterForm && !st.discovery && !st.returnLink, JSON.stringify({ a: st.afterForm, d: st.discovery, r: st.returnLink }));
      check(storeId + ' ' + vp + ': título e botões (2 + "Mais estampas de ' + P.city + '") com alvo ≥ 44 px', st.title === 'Procurando sua cidade ou outra estampa?' && st.buttons.length === 3 && st.buttons.every((b) => b.h >= 44) && st.buttons[2].t === 'Mais estampas de ' + P.city && st.x && st.x.h >= 44, JSON.stringify(st.buttons));
      check(storeId + ' ' + vp + ': convite abaixo do CTA, sem sobreposição', st.cta && st.invite && st.invite.y >= st.cta.bottom, JSON.stringify({ cta: st.cta, invite: st.invite }));
      check(storeId + ' ' + vp + ': nada nosso passa da largura', !st.overflow);
      if (s.mobile) check(storeId + ' ' + vp + ': cupom recolhido enquanto o aviso de cookies da INK está na tela', !st.cookie || /cookie-notice/.test(st.promoHidden || ''), st.promoHidden);
      await shot(page, tag + '-convite-primeira-visita-' + vp);
      await acceptCookies(page); await wait(page, 800);
      await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 600);
      await shot(page, tag + '-convite-' + vp);
      // 2. Caminho A: buscar uma cidade.
      await jsClick(page, '[data-origens-guide="invite"] .o-g-btn'); await wait(page, 500);
      st = await state(page);
      check(storeId + ' ' + vp + ': "Buscar uma cidade" abre o painel com a busca focada, dentro da tela', st.panel && st.panelTitle === 'Buscar uma cidade' && st.focused === 'INPUT.o-g-input' && st.sheetInside, JSON.stringify({ p: st.panel, t: st.panelTitle, f: st.focused, inside: st.sheetInside, sheet: st.sheet }));
      await page.keyboard.type(P.query); await wait(page, 1500);
      st = await state(page);
      check(storeId + ' ' + vp + ': resultados de cidade + UF para "' + P.query + '"', st.options.length >= 1 && /[A-Z]{2}/.test(st.options[0]), st.options.join(' | '));
      await shot(page, tag + '-busca-' + vp);
      await page.keyboard.press('Enter'); await page.waitForSelector('#o-guide a.o-g-card', { timeout: 15000 }).catch(() => {}); await wait(page, 1500);
      st = await state(page);
      check(storeId + ' ' + vp + ': cidade escolhida → até 3 estampas com foto real, nome e preço, links na loja ' + s.store.inkHost, st.cards.length >= 1 && st.cards.length <= 3 && st.cards.every((c) => c.href.startsWith('https://' + s.store.inkHost + s.store.inkBase + '/product/') && /R\$/.test(c.label || '') && c.img > 0), JSON.stringify(st.cards));
      check(storeId + ' ' + vp + ': "Ver todas as estampas de …" leva à página da cidade no storefront', !!st.after && /^Ver todas as estampas de /.test(st.after) && (st.afterHref || '').startsWith('https://useorigens.com.br/' + region + '/'), st.after + ' ' + st.afterHref);
      await shot(page, tag + '-resultado-cidade-' + vp);
      if (!full) { await s.ctx.close(); continue; }
      await page.keyboard.press('Escape'); await wait(page, 300);
      st = await state(page);
      check(storeId + ' ' + vp + ': Escape fecha e devolve o foco ao botão', !st.panel && st.focused === 'BUTTON.o-g-btn', JSON.stringify({ p: st.panel, f: st.focused }));
      // 3. Contexto: "Mais estampas de <cidade>".
      await jsClick(page, '[data-origens-guide="invite"] [data-guide-more]'); await page.waitForSelector('#o-guide a.o-g-card, #o-guide .o-g-lead', { timeout: 15000 }).catch(() => {}); await wait(page, 1200);
      st = await state(page);
      check(storeId + ' ' + vp + ': "Mais estampas de ' + P.city + '" vai direto às estampas da cidade, sem o produto aberto', st.panelTitle === 'Estampas de ' + P.city && st.cards.length >= 1 && !st.cards.some((c) => c.href.endsWith(P.path)), JSON.stringify({ t: st.panelTitle, n: st.cards.length }));
      await shot(page, tag + '-mais-da-cidade-' + vp);
      await jsClick(page, '#o-guide .o-g-close'); await wait(page, 300);
      // 4. Caminho B: ver outras estampas.
      await jsClick(page, '[data-origens-guide="invite"] .o-g-btn:nth-of-type(2)'); await page.waitForSelector('#o-guide .o-g-tile', { timeout: 15000 }).catch(() => {}); await wait(page, 1200);
      st = await state(page);
      check(storeId + ' ' + vp + ': "Ver outras estampas" lista coleções reais da região (com foto)', st.panelTitle === 'Ver outras estampas' && st.tiles >= 2 && st.tiles <= 8, JSON.stringify({ t: st.panelTitle, tiles: st.tiles }));
      await shot(page, tag + '-colecoes-' + vp);
      const tileName = await page.evaluate(() => document.querySelector('#o-guide .o-g-tile')?.getAttribute('aria-label'));
      await jsClick(page, '#o-guide .o-g-tile'); await page.waitForSelector('#o-guide a.o-g-card', { timeout: 15000 }).catch(() => {}); await wait(page, 1500);
      st = await state(page);
      check(storeId + ' ' + vp + ': coleção escolhida → poucos produtos + "Ver a coleção completa"', st.cards.length >= 1 && st.cards.length <= 4 && /^Ver a coleção completa/.test(st.after || '') && (st.afterHref || '').includes('/' + region + '/colecoes/'), JSON.stringify({ tile: tileName, n: st.cards.length, after: st.after, href: st.afterHref }));
      await shot(page, tag + '-resultado-colecao-' + vp);
      await jsClick(page, '#o-guide .o-g-back'); await wait(page, 400);
      st = await state(page);
      check(storeId + ' ' + vp + ': "Voltar" retorna às coleções', st.panelTitle === 'Ver outras estampas' && st.tiles >= 2, st.panelTitle);
      if (!s.mobile) {
        // Teclado: Tab fica dentro do diálogo.
        for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
        st = await state(page);
        check(storeId + ' ' + vp + ': Tab preso dentro do diálogo', st.focusInPanel, st.focused);
      }
      await page.keyboard.press('Escape'); await wait(page, 300);
      // 5. Dispensa por 30 dias + reabertura discreta; some na recarga e volta a aparecer só pela linha discreta.
      await jsClick(page, '[data-origens-guide="invite"] .o-g-x'); await wait(page, 300);
      st = await state(page);
      check(storeId + ' ' + vp + ': ✕ dispensa, guarda no navegador e deixa só a linha discreta', !st.invite && !!st.reopen && !!st.storage, JSON.stringify({ r: st.reopen, s: st.storage }));
      await shot(page, tag + '-dispensado-' + vp);
      await open(s, P.path); await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 800);
      st = await state(page);
      check(storeId + ' ' + vp + ': na recarga a dispensa é lembrada (só a linha discreta)', !st.invite && !!st.reopen);
      await jsClick(page, '[data-origens-guide="reopen"] button'); await wait(page, 500);
      st = await state(page);
      check(storeId + ' ' + vp + ': a linha discreta reabre o menu com as três saídas', st.panel && st.panelTitle === 'Procurando sua cidade ou outra estampa?', st.panelTitle);
      await shot(page, tag + '-reaberto-' + vp);
      await page.keyboard.press('Escape');
      await page.evaluate(() => localStorage.removeItem('origens:guia:v1:dispensado'));
      // 6. Falha da API do guia: mensagem honesta, "Tentar de novo" e a saída para a vitrine; a compra nativa segue.
      guideFails = true;
      await open(s, P.path); await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 800);
      st = await state(page);
      check(storeId + ' ' + vp + ': sem o contexto (API fora) o convite aparece com 2 botões', !!st.invite && st.buttons.length === 2, JSON.stringify(st.buttons));
      await jsClick(page, '[data-origens-guide="invite"] .o-g-btn:nth-of-type(2)'); await wait(page, 2500);
      st = await state(page);
      check(storeId + ' ' + vp + ': API fora → "Não deu para carregar agora." + Tentar de novo + link da vitrine', st.alert === 'Não deu para carregar agora.' && (await page.evaluate(() => !!document.querySelector('#o-guide .o-g-foot a[href^="https://useorigens.com.br/"]'))), st.alert);
      await shot(page, tag + '-erro-api-' + vp);
      guideFails = false;
      await jsClick(page, '#o-guide .o-g-btn'); await page.waitForSelector('#o-guide .o-g-tile', { timeout: 15000 }).catch(() => {}); await wait(page, 800);
      st = await state(page);
      check(storeId + ' ' + vp + ': "Tentar de novo" recupera', st.tiles >= 2, String(st.tiles));
      await page.keyboard.press('Escape');
      // 7. Quem escolhe variante segue comprando: nada abre; a compra nativa até o drawer funciona com o guia ligado (sem checkout).
      if (storeId === 'sul' && !s.mobile) {
        await open(s, P.path); await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 800);
        const postsBefore = s.posts.length;
        for (const id of ['model-Masculino', 'color-Preta', 'size-M']) { await jsClick(page, 'label[for="' + P.id + '-' + id + '"]'); await wait(page, 1200); }
        st = await state(page);
        check('sul desktop: escolher modelo, cor e tamanho não abre o guia nem mexe no convite', !st.panel && !!st.invite && st.buttons.length === 3, JSON.stringify({ p: st.panel, b: st.buttons.length }));
        check('sul desktop: o guia não fez POST na loja', s.posts.slice(postsBefore).filter((p) => !p.startsWith('/cdn-cgi/')).length === 0);
        await shot(page, tag + '-variantes-escolhidas-' + vp);
        await page.evaluate(() => document.getElementById('add-to-cart-desk').click());
        const added = await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }).then(() => true).catch(() => false);
        check('sul desktop: adicionar ao carrinho (nativo) funciona com o guia ligado', added);
        if (added) { await wait(page, 800); await shot(page, tag + '-pos-adicao-' + vp); await page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click()); await wait(page, 2000); const checkout = await page.evaluate(() => { const b = document.getElementById('checkout-btn'); const r = b && b.getBoundingClientRect(); return b ? { text: b.textContent.trim(), visible: r.height > 0 && r.bottom <= innerHeight } : null; }); check('sul desktop: drawer com "Finalizar compra" visível (não clicado)', checkout && checkout.text === 'Finalizar compra' && checkout.visible, JSON.stringify(checkout)); await shot(page, tag + '-carrinho-' + vp); }
      }
      // 8. Um produto do guia abre a PDP dele e encerra a orientação (a nova página tem o próprio convite, nada do anterior).
      if (storeId === 'sul' && s.mobile) {
        await open(s, P.path); await jsClick(page, '[data-origens-guide="invite"] [data-guide-more]'); await page.waitForSelector('#o-guide a.o-g-card', { timeout: 15000 }); await wait(page, 500);
        const target = await page.evaluate(() => document.querySelector('#o-guide a.o-g-card').getAttribute('href'));
        await page.evaluate(() => document.querySelector('#o-guide a.o-g-card').click());
        await page.waitForFunction((t) => location.href.split('?')[0] === t, target, { timeout: 30000 }).catch(() => {});
        await page.waitForSelector('[data-origens-guide="invite"]', { timeout: 20000 }).catch(() => {}); await wait(page, 1000);
        st = await state(page);
        check('sul mobile: produto do guia abre a PDP dele; o painel fecha e a nova página tem só o próprio convite', page.url().split('?')[0] === target && !st.panel && !!st.invite, JSON.stringify({ url: page.url(), p: st.panel }));
        await page.evaluate(() => document.getElementById('add-to-cart-desk')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 600);
        await shot(page, tag + '-produto-escolhido-' + vp);
      }
    } catch (e) { check(storeId + ' ' + vp + ': execução sem exceção', false, e.message); }
    await s.ctx.close();
  }
}

await browser.close();
for (const mf of workers.values()) await mf.dispose();
console.log(failures.length ? '\n' + failures.length + ' FALHA(S):\n- ' + failures.join('\n- ') : '\nTUDO OK');
process.exit(failures.length ? 1 : 0);
