import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';

// Tema da compra no workerd REAL (HTMLRewriter de verdade). A INK e o storefront são stubs (outboundService).
const HOST = 'https://www.usesul.com.br';
const PDP = '/usesul/product/florianopolis-legado-sc';
const UUID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const CONTACT = '/usesul/checkout/contact_and_shipping_details/' + UUID;
const PAYMENT = '/usesul/checkout/payment_methods/' + UUID;
const PRODUCT_HTML = readFileSync(new URL('./fixtures/product-page-theme.html', import.meta.url), 'utf8');
const CHECKOUT_HTML = '<!doctype html><html lang="pt-BR"><head><title>Checkout</title></head><body><nav class="bg-store-primary"><a href="/usesul"><img alt="Use Sul" src="/logo.png"></a></nav><div data-controller="ink-store--checkout"><form id="formPaymentMethods" action="/usesul/checkout/process_payment?cart_uuid=' + UUID + '" method="post"><input type="radio" id="pix" name="cart[payment_type]" value="pix"></form></div></body></html>';
// Login da INK (estrutura real de 17/10/2026, textos fictícios): "Voltar" e símbolo para a home da loja, o formulário do CPF/CNPJ.
const LOGIN_HTML = '<!doctype html><html lang="pt-BR"><head><title>Entrar</title></head><body class="font-poppins"><div><div class="px-2 py-8 flex justify-center bg-gray-100 min-h-screen max-h-fit"><div class="p-4 md:p-8 rounded-lg bg-white shadow"><div class="flex flex-col gap-6"><div class="flex flex-col"><a class="flex flex-row gap-2 items-center cursor-pointer w-fit mb-2" href="/usesul"><p class="text-sm">Voltar</p></a><div class="flex flex-row py-7 gap-2 items-center"><a href="/usesul"><img class="max-h-30 w-12 object-cover" src="/logo.png" alt=""></a><p class="text-gray-900 font-bold text-xl">Use Origens</p></div></div><form class="flex flex-col gap-6" action="/usesul/store_sessions" method="post"><input type="text" name="user[document]"><button type="submit" class="rounded-full bg-gray-900"><p class="text-white">Continuar</p></button></form></div></div></div></div></body></html>';
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
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie'), encoding: request.headers.get('accept-encoding') });
        if (url.host === 'useorigens.com.br') return url.pathname === '/api/ink-theme/sul' ? storefront() : new Response('{}', { status: 404 });
        if (url.pathname.includes('/checkout/')) return new Response(CHECKOUT_HTML, { headers: inkHeaders() });
        if (url.pathname.includes('/store_sessions')) return new Response(LOGIN_HTML, { headers: inkHeaders() });
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
  assert.match(html, /<body class="font-poppins" data-origens-theme="pdp cart">/);
  const tag = links(html);
  assert.equal(tag.length, 1);
  assert.match(tag[0], /theme\.css\?s=pdp,cart&v=1&c=[0-9a-z]+"/);
  assert.ok(html.indexOf(tag[0]) < html.indexOf('</head>'), 'link inside <head>');
  assert.equal((html.match(/data-use-origens-widget=/g) || []).length, 1, 'loader too');
  assert.deepEqual(res.headers.getSetCookie(), ['_ink_session=abc; path=/; HttpOnly', 'cart=1; path=/']);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const read = calls.find((c) => c.host === 'useorigens.com.br');
  assert.deepEqual({ ...read, encoding: undefined }, { host: 'useorigens.com.br', path: '/api/ink-theme/sul', method: 'GET', cookie: null, encoding: undefined }, 'fixed URL, no visitor cookie');
});

