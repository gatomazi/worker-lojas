import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';
import { parseFeatures, FEATURE_NAMES } from '../src/features.js';
import { STORES, withInkDomain } from '../src/stores.js';

// product-wait: a pílula da camiseta em criação nas páginas da INK (jsdom; página de produto REAL da INK como fixture), na loja única do domínio novo
// (loja.useorigens.com.br/useorigens): só lá o cookie compartilhado .useorigens.com.br existe. O relógio do loader anda 50x mais rápido (5 s = 100 ms) para
// provar a consulta a cada 5 s sem esperar; os retângulos que importam (CTA fixo) são simulados por elemento, como no teste do botão de cupons.
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const NEXT = withInkDomain(STORES.sul, 'next').store;
const HOST = 'https://loja.useorigens.com.br';
const PATH = '/useorigens/product/serra-catarinense';
const A = '01JB8Z6Q4M0000000000000001';
const B = '01JB8Z6Q4M0000000000000002';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/42.jpg';
const URL_A = HOST + '/useorigens/product/silva-natal-em-familia-universitario';
const SPEED = 50;
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const job = (id, status, extra = {}) => ({ id, label: id === A ? 'Universitário' : 'Eu vim pela ceia · Infantil', status, url: null, image: null, ...extra });
const READY_A = job(A, 'ready', { url: URL_A, image: IMG });

const windows = [];
after(() => { for (const w of windows) w.close(); });

// `answers`: id -> resposta (objeto = 200 JSON, número = só o status, função = chamada a cada consulta).
function setup({ cookie = A, answers = { [A]: job(A, 'creating') }, url = HOST + PATH, store = NEXT, features = ['product-wait'], width = 390, height = 844, rects = {}, html = PRODUCT, speed = SPEED, hostOnly = false } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  windows.push(w);
  const t = { w, doc: w.document, fetches: [], writes: [], answers, rects, visibility: 'visible' };
  // O que o loader escreve no cookie, cru (os atributos não voltam na leitura); a leitura e a gravação continuam as do jsdom.
  const native = Object.getOwnPropertyDescriptor(w.Document.prototype, 'cookie');
  Object.defineProperty(w.document, 'cookie', { configurable: true, get() { return native.get.call(this); }, set(value) { t.writes.push(value); native.set.call(this, value); } });
  if (cookie !== null) native.set.call(w.document, 'uo_produtos=' + cookie + (hostOnly ? '; Path=/' : '; Domain=.useorigens.com.br; Path=/; Max-Age=86400; SameSite=Lax; Secure'));
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.classList.contains('hidden')) return []; } return [{}]; };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    for (const [selector, r] of Object.entries(t.rects)) if (this.matches(selector)) return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top };
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(w.document.documentElement, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(w.document.documentElement, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => t.visibility });
  w.matchMedia = (q) => ({ matches: /coarse/.test(q) ? width < 640 : false, addEventListener() {}, removeEventListener() {} });
  // Relógio acelerado: esperas longas (consulta, novas tentativas) e Date.now andam juntos.
  const realTimeout = w.setTimeout.bind(w); const start = Date.now();
  w.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 1000 ? ms / speed : ms, ...a);
  w.Date.now = () => start + (Date.now() - start) * speed;
  w.fetch = async (u, options = {}) => {
    t.fetches.push({ url: String(u), credentials: options.credentials, cache: options.cache });
    const id = String(u).startsWith('/__origens/produto/') ? String(u).slice('/__origens/produto/'.length) : null;
    const answer = id ? t.answers[id] : undefined;
    if (answer === undefined) return new Response('nope', { status: 404 });
    if (typeof answer === 'function') { const r = answer(); return typeof r === 'number' ? json({ error: 'x' }, r) : json(r); }
    return typeof answer === 'number' ? json({ error: 'x' }, answer) : json(answer);
  };
  w.eval(buildLoaderSource([new URL(url).pathname], features, 'allowlist', store));
  t.q = (sel) => w.document.querySelector(sel);
  t.all = (sel) => [...w.document.querySelectorAll(sel)];
  t.pill = () => t.q('#o-wait .o-wait-pill');
  t.click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  t.calls = (id) => t.fetches.filter((f) => f.url === '/__origens/produto/' + id).length;
  t.cookie = () => (/(?:^|;\s*)uo_produtos=([^;]*)/.exec(w.document.cookie) || [])[1];
  return t;
}

