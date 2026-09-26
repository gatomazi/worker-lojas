import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource, LOADER_VERSION } from '../src/loader-source.js';
import { parseFeatures } from '../src/features.js';

// header-nav: cabeçalho da INK aproximado do storefront + busca textual redirecionada + FAB de WhatsApp (jsdom; HTML REAL do cabeçalho da INK como fixture).
const read = (name) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const PRODUCT = read('product-page.html');
const HEADER = read('ink-header.html');
const HEADER_IN = read('ink-header-logged-in.html');
const HELP = read('ink-help.html');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/serra-catarinense';
const ALL = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav'];
const NAV_ONLY = ['header-nav'];
const WITH_MIRROR = ['cart-mirror', 'header-nav'];
const tick = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const REF = 'AbCdEfGhIjKlMnOpQrStUv';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/1880b16e4d326a02dea0508acc56925d.jpg';
const WA = 'https://api.whatsapp.com/send?phone=5548988082581'; // o mesmo destino que a INK publica no menu e no Ajuda
const HEADER_NO_WA = HEADER.replace(/<a class="wpp-floater"[^>]*>[^<]*<\/a>/, '');

const STATES = [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }, { uf: 'SC', name: 'Santa Catarina', path: '/sul/sc' }, { uf: 'RS', name: 'Rio Grande do Sul', path: '/sul/rs' }];
const entries = (names) => names.map((title, i) => ({ id: i + 1, title, slug: title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'), order: i + 1 }));
const cfg = (top, more = []) => ({ v: 2, states: STATES, top: entries(top), more: entries(more).map((e, i) => ({ ...e, id: 100 + i })) });
const CONFIG = cfg(['Novidades', 'Do Nosso Jeito', 'Feito Para Você'], ['Seu Lugar', 'Fala Daqui', 'Da Nossa Terra', 'Kits']);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const cartHtml = '<div class="cart-drawer"><turbo-frame id="cart"><div><div class="cart-drawer__header"><span>Carrinho <span id="quantity-header" data-quantityheader="1"></span></span></div><div class="cart-drawer__main"><ul>' +
  '<li class="main-list__item"><img src="' + IMG + '"><div class="item-details"><p>Serra Catarinense</p><p>Preta</p><p>M</p></div><div class="price-details"><div class="price"><span>R$ 109,90</span></div></div>' +
  '<form data-turbo="true" data-ink-store--cart-product-id-value="4932916" data-ink-store--cart-product-variant-value="Preta-Masculino-M"><input class="quantity-input" type="text" value="1" name="cart_item[quantity]"></form></li></ul></div>' +
  '<div class="cart-drawer__footer"><div class="footer-details" data-ink-store--cart-discount-value="0.0" data-ink-store--cart-subtotal-value="109.9"><p>Total</p><div><p>R$ 109,90</p></div></div></div></div></turbo-frame></div>';
const EMPTY_CART = '<div class="cart-drawer"><turbo-frame id="cart"><div><header class="cart-drawer__header"><span>(0 produtos)</span></header><div class="empty-cart"><span>Seu carrinho está vazio</span></div></div></turbo-frame></div>';

function page({ header = HEADER, cart = '', help = '' } = {}) {
  return PRODUCT.replace(/(<body[^>]*>)/, '$1' + header).replace('</main>', cart + '</main>').replace('</body>', help + '</body>');
}

function setup({ features = NAV_ONLY, config = CONFIG, cart = '', header = HEADER, help = '', path = PATH, fetchImpl, carry = null, overflow = false, viewport = null } = {}) {
  const virtualConsole = new VirtualConsole();
  const t = { navs: [], lastLink: null, fetches: [], navigations: [] };
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) t.navs.push(t.lastLink ? t.lastLink.href : null); });
  const dom = new JSDOM(page({ header, cart, help }), { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  // Sem layout no jsdom: "renderizado" = sem atributo hidden, sem display:none e sem a classe utilitária `hidden` (Tailwind) em nenhum ancestral.
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none' || n.classList.contains('hidden')) return []; } return [{}]; };
  // A largura "não cabe" é simulada por página (o jsdom não tem layout).
  Object.defineProperty(w.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList && this.classList.contains('o-nav-links') ? (w.__overflow ? 999 : 10) : 0; } });
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList && this.classList.contains('o-nav-links') ? 100 : 0; } });
  w.__overflow = overflow;
  if (viewport) Object.defineProperty(w, 'visualViewport', { configurable: true, value: { height: viewport, addEventListener() {} } });
  if (carry) for (const [k, v] of Object.entries(carry)) w.sessionStorage.setItem(k, v);
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), method: options.method || 'GET', credentials: options.credentials, headers: options.headers, body: options.body });
    if (fetchImpl) return fetchImpl(String(url), options);
    if (String(url).includes('cart-ref')) return json({ ref: REF, ttl: 1800 }, 201);
    if (String(url).includes('/__origens/navbar')) return json(config);
    return new Response('nope', { status: 404 });
  };
  // Cliques que o navegador seguiria sozinho (não interceptados pelo cart-mirror).
  w.document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a && a.getAttribute('href')) { t.lastLink = a; if (!e.defaultPrevented) { t.navigations.push(a.href); e.preventDefault(); } } });
  Object.assign(t, { w, doc: w.document, dom });
  w.eval(buildLoaderSource([PATH], features, 'allowlist'));
  t.q = (sel) => w.document.querySelector(sel);
  t.all = (sel) => [...w.document.querySelectorAll(sel)];
  t.navFetches = () => t.fetches.filter((f) => f.url.includes('/__origens/navbar'));
  t.posts = () => t.fetches.filter((f) => f.url.includes('cart-ref'));
  return t;
}
const click = (t, el, init = {}) => { const e = new t.w.MouseEvent('click', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
const key = (t, el, k) => el.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const type = (t, text) => { const input = t.q('#o-nav-q'); input.value = text; input.dispatchEvent(new t.w.Event('input', { bubbles: true })); };
const enter = (t) => t.q('#o-nav-search').dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true }));
const desktopLupa = (t) => t.q('[data-origens-nav="desktop"] .o-nav-lupa');
const mobileLupa = (t) => t.q('.navbar__top .o-nav-lupa');
const dd = (t, id) => t.q('[data-origens-nav="desktop"] .o-nav-full [data-dd="' + id + '"]');
const ddOpen = (t, id) => !dd(t, id).querySelector('.o-dd-panel').hidden;
const texts = (nodes) => [...nodes].map((n) => n.textContent.trim());