test('incentivo: com theme-cart + cart-incentive e regra válida publicada, a regra vai no <body>; sem a feature, sem o carrinho ou regra inválida, não', async () => {
  const rule = { enabled: true, kind: 'free-shipping', unit: 'items', threshold: 2, ufs: ['PR', 'SC', 'RS'] };
  const INC = ALL + ',cart-incentive';
  // Uma instância por cenário (a configuração fica 60 s em cache por isolate).
  storefront = () => Response.json({ ...themeOf({ pdp: true, cart: true, checkout: true }), incentive: rule });
  let html = await (await get(INC, PDP, {}, { CASE: 'ok' })).text();
  assert.match(html, /<body class="font-poppins" data-origens-theme="pdp cart" data-origens-incentive="2\|PR,SC,RS\|no Sul">/);
  const k = await (await get(INC, PAYMENT, {}, { CASE: 'ok' })).text();
  assert.doesNotMatch(k, /data-origens-incentive/, 'checkout: nada além do tema');
  html = await (await get(ALL, PDP, {}, { CASE: 'no-feature' })).text();
  assert.doesNotMatch(html, /data-origens-incentive/, 'sem a feature');
  storefront = () => Response.json({ ...themeOf({ pdp: true, cart: false, checkout: true }), incentive: rule });
  html = await (await get(INC, PDP, {}, { CASE: 'cart-off' })).text();
  assert.doesNotMatch(html, /data-origens-incentive/, 'carrinho desligado no painel');
  storefront = () => Response.json({ ...themeOf({ pdp: true, cart: true, checkout: true }), incentive: { ...rule, ufs: ['SP'] } });
  html = await (await get(INC, PDP, {}, { CASE: 'bad' })).text();
  assert.match(html, /data-origens-theme="pdp cart"/, 'regra inválida não derruba o tema');
  assert.doesNotMatch(html, /data-origens-incentive/);
  reset();
});

