// Tema da compra na INK (theme-pdp, theme-cart, theme-checkout): a PDP, o carrinho e o checkout da INK com a cara da PDP do storefront.
// SÓ CSS, servido pelo próprio Worker em /__origens/theme.css e ligado por <link> no <head> das páginas que ele já reescreve (produto e casca) e,
// com theme-checkout, nas duas telas do checkout. Nada de JS no checkout, nenhum nó da INK é movido, clonado ou substituído: os controles nativos
// (variantes, quantidade, cupom, CEP, frete, pagamento) continuam os mesmos, só com outra aparência. Falhou o CSS? A página nativa segue igual.
//
// Configuração: o CMS do storefront publica por região (/api/ink-theme/<região>, contrato v1). O Worker lê no SERVIDOR (origem fixa de stores.js,
// sem cabeçalhos do visitante), valida estritamente e só então monta o CSS. Duas chaves por superfície: a feature do deploy (teto técnico) E o
// interruptor do painel (decisão do dono). Sem configuração válida = nenhuma injeção (a INK fica nativa), nunca um tema inventado.
// Contrato v1: { v:1, region, surfaces:{ pdp, cart, checkout }, tokens:{ action, onAction, selected, onSelected, ground, surface, paper, ink,
//   inkSoft, inkMute, line, radius:0|8, font:'origens'|'ink' } } — cores só #rrggbb (nenhum texto livre vira CSS).
import { ACTIVE_STORE } from './stores.js';
import { contentHash } from './loader-source.js';

export const THEME_PATH = '/__origens/theme.css';
export const THEME_VERSION = '1';
export const SURFACES = Object.freeze(['pdp', 'cart', 'checkout']);
export const SURFACE_FEATURE = Object.freeze({ pdp: 'theme-pdp', cart: 'theme-cart', checkout: 'theme-checkout' });
const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['action', 'onAction', 'selected', 'onSelected', 'ground', 'surface', 'paper', 'ink', 'inkSoft', 'inkMute', 'line'];
const FONTS = Object.freeze({
  // Hanken Grotesk é a fonte da PDP do storefront; a INK já carrega Poppins do Google Fonts, então a origem não é nova para a página.
  origens: { stack: '"Hanken Grotesk",Poppins,system-ui,-apple-system,"Segoe UI",sans-serif', import: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap' },
  ink: { stack: 'Poppins,system-ui,-apple-system,"Segoe UI",sans-serif', import: null }
});
const FETCH_TIMEOUT_MS = 1500; // o HTML espera a configuração (em paralelo com a INK): curto, e falha = página nativa
const FRESH_MS = 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_CHARS = 4096;

// ── Contrato ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }

// Aceita só o v1 DESTA loja; qualquer campo fora do formato, ou um par de cores sem contraste AA para texto, recusa o payload inteiro (null).
export function normalizeTheme(data, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || data.v !== 1 || data.region !== store.region) return null;
  const s = data.surfaces; const t = data.tokens;
  if (!s || typeof s !== 'object' || !t || typeof t !== 'object') return null;
  const surfaces = {};
  for (const key of SURFACES) { if (typeof s[key] !== 'boolean') return null; surfaces[key] = s[key]; }
  const tokens = {};
  for (const key of COLOR_KEYS) { if (typeof t[key] !== 'string' || !HEX.test(t[key])) return null; tokens[key] = t[key].toLowerCase(); }
  if (t.radius !== 0 && t.radius !== 8) return null;
  if (!Object.hasOwn(FONTS, t.font)) return null;
  tokens.radius = t.radius; tokens.font = t.font;
  // Defesa em profundidade (o CMS já confere): texto do botão e do selecionado legíveis, texto da página legível no fundo e nas superfícies.
  if (contrast(tokens.action, tokens.onAction) < 4.5 || contrast(tokens.selected, tokens.onSelected) < 4.5) return null;
  for (const bg of ['ground', 'surface', 'paper']) if (contrast(tokens.ink, tokens[bg]) < 4.5 || contrast(tokens.inkMute, tokens[bg]) < 4.5) return null;
  return { surfaces, tokens };
}

