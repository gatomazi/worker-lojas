#!/usr/bin/env node
// Smoke HTTP PÚBLICO e SOMENTE LEITURA do Worker publicado (sem cookies, sem POST, sem carrinho, sem login).
//   node scripts/smoke-global.mjs --expect=allowlist   -> estado atual (cinco produtos): amostra fora do escopo SEM loader
//   node scripts/smoke-global.mjs --expect=catalog     -> catálogo inteiro: amostra COM exatamente 1 loader
//   --features=seven [--allowlist-size=N] [--shell=off] -> estado do release da navbar: as seis + header-nav (e a rota /__origens/navbar viva). --shell=off: a navbar
//                                                        está ativa mas as páginas de casca AINDA não (estado anterior a um update, ou o estado restaurado por um rollback)
// exit 0 = ok; 1 = alguma divergência (lista impressa). O health é conferido contra as seis features e a allowlist de cinco.
import { readFileSync } from 'node:fs';
import { evaluateHealth, countLoaders, FIVE_SLUGS, SIX_FEATURES, SEVEN_FEATURES } from './lib/release-lib.mjs';

const HOST = 'https://www.usesul.com.br';
const expect = (process.argv.find((a) => a.startsWith('--expect=')) || '--expect=allowlist').split('=')[1];
const version = (process.argv.find((a) => a.startsWith('--version=')) || '').split('=')[1] || null;
const featureSet = (process.argv.find((a) => a.startsWith('--features=')) || '--features=six').split('=')[1];
if (featureSet !== 'six' && featureSet !== 'seven') { console.error('--features precisa ser six ou seven'); process.exit(2); }
const shellExpected = featureSet === 'seven' && !process.argv.includes('--shell=off');
const allowlistSize = Number((process.argv.find((a) => a.startsWith('--allowlist-size=')) || '--allowlist-size=5').split('=')[1]);
const sample = JSON.parse(readFileSync(new URL('./catalog-sample.json', import.meta.url), 'utf8')).products.map((p) => p.slug);
const outside = sample.filter((s) => !FIVE_SLUGS.includes(s));
const failures = []; let checks = 0;
const check = (name, ok, detail = '') => { checks++; if (!ok) { failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); } };
const get = async (path, init = {}) => { const r = await fetch(HOST + path, { redirect: 'manual', ...init }); return { status: r.status, body: await r.text(), headers: r.headers }; };

