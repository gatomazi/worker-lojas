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
const rows = (t) => [...t.doc.querySelectorAll('.o-kit-tier')].map((li) => [...li.querySelectorAll('[aria-hidden="true"], .o-kit-qty, .o-kit-off')].filter((n) => n.parentElement === li).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
const labels = (t) => [...t.doc.querySelectorAll('.add-product-modal__modal-content__footer span')].map((s) => s.textContent);

test('post-add-kit: the block goes BEFORE the native buttons, with the price of the piece just added; the native buttons only change their label', async () => {
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
  assert.equal(block.getAttribute('data-priced'), 'true');
  const nbsp = (s) => s.replace(/ /g, ' ');
  assert.deepEqual(rows(t).map(nbsp), [
    '3 peças | de R$ 329,70por R$ 304,70 | R$ 101,57 cadaeconomize R$ 25,00',
    '4 peças | de R$ 439,60por R$ 399,60 | R$ 99,90 cadaeconomize R$ 40,00',
    '5 peças | de R$ 549,50por R$ 489,50 | R$ 97,90 cadaeconomize R$ 60,00',
    '6 peças | de R$ 659,40por R$ 574,40 | R$ 95,73 cadaeconomize R$ 85,00'
  ]);
  // A frase inteira para leitor de tela; o visual fica escondido dele.
  assert.equal(nbsp(t.doc.querySelector('.o-kit-tier .o-kit-sr').textContent), '3 peças: de R$ 329,70 por R$ 304,70, R$ 101,57 cada, economia de R$ 25,00.');
  assert.deepEqual([...t.doc.querySelectorAll('.o-kit-tier')].map((li) => li.hasAttribute('data-best')), [false, false, false, true]);
  assert.equal(block.querySelector('.o-kit-note').textContent, 'Em peças com preços diferentes, o total do kit pode variar.');
  // Os mesmos botões da INK, com o ícone; só o texto do rótulo.
  assert.deepEqual(labels(t), ['Finalizar compra', 'Escolher mais produtos']);
  assert.ok(t.doc.querySelector('.checkout-btn svg'));
  assert.ok(t.doc.querySelector('.add-product-modal__modal-content__footer').hasAttribute('data-origens-kit-footer'));
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
  assert.equal(t.doc.querySelector('[data-origens-kit] > [role="status"]').textContent, 'Cupom KITTESTE copiado. Cole no carrinho.');
  assert.equal(named(t, 'kit_coupon_copy').length, 1);
  let inkClicks = 0;
  t.doc.querySelector('.checkout-btn').addEventListener('click', () => inkClicks++);
  t.doc.querySelector('.checkout-btn').click();
  assert.equal(inkClicks, 1);
  assert.equal(named(t, 'kit_checkout_click').length, 1);
  assert.ok(!JSON.stringify(t.events).includes('KITTESTE'));
});

test('post-add-kit: the price follows the form that was sent (a "compre junto" in promotion counts its charged price, never the struck one)', async () => {
  const t = setup();
  await tick();
  add(t, 'form-product-4400001');
  await openModal(t);
  assert.match(rows(t)[0].replace(/ /g, ' '), /^3 peças \| de R\$ 299,70por R\$ 274,70 \| R\$ 91,57 cada/);
});

test('post-add-kit: in INK\'s price anchor (real PDP markup of 27/10/2026) the charged price is the lowest whole price, even with the regular one not struck', async () => {
  const REAL = '<div class="flex flex-col items-start gap-1 font-medium mt-5 lg:mt-0" data-ink-labs-anchor="product_price"><span class="flex flex-col justify-center flex-wrap gap-1 font-semibold">' +
    '<div class="flex items-center gap-2"><p class="text-gray-500 text-base">R$ 129,90</p><p class="text-4xl font-medium">R$ 99,90</p></div></span><p class="font-medium text-base">ou <span class="text-green-500">5x de R$ 19,98 sem juros</span></p></div>';
  const t = setup();
  await tick();
  const form = t.doc.getElementById('form-product-3789914');
  form.querySelector('.text-4xl').parentElement.outerHTML = REAL;
  add(t);
  await openModal(t);
  assert.match(rows(t)[0].replace(/\u00a0/g, ' '), /^3 peças \| de R\$ 299,70por R\$ 274,70/);
});

test('post-add-kit: no price read (nothing sent just before) = the tiers show only INK\'s discounts, no made-up totals', async () => {
  const t = setup();
  await tick();
  await openModal(t);
  assert.equal(kit(t).getAttribute('data-priced'), 'false');
  assert.deepEqual(rows(t), ['3 peças | R$ 25 OFF no total', '4 peças | R$ 40 OFF no total', '5 peças | R$ 60 OFF no total', '6 peças | R$ 85 OFF no total']);
  const pct = setup({ payload: { v: 1, kit: { ...KIT, kind: 'percentage', tiers: [{ items: 15, discount: 20 }, { items: 20, discount: 12.5 }] } } });
  await tick();
  await openModal(pct);
  assert.deepEqual(rows(pct), ['15 peças | 20% OFF no total', '20 peças | 12,5% OFF no total']);
});

test('post-add-kit: a promotion INK applies by itself has no code to copy', async () => {
  const t = setup({ payload: { v: 1, kit: { ...KIT, auto: true } } });
  await tick();
  add(t);
  await openModal(t);
  assert.equal(t.doc.querySelector('.o-kit-chip').textContent, 'Desconto aplicado no carrinho');
  assert.equal(t.doc.querySelector('.o-kit-copy'), null);
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
  assert.equal(t.doc.querySelector('[data-origens-kit-footer]'), null);
  // Reaberto (nova adição, os mesmos nós): o bloco volta, com o preço desta adição.
  add(t, 'form-product-4400001');
  t.doc.getElementById('modal-wrapper').style.display = '';
  await tick();
  assert.ok(kit(t));
  assert.match(rows(t)[0], /274,70/);
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
