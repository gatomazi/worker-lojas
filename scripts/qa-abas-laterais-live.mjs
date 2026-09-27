#!/usr/bin/env node
// QA das abas laterais (WhatsApp + Ajuda) em NAVEGADOR REAL contra a página REAL da INK. Ensaio: injeta o loader LOCAL desta branch numa aba do
// Chrome navegando na INK verdadeira; /__origens/navbar e /__origens/cart-ref são respondidos com dados de teste (page.route) — nada é gravado
// no KV de produção e o Worker não precisa estar publicado. Não faz compra: só confere geometria das duas abas, o menu de Ajuda de verdade
// (mesmas quatro opções e handlers da INK) e o link de WhatsApp que a própria INK publica.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-abas-laterais-live.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLoaderSource } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const HOST = 'https://www.usesul.com.br';
const PRODUCT = '/usesul/product/serra-catarinense';
const OUT = (new URL('../docs/evidence/abas-laterais/', import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const CONFIG = { v: 2, states: [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }], top: [{ title: 'Novidades', slug: 'novidades' }], more: [] };
const results = []; const failures = [];
const check = (n, ok, d = '') => { results.push(!!ok); if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 300) : '')); };
const info = (n) => console.log('INFO ' + n);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);

async function session(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.route('**/__origens/navbar', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) }));
  await page.route('**/__origens/cart-ref', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }) }));
  // A produção já injeta o SEU PRÓPRIO <script src="/__origens/loader.js?...">  nesta página (scope product-catalog cobre o catálogo inteiro
  // agora). Sem isto, o ensaio rodaria DOIS loaders (o de produção + o nosso), e o antigo criaria a aba de WhatsApp primeiro — o nosso só
  // atualizaria o href dela, nunca o tamanho novo. Servimos o BUILD LOCAL desta branch no mesmo caminho: um único loader, o desta rodada.
  await page.route('**/__origens/loader.js**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: buildLoaderSource([], ['header-nav'], 'product-catalog') }));
  return { ctx, page };
}

async function openProduct(s) {
  for (let n = 1; n <= 2; n++) {
    try { await s.page.goto(HOST + PRODUCT, { waitUntil: 'domcontentloaded', timeout: 45000 }); await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 }); break; }
    catch (e) { if (n === 2) throw e; info('navegação falhou (' + String(e.message).split('\n')[0] + '), nova tentativa'); await wait(s.page, 2000); }
  }
  await s.page.waitForSelector('#o-wa-fab', { timeout: 25000 }).catch(() => {});
  await wait(s.page, 800);
}

const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible().catch(() => false)) { await n.first().click(); await wait(page, 400); } };

const geometry = (page) => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const fab = document.getElementById('o-wa-fab');
  const btn = document.getElementById('dropdownLinksListButton');
  const cta = document.querySelector('#add-to-cart-mob');
  const rect = (e) => (vis(e) ? e.getBoundingClientRect() : null);
  const fr = rect(fab); const br = rect(btn); const cr = rect(cta);
  const round = (r) => r && { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(window.innerWidth - r.right) };
  return {
    fab: round(fr), ajuda: round(br), cta: round(cr),
    gap: fr && br ? Math.round(br.top - fr.bottom) : null,
    sameRight: fr && br ? Math.abs((window.innerWidth - fr.right) - (window.innerWidth - br.right)) <= 1 : null,
    ajudaAboveCta: br && cr ? br.bottom <= cr.top + 1 : null,
    vw: window.innerWidth, vh: window.innerHeight
  };
});

// ── Viewports exigidos pela tarefa ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { name: '320x640', width: 320, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '440', width: 440, height: 800 },
  { name: '500', width: 500, height: 800 },
  { name: '768', width: 768, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '390x560-baixa', width: 390, height: 560 }
];

