#!/usr/bin/env node
// MATRIZ DE ESTADOS do tema da compra (auditoria antes/depois): abre cada componente da PDP, do carrinho e do checkout nas páginas REAIS da INK (Worker
// local, harness de preview-tema), fotografa e mede. Nada é comprado: o carrinho não recebe POST (abortado) e o checkout é só GET — os cliques em rádios
// do pagamento são do lado do navegador e qualquer POST que eles disparem é ABORTADO pela trava (fica registrado em "bloqueadas").
//   PW_PATH=… node scripts/estados-tema.mjs --out <dir> [--config tema.json] [--off] [--checkout <uuid de teste>]
// Saída: <dir>/*.png (campos pessoais mascarados) e <dir>/estados.json (componente, ação, estado, viewport, medidas, observação).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHarness, REFERENCE_THEME, DEFAULT_PDP, VIEWPORTS } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('--out'); if (!OUT) { console.error('--out <dir>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const config = opt('--config') ? JSON.parse(readFileSync(opt('--config'), 'utf8')) : REFERENCE_THEME;
const UUID = opt('--checkout');
const PDP = process.env.PREVIEW_PDP || DEFAULT_PDP;
const H = await createHarness({ config, off: argv.includes('--off') });
const rows = [];
const row = (vp, componente, acao, estado, medida = {}, obs = '', arquivo = null) => { rows.push({ viewport: vp, componente, acao, estado, medida, obs, arquivo }); console.log(`[${vp}] ${componente} · ${acao} → ${estado}${obs ? ' — ' + obs : ''}`); };
const wait = (p, ms) => p.waitForTimeout(ms);
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const esc = (p) => p.keyboard.press('Escape');
const shot = async (p, vp, name, full = false) => { const f = `${vp}-${name}.png`; await H.shot(p, `${OUT}/${f}`, full); return f; };

