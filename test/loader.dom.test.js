import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { LOADER_SOURCE, buildLoaderSource } from '../src/loader-source.js';

// jsdom: sem layout real. getClientRects é simulado; a verificação visual em navegador real é separada.
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const LINK = 'use-origens-return-link';
const ALLOWED = ['/usesul/product/serra-catarinense', '/usesul/product/x'];
const SOURCE = buildLoaderSource(ALLOWED);
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function page({ url = 'https://www.usesul.com.br/usesul/product/serra-catarinense', html = FIXTURE } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  return dom;
}

async function load(dom) {
  dom.window.eval(SOURCE);
  await tick();
  return dom.window.document;
}

const links = (doc) => doc.querySelectorAll('#' + LINK);

test('mounts one link right after the in-flow CTA, not in the fixed mobile bar', async () => {
  const doc = await load(page());
  assert.equal(links(doc).length, 1);
  assert.equal(doc.getElementById('add-to-cart-desk').nextElementSibling.id, LINK);
  assert.equal(doc.getElementById('add-to-cart-mob').parentElement.querySelector('#' + LINK), null);
  assert.equal(doc.getElementById(LINK).textContent, '← Voltar a procurar');
  assert.equal(doc.getElementById(LINK).href, 'https://useorigens.com.br/sul');
});

test('is idempotent: running the loader twice never duplicates the link', async () => {
  const dom = page();
  const doc = await load(dom);
  dom.window.eval(SOURCE);
  await tick();
  assert.equal(links(doc).length, 1);
});

test('remounts once after Turbo events or DOM replacement removed the link', async () => {
  const dom = page();
  const doc = await load(dom);
  doc.getElementById(LINK).remove();
  doc.dispatchEvent(new dom.window.Event('turbo:load'));
  await tick();
  assert.equal(links(doc).length, 1);
  const frame = doc.querySelector('turbo-frame#cart');
  frame.innerHTML = frame.innerHTML; // simula re-render do frame do carrinho pela INK
  await tick();
  assert.equal(links(doc).length, 1);
});

test('remounts after the whole <body> is replaced (Turbo Drive render)', async () => {
  const dom = page();
  const doc = await load(dom);
  const fresh = doc.createElement('body');
  fresh.innerHTML = doc.body.innerHTML.replace(/<a id="use-origens-return-link".*?<\/a>/, '');
  doc.body.replaceWith(fresh);
  await tick();
  assert.equal(links(doc).length, 1);
});

test('falls back to the class selector when the id changes', async () => {
  const doc = await load(page({ html: FIXTURE.replace('id="add-to-cart-desk"', 'id="renamed"') }));
  assert.equal(links(doc).length, 1);
});

test('does nothing (and does not throw) when no CTA exists', async () => {
  const doc = await load(page({ html: '<html><head></head><body><main>sem cta</main></body></html>' }));
  assert.equal(links(doc).length, 0);
});

test('does nothing outside product pages or on another host', async () => {
  for (const url of ['https://www.usesul.com.br/usesul/cart', 'https://www.usesul.com.br/usesul', 'https://www.usesul.com.br/usesul/product/a/b', 'https://example.com/usesul/product/x']) {
    assert.equal(links(await load(page({ url }))).length, 0, url);
  }
});

test('origens_return: accepts only https://useorigens.com.br/sul[/...]', async () => {
  const base = 'https://www.usesul.com.br/usesul/product/x?origens_return=';
  const ok = 'https://useorigens.com.br/sul/sc/tijucas';
  assert.equal((await load(page({ url: base + encodeURIComponent(ok) }))).getElementById(LINK).href, ok);
  for (const bad of ['https://evil.example/sul', 'https://useorigens.com.br.evil.example/sul', 'https://useorigens.com.br/outro',
    'https://useorigens.com.br/sulista', 'javascript:alert(1)', 'https://user:pw@useorigens.com.br/sul', 'https://useorigens.com.br:8443/sul',
    'http://useorigens.com.br/sul', '//evil.example/sul', '/sul']) {
    const doc = await load(page({ url: base + encodeURIComponent(bad) }));
    assert.equal(doc.getElementById(LINK).href, 'https://useorigens.com.br/sul', bad);
  }
});

