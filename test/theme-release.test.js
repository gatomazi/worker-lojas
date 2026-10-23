import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planThemeRelease, sameThemeConfig, evaluateThemePage, evaluateCheckoutPage, evaluateAccountPage, parseTomlVars, parseTomlRoutes, parseLiveRoutes, checkoutRoutes, accountRoutes, checkoutRoutesState, checkoutProbeSet, accountProbeSet, evaluateTopBar, THEME_FEATURES } from '../scripts/lib/theme-release-lib.mjs';

// A produção de 17/10/2026 (versão do domínio novo): 14 features, catálogo, 5 caminhos na allowlist.
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide,size-fit';
const ALLOW = ['serra-catarinense', 'paranaense-essencia', 'made-in-parana-x', 'made-in-santa-catarina-y', 'made-in-rio-grande-do-sul-z'].map((s) => '/useorigens/product/' + s).join(',');
const VARS = { ENABLE_WIDGET: 'true', SERVE_REGIONS: 'sul,norte,centro-oeste', SINGLE_STORE_DOMAIN: 'next', WIDGET_ALLOWLIST: ALLOW, WIDGET_FEATURES: FEATURES, WIDGET_SCOPE_MODE: 'product-catalog' };
const HEALTH = { service: 'use-sul-widget', version: '5.2', widget_mode: 'true', features_status: 'ok', widget_features: FEATURES.split(','), scope_mode: 'product-catalog', allowlist_size: 5, ink_host: 'loja.useorigens.com.br', served_regions: ['sul', 'norte', 'centro-oeste'] };
const TOML = readFileSync(new URL('../wrangler.production.toml', import.meta.url), 'utf8');
const plan = (over = {}) => planThemeRelease({ health: HEALTH, captured: { vars: VARS, bindings: [{ type: 'kv_namespace', name: 'CART_REFS' }] }, tomlBindings: ['CART_REFS'], tomlVars: parseTomlVars(TOML), ...over });

test('planThemeRelease: preserves every captured variable and only adds theme-pdp and theme-cart, in the registry order', () => {
  const p = plan();
  assert.equal(p.ok, true, p.problems.join('; '));
  assert.equal(p.deploy.WIDGET_ALLOWLIST, ALLOW);
  assert.equal(p.deploy.WIDGET_SCOPE_MODE, 'product-catalog');
  assert.equal(p.deploy.WIDGET_FEATURES, FEATURES + ',theme-pdp,theme-cart');
  assert.deepEqual(p.deploy.added, THEME_FEATURES);
});

test('planThemeRelease: stops on anything it would change or lose by accident', () => {
  const problems = (over) => plan(over).problems.join(' | ');
  assert.match(problems({ captured: { vars: { ...VARS, WIDGET_FEATURES: FEATURES + ',theme-pdp' }, bindings: [{ name: 'CART_REFS' }] } }), /já ligado/);
  assert.match(problems({ captured: { vars: { ...VARS, SINGLE_STORE_DOMAIN: 'current' }, bindings: [{ name: 'CART_REFS' }] } }), /SINGLE_STORE_DOMAIN/);
  assert.match(problems({ captured: { vars: { ...VARS, OUTRA: 'x' }, bindings: [{ name: 'CART_REFS' }] } }), /OUTRA existe na produção/);
  assert.match(problems({ captured: { vars: VARS, bindings: [] } }), /bindings/);
  assert.match(problems({ health: { ...HEALTH, allowlist_size: 4 } }), /health: allowlist/);
  assert.match(problems({ health: { ...HEALTH, widget_features: [...HEALTH.widget_features, 'top-bar'] } }), /health: features/);
  assert.match(problems({ captured: { vars: { ...VARS, WIDGET_ALLOWLIST: '/usesul/product/x' }, bindings: [{ name: 'CART_REFS' }] } }), /WIDGET_ALLOWLIST/);
  assert.match(problems({ captured: null }), /ilegíveis/);
});

test('sameThemeConfig: the features grow by exactly the theme ones and nothing else moves', () => {
  const after = { ...HEALTH, widget_features: [...HEALTH.widget_features, 'theme-pdp', 'theme-cart'] };
  assert.equal(sameThemeConfig(HEALTH, after), true);
  assert.equal(sameThemeConfig(HEALTH, { ...after, scope_mode: 'allowlist' }), false);
  assert.equal(sameThemeConfig(HEALTH, { ...after, ink_host: 'www.usesul.com.br' }), false);
  assert.equal(sameThemeConfig(HEALTH, { ...after, widget_features: [...after.widget_features, 'theme-checkout'] }), false);
  assert.equal(sameThemeConfig(HEALTH, HEALTH), false);
});

