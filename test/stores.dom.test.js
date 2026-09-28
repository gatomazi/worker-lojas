import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource, buildDiscoverySource } from '../src/loader-source.js';
import { STORES } from '../src/stores.js';

// O loader de cada loja no jsdom: host, prefixo, storefront e GA4 DA LOJA; os links, a busca e a ponte do carrinho nunca saem para outra região.
// Fixtures = HTML real da INK (Use Sul) com host/prefixo trocados pelos da loja (o modelo da INK é o mesmo nas três lojas; o QA em navegador real confere a estrutura ao vivo).
const SAMPLES = JSON.parse(readFileSync(new URL('../scripts/store-samples.json', import.meta.url), 'utf8'));
const read = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const FEATURES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav'];
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const CART = '<div class="cart-drawer"><turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="1"></span></span></div><div class="cart-drawer__main"><ul>' +
  '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>Camiseta</p><p>Preta</p><p>M</p></div><div class="price-details"><div class="price"><span>R$ 109,90</span></div></div>' +
  '<form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-M"><input class="quantity-input" type="text" value="1" name="cart_item[quantity]"></form></li></ul></div>' +
  '<div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="109.9"><p>Total</p><div><p>R$ 109,90</p></div></div></div></div></turbo-frame></div>';

const forStore = (text, store) => text.replaceAll('www.usesul.com.br', store.inkHost).replaceAll('/usesul', store.inkBase);
const navbarPayload = (store) => ({ v: 2, states: store.ufs.map((uf) => ({ uf, name: store.stateNames[uf], path: store.storefrontBase + '/' + uf.toLowerCase() })), top: [], more: [] });

function setup(store, { path, features = FEATURES, cart = '', gtag = false, host = store.inkHost, extraBody = '' } = {}) {
  const product = SAMPLES[store.id].allowlist[0];
  const pagePath = path || product;
  let html = forStore(read('product-page.html'), store).replace(/(<body[^>]*>)/, '$1' + forStore(read('ink-header.html'), store)).replace('</main>', cart + extraBody + '</main>');
  if (gtag) html = html.replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js?id=' + store.ga + '" async></script></head>');
  // `navs`: navegações que o jsdom não implementa (a ponte do carrinho e a busca terminam em location.assign); `navigations`: cliques em links NÃO interceptados.
  const t = { fetches: [], navigations: [], navs: [], events: [], lastLink: null };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) t.navs.push(t.lastLink ? t.lastLink.href : null); });
  const dom = new JSDOM(html, { url: 'https://' + host + pagePath, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none' || n.classList.contains('hidden')) return []; } return [{}]; };
  if (gtag) w.gtag = function () { t.events.push([...arguments]); };
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (String(url).includes('cart-ref')) return json({ ref: REF, ttl: 1800 }, 201);
    if (String(url).includes('/__origens/navbar')) return json(navbarPayload(store));
    return new Response('nope', { status: 404 });
  };
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.getAttribute('href')) { t.lastLink = a; if (!e.defaultPrevented) { t.navigations.push(a.href); e.preventDefault(); } } });
  Object.assign(t, { w, doc: w.document, q: (sel) => w.document.querySelector(sel), all: (sel) => [...w.document.querySelectorAll(sel)] });
  w.eval(buildLoaderSource([product], features, 'allowlist', store));
  t.posts = () => t.fetches.filter((f) => f.method === 'POST' && f.url.includes('cart-ref'));
  return t;
}
const click = (t, el) => el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));

