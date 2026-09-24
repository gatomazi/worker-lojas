import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { LOADER_SOURCE } from '../src/loader-source.js';

// jsdom: sem layout real. getClientRects é simulado; a verificação visual em navegador real é separada.
const FIXTURE = readFileSync(new URL('./fixtures/product-page.html', import.meta.url), 'utf8');
const LINK = 'use-origens-return-link';
const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function page({ url = 'https://www.usesul.com.br/usesul/product/serra-catarinense', html = FIXTURE } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getClientRects = function () { return [{}]; };
  return dom;
}

async function load(dom) {
  dom.window.eval(LOADER_SOURCE);
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
  dom.window.eval(LOADER_SOURCE);
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
  for (const forbidden of [/fetch\(/, /XMLHttpRequest/, /sendBeacon/, /addEventListener\(\s*['"]click/, /document\.cookie/, /localStorage/, /sessionStorage/, /\.submit\(/]) {
    assert.doesNotMatch(LOADER_SOURCE, forbidden);
  }
});
