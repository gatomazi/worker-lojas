#!/usr/bin/env node
// COMPLEMENTO VISUAL: carrinho preenchido, confirmação pós-adição, incentivo de frete (PROPOSTA) e as telas do checkout, com o tema ATUAL (escopo no
// <body>), em 1440 / 390 / 360 px. Duas origens, ambas marcadas na faixa acima de cada imagem e no nome do arquivo:
//   · Carrinho e pós-adição: SIMULAÇÃO VISUAL sobre a PDP REAL — marcação do carrinho reconstruída a partir do CSS da INK, injetada no turbo-frame#cart
//     (adicionar ao carrinho real foi negado pela política de permissões; nada é enviado à INK).
//   · Checkout: estrutura REAL das duas telas (GET do carrinho de teste do dono) com os dados pessoais SANITIZADOS no harness antes do navegador
//     (sanitizeCheckout: aprende os valores do próprio HTML e troca por fictícios; recusa a captura se sobrar algo). Rádios clicados no navegador; o POST
//     de desconto que eles disparam é ABORTADO pela trava — o total não é recalculado.
//   PW_PATH=… node scripts/complemento-visual.mjs --out <dir> --checkout <uuid de teste>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHarness, DEFAULT_PDP } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('--out'); const UUID = opt('--checkout');
if (!OUT || !UUID) { console.error('uso: --out <dir> --checkout <uuid>'); process.exit(2); }
for (const d of ['desktop/1280x640', 'mobile/360']) mkdirSync(`${OUT}/${d}`, { recursive: true });
const H = await createHarness({ sanitize: true });
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const composer = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const rows = [];
const wait = (p, ms) => p.waitForTimeout(ms);

const SIM = 'SIMULAÇÃO VISUAL — integração não validada';
const SAN = 'SIMULAÇÃO VISUAL — estrutura real do checkout da INK, dados fictícios; integração não validada';
// Faixa ACIMA da captura (não cobre nenhum componente).
async function labeled(buffer, file, label, detail) {
  const p = await composer.newPage({ viewport: { width: 800, height: 200 } });
  const img = 'data:image/png;base64,' + buffer.toString('base64');
  const width = buffer.readUInt32BE(16); // largura do PNG: o rótulo acompanha a escala (as capturas do celular são 2×)
  const fs = Math.max(15, Math.round(width / 52));
  await p.setContent(`<body style="margin:0;background:#fff"><div id="w" style="display:inline-block;width:${width}px"><div style="font:700 ${fs}px/1.3 system-ui;background:#b42318;color:#fff;padding:${Math.round(fs * 0.55)}px ${Math.round(fs * 0.8)}px">${label}<span style="font-weight:500;opacity:.92"> · ${detail}</span></div><img src="${img}" style="display:block"></div></body>`);
  await p.waitForTimeout(100);
  const box = await p.evaluate(() => { const r = document.getElementById('w').getBoundingClientRect(); return { width: r.width, height: r.height }; });
  await p.setViewportSize({ width: Math.ceil(box.width), height: Math.min(Math.ceil(box.height), 16000) });
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
}
let only = null; // telas extras (360, desktop baixo): só os estados em que barra fixa e altura importam
async function shot(page, folder, name, label, detail, opts = {}) {
  if (only && !only.some((p) => name.startsWith(p))) return;
  // Página inteira no celular: a barra fixa do rodapé da INK (Total · Finalizar) congelaria no meio da imagem, cobrindo campos. Só para ESTA captura ela
  // vai para o fim do fluxo da página; depois volta.
  if (opts.fullPage) await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) { if (getComputedStyle(el).position === 'fixed' && el.querySelector('button') && el.getBoundingClientRect().bottom >= innerHeight - 2 && el.getBoundingClientRect().height < 200) { el.dataset.oCaptureStatic = el.getAttribute('style') || ''; el.style.position = 'static'; } } });
  const buffer = await page.screenshot(opts);
  if (opts.fullPage) await page.evaluate(() => { for (const el of document.querySelectorAll('[data-o-capture-static]')) { el.setAttribute('style', el.dataset.oCaptureStatic); delete el.dataset.oCaptureStatic; } });
  const prefix = label === SAN ? 'SIMULACAO-VISUAL_checkout-dados-ficticios' : 'SIMULACAO-VISUAL';
  const file = `${OUT}/${folder}/${prefix}_${name}.png`;
  await labeled(buffer, file, label, detail);
  rows.push({ folder, file: file.slice(OUT.length + 1), label, detail });
}

