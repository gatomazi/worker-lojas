import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// post-add-kit no navegador (jsdom), sobre a PDP real reduzida (o formulário de compra com o preço da INK de 26/10/2026) e o modal pós-adição com a
// marcação da INK (docs/evidence/drawer/before-drawer-*.audit.json). Nenhum carrinho é tocado: o envio do formulário é cancelado, e o modal é inserido
// em #last_added_product como a INK faria depois da resposta.
const FIXTURE = readFileSync(new URL('./fixtures/product-page-offers.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/balneario-camboriu-origem-sc';
const GA = 'G-8GYTEJ1F77';
const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

// Um "compre junto" (outro formulário de compra) com preço promocional: o "de" riscado e o "por" ao lado.
const BUY_TOGETHER = '<div class="modal-buy-together"><form id="form-product-4400001" action="/usesul/cart?product_id=4400001" method="post">' +
  '<div class="flex gap-2"><p class="line-through text-gray-500">R$ 129,90</p><p class="font-medium">R$ 99,90</p></div><button type="submit" id="bt-add">Adicionar</button></form></div>';
const PAGE = FIXTURE.replace('</body>', BUY_TOGETHER + '<turbo-frame id="last_added_product"></turbo-frame></body>')
  .replace('</form>\n  <form id="form-product-3789914"', '</form>\n  <form id="form-product-3789914"')
  .replace('<p class="text-4xl font-medium">R$ 109,90</p>', '<p class="text-4xl font-medium">R$ 109,90</p><p class="font-medium text-base">ou <span>5x de R$ 21,98 sem juros</span></p><button type="submit" id="add-to-cart-desk">Adicionar ao carrinho</button>');
const MODAL = '<div id="modal-wrapper" class="add-product-modal overflow-y-auto overflow-x-hidden" role="dialog" aria-modal="true"><div class="relative w-full"><div class="w-full p-4">' +
  '<div class="flex items-center justify-between"><div class="flex items-center"><h3 class="text-center font-medium">Produto adicionado ao carrinho</h3></div><button id="modal-close-button"></button></div>' +
  '<div class="flex flex-col add-product-modal__modal-content__footer"><button class="flex flex-row checkout-btn"><svg></svg><span class="pl-2">Ver carrinho</span></button>' +
  '<button id="continue-shopping-button" class="flex flex-row bg-white"><span class="pl-2">Continuar comprando</span></button></div>' +
  '<turbo-frame id="most_sold_frame" class="w-full"><h3>As mais vendidas</h3></turbo-frame></div></div></div>';

const KIT = { id: 501, code: 'KITTESTE', auto: false, kind: 'value', tiers: [{ items: 3, discount: 25 }, { items: 4, discount: 40 }, { items: 5, discount: 60 }, { items: 6, discount: 85 }], eyebrow: 'Economize montando seu kit', title: 'Monte seu kit e pague menos', lead: 'Você pode combinar produtos participantes.' };
const GOOD = { v: 1, kit: KIT };

function setup({ features = ['post-add-kit'], payload = GOOD, status = 200 } = {}) {
  const html = PAGE.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; }
    return [{}];
  };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copied.push(text); } } });
  Object.defineProperty(w, 'isSecureContext', { configurable: true, value: true });
  const fetches = [];
  w.fetch = async (url, options = {}) => {
    fetches.push({ url: String(url), credentials: options.credentials });
    return { ok: status === 200, status, json: async () => payload };
  };
  // Nenhum envio chega a lugar nenhum: a "INK" só recebe o evento.
  w.document.addEventListener('submit', (e) => e.preventDefault());
  w.eval(buildLoaderSource([], features, 'product-catalog'));
  return { w, doc: w.document, events, copied, fetches };
}
const named = (t, name) => t.events.filter((e) => e[0] === 'event' && e[1] === name).map((e) => e[2]);
function add(t, formId = 'form-product-3789914') {
  const form = t.doc.getElementById(formId);
  form.dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
}
async function openModal(t) {
  t.doc.getElementById('last_added_product').innerHTML = MODAL;
  await tick();
}
const kit = (t) => t.doc.querySelector('[data-origens-kit]');
const nbsp = (text) => text.replace(/\u00a0/g, ' ');
const steps = (t) => [...t.doc.querySelectorAll('.o-kit-step')].map((li) => nbsp(li.getAttribute('data-state') + ' ' + li.querySelector('b').textContent + ' ' + li.querySelector('small').textContent));
const say = (t) => nbsp(t.doc.querySelector('.o-kit-title').textContent + ' | ' + t.doc.querySelector('.o-kit-lead').textContent);
// O carrinho da INK na página: a contagem do cabeçalho e, opcional, a barra da promoção progressiva (web component com shadow root aberto).
function cart(t, { qty = null, bar = null } = {}) {
  t.doc.querySelectorAll('.cart-drawer').forEach((n) => n.remove());
  const drawer = t.doc.createElement('div');
  drawer.className = 'cart-drawer';
  drawer.innerHTML = (qty === null ? '' : '<span id="quantity-header" data-quantityheader="' + qty + '">(' + qty + ' produtos)</span>') +
    '<div data-ink-labs-anchor="cart_shipping_bar"><div data-ink-labs-progressive-discount="cart"></div></div>';
  t.doc.body.appendChild(drawer);
  if (bar !== null) {
    const root = drawer.querySelector('[data-ink-labs-progressive-discount]').attachShadow({ mode: 'open' });
    root.innerHTML = '<style>.ink-pd-bar{color:green}</style><div class="ink-pd-bars"><div class="ink-pd-bar"><p class="ink-pd-bar__text">' + bar + '</p></div></div>';
  }
}
const labels = (t) => [...t.doc.querySelectorAll('.add-product-modal__modal-content__footer span')].map((s) => s.textContent);

