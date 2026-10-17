// Tema da compra na INK (theme-pdp, theme-cart, theme-checkout): a PDP, o carrinho e o checkout da INK com a cara da PDP do storefront.
// SÓ CSS, servido pelo próprio Worker em /__origens/theme.css e ligado por <link> no <head> das páginas que ele já reescreve (produto e casca) e,
// com theme-checkout, nas duas telas do checkout. Nada de JS no checkout, nenhum nó da INK é movido, clonado ou substituído: os controles nativos
// (variantes, quantidade, cupom, CEP, frete, pagamento) continuam os mesmos, só com outra aparência. Falhou o CSS? A página nativa segue igual.
//
// Configuração: o CMS do storefront publica por região (/api/ink-theme/<região>, contrato v1). O Worker lê no SERVIDOR (origem fixa de stores.js,
// sem cabeçalhos do visitante), valida estritamente e só então monta o CSS. Duas chaves por superfície: a feature do deploy (teto técnico) E o
// interruptor do painel (decisão do dono). Sem configuração válida = nenhuma injeção (a INK fica nativa), nunca um tema inventado.
// Contrato v1: { v:1, region, surfaces:{ pdp, cart, checkout, account? }, tokens:{ action, onAction, selected, onSelected, ground, surface, paper, ink,
//   inkSoft, inkMute, line, photo, radius:0|8, font:'origens'|'ink' } } — cores só #rrggbb (nenhum texto livre vira CSS). `photo` = o cinza das fotos da INK
//   (fundo da galeria e das miniaturas), separado do fundo da página (`ground`).
//   Opcional: incentive:{ enabled, kind:'free-shipping', unit:'items', threshold, ufs } — a REPRESENTAÇÃO de uma regra comercial que a INK já aplica
//   (o painel exige a confirmação do dono para ligar). Só por peças: a regra por valor a INK mostra sozinha (barra nativa). Inválido = sem incentivo,
//   o tema continua. Vai para a página como atributo do <body> (data-origens-incentive="2|PR,SC,RS"), só com a feature cart-incentive.
//   `surfaces.account` (theme-account, as páginas de conta: login, pedidos, rastreio, avaliação, trocas) é OPCIONAL: o storefront publicado antes dela
//   manda só pdp/cart/checkout, e ausente = desligada (nunca derruba o tema que já está no ar). Presente e não booleano = payload recusado, como as outras.
import { ACTIVE_STORE } from './stores.js';
import { contentHash } from './loader-source.js';

