import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { cleanMessage, normalizeBoot, normalizeReply, validateItem, validateLink } from '../src/assistant-gateway.js';
import { parseFeatures, FEATURE_NAMES } from '../src/features.js';

// Rota /__origens/assistente no workerd REAL, com o storefront e a INK como stubs (outboundService). O assistente só existe com a flag assistant.
const HOST = 'https://www.usesul.com.br';
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/main_image/';
const item = (id, extra = {}) => ({ title: 'Item ' + id, context: 'Florianópolis · SC', image: IMG + id + '.jpg', price: 109.9, href: HOST + '/usesul/product/item-' + id, productId: String(id), ...extra });
const opening = { v: 1, kind: 'greeting', text: 'Oi! Posso ajudar?', suggestions: ['Tem estampa da minha cidade?', 'Qual é o tecido das camisetas?'] };
const reply = {
  v: 1, kind: 'designs', text: 'Estampas de Florianópolis:',
  items: [item(1), item(2), item(3, { href: 'https://www.useorigens.com.br/sul/sc/florianopolis/ponto-de-origem', productId: undefined })],
  links: [{ kind: 'page', label: 'Ver as 8 estampas de Florianópolis', href: 'https://www.useorigens.com.br/sul/sc/florianopolis' }]
};
const calls = [];
const instances = new Map();
let storefront = () => Response.json({ v: 1, region: 'sul', enabled: true, opening, whatsapp: true });
async function worker(bindings) {
  const key = JSON.stringify(bindings);
  if (!instances.has(key)) {
    instances.set(key, new Miniflare({
      ...workerModules(), compatibilityDate: '2026-08-01', bindings,
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push({ host: url.host, path: url.pathname, method: request.method, cookie: request.headers.get('cookie'), visitor: request.headers.get('x-origens-visitor'), body: request.method === 'POST' ? await request.text() : null });
        if (url.host === 'useorigens.com.br') return storefront(request, url);
        if (url.pathname.startsWith('/__origens/')) return new Response('INK 404', { status: 404, headers: { 'content-type': 'text/html' } });
        return new Response('<!doctype html><html><head></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
      }
    }));
  }
  return instances.get(key);
}
after(async () => { for (const mf of instances.values()) await mf.dispose(); });

const BASE = { ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '' };
const ON = { ...BASE, WIDGET_FEATURES: 'return-link,promo-fab,assistant' };
const OFF = { ...BASE, WIDGET_FEATURES: 'return-link,promo-fab' };

test('feature: assistant is a known flag, and the whole list (every feature) still fits the size cap', () => {
  assert.ok(FEATURE_NAMES.includes('assistant'));
  assert.equal(parseFeatures(FEATURE_NAMES.join(',')).status, 'ok');
  assert.equal(parseFeatures('assistant,nao-existe').status, 'invalid');
});

test('cleanMessage: one line of text, up to 300 characters, no control characters', () => {
  assert.equal(cleanMessage('  tem   de Floripa? '), 'tem de Floripa?');
  assert.equal(cleanMessage(''), '');
  for (const bad of [null, 3, 'x'.repeat(301), 'a\u0000b']) assert.equal(cleanMessage(bad), null, String(bad).slice(0, 20));
});