test('feature: product-wait is a known flag; the bundle only carries the module (and the only cookie code) when it is on; every feature at once still parses', () => {
  assert.ok(FEATURE_NAMES.includes('product-wait'));
  assert.equal(parseFeatures(FEATURE_NAMES.join(',')).status, 'ok');
  const on = buildLoaderSource([PATH], ['product-wait'], 'allowlist', NEXT);
  assert.match(on, /id: 'product-wait'/);
  const off = buildLoaderSource([PATH], FEATURE_NAMES.filter((f) => f !== 'product-wait'), 'product-catalog', NEXT);
  assert.doesNotMatch(off, /id: 'product-wait'|uo_produtos|document\.cookie|__origens\/produto/);
  // Todos os módulos dividem o mesmo escopo: um nome repetido derrubaria o loader inteiro.
  assert.doesNotThrow(() => new Function(buildLoaderSource([], FEATURE_NAMES, 'product-catalog', NEXT)));
});

test('no cookie, only junk in it, or a host outside the shared domain: nothing of ours and no request', async () => {
  for (const opts of [{ cookie: null }, { cookie: 'abc.' + A.toLowerCase() + '.01JB8Z6Q4M000000000000000I' }, { url: 'https://www.usesul.com.br/usesul/product/serra-catarinense', store: STORES.sul }, { url: 'https://www.usesul.com.br/usesul/product/serra-catarinense', store: STORES.sul, hostOnly: true }]) {
    const t = setup(opts);
    await tick();
    assert.equal(t.q('#o-wait'), null, JSON.stringify(opts));
    assert.equal(t.fetches.length, 0, JSON.stringify(opts));
  }
});

