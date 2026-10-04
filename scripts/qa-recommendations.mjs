#!/usr/bin/env node
// QA do bloco "Você também pode gostar" (auto-recommendations) em NAVEGADOR REAL contra PDPs REAIS da INK, sem publicar nada:
//   PW_PATH=<dir com playwright-core> RECO_STOREFRONT=http://127.0.0.1:3107 node scripts/qa-recommendations.mjs
// Ensaio fiel: o HTML de produto da INK real passa pelo Worker LOCAL (Miniflare, mesmo HTMLRewriter/loader de produção) e /__origens/** é
// respondido por ele. O Worker chama o storefront: /api/recommendations/** vai para o storefront LOCAL (RECO_STOREFRONT, a rota real lendo o
// índice gerado por `npm run recommendations:build`); navbar/cidades vão ao storefront de PRODUÇÃO (GET públicos, só leitura).
// Sessão anônima descartável; nunca adiciona ao carrinho nem toca em checkout; tags de analytics da INK bloqueadas. Capturas em QA_EVIDENCE_DIR.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { shellPageKind } from '../src/scope.js';
import { STORES } from '../src/stores.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const { workerModules } = await import('../test/helpers.js');

const LOCAL_SF = (process.env.RECO_STOREFRONT || 'http://127.0.0.1:3107').replace(/\/$/, '');
const OUT = ((process.env.QA_EVIDENCE_DIR || new URL('../docs/evidence/ink-auto-recommendations/', import.meta.url).pathname) + '/').replace(/\/+$/, '/');
mkdirSync(OUT, { recursive: true });
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,auto-recommendations';
const results = []; const failures = [];
const check = (n, ok, d = '') => { results.push(!!ok); if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 300) : '')); };
const info = (n) => console.log('INFO ' + n);

// Casos (MD §26): cidade, editorial e sem contexto. `shot` = nome da captura pedida no MD §27.
const CASES = [
  { store: 'sul', kind: 'city', path: '/usesul/product/florianopolis-origem-sc-0faeb956-3b10-4a06-8f93-2c9cff8d1afb', id: '3789929', title: 'Florianópolis · Origem', place: 'Florianópolis', shot: 'pdp-city' },
  { store: 'sul', kind: 'city', path: '/usesul/product/tijucas-coordenadas', id: '3827650', title: 'Tijucas · Coordenadas', place: 'Tijucas' },
  { store: 'sul', kind: 'city', path: '/usesul/product/bage-traco-rs-d0618202-d6ed-43c3-a699-a33dee97bdf6', id: '4382115', title: 'Bagé · Traço', place: 'Bagé' },
  { store: 'sul', kind: 'editorial', path: '/usesul/product/bah-dizeres', id: '3859884', title: 'Bah | Dizeres (Fala Daqui)', shot: 'pdp-editorial' },
  { store: 'sul', kind: 'editorial', path: '/usesul/product/serra-catarinense', id: '4932916', title: 'Serra Catarinense (Do Nosso Jeito)' },
  { store: 'sul', kind: 'editorial', path: '/usesul/product/pai-paranaense-churrasqueiro-lenda', id: '3822253', title: 'Pai Paranaense Churrasqueiro (Lenda)' },
  { store: 'sul', kind: 'editorial', path: '/usesul/product/paranaense-bicho-do-parana-757ac4ce-0d5d-4c6c-839f-828be380e0d5', id: '5071864', title: 'Paranaense | Bicho do Paraná — peça Oversized (mesmo cluster)', piece: true },
  { store: 'sul', kind: 'none', path: '/usesul/product/amigas-la-de-caibate', id: '4430200', title: 'Amigas lá de Caibaté (encomenda pessoal, sem contexto)' },
  { store: 'centro', kind: 'city', path: '/usecentro/product/goiania-origem-go', id: '3915458', title: 'Goiânia · Origem (Centro-Oeste)', place: 'Goiânia' }
];

