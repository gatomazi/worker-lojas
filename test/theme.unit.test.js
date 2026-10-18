import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheme, normalizeIncentive, incentiveAttr, activeSurfaces, buildThemeCss, checkoutPageKind, accountPageKind, ACCOUNT_CSS_ONLY, parseSurfaceParam, themeQuery, createThemeSource, contrast, SURFACES, PALETTES } from '../src/theme.js';
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
  assert.deepEqual(t.surfaces, { pdp: true, cart: true, checkout: false, account: false });
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
  const all = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide,size-fit,theme-pdp,theme-cart,theme-checkout,cart-incentive';
  assert.equal(parseFeatures(all).status, 'ok', 'the full list (production + theme) fits the length guard');
});

test('CSS: every rule is scoped to the themed <body> (or is the font @import / an @media of scoped rules); a surface carries only its own rules', () => {
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
      // `html:has(> body[data-origens-theme~=…])`: o scroll-padding do checkout mora no <html>, mas só vale com o <body> tematizado.
      assert.match(sel.trim(), /^(?:html:has\(> )?body\[data-origens-theme/, 'unscoped selector: ' + sel.trim().slice(0, 80));
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
  // `display` só onde a INK nunca alterna visibilidade (grades dos seletores, o "Continuar Comprando" do carrinho vazio, o link da marca no checkout). Os
  // `display:none`: a frase da INK que repete o nosso "Seu carrinho está vazio" (só quando o nosso bloco existe), a setinha do nosso "Guia de medidas" e o
  // rótulo/texto de apoio do NOSSO bloco no pós-adição e o cupom da INK recolhido — só com o atributo NOSSO que o theme-ui põe quando o campo está vazio
  // e sem nada a dizer (sem o código, o campo aparece). Os demais `display` são dos nossos nós (botão "Adicionar cupom", incentivo) e do "Continuar
  // comprando" (que a INK nunca esconde).
  assert.deepEqual(selectorsWith('display:').sort(), [
    'body[data-origens-theme~="cart"] .cart-drawer .empty-cart [data-action*="closeDrawer"]',
    'body[data-origens-theme~="cart"] .cart-drawer__footer__keep-shopping',
    'body[data-origens-theme~="cart"] .cart-drawer__footer__coupon[data-origens-collapsed]',
    'body[data-origens-theme~="cart"] .cart-drawer .o-coupon-toggle',
    'body[data-origens-theme~="cart"] .cart-drawer [data-origens-incentive-box]',
    'body[data-origens-theme~="cart"] .cart-drawer [data-origens-incentive-box] .o-incentive-bar',
    'body[data-origens-theme~="cart"] .cart-drawer [data-origens-incentive-box] .o-incentive-bar i',
    // A linha "Adicionar cupom" + "Frete · Inserir CEP" (grade do rodapé só com o nosso botão no lugar do cupom e o CEP fechado) e o alvo de 44 px do
    // "Inserir CEP" (a INK alterna o campo do CEP, não este link).
    'body[data-origens-theme~="cart"] .cart-drawer__footer:has(> .o-coupon-toggle):has(> .cart-drawer__footer__cep [data-action*="insertCep"]):not(:has(> .cart-drawer__footer__cep [data-ink-store--cart-target="cepInputContainer"]:not(.hidden)))',
    'body[data-origens-theme~="cart"] .cart-drawer__footer__cep [data-action*="insertCep"]',
    'body[data-origens-theme~="cart"] .cart-drawer .empty-cart:has([data-origens-empty]) #most_sold_frame > div > span:first-child',
    'body[data-origens-theme~="cart"] [data-origens-discovery="post-add"] :is(.o-eyebrow,.o-lead)',
    'body[data-origens-theme~="checkout"] nav.bg-store-primary a:has([data-origens-brand])',
    'body[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type #open-modal-size .o-size-chevron',
    'body[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type .form-product-options__select-type-model',
    'body[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type .form-product-options__select-type-size',
    'body[data-origens-theme~="pdp"] .o-thumbs',
    'body[data-origens-theme~="pdp"] .o-thumb img'
  ].sort());
  assert.deepEqual(selectorsWith('display:\\s*none').sort(), [
    'body[data-origens-theme~="cart"] .cart-drawer .empty-cart:has([data-origens-empty]) #most_sold_frame > div > span:first-child',
    'body[data-origens-theme~="cart"] .cart-drawer__footer__coupon[data-origens-collapsed]',
    'body[data-origens-theme~="cart"] [data-origens-discovery="post-add"] :is(.o-eyebrow,.o-lead)',
    'body[data-origens-theme~="pdp"] form[id^="form-product-"] .form-product-options__select-type #open-modal-size .o-size-chevron'
  ].sort());
  // visibility:hidden só no que volta sozinho: barra fixa (CTA à vista/teclado), pontos da galeria (com as miniaturas no lugar), flutuantes durante a escolha
  // e o conteúdo do NOSSO incentivo enquanto a INK responde (a caixa fica, a altura não muda).
  const vis = selectorsWith('visibility:hidden');
  assert.equal(vis.length, 4);
  assert.ok(vis.some((v) => v.endsWith('[data-origens-incentive-box][data-loading] > *')));
  assert.ok(vis.some((v) => v.includes(':is(.o-cta-inview,.o-typing)') && v.includes('.form-product-options__add-to-cart-mobile')));
  assert.ok(vis.some((v) => v.includes('.o-thumbs') && v.includes('ul.absolute.z-30')), 'native dots hidden only once the thumbnail grid is mounted');
  assert.ok(vis.some((v) => v.includes('.o-choosing') && v.includes('ink-store--help-button')));
  assert.ok(!/[;{]content:/.test(css), 'no generated text');
  assert.ok(css.includes('--o-action:#000000') && css.includes('--o-selected:#4d543d') && css.includes('--o-photo:#e5e5e5'));
  const ink = normalizeTheme(clone({ surfaces: { pdp: true, cart: false, checkout: false } }, { font: 'ink' }));
  assert.ok(!buildThemeCss(ink, ['pdp']).includes('@import'), 'native font = no font request');
  assert.ok(buildThemeCss(t, ['pdp']).startsWith('/*') && buildThemeCss(t, ['pdp']).includes('@import url("https://fonts.googleapis.com/css2?family=Big+Shoulders+Display'));
  // Faixa superior: a animação nossa só entra com exatamente três mensagens e com os keyframes no próprio CSS.
  assert.ok(css.includes('@keyframes o-benefit') && css.includes('.header-benefits:has(> span:nth-child(3):last-child) > span'));
  assert.ok(!buildThemeCss(t, ['cart']).includes('@keyframes'), 'cart alone has no strip');
  // Checkout: o campo em foco não para atrás da faixa do topo nem da barra fixa do celular (só CSS; o respiro de baixo só existe com a barra).
  const k = buildThemeCss(t, ['checkout']);
  assert.ok(k.includes('html:has(> body[data-origens-theme~="checkout"]){scroll-padding-top:48px}'));
  assert.ok(/@media \(max-width:767px\)\{html:has\(> body\[data-origens-theme~="checkout"\] div\.fixed\.bottom-0 button\.md\\:hidden\)\{scroll-padding-bottom:104px\}\}/.test(k));
  assert.ok(!buildThemeCss(t, ['pdp', 'cart']).includes('scroll-padding'), 'only the checkout touches scroll-padding');
  // Carrinho: preço de cada item numa linha; botões de quantidade/remover com 44 px.
  const c = buildThemeCss(t, ['cart']);
  assert.ok(c.includes(':is(.price,.price span,.price del){white-space:nowrap}') && c.includes('.item-details__quantity button{width:44px!important;height:44px!important}'));
});

test('incentive: só ligado, frete grátis por PEÇAS, meta 2–20, UFs desta região; inválido = sem incentivo (o tema continua); atributo só com números e siglas', () => {
  const ok = { enabled: true, kind: 'free-shipping', unit: 'items', threshold: 2, ufs: ['RS', 'PR', 'SC'] };
  assert.deepEqual(normalizeIncentive(ok), { threshold: 2, ufs: ['PR', 'SC', 'RS'], where: 'no Sul' }, 'ordem da região; a região inteira = "no Sul"');
  assert.deepEqual(normalizeIncentive({ ...ok, ufs: ['SC', 'PR'] }), { threshold: 2, ufs: ['PR', 'SC'], where: '' }, 'parte da região: o carrinho lista as UFs');
  for (const bad of [{ ...ok, enabled: false }, { ...ok, kind: 'discount' }, { ...ok, unit: 'value' }, { ...ok, threshold: 1 }, { ...ok, threshold: 21 }, { ...ok, threshold: '2' },
    { ...ok, ufs: [] }, { ...ok, ufs: ['SP'] }, { ...ok, ufs: ['PR', 'PR'] }, { ...ok, ufs: ['pr'] }, { ...ok, ufs: 'PR' }, null, 'x']) {
    assert.equal(normalizeIncentive(bad), null, JSON.stringify(bad));
  }
  const themed = normalizeTheme(clone({ incentive: ok }));
  assert.deepEqual(themed.incentive, { threshold: 2, ufs: ['PR', 'SC', 'RS'], where: 'no Sul' });
  assert.equal(incentiveAttr(themed), '2|PR,SC,RS|no Sul');
  assert.equal(incentiveAttr(normalizeTheme(clone({ incentive: { ...ok, ufs: ['PR'] } }))), '2|PR');
  const broken = normalizeTheme(clone({ incentive: { ...ok, ufs: ['SP'] } }));
  assert.ok(broken && broken.incentive === null, 'incentivo inválido não derruba o tema');
  assert.equal(incentiveAttr(broken), '');
  assert.equal(incentiveAttr(null), '');
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
  const U = '0f0e0d0c-0b0a-4908-8706-050403020100';
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

test('palette "acento" (proposta B, escolhida em 17/10/2026): só na Sul, só carrinho e checkout, e um valor estranho nunca derruba o tema', () => {
  const acento = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true }, palette: 'acento' }), STORES.sul);
  assert.equal(acento.palette, 'acento');
  assert.equal(normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }), STORES.sul).palette, 'neutra', 'sem paleta = a derivada dos tokens, como antes');
  assert.equal(normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true }, palette: 'neon' }), STORES.sul).palette, 'neutra', 'paleta desconhecida = ignorada, o tema continua');
  const css = buildThemeCss(acento, ['pdp', 'cart', 'checkout']);
  const roles = PALETTES.acento.sul;
  for (const [role, value] of Object.entries(roles)) assert.ok(css.includes('--o-' + role + ':' + value), role);
  assert.ok(css.includes('body[data-origens-theme~="cart"] .cart-drawer,body[data-origens-theme~="checkout"]{'), 'escopo: gaveta do carrinho e checkout');
  assert.ok(css.includes('::selection{background:#ecdcb8'), 'seleção de texto na paleta');
  assert.ok(css.includes('caret-color:#3a5a30'), 'cursor dos campos do checkout no verde das escolhas');
  // Só a PDP: nada da paleta (ela é do carrinho e do checkout).
  assert.ok(!buildThemeCss(acento, ['pdp']).includes('#f4ecda'));
  // A neutra continua byte a byte a de antes; e a paleta muda a URL do CSS (o navegador não reaproveita o arquivo antigo).
  const neutra = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }), STORES.sul);
  assert.ok(!buildThemeCss(neutra, ['cart', 'checkout']).includes('#f4ecda'));
  assert.notEqual(themeQuery(acento, ['cart']), themeQuery(neutra, ['cart']));
  // Contraste dos pares de texto da paleta (AA).
  assert.ok(contrast(roles['on-cta'], roles.cta) >= 4.5);
  assert.ok(contrast(roles['incentive-ink'], roles['incentive-bg']) >= 4.5);
  assert.ok(contrast(roles['incentive-soft'], roles['incentive-bg']) >= 4.5);
  assert.ok(contrast(roles['incentive-icon'], roles['incentive-icon-bg']) >= 3);
  assert.ok(contrast(roles.ink, roles.panel) >= 4.5);
});

