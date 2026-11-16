#!/usr/bin/env node
// QA do topo do artigos (src/artigos) em NAVEGADOR REAL contra a loja REAL da Uma Penca. Nada é publicado: o Worker roda LOCAL (Miniflare, o workerd de verdade)
// na frente de artigos.useorigens.com.br, e só os documentos HTML passam por ele (o resto da página vem direto da Uma Penca, como em produção).
//   PW_PATH=<raiz com node_modules/playwright-core> node scripts/qa-artigos.mjs                 -> confere e grava as capturas em docs/screenshots/artigos-topo/
//   PW_PATH=... node scripts/qa-artigos.mjs --headed --hold=900                                 -> duas janelas abertas (computador 1440×900 e celular 390×844) por 15 min, para ver ao vivo
//   --storefront=fixture   usa o payload guardado em test/fixtures (padrão: o /api/navbar/sul REAL de produção)
// Só LEITURA na Uma Penca: abre páginas e abre/fecha o painel da sacola (nunca adiciona item, nunca vai ao checkout). Sessão anônima descartável.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { HOST, PRODUCT, routeThroughWorker, startLocalWorker } from './lib/artigos-local.mjs';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');

const arg = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').split('=')[1];
const HEADED = process.argv.includes('--headed');
const HOLD = Number(arg('hold') || 0);
const FIXTURE = arg('storefront') === 'fixture';
const OUT = new URL('../docs/screenshots/artigos-topo/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const failures = [];
const check = (name, ok, detail = '') => { if (!ok) failures.push(name); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + String(detail).slice(0, 240) : '')); };

const mf = startLocalWorker({ fixture: FIXTURE });
const route = (page) => routeThroughWorker(page, mf);

const browser = await chromium.launch({ headless: !HEADED });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1800); };
const shot = (page, name) => page.screenshot({ path: OUT + name + '.png' });
// O painel lateral da Uma Penca (sacola e busca abrem o mesmo #sidebar-content): fechado antes, aberto depois do toque.
const sidebarOpen = (page) => page.evaluate(() => document.querySelector('#sidebar-content').classList.contains('open'));
async function open(ctx, path) {
  const page = await ctx.newPage(); await route(page);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(HOST + path, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page);
  return { page, errors };
}

