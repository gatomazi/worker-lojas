import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// assistant: o assistente "Pergunte aqui" nas páginas da INK (jsdom; página de produto REAL da INK como fixture, com o botão nativo "Ajuda?" da INK colado no
// fim do <body>, como a INK o entrega). Sem layout no jsdom: os retângulos não importam aqui (são do promo-fab, testados lá).
const PRODUCT = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const NATIVE_HELP = '<div class="bottom-[70px] lg:bottom-6 fixed z-30 right-5" data-controller="ink-store--help-button"><button id="dropdownLinksListButton" data-ink-store--help-button-target="helpButton">Ajuda?</button><div data-ink-store--help-button-target="linksList" class="hidden"><a href="/usesul/orders/trackings">Status do pedido</a><a href="https://api.whatsapp.com/send?phone=5548988082581">WhatsApp</a></div></div>';
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/serra-catarinense';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/1.jpg';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const OPENING = { v: 1, kind: 'greeting', text: 'Oi! Posso ajudar?', suggestions: ['Tem estampa da minha cidade?', 'Qual é o tecido das camisetas?'] };
const BOOT = { v: 1, enabled: true, opening: OPENING, whatsapp: 'https://wa.me/5548988082581?text=Ol%C3%A1' };
const DESIGNS = { v: 1, kind: 'designs', text: 'Estampas de Florianópolis:', items: [{ title: 'Ponto de Origem & Cia', context: 'Florianópolis · SC', image: IMG, price: 109.9, href: HOST + '/usesul/product/florianopolis-origem', productId: '11' }], links: [{ kind: 'page', label: 'Ver as 8 estampas', href: 'https://useorigens.com.br/sul/sc/florianopolis' }] };

const windows = [];
after(() => { for (const w of windows) w.close(); });

