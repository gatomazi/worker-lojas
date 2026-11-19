#!/usr/bin/env node
// Sonda da PDP real da INK no Worker LOCAL (o mesmo worker.js/loader de produção; scripts/lib/tema-harness.mjs): capturas no computador (1440×900) e no celular
// (390×844) dos estados que importam na coluna de compra, mais as medidas da ordem dos blocos, da barra de compra fixa, do aviso de cookies e dos flutuantes.
// Nenhum POST sai (a trava do harness aborta e registra qualquer um); só GETs, numa sessão anônima descartável.
//
//   PW_PATH=<dir com playwright-core> [PREVIEW_PDP=/useorigens/product/<slug>] node scripts/probe-pdp-layout.mjs <dir de capturas> [--sem-tema] [--medidas]
//     --sem-tema  mesmas páginas SEM o tema da PDP (a ordem e o visual nativos da INK)
//     --medidas   imprime também o JSON das medidas (ordem dos blocos, elementos fixos)
//
// Estados: 1-topo (aviso de cookies na tela) · 2-escolhas (aviso na tela: a barra de compra fica ACIMA dele e os flutuantes acima da barra) ·
// 3-escolhido (aviso aceito, modelo + cor + tamanho: botão ativo) · 4-cupons (aviso aceito, "Cupons disponíveis" aberto, logo abaixo do prazo).
import { mkdirSync } from 'node:fs';
import { createHarness, VIEWPORTS } from './lib/tema-harness.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('uso: probe-pdp-layout.mjs <dir de capturas> [--sem-tema] [--medidas]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const PDP = process.env.PREVIEW_PDP || '/useorigens/product/bage-origem-rs';
const H = await createHarness({ themeFeatures: args.includes('--sem-tema') ? '' : 'theme-pdp,theme-cart,theme-checkout,pdp-cep,pdp-coupons' });

const measure = (page) => page.evaluate(() => {
  const top = (e) => Math.round(e.getBoundingClientRect().top + scrollY);
  const col = document.querySelector('[data-buy-column]');
  const order = col ? [...col.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => (c.getAttribute('data-testid') || c.getAttribute('data-ink-labs-anchor') || (c.classList.contains('container-form') ? 'prazo+cupons' : c.querySelector('turbo-frame[id^="variant-selection-"]') ? 'escolhas+botao' : c.className.toString().split(' ')[0] || c.tagName.toLowerCase())) + '@' + top(c)).join(' > ') : null;
  const fixed = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().width > 0 && !e.closest('.cart-drawer'))
    .map((e) => (e.id || e.className || e.tagName).toString().slice(0, 36) + ' top=' + Math.round(e.getBoundingClientRect().top) + ' bottom=' + Math.round(e.getBoundingClientRect().bottom));
  return { vw: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, order, fixed, cookieVar: getComputedStyle(document.documentElement).getPropertyValue('--o-cookie-h') };
});

try {
  for (const vp of VIEWPORTS) {
    const s = await H.session(vp);
    const { page } = s;
    await page.goto(H.HOST + PDP, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    const info = await measure(page);
    console.log('== ' + vp.name, 'largura ' + info.vw + (info.scrollWidth > info.vw ? ' (ROLAGEM HORIZONTAL: ' + info.scrollWidth + ')' : ''), '\n   ordem: ' + info.order);
    if (args.includes('--medidas')) console.log(JSON.stringify(info, null, 1));
    await H.shot(page, dir + '/' + vp.name + '-1-topo.png');
    await page.evaluate(() => document.querySelector('turbo-frame[id^="variant-selection-"]').scrollIntoView({ behavior: 'instant', block: 'start' }));
    await page.waitForTimeout(700);
    await H.shot(page, dir + '/' + vp.name + '-2-escolhas.png');
    await H.acceptCookies(page);
    await page.waitForTimeout(500);
    for (const [step, sel] of [['model', 'a[data-step="model"]'], ['color', 'a[data-step="color"]'], ['size', 'a[data-step="size"][data-value="M"]']]) {
      await page.locator(sel).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(step === 'size' ? 900 : 1600);
    }
    await page.evaluate(() => document.querySelector('turbo-frame[id^="variant-selection-"]').scrollIntoView({ behavior: 'instant', block: 'start' }));
    await page.waitForTimeout(500);
    await H.shot(page, dir + '/' + vp.name + '-3-escolhido.png');
    const toggle = page.locator('.o-cpn-toggle');
    if (await toggle.count()) {
      await toggle.first().scrollIntoViewIfNeeded().catch(() => {});
      await toggle.first().click({ timeout: 5000 }).catch(() => {});
      await page.evaluate(() => { const e = document.querySelector('.o-cep') || document.querySelector('.o-cpn-near'); if (e) e.scrollIntoView({ behavior: 'instant', block: 'center' }); });
      await page.waitForTimeout(600);
      await H.shot(page, dir + '/' + vp.name + '-4-cupons.png');
    }
    await s.ctx.close();
  }
} finally { await H.close(); }
console.log('POSTs bloqueados:', H.blocked.length);
