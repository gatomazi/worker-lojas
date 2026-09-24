import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource, buildDiscoverySource } from '../src/loader-source.js';

// jsdom: sem layout real. getClientRects é simulado (oculto se o elemento ou um ancestral tem [hidden]/display:none).
// O carregamento do discovery.js sob demanda é simulado avaliando o MESMO código que o Worker serve.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const ALLOWED = '/usesul/product/serra-catarinense';
const OTHER = '/usesul/product/vida-no-sul-estancia-edition';
const HOST = 'https://www.usesul.com.br';
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));

const DRAWER = '<div id="modal-wrapper" class="add-product-modal" role="dialog" aria-modal="true"><div class="relative w-full"><div class="w-full p-4">' +
  '<div class="flex"><h3>Produto adicionado ao carrinho</h3><button id="modal-close-button" data-action="ink-store--product-modal#closeModal"></button></div>' +
  '<div class="flex flex-col add-product-modal__modal-content__footer"><button class="flex checkout-btn"><span>Ver carrinho</span></button><button id="continue-shopping-button"><span>Continuar comprando</span></button></div>' +
  '<turbo-frame id="most_sold_frame"><h3>As mais vendidas</h3></turbo-frame></div></div></div>';
const PAGE = PRODUCT.replace('</main>', '<turbo-frame id="last_added_product"></turbo-frame></main>');

function setup({ path = ALLOWED, features = ['return-link', 'post-add-discovery', 'city-search'], fetchImpl } = {}) {
  const dom = new JSDOM(PAGE, { url: HOST + path, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.style.display === 'none') return []; }
    return [{}];
  };
  const fetchCalls = []; const aborted = [];
  w.fetch = (url, options = {}) => {
    fetchCalls.push({ url: String(url), credentials: options.credentials, headers: options.headers, method: options.method || 'GET' });
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (signal) signal.addEventListener('abort', () => { aborted.push(String(url)); reject(new w.DOMException('aborted', 'AbortError')); });
      (fetchImpl || defaultFetch)(String(url), resolve, reject);
    });
  };
  // discovery.js sob demanda: avalia o código do Worker e dispara onload, como o navegador faria.
  const scriptLoads = [];
  const head = w.document.head; const original = head.appendChild.bind(head);
  head.appendChild = (node) => {
    if (node.tagName === 'SCRIPT' && /discovery\.js/.test(node.src)) {
      scriptLoads.push(node.src);
      original(node);
      queueMicrotask(() => { w.eval(buildDiscoverySource({ search: features.includes('city-search') })); if (node.onload) node.onload(); });
      return node;
    }
    return original(node);
  };
  const navigations = [];
  w.document.addEventListener('click', (event) => { const a = event.target.closest && event.target.closest('a'); if (a && a.href) { navigations.push(a.href); event.preventDefault(); } }, true);
  w.eval(buildLoaderSource([ALLOWED], features));
  return { dom, w, doc: w.document, fetchCalls, aborted, scriptLoads, navigations };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const RESULTS = { results: [
  { type: 'city', name: 'Florianópolis', uf: 'SC', meso: 'Grande Florianópolis', href: 'https://useorigens.com.br/sul/sc/florianopolis' },
  { type: 'state', name: 'Santa Catarina', uf: 'SC', meso: null, href: 'https://useorigens.com.br/sul/sc' }] };
function defaultFetch(url, resolve) { resolve(json(RESULTS)); }

const openDrawer = (doc) => { doc.getElementById('last_added_product').innerHTML = DRAWER; };
const closeDrawer = (doc) => { doc.getElementById('last_added_product').innerHTML = ''; };
const roots = (doc) => doc.querySelectorAll('[data-origens-discovery]').length;
const styles = (doc) => doc.querySelectorAll('style[data-origens-discovery-style]').length;
const type = async (w, input, text) => { input.value = text; input.dispatchEvent(new w.Event('input', { bubbles: true })); };

test('nothing loads before the drawer really opens (lazy module)', async () => {
  const t = setup(); await tick();
  assert.equal(roots(t.doc), 0); assert.equal(t.scriptLoads.length, 0); assert.equal(t.fetchCalls.length, 0);
  assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 1); // return-link segue funcionando
});

