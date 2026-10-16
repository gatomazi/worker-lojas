import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// theme-ui (theme-pdp / theme-cart) no navegador (jsdom), sobre a PDP real reduzida: miniaturas da galeria, ordem do DOM, barra fixa, Esc no carrinho e,
// sobretudo, o ESTADO EFETIVO: só atua com a feature do deploy E o atributo da página atual (<body data-origens-theme>), e desfaz tudo ao desligar.
const FIXTURE = readFileSync(new URL('./fixtures/product-page-theme.html', import.meta.url), 'utf8');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/florianopolis-legado-sc';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['theme-pdp', 'theme-cart'], attr = 'pdp cart', html = FIXTURE } = {}) {
  if (attr !== null) html = html.replace('<body class="font-poppins">', '<body class="font-poppins" data-origens-theme="' + attr + '">');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  w.HTMLElement.prototype.scrollIntoView = function () { this.ownerDocument.__scrolled = this; };
  const observers = [];
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; this.targets = []; this.alive = true; observers.push(this); } observe(t) { this.targets.push(t); } disconnect() { this.alive = false; } };
  const native = { adds: 0, closes: 0, submits: 0, dots: [] };
  w.document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.add-to-cart-js')) native.adds++;
    if (e.target.id === 'cart-drawer-close') native.closes++;
    if (/^dot-image-\d+$/.test(e.target.id || '')) native.dots.push(e.target.id);
  });
  w.document.addEventListener('submit', (e) => { native.submits++; e.preventDefault(); });
  w.eval(buildLoaderSource([], ['return-link', ...features], 'product-catalog'));
  return { w, doc: w.document, observers, native };
}
const body = (t) => t.doc.body;
const live = (t) => t.observers.filter((o) => o.alive);
const thumbs = (t) => [...t.doc.querySelectorAll('[data-origens-thumbs] .o-thumb')];
const formOrder = (t) => [...t.doc.querySelector('form[id^="form-product-"]').children].filter((e) => e.tagName !== 'INPUT').map((e) => e.id || e.getAttribute('data-controller') || e.className.split(' ')[0]);
const typeOrder = (t) => [...t.doc.querySelector('.form-product-options__select-type').children].map((e) => e.id || (e.querySelector('strong') || {}).textContent);
const NATIVE_FORM = ['flex', 'delivery_estimates_frame', 'product_promotions_frame', 'ink-store--modal', 'product_variants_options_frame'];
const THEMED_FORM = ['flex', 'product_variants_options_frame', 'delivery_estimates_frame', 'product_promotions_frame', 'ink-store--modal'];
// Turbo: troca o <body> inteiro pelo da nova resposta (o <html> e os <link> do <head> continuam).
function turboVisit(t, attr, action = 'advance') {
  t.doc.dispatchEvent(new t.w.CustomEvent('turbo:visit', { detail: { url: HOST + PATH, action } }));
  const next = new JSDOM(FIXTURE).window.document.body;
  const fresh = t.doc.importNode(next, true);
  if (attr !== null) fresh.setAttribute('data-origens-theme', attr);
  t.doc.documentElement.replaceChild(fresh, t.doc.body);
  t.doc.dispatchEvent(new t.w.Event('turbo:render'));
}

test('miniaturas: TODAS as fotos, na ordem nativa, com as mesmas URLs; a atual acompanha aria-current dos pontos; tocar aciona o ponto nativo', async () => {
  const t = setup();
  await tick();
  const list = thumbs(t);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((b) => b.getAttribute('aria-label')), ['Foto 1 de 3', 'Foto 2 de 3', 'Foto 3 de 3']);
  assert.deepEqual(list.map((b) => b.querySelector('img').getAttribute('src')), ['https://img.test/main.webp', 'https://img.test/a2.webp', 'https://img.test/a3.webp']);
  assert.ok(list.every((b) => b.querySelector('img').loading === 'lazy' && b.type === 'button'));
  assert.equal(list[0].getAttribute('aria-current'), 'true');
  assert.ok(body(t).classList.contains('o-thumbs'), 'pontos nativos saem só com a grade montada');
  list[2].click();
  assert.deepEqual(t.native.dots, ['dot-image-2'], 'o ponto NATIVO recebe o clique');
  // A INK move o ponto ativo (miniatura, seta, swipe ou troca de cor): a miniatura acompanha.
  t.doc.getElementById('dot-image-0').setAttribute('aria-current', 'false');
  t.doc.getElementById('dot-image-2').setAttribute('aria-current', 'true');
  await tick(20);
  assert.deepEqual(thumbs(t).map((b) => b.getAttribute('aria-current')), [null, null, 'true']);
  assert.ok(![...t.doc.querySelectorAll('form input[type="radio"]')].some((r) => r.checked), 'navegar por fotos não escolhe variante');
  // A grade fica logo abaixo do carrossel, dentro da seção da galeria.
  assert.equal(t.doc.querySelector('[data-origens-thumbs]').previousElementSibling.getAttribute('data-controller'), 'ink-store--carousel');
});

