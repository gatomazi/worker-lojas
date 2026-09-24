import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource, buildDiscoverySource } from '../src/loader-source.js';

// Drawer do CARRINHO da INK (estrutura auditada em sessão anônima: docs/fase-4-cart-bridge.md). jsdom sem layout:
// getClientRects é simulado (oculto se [hidden]/display:none). O discovery.js sob demanda avalia o MESMO código do Worker.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const ALLOWED = '/usesul/product/serra-catarinense';
const OTHER = '/usesul/product/vida-no-sul-estancia-edition';
const HOST = 'https://www.usesul.com.br';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery'];

const item = (n, qty = 1, price = 'R$ 109,90') => '<li class="main-list__item"><img alt="Imagem do produto"><div class="item-wrapper"><header><div class="item-details"><p>Serra Catarinense ' + n + '</p><p>Preta</p><p>M</p></div>' +
  '<div class="price-details"><div class="price"><span>' + price + '</span></div></div></header><div class="item-details__footer"><form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M" data-ink-store--cart-id-value="cart_item_' + n + '" action="/usesul/cart/item" method="post">' +
  '<div id="quantity-buttons"><button type="button" data-action="click->ink-store--cart#decrement"></button><input class="quantity-input" type="text" value="' + qty + '" name="cart_item[quantity]"><button type="button" data-action="click->ink-store--cart#increment"></button></div></form></div></div></li>';
const FOOTER = '<div class="cart-drawer__footer px-4 pb-4"><form id="coupon-form" action="/usesul/cart/coupon" method="post"><input id="cart_coupon_code" type="text"></form>' +
  '<div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="109.9"><ul><li><span>Subtotal</span><span id="amount">R$ 109,90</span></li></ul><p>Total</p><p>R$ 109,90</p></div>' +
  '<form class="pt-2.5" data-turbo="false" action="/usesul/cart/checkout_cart_items" method="post"><input type="hidden" name="authenticity_token" value="x"><button id="checkout-btn" data-action="click->tracking#trackClick">Finalizar compra</button></form></div>';
const CART_ITEMS = '<turbo-frame id="cart"><div class="flex flex-col h-full"><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="1">(1 produto)</span></span></div>' +
  '<div class="cart-drawer__main bg-gray-50"><ul class="flex flex-col w-full">' + item(1) + '</ul></div><div class="flex flex-col h-fit"></div>' + FOOTER + '</div></turbo-frame>';
const CART_EMPTY = '<turbo-frame id="cart"><turbo-frame id="cart"><div class="flex flex-col"><header class="cart-drawer__header"><span>(0 produtos)</span></header>' +
  '<div class="empty-cart"><turbo-frame id="most_sold_frame"><span>Seu carrinho está vazio. Comece explorando alguns</span></turbo-frame><div>Continuar Comprando</div></div></div></turbo-frame></turbo-frame>';
const PAGE = PRODUCT.replace('</main>', '<button id="shopping-cart-menu-desk" data-action="click->ink-store--drawer#openDrawer">1</button><turbo-frame id="last_added_product"></turbo-frame><div class="cart-drawer z-50">' + CART_ITEMS + '</div></main>');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MANY = { results: Array.from({ length: 6 }, (_, i) => ({ type: 'city', name: 'Cidade ' + i, uf: 'RS', meso: '', href: 'https://useorigens.com.br/sul/rs/cidade-' + i })) };

