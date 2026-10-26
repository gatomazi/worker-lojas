import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// pdp-cep + pdp-coupons no navegador (jsdom), sobre a PDP real reduzida (prazo e cupons com a marcação da INK de 26/10/2026). O "Turbo" daqui só faz o
// que o da INK faz com o formulário externo do CEP: assume o envio (preventDefault), e a resposta chega como na INK real — turbo:submit-end e, logo
// depois, os streams "cart", o conteúdo do modal e "remaining_delivery_time" (ou só "cart", com o erro, para um CEP sem entrega).
const FIXTURE = readFileSync(new URL('./fixtures/product-page-offers.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/balneario-camboriu-origem-sc';
const GA = 'G-8GYTEJ1F77';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['pdp-cep', 'pdp-coupons'], html = FIXTURE, turbo = 'takes', stored = null } = {}) {
  html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (stored) w.sessionStorage.setItem('origens:cep', stored);
  if (turbo) w.Turbo = { renderStreamMessage() {} };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copied.push(text); } } });
  Object.defineProperty(w, 'isSecureContext', { configurable: true, value: true });
  const sent = []; // envios do formulário externo que o "Turbo" assumiu (os parâmetros, como iriam na URL)
  const native = { productSubmits: 0, otherSubmits: [] };
  w.document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.id === 'delivery-estimates-form') { if (turbo === 'takes') { e.preventDefault(); sent.push([...new w.FormData(form)]); } return; }
    if (/^form-product-/.test(form.id)) native.productSubmits++; else native.otherSubmits.push(form.className || form.id || form.tagName);
    e.preventDefault();
  });
  w.eval(buildLoaderSource([], features, 'product-catalog'));
  return { w, doc: w.document, events, copied, sent, native };
}
const cepBlock = (t) => t.doc.querySelector('#delivery_estimates_frame > .o-cep');
const cepInput = (t) => t.doc.querySelector('.o-cep-input');
const cepOut = (t) => [...t.doc.querySelector('.o-cep-out').children].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
const named = (t, name) => t.events.filter((e) => e[0] === 'event' && e[1] === name).map((e) => e[2]);

function typeAndSubmit(t, value) {
  const input = cepInput(t);
  input.value = value;
  input.dispatchEvent(new t.w.Event('input', { bubbles: true }));
  const form = input.form;
  form.dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
}
function stream(t, action, target, html) {
  const el = t.doc.createElement('turbo-stream');
  el.setAttribute('action', action); el.setAttribute('target', target);
  const tpl = t.doc.createElement('template'); tpl.innerHTML = html; el.appendChild(tpl);
  return el;
}
const WHEN = (lead, dates) => '<div class="flex flex-col gap-2"><p class="text-gray-900 text-base font-normal">' + lead + ' <span class="font-semibold text-gray-900 lowercase">' + dates + '</span>.</p><p class="text-gray-500 text-base font-normal">Comprando dentro das próximas <span class="text-green-500 font-medium"> 1 hora e 41 minutos. </span></p></div>';
const MODAL = (cep, place) => '<div class="px-4 py-6"><span>A receber</span><input form="delivery-estimates-form" disabled id="postal-code-field" type="text" name="postal_code" value="CEP ' + cep + ' - ' + place + '"><a href="/usesul/delivery_estimates?store_slug=usesul">Escolher outro CEP</a>' + WHEN('Entrega até', 'x') + '</div>';
// A resposta da INK: submit-end primeiro e, ~2 ms depois, os streams (o evento de cada um sai antes de a INK aplicar; aqui a "INK" aplica em seguida).
function respond(t, { success = true, cep, place, lead = 'Entrega até', dates = 'Terça, 3 de Novembro', error = '' } = {}) {
  const form = t.doc.getElementById('delivery-estimates-form');
  form.dispatchEvent(new t.w.CustomEvent('turbo:submit-end', { bubbles: true, detail: { success } }));
  if (!success) return;
  const streams = [stream(t, 'replace', 'cart', '<turbo-frame id="cart"><div class="cart-errors mx-4 mt-4" data-ink-store--cart-target="cartErrors">' + error + '</div></turbo-frame>')];
  if (cep) streams.push(stream(t, 'update', 'delivery-estimates-content-modal-frame', MODAL(cep, place)), stream(t, 'update', 'remaining_delivery_time', WHEN(lead, dates)));
  for (const s of streams) { t.doc.documentElement.appendChild(s); s.dispatchEvent(new t.w.CustomEvent('turbo:before-stream-render', { bubbles: true, cancelable: true })); }
  if (cep) {
    t.doc.getElementById('delivery-estimates-content-modal-frame').innerHTML = MODAL(cep, place);
    t.doc.getElementById('remaining_delivery_time').innerHTML = WHEN(lead, dates);
  }
  for (const s of streams) s.remove();
}