test('header-nav is a known feature; the bundle contains the module (and the FAB) only when it is enabled; no eighth flag exists', () => {
  assert.deepEqual(parseFeatures(ALL.join(',')).features, ALL);
  assert.equal(parseFeatures('header-nav,nao-existe').status, 'invalid');
  assert.equal(parseFeatures(ALL.join(',') + ',whatsapp-fab').status, 'invalid', 'the FAB is part of header-nav, not a flag of its own');
  assert.match(buildLoaderSource([PATH], NAV_ONLY), /id: 'header-nav'/);
  assert.match(buildLoaderSource([PATH], NAV_ONLY), /id: 'whatsapp-fab'/);
  const off = buildLoaderSource([PATH], ['return-link', 'cart-mirror']);
  assert.doesNotMatch(off, /id: 'header-nav'|id: 'whatsapp-fab'|o-wa-fab|__origens\/navbar/);
  const src = buildLoaderSource([PATH], NAV_ONLY);
  assert.ok(!src.includes('__NAV_STORE__'));
  assert.ok(src.includes('"search":"https://useorigens.com.br/sul/busca"') && src.includes('"inkBase":"/usesul"') && src.includes('"origin":"https://useorigens.com.br"'));
});

test('desktop order: Regiões ▾, ALL the Topo collections in CMS order, Demais categorias ▾, Cidades, lupa; native account and cart untouched', async () => {
  const t = setup(); await tick(300);
  const desk = t.q('[data-origens-nav="desktop"]');
  assert.ok(desk); assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-nav-search').length, 1);
  const full = desk.querySelector('.o-nav-full');
  assert.deepEqual(texts([...full.children].map((c) => (c.matches('.o-dd') ? c.querySelector('button') : c))), ['Regiões', 'Novidades', 'Do Nosso Jeito', 'Feito Para Você', 'Demais categorias']);
  const topLinks = [...full.querySelectorAll(':scope > a')].map((a) => [a.textContent, a.getAttribute('href')]);
  assert.deepEqual(topLinks, [['Novidades', '/usesul/collections/novidades'], ['Do Nosso Jeito', '/usesul/collections/do-nosso-jeito'], ['Feito Para Você', '/usesul/collections/feito-para-voce']]);
  assert.deepEqual(texts(dd(t, 'demais').querySelectorAll('a')), ['Seu Lugar', 'Fala Daqui', 'Da Nossa Terra', 'Kits']);
  assert.deepEqual([...dd(t, 'regioes').querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]), [['Paraná', 'https://useorigens.com.br/sul/pr'], ['Santa Catarina', 'https://useorigens.com.br/sul/sc'], ['Rio Grande do Sul', 'https://useorigens.com.br/sul/rs'], ['Ver estados', 'https://useorigens.com.br/sul#estados']]);
  const links = desk.querySelector('.o-nav-links'); const last = links.lastElementChild;
  assert.equal(last.textContent, 'Cidades'); assert.equal(last.getAttribute('href'), 'https://useorigens.com.br/sul#estados');
  assert.equal(desk.querySelector('.o-nav-logo').getAttribute('href'), 'https://useorigens.com.br/sul');
  assert.equal(desk.querySelector('.o-nav-logo img').getAttribute('src'), t.q('a.brand img').getAttribute('src'), 'reuses the store logo the INK page already loads');
  assert.ok(desktopLupa(t) && desk.lastElementChild === desktopLupa(t), 'the lupa closes the block, before the native account/cart');
  for (const sel of ['a.brand', 'ul.navbar-list', '#shopping-cart-menu-mob', '.menu-icons', '#menu-hamburger', '#navbar-list-mobile', 'button[aria-label="Pesquisar"]', '#mobile_search']) assert.ok(t.q(sel), sel + ' still exists (hidden by CSS only)');
  const css = t.q('style[data-origens-nav]').textContent;
  assert.match(css, /header:has\(\[data-origens-nav\]\) nav\.navbar:not\(\[data-controller\]\) > ul\.navbar-list/);
  assert.ok(!/menu-icons|menu-user|shopping-cart|checkout|help-button|wpp-floater/.test(css), 'the stylesheet never targets account, cart, Ajuda or the native WhatsApp link');
});

test('there is no editorial limit or special slot: twelve Topo collections and thirty Demais categorias are all rendered; "Novidades" is just a title', async () => {
  const top = Array.from({ length: 12 }, (_, i) => (i === 5 ? 'Novidades' : 'Coleção ' + (i + 1)));
  const more = Array.from({ length: 30 }, (_, i) => 'Outra ' + (i + 1));
  const t = setup({ config: cfg(top, more) }); await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"] .o-nav-full > a').length, 12);
  assert.equal(dd(t, 'demais').querySelectorAll('a').length, 30);
  assert.deepEqual(texts(t.all('[data-origens-nav="desktop"] .o-nav-full > a')), top, 'the CMS order, verbatim');
  assert.equal(t.all('[data-origens-nav="menu"] > a:not(.o-cta)').length, 12, 'the mobile menu lists all of them too');
  assert.ok(t.q('[data-origens-nav="desktop"] .o-nav-full > a[href$="/novidades"]'), 'Novidades has no role of its own: it is one more link');
});

