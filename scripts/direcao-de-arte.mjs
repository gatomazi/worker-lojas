#!/usr/bin/env node
// DIREÇÃO DE ARTE: Atual / A / B sobre o MESMO código, os MESMOS dados, o MESMO estado e o MESMO viewport. As propostas são trocas dos papéis de cor
// (scripts/lib/propostas-cor.mjs) injetadas só nesta prévia. Carrinho = gaveta reconstruída na PDP real (SIMULAÇÃO); checkout = estrutura real com
// dados fictícios (sanitizeCheckout). Também a PDP externa atual (storefront), só como referência de continuidade.
//   PW_PATH=… node scripts/direcao-de-arte.mjs --out <dir> --checkout <uuid de teste>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHarness, DEFAULT_PDP, REFERENCE_THEME } from './lib/tema-harness.mjs';
import { PROPOSTAS } from './lib/propostas-cor.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('--out'); const UUID = opt('--checkout');
if (!OUT || !UUID) { console.error('uso: --out <dir> --checkout <uuid>'); process.exit(2); }
const RULE = { enabled: true, kind: 'free-shipping', unit: 'items', threshold: 2, ufs: ['PR', 'SC', 'RS'] };
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const composer = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const wait = (p, ms) => p.waitForTimeout(ms);
const VARIANTES = [{ id: 'atual', nome: 'Atual (aprovado)', cor: '#5b5b5b' }, { id: 'A', nome: PROPOSTAS.A.nome, cor: '#2e5b38' }, { id: 'B', nome: PROPOSTAS.B.nome, cor: '#8a6a2c' }];
let TAG = ''; let TAGCOR = '#5b5b5b';
const SIM = 'SIMULAÇÃO VISUAL — carrinho reconstruído';
const SAN = 'checkout real, dados fictícios';
const shots = {}; // estado@viewport -> { atual, A, B }

async function labeled(buffer, file, label, detail) {
  const p = await composer.newPage({ viewport: { width: 800, height: 200 } });
  const width = buffer.readUInt32BE(16); const fs = Math.max(15, Math.round(width / 52));
  await p.setContent(`<body style="margin:0;background:#fff"><div id="w" style="display:inline-block;width:${width}px"><div style="font:700 ${fs}px/1.3 system-ui;background:${TAGCOR};color:#fff;padding:${Math.round(fs * 0.55)}px ${Math.round(fs * 0.8)}px">${TAG} · ${label}<span style="font-weight:500;opacity:.92"> · ${detail}</span></div><img src="data:image/png;base64,${buffer.toString('base64')}" style="display:block"></div></body>`);
  await p.waitForTimeout(80);
  const box = await p.evaluate(() => { const r = document.getElementById('w').getBoundingClientRect(); return { width: r.width, height: r.height }; });
  await p.setViewportSize({ width: Math.ceil(box.width), height: Math.min(Math.ceil(box.height), 16000) });
  await p.locator('#w').screenshot({ path: file }); // só o bloco (faixa + tela): sem costura de página inteira
  await p.close();
}

async function shot(page, key, label, detail, opts = {}) {
  const buffer = await page.screenshot(opts);
  const dir = `${OUT}/capturas/${key.split('@')[1]}`; mkdirSync(dir, { recursive: true });
  const file = `${dir}/${VAR === 'atual' ? 'Atual' : 'Proposta-' + VAR}_${key.split('@')[0]}.png`;
  await labeled(buffer, file, label, detail);
  (shots[key] ||= {})[VAR] = file;
}
let VAR = 'atual';

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
  const inc = document.querySelector('.cart-drawer [data-origens-incentive-box]');
  const ib = inc && inc.getBoundingClientRect();
  return { incentivoVisivelAoAbrir: ib ? ib.top >= 0 && ib.bottom <= innerHeight && ib.bottom <= mr.bottom + 1 : null, incentivoNoRodape: !!(inc && inc.closest('.cart-drawer__footer')), rodape: r('.cart-drawer__footer'), lista: Math.round(mr.height), itensInteiros: fully, menorToque: touch.length ? Math.min(...touch) : null, finalizarVisivel: btn.top >= 0 && btn.bottom <= innerHeight, finalizarAltura: Math.round(btn.height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});