test('cookie with a job being made: ONE pill "Criando camiseta…" bottom-centre with the pulsing dot and no shake; the gateway is asked without credentials', async () => {
  const t = setup();
  await tick();
  assert.equal(t.all('#o-wait').length, 1);
  const pill = t.pill();
  assert.equal(pill.querySelector('[data-wait-label]').textContent, 'Criando camiseta…');
  assert.equal(pill.querySelector('.o-wait-dot').hidden, false);
  assert.equal(pill.classList.contains('o-wait-nudge'), false, 'only the ready state shakes');
  assert.equal(pill.getAttribute('data-wait-state'), 'making');
  // Fazendo: a caixa de 28px com as setas girando (28px) e a camiseta de 14px no centro (o WorkingIcon do storefront).
  const working = pill.querySelector('[data-wait-icon="working"].o-wait-working');
  assert.ok(working, 'the turning-arrows box');
  const arrows = working.querySelector('svg.o-wait-arrows');
  assert.deepEqual([arrows.getAttribute('viewBox'), arrows.getAttribute('stroke-width'), arrows.getAttribute('stroke-linecap'), arrows.getAttribute('stroke-linejoin')], ['0 0 24 24', '1.6', 'round', 'round']);
  assert.deepEqual([...arrows.querySelectorAll('path')].map((p) => p.getAttribute('d')), ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5']);
  assert.equal(working.querySelector('svg.o-wait-shirt-sm').getAttribute('stroke-width'), '2.2');
  const pcss = t.q('#o-wait style').textContent;
  assert.ok(pcss.includes('.o-wait-pill .o-wait-working{position:relative;align-items:center;justify-content:center;width:28px;height:28px}'));
  assert.ok(pcss.includes('.o-wait-pill .o-wait-arrows{position:absolute;inset:0;width:28px;height:28px}') && pcss.includes('.o-wait-pill .o-wait-shirt-sm{width:14px;height:14px}'));
  assert.ok(pcss.includes('@keyframes o-wait-spin{to{transform:rotate(360deg)}}'));
  assert.match(pcss, /@media \(prefers-reduced-motion: no-preference\)\{[^@]*\.o-wait-arrows\{animation:o-wait-spin 1\.6s linear infinite\}/, 'turning only without reduced motion');
  assert.equal(pill.style.left, '195px', 'centred on the 390 px screen');
  assert.equal(pill.style.maxWidth, '230px', 'never touching the coupons (left) nor the assistant (right)');
  assert.match(pill.style.bottom, /calc\(16px/);
  assert.deepEqual(t.fetches[0], { url: '/__origens/produto/' + A, credentials: 'omit', cache: 'no-store' });
  const css = t.q('#o-wait style').textContent;
  assert.match(css, /border:2px solid #111827/); assert.match(css, /font-size:14px;font-weight:700/); assert.match(css, /min-height:48px/);
});

test('ready: "Camiseta pronta!" filled with the region colour, with the attention class (pulse + shake on `rotate`, only without reduced motion)', async () => {
  const t = setup({ answers: { [A]: READY_A } });
  await tick();
  const pill = t.pill();
  assert.equal(pill.querySelector('[data-wait-label]').textContent, 'Camiseta pronta!');
  assert.ok(pill.classList.contains('is-ready') && pill.classList.contains('o-wait-nudge'));
  assert.equal(pill.getAttribute('data-wait-state'), 'ready');
  assert.equal(pill.querySelector('.o-wait-dot').hidden, true);
  assert.equal(pill.querySelector('.o-wait-arrows'), null, 'ready: no turning arrows');
  assert.equal(pill.querySelector('[data-wait-icon]').getAttribute('data-wait-icon'), 'shirt');
  assert.equal(pill.querySelectorAll('svg').length, 1, 'the plain shirt icon');
  const css = t.q('#o-wait style').textContent;
  assert.ok(css.includes('.o-wait-pill.is-ready{border-color:#4d543d;background:#4d543d;color:#fff}'), 'the Sul primary colour (stores.js theme)');
  assert.ok(css.includes('@keyframes uo-nudge{0%,70%,100%{rotate:0deg}74%{rotate:-5deg}78%{rotate:5deg}82%{rotate:-3deg}86%{rotate:3deg}90%{rotate:0deg}}'));
  assert.ok(css.includes('@keyframes uo-glow{50%{opacity:.82}}'));
  assert.ok(css.includes('@media (prefers-reduced-motion: no-preference){') && /no-preference\)\{[^@]*\.o-wait-pill\.o-wait-nudge\{animation:uo-nudge 2\.8s ease-in-out infinite,uo-glow 1\.4s ease-in-out infinite\}/.test(css));
  assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion: no-preference\)\{.*?\}\}/, ''), /animation:/, 'no animation outside the no-preference block');
  assert.match(css, /transform:translateX\(-50%\)/, 'the centring is a translate; the shake is `rotate`, so they never fight');
  // Two ready: the count, like the storefront.
  const u = setup({ cookie: A + '.' + B, answers: { [A]: READY_A, [B]: job(B, 'ready', { url: HOST + '/useorigens/product/silva-ceia-infantil' }) } });
  await tick();
  assert.equal(u.pill().querySelector('[data-wait-label]').textContent, '2 camisetas prontas!');
});

test('panel: the label, the four steps with the current one marked, the photo and "Ver minha camiseta" when ready, the notice when it could not be made', async () => {
  const C = '01JB8Z6Q4M0000000000000003';
  const t = setup({ cookie: [A, B, C].join('.'), answers: { [A]: job(A, 'photos'), [B]: job(B, 'ready', { url: URL_A, image: IMG }), [C]: { ...job(C, 'check'), label: 'Lá vem a família' } } });
  await tick();
  t.click(t.pill());
  const panel = t.q('#o-wait-panel');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(t.q('#o-wait-title').textContent, 'Suas camisetas');
  assert.equal(t.pill().getAttribute('aria-expanded'), 'true');
  const [a, b, c] = t.all('#o-wait [data-wait-job]');
  assert.equal(a.querySelector('.o-wait-name').textContent, 'Universitário');
  assert.deepEqual([...a.querySelectorAll('[data-wait-steps] li')].map((li) => [li.getAttribute('data-step'), li.textContent]), [['done', 'Arte com o nome'], ['done', 'Camiseta criada na loja'], ['current', 'Tirando as fotos…'], ['todo', 'Abrindo a sua camiseta']]);
  assert.equal(a.querySelector('[aria-current="step"]').textContent, 'Tirando as fotos…');
  assert.equal(a.querySelector('[data-wait-open]'), null);
  assert.deepEqual([...b.querySelectorAll('[data-wait-steps] li')].map((li) => li.getAttribute('data-step')), ['done', 'done', 'done', 'done'], 'ready = all done');
  assert.equal(b.querySelector('img').getAttribute('src'), IMG);
  assert.equal(b.querySelector('[data-wait-open]').getAttribute('href'), URL_A);
  assert.equal(b.querySelector('[data-wait-open]').textContent, 'Ver minha camiseta');
  assert.equal(c.querySelector('[data-wait-steps]'), null);
  assert.equal(c.querySelector('[data-wait-note]').textContent, 'Não deu para criar agora. A equipe pode mandar o link.');
  for (const item of [a, b, c]) assert.equal(item.querySelector('[data-wait-remove]').textContent, 'Tirar da lista');
  // Fechar, Esc.
  t.click(t.q('[data-wait-close]'));
  assert.equal(t.q('#o-wait-panel'), null);
  assert.equal(t.pill().getAttribute('aria-expanded'), 'false');
  t.click(t.pill());
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(t.q('#o-wait-panel'), null);
});