test('an empty Demais categorias group hides its button (desktop and mobile); an empty Topo still leaves Regiões, Cidades and the search', async () => {
  const noMore = setup({ config: cfg(['Novidades']) }); await tick(300);
  assert.equal(dd(noMore, 'demais'), null); assert.equal(noMore.q('[data-dd="demais"]'), null);
  assert.ok(!texts(noMore.all('[data-origens-nav="menu"] .o-acc-btn')).includes('Demais categorias'));
  const none = setup({ config: cfg([], []) }); await tick(300);
  assert.ok(none.q('[data-origens-nav="desktop"]'));
  assert.deepEqual([...none.all('[data-origens-nav="desktop"] .o-nav-full > *')].map((c) => c.querySelector('button').textContent.trim()), ['Regiões']);
  assert.equal(none.q('[data-origens-nav="menu"] .o-nav-title'), null, 'no "Coleções" heading without collections');
  assert.ok(none.q('[data-origens-nav="menu"] a.o-cta'));
});

test('collection names are plain text: no markup from the config is ever interpreted', async () => {
  const t = setup({ config: { v: 2, states: STATES, top: [{ id: 1, title: '<img src=x onerror=alert(1)>Kits', slug: 'kits', order: 1 }], more: [] } }); await tick(300);
  const link = t.q('.o-nav-full > a');
  assert.equal(link.textContent, '<img src=x onerror=alert(1)>Kits'); assert.equal(link.querySelector('img'), null);
});

test('dropdowns work by click and keyboard: aria-expanded, one open at a time, Escape returns the focus, outside click, link choice and Turbo close them', async () => {
  const t = setup(); await tick(300);
  const regBtn = dd(t, 'regioes').querySelector('button'); const demBtn = dd(t, 'demais').querySelector('button');
  assert.equal(regBtn.getAttribute('aria-expanded'), 'false'); assert.equal(ddOpen(t, 'regioes'), false);
  click(t, regBtn);
  assert.equal(ddOpen(t, 'regioes'), true); assert.equal(regBtn.getAttribute('aria-expanded'), 'true'); assert.equal(regBtn.getAttribute('aria-haspopup'), 'true');
  click(t, demBtn);
  assert.equal(ddOpen(t, 'regioes'), false, 'opening another one closes the first'); assert.equal(ddOpen(t, 'demais'), true);
  // Escape closes and gives the focus back to the button
  dd(t, 'demais').querySelector('a').focus(); key(t, dd(t, 'demais').querySelector('.o-dd-panel'), 'Escape');
  assert.equal(ddOpen(t, 'demais'), false); assert.equal(t.doc.activeElement, demBtn);
  // document-level Escape and outside click
  click(t, regBtn); key(t, t.doc.body, 'Escape'); assert.equal(ddOpen(t, 'regioes'), false);
  click(t, regBtn); click(t, t.q('.navbar__top')); assert.equal(ddOpen(t, 'regioes'), false, 'outside click');
  // choosing a link closes the panel
  click(t, regBtn); click(t, dd(t, 'regioes').querySelector('a')); await tick(30);
  assert.equal(ddOpen(t, 'regioes'), false);
  // Turbo navigation closes
  click(t, demBtn); t.doc.dispatchEvent(new t.w.Event('turbo:visit')); assert.equal(ddOpen(t, 'demais'), false);
  // opening the search closes any dropdown, and opening a dropdown closes the search
  click(t, regBtn); click(t, desktopLupa(t)); assert.equal(ddOpen(t, 'regioes'), false); assert.equal(t.q('#o-nav-search').hidden, false);
  click(t, demBtn); assert.equal(t.q('#o-nav-search').hidden, true, 'a dropdown and the search are never open together');
});

test('keyboard: ArrowDown opens and focuses the first link; arrows/Home/End move inside; leaving the panel with Tab closes it; the panel scrolls internally', async () => {
  const t = setup({ config: cfg(['A'], Array.from({ length: 30 }, (_, i) => 'Cat ' + (i + 1))) }); await tick(300);
  const btn = dd(t, 'demais').querySelector('button'); const panel = dd(t, 'demais').querySelector('.o-dd-panel'); const items = [...panel.querySelectorAll('a')];
  key(t, btn, 'ArrowDown');
  assert.equal(ddOpen(t, 'demais'), true); assert.equal(t.doc.activeElement, items[0]);
  key(t, panel, 'ArrowDown'); assert.equal(t.doc.activeElement, items[1]);
  key(t, panel, 'End'); assert.equal(t.doc.activeElement, items[29]);
  key(t, panel, 'ArrowDown'); assert.equal(t.doc.activeElement, items[0], 'wraps');
  key(t, panel, 'ArrowUp'); assert.equal(t.doc.activeElement, items[29], 'wraps back');
  key(t, panel, 'Home'); assert.equal(t.doc.activeElement, items[0]);
  dd(t, 'demais').dispatchEvent(new t.w.FocusEvent('focusout', { bubbles: true, relatedTarget: t.q('.o-nav-logo') }));
  assert.equal(ddOpen(t, 'demais'), false, 'Tab out of the panel closes it');
  assert.match(t.q('style[data-origens-nav]').textContent, /\.o-dd-panel\{[^}]*max-height:min\(70vh,440px\);overflow-y:auto/, 'a long list scrolls inside the panel');
});

test('without width for everything only the PRESENTATION changes: one compact Menu holds Regiões, Coleções and Demais categorias; the CMS groups are untouched', async () => {
  const t = setup({ overflow: true }); await tick(300);
  const desk = t.q('[data-origens-nav="desktop"]');
  assert.ok(desk.hasAttribute('data-compact'), 'compact when the links do not fit');
  const menu = t.q('[data-origens-nav="desktop"] .o-nav-compact [data-dd="menu"] .o-dd-panel');
  assert.deepEqual(texts(menu.querySelectorAll('.o-dd-h')), ['Regiões', 'Coleções', 'Demais categorias']);
  assert.equal(menu.querySelectorAll('a').length, 4 + 3 + 4, 'states + Ver estados, all Topo, all Demais');
  // the data is intact: the full layout still carries every Topo link and the dropdown, and nothing moved between groups
  assert.equal(t.all('.o-nav-full > a').length, 3); assert.equal(dd(t, 'demais').querySelectorAll('a').length, 4);
  assert.match(t.q('style[data-origens-nav]').textContent, /\[data-compact\] \.o-nav-full\{display:none\}/);
  t.w.__overflow = false; t.w.dispatchEvent(new t.w.Event('resize')); await tick(260);
  assert.equal(desk.hasAttribute('data-compact'), false, 'back to the full layout when it fits again');
});