for (const vp of VIEWPORTS) {
  const v = vp.name;
  const s = await H.session(vp);
  const { page } = s;
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(H.HOST + PDP, { waitUntil: 'networkidle', timeout: 90000 });
  await H.acceptCookies(page); await wait(page, 1500);

  // ── Cabeçalho e faixa superior ──
  const head = await page.evaluate(() => {
    // A palavra VISÍVEL (há uma no cabeçalho do computador e outra no do celular; a outra fica escondida pela própria INK).
    const word = [...document.querySelectorAll('.o-nav-word')].find((w) => { const r = w.getBoundingClientRect(); return r.width > 2 && r.height > 2; }) || null;
    const wr = word ? word.getBoundingClientRect() : null;
    const logo = document.querySelector('.navbar__top .o-nav-logo img, .o-nav-logo img');
    const header = document.querySelector('.header');
    return { wordVisible: !!wr && wr.width > 2 && wr.height > 2, wordFont: word ? getComputedStyle(word).fontFamily.slice(0, 40) : null, logoH: logo ? Math.round(logo.getBoundingClientRect().height) : null, headerH: header ? Math.round(header.getBoundingClientRect().height) : null };
  });
  row(v, 'Cabeçalho', 'carregar a PDP', head.wordVisible ? 'símbolo + nome' : 'só o símbolo', head, '', await shot(page, v, '01-pdp-topo'));
  // Faixa superior: amostra a cada 150 ms por 9 s quantas mensagens estão visíveis ao mesmo tempo e se os retângulos se cruzam.
  const strip = await page.evaluate(async () => {
    const bar = document.querySelector('.header-benefits'); if (!bar) return null;
    const items = [...bar.children]; let maxVisible = 0; let overlapFrames = 0; let frames = 0; const samples = [];
    for (let i = 0; i < 60; i++) {
      const vis = items.filter((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return parseFloat(c.opacity) > 0.15 && c.visibility !== 'hidden' && r.width > 0 && r.right > 0 && r.left < innerWidth; });
      const rs = vis.map((e) => e.getBoundingClientRect());
      let ov = false; for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) if (rs[a].left < rs[b].right && rs[b].left < rs[a].right) ov = true;
      frames++; if (ov) overlapFrames++; maxVisible = Math.max(maxVisible, vis.length);
      if (i % 10 === 0) samples.push(vis.map((e) => (e.textContent || '').trim().slice(0, 18) + '@' + parseFloat(getComputedStyle(e).opacity).toFixed(2)).join(' | '));
      await new Promise((r) => setTimeout(r, 150));
    }
    return { items: items.length, maxVisible, overlapFrames, frames, anim: getComputedStyle(items[0] || bar).animationName + ' ' + getComputedStyle(items[0] || bar).transitionProperty, samples };
  });
  row(v, 'Faixa superior (INK)', 'observar 9 s de animação', strip ? (strip.overlapFrames ? `sobreposição em ${strip.overlapFrames}/${strip.frames} quadros` : 'sem sobreposição') : 'ausente', strip || {});

  // ── Altura antes da imagem e galeria ──
  const fold = await page.evaluate(() => {
    const g = document.querySelector('.section-product-v2 ul.aspect-square'); const r = g ? g.getBoundingClientRect() : null;
    const dots = document.querySelectorAll('.section-product-v2 button[id^="dot-image-"]').length;
    const active = [...document.querySelectorAll('.section-product-v2 button[id^="dot-image-"]')].map((b) => b.className).filter((c, i, a) => a.indexOf(c) === i).slice(0, 3);
    return { galleryTop: r ? Math.round(r.top + scrollY) : null, galleryH: r ? Math.round(r.height) : null, galleryW: r ? Math.round(r.width) : null, dots, dotClasses: active, images: document.querySelectorAll('.section-product-v2 ul.aspect-square > li').length };
  });
  row(v, 'Galeria', 'carregar', `${fold.images} imagens, ${fold.dots} pontos`, fold);

  // ── Variantes ──
  await page.evaluate(() => document.getElementById('product_variants_options_frame')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForSelector('form[id^="form-product-"] input[name="size"]', { state: 'attached', timeout: 20000 }).catch(() => {});
  await wait(page, 800);
  row(v, 'Seletores', 'abrir o quadro (sem escolha)', 'nenhum selecionado', {}, '', await shot(page, v, '02-variantes-inicial'));
  const img0 = await page.evaluate(() => [...document.querySelectorAll('.section-product-v2 ul.aspect-square img')].find((i) => i.getBoundingClientRect().width > 0 && i.closest('li') && getComputedStyle(i.closest('li')).display !== 'none')?.currentSrc?.slice(-30));
  await click(page, 'input[name="style"][value="Masculino"]'); await wait(page, 1800);
  const colors = await page.evaluate(() => [...document.querySelectorAll('input[name="color"]')].map((c) => c.value));
  if (colors[1]) { await page.evaluate((c) => document.querySelector('input[name="color"][value="' + c + '"]').click(), colors[1]); await wait(page, 1800); }
  await click(page, 'input[name="size"][value="M"]'); await wait(page, 1200);
  const after = await page.evaluate(() => ({ variant: document.querySelector('input[name="product_variant_id"]')?.value, price: document.querySelector('form[id^="form-product-"] .text-4xl')?.textContent.trim(), checked: [...document.querySelectorAll('form[id^="form-product-"] input[type="radio"]:checked')].map((r) => r.name + '=' + r.value), img: [...document.querySelectorAll('.section-product-v2 ul.aspect-square img')].find((i) => i.getBoundingClientRect().width > 0 && getComputedStyle(i.closest('li')).display !== 'none')?.currentSrc?.slice(-30) }));
  row(v, 'Seletores', `modelo Clássica + cor ${colors[1] || '?'} + M`, after.variant && after.variant !== '-1' ? 'variante resolvida' : 'variante pendente', { ...after, imgBefore: img0 }, after.img !== img0 ? 'imagem trocou com a cor' : 'imagem NÃO trocou', await shot(page, v, '03-variantes-escolhidas'));
  // Troca que invalida tamanho: 4G na Clássica e depois Baby Look (a Baby Look não tem 4G em várias peças).
  const has4G = await click(page, 'input[name="size"][value="4G"]:not([disabled])'); await wait(page, 1200);
  await click(page, 'input[name="style"][value="Feminino"]'); await wait(page, 2000);
  const inval = await page.evaluate(() => ({ size: document.querySelector('input[name="size"]:checked')?.value || null, has4G: !!document.querySelector('input[name="size"][value="4G"]'), disabled4G: !!document.querySelector('input[name="size"][value="4G"][disabled]'), variant: document.querySelector('input[name="product_variant_id"]')?.value, price: document.querySelector('form[id^="form-product-"] .text-4xl')?.textContent.trim() }));
  row(v, 'Seletores', '4G na Clássica → Baby Look', inval.size ? `tamanho ${inval.size} mantido` : 'tamanho limpo pela INK', { has4GClassica: has4G, ...inval }, '', await shot(page, v, '04-troca-invalida-tamanho'));

  // ── Medidas, flutuantes ──
  await page.evaluate(() => document.getElementById('open-modal-size')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 700);
  const sizeRow = await page.evaluate(() => {
    const r = (e) => e ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height), right: Math.round(x + width) }))(e.getBoundingClientRect()) : null;
    const guide = document.getElementById('open-modal-size'); const fit = document.querySelector('button[data-origens-fit]');
    const help = document.querySelector('[data-controller~="ink-store--help-button"]'); const wa = document.getElementById('o-wa-fab');
    const hit = (a, b) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.y + b.h && b.y < a.y + a.h;
    const R = { guide: r(guide), fit: r(fit), help: help && help.getClientRects().length ? r(help) : null, wa: wa && !wa.hidden && wa.getClientRects().length ? r(wa) : null };
    const trunc = (e) => e ? [...e.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1) || e.scrollWidth > e.clientWidth + 1 : false;
    return { ...R, helpCoversFit: hit(R.help, R.fit) || hit(R.wa, R.fit), helpCoversGuide: hit(R.help, R.guide) || hit(R.wa, R.guide), fitTruncated: trunc(fit), guideTruncated: trunc(guide) };
  });
  row(v, 'Guia/Informar medidas + flutuantes', 'rolar até os links de medidas', sizeRow.helpCoversFit || sizeRow.helpCoversGuide ? 'flutuante COBRE ação de medidas' : 'sem sobreposição', sizeRow, sizeRow.fitTruncated ? '"Informar medidas" truncado' : '', await shot(page, v, '05-medidas-flutuantes'));
  if (await click(page, '#open-modal-size')) { await wait(page, 1200); row(v, 'Guia de medidas (modal INK)', 'abrir', (await visible(page, '.modal-size-product')) ? 'aberto' : 'não abriu', {}, '', await shot(page, v, '06-modal-medidas')); await click(page, '#modal-size-close'); await esc(page); await wait(page, 600); }
  if (await click(page, 'button[data-origens-fit]')) { await wait(page, 900); row(v, 'Informar medidas (nosso)', 'abrir', (await visible(page, '#o-fit')) ? 'aberto' : 'não abriu', {}, '', await shot(page, v, '07-informar-medidas')); await esc(page); await wait(page, 600); }
  // ── Também disponível em, prazo, cupons, zoom ──
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(page, 400);
  const cluster = await rect(page, 'form[id^="form-product-"] [data-controller="ink-store--modal"] .no-scrollbar');
  row(v, '"Também disponível em"', 'carregar', cluster ? `em y=${cluster.y}` : 'ausente', cluster || {});
  if (await click(page, '#cheapest-estimate-button')) { await wait(page, 1500); row(v, 'Prazo de entrega (modal INK)', 'abrir', (await visible(page, '#delivery-estimates-modal')) ? 'aberto' : 'não abriu', {}, 'só aberto; nenhum CEP enviado', await shot(page, v, '08-modal-prazo')); await esc(page); await click(page, '#delivery-estimates-modal button[data-action*="hide"], #delivery-estimates-modal [data-modal-hide]'); await wait(page, 600); }
  if (await page.evaluate(() => { const a = [...document.querySelectorAll('#product_promotions_frame a')].find((x) => /cupons/i.test(x.textContent)); if (a) { a.click(); return true; } return false; })) { await wait(page, 1500); row(v, 'Cupons (modal INK)', 'abrir', (await visible(page, '#product-promotions-modal')) ? 'aberto' : 'não abriu', {}, '', await shot(page, v, '09-modal-cupons')); await esc(page); await page.evaluate(() => document.querySelector('#product-promotions-modal button')?.click()); await wait(page, 600); }
  if (await page.evaluate(() => { const i = document.querySelector('.section-product-v2 [data-controller="ink-store--zoom-image"]'); if (!i) return false; i.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })) {
    const g = await rect(page, '.section-product-v2 ul.aspect-square');
    if (g && !s.mobile) { await page.mouse.click(g.x + g.w / 2, g.y + g.h / 2); await wait(page, 900); row(v, 'Galeria (zoom INK)', 'clicar na imagem', 'zoom', {}, '', await shot(page, v, '10-zoom')); await page.mouse.move(5, 5); await page.mouse.click(5, 300); await wait(page, 500); }
  }
  // ── Carrinho vazio ──
  await page.evaluate(() => window.scrollTo(0, 0));
  await click(page, s.mobile ? '#shopping-cart-menu-mob' : '#shopping-cart-menu-desk'); await wait(page, 1800);
  const cart = await page.evaluate(() => { const d = document.querySelector('.cart-drawer'); const blocks = [...document.querySelectorAll('.cart-drawer .empty-cart > *')].map((e) => (e.getAttribute('data-origens-discovery') ? 'NOSSO:' : 'INK:') + (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)); return { open: !!document.querySelector('.cart-drawer.open'), width: d ? Math.round(d.getBoundingClientRect().width) : null, blocks }; });
  row(v, 'Carrinho vazio', 'abrir pelo ícone', cart.open ? 'aberto' : 'fechado', cart, '', await shot(page, v, '11-carrinho-vazio'));
  await esc(page); await wait(page, 600);
  row(v, 'Carrinho com itens / pós-adição', 'adicionar item', 'BLOQUEADO', {}, 'POST /usesul/cart abortado pela trava; adicionar ao carrinho real foi negado pela política de permissões na rodada 1 (não contornado)');
  if (errors.length) row(v, 'Página', 'erros de JS', errors.length + ' erro(s)', { errors });

  // ── Checkout (GET; rádios clicados no navegador com POST abortado) ──
  if (UUID) {
    await page.goto(`${H.HOST}${H.store.inkBase}/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1000);
    const c = await page.evaluate(() => ({ logo: (() => { const i = document.querySelector('nav.bg-store-primary img'); return i ? Math.round(i.getBoundingClientRect().height) : null; })(), brandText: !!document.querySelector('[data-origens-brand]'), sw: document.documentElement.scrollWidth }));
    row(v, 'Checkout contato/entrega', 'abrir (GET)', 'carregado', c, '', await shot(page, v, '20-checkout-contato', true));
    await page.focus('#inputEmail').catch(() => {}); await wait(page, 300);
    row(v, 'Checkout contato/entrega', 'foco no e-mail (sem digitar)', 'foco', { focus: await page.evaluate(() => document.activeElement?.id) }, '', await shot(page, v, '21-checkout-foco'));
    await page.goto(`${H.HOST}${H.store.inkBase}/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1000);
    const bar = await page.evaluate(() => [...document.querySelectorAll('[data-controller="ink-store--checkout"] button')].filter((b) => b.getClientRects().length && /finalizar/i.test(b.textContent || '')).map((b) => { const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight) || 18; return { cls: String(b.className).slice(0, 60), h: Math.round(r.height), w: Math.round(r.width), lines: Math.round((b.scrollHeight - parseFloat(getComputedStyle(b).paddingTop) - parseFloat(getComputedStyle(b).paddingBottom)) / lh) }; }));
    row(v, 'Pagamento', 'abrir (GET)', 'carregado', { finalizar: bar }, '', await shot(page, v, '22-pagamento', true));
    await click(page, '#credit_card'); await wait(page, 900);
    const card = await page.evaluate(() => ({ cardOpen: (() => { const e = document.getElementById('content-credit_card'); return !!e && e.getBoundingClientRect().height > 0; })(), fields: [...document.querySelectorAll('#content-credit_card input:not([type=hidden]), #content-credit_card select')].filter((e) => e.getClientRects().length).map((e) => e.id + ':' + Math.round(e.getBoundingClientRect().height)) }));
    row(v, 'Pagamento', 'escolher Cartão (clique no navegador)', card.cardOpen ? 'campos do cartão abertos' : 'não abriu', card, 'campos vazios; nada digitado', await shot(page, v, '23-pagamento-cartao', true));
    await page.focus('#card_number').catch(() => {}); await wait(page, 300);
    const err = await page.evaluate(() => [...document.querySelectorAll('#content-credit_card small')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim().slice(0, 40)));
    row(v, 'Pagamento', 'foco no número do cartão vazio', err.length ? 'mensagem de campo visível' : 'sem mensagem', { err }, '', await shot(page, v, '24-pagamento-cartao-erro'));
    await click(page, '#pix'); await wait(page, 1200);
    row(v, 'Pagamento', 'escolher Pix (clique no navegador)', (await visible(page, '#content-pix')) ? 'detalhes do Pix abertos' : 'não abriu', {}, 'o POST de desconto que o clique dispara é ABORTADO (não chega à INK)', await shot(page, v, '25-pagamento-pix', true));
    await click(page, '#billing_address_equal_shipping_address'); await wait(page, 900);
    const bill = await page.evaluate(() => { const f = document.querySelector('[data-controller="ink-store--checkout--address"].hidden, form[action*="billing_address"]'); const box = document.querySelector('form[action*="billing_address"]')?.closest('[data-controller="ink-store--checkout--address"]'); return { shown: !!box && !box.classList.contains('hidden') && box.getBoundingClientRect().height > 0 }; });
    row(v, 'Pagamento', 'desmarcar "endereço de cobrança igual"', bill.shown ? 'endereço de cobrança aberto' : 'não abriu', bill, 'campos vazios; nada digitado', await shot(page, v, '26-pagamento-cobranca', true));
  }
  await s.ctx.close();
}
writeFileSync(`${OUT}/estados.json`, JSON.stringify({ geradoEm: new Date().toISOString(), tema: argv.includes('--off') ? 'desligado' : 'ligado', bloqueadas: H.blocked, linhas: rows }, null, 2));
console.log('requisições bloqueadas pela trava:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
await H.close();
