import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource, buildDiscoverySource } from '../src/loader-source.js';

// Escopo DENTRO do loader (jsdom): modo catálogo valida a URL corrente E a presença do formulário nativo a cada mudança relevante.
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery'];
const FIVE = ['/usesul/product/serra-catarinense', '/usesul/product/paranaense-essencia'];
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const ours = (doc) => doc.querySelectorAll('[data-origens-discovery], #use-origens-return-link, style[data-origens-discovery-style]').length;
const blocks = (doc) => doc.querySelectorAll('[data-origens-discovery="product"]').length;

function setup({ path, mode = 'product-catalog', allowed = FIVE, html = FIXTURE, features = ALL } = {}) {
  const dom = new JSDOM(html, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; } return [{}]; };
  w.fetch = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const head = w.document.head; const original = head.appendChild.bind(head);
  head.appendChild = (node) => { if (node.tagName === 'SCRIPT' && /discovery\.js/.test(node.src)) { original(node); queueMicrotask(() => { w.eval(buildDiscoverySource({ search: true, postAdd: true, cart: true, product: true })); if (node.onload) node.onload(); }); return node; } return original(node); };
  w.eval(buildLoaderSource(allowed, features, mode));
  return { w, doc: w.document };
}
const visit = async (t, path, html) => {
  t.w.history.pushState({}, '', path);
  if (html) { const body = t.doc.createElement('body'); body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1]; t.doc.body.replaceWith(body); }
  for (const n of ['turbo:visit', 'turbo:before-render', 'turbo:render', 'turbo:load']) t.doc.dispatchEvent(new t.w.CustomEvent(n, { detail: { url: HOST + path } }));
  await tick(500);
};

test('catalog mode: ANY canonical product page with the native form mounts our block (with an EMPTY allowlist), exactly once', async () => {
  for (const slug of ['bah-dizeres', 'retrato-gaucho', 'produto-de-amanha', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a', 'a']) {
    const t = setup({ path: '/usesul/product/' + slug, allowed: [] }); await tick(500);
    assert.equal(blocks(t.doc), 1, slug); assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 0);
  }
});

test('default (allowlist) mode is unchanged: the listed pages mount, every other product page stays untouched', async () => {
  const listed = setup({ path: FIVE[0], mode: 'allowlist' }); await tick(500); assert.equal(blocks(listed.doc), 1);
  const other = setup({ path: '/usesul/product/bah-dizeres', mode: 'allowlist' }); await tick(500); assert.equal(ours(other.doc), 0);
});

test('catalog mode: non-product routes, odd pathnames and product-like URLs WITHOUT the native form get zero UI, styles and observers', async () => {
  for (const path of ['/usesul', '/usesul/products', '/usesul/cart', '/usesul/checkout', '/usesul/checkout/contact_and_shipping_details', '/usesul/product/a/b', '/usesul/product/UPPER', '/usesul/product/x.y', '/admin/x']) {
    const t = setup({ path }); await tick(400); assert.equal(ours(t.doc), 0, path);
  }
  const noForm = setup({ path: '/usesul/product/pagina-404', html: '<!doctype html><html><head></head><body><main><h1>404</h1></main></body></html>' }); await tick(400);
  assert.equal(ours(noForm.doc), 0, 'a product-like URL whose DOM is not a product page');
  const wrongHost = new JSDOM(FIXTURE, { url: 'https://useorigens.com.br/usesul/product/bah-dizeres', runScripts: 'outside-only', pretendToBeVisual: true });
  wrongHost.window.eval(buildLoaderSource([], ALL, 'product-catalog')); await tick(300); assert.equal(ours(wrongHost.window.document), 0, 'wrong host');
});

test('Turbo in catalog mode: product A -> product B -> home -> non-form product-like page -> A: 1 -> 1 -> 0 -> 0 -> 1, never duplicated, full teardown when leaving', async () => {
  const t = setup({ path: '/usesul/product/produto-a', allowed: [] }); await tick(500);
  assert.equal(blocks(t.doc), 1);
  await visit(t, '/usesul/product/produto-b', FIXTURE); assert.equal(blocks(t.doc), 1);
  await visit(t, '/usesul', '<!doctype html><html><body><main><h1>Home</h1></main></body></html>'); assert.equal(ours(t.doc), 0);
  await visit(t, '/usesul/product/fantasma', '<!doctype html><html><body><main><h1>404</h1></main></body></html>'); assert.equal(ours(t.doc), 0);
  await visit(t, '/usesul/product/produto-a', FIXTURE); assert.equal(blocks(t.doc), 1); assert.equal(t.doc.querySelectorAll('style[data-origens-discovery-style]').length, 1);
  for (let i = 0; i < 6; i++) t.doc.body.appendChild(t.doc.createElement('i')); await tick(400); assert.equal(blocks(t.doc), 1);
});

test('catalog mode never widens the transaction surface: the cart drawer of a non-product page (cart route) gets no block even if a drawer is present', async () => {
  const DRAWER = '<div class="cart-drawer open"><turbo-frame id="cart"><div class="cart-drawer__main"><ul></ul></div></turbo-frame></div>';
  const t = setup({ path: '/usesul/cart', html: FIXTURE.replace('</main>', DRAWER + '</main>') }); await tick(600);
  assert.equal(ours(t.doc), 0);
});