test('post-add-kit: the block goes BEFORE the native buttons; "Ver carrinho" only changes its label and "Continuar comprando" is hidden while the kit is there', async () => {
  const t = setup();
  await tick();
  add(t);
  await openModal(t);
  const block = kit(t);
  assert.ok(block, 'o bloco montou');
  assert.equal(block.nextElementSibling.classList.contains('add-product-modal__modal-content__footer'), true);
  assert.equal(block.querySelector('.o-kit-eyebrow').textContent, KIT.eyebrow);
  assert.equal(block.querySelector('.o-kit-title').textContent, KIT.title);
  assert.equal(block.querySelector('[data-origens-kit-code]').textContent, 'KITTESTE');
  // Sem carrinho legível: o título e o texto do CMS, e a trilha sem destaque (um passo por faixa: o desconto e as peças, sem preço por peça).
  assert.equal(block.getAttribute('data-state'), 'unknown');
  assert.equal(block.querySelector('.o-kit-lead').textContent, KIT.lead);
  assert.deepEqual(steps(t), ['todo −R$ 25 3 peças', 'todo −R$ 40 4 peças', 'todo −R$ 60 5 peças', 'todo −R$ 85 6 peças']);
  assert.equal(block.querySelector('.o-kit-tier, .o-kit-note'), null, 'nada da tabela de preços antiga');
  // O mesmo botão da INK, com o ícone; só o texto do rótulo. O "Continuar comprando" fica escondido (a busca abaixo faz esse papel), com o rótulo dele.
  assert.deepEqual(labels(t), ['Finalizar compra', 'Continuar comprando']);
  assert.equal(t.w.getComputedStyle(t.doc.getElementById('continue-shopping-button')).display, 'none');
  assert.notEqual(t.w.getComputedStyle(t.doc.querySelector('.checkout-btn')).display, 'none');
  assert.ok(t.doc.querySelector('.checkout-btn svg'));
  assert.ok(t.doc.querySelector('.add-product-modal__modal-content__footer').hasAttribute('data-origens-kit-footer'));
  // A folha e o topo com o × marcados para o CSS do celular (folha com altura da tela, topo preso no alto).
  assert.ok(t.doc.getElementById('modal-wrapper').hasAttribute('data-origens-kit-open'));
  assert.equal(t.doc.querySelector('[data-origens-kit-head]'), t.doc.getElementById('modal-close-button').parentElement);
  assert.equal(t.doc.querySelector('[data-origens-kit-body]'), t.doc.querySelector('.add-product-modal__modal-content__footer').parentElement);
  assert.ok(t.doc.getElementById('most_sold_frame'), '"As mais vendidas" continua');
  // Uma busca, sem credenciais, com a região; medição sem código nem preço.
  assert.equal(t.fetches.length, 1);
  assert.equal(t.fetches[0].url, '/__origens/kit?origens_r=sul');
  assert.equal(t.fetches[0].credentials, 'omit');
  assert.deepEqual(named(t, 'kit_view'), [{ send_to: GA, region: 'sul', surface: 'ink', promo_id: '501', tiers: 4, transport_type: 'beacon' }]);
  assert.ok(!JSON.stringify(t.events).includes('KITTESTE'));
});

