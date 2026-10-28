// Harness da prévia do tema da compra (usado por preview-tema.mjs e estados-tema.mjs): páginas REAIS da INK passando pelo Worker LOCAL (Miniflare,
// mesmo worker.js/HTMLRewriter/loader de produção) com a configuração do tema vinda de um arquivo (rascunho do painel). Nada é publicado.
// TRAVA: no navegador, qualquer não-GET para <loja>/checkout é ABORTADA (nunca chega à INK); as do carrinho também, salvo allowCart.
import { createRequire } from 'node:module';
import { shellPageKind } from '../../src/scope.js';
import { STORES, withInkDomain } from '../../src/stores.js';
import { checkoutPageKind, accountPageKind } from '../../src/theme.js';
import { propostaCss } from './propostas-cor.mjs';

// A paleta "acento" (verde com acento ocre, a proposta B escolhida em 17/10/2026) é o padrão do painel; `palette: 'neutra'` volta à derivada dos tokens.
export const REFERENCE_THEME = {
  v: 1, region: 'sul', surfaces: { pdp: true, cart: true, checkout: true }, palette: 'acento',
  tokens: { action: '#000000', onAction: '#ffffff', selected: '#4d543d', onSelected: '#ffffff', ground: '#ffffff', surface: '#ffffff', paper: '#f2f2f0', photo: '#e5e5e5', ink: '#000000', inkSoft: '#33332f', inkMute: '#56564f', line: '#b3b3b0', radius: 0, font: 'origens' }
};
export const LIVE_FEATURES = 'return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide,size-fit';
// A loja única atende em loja.useorigens.com.br/useorigens desde 16/10/2026 (SINGLE_STORE_DOMAIN=next em produção; o domínio antigo só redireciona).
// A prévia segue a produção; SINGLE_STORE_DOMAIN=current no ambiente volta ao domínio antigo.
export const SINGLE_STORE_DOMAIN = process.env.SINGLE_STORE_DOMAIN ?? 'next';
export const STORE = withInkDomain(STORES.sul, SINGLE_STORE_DOMAIN).store;
export const DEFAULT_PDP = STORE.inkBase + '/product/florianopolis-legado-sc-b88373a3-9f47-418d-a6b4-f27757ac3fa4';
export const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
// Campos e blocos com dados pessoais do checkout: mascarados em TODA captura (inclusive "antes").
// Campos com valor vindo do servidor (contato/endereço) são mascarados; os VAZIOS (cartão, cobrança) ficam visíveis para avaliar o estilo — nada é digitado.
const PII = ['[data-controller="ink-store--checkout"] input[value]:not([value=""]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"])', '[data-controller="ink-store--checkout"] select:has(option[selected]:not([value=""]))', '.md\\:hidden.flex.flex-col .text-sm.font-normal', '.md\\:hidden.flex.flex-col .text-lg', '.md\\:flex.md\\:flex-col.items-center small', '.md\\:hidden.flex.md\\:flex-col small', '#saved_address_offer', 'turbo-frame#cart_summary + * small'];

