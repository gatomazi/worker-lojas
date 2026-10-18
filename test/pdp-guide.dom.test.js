import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures } from '../src/features.js';

// pdp-guide: convite "Procurando sua cidade ou outra estampa?" abaixo do CTA nativo, painel por toque, busca de cidade, estampas da cidade, coleções, dispensa
// por 30 dias e medição (jsdom; o gateway /__origens/guia e /__origens/search são stubs).
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/feito-em-florianopolis';
const PATHS = [PATH, '/usesul/product/aaa-um'];
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'pdp-guide'];
const GA = 'G-8GYTEJ1F77';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const item = (id, title) => ({ productId: String(id), title, context: 'Florianópolis · SC', image: IMG + id + '.jpg', price: 109.9, href: HOST + '/usesul/product/item-' + id });
const CITY = { name: 'Florianópolis', uf: 'SC', slug: 'florianopolis', kind: 'city', url: 'https://useorigens.com.br/sul/sc/florianopolis' };
const SEARCH = { results: [{ type: 'city', name: 'Florianópolis', uf: 'SC', meso: 'Grande Florianópolis', href: 'https://useorigens.com.br/sul/sc/florianopolis' }, { type: 'state', name: 'Santa Catarina', uf: 'SC', href: 'https://useorigens.com.br/sul/sc' }] };
const GUIDE = {
  'produto=4714617': { ok: true, kind: 'produto', city: CITY },
  'cidade=sc/florianopolis&produto=4714617': { ok: true, kind: 'cidade', city: CITY, items: [item(1, 'Ponto de Origem'), item(2, 'Coordenadas'), item(3, 'Legado')], total: 8 },
  '': { ok: true, kind: 'colecoes', collections: [{ name: 'Da Nossa Terra', slug: 'da-nossa-terra', url: 'https://useorigens.com.br/sul/colecoes/da-nossa-terra', image: IMG + 'c.jpg', total: 73 }, { name: 'Fala Daqui', slug: 'fala-daqui', url: 'https://useorigens.com.br/sul/colecoes/fala-daqui', total: 12 }] },
  'colecao=da-nossa-terra': { ok: true, kind: 'colecao', collection: { name: 'Da Nossa Terra', slug: 'da-nossa-terra', url: 'https://useorigens.com.br/sul/colecoes/da-nossa-terra', total: 73 }, items: [item(11, 'Catarinense | Essência'), item(12, 'Gaúcho | Essência'), item(13, 'Paranaense | Essência'), item(14, 'Serrano | Essência')], total: 73 }
};

function setup({ path = PATH, features = ALL, guide = GUIDE, searchFails = false, guideFails = false, cookieAccepted = true, storage = null, productId = '4714617' } = {}) {
  let html = FIXTURE.replace(/form-product-0/g, 'form-product-' + productId).replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + GA + '" async></script></head>');
  if (!cookieAccepted) html = html.replace(/<body[^>]*>/, (m) => m + '<div class="cookie-acceptance">Nosso site utiliza cookies <button>Aceitar cookies</button></div>');
  const dom = new JSDOM(html, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; } return [{}]; };
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  const events = []; w.gtag = function () { events.push(JSON.parse(JSON.stringify([...arguments]))); };
  const fetchCalls = [];
  w.fetch = async (url, options = {}) => {
    // The region of the page goes along on every request (asserted below); the mock answers by the rest of the address.
    const raw = String(url); const u = raw.replace(/[?&]origens_r=[a-z-]+$/, ''); fetchCalls.push({ url: u, raw, credentials: options.credentials });
    if (u.startsWith('/__origens/search')) return searchFails ? new Response('x', { status: 502 }) : new Response(JSON.stringify(SEARCH), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('/__origens/guia')) { if (guideFails) return new Response('x', { status: 503 }); const q = u.includes('?') ? u.slice(u.indexOf('?') + 1) : ''; const body = guide[q] || { ok: false, kind: 'x', notFound: true }; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return new Response('{}', { status: 200 });
  };
  const navigations = []; w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.href) { navigations.push(a.href); e.preventDefault(); } });
  w.eval(buildLoaderSource(PATHS, features));
  return { w, doc: w.document, events, fetchCalls, navigations };
}
const click = (w, el, init = {}) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const invite = (doc) => doc.querySelector('[data-origens-guide="invite"]');
const panel = (doc) => doc.getElementById('o-guide');
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const guideEvents = (events) => events.filter((e) => e[0] === 'event' && String(e[1]).startsWith('origens_guide_'));

