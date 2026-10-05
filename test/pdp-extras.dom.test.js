import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { STORES } from '../src/stores.js';

// pdp-share + size-guide no navegador (jsdom), sobre a PDP real sanitizada (dois títulos, link "Confira suas medidas" no frame da variante, modal oficial).
const FIXTURE = readFileSync(new URL('./fixtures/product-page-size-share.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/paranaense-pe-vermelho';
const GA = 'G-8GYTEJ1F77';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['pdp-share', 'size-guide'], html = FIXTURE, query = '?cart_ref=abc&ls=tok.sig&origens_src=ink_product_return&utm_source=x#reviews', share, canShare, store } = {}) {
  html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + PATH + query, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const shared = [];
  if (share !== undefined) Object.defineProperty(w.navigator, 'share', { configurable: true, value: share === null ? undefined : (data) => { shared.push(data); return share(data); } });
  if (canShare !== undefined) Object.defineProperty(w.navigator, 'canShare', { configurable: true, value: canShare });
  const submits = []; w.document.addEventListener('submit', (e) => { submits.push(e.target.id); e.preventDefault(); });
  w.eval(buildLoaderSource([], features, 'product-catalog', store));
  return { w, doc: w.document, events, shared, submits };
}
const sizeLink = (doc) => doc.getElementById('open-modal-size');
const shareButtons = (doc) => doc.querySelectorAll('button[data-origens-share]');

test('size-guide: the native link becomes "Guia de medidas" with the tape icon and the region tint, on the SAME node, href and Stimulus action', async () => {
  const t = setup({ features: ['size-guide'] });
  const native = sizeLink(t.doc);
  await tick();
  const link = sizeLink(t.doc);
  assert.equal(link, native, 'same element: never cloned or replaced');
  assert.ok(link.hasAttribute('data-origens-size'));
  assert.equal(link.getAttribute('href'), '#modal-product');
  assert.equal(link.getAttribute('data-action'), 'click->ink-store--product-page#openModalOfSizes');
  assert.equal(link.getAttribute('form'), 'form-product-5072062');
  assert.equal(link.querySelector('.o-size-label').textContent, 'Guia de medidas');
  assert.ok(link.querySelector('.o-size-icon svg'));
  assert.equal(link.style.getPropertyValue('--o-size-tint'), '#4d543d', 'Sul olive, from stores.js');
  assert.ok(t.doc.getElementById('o-size-style'));
  assert.match(link.querySelector('.o-size-native').textContent, /Confira suas medidas/, 'original text kept in the DOM, only hidden');
  assert.ok(link.querySelector('img[alt="Fita metrica"]'), 'native image kept (hidden by our scoped CSS)');
});

test('size-guide: idempotent across mutations and a re-rendered variant frame; one click = one native activation; teardown restores the native link', async () => {
  const t = setup({ features: ['size-guide'] });
  await tick();
  t.doc.body.appendChild(t.doc.createElement('div')); await tick();
  assert.equal(sizeLink(t.doc).querySelectorAll('.o-size-label').length, 1, 'no duplicated label after another sync');
  // Trocar a variante re-renderiza o frame: um link nativo NOVO chega e é tratado uma vez.
  const frame = t.doc.getElementById('product_variants_options_frame');
  frame.innerHTML = FIXTURE.match(/<turbo-frame id="product_variants_options_frame"[^>]*>([\s\S]*?)<\/turbo-frame>/)[1];
  await tick();
  assert.equal(t.doc.querySelectorAll('a[data-origens-size]').length, 1);
  assert.equal(sizeLink(t.doc).querySelectorAll('.o-size-icon').length, 1);
  let clicks = 0; sizeLink(t.doc).addEventListener('click', (e) => { clicks++; e.preventDefault(); });
  sizeLink(t.doc).querySelector('.o-size-label').click();
  assert.equal(clicks, 1);
  assert.deepEqual(t.submits, [], 'never submits the product form');
  // Saída do escopo (Turbo before-cache): o link volta exatamente ao nativo.
  t.doc.dispatchEvent(new t.w.Event('turbo:before-cache'));
  const restored = sizeLink(t.doc);
  assert.equal(restored.hasAttribute('data-origens-size'), false);
  assert.equal(restored.querySelector('.o-size-icon, .o-size-label, .o-size-chevron, .o-size-native'), null);
  assert.match(restored.textContent, /Confira suas medidas/);
  assert.equal(t.doc.getElementById('o-size-style'), null);
});

