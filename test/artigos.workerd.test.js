import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';

// O Worker do artigos (src/artigos/worker.js) no workerd REAL: o HTMLRewriter de verdade, sobre a marcação do topo da Uma Penca. A Uma Penca e a vitrine são stubs.
const SRC = new URL('../src/', import.meta.url).pathname;
const MODULES = ['artigos/worker.js', 'artigos/escopo.js', 'artigos/site.js', 'artigos/rewrite.js', 'artigos/topo.js', 'navbar-gateway.js', 'stores.js'].map((file) => ({ type: 'ESModule', path: SRC + file }));
const PAGE = readFileSync(new URL('./fixtures/artigos-pagina.html', import.meta.url), 'utf8');
const NAVBAR = readFileSync(new URL('./fixtures/artigos-navbar-sul.json', import.meta.url), 'utf8');
const HOST = 'https://artigos.useorigens.com.br';
const HTML = { accept: 'text/html,application/xhtml+xml' };

const calls = [];
let storefront = () => new Response(NAVBAR, { headers: { 'content-type': 'application/json' } });
let origin = () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store, no-cache, must-revalidate', 'set-cookie': 'up_session=abc; Path=/; Secure', 'x-frame-options': 'SAMEORIGIN' } });

const instances = new Map();
// Um Miniflare por "cenário" (o `site` fica guardado 60 s no isolate: cenário novo = isolate novo).
async function worker(scenario, bindings = {}) {
  const key = scenario + JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      modulesRoot: SRC, modules: MODULES, compatibilityDate: '2026-08-01', bindings: { ARTIGOS_TOPO: 'true', ...bindings },
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, search: url.search, method: request.method, cookie: request.headers.get('cookie'), authorization: request.headers.get('authorization') });
        if (url.host === 'useorigens.com.br') return storefront(request);
        return origin(request);
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });
const get = async (scenario, path, init = {}, bindings) => { const mf = await worker(scenario, bindings); calls.length = 0; return mf.dispatchFetch(HOST + path, { headers: HTML, ...init }); };

test('com o topo ligado: logo e navegação da vitrine entram no topo, o ☰ nosso no celular, e a página segue igual', async () => {
  const res = await get('on', '/?tipo=caneca', { headers: { ...HTML, cookie: 'up_session=minha-sessao' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-origens-artigos'), 'topo');
  assert.equal(res.headers.get('cache-control'), 'no-store, no-cache, must-revalidate', 'os cabeçalhos da Uma Penca seguem');
  assert.equal(res.headers.get('set-cookie'), 'up_session=abc; Path=/; Secure');
  const html = await res.text();
  assert.equal((html.match(/data-origens-artigos="nav"/g) || []).length, 1);
  assert.equal((html.match(/data-origens-artigos="menu"/g) || []).length, 1);
  assert.equal((html.match(/<style data-origens-artigos="css">/g) || []).length, 1);
  // os dois logos (computador e celular) levam à vitrine e mostram o nome com a etiqueta
  assert.equal((html.match(/href="https:\/\/useorigens\.com\.br\/sul" title="Voltar para a Use Origens"/g) || []).length, 2);
  assert.equal((html.match(/class="oa-logo-img"/g) || []).length, 2);
  // a navegação é irmã do logo (fora do bloco que o Vue da Uma Penca compila) e o ☰ vem logo depois do nativo
  assert.match(html, /<\/a>\s*<\/div>\s*<\/div>\s*<div class="oa-nav" data-origens-artigos="nav">/);
  assert.match(html, /<i id="header-drawer-icon"><\/i><details class="oa-m"/);
  // nada foi removido nem acrescentado fora disso: o nativo continua no HTML (só some por CSS) e nenhum script nosso entrou
  assert.match(html, /<div id="header-desktop-nav" @mouseleave="closeMenu">/);
  assert.match(html, /id="header-cart-desktop"/);
  assert.equal((html.match(/<script/g) || []).length, 0);
  assert.match(html, /<div id="hotsite-content"><h1>Conheça os produtos<\/h1>/);
});

test('a vitrine é lida UMA vez, em GET, sem cookie nem Authorization do visitante; a origem recebe o pedido original', async () => {
  const res = await get('calls', '/', { headers: { ...HTML, cookie: 'up_session=minha-sessao', authorization: 'Bearer x' } });
  assert.equal(res.status, 200); await res.text();
  const front = calls.filter((c) => c.host === 'useorigens.com.br');
  assert.equal(front.length, 1);
  assert.deepEqual([front[0].path, front[0].method, front[0].cookie, front[0].authorization], ['/api/navbar/sul', 'GET', null, null]);
  const art = calls.filter((c) => c.host === 'artigos.useorigens.com.br');
  assert.equal(art.length, 1);
  assert.equal(art[0].cookie, 'up_session=minha-sessao', 'o cookie da Uma Penca segue para a Uma Penca, nunca para a vitrine');
  // uma segunda visita no minuto seguinte não lê a vitrine de novo
  const again = await (await worker('calls')).dispatchFetch(HOST + '/fale-conosco', { headers: HTML });
  await again.text();
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 1);
});

test('páginas de artigo e de contato também recebem o topo', async () => {
  for (const path of ['/caneca/la-de-chapeco-sc-444855.html?utm_source=x', '/fale-conosco', '/sobre', '/newsletter']) {
    const res = await get('paths', path);
    assert.equal(res.headers.get('x-origens-artigos'), 'topo', path);
    assert.match(await res.text(), /data-origens-artigos="nav"/, path);
  }
});

test('fora do escopo nada muda: carrinho, checkout, login, APIs, arquivos, POST, HEAD, pedido sem HTML e outro host', async () => {
  for (const path of ['/carrinho', '/checkout', '/checkout/pagamento', '/login', '/minha-conta', '/api/carrinho', '/sw_v2.js', '/manifest.json', '/caneca/sem-id.html', '/__origens/outra']) {
    const res = await get('fora', path);
    assert.equal(res.headers.get('x-origens-artigos'), null, path);
    assert.equal(await res.text(), PAGE, path);
    assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0, 'sem leitura da vitrine: ' + path);
  }
  const post = await get('fora', '/', { method: 'POST', body: 'a=1' });
  assert.equal(await post.text(), PAGE); assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'o POST chega à origem como veio');
  const json = await get('fora', '/', { headers: { accept: 'application/json' } });
  assert.equal(await json.text(), PAGE);
  const head = await get('fora', '/', { method: 'HEAD' });
  assert.equal(head.headers.get('x-origens-artigos'), null);
  const mf = await worker('fora');
  const other = await mf.dispatchFetch('https://outro.useorigens.com.br/', { headers: HTML });
  assert.equal(await other.text(), PAGE);
});