test('feature flag: pdp-guide is a known feature (fail-closed list stays all-or-nothing)', () => {
  assert.deepEqual(parseFeatures(ALL.join(',')).features, ALL);
  assert.equal(parseFeatures('pdp-guide,nao-existe').status, 'invalid');
});

test('invite: ONE compact block right after the native purchase form, with the approved copy and two actions; the previous block and the return link are gone; nothing opens by itself', async () => {
  const t = setup(); await tick(400);
  const b = invite(t.doc);
  assert.ok(b, 'invite rendered');
  const form = t.doc.getElementById('form-product-4714617');
  assert.equal(form.nextElementSibling, b, 'right after the native form (outside it), below the CTA');
  assert.ok(!form.contains(b));
  assert.equal(text(b.querySelector('.o-g-title')), 'Procurando sua cidade ou outra estampa?');
  assert.deepEqual([...b.querySelectorAll('.o-g-actions > .o-g-btn')].map(text), ['Buscar uma cidade', 'Ver outras estampas', 'Mais estampas de Florianópolis'], 'context of the city arrives from the gateway');
  assert.equal(b.querySelector('.o-g-x').getAttribute('aria-label'), 'Dispensar esta ajuda');
  assert.equal(t.doc.querySelectorAll('[data-origens-discovery="product"]').length, 0, 'never both blocks');
  assert.equal(t.doc.getElementById('use-origens-return-link'), null);
  assert.equal(panel(t.doc), null, 'no dialog without a tap');
  assert.equal(t.doc.querySelectorAll('[data-origens-guide="invite"]').length, 1);
  assert.deepEqual(t.fetchCalls.map((c) => [c.url, c.credentials]), [['/__origens/guia?produto=4714617', 'omit']], 'one context request, same origin, no credentials');
  assert.ok(t.doc.getElementById('add-to-cart-desk') && !t.doc.getElementById('add-to-cart-desk').hidden, 'native CTA untouched');
  assert.equal(guideEvents(t.events).length, 0, 'no event without a visible exposure (no IntersectionObserver in jsdom) or a tap');
});

test('a merchandise product (no city) shows only the two actions; a product page without a numeric form id asks nothing', async () => {
  const t = setup({ guide: { ...GUIDE, 'produto=4714617': { ok: true, kind: 'produto', city: null } } }); await tick(300);
  assert.deepEqual([...invite(t.doc).querySelectorAll('.o-g-btn')].map(text), ['Buscar uma cidade', 'Ver outras estampas']);
  const u = setup({ productId: '0' }); await tick(200);
  assert.equal(u.fetchCalls.length, 0); assert.ok(invite(u.doc));
});

