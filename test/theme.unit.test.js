import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme, activeSurfaces, buildThemeCss, checkoutPageKind, parseSurfaceParam, themeQuery, createThemeSource, contrast, SURFACES } from '../src/theme.js';
import { STORES } from '../src/stores.js';
import { parseFeatures } from '../src/features.js';

// Contrato v1 do tema da compra, CSS por superfície e as telas do checkout que podem recebê-lo. Puro (sem rede).
export const GOOD = {
  v: 1, region: 'sul', surfaces: { pdp: true, cart: true, checkout: false },
  tokens: { action: '#000000', onAction: '#FFFFFF', selected: '#4d543d', onSelected: '#ffffff', ground: '#e5e5e5', surface: '#ffffff', paper: '#f2f2f0', photo: '#e5e5e5', ink: '#000000', inkSoft: '#33332f', inkMute: '#56564f', line: '#b3b3b0', radius: 0, font: 'origens' }
};
// Separa uma lista de seletores pelas vírgulas de NÍVEL SUPERIOR (as de dentro de :is()/:where()/:not() não contam).
const splitSelectors = (list) => { const out = []; let depth = 0; let cur = ''; for (const ch of list) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const clone = (patch = {}, tokens = {}) => ({ ...structuredClone(GOOD), ...patch, tokens: { ...GOOD.tokens, ...tokens } });

test('normalizeTheme: accepts v1 of THIS store (colours lower-cased), refuses another region, version, missing surface, non-hex colour, radius or font outside the presets', () => {
  const t = normalizeTheme(GOOD, STORES.sul);
  assert.deepEqual(t.surfaces, { pdp: true, cart: true, checkout: false });
  assert.equal(t.tokens.onAction, '#ffffff');
  assert.equal(normalizeTheme(GOOD, STORES.norte), null, 'Sul payload is never Norte');
  assert.equal(normalizeTheme(clone({ v: 2 })), null);
  assert.equal(normalizeTheme(clone({ surfaces: { pdp: true, cart: true } })), null);
  assert.equal(normalizeTheme(clone({ surfaces: { pdp: 'yes', cart: true, checkout: true } })), null);
  for (const bad of ['red', '#fff', 'url(x)', '#000000;}body{display:none', '', null]) assert.equal(normalizeTheme(clone({}, { action: bad })), null, String(bad));
  assert.equal(normalizeTheme(clone({}, { radius: 4 })), null);
  assert.equal(normalizeTheme(clone({}, { radius: '0' })), null);
  assert.equal(normalizeTheme(clone({}, { font: 'Comic Sans' })), null);
  assert.equal(normalizeTheme(null), null);
});

test('normalizeTheme: a pair without AA contrast is refused whole (button text, selected chip, page text on every background)', () => {
  assert.equal(normalizeTheme(clone({}, { action: '#777777', onAction: '#ffffff' })), null);
  assert.equal(normalizeTheme(clone({}, { selected: '#d6ba8d', onSelected: '#ffffff' })), null);
  assert.equal(normalizeTheme(clone({}, { ground: '#333333' })), null);
  assert.ok(contrast('#4d543d', '#ffffff') >= 4.5);
});

test('activeSurfaces: a surface needs BOTH the panel switch and the deploy feature; canonical order', () => {
  const t = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }));
  assert.deepEqual(activeSurfaces(t, ['theme-cart', 'theme-pdp', 'theme-checkout']), ['pdp', 'cart', 'checkout']);
  assert.deepEqual(activeSurfaces(t, ['theme-cart']), ['cart']);
  assert.deepEqual(activeSurfaces(normalizeTheme(GOOD), ['theme-checkout']), [], 'panel off wins');
  assert.deepEqual(activeSurfaces(null, ['theme-pdp']), []);
});

test('features: the three theme flags parse; unknown theme name still discards the whole list', () => {
  assert.deepEqual(parseFeatures('return-link,theme-pdp,theme-cart,theme-checkout').features, ['return-link', 'theme-pdp', 'theme-cart', 'theme-checkout']);
  assert.equal(parseFeatures('theme-pdp,theme-home').status, 'invalid');
  const all = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide,size-fit,theme-pdp,theme-cart,theme-checkout';
  assert.equal(parseFeatures(all).status, 'ok', 'the full list (production + theme) fits the length guard');
});