const health = await (await fetch(HOST + '/__origens/health')).json();
const h = evaluateHealth(health, expect, { loaderVersion: version, features: featureSet === 'seven' ? SEVEN_FEATURES : SIX_FEATURES, allowlistSize });
check('health no estado esperado (' + expect + ')', h.ok, h.problems.join('; '));
for (const slug of FIVE_SLUGS) { const r = await get('/usesul/product/' + slug); check('cinco produtos: ' + slug.slice(0, 28) + ' 200 com 1 loader', r.status === 200 && countLoaders(r.body) === 1 && /id="cart"/.test(r.body), `status ${r.status}, loaders ${countLoaders(r.body)}`); }
for (const slug of outside) { const r = await get('/usesul/product/' + slug); const n = countLoaders(r.body); check(`amostra ${expect === 'catalog' ? 'COM' : 'SEM'} loader: ${slug.slice(0, 28)}`, r.status === 200 && n === (expect === 'catalog' ? 1 : 0), `status ${r.status}, loaders ${n}`); }
// Sempre sem loader, em qualquer modo: não-produto, transacional, 404 de produto, subcaminho e Turbo-Frame.
const SHELL_PATHS = ['/usesul', '/usesul/products'];
for (const path of ['/usesul/cart', '/usesul/checkout/contact_and_shipping_details', '/usesul/product/produto-que-nao-existe-zzz-123', '/usesul/product/a/b']) { const r = await get(path); check('sem loader: ' + path, r.status < 500 && countLoaders(r.body) === 0, `status ${r.status}`); }
// Home e listagem: sem loader no estado de seis features; COM exatamente um (páginas de casca) no estado da navbar.
for (const path of SHELL_PATHS) { const r = await get(path); const want = shellExpected ? 1 : 0; check(`${want ? 'casca COM 1 loader' : 'sem loader'}: ${path}`, r.status < 500 && countLoaders(r.body) === want, `status ${r.status}, loaders ${countLoaders(r.body)}`); }
const tf = await get('/usesul/product/' + FIVE_SLUGS[0], { headers: { 'Turbo-Frame': 'cart' } }); check('Turbo-Frame sem loader', tf.status === 200 && countLoaders(tf.body) === 0);
const loaderJs = await get('/__origens/loader.js'); check('loader.js servido com o modo de escopo correto', loaderJs.status === 200 && new RegExp('SCOPE_MODE = "' + (expect === 'catalog' ? 'product-catalog' : 'allowlist') + '"').test(loaderJs.body) || (expect === 'allowlist' && !/SCOPE_MODE/.test(loaderJs.body)), `status ${loaderJs.status}`);
const search = await get('/__origens/search?q=floria'); check('gateway de busca responde com cidades', search.status === 200 && /Florian/.test(search.body));
if (featureSet === 'seven') {
  if (shellExpected) check('health: shell_pages ligado (catálogo + header-nav)', health.shell_pages === true, String(health.shell_pages));
  if (shellExpected) {
    // Páginas de casca: exatamente UM loader, com e sem query string (a rota da Cloudflare precisa casar as duas formas).
    const collection = ((await (await fetch('https://useorigens.com.br/api/navbar/sul')).json().catch(() => ({}))).top || [])[0];
    const shellOk = ['/usesul?utm_source=smoke', '/usesul/products?product_type=1', '/usesul/about', '/usesul/orders/trackings', ...(collection ? ['/usesul/collections/' + collection.slug] : [])];
    for (const path of shellOk) { const r = await get(path); check('casca COM 1 loader: ' + path, r.status === 200 && countLoaders(r.body) === 1, `status ${r.status}, loaders ${countLoaders(r.body)}`); }
    // Conta: sem sessão a INK redireciona ao login (o Worker repassa o redirect sem tocar); login nunca recebe o loader.
    const orders = await get('/usesul/orders'); check('conta sem sessão: redirect da INK repassado, sem loader: /usesul/orders', [301, 302, 303].includes(orders.status) && countLoaders(orders.body) === 0 && /store_sessions/.test(orders.headers.get('location') || ''), `status ${orders.status}`);
    for (const path of ['/usesul/store_sessions/new', '/usesul/orders/1/2', '/usesul/collections']) { const r = await get(path); check('nunca casca: ' + path, r.status < 500 && countLoaders(r.body) === 0, `status ${r.status}`); }
  }
  const nav = await get('/__origens/navbar'); let cfg = null; try { cfg = JSON.parse(nav.body); } catch (_) { /* fica null */ }
  const entryOk = (e) => Object.keys(e).sort().join() === 'id,order,slug,title';
  check('navbar: /__origens/navbar 200 JSON v2 com os grupos top/more (só id/título/slug/ordem) e os estados de Regiões', nav.status === 200 && cfg && cfg.v === 2 && Array.isArray(cfg.top) && Array.isArray(cfg.more) && Array.isArray(cfg.states) && [...cfg.top, ...cfg.more].every(entryOk), `status ${nav.status}`);
  check('navbar: o loader publicado carrega o módulo header-nav e o FAB de WhatsApp', /id: 'header-nav'/.test(loaderJs.body) && /id: 'whatsapp-fab'/.test(loaderJs.body));
  const sf = await (await fetch('https://useorigens.com.br/api/navbar/sul')).json().catch(() => null);
  const pick = (g) => JSON.stringify((g || []).map((e) => [e.title, e.slug]));
  check('navbar: os dois grupos do Worker são os do storefront (mesma fonte, mesma ordem, sem cópia)', cfg && sf && pick(cfg.top) === pick(sf.top) && pick(cfg.more) === pick(sf.more) && JSON.stringify(cfg.states) === JSON.stringify(sf.states), 'divergem');
}
const ref = await get('/__origens/cart-ref/AAAAAAAAAAAAAAAAAAAAAA'); check('cart-ref: token inexistente = 404 (rota viva; nada gravado)', ref.status === 404);

console.log(JSON.stringify({ expect, checks, failures: failures.length, featureSet, health: { version: health.version, scope_mode: health.scope_mode, allowlist_size: health.allowlist_size, features: (health.widget_features || []).length } }));
process.exit(failures.length ? 1 : 0);