// Superfícies que valem AGORA: ligadas no painel E liberadas no deploy. Ordem fixa (a URL do CSS e o atributo do <html> não variam por ordem).
export const activeSurfaces = (theme, features) => (theme ? SURFACES.filter((s) => theme.surfaces[s] && features.includes(SURFACE_FEATURE[s])) : []);

// ── Leitura da configuração publicada (por isolate: 60 s fresca; se o storefront falhar, a última boa vale por até 24 h) ──────────────

export function createThemeSource({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE, now = () => Date.now() } = {}) {
  let cached = null; // { theme, at }
  let inflight = null;
  async function load() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await upstream(new Request(store.storefront + store.inkThemeApi, { method: 'GET', headers: { accept: 'application/json' } }), {
        redirect: 'manual', signal: controller.signal, cf: { cacheTtl: 60, cacheEverything: true }
      });
      if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
      const text = await response.text();
      if (text.length > MAX_CHARS) throw new Error('too large');
      const theme = normalizeTheme(JSON.parse(text), store);
      if (!theme) throw new Error('schema');
      cached = { theme, at: now() };
      return theme;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    // Nunca lança: null = sem tema (a INK fica nativa).
    async get() {
      if (cached && now() - cached.at < FRESH_MS) return cached.theme;
      if (!inflight) inflight = load().finally(() => { inflight = null; });
      try {
        return await inflight;
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.theme-error', reason: String(error && error.message).slice(0, 40) }));
        return cached && now() - cached.at < STALE_MS ? cached.theme : null;
      }
    }
  };
}

