import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';

// Tema da compra no workerd REAL (HTMLRewriter de verdade). A INK e o storefront são stubs (outboundService).
const HOST = 'https://www.usesul.com.br';
const PDP = '/usesul/product/florianopolis-legado-sc';
const UUID = '1bea2f5a-90df-4f1e-bf1d-fb7dcfea246b';
const CONTACT = '/usesul/checkout/contact_and_shipping_details/' + UUID;
const PAYMENT = '/usesul/checkout/payment_methods/' + UUID;
const PRODUCT_HTML = readFileSync(new URL('./fixtures/product-page-theme.html', import.meta.url), 'utf8');
const CHECKOUT_HTML = '<!doctype html><html lang="pt-BR"><head><title>Checkout</title></head><body><nav class="bg-store-primary"><a href="/usesul"><img alt="Use Sul" src="/logo.png"></a></nav><div data-controller="ink-store--checkout"><form id="formPaymentMethods" action="/usesul/checkout/process_payment?cart_uuid=' + UUID + '" method="post"><input type="radio" id="pix" name="cart[payment_type]" value="pix"></form></div></body></html>';
const TOKENS = { action: '#000000', onAction: '#ffffff', selected: '#4d543d', onSelected: '#ffffff', ground: '#e5e5e5', surface: '#ffffff', paper: '#f2f2f0', photo: '#e5e5e5', ink: '#000000', inkSoft: '#33332f', inkMute: '#56564f', line: '#b3b3b0', radius: 0, font: 'origens' };
const themeOf = (surfaces) => ({ v: 1, region: 'sul', surfaces: { pdp: false, cart: false, checkout: false, ...surfaces }, tokens: TOKENS });

const calls = [];
let storefront = () => Response.json(themeOf({ pdp: true, cart: true, checkout: true }));
const inkHeaders = () => { const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' }); h.append('set-cookie', '_ink_session=abc; path=/; HttpOnly'); h.append('set-cookie', 'cart=1; path=/'); return h; };
const instances = new Map();
async function worker(features, extra = {}) {
  const bindings = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: features, ...extra };
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie') });
        if (url.host === 'useorigens.com.br') return url.pathname === '/api/ink-theme/sul' ? storefront() : new Response('{}', { status: 404 });
        if (url.pathname.includes('/checkout/')) return new Response(CHECKOUT_HTML, { headers: inkHeaders() });
        return new Response(PRODUCT_HTML, { headers: inkHeaders() });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });
const ALL = 'return-link,header-nav,theme-pdp,theme-cart,theme-checkout';
const get = async (features, path, init = {}, extra) => { calls.length = 0; return (await worker(features, extra)).dispatchFetch(HOST + path, init); };
const links = (html) => html.match(/<link rel="stylesheet" href="\/__origens\/theme\.css\?[^"]+"[^>]*>/g) || [];
const reset = () => { storefront = () => Response.json(themeOf({ pdp: true, cart: true, checkout: true })); };

test('product page: <html data-origens-theme="pdp cart">, ONE theme link in <head>, loader still injected; cookies and status kept', async () => {
  reset();
  const res = await get(ALL, PDP);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<html lang="pt-BR" data-origens-theme="pdp cart">/);
  const tag = links(html);
  assert.equal(tag.length, 1);
  assert.match(tag[0], /theme\.css\?s=pdp,cart&v=1&c=[0-9a-z]+"/);
  assert.ok(html.indexOf(tag[0]) < html.indexOf('</head>'), 'link inside <head>');
  assert.equal((html.match(/data-use-origens-widget=/g) || []).length, 1, 'loader too');
  assert.deepEqual(res.headers.getSetCookie(), ['_ink_session=abc; path=/; HttpOnly', 'cart=1; path=/']);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const read = calls.find((c) => c.host === 'useorigens.com.br');
  assert.deepEqual(read, { host: 'useorigens.com.br', path: '/api/ink-theme/sul', method: 'GET', cookie: null }, 'fixed URL, no visitor cookie');
});

test('product page: the panel switch narrows the surfaces; feature off = no theme read, no link, no attribute', async () => {
  // Cada passo usa um isolate novo (outra combinação de features): a configuração fica 60 s em memória por isolate, de propósito.
  storefront = () => Response.json(themeOf({ cart: true }));
  let html = await (await get(ALL + ',cart-mirror', PDP)).text();
  assert.match(html, /data-origens-theme="cart"/);
  assert.match(links(html)[0], /s=cart&/);
  storefront = () => Response.json(themeOf({ checkout: true }));
  html = await (await get(ALL + ',city-search', PDP)).text();
  assert.equal(links(html).length, 0); assert.ok(!html.includes('data-origens-theme'));
  reset();
  html = await (await get('return-link,header-nav', PDP)).text();
  assert.equal(links(html).length, 0); assert.ok(!html.includes('data-origens-theme'));
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0, 'nothing read without a theme feature');
});