test('interruptor: sem ARTIGOS_TOPO=true o Worker só repassa (nem lê a vitrine)', async () => {
  for (const bindings of [{ ARTIGOS_TOPO: 'false' }, { ARTIGOS_TOPO: '1' }, { ARTIGOS_TOPO: 'dry-run' }]) {
    const res = await get('off' + bindings.ARTIGOS_TOPO, '/', {}, bindings);
    assert.equal(await res.text(), PAGE);
    assert.equal(res.headers.get('x-origens-artigos'), null);
    assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0);
  }
  const mf = new Miniflare({ modulesRoot: SRC, modules: MODULES, compatibilityDate: '2026-08-01', outboundService: async () => origin() });
  try { assert.equal(await (await mf.dispatchFetch(HOST + '/', { headers: HTML })).text(), PAGE, 'variável ausente'); } finally { await mf.dispose(); }
});

test('fail-aberto: vitrine com erro, lenta demais, fora do formato ou sem `site` => a página da Uma Penca chega exatamente como veio', async () => {
  const bad = {
    http500: () => new Response('boom', { status: 500 }),
    html: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    badjson: () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    schema: () => new Response(JSON.stringify({ v: 2, region: 'sul', states: [], top: [], more: [] }), { headers: { 'content-type': 'application/json' } }),
    wrongregion: () => new Response(JSON.stringify({ ...JSON.parse(NAVBAR), region: 'norte' }), { headers: { 'content-type': 'application/json' } }),
    throws: () => { throw new Error('network'); },
    slow: () => new Promise((resolve) => setTimeout(() => resolve(new Response(NAVBAR, { headers: { 'content-type': 'application/json' } })), 4000))
  };
  try {
    for (const [name, impl] of Object.entries(bad)) {
      storefront = impl;
      const started = Date.now();
      const res = await get('falha-' + name, '/');
      assert.equal(res.status, 200, name);
      assert.equal(await res.text(), PAGE, name);
      assert.equal(res.headers.get('x-origens-artigos'), null, name);
      if (name === 'slow') assert.ok(Date.now() - started < 3500, 'a espera pela vitrine é limitada (1,5 s)');
    }
  } finally {
    storefront = () => new Response(NAVBAR, { headers: { 'content-type': 'application/json' } });
  }
});

test('a origem manda o que quiser: redirect, 404 e não-HTML passam sem alteração', async () => {
  const keep = origin;
  try {
    origin = () => new Response(null, { status: 302, headers: { location: '/login' } });
    const redirect = await get('origem-302', '/', { redirect: 'manual' });
    assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/login');
    origin = () => new Response('nao achei', { status: 404, headers: { 'content-type': 'text/html' } });
    const missing = await get('origem-404', '/');
    assert.equal(missing.status, 404); assert.equal(await missing.text(), 'nao achei');
    origin = () => new Response('{"a":1}', { headers: { 'content-type': 'application/json' } });
    assert.equal(await (await get('origem-json', '/')).text(), '{"a":1}');
  } finally { origin = keep; }
});

test('um fragmento HTML sem os topos da Uma Penca fica intacto (nem o CSS entra)', async () => {
  const keep = origin;
  try {
    const fragment = '<div class="lista"><a href="/caneca/x-1.html">x</a></div>';
    origin = () => new Response(fragment, { headers: { 'content-type': 'text/html' } });
    assert.equal(await (await get('fragmento', '/')).text(), fragment);
  } finally { origin = keep; }
});

test('saúde: responde sem tocar a origem nem a vitrine, mostrando se o topo está ligado', async () => {
  const on = await get('saude-on', '/__origens/health', { headers: {} });
  assert.deepEqual(await on.json(), { ok: true, worker: 'use-origens-artigos', topo: 'on' });
  assert.equal(on.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
  const off = await get('saude-off', '/__origens/health', { headers: {} }, { ARTIGOS_TOPO: 'false' });
  assert.deepEqual(await off.json(), { ok: true, worker: 'use-origens-artigos', topo: 'off' });
});