// ── Páginas do checkout que recebem o tema ──────────────────────────────────────────────────────────────────────────────────
// Só as duas TELAS (GET) de contato/entrega e de pagamento: <inkBase>/checkout/<tela>[/<uuid do carrinho>]. Nunca os POSTs (buyer, shipping_address,
// process_payment, payment_discount…), nunca outra tela. Função pura, testada; o uuid nunca vai para log.
const CHECKOUT_STEPS = Object.freeze({ contact_and_shipping_details: 'contact', payment_methods: 'payment' });
export function checkoutPageKind(pathname, base) {
  if (typeof pathname !== 'string' || typeof base !== 'string' || base === '') return null;
  const m = /^\/checkout\/([a-z_]+)(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.exec(pathname.startsWith(base + '/') ? pathname.slice(base.length) : '');
  return m && Object.hasOwn(CHECKOUT_STEPS, m[1]) ? CHECKOUT_STEPS[m[1]] : null;
}

// ── CSS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Tudo sob html[data-origens-theme~="<superfície>"] (o Worker põe o atributo no <html> da resposta): nada vale fora das páginas tematizadas, e cada
// superfície desliga sozinha. Só propriedades visuais: nenhuma regra muda `display` de algo que a INK mostra/esconde (classes `hidden`, modais,
// campos do cartão), nenhuma esconde conteúdo (preço, cupom, frete, totais, termos). Seletores da INK conferidos no DOM real em 15/10/2026.

const P = 'html[data-origens-theme~="pdp"]';
const C = 'html[data-origens-theme~="cart"]';
const K = 'html[data-origens-theme~="checkout"]';

function tokensCss(tokens) {
  const font = FONTS[tokens.font];
  return 'html[data-origens-theme]{' + [
    '--o-action:' + tokens.action, '--o-on-action:' + tokens.onAction, '--o-selected:' + tokens.selected, '--o-on-selected:' + tokens.onSelected,
    '--o-ground:' + tokens.ground, '--o-surface:' + tokens.surface, '--o-paper:' + tokens.paper, '--o-ink:' + tokens.ink, '--o-ink-soft:' + tokens.inkSoft,
    '--o-ink-mute:' + tokens.inkMute, '--o-line:' + tokens.line, '--o-radius:' + tokens.radius + 'px', '--o-font:' + font.stack,
    '--o-ok:#1f6f43', '--o-error:#b42318', '--o-ease:cubic-bezier(.22,1,.36,1)'
  ].join(';') + '}';
}

// Botões: retos como os do storefront (.btn), maiúsculas, 52 px. `B` = ação principal; `G` = secundária (contorno).
// Nunca `display`: a INK esconde/mostra botões com classes (`hidden md:block`, barra do celular); trocar o display traria de volta um botão escondido.
const btn = (sel) => sel + '{align-items:center;justify-content:center;gap:10px;min-height:52px;height:auto;padding:0 28px;border:2px solid var(--o-action)!important;border-radius:var(--o-radius)!important;background:var(--o-action)!important;color:var(--o-on-action)!important;font-family:var(--o-font);font-size:15px;font-weight:700;line-height:1.2;letter-spacing:.04em;text-transform:uppercase;box-shadow:none!important;transition:background-color .2s var(--o-ease),color .2s var(--o-ease)}' +
  '@media (hover:hover){' + sel.split(',').map((s) => s + ':hover').join(',') + '{background:transparent!important;color:var(--o-action)!important}}' +
  sel.split(',').map((s) => s + ':focus-visible').join(',') + '{outline:2px solid var(--o-ink);outline-offset:3px}';
const ghost = (sel) => sel + '{align-items:center;justify-content:center;min-height:48px;padding:0 20px;border:2px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-family:var(--o-font);font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;box-shadow:none!important}' +
  '@media (hover:hover){' + sel.split(',').map((s) => s + ':hover').join(',') + '{background:var(--o-ink)!important;color:var(--o-surface)!important}}' +
  sel.split(',').map((s) => s + ':focus-visible').join(',') + '{outline:2px solid var(--o-ink);outline-offset:3px}';
// Campo de texto/seleção: reto, fundo branco, 48 px, 16 px (o iOS não dá zoom), foco visível. Só aparência: valor, máscara e validação são da INK.
const field = (sel) => sel + '{min-height:48px;border:1px solid var(--o-line)!important;border-radius:var(--o-radius)!important;background-color:var(--o-surface)!important;color:var(--o-ink)!important;font-family:var(--o-font);font-size:16px!important;box-shadow:none!important}' +
  sel.split(',').map((s) => s + ':focus').join(',') + '{border-color:var(--o-ink)!important;outline:2px solid var(--o-ink)!important;outline-offset:0;box-shadow:none!important}';

function pdpCss() {
  const F = P + ' form[id^="form-product-"]';
  return [
    // Página: o cinza da vitrine (é o mesmo cinza das fotos da INK: a camiseta "senta" na página, sem caixa), a fonte da vitrine.
    P + ' body{background:var(--o-ground);color:var(--o-ink);font-family:var(--o-font)}',
    P + ' body :is(button,input,select,textarea){font-family:inherit}',
    P + ' .details-product{letter-spacing:normal}',
    // Duas colunas na proporção da PDP do storefront (1,15 : 1, 64 px entre elas). Só a grade: a ordem dos nós é a da INK.
    '@media (min-width:1024px){' + P + ' .details-product{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);column-gap:64px}}',
    // Migalha: como a do storefront (sublinhada, 15 px).
    P + ' .details-product nav[aria-label="Breadcrumb"] :is(a,span,li){font-size:15px;color:var(--o-ink-soft)}',
    P + ' .details-product nav[aria-label="Breadcrumb"] a{text-decoration:underline;text-decoration-color:var(--o-line);text-underline-offset:3px}',
    P + ' .details-product nav[aria-label="Breadcrumb"] li:last-child span{color:var(--o-ink)}',
    // Título (há dois h1 na INK: o do celular e o do computador; os dois recebem o mesmo estilo).
    P + ' .details-product h1{font-family:var(--o-font);font-weight:800;font-size:clamp(28px,3.4vw,44px);line-height:1.04;letter-spacing:-.02em;color:var(--o-ink);text-wrap:balance}',
    // Galeria: fundo do cinza da vitrine; setas e pontos discretos (as interações e a troca de imagem por variante são as da INK).
    P + ' .section-product-v2 ul.aspect-square,' + P + ' .section-product-v2 ul.aspect-square li{background:var(--o-ground)}',
    P + ' .section-product-v2 button[aria-label="Imagem anterior"],' + P + ' .section-product-v2 button[aria-label="Proxima imagem"]{background:var(--o-surface)!important;color:var(--o-ink)!important;border:1px solid var(--o-line);border-radius:var(--o-radius)!important;box-shadow:none}',
    P + ' .section-product-v2 button[aria-label="Imagem anterior"] svg,' + P + ' .section-product-v2 button[aria-label="Proxima imagem"] svg{color:var(--o-ink);fill:currentColor}',
    // Pontos da galeria: menores e mais juntos (17 pontos de 12 px com 12 px de espaço passavam de 390 px e davam rolagem horizontal no celular).
    P + ' .section-product-v2 ul.absolute.z-30{max-width:calc(100% - 16px)}',
    P + ' .section-product-v2 ul.absolute.z-30 > li + li{margin-left:6px!important}',
    P + ' .section-product-v2 button[id^="dot-image-"]{width:8px!important;height:8px!important}',
    // Recomendações nativas sob a galeria (seção absoluta com fundo branco): no cinza da página.
    P + ' .section-product-v2 > section{background:var(--o-ground)!important}',
    // Preço: o mesmo peso e escala do preço do storefront (t-h2). Parcelas e descontos são os textos da INK, só em tinta.
    F + ' .text-4xl{font-family:var(--o-font);font-weight:800;font-size:clamp(34px,4vw,48px);line-height:1.05;letter-spacing:-.028em;color:var(--o-ink)}',
    F + ' > .flex.flex-col.items-start.gap-1 p.font-medium.text-base{color:var(--o-ink-soft);font-weight:500}',
    F + ' > .flex.flex-col.items-start.gap-1 :is(.text-green-500,.lg\\:text-green-600){color:var(--o-ink)!important;font-weight:700}',
    F + ' del,' + F + ' .line-through{color:var(--o-ink-mute)}',
    // Prazo de entrega e cupons: perto da compra (já estão), com a aparência da vitrine.
    P + ' #cheapest-estimate-button{min-height:44px;color:var(--o-ink)!important;font-weight:600;text-decoration:underline;text-underline-offset:3px}',
    P + ' #cheapest-estimate-button :is(span,svg){color:var(--o-ink)!important}',
    P + ' #cheapest-estimate-button svg path{fill:var(--o-ink)}',
    P + ' #product_promotions_frame > div.border{border-color:var(--o-line)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)}',
    P + ' #product_promotions_frame a.text-blue-600{color:var(--o-ink)!important}',
    // "Também disponível em": chips do storefront.
    F + ' [data-controller="ink-store--modal"] .no-scrollbar button{min-height:44px;border:2px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-size:15px;font-weight:600;box-shadow:none!important}',
    // Seletores (modelo, tamanho): chips de 44 px, borda de 2 px; selecionado na cor da região; indisponível apagado e riscado (o risco é o da INK).
    F + ' .form-product-options__select-type p strong{font-size:15px;font-weight:700;color:var(--o-ink)}',
    F + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item) label{min-height:44px;height:auto!important;border:2px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-size:15px!important;font-weight:600;letter-spacing:0;transition:background-color .16s var(--o-ease),color .16s var(--o-ease)}',
    F + ' .form-product-options__select-type-size-item label{min-width:48px}',
    '@media (hover:hover){' + F + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item) label:hover{background:rgba(0,0,0,.06)!important}}',
    F + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item) input:checked + label{background:var(--o-selected)!important;border-color:var(--o-selected)!important;color:var(--o-on-selected)!important}',
    F + ' .form-product-options__select-type-size-item-disabled label{border-color:var(--o-line)!important;color:var(--o-ink-mute)!important;background:transparent!important}',
    F + ' .form-product-options__select-type-size-item-disabled:after{background-color:var(--o-line)}',
    // Foco de teclado nos rádios (são sr-only: o foco aparece no rótulo) e nas cores.
    F + ' input[type="radio"]:focus-visible + label{outline:2px solid var(--o-ink)!important;outline-offset:3px}',
    F + ' .form-product-options__select-type-colors-item input:checked + label{border-color:var(--o-ink)!important}',
    // Quantidade.
    F + ' .inline-flex.items-center.px-3.border-solid{border-color:var(--o-ink)!important;border-radius:var(--o-radius)!important;min-height:44px}',
    // Guia de medidas (o link nativo, já reestilizado pelo size-guide) e "Informar medidas": mesmo canto e mesma linha da vitrine.
    F + ' #open-modal-size,' + F + ' [data-origens-size-fit],' + F + ' button[data-origens-fit]{border-radius:var(--o-radius)!important}',
    // CTA "Adicionar ao Carrinho": o botão da vitrine. Mesmo botão, mesmo clique, mesma validação da INK.
    btn(F + ' #add-to-cart-desk,' + F + ' #add-to-cart-mob'),
    F + ' #add-to-cart-desk{width:100%;max-width:420px}',
    F + ' :is(#add-to-cart-desk,#add-to-cart-mob)[disabled]{opacity:.55;cursor:progress}',
    // Barra fixa do celular (nativa): largura da tela (a nativa tinha 3 px a mais), área segura, e some enquanto o botão principal está à vista
    // (classe posta pelo loader com IntersectionObserver; sem JS ela simplesmente fica, como na INK).
    F + ' .form-product-options__add-to-cart-mobile{left:0;right:0;width:auto!important;padding:8px 16px calc(8px + env(safe-area-inset-bottom));background:var(--o-ground);border-top:1px solid var(--o-line);transition:transform .2s var(--o-ease),visibility .2s}',
    F + ' #add-to-cart-mob{width:100%;min-height:52px}',
    F + ' .o-need-choice{outline:2px solid var(--o-error);outline-offset:6px;transition:outline-color .3s}',
    F + ' .o-need-choice p strong{color:var(--o-error)}',
    P + ':is(.o-cta-inview,.o-typing) form[id^="form-product-"] .form-product-options__add-to-cart-mobile{transform:translateY(110%);visibility:hidden}',
    // Abas de descrição: continuam abas (acessíveis: role=tablist/tab da INK), com a linha da vitrine; o conteúdo sai do cinza para o branco.
    P + ' #mytab button{min-height:44px;color:var(--o-ink-soft);font-weight:600}',
    P + ' #mytab button[aria-selected="true"]{color:var(--o-ink)!important;border-color:var(--o-ink)!important}',
    P + ' #product_details [role="tabpanel"]{background:var(--o-surface)!important;border-radius:var(--o-radius)!important}',
    P + ' #product_details [role="tabpanel"] :is(p,div){color:var(--o-ink-soft)!important;font-weight:400!important;line-height:1.55}',
    // Módulos nossos na PDP (guia, recomendações, retorno): mesma linguagem da vitrine (cantos, cores, fundo).
    P + ' [data-origens-guide="invite"]{background:var(--o-surface)!important;border-color:var(--o-line)!important;border-radius:var(--o-radius)!important;--o-tint:var(--o-ink)}',
    P + ' [data-origens-guide] .o-g-btn{border:2px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-weight:600}',
    P + ' [data-origens-guide] .o-g-btn.o-g-more{border-style:solid!important}',
    P + ' .o-reco-card{border-radius:var(--o-radius)!important;border-color:var(--o-line)!important;background:transparent!important}',
    P + ' .o-reco-media,' + P + ' .o-reco-media img{border-radius:var(--o-radius)!important;background:var(--o-ground)!important}',
    P + ' .o-reco-name{font-weight:600!important;color:var(--o-ink)!important}',
    P + ' .o-reco-price{font-weight:600!important;color:var(--o-ink)!important}',
    P + ' .o-reco-cta{color:var(--o-ink)!important;text-decoration:underline;text-underline-offset:3px}',
    P + ' .o-reco-title{font-weight:800!important;letter-spacing:-.01em;color:var(--o-ink)!important}'
  ].join('');
}