test('fail-open: storefront down or invalid payload = the INK page as usual (loader still there), never a guessed theme', async () => {
  storefront = () => new Response('boom', { status: 500 });
  let html = await (await get(ALL + ',list-session', PDP)).text(); // outra combinação = isolate novo, sem tema em memória
  assert.equal(links(html).length, 0); assert.ok(!html.includes('data-origens-theme'));
  assert.equal((html.match(/data-use-origens-widget=/g) || []).length, 1);
  storefront = () => Response.json({ ...themeOf({ pdp: true }), tokens: { ...TOKENS, action: 'red' } });
  html = await (await get(ALL + ',promo-fab', PDP)).text();
  assert.equal(links(html).length, 0);
  reset();
});

test('shell page (collection) gets the same attribute and link (the <html> survives Turbo visits)', async () => {
  reset();
  const html = await (await get(ALL, '/usesul/collections/sc')).text();
  assert.match(html, /data-origens-theme="pdp cart"/);
  assert.equal(links(html).length, 1);
});

test('checkout screens: ONLY the attribute and the CSS link (no loader, no script of ours); headers and body otherwise intact', async () => {
  reset();
  for (const path of [CONTACT, PAYMENT]) {
    const res = await get(ALL, path);
    const html = await res.text();
    assert.match(html, /<html lang="pt-BR" data-origens-theme="checkout">/, path);
    assert.equal(links(html).length, 1); assert.match(links(html)[0], /s=checkout&/);
    assert.ok(!html.includes('__origens/loader.js') && !html.includes('data-use-origens-widget'), 'no loader on checkout');
    assert.match(html, /<a href="\/usesul"><img alt="Use Sul" src="\/logo.png"><span data-origens-brand aria-hidden="true">Use Origens<\/span><\/a>/, 'brand next to the logo, inside the same link');
    assert.equal(html.replace(/ data-origens-theme="checkout"/, '').replace(links(html)[0], '').replace('<span data-origens-brand aria-hidden="true">Use Origens</span>', ''), CHECKOUT_HTML, 'nothing else changed');
    assert.deepEqual(res.headers.getSetCookie(), ['_ink_session=abc; path=/; HttpOnly', 'cart=1; path=/']);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  }
});

test('checkout: untouched without theme-checkout, with the panel switch off, in dry-run, on POST, on Turbo-Frame and on any other checkout path', async () => {
  reset();
  const same = async (features, path, init, extra) => assert.equal(await (await get(features, path, init, extra)).text(), path.includes('/checkout/') ? CHECKOUT_HTML : PRODUCT_HTML, path);
  await same('return-link,theme-pdp,theme-cart', PAYMENT);
  storefront = () => Response.json(themeOf({ pdp: true, cart: true }));
  await same(ALL + ',size-guide', PAYMENT);
  reset();
  await same(ALL, PAYMENT, {}, { ENABLE_WIDGET: 'dry-run' });
  await same(ALL, PAYMENT, { method: 'POST', body: 'x=1' });
  await same(ALL, CONTACT, { headers: { 'Turbo-Frame': 'shipping_address' } });
  await same(ALL, '/usesul/checkout/process_payment', { method: 'POST', body: 'cart[payment_type]=pix' });
  await same(ALL, '/usesul/checkout/buyer/94657912');
});

test('theme.css: same hash = immutable for a year; other hash = current CSS with a short cache; surface switched off = empty, no-store; feature off = the INK answers', async () => {
  reset();
  const html = await (await get(ALL, PDP)).text();
  const href = links(html)[0].match(/href="([^"]+)"/)[1];
  let res = await get(ALL, href);
  const css = await res.text();
  assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.ok(css.includes('html[data-origens-theme~="pdp"]') && css.includes('html[data-origens-theme~="cart"]') && !css.includes('~="checkout"'));
  res = await get(ALL, '/__origens/theme.css?s=pdp,cart&v=1&c=old');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(await res.text(), css);
  storefront = () => Response.json(themeOf({ pdp: true }));
  res = await get(ALL + ',pdp-share', '/__origens/theme.css?s=checkout&v=1&c=x');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /theme off/);
  res = await get('return-link', '/__origens/theme.css?s=pdp');
  assert.match(res.headers.get('content-type'), /text\/html/, 'INK 404 page (stub) answers, not us');
  res = await get(ALL, '/__origens/theme.css?s=pdp', { method: 'POST' });
  assert.equal(res.status, 405);
  reset();
});