// ── Carrinho (marcação reconstruída do CSS da INK: .cart-drawer__main .main-list__item .item-wrapper …) ──
const ITEMS = [
  { name: 'Florianópolis | Legado SC', variant: ['Preta', 'Clássica | Unissex', 'M'], price: 'R$ 109,90', qty: 1 },
  { name: 'Balneário Camboriú | Território SC — Edição Litoral Catarinense', variant: ['Branca', 'Baby Look | Feminina', 'P'], price: 'R$ 109,90', qty: 1 },
  { name: 'Grande Florianópolis · 048', variant: ['Preta', 'Clássica | Unissex', 'G'], price: 'R$ 219,80', qty: 2 },
  { name: 'Made in Santa Catarina', variant: ['Preta', 'Clássica | Unissex', 'GG'], price: 'R$ 109,90', qty: 1 },
  { name: 'Lá da Scharlau', variant: ['Verde', 'Clássica | Unissex', '3G'], price: 'R$ 109,90', qty: 1 }
];
const money = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
function cartHtml(items, imgs, incentive) {
  const li = (it, i) => '<li class="main-list__item"><img src="' + imgs[i % imgs.length] + '" alt="Imagem do produto"><div class="item-wrapper"><header class="item-header"><div class="item-details">' +
    '<p>' + it.name + '</p>' + it.variant.map((v) => '<span>' + v + '</span>').join('') + '</div><div class="price-details"><div class="price"><span>' + it.price + '</span></div></div></header>' +
    '<div class="item-details__footer"><form data-turbo="true" action="#" method="post" onsubmit="return false"><div class="item-details__quantity"><button type="button" aria-label="Remover">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>' +
    '<input class="quantity-input" type="text" value="' + it.qty + '" readonly><button type="button" aria-label="Aumentar">+</button></div></form></div></div></li>';
  const units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + Number(b.price.replace(/[^\d,]/g, '').replace(',', '.')), 0);
  return '<div class="flex flex-col h-full"><header class="cart-drawer__header"><div class="top-header flex p-3"><span>Carrinho <span id="quantity-header" class="text-gray-500 font-normal text-xs" data-quantityheader="' + units + '">(' + units + (units === 1 ? ' produto' : ' produtos') + ')</span></span>' +
    '<div class="flex items-center justify-end"><svg id="cart-drawer-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div></div></header>' +
    '<div class="cart-drawer__main bg-gray-50"><ul class="main-list flex flex-col w-full">' + items.map(li).join('') + '</ul></div>' +
    '<div class="cart-drawer__footer">' + (incentive ? incentiveHtml(incentive, units) : '') +
    '<div class="cart-drawer__footer__coupon flex items-center justify-between"><label>Cupom</label><form onsubmit="return false" class="flex items-center gap-2"><input class="coupon-input" placeholder="CUPOM"><button type="button" class="btn-apply" aria-label="Aplicar">→</button></form></div>' +
    '<div class="cart-drawer__footer__cep flex items-center justify-between"><span>Frete</span>' + (incentive === 'confirmado' ? '<span class="font-medium text-green-600">Grátis</span>' : '<a href="#" onclick="return false" class="underline">Inserir CEP</a>') + '</div>' +
    '<div class="footer-details"><ul><li><span>Subtotal</span><span id="amount">' + money(subtotal) + '</span></li><li><span>Total</span><span>' + money(subtotal) + '</span></li></ul><small class="self-end">ou 5x de ' + money(subtotal / 5) + '</small></div>' +
    '<form data-turbo="false" action="#" method="post" onsubmit="return false"><button id="checkout-btn" type="button" class="bg-store-button text-base text-store-button-font font-medium w-full py-3 rounded-full">Finalizar compra</button></form>' +
    '<button type="button" class="cart-drawer__footer__keep-shopping w-full py-3 mt-2">Continuar comprando</button></div></div>';
}
// PROPOSTA do incentivo (não existe no fluxo real; regra não estruturada): uma linha curta + barra fina, no topo do resumo, antes do cupom e do total.
const INCENTIVE_CSS = '.o-incentive{display:flex;flex-direction:column;gap:6px;margin:0 0 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--o-selected) 35%,transparent);border-radius:var(--o-radius);background:color-mix(in srgb,var(--o-selected) 6%,#fff);color:var(--o-ink);font:500 14px/1.35 var(--o-font)}' +
  '.o-incentive p{margin:0;display:flex;gap:8px;align-items:flex-start}.o-incentive svg{flex:0 0 18px;margin-top:1px;color:var(--o-selected)}.o-incentive strong{font-weight:700}' +
  '.o-incentive-bar{height:4px;border-radius:2px;background:color-mix(in srgb,var(--o-selected) 18%,#fff);overflow:hidden}.o-incentive-bar i{display:block;height:100%;background:var(--o-selected);transition:width .3s ease}' +
  '@media (prefers-reduced-motion:reduce){.o-incentive-bar i{transition:none}}' +
  '@media (max-height:760px){.o-incentive{gap:4px;margin-bottom:6px;padding:6px 10px;font-size:13px}}';