test('loader source has no network calls, no click interception and no cookie/storage access', () => {
  for (const forbidden of [/fetch\(/, /XMLHttpRequest/, /sendBeacon/, /preventDefault|stopPropagation|stopImmediatePropagation/, /document\.cookie/, /localStorage/, /sessionStorage/, /\.submit\(/]) {
    assert.doesNotMatch(LOADER_SOURCE, forbidden);
  }
});

// ---- allowlist embutida no loader + navegação Turbo (simulada em jsdom; o Turbo real fica para o navegador)
const OTHER = '/usesul/product/vida-no-sul-estancia-edition';

// Simula o que o Turbo Drive faz: troca URL e <body> sem recarregar o JS, e emite turbo:render/turbo:load.
async function turboVisit(dom, path, bodyHtml) {
  dom.window.history.pushState({}, '', path);
  const fresh = dom.window.document.createElement('body');
  fresh.innerHTML = bodyHtml;
  dom.window.document.body.replaceWith(fresh);
  dom.window.document.dispatchEvent(new dom.window.Event('turbo:render'));
  dom.window.document.dispatchEvent(new dom.window.Event('turbo:load'));
  await tick();
}
const cleanBody = () => FIXTURE.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];

test('an empty embedded allowlist never mounts (fail-closed)', async () => {
  const dom = page();
  dom.window.eval(LOADER_SOURCE);
  await tick();
  assert.equal(links(dom.window.document).length, 0);
});

test('a path outside the embedded allowlist never mounts, even with a product-shaped URL', async () => {
  const dom = page({ url: 'https://www.usesul.com.br' + OTHER });
  const doc = await load(dom);
  assert.equal(links(doc).length, 0);
});

test('a query string on an allowed path still mounts (matching is by path)', async () => {
  const doc = await load(page({ url: 'https://www.usesul.com.br/usesul/product/serra-catarinense?utm_source=x&variant=2' }));
  assert.equal(links(doc).length, 1);
});

test('a look-alike path (trailing slash, other case, suffix) never mounts', async () => {
  for (const path of ['/usesul/product/serra-catarinense/', '/usesul/product/Serra-Catarinense', '/usesul/product/serra-catarinense-2']) {
    assert.equal(links(await load(page({ url: 'https://www.usesul.com.br' + path }))).length, 0, path);
  }
});

test('Turbo: allowed -> not allowed removes the link and mounts nothing; back to allowed mounts once', async () => {
  const dom = page();
  const doc = await load(dom);
  assert.equal(links(doc).length, 1);
  await turboVisit(dom, OTHER, cleanBody());
  assert.equal(links(dom.window.document).length, 0);
  await turboVisit(dom, '/usesul/product/serra-catarinense', cleanBody());
  assert.equal(links(dom.window.document).length, 1);
  await turboVisit(dom, '/usesul/product/x', cleanBody());
  assert.equal(links(dom.window.document).length, 1);
});

test('Turbo re-executing the script tag (new head element) never duplicates', async () => {
  const dom = page();
  const doc = await load(dom);
  for (let i = 0; i < 3; i++) dom.window.eval(SOURCE);
  await turboVisit(dom, '/usesul/product/serra-catarinense', cleanBody());
  dom.window.eval(SOURCE);
  await tick();
  assert.equal(links(doc).length, 1);
});

test('the embedded list is plain JSON of validated paths', () => {
  assert.match(SOURCE, /const ALLOWED_PATHS = \["\/usesul\/product\/serra-catarinense","\/usesul\/product\/x"\];/);
  assert.match(buildLoaderSource(), /const ALLOWED_PATHS = \[\];/);
});