test('mounts exactly once AFTER the INK renders the confirmation, between the native buttons and "As mais vendidas"', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc); await tick(300);
  assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1); assert.equal(t.scriptLoads.length, 1);
  const wrapper = t.doc.getElementById('modal-wrapper');
  const root = wrapper.querySelector('[data-origens-discovery]');
  assert.equal(root.previousElementSibling, wrapper.querySelector('.add-product-modal__modal-content__footer'));
  assert.equal(root.nextElementSibling, wrapper.querySelector('#most_sold_frame'));
  assert.equal(root.querySelector('.o-title').textContent, 'Qual é a próxima cidade?');
  assert.equal(root.querySelector('.o-lead').textContent, 'Seu carrinho continua salvo enquanto você procura.');
  const cta = root.querySelector('.o-cta');
  assert.equal(cta.textContent, 'Explorar outras camisetas'); assert.equal(cta.href, 'https://useorigens.com.br/sul');
});

test('native drawer stays untouched: same nodes, same texts, no extra handlers on native buttons, no focus stealing', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc);
  const wrapper = t.doc.getElementById('modal-wrapper');
  const natives = ['.checkout-btn', '#continue-shopping-button', '#modal-close-button'].map((s) => wrapper.querySelector(s));
  const before = natives.map((n) => n.outerHTML);
  let clicks = 0; natives.forEach((n) => n.addEventListener('click', () => clicks++));
  await tick(300);
  assert.deepEqual(natives.map((n) => n.outerHTML), before);
  assert.equal(t.doc.activeElement, t.doc.body); // nada rouba o foco
  natives[0].click(); natives[1].click(); natives[2].click();
  assert.equal(clicks, 3);
  assert.equal(wrapper.querySelector('.checkout-btn span').textContent, 'Ver carrinho');
  assert.equal(wrapper.querySelector('#continue-shopping-button span').textContent, 'Continuar comprando');
});

test('repeated adds / frame re-renders never duplicate the block, styles, script or listeners', async () => {
  const t = setup(); await tick();
  for (let i = 0; i < 4; i++) { openDrawer(t.doc); await tick(300); assert.equal(roots(t.doc), 1, 'round ' + i); assert.equal(styles(t.doc), 1); }
  assert.equal(t.scriptLoads.length, 1);
  assert.equal(t.doc.querySelectorAll('script[data-use-origens-discovery]').length, 1);
  const input = t.doc.querySelector('.o-input');
  await type(t.w, input, 'flor'); await tick(450);
  assert.equal(t.fetchCalls.length, 1); // um único listener: uma única busca
});

test('closing the drawer removes the block and its style; reopening mounts again', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc); await tick(300); assert.equal(roots(t.doc), 1);
  closeDrawer(t.doc); await tick(200);
  assert.equal(roots(t.doc), 0); assert.equal(styles(t.doc), 0);
  openDrawer(t.doc); await tick(300);
  assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1);
});

test('a hidden drawer, an unrelated modal or a drawer without anchors never mounts (silent fallback to native)', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc); await tick(300); t.doc.getElementById('modal-wrapper').setAttribute('hidden', ''); await tick(300);
  assert.equal(roots(t.doc), 0);
  closeDrawer(t.doc);
  t.doc.getElementById('last_added_product').innerHTML = '<div id="modal-wrapper" role="dialog"><h3>Newsletter</h3><button class="checkout-btn">x</button></div>'; await tick(300);
  assert.equal(roots(t.doc), 0);
  t.doc.getElementById('last_added_product').innerHTML = '<div id="modal-wrapper" role="dialog"><h3>Produto adicionado ao carrinho</h3><button class="checkout-btn">Ver carrinho</button></div>'; await tick(300);
  assert.equal(roots(t.doc), 0); // sem âncora segura
  assert.equal(t.doc.querySelectorAll('style[data-origens-discovery-style]').length, 0);
});