function cartCss() {
  const D = C + ' .cart-drawer';
  return [
    // Painel: fonte e cores da vitrine, sem o espaçamento entre letras da INK; no computador um pouco mais largo (440 px).
    D + '{font-family:var(--o-font);letter-spacing:normal;color:var(--o-ink);background:var(--o-surface)}',
    D + ' :is(button,input,select,textarea){font-family:inherit;letter-spacing:normal}',
    '@media (min-width:768px){' + D + '{width:440px}}',
    D + '__header{border-bottom:1px solid var(--o-line)}',
    D + '__header .top-header > span{font-size:17px;font-weight:800;color:var(--o-ink)}',
    D + '__header .top-header > span .text-gray-500{color:var(--o-ink-mute)!important;font-weight:500}',
    D + '__header #cart-drawer-close{min-width:44px;min-height:44px;padding:10px;box-sizing:content-box}',
    // Itens: imagem no cinza da vitrine, nome, variante completa, preço e quantidade legíveis; botões de quantidade/remover com área de toque de 44 px.
    D + '__main{background:var(--o-surface)!important}',
    D + '__main .main-list__item{border-bottom:1px solid var(--o-line)}',
    D + '__main .main-list__item > img{background:var(--o-ground);border-radius:var(--o-radius)}',
    D + '__main .main-list__item .item-wrapper .item-header{font-size:15px;font-weight:600;color:var(--o-ink)}',
    D + '__main .main-list__item .item-wrapper .item-details > span,' + D + '__main .main-list__item .item-wrapper .item-details p{color:var(--o-ink-mute);font-size:14px}',
    D + '__main .main-list__item .item-wrapper .item-details .price span{color:var(--o-ink);font-weight:700}',
    D + '__main .main-list__item .item-wrapper .item-details .price del{color:var(--o-ink-mute)}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity button{width:44px!important;height:44px!important}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity .quantity-input{font-weight:700;color:var(--o-ink)}',
    // Rodapé: cupom, CEP, descontos, subtotal e total da INK, só com outra aparência; total em destaque; "Finalizar compra" = botão da vitrine.
    D + '__footer{background:var(--o-paper)!important;border-top:1px solid var(--o-line);padding-bottom:env(safe-area-inset-bottom)}',
    D + '__footer .footer-details ul > li{font-size:15px;font-weight:500;color:var(--o-ink-soft)}',
    D + '__footer .footer-details ul > li:last-child{font-size:18px;font-weight:800;color:var(--o-ink)}',
    D + '__footer :is(.text-green-500,.text-green-600){color:var(--o-ok)!important}',
    D + '__footer__cep input,' + D + '__footer__coupon input{border:1px solid var(--o-line)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)!important;min-height:44px;font-size:16px!important;color:var(--o-ink)}',
    D + '__footer__cep input:focus,' + D + '__footer__coupon input:focus{border-color:var(--o-ink)!important;outline:2px solid var(--o-ink);outline-offset:0}',
    D + '__footer__cep .btn-apply,' + D + '__footer__coupon .btn-apply{min-width:44px;min-height:44px}',
    D + '__footer__cep label,' + D + '__footer__coupon label,' + D + '__footer__cep span,' + D + '__footer__coupon span{color:var(--o-ink);font-weight:600}',
    btn(D + ' #checkout-btn,' + D + '__footer__submit'),
    D + ' #checkout-btn{width:100%}',
    ghost(D + '__footer__keep-shopping'),
    // Carrinho vazio: mensagem simples e volta à loja (o "Continuar Comprando" nativo vira botão secundário). Sem produto inventado.
    D + ' .empty-cart{background:var(--o-ground)!important;color:var(--o-ink-soft)!important}',
    D + ' .empty-cart [data-action*="closeDrawer"]{display:flex;align-items:center;justify-content:center;min-height:48px;border:2px solid var(--o-ink);border-radius:var(--o-radius);background:transparent;cursor:pointer}',
    D + ' .empty-cart [data-action*="closeDrawer"] > div{color:var(--o-ink)!important;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:14px}',
    C + ' .cart-drawer-overlay{background:rgba(0,0,0,.45)!important}',
    // Bloco nosso "Descubra outras estampas" (carrinho e pós-adição): a mesma linguagem (cantos, linha, botões de contorno).
    C + ' [data-origens-discovery]{background:var(--o-surface)!important;border-color:var(--o-line)!important;border-radius:var(--o-radius)!important;color:var(--o-ink)!important}',
    C + ' [data-origens-discovery] :is(.o-cta,.o-toggle){border:2px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-weight:700}',
    C + ' [data-origens-discovery] .o-input{border-radius:var(--o-radius)!important;border-color:var(--o-line)!important;font-size:16px}',
    C + ' [data-origens-discovery] .o-item{border-radius:var(--o-radius)!important}',
    // Confirmação pós-adição (modal nativo): mesma linguagem do carrinho; "Ver carrinho" = ação principal, "Continuar comprando" = secundária.
    C + ' #modal-wrapper{font-family:var(--o-font);letter-spacing:normal;color:var(--o-ink)}',
    C + ' #modal-wrapper :is(button,input){font-family:inherit;letter-spacing:normal}',
    C + ' #modal-wrapper :is(h2,h3){font-weight:800;color:var(--o-ink)}',
    btn(C + ' #modal-wrapper .checkout-btn'),
    ghost(C + ' #modal-wrapper #continue-shopping-button'),
    C + ' #modal-wrapper :is(.checkout-btn,#continue-shopping-button){width:100%}'
  ].join('');
}

