#!/usr/bin/env node
// AJUSTES FINAIS (carrinho, incentivo, rodapé): capturas e medidas ANTES/DEPOIS nas mesmas dimensões, com a MESMA gaveta reconstruída.
//   --fase depois  o código atual (cupom recolhido, "Continuar comprando" em texto, incentivo do theme-ui com a regra de EXEMPLO publicada)
//   --fase antes   rode a partir de um worktree do código anterior (sem cart-incentive no deploy); o incentivo de lá era a proposta desenhada à mão
// A gaveta é reconstruída com a marcação que o JS e o CSS públicos da INK confirmam (#quantity-header, #coupon-form/cart[coupon][code], alvos do
// ink-store--cart, classes .cart-drawer__footer__*) e injetada na PDP REAL; adicionar ao carrinho real segue recusado. Nada é enviado à INK.
//   PW_PATH=… node scripts/ajustes-finais.mjs --fase depois --out <dir> [--checkout <uuid de teste>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHarness, DEFAULT_PDP, REFERENCE_THEME } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FASE = opt('--fase'); const OUT = opt('--out'); const UUID = opt('--checkout');
if (!['antes', 'depois'].includes(FASE) || !OUT) { console.error('uso: --fase antes|depois --out <dir> [--checkout <uuid>]'); process.exit(2); }
const AFTER = FASE === 'depois';
// Regra de EXEMPLO (a frase da faixa da INK): só para a simulação; no fluxo real ela só existe se o dono confirmar no painel.
const RULE = { enabled: true, kind: 'free-shipping', unit: 'items', threshold: 2, ufs: ['PR', 'SC', 'RS'] };
const H = await createHarness({ config: AFTER ? { ...REFERENCE_THEME, incentive: RULE } : REFERENCE_THEME, themeFeatures: 'theme-pdp,theme-cart,theme-checkout' + (AFTER ? ',cart-incentive' : ''), sanitize: !!UUID });
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const composer = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const wait = (p, ms) => p.waitForTimeout(ms);
const rows = []; const metrics = [];
const SIM = 'SIMULAÇÃO VISUAL — integração não validada';
const SAN = 'SIMULAÇÃO VISUAL — estrutura real do checkout da INK, dados fictícios';
const TAG = AFTER ? 'DEPOIS' : 'ANTES';

async function labeled(buffer, file, label, detail) {
  const p = await composer.newPage({ viewport: { width: 800, height: 200 } });
  const width = buffer.readUInt32BE(16); const fs = Math.max(15, Math.round(width / 52));
  await p.setContent(`<body style="margin:0;background:#fff"><div id="w" style="display:inline-block;width:${width}px"><div style="font:700 ${fs}px/1.3 system-ui;background:${AFTER ? '#b42318' : '#5b5b5b'};color:#fff;padding:${Math.round(fs * 0.55)}px ${Math.round(fs * 0.8)}px">${TAG} · ${label}<span style="font-weight:500;opacity:.92"> · ${detail}</span></div><img src="data:image/png;base64,${buffer.toString('base64')}" style="display:block"></div></body>`);
  await p.waitForTimeout(80);
  const box = await p.evaluate(() => { const r = document.getElementById('w').getBoundingClientRect(); return { width: r.width, height: r.height }; });
  await p.setViewportSize({ width: Math.ceil(box.width), height: Math.min(Math.ceil(box.height), 16000) });
  await p.locator('#w').screenshot({ path: file }); // só o bloco (faixa + tela): sem costura de página inteira
  await p.close();
}
async function shot(page, folder, name, label, detail, opts = {}) {
  if (opts.fullPage) await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) { if (getComputedStyle(el).position === 'fixed' && el.querySelector('button') && el.getBoundingClientRect().bottom >= innerHeight - 2 && el.getBoundingClientRect().height < 200) { el.dataset.oCaptureStatic = el.getAttribute('style') || ''; el.style.position = 'static'; } } });
  const buffer = await page.screenshot(opts);
  if (opts.fullPage) await page.evaluate(() => { for (const el of document.querySelectorAll('[data-o-capture-static]')) { el.setAttribute('style', el.dataset.oCaptureStatic); delete el.dataset.oCaptureStatic; } });
  mkdirSync(`${OUT}/${folder}`, { recursive: true });
  const file = `${OUT}/${folder}/${TAG}_${label === SAN ? 'SIMULACAO-VISUAL_checkout-dados-ficticios' : 'SIMULACAO-VISUAL'}_${name}.png`;
  await labeled(buffer, file, label, detail);
  rows.push({ folder, file: file.slice(OUT.length + 1), detail });
}