test('account surface (theme-account): OPTIONAL in the contract — absent = off and the theme on air keeps working; present must be boolean', () => {
  // O storefront publicado antes da conta manda só pdp/cart/checkout: nada pode desligar por isso.
  const before = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }), STORES.sul);
  assert.ok(before, 'payload without account still valid');
  assert.equal(before.surfaces.account, false);
  assert.deepEqual(activeSurfaces(before, ['theme-pdp', 'theme-cart', 'theme-checkout', 'theme-account']), ['pdp', 'cart', 'checkout']);
  const on = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true, account: true } }), STORES.sul);
  assert.deepEqual(activeSurfaces(on, ['theme-pdp', 'theme-cart', 'theme-checkout', 'theme-account']), ['pdp', 'cart', 'checkout', 'account']);
  assert.deepEqual(activeSurfaces(on, ['theme-pdp', 'theme-cart', 'theme-checkout']), ['pdp', 'cart', 'checkout'], 'the deploy feature is the ceiling');
  for (const bad of ['yes', 1, null]) assert.equal(normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true, account: bad } }), STORES.sul), null, String(bad));
  assert.deepEqual(parseSurfaceParam('account'), ['account']);
  assert.deepEqual(parseSurfaceParam('pdp,cart,account'), ['pdp', 'cart', 'account']);
});