test('uma foto só = sem grade e sem esconder pontos', async () => {
  const one = FIXTURE.replace(/<li data-ink-store--carousel-target="item"><div id="carousel-item-[23]">.*?<\/li>/g, '').replace(/<li><button id="dot-image-[12]".*?<\/li>/g, '');
  const t = setup({ html: one });
  await tick();
  assert.equal(thumbs(t).length, 0);
  assert.ok(!body(t).classList.contains('o-thumbs'));
});

test('ordem do DOM = ordem visual: prazo, cupom e "Também disponível em" depois do quadro de compra; medidas antes da quantidade; desligar devolve', async () => {
  const t = setup();
  assert.deepEqual(formOrder(t), NATIVE_FORM);
  await tick();
  assert.deepEqual(formOrder(t), THEMED_FORM);
  assert.deepEqual(typeOrder(t).slice(-2), ['o-test-links', 'o-test-qty']);
  // Muitas mutações não movem de novo nem duplicam nada.
  for (let i = 0; i < 20; i++) t.doc.body.appendChild(t.doc.createElement('i'));
  await tick();
  assert.deepEqual(formOrder(t), THEMED_FORM);
  assert.equal(t.doc.querySelectorAll('[data-origens-thumbs]').length, 1);
  // Desligado pelo painel numa página posterior SEM trocar o body (ex.: a INK re-renderiza): o atributo some e tudo volta.
  body(t).setAttribute('data-origens-theme', 'cart');
  body(t).appendChild(t.doc.createElement('i'));
  await tick();
  assert.deepEqual(formOrder(t), NATIVE_FORM, 'blocos de volta ao lugar nativo');
  assert.deepEqual(typeOrder(t).slice(-2), ['o-test-qty', 'o-test-links']);
  assert.equal(thumbs(t).length, 0);
  assert.ok(!body(t).classList.contains('o-thumbs'));
});

test('frame da INK carregando (busy) não é movido — mover abortaria o pedido; é movido quando termina', async () => {
  const t = setup({ html: FIXTURE.replace('<turbo-frame id="delivery_estimates_frame">', '<turbo-frame id="delivery_estimates_frame" busy aria-busy="true" src="/usesul/delivery_estimate">') });
  await tick();
  assert.deepEqual(formOrder(t), ['flex', 'delivery_estimates_frame', 'product_variants_options_frame', 'product_promotions_frame', 'ink-store--modal']);
  // Fim do carregamento como a INK faz: o Turbo tira o busy e TROCA o conteúdo do frame (é a mudança no DOM que faz o runtime remontar).
  const f = t.doc.getElementById('delivery_estimates_frame'); f.removeAttribute('busy'); f.setAttribute('aria-busy', 'false'); f.setAttribute('complete', '');
  f.appendChild(t.doc.createElement('span'));
  await tick();
  assert.deepEqual(formOrder(t), THEMED_FORM);
});

test('REGRESSÃO: feature no deploy NÃO basta — com a PDP desligada no painel (body sem "pdp") nada da PDP atua; o carrinho segue', async () => {
  const t = setup({ attr: 'cart' });
  await tick();
  assert.equal(thumbs(t).length, 0);
  assert.equal(live(t).length, 0, 'sem observadores da PDP');
  assert.deepEqual(formOrder(t), NATIVE_FORM);
  t.doc.querySelector('.form-product-options__add-to-cart-mobile').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  assert.ok(!t.doc.querySelector('.o-need-choice'));
  // Esc do carrinho funciona (carrinho ligado).
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 1);
});

