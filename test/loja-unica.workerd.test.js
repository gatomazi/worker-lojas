import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { workerModules } from './helpers.js';
import { STORES } from '../src/stores.js';

// Loja única no workerd REAL: o Worker da Use Sul com SERVE_REGIONS atende quem veio de /norte e /centro-oeste com a navbar, a cor e a volta da
// região de origem. A INK e o storefront são stubs; o storefront registra quais caminhos o Worker pediu.
const sul = STORES.sul;
const PRODUCT = sul.inkBase + '/product/belem-territorio-pa';
const INK_HTML = '<!doctype html><html><head><title>Produto</title></head><body><main><form id="form-product-1" class="form-product-options" action="' + sul.inkBase + '/cart?product_id=1" method="post"><button type="submit">Adicionar ao carrinho</button></form></main></body></html>';
const FEATURES = 'return-link,header-nav,city-search,cart-mirror,list-session';

const instances = [];
after(async () => { for (const mf of instances) await mf.dispose(); });
async function worker(extra = {}) {
  const asked = [];
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: [sul.kvBinding],
    bindings: { STORE_ID: 'sul', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: PRODUCT, WIDGET_FEATURES: FEATURES, ...extra },
    outboundService: async (request) => {
      const url = new URL(request.url);
      if (url.host === 'useorigens.com.br') {
        asked.push(url.pathname);
        return Response.json({ region: url.pathname.split('/').pop(), v: 1, groups: [], states: [] });
      }
      if (url.host === sul.inkHost) return new Response(INK_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'sess=abc; Path=/' } });
      return new Response('unexpected host ' + url.host, { status: 599 });
    }
  });
  instances.push(mf);
  return { mf, asked };
}
const at = (path) => 'https://' + sul.inkHost + path;
const loaderSrc = (html) => (/src="(\/__origens\/loader\.js\?[^"]+)"/.exec(html) || [])[1];

test('with SERVE_REGIONS, a visitor from /norte gets the Norte loader, a remembered region and the Norte navbar; the origin cookies survive', async () => {
  const { mf, asked } = await worker({ SERVE_REGIONS: 'sul,norte,centro-oeste' });
  const health = await (await mf.dispatchFetch(at('/__origens/health'))).json();
  assert.deepEqual(health.served_regions, ['sul', 'norte', 'centro-oeste']);
  assert.equal(health.served_regions_status, 'ok');

  const page = await mf.dispatchFetch(at(PRODUCT + '?origens_r=norte'));
  const cookies = page.headers.get('set-cookie') || '';
  assert.match(cookies, /origens_r=norte; Path=\/; Max-Age=2592000; Secure; SameSite=Lax/);
  assert.match(cookies, /sess=abc/, 'the INK session cookie is kept');
  const src = loaderSrc(await page.text());
  assert.match(src, /&r=norte$/);

  const loader = await (await mf.dispatchFetch(at(src))).text();
  assert.match(loader, /"base":"\/norte"/);
  assert.match(loader, new RegExp('"primary":"' + STORES.norte.theme.primary + '"'));
  assert.match(loader, /"inkHost":"www\.usesul\.com\.br"/, 'the purchase stays in the single store');

  // The next page (no parameter) and the gateways follow the cookie.
  const next = await mf.dispatchFetch(at(PRODUCT), { headers: { cookie: 'sess=abc; origens_r=norte' } });
  assert.equal(next.headers.get('set-cookie'), 'sess=abc; Path=/', 'nothing new to remember');
  assert.match(loaderSrc(await next.text()), /&r=norte$/);
  await mf.dispatchFetch(at('/__origens/navbar'), { headers: { cookie: 'origens_r=norte' } });
  assert.ok(asked.includes('/api/navbar/norte'), asked.join(','));
  // What the browser really sends: the loader asks with credentials:'omit' (no cookie), so the region rides in the address — and the Norte
  // loader puts it there.
  asked.length = 0;
  await mf.dispatchFetch(at('/__origens/navbar?origens_r=norte'));
  assert.ok(asked.includes('/api/navbar/norte'), 'no cookie, region in the address: ' + asked.join(','));
  assert.match(loader, /'origens_r=' \+ encodeURIComponent\(STORE\.region\)/, 'the loader sends its region on the gateway requests');

  // The plain page (no region yet) is the store's own: Sul.
  const plain = await mf.dispatchFetch(at(PRODUCT));
  assert.doesNotMatch(loaderSrc(await plain.text()), /&r=/);
});

test('a region the store does not serve, or a forged loader region, is ignored', async () => {
  const { mf } = await worker({ SERVE_REGIONS: 'sul,norte' });
  const page = await mf.dispatchFetch(at(PRODUCT + '?origens_r=centro-oeste'));
  assert.doesNotMatch(page.headers.get('set-cookie') || '', /origens_r/);
  assert.doesNotMatch(loaderSrc(await page.text()), /&r=/);
  const forged = await mf.dispatchFetch(at(PRODUCT), { headers: { cookie: 'origens_r=../x' } });
  assert.doesNotMatch(loaderSrc(await forged.text()), /&r=/);
});

test('without SERVE_REGIONS (every Worker today), the parameter changes nothing', async () => {
  const { mf } = await worker();
  const health = await (await mf.dispatchFetch(at('/__origens/health'))).json();
  assert.deepEqual(health.served_regions, ['sul']);
  assert.equal(health.served_regions_status, 'single');
  const page = await mf.dispatchFetch(at(PRODUCT + '?origens_r=norte'));
  assert.equal(page.headers.get('set-cookie'), 'sess=abc; Path=/');
  assert.doesNotMatch(loaderSrc(await page.text()), /&r=/);
});

test('a SERVE_REGIONS without the store\'s own region is refused (only its own region is served)', async () => {
  const { mf } = await worker({ SERVE_REGIONS: 'norte,centro-oeste' });
  const health = await (await mf.dispatchFetch(at('/__origens/health'))).json();
  assert.deepEqual(health.served_regions, ['sul']);
  assert.equal(health.served_regions_status, 'invalid');
});