test('pdp-cep: the CEP field goes INSIDE the delivery frame; the native modal stays in the DOM and its trigger is hidden only while ours is there', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  const block = cepBlock(t);
  assert.ok(block, 'our block was mounted inside #delivery_estimates_frame');
  assert.equal(block.querySelector('.o-cep-title').textContent, 'Prazo de entrega');
  const input = cepInput(t);
  assert.equal(input.getAttribute('inputmode'), 'numeric');
  assert.equal(input.getAttribute('autocomplete'), 'postal-code');
  assert.equal(input.maxLength, 9);
  assert.equal(block.querySelector('.o-cep-go').textContent, 'Calcular');
  assert.equal(block.querySelector('.o-cep-finder').getAttribute('target'), '_blank');
  assert.doesNotMatch(block.textContent, /frete/i, 'the INK gives a delivery window, not a shipping price: no "frete" promise');
  assert.ok(t.doc.getElementById('cheapest-estimate-button'), 'native trigger kept');
  assert.ok(t.doc.getElementById('delivery-estimates-modal'), 'native modal kept');
  const css = t.doc.getElementById('o-cep-style').textContent;
  assert.match(css, /turbo-frame#delivery_estimates_frame:has\(> \.o-cep\) :is\(#cheapest-estimate,#remaining_delivery_time,#cheapest-estimate-button\)\{display:none!important\}/);
  t.doc.body.appendChild(t.doc.createElement('div')); await tick();
  assert.equal(t.doc.querySelectorAll('.o-cep').length, 1, 'idempotent across observer ticks');
});

test('pdp-cep: our field has OUR form as owner — Enter/submit never reaches the purchase form (its ancestor) nor Turbo', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  const input = cepInput(t);
  const product = t.doc.getElementById('form-product-3789914');
  assert.ok(product.contains(input), 'the delivery frame lives inside the purchase form');
  assert.notEqual(input.form, product, 'but the input is NOT owned by it');
  assert.ok(input.form.classList.contains('o-cep-form'));
  assert.ok(!new t.w.FormData(product).has('o_cep'), 'never serialized with the purchase');
  typeAndSubmit(t, '8801');
  await tick();
  assert.equal(t.native.productSubmits, 0);
  assert.deepEqual(t.native.otherSubmits, [], 'our submit event stops at our form');
  assert.equal(t.sent.length, 0, 'an incomplete CEP is not sent');
  assert.match(cepOut(t), /8 números/);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
});