for (const id of ['norte', 'centro']) {
  const store = STORES[id];
  const home = store.storefront + store.storefrontBase;

  test(`[${id}] mounts only on the store host + prefix; the wrong host (another store, workers.dev) or another store prefix mounts nothing`, async () => {
    const ok = setup(store); await tick(300);
    assert.ok(ok.q('header [data-origens-nav]'), 'navbar mounted');
    for (const host of ['www.usesul.com.br', STORES[id === 'norte' ? 'centro' : 'norte'].inkHost, 'use-x.workers.dev']) {
      const t = setup(store, { host }); await tick(300);
      assert.equal(t.all('[data-origens-nav], #use-origens-return-link, [data-origens-discovery]').length, 0, host);
      assert.equal(t.fetches.length, 0, host);
    }
    const foreignPrefix = setup(store, { path: '/usesul/product/serra-catarinense' }); await tick(300);
    assert.equal(foreignPrefix.all('[data-origens-nav], #use-origens-return-link').length, 0);
  });

  test(`[${id}] navbar: logo, Cidades, states and the search all point to ${store.storefrontBase} on the storefront; the config is fetched once, from the Worker`, async () => {
    const t = setup(store); await tick(300);
    const hrefs = t.all('[data-origens-nav] a[href], a[data-origens-nav][href]').map((a) => a.href);
    assert.ok(hrefs.includes(home), 'logo -> region home');
    assert.ok(hrefs.includes(home + '#estados'), 'Cidades');
    for (const uf of store.ufs) assert.ok(hrefs.includes(home + '/' + uf.toLowerCase()), 'state ' + uf);
    const foreign = hrefs.filter((h) => h.startsWith('https://useorigens.com.br') && !(h === home || h.startsWith(home + '/') || h.startsWith(home + '#')));
    assert.deepEqual(foreign, [], 'no storefront link outside this region');
    assert.equal(t.q('#o-nav-search').action, home + '/busca');
    assert.deepEqual(t.fetches.map((f) => f.url), ['/__origens/navbar']);
    const brand = t.q('.o-nav-logo'); assert.ok(brand.getAttribute('aria-label').includes(store.name));
  });

  test(`[${id}] search: typing makes no request; Enter goes to ${store.storefrontBase}/busca?q=…, waiting for one cart snapshot when the cart has items`, async () => {
    const t = setup(store, { cart: CART }); await tick(300);
    t.q('.o-nav-lupa').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const input = t.q('#o-nav-q'); const before = t.fetches.length;
    for (const text of ['b', 'be', 'bel', 'belem']) { input.value = text; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); }
    await tick(300);
    assert.equal(t.fetches.length, before, 'no request while typing');
    assert.equal(t.posts().length, 0, 'no KV write while typing');
    t.q('#o-nav-search').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true })); await tick(400);
    assert.equal(t.posts().length, 1, 'exactly one snapshot on exit');
    assert.equal(t.posts()[0].url, '/__origens/cart-ref');
    const dest = new URL(t.navs.at(-1));
    assert.equal(dest.origin + dest.pathname, home + '/busca'); assert.equal(dest.searchParams.get('q'), 'belem'); assert.equal(dest.searchParams.get('cart_ref'), REF);
  });

  test(`[${id}] cart bridge: our ${store.storefrontBase} links carry the token; INK links, other regions and foreign hosts never do`, async () => {
    const t = setup(store, { cart: CART, extraBody: '<a id="other-region" href="https://useorigens.com.br/sul/pr">x</a><a id="foreign" href="https://evil.example' + store.storefrontBase + '">y</a><a id="ink" href="' + store.inkBase + '/orders">o</a>' }); await tick(300);
    click(t, t.q('.o-nav-logo')); await tick(300);
    assert.equal(t.posts().length, 1); const out = new URL(t.navs.at(-1)); assert.equal(out.searchParams.get('cart_ref'), REF); assert.equal(out.origin + out.pathname, home);
    const before = t.navigations.length; const navsBefore = t.navs.length;
    for (const sel of ['#other-region', '#foreign', '#ink']) click(t, t.q(sel));
    await tick(100);
    assert.equal(t.posts().length, 1, 'no extra snapshot'); assert.equal(t.navs.length, navsBefore, 'the bridge did not intercept them');
    assert.equal(t.navigations.length, before + 3);
    for (const href of t.navigations.slice(before)) assert.equal(new URL(href).searchParams.has('cart_ref'), false, href);
  });

  test(`[${id}] return link and discovery: the default return is ${store.storefrontBase}; only ${store.storefrontBase} URLs are accepted (other regions and hosts are ignored)`, async () => {
    const t = setup(store, { features: ['return-link'] }); await tick(300);
    assert.equal(t.q('#use-origens-return-link').href, home);
    const withParam = (value) => {
      const html = forStore(read('product-page.html'), store);
      const dom = new JSDOM(html, { url: 'https://' + store.inkHost + SAMPLES[id].allowlist[0] + '?origens_return=' + encodeURIComponent(value), runScripts: 'outside-only', pretendToBeVisual: true });
      dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
      dom.window.eval(buildLoaderSource([SAMPLES[id].allowlist[0]], ['return-link'], 'allowlist', store));
      return dom;
    };
    const good = withParam(home + '/' + store.ufs[0].toLowerCase()); await tick(300);
    assert.equal(good.window.document.getElementById('use-origens-return-link').href, home + '/' + store.ufs[0].toLowerCase());
    for (const bad of ['https://useorigens.com.br/sul/pr', 'https://evil.example' + store.storefrontBase, 'http://useorigens.com.br' + store.storefrontBase]) {
      const dom = withParam(bad); await tick(300);
      assert.equal(dom.window.document.getElementById('use-origens-return-link').href, home, bad);
    }
  });

  test(`[${id}] tracking: the event carries this store's region and GA4 property; without that property on the page nothing is sent`, async () => {
    const t = setup(store, { features: ['return-link', 'cart-mirror'], gtag: true }); await tick(300);
    click(t, t.q('#use-origens-return-link'));
    assert.equal(t.events.length, 1);
    const params = JSON.parse(JSON.stringify(t.events[0][2]));
    assert.equal(params.send_to, store.ga); assert.equal(params.region, store.region); assert.equal(params.entry_point, 'ink_product_return');
    assert.equal(JSON.stringify(t.events).includes('G-8GYTEJ1F77'), id === 'sul');
    const sulGa = setup(store, { features: ['return-link'], gtag: false, extraBody: '<script src="https://www.googletagmanager.com/gtag/js?id=G-8GYTEJ1F77"></script>' }); sulGa.w.gtag = function () { sulGa.events.push([...arguments]); }; await tick(300);
    click(sulGa, sulGa.q('#use-origens-return-link'));
    assert.equal(sulGa.events.length, 0, 'a page that only carries the Sul property gets no event');
  });

  test(`[${id}] post-add discovery: the CTA goes to ${store.storefrontBase}; search results are shown only when they are ${store.storefrontBase} links (other regions, hosts and query strings are dropped)`, async () => {
    const s = SAMPLES[id].search;
    const good = { type: 'city', name: s.city, uf: s.uf, meso: null, href: s.href };
    const results = { results: [good, { type: 'city', name: 'Curitiba', uf: 'PR', meso: null, href: 'https://useorigens.com.br/sul/pr/curitiba' },
      { type: 'city', name: 'Fora', uf: s.uf, meso: null, href: 'https://evil.example' + s.href.replace('https://useorigens.com.br', '') },
      { type: 'city', name: 'Query', uf: s.uf, meso: null, href: s.href + '?x=1' }] };
    const t = setup(store, { features: ['return-link', 'post-add-discovery', 'city-search'] });
    // discovery.js sob demanda: o mesmo código que o Worker serve, avaliado ao carregar o <script>
    const head = t.doc.head; const original = head.appendChild.bind(head);
    head.appendChild = (node) => {
      if (node.tagName === 'SCRIPT' && /discovery\.js/.test(node.src)) { original(node); queueMicrotask(() => { t.w.eval(buildDiscoverySource({ search: true, postAdd: true })); if (node.onload) node.onload(); }); return node; }
      return original(node);
    };
    t.w.fetch = async (url) => { t.fetches.push({ url: String(url), method: 'GET' }); return String(url).includes('/__origens/search') ? json(results) : json(navbarPayload(store)); };
    t.doc.querySelector('main').insertAdjacentHTML('beforeend', '<turbo-frame id="last_added_product"></turbo-frame>');
    t.doc.getElementById('last_added_product').innerHTML = '<div id="modal-wrapper" class="add-product-modal" role="dialog" aria-modal="true"><div class="relative w-full"><div class="w-full p-4"><div class="flex"><h3>Produto adicionado ao carrinho</h3><button id="modal-close-button"></button></div><div class="flex flex-col add-product-modal__modal-content__footer"><button class="flex checkout-btn"><span>Ver carrinho</span></button><button id="continue-shopping-button"><span>Continuar comprando</span></button></div><turbo-frame id="most_sold_frame"><h3>As mais vendidas</h3></turbo-frame></div></div></div>';
    await tick(500);
    const root = t.doc.querySelector('[data-origens-discovery]');
    assert.ok(root, 'the post-add block mounted'); assert.equal(root.querySelector('.o-cta').href, home);
    const input = root.querySelector('.o-input'); input.value = s.query; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); await tick(600);
    const links = [...root.querySelectorAll('a.o-item')].map((a) => a.href);
    assert.ok(links.includes(s.href), 'the region result is shown: ' + JSON.stringify(links));
    assert.equal(links.some((h) => h.includes('/sul/') || h.includes('evil.example') || h.includes('?x=1')), false, JSON.stringify(links));
    assert.deepEqual(t.fetches.filter((f) => f.url.includes('/__origens/search')).map((f) => new URL(f.url, 'https://x').pathname), ['/__origens/search']);
  });
}
