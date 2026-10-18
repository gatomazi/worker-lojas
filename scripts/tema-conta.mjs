#!/usr/bin/env node
// Prova visual do tema da CONTA (theme-account) em Miniflare + navegador headless, com o worker.js/HTMLRewriter/CSS de produção e a "Conta" ligada só nesta
// configuração local. Nada é publicado e nenhum POST sai (o harness aborta). Páginas:
//   - login, rastreio e trocas: HTML REAL da INK (públicas);
//   - Compras e o detalhe do pedido (só logado): a ESTRUTURA vista em 17/10/2026 (mesmas tags e classes) com textos FICTÍCIOS, dentro do <head> e do
//     cabeçalho reais do rastreio (o CSS da INK é o mesmo) — nenhum dado pessoal.
//   PW_PATH=<projeto com playwright-core> node scripts/tema-conta.mjs [--out docs/evidence/tema-conta]
import { mkdirSync } from 'node:fs';
import { createHarness, REFERENCE_THEME, STORE, VIEWPORTS } from './lib/tema-harness.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const out = arg('--out') || 'docs/evidence/tema-conta';
mkdirSync(out, { recursive: true });
const BASE = STORE.inkBase;

const card = (n, status, cls, rated) => `<div class="w-full p-4 flex flex-col lg:flex-row gap-4 items-start bg-white rounded-lg border border-gray-200 shadow-sm">
  <div class="w-full flex flex-col gap-4 items-start justify-center">
    <div class="inline-flex items-center justify-start gap-4"><p class="text-lg font-bold text-gray-900">INK00000${n}</p></div>
    <div class="flex flex-col lg:flex-row justify-start items-start w-full gap-4 lg:gap-10">
      <div class="w-full lg:max-w-[355px] inline-flex items-start gap-4 lg:gap-10">
        <div class="flex flex-col items-start justify-center gap-2 w-1/2 lg:max-w-[180px] lg:text-nowrap"><p class="text-sm font-normal text-gray-500">Status</p><p class="text-sm font-semibold ${cls}">${status}</p></div>
        <div class="flex flex-col items-start justify-center gap-2 w-1/2 lg:max-w-[135px]"><p class="text-sm font-normal text-gray-500">Data da compra</p><p class="text-sm font-semibold text-gray-900">0${n}/01/2026</p></div>
      </div>
      <div class="w-full lg:max-w-[355px] inline-flex items-start gap-4 lg:gap-10">
        <div class="flex flex-col items-start justify-center gap-2 w-1/2 lg:max-w-[180px]"><p class="text-sm font-normal text-gray-500">Transportadora</p><p class="text-sm font-semibold text-gray-900">Transportadora Exemplo</p></div>
        <div class="flex flex-col items-start justify-center gap-2 w-1/2 lg:max-w-[135px]"><p class="text-sm font-normal text-gray-500">Valor pago</p><p class="text-sm font-semibold text-gray-900">R$ 109,90</p></div>
      </div>
    </div>
  </div>
  <div class="flex flex-col gap-2 items-end justify-center text-nowrap w-full lg:max-w-[169px]">
    <a class="w-full bg-store-button text-store-button-font text-sm font-medium py-2.5 px-5 flex justify-center items-center gap-2 self-stretch rounded-lg" href="#">Ver compra</a>
    ${rated ? '<a class="w-full flex items-center justify-center" href="#"><div class="star-rating disabled"><div class="star-value"></div></div></a>' : '<button type="button" class="cursor-default w-full rounded-lg border border-gray-400 py-2.5 px-5 flex justify-center items-center gap-2 self-stretch text-gray-400 text-sm font-medium">Avaliar</button>'}
  </div>
</div>`;
const ORDERS = `<main class="container mx-auto max-w-screen-xl py-9 px-4"><div class="w-full text-left"><h1 class="text-4xl font-semibold text-gray-800">Compras</h1></div>
<section class="flex flex-col items-center justify-center gap-6 w-full mt-6">${card(1, 'Entregue', 'text-green-500', true)}${card(2, 'Em trânsito', 'text-gray-900', false)}${card(3, 'Entregue', 'text-green-500', false)}</section></main>`;
const THUMB = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#e5e5e5"/><path d="M22 24l12-6h12l12 6-5 10h-6v28H33V34h-6z" fill="#1b1d19"/></svg>');
const item = (name) => `<div class="flex items-center gap-4"><img class="w-16 h-16 rounded-lg border" src="${THUMB}" alt=""><div class="flex-1"><p class="text-sm font-semibold text-gray-900">${name}</p><p class="text-sm text-gray-500">Camiseta · Clássica | Unissex / Preta / M</p></div><p class="text-sm font-semibold text-gray-900">R$ 49,90</p></div>`;
const ORDER = `<main class="container mx-auto max-w-screen-xl px-4"><div class="container">
<nav class="flex flex-col gap-2 items-start py-6"><div class="flex items-center gap-4"><a href="${BASE}/orders"><span>&larr;</span></a><p class="text-2xl font-semibold">INK000001</p></div><span class="text-gray-600 text-xs">Compra confirmada em 1 de Janeiro de 2026.</span></nav>
<div class="flex flex-col md:flex-row gap-6 items-start">
  <div class="w-full md:w-1/2 flex flex-col gap-6 items-center justify-center">
    <section class="w-full flex flex-col gap-4 items-start p-4 bg-white rounded-lg border border-gray-200">
      <div class="w-full flex flex-col gap-1 items-start"><p class="text-sm font-semibold text-green-500">Entregue</p><p class="text-lg font-semibold text-gray-900">Seu pedido foi entregue em 05 de Janeiro.</p></div>
      <p class="text-sm font-light">Entregamos seu pedido na Rua Exemplo, 100, Centro, Cidade Exemplo</p>
      <div class="gap-2"><p class="text-sm">Entrega por Transportadora Exemplo</p></div>
      <div class="w-full flex flex-col lg:flex lg:flex-row lg:justify-center lg:items-center gap-4"><a class="w-full bg-store-button text-store-button-font text-sm font-medium py-2.5 px-5 flex justify-center items-center gap-2 self-stretch rounded-lg" href="#">Rastrear compra</a></div>
    </section>
    <section class="w-full flex flex-col gap-4 items-start p-4 bg-white rounded-lg border border-gray-200 text-sm">
      <p class="font-medium">Detalhes da compra</p>
      <div class="grid grid-cols-2 gap-4 w-full"><div><p class="font-medium">Informações de contato</p><p class="text-gray-600">Cliente Exemplo</p></div><div><p class="font-medium">Pagamento</p><p class="text-gray-600">Pix</p></div></div>
    </section>
  </div>
  <div class="w-full md:w-1/2"><section class="w-full flex flex-col gap-4 items-start p-4 bg-white rounded-lg border border-gray-200">
    <p class="text-lg font-semibold text-gray-900">Resumo da Compra</p>${item('Cidade Exemplo | Origem SC')}${item('Cidade Exemplo | Dizeres SC')}
    <div class="w-full flex justify-between text-sm"><p class="text-gray-500">Subtotal</p><p class="text-gray-900">R$ 99,80</p></div>
    <div class="w-full flex justify-between"><p class="font-semibold text-gray-900">Total</p><p class="font-semibold text-gray-900">R$ 108,82</p></div>
  </section></div>
</div></div></main>`;