test('evaluateThemePage: body signal, the theme stylesheet and one loader', () => {
  const page = '<html><head><link rel="stylesheet" href="/__origens/theme.css?s=pdp,cart&amp;v=1&amp;c=abc" data-origens-theme-css="1"></head><body class="x" data-origens-theme="pdp cart"><script src="/__origens/loader.js?v=5.2&c=z"></script></body></html>';
  const r = evaluateThemePage(page, { status: 200, type: 'text/css; charset=utf-8', body: 'body[data-origens-theme]{--o-cta:#1b1d19}' });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.cssPath, '/__origens/theme.css?s=pdp,cart&v=1&c=abc');
  assert.equal(evaluateThemePage(page.replace(' data-origens-theme="pdp cart"', '')).ok, false);
  assert.equal(evaluateThemePage(page, { status: 404, type: 'text/html', body: '' }).ok, false);
  assert.equal(evaluateThemePage(page + '<script src="/__origens/loader.js?v=5.2&c=z"></script>').ok, false);
});

test('TOML and zone routes: the production TOML declares the routes the zone has after the domain move', () => {
  const live = ['www.usesul.com.br (1 rota(s))', '   www.usesul.com.br/* -> use-sul-widget', 'loja.useorigens.com.br (3 rota(s))', '   loja.useorigens.com.br/__origens/* -> use-sul-widget', '   loja.useorigens.com.br/useorigens/* -> (sem Worker)', '   loja.useorigens.com.br/useorigens/product/* -> use-sul-widget'].join('\n');
  assert.deepEqual(parseLiveRoutes(live), ['www.usesul.com.br/*', 'loja.useorigens.com.br/__origens/*', 'loja.useorigens.com.br/useorigens/product/*']);
  const toml = parseTomlRoutes(TOML);
  assert.ok(toml.includes('www.usesul.com.br/*') && toml.includes('loja.useorigens.com.br/useorigens/product/*'));
  const purchase = toml.filter((p) => /checkout|cart|store_sessions|payment_confirmation/.test(p));
  assert.deepEqual(purchase.sort(), [...checkoutRoutes('loja.useorigens.com.br', '/useorigens'), 'loja.useorigens.com.br/useorigens/store_sessions/new*'].sort(), 'no caminho da compra e do login, só as duas telas do checkout, a confirmação do pedido e a TELA do login');
  for (const p of accountRoutes('loja.useorigens.com.br', '/useorigens')) assert.ok(toml.includes(p), p);
  assert.equal(parseTomlVars(TOML).SINGLE_STORE_DOMAIN, 'next');
});

const HOST = 'loja.useorigens.com.br'; const BASE = '/useorigens'; const W = 'use-sul-widget';
const ZONE_NOW = [{ pattern: HOST + '/useorigens/*', script: null }, { pattern: HOST + '/useorigens/product/*', script: W }, { pattern: HOST + '/__origens/*', script: W }];

test('checkout routes: only the two document screens, never without the exclusion, never next to another route on the purchase path', () => {
  const s = checkoutRoutesState(ZONE_NOW, { host: HOST, base: BASE, worker: W });
  assert.deepEqual(s.missing, [HOST + '/useorigens/checkout/contact_and_shipping_details*', HOST + '/useorigens/checkout/payment_methods*', HOST + '/useorigens/payment_confirmation/*']);
  assert.deepEqual(s.problems, []);
  const done = checkoutRoutesState([...ZONE_NOW, ...s.missing.map((pattern) => ({ pattern, script: W }))], { host: HOST, base: BASE, worker: W });
  assert.deepEqual(done.missing, []);
  assert.match(checkoutRoutesState(ZONE_NOW.slice(1), { host: HOST, base: BASE, worker: W }).problems.join(), /falta a exclusão/);
  assert.match(checkoutRoutesState([...ZONE_NOW, { pattern: HOST + '/useorigens/checkout/process_payment*', script: W }], { host: HOST, base: BASE, worker: W }).problems.join(), /fora das autorizadas/);
  assert.match(checkoutRoutesState([...ZONE_NOW, { pattern: HOST + '/useorigens/cart*', script: W }], { host: HOST, base: BASE, worker: W }).problems.join(), /fora das autorizadas/);
});

