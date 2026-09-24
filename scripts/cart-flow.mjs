#!/usr/bin/env node
// Compra assistida SEM checkout numa sessão anônima ISOLADA (contexto novo; janela visível). Não toca no carrinho de ninguém.
//   PW_PATH=/tmp/pw node scripts/cart-flow.mjs <base|off|on>
// Adiciona 1 item ao carrinho anônimo, confere o drawer da INK, vai ao storefront pelo link (fase on) ou direto (outras fases),
// volta à INK na MESMA sessão e confere que o carrinho é o mesmo; depois tenta remover o item. Nunca abre checkout.
import { createRequire } from 'node:module';
const require = createRequire((process.env.PW_PATH || '.') + '/');
const { chromium } = require('playwright-core');
const phase = process.argv[2] || 'base';
const HOST = 'https://www.usesul.com.br';
const ALLOWED = '/usesul/product/serra-catarinense';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = [];
const check = (n, ok, d = '') => { out.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  — ' + d : '')); };

const browser = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--window-size=1300,950'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR' });
const page = await ctx.newPage();
const cartInfo = () => page.evaluate(async () => {
  const html = await (await fetch('/usesul/cart', { headers: { Accept: 'text/html' } })).text();
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\s+/g, ' ');
  return { len: html.length, header: (text.match(/Carrinho \(\d+[^)]*\)/) || [null])[0], serra: /Serra Catarinense/.test(text) };
});
try {
  await page.goto(HOST + ALLOWED, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const links0 = await page.evaluate(() => document.querySelectorAll('#use-origens-return-link').length);
  check('produto abre e CTA existe' + (phase === 'on' ? ' (1 link nosso)' : ' (0 links)'), (await page.locator('#add-to-cart-desk').count()) === 1 && links0 === (phase === 'on' ? 1 : 0), 'links=' + links0);
  // mesmo caminho que um visitante: clicar nas opções e no CTA
  await page.locator('label[for="4932916-model-Masculino"]').click();
  await page.locator('label[for="4932916-color-Preta"]').click();
  await page.locator('label[for="4932916-size-M"]').click();
  await page.waitForFunction(() => document.getElementById('product-variant-id-4932916')?.value > 0, null, { timeout: 10000 });
  const post = page.waitForResponse((r) => r.url().includes('/usesul/cart') && r.request().method() === 'POST', { timeout: 20000 });
  await page.locator('#add-to-cart-desk').click();
  const resp = await post;
  await page.waitForTimeout(2500);
  const drawer = await page.evaluate(() => document.getElementById('modal-wrapper')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) || null);
  check('POST /usesul/cart pelo proxy/Worker com sucesso', resp.status() < 400, 'status=' + resp.status());
  check('drawer da INK ("Ver carrinho" / "Continuar comprando") intacto', !!drawer && /Ver carrinho/.test(drawer) && /Continuar comprando/.test(drawer), drawer);
  const before = await cartInfo();
  check('carrinho anônimo contém o item de teste', before.serra, JSON.stringify(before));
  if (phase === 'on') check('link continua único após adicionar', (await page.evaluate(() => document.querySelectorAll('#use-origens-return-link').length)) === 1);
  // ida ao storefront: pelo link (fase on) ou direto
  if (phase === 'on') {
    await page.locator('#modal-wrapper button, #modal-wrapper a').filter({ hasText: 'Continuar comprando' }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.locator('#use-origens-return-link').click();
    await page.waitForURL(/useorigens\.com\.br\/sul/, { timeout: 25000 });
  } else {
    await page.goto('https://useorigens.com.br/sul', { waitUntil: 'load' });
  }
  const sf = await page.request.get('https://useorigens.com.br/sul');
  check('storefront https://useorigens.com.br/sul responde 200', sf.status() === 200 && /useorigens\.com\.br\/sul/.test(page.url()), page.url() + ' status=' + sf.status());
  await page.goto(HOST + ALLOWED, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const after = await cartInfo();
  check('volta à INK na MESMA sessão: carrinho preservado', after.serra && after.len === before.len && after.header === before.header, 'antes=' + JSON.stringify(before) + ' depois=' + JSON.stringify(after));
  if (phase === 'on') check('depois da volta: continua 1 link', (await page.evaluate(() => document.querySelectorAll('#use-origens-return-link').length)) === 1);
  // limpeza do item de teste (melhor esforço)
  await page.goto(HOST + '/usesul/cart', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const removed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a, button')].find((e) => /remover|excluir|remove|delete/i.test((e.textContent || '') + (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '') + (e.getAttribute('data-turbo-method') || '')) && e.getClientRects().length);
    if (el) { el.click(); return true; }
    return false;
  });
  await page.waitForTimeout(2000);
  console.log('INFO remoção do item de teste (sessão anônima descartável): ' + (removed ? 'acionada' : 'sem controle simples; sessão descartada'));
} catch (e) { check('fluxo sem exceção', false, String(e.message).slice(0, 200)); }
await browser.close();
console.log('RESUMO cart-flow fase=' + phase + ': ' + out.filter(Boolean).length + ' PASS, ' + out.filter((x) => !x).length + ' FAIL');
process.exit(out.every(Boolean) ? 0 : 1);
