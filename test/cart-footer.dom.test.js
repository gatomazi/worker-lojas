import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// Carrinho tematizado (theme-ui): cupom recolhido atrás de "Adicionar cupom" no rodapé e incentivo de frete por peças (cart-incentive) no topo da lista. A gaveta cheia
// abaixo segue a marcação que o JS e o CSS públicos da INK confirmam (#quantity-header[data-quantityheader], #coupon-form com cart[coupon][code],
// alvos cepInputContainer/cartErrors do ink-store--cart, as classes .cart-drawer__footer__*). Itens fictícios.
const FIXTURE = readFileSync(new URL('./fixtures/product-page-theme.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/florianopolis-legado-sc';
const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

const coupon = ({ value = '', applied = false } = {}) => '<div class="cart-drawer__footer__coupon flex items-center justify-between"><label for="coupon">Cupom</label>' +
  '<form id="coupon-form" action="/usesul/cart/coupon" method="post" data-turbo="true"><input class="coupon-input" id="coupon" name="cart[coupon][code]" value="' + value + '">' +
  (applied ? '<button type="button" data-action="ink-store--cart#clearCoupon">Remover</button>' : '<button type="submit" class="btn-apply" data-action="ink-store--cart#addCoupon">Aplicar</button>') + '</form></div>';
const cep = (shipping = '') => '<div class="cart-drawer__footer__cep flex items-center justify-between"><span>Frete</span>' +
  (shipping ? '<span class="shipping-value">' + shipping + '</span>' : '<a href="#" data-action="ink-store--cart#insertCep">Inserir CEP</a>') +
  '<div class="hidden" data-ink-store--cart-target="cepInputContainer"><input class="cep-input" name="cep" value=""></div></div>';
function drawer({ qty = 1, couponOpts = {}, shipping = '', errors = false, nativeMax = 0 } = {}) {
  const items = Array.from({ length: Math.max(qty, 0) }, (_, i) => '<li class="main-list__item"><div class="item-wrapper"><p>Estampa ' + (i + 1) + '</p></div></li>').join('');
  return '<div data-controller="ink-store--cart ink-store--progress-bar" data-ink-store--progress-bar-max-progress-value="' + nativeMax + '" data-ink-store--progress-bar-progress-value="0" class="flex flex-col h-full">' +
    '<header class="cart-drawer__header"><div class="top-header"><span>Carrinho <span id="quantity-header" data-quantityheader="' + qty + '">(' + qty + ')</span></span><svg id="cart-drawer-close"></svg></div></header>' +
    (errors ? '<div data-ink-store--cart-target="cartErrors">Cupom inválido</div>' : '') +
    '<div class="cart-drawer__main"><ul class="main-list">' + items + '</ul></div>' +
    '<div class="cart-drawer__footer">' + coupon(couponOpts) + cep(shipping) +
    '<div class="footer-details"><ul><li><span>Subtotal</span><span>R$ 109,90</span></li><li><span>Total</span><span>R$ 109,90</span></li></ul></div>' +
    '<form action="/usesul/checkout" method="post" data-turbo="false"><button id="checkout-btn" type="button">Finalizar compra</button></form>' +
    '<button type="button" class="cart-drawer__footer__keep-shopping">Continuar comprando</button></div></div>';
}

function setup({ features = ['theme-pdp', 'theme-cart', 'cart-incentive'], attr = 'pdp cart', incentive = '2|PR,SC,RS', cart = drawer() } = {}) {
  let html = FIXTURE.replace(/<turbo-frame id="cart">[\s\S]*?<\/turbo-frame>/, '<turbo-frame id="cart">' + cart + '</turbo-frame>');
  const attrs = (attr !== null ? ' data-origens-theme="' + attr + '"' : '') + (incentive ? ' data-origens-incentive="' + incentive + '"' : '');
  html = html.replace('<body class="font-poppins">', '<body class="font-poppins"' + attrs + '>');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.eval(buildLoaderSource([], ['return-link', ...features], 'product-catalog'));
  return { w, doc: w.document };
}
// A INK re-renderiza o conteúdo do frame do carrinho a cada resposta.
const rerender = (t, opts) => { t.doc.querySelector('turbo-frame#cart').innerHTML = drawer(opts); };
const row = (t) => t.doc.querySelector('.cart-drawer__footer__coupon');
const toggles = (t) => [...t.doc.querySelectorAll('.o-coupon-toggle')];
const boxes = (t) => [...t.doc.querySelectorAll('[data-origens-incentive-box]')];
const say = (t) => { const b = boxes(t)[0]; return b ? [b.querySelector('p').textContent, (b.querySelector('small') || {}).textContent || ''] : null; };
const submit = (t, type, detail = {}) => t.doc.getElementById('coupon-form').dispatchEvent(new t.w.CustomEvent(type, { bubbles: true, detail }));

test('cupom vazio: recolhido atrás de "Adicionar cupom" (um botão só); abrir mostra o campo da INK e foca; re-render da INK não fecha de novo', async () => {
  const t = setup();
  await tick();
  assert.ok(row(t).hasAttribute('data-origens-collapsed'));
  assert.equal(toggles(t).length, 1);
  const [btn] = toggles(t);
  assert.equal(btn.textContent, 'Adicionar cupom');
  assert.equal(btn.type, 'button');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(btn.getAttribute('aria-controls'), 'coupon-form');
  assert.equal(btn.nextElementSibling, row(t), 'no lugar do cupom');
  btn.click();
  await tick();
  assert.ok(!row(t).hasAttribute('data-origens-collapsed'));
  assert.equal(toggles(t).length, 0);
  assert.equal(t.doc.activeElement, t.doc.getElementById('coupon'));
  rerender(t, { qty: 2 });
  await tick();
  assert.ok(!row(t).hasAttribute('data-origens-collapsed'), 'aberto pelo cliente continua aberto');
  assert.equal(toggles(t).length, 0);
});

test('cupom com código, aplicado ou com erro: fica à mostra (nada a esconder)', async () => {
  for (const opts of [{ couponOpts: { value: 'LEVEMAIS' } }, { couponOpts: { value: 'LEVEMAIS', applied: true } }, { errors: true }]) {
    const t = setup({ cart: drawer(opts) });
    await tick();
    assert.ok(!row(t).hasAttribute('data-origens-collapsed'), JSON.stringify(opts));
    assert.equal(toggles(t).length, 0, JSON.stringify(opts));
  }
});

test('sem o carrinho tematizado (painel desligado ou sem theme-cart no deploy): o cupom da INK fica como é, sem botão nem incentivo', async () => {
  for (const opts of [{ attr: 'pdp' }, { features: ['theme-pdp'] }, { attr: null }]) {
    const t = setup(opts);
    await tick();
    assert.ok(!row(t).hasAttribute('data-origens-collapsed'), JSON.stringify(opts));
    assert.equal(toggles(t).length + boxes(t).length, 0, JSON.stringify(opts));
  }
});

test('incentivo: no TOPO da lista (abaixo do título, antes dos produtos, rola com eles); UMA linha + régua fina; falta peça, quantidade atingida com CEP pendente, frete grátis da INK, CEP pago', async () => {
  const t = setup({ incentive: '2|PR,SC,RS|no Sul' });
  await tick();
  assert.equal(boxes(t).length, 1);
  const list = t.doc.querySelector('.cart-drawer__main ul');
  const slot = boxes(t)[0].parentElement;
  assert.ok(slot.matches('li[role="none"][data-origens-incentive-slot]') && list.firstElementChild === slot, 'primeiro item da lista rolável');
  assert.ok(!t.doc.querySelector('.cart-drawer__footer [data-origens-incentive-box]'), 'nada no rodapé');
  assert.deepEqual(say(t), ['Falta 1 peça para o frete grátis no Sul', ''], 'uma linha só');
  assert.deepEqual([...boxes(t)[0].querySelectorAll('strong')].map((b) => b.textContent), ['1 peça', 'frete grátis'], 'o que falta e o benefício em destaque');
  assert.equal(boxes(t)[0].querySelector('.o-incentive-bar i').style.transform, 'scaleX(0.5)', 'régua por transform (sem animar layout)');
  assert.equal(boxes(t)[0].getAttribute('role'), 'status');
  rerender(t, { qty: 2 });
  await tick();
  assert.deepEqual(say(t), ['Agora é só confirmar o CEP para o frete grátis', '']);
  assert.equal(boxes(t)[0].querySelector('.o-incentive-bar i').style.transform, 'scaleX(1)', 'régua cheia, mas o texto não promete o frete');
  rerender(t, { qty: 3, shipping: 'Grátis' });
  await tick();
  assert.deepEqual(say(t), ['Frete grátis para o seu CEP!', '']);
  rerender(t, { qty: 3, shipping: 'R$ 27,49' });
  await tick();
  assert.deepEqual(say(t), ['O frete grátis vale só para PR, SC e RS', ''], 'nunca sucesso com frete cobrado');
  assert.equal(boxes(t)[0].querySelector('.o-incentive-bar'), null);
  rerender(t, { qty: 1 });
  await tick();
  assert.deepEqual(say(t)[0], 'Falta 1 peça para o frete grátis no Sul', 'removeu: volta a faltar');
  assert.equal(t.doc.querySelectorAll('[data-origens-incentive-slot]').length, 1);
});

test('incentivo: regra só para parte da região = as UFs na mensagem; rótulo de região desconhecido é recusado', async () => {
  let t = setup({ incentive: '2|PR,SC' });
  await tick();
  assert.deepEqual(say(t)[0], 'Falta 1 peça para o frete grátis em PR e SC');
  t = setup({ incentive: '2|PR,SC,RS|<b>x</b>' });
  await tick();
  assert.equal(boxes(t).length, 0);
});

test('incentivo: some sem regra, sem a feature, com carrinho vazio ou quando a régua NATIVA da INK aparece (um aviso só)', async () => {
  for (const opts of [{ incentive: '' }, { features: ['theme-pdp', 'theme-cart'] }, { incentive: '2|PR;SC' }, { cart: drawer({ qty: 0 }) }, { cart: drawer({ nativeMax: 199 }) }]) {
    const t = setup(opts);
    await tick();
    assert.equal(boxes(t).length, 0, JSON.stringify(opts));
  }
});

test('incentivo durante a resposta da INK: conteúdo escondido (sem mensagem velha) até o rodapé novo; erro no envio = volta o estado atual', async () => {
  const t = setup();
  await tick();
  submit(t, 'turbo:submit-start');
  assert.ok(boxes(t)[0].hasAttribute('data-loading'));
  rerender(t, { qty: 2 });
  await tick();
  assert.ok(!boxes(t)[0].hasAttribute('data-loading'));
  assert.match(say(t)[0], /^Agora é só confirmar o CEP/);
  submit(t, 'turbo:submit-start');
  assert.ok(boxes(t)[0].hasAttribute('data-loading'));
  submit(t, 'turbo:submit-end', { success: false });
  await tick();
  assert.ok(!boxes(t)[0].hasAttribute('data-loading'));
  assert.match(say(t)[0], /^Agora é só confirmar o CEP/);
});

test('Turbo: página nova sem o carrinho tematizado = nenhum botão, nenhum incentivo, cupom à mostra; com tema = um de cada (sem duplicar)', async () => {
  const t = setup();
  await tick();
  const visit = (attr, incentive) => {
    t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + PATH, action: 'advance' } }));
    const next = new JSDOM(FIXTURE.replace(/<turbo-frame id="cart">[\s\S]*?<\/turbo-frame>/, '<turbo-frame id="cart">' + drawer({ qty: 1 }) + '</turbo-frame>')).window.document.body;
    const fresh = t.doc.importNode(next, true);
    if (attr) fresh.setAttribute('data-origens-theme', attr);
    if (incentive) fresh.setAttribute('data-origens-incentive', incentive);
    t.doc.documentElement.replaceChild(fresh, t.doc.body);
    t.doc.dispatchEvent(new t.w.Event('turbo:render'));
  };
  visit('pdp', '');
  await tick();
  assert.equal(toggles(t).length + boxes(t).length, 0);
  assert.ok(!row(t).hasAttribute('data-origens-collapsed'));
  visit('pdp cart', '2|PR,SC,RS');
  await tick();
  for (let i = 0; i < 5; i++) t.doc.body.appendChild(t.doc.createElement('i')); // outras mudanças no DOM remontam o runtime
  await tick();
  assert.equal(toggles(t).length, 1);
  assert.equal(boxes(t).length, 1);
});

