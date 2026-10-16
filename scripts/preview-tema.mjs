#!/usr/bin/env node
// PRÉVIA do tema da compra na INK (theme-pdp, theme-cart, theme-checkout) em NAVEGADOR REAL contra as páginas REAIS da INK, sem publicar nada:
// o HTML de produto, de casca e das duas telas do checkout passa pelo Worker LOCAL (Miniflare: o mesmo worker.js/HTMLRewriter/loader de produção) e
// /__origens/** é respondido por ele. A configuração do tema vem de um ARQUIVO (o rascunho do painel, exportado com `npm run ink-theme:draft` no
// storefront) e só existe nesta prévia: nenhum cliente real vê nada.
//
//   PW_PATH=<dir com playwright-core> node scripts/preview-tema.mjs --config tema.json [--off] [--checkout <uuid>] [--shots <dir> | --qa | --headed] [--allow-cart]
//     --config    payload v1 (/api/ink-theme/<região>); sem ele, o tema de referência abaixo (o padrão do painel para a Sul)
//     --off       mesma navegação SEM tema (o "antes", com o mesmo Worker e as mesmas features)
//     --checkout  uuid de um carrinho de TESTE para abrir as telas de contato/entrega e pagamento (nunca vai para log nem para captura)
//     --shots     capturas desktop (1440×900) e celular (390×844) das superfícies; campos pessoais do checkout saem MASCARADOS
//     --qa        verificações com número em 360/375/390/768/1440 (rolagem horizontal, alvos de toque, Turbo, barra fixa, Esc, checkout); exit 1 se falhar
//     --headed    abre duas janelas (computador e celular) para navegar à mão; Ctrl+C encerra
//     --allow-cart  libera os POSTs do CARRINHO (adicionar/quantidade/remover) — só para uso manual; o checkout continua bloqueado
// TRAVA: qualquer requisição não-GET para <loja>/checkout é ABORTADA no navegador (nunca chega à INK: nada de pedido, pagamento ou cobrança).
import { mkdirSync, readFileSync } from 'node:fs';
import { createHarness, REFERENCE_THEME, DEFAULT_PDP, VIEWPORTS } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const flag = (n) => argv.includes(n);
const config = opt('--config') ? JSON.parse(readFileSync(opt('--config'), 'utf8')) : REFERENCE_THEME;
const OFF = flag('--off');
const UUID = opt('--checkout');
if (UUID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(UUID)) { console.error('--checkout espera o uuid do carrinho'); process.exit(2); }
const SHOTS = opt('--shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PDP = process.env.PREVIEW_PDP || DEFAULT_PDP;
const H = await createHarness({ config, off: OFF, headed: flag('--headed'), allowCart: flag('--allow-cart') });
const { session, blocked, HOST, store, acceptCookies } = H;
const browser = { close: () => H.close() };
const mf = { dispose: async () => {} };
async function shot(page, file, full = false) {
  if (!SHOTS) return;
  await H.shot(page, SHOTS + '/' + file, full);
}

if (flag('--headed')) {
  for (const vp of VIEWPORTS) { const s = await session(vp); await s.page.goto(HOST + PDP, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
  console.log('Prévia aberta (computador e celular)' + (OFF ? ' SEM tema' : ' COM tema') + '. Checkout: só GET; Ctrl+C encerra.');
  await new Promise(() => {});
}

// --eval <arquivo.js>: imprime o resultado de uma expressão rodada na PDP (medição de QA; nada é clicado).
if (opt('--eval')) {
  const code = readFileSync(opt('--eval'), 'utf8');
  for (const vp of VIEWPORTS) {
    const s = await session(vp);
    await s.page.goto(HOST + (process.env.PREVIEW_PATH || PDP).replace('<uuid>', UUID || ''), { waitUntil: 'networkidle', timeout: 90000 });
    await acceptCookies(s.page); await s.page.waitForTimeout(1500);
    console.log(vp.name, JSON.stringify(await s.page.evaluate(code), null, 1));
    await s.ctx.close();
  }
  await browser.close(); await mf.dispose(); process.exit(0);
}

// --qa: verificações com número (não só capturas). Sai com código 1 se algo falhar.
if (flag('--qa')) {
  const results = [];
  const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
  const widths = [360, 375, 390, 768, 1440];
  for (const width of widths) {
    const s = await session({ name: 'w' + width, width, height: width >= 1024 ? 900 : 800 });
    const { page } = s;
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
    await page.goto(HOST + PDP, { waitUntil: 'networkidle', timeout: 90000 });
    await acceptCookies(page); await page.waitForTimeout(1200);
    // O quadro de variantes é lazy: entra na tela, carrega; depois mede.
    await page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForSelector('form[id^="form-product-"] input[name="size"]', { state: 'attached', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const h = (sel) => { const e = document.querySelector(sel); return e && e.getClientRects().length ? Math.round(e.getBoundingClientRect().height) : null; };
      const labels = [...document.querySelectorAll('form[id^="form-product-"] :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item,.form-product-options__select-type-size-item-disabled) label')].map((l) => Math.round(l.getBoundingClientRect().height));
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, attr: document.body.getAttribute('data-origens-theme'), links: document.querySelectorAll('link[data-origens-theme-css]').length, loaders: document.querySelectorAll('script[data-use-origens-widget]').length, cta: h('#add-to-cart-desk'), minChip: labels.length ? Math.min(...labels) : null, chips: labels.length, font: getComputedStyle(document.body).fontFamily.split(',')[0] };
    });
    const themed = !OFF;
    check(`${width}px PDP sem rolagem horizontal`, m.sw <= m.cw, `${m.sw}/${m.cw}`);
    if (themed) {
      check(`${width}px PDP tema aplicado (atributo, 1 link, 1 loader, fonte)`, m.attr === 'pdp cart' && m.links === 1 && m.loaders === 1 && /Hanken/.test(m.font), JSON.stringify({ attr: m.attr, links: m.links, loaders: m.loaders, font: m.font }));
      check(`${width}px CTA ≥ 44 px`, m.cta >= 44, String(m.cta));
      check(`${width}px seletores ≥ 44 px`, m.chips > 0 && m.minChip >= 44, `${m.chips} chips, menor ${m.minChip}`);
    } else check(`${width}px sem tema quando a feature está desligada`, m.attr === null && m.links === 0, JSON.stringify({ attr: m.attr, links: m.links }));
    if (width === 390 && themed) {
      // Turbo de verdade (Turbo.visit, a API dos links da INK) para outra PDP e volta; o tema e o loader não se multiplicam.
      const href = await page.evaluate((u) => { if (!window.Turbo || typeof window.Turbo.visit !== 'function') return null; window.Turbo.visit(u); return u; }, HOST + '/usesul/product/scharlau-origem-localidade-rs');
      if (href) {
        await page.waitForURL((u) => u.href !== HOST + PDP, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const t = await page.evaluate(() => ({ attr: document.body.getAttribute('data-origens-theme'), links: document.querySelectorAll('link[data-origens-theme-css]').length, loaders: document.querySelectorAll('script[data-use-origens-widget]').length, guides: document.querySelectorAll('[data-origens-guide="invite"]').length, grids: document.querySelectorAll('[data-origens-thumbs]').length, semRecarga: performance.getEntriesByType('navigation')[0].name.includes('florianopolis-legado') }));
        check('Turbo (sem recarregar o documento): outra PDP com 1 tema, 1 link, 1 guia, 1 grade', t.semRecarga && t.attr === 'pdp cart' && t.links === 1 && t.guides <= 1 && t.grids === 1, JSON.stringify(t));
        await page.goBack({ waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(2000);
        const b = await page.evaluate(() => ({ attr: document.body.getAttribute('data-origens-theme'), links: document.querySelectorAll('link[data-origens-theme-css]').length, guides: document.querySelectorAll('[data-origens-guide="invite"]').length }));
        check('Voltar: tema persiste sem duplicar', b.attr === 'pdp cart' && b.links === 1 && b.guides <= 1, JSON.stringify(b));
      }
      // Toque na barra inerte (sem variante) leva o foco à primeira escolha; nenhum POST sai.
      await page.goto(HOST + PDP, { waitUntil: 'networkidle', timeout: 90000 }); await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
      const early = await page.evaluate(() => !document.querySelector('form[id^="form-product-"] input[name="style"]'));
      if (early) {
        await page.evaluate(() => document.querySelector('.form-product-options__add-to-cart-mobile').click());
        await page.waitForSelector('form[id^="form-product-"] input[name="style"]', { state: 'attached', timeout: 20000 }).catch(() => {});
        check('celular: toque na barra antes de o quadro de variantes carregar rola até ele (e ele carrega)', await page.evaluate(() => !!document.querySelector('form[id^="form-product-"] input[name="style"]')));
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
      }
      const bar = await page.evaluate(() => { const b = document.querySelector('.form-product-options__add-to-cart-mobile'); const r = b.getBoundingClientRect(); return { visible: getComputedStyle(b).visibility !== 'hidden' && r.top < innerHeight, inert: document.getElementById('add-to-cart-mob').classList.contains('pointer-events-none') }; });
      check('celular: barra fixa visível com o CTA principal fora da tela', bar.visible, JSON.stringify(bar));
      if (bar.inert) {
        await page.evaluate(() => document.querySelector('.form-product-options__add-to-cart-mobile').click());
        await page.waitForTimeout(900);
        const f = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.name, need: !!document.querySelector('.o-need-choice') }));
        check('celular: toque na barra sem variante leva o foco à escolha que falta', f.focus === 'style' && f.need, JSON.stringify(f));
      }
      await page.evaluate(() => document.getElementById('add-to-cart-desk').scrollIntoView({ block: 'center', behavior: 'instant' })); await page.waitForTimeout(600);
      const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.form-product-options__add-to-cart-mobile')).visibility === 'hidden');
      check('celular: barra fixa some com o CTA principal à vista (um CTA só)', hidden);
      // Carrinho: abre pelo ícone nativo, Esc fecha pelo "X" nativo.
      await page.evaluate(() => document.getElementById('shopping-cart-menu-mob')?.click()); await page.waitForTimeout(1200);
      const open = await page.evaluate(() => !!document.querySelector('.cart-drawer.open'));
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      const closed = await page.evaluate(() => !document.querySelector('.cart-drawer.open'));
      check('carrinho: abre pelo ícone e Esc fecha (controle nativo)', open && closed, JSON.stringify({ open, closed }));
    }
    // Scripts inline da INK re-executados pelo Turbo redeclaram `const` ("Identifier 'buttons'/'eventIDViewContent' has already been declared"): acontece
    // IGUAL com o tema desligado (verificado), então é registrado como nativo e não conta como erro nosso.
    const nativeTurbo = errors.filter((e) => /Identifier '(buttons|eventIDViewContent)' has already been declared/.test(e));
    const ours = errors.filter((e) => !nativeTurbo.includes(e));
    if (nativeTurbo.length) console.log(`INFO ${width}px erros NATIVOS da INK após visita Turbo (também sem tema): ${[...new Set(nativeTurbo)].join(' | ')}`);
    check(`${width}px sem erro de JS que não seja da própria INK`, ours.length === 0, ours.join(' | '));
    if (UUID) {
      for (const step of ['contact_and_shipping_details', 'payment_methods']) {
        await page.goto(`${HOST}${store.inkBase}/checkout/${step}/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await page.waitForTimeout(800);
        const c = await page.evaluate(() => {
          const fields = [...document.querySelectorAll('[data-controller="ink-store--checkout"] :is(input[type="text"],input[type="email"],input[type="tel"],select)')].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height));
          const btn = [...document.querySelectorAll('[data-controller="ink-store--checkout"] button')].filter((b) => b.getClientRects().length && /pagamento|finalizar/i.test(b.textContent || '')).map((b) => Math.round(b.getBoundingClientRect().height));
          return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, attr: document.body.getAttribute('data-origens-theme'), loaders: document.querySelectorAll('script[data-use-origens-widget]').length, minField: fields.length ? Math.min(...fields) : null, fields: fields.length, btn };
        });
        const label = step === 'payment_methods' ? 'pagamento' : 'contato/entrega';
        check(`${width}px checkout ${label} sem rolagem horizontal`, c.sw <= c.cw, `${c.sw}/${c.cw}`);
        if (themed) {
          check(`${width}px checkout ${label}: tema só CSS (sem loader)`, c.attr === 'checkout' && c.loaders === 0, JSON.stringify({ attr: c.attr, loaders: c.loaders }));
          if (c.fields) check(`${width}px checkout ${label}: campos ≥ 44 px`, c.minField >= 44, `${c.fields} campos, menor ${c.minField}`);
          check(`${width}px checkout ${label}: botão de seguir ≥ 44 px e numa linha só (≤ 60 px)`, c.btn.length > 0 && Math.min(...c.btn) >= 44 && Math.max(...c.btn) <= 60, JSON.stringify(c.btn));
        }
      }
    }
    await s.ctx.close();
  }
  console.log('INFO trava do checkout/carrinho: ' + (blocked.length ? blocked.length + ' requisição(ões) não-GET abortada(s) no navegador: ' + blocked.join(' | ') : 'nenhuma requisição não-GET foi tentada'));
  console.log(results.filter(Boolean).length + '/' + results.length + ' PASS');
  await browser.close(); await mf.dispose(); process.exit(results.every(Boolean) ? 0 : 1);
}

const tag = OFF ? 'antes' : 'depois';
for (const vp of VIEWPORTS) {
  const s = await session(vp);
  const { page } = s;
  await page.goto(HOST + PDP, { waitUntil: 'networkidle', timeout: 90000 });
  await acceptCookies(page); await page.waitForTimeout(1500);
  await shot(page, `${tag}-pdp-${vp.name}.png`);
  await shot(page, `${tag}-pdp-${vp.name}-inteira.png`, true);
  // Variantes: escolhe modelo e tamanho pelos rádios NATIVOS (só a seleção, sem adicionar) para mostrar os estados.
  await page.evaluate(() => { const m = document.querySelector('input[name="style"][value="Masculino"]'); m && m.click(); });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const z = document.querySelector('input[name="size"][value="M"]'); z && z.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.form-product-options__select-type')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  await shot(page, `${tag}-pdp-variantes-${vp.name}.png`);
  // Carrinho vazio (abre pelo ícone nativo; sem POST).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate((m) => document.getElementById(m ? 'shopping-cart-menu-mob' : 'shopping-cart-menu-desk')?.click(), s.mobile);
  await page.waitForTimeout(1500);
  await shot(page, `${tag}-carrinho-vazio-${vp.name}.png`);
  if (UUID) {
    for (const step of ['contact_and_shipping_details', 'payment_methods']) {
      await page.goto(`${HOST}${store.inkBase}/checkout/${step}/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(1200);
      await shot(page, `${tag}-checkout-${step === 'payment_methods' ? 'pagamento' : 'contato'}-${vp.name}.png`, true);
    }
  }
  await s.ctx.close();
}
console.log('capturas:', SHOTS || '(nenhuma)', '· requisições bloqueadas pela trava:', blocked.length ? blocked.join(' | ') : 'nenhuma');
await browser.close(); await mf.dispose();