test('size-guide: Norte and Centro-Oeste get their own validated region tint', async () => {
  for (const [id, color, host, base] of [['norte', '#234b50', 'https://www.usenorte.com.br', '/usenorte'], ['centro', '#8c3b1f', 'https://www.usecentro.com.br', '/usecentro']]) {
    const html = FIXTURE.replaceAll('/usesul/', base + '/');
    const dom = new JSDOM(html, { url: host + base + '/product/goiania-origem-go', runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
    dom.window.eval(buildLoaderSource([], ['size-guide'], 'product-catalog', STORES[id]));
    await tick();
    assert.equal(dom.window.document.getElementById('open-modal-size').style.getPropertyValue('--o-size-tint'), color, id);
  }
});

test('size-guide: without the native link nothing is drawn (and the page stays native)', async () => {
  const t = setup({ features: ['size-guide'], html: FIXTURE.replace(/<a class="form-product-options__size-modal-link[\s\S]*?<\/a>/, '') });
  await tick();
  assert.equal(t.doc.querySelector('[data-origens-size]'), null);
  assert.equal(t.doc.getElementById('o-size-style'), null);
});

test('pdp-share: one "Compartilhar" button right after EACH title (phone and desktop headers), type=button, outside the form, never duplicated', async () => {
  const t = setup({ features: ['pdp-share'] });
  await tick();
  t.doc.body.appendChild(t.doc.createElement('div')); await tick();
  const buttons = shareButtons(t.doc);
  assert.equal(buttons.length, 2);
  for (const b of buttons) {
    assert.equal(b.type, 'button');
    assert.equal(b.previousElementSibling.tagName, 'H1');
    assert.equal(b.closest('form'), null);
    assert.equal(b.textContent, 'Compartilhar');
  }
});

test('pdp-share: native share gets the clean canonical product URL (no cart_ref, ls, origens_*, utm, hash) and the real product name', async () => {
  const t = setup({ features: ['pdp-share'], share: () => Promise.resolve() });
  await tick();
  shareButtons(t.doc)[1].click(); await tick(20);
  assert.deepEqual(JSON.parse(JSON.stringify(t.shared)), [{
    url: 'https://www.usesul.com.br/usesul/product/paranaense-pe-vermelho',
    title: 'Paranaense | Pé Vermelho | Use Sul',
    text: 'Olha essa camiseta da Use Origens: Paranaense | Pé Vermelho'
  }]);
  assert.equal(t.w.location.search, '?cart_ref=abc&ls=tok.sig&origens_src=ink_product_return&utm_source=x', 'the current URL is never touched');
  assert.equal(t.doc.getElementById('o-share'), null);
  assert.deepEqual(t.submits, []);
});

test('pdp-share: cancelling the native sheet (AbortError) does nothing else; another failure opens the fallback panel', async () => {
  const cancel = setup({ features: ['pdp-share'], share: () => Promise.reject(new DOMException('x', 'AbortError')) });
  await tick();
  shareButtons(cancel.doc)[0].click(); await tick(20);
  assert.equal(cancel.shared.length, 1);
  assert.equal(cancel.doc.getElementById('o-share'), null, 'no menu, no copy after a cancel');
  const fail = setup({ features: ['pdp-share'], share: () => Promise.reject(new DOMException('x', 'NotAllowedError')) });
  await tick();
  shareButtons(fail.doc)[0].click(); await tick(20);
  assert.ok(fail.doc.getElementById('o-share'));
});

test('pdp-share: without native share, the panel offers "Copiar link" (confirms only on success) and WhatsApp (wa.me, no recipient); Escape closes and returns focus', async () => {
  const t = setup({ features: ['pdp-share'], share: null });
  await tick();
  const trigger = shareButtons(t.doc)[1];
  trigger.click(); await tick(20);
  const menu = t.doc.getElementById('o-share');
  assert.equal(menu.getAttribute('role'), 'dialog');
  const wa = menu.querySelector('a.o-share-wa');
  const url = new URL(wa.href);
  assert.equal(url.origin + url.pathname, 'https://wa.me/');
  assert.equal(url.searchParams.get('text'), 'Olha essa camiseta da Use Origens: Paranaense | Pé Vermelho https://www.usesul.com.br/usesul/product/paranaense-pe-vermelho');
  assert.equal(wa.rel, 'noopener noreferrer');
  // Cópia que falha: nada de "copiado"; o link aparece selecionável.
  Object.defineProperty(t.w.navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
  t.doc.execCommand = () => false;
  menu.querySelector('.o-share-copy').click(); await tick(20);
  assert.equal(menu.querySelector('.o-share-status').textContent, 'Selecione e copie o link');
  assert.equal(menu.querySelector('.o-share-field').value, 'https://www.usesul.com.br/usesul/product/paranaense-pe-vermelho');
  // Cópia que funciona.
  Object.defineProperty(t.w, 'isSecureContext', { configurable: true, value: true });
  const copied = []; Object.defineProperty(t.w.navigator, 'clipboard', { configurable: true, value: { writeText: (s) => { copied.push(s); return Promise.resolve(); } } });
  menu.querySelector('.o-share-copy').click(); await tick(20);
  assert.equal(menu.querySelector('.o-share-status').textContent, 'Link copiado!');
  assert.deepEqual(copied, ['https://www.usesul.com.br/usesul/product/paranaense-pe-vermelho']);
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.doc.getElementById('o-share'), null);
  assert.equal(t.doc.activeElement, trigger);
});

test('pdp-share: a non-tee piece gets the neutral sentence; flags off = nothing of ours at all', async () => {
  const t = setup({ features: ['pdp-share'], share: () => Promise.resolve(), html: FIXTURE.replace('Clássica | Unissex', 'Hoodie Slim').replace('Baby Look | Feminina', 'Hoodie Slim') });
  await tick();
  shareButtons(t.doc)[0].click(); await tick(20);
  assert.match(t.shared[0].text, /^Olha o que encontrei na Use Origens: /);
  const off = setup({ features: ['return-link'] });
  await tick();
  assert.equal(off.doc.querySelector('[data-origens-share], [data-origens-size], #o-share-style, #o-size-style'), null);
});

test('analytics: only through INK gtag after the cookie notice is accepted; never a URL', async () => {
  const t = setup({ share: () => Promise.resolve() });
  await tick();
  shareButtons(t.doc)[0].click(); await tick(20);
  sizeLink(t.doc).addEventListener('click', (e) => e.preventDefault());
  sizeLink(t.doc).click();
  const names = t.events.map((e) => e[1]);
  assert.deepEqual(names, ['origens_share', 'origens_size_guide_open']);
  assert.deepEqual(t.events[0][2], { send_to: GA, region: 'sul', surface: 'ink', transport_type: 'beacon', method: 'native' });
  assert.ok(!JSON.stringify(t.events).includes('http'), 'no URL in any event');
});