test('REGRESSÃO: uma visita Turbo para uma página com a superfície desligada desmonta tudo, mesmo com o <link> antigo no <head> e a feature no deploy', async () => {
  const t = setup();
  t.doc.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/__origens/theme.css?s=pdp,cart&v=1&c=x" data-origens-theme-css="1">');
  await tick();
  assert.equal(thumbs(t).length, 3);
  assert.equal(live(t).length, 2);
  turboVisit(t, 'cart');
  await tick();
  assert.equal(t.doc.querySelectorAll('[data-origens-thumbs]').length, 0);
  assert.equal(live(t).length, 0, 'observadores desligados');
  assert.ok(!['o-thumbs', 'o-cta-inview', 'o-choosing', 'o-typing'].some((c) => body(t).classList.contains(c)));
  assert.equal(body(t).style.getPropertyValue('--o-gal-top'), '');
  assert.deepEqual(formOrder(t), NATIVE_FORM);
  // E sem nenhum atributo (página que não passou pelo Worker), idem.
  turboVisit(t, null);
  await tick();
  assert.equal(thumbs(t).length, 0);
  // Volta para uma página com tema: remonta UMA vez.
  turboVisit(t, 'pdp cart');
  await tick();
  assert.equal(t.doc.querySelectorAll('[data-origens-thumbs]').length, 1);
  assert.deepEqual(formOrder(t), THEMED_FORM);
  assert.equal(live(t).length, 2);
});

test('REGRESSÃO: voltar pelo cache do Turbo não religa uma superfície que a rede já desligou (vale o último estado vindo da rede)', async () => {
  const t = setup();
  await tick();
  assert.equal(thumbs(t).length, 3);
  turboVisit(t, 'cart'); // nova página, buscada na rede, com a PDP desligada no painel
  await tick();
  assert.equal(thumbs(t).length, 0);
  turboVisit(t, 'pdp cart', 'restore'); // o Turbo restaura do cache a página ANTIGA (body com "pdp")
  await tick();
  assert.equal(body(t).getAttribute('data-origens-theme'), 'cart', 'atributo corrigido para o estado da rede');
  assert.equal(thumbs(t).length, 0);
  assert.deepEqual(formOrder(t), NATIVE_FORM);
  turboVisit(t, 'pdp cart'); // nova busca na rede com a PDP religada: volta
  await tick();
  assert.equal(thumbs(t).length, 3);
});

test('feature ausente no deploy: mesmo com "pdp" na página, nada da PDP; sem nenhuma feature de tema o módulo nem entra no loader', async () => {
  const t = setup({ features: ['theme-cart'], attr: 'pdp cart' });
  await tick();
  assert.equal(thumbs(t).length, 0);
  assert.deepEqual(formOrder(t), NATIVE_FORM);
  assert.ok(!buildLoaderSource([], ['return-link'], 'product-catalog').includes("id: 'theme-ui'"));
});

test('barra fixa: some com o CTA principal à vista e com teclado; toque na barra inerte leva à primeira escolha que falta, sem escolher nada', async () => {
  const t = setup();
  await tick();
  const cta = live(t).find((o) => o.targets.length === 1 && o.targets[0] === t.doc.getElementById('add-to-cart-desk'));
  cta.cb([{ isIntersecting: true }]);
  assert.ok(body(t).classList.contains('o-cta-inview'));
  cta.cb([{ isIntersecting: false }]);
  assert.ok(!body(t).classList.contains('o-cta-inview'));
  const input = t.doc.createElement('input'); input.type = 'text'; t.doc.body.appendChild(input);
  input.dispatchEvent(new t.w.FocusEvent('focusin', { bubbles: true }));
  assert.ok(body(t).classList.contains('o-typing'));
  input.dispatchEvent(new t.w.FocusEvent('focusout', { bubbles: true }));
  assert.ok(!body(t).classList.contains('o-typing'));
  t.doc.querySelector('.form-product-options__add-to-cart-mobile').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
  assert.equal(t.doc.activeElement, t.doc.querySelector('input[name="style"][value="Feminino"]'));
  assert.ok(![...t.doc.querySelectorAll('input[type="radio"]')].some((r) => r.checked));
  assert.equal(t.native.adds, 0); assert.equal(t.native.submits, 0);
});

test('carrinho: Esc fecha pelo "X" nativo e devolve o foco; com o carrinho desligado na página, Esc não faz nada nosso', async () => {
  let t = setup();
  await tick();
  const opener = t.doc.getElementById('shopping-cart-menu-desk');
  opener.focus(); opener.dispatchEvent(new t.w.FocusEvent('focusin', { bubbles: true }));
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 1);
  await tick(400);
  assert.equal(t.doc.activeElement, opener);
  t = setup({ attr: 'pdp' });
  await tick();
  t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(t.native.closes, 0);
});