test('pdp-cep: a CEP goes through the INK outer form (product_id + postal_code) and the delivery window is shown from THIS response', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  typeAndSubmit(t, '88010000');
  assert.equal(cepInput(t).value, '88010-000', 'masked as 00000-000');
  assert.deepEqual(t.sent, [[['product_id', '3789914'], ['postal_code', '88010-000']]]);
  assert.equal(t.doc.querySelectorAll('#delivery-estimates-form input[name="postal_code"]').length, 0, 'the temporary field leaves right after the send');
  assert.equal(t.doc.querySelector('.o-cep-go').disabled, true);
  assert.equal(t.doc.querySelector('.o-cep-go').textContent, 'Calculando…');
  typeAndSubmit(t, '01001000');
  assert.equal(t.sent.length, 1, 'one calculation at a time');
  respond(t, { cep: '88010-000', place: 'Centro, Florianópolis' });
  await tick(30);
  assert.equal(cepBlock(t).getAttribute('data-state'), 'done');
  assert.equal(cepOut(t), 'CEP 88010-000 · Centro, Florianópolis | Entrega até terça, 3 de novembro | Comprando dentro das próximas 1 hora e 41 minutos.');
  assert.equal(t.doc.querySelector('.o-cep-when strong').textContent, 'terça, 3 de novembro');
  assert.equal(t.doc.querySelector('.o-cep-form').hidden, true);
  assert.equal(t.doc.querySelector('.o-cep-change').hidden, false);
  assert.equal(t.w.sessionStorage.getItem('origens:cep'), '88010-000');
  const calc = named(t, 'origens_cep_calc');
  assert.equal(calc.length, 1);
  assert.equal(calc[0].result, 'ok');
  assert.doesNotMatch(JSON.stringify(t.events), /88010|Florian|Centro/, 'analytics never carry the CEP or the place');
  assert.equal(t.native.productSubmits, 0);
});

test('pdp-cep: a CEP with no delivery AFTER a valid one says so (the page still shows the old window, but this response had none)', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  typeAndSubmit(t, '88010000'); respond(t, { cep: '88010-000', place: 'Centro, Florianópolis' }); await tick(30);
  t.doc.querySelector('.o-cep-change').click();
  assert.equal(cepInput(t).value, '88010-000', '"Alterar CEP" brings the field back, filled');
  typeAndSubmit(t, '00000000');
  respond(t, { error: 'Não temos transportadora disponível para entregar neste CEP. Tente outro endereço ou fale com o suporte da loja.' });
  await tick(30);
  assert.match(cepOut(t), /Não há entrega disponível para esse CEP/);
  assert.notEqual(cepBlock(t).getAttribute('data-state'), 'done');
  assert.equal(named(t, 'origens_cep_calc').at(-1).result, 'not_found');
  assert.equal(t.doc.querySelector('.o-cep-go').disabled, false);
});

test('pdp-cep: a failed request, or a send nobody took (no Turbo listening), ends in a retry message — never a navigation', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  typeAndSubmit(t, '01001000'); respond(t, { success: false }); await tick(30);
  assert.match(cepOut(t), /Não foi possível calcular agora/);
  const u = setup({ features: ['pdp-cep'], turbo: 'present-but-idle' });
  await tick();
  typeAndSubmit(u, '01001000'); await tick(30);
  assert.match(cepOut(u), /Não foi possível calcular agora/);
  assert.equal(u.w.location.pathname, PATH);
  assert.equal(u.doc.querySelector('.o-cep-go').disabled, false);
});

test('pdp-cep: without Turbo nothing is mounted (the native link and modal stay as they are)', async () => {
  const t = setup({ features: ['pdp-cep'], turbo: null });
  await tick();
  assert.equal(t.doc.querySelector('.o-cep'), null);
  assert.equal(t.doc.getElementById('o-cep-style'), null);
});

test('pdp-cep: the region estimate the INK already shows becomes the hint; the last CEP of this tab pre-fills the field (no automatic request)', async () => {
  const html = FIXTURE.replace('<span id="cheapest-estimate" class="text-gray-600 text-base font-normal leading-4">', '<span id="cheapest-estimate" class="text-gray-600 text-base font-normal leading-4">Estimativa de entrega até 05 de novembro em Santa Catarina');
  const t = setup({ features: ['pdp-cep'], html, stored: '88010-000' });
  await tick();
  assert.equal(t.doc.querySelector('.o-cep-hint').textContent, 'Estimativa de entrega até 05 de novembro em Santa Catarina. Informe o CEP para o prazo exato.');
  assert.equal(cepInput(t).value, '88010-000');
  assert.equal(t.sent.length, 0);
});