const workers = new Map();
const upstreamInk = { html: '', status: 200 };
let storefrontDown = false;
function workerFor(storeId, features = FEATURES) {
  const key = storeId + '|' + features;
  if (!workers.has(key)) {
    workers.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
      bindings: { STORE_ID: storeId, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: features },
      outboundService: async (req) => {
        const url = new URL(req.url);
        if (url.host === 'useorigens.com.br' && url.pathname.startsWith('/api/recommendations/')) {
          if (storefrontDown) return new Response('down', { status: 502 });
          return fetch(LOCAL_SF + url.pathname, { headers: { accept: 'application/json' } });
        }
        if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
        return new Response(upstreamInk.html, { status: upstreamInk.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }));
  }
  return workers.get(key);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(storeId, viewport, features = FEATURES) {
  const store = STORES[storeId];
  const mf = workerFor(storeId, features);
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', deviceScaleFactor: viewport.width < 600 ? 2 : 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar/, (r) => r.abort());
  const page = await ctx.newPage();
  const s = { ctx, page, store, reco: [], posts: 0 };
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host === store.inkHost && u.pathname.startsWith('/__origens/recommendations/')) s.reco.push(req.method() + ' ' + u.pathname);
    // POST de compra/sessão (carrinho, checkout, login) disparado por nós: deve ser 0. Os POST do próprio Cloudflare da INK (/cdn-cgi/: challenge e RUM)
    // existem com ou sem o nosso código e não contam.
    if (req.method() === 'POST' && u.host === store.inkHost && /\/(cart|checkout|store_sessions|orders|payments?)(\/|$|\?)/.test(u.pathname)) s.posts++;
  });
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
    upstreamInk.html = await res.text(); upstreamInk.status = res.status();
    const out = await mf.dispatchFetch(route.request().url());
    await route.fulfill({ response: res, body: await out.text() });
  });
  await page.route('https://useorigens.com.br/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>storefront (stub do ensaio)</h1></body></html>' }));
  return s;
}

async function open(s, path) {
  for (let n = 1; n <= 2; n++) {
    try {
      await s.page.goto('https://' + s.store.inkHost + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
      break;
    } catch (e) { if (n === 2) throw e; info('navegação falhou (' + String(e.message).split('\n')[0] + '); nova tentativa'); await wait(s.page, 2000); }
  }
  await s.page.waitForSelector('[data-origens-reco]', { timeout: 8000 }).catch(() => {});
  await wait(s.page, 600);
}

const state = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-origens-reco]');
  const cards = root ? [...root.querySelectorAll('a.o-reco-card')] : [];
  const together = document.querySelector('section.buy-together');
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const track = root && root.querySelector('.o-reco-track');
  const rects = cards.map((c) => c.getBoundingClientRect());
  const mainForm = [...document.querySelectorAll('form[id^="form-product-"]')].find((f) => !f.closest('.modal-buy-together'));
  const desc = [...document.querySelectorAll('h2, h3, p, div')].find((e) => /^\s*Descri[cç][aã]o\s*$/i.test(e.textContent || ''));
  const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  let sw = document.documentElement.scrollWidth; const vw = document.documentElement.clientWidth;
  const gallery = document.querySelector('.details-product > section.section-product-v2');
  const carousel = gallery && gallery.firstElementChild;
  const details = document.querySelector('.details-product > section.section-details');
  const geo = () => ({ galleryH: gallery ? Math.round(gallery.getBoundingClientRect().height) : 0, carouselH: carousel ? Math.round(carousel.getBoundingClientRect().height) : 0, detailsH: details ? Math.round(details.getBoundingClientRect().height) : 0, ctaTop: Math.round((document.getElementById('add-to-cart-desk') || document.body).getBoundingClientRect().top + scrollY) });
  const withBlock = geo();
  let swWithout = sw; let withoutBlock = withBlock; if (root) { root.style.display = 'none'; swWithout = document.documentElement.scrollWidth; withoutBlock = geo(); root.style.display = ''; }
  const rootBox = root ? root.getBoundingClientRect() : null; const carBox = carousel ? carousel.getBoundingClientRect() : null;
  return {
    blocks: document.querySelectorAll('[data-origens-reco]').length,
    title: root && root.querySelector('h2') ? root.querySelector('h2').textContent : null,
    items: cards.map((c) => ({ href: c.href, id: c.getAttribute('data-product-id'), reason: c.getAttribute('data-reason'), name: c.querySelector('.o-reco-name').textContent, price: c.querySelector('.o-reco-price').textContent, img: c.querySelector('img').src, h: c.getBoundingClientRect().height })),
    nativeTogether: !!together, nativeTogetherVisible: vis(together), afterTogether: !!(together && together.nextElementSibling === root),
    afterForm: before(mainForm, root), beforeDescription: desc ? before(root, desc) : null, insideForm: !!(mainForm && root && mainForm.contains(root)),
    formId: mainForm && mainForm.id, ctaVisible: vis(document.getElementById('add-to-cart-desk')) || vis(document.getElementById('add-to-cart-mob')),
    overflowOurs: sw > vw + 1 && swWithout <= vw + 1, sw, swWithout, vw,
    trackScrolls: !!(track && track.scrollWidth > track.clientWidth + 4), visibleCards: track && rects[0] ? Number((track.clientWidth / (rects[0].width + 12)).toFixed(2)) : 0,
    oneRow: rects.length > 0 && rects.every((r) => Math.abs(r.top - rects[0].top) < 2),
    loader: window.__useOrigensLoader, features: (window.__useOrigens || {}).features || [],
    placement: root ? root.getAttribute('data-placement') : null, inGallery: !!(gallery && root && gallery.contains(root)),
    belowImage: !!(rootBox && carBox && rootBox.top >= carBox.bottom - 1 && rootBox.left >= carBox.left - 1 && rootBox.right <= carBox.right + 1),
    carouselSame: withBlock.carouselH === withoutBlock.carouselH && withBlock.galleryH === withoutBlock.galleryH,
    fitsGap: !!(rootBox && details && rootBox.bottom <= details.getBoundingClientRect().bottom + 1), detailsSame: withBlock.detailsH === withoutBlock.detailsH, ctaSame: withBlock.ctaTop === withoutBlock.ctaTop
  };
});