function setup({ boot = BOOT, reply = DESIGNS, width = 390, features = ['assistant'] } = {}) {
  const dom = new JSDOM(PRODUCT.replace('</body>', NATIVE_HELP + '</body>'), { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  windows.push(w);
  const t = { w, doc: w.document, fetches: [] };
  w.HTMLElement.prototype.getClientRects = function () { for (let n = this; n && n.nodeType === 1; n = n.parentElement) { if (n.hasAttribute('hidden') || n.classList.contains('hidden')) return []; } return [{}]; };
  Object.defineProperty(w.document.documentElement, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(w.document.documentElement, 'clientHeight', { configurable: true, get: () => 844 });
  w.matchMedia = (q) => ({ matches: /coarse/.test(q) ? width < 640 : false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (url, options = {}) => {
    t.fetches.push({ url: String(url), method: options.method || 'GET', credentials: options.credentials, body: options.body });
    if (!String(url).startsWith('/__origens/assistente')) return new Response('nope', { status: 404 });
    if ((options.method || 'GET') === 'GET') return typeof boot === 'function' ? boot() : json(boot);
    return typeof reply === 'function' ? reply(JSON.parse(options.body)) : json(reply);
  };
  w.eval(buildLoaderSource([PATH], features, 'allowlist'));
  t.q = (sel) => w.document.querySelector(sel);
  t.all = (sel) => [...w.document.querySelectorAll(sel)];
  t.click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  t.say = (text) => { t.q('[data-assist-input]').value = text; t.q('#o-assist .o-assist-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
  t.posts = () => t.fetches.filter((f) => f.method === 'POST');
  return t;
}

test('on: ONE "Pergunte aqui" button bottom-right; INK\'s own "Ajuda?" (with its WhatsApp) is hidden only while ours is mounted', async () => {
  const t = setup();
  await tick();
  assert.equal(t.all('#o-assist').length, 1);
  assert.equal(t.q('#o-assist [data-assist-label]').textContent, 'Pergunte aqui', 'a storefront that sends no text: the default one');
  assert.match(t.q('#o-assist .o-assist-fab').style.right, /16px/);
  assert.match(t.q('#o-assist style').textContent, /\[data-controller~="ink-store--help-button"\]\{display:none!important\}/);
  assert.ok(t.q('[data-controller~="ink-store--help-button"]'), 'the native node is never removed, only hidden by our style');
  assert.deepEqual(t.fetches.map((f) => [f.method, f.url, f.credentials]), [['GET', '/__origens/assistente?origens_r=sul', 'omit']]);
  // Out of scope (Turbo to the cart): ours goes, and with it the style: INK's own help is back.
  w_navigate(t, '/usesul/cart');
  await tick();
  assert.equal(t.q('#o-assist'), null);
});
function w_navigate(t, path) { t.w.history.pushState({}, '', path); t.w.dispatchEvent(new t.w.Event('popstate')); }

test('off, an error or an invalid boot: nothing of ours, INK\'s "Ajuda?" stays exactly as it was', async () => {
  for (const boot of [{ v: 1, enabled: false }, () => new Response('down', { status: 503 }), { v: 1, enabled: true, opening: { v: 1, kind: 'greeting', text: '<script>' } }]) {
    const t = setup({ boot });
    await tick();
    assert.equal(t.q('#o-assist'), null);
    assert.ok(t.q('[data-controller~="ink-store--help-button"]'));
  }
});

test('open: the opening and its chips, the WhatsApp shortcut in the header; a question shows "digitando" and then the answer, text only', async () => {
  const t = setup();
  await tick();
  t.click(t.q('#o-assist .o-assist-fab'));
  assert.equal(t.q('#o-assist-panel').getAttribute('role'), 'dialog');
  assert.equal(t.q('[data-assist-whatsapp]').getAttribute('href'), 'https://wa.me/5548988082581?text=Ol%C3%A1');
  assert.deepEqual(t.all('#o-assist .o-assist-chip').map((c) => c.textContent), OPENING.suggestions, 'no topics: the opening keeps its chips');
  assert.equal(t.q('[data-assist-topics]'), null);
  t.say('tem de Floripa?');
  await tick(50);
  assert.ok(t.q('[data-assist-typing]'), 'typing indicator while it "types"');
  assert.equal(t.posts().length, 1);
  assert.deepEqual(JSON.parse(t.posts()[0].body), { message: 'tem de Floripa?' });
  assert.equal(t.posts()[0].credentials, 'omit');
  assert.equal(t.q('[data-assist-reply="designs"]'), null, 'never instant');
  await tick(900);
  assert.equal(t.q('[data-assist-typing]'), null);
  const card = t.q('#o-assist .o-assist-card');
  assert.equal(card.getAttribute('href'), HOST + '/usesul/product/florianopolis-origem');
  assert.equal(card.querySelector('.o-assist-t').textContent, 'Ponto de Origem & Cia', 'text, never HTML');
  assert.equal(card.querySelector('.o-assist-p').textContent, 'R$ 109,90');
  assert.equal(t.q('[data-assist-link="page"]').getAttribute('href'), 'https://useorigens.com.br/sul/sc/florianopolis');
});

test('the panel\'s text and fixed topics: the button, the title and the row above the field; a topic is sent as a message, never twice at once', async () => {
  const t = setup({ boot: { ...BOOT, label: 'Fale com a gente', topics: ['Achar estampa', 'Rastrear pedido', 'Trocar pedido', 'Frete e prazo'] } });
  await tick();
  const fab = t.q('#o-assist .o-assist-fab');
  assert.equal(t.q('#o-assist [data-assist-label]').textContent, 'Fale com a gente');
  t.click(fab);
  assert.equal(t.q('#o-assist-title').textContent, 'Fale com a gente');
  assert.equal(t.q('[data-assist-close]').getAttribute('aria-label'), 'Fechar o assistente');
  assert.equal(t.all('#o-assist .o-assist-chip').length, 0, 'the opening\'s chips would repeat the topics: hidden while the row is there');
  const row = t.q('#o-assist-panel [data-assist-topics]');
  assert.equal(row.nextElementSibling, t.q('#o-assist .o-assist-form'), 'right above the field');
  assert.deepEqual(t.all('[data-assist-topic]').map((b) => b.textContent), ['Achar estampa', 'Rastrear pedido', 'Trocar pedido', 'Frete e prazo']);
  t.click(t.all('[data-assist-topic]')[1]);
  await tick(50);
  assert.ok(t.all('[data-assist-topic]').every((b) => b.disabled), 'disabled while the answer "types"');
  t.click(t.all('[data-assist-topic]')[2]);
  await tick(900);
  assert.deepEqual(t.posts().map((p) => JSON.parse(p.body)), [{ message: 'Rastrear pedido' }]);
  assert.equal(t.all('#o-assist .o-assist-me').pop().textContent, 'Rastrear pedido');
  assert.ok(t.all('[data-assist-topic]').every((b) => !b.disabled));
  assert.ok(t.q('[data-assist-topics]'), 'the row stays for the whole conversation');
  t.click(t.q('[data-assist-close]'));
  assert.equal(t.q('#o-assist [data-assist-label]').textContent, 'Fale com a gente', 'closing gives the panel\'s text back');
});

test('the glow: in the region\'s accent until the chat is opened once in the visit; a text or topic out of format falls back alone', async () => {
  const t = setup({ boot: { ...BOOT, label: '<b>oi</b>', topics: ['Rastrear pedido', 'x'.repeat(41), 'Rastrear pedido', 7] } });
  await tick();
  const fab = t.q('#o-assist .o-assist-fab');
  assert.equal(fab.getAttribute('data-glow'), 'pulse');
  assert.match(t.q('#o-assist style').textContent, /0 0 18px 3px #d6ba8d;opacity:\.4/, 'Sul: sand gold, the storefront\'s accent');
  assert.match(t.q('#o-assist style').textContent, /prefers-reduced-motion: reduce\)\{#o-assist \.o-assist-fab\[data-glow\]::before\{animation:none\}/);
  fab.dispatchEvent(new t.w.Event('animationend'));
  assert.equal(fab.getAttribute('data-glow'), 'rest', 'after the breaths, a still halo (showing it again does not restart them)');
  assert.equal(t.q('#o-assist [data-assist-label]').textContent, 'Pergunte aqui');
  t.click(fab);
  assert.equal(fab.hasAttribute('data-glow'), false);
  assert.deepEqual(t.all('[data-assist-topic]').map((b) => b.textContent), ['Rastrear pedido']);
  t.click(t.q('[data-assist-close]'));
  assert.equal(fab.hasAttribute('data-glow'), false, 'opened once: no glow for the rest of the visit');
  assert.equal(t.w.sessionStorage.getItem('origens:assistant:seen'), '1');
});

test('a CPF is never sent; "tem mais?" after designs is answered here with the link to all of them', async () => {
  const t = setup();
  await tick();
  t.click(t.q('#o-assist .o-assist-fab'));
  t.say('meu cpf é 123.456.789-00');
  await tick(1900); // a longer answer "types" longer (up to 1,8 s)
  assert.equal(t.posts().length, 0);
  assert.equal(t.all('#o-assist .o-assist-me').pop().textContent, '••••');
  assert.match(t.q('[data-assist-reply="refuse"] .o-assist-say').textContent, /^Por segurança/);
  t.say('tem de Floripa?');
  await tick(1000);
  t.say('tem mais?');
  await tick(900);
  assert.equal(t.posts().length, 1, 'the follow-up never went to the server');
  const last = t.all('#o-assist [data-assist-reply]').pop();
  assert.equal(last.querySelector('.o-assist-say').textContent, 'Todas estão nesta página:');
  assert.equal(last.querySelector('[data-assist-link]').getAttribute('href'), 'https://useorigens.com.br/sul/sc/florianopolis');
});

test('links outside the store are dropped on the client too (storage and replies are the visitor\'s)', async () => {
  const t = setup({ reply: { v: 1, kind: 'answer', text: 'Veja', links: [{ kind: 'page', label: 'Mal', href: 'https://evil.example/sul' }, { kind: 'orders', label: 'Meus pedidos', href: HOST + '/usesul/orders' }] } });
  await tick();
  t.click(t.q('#o-assist .o-assist-fab'));
  t.say('pedido');
  await tick(900);
  assert.deepEqual(t.all('#o-assist [data-assist-link]').map((a) => a.getAttribute('href')), [HOST + '/usesul/orders']);
});

test('feature off: the bundle does not carry the module', () => {
  assert.match(buildLoaderSource([PATH], ['assistant']), /id: 'assistant'/);
  assert.doesNotMatch(buildLoaderSource([PATH], ['promo-fab']), /id: 'assistant'|__origens\/assistente/);
});