// ── Gaveta reconstruída (mesma nas duas fases) ──
const ITEMS = [
  { name: 'Florianópolis | Legado SC', variant: ['Preta', 'Clássica | Unissex', 'M'], price: 109.9, qty: 1 },
  { name: 'Balneário Camboriú | Território SC — Edição Litoral Catarinense', variant: ['Branca', 'Baby Look | Feminina', 'P'], price: 109.9, qty: 1 },
  { name: 'Grande Florianópolis · 048', variant: ['Preta', 'Clássica | Unissex', 'G'], price: 109.9, qty: 2 },
  { name: 'Made in Santa Catarina', variant: ['Preta', 'Clássica | Unissex', 'GG'], price: 109.9, qty: 1 },
  { name: 'Lá da Scharlau', variant: ['Verde', 'Clássica | Unissex', '3G'], price: 109.9, qty: 1 }
];
const money = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
function cartHtml(items, imgs, { coupon = 'vazio', shipping = '' } = {}) {
  const units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
  const discount = coupon === 'aplicado' ? 25 : 0;
  const li = (it, i) => '<li class="main-list__item"><img src="' + imgs[i % imgs.length] + '" alt="Imagem do produto"><div class="item-wrapper"><header class="item-header"><div class="item-details">' +
    '<p>' + it.name + '</p>' + it.variant.map((v) => '<span>' + v + '</span>').join('') + '</div><div class="price-details"><div class="price"><span>' + money(it.price * it.qty) + '</span></div></div></header>' +
    '<div class="item-details__footer"><form data-turbo="true" action="#" method="post" onsubmit="return false"><div class="item-details__quantity" id="quantity-buttons"><button type="button" aria-label="Remover">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>' +
    '<input class="quantity-input" type="text" value="' + it.qty + '" readonly><button type="button" aria-label="Aumentar">+</button></div></form></div></div></li>';
  const couponRow = '<div class="cart-drawer__footer__coupon flex items-center justify-between"><label for="coupon">Cupom</label><form id="coupon-form" action="#" method="post" data-turbo="true" onsubmit="return false" class="flex items-center gap-2">' +
    '<input class="coupon-input" id="coupon" name="cart[coupon][code]" placeholder="CUPOM" value="' + (coupon === 'aplicado' || coupon === 'erro' ? (coupon === 'erro' ? 'CUPOMX' : 'LEVEMAIS') : '') + '">' +
    (coupon === 'aplicado' ? '<button type="button" class="btn-apply" data-action="ink-store--cart#clearCoupon" aria-label="Remover cupom">✕</button>' : '<button type="button" class="btn-apply" data-action="ink-store--cart#addCoupon" aria-label="Aplicar">→</button>') + '</form></div>';
  const cepRow = '<div class="cart-drawer__footer__cep flex items-center justify-between"><span>Frete</span>' +
    (shipping ? '<span class="font-medium">' + shipping + '</span>' : '<a href="#" onclick="return false" data-action="ink-store--cart#insertCep" class="underline">Inserir CEP</a>') +
    '<div class="hidden" data-ink-store--cart-target="cepInputContainer"><input class="cep-input" name="cep"></div></div>';
  const errors = coupon === 'erro' ? '<div data-ink-store--cart-target="cartErrors" class="text-red-500 text-sm font-medium px-4 py-2">Cupom inválido ou expirado.</div>' : '';
  const total = subtotal - discount + (/R\$/.test(shipping) ? 27.49 : 0);
  return '<div data-controller="ink-store--cart ink-store--progress-bar" data-ink-store--progress-bar-max-progress-value="0" data-ink-store--progress-bar-progress-value="0" class="flex flex-col h-full">' +
    '<header class="cart-drawer__header"><div class="top-header flex p-3"><span>Carrinho <span id="quantity-header" class="text-gray-500 font-normal text-xs" data-quantityheader="' + units + '">(' + units + (units === 1 ? ' produto' : ' produtos') + ')</span></span>' +
    '<div class="flex items-center justify-end"><svg id="cart-drawer-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div></div></header>' +
    '<div class="cart-drawer__main bg-gray-50"><ul class="main-list flex flex-col w-full">' + items.map(li).join('') + '</ul></div>' +
    '<div class="cart-drawer__footer">' + errors + couponRow + cepRow +
    '<div class="footer-details"><ul><li><span>Subtotal</span><span id="amount">' + money(subtotal) + '</span></li>' + (discount ? '<li><span>Desconto</span><span class="text-green-600">−' + money(discount) + '</span></li>' : '') + '<li><span>Total</span><span>' + money(total) + '</span></li></ul><small class="self-end">ou 5x de ' + money(total / 5) + '</small></div>' +
    '<form data-turbo="false" action="#" method="post" onsubmit="return false"><button id="checkout-btn" type="button" class="bg-store-button text-base text-store-button-font font-medium w-full py-3 rounded-full">Finalizar compra</button></form>' +
    '<button type="button" class="cart-drawer__footer__keep-shopping w-full py-3 mt-2">Continuar comprando</button></div></div>';
}
// A proposta desenhada à mão da rodada anterior (só na fase "antes", para comparar com o incentivo de verdade).
const OLD_INCENTIVE_CSS = '.o-incentive{display:flex;flex-direction:column;gap:6px;margin:0 0 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--o-selected) 35%,transparent);border-radius:var(--o-radius);background:color-mix(in srgb,var(--o-selected) 6%,#fff);color:var(--o-ink);font:500 14px/1.35 var(--o-font)}.o-incentive p{margin:0}.o-incentive-bar{height:4px;border-radius:2px;background:color-mix(in srgb,var(--o-selected) 18%,#fff);overflow:hidden}.o-incentive-bar i{display:block;height:100%;background:var(--o-selected)}';
const oldIncentive = (units) => units < 2 ? '<div class="o-incentive"><p>Falta <strong>1 peça</strong> para a condição de frete grátis no Sul (PR, SC e RS).</p><div class="o-incentive-bar"><i style="width:50%"></i></div></div>' : '<div class="o-incentive"><p><strong>Condição de 2 peças atingida.</strong> Informe o CEP para verificar o frete grátis.</p></div>';

