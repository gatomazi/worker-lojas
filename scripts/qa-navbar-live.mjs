#!/usr/bin/env node
// QA da navbar da INK (header-nav + FAB de WhatsApp) em NAVEGADOR REAL contra a página REAL da INK. Só os cenários críticos (sem stress).
//   PW_PATH=/caminho/com/playwright-core node scripts/qa-navbar-live.mjs             -> AO VIVO (depois do deploy): Worker PUBLICADO, POST de cart-ref e leitura do KV VERDADEIROS
//   PW_PATH=... node scripts/qa-navbar-live.mjs --rehearse                           -> ENSAIO (antes do deploy): loader LOCAL injetado; /__origens/navbar e cart-ref respondidos por
//                                                                                       page.route com uma configuração de teste (nenhum KV real é escrito)
// Chamado por scripts/release-navbar.sh. Sessão ANÔNIMA descartável (o estado logado NÃO é coberto aqui: ver docs). NÃO faz compra: só adiciona UM item ao
// carrinho anônimo, abre o drawer e confere que "Finalizar compra" está visível e habilitado (nunca clica). Bloqueia as tags de analytics da INK.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLoaderSource, LOADER_VERSION } from '../src/loader-source.js';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const REHEARSE = process.argv.includes('--rehearse');
const HOST = 'https://www.usesul.com.br';
const SF = 'https://useorigens.com.br';
const PRODUCT = '/usesul/product/paranaense-essencia';
const OUT = ((process.env.QA_EVIDENCE_DIR || new URL('../docs/evidence/navbar-ink-search/live/', import.meta.url).pathname) + '/').replace(/\/+$/, '/'); mkdirSync(OUT, { recursive: true }); // sempre com barra final (o release passa o diretório sem ela)
const results = []; const failures = [];
const check = (n, ok, d = '') => { results.push(!!ok); if (!ok) failures.push(n); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + String(d).slice(0, 320) : '')); };
const info = (n) => console.log('INFO ' + n);
const REF_RE = /^[A-Za-z0-9_-]{22}$/;
const slugOf = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
const entries = (titles, base = 0) => titles.map((title, i) => ({ id: base + i + 1, title, slug: slugOf(title), order: i + 1 }));
// Configurações do ENSAIO. FIT: cabe tudo em 1280 (layout completo). LARGE: muitos no Topo (um deles "Novidades", só um nome) => apresentação compacta em 1280.
// Em Demais categorias uma lista longa (rola dentro do painel).
const STATES = [{ uf: 'PR', name: 'Paraná', path: '/sul/pr' }, { uf: 'SC', name: 'Santa Catarina', path: '/sul/sc' }, { uf: 'RS', name: 'Rio Grande do Sul', path: '/sul/rs' }];
const MORE = entries(['Personalizados', 'Pré-treino Raiz', 'Rio Grande do Sul', 'Santa Catarina', 'Paraná', 'Carnaval', 'Ruas de Origem', 'Fé de Origem', 'Cidades mais pedidas', 'Outra 1', 'Outra 2', 'Outra 3'], 100);
const REHEARSAL = { v: 2, states: STATES, top: entries(['Novidades', 'Seu Lugar', 'Do Nosso Jeito', 'Feito Para Você']), more: MORE };
const REHEARSAL_LARGE = { v: 2, states: STATES, top: entries(['Novidades', 'Seu Lugar', 'Do Nosso Jeito', 'Da Nossa Terra', 'Feito Para Você', 'Fala Daqui', 'Kits', 'Parceiros']), more: MORE };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.QA_HEADED !== '1' });
const wait = (page, ms) => page.waitForTimeout(ms);
let expected = null; // a configuração que a página DEVE mostrar (ensaio: a de teste; ao vivo: a do Worker)