test('Turbo: leaving the allowlisted route removes every piece of UI at once and the drawer of another page never gets ours', async () => {
  const t = setup(); await tick();
  openDrawer(t.doc); await tick(300); assert.equal(roots(t.doc), 1);
  const dispatch = (name, detail) => t.doc.dispatchEvent(new t.w.CustomEvent(name, { detail }));
  dispatch('turbo:visit', { url: HOST + OTHER });
  assert.equal(roots(t.doc), 0); assert.equal(styles(t.doc), 0); // imediato, antes do render
  t.w.history.pushState({}, '', OTHER); dispatch('turbo:render'); dispatch('turbo:load'); await tick(200);
  assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 0);
  openDrawer(t.doc); await tick(400);
  assert.equal(roots(t.doc), 0); assert.equal(styles(t.doc), 0); assert.equal(t.doc.querySelectorAll('script[data-use-origens-discovery]').length, 1);
  t.w.history.pushState({}, '', ALLOWED); dispatch('turbo:render'); dispatch('turbo:load'); await tick(300);
  assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 1);
  assert.equal(roots(t.doc), 1); assert.equal(styles(t.doc), 1);
});

test('Turbo: allowed -> not allowed -> allowed keeps the component count 1 -> 0 -> 1 with the drawer open/closed', async () => {
  const t = setup(); await tick();
  const count = () => roots(t.doc) + t.doc.querySelectorAll('#use-origens-return-link').length;
  openDrawer(t.doc); await tick(300); const first = count();
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + OTHER } })); t.w.history.pushState({}, '', OTHER); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  const away = count();
  closeDrawer(t.doc); // a página nova do Turbo traz um <body> sem o drawer aberto
  t.w.history.pushState({}, '', ALLOWED); t.doc.dispatchEvent(new t.w.Event('turbo:load')); await tick(200);
  const back = count(); openDrawer(t.doc); await tick(300);
  assert.deepEqual([first, away, back, count()], [2, 0, 1, 2]);
});

test('a direct load of another product (or the cart) never mounts anything, even with the drawer present', async () => {
  for (const path of [OTHER, '/usesul/cart', '/usesul/checkout', '/usesul', ALLOWED + '/extra']) {
    const t = setup({ path }); openDrawer(t.doc); await tick(400);
    assert.equal(roots(t.doc) + styles(t.doc) + t.scriptLoads.length + t.fetchCalls.length, 0, path);
    assert.equal(t.doc.querySelectorAll('#use-origens-return-link').length, 0, path);
  }
});

test('feature gating: without post-add-discovery nothing drawer-related runs; without city-search there is no field, only the CTA', async () => {
  const off = setup({ features: ['return-link'] }); openDrawer(off.doc); await tick(400);
  assert.equal(roots(off.doc), 0); assert.equal(off.scriptLoads.length, 0);
  const noSearch = setup({ features: ['return-link', 'post-add-discovery'] }); openDrawer(noSearch.doc); await tick(400);
  assert.equal(roots(noSearch.doc), 1);
  assert.equal(noSearch.doc.querySelectorAll('.o-input, .o-list').length, 0);
  assert.equal(noSearch.doc.querySelector('.o-cta').href, 'https://useorigens.com.br/sul');
  assert.equal(noSearch.fetchCalls.length, 0);
});

test('discovery.js failing to load leaves the native drawer alone and does not retry in a loop', async () => {
  const t = setup(); t.doc.head.appendChild = (node) => { if (node.tagName === 'SCRIPT') { t.scriptLoads.push(node.src); queueMicrotask(() => node.onerror && node.onerror()); return node; } return Object.getPrototypeOf(t.doc.head).appendChild.call(t.doc.head, node); };
  await tick(); openDrawer(t.doc); await tick(300); closeDrawer(t.doc); openDrawer(t.doc); await tick(300);
  assert.equal(roots(t.doc), 0); assert.equal(t.scriptLoads.length, 1);
  assert.equal(t.doc.querySelectorAll('.checkout-btn').length, 1);
});

// ---------------- busca no drawer ----------------
async function withDrawer(opts) { const t = setup(opts); await tick(); openDrawer(t.doc); await tick(300); t.input = t.doc.querySelector('.o-input'); return t; }
const items = (doc) => [...doc.querySelectorAll('.o-item')];

