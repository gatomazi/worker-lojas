#!/usr/bin/env node
// QA de pdp-cep + pdp-coupons em NAVEGADOR REAL contra uma PDP REAL da INK, sem publicar nada:
//   PW_PATH=<dir com playwright-core> [PREVIEW_PDP=<caminho do produto>] node scripts/qa-cep-cupons.mjs [--shots <dir>] [--rapido]
// O HTML do produto passa pelo Worker LOCAL (Miniflare, o mesmo worker.js/loader de produção; scripts/lib/tema-harness.mjs) e o cálculo do prazo vai à
// INK de verdade, numa sessão ANÔNIMA descartável, com CEPs públicos (01001-000 Praça da Sé, 88010-000 Centro de Florianópolis, 00000-000 sem
// entrega). Nenhum POST sai (a trava do harness aborta e registra qualquer um). Com e sem o tema da PDP; 1440×900, 390×844 e 360×740.
import { mkdirSync } from 'node:fs';
import { createHarness, DEFAULT_PDP } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const SHOTS = opt('--shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PDP = process.env.PREVIEW_PDP || DEFAULT_PDP;
const failures = [];
const check = (name, ok, detail = '') => { if (!ok) failures.push(name); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + String(detail).slice(0, 300) : '')); };

async function run({ label, themeFeatures, viewports, shots }) {
  const H = await createHarness({ themeFeatures });
  try {
    for (const vp of viewports) {
      const s = await H.session(vp);
      const { page } = s;
      await s.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: H.HOST });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(H.HOST + PDP, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await H.acceptCookies(page);
      const tag = label + ' ' + vp.name;
      const on = /pdp-cep/.test(themeFeatures);
      if (!on) {
        // "Antes": o nativo, para comparar.
        await page.waitForSelector('#cheapest-estimate-button', { timeout: 30000 });
        await page.locator('#product_promotions_frame').scrollIntoViewIfNeeded();
        await page.waitForSelector('#product_promotions_frame > div.border', { timeout: 30000 });
        await page.evaluate(() => document.getElementById('cheapest-estimate-button').scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(400);
        if (shots) await page.screenshot({ path: shots + '/antes-' + vp.name + '.png' });
        await s.ctx.close();
        continue;
      }
      await page.waitForSelector('.o-cep', { timeout: 30000 });
      const native = await page.evaluate(() => ({ btn: getComputedStyle(document.getElementById('cheapest-estimate-button')).display, modal: document.getElementById('delivery-estimates-modal').classList.contains('hidden') }));
      check(tag + ': o link nativo do modal some com o nosso campo', native.btn === 'none' && native.modal, JSON.stringify(native));
      const input = page.locator('.o-cep-input');
      const box = await input.boundingBox();
      check(tag + ': campo com 48 px e fonte de 16 px (sem zoom no iPhone)', box && box.height >= 44 && (await input.evaluate((el) => getComputedStyle(el).fontSize)) === '16px');
      check(tag + ': teclado numérico e CEP do navegador', (await input.getAttribute('inputmode')) === 'numeric' && (await input.getAttribute('autocomplete')) === 'postal-code');
      await page.evaluate(() => document.querySelector('.o-cep').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(300);
      if (shots) await page.screenshot({ path: shots + '/cep-campo-' + vp.name + '.png' });

      // Incompleto: avisa, não envia.
      await input.fill('8801');
      await input.press('Enter');
      await page.waitForTimeout(200);
      check(tag + ': CEP incompleto avisa sem enviar', /8 números/.test(await page.locator('.o-cep-out').innerText()));
      // Sem entrega.
      await input.fill('00000000');
      check(tag + ': máscara 00000-000', (await input.inputValue()) === '00000-000');
      await page.locator('.o-cep-go').click();
      await page.waitForFunction(() => /Não há entrega/.test(document.querySelector('.o-cep-out')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
      check(tag + ': CEP sem entrega diz que não há entrega', /Não há entrega/.test(await page.locator('.o-cep-out').innerText()));
      // Atendido, pelo Enter (o formulário de compra NÃO pode ser enviado).
      await input.fill('88010000');
      await input.press('Enter');
      await page.waitForSelector('.o-cep[data-state="done"]', { timeout: 20000 }).catch(() => {});
      const out = await page.locator('.o-cep-out').innerText().catch(() => '');
      check(tag + ': prazo na página com CEP e lugar', /CEP 88010-000 · Centro, Florianópolis/.test(out) && /Entrega (até|entre)/.test(out), out.replace(/\n/g, ' | '));
      const after = await page.evaluate(() => ({ url: location.pathname + location.search, drawer: !!document.querySelector('.cart-drawer.open'), modal: document.getElementById('delivery-estimates-modal').classList.contains('hidden'), added: !!document.querySelector('#modal-wrapper') && /Produto adicionado/i.test(document.getElementById('modal-wrapper').textContent || '') }));
      check(tag + ': URL igual, carrinho e modal fechados, nada adicionado', after.url === new URL(H.HOST + PDP).pathname && !after.drawer && after.modal && !after.added, JSON.stringify(after));
      await page.evaluate(() => document.querySelector('.o-cep').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(300);
      if (shots) await page.screenshot({ path: shots + '/cep-prazo-' + vp.name + '.png' });
      // Alterar: volta o campo, preenchido.
      await page.locator('.o-cep-change').click();
      check(tag + ': "Alterar CEP" volta o campo com o último CEP', (await input.isVisible()) && (await input.inputValue()) === '88010-000');
      await input.fill('01001000');
      await page.locator('.o-cep-go').click();
      await page.waitForFunction(() => /01001-000/.test(document.querySelector('.o-cep-where')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
      check(tag + ': segundo cálculo atualiza o prazo', /CEP 01001-000 · Sé, São Paulo/.test(await page.locator('.o-cep-out').innerText().catch(() => '')));

      // Cupons perto do preço: o frame (preguiçoso, lá embaixo) é pedido já; o botão aparece SEM rolar até ele.
      await page.evaluate(() => document.querySelector('[data-ink-labs-anchor="product_price"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForSelector('.o-cpn-near', { timeout: 30000 }).catch(() => {});
      const cpn = await page.evaluate(() => {
        const box = document.querySelector('#product_promotions_frame > div.border');
        const near = document.querySelector('.o-cpn-near');
        return { has: !!near, belowPrice: !!document.querySelector('[data-ink-labs-anchor="product_price"] + .o-cpn-near'), closed: !!near && near.querySelector('.o-cpn').hidden,
          nativeHidden: !!box && getComputedStyle(box).display === 'none', label: near ? near.querySelector('.o-cpn-toggle').textContent.trim() : '', tabs: [...document.querySelectorAll('.o-cpn-tab')].map((t) => t.textContent.trim()) };
      });
      const nativeCoupons = await page.evaluate(() => document.querySelectorAll('#product_promotions_frame [data-controller~="ink-store--clipboard"] input[type="hidden"]').length);
      if (!nativeCoupons) {
        // Produto sem cupom na INK: nada nosso, o frame fica como a INK o deixa.
        check(tag + ': sem cupom na INK, nenhum bloco nosso', !cpn.has, JSON.stringify(cpn));
      } else check(tag + ': "Cupons disponíveis" logo abaixo do preço, fechado, sem rolar; o quadro nativo some', cpn.has && cpn.belowPrice && cpn.closed && cpn.nativeHidden && cpn.tabs.length === nativeCoupons, JSON.stringify(cpn));
      if (cpn.has) {
        await page.waitForTimeout(300);
        if (shots) await page.screenshot({ path: shots + '/cupons-fechado-' + vp.name + '.png' });
        await page.locator('.o-cpn-toggle').click();
        check(tag + ': o botão abre as abas', await page.evaluate(() => !document.getElementById('o-cpn-box').hidden && document.querySelector('.o-cpn-toggle').getAttribute('aria-expanded') === 'true'));
        if (cpn.tabs.length > 1) {
          await page.locator('.o-cpn-tab').nth(1).click();
          const shown = await page.evaluate(() => [...document.querySelectorAll('.o-cpn-panel')].map((p) => !p.hidden));
          check(tag + ': trocar de aba troca o painel', shown[0] === false && shown[1] === true, JSON.stringify(shown));
          await page.locator('.o-cpn-tab').nth(0).click();
        }
        await page.locator('.o-cpn-panel:not([hidden]) .o-cpn-copy').click();
        await page.waitForTimeout(300);
        const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        check(tag + ': "Copiar" copia o código', copied === cpn.tabs[0], copied);
        await page.evaluate(() => document.querySelector('[data-ink-labs-anchor="product_price"]').scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.evaluate(() => window.scrollBy(0, -120));
        await page.waitForTimeout(300);
        if (shots) await page.screenshot({ path: shots + '/cupons-' + vp.name + '.png' });
        if (shots && cpn.tabs.length > 1) {
          await page.locator('.o-cpn-tab').nth(1).click();
          await page.waitForTimeout(200);
          await page.screenshot({ path: shots + '/cupons-progressivo-' + vp.name + '.png' });
        }
      }
      // A PDP nativa SEM tema já rola ~27 px no celular (gaveta fora da tela, conferido em 05/10): aqui vale que os NOSSOS blocos cabem na tela.
      const fit = await page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('.o-cep, .o-cpn-near')].map((el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w }; }); });
      check(tag + ': o prazo e os cupons cabem na largura da tela', fit.length === (cpn.has ? 2 : 1) && fit.every((b) => b.left >= 0 && b.right <= b.w), JSON.stringify(fit));
      check(tag + ': sem erro de script nosso', !errors.some((m) => !/buttons' has already been declared|Identifier 'buttons'/.test(m)), errors.join(' | '));
      await s.ctx.close();
    }
    check(label + ': nenhum POST saiu (trava do harness)', H.blocked.length === 0, H.blocked.join(' | '));
  } finally {
    await H.close();
  }
}

const desktop = { name: 'desktop', width: 1440, height: 900 };
const mobile = { name: 'mobile', width: 390, height: 844 };
const small = { name: 'mobile-360', width: 360, height: 740 };
// --rapido: só com o tema, computador e celular (para conferir outros produtos sem refazer as capturas).
const QUICK = argv.includes('--rapido');
if (!QUICK) await run({ label: 'antes', themeFeatures: 'theme-pdp,theme-cart', viewports: [desktop, mobile], shots: SHOTS });
await run({ label: 'tema', themeFeatures: 'theme-pdp,theme-cart,pdp-cep,pdp-coupons', viewports: QUICK ? [desktop, mobile] : [desktop, mobile, small], shots: SHOTS });
if (!QUICK) await run({ label: 'sem-tema', themeFeatures: 'pdp-cep,pdp-coupons', viewports: [desktop, mobile], shots: SHOTS ? SHOTS + '/sem-tema' : null });
console.log(failures.length ? '\nFALHOU: ' + failures.length + ' verificação(ões)' : '\nTUDO CERTO');
process.exit(failures.length ? 1 : 0);
