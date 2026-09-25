#!/usr/bin/env node
// QA PRÉ-DEPLOY do drawer contra a página REAL da INK, sem publicar nada: o navegador carrega o HTML/JS/carrinho reais
// de www.usesul.com.br, mas as requisições /__origens/* são atendidas por um Worker LOCAL (Miniflare/workerd) com o build atual.
//   PW_PATH=/tmp/pw node scripts/qa-drawer.mjs <desktop|mobile> [--out docs/evidence/drawer] [--tag after]
// Sessão anônima descartável, janela visível; não abre checkout; no mobile o banner de cookies não é aceito (clique programático).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const { Miniflare } = process.argv.includes('--live') ? { Miniflare: null } : await import(process.env.MINIFLARE || 'miniflare');

const mode = process.argv[2] || 'desktop';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'docs/evidence/drawer'); const tag = arg('--tag', 'after');
mkdirSync(out, { recursive: true });
const HOST = 'https://www.usesul.com.br'; const P = '/usesul/product/serra-catarinense'; const OTHER = '/usesul/product/vida-no-sul-estancia-edition';
const WIDTH = Number(arg('--width', mode === 'mobile' ? 390 : 1280));
const LIVE = process.argv.includes('--live'); // contra a produção REAL (sem Worker local nem interceptação)
const mobile = WIDTH < 768;
const label = arg('--width') ? 'w' + WIDTH : mode;
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };

const mf = LIVE ? null : new Miniflare({
  modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01',
  bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: P, WIDGET_FEATURES: 'return-link,post-add-discovery,city-search' },
  // Storefront REAL para o índice de cidades; nada mais sai do Worker local.
  // Índice de cidades: storefront REAL; se ele estiver indisponível neste momento, cai no snapshot real versionado (test/fixtures/search).
  outboundService: async (req) => {
    if (new URL(req.url).host !== 'useorigens.com.br') return new Response('no', { status: 404 });
    try { const r = await fetch(req.url, { headers: { accept: 'application/json' } }); if (r.ok) return r; } catch (_) { /* cai no snapshot */ }
    console.log('INFO storefront indisponível agora: índice servido pelo snapshot real versionado');
    return new Response(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url)), { headers: { 'content-type': 'application/json' } });
  }
});
let searchMode = 'ok'; const searchLog = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: WIDTH, height: WIDTH < 360 ? 640 : 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'pt-BR' } : { viewport: { width: WIDTH, height: WIDTH >= 1024 ? 900 : 1024 }, locale: 'pt-BR' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
page.on('request', (r) => { if (new URL(r.url()).pathname === '/__origens/search') r.allHeaders().then((h) => searchLog.push({ q: new URL(r.url()).searchParams.get('q'), cookie: h['cookie'] || null, authorization: h['authorization'] || null })); });
if (!LIVE) {
await page.route('**/__origens/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/__origens/search') {
        if (searchMode === 'error') return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"unavailable"}' });
  }
  const res = await mf.dispatchFetch(url.href, { method: route.request().method() });
  await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
});

}

const shot = (name) => page.screenshot({ path: `${out}/${tag}${LIVE ? '-live' : ''}-${name}-${label}.jpg`, type: 'jpeg', quality: 62 });
const R = () => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const w = document.getElementById('modal-wrapper'); const root = w && w.querySelector('[data-origens-discovery]');
  const ver = w && w.querySelector('.checkout-btn'); const cont = w && w.querySelector('#continue-shopping-button'); const sold = w && w.querySelector('#most_sold_frame');
  const inter = (a, b) => a && b && !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
  const hs = () => document.documentElement.scrollWidth; const hWith = hs(); if (root) root.style.display = 'none'; const hWithout = hs(); if (root) root.style.display = '';
  return { vw: innerWidth, vh: innerHeight, hScroll: hWith, hScrollWithout: hWithout, wrapper: r(w), wrapperScroll: w ? w.scrollHeight + '/' + w.clientHeight : null, root: r(root), ver: r(ver), cont: r(cont), sold: r(sold),
    input: r(root && root.querySelector('.o-input')), cta: r(root && root.querySelector('.o-cta')),
    rootVsVer: inter(r(root), r(ver)), rootVsCont: inter(r(root), r(cont)), rootVsSold: inter(r(root), r(sold)),
    verVisible: !!ver && r(ver).bottom <= innerHeight && r(ver).top >= 0, roots: document.querySelectorAll('[data-origens-discovery]').length, styles: document.querySelectorAll('style[data-origens-discovery-style]').length };
});
const cartLen = () => page.evaluate(async () => (await (await fetch('/usesul/cart', { headers: { Accept: 'text/html' } })).text()).length);

