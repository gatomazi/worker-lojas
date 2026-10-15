#!/usr/bin/env node
// SIMULAÇÃO (não é o carrinho real): carrinho com itens e confirmação pós-adição para avaliar a APARÊNCIA do tema quando adicionar ao carrinho real não é
// permitido nesta sessão. Abre a PDP REAL pelo Worker local (harness de preview-tema), injeta no próprio turbo-frame#cart e em #last_added_product uma
// marcação RECONSTRUÍDA a partir das classes do CSS da INK (stores/application.css: .cart-drawer__main .main-list__item .item-wrapper …) e da estrutura
// documentada em docs/fase-4-cart-bridge.md, abre o drawer e fotografa. Nenhum POST sai (a trava aborta); toda captura leva a faixa "SIMULAÇÃO".
// Não prova integração: a marcação real pode ter diferenças. A validação real é o roteiro manual (docs/RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md).
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
  await page.evaluate(({ html }) => { document.querySelector('turbo-frame#cart').innerHTML = html; }, { html: cartHtml(ITEMS, [imgs[0], imgs[0], imgs[4] || imgs[1], imgs[5] || imgs[2]]) });
  await page.evaluate((m) => document.getElementById(m ? 'shopping-cart-menu-mob' : 'shopping-cart-menu-desk')?.click(), s.mobile);
  await page.waitForTimeout(2200);
  await page.evaluate(BANNER);
  const m = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { y: Math.round(x.y), h: Math.round(x.height), w: Math.round(x.width) }; }; return { drawer: r('.cart-drawer'), checkout: r('#checkout-btn'), discovery: r('[data-origens-discovery="cart"]'), discoveryAfterItems: (() => { const d = document.querySelector('[data-origens-discovery="cart"]'); const items = document.querySelectorAll('li.main-list__item'); return d && items.length ? !!(items[items.length - 1].compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) : null; })(), vh: innerHeight }; });
  console.log(`[${vp.name}] ${tag} carrinho com itens (SIMULAÇÃO)`, JSON.stringify(m));
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