test('CSS: every rule is scoped to the themed <html> (or is the font @import / an @media of scoped rules); a surface carries only its own rules', () => {
  const t = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }));
  const css = buildThemeCss(t, SURFACES);
  // @keyframes o-benefit é global por natureza (nome nosso, prefixado); o resto precisa do escopo.
  const body = css.replace(/^\/\*[^*]*\*\//, '').replace(/^@import url\("[^"]+"\);/, '').replace(/@keyframes o-[a-z-]+\{(?:[^{}]*\{[^}]*\})*\}/g, '');
  // Quebra no nível superior: cada regra (ou bloco @media) tem que começar pelo escopo.
  let depth = 0; let start = 0; const top = [];
  for (let i = 0; i < body.length; i++) { if (body[i] === '{') depth++; else if (body[i] === '}') { depth--; if (depth === 0) { top.push(body.slice(start, i + 1)); start = i + 1; } } }
  assert.equal(depth, 0, 'balanced braces');
  for (const rule of top) {
    const inner = rule.startsWith('@media') ? rule.slice(rule.indexOf('{') + 1, -1) : rule;
    for (const sel of inner.split('}').filter(Boolean).map((r) => r.slice(0, r.indexOf('{'))).flatMap(splitSelectors)) {
      assert.match(sel.trim(), /^html\[data-origens-theme/, 'unscoped selector: ' + sel.trim().slice(0, 80));
    }
  }
  const pdpOnly = buildThemeCss(t, ['pdp']);
  assert.ok(pdpOnly.includes('~="pdp"') && !pdpOnly.includes('~="cart"') && !pdpOnly.includes('~="checkout"'));
  assert.ok(buildThemeCss(t, ['checkout']).includes('~="checkout"'));
  assert.equal(buildThemeCss(t, []), '');
  assert.equal(buildThemeCss(null, ['pdp']), '');
});

test('CSS: never hides INK purchase content; display/visibility only where listed; no generated text; tokens as variables', () => {
  const t = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }));
  const css = buildThemeCss(t, SURFACES);
  const selectorsWith = (re) => (css.replace(/@keyframes o-[a-z-]+\{(?:[^{}]*\{[^}]*\})*\}/g, '').match(new RegExp('[^{}]+\\{[^}]*' + re + '[^}]*\\}', 'g')) || []).map((r) => { const head = r.slice(0, r.lastIndexOf('{')); return head.slice(head.lastIndexOf('{') + 1); }); // tira o @media em volta
  // `display` só onde a INK nunca alterna visibilidade (grades dos seletores, o "Continuar Comprando" do carrinho vazio, o link da marca no checkout). Os dois
  // `display:none`: a frase da INK que repete o nosso "Seu carrinho está vazio" (só quando o nosso bloco existe) e a setinha do nosso "Guia de medidas".
  assert.deepEqual(selectorsWith('display:').sort(), [
    'html[data-origens-theme~="cart"] .cart-drawer .empty-cart [data-action*="closeDrawer"]',
    'html[data-origens-theme~="cart"] .cart-drawer .empty-cart:has([data-origens-empty]) #most_sold_frame > div > span:first-child',
    'html[data-origens-theme~="checkout"] nav.bg-store-primary a:has([data-origens-brand])',
    'html[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type #open-modal-size .o-size-chevron',
    'html[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type .form-product-options__select-type-model',
    'html[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type .form-product-options__select-type-size'
  ].sort());
  assert.deepEqual(selectorsWith('display:\\s*none').sort(), [
    'html[data-origens-theme~="cart"] .cart-drawer .empty-cart:has([data-origens-empty]) #most_sold_frame > div > span:first-child',
    'html[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type #open-modal-size .o-size-chevron'
  ].sort());
  // visibility:hidden só no que volta sozinho: barra fixa (CTA à vista/teclado), pontos da galeria (com o contador no lugar), flutuantes durante a escolha.
  const vis = selectorsWith('visibility:hidden');
  assert.equal(vis.length, 3);
  assert.ok(vis.some((v) => v.includes(':is(.o-cta-inview,.o-typing)') && v.includes('.form-product-options__add-to-cart-mobile')));
  assert.ok(vis.some((v) => v.includes('.o-gal-count') && v.includes('ul.absolute.z-30')));
  assert.ok(vis.some((v) => v.includes('.o-choosing') && v.includes('ink-store--help-button')));
  assert.ok(!/[;{]content:/.test(css), 'no generated text');
  assert.ok(css.includes('--o-action:#000000') && css.includes('--o-selected:#4d543d') && css.includes('--o-photo:#e5e5e5'));
  const ink = normalizeTheme(clone({ surfaces: { pdp: true, cart: false, checkout: false } }, { font: 'ink' }));
  assert.ok(!buildThemeCss(ink, ['pdp']).includes('@import'), 'native font = no font request');
  assert.ok(buildThemeCss(t, ['pdp']).startsWith('/*') && buildThemeCss(t, ['pdp']).includes('@import url("https://fonts.googleapis.com/css2?family=Big+Shoulders+Display'));
  // Faixa superior: a animação nossa só entra com exatamente três mensagens e com os keyframes no próprio CSS.
  assert.ok(css.includes('@keyframes o-benefit') && css.includes('.header-benefits:has(> span:nth-child(3):last-child) > span'));
  assert.ok(!buildThemeCss(t, ['cart']).includes('@keyframes'), 'cart alone has no strip');
});

