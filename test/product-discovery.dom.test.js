import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource, buildDiscoverySource } from '../src/loader-source.js';
import { parseFeatures } from '../src/features.js';

// product-discovery: bloco "Continue explorando" abaixo do CTA nativo, no lugar de "← Voltar a procurar" (jsdom; discovery.js servido = o do Worker).
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATHS = ['/usesul/product/serra-catarinense', '/usesul/product/aaa-um', '/usesul/product/bbb-dois', '/usesul/product/ccc-tres', '/usesul/product/ddd-quatro'];
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery'];
const GA = 'G-8GYTEJ1F77';
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const blocks = (doc) => doc.querySelectorAll('[data-origens-discovery="product"]');
const RESULTS = { results: [{ type: 'city', name: 'Florianópolis', uf: 'SC', meso: 'Grande Florianópolis', href: 'https://useorigens.com.br/sul/sc/florianopolis' }] };

function setup({ path = PATHS[0], features = ALL, discoveryFails = false, fetchImpl, html = FIXTURE } = {}) {
  html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  const dom = new JSDOM(html, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; } return [{}]; };
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const fetchCalls = [];
  w.fetch = async (url, options = {}) => { fetchCalls.push({ url: String(url), credentials: options.credentials, method: options.method || 'GET' }); if (String(url).includes('cart-ref')) return new Response(JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }), { status: 201 }); return (fetchImpl ? fetchImpl() : new Response(JSON.stringify(RESULTS), { status: 200, headers: { 'content-type': 'application/json' } })); };
  const scriptLoads = []; const head = w.document.head; const original = head.appendChild.bind(head);
  head.appendChild = (node) => {
    if (node.tagName === 'SCRIPT' && /discovery\.js/.test(node.src)) {
      scriptLoads.push(node.src); original(node);
      queueMicrotask(() => { if (discoveryFails) { if (node.onerror) node.onerror(); return; } w.eval(buildDiscoverySource({ search: features.includes('city-search'), postAdd: features.includes('post-add-discovery'), cart: features.includes('cart-discovery'), product: features.includes('product-discovery') })); if (node.onload) node.onload(); });
      return node;
    }
    return original(node);
  };
  const navigations = []; w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { navigations.push(a.href); e.preventDefault(); } });
  w.eval(buildLoaderSource(PATHS, features));
  return { w, doc: w.document, events, fetchCalls, scriptLoads, navigations };
}
const click = (w, el, init = {}) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

test('feature flag: product-discovery is a known feature (fail-closed list stays all-or-nothing)', () => {
  assert.deepEqual(parseFeatures(ALL.join(',')).features, ALL);
  assert.equal(parseFeatures(ALL.join(',') + ',nao-existe').status, 'invalid');
});