async function openCart(page, mobile, html, { oldIncentiveFor = null } = {}) {
  await page.evaluate(({ html, css, inc }) => {
    if (inc !== null && !document.getElementById('o-old-inc')) { const s = document.createElement('style'); s.id = 'o-old-inc'; s.textContent = css; document.head.appendChild(s); }
    document.querySelector('turbo-frame#cart').innerHTML = html;
    if (inc) document.querySelector('.cart-drawer__footer').insertAdjacentHTML('afterbegin', inc);
  }, { html, css: OLD_INCENTIVE_CSS, inc: oldIncentiveFor === null ? null : oldIncentive(oldIncentiveFor) });
  await page.evaluate((m) => { window.scrollTo(0, 0); if (!document.querySelector('.cart-drawer.open')) document.getElementById(m ? 'shopping-cart-menu-mob' : 'shopping-cart-menu-desk')?.click(); }, mobile);
  await wait(page, 1500);
}
const measure = (page) => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
  const main = document.querySelector('.cart-drawer__main');
  const items = [...document.querySelectorAll('.cart-drawer li.main-list__item')];
  const mr = main.getBoundingClientRect();
  const fully = items.filter((li) => { const b = li.getBoundingClientRect(); return b.top >= mr.top - 1 && b.bottom <= mr.bottom + 1; }).length;
  const touch = [...document.querySelectorAll('.cart-drawer .cart-drawer__footer button, .cart-drawer .cart-drawer__footer a, .cart-drawer .item-details__quantity button')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map((e) => Math.round(Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)));
  const btn = document.getElementById('checkout-btn').getBoundingClientRect();
  return { rodape: r('.cart-drawer__footer'), lista: Math.round(mr.height), itensInteiros: fully, menorToque: touch.length ? Math.min(...touch) : null, finalizarVisivel: btn.top >= 0 && btn.bottom <= innerHeight, finalizarAltura: Math.round(btn.height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});