try {
  // ── antes: a loja como está hoje, direto da Uma Penca, sem o Worker (só para a comparação do PR) ───────────────────────────────────────────────
  for (const [name, opts] of [['antes-desktop', { viewport: { width: 1440, height: 900 } }], ['antes-mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.goto(HOST + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page);
    await shot(page, name); await ctx.close();
  }
  // ── computador ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const d = await open(desk, '/');
  const facts = await d.page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const logo = q('#header-desktop a.header-logo-up');
    const nav = q('[data-origens-artigos="nav"]');
    const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return {
      logoHref: logo && logo.getAttribute('href'), nav: !!nav, navRect: nav && rect(nav), navVisible: nav && nav.offsetParent !== null,
      nativeNavHidden: getComputedStyle(q('#header-desktop-nav')).display === 'none',
      cart: !!q('#header-desktop #header-cart-desktop'), account: !!q('#header-desktop #header-account'), search: !!q('#header-desktop .button-open-search'),
      links: [...document.querySelectorAll('.oa-inline > a, .oa-inline .oa-t')].map((a) => a.textContent.trim()),
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  });
  check('computador: o logo leva à vitrine', facts.logoHref === 'https://useorigens.com.br/sul', facts.logoHref);
  check('computador: a navegação nossa sobreviveu ao Vue da Uma Penca e está à vista', facts.nav && facts.navVisible, JSON.stringify(facts.navRect));
  check('computador: a navegação nativa só ficou escondida', facts.nativeNavHidden);
  check('computador: lupa, conta e sacola da Uma Penca seguem no lugar', facts.cart && facts.account && facts.search);
  check('computador: sem rolagem lateral', !facts.overflow);
  check('computador: links esperados', facts.links.includes('Sua cidade') && facts.links.includes('Estados') && facts.links.includes('Loja') && facts.links.includes('Contato'), facts.links.join(' | '));
  check('computador: nenhum erro de script na página', d.errors.length === 0, d.errors.join(' / '));
  await shot(d.page, 'desktop-home');
  await d.page.hover('.oa-inline .oa-dd:nth-of-type(1) .oa-t'); await d.page.waitForTimeout(300);
  check('computador: "Estados" abre o painel ao passar o mouse', await d.page.evaluate(() => getComputedStyle(document.querySelector('.oa-inline .oa-dd .oa-p')).display === 'block'));
  await shot(d.page, 'desktop-estados');
  await d.page.hover('.oa-inline .oa-dd-wide .oa-t'); await d.page.waitForTimeout(300);
  await shot(d.page, 'desktop-categorias');
  // a sacola e a lupa nativas seguem abrindo o painel da Uma Penca (só abre: nunca adiciona item nem vai ao checkout)
  await d.page.mouse.move(700, 500);
  check('computador: o painel da Uma Penca começa fechado', !(await sidebarOpen(d.page)));
  await d.page.click('#header-desktop #header-cart-desktop .button-open-cart'); await d.page.waitForTimeout(900);
  check('computador: clicar na sacola da Uma Penca abre o painel dela', await sidebarOpen(d.page));
  await d.page.reload({ waitUntil: 'domcontentloaded' }); await settle(d.page);
  check('computador: depois de recarregar o painel volta fechado', !(await sidebarOpen(d.page)));
  await d.page.click('#header-desktop .button-open-search'); await d.page.waitForTimeout(900);
  check('computador: clicar na lupa da Uma Penca abre a busca dela', await sidebarOpen(d.page));
  const p = await open(desk, PRODUCT);
  check('artigo: o topo também entra na página do produto', await p.page.evaluate(() => !!document.querySelector('[data-origens-artigos="nav"]')));
  await shot(p.page, 'desktop-artigo');
  await p.page.setViewportSize({ width: 900, height: 800 }); await p.page.waitForTimeout(400);
  const narrow = await p.page.evaluate(() => ({ inline: getComputedStyle(document.querySelector('.oa-inline')).display, compact: getComputedStyle(document.querySelector('.oa-compact')).display, overflow: document.documentElement.scrollWidth > innerWidth }));
  check('900 px: a navegação vira o "Menu ▾" compacto, sem rolagem lateral', narrow.inline === 'none' && narrow.compact === 'block' && !narrow.overflow, JSON.stringify(narrow));
  await p.page.hover('.oa-compact .oa-t'); await p.page.waitForTimeout(300);
  await shot(p.page, 'tablet-menu');

  // ── celular ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR' });
  const m = await open(phone, '/');
  const mf2 = await m.page.evaluate(() => {
    const menu = document.querySelector('[data-origens-artigos="menu"]'); const btn = menu && menu.querySelector('summary');
    const r = btn && btn.getBoundingClientRect();
    return { menu: !!menu, btn: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], logoHref: document.querySelector('#header-mobile a.header-logo-up').getAttribute('href'), nativeIcon: getComputedStyle(document.querySelector('#header-drawer-icon')).display, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check('celular: o ☰ nosso existe e tem 46×46', mf2.menu && mf2.btn && mf2.btn[2] === 46 && mf2.btn[3] === 46, JSON.stringify(mf2.btn));
  check('celular: o ☰ nativo fica escondido e o logo leva à vitrine', mf2.nativeIcon === 'none' && mf2.logoHref === 'https://useorigens.com.br/sul', mf2.logoHref);
  check('celular: sem rolagem lateral', !mf2.overflow);
  // o logo, a lupa e a sacola continuam centrados na barra de 46 px (o ☰ nativo escondido não pode encolher a linha)
  const align = await m.page.evaluate(() => {
    const mid = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return Math.round(r.top + r.height / 2); };
    return { bar: document.querySelector('#header-mobile-topbar-wrapper').getBoundingClientRect().height, logo: mid('#header-mobile a.header-logo-up'), search: mid('#header-mobile .header-store-search'), cart: mid('#header-mobile .header-cart-icon'), burger: mid('[data-origens-artigos="menu"] summary') };
  });
  check('celular: a barra tem 46 px e logo, lupa, sacola e ☰ ficam dentro dela e alinhados', align.bar === 46 && [align.logo, align.search, align.cart, align.burger].every((y) => y >= 14 && y <= 32), JSON.stringify(align));
  check('celular: nenhum erro de script na página', m.errors.length === 0, m.errors.join(' / '));
  await shot(m.page, 'mobile-home');
  await m.page.evaluate(() => window.scrollTo(0, 700)); await m.page.waitForTimeout(500);
  await m.page.tap('[data-origens-artigos="menu"] summary'); await m.page.waitForTimeout(500);
  const panel = await m.page.evaluate(() => { const r = document.querySelector('.oa-m-panel').getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), vh: innerHeight, header: Math.round(document.querySelector('#header-mobile-topbar-wrapper').getBoundingClientRect().top) }; });
  check('celular: com a página rolada, a barra continua no alto e a gaveta ocupa o resto da tela', panel.header === 0 && panel.top === 46 && panel.height === panel.vh - 46, JSON.stringify(panel));
  const open2 = await m.page.evaluate(() => { const d = document.querySelector('[data-origens-artigos="menu"]'); const first = d.querySelector('.oa-m-panel a'); return { open: d.open, first: first && first.textContent.trim(), firstHref: first && first.getAttribute('href') }; });
  check('celular: tocar no ☰ abre a gaveta com "Voltar para a Use Origens" em primeiro', open2.open && /Voltar para a Use Origens/.test(open2.first) && open2.firstHref === 'https://useorigens.com.br/sul', JSON.stringify(open2));
  await shot(m.page, 'mobile-menu');
  await m.page.tap('[data-origens-artigos="menu"] summary'); await m.page.waitForTimeout(300);
  check('celular: tocar de novo fecha a gaveta', await m.page.evaluate(() => !document.querySelector('[data-origens-artigos="menu"]').open));
  check('celular: o painel da Uma Penca começa fechado', !(await sidebarOpen(m.page)));
  await m.page.tap('#header-mobile #header-cart-desktop .button-open-cart'); await m.page.waitForTimeout(900);
  check('celular: tocar na sacola da Uma Penca abre o painel dela', await sidebarOpen(m.page));
  await m.page.reload({ waitUntil: 'domcontentloaded' }); await settle(m.page);
  await m.page.tap('#header-mobile .button-open-search'); await m.page.waitForTimeout(900);
  check('celular: tocar na lupa da Uma Penca abre a busca dela', await sidebarOpen(m.page));
  const mp = await open(phone, PRODUCT);
  check('celular/artigo: o topo também entra na página do produto', await mp.page.evaluate(() => !!document.querySelector('[data-origens-artigos="menu"]')));
  await shot(mp.page, 'mobile-artigo');

  if (HEADED && HOLD > 0) {
    console.log('INFO janelas abertas por ' + HOLD + ' s (computador 1440×900 e celular 390×844); Ctrl+C para fechar antes.');
    await new Promise((resolve) => setTimeout(resolve, HOLD * 1000));
  }
} finally {
  await browser.close();
  await mf.dispose();
}
console.log(failures.length === 0 ? '\nTODOS OS CENÁRIOS PASSARAM' : '\nFALHARAM: ' + failures.join('; '));
process.exit(failures.length === 0 ? 0 : 1);