export const THEME_PATH = '/__origens/theme.css';
export const THEME_VERSION = '1';
export const SURFACES = Object.freeze(['pdp', 'cart', 'checkout', 'account']);
export const SURFACE_FEATURE = Object.freeze({ pdp: 'theme-pdp', cart: 'theme-cart', checkout: 'theme-checkout', account: 'theme-account' });
// Superfícies que o contrato aceita AUSENTES (= desligadas): as que chegaram depois do v1 publicado.
const OPTIONAL_SURFACES = Object.freeze(['account']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['action', 'onAction', 'selected', 'onSelected', 'ground', 'surface', 'paper', 'photo', 'ink', 'inkSoft', 'inkMute', 'line'];
const FONTS = Object.freeze({
  // Hanken Grotesk é a fonte da PDP do storefront; a INK já carrega Poppins do Google Fonts, então a origem não é nova para a página.
  origens: { stack: '"Hanken Grotesk",Poppins,system-ui,-apple-system,"Segoe UI",sans-serif', import: 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap' },
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
  for (const key of SURFACES) {
    if (s[key] === undefined && OPTIONAL_SURFACES.includes(key)) { surfaces[key] = false; continue; }
    if (typeof s[key] !== 'boolean') return null;
    surfaces[key] = s[key];
  }
  const tokens = {};
  for (const key of COLOR_KEYS) { if (typeof t[key] !== 'string' || !HEX.test(t[key])) return null; tokens[key] = t[key].toLowerCase(); }
  if (t.radius !== 0 && t.radius !== 8) return null;
  if (!Object.hasOwn(FONTS, t.font)) return null;
  tokens.radius = t.radius; tokens.font = t.font;
  const incentive = normalizeIncentive(data.incentive, store);
  // Paleta do carrinho e do checkout (opcional): "acento" = verde com acento ocre (a direção escolhida em 17/10/2026). Ausente, desconhecida ou de outra
  // região = os papéis derivados dos tokens, como antes (um valor novo do painel nunca derruba o tema: só não é aplicado).
  const palette = data.palette === 'acento' && Object.hasOwn(PALETTES.acento, store.region) ? 'acento' : 'neutra';
  // Defesa em profundidade (o CMS já confere): texto do botão e do selecionado legíveis, texto da página legível no fundo e nas superfícies.
  if (contrast(tokens.action, tokens.onAction) < 4.5 || contrast(tokens.selected, tokens.onSelected) < 4.5) return null;
  for (const bg of ['ground', 'surface', 'paper']) if (contrast(tokens.ink, tokens[bg]) < 4.5 || contrast(tokens.inkMute, tokens[bg]) < 4.5) return null;
  return { surfaces, tokens, incentive, palette, region: store.region };
}

// Incentivo do carrinho: só ligado, só frete grátis por quantidade de peças, meta de 2 a 20, destinos = UFs DESTA região (sem repetição).
const UF = /^[A-Z]{2}$/;
export function normalizeIncentive(raw, store = ACTIVE_STORE) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true || raw.kind !== 'free-shipping' || raw.unit !== 'items') return null;
  if (!Number.isInteger(raw.threshold) || raw.threshold < 2 || raw.threshold > 20) return null;
  const allowed = store.ufs || [];
  if (!Array.isArray(raw.ufs) || raw.ufs.length === 0 || raw.ufs.length > allowed.length || new Set(raw.ufs).size !== raw.ufs.length) return null;
  if (!raw.ufs.every((uf) => typeof uf === 'string' && UF.test(uf) && allowed.includes(uf))) return null;
  const ufs = allowed.filter((uf) => raw.ufs.includes(uf));
  // Regra que vale para a região inteira: a mensagem diz "no Sul" (curta); senão o carrinho lista as UFs.
  return { threshold: raw.threshold, ufs, where: ufs.length === allowed.length ? REGION_WHERE[store.region] || '' : '' };
}
const REGION_WHERE = Object.freeze({ sul: 'no Sul', norte: 'no Norte', 'centro-oeste': 'no Centro-Oeste' });
// Valor do atributo do <body> (só números, siglas e o rótulo fixo da região): "2|PR,SC,RS|no Sul".
export const incentiveAttr = (theme) => (theme && theme.incentive ? theme.incentive.threshold + '|' + theme.incentive.ufs.join(',') + (theme.incentive.where ? '|' + theme.incentive.where : '') : '');

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

// ── Páginas de conta que recebem o tema (theme-account) ─────────────────────────────────────────────────────────────────────
// login     <inkBase>/store_sessions/new (só a TELA; o POST /store_sessions e qualquer outro caminho de sessão, nunca)
// orders    <inkBase>/orders · tracking <inkBase>/orders/trackings · order <inkBase>/orders/<pedido>
// review    <inkBase>/orders/<pedido>/review/<id> e <inkBase>/orders/guest_reviews/new
// exchanges <inkBase>/exchanges_and_returns
// login e review ficam FORA da casca (shellPageKind): recebem só o atributo e o CSS, nenhum script nosso (ACCOUNT_CSS_ONLY). As demais são páginas de casca:
// o tema da conta entra junto com o loader e a navbar. Função pura, testada; o caminho (que pode levar o número do pedido) nunca vai para log.
export const ACCOUNT_CSS_ONLY = Object.freeze(['login', 'review']);
const ORDER_ID = '[A-Za-z0-9_-]{1,64}';
export function accountPageKind(pathname, base) {
  if (typeof pathname !== 'string' || typeof base !== 'string' || base === '') return null;
  if (pathname.slice(0, base.length + 1) !== base + '/') return null;
  const rest = pathname.slice(base.length + 1).replace(/\/$/, '');
  if (rest === 'store_sessions/new') return 'login';
  if (rest === 'exchanges_and_returns') return 'exchanges';
  if (rest === 'orders') return 'orders';
  if (rest === 'orders/trackings') return 'tracking';
  if (rest === 'orders/guest_reviews/new' || new RegExp('^orders/' + ORDER_ID + '/review/' + ORDER_ID + '$').test(rest)) return 'review';
  if (new RegExp('^orders/' + ORDER_ID + '$').test(rest)) return 'order';
  return null;
}

// ── CSS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Tudo sob body[data-origens-theme~="<superfície>"] (o Worker põe o atributo no <body> da resposta): nada vale fora das páginas tematizadas, e cada
// superfície desliga sozinha. Nenhuma regra muda `display` de algo que a INK mostra/esconde (classes `hidden`, modais, campos do cartão) — os únicos
// `display` são em contêineres que a INK nunca alterna (grades dos seletores, link da marca no checkout), listados no teste — e nada de preço, cupom, frete,
// totais ou termos é escondido. Reordenação só com `order` dentro do MESMO pai flex: o DOM (formulários, labels, inputs, frames) não muda.
// Rodada 2 (composição): a camiseta como protagonista (galeria fixa no computador, de ponta a ponta no celular), uma coluna de compra na ordem da decisão
// (título › preço › modelo/cor/tamanho › medidas › quantidade e CTA › prazo e confiança › outros tipos), controles com linha fina e o escolhido forte.
// Seletores da INK conferidos no DOM real em 15/10/2026.

// Escopo no <BODY> (rodada 3): o Turbo troca o <body> a cada visita, então o atributo é sempre o da página carregada — um <link> antigo que o Turbo
// mantém no <head> não religa nada numa página em que o painel desligou a superfície.
const P = 'body[data-origens-theme~="pdp"]';
const C = 'body[data-origens-theme~="cart"]';
const K = 'body[data-origens-theme~="checkout"]';
const A = 'body[data-origens-theme~="account"]';
const ANY = 'body[data-origens-theme]';

function tokensCss(tokens) {
  const font = FONTS[tokens.font];
  return ANY + '{' + [
    '--o-action:' + tokens.action, '--o-on-action:' + tokens.onAction, '--o-selected:' + tokens.selected, '--o-on-selected:' + tokens.onSelected,
    '--o-ground:' + tokens.ground, '--o-surface:' + tokens.surface, '--o-paper:' + tokens.paper, '--o-photo:' + tokens.photo, '--o-ink:' + tokens.ink, '--o-ink-soft:' + tokens.inkSoft,
    '--o-ink-mute:' + tokens.inkMute, '--o-line:' + tokens.line, '--o-radius:' + tokens.radius + 'px', '--o-font:' + font.stack,
    // Linha fina dos estados normais: a tinta a 16% (mais leve que --o-line, que fica para campos). Navegador sem color-mix usa --o-line.
    '--o-line-soft:var(--o-line)', '--o-line-soft:color-mix(in srgb,var(--o-ink) 16%,transparent)',
    '--o-ok:#1f6f43', '--o-error:#b42318', '--o-ease:cubic-bezier(.22,1,.36,1)', '--o-word:"Big Shoulders Display","Arial Narrow",Impact,sans-serif',
    // Papéis de cor do carrinho e do checkout, derivados dos tokens (o visual aprovado). Uma direção de arte nova troca estes papéis, não as regras.
    '--o-cta:var(--o-action)', '--o-on-cta:var(--o-on-action)', '--o-panel:var(--o-paper)',
    '--o-incentive-bg:color-mix(in srgb,var(--o-selected) 20%,var(--o-surface))', '--o-incentive-line:color-mix(in srgb,var(--o-selected) 35%,var(--o-surface))',
    '--o-incentive-ink:var(--o-selected)', '--o-incentive-icon:var(--o-selected)', '--o-incentive-text:var(--o-ink)', '--o-incentive-soft:var(--o-ink-soft)',
    '--o-incentive-track:color-mix(in srgb,var(--o-selected) 8%,var(--o-surface))', '--o-incentive-fill:var(--o-selected)',
    '--o-choice-line:var(--o-selected)', '--o-choice-ring:var(--o-selected)', '--o-choice-bg:color-mix(in srgb,var(--o-selected) 10%,var(--o-surface))',
    '--o-choice-body:var(--o-choice-bg)', '--o-choice-head:transparent', '--o-choice-mark:var(--o-selected)',
    '--o-incentive-icon-bg:transparent', '--o-incentive-icon-size:16px', '--o-incentive-icon-pad:0px'
  ].join(';') + '}';
}

// Botão principal: reto como o .btn do storefront, 54 px, maiúsculas. Nunca `display` (a INK esconde/mostra botões com classes).
// Os seletores passados aqui não usam vírgula dentro de :is() (a lista é separada por vírgula para gerar :hover/:focus).
const each = (sel, suffix) => sel.split(',').map((s) => s + suffix).join(',');
const btn = (sel, role = 'action') => sel + '{align-items:center;justify-content:center;gap:10px;min-height:54px;height:auto;padding:0 24px;border:2px solid var(--o-' + role + ')!important;border-radius:var(--o-radius)!important;background:var(--o-' + role + ')!important;color:var(--o-on-' + role + ')!important;font-family:var(--o-font);font-size:15px;font-weight:700;line-height:1.2;letter-spacing:.04em;text-transform:uppercase;box-shadow:none!important;transition:background-color .2s var(--o-ease),color .2s var(--o-ease)}' +
  '@media (hover:hover){' + each(sel, ':hover') + '{background:transparent!important;color:var(--o-' + role + ')!important}}' +
  each(sel, ':focus-visible') + '{outline:2px solid var(--o-ink);outline-offset:3px}';
// Ação secundária: linha fina, sem maiúsculas pesadas.
const ghost = (sel) => sel + '{align-items:center;justify-content:center;min-height:48px;padding:0 18px;border:1px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-family:var(--o-font);font-size:15px;font-weight:600;letter-spacing:0;text-transform:none;box-shadow:none!important}' +
  '@media (hover:hover){' + each(sel, ':hover') + '{background:var(--o-paper)!important}}' +
  each(sel, ':focus-visible') + '{outline:2px solid var(--o-ink);outline-offset:3px}';
// Campo: reto, branco, 48 px, 16 px (o iOS não dá zoom), foco visível. Valor, máscara e validação são da INK.
const field = (sel) => sel + '{min-height:48px;border:1px solid var(--o-line)!important;border-radius:var(--o-radius)!important;background-color:var(--o-surface)!important;color:var(--o-ink)!important;font-family:var(--o-font);font-size:16px!important;box-shadow:none!important}' +
  each(sel, ':focus') + '{border-color:var(--o-ink)!important;outline:2px solid var(--o-ink)!important;outline-offset:0;box-shadow:none!important}';
// Rótulo de grupo (Modelo, Cor, Tamanho, Quantidade…): discreto; o que pesa é a escolha.
const groupLabel = 'font-size:14px;font-weight:600;letter-spacing:0;color:var(--o-ink)';

// Faixa superior da INK (produto, casca e checkout): três mensagens com animações de 16 s que se CRUZAM (duas visíveis e sobrepostas em ~25% do ciclo,
// medido). Com exatamente três mensagens, a mesma duração com um terço para cada uma e a seguinte só entra depois que a anterior saiu. Outro número de
// mensagens = a animação da INK, intocada.
function stripCss(scope) {
  const bar = scope + ' .header-benefits:has(> span:nth-child(3):last-child) > span';
  return bar + '{animation:o-benefit 16s ease-in-out infinite!important}' +
    bar + ':nth-child(2){animation-delay:-10.667s!important}' + bar + ':nth-child(3){animation-delay:-5.333s!important}' +
    '@media (prefers-reduced-motion:reduce){' + bar + '{animation-duration:30s!important}}';
}
const STRIP_KEYFRAMES = '@keyframes o-benefit{0%{opacity:0;visibility:hidden}2.5%{opacity:1;visibility:visible}30.8%{opacity:1;visibility:visible}33.3%{opacity:0;visibility:hidden}100%{opacity:0;visibility:hidden}}';

// Cabeçalho (nosso header-nav sobre o da INK): no celular, símbolo + "USE ORIGENS" como no storefront, numa faixa mais baixa.
function headerCss() {
  return [
    ANY + ' .o-nav-word{font-family:var(--o-word);font-weight:800}',
    '@media (max-width:1023px){' + P + ' .navbar__top .o-nav-word{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;font-size:22px;line-height:1;letter-spacing:.02em}' +
      P + ' .navbar__top .o-nav-logo{gap:8px;min-height:44px}' + P + ' .navbar__top .o-nav-logo img{height:34px}}'
  ].join('');
}

function pdpCss() {
  const F = P + ' form[id^="form-product-"]';
  const T = F + ' .form-product-options__select-type';
  return [
    stripCss(P), headerCss(),
    P + '{background:var(--o-ground);color:var(--o-ink);font-family:var(--o-font)}',
    P + ' :is(button,input,select,textarea){font-family:inherit}',
    P + ' .details-product{letter-spacing:normal}',
    // ── Composição ── Computador: galeria larga e FIXA enquanto a coluna de compra rola (a imagem fica à vista durante a escolha); colunas alinhadas pelo
    // topo. (No celular a galeria mantém a largura da coluna: o carrossel da INK fixa a largura das imagens em pixels.) (As recomendações, com a galeria fixa, passam a vir depois da compra: recommendations.js só usa o vão da
    // galeria quando ela é `relative`.)
    '@media (min-width:1024px){' +
      P + ' .details-product{grid-template-columns:minmax(0,1.3fr) minmax(360px,1fr);column-gap:56px;align-items:start}' +
      // Fixa; `--o-gal-top` (theme-ui) sobe a galeria quando ela é mais alta que a janela, para as últimas miniaturas continuarem alcançáveis.
      P + ' .details-product > .section-product-v2{position:sticky;top:var(--o-gal-top,120px);align-self:start}' +
      P + ' .details-product > .section-details{padding-top:4px}' +
    '}',
    // Migalha e título: discretos e legíveis (o título deixa de ser o elemento mais pesado da página).
    P + ' .details-product nav[aria-label="Breadcrumb"] :is(a,span,li){font-size:13px;color:var(--o-ink-mute)}',
    P + ' .details-product nav[aria-label="Breadcrumb"] a{text-decoration:underline;text-decoration-color:var(--o-line-soft);text-underline-offset:3px}',
    P + ' .details-product nav[aria-label="Breadcrumb"] li:last-child span{color:var(--o-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}',
    '@media (max-width:1023px){' + P + ' .details-product > div:first-child{margin:12px 0 4px!important}}',
    P + ' .details-product h1{font-family:var(--o-font);font-weight:700;font-size:clamp(24px,2.3vw,34px);line-height:1.12;letter-spacing:-.015em;color:var(--o-ink);text-wrap:balance}',
    // Título, compartilhar e avaliações: título numa linha, as duas ações secundárias juntas na linha de baixo (antes: três linhas empilhadas).
    P + ' .details-product > header,' + P + ' .section-details > header{flex-direction:row!important;flex-wrap:wrap;align-items:center;column-gap:18px;row-gap:2px;margin-bottom:14px!important}',
    P + ' .details-product > header h1,' + P + ' .section-details > header h1{flex:1 0 100%;margin-bottom:4px}',
    P + ' .details-product > header > a,' + P + ' .section-details > header > a{font-size:14px}',
    P + ' :is(.details-product,.section-details) > header .star-rating{transform:scale(.8);transform-origin:left center}',
    P + ' :is(.details-product,.section-details) > header .text-yellow-400{font-size:14px!important;color:var(--o-ink-mute)!important;font-weight:500!important}',
    // Galeria: o cinza das fotos atrás da camiseta; setas discretas; contador "1 / 17" no lugar da fileira de pontos quando o loader o põe (theme-ui).
    P + ' .section-product-v2 ul.aspect-square,' + P + ' .section-product-v2 ul.aspect-square li{background:var(--o-photo)}',
    P + ' .section-product-v2 button[aria-label="Imagem anterior"],' + P + ' .section-product-v2 button[aria-label="Proxima imagem"]{width:40px!important;height:40px!important;background:rgba(255,255,255,.88)!important;color:var(--o-ink)!important;border:0;border-radius:999px!important;box-shadow:0 1px 2px rgba(0,0,0,.12)}',
    P + ' .section-product-v2 button[aria-label="Imagem anterior"] svg,' + P + ' .section-product-v2 button[aria-label="Proxima imagem"] svg{color:var(--o-ink);fill:currentColor}',
    P + ' .section-product-v2 ul.absolute.z-30{max-width:calc(100% - 16px)}',
    P + ' .section-product-v2 ul.absolute.z-30 > li + li{margin-left:6px!important}',
    P + ' .section-product-v2 button[id^="dot-image-"]{width:8px!important;height:8px!important}',
    // Miniaturas (theme-ui): TODAS as fotos numa LINHA abaixo da principal, na largura dela; quando não cabem, rolagem lateral (decisão do dono,
    // 15/10/2026). ~6,5 visíveis no celular e ~7,5 no computador: a metade da próxima na borda mostra que há mais. A escolhida com borda na cor da região
    // (e trazida para a área visível pelo theme-ui); foco de teclado em tinta. Os pontos nativos só somem depois de a grade existir (classe o-thumbs).
    P + '.o-thumbs .section-product-v2 ul.absolute.z-30{visibility:hidden}',
    P + ' .o-thumbs{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:clamp(44px,calc((100% - 33px) / 6.5),84px);gap:6px;width:100%;margin-top:8px;padding-bottom:6px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:thin;-webkit-overflow-scrolling:touch}',
    '@media (min-width:1024px){' + P + ' .o-thumbs{grid-auto-columns:calc((100% - 52px) / 7.5);gap:8px;margin-top:10px}}',
    P + ' .o-thumb{position:relative;scroll-snap-align:start;aspect-ratio:800/820;min-width:44px;min-height:44px;padding:0;border:1px solid transparent;border-radius:var(--o-radius);background:var(--o-photo);overflow:hidden;cursor:pointer}',
    P + ' .o-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
    P + ' .o-thumb[aria-current="true"]{border:2px solid var(--o-selected)}',
    '@media (hover:hover){' + P + ' .o-thumb:hover{border-color:var(--o-line)}' + P + ' .o-thumb[aria-current="true"]:hover{border-color:var(--o-selected)}}',
    P + ' .o-thumb:focus-visible{outline:2px solid var(--o-ink);outline-offset:2px}',
    P + ' .o-thumb-video{position:absolute;right:4px;bottom:4px;padding:1px 5px;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font:600 10px/1.4 var(--o-font)}',
    // A seção da galeria vira coluna (foto, depois a grade); no computador era linha por causa do selo de zoom absoluto (que segue absoluto).
    P + ' .section-product-v2{flex-direction:column;gap:0!important}',
    P + ' #zoom-image-tooltip{width:auto!important;height:40px!important;padding:0 16px;border-radius:999px!important;background:rgba(0,0,0,.6)!important;font-size:14px}',
    P + '.o-thumbs #zoom-image-tooltip{bottom:calc(var(--o-thumbs-h,0px) + 16px)!important;top:auto!important}',
    P + ' .section-product-v2 > section{background:var(--o-ground)!important}',
    // ── Coluna de compra na ordem da decisão: o theme-ui REPOSICIONA no DOM prazo, cupom e "Também disponível em" depois do quadro de compra (mesmo pai),
    // para a ordem do teclado e do leitor de tela seguir a visual. Sem JS, fica a ordem nativa. ──
    F + '{gap:22px!important}',
    // Preço e condições.
    F + ' .text-4xl{font-family:var(--o-font);font-weight:700;font-size:clamp(28px,2.6vw,36px);line-height:1.05;letter-spacing:-.02em;color:var(--o-ink)}',
    F + ' > .flex.flex-col.items-start.gap-1 p.font-medium.text-base{color:var(--o-ink-soft);font-size:15px;font-weight:400}',
    F + ' > .flex.flex-col.items-start.gap-1 :is(.text-green-500,.lg\\:text-green-600){color:var(--o-ink)!important;font-weight:600}',
    F + ' del,' + F + ' .line-through{color:var(--o-ink-mute)}',
    // Escolhas: uma coluna (modelo › cor › tamanho › medidas › quantidade — a quantidade é posta depois das medidas no DOM pelo theme-ui).
    T + '{flex-direction:column!important;flex-wrap:nowrap!important;align-items:stretch!important;gap:20px!important;margin-bottom:4px!important}',
    T + ' > div:has(#open-modal-size){margin-top:-10px}',
    T + ' p strong,' + T + ' p{' + groupLabel + '}',
    // Chips de modelo e tamanho: linha fina e fundo claro no normal; o escolhido na cor da região (cheio); indisponível tracejado e apagado.
    T + ' .form-product-options__select-type-model{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%}',
    T + ' .form-product-options__select-type-model-item{width:100%}',
    T + ' .form-product-options__select-type-size{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(44px,1fr));gap:8px;width:100%}',
    T + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item,.form-product-options__select-type-size-item-disabled) label{width:100%!important;min-width:0!important;min-height:46px;height:auto!important;border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)!important;color:var(--o-ink)!important;font-size:15px!important;font-weight:500;letter-spacing:0;transition:border-color .16s var(--o-ease),background-color .16s var(--o-ease),color .16s var(--o-ease)}',
    '@media (hover:hover){' + T + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item) label:hover{border-color:var(--o-ink)!important}}',
    T + ' :is(.form-product-options__select-type-model-item,.form-product-options__select-type-size-item) input:checked + label{background:var(--o-selected)!important;border-color:var(--o-selected)!important;color:var(--o-on-selected)!important;font-weight:600}',
    T + ' .form-product-options__select-type-size-item-disabled label{border-style:dashed!important;border-color:var(--o-line)!important;color:var(--o-ink-mute)!important;background:var(--o-paper)!important}',
    T + ' .form-product-options__select-type-size-item-disabled:after{background-color:var(--o-line);height:70%;top:15%}',
    T + ' input[type="radio"]:focus-visible + label{outline:2px solid var(--o-ink)!important;outline-offset:2px}',
    // Cores: o anel de seleção em tinta, separado da bolinha (legível em cor clara e escura).
    T + ' .form-product-options__select-type-colors{gap:8px!important;flex-wrap:wrap}',
    T + ' .form-product-options__select-type-colors-item input:checked + label{border-color:var(--o-surface)!important;box-shadow:0 0 0 2px var(--o-ink)}',
    // Medidas: "Guia de medidas" e "Informar medidas" como links de ação lado a lado (antes: dois botões largos que truncavam no celular).
    T + ' [data-origens-fit-row]{gap:4px 24px!important;flex-wrap:wrap;justify-content:flex-start!important;margin-bottom:0!important}',
    T + ' #open-modal-size,' + T + ' button[data-origens-fit]{min-height:44px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;color:var(--o-ink)!important;font-size:14px!important;font-weight:600!important;width:auto!important;flex:0 0 auto!important;gap:8px!important}',
    T + ' #open-modal-size .o-size-label,' + T + ' button[data-origens-fit] > span{text-decoration:underline!important;text-underline-offset:4px;text-decoration-color:var(--o-line)!important}',
    T + ' #open-modal-size .o-size-chevron{display:none}',
    // Quantidade discreta.
    T + ' .inline-flex.items-center.px-3.border-solid{border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;min-height:44px;background:var(--o-surface)}',
    // CTA: largura total da coluna; mesmo botão, mesmo clique e mesma validação da INK.
    btn(F + ' #add-to-cart-desk,' + F + ' #add-to-cart-mob'),
    F + ' #add-to-cart-desk{width:100%;max-width:none}',
    F + ' .form-product-options__add-to-cart{gap:16px!important}',
    // Confiança logo abaixo do CTA: texto em tinta, ícone em verde AA, pagamento menor.
    F + ' .form-product-options__add-to-cart :is(.text-green-500,.text-green-600,.text-green-700){color:var(--o-ink)!important;font-weight:600}',
    F + ' .form-product-options__add-to-cart svg{color:var(--o-ok)}',
    F + ' .form-product-options__add-to-cart .gap-8{gap:14px!important}',
    F + ' .form-product-options__add-to-cart :is(p,span){font-size:14px}',
    F + ' .form-product-options__add-to-cart ul img{height:24px!important;width:auto!important}',
    // Prazo e cupons: perto da compra, como linhas discretas.
    P + ' #cheapest-estimate-button{min-height:44px;color:var(--o-ink)!important;font-weight:600;font-size:15px;text-decoration:underline;text-underline-offset:4px;text-decoration-color:var(--o-line)}',
    P + ' #cheapest-estimate-button :is(span,svg){color:var(--o-ink)!important}',
    P + ' #cheapest-estimate-button svg path{fill:var(--o-ink)}',
    P + ' #product_promotions_frame > div.border{border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;background:var(--o-paper);padding:12px 14px!important}',
    P + ' #product_promotions_frame > div.border :is(span,a){font-size:14px!important}',
    P + ' #product_promotions_frame a.text-blue-600{color:var(--o-ink)!important}',
    // "Também disponível em": outros tipos de peça, depois da compra e com peso secundário.
    F + ' > [data-controller="ink-store--modal"] > span{font-size:13px!important;font-weight:600!important;letter-spacing:.04em;text-transform:uppercase;color:var(--o-ink-mute)}',
    F + ' > [data-controller="ink-store--modal"] .no-scrollbar button{min-height:44px;padding:0 14px!important;border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)!important;color:var(--o-ink)!important;font-size:14px!important;font-weight:500!important;box-shadow:none!important}',
    // Barra fixa do celular (nativa): só quando o CTA principal está fora da tela; some com teclado, escolha em andamento e painéis (classes do theme-ui).
    F + ' .form-product-options__add-to-cart-mobile{left:0;right:0;width:auto!important;padding:8px 16px calc(8px + env(safe-area-inset-bottom));background:var(--o-surface);border-top:1px solid var(--o-line-soft);transition:transform .2s var(--o-ease),visibility .2s}',
    F + ' #add-to-cart-mob{width:100%;min-height:52px}',
    P + ':is(.o-cta-inview,.o-typing) form[id^="form-product-"] .form-product-options__add-to-cart-mobile{transform:translateY(110%);visibility:hidden}',
    F + ' .o-need-choice{outline:2px solid var(--o-error);outline-offset:6px;transition:outline-color .3s}',
    F + ' .o-need-choice p strong{color:var(--o-error)}',
    // Flutuantes (Ajuda da INK, WhatsApp e cupons nossos): no celular saem do caminho enquanto as escolhas e o CTA estão na tela (classe do theme-ui);
    // voltam ao rolar para fora. O menu lateral continua com o atendimento.
    '@media (max-width:1023px){' + P + '.o-choosing :is([data-controller~="ink-store--help-button"],#o-wa-fab,#o-promo){opacity:0!important;visibility:hidden!important;pointer-events:none!important}' +
      P + ' :is([data-controller~="ink-store--help-button"],#o-wa-fab,#o-promo){transition:opacity .2s var(--o-ease),visibility .2s}}',
    // Abas de descrição: continuam abas (role=tablist da INK), com a linha da vitrine.
    P + ' #mytab button{min-height:44px;color:var(--o-ink-mute);font-weight:600}',
    P + ' #mytab button[aria-selected="true"]{color:var(--o-ink)!important;border-color:var(--o-ink)!important}',
    P + ' #product_details [role="tabpanel"]{background:transparent!important;border-radius:0!important;padding-left:0!important;padding-right:0!important}',
    P + ' #product_details [role="tabpanel"] :is(p,div){color:var(--o-ink-soft)!important;font-weight:400!important;line-height:1.6}',
    // Módulos nossos na PDP (guia, recomendações): mesma linguagem leve.
    P + ' [data-origens-guide="invite"]{background:var(--o-paper)!important;border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;--o-tint:var(--o-ink)}',
    P + ' [data-origens-guide] .o-g-title{font-size:15px!important;font-weight:600!important}',
    P + ' [data-origens-guide] .o-g-btn{border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)!important;color:var(--o-ink)!important;font-weight:500}',
    P + ' [data-origens-guide] .o-g-btn.o-g-more{border-style:solid!important}',
    P + ' .o-reco-card{border-radius:var(--o-radius)!important;border-color:var(--o-line-soft)!important;background:var(--o-surface)!important}',
    P + ' .o-reco-media,' + P + ' .o-reco-media img{border-radius:var(--o-radius)!important;background:var(--o-photo)!important}',
    P + ' .o-reco-name,' + P + ' .o-reco-price{font-weight:500!important;color:var(--o-ink)!important}',
    P + ' .o-reco-cta{color:var(--o-ink)!important;text-decoration:underline;text-underline-offset:3px}',
    P + ' .o-reco-title{font-weight:700!important;letter-spacing:-.01em;color:var(--o-ink)!important}'
  ].join('');
}