test('accountPageKind: login screen, orders, tracking, order, review and exchanges — never the login POST or another session/checkout path', () => {
  const k = (p) => accountPageKind(p, '/useorigens');
  assert.equal(k('/useorigens/store_sessions/new'), 'login');
  assert.equal(k('/useorigens/orders'), 'orders'); assert.equal(k('/useorigens/orders/'), 'orders');
  assert.equal(k('/useorigens/orders/trackings'), 'tracking');
  assert.equal(k('/useorigens/orders/1829670'), 'order');
  assert.equal(k('/useorigens/orders/1829670/review/55'), 'review'); assert.equal(k('/useorigens/orders/guest_reviews/new'), 'review');
  assert.equal(k('/useorigens/exchanges_and_returns'), 'exchanges');
  for (const bad of ['/useorigens/store_sessions', '/useorigens/store_sessions/abc', '/useorigens/store_sessions/new/x', '/useorigens/orders/trackings/search', '/useorigens/orders/1/2',
    '/useorigens/orders/1/review', '/useorigens/cart', '/useorigens/checkout/payment_methods', '/useorigens/product/x', '/useorigens', '/outra/orders', '/useorigens/orders/' + 'x'.repeat(65)]) assert.equal(k(bad), null, bad);
  assert.equal(accountPageKind('/useorigens/orders', ''), null);
  assert.deepEqual([...ACCOUNT_CSS_ONLY], ['login', 'review'], 'login and review never get our script');
});

