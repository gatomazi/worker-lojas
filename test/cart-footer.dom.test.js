import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// Rodapé do carrinho tematizado (theme-ui): cupom recolhido atrás de "Adicionar cupom" e incentivo de frete por peças (cart-incentive). A gaveta cheia
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

test('incentivo: falta peça (régua), meta atingida com CEP pendente, frete grátis confirmado pela INK, CEP pago — mensagens naturais, um bloco só', async () => {
  const t = setup();
  await tick();
  assert.equal(boxes(t).length, 1);
  assert.deepEqual(say(t), ['Falta 1 peça para o frete grátis', 'Para entregas em PR, SC e RS.']);
  assert.equal(boxes(t)[0].querySelector('.o-incentive-bar i').style.width, '50%');
  assert.equal(boxes(t)[0].getAttribute('role'), 'status');
  assert.equal(boxes(t)[0].parentElement.firstElementChild, boxes(t)[0], 'no topo do rodapé, antes do cupom e do total');
  rerender(t, { qty: 2 });
  await tick();
  assert.deepEqual(say(t), ['Você já tem 2 peças!', 'Consulte seu CEP para verificar o frete grátis.']);
  assert.equal(boxes(t)[0].querySelector('.o-incentive-bar'), null, 'sem régua depois da meta');
  rerender(t, { qty: 3, shipping: 'Grátis' });
  await tick();
  assert.deepEqual(say(t), ['Frete grátis disponível para o seu CEP.', '']);
  rerender(t, { qty: 3, shipping: 'R$ 27,49' });
  await tick();
  assert.deepEqual(say(t), ['O frete grátis com 2 peças ou mais vale para PR, SC e RS.', ''], 'nunca sucesso com frete cobrado');
  rerender(t, { qty: 1 });
  await tick();
  assert.deepEqual(say(t)[0], 'Falta 1 peça para o frete grátis', 'removeu: volta a faltar');
  assert.equal(boxes(t).length, 1);
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
  assert.match(say(t)[0], /^Você já tem 2 peças!/);
  submit(t, 'turbo:submit-start');
  assert.ok(boxes(t)[0].hasAttribute('data-loading'));
  submit(t, 'turbo:submit-end', { success: false });
  await tick();
  assert.ok(!boxes(t)[0].hasAttribute('data-loading'));
  assert.match(say(t)[0], /^Você já tem 2 peças!/);
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
