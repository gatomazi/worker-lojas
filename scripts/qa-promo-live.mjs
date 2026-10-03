#!/usr/bin/env node
// QA do botão de cupons (promo-fab) em NAVEGADOR REAL contra as páginas REAIS da INK das três lojas. Ensaio, mesmo método de qa-abas-laterais-live.mjs: o
// caminho /__origens/loader.js é respondido com o BUILD LOCAL desta branch (as features que a produção já usa + promo-fab) e /__origens/promotions com
// dados de teste (page.route). Nada é publicado, nada é gravado, nenhuma compra: não clica em "Adicionar ao carrinho" (sem POST na INK).
// Confere: um único botão no canto inferior esquerdo, longe de WhatsApp/Ajuda e do CTA fixo, painel (cartão/folha), Copiar, menu e Ajuda abertos => botão
// fora do caminho, sem rolagem horizontal, fail-open (503 => nada) e o resto da página (navbar, formulário de compra) intacto.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-promo-live.mjs [sul|norte|centro ...]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { buildLoaderSource } from '../src/loader-source.js';
import { STORES } from '../src/stores.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const OUT = new URL('../docs/evidence/promo-fab/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const LIVE_FEATURES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav', 'list-session'];
const FEATURES = [...LIVE_FEATURES, 'promo-fab'];
const PRODUCT = { sul: '/usesul/product/serra-catarinense' };
const THEME = { sul: '#4d543d', norte: '#234b50', centro: '#8c3b1f' };
const payload = (id) => ({ v: 1, theme: { primary: THEME[id], onPrimary: '#ffffff' }, items: [
  { id: 'leve-mais', type: 'coupon', title: 'LEVE MAIS', code: 'LEVEMAIS', description: '3 peças: R$ 30 OFF · 4 peças: R$ 50 OFF · 5 ou mais: R$ 75 OFF', callout: 'Um cupom por pedido.', order: 1 },
  { id: 'frete-gratis', type: 'promotion', title: 'Semana do Frete Grátis', description: '1 peça RJ ou 2 peças demais estados', callout: 'Com limite de R$ 29,90 por frete', order: 2 },
  { id: 'primeira-compra', type: 'coupon', title: 'PRIMEIRA COMPRA', code: 'PRIMEIRA5', description: '5% OFF na sua primeira compra', badgeLabel: 'Novo', order: 3 }
] });
// QA_WIDTHS=390,320 limita as larguras (depuração).
const VIEWPORTS = [[1280, 800], [1024, 768], [768, 1024], [500, 900], [390, 844], [360, 740], [320, 640]].filter(([w]) => !process.env.QA_WIDTHS || process.env.QA_WIDTHS.split(',').map(Number).includes(w));
const results = []; const failures = [];
const check = (n, ok, d = '') => { results.push(!!ok); if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 300) : '')); };
const info = (n) => console.log('INFO ' + n);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(store, viewport, { promotions = 'ok', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, locale: 'pt-BR', isMobile: mobile, hasTouch: mobile, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms/, (r) => r.abort());
  const page = await ctx.newPage();
  page.promoCalls = 0;
  await page.route('**/__origens/loader.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildLoaderSource([], FEATURES, 'product-catalog', store) }));
  await page.route('**/__origens/promotions', (r) => { page.promoCalls++; return promotions === 'ok' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload(store.id)) }) : r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }); });
  return { ctx, page };
}

async function productPath(store) {
  if (PRODUCT[store.id]) return PRODUCT[store.id];
  const s = await session(store, [1280, 800]);
  await s.page.goto('https://' + store.inkHost + store.inkBase, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const href = await s.page.locator('a[href*="' + store.inkBase + '/product/"]').first().getAttribute('href');
  await s.ctx.close();
  PRODUCT[store.id] = new URL(href, 'https://' + store.inkHost).pathname;
  return PRODUCT[store.id];
}

async function open(page, url) {
  for (let n = 1; n <= 2; n++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); break; }
    catch (e) { if (n === 2) throw e; info('navegação falhou, nova tentativa'); await wait(page, 2000); }
  }
  await page.waitForSelector('#o-promo .o-promo-fab', { timeout: 20000 }).catch(() => {});
  await wait(page, 900);
}
// DOM click: on phones the INK's own sticky CTA overlaps the notice's button (it is still the visitor's tap on "Aceitar").
// Toque/clique REAL no centro do elemento, sem a rolagem automática do Playwright (numa página mais larga que a tela ela desloca o viewport antes de clicar).
async function press(page, locator, touch) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('elemento fora da tela');
  if (touch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count()) { await n.first().evaluate((b) => b.click()).catch(() => {}); await wait(page, 500); } };