// Marcação REAL da gaveta da INK, lida na loja única em 08/11/2026 (estrutura, sem dados de sessão): cupom e CEP cada um no próprio <form>, filhos
// diretos do rodapé; a promoção automática (BLACKMONTH) entra como cupom aplicado (campo escondido + selo com "remover"); o contêiner de erros vazio.
function realDrawer({ applied = false, cepOpen = false } = {}) {
  return '<div class="relative flex flex-col h-full" data-controller="ink-store--cart ink-store--progress-bar" data-ink-store--progress-bar-max-progress-value="0">' +
    '<div class="cart-drawer__header"><div class="top-header"><span>Carrinho <span id="quantity-header" data-quantityheader="3">(3 produtos)</span></span></div></div>' +
    '<div data-ink-store--cart-target="cartErrors"></div>' +
    '<div class="cart-drawer__main flex-col"><ul class="flex flex-col w-full"><li class="main-list__item"><div class="item-wrapper"><p>Estampa</p></div></li></ul>' +
    '<div data-ink-labs-anchor="cart_items_below"></div><turbo-frame id="order_bump_offer_frame"></turbo-frame></div>' +
    '<div class="cart-drawer__footer"><div data-ink-labs-anchor="cart_shipping_bar"><div data-ink-labs-slot="progressive_discount_cart"><div data-ink-labs-progressive-discount="cart"></div></div></div>' +
    '<form id="coupon-form" class="flex flex-col gap-4" action="/useorigens/cart/coupon" method="post" data-turbo="true"><div class="cart-drawer__footer__coupon mb-3">' +
    '<div class="flex"><label for="cart_coupon_Cupom">Cupom</label></div><div class="flex justify-end items-center w-48">' +
    '<input id="cart_coupon_code" class="' + (applied ? 'hidden ' : '') + 'coupon-input reset-input w-full" name="cart[coupon][code]" placeholder="CUPOM" value="">' +
    '<button id="apply_coupon_code" type="button" class="btn-apply' + (applied ? ' hidden' : '') + '" data-action="click->ink-store--cart#addCoupon"></button>' +
    (applied ? '<span id="badge-dismiss-yellow"><span>BLACKMONTH</span><button type="button" data-action="click->ink-store--cart#removeCoupon" aria-label="Remove"></button></span>' : '') +
    '</div></div></form>' +
    '<form id="cep-form" class="flex flex-col gap-4" action="/useorigens/cart/cep" method="post" data-turbo="true"><div class="cart-drawer__footer__cep"><div class="w-full block">' +
    '<div class="flex justify-between w-full"><div class="flex"><span>Frete</span></div><div id="insert-cep-btn" class="flex justify-end items-center w-48" data-action="click->ink-store--cart#insertCep">Inserir CEP</div></div>' +
    '<div class="flex justify-between w-full' + (cepOpen ? '' : ' hidden') + ' pt-3.5" data-ink-store--cart-target="cepInputContainer"><input id="cart-cep-input" class="cep-input" name="cart[cep]"></div></div></div></form>' +
    '<div data-ink-labs-anchor="cart_summary"></div><div class="footer-details"><ul><li><span>Subtotal</span><span id="amount">R$ 359,70</span></li><li><span>Desconto</span><span>-R$ 65,00</span></li></ul>' +
    '<div class="flex justify-between"><p>Total</p><span class="flex flex-col"><p>R$ 294,70</p><span>ou 5x de R$ 58,94</span></span></div></div>' +
    '<form action="/useorigens/checkout" method="post" data-turbo="false"><button id="checkout-btn" type="button">Finalizar compra</button></form></div></div>';
}
const footer = (t) => t.doc.querySelector('.cart-drawer__footer');