function cartCss() {
  const D = C + ' .cart-drawer';
  return [
    // Painel: compra em primeiro plano. Cabeçalho enxuto; itens separados por linha fina; rodapé com o resumo e UMA ação principal.
    D + '{font-family:var(--o-font);letter-spacing:normal;color:var(--o-ink);background:var(--o-surface)}',
    D + ' :is(button,input,select,textarea){font-family:inherit;letter-spacing:normal}',
    '@media (min-width:768px){' + D + '{width:440px}}',
    D + '__header{border-bottom:1px solid var(--o-line-soft)}',
    D + '__header .top-header{min-height:56px;align-items:center;padding:8px 12px 8px 20px!important}',
    D + '__header .top-header > span{font-size:18px;font-weight:700;color:var(--o-ink)}',
    D + '__header .top-header > span .text-gray-500{color:var(--o-ink-mute)!important;font-weight:400;font-size:14px!important}',
    D + '__header #cart-drawer-close{width:28px!important;height:28px!important;min-width:28px;cursor:pointer;color:var(--o-ink)}',
    D + '__main{background:var(--o-surface)!important}',
    D + '__main .main-list__item{border-bottom:1px solid var(--o-line-soft);padding:14px 16px!important;gap:12px}',
    D + '__main .main-list__item > img{width:88px!important;height:88px!important;max-width:88px;flex:0 0 88px;object-fit:cover;background:var(--o-photo);border-radius:var(--o-radius)}',
    D + '__main .main-list__item .item-wrapper .item-header{font-size:15px;font-weight:600;color:var(--o-ink)}',
    D + '__main .main-list__item .item-wrapper .item-details > span,' + D + '__main .main-list__item .item-wrapper .item-details p{color:var(--o-ink-mute);font-size:14px}',
    D + '__main .main-list__item .item-wrapper .item-details > p:first-child{color:var(--o-ink);font-weight:600;font-size:15px}',
    D + '__main .main-list__item .item-wrapper .item-details .price span{color:var(--o-ink);font-weight:600}',
    // Preço numa linha só, mesmo com nome longo (o nome é que quebra).
    D + '__main .main-list__item .item-wrapper .price-details{flex:0 0 auto;padding-left:8px}',
    D + '__main .main-list__item .item-wrapper :is(.price,.price span,.price del){white-space:nowrap}',
    D + '__main .main-list__item .item-wrapper .item-details > :is(span,p){line-height:1.35}',
    D + '__main .main-list__item .item-wrapper .item-details .price del{color:var(--o-ink-mute)}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity{border:1px solid var(--o-line-soft);border-radius:var(--o-radius);width:fit-content!important;max-width:100%}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity button{width:44px!important;height:44px!important}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity .quantity-input{width:36px!important;text-align:center}',
    D + '__main .main-list__item .item-wrapper .item-details__quantity .quantity-input{font-weight:600;color:var(--o-ink)}',
    // Rodapé: cupom e CEP em segundo plano (linhas compactas), total em destaque, "Finalizar compra" como única ação principal.
    D + '__footer{background:var(--o-panel)!important;border-top:1px solid var(--o-line-soft);padding:10px 16px calc(12px + env(safe-area-inset-bottom))!important}',
    D + '__footer .footer-details{margin:4px 0 10px!important;gap:4px}',
    D + '__footer .footer-details ul > li{font-size:14px;font-weight:400;color:var(--o-ink-soft)}',
    D + '__footer .footer-details ul > li:last-child{font-size:20px;font-weight:700;color:var(--o-ink);padding-top:6px}',
    D + '__footer :is(.text-green-500,.text-green-600){color:var(--o-ok)!important}',
    D + '__footer__cep,' + D + '__footer__coupon{min-height:44px}',
    D + '__footer__cep input,' + D + '__footer__coupon input{border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;background:var(--o-surface)!important;min-height:40px;font-size:16px!important;color:var(--o-ink)}',
    D + '__footer__cep input:focus,' + D + '__footer__coupon input:focus{border-color:var(--o-ink)!important;outline:2px solid var(--o-ink);outline-offset:0}',
    D + '__footer__cep .btn-apply,' + D + '__footer__coupon .btn-apply{min-width:44px;min-height:44px}',
    D + '__footer__cep label,' + D + '__footer__coupon label,' + D + '__footer__cep span,' + D + '__footer__coupon span{color:var(--o-ink-soft);font-weight:500;font-size:14px}',
    btn(D + ' #checkout-btn,' + D + '__footer__submit', 'cta'),
    D + ' #checkout-btn{width:100%}',
    // "Continuar comprando": ação de texto (44 px de toque, foco visível), abaixo da ação principal; mesmo controle da INK, só a aparência.
    D + '__footer__keep-shopping{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:2px!important;padding:0 12px!important;border:0!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;box-shadow:none!important;font-family:var(--o-font);font-size:15px;font-weight:600;letter-spacing:0;text-transform:none;text-decoration:underline;text-underline-offset:3px}',
    D + '__footer__keep-shopping:focus-visible{outline:2px solid var(--o-ink);outline-offset:2px}',
    // Cupom recolhido (theme-ui): o atributo é NOSSO e só existe com o código rodando; sem ele o campo da INK aparece. "Adicionar cupom" no lugar.
    D + '__footer__coupon[data-origens-collapsed]{display:none!important}',
    D + ' .o-coupon-toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0;border:0;background:transparent;color:var(--o-ink);font-family:var(--o-font);font-size:14px;font-weight:600;text-align:left;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    D + ' .o-coupon-toggle:focus-visible{outline:2px solid var(--o-ink);outline-offset:2px}',
    // Incentivo de frete (cart-incentive): no TOPO da lista, logo abaixo do título (rola com os produtos; nenhuma área fixa a mais). Fundo da cor de
    // seleção da marca, perceptível no branco do carrinho; o que falta e o benefício em destaque na mesma cor; a ressalva (destinos, CEP) numa linha
    // menor; régua fina só com meta numérica. Altura mínima de duas linhas + régua: trocar de estado não empurra os produtos. Sem animação contínua.
    D + ' [data-origens-incentive-slot]{flex:0 0 auto;width:100%;margin:0;padding:10px 16px 2px;list-style:none}',
    // Compacto (como a referência): uma linha de texto e a régua fina logo abaixo, ~45 px. Altura mínima igual nos estados com e sem régua.
    D + ' [data-origens-incentive-box]{display:grid;grid-template-columns:var(--o-incentive-icon-size) minmax(0,1fr);column-gap:8px;align-items:center;align-content:center;min-height:46px;padding:8px 12px 9px;border:1px solid var(--o-incentive-line);border-radius:var(--o-radius);background:var(--o-incentive-bg);color:var(--o-incentive-text);font-family:var(--o-font)}',
    D + ' [data-origens-incentive-box] > svg{grid-row:1;align-self:center;width:var(--o-incentive-icon-size);height:var(--o-incentive-icon-size);padding:var(--o-incentive-icon-pad);border-radius:50%;background:var(--o-incentive-icon-bg);color:var(--o-incentive-icon)}',
    D + ' [data-origens-incentive-box] > p{grid-column:2;margin:0;font-size:13.5px;line-height:1.35;color:var(--o-incentive-text)}',
    D + ' [data-origens-incentive-box] > p strong{font-weight:700;color:var(--o-incentive-ink)}',
    D + ' [data-origens-incentive-box] > small{grid-column:2;font-size:12.5px;line-height:1.3;color:var(--o-incentive-soft)}',
    D + ' [data-origens-incentive-box] .o-incentive-bar{display:block;grid-column:1 / -1;height:5px;margin-top:7px;border-radius:3px;overflow:hidden;background:var(--o-incentive-track)}',
    D + ' [data-origens-incentive-box] .o-incentive-bar i{display:block;width:100%;height:100%;border-radius:3px;background:var(--o-incentive-fill);transform-origin:left center;transition:transform .25s ease}',
    D + ' [data-origens-incentive-box][data-loading] > *{visibility:hidden}',
    '@media (prefers-reduced-motion:reduce){' + D + ' [data-origens-incentive-box] .o-incentive-bar i{transition:none}}',
    // Com o cupom recolhido e o CEP ainda fechado, "Adicionar cupom" e "Frete · Inserir CEP" dividem uma linha (os dois são ações curtas): uma linha de
    // 44 px a menos no rodapé fixo. Abriu o cupom ou o CEP, ou a marcação não é a esperada? Volta a uma linha cada. Nenhum nó é movido.
    D + '__footer:has(> .o-coupon-toggle):has(> .cart-drawer__footer__cep [data-action*="insertCep"]):not(:has(> .cart-drawer__footer__cep [data-ink-store--cart-target="cepInputContainer"]:not(.hidden))){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px}',
    D + '__footer:has(> .o-coupon-toggle):has(> .cart-drawer__footer__cep [data-action*="insertCep"]) > *{grid-column:1 / -1}',
    D + '__footer:has(> .o-coupon-toggle):has(> .cart-drawer__footer__cep [data-action*="insertCep"]) > .o-coupon-toggle{grid-column:1}',
    D + '__footer:has(> .o-coupon-toggle):has(> .cart-drawer__footer__cep [data-action*="insertCep"]):not(:has(> .cart-drawer__footer__cep [data-ink-store--cart-target="cepInputContainer"]:not(.hidden))) > .cart-drawer__footer__cep{grid-column:2}',
    // "Inserir CEP" da INK: 44 px de toque sem crescer a linha.
    D + '__footer__cep [data-action*="insertCep"]{display:inline-flex;align-items:center;min-height:44px;color:var(--o-ink);font-weight:600}',
    // Tela baixa (celular de 640–760 px de altura, notebook com a janela baixa): o rodapé fixo da gaveta comia a lista. Compacto, sem esconder nada da
    // INK e sem alvo de toque abaixo de 44 px.
    '@media (max-height:760px){' + D + '__footer{padding:8px 16px calc(10px + env(safe-area-inset-bottom))!important}' +
      D + '__footer .footer-details{margin:2px 0 8px!important;gap:2px}' + D + '__footer .footer-details ul > li:last-child{font-size:18px;padding-top:2px}' +
      D + ' #checkout-btn,' + D + '__footer__submit{min-height:48px}}',
    // Tela MUITO baixa (teclado do celular aberto no cupom ou no CEP, janela achatada): a gaveta rola inteira — itens, cupom, totais e botões em
    // sequência —, e o rodapé deixa de ser fixo para não cobrir o campo em uso nem o último produto.
    '@media (max-height:520px){' + D + ' turbo-frame#cart > div.flex-col{overflow-y:auto;overscroll-behavior:contain}' +
      D + '__main{flex:0 0 auto!important;height:auto!important;overflow:visible!important}}',
    // Carrinho vazio: o nosso bloco abre o estado ("Seu carrinho está vazio" + "Encontrar minha cidade" + "Explorar estampas"); a frase da INK que repete
    // a mesma intenção some só quando o nosso bloco existe (sem ele, a INK fica como é). Recomendações da INK abaixo; "Continuar comprando" secundário.
    D + ' .empty-cart{background:var(--o-surface)!important;color:var(--o-ink-soft)!important;gap:20px}',
    D + ' .empty-cart:has([data-origens-empty]) #most_sold_frame > div > span:first-child{display:none}',
    D + ' .empty-cart [data-action*="closeDrawer"]{display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid var(--o-ink);border-radius:var(--o-radius);background:transparent;cursor:pointer}',
    D + ' .empty-cart [data-action*="closeDrawer"] > div{color:var(--o-ink)!important;font-weight:600;font-size:15px}',
    C + ' .cart-drawer-overlay{background:rgba(0,0,0,.45)!important}',
    // Bloco "Descubra outras estampas" (nosso): no carrinho preenchido vem depois dos itens e compacto (discovery-ui); no vazio é a abertura.
    C + ' [data-origens-discovery]{background:var(--o-paper)!important;border:1px solid var(--o-line-soft)!important;border-radius:var(--o-radius)!important;color:var(--o-ink)!important}',
    C + ' [data-origens-discovery] .o-title{font-weight:600!important}',
    C + ' [data-origens-discovery] .o-toggle,' + C + ' [data-origens-discovery] .o-cta{border:1px solid var(--o-ink)!important;border-radius:var(--o-radius)!important;background:transparent!important;color:var(--o-ink)!important;font-weight:600!important;letter-spacing:0!important}',
    C + ' [data-origens-discovery][data-origens-empty]{background:transparent!important;border:0!important;padding:4px 20px 0!important;margin:16px 0 0!important}',
    C + ' [data-origens-discovery][data-origens-empty] .o-title{font-size:18px!important;font-weight:700!important;margin-bottom:12px}',
    C + ' [data-origens-discovery][data-origens-empty] .o-actions{flex-direction:column;align-items:stretch}',
    C + ' [data-origens-discovery][data-origens-empty] .o-actions > *{flex:0 0 auto!important;width:100%}',
    C + ' [data-origens-discovery][data-origens-empty] .o-toggle{background:var(--o-action)!important;border-color:var(--o-action)!important;color:var(--o-on-action)!important;min-height:52px}',
    C + ' [data-origens-discovery] .o-input{border-radius:var(--o-radius)!important;border-color:var(--o-line)!important;font-size:16px}',
    // Carrinho preenchido: o bloco (denso, depois dos itens) é uma linha de duas ações de 44 px, sem disputar com os itens.
    C + ' [data-origens-discovery="cart"].o-dense{padding:8px!important;margin:12px 16px!important}',
    C + ' [data-origens-discovery="cart"].o-dense :is(.o-toggle,.o-cta){min-height:44px!important;padding:6px 10px!important;font-size:14px!important;line-height:1.2}',
    // Pós-adição: só título e ações (o texto de apoio e o rótulo de cima alongavam a folha no celular).
    C + ' [data-origens-discovery="post-add"] :is(.o-eyebrow,.o-lead){display:none}',
    C + ' [data-origens-discovery="post-add"] .o-title{font-size:16px!important;margin-bottom:8px}',
    C + ' [data-origens-discovery] .o-item{border-radius:var(--o-radius)!important}',
    // Confirmação pós-adição (modal nativo): mesma linguagem; "Ver carrinho" = ação principal, "Continuar comprando" = secundária.
    C + ' #modal-wrapper{font-family:var(--o-font);letter-spacing:normal;color:var(--o-ink)}',
    C + ' #modal-wrapper :is(button,input){font-family:inherit;letter-spacing:normal}',
    C + ' #modal-wrapper :is(h2,h3){font-weight:700;color:var(--o-ink)}',
    btn(C + ' #modal-wrapper .checkout-btn'),
    ghost(C + ' #modal-wrapper #continue-shopping-button'),
    C + ' #modal-wrapper .checkout-btn,' + C + ' #modal-wrapper #continue-shopping-button{width:100%}'
  ].join('');
}

