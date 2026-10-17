#!/usr/bin/env node
// LIGA/DESLIGA do tema da compra, no navegador, nas páginas REAIS da INK pelo Worker local: cada cenário publica uma configuração diferente (o arquivo que o
// Worker lê do storefront) e/ou muda as features do deploy, e confere o que de fato acontece na PDP, no carrinho e (com --checkout) no checkout.
// O último cenário muda a configuração NO MEIO da sessão e confere a visita Turbo seguinte, o voltar (cache do Turbo) e o recarregar.
//   PW_PATH=… node scripts/qa-desligamento-tema.mjs [--checkout <uuid de teste>] [--rapido]   (--rapido pula o cenário que espera o cache de 60 s)
import { createHarness, REFERENCE_THEME, DEFAULT_PDP, STORE } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const UUID = opt('--checkout');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + String(detail).slice(0, 240) : '')); };
const OTHER_PDP = STORE.inkBase + '/product/scharlau-origem-localidade-rs';
const theme = (surfaces) => ({ ...structuredClone(REFERENCE_THEME), surfaces: { pdp: false, cart: false, checkout: false, ...surfaces } });
const wait = (p, ms) => p.waitForTimeout(ms);

// O que a página mostra AGORA (sinais visuais e de comportamento, não só atributos).
const probe = (page) => page.evaluate(() => ({
  attr: document.body.getAttribute('data-origens-theme'),
  links: [...document.querySelectorAll('link[data-origens-theme-css]')].map((l) => new URL(l.href).searchParams.get('s')),
  font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, ''),
  thumbs: document.querySelectorAll('[data-origens-thumbs] .o-thumb').length,
  dots: getComputedStyle(document.querySelector('.section-product-v2 ul.absolute.z-30') || document.body).visibility,
  order: [...(document.querySelector('form[id^="form-product-"]')?.children || [])].filter((e) => e.tagName !== 'INPUT').map((e) => e.id || e.getAttribute('data-controller') || 'preco').join('>'),
  classes: [...document.body.classList].filter((c) => /^o-/.test(c)).join(' '),
  galTop: document.body.style.getPropertyValue('--o-gal-top')
}));
const NATIVE = 'preco>delivery_estimates_frame>product_promotions_frame>ink-store--modal>product_variants_options_frame';
const THEMED = 'preco>product_variants_options_frame>delivery_estimates_frame>product_promotions_frame>ink-store--modal';
async function cartWidth(page) {
  await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('shopping-cart-menu-desk')?.click(); });
  await wait(page, 1500);
  const w = await page.evaluate(() => { const d = document.querySelector('.cart-drawer'); return { w: Math.round(d.getBoundingClientRect().width), font: getComputedStyle(d).fontFamily.split(',')[0].replace(/"/g, ''), empty: !!document.querySelector('[data-origens-empty]') }; });
  await page.keyboard.press('Escape'); await page.evaluate(() => document.getElementById('cart-drawer-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await wait(page, 600);
  return w;
}
async function checkoutAttr(page) {
  if (!UUID) return null;
  await page.goto(`https://${STORE.inkHost}${STORE.inkBase}/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 });
  return page.evaluate(() => ({ attr: document.body.getAttribute('data-origens-theme'), brand: !!document.querySelector('[data-origens-brand]'), loader: !!document.querySelector('script[data-use-origens-widget]') }));
}

const SCENARIOS = [
  { name: 'tudo ligado', config: theme({ pdp: true, cart: true, checkout: true }), expect: { pdp: true, cart: true, checkout: true } },
  { name: 'tudo desligado no painel (features no deploy)', config: theme({}), expect: { pdp: false, cart: false, checkout: false } },
  { name: 'PDP desligada, carrinho ligado', config: theme({ cart: true, checkout: true }), expect: { pdp: false, cart: true, checkout: true } },
  { name: 'PDP ligada, carrinho desligado', config: theme({ pdp: true, checkout: true }), expect: { pdp: true, cart: false, checkout: true } },
  { name: 'checkout desligado', config: theme({ pdp: true, cart: true }), expect: { pdp: true, cart: true, checkout: false } },
  { name: 'features de tema ausentes no deploy (painel tudo ligado)', config: theme({ pdp: true, cart: true, checkout: true }), themeFeatures: '', expect: { pdp: false, cart: false, checkout: false } },
  { name: 'só theme-cart no deploy (painel tudo ligado)', config: theme({ pdp: true, cart: true, checkout: true }), themeFeatures: 'theme-cart', expect: { pdp: false, cart: true, checkout: false } }
];

for (const sc of argv.includes('--so-meio') ? [] : SCENARIOS) {
  const H = await createHarness({ config: sc.config, themeFeatures: sc.themeFeatures ?? 'theme-pdp,theme-cart,theme-checkout' });
  const s = await H.session({ name: 'desktop', width: 1440, height: 900 });
  const { page } = s;
  await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1500);
  const p = await probe(page);
  const e = sc.expect;
  const pdpOk = e.pdp ? (/pdp/.test(p.attr || '') && p.font === 'Hanken Grotesk' && p.thumbs > 1 && p.dots === 'hidden' && p.order === THEMED)
    : (!/pdp/.test(p.attr || '') && p.thumbs === 0 && p.dots === 'visible' && p.order === NATIVE && !/o-thumbs|o-cta-inview|o-choosing/.test(p.classes) && !p.galTop);
  check(`[${sc.name}] PDP ${e.pdp ? 'LIGADA' : 'desligada'}`, pdpOk, JSON.stringify(p));
  const c = await cartWidth(page);
  check(`[${sc.name}] carrinho ${e.cart ? 'LIGADO' : 'desligado'}`, e.cart ? (c.w === 440 && c.font === 'Hanken Grotesk' && c.empty) : (c.w === 390 && !c.empty), JSON.stringify(c));
  const k = await checkoutAttr(page);
  if (k) check(`[${sc.name}] checkout ${e.checkout ? 'LIGADO' : 'desligado'}`, e.checkout ? (k.attr === 'checkout' && k.brand && !k.loader) : (!k.attr && !k.brand && !k.loader), JSON.stringify(k));
  await s.ctx.close(); await H.close();
}

if (!argv.includes('--rapido')) {
  // Mudança de configuração NO MEIO da sessão: PDP ligada → painel desliga a PDP → (cache do Worker: 60 s) → visita Turbo, voltar (cache do Turbo), recarregar.
  const config = theme({ pdp: true, cart: true });
  const H = await createHarness({ config });
  const s = await H.session({ name: 'desktop', width: 1440, height: 900 });
  const { page } = s;
  await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 }); await H.acceptCookies(page); await wait(page, 1500);
  let p = await probe(page);
  check('[mudança no meio] antes: PDP ligada', p.thumbs > 1 && /pdp/.test(p.attr || ''), JSON.stringify({ attr: p.attr, thumbs: p.thumbs }));
  config.surfaces.pdp = false; // "publicar" com a PDP desligada
  console.log('INFO aguardando 62 s (cache de 60 s da configuração no Worker)…');
  await wait(page, 62000);
  // Visita Turbo para outra PDP (a mesma API que os links da INK usam; não depende do bloco de recomendações ter carregado).
  const turboOk = await page.evaluate((u) => { if (!window.Turbo || typeof window.Turbo.visit !== 'function') return false; window.Turbo.visit(u); return true; }, H.HOST + OTHER_PDP);
  check('[mudança no meio] Turbo disponível na página da INK', turboOk);
  await page.waitForURL((u) => u.pathname !== DEFAULT_PDP, { timeout: 30000 }).catch(() => {});
  await wait(page, 2500);
  p = await probe(page);
  // A proteção não depende de o Turbo manter ou trocar o <link> antigo: o que vale é o atributo do <body> da resposta nova (o detalhe só é registrado).
  check('[mudança no meio] visita Turbo seguinte: PDP desligada', !/pdp/.test(p.attr || '') && p.thumbs === 0 && p.font !== 'Hanken Grotesk' && p.order === NATIVE, JSON.stringify({ ...p, linkAntigoRetido: p.links.includes('pdp,cart') }));
  await page.goBack({ waitUntil: 'networkidle' }).catch(() => {}); await wait(page, 2000);
  p = await probe(page);
  check('[mudança no meio] voltar (página restaurada do cache do Turbo): continua desligada', !/pdp/.test(p.attr || '') && p.thumbs === 0 && p.font !== 'Hanken Grotesk', JSON.stringify(p));
  await page.reload({ waitUntil: 'networkidle' }); await wait(page, 1500);
  p = await probe(page);
  check('[mudança no meio] recarregar: desligada', !/pdp/.test(p.attr || '') && p.thumbs === 0, JSON.stringify({ attr: p.attr, thumbs: p.thumbs }));
  config.surfaces.pdp = true;
  console.log('INFO religando; aguardando 62 s…');
  await wait(page, 62000);
  await page.reload({ waitUntil: 'networkidle' }); await wait(page, 1500);
  p = await probe(page);
  check('[mudança no meio] religada: volta, uma grade só', /pdp/.test(p.attr || '') && p.thumbs > 1 && (await page.evaluate(() => document.querySelectorAll('[data-origens-thumbs]').length)) === 1, JSON.stringify({ attr: p.attr, thumbs: p.thumbs }));
  await s.ctx.close(); await H.close();
}
console.log(results.filter(Boolean).length + '/' + results.length + ' PASS');
process.exit(results.every(Boolean) ? 0 : 1);