test('checkout probes: the two screens execute; every submission, the cart and the login do not (GET only)', () => {
  const set = checkoutProbeSet(BASE);
  const exec = set.filter((p) => p.exec).map((p) => p.url);
  const skip = set.filter((p) => p.exec === false).map((p) => p.url);
  assert.ok(exec.some((u) => u.includes('/checkout/contact_and_shipping_details/')) && exec.some((u) => u.includes('/checkout/payment_methods/')));
  assert.ok(exec.includes(BASE + '/payment_confirmation/0/0'), 'the order confirmation executes (fictitious ids)');
  for (const path of ['/checkout/buyer/', '/checkout/shipping_address/', '/checkout/process_payment', '/checkout/payment_discount/', '/cart', '/store_sessions/']) assert.ok(skip.some((u) => u.includes(path)), path);
  // Os dois padrões casam com as telas e com nenhum envio.
  const glob = (p) => new RegExp('^' + p.slice(HOST.length).replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
  const patterns = checkoutRoutes(HOST, BASE).map(glob);
  for (const u of exec.filter((x) => x.includes('/checkout/') || x.includes('/payment_confirmation/'))) assert.ok(patterns.some((g) => g.test(u)), u);
  for (const u of skip) assert.ok(!patterns.some((g) => g.test(u)), u);
});

test('theme-checkout release: added on top of the two already live; the checkout page carries the theme and no loader', () => {
  const live = { vars: { ...VARS, WIDGET_FEATURES: FEATURES + ',theme-pdp,theme-cart' }, bindings: [{ name: 'CART_REFS' }] };
  const health = { ...HEALTH, widget_features: [...HEALTH.widget_features, 'theme-pdp', 'theme-cart'] };
  const p = plan({ captured: live, health, add: ['theme-checkout'] });
  assert.equal(p.ok, true, p.problems.join('; '));
  assert.equal(p.deploy.WIDGET_FEATURES, FEATURES + ',theme-pdp,theme-cart,theme-checkout');
  assert.equal(sameThemeConfig(health, { ...health, widget_features: [...health.widget_features, 'theme-checkout'] }, ['theme-checkout']), true);
  const page = '<html><head><link rel="stylesheet" href="/__origens/theme.css?s=checkout&amp;v=1&amp;c=x"></head><body data-origens-theme="checkout"><form></form></body></html>';
  assert.equal(evaluateCheckoutPage(page).ok, true);
  assert.equal(evaluateCheckoutPage(page.replace('</body>', '<script src="/__origens/loader.js?v=5.2&c=z"></script></body>')).ok, false);
  assert.equal(evaluateCheckoutPage(page.replace(' data-origens-theme="checkout"', '')).ok, false);
});

test('account routes: the login SCREEN and exchanges only; checkout routes are not a problem for the account group and vice versa', () => {
  const acc = accountRoutes(HOST, BASE);
  assert.deepEqual(acc, [HOST + '/useorigens/store_sessions/new*', HOST + '/useorigens/exchanges_and_returns*']);
  const zone = [...ZONE_NOW, ...checkoutRoutes(HOST, BASE).map((pattern) => ({ pattern, script: W }))];
  const s = checkoutRoutesState(zone, { host: HOST, base: BASE, worker: W, group: 'account' });
  assert.deepEqual(s.missing, acc); assert.deepEqual(s.problems, []);
  const both = checkoutRoutesState([...zone, ...acc.map((pattern) => ({ pattern, script: W }))], { host: HOST, base: BASE, worker: W });
  assert.deepEqual(both.problems, [], 'the login screen route is authorised for the checkout group too');
  assert.match(checkoutRoutesState([...zone, { pattern: HOST + '/useorigens/store_sessions*', script: W }], { host: HOST, base: BASE, worker: W, group: 'account' }).problems.join(), /fora das autorizadas/);
  // O padrão da tela do login nunca casa com o POST nem com outro caminho de sessão.
  const glob = (p) => new RegExp('^' + p.slice(HOST.length).replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
  const patterns = acc.map(glob);
  const set = accountProbeSet(BASE);
  for (const p of set.filter((x) => x.exec === false)) assert.ok(!patterns.some((g) => g.test(p.url)), p.url);
  for (const u of ['/useorigens/store_sessions/new', '/useorigens/exchanges_and_returns']) assert.ok(patterns.some((g) => g.test(u)), u);
});

test('evaluateAccountPage: login = account only, no loader, home links; shell = account with one loader', () => {
  const login = '<html><head><link rel="stylesheet" href="/__origens/theme.css?s=account&amp;v=1&amp;c=x"></head><body class="font-poppins" data-origens-theme="account"><a href="https://useorigens.com.br/sul">Voltar</a></body></html>';
  assert.equal(evaluateAccountPage(login, { kind: 'login', home: 'https://useorigens.com.br/sul' }).ok, true);
  assert.equal(evaluateAccountPage(login.replace('https://useorigens.com.br/sul', '/useorigens'), { kind: 'login', home: 'https://useorigens.com.br/sul' }).ok, false);
  assert.equal(evaluateAccountPage(login.replace('</body>', '<script src="/__origens/loader.js?v=5.2&c=z"></script></body>'), { kind: 'login' }).ok, false);
  const shell = '<html><head><link rel="stylesheet" href="/__origens/theme.css?s=pdp,cart,account&amp;v=1&amp;c=x"></head><body data-origens-theme="pdp cart account"><script src="/__origens/loader.js?v=5.2&c=z"></script></body></html>';
  assert.equal(evaluateAccountPage(shell, { kind: 'shell' }).ok, true);
  assert.equal(evaluateAccountPage(shell.replace(' account"', '"'), { kind: 'shell' }).ok, false);
});

test('--update (only new code): the same features go out, nothing turned on or off, and the health check expects exactly them', () => {
  const live = { vars: { ...VARS, WIDGET_FEATURES: FEATURES + ',theme-pdp,theme-cart,theme-checkout,theme-account' }, bindings: [{ name: 'CART_REFS' }] };
  const health = { ...HEALTH, widget_features: [...HEALTH.widget_features, 'theme-pdp', 'theme-cart', 'theme-checkout', 'theme-account'] };
  const p = plan({ captured: live, health, add: [] });
  assert.equal(p.ok, true, p.problems.join('; '));
  assert.equal(p.deploy.WIDGET_FEATURES, live.vars.WIDGET_FEATURES);
  assert.equal(sameThemeConfig(health, health, []), true);
  assert.equal(sameThemeConfig(health, { ...health, widget_features: health.widget_features.slice(0, -1) }, []), false);
});

test('top-bar: o release soma a faixa às 18 features de produção sem tirar nenhuma', () => {
  const live = FEATURES.split(',').concat(['theme-pdp', 'theme-cart', 'theme-checkout', 'theme-account']);
  const before = { widget_mode: 'true', scope_mode: 'product-catalog', allowlist_size: 5, ink_host: 'loja.useorigens.com.br', served_regions: ['sul', 'norte', 'centro-oeste'], widget_features: live };
  assert.equal(sameThemeConfig(before, { ...before, widget_features: [...live, 'top-bar'] }, ['top-bar']), true);
  assert.equal(sameThemeConfig(before, { ...before, widget_features: [...live.slice(1), 'top-bar'] }, ['top-bar']), false);
});

test('top-bar: a INK tem de servir a MESMA faixa do storefront, e o loader tem de trazer o módulo', () => {
  const site = { v: 1, region: 'sul', style: 'marquee', messages: [{ id: 'a', text: '📍 Todas as cidades do Sul estampadas' }, { id: 'b', text: '🚚 Frete grátis' }], colors: { background: '#e2b64a', text: '#111111' } };
  const loader = "const BAR_ENDPOINT = '/__origens/top-bar';";
  assert.deepEqual(evaluateTopBar(site, site, loader), { ok: true, problems: [], messages: ['📍 Todas as cidades do Sul estampadas', '🚚 Frete grátis'] });
  assert.equal(evaluateTopBar(null, site, loader).ok, false); // a feature não está no ar
  assert.equal(evaluateTopBar({ ...site, messages: site.messages.slice(0, 1) }, site, loader).ok, false);
  assert.equal(evaluateTopBar({ ...site, colors: undefined }, site, loader).ok, false);
  assert.equal(evaluateTopBar(site, site, 'sem módulo').ok, false);
  assert.match(evaluateTopBar(site, { ...site, messages: [] }, loader).problems.join(' '), /não tem faixa publicada/);
});