async function session(viewport, cfg = REHEARSAL) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' });
  await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms/, (r) => r.abort());
  const page = await ctx.newPage();
  const s = { ctx, page, ours: [], posts: [], sfDocs: [], cfg };
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host === 'www.usesul.com.br' && u.pathname.startsWith('/__origens/')) { s.ours.push(req.method() + ' ' + u.pathname); if (req.method() === 'POST' && u.pathname === '/__origens/cart-ref') s.posts.push(Date.now()); }
    if (u.host === 'useorigens.com.br' && req.resourceType() === 'document') s.sfDocs.push(req.url());
  });
  if (REHEARSE) {
    await page.route('**/__origens/navbar', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) }));
    await page.route('**/__origens/cart-ref', (r) => r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ref: 'AbCdEfGhIjKlMnOpQrStUv', ttl: 1800 }) }));
    await page.route(SF + '/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Buscar estampas (stub do ensaio)</h1></body></html>' }));
  }
  return s;
}
async function openProduct(s, path = PRODUCT) {
  await s.page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await s.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 });
  if (REHEARSE) { await s.page.evaluate(() => { delete window.__useOrigensLoader; delete window.__useOrigens; }); await s.page.addScriptTag({ content: buildLoaderSource([], ['header-nav', 'cart-mirror'], 'product-catalog') }); }
  await s.page.waitForSelector('header [data-origens-nav]', { timeout: 25000 }).catch(() => {});
  await wait(s.page, 800);
}
const acceptNotice = async (page) => { const n = page.locator('.cookie-acceptance button'); if (await n.count() && await n.first().isVisible()) { await n.first().click(); await wait(page, 400); } };
const geometry = (page) => page.evaluate(() => {
  const vis = (e) => e && e.getClientRects().length > 0;
  const box = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, r: b.right, y: b.y, b: b.bottom }; };
  const overlap = (list) => list.some((a, i) => list.some((c, j) => j > i && a.x < c.r - 1 && c.x < a.r - 1 && a.y < c.b - 1 && c.y < a.b - 1));
  const top = document.querySelector('.navbar__top'); const mobile = top && vis(top) ? [...top.querySelectorAll('#menu-hamburger, .o-nav-logo, .o-nav-lupa, #shopping-cart-menu-mob')].filter(vis).map(box) : [];
  const desk = document.querySelector('[data-origens-nav="desktop"]');
  const deskItems = desk && vis(desk) ? [...desk.querySelectorAll('.o-nav-logo, .o-nav-full > *, .o-nav-compact .o-dd-btn, .o-nav-links > a, .o-nav-lupa'), ...document.querySelectorAll('.menu-icons')].filter(vis).map(box) : [];
  const logo = document.querySelector('.navbar__top .o-nav-logo'); const lb = logo && vis(logo) ? logo.getBoundingClientRect() : null;
  return { vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, overlap: overlap(mobile) || overlap(deskItems), nativeSearchHidden: [...document.querySelectorAll('button[aria-label="Pesquisar"], #mobile_search, form[data-controller~="ink-store--input-search"]')].every((e) => !vis(e)), cartVisible: vis(document.querySelector(innerWidth >= 1024 ? '.menu-icons' : '#shopping-cart-menu-mob')), loader: window.__useOrigensLoader, features: (window.__useOrigens || {}).features || [], logoCenterOffset: lb ? Math.round(Math.abs(lb.x + lb.width / 2 - document.documentElement.clientWidth / 2)) : null, compact: !!(desk && desk.hasAttribute('data-compact')) };
});
async function addToCart(page) {
  await page.evaluate(() => document.querySelector('#add-to-cart-desk')?.scrollIntoView({ block: 'center' }));
  const pid = await page.waitForFunction(() => { const m = document.querySelector('input[type=radio][id*="-model-"]'); return m ? m.id.split('-')[0] : null; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  for (const [g, prefer] of [['model', 'Masculino'], ['color', 'Preta'], ['size', 'M']]) {
    const id = await page.evaluate(({ pid, g, prefer }) => { const all = [...document.querySelectorAll('input[type=radio][id^="' + pid + '-' + g + '-"]')].filter((e) => !e.disabled); const pick = all.find((e) => e.id.endsWith('-' + prefer)) || all[0]; return pick && pick.id; }, { pid, g, prefer });
    await page.locator('label[for="' + id + '"]').click();
  }
  await page.waitForFunction((pid) => document.getElementById('product-variant-id-' + pid)?.value > 0, pid);
  await page.evaluate(() => document.querySelector('#add-to-cart-desk').click());
  await page.waitForSelector('#modal-wrapper .checkout-btn', { timeout: 20000 }); await wait(page, 2200);
}
// O KV é eventualmente consistente entre regiões: a chave recém-criada pode dar 404 por um tempo. Leitura com espera limitada (registrada).
async function readRef(ref, maxMs = 90000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < maxMs) { const r = await fetch(HOST + '/__origens/cart-ref/' + ref); last = r.status; if (r.status === 200) return { status: 200, body: await r.json(), ms: Date.now() - t0 }; await new Promise((res) => setTimeout(res, 3000)); }
  return { status: last, body: null, ms: Date.now() - t0 };
}
const fabInfo = (page) => page.evaluate(() => {
  const fab = document.getElementById('o-wa-fab'); const help = document.querySelector('[data-controller~="ink-store--help-button"]');
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  if (!fab) return { exists: false };
  const f = fab.getBoundingClientRect(); const h = help ? help.getBoundingClientRect() : null;
  return { exists: true, shown: vis(fab), href: fab.getAttribute('href'), target: fab.getAttribute('target'), rel: fab.getAttribute('rel'), size: [Math.round(f.width), Math.round(f.height)], aboveHelp: h ? f.bottom <= h.top + 0.5 : null, gap: h ? Math.round(h.top - f.bottom) : null, centerOffset: h ? Math.round(Math.abs(f.left + f.width / 2 - (h.left + h.width / 2))) : null, helpShown: vis(help), inViewport: f.top >= 0 && f.left >= 0 && f.right <= innerWidth && f.bottom <= innerHeight };
});
const nativeWa = (page) => page.evaluate(() => { const a = document.querySelector('a.wpp-floater'); return a ? a.getAttribute('href') : null; });


// Apresentação compacta: um único Menu ▾ com Regiões, Coleções e Demais categorias, com os MESMOS dados dos grupos.
async function compactChecks(page, w, cfg, shot) {
  await page.locator('[data-origens-nav="desktop"] .o-nav-compact .o-dd-btn').click();
  const menu = await page.evaluate(() => { const p = document.querySelector('.o-nav-compact .o-dd-panel'); const r = p.getBoundingClientRect(); return { open: !p.hidden, heads: [...p.querySelectorAll('.o-dd-h')].map((h) => h.textContent), links: p.querySelectorAll('a').length, inView: r.right <= innerWidth && r.left >= 0 && r.bottom <= innerHeight, scrolls: p.scrollHeight > p.clientHeight }; });
  check(`[${w}] Menu compacto abre e traz Regiões, Coleções e Demais categorias com os MESMOS dados dos grupos (rola por dentro se longo)`, menu.open && menu.inView && menu.heads.includes('Regiões') && menu.links === 4 + cfg.top.length + cfg.more.length, JSON.stringify(menu));
  if (shot) await page.screenshot({ path: OUT + shot, clip: { x: 0, y: 0, width: w, height: 560 } });
  await page.keyboard.press('Escape');
  check(`[${w}] Escape fecha o Menu compacto`, await page.evaluate(() => document.querySelector('.o-nav-compact .o-dd-panel').hidden));
}

try {
  // ── Desktop 1280 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const d = await session({ width: 1280, height: 800 });
  await openProduct(d);
  expected = REHEARSE ? REHEARSAL : await (await fetch(HOST + '/__origens/navbar')).json();
  const g0 = await geometry(d.page);
  check('[1280] navbar montada' + (REHEARSE ? ' (ENSAIO: loader local)' : ' pelo Worker PUBLICADO') + `: loader ${g0.loader}, header-nav ativa, 1 formulário de busca`, g0.loader === LOADER_VERSION && g0.features.includes('header-nav') && await d.page.locator('#o-nav-search').count() === 1, JSON.stringify({ loader: g0.loader, features: g0.features }));
  check('[1280] sem sobreposição, pesquisa nativa escondida, conta e carrinho nativos visíveis', !g0.overlap && g0.nativeSearchHidden && g0.cartVisible && await d.page.locator('.menu-icons #menu-user-link, .menu-icons .menu-user').count() > 0, JSON.stringify(g0));
  await d.page.screenshot({ path: OUT + 'desktop-fechado-1280.png', clip: { x: 0, y: 0, width: 1280, height: 200 } });

  const comp = await d.page.evaluate(() => { const full = document.querySelector('[data-origens-nav="desktop"] .o-nav-full'); const first = full && full.firstElementChild; return { firstLabel: first && first.querySelector('button') && first.querySelector('button').textContent.trim(), top: [...(full ? full.querySelectorAll(':scope > a') : [])].map((a) => [a.textContent, a.getAttribute('href')]), hasMore: !!(full && full.querySelector('[data-dd="demais"]')), last: (() => { const l = document.querySelector('[data-origens-nav="desktop"] .o-nav-links'); return l && l.lastElementChild ? [l.lastElementChild.textContent, l.lastElementChild.getAttribute('href')] : null; })() }; });
  check('[1280] ordem: Regiões ▾ primeiro, TODAS as coleções do Topo na ordem do CMS, Demais categorias ▾ só se houver, Cidades por último', comp.firstLabel === 'Regiões' && JSON.stringify(comp.top.map((t) => t[1])) === JSON.stringify(expected.top.map((e) => '/usesul/collections/' + e.slug)) && comp.hasMore === (expected.more.length > 0) && comp.last && comp.last[0] === 'Cidades' && comp.last[1] === SF + '/sul#estados', JSON.stringify(comp).slice(0, 300));
  check('[1280] logo → home do storefront Sul', await d.page.locator('[data-origens-nav="desktop"] .o-nav-logo').getAttribute('href') === SF + '/sul');
  const statuses = []; for (const c of [...expected.top, ...expected.more].slice(0, 25)) statuses.push((await fetch(HOST + '/usesul/collections/' + c.slug, { redirect: 'manual' })).status);
  check('[1280] cada coleção publicada na navbar tem página pública na INK (200)', REHEARSE ? true : statuses.every((x) => x === 200), statuses.join(',') + (REHEARSE ? ' (ensaio: nomes de teste; só informativo)' : ''));

  // Regiões e Demais categorias no layout COMPLETO: clique, links reais, Escape, clique fora, teclado. Na apresentação compacta o Menu ▾ cobre o mesmo.
  if (g0.compact) { info('[1280] a lista real não cabe na barra: apresentação compacta (Menu ▾) em vez de Regiões/Demais separados'); await compactChecks(d.page, 1280, expected, 'desktop-menu-compacto-1280.png'); }
  if (!g0.compact) {
    const reg = d.page.locator('[data-origens-nav="desktop"] .o-nav-full [data-dd="regioes"] > button');
    await reg.click();
    const regPanel = await d.page.evaluate(() => { const p = document.querySelector('[data-origens-nav="desktop"] [data-dd="regioes"] .o-dd-panel'); const r = p.getBoundingClientRect(); return { open: !p.hidden, links: [...p.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]), inView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, expanded: document.querySelector('[data-origens-nav="desktop"] [data-dd="regioes"] > button').getAttribute('aria-expanded') }; });
    check('[1280] Regiões abre por clique com Paraná, Santa Catarina, Rio Grande do Sul e Ver estados (rotas do storefront)', regPanel.open && regPanel.expanded === 'true' && JSON.stringify(regPanel.links) === JSON.stringify([['Paraná', SF + '/sul/pr'], ['Santa Catarina', SF + '/sul/sc'], ['Rio Grande do Sul', SF + '/sul/rs'], ['Ver estados', SF + '/sul#estados']]) && regPanel.inView, JSON.stringify(regPanel).slice(0, 260));
    await d.page.screenshot({ path: OUT + 'desktop-regioes-aberto-1280.png', clip: { x: 0, y: 0, width: 1280, height: 330 } });
    const stateStatuses = []; for (const l of regPanel.links) stateStatuses.push((await fetch(l[1].split('#')[0], { redirect: 'manual' })).status);
    check('[1280] as rotas de Regiões existem no storefront (200)', stateStatuses.every((x) => x === 200), stateStatuses.join(','));
    await d.page.keyboard.press('Escape');
    check('[1280] Escape fecha o dropdown', await d.page.evaluate(() => document.querySelector('[data-origens-nav="desktop"] [data-dd="regioes"] .o-dd-panel').hidden));
    await reg.click(); await d.page.mouse.click(640, 500); await wait(d.page, 100);
    check('[1280] clique fora fecha o dropdown', await d.page.evaluate(() => document.querySelector('[data-origens-nav="desktop"] [data-dd="regioes"] .o-dd-panel').hidden));
    if (expected.more.length > 0) {
      const more = d.page.locator('[data-origens-nav="desktop"] [data-dd="demais"] > button');
      await more.focus(); await d.page.keyboard.press('ArrowDown'); await wait(d.page, 100);
      const dem = await d.page.evaluate(() => { const p = document.querySelector('[data-origens-nav="desktop"] [data-dd="demais"] .o-dd-panel'); const r = p.getBoundingClientRect(); return { open: !p.hidden, focusInPanel: p.contains(document.activeElement), links: p.querySelectorAll('a').length, scrolls: p.scrollHeight > p.clientHeight, inView: r.left >= 0 && r.right <= innerWidth, tall: Math.round(r.height) }; });
      check('[1280] Demais categorias abre por TECLADO (ArrowDown), foca o primeiro link, lista todas e rola por dentro quando é longa', dem.open && dem.focusInPanel && dem.links === expected.more.length && dem.inView && (dem.links < 10 || dem.scrolls), JSON.stringify(dem));
      await d.page.screenshot({ path: OUT + 'desktop-demais-aberto-1280.png', clip: { x: 0, y: 0, width: 1280, height: 520 } });
      await d.page.keyboard.press('Escape');
    }

  }

  // Lupa: painel compacto ancorado, sem empurrar a página
  const crumbY = () => d.page.evaluate(() => Math.round(document.querySelector('h1').getBoundingClientRect().top));
  const y0 = await crumbY();
  await acceptNotice(d.page);
  const ourBefore = d.ours.length; const postsBefore = d.posts.length;
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click();
  await d.page.keyboard.type('chimarrao', { delay: 60 }); await wait(d.page, 800);
  const panel = await d.page.evaluate(() => { const f = document.getElementById('o-nav-search'); const r = f.getBoundingClientRect(); const h = document.querySelector('header').getBoundingClientRect(); return { position: getComputedStyle(f).position, top: Math.round(r.top), headerBottom: Math.round(h.bottom), width: Math.round(r.width), focused: document.activeElement === document.getElementById('o-nav-q') }; });
  check('[1280] a lupa abre um painel COMPACTO ancorado logo abaixo do cabeçalho (sem faixa vazia), com foco no campo', panel.position === 'absolute' && Math.abs(panel.top - panel.headerBottom) <= 2 && panel.width <= 460 && panel.focused, JSON.stringify(panel));
  const y1 = await crumbY();
  check('[1280] abrir a busca não empurra a página (o conteúdo não desce)', y1 === y0, `${y0} -> ${y1}`);
  await d.page.screenshot({ path: OUT + 'desktop-busca-aberta-1280.png', clip: { x: 0, y: 0, width: 1280, height: 220 } });
  await d.page.keyboard.press('Escape'); await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click(); await d.page.keyboard.press('Escape');
  check('[1280] abrir, digitar e fechar a lupa: 0 requisições nossas e 0 POST/KV', d.ours.length === ourBefore && d.posts.length === postsBefore, d.ours.slice(ourBefore).join(','));
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click(); await d.page.fill('#o-nav-q', '   '); await d.page.keyboard.press('Enter'); await wait(d.page, 300);
  check('[1280] busca vazia/só espaços não navega, devolve o foco ao campo e não grava nada', d.page.url().startsWith(HOST) && d.posts.length === postsBefore && await d.page.evaluate(() => document.activeElement === document.getElementById('o-nav-q')));
  await d.page.keyboard.press('Escape');

  // FAB de WhatsApp acima do Ajuda (desktop)
  const wa = await nativeWa(d.page); const fab = await fabInfo(d.page);
  check('[1280] FAB de WhatsApp: ACIMA do "Ajuda?" nativo (centralizado), 52 px, para o link de WhatsApp que a própria INK publica', fab.exists && fab.shown && fab.aboveHelp === true && fab.centerOffset <= 2 && fab.size[0] === 52 && fab.href === wa && fab.target === '_blank' && /noopener/.test(fab.rel || '') && fab.inViewport, JSON.stringify({ ...fab, nativeWa: wa ? 'presente' : null }));
  await d.page.screenshot({ path: OUT + 'desktop-fab-ajuda-1280.png', clip: { x: 1000, y: 560, width: 280, height: 240 } });
  await d.page.locator('[data-controller~="ink-store--help-button"] button').first().click(); await wait(d.page, 400);
  const helpOpen = await fabInfo(d.page);
  check('[1280] o Ajuda nativo continua funcionando (abre a lista) e o FAB recua enquanto ela está aberta', await d.page.evaluate(() => { const l = document.querySelector('[data-controller~="ink-store--help-button"] [data-ink-store--help-button-target="linksList"]'); return !!l && l.getClientRects().length > 0; }) && helpOpen.shown === false, JSON.stringify(helpOpen));
  await d.page.locator('[data-controller~="ink-store--help-button"] button').first().click(); await wait(d.page, 300);

  // Larguras intermediárias: sem overflow nem sobreposição; com lista grande a apresentação vira Menu compacto
  for (const w of [1100, 1024]) {
    await d.page.setViewportSize({ width: w, height: 800 }); await wait(d.page, 700);
    const gm = await geometry(d.page);
    check(`[${w}] largura intermediária: sem sobreposição e sem overflow novo` + (gm.compact ? ' (apresentação compacta: Menu ▾)' : ''), !gm.overlap && gm.sw <= gm.vw + 1 && gm.cartVisible, JSON.stringify(gm));
    if (gm.compact) await compactChecks(d.page, w, expected, `desktop-menu-compacto-${w}.png`);
  }
  await d.page.setViewportSize({ width: 1280, height: 800 }); await wait(d.page, 500);

  // Turbo: produto → produto → página que não é produto → produto (um só cabeçalho e um só FAB)
  const turbo = async (path) => { const ok = await d.page.evaluate((p) => { if (!window.Turbo) return false; window.Turbo.visit(p); return true; }, path); await wait(d.page, 3500); return ok; };
  const nav = () => d.page.evaluate(() => ({ desktop: document.querySelectorAll('[data-origens-nav="desktop"]').length, forms: document.querySelectorAll('#o-nav-search').length, any: document.querySelectorAll('[data-origens-nav]').length, fabs: document.querySelectorAll('#o-wa-fab').length, path: location.pathname }));
  if (await turbo('/usesul/product/serra-catarinense')) {
    const a = await nav(); check('[1280] Turbo produto → produto: um cabeçalho nosso e no máximo um FAB (sem duplicar)', a.path.endsWith('serra-catarinense') && a.desktop === 1 && a.forms === 1 && a.fabs <= 1, JSON.stringify(a));
    await turbo('/usesul/about'); const b = await nav(); check('[1280] Turbo para página que não é produto: nada nosso fica e o cabeçalho nativo é o da INK', b.any === 0 && b.fabs === 0 && await d.page.locator('nav.navbar:not([data-controller]) > ul.navbar-list').first().isVisible(), JSON.stringify(b));
    await turbo(PRODUCT);
    if (REHEARSE && !(await d.page.evaluate(() => !!(window.__useOrigens && window.__useOrigens.features.includes('header-nav'))))) { await d.page.waitForSelector('form[id^="form-product-"]', { timeout: 30000 }); await d.page.evaluate(() => { delete window.__useOrigensLoader; delete window.__useOrigens; }); await d.page.addScriptTag({ content: buildLoaderSource([], ['header-nav', 'cart-mirror'], 'product-catalog') }); await wait(d.page, 2500); }
    const c = await nav(); check('[1280] Turbo de volta ao produto: monta de novo, uma vez', c.desktop === 1 && c.forms === 1 && c.fabs <= 1, JSON.stringify(c));
  } else check('[1280] Turbo disponível na página da INK', false);

  // Carrinho anônimo com 1 item (sem compra) e a página recarregada com o carrinho
  await openProduct(d); await acceptNotice(d.page); await addToCart(d.page);
  await openProduct(d); await wait(d.page, 2500);
  const postsBeforeExit = d.posts.length; d.sfDocs.length = 0;
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-lupa').click(); await d.page.fill('#o-nav-q', 'chimarrao');
  const t0 = Date.now(); await d.page.keyboard.press('Enter');
  await d.page.waitForURL((u) => u.hostname === 'useorigens.com.br', { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
  await d.page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}); await wait(d.page, 1500);
  const sfReq = d.sfDocs.find((u) => /\/sul\/busca/.test(u)); const sfUrl = sfReq ? new URL(sfReq) : null; const ref = sfUrl && sfUrl.searchParams.get('cart_ref');
  check('[1280] Enter → useorigens.com.br/sul/busca?q=chimarrao COM cart_ref (a navegação não esperou mais que o limite seguro)', !!sfUrl && sfUrl.pathname === '/sul/busca' && sfUrl.searchParams.get('q') === 'chimarrao' && REF_RE.test(ref || '') && Date.now() - t0 < 12000, sfReq && sfReq.replace(/cart_ref=[^&]+/, 'cart_ref=<ref>'));
  check('[1280] exatamente UM POST de cart-ref na saída (nada ao digitar/abrir/fechar/menus)', d.posts.length - postsBeforeExit === 1, `${d.posts.length - postsBeforeExit} POST(s)`);
  if (!REHEARSE) {
    const stored = await readRef(ref);
    check('[1280] o token é VERDADEIRO: o servidor devolve o resumo do carrinho (1 item)', stored.status === 200 && stored.body && stored.body.count === 1 && stored.body.items.length === 1, `status ${stored.status} após ${stored.ms} ms`);
    const title = await d.page.locator('h1').first().textContent().catch(() => ''); const cards = await d.page.locator('main ul li').count();
    check('[1280] a página de resultados do storefront respondeu com produtos reais', /Buscar estampas/i.test(title || '') && cards >= 1, `h1 "${title}", ${cards} cards`);
  }
  await openProduct(d); await wait(d.page, 2500);
  const p1 = d.posts.length; d.sfDocs.length = 0;
  await d.page.locator('[data-origens-nav="desktop"] .o-nav-logo').click({ noWaitAfter: true });
  await d.page.waitForURL((u) => u.hostname === 'useorigens.com.br', { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
  const logoUrl = d.sfDocs[0] ? new URL(d.sfDocs[0]) : null;
  check('[1280] logo → /sul reaproveita o MESMO token (carrinho inalterado: 0 novo POST)', !!logoUrl && logoUrl.pathname === '/sul' && logoUrl.searchParams.get('cart_ref') === ref && d.posts.length === p1, logoUrl && logoUrl.pathname);
  await openProduct(d); await wait(d.page, 2500);
  await d.page.evaluate(() => { const b = [...document.querySelectorAll('[id^=shopping-cart-menu]')].find((e) => e.getClientRects().length); b && b.click(); });
  await d.page.waitForSelector('.cart-drawer.open', { timeout: 20000 }); await wait(d.page, 900);
  const checkout = await d.page.evaluate(() => { const el = [...document.querySelectorAll('.cart-drawer a, .cart-drawer button')].find((e) => /finalizar compra/i.test(e.textContent || '')); if (!el) return { found: false }; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { found: true, visible: r.width > 0 && r.height > 0, enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true', covered: !!top && !el.contains(top) }; });
  const fabDrawer = await fabInfo(d.page);
  check('[1280] drawer nativo abre, "Finalizar compra" visível, habilitado e descoberto (não clicado); o FAB recua com o drawer aberto', checkout.found && checkout.visible && checkout.enabled && !checkout.covered && fabDrawer.shown === false, JSON.stringify({ checkout, fabShown: fabDrawer.shown }));
  await d.page.screenshot({ path: OUT + 'desktop-drawer-fab-1280.png' });
  await d.ctx.close();

  // ── Muitas coleções no Topo em 1280 (ensaio): a apresentação vira Menu ▾ compacto, sem overflow nem sobreposição ─────────────────────────
  if (REHEARSE) {
    const c = await session({ width: 1280, height: 800 }, REHEARSAL_LARGE); await openProduct(c);
    const gc = await geometry(c.page);
    check('[1280] muitas coleções no Topo (8): só a APRESENTAÇÃO vira Menu ▾ compacto, sem overflow nem sobreposição', gc.compact && !gc.overlap && gc.sw <= gc.vw + 1 && gc.cartVisible, JSON.stringify(gc));
    await compactChecks(c.page, 1280, REHEARSAL_LARGE, 'desktop-menu-compacto-muitas-1280.png');
    await c.ctx.close();
    expected = REHEARSAL_LARGE; // no mobile a lista completa (Topo 8 + Demais 12) precisa caber no menu lateral
  }

  // ── Mobile: 390, 320, 500 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const [w, vp] of [['390', { width: 390, height: 844 }], ['320', { width: 320, height: 640 }], ['500', { width: 500, height: 800 }]]) {
    const m = await session(vp, REHEARSAL_LARGE); await openProduct(m);
    const base = await m.page.evaluate(() => document.documentElement.scrollWidth); const g = await geometry(m.page);
    check(`[${w}] header montado, sem sobreposição, pesquisa nativa escondida, carrinho nativo, logo CENTRALIZADO (desvio ${g.logoCenterOffset}px)`, g.features.includes('header-nav') && !g.overlap && g.nativeSearchHidden && g.cartVisible && g.logoCenterOffset !== null && g.logoCenterOffset <= 2, JSON.stringify(g));
    await m.page.screenshot({ path: OUT + `mobile-cabecalho-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 200 } });
    const y0m = await m.page.evaluate(() => Math.round(document.querySelector('h1').getBoundingClientRect().top));
    const before = m.ours.length; await m.page.locator('.navbar__top .o-nav-lupa').click(); await m.page.keyboard.type('bah', { delay: 50 }); await wait(m.page, 500);
    const g2 = await geometry(m.page); const y1m = await m.page.evaluate(() => Math.round(document.querySelector('h1').getBoundingClientRect().top));
    check(`[${w}] a busca abre em painel compacto abaixo da faixa (sem empurrar a página), sem requisição ao digitar e sem overflow novo`, await m.page.locator('#o-nav-q').evaluate((e) => document.activeElement === e) && m.ours.length === before && !g2.overlap && g2.sw <= Math.max(base, g2.vw) + 1 && y0m === y1m, `${y0m}->${y1m}`);
    await m.page.screenshot({ path: OUT + `mobile-busca-${w}.png`, clip: { x: 0, y: 0, width: vp.width, height: 260 } });
    await m.page.keyboard.press('Escape');

    await m.page.click('#menu-hamburger'); await wait(m.page, 600);
    const menu = await m.page.evaluate(() => {
      const list = document.getElementById('navbar-list-mobile'); const ours = document.querySelector('[data-origens-nav="menu"]'); const kids = ours ? [...ours.children] : [];
      const acct = list && list.querySelector(':scope > section.absolute'); const b = (e) => e.getBoundingClientRect();
      const accBtns = ours ? [...ours.querySelectorAll('.o-acc-btn')].map((x) => [x.textContent.trim(), x.getAttribute('aria-expanded')]) : [];
      return { open: list.getClientRects().length > 0, searchClosed: document.getElementById('o-nav-search').hidden, first: kids[0] && kids[0].textContent, accBtns, topLinks: ours ? ours.querySelectorAll(':scope > a:not(.o-cta)').length : 0, acctPosition: acct ? getComputedStyle(acct).position : null, clear: !ours || !acct || b(ours).bottom <= b(acct).top + 1, nativeHidden: ['li[data-drawer-target="product-sidebar"]', 'li[data-drawer-target="collection-sidebar"]'].every((s) => { const e = list.querySelector(s); return !e || e.getClientRects().length === 0; }), sobre: !!list.querySelector('a[href="/usesul/about"]') && list.querySelector('a[href="/usesul/about"]').getClientRects().length > 0 };
    });
    check(`[${w}] menu lateral: CTA de cidades, Regiões e Demais categorias FECHADOS, TODAS as coleções do Topo, Loja/Produtos/Categorias nativos fora, Sobre presente`, menu.open && menu.searchClosed && /Encontrar minha cidade/.test(menu.first) && menu.accBtns.every((a) => a[1] === 'false') && menu.accBtns.some((a) => a[0] === 'Regiões') && menu.accBtns.some((a) => a[0] === 'Demais categorias') === (expected.more.length > 0) && menu.topLinks === expected.top.length && menu.nativeHidden && menu.sobre, JSON.stringify(menu));
    check(`[${w}] a conta/atendimento nativa entra no fluxo (static) e não é coberta pelas coleções`, menu.acctPosition === 'static' && menu.clear, JSON.stringify({ acct: menu.acctPosition, clear: menu.clear }));
    await m.page.screenshot({ path: OUT + `mobile-menu-${w}.png` });
    // expandir Demais categorias (muitas coleções) e alcançar o fim: o bloco de conta/atendimento precisa ficar acessível com a lista aberta
    if (expected.more.length > 0) { await m.page.locator('.o-acc-btn', { hasText: 'Demais categorias' }).click(); await wait(m.page, 200); }
    await m.page.locator('.o-acc-btn', { hasText: 'Regiões' }).click(); await wait(m.page, 200);
    const reach = await m.page.evaluate(() => {
      const list = document.getElementById('navbar-list-mobile'); list.scrollTop = list.scrollHeight; const lb = list.getBoundingClientRect();
      const labels = ['Entrar', 'Rastreio', 'Trocar pedido', 'Avaliar meu pedido', 'Whatsapp', 'Meus pedidos', 'Sair'];
      const found = {}; for (const a of list.querySelectorAll(':scope > section.absolute a')) { const t = a.textContent.trim(); for (const l of labels) if (t.toLowerCase().includes(l.toLowerCase())) { const r = a.getBoundingClientRect(); found[l] = r.width > 0 && r.top >= lb.top - 1 && r.bottom <= lb.bottom + 1; } }
      return { scrolls: list.scrollHeight > list.clientHeight, found };
    });
    const loggedOut = ['Entrar', 'Rastreio', 'Trocar pedido', 'Avaliar meu pedido', 'Whatsapp'];
    check(`[${w}] com tudo expandido o menu ROLA e o bloco nativo alcança a tela (deslogado: Entrar, Rastreio, Trocar pedido, Avaliar meu pedido, WhatsApp)`, loggedOut.every((l) => reach.found[l] === true), JSON.stringify(reach));
    await m.page.screenshot({ path: OUT + `mobile-menu-expandido-${w}.png` });
    const fabMenu = await fabInfo(m.page);
    check(`[${w}] com o menu aberto o FAB de WhatsApp recua (nunca cobre o menu)`, !fabMenu.exists || fabMenu.shown === false, JSON.stringify(fabMenu));
    await m.page.click('#menu-hamburger'); await wait(m.page, 500);
    const fabClosed = await fabInfo(m.page);
    check(`[${w}] menu fechado: FAB de WhatsApp acima do Ajuda, dentro da tela, alvo ≥ 44 px`, fabClosed.exists && fabClosed.shown && fabClosed.aboveHelp === true && fabClosed.inViewport && fabClosed.size[0] >= 44 && fabClosed.centerOffset <= 2, JSON.stringify(fabClosed));
    await m.page.screenshot({ path: OUT + `mobile-fab-ajuda-${w}.png`, clip: { x: 0, y: Math.max(0, vp.height - 260), width: vp.width, height: Math.min(260, vp.height) } });
    await m.ctx.close();
  }
  // Viewport baixa: o menu tem de rolar por inteiro e a conta continuar alcançável
  const low = await session({ width: 390, height: 560 }, REHEARSAL_LARGE); await openProduct(low);
  await low.page.click('#menu-hamburger'); await wait(low.page, 500);
  if (expected.more.length > 0) await low.page.locator('.o-acc-btn', { hasText: 'Demais categorias' }).click();
  const lowReach = await low.page.evaluate(() => { const list = document.getElementById('navbar-list-mobile'); list.scrollTop = list.scrollHeight; const a = [...list.querySelectorAll(':scope > section.absolute a')].find((x) => /entrar|sair/i.test(x.textContent)); const lb = list.getBoundingClientRect(); const r = a && a.getBoundingClientRect(); return { scrolls: list.scrollHeight > list.clientHeight, reachable: !!r && r.bottom <= lb.bottom + 1 && r.top >= lb.top - 1 }; });
  check('[390x560] viewport baixa com muitas coleções: o menu rola por inteiro e Entrar/Sair (conta) fica alcançável', lowReach.scrolls && lowReach.reachable, JSON.stringify(lowReach));
  await low.ctx.close();
  info('ESTADO LOGADO não validado nesta execução (sem sessão de teste autorizada): Meus pedidos, Sair, saudação truncada e a ocultação do Dashboard sem destino têm cobertura DOM (fixture logada) e ficam para conferência manual.');
} catch (e) {
  check('roteiro concluído sem exceção', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
}
await browser.close();
writeFileSync(OUT + 'resultado.json', JSON.stringify({ mode: REHEARSE ? 'rehearse' : 'live', at: new Date().toISOString(), checks: results.length, passed: results.filter(Boolean).length, failures }, null, 1));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks (${REHEARSE ? 'ENSAIO' : 'AO VIVO'})`);
process.exit(results.length > 0 && failures.length === 0 ? 0 : 1);