function setup({ path = ALLOWED, features = ALL, fetchImpl } = {}) {
  const dom = new JSDOM(PAGE, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; } return [{}]; };
  const fetchCalls = [];
  w.fetch = (url, options = {}) => { fetchCalls.push({ url: String(url), credentials: options.credentials }); return new Promise((resolve, reject) => { if (options.signal) options.signal.addEventListener('abort', () => reject(new w.DOMException('aborted', 'AbortError'))); (fetchImpl || ((u, res) => res(json(MANY))))(String(url), resolve, reject); }); };
  const scriptLoads = []; const head = w.document.head; const original = head.appendChild.bind(head);
  head.appendChild = (node) => { if (node.tagName === 'SCRIPT' && /discovery\.js/.test(node.src)) { scriptLoads.push(node.src); original(node); queueMicrotask(() => { w.eval(buildDiscoverySource({ search: features.includes('city-search'), postAdd: features.includes('post-add-discovery'), cart: features.includes('cart-discovery') })); if (node.onload) node.onload(); }); return node; } return original(node); };
  const navigations = []; w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { navigations.push(a.href); e.preventDefault(); } }, true);
  w.eval(buildLoaderSource([ALLOWED], features));
  return { dom, w, doc: w.document, fetchCalls, scriptLoads, navigations };
}
const drawer = (doc) => doc.querySelector('.cart-drawer');
const openDrawer = (doc) => drawer(doc).classList.add('open');
const closeDrawer = (doc) => drawer(doc).classList.remove('open');
const roots = (doc) => doc.querySelectorAll('[data-origens-discovery="cart"]').length;
const allRoots = (doc) => doc.querySelectorAll('[data-origens-discovery]').length;
const styles = (doc) => doc.querySelectorAll('style[data-origens-discovery-style]').length;
const setFrame = (doc, html) => { doc.querySelector('.cart-drawer').innerHTML = html; };
const type = (w, input, text) => { input.value = text; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
const native = (doc) => ({ header: doc.getElementById('quantity-header')?.outerHTML, amount: doc.getElementById('amount')?.outerHTML, footer: doc.querySelector('.cart-drawer__footer')?.outerHTML, checkout: doc.getElementById('checkout-btn')?.outerHTML, items: [...doc.querySelectorAll('li.main-list__item')].map((li) => li.outerHTML) });

test('closed cart drawer: nothing mounts, nothing loads', async () => {
  const t = setup(); await tick(300);
  assert.equal(allRoots(t.doc), 0); assert.equal(t.scriptLoads.length, 0); assert.equal(t.fetchCalls.length, 0);
});

test('opened by the header icon: one compact block inside the scrollable main area, never in the footer', async () => {
  const t = setup(); await tick();
  t.doc.getElementById('shopping-cart-menu-desk').click(); openDrawer(t.doc); await tick(350);
  assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1); assert.equal(t.scriptLoads.length, 1);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]');
  // dentro do <ul> dos itens (último item, largura total), nunca como irmão do <ul> em .cart-drawer__main (flex em linha)
  assert.equal(root.closest('ul'), t.doc.querySelector('.cart-drawer__main > ul'));
  assert.equal(root.parentElement.tagName, 'LI'); assert.equal(root.parentElement.getAttribute('role'), 'none'); assert.equal(root.parentElement.parentElement.lastElementChild, root.parentElement);
  assert.equal(t.doc.querySelector('.cart-drawer__main').children.length, 1); // main continua com o <ul> como único filho
  assert.equal(root.closest('.cart-drawer__footer'), null);
  assert.equal(root.querySelector('.o-title').textContent, 'Procurar outra cidade');
  assert.equal(root.querySelector('.o-lead').textContent, 'Continue escolhendo sem perder seu carrinho.');
  assert.equal(root.querySelector('.o-cta').textContent, 'Explorar vitrine'); assert.equal(root.querySelector('.o-cta').href, 'https://useorigens.com.br/sul');
  // recolhido por padrão: só o botão e o CTA; o painel de busca está oculto
  assert.equal(root.querySelector('.o-panel').hidden, true); assert.equal(root.querySelector('.o-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(t.doc.getElementById('checkout-btn').parentElement.parentElement.classList.contains('cart-drawer__footer'), true);
});

test('opened by "Ver carrinho" (same drawer, no navigation): mounts once', async () => {
  const t = setup(); await tick();
  // A INK abre o drawer via product-modal#openCart: só a classe "open" muda, sem navegação.
  const before = t.w.location.href; openDrawer(t.doc); await tick(350);
  assert.equal(roots(t.doc), 1); assert.equal(t.w.location.href, before);
});

test('native cart is never modified: items, quantity buttons, totals, coupon/CEP forms and the checkout button stay byte-identical', async () => {
  const t = setup(); await tick(); const before = native(t.doc);
  openDrawer(t.doc); await tick(350);
  const toggle = t.doc.querySelector('.o-toggle'); toggle.click(); type(t.w, t.doc.querySelector('.o-input'), 'cid'); await tick(450);
  assert.deepEqual(native(t.doc), before);
  assert.equal(t.doc.getElementById('checkout-btn').getAttribute('data-action'), 'click->tracking#trackClick');
  const forms = [...t.doc.querySelectorAll('.cart-drawer__footer form')].map((f) => f.getAttribute('action'));
  assert.deepEqual(forms, ['/usesul/cart/coupon', '/usesul/cart/checkout_cart_items']);
});

test('cart re-render (quantity change/removal replaces the frame): the block remounts exactly once; native numbers stay as the INK rendered them', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  for (let i = 2; i <= 4; i++) {
    // A INK devolve o HTML do frame SEM o nosso bloco (ele não existe no servidor): reproduz isso a partir do markup original.
    setFrame(t.doc, CART_ITEMS.replace('(1 produto)', '(' + i + ' produtos)').replace('R$ 109,90', 'R$ ' + i * 109 + ',00'));
    await tick(300); assert.equal(roots(t.doc), 1, 'round ' + i); assert.equal(styles(t.doc), 1);
  }
  assert.match(t.doc.getElementById('quantity-header').textContent, /4 produtos/);
  assert.equal(t.scriptLoads.length, 1);
});

