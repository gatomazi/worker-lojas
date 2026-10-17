import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planThemeRelease, sameThemeConfig, evaluateThemePage, parseTomlVars, parseTomlRoutes, parseLiveRoutes, THEME_FEATURES } from '../scripts/lib/theme-release-lib.mjs';

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
  assert.ok(!toml.some((p) => /checkout|cart|store_sessions/.test(p)), 'nenhuma rota de compra ou login no TOML');
  assert.equal(parseTomlVars(TOML).SINGLE_STORE_DOMAIN, 'next');
});