test('search: real-shaped results render as TEXT, links are the validated storefront URLs, requests are same-origin without credentials', async () => {
  const t = await withDrawer();
  await type(t.w, t.input, 'flor'); await tick(450);
  assert.equal(t.fetchCalls.length, 1);
  assert.equal(t.fetchCalls[0].url, '/__origens/search?q=flor');
  assert.equal(t.fetchCalls[0].credentials, 'omit');
  assert.deepEqual(Object.keys(t.fetchCalls[0].headers), ['accept']);
  const list = items(t.doc);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((a) => a.getAttribute('href')), ['https://useorigens.com.br/sul/sc/florianopolis', 'https://useorigens.com.br/sul/sc']);
  assert.equal(list[0].querySelector('.o-name').textContent, 'Florianópolis');
  assert.equal(list[0].querySelector('.o-sub').textContent, 'SC · Grande Florianópolis');
  assert.equal(list[1].querySelector('.o-sub').textContent, 'Ver as cidades do estado');
  assert.equal(t.doc.querySelector('.o-status').textContent, '2 resultados.');
  assert.equal(t.input.getAttribute('aria-expanded'), 'true');
});

test('search: hostile data from the gateway never becomes HTML (XSS) nor an unsafe link', async () => {
  const hostile = { results: [
    { type: 'city', name: '<img src=x onerror="window.__xss=1">', uf: 'SC', meso: '<b>x</b>', href: 'https://useorigens.com.br/sul/sc/ok' },
    { type: 'city', name: 'JS', uf: 'SC', meso: '', href: 'javascript:alert(1)' },
    { type: 'city', name: 'Outra origem', uf: 'SC', meso: '', href: 'https://evil.example/sul/sc/x' },
    { type: 'city', name: 'Subdominio', uf: 'SC', meso: '', href: 'https://useorigens.com.br.evil.example/sul/sc/x' },
    { type: 'city', name: 'Query', uf: 'SC', meso: '', href: 'https://useorigens.com.br/sul/sc/x?next=//evil' },
    { type: 'city', name: 'Credenciais', uf: 'SC', meso: '', href: 'https://user:pw@useorigens.com.br/sul/sc/x' },
    { type: 'city', name: 'Fora de /sul', uf: 'SC', meso: '', href: 'https://useorigens.com.br/admin' },
    { type: 'city', name: 'Barra dupla', uf: 'SC', meso: '', href: 'https://useorigens.com.br/sul//evil' },
    { type: 'weird', name: 'Tipo', uf: 'SC', meso: '', href: 'https://useorigens.com.br/sul/sc' },
    { type: 'city', name: 'x'.repeat(61), uf: 'SC', meso: '', href: 'https://useorigens.com.br/sul/sc/longo' },
    { type: 'city', name: 'UF ruim', uf: 'sc', meso: '', href: 'https://useorigens.com.br/sul/sc/uf' }] };
  const t = await withDrawer({ fetchImpl: (u, resolve) => resolve(json(hostile)) });
  await type(t.w, t.input, 'flor'); await tick(450);
  const list = items(t.doc);
  assert.equal(list.length, 1);
  assert.equal(list[0].querySelector('.o-name').textContent, '<img src=x onerror="window.__xss=1">');
  assert.equal(t.doc.querySelectorAll('[data-origens-discovery] img, [data-origens-discovery] b, [data-origens-discovery] script').length, 0);
  assert.equal(t.w.__xss, undefined);
  assert.equal(list[0].getAttribute('href'), 'https://useorigens.com.br/sul/sc/ok');
});

test('search: at most 5 results are ever rendered, even if the gateway sends more', async () => {
  const many = { results: Array.from({ length: 12 }, (_, i) => ({ type: 'city', name: 'Cidade ' + i, uf: 'RS', meso: '', href: 'https://useorigens.com.br/sul/rs/cidade-' + i })) };
  const t = await withDrawer({ fetchImpl: (u, resolve) => resolve(json(many)) });
  await type(t.w, t.input, 'cid'); await tick(450);
  assert.equal(items(t.doc).length, 5);
});

test('search: race condition — a slow old response never overwrites the newer one, and the old request is aborted', async () => {
  const slow = { results: [{ type: 'city', name: 'ANTIGA', uf: 'PR', meso: '', href: 'https://useorigens.com.br/sul/pr/antiga' }] };
  const fast = { results: [{ type: 'city', name: 'NOVA', uf: 'SC', meso: '', href: 'https://useorigens.com.br/sul/sc/nova' }] };
  const t = await withDrawer({ fetchImpl: (url, resolve) => { if (url.endsWith('q=ab')) setTimeout(() => resolve(json(slow)), 900); else resolve(json(fast)); } });
  await type(t.w, t.input, 'ab'); await tick(260);            // dispara a busca lenta
  await type(t.w, t.input, 'abc'); await tick(1200);         // nova digitação: rápida
  assert.deepEqual(items(t.doc).map((a) => a.querySelector('.o-name').textContent), ['NOVA']);
  assert.ok(t.aborted.some((u) => u.includes('q=ab') && !u.includes('q=abc')), 'busca antiga abortada');
});