test('closing removes the block and its style; reopening mounts again; many attribute mutations never duplicate', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350); assert.equal(roots(t.doc), 1);
  for (let i = 0; i < 25; i++) { drawer(t.doc).setAttribute('data-x', String(i)); drawer(t.doc).classList.toggle('foo'); }
  await tick(250); assert.equal(roots(t.doc), 1);
  closeDrawer(t.doc); await tick(250); assert.equal(roots(t.doc), 0); assert.equal(styles(t.doc), 0); assert.equal(t.doc.querySelectorAll('[data-origens-slot]').length, 0);
  openDrawer(t.doc); await tick(350); assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1);
});

test('empty cart: the block goes into .empty-cart before the INK recommendations; going from items to empty remounts once', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  assert.equal(t.doc.querySelector('[data-origens-discovery="cart"]').closest('.cart-drawer__main').className, 'cart-drawer__main bg-gray-50');
  setFrame(t.doc, CART_EMPTY); await tick(350);
  assert.equal(roots(t.doc), 1);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]');
  assert.equal(root.parentElement.className, 'empty-cart'); assert.equal(root.nextElementSibling.id, 'most_sold_frame');
  setFrame(t.doc, CART_ITEMS); await tick(350); assert.equal(roots(t.doc), 1);
  assert.equal(t.doc.querySelector('[data-origens-discovery="cart"]').closest('.cart-drawer__main').className, 'cart-drawer__main bg-gray-50');
});

test('a drawer without a safe anchor (no main, no empty state) is left alone', async () => {
  const t = setup(); await tick(); setFrame(t.doc, '<turbo-frame id="cart"><div>estrutura desconhecida</div></turbo-frame>'); openDrawer(t.doc); await tick(350);
  assert.equal(allRoots(t.doc), 0); assert.equal(t.scriptLoads.length, 0);
});

test('search is collapsible: toggle opens the panel with focus in the input; results capped at 3; close restores the layout', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]');
  const toggle = root.querySelector('.o-toggle'); const panel = root.querySelector('.o-panel'); const input = root.querySelector('.o-input');
  toggle.click();
  assert.equal(panel.hidden, false); assert.equal(toggle.hidden, true); assert.equal(t.doc.activeElement, input);
  type(t.w, input, 'cid'); await tick(450);
  assert.equal(t.fetchCalls.length, 1); assert.equal(t.fetchCalls[0].credentials, 'omit');
  assert.equal(root.querySelectorAll('.o-item').length, 3); // teto do carrinho: 3 (o gateway devolveu 6)
  root.querySelector('.o-close').click();
  assert.equal(panel.hidden, true); assert.equal(toggle.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(input.value, ''); assert.equal(root.querySelectorAll('.o-item').length, 0); assert.equal(root.querySelector('.o-status').textContent, '');
  assert.equal(t.doc.activeElement, toggle);
});

