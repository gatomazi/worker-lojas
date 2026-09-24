#!/usr/bin/env node
// QA do carrinho com MUITOS itens (variantes diferentes da Serra: cada combinação de modelo/cor/tamanho vira uma linha).
//   PW_PATH=/tmp/pw node scripts/qa-cart-many.mjs <desktop|mobile> [--width N] [--items 8] [--out docs/evidence/cart] [--live]
// Worker/KV LOCAIS (sem --live), sessão anônima descartável, janela visível. Não abre checkout, não aceita cookies.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const LIVE = process.argv.includes('--live');
const { Miniflare } = LIVE ? { Miniflare: null } : await import(process.env.MINIFLARE || 'miniflare');
const mode = process.argv[2] || 'desktop';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WIDTH = Number(arg('--width', mode === 'mobile' ? 390 : 1280)); const mobile = WIDTH < 768;
const N = Number(arg('--items', 8)); const out = arg('--out', 'docs/evidence/cart'); mkdirSync(out, { recursive: true });
const label = arg('--width') ? 'w' + WIDTH : mode;
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense';
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
const mf = LIVE ? null : new Miniflare({ modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'],
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: P, WIDGET_FEATURES: 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror' },
  outboundService: async (req) => (new URL(req.url).host === 'useorigens.com.br' ? new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } }) : new Response('no', { status: 404 })) });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: WIDTH, height: WIDTH < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' } : { viewport: { width: WIDTH, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage(); const refs = []; const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
if (!LIVE) await page.route('**/__origens/**', async (route) => { const req = route.request(); const url = new URL(req.url()); const h = req.headers();
  const res = await mf.dispatchFetch(url.href, { method: req.method(), headers: { 'content-type': h['content-type'] || '', origin: h['origin'] || '', referer: h['referer'] || '', 'sec-fetch-site': h['sec-fetch-site'] || '' }, body: req.method() === 'POST' ? req.postDataBuffer() : undefined });
  const buf = Buffer.from(await res.arrayBuffer()); if (url.pathname === '/__origens/cart-ref' && req.method() === 'POST') { try { const j = JSON.parse(buf.toString()); if (j.ref) refs.push(j.ref); } catch (_) { /* ignora */ } }
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: buf }); });
const wait = (ms) => page.waitForTimeout(ms); const shot = (n) => page.screenshot({ path: `${out}/after-cart-n${N}-${n}-${label}${LIVE ? '-live' : ''}.jpg`, type: 'jpeg', quality: 62 });