await page.goto(HOST + P, { waitUntil: 'load' }); await page.waitForTimeout(3500);
check((LIVE ? 'loader de PRODUÇÃO' : 'build local do loader') + ' ativo na página real (v' + LOADER_VERSION + ')', (await page.evaluate(() => window.__useOrigensLoader)) === LOADER_VERSION);
check('link "← Voltar a procurar" segue presente (1)', (await page.locator('#use-origens-return-link').count()) === 1);
const mobileHs = mobile ? await page.evaluate(() => document.documentElement.scrollWidth) : null;

// As opções de variante da INK só carregam quando a área de compra entra na viewport (lazy).
await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click(); await page.locator('label[for="4932916-color-Preta"]').click(); await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForSelector('#modal-wrapper [data-origens-discovery]', { timeout: 20000 }); await page.waitForTimeout(1200);
let m = await R();
await shot('drawer');
check('bloco de descoberta montou exatamente 1x dentro do drawer real', m.roots === 1 && m.styles === 1, JSON.stringify({ roots: m.roots, styles: m.styles }));
check('ordem: botões nativos → nosso bloco → "As mais vendidas", sem sobreposição', m.ver && m.cont && m.root && m.sold && m.ver.bottom <= m.cont.top + 1 && m.cont.bottom <= m.root.top + 1 && m.root.bottom <= m.sold.top + 1 && !m.rootVsVer && !m.rootVsCont && !m.rootVsSold);
check('"Ver carrinho" continua visível na área útil (não empurrado para fora)', m.verVisible, 'ver=' + JSON.stringify(m.ver) + ' vh=' + m.vh);
check('campo de busca com alvo de toque >= 44 px (48)', m.input && m.input.h >= 44, 'h=' + (m.input && m.input.h));
check('CTA "Explorar todas as estampas" >= 44 px', m.cta && m.cta.h >= 44, 'h=' + (m.cta && m.cta.h));
if (mobile) check('mobile: nosso bloco não causa overflow horizontal (largura idêntica com e sem o bloco; overflow preexistente da INK)', m.hScroll === m.hScrollWithout, 'com=' + m.hScroll + ' sem=' + m.hScrollWithout + ' (medida inicial da página: ' + mobileHs + ')');
else check('desktop: sem overflow horizontal', m.hScroll <= m.vw, String(m.hScroll));
console.log('INFO medidas', JSON.stringify({ wrapper: m.wrapper, wrapperScroll: m.wrapperScroll, root: m.root, ver: m.ver, input: m.input }));

// ---- busca real (índice de useorigens.com.br) ----
const input = page.locator('[data-origens-discovery] .o-input');
await input.click(); await input.type('floripa', { delay: 40 }); await page.waitForSelector('[data-origens-discovery] .o-item', { timeout: 8000 }); await page.waitForTimeout(400);
const first = await page.evaluate(() => [...document.querySelectorAll('[data-origens-discovery] .o-item')].map((a) => a.querySelector('.o-name').textContent + ' | ' + a.getAttribute('href')));
await shot('search-results'); m = await R();
check('busca "floripa" → Florianópolis com link real do storefront', first[0] === 'Florianópolis | https://useorigens.com.br/sul/sc/florianopolis', JSON.stringify(first));
check('com resultados, "Ver carrinho" segue acessível e sem sobreposição', m.verVisible && !m.rootVsVer && !m.rootVsCont, JSON.stringify({ ver: m.ver, wrapperScroll: m.wrapperScroll }));
check('a requisição de busca foi same-origin e SEM Cookie/Authorization', searchLog.length >= 1 && searchLog.every((s) => s.cookie === null && s.authorization === null), JSON.stringify(searchLog.slice(0, 2)));
await input.fill(''); await input.type('sc', { delay: 40 }); await page.waitForTimeout(900);
check('busca "sc" → estado Santa Catarina primeiro', (await page.locator('[data-origens-discovery] .o-item .o-name').first().textContent()) === 'Santa Catarina');
await input.fill(''); await input.type('xyzq', { delay: 40 }); await page.waitForSelector('[data-origens-discovery] .o-status:not(:empty)'); await page.waitForTimeout(900);
await shot('search-empty');
check('estado vazio com mensagem e CTA visível', /Não encontramos essa cidade ou estado/.test(await page.locator('[data-origens-discovery] .o-status').textContent()) && (await page.locator('[data-origens-discovery] .o-cta').isVisible()));
// Erro da busca: local = gateway responde 502 pela rota; LIVE = a falha é simulada SÓ no navegador de teste (a rota é
// respondida com 502 no cliente; nada é derrubado na produção).
if (LIVE) await page.route('**/__origens/search*', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"unavailable"}' }));
else searchMode = 'error';
await input.fill(''); await input.type('curitiba', { delay: 40 }); await page.waitForTimeout(1200);
await shot('search-error');
check('estado de erro (gateway 502' + (LIVE ? ', simulado no cliente' : '') + ') com mensagem e CTA; drawer nativo intacto', /A busca não está disponível agora/.test(await page.locator('[data-origens-discovery] .o-status').textContent()) && (await page.locator('.checkout-btn').isVisible()));
if (LIVE) await page.unroute('**/__origens/search*'); else searchMode = 'ok';