const geometry = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const r = (e) => (vis(e) ? e.getBoundingClientRect() : null);
  const hit = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const fab = r(document.querySelector('#o-promo .o-promo-fab'));
  const others = { whatsapp: r(document.getElementById('o-wa-fab')), ajuda: r(document.querySelector('[data-controller~="ink-store--help-button"] button')), cta: r(document.getElementById('add-to-cart-mob')), cookies: r(document.querySelector('.cookie-acceptance')) };
  return {
    count: document.querySelectorAll('#o-promo').length,
    fab: fab && { left: Math.round(fab.left), bottom: Math.round(window.innerHeight - fab.bottom), w: Math.round(fab.width) },
    hits: Object.entries(others).filter(([, o]) => hit(fab, o)).map(([k]) => k),
    // A INK sozinha já passa da largura no celular (drawer e barra fixos): o que conta é se o NOSSO botão/painel aumenta isso.
    overflow: Math.max(0, ...[...document.querySelectorAll('#o-promo .o-promo-fab, #o-promo-panel')].map((e) => e.getBoundingClientRect().right - Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth))),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    badge: document.querySelector('#o-promo .o-promo-badge')?.textContent ?? null,
    form: !!document.querySelector('form[id^="form-product-"]'),
    navbar: !!document.querySelector('[data-origens-nav]')
  };
});