function checkoutCss() {
  const L = K + ' [data-controller="ink-store--checkout"]';
  return [
    // Mesma fonte e cores; o cabeçalho compacto (marca, sem menu) é o da própria INK e fica como está.
    K + ' body{font-family:var(--o-font);color:var(--o-ink);background:var(--o-surface)}',
    K + ' body :is(button,input,select,textarea){font-family:inherit}',
    // A INK fixa Inter no container do checkout e no resumo: a fonte da vitrine em tudo, menos nos ícones (Font Awesome usa <i>).
    K + ' :is([data-controller="ink-store--checkout"],turbo-frame#cart_summary),' + K + ' :is([data-controller="ink-store--checkout"],turbo-frame#cart_summary) :where(*:not(i):not(svg):not(svg *)){font-family:var(--o-font)!important}',
    // Títulos e rótulos.
    L + ' section > .w-full.flex.flex-col.items-start > p.text-2xl{font-weight:800;font-size:clamp(26px,3vw,34px);letter-spacing:-.02em;color:var(--o-ink)}',
    L + ' section > .w-full.flex.flex-col.items-start > p.text-sm{color:var(--o-ink-mute)}',
    L + ' h3.text-lg{font-size:19px;font-weight:800;color:var(--o-ink)}',
    L + ' label{color:var(--o-ink);font-weight:600}',
    // Campos (identificação, CEP, endereço de entrega e de cobrança, cartão quando a INK o mostra): só aparência.
    field(L + ' input:is([type="text"],[type="email"],[type="tel"]),' + L + ' select'),
    // Rádios e caixas de seleção da INK (plugin de formulários: a cor marcada é currentColor): tinta em vez de azul.
    L + ' input:is([type="checkbox"],[type="radio"]){color:var(--o-ink)!important;accent-color:var(--o-ink);border-color:var(--o-ink-mute)!important}',
    L + ' input[type="checkbox"]{width:20px;height:20px}',
    L + ' input:is([type="checkbox"],[type="radio"]):focus-visible{outline:2px solid var(--o-ink);outline-offset:2px;box-shadow:none!important}',
    L + ' #formPaymentMethods label{background-color:transparent!important}',
    // Erros da INK: vermelho com contraste AA, e a borda do campo acompanha (o texto da mensagem é o da INK).
    // As mensagens de campo da INK são os <small> posicionados sob o campo (-bottom-5); ela os mostra por CSS (peer-invalid) ou tirando `hidden`.
    L + ' small[class*="-bottom-5"]{color:var(--o-error)!important;font-weight:600}',
    L + ' .field_with_errors :is(input,select),' + L + ' :is(input,select)[aria-invalid="true"]{border-color:var(--o-error)!important}',
    L + ' #contentAlert{color:var(--o-error)!important}',
    L + ' a.underline{color:var(--o-ink)}',
    // Opções de frete e de pagamento: cartões com borda; o escolhido ganha borda de 2 px (o rádio continua o nativo, com o mesmo clique).
    L + ' .shipping-types__item,' + L + ' #formPaymentMethods > ul > li{border:1px solid var(--o-line);border-radius:var(--o-radius)!important;background:var(--o-surface)}',
    L + ' .shipping-types__item{padding:12px 14px;min-height:56px}',
    L + ' .shipping-types__item:has(input:checked),' + L + ' #formPaymentMethods > ul > li:has(> label input:checked){border:2px solid var(--o-ink)}',
    L + ' #formPaymentMethods > ul{gap:8px;border:0!important;border-radius:0!important}',
    L + ' #formPaymentMethods > ul > li > label{min-height:56px}',
    // A faixa "pagamento protegido" fica proporcional: neutra e menor que as opções e o botão (o texto é o da INK, nada é alegado por nós).
    L + ' section > div[role="alert"].p-4.text-sm.rounded-lg{background:var(--o-paper)!important;border:1px solid var(--o-line)!important;border-radius:var(--o-radius)!important;padding:10px 14px}',
    L + ' section > div[role="alert"].p-4.text-sm.rounded-lg h3{font-size:15px}',
    L + ' section > div[role="alert"].p-4.text-sm.rounded-lg :is(span,h3){color:var(--o-ink)!important}',
    L + ' section > div[role="alert"].p-4.text-sm.rounded-lg .mt-2{margin:4px 0 0}',
    // Botões de seguir (contato → pagamento) e "Finalizar compra": o botão da vitrine. Mesmo nó, mesmo clique, mesma validação.
    btn(L + ' button.bg-green-500,' + L + ' button[type="submit"][data-action*="validateAndSubmit"],' + L + ' a.bg-green-500'),
    // Resumo: itens, subtotal, desconto, entrega e total da INK; total em destaque, desconto em verde com contraste AA.
    K + ' turbo-frame#cart_summary > section{background:var(--o-paper)!important}',
    K + ' turbo-frame#cart_summary img{border-radius:var(--o-radius)!important;border-color:var(--o-line)!important;background:var(--o-ground)}',
    K + ' turbo-frame#cart_summary h3{font-weight:600;color:var(--o-ink)}',
    K + ' turbo-frame#cart_summary p.font-medium{font-weight:800;color:var(--o-ink)}',
    K + ' turbo-frame#cart_summary :is(.text-green-500,.text-green-600),' + L + ' :is(.text-green-500,.text-green-600){color:var(--o-ok)!important}',
    K + ' #prices_summary .text-base.md\\:text-lg,' + K + ' #prices_summary .text-base{font-weight:800;color:var(--o-ink)}',
    // Resumo do celular (barra "Total · Finalizar compra" e cartão do endereço): mesmas cores.
    L + ' a[aria-label="Editar endereço de entrega"]{color:var(--o-ink);min-height:44px;font-weight:600}',
    L + ' .md\\:hidden.flex.flex-col{border-color:var(--o-line)!important;border-radius:var(--o-radius)!important}'
  ].join('');
}

