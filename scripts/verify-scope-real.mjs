#!/usr/bin/env node
// Verificação SOMENTE LEITURA do escopo contra o HTML REAL da INK: roda o Worker (código deste repo) em Miniflare local e faz a
// origem devolver as páginas públicas reais (GET). Nada é publicado, nenhum cookie é enviado, nenhuma rota da Cloudflare é tocada.
//   node scripts/verify-scope-real.mjs            -> exit 0 = tudo conforme; 1 = alguma divergência (lista impressa)
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { LOADER_VERSION } from '../src/loader-source.js';

const HOST = 'https://www.usesul.com.br';
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery';
const sample = JSON.parse(readFileSync(new URL('./catalog-sample.json', import.meta.url), 'utf8')).products;
const FIVE = ['serra-catarinense', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a'];
const ALLOW = FIVE.map((s) => '/usesul/product/' + s).join(',');
const LOADER_RE = /\/__origens\/loader\.js\?v=/g;
const TAG_RE = /<script src="\/__origens\/loader\.js[^>]*><\/script>/;

const failures = []; let checks = 0;
const check = (name, ok, detail = '') => { checks++; if (!ok) { failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); } };

// Origem = a INK real (GET público, sem cookies). O corpo chega decodificado, como no runtime da Cloudflare.
// O que a origem devolveu NESTA transação fica guardado (páginas da INK têm tokens/horários que mudam a cada GET): a comparação é com isso.
const upstream = new Map();
async function realOrigin(req) {
  const res = await fetch(req.url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'use-origens-scope-check/1' } });
  const headers = new Headers(res.headers); headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('set-cookie');
  const buf = res.status === 204 || res.status === 304 ? null : await res.arrayBuffer();
  upstream.set(new URL(req.url).pathname, { status: res.status, body: buf ? new TextDecoder().decode(buf) : '' });
  return new Response(buf, { status: res.status, headers });
}
const make = (bindings) => new Miniflare({ modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: ALLOW, WIDGET_FEATURES: FEATURES, ...bindings }, outboundService: realOrigin });

const catalog = make({ WIDGET_SCOPE_MODE: 'product-catalog' }); const allow = make({});
const timings = [];
try {
  // 1) modo catálogo: amostra real => 1 loader, só a tag adicionada
  for (const p of sample) {
    const path = '/usesul/product/' + p.slug; const t0 = Date.now();
    const res = await catalog.dispatchFetch(HOST + path); const body = await res.text(); timings.push(Date.now() - t0);
    const orig = upstream.get(path);
    check('catálogo: ' + p.slug + ' 200 com 1 loader', res.status === 200 && (body.match(LOADER_RE) || []).length === 1, `status ${res.status}, loaders ${(body.match(LOADER_RE) || []).length}`);
    // Páginas que a produção JÁ injeta hoje (as cinco) chegam com o loader na origem: o Worker não duplica (corpo idêntico).
    const already = LOADER_RE.test(orig.body); LOADER_RE.lastIndex = 0;
    check('catálogo: ' + p.slug + (already ? ' já trazia o loader: corpo intacto (sem duplicar)' : ' só a tag foi adicionada, no fim do <body>'),
      already ? body === orig.body : body.replace(TAG_RE, '') === orig.body && body.indexOf('/__origens/loader.js') > body.indexOf('form-product-'), 'HTML alterado além da tag');
  }
  // 2) modo catálogo: rotas reais que NUNCA recebem o loader (e a resposta é a da origem)
  for (const path of ['/usesul', '/usesul/products', '/usesul/cart', '/usesul/checkout/contact_and_shipping_details', '/usesul/product/produto-que-nao-existe-zzz-123', '/usesul/product/a/b']) {
    const res = await catalog.dispatchFetch(HOST + path, { redirect: 'manual' }); const body = await res.text(); const orig = upstream.get(path);
    check('catálogo: ' + path + ' sem loader e igual à origem', (body.match(LOADER_RE) || []).length === 0 && res.status === orig.status && body === orig.body, `status ${res.status} vs ${orig.status}`);
  }
  // 3) Turbo-Frame e POST na mesma página real: nada
  const tf = await catalog.dispatchFetch(HOST + '/usesul/product/' + sample[0].slug, { headers: { 'Turbo-Frame': 'cart' } });
  check('catálogo: Turbo-Frame sem loader', ((await tf.text()).match(LOADER_RE) || []).length === 0);
  // 4) modo padrão (allowlist): só os cinco; o restante da amostra fora
  for (const slug of FIVE) { const b = await (await allow.dispatchFetch(HOST + '/usesul/product/' + slug)).text(); check('allowlist: ' + slug.slice(0, 30) + ' 1 loader (no <head>)', (b.match(LOADER_RE) || []).length === 1 && b.indexOf('/__origens/loader.js') < b.indexOf('</head>')); }
  for (const p of sample.filter((x) => !FIVE.includes(x.slug)).slice(0, 8)) { const b = await (await allow.dispatchFetch(HOST + '/usesul/product/' + p.slug)).text(); check('allowlist: ' + p.slug.slice(0, 30) + ' fora (sem loader)', (b.match(LOADER_RE) || []).length === 0); }
} finally { await catalog.dispose(); await allow.dispose(); }

const sorted = [...timings].sort((a, b) => a - b);
console.log(JSON.stringify({ loader_version: LOADER_VERSION, products_checked: sample.length, checks, failures: failures.length, worker_transform_ms_incl_origin: { p50: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) } }));
process.exit(failures.length ? 1 : 0);