function checkoutCss() {
  const L = K + ' [data-controller="ink-store--checkout"]';
  const PAY = L + ' > section.md\\:col-span-7';
  return [
    stripCss(K),
    K + '{font-family:var(--o-font);color:var(--o-ink);background:var(--o-surface)}',
    K + ' :is(button,input,select,textarea){font-family:inherit}',
    K + ' :is([data-controller="ink-store--checkout"],turbo-frame#cart_summary),' + K + ' :is([data-controller="ink-store--checkout"],turbo-frame#cart_summary) :where(*:not(i):not(svg):not(svg *)){font-family:var(--o-font)!important}',
    // Cabeçalho compacto com a assinatura: símbolo da INK (o logo da loja) + "USE ORIGENS" (posto pelo Worker no HTML, sem script). Sem menu.
    K + ' nav.bg-store-primary a:has([data-origens-brand]){display:flex;align-items:center;gap:10px;text-decoration:none}',
    K + ' nav.bg-store-primary a img{height:40px!important;width:auto}',
    K + ' [data-origens-brand]{font-family:var(--o-word);font-weight:800;font-size:24px;line-height:1;letter-spacing:.02em;text-transform:uppercase;color:#fff;white-space:nowrap}',
    // Duas colunas com largura máxima e respiro; resumo como uma superfície própria, fixo enquanto o formulário rola SÓ em telas altas o bastante.
    '@media (min-width:768px){' + L + '{max-width:1180px;margin-inline:auto!important;column-gap:48px;padding:0 24px}' +
      K + ' turbo-frame#cart_summary > section{border-radius:var(--o-radius);padding:24px!important;margin-top:24px;height:auto!important}}',
    '@media (min-width:768px) and (min-height:760px){' + K + ' turbo-frame#cart_summary > section{position:sticky;top:24px;max-height:calc(100vh - 48px);overflow:auto}}',
    // Títulos de grupo: identificação, entrega, formas de entrega; mesmos pesos e espaços.
    L + ' section > .w-full.flex.flex-col.items-start > p.text-2xl{font-weight:700;font-size:clamp(24px,2.6vw,32px);letter-spacing:-.015em;color:var(--o-ink)}',
    L + ' section > .w-full.flex.flex-col.items-start > p.text-sm{color:var(--o-ink-mute)}',
    L + ' h3.text-lg{font-size:18px;font-weight:700;color:var(--o-ink);padding-top:12px;border-top:1px solid var(--o-line-soft)}',
    L + ' label{color:var(--o-ink);font-weight:500}',
    field(L + ' input:is([type="text"],[type="email"],[type="tel"]),' + L + ' select'),
    L + ' input:is([type="checkbox"],[type="radio"]){color:var(--o-ink)!important;accent-color:var(--o-ink);border-color:var(--o-ink-mute)!important}',
    L + ' input[type="checkbox"]{width:20px;height:20px}',
    L + ' input:is([type="checkbox"],[type="radio"]):focus-visible{outline:2px solid var(--o-ink);outline-offset:2px;box-shadow:none!important}',
    L + ' small[class*="-bottom-5"]{color:var(--o-error)!important;font-weight:600;font-size:12.5px;line-height:1.3}',
    L + ' .field_with_errors :is(input,select),' + L + ' :is(input,select)[aria-invalid="true"]{border-color:var(--o-error)!important}',
    L + ' #contentAlert{color:var(--o-error)!important}',
    L + ' a.underline{color:var(--o-ink)}',
    // Opções de frete e pagamento: linhas de escolha com borda fina; a escolhida com borda forte e fundo claro. Campos revelados (cartão, cobrança) iguais.
    // A escolhida: fundo leve da cor de seleção da marca, borda discreta nessa cor e o indicador nativo na mesma cor; as demais neutras. Mesma
    // espessura de borda nos dois estados (nada pula ao escolher).
    L + ' .shipping-types__item,' + L + ' #formPaymentMethods > ul > li{border:1px solid var(--o-line-soft);border-radius:var(--o-radius)!important;background:var(--o-surface);box-shadow:none}',
    L + ' .shipping-types__item{padding:12px 14px;min-height:56px}',
    L + ' .shipping-types__item:has(input:checked),' + L + ' #formPaymentMethods > ul > li:has(> label input:checked){border-color:var(--o-choice-line);background:var(--o-choice-bg);box-shadow:inset 0 0 0 1px var(--o-choice-ring)}',
    L + ' #formPaymentMethods > ul > li:has(> label input:checked){background:var(--o-choice-body)}',
    L + ' #formPaymentMethods > ul > li:has(> label input:checked) > label{background-color:var(--o-choice-head)!important}',
    L + ' :is(.shipping-types__item,#formPaymentMethods) input[type="radio"]{accent-color:var(--o-choice-mark)}',
    L + ' :is(.shipping-types__item,#formPaymentMethods) input[type="radio"]:checked{color:var(--o-choice-mark)!important;border-color:var(--o-choice-mark)!important}',
    L + ' #formPaymentMethods > ul{gap:8px;border:0!important;border-radius:0!important}',
    L + ' #formPaymentMethods > ul > li > label{min-height:56px}',
    L + ' #formPaymentMethods label{background-color:transparent!important;border-color:transparent!important}',
    L + ' #content-credit_card,' + L + ' #content-pix{padding:4px 16px 16px!important;background:transparent!important}',
    // Desabilitado e carregando (a INK desabilita o botão enquanto envia): legível, sem parecer clicável.
    L + ' :is(button,input,select):disabled{opacity:.55;cursor:not-allowed}',
    // Respiro entre as seções (identificação, entrega, formas de entrega, pagamento).
    L + ' h3.text-lg{margin-top:12px}',
    L + ' #content-pix .bg-orange-50{background:var(--o-surface)!important;border:1px solid var(--o-line-soft);border-radius:var(--o-radius)}',
    // A faixa "pagamento protegido" desce para DEPOIS das opções e do botão (mesmo pai flex): a decisão vem primeiro, a garantia fica perto do botão.
    PAY + '{gap:20px}',
    PAY + ' > section{order:2}',
    PAY + ' > div[role="alert"].p-4.text-sm.rounded-lg{order:3;background:transparent!important;border:0!important;padding:0!important}',
    PAY + ' > div[role="alert"].p-4.text-sm.rounded-lg h3{font-size:14px;font-weight:600}',
    PAY + ' > div[role="alert"].p-4.text-sm.rounded-lg :is(span,h3){color:var(--o-ink-soft)!important}',
    PAY + ' > div[role="alert"].p-4.text-sm.rounded-lg .mt-2{margin:2px 0 0!important}',
    // Botões de seguir e "Finalizar compra" (que já processa o pagamento: não há revisão depois). Na barra do celular, uma linha só.
    btn(L + ' button.bg-green-500,' + L + ' button[type="submit"][data-action*="validateAndSubmit"],' + L + ' a.bg-green-500', 'cta'),
    L + ' button.bg-green-500.md\\:hidden{white-space:nowrap;padding:0 16px;letter-spacing:.02em;font-size:14px}',
    // Campo em foco (Tab, ou o navegador levando ao campo com erro) nunca para atrás da faixa fixa do topo nem, no celular, atrás da barra fixa
    // "Total · Finalizar compra" (79 px): o navegador respeita o scroll-padding ao rolar até o foco.
    'html:has(> ' + K + '){scroll-padding-top:48px}',
    '@media (max-width:767px){html:has(> ' + K + ' div.fixed.bottom-0 button.md\\:hidden){scroll-padding-bottom:104px}}',
    // Resumo: itens, subtotal, desconto, prazo, frete e total; total em destaque, desconto em verde AA.
    K + ' turbo-frame#cart_summary > section{background:var(--o-panel)!important}',
    K + ' turbo-frame#cart_summary img{border-radius:var(--o-radius)!important;border-color:var(--o-line-soft)!important;background:var(--o-photo)}',
    K + ' turbo-frame#cart_summary h3{font-weight:600;color:var(--o-ink)}',
    K + ' turbo-frame#cart_summary p.font-medium.text-gray-900{font-weight:700;color:var(--o-ink)}',
    K + ' turbo-frame#cart_summary :is(.text-green-500,.text-green-600),' + L + ' :is(.text-green-500,.text-green-600){color:var(--o-ok)!important}',
    K + ' #prices_summary div.text-base.md\\:text-lg{font-weight:700;color:var(--o-ink)}',
    L + ' a[aria-label="Editar endereço de entrega"]{color:var(--o-ink);min-height:44px;font-weight:600}',
    L + ' .md\\:hidden.flex.flex-col{border-color:var(--o-line-soft)!important;border-radius:var(--o-radius)!important}'
  ].join('');
}