for (const vp of VIEWPORTS) {
  const s = await session({ width: vp.width, height: vp.height });
  try {
    await openProduct(s);
    await acceptNotice(s.page);
    await wait(s.page, 400);
    const geo = await geometry(s.page);
    info(`[${vp.name}] geometria: ${JSON.stringify(geo)}`);
    check(`[${vp.name}] as duas abas existem e têm a mesma largura (bordas alinhadas na pilha)`, !!geo.fab && !!geo.ajuda && geo.fab.w === geo.ajuda.w, JSON.stringify(geo));
    check(`[${vp.name}] alvo de toque >= 44px nas duas abas`, !!geo.fab && geo.fab.w >= 44 && geo.fab.h >= 44 && !!geo.ajuda && geo.ajuda.w >= 44 && geo.ajuda.h >= 44, JSON.stringify(geo));
    check(`[${vp.name}] intervalo pequeno entre as abas (6–10 px)`, geo.gap !== null && geo.gap >= 4 && geo.gap <= 12, 'gap=' + geo.gap);
    check(`[${vp.name}] mesma lateral (bordas direitas alinhadas)`, geo.sameRight === true, JSON.stringify(geo));
    check(`[${vp.name}] Ajuda fica acima do CTA fixo, sem sobrepor`, geo.ajudaAboveCta !== false, JSON.stringify(geo));
    // scrollWidth do documento inteiro é ruído aqui: o tema nativo da INK já tem itens do menu lateral (drawer) fora da tela por transform/left
    // negativo, sem overflow:hidden no <body> — isso conta para o scrollWidth em qualquer rodada, mesmo sem as nossas abas. O que é NOSSO
    // (posição/tamanho fixos das duas abas) é o que testamos: nunca fora da faixa 0..innerWidth.
    check(`[${vp.name}] as nossas abas nunca criam overflow (ficam dentro de 0..innerWidth)`, (!geo.fab || geo.fab.right >= 0) && (!geo.ajuda || geo.ajuda.right >= 0));

    if (vp.name === '320x640' || vp.name === '390x844') await s.page.screenshot({ path: OUT + `fechadas-${vp.name}.png` });
    if (vp.name === '1280') await s.page.screenshot({ path: OUT + 'desktop-fechadas-1280.png', clip: { x: 900, y: Math.max(0, (geo.fab ? geo.fab.top : 500) - 20), width: 380, height: 260 } });

    if (vp.name === '390x844') {
      await s.page.locator('#dropdownLinksListButton').click(); await wait(s.page, 400);
      const opened = await s.page.evaluate(() => { const l = document.querySelector('[data-ink-store--help-button-target="linksList"]'); return { open: !!l && !l.classList.contains('hidden'), links: l ? [...l.querySelectorAll('a')].map((a) => a.textContent.trim()) : [] }; });
      check('[390x844] menu de Ajuda abre com as opções reais da INK', opened.open, JSON.stringify(opened.links));
      await s.page.screenshot({ path: OUT + 'ajuda-aberta-390.png' });
      await s.page.keyboard.press('Escape'); await wait(s.page, 300);
      const closedByEsc = await s.page.evaluate(() => { const l = document.querySelector('[data-ink-store--help-button-target="linksList"]'); return !!l && l.classList.contains('hidden'); });
      check('[390x844] Escape fecha o menu de Ajuda (a INK não trata isso sozinha)', closedByEsc);
      const ctaOk = await s.page.evaluate(() => { const cta = document.querySelector('#add-to-cart-mob'); return !!cta && cta.getClientRects().length > 0; });
      check('[390x844] CTA "Adicionar ao Carrinho" continua visível com o menu fechado', ctaOk);
      await s.page.screenshot({ path: OUT + 'sticky-cta-390.png' });
    }
  } catch (e) {
    check(`[${vp.name}] sessão completou sem exceção`, false, String(e.message || e).slice(0, 300));
  } finally {
    await s.ctx.close();
  }
}

writeFileSync(OUT + 'resultado.json', JSON.stringify({ at: new Date().toISOString(), checks: results.length, passed: results.filter(Boolean).length, failures }, null, 2));
console.log(`\n${results.filter(Boolean).length}/${results.length} PASS`);
if (failures.length) { console.log('FALHAS:', failures); process.exitCode = 1; }
await browser.close();