test('account CSS: scoped to the account surface, the same button/field language as the checkout, and the acento palette carried to the account', () => {
  const theme = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true, account: true }, palette: 'acento' }), STORES.sul);
  const css = buildThemeCss(theme, ['account']);
  assert.ok(css.includes('body[data-origens-theme~="account"] a.bg-store-button'), 'Ver compra / Rastrear compra as the main action');
  assert.ok(css.includes('form[action$="/store_sessions"] button[type="submit"]'), 'login submit');
  assert.ok(css.includes('form[action$="/orders/trackings/search"] input[type="submit"]'), 'tracking submit');
  assert.ok(css.includes('body[data-origens-theme~="account"]{--o-cta:#1b1d19'), 'acento palette on the account');
  assert.ok(!buildThemeCss(theme, ['checkout']).includes('data-origens-theme~="account"'), 'nothing of the account without the surface');
  assert.notEqual(themeQuery(theme, ['pdp', 'cart']), themeQuery(theme, ['pdp', 'cart', 'account']));
});

test('finishing touches: buttons centre their text when INK draws them as blocks; the account menu and the footer newsletter in the theme', () => {
  const t = normalizeTheme(clone({ surfaces: { pdp: true, cart: true, checkout: true } }), STORES.sul);
  const css = buildThemeCss(t, ['pdp', 'cart']);
  assert.match(css, /align-items:center;align-content:center;justify-content:center/, 'block buttons ("Rastrear compra") centre the label');
  assert.match(css, /body\[data-origens-theme~="pdp"\] \.menu-user\{border:2px solid var\(--o-ink\);border-radius:var\(--o-radius\)!important;box-shadow:none!important/);
  assert.match(css, /\.menu-user \.menu-user__list :is\(a,button\)\{width:100%;min-height:44px/);
  assert.match(css, /div\.bg-gray-700:has\(> \* > form\[action\$="\/newsletter"\]\)\{background:var\(--o-selected\)!important/);
  assert.match(css, /form\[action\$="\/newsletter"\] input\[type=submit\]\{min-height:48px/);
  // Nunca `display` nas peças da INK que ela mostra/esconde.
  assert.doesNotMatch(css.match(/\.menu-user[^}]*\}/g).join(''), /display:/);
});
