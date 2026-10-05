#!/usr/bin/env node
// QA de pdp-share + size-guide em NAVEGADOR REAL contra PDPs REAIS da INK, sem publicar nada:
//   PW_PATH=<dir com playwright-core> node scripts/qa-pdp-extras.mjs
// Ensaio fiel (mesmo desenho de qa-recommendations.mjs): o HTML real de produto passa pelo Worker LOCAL (Miniflare, mesmo HTMLRewriter/loader de
// produção) e /__origens/** é respondido por ele. Sessão anônima descartável; tags de analytics bloqueadas. Uma execução real de compra até o
// drawer com "Finalizar compra" (sem clicar nele: nada de checkout nem pagamento). Capturas em QA_EVIDENCE_DIR.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { shellPageKind } from '../src/scope.js';
import { STORES } from '../src/stores.js';
import { LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
const { workerModules } = await import('../test/helpers.js');

const OUT = ((process.env.QA_EVIDENCE_DIR || new URL('../docs/evidence/pdp-share-size-guide/', import.meta.url).pathname) + '/').replace(/\/+$/, '/');
mkdirSync(OUT, { recursive: true });
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide';
const failures = [];
const check = (n, ok, d = '') => { if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, process.env.QA_VERBOSE ? 4000 : 300) : '')); };
const info = (n) => console.log('INFO ' + n);

const SUL = { store: 'sul', path: '/usesul/product/paranaense-pe-vermelho', id: '5072062', other: '/usesul/product/florianopolis-origem-sc-0faeb956-3b10-4a06-8f93-2c9cff8d1afb' };
const OTHERS = [
  { store: 'norte', path: '/usenorte/product/assis-brasil-origem-ac' },
  { store: 'centro', path: '/usecentro/product/goiania-origem-go' }
];

const workers = new Map();
const upstream = { html: '', status: 200 };
function workerFor(storeId) {
  if (!workers.has(storeId)) {
    workers.set(storeId, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
      bindings: { STORE_ID: storeId, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: FEATURES },
      outboundService: async (req) => {
        const url = new URL(req.url);
        if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
        return new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
    }));
  }
  return workers.get(storeId);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(storeId, viewport, { nativeShare = false } = {}) {
  const store = STORES[storeId];
  const mf = workerFor(storeId);
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar/, (r) => r.abort());
  // Chrome headless não tem folha nativa de compartilhamento: o painel alternativo é o caminho exercitado (o nativo é coberto no teste jsdom).
  if (!nativeShare) await ctx.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  const page = await ctx.newPage();
  const s = { ctx, page, store, mobile, posts: [] };
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
  await s.page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center' }));
  await s.page.waitForSelector('a[data-origens-size]', { timeout: 20000 }).catch(() => {});
  await wait(s.page, 700);
}