test('search: typing fast is debounced into a single request', async () => {
  const t = await withDrawer();
  for (const text of ['f', 'fl', 'flo', 'flor']) { await type(t.w, t.input, text); await tick(40); }
  await tick(450);
  assert.equal(t.fetchCalls.length, 1);
  assert.equal(t.fetchCalls[0].url, '/__origens/search?q=flor');
});

test('search: query is sanitized before it leaves the browser; 1 character never searches', async () => {
  const t = await withDrawer();
  await type(t.w, t.input, 'f'); await tick(400); assert.equal(t.fetchCalls.length, 0);
  await type(t.w, t.input, '  <b>São</b> José/?&=  '); await tick(450);
  assert.equal(t.fetchCalls.length, 1);
  assert.equal(new URL(t.fetchCalls[0].url, 'https://x.example').searchParams.get('q'), 'b São b José');
});

test('search: empty state and error state keep the return CTA visible and the drawer usable', async () => {
  const empty = await withDrawer({ fetchImpl: (u, resolve) => resolve(json({ results: [] })) });
  await type(empty.w, empty.input, 'xyzq'); await tick(450);
  assert.match(empty.doc.querySelector('.o-status').textContent, /Ainda não encontramos essa cidade/);
  assert.equal(items(empty.doc).length, 0); assert.equal(empty.input.getAttribute('aria-expanded'), 'false');
  assert.ok(empty.doc.querySelector('.o-cta'));
  for (const impl of [(u, resolve) => resolve(json({ error: 'unavailable' }, 502)), (u, resolve) => resolve(new Response('lixo', { status: 200 })), (u, resolve) => resolve(json({ nao: 'schema' })), (u, resolve, reject) => reject(new Error('rede'))]) {
    const t = await withDrawer({ fetchImpl: impl });
    await type(t.w, t.input, 'flor'); await tick(450);
    assert.match(t.doc.querySelector('.o-status').textContent, /A busca não está disponível agora/);
    assert.ok(t.doc.querySelector('.o-cta')); assert.equal(items(t.doc).length, 0);
    assert.equal(t.doc.querySelectorAll('.checkout-btn').length, 1);
  }
});

test('search: a request that never answers times out (4 s) into the error state', async () => {
  const t = await withDrawer({ fetchImpl: () => {} });
  await type(t.w, t.input, 'flor'); await tick(4700);
  assert.match(t.doc.querySelector('.o-status').textContent, /A busca não está disponível agora/);
  assert.ok(t.aborted.length >= 1);
});

test('search keyboard: arrows move the active option (aria-activedescendant), Enter follows the link, Esc is left to the INK (native close)', async () => {
  const t = await withDrawer();
  await type(t.w, t.input, 'flor'); await tick(450);
  const key = (k) => { const e = new t.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); t.input.dispatchEvent(e); return e; };
  const opts = items(t.doc);
  assert.equal(t.input.getAttribute('aria-activedescendant'), opts[0].id);
  key('ArrowDown'); assert.equal(t.input.getAttribute('aria-activedescendant'), opts[1].id); assert.equal(opts[1].getAttribute('aria-selected'), 'true');
  key('ArrowDown'); assert.equal(t.input.getAttribute('aria-activedescendant'), opts[0].id); // dá a volta
  key('ArrowUp'); assert.equal(t.input.getAttribute('aria-activedescendant'), opts[1].id);
  key('ArrowUp'); key('Enter');
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/sc/florianopolis']);
  let reachedInk = 0; t.doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') reachedInk++; });
  const esc = key('Escape');
  assert.equal(esc.defaultPrevented, false); assert.equal(reachedInk, 1); assert.equal(t.input.value, 'flor'); // nosso código não interfere no Esc
});