// `config` é lido A CADA pedido do Worker ao storefront: mudar o objeto durante a sessão simula uma nova publicação no painel (o Worker ainda guarda 60 s
// por isolate). `themeFeatures` troca as features de tema do deploy (padrão: as três).
// SANITIZAÇÃO do checkout para capturas de apresentação: lê do PRÓPRIO HTML os valores pessoais (inputs de contato e de endereço) e troca TODAS as
// ocorrências (atributos e textos, também em só dígitos) por dados fictícios ANTES de a página chegar ao navegador. Nenhum dado real fica no código. Se
// algum valor original sobrar, lança erro (a captura não acontece). Os campos de cartão vêm vazios da INK e continuam vazios.
const FAKE = {
  'user[email]': 'cliente@exemplo.com', 'user[first_name]': 'Cliente', 'user[last_name]': 'Exemplo', 'user[phone]': '(48) 90000-0000', 'user[document]': '000.000.000-00',
  'cart[cep]': '88000-000', street: 'Rua Exemplo', number: '100', neighbourhood: 'Centro', city: 'Cidade Exemplo', complement: ''
};
const decode = (v) => v.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// `learned`: o que já foi aprendido em outra tela do MESMO checkout (a de pagamento só mostra o endereço em texto, sem os campos de contato).
export function sanitizeCheckout(html, learned = new Map()) {
  const found = new Map(learned); // valor original -> fictício
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    const name = (/\bname="([^"]+)"/.exec(tag) || [])[1];
    const value = (/\bvalue="([^"]*)"/.exec(tag) || [])[1];
    if (!name || !value || value.length < 2) continue;
    const field = (/\[(?:shipping|billing)_address\]\[([a-z_]+)\]/.exec(name) || [])[1];
    const fake = Object.hasOwn(FAKE, name) ? FAKE[name] : (field && Object.hasOwn(FAKE, field) ? FAKE[field] : null);
    if (fake === null || (field === 'number')) continue; // número da casa sozinho não identifica; evita trocar números de preço
    const original = decode(value).trim();
    if (original.length < 2) continue;
    found.set(original, fake);
    const digits = original.replace(/\D/g, '');
    if (digits.length >= 8 && digits !== original) found.set(digits, fake.replace(/\D/g, '') || fake);
  }
  let out = html;
  for (const [original, fake] of [...found.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const esc = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'g'), fake).replace(new RegExp(esc.replace(/'/g, '&#39;').replace(/"/g, '&quot;'), 'g'), fake);
  }
  // Número da casa: trocado só no campo e logo depois da rua fictícia (um número solto aparece em preços e datas; trocá-lo no texto todo estragaria a página).
  out = out.replace(/<input\b[^>]*name="cart\[(?:shipping|billing)_address\]\[number\]"[^>]*>/g, (tag) => tag.replace(/\bvalue="[^"]*"/, 'value="' + FAKE.number + '"'))
    .replace(new RegExp('(' + FAKE.street + ',\\s*)[0-9]+[A-Za-z]?', 'g'), '$1' + FAKE.number);
  if (found.size === 0) throw new Error('sanitização recusada: nenhum valor pessoal aprendido (abra antes a tela de contato e entrega)');
  for (const original of found.keys()) if (out.includes(original)) throw new Error('sanitização incompleta: um valor pessoal sobrou no HTML');
  // Rede de segurança: nenhum CEP no texto visível além do fictício.
  const text = out.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  if ((text.match(/\b\d{5}-\d{3}\b/g) || []).some((c) => c !== FAKE['cart[cep]'])) throw new Error('sanitização incompleta: sobrou um CEP real no texto');
  return { html: out, replaced: found.size, learned: found };
}

// allowPaymentDiscount: deixa passar SÓ o POST de recálculo do desconto ao trocar Pix/cartão (<loja>/checkout/payment_discount/<id>), que não cria pedido
// nem cobrança; a resposta também é sanitizada. Pagamento (process_payment), contato e entrega continuam abortados.
// proposta: 'A' | 'B' injeta a proposta de cor (scripts/lib/propostas-cor.mjs) no fim do <head> das páginas reescritas: SÓ na prévia, para comparar.
// rotulo: etiqueta fixa no canto (só na prévia aberta à mão), para distinguir janelas de versões diferentes.
// `storefront`: respostas fixas do storefront por caminho ({ '/api/post-add-kit/sul': {...} }), para provar um contrato que a produção ainda não serve.
export async function createHarness({ config = REFERENCE_THEME, off = false, headed = false, allowCart = false, themeFeatures = 'theme-pdp,theme-cart,theme-checkout', sanitize = false, allowPaymentDiscount = false, proposta = null, rotulo = null, storefront = {} } = {}) {
  const etiqueta = rotulo ? 'body::before{content:' + JSON.stringify(rotulo) + ';position:fixed;top:6px;left:6px;z-index:2147483647;padding:3px 8px;background:#1b1d19;color:#fff;font:700 11px/1.3 system-ui;letter-spacing:.04em;pointer-events:none;opacity:.88}' : '';
  const propostaStyle = proposta || etiqueta ? '<style data-origens-proposta="' + (proposta || 'atual') + '">' + (proposta ? propostaCss(proposta) : '') + etiqueta + '</style>' : '';
  const require = createRequire((process.env.PW_PATH || '.') + '/');
  const { chromium } = require('playwright-core');
  const { Miniflare } = await import(process.env.MINIFLARE || 'miniflare');
  const { workerModules } = await import('../../test/helpers.js');
  const store = STORE;
  const HOST = 'https://' + store.inkHost;
  const features = off || !themeFeatures ? LIVE_FEATURES : LIVE_FEATURES + ',' + themeFeatures;
  const upstream = { html: '', status: 200 };
  const mf = new Miniflare({
    ...workerModules(), compatibilityDate: '2026-08-01', kvNamespaces: ['CART_REFS', 'NORTE_CART_REFS', 'CENTRO_CART_REFS'],
    bindings: { STORE_ID: 'sul', ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: 'product-catalog', WIDGET_ALLOWLIST: '', WIDGET_FEATURES: features, SINGLE_STORE_DOMAIN },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.host === 'useorigens.com.br' && url.pathname === store.inkThemeApi) return Response.json(config);
      if (url.host === 'useorigens.com.br' && Object.hasOwn(storefront, url.pathname)) return Response.json(storefront[url.pathname]);
      if (url.host === 'useorigens.com.br') return fetch(req.url, { headers: { accept: 'application/json' } });
      return new Response(upstream.html, { status: upstream.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !headed });
  const blocked = [];
  const passed = []; // POSTs liberados (só payment_discount, com allowPaymentDiscount)
  const learned = new Map(); // sanitização: valores aprendidos na tela de contato (vale para a de pagamento)
  async function session({ name, width, height }) {
    const mobile = width < 600;
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.route(/googletagmanager|google-analytics|facebook|connect\.facebook|newrelic|nr-data|tiktok|doubleclick|clarity\.ms|hotjar|kdt|konduto/, (r) => r.abort());
    await ctx.route((u) => u.host === store.inkHost && !u.pathname.startsWith('/cdn-cgi/') && !u.pathname.startsWith('/__origens/'), async (route) => {
      const req = route.request();
      if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback();
      const path = new URL(req.url()).pathname;
      const safe = (p) => p.replace(/[0-9a-f-]{36}/g, '<uuid>').replace(/\d{5,}/g, '<id>');
      if (allowPaymentDiscount && req.method() === 'POST' && new RegExp('^' + store.inkBase + '/checkout/payment_discount/[0-9a-zA-Z-]+$').test(path)) {
        const res = await route.fetch({ maxRedirects: 0, timeout: 60000 });
        let body = await res.text();
        if (sanitize) {
          try { body = sanitizeCheckout(body, learned).html; } catch (error) { if (!/nenhum valor pessoal aprendido/.test(error.message)) { console.error('[harness] ' + error.message); return route.fulfill({ status: 451, contentType: 'text/plain', body: 'resposta não sanitizada' }); } }
        }
        passed.push(name + ' ' + req.method() + ' ' + safe(path) + ' -> ' + res.status());
        const headers = { ...res.headers() }; delete headers['content-length']; delete headers['content-encoding'];
        return route.fulfill({ status: res.status(), headers, body });
      }
      if (path.includes('/checkout') || !allowCart) { blocked.push(name + ' ' + req.method() + ' ' + path.replace(/[0-9a-f-]{36}/g, '<uuid>').replace(/\d{5,}/g, '<id>')); return route.abort(); }
      return route.fallback();
    });
    await ctx.route('**/__origens/**', async (route) => {
      const req = route.request();
      const res = await mf.dispatchFetch(req.url(), { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '', origin: req.headers().origin || '', referer: req.headers().referer || '' }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
      await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    const productRe = new RegExp('^' + store.inkBase + '/product/[^/]+$');
    await ctx.route((u) => u.host === store.inkHost && (productRe.test(u.pathname) || shellPageKind(u.pathname, store.inkBase) !== null || checkoutPageKind(u.pathname, store.inkBase) !== null || accountPageKind(u.pathname, store.inkBase) !== null), async (route) => {
      const req = route.request();
      // Documento E visitas Turbo (fetch com Accept text/html): em produção a rota do Worker cobre o caminho seja qual for o tipo de pedido. Frames
      // (header Turbo-Frame) também passam pelo Worker, que os devolve intactos — como no real.
      const kind = req.resourceType();
      if (req.method() !== 'GET' || !(kind === 'document' || ((kind === 'fetch' || kind === 'xhr') && /text\/html/.test(req.headers().accept || '')))) return route.fallback();
      const res = await route.fetch({ maxRedirects: 0, timeout: 60000 });
      if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
      upstream.html = await res.text(); upstream.status = res.status();
      if (sanitize && checkoutPageKind(new URL(req.url()).pathname, store.inkBase) !== null) {
        try { const r = sanitizeCheckout(upstream.html, learned); upstream.html = r.html; for (const [k, v] of r.learned) learned.set(k, v); }
        catch (error) { console.error('[harness] ' + error.message); return route.fulfill({ status: 451, contentType: 'text/plain', body: 'checkout não sanitizado: captura recusada' }); }
      }
      const fwd = { accept: req.headers().accept || 'text/html' };
      if (req.headers()['turbo-frame']) fwd['turbo-frame'] = req.headers()['turbo-frame'];
      const out = await mf.dispatchFetch(req.url(), { headers: fwd });
      const headers = { ...res.headers() }; delete headers['content-length']; delete headers['content-encoding']; delete headers.etag;
      let body = await out.text();
      if (propostaStyle && body.includes('</head>')) body = body.replace('</head>', propostaStyle + '</head>');
      await route.fulfill({ status: out.status, headers, body });
    });
    const page = await ctx.newPage();
    return { ctx, page, mobile, name };
  }
  const acceptCookies = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /aceitar cookies/i.test(x.textContent || '')); if (b) b.click(); });
  const pii = (page) => [...PII.map((s) => page.locator(s)), page.locator('div:has(> div > a[aria-label="Editar endereço de entrega"]), div:has(> a[aria-label="Editar endereço de entrega"])'), page.locator('li', { hasText: /Entrega para/ })];
  const shot = (page, path, full = false) => page.screenshot({ path, fullPage: full, mask: pii(page), maskColor: '#ff5fa2' });
  const close = async () => { await browser.close(); await mf.dispose(); };
  // `upstream`: o HTML que a "INK" devolve ao Worker no próximo pedido (as provas com estrutura reconstruída, ex. páginas logadas, o trocam antes do pedido).
  return { session, browser, mf, upstream, blocked, passed, HOST, store, acceptCookies, shot, close };
}