const state = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const size = [...document.querySelectorAll('a[data-origens-size]')];
  const link = size.find(vis);
  const shares = [...document.querySelectorAll('button[data-origens-share]')];
  const cta = document.getElementById('add-to-cart-desk');
  const lb = link && link.getBoundingClientRect(); const cb = cta && vis(cta) && cta.getBoundingClientRect();
  const cs = link && getComputedStyle(link);
  return {
    loader: window.__useOrigensLoader, features: (window.__useOrigens && window.__useOrigens.features) || [],
    sizeCount: size.length, nativeLinks: document.querySelectorAll('a#open-modal-size').length,
    sizeText: link ? link.innerText.trim() : null, sizeH: lb ? Math.round(lb.height) : 0, sizeColor: cs ? cs.color : null, sizeDecoration: cs ? cs.textDecorationLine : null,
    sizeRadius: cs ? cs.borderTopLeftRadius : null, tint: link ? link.style.getPropertyValue('--o-size-tint') : null,
    gapToCta: lb && cb ? Math.round(cb.top - lb.bottom) : null,
    shareCount: shares.length, shareVisible: shares.filter(vis).length, shareH: shares.filter(vis).map((b) => Math.round(b.getBoundingClientRect().height))[0] || 0,
    menu: !!document.getElementById('o-share'), menuStatus: document.querySelector('#o-share .o-share-status')?.textContent || '',
    // Só os NOSSOS elementos: a PDP nativa da INK já passa da largura no celular (o drawer do carrinho fica fora da tela), com ou sem nada nosso.
    overflow: [...document.querySelectorAll('a[data-origens-size], button[data-origens-share], #o-share .o-share-panel')].filter(vis).some((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 || e.getBoundingClientRect().left < -0.5),
    storefrontLink: [...document.querySelectorAll('a[href^="https://useorigens.com.br/"]')].some(vis)
  };
});
// Modal nativo de medidas da INK aberto? (o controller dela mostra .modal-size-product; aqui só observamos.)
const sizeModalOpen = (page) => page.evaluate(() => [...document.querySelectorAll('.modal-size-product')].some((m) => m.getClientRects().length > 0 && getComputedStyle(m).display !== 'none' && getComputedStyle(m).visibility !== 'hidden' && Number(getComputedStyle(m).opacity) > 0));
// Toque REAL no centro do elemento depois de centralizá-lo, conferindo antes que nada cobre a área de toque (esquerda, centro e direita).
async function tap(page, selector, label, touch = false) {
  // A INK rola com scroll-behavior suave: centralizar SEM animação e medir só depois de parar (senão o toque cai no CTA logo abaixo).
  await page.evaluate((sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length).scrollIntoView({ block: 'center', behavior: 'instant' }), selector);
  await wait(page, 700);
  const hit = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
    const r = el.getBoundingClientRect();
    const pts = [0.08, 0.5, 0.92].map((fx) => { const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2); return e === el || el.contains(e) ? 'ok' : (e ? e.tagName + '.' + String(e.className).slice(0, 40) : 'null'); });
    return { pts, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  check(label + ': área de toque livre (nada da página por cima)', hit.pts.every((p) => p === 'ok'), hit.pts.join(' | '));
  if (process.env.QA_TRACE) await page.evaluate(() => { window.__ev = []; for (const t of ['touchstart', 'click', 'submit']) document.addEventListener(t, (e) => { const d = (el) => el && el.tagName ? el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className || '').split(' ')[0] : String(el); window.__ev.push(t + '@' + d(e.target) + (e.submitter ? ' by ' + d(e.submitter) : '')); }, true); });
  // Celular: a PDP nativa da INK já tem ~417 px de largura num viewport de 390 (drawer fora da tela) e, na emulação mobile, o toque sintético é
  // mapeado nessa proporção e cai ~35 px abaixo (no CTA). A área livre já foi conferida acima por elementFromPoint; a ativação é um clique no
  // próprio elemento (o mesmo evento que o toque real gera), sem mapear coordenadas.
  if (touch) await page.evaluate((sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length).click(), selector);
  else await page.mouse.click(hit.x, hit.y);
  if (process.env.QA_TRACE) { await wait(page, 300); info(label + ' eventos: ' + (await page.evaluate(() => window.__ev.join(' | '))) + ' rect-y=' + Math.round(hit.y) + ' scrollY=' + (await page.evaluate(() => scrollY))); }
}
const shot = (page, name) => page.screenshot({ path: OUT + name + '.png' });