const VPS = [{ name: '390', width: 390, height: 844 }, { name: '360', width: 360, height: 740 }, { name: '1440', width: 1440, height: 900 }];
for (const v of VARIANTES) {
  VAR = v.id; TAG = v.id === 'atual' ? 'ATUAL' : 'PROPOSTA ' + v.id; TAGCOR = v.cor;
  const H = await createHarness({ config: { ...REFERENCE_THEME, incentive: RULE }, themeFeatures: 'theme-pdp,theme-cart,theme-checkout,cart-incentive', sanitize: true, proposta: v.id === 'atual' ? null : v.id });
  for (const vp of VPS) {
    const s = await H.session({ name: v.id + '-' + vp.name, width: vp.width, height: vp.height }); const { page } = s;
    const mobile = vp.width < 600; const tag = vp.name + ' px';
    const drawerClip = mobile ? {} : { clip: { x: vp.width - 520, y: 0, width: 520, height: vp.height } };
    await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1200);
    const imgs = await page.evaluate(() => [...document.querySelectorAll('.section-product-v2 ul.aspect-square img')].map((i) => i.getAttribute('src')).filter(Boolean));
    const pick = [imgs[0], imgs[4], imgs[1], imgs[2], imgs[13] || imgs[3]];
    // 1 e 2: carrinho abaixo da meta e com a quantidade atingida (CEP pendente).
    await openCart(page, mobile, cartHtml(ITEMS.slice(0, 1), pick));
    await shot(page, '1-carrinho-1-item-abaixo-da-meta@' + vp.name, SIM, `1 item, abaixo da meta · ${tag}`, drawerClip);
    await openCart(page, mobile, cartHtml(ITEMS, pick));
    await shot(page, '2-carrinho-6-pecas-cep-pendente@' + vp.name, SIM, `6 peças, quantidade atingida, CEP pendente · ${tag}`, drawerClip);
    if (vp.name === '390') {
      // 3: benefício confirmado pela INK e destino não elegível.
      await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, { shipping: 'Grátis' }));
      await shot(page, '3a-carrinho-frete-gratis-da-ink@390', SIM, `a INK mostra "Grátis" para o CEP · ${tag}`);
      await openCart(page, mobile, cartHtml(ITEMS.slice(0, 2), pick, { shipping: 'R$ 27,49' }));
      await shot(page, '3b-carrinho-cep-nao-elegivel@390', SIM, `a INK cobra frete para o CEP: sem sucesso · ${tag}`);
    }
    await page.evaluate(() => { document.querySelector('.cart-drawer')?.classList.remove('open'); document.querySelector('turbo-frame#cart').innerHTML = ''; });
    // 4: contato/entrega com a forma de frete escolhida.
    if (vp.name !== '360') {
      await page.goto(`${H.HOST}/usesul/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 900);
      if (mobile) { await page.evaluate(() => document.querySelector('.shipping-types__item')?.scrollIntoView({ block: 'center' })); await wait(page, 300); }
      await shot(page, '4-checkout-entrega-frete-escolhido@' + vp.name, SAN, `contato e entrega, frete escolhido · ${tag}`);
    }
    // 5: pagamento com o cartão aberto; 6: Pix escolhido e erro/foco.
    await page.goto(`${H.HOST}/usesul/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 900);
    await page.evaluate(() => document.getElementById('credit_card')?.click()); await wait(page, 700);
    await page.selectOption('#cart_card_installments', { index: 2 }).catch(() => {});
    await page.evaluate(() => document.getElementById('formPaymentMethods')?.scrollIntoView({ block: 'start' })); await wait(page, 300);
    await shot(page, '5-checkout-cartao-aberto@' + vp.name, SAN, `pagamento, cartão aberto, parcela 3x · ${tag}`);
    if (vp.name === '390') {
      await page.evaluate(() => document.getElementById('pix')?.click()); await wait(page, 700);
      await page.evaluate(() => document.getElementById('formPaymentMethods')?.scrollIntoView({ block: 'start' })); await wait(page, 300);
      await shot(page, '6a-checkout-pix@390', SAN, `Pix escolhido · ${tag}`);
      await page.goto(`${H.HOST}/usesul/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(page, 900);
      const num = 'input[name="cart[shipping_address][number]"]';
      await page.fill(num, '').catch(() => {}); await page.press(num, 'Tab').catch(() => {}); await wait(page, 500);
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), num); await wait(page, 300);
      await shot(page, '6b-checkout-erro-e-foco@390', SAN, `número apagado: erro da INK + foco no campo seguinte (Tab) · ${tag}`);
    }
    await s.ctx.close();
  }
  console.log(v.id, 'ok; bloqueadas:', H.blocked.length);
  await H.close();
}

// PDP externa atual (storefront), sem mudança: referência de continuidade.
const ref = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const vp of [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1440', width: 1440, height: 900, mobile: false }]) {
  const ctx = await ref.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|clarity\.ms|hotjar|doubleclick/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto('https://www.useorigens.com.br/sul/sc/florianopolis/legado', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await wait(page, 1500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /recusar|só essenciais|apenas essenciais|rejeitar/i.test(x.textContent || '')); if (b) b.click(); });
  await wait(page, 600);
  TAG = 'REFERÊNCIA'; TAGCOR = '#1b1d19';
  const buffer = await page.screenshot();
  const dir = `${OUT}/capturas/${vp.name}`; mkdirSync(dir, { recursive: true });
  await labeled(buffer, `${dir}/Referencia_0-pdp-externa.png`, 'PDP externa atual (storefront)', `useorigens.com.br/sul/sc/florianopolis/legado, sem mudança · ${vp.name} px`);
  await ctx.close();
}
await ref.close();

// Comparações Atual / A / B por estado (mesmo enquadramento).
mkdirSync(`${OUT}/comparacoes`, { recursive: true });
const { readFileSync } = await import('node:fs');
for (const [key, files] of Object.entries(shots)) {
  const [estado, vp] = key.split('@');
  const cols = VARIANTES.map((v) => files[v.id]).filter(Boolean);
  const p = await composer.newPage({ viewport: { width: 400, height: 300 } });
  await p.setContent('<body style="margin:0;background:#fff"><div id="w" style="display:inline-flex;gap:16px;padding:16px;align-items:flex-start">' + cols.map((f) => '<img src="data:image/png;base64,' + readFileSync(f).toString('base64') + '" style="display:block;border:1px solid #ccc">').join('') + '</div></body>');
  await p.waitForTimeout(150);
  const box = await p.evaluate(() => { const r = document.getElementById('w').getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; });
  await p.setViewportSize({ width: box.w, height: Math.min(box.h, 16000) });
  await p.locator('#w').screenshot({ path: `${OUT}/comparacoes/${vp}_${estado}.png` });
  await p.close();
}
writeFileSync(`${OUT}/capturas.json`, JSON.stringify({ geradoEm: new Date().toISOString(), propostas: PROPOSTAS, capturas: shots }, null, 1));
await composer.close();
console.log('comparações:', Object.keys(shots).length);
