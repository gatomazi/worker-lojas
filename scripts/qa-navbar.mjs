#!/usr/bin/env node
// QA da navbar da INK (header-nav) em navegador real contra a página REAL da INK, sem publicar nada.
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-navbar.mjs
// O Worker de produção ainda não tem a rota /__origens/navbar nem o loader 4.4: este script troca o loader ativo da página pelo build LOCAL
// (só header-nav + cart-mirror) e responde a configuração da navbar e o cart-ref por page.route (nenhum KV real é escrito, nada de rede
// para o storefront). Sessão anônima descartável; não abre checkout. Capturas em docs/evidence/navbar-ink-search/.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { buildLoaderSource } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const HOST = 'https://www.usesul.com.br';
const PATH = '/usesul/product/paranaense-essencia';
const OUT = new URL('../docs/evidence/navbar-ink-search/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const CONFIG = { v: 1, collections: ['Seu Lugar', 'Do Nosso Jeito', 'Da Nossa Terra', 'Feito Para Você', 'Fala Daqui', 'Kits', 'Novidades'].map((name) => ({ name, slug: name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ /g, '-') })) };
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const LOADER = buildLoaderSource([], ['header-nav', 'cart-mirror'], 'product-catalog');

for (const [w, vp] of [['1280', { width: 1280, height: 800 }], ['390', { width: 390, height: 844 }], ['320', { width: 320, height: 640 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const our = [];
  await page.route('**/__origens/navbar', (route) => { our.push('navbar'); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIG) }); });
  await page.route('**/__origens/cart-ref', (route) => { our.push('cart-ref'); route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }) }); });
  for (const blocked of ['googletagmanager.com', 'google-analytics.com', 'facebook.net', 'tiktok.com', 'clarity.ms']) await page.route('**/*' + blocked + '*/**', (route) => route.abort());
  await page.goto(HOST + PATH, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  const sw0 = await page.evaluate(() => document.documentElement.scrollWidth); // a própria página da INK já transborda em 320/390: o critério é NÃO piorar
  await page.evaluate(() => { delete window.__useOrigensLoader; delete window.__useOrigens; });
  await page.addScriptTag({ content: LOADER }); await page.waitForTimeout(1500);
  const mounted = await page.evaluate(() => ({ nav: document.querySelectorAll('header [data-origens-nav]').length, forms: document.querySelectorAll('#o-nav-search').length, ver: window.__useOrigensLoader }));
  check(`[${w}] header montado uma vez (loader ${mounted.ver}), 1 formulário de busca`, mounted.nav > 0 && mounted.forms === 1);
  const geometry = () => page.evaluate(() => {
    const vis = (e) => e && e.getClientRects().length > 0;
    const box = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), r: Math.round(b.right), y: Math.round(b.y), b: Math.round(b.bottom) }; };
    const top = document.querySelector('.navbar__top'); const items = top ? [...top.querySelectorAll('#menu-hamburger, .o-nav-logo, .o-nav-lupa, #shopping-cart-menu-mob')].filter(vis).map(box) : [];
    const desk = document.querySelector('[data-origens-nav="desktop"]'); const deskItems = desk && vis(desk) ? [...desk.querySelectorAll('.o-nav-logo, .o-nav-links a, .o-nav-lupa'), ...document.querySelectorAll('.menu-icons')].filter(vis).map(box) : [];
    const overlap = (list) => list.some((a, i) => list.some((c, j) => j > i && a.x < c.r - 1 && c.x < a.r - 1 && a.y < c.b - 1 && c.y < a.b - 1));
    return { vw: innerWidth, sw: document.documentElement.scrollWidth, mobileOverlap: overlap(items), deskOverlap: overlap(deskItems), nativeSearchHidden: [...document.querySelectorAll('button[aria-label="Pesquisar"], #mobile_search, form[data-controller~="ink-store--input-search"]')].every((e) => !vis(e)), cart: vis(document.querySelector(innerWidth >= 1024 ? '.menu-icons' : '#shopping-cart-menu-mob')), account: !!document.querySelector('.menu-icons #menu-user-link, .menu-icons .menu-user') };
  });
  const g0 = await geometry();
  check(`[${w}] sem sobreposição no cabeçalho, sem pesquisa nativa visível, carrinho/conta nativos presentes, sem overflow novo (${sw0} -> ${g0.sw})`, !g0.mobileOverlap && !g0.deskOverlap && g0.nativeSearchHidden && g0.cart && (w !== '1280' || g0.account) && g0.sw <= Math.max(sw0, g0.vw) + 1, JSON.stringify(g0));
  await page.screenshot({ path: OUT + `cabecalho-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 200 } });

  const lupa = page.locator(w === '1280' ? '[data-origens-nav="desktop"] .o-nav-lupa' : '.navbar__top .o-nav-lupa');
  const before = our.length;
  await lupa.click(); await page.waitForTimeout(200);
  check(`[${w}] a lupa abre UM campo, com foco`, await page.evaluate(() => !document.getElementById('o-nav-search').hidden && document.activeElement === document.getElementById('o-nav-q')));
  await page.keyboard.type('Florianópolis', { delay: 40 }); await page.waitForTimeout(600);
  check(`[${w}] digitar não faz requisição nossa (0 novas)`, our.length === before, our.join(','));
  const g1 = await geometry(); check(`[${w}] busca aberta sem sobreposição e sem overflow novo`, !g1.mobileOverlap && g1.sw <= Math.max(sw0, g1.vw) + 1, JSON.stringify(g1));
  await page.screenshot({ path: OUT + `busca-aberta-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 240 } });
  const href = await page.getAttribute('.o-nav-go', 'href');
  check(`[${w}] destino = /sul/busca?q= com a consulta codificada`, href === 'https://useorigens.com.br/sul/busca?q=Florian%C3%B3polis', href);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(`[${w}] Escape fecha e devolve o foco à lupa`, await page.evaluate(() => document.getElementById('o-nav-search').hidden && document.activeElement.classList.contains('o-nav-lupa')));
  await lupa.click(); await page.fill('#o-nav-q', '   '); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  check(`[${w}] vazio/espaços não navegam e devolvem o foco ao campo`, page.url().startsWith(HOST) && await page.evaluate(() => document.activeElement === document.getElementById('o-nav-q')));
  if (w !== '1280') {
    await page.keyboard.press('Escape');
    await page.click('#menu-hamburger'); await page.waitForTimeout(400);
    const menu = await page.evaluate(() => { const list = document.getElementById('navbar-list-mobile'); const ours = document.querySelector('[data-origens-nav="menu"]'); const acct = list && [...list.querySelectorAll('a')].find((a) => /Entrar|Sair|Dashboard/i.test(a.textContent)); const b = (e) => e && e.getBoundingClientRect(); return { open: list && list.getClientRects().length > 0, searchClosed: document.getElementById('o-nav-search').hidden, ours: !!ours, oursBottom: ours && Math.round(b(ours).bottom), acctTop: acct && Math.round(b(acct).top) }; });
    check(`[${w}] menu lateral abre sem a busca junto; coleções no topo`, menu.open && menu.searchClosed && menu.ours, JSON.stringify(menu));
    await page.screenshot({ path: OUT + `menu-lateral-${w}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks`); process.exit(results.every(Boolean) ? 0 : 1);