// ---- teclado ----
await input.fill(''); await input.type('curitiba', { delay: 40 }); await page.waitForSelector('[data-origens-discovery] .o-item'); await page.waitForTimeout(300);
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
const active = await page.evaluate(() => document.querySelector('[data-origens-discovery] .o-input').getAttribute('aria-activedescendant'));
check('teclado: setas atualizam aria-activedescendant', !!active);
await page.keyboard.press('Escape'); await page.waitForTimeout(900);
const closedByEsc = await page.evaluate(() => !document.getElementById('modal-wrapper')?.getClientRects().length);
check('Esc segue para a INK (fecha o drawer nativo) e leva o bloco junto', closedByEsc && (await page.locator('[data-origens-discovery]').count()) === 0);
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForSelector('#modal-wrapper [data-origens-discovery]', { timeout: 20000 }); await page.waitForTimeout(800);
const input2 = page.locator('[data-origens-discovery] .o-input'); await input2.click();

// ---- ida ao storefront e volta na MESMA sessão ----
const before = await cartLen();
await page.mouse.move(1, 1); // ponteiro fora da lista: hover sobre uma linha a ativa (comportamento padrão de combobox)
await input2.fill(''); await input2.type('curitiba', { delay: 40 }); await page.waitForSelector('[data-origens-discovery] .o-item'); await page.waitForTimeout(300);
await Promise.all([page.waitForURL(/useorigens\.com\.br\/sul\/pr\/curitiba/, { timeout: 25000 }), page.keyboard.press('Enter')]);
const sf = await page.request.get(page.url());
check('Enter no resultado leva à página real da cidade no storefront (200)', sf.status() === 200, page.url() + ' ' + sf.status());
await page.goto(HOST + P, { waitUntil: 'load' }); await page.waitForTimeout(2500);
check('volta à INK na MESMA sessão: carrinho nativo preservado', (await cartLen()) === before, 'len ' + before + ' → ' + (await cartLen()));
check('depois da volta: 1 link, nenhum bloco (drawer fechado)', (await page.locator('#use-origens-return-link').count()) === 1 && (await page.locator('[data-origens-discovery]').count()) === 0);

// ---- fechamento nativo e Turbo com o drawer aberto ----
// As opções de variante da INK só carregam quando a área de compra entra na viewport (lazy).
await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => !!document.getElementById('4932916-model-Masculino'), null, { timeout: 30000 });
await page.locator('label[for="4932916-model-Masculino"]').click(); await page.locator('label[for="4932916-color-Preta"]').click(); await page.locator('label[for="4932916-size-M"]').click();
await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0);
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForSelector('#modal-wrapper [data-origens-discovery]', { timeout: 20000 }); await page.waitForTimeout(800);
check('segunda adição: continua exatamente 1 bloco (sem duplicar)', (await R()).roots === 1);
await page.evaluate(() => document.getElementById('modal-close-button').click()); await page.waitForTimeout(900);
m = await R();
check('fechar pelo X nativo remove o bloco e o estilo', m.roots === 0 && m.styles === 0, JSON.stringify({ roots: m.roots, styles: m.styles }));
await page.evaluate((sel) => document.querySelector(sel).click(), mobile ? '#add-to-cart-mob' : '#add-to-cart-desk');
await page.waitForSelector('#modal-wrapper [data-origens-discovery]', { timeout: 20000 }); await page.waitForTimeout(600);
await page.evaluate((p) => window.Turbo.visit(p), OTHER); await page.waitForURL('**' + OTHER, { timeout: 20000 }); await page.waitForTimeout(2500);
check('Turbo com o drawer aberto → produto NÃO permitido: 0 bloco, 0 link, 0 estilo', (await page.evaluate(() => document.querySelectorAll('[data-origens-discovery],#use-origens-return-link,style[data-origens-discovery-style]').length)) === 0);
await page.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); }, '#add-to-cart-desk'); await page.waitForTimeout(500);
await page.evaluate((p) => window.Turbo.visit(p), P); await page.waitForURL('**' + P, { timeout: 20000 }); await page.waitForTimeout(2500);
check('Turbo de volta à Serra: 1 link (1 → 0 → 1)', (await page.locator('#use-origens-return-link').count()) === 1);

const ours = errors.filter((e) => /use.?origens|origens-discovery|__origens/i.test(e));
check('console: nenhum erro atribuível ao nosso código', ours.length === 0, ours.join(' | '));
console.log('INFO erros preexistentes da INK:', [...new Set(errors.filter((e) => !/use.?origens|origens/i.test(e)).map((e) => e.slice(0, 60)))].join(' | '));
await browser.close(); if (mf) await mf.dispose();
console.log('RESUMO qa-drawer ' + label + ': ' + results.filter(Boolean).length + ' PASS, ' + results.filter((x) => !x).length + ' FAIL');
process.exit(results.every(Boolean) ? 0 : 1);