test('the search is closed by default; the lupa opens ONE text field (compact anchored panel) and focuses it; Escape closes it and gives the focus back', async () => {
  const t = setup(); await tick(300);
  const form = t.q('#o-nav-search'); const input = t.q('#o-nav-q');
  assert.equal(form.hidden, true); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'false');
  assert.equal(t.all('input[type="search"][name="q"]').length, 1, 'a single field of ours');
  click(t, desktopLupa(t));
  assert.equal(form.hidden, false); assert.equal(t.doc.activeElement, input); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'true');
  assert.equal(input.getAttribute('enterkeyhint'), 'search'); assert.equal(input.getAttribute('autocomplete'), 'off'); assert.equal(input.getAttribute('placeholder'), 'Buscar cidade, estampa ou coleção');
  assert.equal(t.q('label[for="o-nav-q"]').textContent, 'Buscar produtos'); assert.equal(t.q('.o-nav-go').textContent, 'Buscar');
  const css = t.q('style[data-origens-nav]').textContent;
  assert.match(css, /\[data-origens-nav="search"\]\{position:absolute;top:100%/, 'anchored below the header: it does not push the page nor add an empty strip');
  key(t, input, 'Escape');
  assert.equal(form.hidden, true); assert.equal(desktopLupa(t).getAttribute('aria-expanded'), 'false'); assert.equal(t.doc.activeElement, desktopLupa(t));
});

test('typing, opening and closing without submitting: no request, no cart snapshot, no navigation', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  const before = t.fetches.length;
  click(t, mobileLupa(t)); await tick(50);
  for (const text of ['c', 'ch', 'chi', 'chimarrão']) type(t, text);
  await tick(700);
  click(t, t.q('#o-nav-q'));
  key(t, t.q('#o-nav-q'), 'Escape');
  click(t, mobileLupa(t)); type(t, ''); click(t, mobileLupa(t));
  click(t, dd(t, 'regioes').querySelector('button')); click(t, dd(t, 'regioes').querySelector('button'));
  click(t, t.q('.o-acc-btn')); click(t, t.q('.o-acc-btn'));
  await tick(300);
  assert.equal(t.fetches.length, before, 'zero requests after mount (menus, accordions and search are all local)');
  assert.equal(t.posts().length, 0); assert.equal(t.navs.length + t.navigations.length, 0);
});

test('Enter goes to /sul/busca?q=<encoded text> on the storefront (accents and symbols encoded, spaces collapsed, max 80)', async () => {
  const t = setup(); await tick(300);
  click(t, desktopLupa(t)); type(t, '  Florianópolis  ');
  enter(t); await tick(80);
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/busca?q=Florian%C3%B3polis']);
  type(t, 'a&b=c #x  y'); enter(t); await tick(80);
  assert.equal(new URL(t.navigations[1]).searchParams.get('q'), 'a&b=c #x y'); assert.equal(new URL(t.navigations[1]).hash, '');
  type(t, 'x'.repeat(200)); enter(t); await tick(80);
  assert.equal(new URL(t.navigations[2]).searchParams.get('q').length, 80);
});

test('the "Buscar" button and the lupa (open, with text) submit too; with an empty field neither navigates and the focus returns', async () => {
  const t = setup(); await tick(300);
  click(t, desktopLupa(t));
  const go = t.q('.o-nav-go');
  assert.equal(go.hasAttribute('href'), false, 'no href, no navigation, for an empty query');
  click(t, go); assert.equal(t.navigations.length + t.navs.length, 0); assert.equal(t.doc.activeElement, t.q('#o-nav-q'));
  type(t, '   '); assert.equal(go.hasAttribute('href'), false, 'whitespace only');
  enter(t); assert.equal(t.navigations.length, 0); assert.equal(t.doc.activeElement, t.q('#o-nav-q'));
  click(t, desktopLupa(t)); assert.equal(t.q('#o-nav-search').hidden, true);
  click(t, desktopLupa(t)); type(t, 'chimarrao'); click(t, go); await tick(60);
  assert.equal(new URL(t.navigations[0]).searchParams.get('q'), 'chimarrao');
  click(t, desktopLupa(t)); await tick(60);
  assert.equal(t.navigations.length, 2);
});

test('with a non-empty cart, Enter waits for ONE snapshot and navigates with cart_ref AND q; nothing was written while typing', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  click(t, desktopLupa(t)); type(t, 'gramado'); await tick(500);
  assert.equal(t.posts().length, 0);
  enter(t); await tick(250);
  assert.equal(t.posts().length, 1); assert.equal(t.posts()[0].credentials, 'omit');
  const dest = new URL(t.navs.at(-1));
  assert.equal(dest.origin + dest.pathname, 'https://useorigens.com.br/sul/busca'); assert.equal(dest.searchParams.get('q'), 'gramado'); assert.equal(dest.searchParams.get('cart_ref'), REF);
  assert.ok(!/Serra|109|Preta/.test(dest.href), 'no raw cart data in any URL');
});

