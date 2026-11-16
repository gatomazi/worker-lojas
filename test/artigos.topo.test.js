import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNavbar } from '../src/navbar-gateway.js';
import { STORES } from '../src/stores.js';
import { BACK_LABEL, STOREFRONT_HOME, desktopNav, esc, logoHtml, menuSections, mobileMenu, topoCss } from '../src/artigos/topo.js';
import { eligiblePath, topoEnabled } from '../src/artigos/escopo.js';

// O payload REAL da vitrine (/api/navbar/sul, público) passa pelo mesmo normalizador da INK: o topo do artigos nunca vê um formato que a INK não veria.
const SITE = normalizeNavbar(JSON.parse(readFileSync(new URL('./fixtures/artigos-navbar-sul.json', import.meta.url), 'utf8')), STORES.sul).site;
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test('topo: o payload da vitrine vira a navegação do computador (Sua cidade, Estados, Categorias, barra) e Loja/Contato da Uma Penca ao fim', () => {
  const html = desktopNav(SITE);
  assert.match(html, /^<div class="oa-nav" data-origens-artigos="nav">/);
  assert.match(html, />Sua cidade</);
  assert.match(html, />Estados</);
  assert.match(html, new RegExp('>' + SITE.categoriesLabel + '<'));
  for (const b of SITE.bar) assert.ok(html.includes('>' + esc(b.label) + '<'), 'barra: ' + b.label);
  assert.match(html, /<a class="oa-l oa-n" href="\/">Loja<\/a><a class="oa-l oa-n" href="\/fale-conosco">Contato<\/a>/);
  // os destacados do CMS levam as cores publicadas
  assert.match(html, /class="oa-l oa-hl" href="https:\/\/useorigens\.com\.br\/sul\/colecoes\/natal" style="background:#df4343;color:#fff"/);
});

test('topo: todo endereço de saída é https da origem da vitrine (fora os dois links da própria Uma Penca)', () => {
  for (const html of [desktopNav(SITE), mobileMenu(SITE)]) {
    for (const href of hrefs(html)) {
      assert.ok(href === '/' || href === '/fale-conosco' || href.startsWith(STORES.sul.storefront + '/'), 'href fora do esperado: ' + href);
    }
  }
});

test('topo: celular — "Voltar para a Use Origens" é o primeiro link, depois a cidade e os blocos do menu da vitrine, e Loja/Contato ao fim', () => {
  const panel = menuSections(SITE);
  assert.deepEqual(hrefs(panel).slice(0, 2), [STOREFRONT_HOME, SITE.journey.url]);
  assert.ok(panel.indexOf(BACK_LABEL) < panel.indexOf(SITE.journey.menuLabel));
  for (const block of SITE.blocks) assert.ok(panel.includes('>' + esc(block.label) + '<'), 'bloco: ' + block.label);
  assert.ok(panel.lastIndexOf('Loja') > panel.lastIndexOf(SITE.blocks[SITE.blocks.length - 1].label));
  const menu = mobileMenu(SITE);
  assert.match(menu, /^<details class="oa-m" data-origens-artigos="menu"><summary class="oa-m-btn" aria-label="Menu">/);
});

test('topo: nenhum script nosso — HTML e CSS apenas', () => {
  for (const out of [desktopNav(SITE), mobileMenu(SITE), logoHtml(), topoCss()]) {
    assert.doesNotMatch(out, /<script|javascript:|\son[a-z]+=/i);
  }
});

test('topo: texto fora do esperado é escapado de novo (defesa em profundidade; o normalizador já recusa < e >)', () => {
  const hostile = { ...SITE, journey: { ...SITE.journey, label: '<img src=x onerror=alert(1)>', menuLabel: '"><b>x</b>' }, bar: [{ label: "a'b&c", url: SITE.bar[0].url }] };
  const html = desktopNav(hostile) + menuSections(hostile);
  assert.doesNotMatch(html, /<img src=x|<b>x<\/b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /a&#39;b&amp;c/);
});

test('topo: o logo é a etiqueta da vitrine com o nome, sem alt duplicado (o link já tem o título)', () => {
  assert.match(logoHtml(), /^<img class="oa-logo-img" src="https:\/\/useorigens\.com\.br\/brand\/logo-origens\.png" alt="" width="34" height="34"><span class="oa-logo-word" translate="no">Use Origens<\/span>$/);
});

test('escopo: só a home, a página de artigo e as páginas de conteúdo; o resto (carrinho, checkout, conta, APIs, arquivos) fica de fora', () => {
  for (const p of ['/', '/fale-conosco', '/sobre', '/newsletter', '/caneca/la-de-chapeco-sc-444855.html', '/ecobag/algo-123.html']) assert.equal(eligiblePath(p), true, p);
  for (const p of ['/carrinho', '/checkout', '/checkout/pagamento', '/login', '/minha-conta', '/rastreamento', '/pedido/123', '/api/x', '/sw_v2.js', '/manifest.json', '/store-theme.css', '/caneca/sem-id.html', '/caneca/x-1.html/extra', '/a/b/c-1.html', '/__origens/health', '/fale-conosco/x', '/CANECA/X-1.html']) assert.equal(eligiblePath(p), false, p);
});

test('interruptor: só "true" liga (ausente ou qualquer outro valor desliga)', () => {
  assert.equal(topoEnabled({ ARTIGOS_TOPO: 'true' }), true);
  assert.equal(topoEnabled({ ARTIGOS_TOPO: ' TRUE ' }), true);
  for (const v of [undefined, '', 'false', '1', 'dry-run', 'yes', 0, null]) assert.equal(topoEnabled({ ARTIGOS_TOPO: v }), false, String(v));
  assert.equal(topoEnabled(undefined), false);
});
