#!/usr/bin/env node
// Micro-benchmark LOCAL (Miniflare/workerd, origem = HTML de ~170 KB em memória): custo da reescrita do HTMLRewriter e tamanho dos
// scripts servidos. NÃO é CPU faturada da Cloudflare: é um indicador relativo (injeção x repasse) para o operador.
//   node scripts/bench-injection.mjs
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
const SRC = new URL('../src/', import.meta.url).pathname;
const FILES = ['worker.js', 'allowlist.js', 'scope.js', 'features.js', 'search-gateway.js', 'navbar-gateway.js', 'stores.js', 'search-rank.js', 'cart-ref.js', 'loader-source.js', 'loader/runtime.js', 'loader/return-link.js', 'loader/drawer-watch.js', 'loader/cart-watch.js', 'loader/cart-mirror.js', 'loader/tracking.js', 'loader/product-discovery.js', 'loader/header-nav.js', 'loader/discovery-loader.js', 'loader/discovery-ui.js'];
const FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery';
const HTML = readFileSync(new URL('../test/fixtures/product-page.html', import.meta.url), 'utf8').replace('<main>', '<main>' + '<div class="filler">conteúdo da página de produto</div>\n'.repeat(3500)).replace('</main>', '</main><form id="form-product-1"></form>');
const make = (bindings) => new Miniflare({ modulesRoot: SRC, modules: FILES.map((f) => ({ type: 'ESModule', path: SRC + f })), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS'], bindings: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: '/usesul/product/serra-catarinense', WIDGET_FEATURES: FEATURES, ...bindings }, outboundService: async () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
const time = async (mf, path, n) => { const ts = []; for (let i = 0; i < n + 20; i++) { const t0 = performance.now(); const r = await mf.dispatchFetch('https://www.usesul.com.br' + path); await r.arrayBuffer(); if (i >= 20) ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return { p50: +ts[Math.floor(ts.length / 2)].toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2) }; };
const allow = make({}); const catalog = make({ WIDGET_SCOPE_MODE: 'product-catalog' });
const out = { html_kb: +(HTML.length / 1024).toFixed(0) };
out.passthrough_outside_scope_ms = await time(allow, '/usesul/product/fora-do-escopo', 300);
out.inject_head_allowlist_ms = await time(allow, '/usesul/product/serra-catarinense', 300);
out.inject_body_catalog_ms = await time(catalog, '/usesul/product/qualquer-produto', 300);
const size = async (mf, p) => { const b = Buffer.from(await (await mf.dispatchFetch('https://www.usesul.com.br' + p)).arrayBuffer()); return { bytes: b.length, gzip: gzipSync(b).length }; };
out.loader_js = await size(catalog, '/__origens/loader.js'); out.discovery_js = await size(catalog, '/__origens/discovery.js');
console.log(JSON.stringify(out, null, 1));
await allow.dispose(); await catalog.dispose();