test('logo, Cidades and the Regiões links leave through the cart bridge (one snapshot, the token reused while the cart is unchanged); collections and account links do not', async () => {
  const t = setup({ features: WITH_MIRROR, cart: cartHtml }); await tick(300);
  click(t, t.q('[data-origens-nav="desktop"] .o-nav-logo')); await tick(250);
  assert.equal(t.posts().length, 1); assert.equal(new URL(t.navs.at(-1)).searchParams.get('cart_ref'), REF);
  click(t, dd(t, 'regioes').querySelector('button')); click(t, dd(t, 'regioes').querySelector('a'));
  click(t, t.q('.o-nav-links > a[href^="https://useorigens.com.br"]'));
  await tick(200);
  assert.equal(t.posts().length, 1, 'same cart => same token');
  assert.equal(t.navigations.length, 2);
  for (const href of t.navigations) assert.equal(new URL(href).searchParams.get('cart_ref'), REF);
  assert.equal(new URL(t.navigations[0]).pathname, '/sul/pr');
  // INK-side links never get a token
  const before = t.navigations.length;
  click(t, t.q('.o-nav-full > a[href^="/usesul/collections/"]')); click(t, t.q('a[href="/usesul/orders"]'));
  assert.equal(t.navigations.length, before + 2);
  for (const href of t.navigations.slice(before)) assert.equal(new URL(href).searchParams.has('cart_ref'), false);
  assert.equal(t.posts().length, 1);
});

test('an empty cart writes nothing; a failing snapshot still navigates (search keeps working) without a token; without cart-mirror the links are plain', async () => {
  const empty = setup({ features: WITH_MIRROR, cart: EMPTY_CART }); await tick(300);
  click(empty, desktopLupa(empty)); type(empty, 'gramado'); enter(empty); await tick(100);
  assert.equal(empty.posts().length, 0); assert.equal(empty.navigations[0], 'https://useorigens.com.br/sul/busca?q=gramado');
  const failing = setup({ features: WITH_MIRROR, cart: cartHtml, fetchImpl: (url) => (url.includes('cart-ref') ? json({ error: 'unavailable' }, 503) : json(CONFIG)) }); await tick(300);
  click(failing, desktopLupa(failing)); type(failing, 'gramado'); enter(failing); await tick(300);
  const dest = new URL(failing.navs.at(-1));
  assert.equal(dest.searchParams.get('q'), 'gramado'); assert.equal(dest.searchParams.has('cart_ref'), false);
  const plain = setup({ cart: cartHtml }); await tick(300);
  click(plain, desktopLupa(plain)); type(plain, 'gramado'); enter(plain); await tick(80);
  assert.equal(plain.posts().length, 0); assert.deepEqual(plain.navigations, ['https://useorigens.com.br/sul/busca?q=gramado']);
});

test('mobile drawer: Cidades CTA first, Regiões accordion (closed), ALL Topo links, Demais categorias accordion (closed by default) with all its links', async () => {
  const t = setup(); await tick(300);
  const menu = t.q('[data-origens-nav="menu"]');
  assert.equal(menu.parentElement.id, 'navbar-list-mobile'); assert.equal(menu, menu.parentElement.firstElementChild, 'first thing in the native side menu');
  const kids = [...menu.children];
  assert.equal(kids[0].textContent, 'Encontrar minha cidade'); assert.equal(kids[0].getAttribute('href'), 'https://useorigens.com.br/sul#estados'); assert.match(kids[0].className, /o-cta/);
  assert.equal(kids[1].querySelector('button').textContent.trim(), 'Regiões'); assert.equal(kids[1].querySelector('button').getAttribute('aria-expanded'), 'false'); assert.equal(kids[1].querySelector('.o-acc-list').hidden, true);
  assert.equal(kids[2].textContent, 'Coleções');
  assert.deepEqual(texts(kids.slice(3, 6)), ['Novidades', 'Do Nosso Jeito', 'Feito Para Você']);
  const demais = kids[6];
  assert.equal(demais.querySelector('button').textContent.trim(), 'Demais categorias'); assert.equal(demais.querySelector('.o-acc-list').hidden, true, 'closed by default');
  assert.deepEqual(texts(demais.querySelectorAll('.o-acc-list a')), ['Seu Lugar', 'Fala Daqui', 'Da Nossa Terra', 'Kits']);
  assert.deepEqual(texts(kids[1].querySelectorAll('.o-acc-list a')), ['Paraná', 'Santa Catarina', 'Rio Grande do Sul', 'Ver estados']);
  const btn = demais.querySelector('button'); const list = demais.querySelector('.o-acc-list');
  click(t, btn); assert.equal(list.hidden, false); assert.equal(btn.getAttribute('aria-expanded'), 'true');
  click(t, btn); assert.equal(list.hidden, true); assert.equal(btn.getAttribute('aria-expanded'), 'false');
  const css = t.q('style[data-origens-nav]').textContent;
  assert.match(css, /a\.o-cta\{[^}]*min-height:48px/); assert.match(css, /\.o-acc-btn\{[^}]*min-height:44px/, 'touch targets of at least 44 px');
});

