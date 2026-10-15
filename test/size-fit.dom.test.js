import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// size-fit ("Informar medidas") no navegador (jsdom), sobre a PDP real reduzida (quadro de opções com variantes, link de medidas, modal oficial).
const FIXTURE = readFileSync(new URL('./fixtures/product-page-size-fit.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/paranaense-pe-vermelho';
const GA = 'G-8GYTEJ1F77';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['size-guide', 'size-fit'], html = FIXTURE } = {}) {
  html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const submits = []; w.document.addEventListener('submit', (e) => { submits.push(e.target.id); e.preventDefault(); });
  w.eval(buildLoaderSource([], features, 'product-catalog'));
  return { w, doc: w.document, events, submits };
}
const trigger = (doc) => doc.querySelector('button[data-origens-fit]');
const dialog = (doc) => doc.getElementById('o-fit');
const radio = (doc, name, value) => doc.querySelector('input[name="' + name + '"][value="' + value + '"]');
async function compare(t, width, length = '') {
  dialog(t.doc).querySelector('#o-fit-width').value = width;
  dialog(t.doc).querySelector('#o-fit-length').value = length;
  dialog(t.doc).querySelector('form').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(20);
}

test('size-fit: "Informar medidas" sits next to the size guide link, in one row; the native link is the same node, still inside the form scope', async () => {
  const t = setup();
  const native = t.doc.getElementById('open-modal-size');
  await tick();
  const row = t.doc.querySelector('[data-origens-fit-row]');
  assert.ok(row);
  assert.equal(row.children[0], native, 'native link moved into the row, never cloned');
  assert.ok(native.hasAttribute('data-origens-size'), 'size-guide still decorates it');
  assert.equal(row.children[1], trigger(t.doc));
  assert.equal(trigger(t.doc).type, 'button');
  assert.equal(trigger(t.doc).textContent, 'Informar medidas');
  assert.equal(trigger(t.doc).style.getPropertyValue('--o-fit-tint'), '#4d543d');
  t.doc.body.appendChild(t.doc.createElement('div')); await tick();
  assert.equal(t.doc.querySelectorAll('button[data-origens-fit]').length, 1, 'idempotent');
  trigger(t.doc).click(); await tick(20);
  assert.deepEqual(t.submits, [], 'never submits the product form');
});

test('size-fit: two models and none checked: asks the model first; choosing one clicks INK\'s own radio and shows that table', async () => {
  const t = setup();
  await tick();
  trigger(t.doc).click(); await tick(20);
  const d = dialog(t.doc);
  assert.equal(d.getAttribute('role'), 'dialog');
  assert.equal(d.getAttribute('aria-modal'), 'true');
  const models = Array.from(d.querySelectorAll('.o-fit-models button')).map((b) => b.textContent);
  assert.deepEqual(models, ['Baby Look | Feminina', 'Clássica | Unissex'], 'the model names INK shows on its own buttons');
  d.querySelector('.o-fit-models button:nth-child(2)').click(); await tick(20);
  assert.equal(radio(t.doc, 'style', 'Masculino').checked, true);
  assert.match(d.textContent, /Comparando com: Camiseta clássica \(unissex\)/);
  assert.equal(t.doc.activeElement.id, 'o-fit-width', 'focus moves to the width field');
});

test('size-fit: compares, shows the closest size with cm differences, and "Usar tamanho" marks INK\'s size radio only when available', async () => {
  const t = setup();
  await tick();
  radio(t.doc, 'style', 'Masculino').click();
  radio(t.doc, 'color', 'Branca').click();
  trigger(t.doc).click(); await tick(20);
  await compare(t, '55,5', '73');
  const d = dialog(t.doc);
  assert.match(d.querySelector('.o-fit-verdict').textContent, /O tamanho G tem as medidas mais próximas/);
  assert.match(d.querySelector('.o-fit-result table').textContent, /0,5 cm a mais/);
  const [useG, useM] = Array.from(d.querySelectorAll('.o-fit-actions .o-fit-cta'));
  assert.equal(useG.textContent, 'Usar tamanho G');
  assert.equal(useM.textContent, 'Usar tamanho M');
  useM.click(); await tick(20);
  assert.match(d.querySelector('.o-fit-status').textContent, /O M não está disponível nesta cor e modelo/);
  assert.equal(radio(t.doc, 'size', 'M').checked, false, 'sold out: nothing is marked');
  useG.click(); await tick(20);
  assert.equal(radio(t.doc, 'size', 'G').checked, true);
  assert.equal(dialog(t.doc), null, 'closes after marking');
  assert.equal(t.doc.activeElement, trigger(t.doc));
  assert.deepEqual(t.submits, []);
});

