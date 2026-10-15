import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// theme-ui (theme-pdp / theme-cart) no navegador (jsdom), sobre a PDP real reduzida: barra fixa do celular, toque na barra inerte, Esc no carrinho.
const FIXTURE = readFileSync(new URL('./fixtures/product-page-theme.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/florianopolis-legado-sc';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['theme-pdp', 'theme-cart'], link = 's=pdp,cart&v=1&c=x', attr = 'pdp cart' } = {}) {
  let html = FIXTURE;
  if (link) html = html.replace('</head>', '<link rel="stylesheet" href="/__origens/theme.css?' + link + '" data-origens-theme-css="1"></head>');
  if (attr) html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-origens-theme="' + attr + '">');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  w.HTMLElement.prototype.scrollIntoView = function () { this.ownerDocument.__scrolled = this; };
  const observers = [];
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; this.targets = []; this.alive = true; observers.push(this); } observe(t) { this.targets.push(t); } disconnect() { this.alive = false; } };
  const native = { adds: 0, closes: 0, submits: 0 };
  w.document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.add-to-cart-js')) native.adds++; if (e.target.id === 'cart-drawer-close') native.closes++; });
  w.document.addEventListener('submit', (e) => { native.submits++; e.preventDefault(); });
  w.eval(buildLoaderSource([], ['return-link', ...features], 'product-catalog'));
  return { w, doc: w.document, observers, native };
}
const root = (t) => t.doc.documentElement;
const live = (t) => t.observers.filter((o) => o.alive);

test('theme-pdp: the mobile bar hides while #add-to-cart-desk is on screen (one observer, on that button only) and comes back when it leaves', async () => {
  const t = setup();
  await tick();
  assert.equal(live(t).length, 1);
  assert.deepEqual(live(t)[0].targets, [t.doc.getElementById('add-to-cart-desk')]);
  live(t)[0].cb([{ isIntersecting: true }]);
  assert.ok(root(t).classList.contains('o-cta-inview'));
  live(t)[0].cb([{ isIntersecting: false }]);
  assert.ok(!root(t).classList.contains('o-cta-inview'));
  // Muitas mutações (re-render do frame) não multiplicam observadores nem listeners.
  for (let i = 0; i < 20; i++) t.doc.body.appendChild(t.doc.createElement('i'));
  await tick();
  assert.equal(live(t).length, 1);
});

test('theme-pdp: a text field with focus (keyboard open) hides the bar; radios do not', async () => {
  const t = setup();
  await tick();
  const input = t.doc.createElement('input'); input.type = 'text'; t.doc.body.appendChild(input);
  input.dispatchEvent(new t.w.FocusEvent('focusin', { bubbles: true }));
  assert.ok(root(t).classList.contains('o-typing'));
  input.dispatchEvent(new t.w.FocusEvent('focusout', { bubbles: true }));
  assert.ok(!root(t).classList.contains('o-typing'));
  t.doc.querySelector('input[name="size"][value="M"]').dispatchEvent(new t.w.FocusEvent('focusin', { bubbles: true }));
  assert.ok(!root(t).classList.contains('o-typing'));
});

test('theme-pdp: a tap on the INERT mobile bar takes focus to the first missing choice; nothing is selected or added by us', async () => {
  const t = setup();
  await tick();
  const bar = t.doc.querySelector('.form-product-options__add-to-cart-mobile');
  bar.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  const model = t.doc.querySelector('input[name="style"][value="Feminino"]');
  assert.equal(t.doc.activeElement, model, 'focus on the first model radio');
  assert.ok(t.doc.__scrolled.classList.contains('o-need-choice'));
  assert.ok(![...t.doc.querySelectorAll('input[type="radio"]')].some((r) => r.checked), 'no variant presumed');
  // Modelo escolhido pela pessoa: o próximo que falta é o tamanho, e o primeiro tamanho HABILITADO recebe o foco (PP está indisponível).
  t.doc.querySelector('input[name="style"][value="Masculino"]').checked = true;
  bar.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  assert.equal(t.doc.activeElement, t.doc.querySelector('input[name="size"][value="M"]'));
  assert.equal(t.native.adds, 0); assert.equal(t.native.submits, 0);
  // Botão ativo (INK tirou pointer-events-none): o clique é só da INK, nada nosso acontece.
  t.doc.getElementById('add-to-cart-mob').classList.remove('pointer-events-none');
  t.doc.querySelector('input[name="size"][value="M"]').checked = true;
  t.doc.body.focus();
  t.doc.getElementById('add-to-cart-mob').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  assert.equal(t.native.adds, 1, 'exactly one native add click (the one we dispatched in the test)');
});

test('theme-cart: Esc closes the open cart through the native "X" (one click), focus returns to the cart button; closed cart or a modal on top = nothing', async () => {
  const t = setup();
  await tick();
  const opener = t.doc.getElementById('shopping-cart-menu-desk');
  opener.focus(); opener.dispatchEvent(new t.w.FocusEvent('focusin', { bubbles: true }));
  t.doc.body.focus();
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 1);
  await tick(400);
  assert.equal(t.doc.activeElement, opener);
  const modal = t.doc.createElement('div'); modal.id = 'modal-wrapper'; t.doc.body.appendChild(modal);
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 1, 'the post-add modal closes first (INK)');
  modal.remove();
  t.doc.querySelector('.cart-drawer').classList.remove('open');
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 1);
});

test('theme-ui: restores the <html> attribute from the theme link after a Turbo visit from a page without it; never invents a surface', async () => {
  let t = setup({ attr: null });
  await tick();
  assert.equal(root(t).getAttribute('data-origens-theme'), 'pdp cart');
  t = setup({ attr: null, link: null });
  await tick();
  assert.equal(root(t).getAttribute('data-origens-theme'), null);
  t = setup({ attr: null, link: 's=checkout,pdp&v=1&c=x' });
  await tick();
  assert.equal(root(t).getAttribute('data-origens-theme'), 'pdp', 'checkout is never a loader surface');
});

test('theme-ui: only theme-cart = no observer and no bar handling; without theme features the module is not even in the loader', async () => {
  const t = setup({ features: ['theme-cart'] });
  await tick();
  assert.equal(live(t).length, 0);
  t.doc.querySelector('.form-product-options__add-to-cart-mobile').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  assert.ok(!t.doc.querySelector('.o-need-choice'));
  assert.ok(!buildLoaderSource([], ['return-link'], 'product-catalog').includes('theme-ui'));
  assert.ok(buildLoaderSource([], ['return-link', 'theme-pdp'], 'product-catalog').includes("id: 'theme-ui'"));
});