const COMBOS = [['Masculino', 'Preta', 'M'], ['Masculino', 'Preta', 'G'], ['Masculino', 'Branca', 'M'], ['Masculino', 'Marinho', 'P'], ['Feminino', 'Preta', 'M'], ['Feminino', 'Branca', 'GG'], ['Masculino', 'Cinza', 'M'], ['Masculino', 'Verde', 'G'], ['Masculino', 'Vermelho', 'M'], ['Masculino', 'Amarelo', 'G'], ['Feminino', 'Rosa', 'M'], ['Masculino', 'Bordeaux', 'P']];
await page.goto(HOST + P, { waitUntil: 'load' }); await wait(3500);
let added = 0;
for (const [model, color, size] of COMBOS) {
  if (added >= N) break;
  await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
  for (const id of ['4932916-model-' + model, '4932916-color-' + color, '4932916-size-' + size]) await page.evaluate((i) => document.getElementById(i)?.labels[0].click(), id);
  await wait(500);
  const ok = await page.evaluate(() => Number(document.getElementById('product-variant-id-4932916')?.value) > 0);
  if (!ok) { console.log('INFO variante indisponível, pulando:', model, color, size); continue; }
  const before = await page.evaluate(() => Number(document.getElementById('quantity-header')?.getAttribute('data-quantityheader') || 0));
  await page.evaluate((s) => document.querySelector(s).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
  await page.waitForFunction((b) => Number(document.getElementById('quantity-header')?.getAttribute('data-quantityheader') || 0) > b, before, { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(700);
  await page.evaluate(() => document.getElementById('modal-close-button')?.click()); await wait(500);
  added++;
}
check('carrinho montado com ' + N + ' variantes diferentes (linhas distintas)', added === N, 'adicionadas=' + added);
// Estado NATIVO da INK lido do DOM (somente leitura) com o drawer FECHADO: ainda não existe nenhum bloco nosso.
const NATIVE = () => page.evaluate(() => {
  const f = document.querySelector('.cart-drawer turbo-frame#cart'); const foot = f.querySelector('.footer-details');
  const totalLabel = [...foot.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Total'); const totalEl = totalLabel && totalLabel.nextElementSibling && totalLabel.nextElementSibling.querySelector('p');
  return {
    count: document.getElementById('quantity-header')?.getAttribute('data-quantityheader'), amount: document.getElementById('amount')?.textContent.trim(),
    subtotalAttr: foot.getAttribute('data-ink-store--cart-subtotal-value'), discountAttr: foot.getAttribute('data-ink-store--cart-discount-value'), total: totalEl ? totalEl.textContent.trim() : null,
    footerText: foot.textContent.replace(/\s+/g, ' ').trim(),
    lines: [...f.querySelectorAll('li.main-list__item')].map((li) => ({ eff: [...li.querySelectorAll('.price-details span')].filter((x) => !x.querySelector('del') && !x.closest('del')).pop()?.textContent.trim(), list: li.querySelector('.price-details del')?.textContent.trim() || null, qty: li.querySelector('input[name="cart_item[quantity]"]')?.value, name: li.querySelector('.item-details p')?.textContent.trim() }))
  };
});
const nativeBefore = await NATIVE();
console.log('INFO estado nativo antes do bloco:', JSON.stringify({ count: nativeBefore.count, subtotal: nativeBefore.subtotalAttr, discount: nativeBefore.discountAttr, total: nativeBefore.total, promoLines: nativeBefore.lines.filter((l) => l.list).length + '/' + nativeBefore.lines.length }));
await page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); });
await page.waitForSelector('.cart-drawer.open [data-origens-discovery="cart"]', { timeout: 20000 }); await wait(1500);
const G = () => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
  const d = document.querySelector('.cart-drawer'); const f = d.querySelector('turbo-frame#cart'); const main = f.querySelector('.cart-drawer__main'); const foot = f.querySelector('.cart-drawer__footer'); const btn = document.getElementById('checkout-btn'); const root = d.querySelector('[data-origens-discovery="cart"]'); const rows = [...f.querySelectorAll('li.main-list__item')];
  const hs = () => document.documentElement.scrollWidth; const w1 = hs(); const wI = () => (rows[0] ? Math.round(rows[0].getBoundingClientRect().width) : null);
  const wItem = wI();
  // "invisível mas ocupando o mesmo espaço": separa o que o NOSSO elemento faz (squeeze) do que é a barra de rolagem nativa da INK
  if (root) root.style.visibility = 'hidden'; const wItemHiddenSameBox = wI(); if (root) root.style.visibility = '';
  if (root) root.style.display = 'none'; const w0 = hs(); const wItem0 = wI(); if (root) root.style.display = '';
  const b = btn.getBoundingClientRect(); const mr = main.getBoundingClientRect(); const rr = root && root.getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, items: rows.length, roots: d.querySelectorAll('[data-origens-discovery="cart"]').length, header: document.getElementById('quantity-header')?.textContent.trim(), mainScroll: main.scrollHeight + '/' + main.clientHeight, mainScrollTop: Math.round(main.scrollTop), main: r(main), footer: r(foot), checkout: r(btn),
    checkoutVisible: b.top >= 0 && b.bottom <= innerHeight && b.height > 0, rootLast: !!root && root.parentElement === root.parentElement.parentElement.lastElementChild, rootInView: !!rr && rr.top >= mr.top - 1 && rr.bottom <= mr.bottom + 1, dense: !!root && root.classList.contains('o-dense'), inputInView: (() => { const i = root && root.querySelector('.o-input'); if (!i || i.closest('[hidden]')) return null; const ir = i.getBoundingClientRect(); return ir.top >= mr.top - 1 && ir.bottom <= mr.bottom + 1; })(), firstResultInView: (() => { const i = root && root.querySelector('.o-item'); if (!i) return null; const ir = i.getBoundingClientRect(); return ir.top >= mr.top - 1 && ir.bottom <= mr.bottom + 1; })(), rootFirst: !!root && root.parentElement === root.parentElement.parentElement.firstElementChild, rootTopInMain: rr ? Math.round(rr.top - mr.top) : null, itemW: wItem, itemW0: wItem0, itemWSameBox: wItemHiddenSameBox, hs: w1, hs0: w0 };
});
let g = await G();
check(N + ' linha(s), exatamente 1 bloco, ' + (N >= 3 ? 'no TOPO da lista em versão densa' : 'no FIM da lista, depois dos itens (versão normal)'), g.items === N && g.roots === 1 && (N >= 3 ? g.rootFirst && g.dense : g.rootLast && !g.dense), JSON.stringify({ items: g.items, roots: g.roots, header: g.header, first: g.rootFirst, last: g.rootLast, dense: g.dense }));
if (N >= 3) check('o bloco fica visível SEM rolar a lista (acima da dobra do painel de itens)', g.rootInView, 'rootTopInMain=' + g.rootTopInMain + ' area=' + (g.main.bottom - g.main.top));
check('"Finalizar compra" visível' + (N >= 6 ? ' e a lista rola dentro do painel de itens' : ''), g.checkoutVisible && (N < 6 || Number(g.mainScroll.split('/')[0]) > Number(g.mainScroll.split('/')[1])), 'mainScroll=' + g.mainScroll + ' checkout=' + JSON.stringify(g.checkout));
const baseFooter = g.footer; const baseCheckout = g.checkout;
const nativeOpen = await NATIVE();
check('subtotal, desconto, total e preços das linhas IDÊNTICOS ao estado nativo de antes do bloco (nada alterado por nós)', JSON.stringify(nativeOpen) === JSON.stringify(nativeBefore), JSON.stringify({ subtotal: nativeOpen.subtotalAttr, discount: nativeOpen.discountAttr, total: nativeOpen.total }));
if (nativeBefore.lines.some((l) => l.list)) check('promoção por quantidade (somente leitura): linhas com preço cheio riscado + preço efetivo; subtotal, desconto e total exibidos pela INK presentes', nativeBefore.lines.every((l) => !l.list || /^R\$/.test(l.list)) && nativeBefore.lines.every((l) => /^R\$/.test(l.eff || '')) && !!nativeBefore.total && Number(nativeBefore.discountAttr) > 0, JSON.stringify(nativeBefore.lines[0]));
else console.log('INFO sem promoção por quantidade neste carrinho (' + N + ' peça(s)): preços efetivos =', nativeBefore.lines.map((l) => l.eff).join(' | '));
check('sem overflow horizontal novo causado pelo bloco', g.hs === g.hs0, g.hs + ' vs ' + g.hs0);
check('item nativo NÃO é espremido pelo nosso bloco (largura igual com o bloco visível e com o bloco invisível ocupando o mesmo espaço)', g.itemW === g.itemWSameBox, g.itemW + ' vs ' + g.itemWSameBox);
if (g.itemW !== g.itemW0) console.log('INFO barra de rolagem NATIVA do painel de itens apareceu por causa da ALTURA acrescentada (largura do item ' + g.itemW0 + ' → ' + g.itemW + ' px; só com barras de rolagem clássicas, sem efeito em barras overlay)');
console.log('INFO no topo da lista o bloco está abaixo da dobra? rootInView=' + g.rootInView + ' rootTopInMain=' + g.rootTopInMain + ' (altura da área de itens ' + (g.main.bottom - g.main.top) + ')');
await shot('top');
// alcançar o bloco rolando a lista, abrir a busca e ver resultados
await page.evaluate(() => { const m = document.querySelector('.cart-drawer__main'); m.scrollTop = m.scrollHeight; }); await wait(300);
await page.evaluate(() => document.querySelector('.cart-drawer [data-origens-discovery="cart"]').scrollIntoView({ block: 'nearest' })); await wait(500);
g = await G(); check('mesmo depois de rolar a lista e voltar, o bloco segue íntegro e alcançável', g.roots === 1, JSON.stringify({ top: g.rootTopInMain }));
await shot('block');
await page.locator('.cart-drawer [data-origens-discovery="cart"] .o-toggle').click(); await wait(300); await page.mouse.move(1, 1);
await page.locator('.cart-drawer .o-input').type('floripa', { delay: 40 }); await page.waitForSelector('.cart-drawer .o-item', { timeout: 8000 }); await wait(500);
await page.evaluate(() => document.querySelector('.cart-drawer [data-origens-discovery="cart"]').scrollIntoView({ block: 'nearest' })); await wait(400);
g = await G(); await shot('search-results');
check('busca aberta com resultados no meio de 8 itens: campo e 1º resultado utilizáveis (visíveis) no painel; rodapé e checkout imóveis', g.inputInView === true && g.firstResultInView === true && g.checkoutVisible && JSON.stringify(g.footer) === JSON.stringify(baseFooter) && JSON.stringify(g.checkout) === JSON.stringify(baseCheckout), JSON.stringify({ inputInView: g.inputInView, firstResultInView: g.firstResultInView, rootInView: g.rootInView, area: g.main.bottom - g.main.top }));
await page.locator('.cart-drawer .o-close').click(); await wait(400);
const nativeAfterSearch = await NATIVE();
check('depois de abrir/usar/fechar a busca: estado nativo continua idêntico (subtotal, desconto, total, preços)', JSON.stringify(nativeAfterSearch) === JSON.stringify(nativeBefore));
// mutações nativas com 8 linhas: + na 1ª linha, − até remover uma linha
await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="increment"]').click()); await wait(2500);
g = await G(); check('quantidade + na 1ª linha (re-render do frame com ' + N + ' itens): continua 1 bloco, checkout visível', g.roots === 1 && g.checkoutVisible && new RegExp('\\(' + (N + 1) + ' produtos\\)').test(g.header), g.header);
for (let i = 0; i < 2; i++) { await page.evaluate(() => document.querySelector('turbo-frame#cart li.main-list__item button[data-action*="decrement"]').click()); await wait(2200); }
g = await G(); check('remover uma linha (lixeira nativa): ' + (N - 1) + ' itens, 1 bloco, checkout visível' + ((N - 1) < 3 && N >= 3 ? ', bloco volta ao FIM da lista' : ''), g.items === N - 1 && g.roots === 1 && g.checkoutVisible && (N - 1 >= 3 ? g.rootFirst : g.rootLast), JSON.stringify({ items: g.items, header: g.header, first: g.rootFirst, last: g.rootLast }));
// espelho com N itens (Worker/KV locais)
if (!LIVE) {
  await wait(1500); const ref = refs[refs.length - 1]; const snap = ref ? await (await mf.dispatchFetch(HOST + '/__origens/cart-ref/' + ref)).json() : null;
  const dom = await page.evaluate(() => [...document.querySelectorAll('turbo-frame#cart li.main-list__item')].map((li) => { const p = [...li.querySelectorAll('.item-details p')].map((x) => x.textContent.trim()); return { name: p[0], color: p[1], size: p[2], qty: Number(li.querySelector('input[name="cart_item[quantity]"]').value), price: [...li.querySelectorAll('.price-details span')].filter((x) => !x.querySelector('del') && !x.closest('del')).pop().textContent.trim(), listPrice: (li.querySelector('.price-details del') || {}).textContent ? li.querySelector('.price-details del').textContent.trim() : '', variant: li.querySelector('form[data-ink-store--cart-product-id-value]').getAttribute('data-ink-store--cart-product-variant-value') }; }));
  check('espelho: snapshot com ' + (N - 1) + ' itens, iguais (nome, cor, tamanho, qtd, preço, variante) ao carrinho real', snap && snap.items.length === dom.length && dom.every((d, i) => snap.items[i].name === d.name && snap.items[i].color === d.color && snap.items[i].size === d.size && snap.items[i].quantity === d.qty && snap.items[i].linePriceText === d.price && (snap.items[i].listPriceText || '') === d.listPrice && snap.items[i].variant === d.variant), JSON.stringify({ snap: snap && snap.items.length, dom: dom.length, count: snap && snap.count }));
  const domTotals = await page.evaluate(() => { const f = document.querySelector('.cart-drawer turbo-frame#cart .footer-details'); const l = [...f.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Total'); return { total: l && l.nextElementSibling && l.nextElementSibling.querySelector('p') ? l.nextElementSibling.querySelector('p').textContent.trim() : null, subtotal: Number(f.getAttribute('data-ink-store--cart-subtotal-value')), discount: Number(f.getAttribute('data-ink-store--cart-discount-value')) }; });
  check('espelho: subtotal, desconto e TOTAL exibido iguais aos da INK (lidos, nunca calculados)', snap && snap.subtotal === domTotals.subtotal && snap.discount === domTotals.discount && snap.totalText === domTotals.total, JSON.stringify({ snap: snap && { s: snap.subtotal, d: snap.discount, t: snap.totalText }, dom: domTotals }));
  console.log('INFO promoção por quantidade: linhas com preço cheio riscado =', dom.filter((d) => d.listPrice).length + '/' + dom.length);
  check('espelho: variantes distintas preservadas (' + new Set(dom.map((d) => d.variant)).size + ' variantes)', snap && new Set(snap.items.map((i) => i.variant)).size === dom.length);
}
const ours = errors.filter((e) => /use.?origens|origens-discovery|__origens/i.test(e)); check('console: nenhum erro atribuível ao nosso código', ours.length === 0, ours.join(' | '));
await browser.close(); if (mf) await mf.dispose();
console.log('RESUMO qa-cart-many ' + label + ': ' + results.filter(Boolean).length + ' PASS, ' + results.filter((x) => !x).length + ' FAIL');
process.exit(results.every(Boolean) ? 0 : 1);