test('themeQuery: changes with the published tokens and with the surfaces; parseSurfaceParam keeps only known names in canonical order', () => {
  const a = normalizeTheme(GOOD); const b = normalizeTheme(clone({}, { radius: 8 }));
  assert.notEqual(themeQuery(a, ['pdp']), themeQuery(b, ['pdp']));
  assert.notEqual(themeQuery(a, ['pdp']), themeQuery(a, ['pdp', 'cart']));
  assert.match(themeQuery(a, ['pdp', 'cart']), /^s=pdp,cart&v=1&c=[0-9a-z]+$/);
  assert.deepEqual(parseSurfaceParam('cart,pdp'), ['pdp', 'cart']);
  assert.deepEqual(parseSurfaceParam('pdp,admin'), []);
  assert.deepEqual(parseSurfaceParam(null), []);
});

test('checkoutPageKind: only the two checkout SCREENS of this store (with or without the cart uuid); never the POST endpoints, other stores or look-alikes', () => {
  const U = '1bea2f5a-90df-4f1e-bf1d-fb7dcfea246b';
  assert.equal(checkoutPageKind('/usesul/checkout/contact_and_shipping_details/' + U, '/usesul'), 'contact');
  assert.equal(checkoutPageKind('/usesul/checkout/payment_methods/' + U, '/usesul'), 'payment');
  assert.equal(checkoutPageKind('/usesul/checkout/contact_and_shipping_details', '/usesul'), 'contact');
  for (const p of ['/usesul/checkout/process_payment', '/usesul/checkout/buyer/94657912', '/usesul/checkout/shipping_address/delivery_details', '/usesul/checkout/payment_discount/1',
    '/usesul/checkout/payment_methods/' + U + '/x', '/usesul/checkout/payment_methods/not-a-uuid', '/usenorte/checkout/payment_methods/' + U, '/usesul/cart', '/usesul/checkout', '/usesulx/checkout/payment_methods']) {
    assert.equal(checkoutPageKind(p, '/usesul'), null, p);
  }
});

test('createThemeSource: fixed storefront URL without visitor headers; 60 s fresh; a failing storefront keeps the last good theme (≤ 24 h), never invents one', async () => {
  let clock = 0; const calls = []; let reply = () => Response.json(GOOD);
  const src = createThemeSource({ store: STORES.sul, now: () => clock, upstream: async (req) => { calls.push({ url: req.url, cookie: req.headers.get('cookie') }); return reply(); } });
  assert.ok(await src.get());
  assert.deepEqual(calls, [{ url: 'https://useorigens.com.br/api/ink-theme/sul', cookie: null }]);
  clock = 30_000; await src.get(); assert.equal(calls.length, 1, 'fresh: no refetch');
  clock = 61_000; reply = () => new Response('oops', { status: 500 });
  assert.ok(await src.get(), 'stale but still served');
  clock = 25 * 3600 * 1000; assert.equal(await src.get(), null, 'too old: no theme');
  const empty = createThemeSource({ store: STORES.sul, upstream: async () => Response.json({ ...GOOD, region: 'norte' }) });
  assert.equal(await empty.get(), null, 'wrong region = no theme');
});