const TRUCK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/></svg>';
function incentiveHtml(state, units) {
  if (state === 'falta') return '<div class="o-incentive" role="status">' + '<p>' + TRUCK + '<span>Falta <strong>' + (2 - units) + ' peça</strong> para a condição de frete grátis no Sul (PR, SC e RS).</span></p><div class="o-incentive-bar" aria-hidden="true"><i style="width:' + Math.min(100, units * 50) + '%"></i></div></div>';
  if (state === 'atingida') return '<div class="o-incentive" role="status"><p>' + TRUCK + '<span><strong>Condição de 2 peças atingida.</strong> Informe o CEP para verificar o frete grátis.</span></p></div>';
  if (state === 'confirmado') return '<div class="o-incentive" role="status"><p>' + TRUCK + '<span><strong>Frete grátis aplicado</strong> à entrega escolhida.</span></p></div>';
  return '';
}
const postAddHtml = (img) => '<div id="modal-wrapper" class="add-product-modal fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50" role="dialog" aria-modal="true"><div class="relative w-full max-w-md bg-white"><div class="w-full p-4">' +
  '<div class="flex items-center justify-between"><h3 class="text-lg font-semibold">Produto adicionado ao carrinho</h3><button id="modal-close-button" type="button" aria-label="Fechar">✕</button></div>' +
  '<div class="flex gap-3 my-4"><img src="' + img + '" style="width:88px;height:88px;object-fit:cover"><div><p class="font-medium">Florianópolis | Legado SC</p><p class="text-sm text-gray-500">Preta · Clássica | Unissex · M</p><p class="font-medium mt-1">R$ 109,90</p></div></div>' +
  '<div class="flex flex-col gap-2 add-product-modal__modal-content__footer"><button class="flex justify-center checkout-btn rounded-lg py-3 bg-gray-800 text-white"><span>Ver carrinho</span></button><button id="continue-shopping-button" class="rounded-lg py-3 border"><span>Continuar comprando</span></button></div></div></div></div>';