test('mobile drawer: the native Loja/Produtos/Categorias entries are hidden, but Sobre and the whole account/support block stay (logged-out: Entrar, Rastreio, Trocar pedido, Avaliar meu pedido, WhatsApp)', async () => {
  const before = setup(); const nativeHtml = before.q('#navbar-list-mobile > section.absolute').outerHTML;
  const t = setup(); await tick(300);
  const css = t.q('style[data-origens-nav]').textContent;
  assert.match(css, /li:has\(> a\[href="\/usesul"\]\)/); assert.match(css, /li\[data-drawer-target="product-sidebar"\]/); assert.match(css, /li\[data-drawer-target="collection-sidebar"\]/);
  assert.ok(t.q('#navbar-list-mobile a[href="/usesul/about"]'), 'Sobre is not hidden by any rule of ours');
  assert.doesNotMatch(css, /about/);
  const account = t.q('#navbar-list-mobile > section.absolute');
  assert.equal(account.outerHTML, nativeHtml, 'the native account block is byte-identical: nothing is removed, edited or hidden by attribute');
  assert.deepEqual(texts(account.querySelectorAll('a')).map((s) => s.replace(/\s+/g, ' ')), ['Entrar', 'Rastreio', 'Trocar pedido', 'Avaliar meu pedido', 'Fale pelo Whatsapp']);
  assert.match(css, /#navbar-list-mobile > section\.absolute\{position:static!important/, 'the absolute block joins the flow: the menu scrolls as a whole and the block stays reachable');
  assert.equal(t.all('[data-origens-hide]').length, 0);
});

test('logged in: Meus pedidos and Sair are preserved and the greeting stays; a Dashboard WITHOUT a destination is hidden; with a real destination it stays', async () => {
  const t = setup({ header: HEADER_IN }); await tick(300);
  const account = t.q('#navbar-list-mobile > section.absolute');
  const dash = [...account.querySelectorAll('li')].find((li) => /Dashboard/.test(li.textContent));
  assert.ok(dash.hasAttribute('data-origens-hide'), 'no destination (href="#"): out of sight, not removed');
  for (const label of ['Meus pedidos', 'Sair']) { const li = [...account.querySelectorAll('li')].find((x) => x.textContent.trim() === label); assert.ok(li, label); assert.equal(li.hasAttribute('data-origens-hide'), false, label + ' stays'); }
  assert.match(account.textContent, /Olá, Maria da Silva Sauro Comprida/, 'the (long) greeting stays; the native `truncate` class handles the overflow');
  assert.match(t.q('style[data-origens-nav]').textContent, /\[data-origens-hide\]\{display:none!important\}/);
  const real = setup({ header: HEADER_IN.replace('href="#" class="truncate">Dashboard', 'href="/usesul/dashboard" class="truncate">Dashboard') }); await tick(300);
  assert.equal(real.all('[data-origens-hide]').length, 0, 'a Dashboard that has a destination is not touched');
  // teardown gives it back
  t.w.history.pushState({}, '', '/usesul'); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  assert.equal(t.all('[data-origens-hide]').length, 0); assert.equal(t.all('[data-origens-nav]').length, 0);
});

test('opening the search closes an open native side menu, and opening the menu closes the search (never both)', async () => {
  const t = setup(); await tick(300);
  const burger = t.q('#menu-hamburger'); let burgerClicks = 0;
  burger.addEventListener('click', () => { burgerClicks++; burger.setAttribute('aria-expanded', burger.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); });
  burger.setAttribute('aria-expanded', 'true');
  click(t, mobileLupa(t));
  assert.equal(burgerClicks, 1); assert.equal(burger.getAttribute('aria-expanded'), 'false'); assert.equal(t.q('#o-nav-search').hidden, false);
  click(t, burger);
  assert.equal(t.q('#o-nav-search').hidden, true); assert.equal(burgerClicks, 2);
});

test('config unavailable (503), invalid (old v1, bad slug, overlap, too many, foreign state path) or absent: NOTHING is mounted, the native header is intact, and there is no retry loop', async () => {
  const bad = [
    () => json({ error: 'unavailable' }, 503),
    () => json({ v: 1, collections: [{ name: 'X', slug: 'x' }] }),
    () => json({ ...CONFIG, top: [{ id: 1, title: 'X', slug: '../evil', order: 1 }] }),
    () => json({ ...CONFIG, top: entries(['Kits']), more: entries(['Kits']) }),
    () => json({ ...CONFIG, top: entries(Array.from({ length: 61 }, (_, i) => 'C' + i)) }),
    () => json({ ...CONFIG, states: [{ uf: 'PR', name: 'Paraná', path: 'https://evil.example/pr' }] }),
    () => { throw new Error('offline'); }
  ];
  for (const fetchImpl of bad) {
    const t = setup({ fetchImpl }); await tick(500);
    assert.equal(t.all('[data-origens-nav]').length, 0);
    assert.ok(t.q('ul.navbar-list') && t.q('a.brand') && t.q('#mobile_search'));
    t.doc.body.appendChild(t.doc.createElement('div')); await tick(300);
    assert.equal(t.navFetches().length, 1, 'a single attempt per page load');
  }
});

test('an unknown header structure mounts nothing and does not throw', async () => {
  const t = setup({ header: '<header><nav class="x"><a href="/">home</a></nav></header>' }); await tick(400);
  assert.equal(t.all('[data-origens-nav]').length, 0);
  const none = setup({ header: '' }); await tick(400);
  assert.equal(none.all('[data-origens-nav]').length, 0);
});

test('idempotent and Turbo-safe: repeated syncs keep exactly one header; a fresh native header after a body swap is rebuilt once; a non-product page removes everything', async () => {
  const t = setup(); await tick(300);
  for (let i = 0; i < 5; i++) { t.doc.body.appendChild(t.doc.createElement('i')); await tick(70); }
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-nav-search').length, 1); assert.equal(t.all('[data-origens-nav="menu"]').length, 1);
  t.q('header').outerHTML = HEADER; await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1); assert.equal(t.all('#o-nav-search').length, 1); assert.equal(t.all('style[data-origens-nav]').length, 1); assert.equal(t.all('[data-dd]').length, 3 + 0, 'Regiões, Demais categorias and the compact Menu: once each');
  assert.equal(t.navFetches().length, 1, 'config kept in memory across body swaps');
  t.w.history.pushState({}, '', '/usesul'); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  assert.equal(t.all('[data-origens-nav]').length, 0);
  t.w.history.pushState({}, '', PATH); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(300);
  assert.equal(t.all('[data-origens-nav="desktop"]').length, 1, 'back on the product page it mounts again');
});

test('the config is cached for the session (v2 key): a second page load inside the window does not fetch it again; an expired entry is refetched', async () => {
  const first = setup(); await tick(300);
  const stored = { 'origens:nav:v2': first.w.sessionStorage.getItem('origens:nav:v2') };
  assert.ok(stored['origens:nav:v2']);
  const second = setup({ carry: stored }); await tick(300);
  assert.equal(second.navFetches().length, 0); assert.ok(second.q('[data-origens-nav="desktop"]'));
  const stale = JSON.parse(stored['origens:nav:v2']); stale.at = Date.now() - 10 * 60 * 1000;
  const third = setup({ carry: { 'origens:nav:v2': JSON.stringify(stale) } }); await tick(300);
  assert.equal(third.navFetches().length, 1);
  const old = setup({ carry: { 'origens:nav:v1': stored['origens:nav:v2'] } }); await tick(300);
  assert.equal(old.navFetches().length, 1, 'an entry from the old contract is never read');
});