test('search: results link to the storefront, Enter follows the highlighted result, no result / gateway failure keep the CTA and the native cart', async () => {
  const t = setup({ fetchImpl: (u, res) => res(json({ results: [{ type: 'city', name: 'Florianópolis', uf: 'SC', meso: 'Grande Florianópolis', href: 'https://useorigens.com.br/sul/sc/florianopolis' }] })) });
  await tick(); openDrawer(t.doc); await tick(350);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]'); root.querySelector('.o-toggle').click();
  const input = root.querySelector('.o-input'); type(t.w, input, 'flor'); await tick(450);
  assert.equal(root.querySelector('.o-item').getAttribute('href'), 'https://useorigens.com.br/sul/sc/florianopolis');
  input.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/sc/florianopolis']);
  for (const impl of [(u, res) => res(json({ results: [] })), (u, res) => res(json({ e: 1 }, 502)), (u, res, rej) => rej(new Error('rede'))]) {
    const x = setup({ fetchImpl: impl }); await tick(); openDrawer(x.doc); await tick(350);
    const r = x.doc.querySelector('[data-origens-discovery="cart"]'); r.querySelector('.o-toggle').click(); type(x.w, r.querySelector('.o-input'), 'xyzq'); await tick(450);
    assert.match(r.querySelector('.o-status').textContent, /Ainda não encontramos|A busca não está disponível/);
    assert.ok(r.querySelector('.o-cta')); assert.ok(x.doc.getElementById('checkout-btn'));
  }
});

test('Turbo: leaving the route removes the cart block at once; another page with the drawer open never gets it; coming back mounts once', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350); assert.equal(roots(t.doc), 1);
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + OTHER } }));
  assert.equal(roots(t.doc), 0); assert.equal(styles(t.doc), 0);
  t.w.history.pushState({}, '', OTHER); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  closeDrawer(t.doc); openDrawer(t.doc); await tick(400);
  assert.equal(allRoots(t.doc), 0); assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 0);
  t.w.history.pushState({}, '', ALLOWED); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(400);
  assert.equal(roots(t.doc), 1);
});

test('direct load of another product/cart/checkout with the drawer open: no block, no script, no request', async () => {
  for (const path of [OTHER, '/usesul/cart', '/usesul/checkout', '/usesul', ALLOWED + '/extra']) {
    const t = setup({ path }); openDrawer(t.doc); await tick(400);
    assert.equal(allRoots(t.doc) + styles(t.doc) + t.scriptLoads.length + t.fetchCalls.length, 0, path);
  }
});

test('feature gating: without cart-discovery the cart drawer is ignored; with only cart-discovery the post-add modal is ignored', async () => {
  const off = setup({ features: ['return-link', 'post-add-discovery', 'city-search'] }); openDrawer(off.doc); await tick(400);
  assert.equal(roots(off.doc), 0);
  const only = setup({ features: ['cart-discovery', 'city-search'] }); await tick();
  only.doc.getElementById('last_added_product').innerHTML = '<div id="modal-wrapper" role="dialog"><h3>Produto adicionado ao carrinho</h3><div class="add-product-modal__modal-content__footer"><button class="checkout-btn">Ver carrinho</button></div></div>';
  openDrawer(only.doc); await tick(450);
  assert.equal(roots(only.doc), 1); assert.equal(only.doc.querySelectorAll('#modal-wrapper [data-origens-discovery]').length, 0);
  const noSearch = setup({ features: ['cart-discovery'] }); openDrawer(noSearch.doc); await tick(400);
  assert.equal(roots(noSearch.doc), 1); assert.equal(noSearch.doc.querySelectorAll('.o-toggle, .o-input').length, 0); assert.equal(noSearch.doc.querySelector('.o-cta').textContent, 'Explorar vitrine');
});