async function openCart(page, mobile, html) {
  await page.evaluate(({ html, css }) => {
    if (!document.getElementById('o-sim-incentive-css')) { const s = document.createElement('style'); s.id = 'o-sim-incentive-css'; s.textContent = css; document.head.appendChild(s); }
    document.querySelector('turbo-frame#cart').innerHTML = html;
  }, { html, css: INCENTIVE_CSS });
  await page.evaluate((m) => { window.scrollTo(0, 0); if (!document.querySelector('.cart-drawer.open')) document.getElementById(m ? 'shopping-cart-menu-mob' : 'shopping-cart-menu-desk')?.click(); }, mobile);
  await wait(page, 1800);
}
const cartMetrics = (page) => page.evaluate(() => {
  const d = document.querySelector('.cart-drawer'); const main = document.querySelector('.cart-drawer__main'); const btn = document.getElementById('checkout-btn');
  const names = [...document.querySelectorAll('.cart-drawer .item-details > p:first-child')].map((p) => p.scrollWidth > p.clientWidth + 1);
  const b = btn.getBoundingClientRect(); const items = [...document.querySelectorAll('.cart-drawer li.main-list__item')];
  const qty = [...document.querySelectorAll('.cart-drawer .item-details__quantity button')].map((x) => Math.round(Math.min(x.getBoundingClientRect().width, x.getBoundingClientRect().height)));
  const disc = document.querySelector('[data-origens-discovery="cart"]');
  return { drawerW: Math.round(d.getBoundingClientRect().width), checkoutVisible: b.top >= 0 && b.bottom <= innerHeight, checkoutH: Math.round(b.height), mainScroll: main.scrollHeight > main.clientHeight + 1, truncatedNames: names.filter(Boolean).length,
    minTouch: qty.length ? Math.min(...qty) : null, discoveryAfterItems: !!disc && items.length > 0 && !!(items[items.length - 1].compareDocumentPosition(disc) & Node.DOCUMENT_POSITION_FOLLOWING), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});

const VPS = [{ folder: 'desktop', name: 'desktop', width: 1440, height: 900 }, { folder: 'mobile', name: 'mobile', width: 390, height: 844 },
  { folder: 'mobile/360', name: '360', width: 360, height: 740 }, { folder: 'desktop/1280x640', name: 'baixo', width: 1280, height: 640, only: ['02', '03', '10', '14', '15'] }];
for (const vp of VPS) {
  only = vp.only || null;
  const s = await H.session(vp); const { page } = s;
  const mobile = vp.width < 600; const tag = vp.only ? `${vp.width}×${vp.height}` : `${vp.width} px`;
  await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1500);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('.section-product-v2 ul.aspect-square img')].map((i) => i.getAttribute('src')).filter(Boolean));
  const pick = [imgs[0], imgs[4], imgs[1], imgs[2], imgs[13] || imgs[3]];
  // 1 item (incentivo: falta 1 peça)
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick, 'falta'));
  let m = await cartMetrics(page); console.log(`[${tag}] carrinho 1 item`, JSON.stringify(m));
  await shot(page, vp.folder, '01-carrinho-1-item_incentivo-falta-1-peca', SIM, `carrinho com 1 item · incentivo de frete (PROPOSTA) antes da condição · ${tag}`);
  // 5 linhas / 6 peças: topo e fim da rolagem interna (incentivo: condição atingida, CEP não informado)
  await openCart(page, mobile, cartHtml(ITEMS, pick, 'atingida'));
  m = await cartMetrics(page); console.log(`[${tag}] carrinho 6 peças`, JSON.stringify(m));
  await shot(page, vp.folder, '02-carrinho-varios-itens_topo_incentivo-atingido', SIM, `5 linhas / 6 peças, topo da lista · incentivo (PROPOSTA) atingido, CEP não informado · ${tag}`);
  await page.evaluate(() => { const el = document.querySelector('.cart-drawer__main'); el.scrollTop = el.scrollHeight; }); await wait(page, 500);
  await shot(page, vp.folder, '03-carrinho-varios-itens_fim-da-lista', SIM, `fim da lista: último item, bloco de descoberta depois dos itens, total e finalizar · ${tag}`);
  // Item removido (volta a 1 peça): o incentivo volta a "falta 1 peça"
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick, 'falta'));
  await shot(page, vp.folder, '04-carrinho-item-removido_incentivo-volta', SIM, `após remover itens (2 → 1 peça): o incentivo (PROPOSTA) volta a mostrar o que falta · ${tag}`);
  // Frete grátis confirmado pela INK (CEP elegível): só aqui "aplicado"
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, 'confirmado'));
  await shot(page, vp.folder, '05-carrinho-frete-gratis-confirmado', SIM, `CEP informado e frete grátis confirmado pela INK (PROPOSTA de mensagem) · ${tag}`);
  // Sem oferta aplicável (ex.: regra não disponível): sem bloco
  await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, null));
  await shot(page, vp.folder, '06-carrinho-sem-incentivo', SIM, `regra indisponível ou loja sem oferta: nenhum bloco de incentivo (estado atual do fluxo real) · ${tag}`);
  // Fecha a gaveta simulada (o "X" injetado não tem o controlador da INK): a confirmação real aparece na PDP com a gaveta fechada.
  await page.evaluate(() => { document.querySelector('.cart-drawer')?.classList.remove('open'); const o = document.querySelector('.cart-drawer-overlay'); if (o) o.classList.add('hidden'); document.querySelector('turbo-frame#cart').innerHTML = ''; }); await wait(page, 700);
  // Pós-adição
  await page.evaluate(({ html }) => { const f = document.getElementById('last_added_product'); if (f) f.innerHTML = html; }, { html: postAddHtml(imgs[0]) });
  await wait(page, 1500);
  await shot(page, vp.folder, '07-confirmacao-apos-adicionar', SIM, `confirmação após adicionar · ${tag}`);
  await page.evaluate(() => { const f = document.getElementById('last_added_product'); if (f) f.innerHTML = ''; });

  // ── Checkout: estrutura real sanitizada ──
  const full = mobile && vp.width === 390;
  await page.goto(`${H.HOST}/usesul/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1200);
  const c1 = await page.evaluate(() => ({ status: document.title, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, btn: [...document.querySelectorAll('[data-controller="ink-store--checkout"] button')].filter((b) => b.getClientRects().length && /pagamento/i.test(b.textContent)).map((b) => Math.round(b.getBoundingClientRect().height)) }));
  console.log(`[${tag}] checkout contato`, JSON.stringify(c1));
  await shot(page, vp.folder, '10-checkout-contato-e-entrega' + (mobile ? '_primeira-tela' : ''), SAN, `contato e entrega · ${tag}`);
  if (full || !mobile) await shot(page, vp.folder, '11-checkout-contato-e-entrega_pagina-inteira', SAN, `contato e entrega, página inteira · ${tag}`, { fullPage: true });
  await page.evaluate(() => document.querySelector('turbo-frame#delivery_options')?.scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(page, 500);
  await shot(page, vp.folder, '12-checkout-opcoes-de-entrega', SAN, `opções de entrega (frete/prazo da INK, a escolhida em destaque) e resumo · ${tag}`);
  await page.goto(`${H.HOST}/usesul/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 1200);
  await page.evaluate(() => document.getElementById('pix')?.click()); await wait(page, 1200);
  await shot(page, vp.folder, '13-checkout-pix-selecionado', SAN, `Pix selecionado (o POST de desconto foi ABORTADO: totais não recalculados) · ${tag}`, { fullPage: !mobile || full });
  await page.evaluate(() => document.getElementById('credit_card')?.click()); await wait(page, 1000);
  await page.selectOption('#cart_card_installments', { index: 2 }).catch(() => {}); await wait(page, 400);
  const c2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fields: [...document.querySelectorAll('#content-credit_card input:not([type=hidden]), #content-credit_card select')].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)), finalizar: [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && /finalizar/i.test(b.textContent)).map((b) => Math.round(b.getBoundingClientRect().height)) }));
  console.log(`[${tag}] checkout cartão`, JSON.stringify(c2));
  await shot(page, vp.folder, '14-checkout-cartao-selecionado', SAN, `cartão selecionado: campos vazios, parcela 3x escolhida (opções da INK) · ${tag}`, { fullPage: !mobile || full });
  if (mobile) { await page.evaluate(() => document.getElementById('content-credit_card')?.scrollIntoView({ block: 'start', behavior: 'instant' })); await wait(page, 400); await shot(page, vp.folder, '14b-checkout-cartao-campos_tela', SAN, `campos do cartão e parcelas na tela do celular, com a barra fixa real · ${tag}`); }
  await page.evaluate(() => document.getElementById('billing_address_equal_shipping_address')?.click()); await wait(page, 1000);
  await shot(page, vp.folder, '15-checkout-cobranca-diferente', SAN, `endereço de cobrança diferente (campos vazios) · ${tag}`, { fullPage: !mobile || full });
  if (mobile) { await page.evaluate(() => document.getElementById('billing_address_equal_shipping_address')?.scrollIntoView({ block: 'start', behavior: 'instant' })); await wait(page, 400); await shot(page, vp.folder, '15b-checkout-cobranca_tela', SAN, `endereço de cobrança na tela do celular, com a barra fixa real · ${tag}`); }
  await s.ctx.close();
}
writeFileSync(`${OUT}/capturas.json`, JSON.stringify({ geradoEm: new Date().toISOString(), bloqueadas: H.blocked, capturas: rows }, null, 1));
console.log('requisições bloqueadas pela trava:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
await composer.close(); await H.close();