test('search: clicking a result or the CTA navigates to the storefront (same session keeps the native cart)', async () => {
  const t = await withDrawer();
  await type(t.w, t.input, 'flor'); await tick(450);
  items(t.doc)[1].click(); t.doc.querySelector('.o-cta').click();
  assert.deepEqual(t.navigations, ['https://useorigens.com.br/sul/sc', 'https://useorigens.com.br/sul']);
});

test('accessibility wiring: labelled region, combobox/listbox roles, live status, 16px input, touch targets >= 44px declared', async () => {
  const t = await withDrawer();
  const root = t.doc.querySelector('[data-origens-discovery]');
  assert.equal(root.getAttribute('aria-labelledby'), root.querySelector('.o-title').id);
  assert.equal(t.doc.querySelector('label[for="' + t.input.id + '"]').textContent, 'Buscar cidade ou estado');
  assert.equal(t.input.getAttribute('role'), 'combobox'); assert.equal(t.input.getAttribute('aria-controls'), t.doc.querySelector('[role=listbox]').id);
  assert.equal(t.doc.querySelector('.o-status').getAttribute('aria-live'), 'polite');
  assert.equal(t.input.getAttribute('placeholder'), 'Busque cidade ou estado');
  const css = t.doc.querySelector('style[data-origens-discovery-style]').textContent;
  assert.match(css, /\.o-input\{[^}]*height:48px[^}]*font-size:16px/);
  assert.match(css, /\.o-item\{[^}]*min-height:44px/); assert.match(css, /\.o-cta\{[^}]*min-height:44px/);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /env\(safe-area-inset-bottom/);
  // todo seletor é escopado à raiz exclusiva (nada global que atinja botões/cards nativos)
  for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) {
    const selector = rule.split('{')[0]; if (selector.startsWith('@media')) continue;
    assert.ok(selector.split(',').every((s) => /^\[data-origens-discovery(\]|=)/.test(s.trim())), selector);
  }
});

test('leaving the route aborts an in-flight search and drops its late response', async () => {
  const t = await withDrawer({ fetchImpl: (u, resolve) => setTimeout(() => resolve(json(RESULTS)), 700) });
  await type(t.w, t.input, 'flor'); await tick(300);
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + OTHER } }));
  t.w.history.pushState({}, '', OTHER);
  await tick(900);
  assert.ok(t.aborted.length >= 1);
  assert.equal(roots(t.doc), 0); assert.equal(items(t.doc).length, 0);
});

test('short screens: result rows are hidden from the end until the native "Ver carrinho" fits (never below 1), and untouched when it fits', async () => {
  const many = { results: Array.from({ length: 5 }, (_, i) => ({ type: 'city', name: 'Cidade ' + i, uf: 'RS', meso: '', href: 'https://useorigens.com.br/sul/rs/cidade-' + i })) };
  const t = await withDrawer({ fetchImpl: (u, resolve) => resolve(json(many)) });
  const ver = t.doc.querySelector('.checkout-btn');
  const shown = () => items(t.doc).filter((a) => !a.hidden).length;
  ver.getBoundingClientRect = () => ({ top: shown() > 2 ? -12 : 30 }); // simula o sheet estourando o topo com mais de 2 linhas
  await type(t.w, t.input, 'cid'); await tick(450);
  assert.equal(items(t.doc).length, 5); assert.equal(shown(), 2);
  ver.getBoundingClientRect = () => ({ top: -100 }); // nunca cabe: mantém 1 linha, não zera
  await type(t.w, t.input, 'cida'); await tick(450);
  assert.equal(shown(), 1);
  ver.getBoundingClientRect = () => ({ top: 10 }); // cabe: nada escondido
  await type(t.w, t.input, 'cidad'); await tick(450);
  assert.equal(shown(), 5);
});

test('compact styles for short viewports are scoped to the exclusive root', async () => {
  const t = await withDrawer();
  const css = t.doc.querySelector('style[data-origens-discovery-style]').textContent;
  assert.match(css, /@media \(max-height:700px\)\{\[data-origens-discovery\]\.o-has-results/);
  await type(t.w, t.input, 'flor'); await tick(450);
  assert.ok(t.doc.querySelector('[data-origens-discovery]').classList.contains('o-has-results'));
  await type(t.w, t.input, ''); await tick(200);
  assert.ok(!t.doc.querySelector('[data-origens-discovery]').classList.contains('o-has-results'));
});