const VPS = [
  { folder: 'mobile', name: '390', width: 390, height: 844 },
  { folder: 'mobile/360', name: '360', width: 360, height: 740 },
  { folder: 'desktop/1280x640', name: '1280x640', width: 1280, height: 640 },
  { folder: 'desktop', name: '1440', width: 1440, height: 900 }
];
for (const vp of VPS) {
  const s = await H.session(vp); const { page } = s;
  const mobile = vp.width < 600; const tag = vp.name.includes('x') ? vp.name.replace('x', '×') : vp.name + ' px';
  await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1200);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('.section-product-v2 ul.aspect-square img')].map((i) => i.getAttribute('src')).filter(Boolean));
  const pick = [imgs[0], imgs[4], imgs[1], imgs[2], imgs[13] || imgs[3]];
  const record = async (estado) => { const m = await measure(page); metrics.push({ fase: FASE, viewport: vp.name, estado, ...m }); console.log(`[${FASE} ${vp.name}] ${estado}`, JSON.stringify(m)); };
  const inc = (n) => (AFTER ? {} : { oldIncentiveFor: n });

  // Rodapé sem incentivo (comparação limpa) e com incentivo (o real depois; a proposta desenhada antes).
  if (AFTER) await page.evaluate(() => document.body.removeAttribute('data-origens-incentive'));
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick)); await record('1 item, sem incentivo');
  await shot(page, vp.folder, '01-carrinho-1-item_sem-incentivo', SIM, `1 item, cupom ${AFTER ? 'recolhido' : 'aberto (como era)'}, sem incentivo · ${tag}`);
  await openCart(page, mobile, cartHtml(ITEMS, pick)); await record('6 peças, sem incentivo');
  await shot(page, vp.folder, '02-carrinho-6-pecas_topo_sem-incentivo', SIM, `5 linhas / 6 peças, topo, sem incentivo · ${tag}`);
  if (AFTER) await page.evaluate((v) => document.body.setAttribute('data-origens-incentive', v), '2|PR,SC,RS');
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick), inc(1)); await record('1 item, com incentivo');
  await shot(page, vp.folder, '03-carrinho-1-item_incentivo-falta-1-peca', SIM, `incentivo antes da condição (regra de EXEMPLO: 2 peças, PR/SC/RS) · ${tag}`);
  await openCart(page, mobile, cartHtml(ITEMS, pick), inc(6)); await record('6 peças, com incentivo');
  await shot(page, vp.folder, '04-carrinho-6-pecas_topo_incentivo-cep-pendente', SIM, `meta atingida, CEP pendente · topo da lista · ${tag}`);
  await page.evaluate(() => { const el = document.querySelector('.cart-drawer__main'); el.scrollTop = el.scrollHeight; }); await wait(page, 400);
  await shot(page, vp.folder, '05-carrinho-6-pecas_fim-da-lista', SIM, `fim da lista: último item inteiro e descoberta depois dos itens · ${tag}`);
  if (vp.name === '390' || vp.name === '360' || AFTER) {
    await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, { shipping: 'Grátis' }), inc(2));
    await shot(page, vp.folder, '06-carrinho-frete-gratis-confirmado', SIM, `INK mostra "Grátis" para o CEP informado (texto reconstruído) · ${tag}`);
    await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, { shipping: 'R$ 27,49' }), inc(2));
    await shot(page, vp.folder, '07-carrinho-cep-com-frete-pago', SIM, `meta atingida, mas a INK cobra frete para o CEP: sem mensagem de sucesso · ${tag}`);
    await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick), inc(1));
    await shot(page, vp.folder, '08-carrinho-item-removido_volta-a-faltar', SIM, `depois de remover: volta a faltar 1 peça · ${tag}`);
  }
  // Cupom: fechado (padrão), aberto pelo cliente, aplicado, erro.
  if (AFTER) {
    await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick));
    const btn = await page.$('.cart-drawer .o-coupon-toggle');
    if (btn) { await btn.click(); await wait(page, 300); }
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    console.log(`[${FASE} ${vp.name}] cupom aberto: foco em #${focused}`);
    await shot(page, vp.folder, '09-cupom-aberto', SIM, `cupom aberto pelo cliente ("Adicionar cupom"), foco no campo da INK · ${tag}`);
  }
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 3), pick, { coupon: 'aplicado' }), inc(4));
  await shot(page, vp.folder, '10-cupom-aplicado', SIM, `cupom aplicado (código e remover à mostra; desconto no total) · ${tag}`);
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 3), pick, { coupon: 'erro' }), inc(4));
  await shot(page, vp.folder, '11-cupom-com-erro', SIM, `erro de cupom (mensagem reconstruída): o campo fica à mostra · ${tag}`);
  await page.evaluate(() => { document.querySelector('.cart-drawer')?.classList.remove('open'); document.querySelector('turbo-frame#cart').innerHTML = ''; });

  // Checkout (só na fase depois): composição preservada, dados fictícios.
  if (AFTER && UUID && (vp.name === '390' || vp.name === '1440')) {
    await page.goto(`${H.HOST}${H.store.inkBase}/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1000);
    await shot(page, vp.folder, '20-checkout-contato-e-entrega', SAN, `contato e entrega · ${tag}`, { fullPage: true });
    await page.goto(`${H.HOST}${H.store.inkBase}/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1000);
    await page.evaluate(() => document.getElementById('credit_card')?.click()); await wait(page, 800);
    await shot(page, vp.folder, '21-checkout-pagamento-cartao', SAN, `pagamento, cartão aberto (campos vazios; o POST de desconto foi abortado) · ${tag}`, { fullPage: true });
  }
  await s.ctx.close();
}

// Custo de abrir o carrinho REAL (vazio) na PDP real: requisições e tamanho do loader, nas mesmas condições.
const s = await H.session({ name: 'custo', width: 1440, height: 900 }); const { page } = s;
const reqs = []; page.on('request', (r) => reqs.push(r.url()));
await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1500);
const loaderBytes = await page.evaluate(async () => { const src = document.querySelector('script[data-use-origens-widget]').src; const r = await fetch(src); return (await r.text()).length; });
reqs.length = 0;
await page.evaluate(() => document.getElementById('shopping-cart-menu-desk')?.click()); await wait(page, 2000);
const custo = { fase: FASE, loaderBytes, requisicoesAoAbrirCarrinho: reqs.length, urls: reqs.map((u) => new URL(u).pathname).slice(0, 10) };
console.log('custo', JSON.stringify(custo));
await s.ctx.close();

writeFileSync(`${OUT}/medidas-${FASE}.json`, JSON.stringify({ geradoEm: new Date().toISOString(), fase: FASE, medidas: metrics, custo, capturas: rows, bloqueadas: H.blocked }, null, 1));
console.log('requisições bloqueadas pela trava:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
await composer.close(); await H.close();