test('each of the five products gets exactly ONE block right after the native CTA, the approved copy, and NO return link', async () => {
  for (const path of PATHS) {
    const t = setup({ path }); await tick(500);
    assert.equal(blocks(t.doc).length, 1, path);
    const b = blocks(t.doc)[0];
    const form = t.doc.getElementById('form-product-0');
    assert.equal(form.nextElementSibling, b, 'right after the native purchase form (outside it), i.e. below the CTA');
    assert.ok(!form.contains(b), 'never inside the native form / its re-rendered frame');
    assert.ok(t.doc.getElementById('add-to-cart-desk').compareDocumentPosition(b) & t.w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(b.querySelector('.o-title').textContent, 'Continue explorando');
    assert.equal(b.querySelector('.o-lead').textContent, 'De cidades a expressões e outras ideias: descubra mais estampas com a sua cara.');
    assert.equal(b.querySelector('.o-cta').textContent, 'Explorar todas as estampas'); assert.equal(b.querySelector('.o-cta').getAttribute('href'), 'https://useorigens.com.br/sul');
    assert.equal(b.querySelector('.o-toggle').textContent, 'Buscar cidade ou estado'); assert.equal(b.querySelector('.o-panel').hidden, true, 'search starts collapsed');
    assert.equal(t.doc.getElementById('use-origens-return-link'), null, 'never both');
    assert.ok(t.doc.getElementById('add-to-cart-desk') && !t.doc.getElementById('add-to-cart-desk').hidden, 'native CTA untouched');
  }
});

test('the native purchase form is untouched: same CTA node, no listeners/attributes added, our block is a sibling outside the form controls', async () => {
  const before = setup({ features: ['return-link'] }); await tick();
  const t = setup(); await tick(500);
  const cta = t.doc.getElementById('add-to-cart-desk'); const cta0 = before.doc.getElementById('add-to-cart-desk');
  assert.equal(cta.outerHTML, cta0.outerHTML);
  assert.equal(t.doc.querySelectorAll('[data-origens-discovery="product"] form, [data-origens-discovery="product"] [name]').length, 0);
});

test('search opens/closes, only queries the geographic gateway (same origin, no credentials), results are storefront links; the CTA keeps working', async () => {
  const t = setup(); await tick(500);
  const b = blocks(t.doc)[0]; const toggle = b.querySelector('.o-toggle');
  click(t.w, toggle); assert.equal(b.querySelector('.o-panel').hidden, false); assert.equal(toggle.hidden, true);
  const input = b.querySelector('.o-input'); assert.equal(t.doc.querySelector('label[for="' + input.id + '"]').textContent, 'Buscar cidade ou estado');
  input.value = 'floria'; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); await tick(700);
  const search = t.fetchCalls.filter((c) => c.url.startsWith('/__origens/search')); assert.equal(search.length, 1); assert.equal(search[0].credentials, 'omit');
  assert.equal(b.querySelectorAll('.o-item').length, 1); assert.equal(b.querySelector('.o-item').getAttribute('href'), 'https://useorigens.com.br/sul/sc/florianopolis');
  click(t.w, b.querySelector('.o-close')); assert.equal(b.querySelector('.o-panel').hidden, true);
  click(t.w, b.querySelector('.o-cta')); assert.equal(t.navigations.at(-1).startsWith('https://useorigens.com.br/sul'), true);
});

test('search failure: honest message (not a catalog search), the link to the storefront stays and the purchase CTA is unaffected', async () => {
  const t = setup({ fetchImpl: () => new Response('x', { status: 500 }) }); await tick(500);
  const b = blocks(t.doc)[0]; click(t.w, b.querySelector('.o-toggle'));
  const input = b.querySelector('.o-input'); input.value = 'camiseta gaucho'; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); await tick(700);
  assert.match(b.querySelector('.o-status').textContent, /A busca não está disponível agora\. Você ainda pode explorar todas as estampas\./);
  assert.ok(b.querySelector('.o-cta') && t.doc.getElementById('add-to-cart-desk'));
});

test('exit links carry the cart bridge and the fixed-enum marker (ink_product_detail + slug); ONE click event per click; opening the search is its own intent event', async () => {
  const t = setup({ path: PATHS[3] }); await tick(1500);
  const b = blocks(t.doc)[0];
  click(t.w, b.querySelector('.o-toggle'));
  assert.deepEqual(t.events.map((e) => [e[1], e[2].entry_point]), [['origens_discovery_search_open', 'ink_product_detail']]);
  const cta = b.querySelector('.o-cta'); click(t.w, cta);
  const u = new URL(cta.href);
  assert.equal(u.origin + u.pathname, 'https://useorigens.com.br/sul');
  assert.equal(u.searchParams.get('origens_src'), 'ink_product_detail'); assert.equal(u.searchParams.get('origens_p'), 'ccc-tres');
  const clicks = t.events.filter((e) => e[1] === 'origens_explore_storefront_click'); assert.equal(clicks.length, 1);
  assert.deepEqual(clicks[0][2], { send_to: GA, entry_point: 'ink_product_detail', region: 'sul', transport_type: 'beacon', product_slug: 'ccc-tres' });
  assert.ok(!JSON.stringify(t.events).includes('AbCdEfGhIjKlMnOpQrStUv'));
});