const wanted = process.argv.slice(2).filter((a) => STORES[a]);
for (const id of wanted.length ? wanted : ['sul', 'norte', 'centro']) {
  const store = STORES[id];
  const path = await productPath(store);
  info(store.name + ' · ' + path);
  for (const vp of VIEWPORTS) {
    const tag = id + '-' + vp[0];
    const s = await session(store, vp, { mobile: vp[0] < 768 });
    const page = s.page;
    try {
      await open(page, 'https://' + store.inkHost + path);
      let g = await geometry(page);
      if (g.count === 1) await page.screenshot({ path: OUT + tag + '-cookies.png' });
      await acceptNotice(page);
      g = await geometry(page);
      // Em telas baixas o formulário de compra já começa no rodapé: o botão sai de cima dele (de propósito) e volta ao rolar para além do formulário.
      for (let i = 0; i < 12 && g.count === 1 && !g.fab; i++) { await page.mouse.wheel(0, 300); await wait(page, 250); g = await geometry(page); if (g.fab) info(tag + ': escondido sobre o formulário de compra no topo, visível após rolar ' + (i + 1) * 300 + ' px'); }
      check(tag + ': um único botão, canto inferior esquerdo, selo 2', g.count === 1 && g.fab && g.fab.left <= 24 && g.badge === '2', JSON.stringify(g.fab));
      check(tag + ': não cobre WhatsApp, Ajuda, CTA fixo nem cookies', g.hits.length === 0, g.hits.join(','));
      check(tag + ': nada nosso passa da largura; navbar e formulário de compra intactos', g.overflow <= 0 && g.form && g.navbar, JSON.stringify({ overflow: g.overflow, inkOverflow: g.pageOverflow, form: g.form, navbar: g.navbar }));
      await page.screenshot({ path: OUT + tag + '-fab.png' });
      // Toque REAL no centro do botão, sem a rolagem automática do Playwright (que, numa página mais larga que a tela, desloca o viewport antes de clicar).
      // Se outra coisa estivesse por cima, o painel não abriria e a verificação abaixo falharia.
      const box = await page.locator('#o-promo .o-promo-fab').boundingBox();
      if (vp[0] < 768) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await wait(page, 300);
      const onTop = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? (el.closest('#o-promo') ? 'o-promo' : el.tagName + '#' + el.id) : null; }, [box.x + box.width / 2, box.y + box.height / 2]);
      check(tag + ': o toque no centro do botão chega ao botão (nada por cima)', onTop === 'o-promo', onTop);
      const panel = await page.evaluate(() => { const p = document.getElementById('o-promo-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return { sheet: p.classList.contains('is-sheet'), left: r.left, right: r.right, bottom: r.bottom, top: r.top, titles: [...p.querySelectorAll('h3')].map((h) => h.textContent), copies: p.querySelectorAll('.o-promo-copy').length, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; });
      check(tag + ': painel com os três cards, Copiar só nos cupons, dentro da tela', !!panel && panel.titles.length === 3 && panel.copies === 2 && panel.left >= 0 && panel.right <= Math.max(panel.vw, panel.sw) + 1 && panel.top >= 0, JSON.stringify(panel));
      check(tag + ': folha inferior no celular, cartão no desktop', !!panel && panel.sheet === (vp[0] < 640));
      await page.screenshot({ path: OUT + tag + '-panel.png' });
      await press(page, page.locator('#o-promo-panel .o-promo-copy').first(), vp[0] < 768);
      await wait(page, 200);
      check(tag + ': Copiar copia exatamente LEVEMAIS', (await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === 'LEVEMAIS' && (await page.locator('#o-promo-panel .o-promo-copy').first().textContent()) === 'Copiado');
      await page.keyboard.press('Escape');
      await wait(page, 200);
      check(tag + ': Escape fecha', (await page.locator('#o-promo-panel').count()) === 0);
      // Ajuda aberto (botão nativo da INK) => o nosso sai do caminho; fecha de novo.
      const help = page.locator('[data-controller~="ink-store--help-button"] button').first();
      if (await help.isVisible().catch(() => false)) {
        // O que se verifica aqui é a NOSSA reação ao Ajuda aberto: abrimos o botão nativo pelo DOM. (Em 320/360 a própria INK deixa o Ajuda parcialmente fora
        // da tela, porque a página dela é mais larga que a tela; isso é registrado, não é deste widget.)
        const hb = await help.boundingBox();
        const vis = await page.evaluate(() => ({ w: window.visualViewport ? window.visualViewport.width : innerWidth, h: window.visualViewport ? window.visualViewport.height : innerHeight }));
        if (hb && (hb.x + hb.width > vis.w + 1 || hb.y + hb.height > vis.h + 1)) info(tag + ': o Ajuda da INK passa da área visível (layout da INK mais largo que a tela)');
        await help.evaluate((b) => b.click());
        await wait(page, 400);
        check(tag + ': Ajuda aberto => botão de cupons escondido', await page.locator('#o-promo .o-promo-fab').isHidden());
        await page.keyboard.press('Escape'); await wait(page, 400);
      }
      if (vp[0] < 1024) {
        const burger = page.locator('#menu-hamburger');
        if (await burger.isVisible().catch(() => false)) {
          await press(page, burger, vp[0] < 768); await wait(page, 500);
          check(tag + ': menu aberto => botão de cupons escondido', await page.locator('#o-promo .o-promo-fab').isHidden());
          await page.screenshot({ path: OUT + tag + '-menu.png' });
        }
      }
      // Rolagem longa: continua um único botão e nunca sobre o CTA fixo.
      await page.goto('https://' + store.inkHost + path, { waitUntil: 'domcontentloaded' }); await wait(page, 900);
      await page.mouse.wheel(0, 1800); await wait(page, 500);
      g = await geometry(page);
      check(tag + ': rolagem longa, um botão, sem colisão', g.count <= 1 && g.hits.length === 0, JSON.stringify(g));
      await page.screenshot({ path: OUT + tag + '-scrolled.png' });
    } catch (e) { check(tag + ': sem erro', false, e.message.split('\n').filter((l) => /intercepts|not stable|hidden|visible|Timeout/.test(l)).slice(0, 4).join(' / ')); }
    await s.ctx.close();
  }
  // Fail-open: storefront fora (503) => nada nosso de cupons, o resto da página igual; uma única tentativa.
  const f = await session(store, [390, 844], { promotions: 'fail', mobile: true });
  await open(f.page, 'https://' + store.inkHost + path);
  const g = await geometry(f.page);
  check(id + ': fail-open (503) => nenhum botão, navbar e compra intactos, 1 tentativa', g.count === 0 && g.form && g.navbar && f.page.promoCalls === 1, JSON.stringify({ count: g.count, calls: f.page.promoCalls }));
  await f.ctx.close();
}

await browser.close();
console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' PASS' + (failures.length ? '\nFAIL: ' + failures.join(' | ') : ''));
process.exit(failures.length ? 1 : 0);
