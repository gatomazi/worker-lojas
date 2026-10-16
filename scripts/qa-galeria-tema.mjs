#!/usr/bin/env node
// QA da GALERIA COM MINIATURAS e da ORDEM DE FOCO (rodada 3) nas páginas REAIS da INK, pelo Worker local (harness de preview-tema). Só cliques do lado do
// navegador e GETs; nada é adicionado ao carrinho (POST abortado pela trava).
//   PW_PATH=… node scripts/qa-galeria-tema.mjs [--config tema.json] [--shots <dir>]
// Exit 1 se algo falhar.
import { mkdirSync, readFileSync } from 'node:fs';
import { createHarness, REFERENCE_THEME } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const SHOTS = opt('--shots'); if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const H = await createHarness({ config: opt('--config') ? JSON.parse(readFileSync(opt('--config'), 'utf8')) : REFERENCE_THEME });
const PRODUCTS = [
  { name: 'muitas (17)', path: '/usesul/product/florianopolis-legado-sc-b88373a3-9f47-418d-a6b4-f27757ac3fa4' },
  { name: 'muitas (19)', path: '/usesul/product/scharlau-origem-localidade-rs' },
  { name: 'poucas (3)', path: '/usesul/product/florianopolis-legado-sc-32f02051-5f2c-4acf-b977-358ee2d55acb' },
  { name: 'poucas (5)', path: '/usesul/product/florianopolis-legado-sc-1d635aca-6559-428c-a5e0-5c58150d2f59' }
];
const PRODUCTS0 = PRODUCTS[0].path;
const VIEWPORTS = [{ name: '360', width: 360, height: 740 }, { name: '375', width: 375, height: 812 }, { name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }, { name: '1440-baixa', width: 1440, height: 680 }];
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + String(detail).slice(0, 260) : '')); };
const wait = (p, ms) => p.waitForTimeout(ms);
const state = (page) => page.evaluate(() => {
  const dots = [...document.querySelectorAll('.section-product-v2 button[id^="dot-image-"]')];
  const thumbs = [...document.querySelectorAll('[data-origens-thumbs] .o-thumb')];
  return { dots: dots.length, dot: dots.findIndex((d) => d.getAttribute('aria-current') === 'true'), thumbs: thumbs.length, thumb: thumbs.findIndex((t) => t.getAttribute('aria-current') === 'true'), grids: document.querySelectorAll('[data-origens-thumbs]').length };
});