test('"Tirar da lista" rewrites the shared cookie with the storefront\'s exact attributes; the last one deletes it and everything of ours goes', async () => {
  const t = setup({ cookie: A + '.' + B, answers: { [A]: job(A, 'creating'), [B]: job(B, 'queued') } });
  await tick();
  t.click(t.pill());
  t.click(t.q('#o-wait [data-wait-job="' + A + '"] [data-wait-remove]'));
  assert.deepEqual(t.writes, ['uo_produtos=' + B + '; Domain=.useorigens.com.br; Path=/; Max-Age=86400; SameSite=Lax; Secure']);
  assert.equal(t.cookie(), B);
  assert.deepEqual(t.all('#o-wait [data-wait-job]').map((li) => li.getAttribute('data-wait-job')), [B]);
  assert.equal(t.q('#o-wait-title').textContent, 'Sua camiseta');
  t.click(t.q('#o-wait [data-wait-job="' + B + '"] [data-wait-remove]'));
  assert.equal(t.writes[1], 'uo_produtos=; Domain=.useorigens.com.br; Path=/; Max-Age=0; SameSite=Lax; Secure');
  assert.equal(t.cookie(), undefined, 'deleted');
  assert.equal(t.q('#o-wait'), null);
  const before = t.fetches.length;
  await tick(300);
  assert.equal(t.fetches.length, before, 'nothing left to ask');
});

test('"Ver minha camiseta" takes the id out of the cookie first and lets the link navigate (no preventDefault)', async () => {
  const t = setup({ cookie: A + '.' + B, answers: { [A]: READY_A, [B]: job(B, 'creating') } });
  await tick();
  t.click(t.pill());
  const link = t.q('#o-wait [data-wait-open]');
  // A navegação continua a da página (o Turbo da INK pega o clique no document): o nosso handler nunca a cancela.
  let prevented = null;
  t.doc.addEventListener('click', (e) => { if (e.target === link) prevented = e.defaultPrevented; });
  t.click(link);
  assert.equal(prevented, false);
  assert.equal(t.cookie(), B);
  assert.deepEqual(t.writes, ['uo_produtos=' + B + '; Domain=.useorigens.com.br; Path=/; Max-Age=86400; SameSite=Lax; Secure']);
  await tick();
  assert.equal(t.pill().querySelector('[data-wait-label]').textContent, 'Criando camiseta…', 'the pill follows the one left');
});