test('post-add block and cart block are independent: both can coexist, each mounts once, unmounting one keeps the other and the shared style', async () => {
  const t = setup(); await tick();
  t.doc.getElementById('last_added_product').innerHTML = '<div id="modal-wrapper" role="dialog"><h3>Produto adicionado ao carrinho</h3><div class="add-product-modal__modal-content__footer"><button class="checkout-btn">Ver carrinho</button></div><turbo-frame id="most_sold_frame"></turbo-frame></div>';
  openDrawer(t.doc); await tick(500);
  assert.equal(t.doc.querySelectorAll('[data-origens-discovery="post-add"]').length, 1); assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1); assert.equal(t.scriptLoads.length, 1);
  closeDrawer(t.doc); await tick(300);
  assert.equal(roots(t.doc), 0); assert.equal(t.doc.querySelectorAll('[data-origens-discovery="post-add"]').length, 1); assert.equal(styles(t.doc), 1);
});

test('the cart block never sits below the checkout button and is taller than nothing but small: compact collapsed markup only', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]');
  assert.equal(root.querySelectorAll('.o-eyebrow').length, 0);           // sem eyebrow no carrinho
  assert.equal(root.querySelectorAll(':scope > h4, :scope > p, :scope > .o-actions > *').length, 4); // título, apoio, toggle e CTA; painel de busca oculto
  assert.equal(root.querySelector('.o-panel').hidden, true);
  const css = t.doc.querySelector('style[data-origens-discovery-style]').textContent;
  assert.match(css, /\[data-origens-discovery="cart"\]\{margin:12px 16px 16px/);
});

test('CSS keeps [hidden] effective on the toggle (author display:flex must not defeat the hidden attribute)', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  const css = t.doc.querySelector('style[data-origens-discovery-style]').textContent;
  assert.match(css, /\.o-toggle\[hidden\]\{display:none\}/);
  assert.match(css, /\.o-panel\[hidden\]\{display:none\}/);
});