for (const vp of VIEWPORTS) {
  const s = await H.session(vp);
  const { page } = s;
  for (const [pi, product] of PRODUCTS.entries()) {
    if (pi > 1 && !['390', '1440'].includes(vp.name)) continue; // poucas fotos: 390 e 1440 bastam
    const tag = `${vp.name} ${product.name}`;
    await page.goto(H.HOST + product.path, { waitUntil: 'networkidle', timeout: 90000 });
    await H.acceptCookies(page); await wait(page, 1200);
    const m = await page.evaluate(() => {
      const thumbs = [...document.querySelectorAll('[data-origens-thumbs] .o-thumb')];
      const rects = thumbs.map((t) => t.getBoundingClientRect());
      const slides = [...document.querySelectorAll('.section-product-v2 ul.aspect-square > li img')].map((i) => i.getAttribute('src'));
      const grid = document.querySelector('[data-origens-thumbs]');
      const cols = rects.length ? new Set(rects.map((r) => Math.round(r.top))).size : 0;
      return {
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        n: thumbs.length, slides: slides.length, sameSrc: thumbs.every((t, i) => t.querySelector('img')?.getAttribute('src') === slides[i]),
        minW: rects.length ? Math.round(Math.min(...rects.map((r) => r.width))) : 0, minH: rects.length ? Math.round(Math.min(...rects.map((r) => r.height))) : 0,
        rows: cols, perRow: rects.length ? rects.filter((r) => Math.round(r.top) === Math.round(rects[0].top)).length : 0,
        gridOverflow: grid ? grid.scrollWidth > grid.clientWidth + 1 : false, dotsHidden: getComputedStyle(document.querySelector('.section-product-v2 ul.absolute.z-30')).visibility === 'hidden',
        labels: thumbs.slice(0, 1).map((t) => t.getAttribute('aria-label'))
      };
    });
    check(`${tag}: todas as fotos viram miniaturas (mesmas URLs, ordem nativa)`, m.n === m.slides && m.n >= 2 && m.sameSrc, JSON.stringify({ n: m.n, slides: m.slides, label: m.labels[0] }));
    check(`${tag}: grade sem rolagem lateral, ${m.perRow} por linha em ${m.rows} linha(s), alvo ≥ 44×44`, !m.gridOverflow && m.minW >= 44 && m.minH >= 44 && m.sw <= m.cw, JSON.stringify({ minW: m.minW, minH: m.minH, sw: m.sw, cw: m.cw }));
    check(`${tag}: pontos nativos fora de cena só com a grade montada`, m.dotsHidden && m.n > 0);
    // Primeira, intermediária e última por clique; a principal (ponto nativo) e a miniatura acompanham.
    for (const i of [0, Math.floor(m.n / 2), m.n - 1]) {
      await page.evaluate((k) => document.querySelectorAll('[data-origens-thumbs] .o-thumb')[k].click(), i);
      await wait(page, 750);
      const st = await state(page);
      check(`${tag}: clique na miniatura ${i + 1} mostra a foto ${i + 1}`, st.dot === i && st.thumb === i, JSON.stringify(st));
    }
    if (pi === 0) {
      // Seta nativa (outro controle) e teclado (Enter numa miniatura focada).
      await page.evaluate(() => document.querySelectorAll('[data-origens-thumbs] .o-thumb')[2].click()); await wait(page, 700);
      await page.evaluate(() => document.querySelector('button[aria-label="Proxima imagem"]').click()); await wait(page, 800);
      let st = await state(page);
      check(`${tag}: seta nativa → a miniatura acompanha`, st.dot === 3 && st.thumb === 3, JSON.stringify(st));
      await page.focus('[data-origens-thumbs] .o-thumb:nth-child(6)'); await page.keyboard.press('Enter'); await wait(page, 800);
      st = await state(page);
      check(`${tag}: teclado (foco + Enter) na miniatura 6`, st.dot === 5 && st.thumb === 5, JSON.stringify(st));
      const focusRing = await page.evaluate(() => { const b = document.activeElement; const c = getComputedStyle(b); return b.classList.contains('o-thumb') && c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2; });
      check(`${tag}: foco visível na miniatura`, focusRing);
      // Swipe na imagem principal (eventos de toque sintéticos, só no celular).
      if (s.mobile) {
        const before = (await state(page)).dot;
        await page.evaluate(() => { const ul = document.querySelector('.section-product-v2 ul.aspect-square'); const r = ul.getBoundingClientRect(); const y = r.top + r.height / 2; const t = (x) => new Touch({ identifier: 1, target: ul, clientX: x, clientY: y }); ul.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(r.right - 30)], changedTouches: [t(r.right - 30)] })); ul.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(r.left + 30)], changedTouches: [t(r.left + 30)] })); ul.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(r.left + 30)] })); });
        await wait(page, 900);
        const after = await state(page);
        check(`${tag}: swipe na foto (toque sintético) — miniatura acompanha o que a INK fizer`, after.dot === after.thumb, JSON.stringify({ before, after: after.dot, thumb: after.thumb, moved: after.dot !== before }));
      }
      // Foto intermediária escolhida e DEPOIS troca de modelo/cor: a INK pula para a foto da variante; a miniatura acompanha; a variante é a dos rádios.
      await page.evaluate(() => document.querySelectorAll('[data-origens-thumbs] .o-thumb')[8].click()); await wait(page, 700);
      await page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForSelector('input[name="style"]', { state: 'attached', timeout: 20000 }).catch(() => {});
      await page.evaluate(() => document.querySelector('input[name="style"][value="Masculino"]')?.click()); await wait(page, 1800);
      await page.evaluate(() => document.querySelector('input[name="color"][value="Branca"]')?.click()); await wait(page, 1800);
      st = await state(page);
      const radios = await page.evaluate(() => [...document.querySelectorAll('form[id^="form-product-"] input[type=radio]:checked')].map((r) => r.name + '=' + r.value).join(','));
      check(`${tag}: foto 9 → Clássica + Branca: a INK pula para a foto da variante e a miniatura acompanha`, st.dot === st.thumb && st.dot !== 8 && /style=Masculino/.test(radios) && /color=Branca/.test(radios), JSON.stringify({ ...st, radios }));
      if (vp.width >= 1024) {
        // Zoom nativo e retorno (computador; a galeria só é fixa a partir de 1024 px).
        const g = await page.evaluate(() => { const r = document.querySelector('.section-product-v2 ul.aspect-square').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.click(g.x, g.y); await wait(page, 800);
        await page.mouse.click(g.x, g.y); await wait(page, 600);
        st = await state(page);
        check(`${tag}: zoom nativo e retorno sem perder a seleção`, st.dot === st.thumb && st.grids === 1, JSON.stringify(st));
        // Desktop baixo: as últimas miniaturas são alcançáveis com a galeria fixa (rola até o fim da coluna de compra).
        await page.evaluate(() => window.scrollTo(0, document.querySelector('.section-details').getBoundingClientRect().bottom + scrollY - innerHeight));
        await wait(page, 500);
        const last = await page.evaluate(() => { const t = [...document.querySelectorAll('[data-origens-thumbs] .o-thumb')].pop(); const r = t.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, galTop: getComputedStyle(document.body).getPropertyValue('--o-gal-top') }; });
        check(`${tag}: última miniatura alcançável com a galeria fixa`, last.bottom <= last.vh && last.top >= 0, JSON.stringify(last));
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-fim-da-coluna.png` });
      }
      // Ordem de foco na coluna de compra: Tab a partir do primeiro rádio de modelo até passar do CTA.
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('input[name="style"]').focus(); });
      const seq = [];
      for (let k = 0; k < 40; k++) {
        const d = await page.evaluate(() => { const e = document.activeElement; if (!e) return '?'; if (e.name === 'style' || e.name === 'color' || e.name === 'size') return 'radio:' + e.name; if (e.id === 'open-modal-size') return 'guia'; if (e.matches('button[data-origens-fit]')) return 'informar'; if (e.closest('.inline-flex.items-center.px-3')) return 'quantidade'; if (e.id === 'add-to-cart-desk') return 'cta'; if (e.id === 'cheapest-estimate-button') return 'prazo'; if (e.closest('#product_promotions_frame')) return 'cupons'; if (e.closest('form[id^="form-product-"] > [data-controller="ink-store--modal"]')) return 'outros-tipos'; return 'outro'; });
        if (seq[seq.length - 1] !== d) seq.push(d);
        if (d === 'outros-tipos') break;
        await page.keyboard.press('Tab');
      }
      // "Ver cupons disponíveis" é um <a> da INK SEM href: não recebe foco nem na INK nativa (limitação registrada, não um erro de ordem).
      const cuponsFocavel = await page.evaluate(() => { const a = [...document.querySelectorAll('#product_promotions_frame a')].find((x) => /cupons/i.test(x.textContent)); return !!a && (a.hasAttribute('href') || a.hasAttribute('tabindex')); });
      const want = ['radio:style', 'radio:color', 'radio:size', 'guia', 'informar', 'quantidade', 'cta', 'prazo', ...(cuponsFocavel ? ['cupons'] : []), 'outros-tipos'];
      const idx = want.map((w) => seq.indexOf(w));
      check(`${tag}: Tab segue a ordem visual (modelo › cor › tamanho › medidas › quantidade › CTA › prazo › ${cuponsFocavel ? 'cupons › ' : ''}outros tipos)`, idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]), seq.join(' › ') + (cuponsFocavel ? '' : ' · "Ver cupons" da INK não é focável (sem href)'));
      if (SHOTS) {
        await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);
        await page.evaluate(() => document.querySelectorAll('[data-origens-thumbs] .o-thumb')[4].click()); await wait(page, 800);
        const box = await page.evaluate(() => { const r = document.querySelector('.section-product-v2').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y + scrollY - 8), width: Math.min(document.documentElement.clientWidth, r.width + 16), height: r.height + 16 }; });
        await page.screenshot({ path: `${SHOTS}/${vp.name}-galeria-${product.name.replace(/\W+/g, '')}.png`, clip: box, fullPage: true });
      }
    } else if (SHOTS && ['390', '1440'].includes(vp.name)) {
      const box = await page.evaluate(() => { const r = document.querySelector('.section-product-v2').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y + scrollY - 8), width: Math.min(document.documentElement.clientWidth, r.width + 16), height: r.height + 16 }; });
      await page.screenshot({ path: `${SHOTS}/${vp.name}-galeria-${product.name.replace(/\W+/g, '')}.png`, clip: box, fullPage: true });
    }
  }
  // Turbo para outro produto (link de recomendação) e voltar/avançar: uma grade só, com as fotos DO produto atual.
  if (['390', '1440'].includes(vp.name)) {
    await page.goto(H.HOST + PRODUCTS[0].path, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1000);
    // Visita TURBO de verdade (Turbo.visit, a API dos links da INK), não uma carga inteira.
    const href = await page.evaluate((u) => { if (!window.Turbo || typeof window.Turbo.visit !== 'function') return null; window.Turbo.visit(u); return u; }, H.HOST + PRODUCTS[1].path);
    if (href) {
      await page.waitForURL((u) => !u.href.endsWith(PRODUCTS0), { timeout: 30000 }).catch(() => {});
      await wait(page, 2500);
      const a = await page.evaluate(() => ({ grids: document.querySelectorAll('[data-origens-thumbs]').length, first: document.querySelector('[data-origens-thumbs] .o-thumb img')?.getAttribute('src'), slide: document.querySelector('.section-product-v2 ul.aspect-square > li img')?.getAttribute('src'), turbo: !!window.Turbo, path: location.pathname }));
      const viaTurbo = await page.evaluate(() => performance.getEntriesByType('navigation').length === 1 && performance.getEntriesByType('navigation')[0].name.includes('florianopolis-legado'));
      check(`${vp.name}: Turbo para outra PDP (sem recarregar o documento) — uma grade, com as fotos do produto novo`, viaTurbo && a.grids === 1 && a.first === a.slide && a.path !== PRODUCTS[0].path, JSON.stringify({ ...a, viaTurbo, first: a.first?.slice(-20), slide: a.slide?.slice(-20) }));
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => {}); await wait(page, 2000);
      const b = await page.evaluate(() => ({ grids: document.querySelectorAll('[data-origens-thumbs]').length, first: document.querySelector('[data-origens-thumbs] .o-thumb img')?.getAttribute('src'), slide: document.querySelector('.section-product-v2 ul.aspect-square > li img')?.getAttribute('src'), sel: [...document.querySelectorAll('[data-origens-thumbs] .o-thumb')].filter((t) => t.getAttribute('aria-current') === 'true').length }));
      check(`${vp.name}: voltar (restauração do cache do Turbo) — uma grade, fotos do produto certo, uma seleção`, b.grids === 1 && b.first === b.slide && b.sel === 1, JSON.stringify({ ...b, first: b.first?.slice(-20), slide: b.slide?.slice(-20) }));
      await page.goForward({ waitUntil: 'networkidle' }).catch(() => {}); await wait(page, 2000);
      const c = await page.evaluate(() => ({ grids: document.querySelectorAll('[data-origens-thumbs]').length, first: document.querySelector('[data-origens-thumbs] .o-thumb img')?.getAttribute('src'), slide: document.querySelector('.section-product-v2 ul.aspect-square > li img')?.getAttribute('src') }));
      check(`${vp.name}: avançar — uma grade, fotos do produto certo`, c.grids === 1 && c.first === c.slide, JSON.stringify({ grids: c.grids }));
      await page.reload({ waitUntil: 'networkidle' }); await wait(page, 1500);
      const d = await page.evaluate(() => document.querySelectorAll('[data-origens-thumbs]').length);
      check(`${vp.name}: atualizar a página — uma grade`, d === 1, String(d));
    }
  }
  await s.ctx.close();
}
console.log('requisições bloqueadas pela trava:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
console.log(results.filter(Boolean).length + '/' + results.length + ' PASS');
await H.close();
process.exit(results.every(Boolean) ? 0 : 1);