test('post-add-kit: "Copiar cupom" only copies the code, says so, and measures without the code; the clicks on the native buttons stay INK\'s', async () => {
  const t = setup();
  await tick();
  add(t);
  await openModal(t);
  const copy = t.doc.querySelector('.o-kit-copy');
  assert.equal(copy.getAttribute('type'), 'button');
  copy.click();
  await tick(20);
  assert.deepEqual(t.copied, ['KITTESTE']);
  assert.equal(copy.textContent, 'Copiado');
  assert.ok(copy.hasAttribute('data-copied'));
  assert.ok(copy.querySelector('svg'), 'um botão com ícone, não um texto');
  assert.equal(t.doc.querySelector('[data-origens-kit] > [role="status"]').textContent, 'Cupom KITTESTE copiado. Cole no carrinho.');
  assert.equal(named(t, 'kit_coupon_copy').length, 1);
  let inkClicks = 0;
  t.doc.querySelector('.checkout-btn').addEventListener('click', () => inkClicks++);
  t.doc.querySelector('.checkout-btn').click();
  assert.equal(inkClicks, 1);
  assert.equal(named(t, 'kit_checkout_click').length, 1);
  assert.ok(!JSON.stringify(t.events).includes('KITTESTE'));
});

test('post-add-kit: where the customer is comes from INK\'s own progressive bar in the cart (it knows which pieces count)', async () => {
  const t = setup({ payload: { v: 1, kit: { ...KIT, auto: true, tiers: [{ items: 3, discount: 25 }, { items: 4, discount: 50 }, { items: 5, discount: 75 }, { items: 6, discount: 100 }] } } });
  await tick();
  // A contagem diz 5, mas a barra da INK (que aplica a elegibilidade) diz 3: vale a barra.
  cart(t, { qty: 5, bar: '<strong class="ink-pd-bar__applied">R$ 25,00 OFF aplicado</strong> · adicione 1 peça e sobe para R$ 50,00 OFF' });
  add(t);
  await openModal(t);
  assert.equal(kit(t).getAttribute('data-state'), 'known');
  assert.equal(say(t), 'Você já ganhou R$ 25 OFF | Mais 1 peça e o desconto sobe para R$ 50 OFF.');
  assert.deepEqual(steps(t), ['done −R$ 25 3 peças', 'next −R$ 50 4 peças', 'todo −R$ 75 5 peças', 'todo −R$ 100 6 peças']);
  assert.equal(t.doc.querySelector('.o-kit-step[aria-current="step"] b').textContent.replace(/\u00a0/g, ' '), '−R$ 25');
  // Antes da primeira faixa e na última.
  cart(t, { qty: 1, bar: 'Adicione 2 peças e ganhe R$ 25,00 OFF' });
  t.doc.dispatchEvent(new t.w.Event('turbo:before-stream-render'));
  await tick();
  assert.equal(say(t), 'Faltam 2 peças para R$ 25 OFF | O desconto entra sozinho no carrinho.');
  assert.deepEqual(steps(t).map((x) => x.split(' ')[0]), ['next', 'todo', 'todo', 'todo']);
  cart(t, { qty: 7, bar: '<strong>R$ 100,00 OFF aplicado</strong>' });
  t.doc.dispatchEvent(new t.w.Event('turbo:before-stream-render'));
  await tick();
  assert.equal(say(t), 'Você já ganhou R$ 100 OFF | É o maior desconto do kit.');
  assert.deepEqual(steps(t).map((x) => x.split(' ')[0]), ['done', 'done', 'done', 'done']);
});