// ---- intenção "abrir o carrinho" (storefront -> INK): ?origens_open_cart=1 na página autorizada
function setupIntent(search, { path = ALLOWED, openerVisible = true, opensOnClick = true } = {}) {
  const dom = new JSDOM(PAGE, { url: HOST + path + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return this.id && this.id.startsWith('shopping-cart-menu') && !openerVisible ? [] : [{}]; };
  let clicks = 0;
  w.document.getElementById('shopping-cart-menu-desk').addEventListener('click', () => { clicks++; if (opensOnClick) w.document.querySelector('.cart-drawer').classList.add('open'); });
  w.fetch = () => new Promise(() => {});
  w.eval(buildLoaderSource([ALLOWED], ALL));
  return { w, doc: w.document, clicks: () => clicks };
}

test('?origens_open_cart=1 on the authorized page opens the NATIVE drawer once and cleans the URL', async () => {
  const t = setupIntent('?origens_open_cart=1&utm=1'); await tick(900);
  assert.equal(t.clicks(), 1); assert.equal(drawer(t.doc).classList.contains('open'), true);
  assert.equal(t.w.location.search, '?utm=1'); assert.equal(t.w.location.pathname, ALLOWED);
  await tick(800); assert.equal(t.clicks(), 1); // já aberto: não reclica
});

test('the open-cart intent is ignored elsewhere and for any other value; it never repeats without the parameter', async () => {
  for (const [search, path] of [['?origens_open_cart=1', OTHER], ['?origens_open_cart=1', '/usesul'], ['?origens_open_cart=2', ALLOWED], ['?origens_open_cart=', ALLOWED], ['?x=1', ALLOWED], ['', ALLOWED]]) {
    const t = setupIntent(search, { path }); await tick(1000);
    assert.equal(t.clicks(), 0, path + search);
    assert.equal(t.w.location.search, search);
  }
});

test('the open-cart intent is bounded: no visible opener means at most 8 attempts and then it gives up', async () => {
  const t = setupIntent('?origens_open_cart=1', { openerVisible: false }); await tick(5200);
  assert.equal(t.clicks(), 0);
  const stuck = setupIntent('?origens_open_cart=1', { opensOnClick: false }); await tick(5200);
  assert.ok(stuck.clicks() >= 2 && stuck.clicks() <= 8, 'clicks=' + stuck.clicks());
  const before = stuck.clicks(); await tick(1200); assert.equal(stuck.clicks(), before);
});

test('short viewports: the compact cart block hides its supporting text (scoped CSS)', async () => {
  const t = setup(); await tick(); openDrawer(t.doc); await tick(350);
  const css = t.doc.querySelector('style[data-origens-discovery-style]').textContent;
  assert.match(css, /@media \(max-height:700px\)\{\[data-origens-discovery="cart"\] \.o-lead\{display:none\}/);
});

// ---- muitos itens (variantes diferentes): o bloco vai para o topo da lista, denso
const manyRows = (n) => Array.from({ length: n }, (_, i) => item(i + 1, 1, 'R$ 109,90')).join('');
const cartWith = (n) => CART_ITEMS.replace(item(1), manyRows(n)).replace('(1 produto)', '(' + n + ' produtos)');
async function openWith(n) { const t = setup(); await tick(); setFrame(t.doc, cartWith(n)); openDrawer(t.doc); await tick(400); return t; }

test('1-2 items: the block stays at the END of the list (below the items)', async () => {
  for (const n of [1, 2]) {
    const t = await openWith(n);
    const root = t.doc.querySelector('[data-origens-discovery="cart"]');
    assert.equal(root.parentElement.parentElement.lastElementChild, root.parentElement, n + ' item(s)'); assert.equal(root.classList.contains('o-dense'), false);
  }
});

test('3+ items (8 distinct variants): ONE dense block as the FIRST entry of the list, items untouched and in order', async () => {
  for (const n of [3, 8, 12]) {
    const t = await openWith(n);
    assert.equal(roots(t.doc), 1, n + ' items');
    const root = t.doc.querySelector('[data-origens-discovery="cart"]');
    const list = t.doc.querySelector('.cart-drawer__main > ul');
    assert.equal(list.firstElementChild, root.parentElement); assert.equal(root.classList.contains('o-dense'), true);
    assert.equal(list.querySelectorAll('li.main-list__item').length, n);
    assert.deepEqual([...list.querySelectorAll('li.main-list__item .item-details p:first-child')].map((p) => p.textContent.trim()), Array.from({ length: n }, (_, i) => 'Serra Catarinense ' + (i + 1)));
    assert.equal(root.closest('.cart-drawer__footer'), null);
    assert.equal(t.doc.querySelectorAll('.cart-drawer__footer form').length, 2); assert.ok(t.doc.getElementById('checkout-btn'));
  }
});

test('re-render across the 3-item threshold moves the block (top <-> end) with exactly one block each time', async () => {
  const t = await openWith(2); assert.equal(t.doc.querySelector('[data-origens-discovery="cart"]').classList.contains('o-dense'), false);
  setFrame(t.doc, cartWith(5)); await tick(400); assert.equal(roots(t.doc), 1); assert.equal(t.doc.querySelector('[data-origens-discovery="cart"]').classList.contains('o-dense'), true);
  setFrame(t.doc, cartWith(2)); await tick(400); assert.equal(roots(t.doc), 1); assert.equal(t.doc.querySelector('[data-origens-discovery="cart"]').classList.contains('o-dense'), false);
});

test('dense mode keeps search, toggle and CTA working with many items; native rows/footer stay byte-identical', async () => {
  const t = await openWith(8); const before = native(t.doc);
  const root = t.doc.querySelector('[data-origens-discovery="cart"]'); root.querySelector('.o-toggle').click(); type(t.w, root.querySelector('.o-input'), 'cid'); await tick(450);
  assert.equal(root.querySelectorAll('.o-item').length, 3);
  assert.deepEqual(native(t.doc), before);
  root.querySelector('.o-close').click(); assert.equal(root.querySelector('.o-panel').hidden, true);
  assert.match(t.doc.querySelector('style[data-origens-discovery-style]').textContent, /\.o-dense \.o-lead\{display:none\}/);
});