test('path A: "Buscar uma cidade" opens the dialog with the search focused; typing asks only the geographic gateway; a city shows up to three real products and the link to all of them; Esc closes and focus returns', async () => {
  const t = setup(); await tick(300);
  const trigger = invite(t.doc).querySelector('.o-g-btn');
  click(t.w, trigger);
  const p = panel(t.doc);
  assert.ok(p && p.getAttribute('role') === 'dialog' && p.getAttribute('aria-modal') === 'true');
  assert.equal(text(p.querySelector('#o-g-title')), 'Buscar uma cidade');
  const input = p.querySelector('.o-g-input');
  assert.equal(t.doc.activeElement, input, 'search focused (the visitor asked for it)');
  assert.equal(p.querySelector('.o-g-back').hidden, true, 'first step: no back');
  assert.equal(p.querySelector('.o-g-foot a').getAttribute('href'), 'https://useorigens.com.br/sul', 'the storefront is always one tap away');
  input.value = 'floripa'; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); await tick(600);
  const search = t.fetchCalls.filter((c) => c.url.startsWith('/__origens/search'));
  assert.equal(search.length, 1); assert.equal(search[0].credentials, 'omit'); assert.ok(search[0].url.endsWith('q=floripa'));
  const options = [...p.querySelectorAll('.o-g-item')];
  assert.deepEqual(options.map((o) => [o.tagName, text(o.querySelector('.o-g-name'))]), [['BUTTON', 'Florianópolis'], ['A', 'Santa Catarina']], 'city = step inside; state = link to the storefront');
  assert.equal(options[1].getAttribute('href'), 'https://useorigens.com.br/sul/sc');
  key(t.w, input, 'Enter'); await tick(300);
  assert.equal(text(p.querySelector('#o-g-title')), 'Estampas de Florianópolis');
  assert.equal(p.querySelector('.o-g-back').hidden, false);
  const cards = [...p.querySelectorAll('a.o-g-card')];
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.getAttribute('href')), [HOST + '/usesul/product/item-1', HOST + '/usesul/product/item-2', HOST + '/usesul/product/item-3'], 'INK product pages of this store');
  assert.equal(cards[0].getAttribute('aria-label').replace(/\u00a0/g, ' '), 'Ponto de Origem, Florianópolis · SC, R$ 109,90'); assert.ok(text(cards[0]).includes('Ver produto'));
  assert.equal(cards[0].querySelector('img').getAttribute('src'), IMG + '1.jpg');
  const all = p.querySelector('.o-g-after a');
  assert.equal(text(all), 'Ver todas as estampas de Florianópolis (8)'); assert.equal(all.getAttribute('href'), 'https://useorigens.com.br/sul/sc/florianopolis');
  assert.ok(t.fetchCalls.some((c) => c.url === '/__origens/guia?cidade=sc/florianopolis&produto=4714617'), 'the open product is excluded server-side');
  assert.ok(t.fetchCalls.length > 0 && t.fetchCalls.every((c) => /[?&]origens_r=sul$/.test(c.raw)), 'every guide and search request carries the page region (the cookie does not go: credentials omit)');
  click(t.w, cards[1]);
  assert.deepEqual(t.navigations, [HOST + '/usesul/product/item-2'], 'a product opens its PDP (normal link)');
  key(t.w, t.doc.activeElement || t.doc.body, 'Escape');
  assert.equal(panel(t.doc), null, 'Esc closes');
  assert.equal(t.doc.activeElement, trigger, 'focus back on the trigger');
  const names = guideEvents(t.events).map((e) => e[1]);
  assert.deepEqual(names, ['origens_guide_open', 'origens_guide_city_select', 'origens_guide_results', 'origens_guide_product_click']);
  const open = guideEvents(t.events)[0][2];
  assert.deepEqual(open, { send_to: GA, region: 'sul', surface: 'ink', entry_point: 'ink_product_detail', feature_version: 'guide_v1', transport_type: 'beacon', product_slug: 'feito-em-florianopolis', guide_path: 'city' });
  assert.deepEqual(guideEvents(t.events)[1][2].city_slug, 'florianopolis');
  assert.deepEqual([guideEvents(t.events)[2][2].result_count, guideEvents(t.events)[2][2].has_results], [3, 'true']);
  assert.deepEqual([guideEvents(t.events)[3][2].position, guideEvents(t.events)[3][2].target_product_id, guideEvents(t.events)[3][2].guide_path], [2, '2', 'city']);
  assert.ok(!JSON.stringify(t.events).includes('floripa'), 'the typed text never leaves the page');
});

test('context: "Mais estampas de Florianópolis" goes straight to the city results (no new search), the open product excluded', async () => {
  const t = setup(); await tick(300);
  click(t.w, invite(t.doc).querySelector('[data-guide-more]')); await tick(300);
  const p = panel(t.doc);
  assert.equal(text(p.querySelector('#o-g-title')), 'Estampas de Florianópolis');
  assert.equal(p.querySelectorAll('a.o-g-card').length, 3);
  assert.equal(guideEvents(t.events)[0][2].guide_path, 'city_context');
  assert.equal(guideEvents(t.events)[1][2].guide_path, 'city_context');
});