test('post-add-kit: without INK\'s bar (or with numbers that do not match the tiers) the cart count decides; nothing readable = the CMS copy', async () => {
  const t = setup();
  await tick();
  cart(t, { qty: 4, bar: 'R$ 30,00 OFF aplicado · adicione 1 peça e sobe para R$ 45,00 OFF' });
  add(t);
  await openModal(t);
  assert.equal(say(t), 'Seu kit já vale R$ 40 OFF | Mais 1 peça e o desconto sobe para R$ 60 OFF.');
  assert.deepEqual(steps(t).map((x) => x.split(' ')[0]), ['done', 'done', 'next', 'todo']);
  cart(t, { qty: 2 });
  t.doc.dispatchEvent(new t.w.Event('turbo:before-stream-render'));
  await tick();
  assert.equal(say(t), 'Falta 1 peça para R$ 25 OFF | Use o cupom no carrinho.');
  // Promoção em %: a barra (em R$) não serve; vale a contagem.
  const pct = setup({ payload: { v: 1, kit: { ...KIT, kind: 'percentage', tiers: [{ items: 15, discount: 20 }, { items: 20, discount: 12.5 }] } } });
  await tick();
  cart(pct, { qty: 16 });
  await openModal(pct);
  assert.deepEqual(steps(pct), ['done −20% 15 peças', 'next −12,5% 20 peças']);
  assert.equal(say(pct), 'Seu kit já vale 20% OFF | Mais 4 peças e o desconto sobe para 12,5% OFF.');
});
test('post-add-kit: a promotion INK applies by itself has no code to copy', async () => {
  const t = setup({ payload: { v: 1, kit: { ...KIT, auto: true } } });
  await tick();
  add(t);
  await openModal(t);
  assert.equal(t.doc.querySelector('.o-kit-auto').textContent, 'Desconto automático, sem cupom');
  assert.equal(t.doc.querySelector('.o-kit-copy, .o-kit-chip'), null);
});

test('post-add-kit: closing the modal or leaving the page takes the block out and gives the native labels back', async () => {
  const t = setup();
  await tick();
  add(t);
  await openModal(t);
  t.doc.getElementById('modal-wrapper').style.display = 'none';
  await tick();
  assert.equal(kit(t), null);
  assert.deepEqual(labels(t), ['Ver carrinho', 'Continuar comprando']);
  t.doc.getElementById('modal-wrapper').style.display = '';
  assert.notEqual(t.w.getComputedStyle(t.doc.getElementById('continue-shopping-button')).display, 'none', 'sem kit, o "Continuar comprando" volta');
  t.doc.getElementById('modal-wrapper').style.display = 'none';
  await tick();
  assert.equal(t.doc.querySelector('[data-origens-kit-footer], [data-origens-kit-head], [data-origens-kit-open], [data-origens-kit-body]'), null);
  assert.ok(![t.doc.getElementById('modal-close-button').parentElement, t.doc.querySelector('.add-product-modal__modal-content__footer')].some((el) => /--k-b/.test(el.getAttribute('style') || '')), 'as medidas saem junto');
  // Reaberto (nova adição, os mesmos nós): o bloco volta, com o carrinho desta adição.
  cart(t, { qty: 3 });
  add(t, 'form-product-4400001');
  t.doc.getElementById('modal-wrapper').style.display = '';
  await tick();
  assert.ok(kit(t));
  assert.equal(say(t), 'Seu kit já vale R$ 25 OFF | Mais 1 peça e o desconto sobe para R$ 40 OFF.');
  t.w.history.pushState({}, '', '/usesul/cart');
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + '/usesul/cart' } }));
  await tick();
  assert.equal(kit(t), null);
  assert.deepEqual(labels(t), ['Ver carrinho', 'Continuar comprando']);
  assert.equal(t.doc.getElementById('o-kit-style'), null);
});

test('post-add-kit fail-closed: off, kit null, error, or anything off the contract = the modal exactly as INK draws it', async () => {
  const cases = [
    { features: ['return-link'] },
    { payload: { v: 1, kit: null } },
    { status: 503, payload: { error: 'unavailable' } },
    { payload: { v: 2, kit: KIT } },
    { payload: { v: 1, kit: { ...KIT, code: '<b>' } } },
    { payload: { v: 1, kit: { ...KIT, title: 'Kit <img src=x>' } } },
    { payload: { v: 1, kit: { ...KIT, tiers: [{ items: 4, discount: 40 }, { items: 3, discount: 25 }] } } },
    { payload: { v: 1, kit: { ...KIT, kind: 'percentage', tiers: [{ items: 3, discount: 100 }] } } },
    { payload: { v: 1, kit: { ...KIT, endsAt: '2020-01-01T00:00:00Z' } } }
  ];
  for (const c of cases) {
    const t = setup(c);
    await tick();
    add(t);
    await openModal(t);
    assert.equal(kit(t), null, JSON.stringify(c).slice(0, 120));
    assert.deepEqual(labels(t), ['Ver carrinho', 'Continuar comprando']);
    if (c.features) assert.equal(t.fetches.length, 0, 'desligada: nem a busca');
  }
});