test('polling: every 5 s only while the tab is visible, only for the jobs still being made; a finished one is never asked again', async () => {
  let status = 'queued';
  const t = setup({ cookie: A + '.' + B, answers: { [A]: () => job(A, status), [B]: job(B, 'failed') } });
  await tick(90);
  assert.equal(t.calls(A), 1); assert.equal(t.calls(B), 1);
  await tick(230); // ~11 s do loader
  assert.ok(t.calls(A) >= 2 && t.calls(A) <= 4, 'every 5 s: ' + t.calls(A));
  assert.equal(t.calls(B), 1, 'failed = finished');
  t.visibility = 'hidden';
  const hidden = t.calls(A);
  await tick(250);
  assert.equal(t.calls(A), hidden, 'tab hidden = no request');
  t.visibility = 'visible';
  t.doc.dispatchEvent(new t.w.Event('visibilitychange'));
  await tick(30);
  assert.equal(t.calls(A), hidden + 1, 'back in view = asked at once');
  status = 'ready';
  t.answers[A] = READY_A;
  await tick(150);
  const done = t.calls(A);
  assert.equal(t.pill().querySelector('[data-wait-label]').textContent, 'Camiseta pronta!');
  assert.equal(t.pill().querySelector('.o-wait-arrows'), null, 'the arrows go when it is ready');
  await tick(300);
  assert.equal(t.calls(A), done, 'ready = polling stops');
});

test('a 404 (unknown, or the storefront\'s per-visitor limit) or junk never shows a pill nor touches the cookie; the next try waits longer', async () => {
  const t = setup({ answers: { [A]: 404 } });
  await tick(200); // ~10 s do loader: a 1ª tentativa e nenhuma outra antes de 15 s
  assert.equal(t.q('#o-wait'), null);
  assert.equal(t.calls(A), 1);
  assert.deepEqual(t.writes, []);
  assert.equal(t.cookie(), A);
  await tick(400);
  assert.equal(t.calls(A), 2, 'asked again after the 15 s wait, and not a third time before 30 s more');
  const u = setup({ answers: { [A]: { ...job(A, 'creating'), label: '<img src=x onerror=alert(1)>' } } });
  await tick();
  assert.equal(u.q('#o-wait'), null);
  // A known job keeps its last good state when an answer fails.
  const v = setup({ answers: { [A]: job(A, 'creating') } });
  await tick();
  v.answers[A] = 503;
  await tick(150);
  assert.equal(v.pill().querySelector('[data-wait-label]').textContent, 'Criando camiseta…');
});

test('placement: on the phone it rises above INK\'s fixed "Adicionar ao carrinho" bar; hidden with the cart open or over purchase controls', async () => {
  const H = 844;
  const t = setup({ height: H, rects: { '.form-product-options__add-to-cart-mobile': { left: 0, right: 390, top: H - 72, bottom: H }, '#add-to-cart-mob': { left: 16, right: 374, top: H - 64, bottom: H - 12 } } });
  await tick();
  assert.match(t.pill().style.bottom, /calc\(80px/, 'above the bar (72 px) with the 8 px gap');
  assert.equal(t.q('#o-wait').getAttribute('data-wait-hidden'), '');
  t.rects = { '#add-to-cart-desk': { left: 0, right: 390, top: H - 70, bottom: H - 20 } };
  t.w.dispatchEvent(new t.w.Event('scroll'));
  await tick();
  assert.equal(t.pill().hidden, true);
  assert.match(t.q('#o-wait').getAttribute('data-wait-hidden'), /purchase-controls/);
  t.rects = {};
  const drawer = t.doc.createElement('div'); drawer.className = 'cart-drawer open'; t.doc.body.appendChild(drawer);
  t.w.dispatchEvent(new t.w.Event('resize'));
  await tick();
  assert.match(t.q('#o-wait').getAttribute('data-wait-hidden'), /overlay/);
  drawer.remove();
  t.w.dispatchEvent(new t.w.Event('resize'));
  await tick();
  assert.equal(t.pill().hidden, false);
});

test('Turbo: out of scope everything of ours goes; back in scope the pill is back at once from memory, with no extra request inside the 5 s', async () => {
  const t = setup({ speed: 5 }); // 5 s do loader = 1 s aqui
  await tick(90);
  assert.ok(t.pill());
  const asked = t.calls(A);
  assert.equal(asked, 1);
  t.w.history.pushState({}, '', '/useorigens/cart');
  t.w.dispatchEvent(new t.w.Event('popstate'));
  await tick(80);
  assert.equal(t.q('#o-wait'), null);
  t.w.history.pushState({}, '', PATH);
  t.w.dispatchEvent(new t.w.Event('popstate'));
  await tick(100);
  assert.equal(t.pill().querySelector('[data-wait-label]').textContent, 'Criando camiseta…');
  assert.equal(t.calls(A), asked, 'the 5 s cadence holds across navigations');
});