test('Turbo: allowed A -> allowed B -> NOT allowed -> Serra: 1 -> 1 -> 0 (no block, style, link, listener) -> 1, never duplicated', async () => {
  const t = setup({ path: PATHS[1] }); await tick(600);
  const visit = async (path) => { t.w.history.pushState({}, '', path); for (const n of ['turbo:render', 'turbo:load']) t.doc.dispatchEvent(new t.w.Event(n)); await tick(700); };
  assert.equal(blocks(t.doc).length, 1);
  await visit(PATHS[2]); assert.equal(blocks(t.doc).length, 1);
  await visit('/usesul/product/nao-permitido');
  assert.equal(blocks(t.doc).length, 0); assert.equal(t.doc.querySelectorAll('[data-origens-discovery], style[data-origens-discovery-style], #use-origens-return-link').length, 0);
  await visit(PATHS[0]); assert.equal(blocks(t.doc).length, 1); assert.equal(t.doc.querySelectorAll('style[data-origens-discovery-style]').length, 1);
  for (let i = 0; i < 5; i++) t.doc.body.appendChild(t.doc.createElement('i')); await tick(400); assert.equal(blocks(t.doc).length, 1, 'DOM mutations never duplicate it');
});

test('the INK re-rendering its turbo-frame (mobile lazy load, variant change) does NOT rebuild the block: same node, open search and focus survive', async () => {
  const t = setup(); await tick(600);
  const b = blocks(t.doc)[0]; b.__m = true;
  click(t.w, b.querySelector('.o-toggle')); assert.equal(b.querySelector('.o-panel').hidden, false);
  const frame = t.doc.querySelector('turbo-frame#cart'); const html = frame.innerHTML;
  for (let i = 0; i < 3; i++) { frame.innerHTML = ''; frame.innerHTML = html; t.doc.dispatchEvent(new t.w.Event('turbo:frame-render')); await tick(300); }
  assert.equal(blocks(t.doc).length, 1); assert.equal(blocks(t.doc)[0], b, 'same node'); assert.equal(b.__m, true); assert.equal(b.querySelector('.o-panel').hidden, false);
});

test('a block that is really gone (page swapped) gets rebuilt once; nothing on an unknown page', async () => {
  const t = setup(); await tick(600);
  blocks(t.doc)[0].remove(); await tick(700); assert.equal(blocks(t.doc).length, 1);
  const off = setup({ path: '/usesul/product/fora-da-lista' }); await tick(600);
  assert.equal(off.doc.querySelectorAll('[data-origens-discovery], #use-origens-return-link, style[data-origens-discovery-style]').length, 0); assert.equal(off.scriptLoads.length, 0);
});

test('plan B: if discovery.js cannot load, the plain link "Explorar todas as estampas" appears (one link, no block, no retry loop) and keeps the tracking', async () => {
  const t = setup({ discoveryFails: true }); await tick(900);
  assert.equal(blocks(t.doc).length, 0); assert.equal(t.scriptLoads.length, 1);
  const link = t.doc.getElementById('use-origens-return-link'); assert.ok(link); assert.equal(link.textContent, 'Explorar todas as estampas');
  click(t.w, link); assert.equal(t.events.at(-1)[2].entry_point, 'ink_product_return');
});

test('feature OFF (five features, no product-discovery): the pilot link "← Voltar a procurar" is exactly as before and no discovery.js is requested on load', async () => {
  const t = setup({ features: ALL.filter((f) => f !== 'product-discovery') }); await tick(700);
  assert.equal(blocks(t.doc).length, 0); assert.equal(t.scriptLoads.length, 0);
  assert.equal(t.doc.getElementById('use-origens-return-link').textContent, '← Voltar a procurar');
});

test('product-discovery alone (no city-search): only the link to the storefront, no search field', async () => {
  const t = setup({ features: ['return-link', 'product-discovery'] }); await tick(600);
  const b = blocks(t.doc)[0]; assert.ok(b.querySelector('.o-cta')); assert.equal(b.querySelectorAll('.o-toggle, .o-input').length, 0);
});

test('the two other surfaces use the short copy and the SAME two actions', () => {
  const src = buildDiscoverySource({ search: true, postAdd: true, cart: true, product: true });
  assert.ok(src.includes("title: 'Descubra outras estampas'") && src.includes("title: 'Continue explorando'"));
  assert.ok(src.includes("const CTA_TEXT = 'Explorar todas as estampas'") && src.includes("const SEARCH_TEXT = 'Buscar cidade ou estado'"));
  assert.ok(!/Explorar vitrine|Explorar outras camisetas|Qual é a próxima cidade|Procurar outra cidade/.test(src));
});