test('not mounted at all on a page the loader does not cover (allowlist mode, other path)', async () => {
  const t = setup({ path: '/usesul/product/outro-produto', help: HELP }); await tick(400);
  assert.equal(t.all('[data-origens-nav]').length, 0); assert.equal(t.navFetches().length, 0); assert.equal(t.q('#o-wa-fab'), null);
});

test('coexists with product-discovery: the geographic "Buscar cidade ou estado" block is still separate and unchanged', async () => {
  const t = setup({ features: ALL }); await tick(600);
  assert.ok(t.q('[data-origens-nav="desktop"]'));
  const block = t.q('[data-origens-discovery="product"]');
  if (block) assert.equal(block.querySelector('.o-toggle').textContent, 'Buscar cidade ou estado');
  assert.equal(t.all('#o-nav-q').length, 1);
});

// ── FAB de WhatsApp ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function stubHelpRect(t, rect = { top: 700, right: 1260, bottom: 748, left: 1132, width: 128, height: 48 }) {
  const help = t.q('[data-controller~="ink-store--help-button"]');
  help.getBoundingClientRect = () => rect;
  Object.defineProperty(t.w, 'innerWidth', { configurable: true, value: 1280 }); Object.defineProperty(t.w, 'innerHeight', { configurable: true, value: 800 });
  return help;
}
const settle = async (t) => { t.doc.body.appendChild(t.doc.createElement('i')); await tick(200); };

