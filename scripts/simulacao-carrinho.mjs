#!/usr/bin/env node
// SIMULAÇÃO (não é o carrinho real): carrinho com itens e confirmação pós-adição para avaliar a APARÊNCIA do tema quando adicionar ao carrinho real não é
// permitido nesta sessão. Abre a PDP REAL pelo Worker local (harness de preview-tema), injeta no próprio turbo-frame#cart e em #last_added_product uma
// marcação RECONSTRUÍDA a partir das classes do CSS da INK (stores/application.css: .cart-drawer__main .main-list__item .item-wrapper …) e da estrutura
// documentada em docs/fase-4-cart-bridge.md, abre o drawer e fotografa. Nenhum POST sai (a trava aborta); toda captura leva a faixa "SIMULAÇÃO".
// Não prova integração: a marcação real pode ter diferenças. A validação real é o roteiro manual (docs/RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md).
// --real: a gaveta com a ESTRUTURA lida na loja única em 08/11/2026 (cupom e CEP em <form> próprios, a BLACKMONTH automática como cupom aplicado, a
// barra da promoção progressiva da INK num shadow root, a oferta exclusiva depois da lista), 3 peças.
//   PW_PATH=… node scripts/simulacao-carrinho.mjs --out <dir> [--config tema.json] [--off]
import { mkdirSync, readFileSync } from 'node:fs';
import { createHarness, REFERENCE_THEME, DEFAULT_PDP, VIEWPORTS } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('--out'); if (!OUT) { console.error('--out <dir>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const OFF = argv.includes('--off');
const H = await createHarness({ config: opt('--config') ? JSON.parse(readFileSync(opt('--config'), 'utf8')) : REFERENCE_THEME, off: OFF });
const tag = OFF ? 'antes' : 'depois';
const REAL = argv.includes('--real');
const REAL_ITEMS = [
  { name: 'Mazanza | Dicionário Sulista', variant: ['Marinho', 'M'], de: 'R$ 119,90', por: 'R$ 91,57' },
  { name: 'Mazanza | Dicionário Sulista', variant: ['Cinza', 'M'], de: 'R$ 119,90', por: 'R$ 91,57' },
  { name: 'O Toque do Mate', variant: ['Marinho', 'P'], de: 'R$ 119,90', por: 'R$ 111,57' }
];
// Estrutura real (classes e alvos da INK de 08/11/2026); textos e valores do carrinho de teste do dono.
function realCartHtml(items, imgs) {
  const li = (it, i) => '<li class="main-list__item bg-white border-b-[0.50px] border-gray-200"><img class="w-24 h-28" src="' + imgs[i % imgs.length] + '" alt="Imagem do produto"><div class="item-wrapper justify-between">' +
    '<header><div><div class="item-details"><p>' + it.name + '</p>' + it.variant.map((v) => '<p>' + v + '</p>').join('') + '</div><div><div><span><del>' + it.de + '</del></span><span>' + it.por + '</span></div></div></div></header>' +
    '<div class="item-details__footer"><form data-turbo="true" onsubmit="return false"><div class="item-details__quantity flex items-center"><button type="button" class="text-gray-900"><svg class="w-4 h-4 text-red-700" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="2" d="M5 7h14m-9 3v8m4-8v8M10 3h4a1 1 0 0 1 1 1v3H9V4a1 1 0 0 1 1-1ZM6 7h12v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7Z"/></svg></button>' +
    '<input class="quantity-input" type="text" value="1" readonly><button type="button">+</button></div></form></div></div></li>';
  const bump = '<turbo-frame id="order_bump_offer_frame" complete><div id="order-bump-offer" style="margin:24px 16px 8px;border:1px solid #b7e8d2;border-radius:8px;overflow:hidden;background:#fff;font-family:inherit">' +
    '<p style="margin:0;padding:7px 12px;background:#d7f5e6;color:#0f7a55;font-size:10.5px;font-weight:700;letter-spacing:.08em">⚡ OFERTA EXCLUSIVA · SÓ NESTE PEDIDO</p>' +
    '<div data-ink-store--order-bump-offer-target="slide" style="display:flex;gap:12px;padding:10px"><img src="' + imgs[1 % imgs.length] + '" style="width:108px;height:108px;object-fit:cover;background:#f4f4f5">' +
    '<div style="flex:1"><p style="margin:0;font-size:12.5px">Mãe do piazinho | Dizeres</p><p style="margin:2px 0 0;font-size:11px;color:#0f7a55">R$ 10 OFF neste item</p><p style="margin:4px 0 8px"><b style="font-size:15px">R$ 84,90</b> <s style="font-size:10.5px;color:#a1a1aa">R$ 94,90</s></p>' +
    '<a href="#" onclick="return false" data-ink-store--order-bump-offer-target="button" style="display:flex;justify-content:center;padding:9px;border:1.5px solid #0a0a0a;border-radius:6px;color:#0a0a0a;font-size:12.5px;font-weight:600;text-decoration:none">Adicionar</a></div></div></div></turbo-frame>';
  return '<div hidden data-controller="ink-store--cart-events"></div><div class="relative flex flex-col h-full" data-controller="ink-store--cart ink-store--progress-bar" data-ink-store--progress-bar-max-progress-value="0">' +
    '<div class="cart-drawer__header p-3 bg-gray-50" data-controller="ink-store--drawer"><div class="top-header"><span class="text-base font-semibold text-gray-900">Carrinho <span id="quantity-header" data-quantityheader="3">(3 produtos)</span></span>' +
    '<svg id="cart-drawer-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div></div>' +
    '<div data-ink-labs-anchor="cart_top"></div><div class="cart-drawer__main flex-col bg-gray-50"><ul class="flex flex-col w-full !pb-6">' + items.map(li).join('') + '</ul>' +
    '<div data-ink-labs-anchor="cart_items_below"><div class="empty:hidden" data-ink-labs-slot="bought_together_cart"></div></div>' + bump + '</div><div></div>' +
    '<div class="cart-drawer__footer border-t-[0.50px]"><div data-ink-labs-anchor="cart_shipping_bar"><div class="empty:hidden" data-ink-labs-slot="progressive_discount_cart"><div data-ink-labs-progressive-discount="cart"></div></div></div>' +
    '<form id="coupon-form" class="flex flex-col gap-4" data-turbo="true" onsubmit="return false"><div class="cart-drawer__footer__coupon mb-3"><div class="flex"><label for="cart_coupon_Cupom">Cupom</label></div>' +
    '<div class="flex justify-end items-center w-48"><input id="cart_coupon_code" class="hidden coupon-input reset-input w-full" name="cart[coupon][code]" placeholder="CUPOM"><button id="apply_coupon_code" type="button" class="btn-apply" style="display:none" data-action="click->ink-store--cart#addCoupon"></button>' +
    '<span id="badge-dismiss-yellow" class="flex rounded-md gap-1 items-center justify-end px-2 text-sm py-1 leading-5 font-medium text-yellow-800 bg-yellow-100"><span>🏷</span><span>BLACKMONTH</span><button type="button" data-action="click->ink-store--cart#removeCoupon" aria-label="Remove">✕</button></span></div></div></form>' +
    '<form id="cep-form" class="flex flex-col gap-4" data-turbo="true" onsubmit="return false"><div class="cart-drawer__footer__cep"><div class="w-full block gap-3.5"><div class="flex justify-between w-full"><div class="flex"><span>Frete</span></div>' +
    '<div id="insert-cep-btn" class="flex justify-end items-center w-48 underline text-end text-sm font-medium cursor-pointer" data-action="click->ink-store--cart#insertCep" data-ink-store--cart-target="cepContainer">Inserir CEP</div></div>' +
    '<div class="flex justify-between w-full hidden pt-3.5" data-ink-store--cart-target="cepInputContainer"><input id="cart-cep-input" class="cep-input" name="cart[cep]" placeholder="Insira seu CEP"></div></div></div></form>' +
    '<div data-ink-labs-anchor="cart_summary"></div><div class="footer-details gap-3.5 my-3.5 flex flex-col"><ul class="flex flex-col gap-3.5"><li class="flex justify-between"><span class="text-gray-900 text-sm font-medium">Subtotal</span><span id="amount" class="text-gray-900 text-sm font-normal">R$ 359,70</span></li>' +
    '<li class="flex justify-between"><span class="text-gray-900 text-sm font-medium">Desconto</span><span class="text-green-600 text-sm font-normal">-R$ 65,00</span></li></ul>' +
    '<div class="flex justify-between items-start w-full"><p class="text-gray-900 text-sm font-medium">Total</p><span class="flex flex-col"><p class="text-gray-900 text-sm font-medium text-right">R$ 294,70</p><span class="text-right text-black text-xs">ou 5x de R$ 58,94</span></span></div></div>' +
    '<form class="pt-2.5" data-turbo="false" onsubmit="return false"><button id="checkout-btn" type="button" class="bg-store-button text-base text-store-button-font font-medium w-full py-3">Finalizar compra</button></form></div></div>';
}
const BAR = '<style>.b{font:13px/1.3 system-ui;color:#0f7a55}.t{height:4px;margin-top:6px;border-radius:2px;background:#e5e7eb}.f{width:50%;height:100%;border-radius:2px;background:#16a34a}</style>' +
  '<div class="b"><strong>R$ 25,00 OFF aplicado</strong> <span style="color:#111">· adicione 1 peça e sobe para R$ 50,00 OFF</span><div class="t"><div class="f"></div></div></div>';

const ITEMS = [
  { name: 'Florianópolis | Legado SC', variant: ['Preta', 'Clássica | Unissex', 'M'], price: 'R$ 109,90', qty: 1 },
  { name: 'Florianópolis | Legado SC', variant: ['Branca', 'Baby Look | Feminina', 'P'], price: 'R$ 109,90', qty: 1 },
  { name: 'Grande Florianópolis · 048', variant: ['Preta', 'Clássica | Unissex', 'G'], price: 'R$ 219,80', qty: 2 },
  { name: 'Made in Santa Catarina', variant: ['Preta', 'Clássica | Unissex', 'GG'], price: 'R$ 109,90', qty: 1 }
];
function cartHtml(items, imgs) {
  const li = (it, i) => '<li class="main-list__item"><img src="' + imgs[i % imgs.length] + '" alt="Imagem do produto"><div class="item-wrapper"><header class="item-header"><div class="item-details">' +
    '<p>' + it.name + '</p>' + it.variant.map((v) => '<span>' + v + '</span>').join('') + '</div><div class="price-details"><div class="price"><span>' + it.price + '</span></div></div></header>' +
    '<div class="item-details__footer"><form data-turbo="true" action="#" method="post" onsubmit="return false"><div class="item-details__quantity"><button type="button" aria-label="Remover">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>' +
    '<input class="quantity-input" type="text" value="' + it.qty + '" readonly><button type="button" aria-label="Aumentar">+</button></div></form></div></div></li>';
  const n = items.reduce((a, b) => a + b.qty, 0);
  return '<div class="flex flex-col h-full"><header class="cart-drawer__header"><div class="top-header flex p-3"><span>Carrinho <span id="quantity-header" class="text-gray-500 font-normal text-xs" data-quantityheader="' + n + '">(' + n + ' produtos)</span></span>' +
    '<div class="flex items-center justify-end"><svg id="cart-drawer-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div></div></header>' +
    '<div class="cart-drawer__main bg-gray-50"><ul class="main-list flex flex-col w-full">' + items.map(li).join('') + '</ul></div>' +
    '<div class="cart-drawer__footer"><div class="cart-drawer__footer__coupon flex items-center justify-between"><label>Cupom</label><form onsubmit="return false" class="flex items-center gap-2"><input class="coupon-input" placeholder="CUPOM"><button type="button" class="btn-apply" aria-label="Aplicar">→</button></form></div>' +
    '<div class="cart-drawer__footer__cep flex items-center justify-between"><span>Frete</span><a href="#" onclick="return false" class="underline">Inserir CEP</a></div>' +
    '<div class="footer-details"><ul><li><span>Subtotal</span><span id="amount">R$ 549,50</span></li><li><span>Total</span><span>R$ 549,50</span></li></ul><small class="self-end">ou 5x de R$ 109,90</small></div>' +
    '<form data-turbo="false" action="#" method="post" onsubmit="return false"><button id="checkout-btn" type="button" class="bg-store-button text-base text-store-button-font font-medium w-full py-3 rounded-full">Finalizar compra</button></form>' +
    '<button type="button" class="cart-drawer__footer__keep-shopping w-full py-3 mt-2">Continuar comprando</button></div></div>';
}
const modalHtml = (img) => '<div id="modal-wrapper" class="add-product-modal fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50" role="dialog" aria-modal="true"><div class="relative w-full max-w-md bg-white"><div class="w-full p-4">' +
  '<div class="flex items-center justify-between"><h3 class="text-lg font-semibold">Produto adicionado ao carrinho</h3><button id="modal-close-button" type="button" aria-label="Fechar">✕</button></div>' +
  '<div class="flex gap-3 my-4"><img src="' + img + '" style="width:88px;height:88px;object-fit:cover"><div><p class="font-medium">Florianópolis | Legado SC</p><p class="text-sm text-gray-500">Preta · Clássica | Unissex · M</p><p class="font-medium mt-1">R$ 109,90</p></div></div>' +
  '<div class="flex flex-col gap-2 add-product-modal__modal-content__footer"><button class="flex justify-center checkout-btn rounded-lg py-3 bg-gray-800 text-white"><span>Ver carrinho</span></button><button id="continue-shopping-button" class="rounded-lg py-3 border"><span>Continuar comprando</span></button></div></div></div></div>';
const BANNER = 'const b=document.createElement("div");b.textContent="SIMULAÇÃO · marcação reconstruída, não é o carrinho real";b.style.cssText="position:fixed;left:8px;top:8px;z-index:2147483647;background:#b42318;color:#fff;font:700 12px/1 system-ui;padding:6px 8px;pointer-events:none";document.body.appendChild(b);';

for (const vp of VIEWPORTS) {
  const s = await H.session(vp);
  const { page } = s;
  await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 });
  await H.acceptCookies(page); await page.waitForTimeout(1200);
  const imgs = await page.evaluate(() => [...document.querySelectorAll('.section-product-v2 ul.aspect-square img, .o-reco-media img')].map((i) => i.getAttribute('src')).filter(Boolean).slice(0, 6));
  // Carrinho com 4 linhas (5 peças): injeta no frame real e abre pelo ícone nativo.
  const pics = [imgs[0], imgs[0], imgs[4] || imgs[1], imgs[5] || imgs[2]];
  await page.evaluate(({ html, bar }) => {
    document.querySelector('turbo-frame#cart').innerHTML = html;
    const host = bar && document.querySelector('turbo-frame#cart [data-ink-labs-progressive-discount]');
    if (host) host.attachShadow({ mode: 'open' }).innerHTML = bar;
  }, { html: REAL ? realCartHtml(REAL_ITEMS, pics) : cartHtml(ITEMS, pics), bar: REAL ? BAR : null });
  await page.evaluate((m) => document.getElementById(m ? 'shopping-cart-menu-mob' : 'shopping-cart-menu-desk')?.click(), s.mobile);
  await page.waitForTimeout(2200);
  await page.evaluate(BANNER);
  const m = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { y: Math.round(x.y), h: Math.round(x.height), w: Math.round(x.width) }; }; return { drawer: r('.cart-drawer'), checkout: r('#checkout-btn'), discovery: r('[data-origens-discovery="cart"]'), discoveryAfterItems: (() => { const d = document.querySelector('[data-origens-discovery="cart"]'); const items = document.querySelectorAll('li.main-list__item'); return d && items.length ? !!(items[items.length - 1].compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) : null; })(), vh: innerHeight }; });
  console.log(`[${vp.name}] ${tag} carrinho com itens (SIMULAÇÃO)`, JSON.stringify(m));
  if (REAL) console.log(`[${vp.name}] rodapé`, JSON.stringify(await page.evaluate(() => { const f = document.querySelector('.cart-drawer__footer'); const row = f.querySelector('.cart-drawer__footer__coupon'); const rr = (e) => { const x = e.getBoundingClientRect(); return [Math.round(x.x), Math.round(x.width)]; }; return { h: Math.round(f.getBoundingClientRect().height), pair: f.hasAttribute('data-origens-pair'), applied: !!document.querySelector('[data-origens-applied]'), coupon: [rr(f.querySelector('#coupon-form')), rr(row), ...[...row.querySelectorAll('div, input, button, span')].map((e) => e.tagName + (e.id ? '#' + e.id : '') + ':' + rr(e).join('/') + ':' + getComputedStyle(e).display)], discoveryLast: document.querySelector('.cart-drawer__main')?.lastElementChild?.hasAttribute('data-origens-slot') }; })));
  await page.screenshot({ path: `${OUT}/${tag}-simulacao-carrinho-itens-${vp.name}.png` });
  // Rola a lista até o fim: o rodapé com o total e "Finalizar compra" continua fixo e visível.
  await page.evaluate(() => { const m = document.querySelector('.cart-drawer__main'); if (m) m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${tag}-simulacao-carrinho-fim-lista-${vp.name}.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  // Confirmação pós-adição.
  await page.evaluate(({ html }) => { const f = document.getElementById('last_added_product'); if (f) f.innerHTML = html; }, { html: modalHtml(imgs[0]) });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${tag}-simulacao-pos-adicao-${vp.name}.png` });
  await s.ctx.close();
}
console.log('requisições bloqueadas:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
await H.close();