test('marcação real (08/11): cupom vazio recolhido DENTRO do form do cupom e "Adicionar cupom" + "Frete · Inserir CEP" numa linha; o contêiner de erros vazio não segura o campo aberto', async () => {
  const t = setup({ cart: realDrawer() });
  await tick();
  assert.ok(row(t).hasAttribute('data-origens-collapsed'), 'erro vazio não é erro');
  assert.equal(toggles(t).length, 1);
  assert.equal(toggles(t)[0].parentElement, t.doc.getElementById('coupon-form'));
  assert.ok(footer(t).hasAttribute('data-origens-pair'));
  toggles(t)[0].click();
  await tick();
  assert.ok(!footer(t).hasAttribute('data-origens-pair'), 'abriu o cupom: uma linha cada');
  assert.ok(!row(t).hasAttribute('data-origens-collapsed'));
});

test('marcação real (08/11): cupom aplicado (o BLACKMONTH automático) fica à mostra, só o selo, na mesma linha do frete; com erro ou sem o form do CEP, uma linha cada', async () => {
  const t = setup({ cart: realDrawer({ applied: true }) });
  await tick();
  assert.ok(!row(t).hasAttribute('data-origens-collapsed'), 'cupom aplicado não se esconde');
  assert.equal(toggles(t).length, 0);
  assert.ok(row(t).hasAttribute('data-origens-applied'));
  assert.ok(footer(t).hasAttribute('data-origens-pair'));
  // Erro da INK com texto: nada de linha dividida.
  const again = setup({ cart: realDrawer({ applied: true }).replace('<div data-ink-store--cart-target="cartErrors"></div>', '<div data-ink-store--cart-target="cartErrors">Cupom inválido</div>') });
  await tick();
  assert.ok(!footer(again).hasAttribute('data-origens-pair'));
  assert.ok(!row(again).hasAttribute('data-origens-applied'));
  // Marcação antiga (cupom e CEP soltos no rodapé): o atributo não aparece.
  const old = setup();
  await tick();
  assert.ok(!footer(old).hasAttribute('data-origens-pair'));
});