const config = { ...REFERENCE_THEME, surfaces: { ...REFERENCE_THEME.surfaces, account: true } };
const h = await createHarness({ config, themeFeatures: 'theme-pdp,theme-cart,theme-checkout,theme-account' });
// O casco real (head + cabeçalho + rodapé) do rastreio, para as páginas logadas reconstruídas.
const shell = await (await fetch(h.HOST + BASE + '/orders/trackings')).text();
const withMain = (main) => shell.replace(/<main[\s\S]*?<\/main>/, main);
const report = [];
try {
  for (const vp of VIEWPORTS) {
    const s = await h.session(vp);
    for (const [slug, main] of [['compras', ORDERS], ['pedido', ORDER]]) {
      const path = slug === 'compras' ? BASE + '/orders' : BASE + '/orders/1';
      await s.page.route(h.HOST + path, async (route) => {
        h.upstream.html = withMain(main); h.upstream.status = 200;
        const res = await h.mf.dispatchFetch(route.request().url(), { headers: { accept: 'text/html' } });
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: await res.text() });
      });
    }
    for (const [slug, path, full] of [['login', BASE + '/store_sessions/new', true], ['rastreio', BASE + '/orders/trackings', false], ['trocas', BASE + '/exchanges_and_returns', false], ['compras', BASE + '/orders', false], ['pedido', BASE + '/orders/1', false]]) {
      await s.page.goto(h.HOST + path, { waitUntil: 'networkidle', timeout: 90000 });
      await h.acceptCookies(s.page).catch(() => {});
      await s.page.waitForTimeout(600);
      const info = await s.page.evaluate(() => ({ theme: document.body.getAttribute('data-origens-theme'), loaders: document.querySelectorAll('script[data-use-origens-widget]').length, home: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === 'https://useorigens.com.br/sul').length, overflow: document.documentElement.scrollWidth - window.innerWidth }));
      report.push(`${vp.name} ${slug}: tema="${info.theme}" loaders=${info.loaders} links-home=${info.home} overflow=${info.overflow}`);
      await s.page.screenshot({ path: `${out}/${slug}-${vp.width}.png`, fullPage: full });
    }
    await s.ctx.close();
  }
} finally {
  await h.close();
}
console.log(report.join('\n'));
console.log('POSTs bloqueados:', h.blocked.length);
