#!/usr/bin/env node
// Smoke HTTP PÚBLICO e SOMENTE LEITURA do Worker publicado (sem cookies, sem POST, sem carrinho, sem login).
//   node scripts/smoke-global.mjs --expect=allowlist   -> estado atual (cinco produtos): amostra fora do escopo SEM loader
//   node scripts/smoke-global.mjs --expect=catalog     -> catálogo inteiro: amostra COM exatamente 1 loader
// exit 0 = ok; 1 = alguma divergência (lista impressa). O health é conferido contra as seis features e a allowlist de cinco.
import { readFileSync } from 'node:fs';
import { evaluateHealth, countLoaders, FIVE_SLUGS } from './lib/release-lib.mjs';

const HOST = 'https://www.usesul.com.br';
const expect = (process.argv.find((a) => a.startsWith('--expect=')) || '--expect=allowlist').split('=')[1];
const version = (process.argv.find((a) => a.startsWith('--version=')) || '').split('=')[1] || null;
const sample = JSON.parse(readFileSync(new URL('./catalog-sample.json', import.meta.url), 'utf8')).products.map((p) => p.slug);
const outside = sample.filter((s) => !FIVE_SLUGS.includes(s));
const failures = []; let checks = 0;
const check = (name, ok, detail = '') => { checks++; if (!ok) { failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); } };
const get = async (path, init = {}) => { const r = await fetch(HOST + path, { redirect: 'manual', ...init }); return { status: r.status, body: await r.text(), headers: r.headers }; };

const health = await (await fetch(HOST + '/__origens/health')).json();
const h = evaluateHealth(health, expect, { loaderVersion: version });
check('health no estado esperado (' + expect + ')', h.ok, h.problems.join('; '));
for (const slug of FIVE_SLUGS) { const r = await get('/usesul/product/' + slug); check('cinco produtos: ' + slug.slice(0, 28) + ' 200 com 1 loader', r.status === 200 && countLoaders(r.body) === 1 && /id="cart"/.test(r.body), `status ${r.status}, loaders ${countLoaders(r.body)}`); }
for (const slug of outside) { const r = await get('/usesul/product/' + slug); const n = countLoaders(r.body); check(`amostra ${expect === 'catalog' ? 'COM' : 'SEM'} loader: ${slug.slice(0, 28)}`, r.status === 200 && n === (expect === 'catalog' ? 1 : 0), `status ${r.status}, loaders ${n}`); }
// Sempre sem loader, em qualquer modo: não-produto, transacional, 404 de produto, subcaminho e Turbo-Frame.
for (const path of ['/usesul', '/usesul/products', '/usesul/cart', '/usesul/checkout/contact_and_shipping_details', '/usesul/product/produto-que-nao-existe-zzz-123', '/usesul/product/a/b']) { const r = await get(path); check('sem loader: ' + path, r.status < 500 && countLoaders(r.body) === 0, `status ${r.status}`); }
const tf = await get('/usesul/product/' + FIVE_SLUGS[0], { headers: { 'Turbo-Frame': 'cart' } }); check('Turbo-Frame sem loader', tf.status === 200 && countLoaders(tf.body) === 0);
const loaderJs = await get('/__origens/loader.js'); check('loader.js servido com o modo de escopo correto', loaderJs.status === 200 && new RegExp('SCOPE_MODE = "' + (expect === 'catalog' ? 'product-catalog' : 'allowlist') + '"').test(loaderJs.body) || (expect === 'allowlist' && !/SCOPE_MODE/.test(loaderJs.body)), `status ${loaderJs.status}`);
const search = await get('/__origens/search?q=floria'); check('gateway de busca responde com cidades', search.status === 200 && /Florian/.test(search.body));
const ref = await get('/__origens/cart-ref/AAAAAAAAAAAAAAAAAAAAAA'); check('cart-ref: token inexistente = 404 (rota viva; nada gravado)', ref.status === 404);

console.log(JSON.stringify({ expect, checks, failures: failures.length, health: { version: health.version, scope_mode: health.scope_mode, allowlist_size: health.allowlist_size, features: (health.widget_features || []).length } }));
process.exit(failures.length ? 1 : 0);