test('loja única: o tema segue a região do visitante (como navbar e promoções) — cada região lê o próprio /api/ink-theme/<região>', async () => {
  reset();
  const extra = { SERVE_REGIONS: 'sul,norte,centro-oeste' };
  // Sem região lembrada: a da loja (Sul), com o tema publicado.
  let html = await (await get(ALL, PDP, {}, extra)).text();
  assert.match(html, /data-origens-theme="pdp cart"/);
  assert.ok(calls.some((c) => c.host === 'useorigens.com.br' && c.path === '/api/ink-theme/sul'));
  // Visitante do Norte: lê o tema do Norte (aqui sem publicação: 404) e fica sem tema, sem cair no da Sul.
  html = await (await get(ALL, PDP, { headers: { cookie: 'origens_r=norte' } }, extra)).text();
  assert.ok(calls.some((c) => c.host === 'useorigens.com.br' && c.path === '/api/ink-theme/norte'), calls.map((c) => c.path).join(','));
  assert.ok(!calls.some((c) => c.path === '/api/ink-theme/sul'), 'never the Sul theme for a Norte visitor');
  assert.doesNotMatch(html, /data-origens-theme=/);
  assert.equal(links(html).length, 0);
  // Checkout do visitante do Norte: idem.
  const k = await (await get(ALL, PAYMENT, { headers: { cookie: 'origens_r=norte' } }, extra)).text();
  assert.doesNotMatch(k, /data-origens-theme=/);
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
    assert.match(html, /<body data-origens-theme="checkout">/, path);
    assert.equal(links(html).length, 1); assert.match(links(html)[0], /s=checkout&/);
    assert.ok(!html.includes('__origens/loader.js') && !html.includes('data-use-origens-widget'), 'no loader on checkout');
    // O logo leva à home do storefront da região (não à home da INK), com o nome ao lado, dentro do mesmo link.
    assert.match(html, /<a href="https:\/\/useorigens\.com\.br\/sul"><img alt="Use Sul" src="\/logo.png"><span data-origens-brand aria-hidden="true">Use Origens<\/span><\/a>/, 'brand next to the logo, link to the storefront home');
    assert.equal(html.replace(/ data-origens-theme="checkout"/, '').replace(links(html)[0], '').replace('<span data-origens-brand aria-hidden="true">Use Origens</span>', '').replace('href="https://useorigens.com.br/sul"', 'href="/usesul"'), CHECKOUT_HTML, 'nothing else changed');
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
  assert.ok(css.includes('body[data-origens-theme~="pdp"]') && css.includes('body[data-origens-theme~="cart"]') && !css.includes('~="checkout"'));
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

test('checkout screens: the page is asked UNCOMPRESSED (INK sends the checkout in brotli, which cannot be rewritten) and the session cookie goes along', async () => {
  reset();
  await (await get(ALL, PAYMENT, { headers: { 'accept-encoding': 'gzip, br', cookie: '_ink_session=abc' } })).text();
  const ink = calls.find((c) => c.path.includes('/checkout/'));
  assert.equal(ink.encoding, 'identity');
  assert.equal(ink.cookie, '_ink_session=abc');
  // Fora do checkout nada muda: a página de produto vai com o que o navegador pediu.
  await (await get(ALL, PDP, { headers: { 'accept-encoding': 'gzip, br' } })).text();
  assert.notEqual(calls.find((c) => c.path === PDP).encoding, 'identity');
});

// ── Conta (theme-account) ──────────────────────────────────────────────────────────────────────────────────────────────
const ACC = ALL + ',theme-account';
const withAccount = (account) => { storefront = () => Response.json({ ...themeOf({ pdp: true, cart: true, checkout: true }), surfaces: { pdp: true, cart: true, checkout: true, ...(account === undefined ? {} : { account }) } }); };

test('account shell pages (orders, order, tracking, exchanges): the account surface joins pdp and cart, loader kept, the page asked uncompressed', async () => {
  for (const path of ['/usesul/orders', '/usesul/orders/1829670', '/usesul/orders/trackings', '/usesul/exchanges_and_returns']) {
    withAccount(true);
    const html = await (await get(ACC, path)).text();
    assert.match(html, /data-origens-theme="pdp cart account"/, path);
    assert.equal(links(html).length, 1); assert.match(links(html)[0], /s=pdp,cart,account&/, path);
    assert.equal((html.match(/data-use-origens-widget=/g) || []).length, 1, path + ': loader too');
    assert.equal(calls.find((c) => c.path === path).encoding, 'identity', path);
  }
});

test('account: without theme-account, or with a payload that predates the account switch, the shell pages stay exactly as today', async () => {
  withAccount(true);
  let html = await (await get(ALL, '/usesul/orders', {}, { CASE: 'acc-no-feature' })).text();
  assert.match(html, /data-origens-theme="pdp cart"/); assert.match(links(html)[0], /s=pdp,cart&/);
  assert.notEqual(calls.find((c) => c.path === '/usesul/orders').encoding, 'identity', 'no uncompressed request without the feature');
  withAccount(undefined); // storefront publicado antes da conta
  html = await (await get(ACC, '/usesul/orders', {}, { CASE: 'acc-absent' })).text();
  assert.match(html, /data-origens-theme="pdp cart"/, 'payload without account = account off, theme still on');
  withAccount(false);
  html = await (await get(ACC, '/usesul/orders', {}, { CASE: 'acc-off' })).text();
  assert.match(html, /data-origens-theme="pdp cart"/);
  reset();
});

test('account login: ONLY the attribute and the account CSS (no loader, no script of ours), Voltar and the store symbol lead to the storefront home', async () => {
  withAccount(true);
  const res = await get(ACC, '/usesul/store_sessions/new', { headers: { cookie: '_ink_session=abc', 'accept-encoding': 'br' } });
  const html = await res.text();
  assert.match(html, /<body class="font-poppins" data-origens-theme="account">/);
  assert.equal(links(html).length, 1); assert.match(links(html)[0], /s=account&/);
  assert.ok(!html.includes('__origens/loader.js') && !html.includes('data-use-origens-widget'), 'no loader on the login');
  assert.equal((html.match(/href="https:\/\/useorigens\.com\.br\/sul"/g) || []).length, 2, 'Voltar and the symbol');
  assert.ok(!html.includes('href="/usesul"'));
  assert.match(html, /<form class="flex flex-col gap-6" action="\/usesul\/store_sessions" method="post">/, 'the form untouched');
  const ink = calls.find((c) => c.path === '/usesul/store_sessions/new');
  assert.equal(ink.encoding, 'identity'); assert.equal(ink.cookie, '_ink_session=abc');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  reset();
});

test('account login: feature or panel off = the INK page untouched; the POST of the login and other session paths are never rewritten', async () => {
  withAccount(false);
  assert.equal(await (await get(ACC, '/usesul/store_sessions/new', {}, { CASE: 'login-off' })).text(), LOGIN_HTML);
  withAccount(true);
  assert.equal(await (await get(ALL, '/usesul/store_sessions/new', {}, { CASE: 'login-no-feature' })).text(), LOGIN_HTML, 'no theme-account in the deploy');
  const post = await get(ACC, '/usesul/store_sessions', { method: 'POST', body: 'user[document]=0' });
  assert.equal(await post.text(), LOGIN_HTML, 'POST passes through');
  assert.equal(await (await get(ACC, '/usesul/store_sessions/new', { headers: { 'Turbo-Frame': 'x' } })).text(), LOGIN_HTML, 'Turbo-Frame passes through');
  reset();
});

test('account review (outside the shell): only the attribute and the account CSS, no loader', async () => {
  withAccount(true);
  const html = await (await get(ACC, '/usesul/orders/1829670/review/55')).text();
  assert.match(html, /data-origens-theme="account"/);
  assert.match(links(html)[0], /s=account&/);
  assert.ok(!html.includes('data-use-origens-widget'));
  reset();
});