test('WhatsApp FAB: a green link ABOVE the native Ajuda, to the WhatsApp destination the INK itself publishes (phone and message kept), safe attributes, 52 px target', async () => {
  const t = setup({ help: HELP }); stubHelpRect(t); await settle(t);
  const fab = t.q('#o-wa-fab');
  assert.ok(fab); assert.equal(t.all('#o-wa-fab').length, 1);
  assert.equal(fab.getAttribute('href'), WA); assert.equal(fab.getAttribute('target'), '_blank'); assert.equal(fab.getAttribute('rel'), 'noopener noreferrer'); assert.equal(fab.getAttribute('aria-label'), 'Falar pelo WhatsApp');
  assert.equal(fab.style.position, 'fixed'); assert.equal(fab.style.width, '52px'); assert.equal(fab.style.height, '52px'); assert.match(fab.style.background, /#25d366|rgb\(37, 211, 102\)/);
  assert.equal(fab.style.bottom, '112px', 'Ajuda top (700) -> 800 - 700 + a 12 px gap'); assert.equal(fab.style.right, '58px', 'centered over the 128 px Ajuda that ends 20 px from the edge');
  assert.ok(Number(fab.style.zIndex) < 30, 'never above the native Ajuda (z-30)');
  assert.ok(fab.querySelector('svg'), 'recognizable icon');
  const help = t.q('[data-controller~="ink-store--help-button"]');
  assert.ok(help.querySelector('#dropdownLinksListButton') && help.querySelector('[data-ink-store--help-button-target="linksList"]').children.length === 3, 'the native Ajuda and its list are untouched');
  assert.equal(new t.w.URL(fab.href).hostname, 'api.whatsapp.com');
});

test('WhatsApp FAB: the Ajuda still works (its click is not intercepted) and our FAB steps aside while the Ajuda list is open', async () => {
  const t = setup({ help: HELP }); stubHelpRect(t); await settle(t);
  const button = t.q('#dropdownLinksListButton'); let helpClicks = 0; let prevented = null;
  t.doc.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#dropdownLinksListButton')) { helpClicks++; prevented = e.defaultPrevented; } });
  const ev = click(t, button); assert.equal(helpClicks, 1); assert.equal(prevented, false); assert.equal(ev.defaultPrevented, true === false);
  assert.notEqual(t.q('#o-wa-fab').style.display, 'none');
  t.q('[data-ink-store--help-button-target="linksList"]').classList.remove('hidden'); // the INK's Stimulus controller opens its list
  click(t, button); await tick(150);
  assert.equal(t.q('#o-wa-fab').hidden, true); assert.equal(t.q('#o-wa-fab').style.display, 'none');
  t.q('[data-ink-store--help-button-target="linksList"]').classList.add('hidden'); click(t, button); await tick(150);
  assert.equal(t.q('#o-wa-fab').hidden, false);
});

test('WhatsApp FAB: hidden (never the native controls) while the cart drawer, the post-add modal, the side menu or the virtual keyboard need the space, or when a fixed bar would be covered', async () => {
  const t = setup({ help: HELP, cart: '<div class="cart-drawer"></div>' }); stubHelpRect(t); await settle(t);
  const fab = () => t.q('#o-wa-fab'); const visible = () => !fab().hidden && fab().style.display !== 'none';
  assert.equal(visible(), true);
  const drawer = t.q('.cart-drawer'); drawer.classList.add('open'); click(t, t.doc.body); await tick(150); assert.equal(visible(), false, 'cart drawer open'); drawer.classList.remove('open'); click(t, t.doc.body); await tick(150); assert.equal(visible(), true);
  const modal = t.doc.createElement('div'); modal.id = 'modal-wrapper'; t.doc.body.appendChild(modal); click(t, t.doc.body); await tick(150); assert.equal(visible(), false, 'post-add modal'); modal.remove(); click(t, t.doc.body); await tick(150); assert.equal(visible(), true);
  const burger = t.q('#menu-hamburger'); burger.setAttribute('aria-expanded', 'true'); click(t, t.doc.body); await tick(150); assert.equal(visible(), false, 'mobile menu open'); burger.setAttribute('aria-expanded', 'false'); click(t, t.doc.body); await tick(150); assert.equal(visible(), true);
  const banner = t.doc.createElement('div'); banner.className = 'cookie-acceptance'; banner.getBoundingClientRect = () => ({ left: 0, right: 1280, top: 640, bottom: 800, width: 1280, height: 160 }); t.doc.body.appendChild(banner);
  click(t, t.doc.body); await tick(150);
  assert.equal(visible(), true, 'the cookie banner covers the Ajuda column: the FAB stacks ABOVE the banner instead of vanishing'); assert.equal(fab().style.bottom, '172px', 'banner top (640) -> 800 - 640 + 12'); assert.ok(t.q('.cookie-acceptance'), 'the banner is untouched');
  banner.getBoundingClientRect = () => ({ left: 0, right: 600, top: 640, bottom: 800, width: 600, height: 160 }); click(t, t.doc.body); await tick(150);
  assert.equal(fab().style.bottom, '112px', 'a banner that does not touch the Ajuda column changes nothing');
  banner.remove(); click(t, t.doc.body); await tick(150); assert.equal(visible(), true); assert.equal(fab().style.bottom, '112px');
  let bar = t.q('#add-to-cart-mob'); const created = !bar; if (created) { bar = t.doc.createElement('div'); bar.id = 'add-to-cart-mob'; t.doc.body.appendChild(bar); }
  bar.getBoundingClientRect = () => ({ left: 0, right: 1280, top: 660, bottom: 800, width: 1280, height: 140 });
  click(t, t.doc.body); await tick(150); assert.equal(visible(), false, 'a fixed purchase bar in its spot: we recede, it never does');
  bar.getBoundingClientRect = () => ({ left: 0, right: 1280, top: 780, bottom: 800, width: 1280, height: 20 }); click(t, t.doc.body); await tick(150); assert.equal(visible(), true);
  const keyboard = setup({ help: HELP, viewport: 300 }); stubHelpRect(keyboard); await settle(keyboard);
  assert.equal(keyboard.q('#o-wa-fab').style.display, 'none', 'virtual keyboard: the visual viewport is much shorter than the window');
  const low = setup({ help: HELP }); stubHelpRect(low, { top: 20, right: 1260, bottom: 68, left: 1132, width: 128, height: 48 }); await settle(low);
  assert.equal(low.q('#o-wa-fab').style.display, 'none', 'no room above the Ajuda (under the header): hidden');
});

test('WhatsApp FAB: never rendered without the Ajuda or without a valid WhatsApp link from the INK (no invented phone, no other hosts, no http)', async () => {
  const noHelp = setup({ help: '<a class="wpp-floater" href="' + WA + '">wa</a>' }); await settle(noHelp);
  assert.equal(noHelp.q('#o-wa-fab'), null, 'no Ajuda to sit above');
  const noLink = setup({ header: HEADER_NO_WA, help: HELP.replace(/<a href="https:\/\/api\.whatsapp\.com[^>]*>WhatsApp<\/a>/, '') }); stubHelpRect(noLink); await settle(noLink);
  assert.equal(noLink.q('#o-wa-fab'), null, 'no source of truth for the number: nothing is shown');
  for (const bad of ['http://api.whatsapp.com/send?phone=5548988082581', 'https://evil.example/send?phone=5548988082581', 'https://api.whatsapp.com.evil.example/send?phone=1', 'https://user:pw@api.whatsapp.com/send?phone=1', 'javascript:alert(1)']) {
    const t = setup({ header: HEADER_NO_WA, help: HELP.replace(WA, bad) }); stubHelpRect(t); await settle(t);
    assert.equal(t.q('#o-wa-fab'), null, bad);
  }
  const wame = setup({ header: HEADER_NO_WA, help: HELP.replace(WA, 'https://wa.me/5548988082581?text=Oi') }); stubHelpRect(wame); await settle(wame);
  assert.equal(wame.q('#o-wa-fab').getAttribute('href'), 'https://wa.me/5548988082581?text=Oi');
});

test('WhatsApp FAB: works when the navbar config fails (independent), appears late with the Ajuda, is never duplicated across syncs/Turbo, and leaves with the loader', async () => {
  const t = setup({ fetchImpl: () => json({ error: 'unavailable' }, 503) }); await tick(300);
  assert.equal(t.q('#o-wa-fab'), null, 'the Ajuda has not appeared yet');
  t.doc.body.insertAdjacentHTML('beforeend', HELP); stubHelpRect(t); await tick(300); // late arrival
  assert.equal(t.all('#o-wa-fab').length, 1); assert.equal(t.all('[data-origens-nav]').length, 0, 'navbar failed => native header intact, FAB still there');
  for (let i = 0; i < 6; i++) { t.doc.body.appendChild(t.doc.createElement('i')); await tick(70); }
  assert.equal(t.all('#o-wa-fab').length, 1);
  t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(150); assert.equal(t.all('#o-wa-fab').length, 1);
  t.w.history.pushState({}, '', '/usesul'); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  assert.equal(t.all('#o-wa-fab').length, 0, 'not a product page: the FAB is removed with everything of ours');
});

test('WhatsApp FAB: no observers of its own and no request of any kind (only events); the click goes straight to WhatsApp in a new tab', async () => {
  const t = setup({ help: HELP }); stubHelpRect(t); await settle(t);
  const before = t.fetches.length;
  click(t, t.doc.body); t.w.dispatchEvent(new t.w.Event('resize')); t.w.dispatchEvent(new t.w.Event('scroll')); await tick(200);
  assert.equal(t.fetches.length, before, 'no request');
  click(t, t.q('#o-wa-fab')); assert.equal(t.navigations.at(-1), WA, 'a plain link: nothing intercepted, no cart bridge (it leaves for WhatsApp, not the storefront)');
  assert.equal(t.posts().length, 0);
  const full = buildLoaderSource([PATH], NAV_ONLY);
  const src = full.slice(full.indexOf("id: 'whatsapp-fab'"), full.indexOf('function start()')); // só o widget do FAB (o runtime tem o seu próprio observer)
  assert.doesNotMatch(src, /new MutationObserver|new ResizeObserver|new IntersectionObserver|setInterval/, 'the FAB adds no observer or polling');
});