// Páginas de conta: login (fora da casca: o cartão isolado da INK), pedidos, detalhe do pedido, rastreio, avaliação e trocas (no layout da loja). Os mesmos
// botões, campos, títulos e linhas do checkout: a conta parece a mesma loja do começo ao fim. Seletores conferidos no DOM real em 17/10/2026 (login,
// rastreio e trocas públicos; pedidos, detalhe e avaliação vistos logados, só a estrutura). Nenhum `display` do que a INK mostra/esconde.
function accountCss() {
  const CARD = A + ' :is(section,div).bg-white.rounded-lg.border';
  const LOGIN = A + ' div.rounded-lg.bg-white.shadow';
  return [
    A + '{font-family:var(--o-font);color:var(--o-ink)}',
    A + ' :is(button,input,select,textarea){font-family:inherit}',
    // Cartões (pedidos, detalhe, avaliação): superfície branca com linha fina, sem sombra, cantos do tema.
    CARD + '{border-color:var(--o-line-soft)!important;border-radius:var(--o-radius)!important;box-shadow:none!important;background:var(--o-surface)!important}',
    // O cartão do formulário de rastreio (sem borda na INK, com sombra): a mesma linha fina, sem sombra.
    A + ' div.bg-white.rounded-lg:has(> form[action$="/orders/trackings/search"]){border:1px solid var(--o-line-soft);border-radius:var(--o-radius)!important;box-shadow:none!important}',
    // Títulos: "Compras" e o número do pedido na hierarquia do site (o mesmo peso dos títulos do checkout).
    A + ' h1.text-4xl{font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.1;letter-spacing:-.015em;color:var(--o-ink)!important}',
    A + ' div.container > nav p.text-2xl{font-weight:700;font-size:clamp(22px,2.4vw,28px);letter-spacing:-.01em;color:var(--o-ink)}',
    // "Voltar" do detalhe: alvo de 44 px pelo padding (sem mexer no fluxo da INK).
    A + ' div.container > nav a{padding:10px;margin:-10px;color:var(--o-ink)}',
    A + ' :is(p,span).text-gray-500,' + A + ' :is(p,span).text-gray-600{color:var(--o-ink-mute)!important}',
    A + ' :is(p,span).text-gray-900,' + A + ' :is(p,span).text-gray-800{color:var(--o-ink)!important}',
    CARD + ' p.text-lg.font-bold{font-weight:700;letter-spacing:.01em}',
    A + ' :is(p,span).text-green-500{color:var(--o-ok)!important}',
    // "Ver compra" / "Rastrear compra": a ação principal do site; "Avaliar": secundária, em linha fina; desabilitado legível, sem parecer clicável.
    btn(A + ' a.bg-store-button,' + A + ' button.bg-store-button', 'cta'),
    ghost(A + ' button.border.border-gray-400'),
    A + ' :is(button,input):disabled{opacity:.55;cursor:not-allowed}',
    // Rastreio (CPF/CNPJ e número do pedido) e login (CPF/CNPJ): campos e botão do checkout.
    field(A + ' input:is([type="text"],[type="email"],[type="tel"],[type="number"],[type="password"])'),
    A + ' input::placeholder{color:var(--o-ink-mute);opacity:1}',
    A + ' label.text-gray-900{color:var(--o-ink);font-weight:600}',
    btn(A + ' form[action$="/orders/trackings/search"] input[type="submit"],' + A + ' form[action$="/store_sessions"] button[type="submit"]', 'cta'),
    A + ' form[action$="/store_sessions"] button[type="submit"] p{color:inherit!important;font:inherit}',
    A + ' form[action$="/orders/trackings/search"] hr{border-color:var(--o-line-soft)}',
    // Login: o fundo e o cartão isolados da INK com a cara do site; o nome ao lado do símbolo, como no checkout; "Voltar" com alvo de 44 px.
    A + ' div.bg-gray-100.min-h-screen{background:var(--o-paper)!important}',
    LOGIN + '{border:1px solid var(--o-line-soft);border-radius:var(--o-radius)!important;box-shadow:none!important}',
    LOGIN + ' a:has(> img) + p{font-family:var(--o-word);font-weight:800;font-size:26px;line-height:1;letter-spacing:.02em;text-transform:uppercase;color:var(--o-ink)!important}',
    LOGIN + ' a.cursor-pointer.w-fit{min-height:44px;color:var(--o-ink)}',
    LOGIN + ' p.font-semibold.text-gray-800{font-weight:700;letter-spacing:-.01em}',
    // Resumo do pedido (detalhe): miniaturas no cinza das fotos, cantos do tema.
    CARD + ' img{border-radius:var(--o-radius)!important;background:var(--o-photo)}',
    // Trocas e devoluções: título e perguntas na tipografia do site, linhas finas entre as perguntas.
    // A página de trocas carrega o CSS do "new layout" da INK, que força a Poppins: a fonte do site volta com !important só aqui (ícones fora).
    A + ' main.main-faq,' + A + ' main.main-faq :where(*:not(i):not(svg):not(svg *)),' + A + ':has(main.main-faq) .o-nav :where(*:not(i):not(svg):not(svg *)){font-family:var(--o-font)!important}',
    A + ':has(main.main-faq) .o-nav-word{font-family:var(--o-word)!important}',
    A + ' main.main-faq h4{font-weight:700;font-size:clamp(26px,2.8vw,36px);letter-spacing:-.015em;color:var(--o-ink)}',
    A + ' main.main-faq details{border-bottom:1px solid var(--o-line-soft)}',
    A + ' main.main-faq summary{min-height:48px;font-weight:600;color:var(--o-ink);cursor:pointer}',
    A + ' main.main-faq details p{color:var(--o-ink-soft);line-height:1.6;max-width:72ch}',
    A + ' :is(a,button,summary):focus-visible{outline:2px solid var(--o-ink);outline-offset:3px}'
  ].join('');
}