test('size-fit: validation errors are tied to their fields; switching the model on the page redoes the comparison with the new table', async () => {
  const t = setup();
  await tick();
  radio(t.doc, 'style', 'Masculino').click();
  trigger(t.doc).click(); await tick(20);
  await compare(t, '530');
  const width = dialog(t.doc).querySelector('#o-fit-width');
  assert.equal(width.getAttribute('aria-invalid'), 'true');
  assert.match(dialog(t.doc).querySelector('#o-fit-width-err').textContent, /milímetros/);
  await compare(t, '45');
  assert.match(dialog(t.doc).querySelector('.o-fit-verdict').textContent, /tamanho P/);
  radio(t.doc, 'style', 'Feminino').click(); await tick(20);
  const d = dialog(t.doc);
  assert.match(d.querySelector('.o-fit-swap').textContent, /Você trocou para Baby Look \| Feminina\. A comparação foi refeita com a tabela Camiseta baby look/);
  assert.match(d.querySelector('.o-fit-verdict').textContent, /tamanho M/, 'baby look busto 45 = M');
});

test('size-fit: full table toggles; Escape closes and returns focus; "Abrir guia oficial" activates the native link once', async () => {
  const t = setup();
  await tick();
  radio(t.doc, 'style', 'Feminino').click();
  trigger(t.doc).click(); await tick(20);
  const toggle = Array.from(dialog(t.doc).querySelectorAll('.o-fit-link')).find((b) => /tabela completa/.test(b.textContent));
  toggle.click(); await tick(20);
  assert.match(dialog(t.doc).querySelector('.o-fit-full').textContent, /PP/);
  assert.match(dialog(t.doc).querySelector('.o-fit-full caption').textContent, /tolerância ±1 cm/);
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog(t.doc), null);
  assert.equal(t.doc.activeElement, trigger(t.doc));
  let opened = 0; t.doc.getElementById('open-modal-size').addEventListener('click', (e) => { opened++; e.preventDefault(); });
  trigger(t.doc).click(); await tick(20);
  Array.from(dialog(t.doc).querySelectorAll('.o-fit-link')).find((b) => /guia oficial/.test(b.textContent)).click();
  assert.equal(opened, 1);
  assert.equal(dialog(t.doc), null);
});

test('size-fit: a re-rendered variant frame gets a new row; teardown puts the native link back exactly where it was', async () => {
  const t = setup({ features: ['size-fit'] });
  await tick();
  const frame = t.doc.getElementById('product_variants_options_frame');
  frame.innerHTML = FIXTURE.match(/<turbo-frame loading="lazy" id="product_variants_options_frame"[^>]*>([\s\S]*?)<\/turbo-frame>/)[1];
  await tick();
  assert.equal(t.doc.querySelectorAll('[data-origens-fit-row]').length, 1);
  assert.equal(t.doc.querySelectorAll('button[data-origens-fit]').length, 1);
  const link = t.doc.getElementById('open-modal-size');
  assert.equal(link.parentElement.hasAttribute('data-origens-fit-row'), true);
  assert.match(link.textContent, /Confira suas medidas/, 'without size-guide the native text stays');
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  assert.equal(t.doc.querySelector('[data-origens-fit-row], button[data-origens-fit], #o-fit-style'), null);
  assert.equal(t.doc.getElementById('open-modal-size').previousElementSibling.querySelector('input[name="quantity"]') !== null, true, 'back after the quantity block');
});

test('size-fit: a piece without a known table (kids, replaced image) gets no button; flag off = nothing of ours', async () => {
  const kids = setup({ html: FIXTURE.replace(/size_table\/[0-9a-f]{32}\.webp/g, 'size_table/7c28ff77ab96e626e016a462cef00ab2.webp') });
  await tick();
  assert.equal(trigger(kids.doc), null);
  assert.equal(kids.doc.querySelector('[data-origens-fit-row]'), null);
  assert.ok(kids.doc.querySelector('a[data-origens-size]'), 'the size guide is still there');
  const off = setup({ features: ['size-guide'] });
  await tick();
  assert.equal(off.doc.querySelector('[data-origens-fit], [data-origens-fit-row], #o-fit-style'), null);
});

test('size-fit analytics: open, result and use go through INK gtag only; low cardinality, no measurements, no URL', async () => {
  const t = setup();
  await tick();
  radio(t.doc, 'style', 'Masculino').click();
  radio(t.doc, 'color', 'Preta').click();
  trigger(t.doc).click(); await tick(20);
  await compare(t, '54');
  dialog(t.doc).querySelector('.o-fit-actions .o-fit-cta').click(); await tick(20);
  assert.deepEqual(t.events.map((e) => e[1]), ['origens_size_fit_open', 'origens_size_fit_result', 'origens_size_fit_use']);
  assert.deepEqual(t.events[2][2], { send_to: GA, region: 'sul', surface: 'ink', transport_type: 'beacon', size: 'M', fit_table: 'camiseta-classica' });
  const json = JSON.stringify(t.events);
  assert.ok(!json.includes('http') && !json.includes('54'), 'no URL and no body measurement in any event');
});