test('path B: "Ver outras estampas" lists the published collections with a real photo; one collection shows a few products and the link to the full page; back returns', async () => {
  const t = setup(); await tick(300);
  click(t.w, invite(t.doc).querySelectorAll('.o-g-btn')[1]); await tick(300);
  const p = panel(t.doc);
  assert.equal(text(p.querySelector('#o-g-title')), 'Ver outras estampas');
  const tiles = [...p.querySelectorAll('.o-g-tile')];
  assert.deepEqual(tiles.map((t) => t.getAttribute('aria-label')), ['Da Nossa Terra, 73 estampas', 'Fala Daqui, 12 estampas']);
  assert.equal(tiles[0].querySelector('img').getAttribute('src'), IMG + 'c.jpg'); assert.equal(tiles[1].querySelector('img'), null, 'no photo = no broken image');
  click(t.w, tiles[0]); await tick(300);
  assert.equal(text(p.querySelector('#o-g-title')), 'Da Nossa Terra');
  assert.equal(p.querySelectorAll('a.o-g-card').length, 4);
  assert.equal(text(p.querySelector('.o-g-after a')), 'Ver a coleção completa (73)'); assert.equal(p.querySelector('.o-g-after a').getAttribute('href'), 'https://useorigens.com.br/sul/colecoes/da-nossa-terra');
  click(t.w, p.querySelector('.o-g-back')); await tick(100);
  assert.equal(text(p.querySelector('#o-g-title')), 'Ver outras estampas');
  assert.equal(t.fetchCalls.filter((c) => c.url === '/__origens/guia').length, 1, 'collections cached for the page');
  click(t.w, p.querySelector('.o-g-back'));
  assert.equal(panel(t.doc), null, 'back on the first step closes');
  assert.deepEqual(guideEvents(t.events).map((e) => e[1]), ['origens_guide_open', 'origens_guide_results']);
  assert.equal(guideEvents(t.events)[1][2].guide_path, 'prints');
});

test('dismiss: the ✕ keeps only a discreet line, remembers it for 30 days (versioned key) and the line reopens the menu; an old dismissal is ignored', async () => {
  const t = setup(); await tick(300);
  click(t.w, invite(t.doc).querySelector('.o-g-x'));
  assert.equal(invite(t.doc), null);
  const reopen = t.doc.querySelector('[data-origens-guide="reopen"] button');
  assert.ok(reopen); assert.equal(text(reopen), 'Procurando sua cidade ou outra estampa? Abrir a busca');
  assert.equal(t.doc.activeElement, reopen, 'focus does not get lost');
  const stored = JSON.parse(t.w.localStorage.getItem('origens:guia:v1:dispensado'));
  assert.ok(stored.v === 1 && Date.now() - stored.at < 5000);
  assert.deepEqual(guideEvents(t.events).map((e) => e[1]), ['origens_guide_dismiss']);
  click(t.w, reopen); await tick(100);
  const p = panel(t.doc);
  assert.equal(text(p.querySelector('#o-g-title')), 'Procurando sua cidade ou outra estampa?');
  assert.deepEqual([...p.querySelectorAll('.o-g-menu .o-g-btn')].map(text), ['Mais estampas de Florianópolis', 'Buscar uma cidade', 'Ver outras estampas']);
  assert.equal(guideEvents(t.events)[1][2].guide_path, 'reopen');
  const u = setup({ storage: { 'origens:guia:v1:dispensado': JSON.stringify({ v: 1, at: Date.now() - 1000 }) } }); await tick(200);
  assert.equal(invite(u.doc), null); assert.ok(u.doc.querySelector('[data-origens-guide="reopen"]'), 'remembered on the next product page');
  const v = setup({ storage: { 'origens:guia:v1:dispensado': JSON.stringify({ v: 1, at: Date.now() - 31 * 24 * 3600 * 1000 }) } }); await tick(200);
  assert.ok(invite(v.doc), 'after 30 days the invite is back');
  const x = setup({ storage: { 'origens:guia:v1:dispensado': 'garbage' } }); await tick(200);
  assert.ok(invite(x.doc), 'unreadable storage never breaks the block');
});

test('failures are honest: search down shows the fallback text; the guide API down shows an error with retry and the storefront link; the native CTA is never touched', async () => {
  const t = setup({ searchFails: true, guideFails: true }); await tick(300);
  assert.ok(invite(t.doc), 'the invite renders without the context');
  assert.deepEqual([...invite(t.doc).querySelectorAll('.o-g-btn')].map(text), ['Buscar uma cidade', 'Ver outras estampas']);
  click(t.w, invite(t.doc).querySelector('.o-g-btn'));
  const p = panel(t.doc); const input = p.querySelector('.o-g-input');
  input.value = 'floripa'; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); await tick(600);
  assert.equal(text(p.querySelector('.o-g-status')), 'A busca não está disponível agora. Você ainda pode ver todas as estampas na Use Origens.');
  click(t.w, p.querySelector('.o-g-close'));
  click(t.w, invite(t.doc).querySelectorAll('.o-g-btn')[1]); await tick(300);
  const q = panel(t.doc);
  assert.equal(text(q.querySelector('[role="alert"]')), 'Não deu para carregar agora.');
  assert.equal(text(q.querySelector('.o-g-btn')), 'Tentar de novo');
  assert.equal(q.querySelector('.o-g-foot a').getAttribute('href'), 'https://useorigens.com.br/sul');
  assert.deepEqual(guideEvents(t.events).map((e) => [e[1], e[2].guide_step || e[2].guide_path]), [['origens_guide_open', 'city'], ['origens_guide_error', 'city_search'], ['origens_guide_open', 'prints'], ['origens_guide_error', 'collections']]);
  const cta = t.doc.getElementById('add-to-cart-desk');
  assert.equal(cta.outerHTML, setup({ features: ['return-link'] }).doc.getElementById('add-to-cart-desk').outerHTML);
});