async function closeSizeModal(page) {
  await page.evaluate(() => { const x = [...document.querySelectorAll('.modal-size-product__content-close, #modal-size-close')].find((e) => e.getClientRects().length); if (x) x.click(); });
  await wait(page, 500);
  if (await sizeModalOpen(page)) { await page.keyboard.press('Escape'); await wait(page, 400); }
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 360, height: 740 }]]) {
  const s = await session('sul', viewport);
  const { page } = s;
  try {
    await open(s, SUL.path, '?cart_ref=qa-token&utm_source=qa#reviews');
    let st = await state(page);
    check(label + ': loader ' + LOADER_VERSION + ' com pdp-share e size-guide', st.loader === LOADER_VERSION && st.features.includes('pdp-share') && st.features.includes('size-guide'), st.loader + ' ' + st.features.join(','));
    check(label + ': link nativo de medidas virou "Guia de medidas" (1, no MESMO nó)', st.sizeCount === 1 && st.nativeLinks === 1 && st.sizeText === 'Guia de medidas', JSON.stringify({ c: st.sizeCount, n: st.nativeLinks, t: st.sizeText }));
    check(label + ': botão ≥44 px, sem azul/sublinhado, cantos ~10 px, cor da região', st.sizeH >= 44 && st.sizeDecoration === 'none' && st.sizeColor === 'rgb(31, 35, 40)' && st.sizeRadius === '10px' && st.tint === '#4d543d', JSON.stringify(st));
    if (st.gapToCta !== null) check(label + ': respiro antes do CTA de compra (10–40 px)', st.gapToCta >= 10 && st.gapToCta <= 40, String(st.gapToCta));
    check(label + ': "Compartilhar" — 2 no DOM (cabeçalhos celular/desktop), exatamente 1 visível, ≥44 px', st.shareCount === 2 && st.shareVisible === 1 && st.shareH >= 44, JSON.stringify({ c: st.shareCount, v: st.shareVisible, h: st.shareH }));
    check(label + ': nada nosso passa da largura da tela', !st.overflow);
    await shot(page, label + '-pdp');

    // Guia: abre o modal OFICIAL da INK (uma vez), fecha, nada de POST. No celular a própria INK exige o modelo antes ("Selecione o modelo",
    // comportamento NATIVO, igual sem nada nosso): escolhe-se a variante primeiro, como quem compra.
    const postsBefore = s.posts.length;
    // (No celular a INK valida o formulário ao tocar no link: modelo E cor antes; sem isso mostra "Selecione o modelo/cor", igual sem nada nosso.)
    if (s.mobile) for (const f of ['model-Masculino', 'color-Preta', 'size-M']) { await page.evaluate((x) => document.querySelector('label[for="' + x + '"]')?.click(), SUL.id + '-' + f); await wait(page, 1500); }
    await tap(page, 'a[data-origens-size]', label + ': "Guia de medidas"', s.mobile);
    await wait(page, 700);
    check(label + ': "Guia de medidas" abre o modal nativo de medidas da INK', await sizeModalOpen(page));
    await shot(page, label + '-guia-ink');
    await closeSizeModal(page);
    check(label + ': modal nativo fecha normalmente', !(await sizeModalOpen(page)));

    // Compartilhar: painel alternativo, cópia, Escape; nada de POST nem carrinho.
    await tap(page, 'button[data-origens-share]', label + ': "Compartilhar"', s.mobile);
    await wait(page, 300);
    st = await state(page);
    check(label + ': sem compartilhamento nativo, abre o painel "Copiar link" / "WhatsApp"', st.menu);
    check(label + ': painel inteiro dentro da tela (Fechar e botões visíveis)', !st.overflow && (await page.evaluate(() => { const r = document.querySelector('#o-share .o-share-close').getBoundingClientRect(); return r.right <= document.documentElement.clientWidth; })));
    const wa = await page.locator('#o-share a.o-share-wa').getAttribute('href');
    const text = new URL(wa).searchParams.get('text');
    check(label + ': WhatsApp leva a URL canônica limpa (sem cart_ref/utm/hash) e o nome real', /^Olha essa camiseta da Use Origens: .+ https:\/\/www\.usesul\.com\.br\/usesul\/product\/paranaense-pe-vermelho$/.test(text), text);
    await shot(page, label + '-compartilhar');
    await page.keyboard.press('Escape'); await wait(page, 200);
    check(label + ': Escape fecha o painel e devolve o foco ao botão', !(await state(page)).menu && (await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-origens-share'))));
    // Os POST do próprio Cloudflare da INK (/cdn-cgi/: RUM e challenge) existem com ou sem nada nosso e não contam.
    const ours = s.posts.slice(postsBefore).filter((p) => !p.startsWith('/cdn-cgi/'));
    check(label + ': guia e compartilhar não fizeram nenhum POST na loja', ours.length === 0, ours.join(','));

    // Troca de variante: o frame volta, o link é tratado uma vez, nada duplica.
    const models = await page.evaluate((id) => [...document.querySelectorAll('label[for^="' + id + '-model-"]')].map((l) => l.htmlFor), SUL.id);
    if (models.length > 1) {
      for (const f of [models[1], models[0]]) { await page.evaluate((x) => document.querySelector('label[for="' + x + '"]').click(), f); await wait(page, 1800); }
      st = await state(page);
      check(label + ': depois de trocar o modelo 2x — 1 guia, 2 botões de compartilhar, sem duplicar', st.sizeCount === 1 && st.nativeLinks === 1 && st.shareCount === 2, JSON.stringify({ size: st.sizeCount, native: st.nativeLinks, share: st.shareCount }));
    } else info(label + ': produto sem 2 modelos visíveis; troca de variante não exercitada');

    if (label === 'desktop') {
      // O retorno que existe hoje é a navbar da INK com os links do storefront (header-nav); o return-link só aparece com origens_return.
      check('desktop: retorno ao storefront (links da navbar) presente', st.storefrontLink);
      // Compra real até o drawer: selecionar → adicionar → drawer → "Finalizar compra" visível (sem clicar).
      for (const id of ['model-Masculino', 'color-Preta', 'size-M']) {
        const l = page.locator('label[for="' + SUL.id + '-' + id + '"]');
        await l.scrollIntoViewIfNeeded(); await l.click(); await wait(page, 900);
      }
      const variant = await page.waitForFunction((id) => Number(document.getElementById('product-variant-id-' + id)?.value) > 0, SUL.id, { timeout: 15000 }).then(() => true).catch(() => false);
      info('variante selecionada: ' + variant);
      await page.evaluate(() => document.getElementById('add-to-cart-desk').click());
      const added = await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }).then(() => true).catch(() => false);
      check('desktop: adicionar ao carrinho (nativo) funciona com as duas features ligadas', added);
      if (added) {
        await wait(page, 1000);
        await page.evaluate(() => document.querySelector('#modal-wrapper .checkout-btn').click());
        const drawer = await page.waitForSelector('.cart-drawer.open', { timeout: 15000 }).then(() => true).catch(() => false);
        await wait(page, 1000);
        const checkout = await page.evaluate(() => { const b = document.getElementById('checkout-btn'); const r = b && b.getBoundingClientRect(); return b ? { text: b.textContent.trim(), visible: r.height > 0 && r.bottom <= innerHeight } : null; });
        check('desktop: drawer abre e "Finalizar compra" continua visível (não clicado)', drawer && checkout && checkout.text === 'Finalizar compra' && checkout.visible, JSON.stringify(checkout));
        await shot(page, 'desktop-drawer');
      }
      // Navegação Turbo para outro produto e volta: nada duplica nem fica de outra página.
      await page.evaluate((p) => window.Turbo ? window.Turbo.visit(p) : (window.location.href = p), SUL.other);
      await page.waitForFunction((p) => location.pathname === p, SUL.other, { timeout: 30000 }); await wait(page, 2500);
      await page.goBack({ waitUntil: 'domcontentloaded' }); await wait(page, 2500);
      await page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center' })); await wait(page, 1500);
      st = await state(page);
      check('desktop: produto → outro produto (Turbo) → voltar: 1 guia, 2 compartilhar, sem duplicar', st.sizeCount === 1 && st.shareCount === 2 && st.nativeLinks === 1, JSON.stringify({ size: st.sizeCount, share: st.shareCount, native: st.nativeLinks }));
    }
  } catch (e) { check(label + ': execução sem exceção', false, e.message); }
  await s.ctx.close();
}

for (const c of OTHERS) {
  const s = await session(c.store, { width: 1440, height: 900 });
  try {
    await open(s, c.path);
    const st = await state(s.page);
    check(c.store + ': guia na cor da região (' + STORES[c.store].theme.primary + ') e compartilhar presente', st.sizeCount === 1 && st.tint === STORES[c.store].theme.primary && st.shareVisible === 1, JSON.stringify({ size: st.sizeCount, tint: st.tint, share: st.shareVisible }));
    await tap(s.page, 'a[data-origens-size]', c.store + ': "Guia de medidas"'); await wait(s.page, 700);
    check(c.store + ': abre o modal nativo de medidas', await sizeModalOpen(s.page));
    await closeSizeModal(s.page);
    await shot(s.page, c.store + '-desktop-pdp');
  } catch (e) { check(c.store + ': execução sem exceção', false, e.message); }
  await s.ctx.close();
}

await browser.close();
for (const mf of workers.values()) await mf.dispose();
console.log(failures.length ? '\n' + failures.length + ' FALHA(S):\n- ' + failures.join('\n- ') : '\nTUDO OK');
process.exit(failures.length ? 1 : 0);