async function shot(s, name, { together = false } = {}) {
  const page = s.page;
  // Só para a captura: aceita o aviso informativo de cookies da INK (sessão anônima descartável) para ele não cobrir o bloco.
  const notice = page.locator('.cookie-acceptance button');
  if (await notice.count() && await notice.first().isVisible()) { await notice.first().click(); await wait(page, 400); }
  await page.evaluate((t) => {
    const desk = innerWidth >= 1024;
    const el = t ? (desk ? document.querySelector('.details-product') : (document.querySelector('section.buy-together') || document.querySelector('[data-origens-reco]'))) : (desk ? document.querySelector('.details-product > section.section-product-v2') : document.querySelector('[data-origens-reco]'));
    if (!el) return;
    const header = [...document.querySelectorAll('nav.navbar, header')].map((h) => h.getBoundingClientRect().bottom).filter((b) => b > 0 && b < 300);
    const offset = (header.length ? Math.max(...header) : 0) + 16;
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - offset);
  }, together);
  await wait(page, 900); // imagens lazy dos cards
  await page.evaluate(() => Promise.all([...document.querySelectorAll('[data-origens-reco] img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 4000); })))));
  // Desktop: recorte de página inteira da grade do produto (imagem + bloco à esquerda, compra + "Compre Junto" à direita), para ver o vão reaproveitado.
  const clip = await page.evaluate((t) => {
    if (innerWidth < 1024) return null;
    const grid = document.querySelector('.details-product'); const root = document.querySelector('[data-origens-reco]');
    if (!grid || !root) return null;
    const g = grid.getBoundingClientRect(); const r = root.getBoundingClientRect(); const bt = document.querySelector('section.buy-together');
    const bottom = Math.max(r.bottom, t && bt ? bt.getBoundingClientRect().bottom : 0) + 32;
    return { x: 0, y: Math.max(0, g.top + scrollY - 8), width: document.documentElement.clientWidth, height: Math.round(bottom - g.top + 8) };
  }, together);
  if (clip) await page.screenshot({ path: OUT + name + '.png', fullPage: true, clip });
  else await page.screenshot({ path: OUT + name + '.png' });
  info('captura ' + OUT + name + '.png');
}

const report = [];
for (const c of CASES) {
  for (const vp of [{ width: 1280, height: 900, tag: 'desktop' }, { width: 390, height: 844, tag: 'mobile' }, { width: 320, height: 640, tag: '320' }]) {
    const s = await session(c.store, { width: vp.width, height: vp.height });
    try {
      await open(s, c.path);
      const st = await state(s.page);
      const label = `${c.title} @${vp.width}`;
      check(label + ': loader 4.9 com auto-recommendations', st.loader === '4.9' && st.features.includes('auto-recommendations'), st.loader + ' ' + st.features.join(','));
      check(label + ': exatamente 1 pedido de recomendações', s.reco.length === 1 && s.reco[0] === 'GET /__origens/recommendations/' + c.id, s.reco.join(' | '));
      if (c.kind === 'none') {
        check(label + ': sem contexto => nenhum bloco (PDP normal)', st.blocks === 0, JSON.stringify(st.items));
      } else {
        check(label + ': 1 bloco "Você também pode gostar" com 2–4 cards', st.blocks === 1 && st.title === 'Você também pode gostar' && st.items.length >= 2 && st.items.length <= 4, st.items.length);
        const host = 'https://' + s.store.inkHost + s.store.inkBase + '/product/';
        check(label + ': links reais da loja, sem o produto atual, sem duplicata', st.items.every((i) => i.href.startsWith(host) && i.id !== c.id) && new Set(st.items.map((i) => i.id)).size === st.items.length);
        check(label + ': cards com imagem, preço e alvo ≥ 44 px', st.items.every((i) => i.img.startsWith('https://gcp-images.majestic.ink.rsvcloud.com/') && /R\$/.test(i.price) && i.h >= 44));
        if (c.place) check(label + ': no máximo 2 da mesma cidade; Feito em/Coordenadas primeiro', st.items.length > 0 && st.items.filter((i) => i.name.startsWith(c.place + ' ·')).length <= 2 && /^same-locality/.test((st.items[0] || {}).reason || ''), st.items.map((i) => i.name + ' [' + i.reason + ']').join(' | '));
        if (c.piece) check(label + ': peça Oversized recebe a lista da estampa e nenhuma peça da mesma estampa aparece', !st.items.some((i) => /Bicho do Paraná/.test(i.name)), st.items.map((i) => i.name).join(' | '));
        if (vp.width >= 1024) {
          check(label + ': desktop = logo abaixo da imagem, na coluna da galeria (vão reaproveitado)', st.placement === 'gallery' && st.inGallery && st.belowImage && st.fitsGap && !st.insideForm, JSON.stringify({ placement: st.placement, inGallery: st.inGallery, belowImage: st.belowImage, fitsGap: st.fitsGap }));
          check(label + ': desktop = galeria com a MESMA altura (selo de zoom no lugar), imagem não esticada, coluna de compra e CTA no mesmo lugar, "Compre Junto" nativo visível', st.carouselSame && st.detailsSame && st.ctaSame && (!st.nativeTogether || st.nativeTogetherVisible), JSON.stringify({ carousel: st.carouselSame, details: st.detailsSame, cta: st.ctaSame }));
        } else {
          check(label + ': empilhado = depois do bloco principal de compra, fora do formulário' + (st.nativeTogether ? ', logo após o "Compre Junto" nativo (mantido visível)' : ''), st.placement === 'flow' && st.afterForm && !st.insideForm && (!st.nativeTogether || (st.afterTogether && st.nativeTogetherVisible)) && st.beforeDescription !== false, JSON.stringify({ placement: st.placement, afterForm: st.afterForm, afterTogether: st.afterTogether, nativeVisible: st.nativeTogetherVisible, beforeDescription: st.beforeDescription }));
        }
        check(label + ': CTA nativo intacto e nenhum POST nosso', st.ctaVisible && s.posts === 0 && /^form-product-\d+$/.test(st.formId || '') && st.formId === 'form-product-' + c.id, st.formId);
        check(label + ': nenhum overflow horizontal atribuível ao bloco', !st.overflowOurs, JSON.stringify({ sw: st.sw, without: st.swWithout, vw: st.vw }));
        if (vp.width >= 1024) check(label + ': desktop = cards numa linha', st.oneRow, '');
        else check(label + ': mobile = carrossel horizontal com ~1,2–1,5 cards visíveis', st.items.length <= 1 || (st.trackScrolls && st.visibleCards >= 1.15 && st.visibleCards <= 1.6), 'visíveis ' + st.visibleCards);
        if (vp.tag !== '320') report.push({ case: c.title, viewport: vp.width, items: st.items.map((i) => `${i.name} [${i.reason}]`) });
      }
      if (c.shot && vp.tag !== '320') await shot(s, c.shot + '-' + vp.tag);
      if (c.shot === 'pdp-city' && vp.tag === 'desktop') await shot(s, 'pdp-native-bundle-plus-recommendations', { together: true });
      if (c.shot === 'pdp-city' && vp.tag === 'mobile') await shot(s, 'pdp-native-bundle-plus-recommendations-mobile', { together: true });
    } catch (e) {
      check(`${c.title} @${vp.width}: execução`, false, String(e && e.message).split('\n')[0]);
    } finally { await s.ctx.close(); }
  }
}

// Clique: navega na mesma aba para a PDP real recomendada (Turbo), que ganha o SEU bloco; nenhum POST.
{
  const s = await session('sul', { width: 390, height: 844 });
  try {
    await open(s, CASES[0].path);
    const first = await s.page.$eval('[data-origens-reco] a.o-reco-card', (a) => ({ href: a.href, id: a.getAttribute('data-product-id') }));
    const pages = s.ctx.pages().length;
    await s.page.click('[data-origens-reco] a.o-reco-card');
    await s.page.waitForURL(first.href, { timeout: 30000 });
    await s.page.waitForSelector('form[id^="form-product-' + first.id + '"]', { timeout: 30000 });
    await s.page.waitForSelector('[data-origens-reco]', { timeout: 10000 }).catch(() => {});
    const st = await state(s.page);
    check('clique: mesma aba, PDP real da INK do item recomendado', s.ctx.pages().length === pages && s.page.url() === first.href);
    check('clique: a nova PDP tem o seu próprio bloco (1) e pediu a lista do NOVO produto', st.blocks === 1 && s.reco.at(-1) === 'GET /__origens/recommendations/' + first.id, s.reco.join(' | '));
    check('clique: nenhum POST (sem carrinho, sem checkout)', s.posts === 0);
  } catch (e) { check('clique: execução', false, String(e && e.message).split('\n')[0]); } finally { await s.ctx.close(); }
}

// Fail-safe: storefront fora => nenhum bloco, PDP normal. Flag off => nenhum pedido e nenhum DOM.
{
  storefrontDown = true;
  const s = await session('sul', { width: 1280, height: 900 });
  try { await open(s, CASES[0].path); const st = await state(s.page); check('fail-safe: storefront indisponível => nenhum bloco, CTA intacto', st.blocks === 0 && st.ctaVisible && s.reco.length === 1); }
  catch (e) { check('fail-safe: execução', false, String(e && e.message).split('\n')[0]); } finally { await s.ctx.close(); storefrontDown = false; }
  const off = await session('sul', { width: 1280, height: 900 }, FEATURES.replace(',auto-recommendations', ''));
  try { await open(off, CASES[0].path); const st = await state(off.page); check('flag off: nenhum pedido de recomendações e nenhum DOM', st.blocks === 0 && off.reco.length === 0 && !st.features.includes('auto-recommendations')); }
  catch (e) { check('flag off: execução', false, String(e && e.message).split('\n')[0]); } finally { await off.ctx.close(); }
}

await browser.close();
for (const mf of workers.values()) await mf.dispose();
console.log('\nRESUMO DOS BLOCOS (o que a página mostrou):');
for (const r of report) console.log(`- ${r.case} @${r.viewport}: ${r.items.join(' · ')}`);
console.log(`\n${results.filter(Boolean).length}/${results.length} checagens OK` + (failures.length ? '\nFALHAS:\n- ' + failures.join('\n- ') : ''));
process.exit(failures.length ? 1 : 0);