test('city without products: an honest message and the two other ways out, never an invented product', async () => {
  const t = setup({ guide: { ...GUIDE, 'cidade=sc/florianopolis&produto=4714617': { ok: true, kind: 'cidade', city: CITY, items: [], total: 0 } } }); await tick(300);
  click(t.w, invite(t.doc).querySelector('[data-guide-more]')); await tick(300);
  const p = panel(t.doc);
  assert.equal(p.querySelectorAll('a.o-g-card').length, 0);
  assert.equal(text(p.querySelector('.o-g-lead')), 'Ainda não temos estampas de Florianópolis. Que tal outra cidade ou uma coleção?');
  assert.deepEqual([...p.querySelectorAll('.o-g-actions .o-g-btn')].map(text), ['Buscar uma cidade', 'Ver outras estampas']);
  assert.deepEqual([guideEvents(t.events)[1][2].result_count, guideEvents(t.events)[1][2].has_results], [0, 'false']);
});

test('storefront links of the guide carry the arrival marker (tracking.js) with the product-page origin; INK product cards do not', async () => {
  const t = setup(); await tick(300);
  click(t.w, invite(t.doc).querySelector('[data-guide-more]')); await tick(300);
  const p = panel(t.doc);
  click(t.w, p.querySelector('.o-g-after a'));
  assert.equal(t.navigations.pop(), 'https://useorigens.com.br/sul/sc/florianopolis?origens_src=ink_product_detail&origens_p=feito-em-florianopolis');
  assert.ok(t.events.some((e) => e[1] === 'origens_explore_storefront_click' && e[2].entry_point === 'ink_product_detail'));
  click(t.w, p.querySelector('a.o-g-card'));
  assert.equal(t.navigations.pop(), HOST + '/usesul/product/item-1', 'no marker on INK links');
});

test('without the INK cookie notice accepted nothing is measured, but the guide works the same', async () => {
  const t = setup({ cookieAccepted: false }); await tick(300);
  click(t.w, invite(t.doc).querySelector('.o-g-btn')); await tick(100);
  assert.ok(panel(t.doc));
  assert.equal(guideEvents(t.events).length, 0);
});

test('Turbo: leaving the product route tears the guide down (invite, dialog, style); another product page gets its own invite', async () => {
  const t = setup(); await tick(300);
  click(t.w, invite(t.doc).querySelector('.o-g-btn'));
  assert.ok(panel(t.doc));
  t.w.history.pushState({}, '', '/usesul/cart');
  t.w.dispatchEvent(new t.w.Event('popstate')); await tick(200);
  assert.equal(invite(t.doc), null); assert.equal(panel(t.doc), null); assert.equal(t.doc.getElementById('o-guide-style'), null);
  t.w.history.pushState({}, '', PATHS[1]);
  t.w.dispatchEvent(new t.w.Event('popstate')); await tick(300);
  assert.ok(invite(t.doc)); assert.equal(invite(t.doc).getAttribute('data-path'), PATHS[1]);
});

test('flag OFF (rollback): no invite; the previous "Continue explorando" block is back as it was', async () => {
  const features = ALL.filter((f) => f !== 'pdp-guide');
  const t = setup({ features }); await tick(400);
  assert.equal(t.doc.querySelector('[data-origens-guide]'), null);
  assert.equal(t.fetchCalls.length, 0, 'no guide request');
  const src = buildLoaderSource(PATHS, features);
  assert.ok(src.includes("id: 'product-discovery'") && !src.includes("id: 'pdp-guide'"), 'the previous module is the one in the loader');
});