const SURFACE_CSS = { pdp: pdpCss, cart: cartCss, checkout: checkoutCss };

// CSS de UMA combinação de superfícies. O @import da fonte vem primeiro (regra do CSS).
export function buildThemeCss(theme, surfaces) {
  const list = SURFACES.filter((s) => surfaces.includes(s));
  if (!theme || list.length === 0) return '';
  const font = FONTS[theme.tokens.font];
  return '/* Use Origens · tema da compra na INK v' + THEME_VERSION + ' (' + list.join(',') + ') */' +
    (font.import ? '@import url("' + font.import + '");' : '') +
    tokensCss(theme.tokens) + list.map((s) => SURFACE_CSS[s]()).join('');
}

// URL do CSS: superfícies + hash do conteúdo (mudou o tema publicado ou o código = URL nova; o navegador guarda por um ano).
export const themeQuery = (theme, surfaces) => 's=' + surfaces.join(',') + '&v=' + THEME_VERSION + '&c=' + contentHash(buildThemeCss(theme, surfaces));
export const themeLinkTag = (theme, surfaces) => '<link rel="stylesheet" href="' + THEME_PATH + '?' + themeQuery(theme, surfaces) + '" data-origens-theme-css="' + THEME_VERSION + '">';

// ?s= da URL → superfícies válidas, na ordem canônica, sem repetição; qualquer nome estranho = nada.
export function parseSurfaceParam(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return [];
  const names = raw.split(',');
  if (!names.every((n) => SURFACES.includes(n))) return [];
  return SURFACES.filter((s) => names.includes(s));
}