test('pdp-cep: a re-rendered delivery frame gets the block back on turbo:frame-render (no flash of the native link); teardown restores the native', async () => {
  const t = setup({ features: ['pdp-cep'] });
  await tick();
  const frame = t.doc.getElementById('delivery_estimates_frame');
  const inner = FIXTURE.match(/<turbo-frame id="delivery_estimates_frame"[^>]*>([\s\S]*?)<\/turbo-frame>\s*<turbo-frame id="product_promotions_frame"/)[1];
  frame.innerHTML = inner;
  assert.equal(cepBlock(t), null);
  frame.dispatchEvent(new t.w.CustomEvent('turbo:frame-render', { bubbles: true }));
  assert.ok(cepBlock(t), 'remounted in the same instant');
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  assert.equal(t.doc.querySelector('.o-cep'), null);
  assert.equal(t.doc.getElementById('o-cep-style'), null);
  assert.ok(t.doc.getElementById('cheapest-estimate-button'));
});

test('pdp-coupons: one tab per INK coupon, with what it gives, the savings, the progressive tiers and the conditions; the native box hidden only while ours is there', async () => {
  const t = setup({ features: ['pdp-coupons'] });
  await tick();
  const block = t.doc.querySelector('#product_promotions_frame > .o-cpn');
  assert.ok(block);
  assert.equal(block.querySelector('.o-cpn-ttl').textContent, 'Cupons para esta peça');
  const tabs = [...block.querySelectorAll('.o-cpn-tab')];
  assert.deepEqual(tabs.map((b) => b.textContent.trim()), ['PRIMEIRACOMPRA', 'LEVEMAIS']);
  assert.deepEqual(tabs.map((b) => b.getAttribute('role')), ['tab', 'tab']);
  assert.deepEqual(tabs.map((b) => b.getAttribute('aria-selected')), ['true', 'false']);
  const panels = [...block.querySelectorAll('.o-cpn-panel')];
  assert.deepEqual(panels.map((p) => p.hidden), [false, true]);
  assert.equal(panels[0].querySelector('.o-cpn-main').textContent, '10% de desconto', 'no "first purchase" claim: the INK card does not state it');
  assert.equal(panels[0].querySelector('.o-cpn-save').textContent, 'Você economiza R$ 10,99 na compra');
  assert.equal(panels[1].querySelector('.o-cpn-main').textContent, 'Leve mais, pague menos');
  assert.equal(panels[1].querySelector('.o-cpn-save').textContent, 'Você economiza até R$ 85 na compra');
  assert.deepEqual([...panels[1].querySelectorAll('.o-cpn-tiers li')].map((li) => li.textContent), ['3 itens: R$ 25 OFF', '4 itens: R$ 40 OFF', '5 itens: R$ 60 OFF', '6 itens: R$ 85 OFF']);
  assert.equal(panels[1].querySelector('.o-cpn-rules').textContent, 'Mínimo do carrinho: 3 itens');
  assert.ok(t.doc.getElementById('product-promotions-modal'), 'official modal kept in the DOM');
  assert.ok(t.doc.querySelector('#product_promotions_frame > div.border'), 'native box kept in the DOM');
  assert.match(t.doc.getElementById('o-cpn-style').textContent, /turbo-frame#product_promotions_frame:has\(> \.o-cpn\) > div\.border\{display:none!important\}/);
});

test('pdp-coupons: tabs switch by click and arrows; "Copiar" copies the code, says where to use it and measures only the code', async () => {
  const t = setup({ features: ['pdp-coupons'] });
  await tick();
  const tabs = () => [...t.doc.querySelectorAll('.o-cpn-tab')];
  const panels = () => [...t.doc.querySelectorAll('.o-cpn-panel')];
  tabs()[1].click();
  assert.deepEqual(panels().map((p) => p.hidden), [true, false]);
  tabs()[1].dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(panels().map((p) => p.hidden), [false, true], 'wraps around');
  assert.equal(t.doc.activeElement, tabs()[0]);
  assert.deepEqual(tabs().map((b) => b.tabIndex), [0, -1], 'roving tabindex');
  panels()[0].querySelector('.o-cpn-copy').click();
  await tick(20);
  assert.deepEqual(t.copied, ['PRIMEIRACOMPRA']);
  assert.equal(panels()[0].querySelector('.o-cpn-copy').textContent, 'Copiado');
  assert.match(t.doc.querySelector('.o-cpn-status').textContent, /PRIMEIRACOMPRA copiado\. Cole no campo de cupom do carrinho\./);
  assert.doesNotMatch(t.doc.querySelector('.o-cpn').textContent, /aplicado/i, 'never claims the discount was applied');
  assert.deepEqual(named(t, 'origens_coupon_copy').map((p) => p.coupon), ['PRIMEIRACOMPRA']);
});

test('pdp-coupons: the lazy frame mounts as soon as the INK renders it; empty/unknown markup keeps the native box; teardown restores it', async () => {
  const lazy = FIXTURE.replace(/(<turbo-frame id="product_promotions_frame"[^>]*?) complete="">[\s\S]*?(<\/turbo-frame>\s*<turbo-frame loading="lazy" id="product_variants_options_frame")/, '$1></turbo-frame><turbo-frame loading="lazy" id="product_variants_options_frame"').replace(/<\/turbo-frame>\s*<turbo-frame loading="lazy" id="product_variants_options_frame"/, '</turbo-frame><turbo-frame loading="lazy" id="product_variants_options_frame"');
  const t = setup({ features: ['pdp-coupons'], html: lazy });
  await tick();
  const frame = t.doc.getElementById('product_promotions_frame');
  assert.equal(frame.children.length, 0);
  assert.equal(t.doc.querySelector('.o-cpn'), null);
  frame.innerHTML = FIXTURE.match(/<turbo-frame id="product_promotions_frame"[^>]*>([\s\S]*?)<\/turbo-frame>\s*<turbo-frame loading="lazy"/)[1];
  frame.setAttribute('complete', '');
  frame.dispatchEvent(new t.w.CustomEvent('turbo:frame-render', { bubbles: true }));
  assert.ok(frame.querySelector(':scope > .o-cpn'), 'mounted in the same instant');
  const u = setup({ features: ['pdp-coupons'], html: FIXTURE.replace(/data-controller="ink-store--clipboard"/g, 'data-controller="x"') });
  await tick();
  assert.equal(u.doc.querySelector('.o-cpn'), null, 'no readable coupon: native box stays');
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  assert.equal(t.doc.querySelector('.o-cpn'), null);
  assert.equal(t.doc.getElementById('o-cpn-style'), null);
});

test('flags: neither module (nor its CSS) without its flag; each one alone works', async () => {
  const none = setup({ features: ['return-link'] });
  await tick();
  assert.equal(none.doc.querySelector('.o-cep, .o-cpn'), null);
  const src = buildLoaderSource([], ['return-link'], 'product-catalog');
  assert.doesNotMatch(src, /id: 'pdp-cep'|id: 'pdp-coupons'/);
  const cepOnly = buildLoaderSource([], ['pdp-cep'], 'product-catalog');
  assert.match(cepOnly, /id: 'pdp-cep'/); assert.doesNotMatch(cepOnly, /id: 'pdp-coupons'/); assert.match(cepOnly, /function pdpTrack/);
  const cpnOnly = buildLoaderSource([], ['pdp-coupons'], 'product-catalog');
  assert.match(cpnOnly, /id: 'pdp-coupons'/); assert.doesNotMatch(cpnOnly, /id: 'pdp-cep'/); assert.match(cpnOnly, /function pdpTrack/);
});