test('validateItem/validateLink: products only of THIS store on INK, pages only of this region, orders rebuilt from the store, WhatsApp only wa.me', () => {
  assert.deepEqual(validateItem(item(1)), { title: 'Item 1', image: IMG + '1.jpg', href: HOST + '/usesul/product/item-1', context: 'Florianópolis · SC', price: 109.9, productId: '1' });
  assert.equal(validateItem(item(1, { href: 'https://www.useorigens.com.br/sul/sc/florianopolis' })).href, 'https://useorigens.com.br/sul/sc/florianopolis');
  for (const bad of [{ href: 'https://www.usenorte.com.br/usenorte/product/x' }, { href: HOST + '/usesul/product/x?cart_ref=1' }, { href: 'https://evil.example/sul' }, { href: 'https://useorigens.com.br/norte/am' }, { image: 'https://evil.example/a.jpg' }, { title: '<b>x</b>' }, { price: 0 }, { productId: 'abc' }]) {
    assert.equal(validateItem(item(1, bad)), null, JSON.stringify(bad));
  }
  assert.deepEqual(validateLink({ kind: 'orders', label: 'Meus pedidos', href: 'https://evil.example/x' }), { kind: 'orders', label: 'Meus pedidos', href: HOST + '/usesul/orders' }, 'the payload only picks the kind');
  assert.deepEqual(validateLink({ kind: 'tracking', label: 'Status do pedido' }), { kind: 'tracking', label: 'Status do pedido', href: HOST + '/usesul/orders/trackings' });
  assert.equal(validateLink({ kind: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/5548988082581?text=Ol%C3%A1' }).href, 'https://wa.me/5548988082581?text=Ol%C3%A1');
  assert.equal(validateLink({ kind: 'search', label: 'Ver as 13', href: 'https://www.useorigens.com.br/sul/busca?q=mae' }).href, 'https://useorigens.com.br/sul/busca?q=mae');
  for (const bad of [
    { kind: 'whatsapp', label: 'x', href: 'https://evil.example/5548988082581' },
    { kind: 'whatsapp', label: 'x', href: 'https://wa.me/123?text=a' },
    { kind: 'whatsapp', label: 'x', href: 'https://wa.me/5548988082581?text=a&phone=1' },
    { kind: 'search', label: 'x', href: 'https://useorigens.com.br/norte/busca?q=a' },
    { kind: 'page', label: 'x', href: 'https://useorigens.com.br/sul?x=1' },
    { kind: 'page', label: 'x', href: 'javascript:alert(1)' },
    { kind: 'other', label: 'x', href: 'https://useorigens.com.br/sul' },
    { kind: 'page', label: '<b>', href: 'https://useorigens.com.br/sul' }
  ]) assert.equal(validateLink(bad), null, JSON.stringify(bad));
});

test('normalizeReply/normalizeBoot: v1 of THIS region only; a bad card or link drops alone, a bad text drops the reply', () => {
  const r = normalizeReply({ ...reply, items: [...reply.items, item(4, { image: 'https://evil.example/x.jpg' }), item(5), item(6)], suggestions: ['a', '<b>', 'c'] });
  assert.deepEqual(r.items.map((i) => i.title), ['Item 1', 'Item 2', 'Item 3', 'Item 5']);
  assert.deepEqual(r.suggestions, ['a', 'c']);
  assert.equal(normalizeReply({ ...reply, text: 'Linha 1\nLinha 2' }).text, 'Linha 1\nLinha 2');
  assert.equal(normalizeReply({ ...reply, text: '<script>' }), null);
  assert.equal(normalizeReply({ ...reply, kind: 'outra' }), null);
  assert.deepEqual(normalizeBoot({ v: 1, region: 'sul', enabled: false }), { v: 1, enabled: false });
  assert.equal(normalizeBoot({ v: 1, region: 'norte', enabled: true, opening }), null);
  assert.equal(normalizeBoot({ v: 1, region: 'sul', enabled: true, opening: { ...opening, kind: 'answer' } }), null);
  const boot = normalizeBoot({ v: 1, region: 'sul', enabled: true, opening, whatsapp: 'https://wa.me/5548988082581?text=Ol%C3%A1' });
  assert.equal(boot.opening.text, 'Oi! Posso ajudar?'); assert.equal(boot.whatsapp, 'https://wa.me/5548988082581?text=Ol%C3%A1');
  assert.equal(normalizeBoot({ v: 1, region: 'sul', enabled: true, opening, whatsapp: 'https://evil.example/x' }).whatsapp, undefined);
  assert.deepEqual(validateLink({ kind: 'collection', label: 'Ver Natal na loja', href: HOST + '/usesul/collections/natal' }), { kind: 'collection', label: 'Ver Natal na loja', href: HOST + '/usesul/collections/natal' });
  for (const bad of [HOST + '/usesul/collections/natal?x=1', 'https://www.usenorte.com.br/usenorte/collections/natal', HOST + '/usesul/product/natal', HOST + '/usesul/collections/../orders']) assert.equal(validateLink({ kind: 'collection', label: 'x', href: bad }), null, bad);
  assert.equal(normalizeReply({ v: 1, kind: 'chat', text: 'Por nada!' }).kind, 'chat');
});

test('flag OFF: the route is INK\'s (its 404); nothing reaches the storefront', async () => {
  const mf = await worker(OFF); calls.length = 0;
  const res = await mf.dispatchFetch(HOST + '/__origens/assistente');
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'INK 404');
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0);
});

test('flag ON, GET: the opening comes from the storefront, revalidated, without the visitor cookie, cached a minute', async () => {
  const mf = await worker(ON); calls.length = 0;
  storefront = () => Response.json({ v: 1, region: 'sul', enabled: true, opening, whatsapp: 'https://wa.me/5548988082581?text=Ol%C3%A1' });
  const res = await mf.dispatchFetch(HOST + '/__origens/assistente?origens_r=sul', { headers: { cookie: 'session=secret' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  const body = await res.json();
  assert.equal(body.enabled, true); assert.equal(body.opening.text, 'Oi! Posso ajudar?'); assert.equal(body.whatsapp, 'https://wa.me/5548988082581?text=Ol%C3%A1');
  const sf = calls.filter((c) => c.host === 'useorigens.com.br');
  assert.deepEqual(sf.map((c) => [c.method, c.path, c.cookie]), [['GET', '/api/assistente/sul', null]]);
});

test('flag ON, POST: only the cleaned message goes on, with a visitor hash (never the IP or the cookie); the reply is revalidated and never cached', async () => {
  const mf = await worker(ON); calls.length = 0;
  storefront = () => Response.json({ ...reply, links: [...reply.links, { kind: 'orders', label: 'Meus pedidos', href: 'https://evil.example/' }] });
  const res = await mf.dispatchFetch(HOST + '/__origens/assistente?origens_r=sul', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session=secret', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ message: '  tem   de Floripa? ', extra: 'x' }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.items.length, 3);
  assert.deepEqual(body.links.map((l) => l.href), ['https://useorigens.com.br/sul/sc/florianopolis', HOST + '/usesul/orders']);
  const sent = calls.find((c) => c.host === 'useorigens.com.br');
  assert.equal(sent.method, 'POST'); assert.equal(sent.path, '/api/assistente/sul'); assert.equal(sent.cookie, null);
  assert.deepEqual(JSON.parse(sent.body), { message: 'tem de Floripa?' });
  assert.match(sent.visitor, /^[a-f0-9]{32}$/);
  assert.doesNotMatch(sent.visitor, /203/);
});

test('flag ON, POST: malformed input is refused here; the storefront\'s 429 passes; any other failure is a 503 JSON (never a Cloudflare page)', async () => {
  const mf = await worker(ON); calls.length = 0;
  const post = (body, type = 'application/json') => mf.dispatchFetch(HOST + '/__origens/assistente', { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await post('{"message":1}')).status, 400);
  assert.equal((await post('nope')).status, 400);
  assert.equal((await post('{"message":"oi"}', 'text/plain')).status, 415);
  assert.equal((await post(JSON.stringify({ message: 'x'.repeat(2100) }))).status, 413);
  assert.equal(calls.filter((c) => c.host === 'useorigens.com.br').length, 0);
  storefront = () => Response.json({ v: 1, error: 'slow down' }, { status: 429 });
  assert.equal((await post('{"message":"oi"}')).status, 429);
  storefront = () => Response.json({ v: 1, kind: 'answer', text: '<b>x</b>' });
  const bad = await post('{"message":"oi"}');
  assert.equal(bad.status, 503); assert.deepEqual(await bad.json(), { error: 'unavailable' });
  storefront = () => new Response('down', { status: 502 });
  assert.equal((await post('{"message":"oi"}')).status, 503);
  assert.equal((await mf.dispatchFetch(HOST + '/__origens/assistente', { method: 'PUT' })).status, 405);
});