const SURFACE_CSS = { pdp: pdpCss, cart: cartCss, checkout: checkoutCss, account: accountCss };

// CSS de UMA combinação de superfícies. O @import da fonte vem primeiro (regra do CSS).
export function buildThemeCss(theme, surfaces) {
  const list = SURFACES.filter((s) => surfaces.includes(s));
  if (!theme || list.length === 0) return '';
  const font = FONTS[theme.tokens.font];
  return '/* Use Origens · tema da compra na INK v' + THEME_VERSION + ' (' + list.join(',') + ') */' +
    (font.import ? '@import url("' + font.import + '");' : '') +
    tokensCss(theme.tokens) + ((list.includes('pdp') || list.includes('checkout')) ? STRIP_KEYFRAMES : '') + list.map((s) => SURFACE_CSS[s]()).join('') +
    paletteCss(theme, list);
}

// ── Paletas do carrinho e do checkout ─────────────────────────────────────────────────────────────────────────────────────────
// "acento" (verde com acento ocre, a proposta B da direção de arte, escolhida em 17/10/2026): os PAPÉIS de cor do carrinho e do checkout trocados por
// valores fixos e medidos (contraste AA). As regras não mudam, só os papéis. O botão é carvão, em continuidade com o botão escuro da PDP. As escolhas e o
// progresso ficam no verde da identidade, um tom mais vivo. A faixa de frete é palha, com o ícone num círculo dourado-areia (o acento oficial da Sul). As
// superfícies de apoio são off-white quente. Por região: só existe para a Sul; as outras ficam na paleta derivada dos tokens.
export const PALETTES = Object.freeze({
  acento: Object.freeze({
    sul: Object.freeze({
      cta: '#1b1d19', 'on-cta': '#ffffff', selected: '#3a5a30', ink: '#1b1d19', paper: '#fbf8f2', panel: '#fbf8f2',
      'incentive-bg': '#f4ecda', 'incentive-line': '#e3d3b0', 'incentive-ink': '#2f4b28', 'incentive-text': '#1b1d19', 'incentive-soft': '#5a5340',
      'incentive-icon': '#2f4b28', 'incentive-icon-bg': '#d6ba8d', 'incentive-icon-size': '22px', 'incentive-icon-pad': '3px',
      'incentive-track': '#fffaf1', 'incentive-fill': '#2f4b28',
      'choice-line': '#3a5a30', 'choice-ring': 'transparent', 'choice-bg': '#f1f5ec', 'choice-head': '#eef3e7', 'choice-body': '#ffffff', 'choice-mark': '#3a5a30'
    })
  })
});
const PALETTE_SELECTION = Object.freeze({ acento: '#ecdcb8' });

function paletteCss(theme, list) {
  const roles = theme.palette && theme.palette !== 'neutra' ? PALETTES[theme.palette]?.[theme.region] : null;
  if (!roles) return '';
  // A conta também: o mesmo botão carvão, a mesma tinta e o off-white quente do checkout (a pessoa sai de um e entra na outra).
  const scopes = [list.includes('cart') ? 'body[data-origens-theme~="cart"] .cart-drawer' : null, list.includes('checkout') ? 'body[data-origens-theme~="checkout"]' : null, list.includes('account') ? A : null].filter(Boolean);
  if (scopes.length === 0) return '';
  const vars = Object.entries(roles).map(([role, value]) => '--o-' + role + ':' + value).join(';');
  const sel = scopes.join(',');
  return sel + '{' + vars + '}' +
    scopes.map((s) => s + ' ::selection').join(',') + '{background:' + PALETTE_SELECTION[theme.palette] + ';color:' + roles.ink + '}' +
    (list.includes('checkout') ? 'body[data-origens-theme~="checkout"] :is(input,textarea){caret-color:' + roles.selected + '}' : '') +
    (list.includes('account') ? A + ' :is(input,textarea){caret-color:' + roles.selected + '}' : '');
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
