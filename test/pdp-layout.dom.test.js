import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildLoaderSource } from '../src/loader-source.js';

// A PDP da INK depois de novembro/2026 (fixture sanitizado da página real, sem os nossos blocos): coluna `data-buy-column`; o <form> só guarda os campos
// ocultos, o prazo e os cupons (dentro de .container-form, ACIMA das variações); as escolhas e a barra de compra (quantidade + botão, fixa no celular) moram
// num bloco fora do <form>. Aqui: a ordem do DOM (prazo e cupons depois do botão), o botão "Cupons disponíveis" fechado, as âncoras dos nossos blocos
// (guia, descoberta, recomendações) e o desvio dos flutuantes da barra fixa.
const FIXTURE = readFileSync(new URL('./fixtures/product-page-ink-novo.html', import.meta.url), 'utf8');
const OFFERS = readFileSync(new URL('./fixtures/product-page-offers.html', import.meta.url), 'utf8');
const COUPONS = OFFERS.match(/<turbo-frame id="product_promotions_frame"[^>]*>([\s\S]*?)<\/turbo-frame>\s*<turbo-frame loading="lazy"/)[1];
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/florianopolis-legado-sc';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id) => ({ productId: String(id), title: 'Florianópolis · Feito em ' + id, image: IMG + id + '.webp', price: 109.9, href: HOST + '/usesul/product/feito-em-' + id, reason: 'same-locality:feito-em' });
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ features = ['theme-pdp', 'pdp-cep', 'pdp-coupons'], attr = 'pdp', html = FIXTURE, coupons = true, prepare = null } = {}) {
  if (attr !== null) html = html.replace('<body class="font-poppins">', '<body class="font-poppins" data-origens-theme="' + attr + '">');
  // Os cupons chegam no frame lazy da INK; a marcação real de cupons vem do fixture do prazo/cupons.
  if (coupons) html = html.replace(/(<turbo-frame id="product_promotions_frame"[^>]*>)(<\/turbo-frame>)/, '$1' + COUPONS.replace(/\$/g, '$$$$') + '$2');
  const dom = new JSDOM(html, { url: HOST + PATH, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.IntersectionObserver = class { constructor() {} observe() {} disconnect() {} };
  if (prepare) prepare(w);
  w.eval(buildLoaderSource([], features, 'product-catalog'));
  return { w, doc: w.document };
}
const column = (t) => t.doc.querySelector('[data-buy-column]');
const label = (c) => c.getAttribute('data-ink-labs-anchor') || c.getAttribute('data-testid') || (c.classList.contains('container-form') ? 'prazo+cupons' : c.querySelector('turbo-frame[id^="variant-selection-"]') ? 'escolhas' : c.tagName.toLowerCase() + '.' + c.className.split(' ')[0]);
const order = (t) => [...column(t).children].map(label).filter((l) => !/^(div\.hide|div\.product-data-js|div\.modal|script|div\.o-)/.test(l) && !/^div\.product-data-js/.test(l));

test('a ordem nativa da INK: prazo e cupons ACIMA das escolhas (é isto que o tema corrige)', () => {
  const t = setup({ features: ['return-link'] });
  const o = order(t);
  assert.ok(o.indexOf('prazo+cupons') < o.indexOf('escolhas'), o.join(' > '));
});

test('tema da PDP: prazo e cupons descem para DEPOIS do bloco das escolhas e do botão de compra (o nó inteiro, mesmo pai); desligar devolve', async () => {
  const t = setup();
  const box = t.doc.querySelector('.container-form');
  const form = box.querySelector('form#form-product-3890099');
  await tick();
  const o = order(t);
  assert.ok(o.indexOf('escolhas') < o.indexOf('prazo+cupons'), o.join(' > '));
  assert.equal(o.indexOf('prazo+cupons') - o.indexOf('escolhas'), 1, 'logo depois do botão');
  assert.equal(box.parentElement, column(t), 'mesmo pai');
  assert.ok(box.contains(form) && box.contains(t.doc.getElementById('delivery_estimates_frame')) && box.contains(t.doc.getElementById('product_promotions_frame')), 'o conjunto vai inteiro');
  // Muitas mutações não movem de novo.
  for (let i = 0; i < 20; i++) t.doc.body.appendChild(t.doc.createElement('i'));
  await tick();
  assert.deepEqual(order(t), o);
  // Desligado pelo painel sem trocar o body: tudo volta ao lugar nativo.
  t.doc.body.setAttribute('data-origens-theme', 'cart');
  t.doc.body.appendChild(t.doc.createElement('i'));
  await tick();
  const back = order(t);
  assert.ok(back.indexOf('prazo+cupons') < back.indexOf('escolhas'), back.join(' > '));
});

test('frame da INK carregando (busy): o conjunto NÃO é movido (mover abortaria o pedido); entra na ordem quando o frame termina', async () => {
  const t = setup({ html: FIXTURE.replace('<turbo-frame id="delivery_estimates_frame" complete="">', '<turbo-frame id="delivery_estimates_frame" busy aria-busy="true" src="/usesul/delivery_estimates">') });
  await tick();
  let o = order(t);
  assert.ok(o.indexOf('prazo+cupons') < o.indexOf('escolhas'), 'ainda no lugar nativo: ' + o.join(' > '));
  const f = t.doc.getElementById('delivery_estimates_frame');
  f.removeAttribute('busy'); f.removeAttribute('aria-busy');
  f.appendChild(t.doc.createElement('span'));
  f.setAttribute('complete', '');
  await tick();
  o = order(t);
  assert.ok(o.indexOf('escolhas') < o.indexOf('prazo+cupons'), o.join(' > '));
});

test('cupons: "Cupons disponíveis" entra depois do <form> (dentro do conjunto do prazo), FECHADO; abre as abas no toque; o frame é pedido já', async () => {
  const t = setup({ features: ['theme-pdp', 'pdp-coupons'], html: FIXTURE.replace('<turbo-frame id="product_promotions_frame"', '<turbo-frame id="product_promotions_frame" loading="lazy" src="/usesul/products/3890099/product_promotions"') });
  await tick();
  const frame = t.doc.getElementById('product_promotions_frame');
  assert.equal(frame.getAttribute('loading'), 'eager', 'a INK carrega o frame já, e o botão está na página desde o início');
  const near = t.doc.querySelector('.container-form > .o-cpn-near');
  assert.ok(near, 'dentro do conjunto prazo+cupons');
  assert.equal(near.previousElementSibling.id, 'form-product-3890099', 'logo depois do <form>');
  const toggle = near.querySelector('.o-cpn-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(near.querySelector('#o-cpn-box').hidden, 'fechado por padrão: não ocupa espaço');
  assert.ok(frame.hasAttribute('data-o-cpn-moved'), 'o quadro nativo grande some');
  toggle.click();
  assert.equal(near.querySelector('#o-cpn-box').hidden, false);
  assert.deepEqual([...near.querySelectorAll('.o-cpn-tab')].map((b) => b.textContent.trim()), ['PRIMEIRACOMPRA', 'LEVEMAIS']);
  // O conjunto vai junto quando o tema o leva para baixo do botão.
  const t2 = setup({ features: ['theme-pdp', 'pdp-coupons'] });
  await tick();
  const o = order(t2);
  assert.ok(o.indexOf('escolhas') < o.indexOf('prazo+cupons'));
  assert.ok(t2.doc.querySelector('.container-form > .o-cpn-near'));
});

test('guia da PDP: monta logo depois do prazo e dos cupons (que ficam depois do botão), não acima das variações', async () => {
  const t = setup({ features: ['theme-pdp', 'pdp-guide', 'pdp-cep', 'pdp-coupons'], prepare: (w) => { w.fetch = async () => new Response('{}', { status: 404 }); } });
  await tick(300);
  const guide = t.doc.querySelector('[data-origens-guide]');
  assert.ok(guide, 'o guia monta no DOM novo (a âncora é o bloco das escolhas)');
  const o = order(t);
  const siblings = [...column(t).children];
  const iBox = siblings.indexOf(t.doc.querySelector('.container-form'));
  const iBlock = siblings.findIndex((c) => c.querySelector('turbo-frame[id^="variant-selection-"]'));
  const iGuide = siblings.indexOf(guide);
  assert.ok(iBlock < iBox && iBox < iGuide, 'escolhas, prazo+cupons, guia: ' + [iBlock, iBox, iGuide].join(',') + ' ' + o.join(' > '));
});

test('"Você também pode gostar": sem "Compre junto" monta depois dos detalhes do produto, nunca dentro do conjunto do prazo (acima das variações); com ele, logo depois dele', async () => {
  const fetchOk = (w) => { w.fetch = async () => new Response(JSON.stringify({ items: [item(1), item(2), item(3), item(4)] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const noTogether = FIXTURE.replace(/<section class="buy-together"[\s\S]*?<\/section>/, '');
  assert.ok(!/class="buy-together"/.test(noTogether), 'fixture sem "Compre junto"');
  const a = setup({ features: ['auto-recommendations'], attr: null, html: noTogether, prepare: fetchOk });
  await tick(300);
  const reco = a.doc.querySelector('[data-origens-reco]');
  assert.ok(reco, 'montou');
  assert.ok(!reco.closest('.container-form') && !reco.closest('form'), 'fora do conjunto prazo+cupons e do <form>');
  assert.equal(reco.parentElement, column(a));
  assert.equal(reco.previousElementSibling.getAttribute('data-testid'), 'product-details', 'depois dos detalhes do produto');
  const b = setup({ features: ['auto-recommendations'], attr: null, prepare: fetchOk });
  await tick(300);
  const reco2 = b.doc.querySelector('[data-origens-reco]');
  assert.ok(reco2 && reco2.previousElementSibling.classList.contains('buy-together'), 'com "Compre junto": logo depois dele');
});
