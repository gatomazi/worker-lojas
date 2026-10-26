// Funções puras do release do TEMA DA COMPRA NA INK (scripts/release-tema.sh; testadas em test/theme-release.test.js; sem rede, sem Wrangler).
// O release liga `theme-pdp` e `theme-cart` no Worker da Sul PRESERVANDO tudo o que está em produção: as variáveis da versão ativa (escopo, allowlist,
// features, regiões, domínio), os bindings e as rotas. Nada é adivinhado: uma captura ilegível ou divergente do health público para o release.
import { FEATURE_NAMES } from '../../src/features.js';

/** O que este release liga. `theme-checkout` fica de fora: o Worker não tem rota no checkout (a exclusão da zona deixa compra e login com a INK). */
export const THEME_FEATURES = ['theme-pdp', 'theme-cart'];
/** As variáveis que o deploy passa por --var (o TOML é fail-closed nelas); as demais do TOML vão como estão e TÊM de ser iguais às da produção. */
export const DEPLOY_VARS = ['ENABLE_WIDGET', 'WIDGET_ALLOWLIST', 'WIDGET_FEATURES', 'WIDGET_SCOPE_MODE'];
const MAX_FEATURES_LENGTH = 320; // o mesmo teto de src/features.js parseFeatures
const PRODUCT_PATH = /^\/useorigens\/product\/[a-z0-9][a-z0-9_-]{0,127}$/;

const list = (raw) => String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

/** `[vars]` do TOML: só `NOME = "valor"` (comentários e outras seções ignorados). */
export function parseTomlVars(text) {
  const vars = {};
  let inVars = false;
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (t.startsWith('[')) { inVars = t === '[vars]'; continue; }
    const m = inVars && /^([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(t);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

/** Padrões das rotas COM Worker declaradas no TOML. */
export const parseTomlRoutes = (text) => [...String(text).matchAll(/^pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);

/** Rotas COM este Worker na zona, a partir da saída de `domain-move-routes.mjs plan` ("   <padrão> -> use-sul-widget"). */
export const parseLiveRoutes = (output, worker = 'use-sul-widget') =>
  [...String(output).matchAll(/^\s+(\S+) -> (\S+)\s*$/gm)].filter((m) => m[2] === worker).map((m) => m[1]);

/**
 * O que o release pode publicar, a partir do health público ATUAL, das variáveis/bindings da versão ativa (`parseVersionBindings`) e do TOML.
 * Saída: { ok, problems, deploy } — `deploy` traz as quatro variáveis do --var: as capturadas, com as features do tema acrescentadas na ordem do
 * registro (src/features.js), e o que conferir depois (`before`, `after`, `allowlistSize`, `scope`).
 */
export function planThemeRelease({ health, captured, tomlBindings, tomlVars, add = THEME_FEATURES }) {
  const problems = [];
  if (!health || typeof health !== 'object') return { ok: false, problems: ['health ilegível'], deploy: null };
  if (!captured || !captured.vars) return { ok: false, problems: ['variáveis da versão ativa ilegíveis (wrangler versions view)'], deploy: null };
  const { vars, bindings } = captured;
  if (vars.ENABLE_WIDGET !== 'true') problems.push(`ENABLE_WIDGET capturado = ${vars.ENABLE_WIDGET} (esperado true)`);
  const scope = vars.WIDGET_SCOPE_MODE;
  if (scope !== 'allowlist' && scope !== 'product-catalog') problems.push(`WIDGET_SCOPE_MODE capturado inválido: ${scope}`);
  const before = list(vars.WIDGET_FEATURES);
  const unknown = before.filter((f) => !FEATURE_NAMES.includes(f));
  if (unknown.length) problems.push(`features capturadas desconhecidas deste código: ${unknown.join(',')}`);
  if (new Set(before).size !== before.length) problems.push('features capturadas repetidas');
  const already = add.filter((f) => before.includes(f));
  if (already.length) problems.push(`já ligado em produção: ${already.join(',')} (nada a publicar)`);
  const after = FEATURE_NAMES.filter((f) => before.includes(f) || add.includes(f));
  if (after.join(',').length > MAX_FEATURES_LENGTH) problems.push(`WIDGET_FEATURES passaria de ${MAX_FEATURES_LENGTH} caracteres`);
  const allow = list(vars.WIDGET_ALLOWLIST);
  if (allow.length === 0 || allow.some((p) => !PRODUCT_PATH.test(p)) || new Set(allow).size !== allow.length) problems.push('WIDGET_ALLOWLIST capturada vazia, duplicada ou malformada');
  // As variáveis que NÃO vão por --var saem do TOML: têm de ser as mesmas da produção, e nenhuma variável da produção pode sumir.
  for (const [name, value] of Object.entries(tomlVars || {})) {
    if (DEPLOY_VARS.includes(name)) continue;
    if (vars[name] !== value) problems.push(`${name}: TOML "${value}" != produção "${vars[name] ?? '(ausente)'}"`);
  }
  for (const name of Object.keys(vars)) if (!DEPLOY_VARS.includes(name) && !(name in (tomlVars || {}))) problems.push(`${name} existe na produção e não no TOML (seria perdida)`);
  const captKv = (bindings || []).map((b) => b.name);
  if (!sameSet(captKv, tomlBindings || [])) problems.push(`bindings da versão ativa [${captKv.join(',')}] != TOML [${(tomlBindings || []).join(',')}]`);
  // O health público descreve a MESMA configuração (a captura não pode estar velha nem ser de outra versão).
  if (health.service !== 'use-sul-widget') problems.push('health: service inesperado');
  if (health.widget_mode !== 'true') problems.push('health: widget_mode != true');
  if (health.features_status !== 'ok') problems.push('health: features_status != ok');
  if (!sameSet(Array.isArray(health.widget_features) ? health.widget_features : [], before)) problems.push('health: features diferentes das capturadas');
  if (health.scope_mode !== scope) problems.push(`health: escopo ${health.scope_mode} != capturado ${scope}`);
  if (health.allowlist_size !== allow.length) problems.push(`health: allowlist ${health.allowlist_size} != capturada ${allow.length}`);
  if (problems.length) return { ok: false, problems, deploy: null };
  return { ok: true, problems: [], deploy: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: allow.join(','), WIDGET_FEATURES: after.join(','), WIDGET_SCOPE_MODE: scope, before, after, added: add, allowlistSize: allow.length } };
}

/** Depois do deploy: as features são as de antes MAIS as do tema, e nada mais mudou (modo, escopo, allowlist, domínio, regiões). */
export function sameThemeConfig(before, after, added = THEME_FEATURES) {
  if (!before || !after) return false;
  const want = [...(before.widget_features || []), ...added];
  return after.widget_mode === before.widget_mode && after.scope_mode === before.scope_mode && after.allowlist_size === before.allowlist_size &&
    after.ink_host === before.ink_host && JSON.stringify(after.served_regions) === JSON.stringify(before.served_regions) &&
    sameSet(Array.isArray(after.widget_features) ? after.widget_features : [], want);
}

/**
 * Smoke de uma página de produto com o tema: o <body> sinaliza a PDP, o CSS do tema é pedido pelo Worker, há UM loader. `css` = a resposta do CSS
 * ({ status, type, body }), quando já buscada. Retorna { ok, problems, cssPath }.
 */
export function evaluateThemePage(html, css) {
  const problems = [];
  const text = String(html || '');
  const loaders = (text.match(/\/__origens\/loader\.js\?v=/g) || []).length;
  if (loaders !== 1) problems.push(`loaders na página: ${loaders} (esperado 1)`);
  const signal = /<body[^>]*\sdata-origens-theme="([^"]*)"/.exec(text);
  if (!signal || !signal[1].split(/\s+/).includes('pdp')) problems.push('o <body> não sinaliza o tema da PDP (data-origens-theme)');
  const link = /href="(\/__origens\/theme\.css\?[^"]+)"/.exec(text);
  if (!link) problems.push('sem o <link> do CSS do tema');
  if (css) {
    if (css.status !== 200) problems.push(`CSS do tema: HTTP ${css.status}`);
    if (!/text\/css/.test(css.type || '')) problems.push(`CSS do tema: tipo ${css.type}`);
    if (!/body\[data-origens-theme/.test(css.body || '')) problems.push('CSS do tema sem as regras do tema');
  }
  return { ok: problems.length === 0, problems, cssPath: link ? link[1].replace(/&amp;/g, '&') : null };
}

// ── Checkout: as DUAS rotas da zona que trazem as telas do checkout ao Worker (docs/tema-fluxo-ink.md) ─────────────────────────────────────────────
// Só as telas de documento (contato/entrega e pagamento), mais específicas que a exclusão `<host><base>/*` (sem Worker). Os envios do checkout
// (buyer, shipping_address, process_payment, payment_discount), o carrinho e o login continuam na exclusão: direto na INK.
// E a confirmação do pedido (payment_confirmation/<pedido>/<pagamento>, só GET de documento): o mesmo tema, a mesma feature.
export const checkoutRoutes = (host, base) => [`${host}${base}/checkout/contact_and_shipping_details*`, `${host}${base}/checkout/payment_methods*`, `${host}${base}/payment_confirmation/*`];
// Conta (theme-account): a TELA do login (o padrão não casa com o POST /store_sessions) e Trocas e devoluções. Pedidos, rastreio e avaliação já vêm pela rota de pedidos.
export const accountRoutes = (host, base) => [`${host}${base}/store_sessions/new*`, `${host}${base}/exchanges_and_returns*`];
/** As rotas de tema por grupo (o release pode criar um grupo inteiro com o deploy e o rollback o apaga). */
export const themeRouteGroups = (host, base) => ({ checkout: checkoutRoutes(host, base), account: accountRoutes(host, base) });

/**
 * O estado das rotas do checkout num host, a partir das rotas da zona ([{ pattern, script }]). `problems` = o que impede criar/manter as duas com
 * segurança: a exclusão ausente, ou qualquer OUTRA rota com Worker no caminho da compra ou do login.
 */
export function checkoutRoutesState(routes, { host, base, worker, group = 'checkout' }) {
  const ours = (routes || []).filter((r) => r && typeof r.pattern === 'string' && r.pattern.startsWith(host + '/'));
  const groups = themeRouteGroups(host, base);
  const wanted = groups[group];
  // Autorizadas no caminho da compra/login: as rotas de tema de TODOS os grupos (as do checkout não são problema para a conta, e vice-versa).
  const authorized = Object.values(groups).flat();
  const have = wanted.filter((p) => ours.some((r) => r.pattern === p && r.script === worker));
  const problems = [];
  if (!ours.some((r) => r.pattern === `${host}${base}/*` && !r.script)) problems.push(`falta a exclusão ${host}${base}/* (sem Worker): sem ela o Worker ficaria no caminho da compra`);
  for (const r of ours) {
    if (!r.script || authorized.includes(r.pattern)) continue;
    if (/\/(checkout|cart|store_sessions|login|sign_in)/.test(r.pattern)) problems.push(`rota com Worker no caminho da compra/login fora das autorizadas: ${r.pattern}`);
  }
  for (const p of wanted) { const r = ours.find((x) => x.pattern === p); if (r && r.script !== worker) problems.push(`${p} aponta para ${r.script || '(sem Worker)'}, não para ${worker}`); }
  return { wanted, have, missing: wanted.filter((p) => !have.includes(p)), problems };
}

/** As sondas de execução do checkout: as duas telas EXECUTAM; os envios, o checkout sem tela, o carrinho e o login NÃO. Só GET (ver tail-probe.mjs). */
export function checkoutProbeSet(base) {
  const id = '00000000-0000-4000-8000-000000000000';
  return [
    { url: `${base}/checkout/contact_and_shipping_details/${id}`, exec: true },
    { url: `${base}/checkout/payment_methods/${id}`, exec: true },
    { url: `${base}/payment_confirmation/0/0`, exec: true },
    { url: `${base}/checkout/buyer/${id}`, exec: false },
    { url: `${base}/checkout/shipping_address/${id}`, exec: false },
    { url: `${base}/checkout/process_payment`, exec: false },
    { url: `${base}/checkout/payment_discount/${id}`, exec: false },
    { url: `${base}/checkout`, exec: false },
    { url: `${base}/cart`, exec: false },
    { url: `${base}/store_sessions/new`, exec: false },
    { url: `${base}/product/serra-catarinense`, exec: true },
  ];
}

/** As sondas de execução da conta: a tela do login e trocas EXECUTAM (e os pedidos, que já executavam); o POST do login e outros caminhos de sessão, o carrinho e o checkout NÃO. */
export function accountProbeSet(base) {
  return [
    { url: `${base}/store_sessions/new`, exec: true },
    { url: `${base}/exchanges_and_returns`, exec: true },
    { url: `${base}/orders/trackings`, exec: true },
    { url: `${base}/store_sessions`, exec: false },
    { url: `${base}/store_sessions/0`, exec: false },
    { url: `${base}/cart`, exec: false },
    { url: `${base}/checkout`, exec: false },
  ];
}

/**
 * Smoke de uma página de conta com o tema. `kind`: 'login' (só CSS: o <body> sinaliza a conta, o <link> pede só a conta, NENHUM loader e, com `home`, o "Voltar"
 * e o símbolo levam à home do storefront) ou 'shell' (a conta junto com a PDP e o carrinho, UM loader).
 */
export function evaluateAccountPage(html, { kind, home = null }) {
  const problems = [];
  const text = String(html || '');
  const loaders = (text.match(/\/__origens\/loader\.js\?v=/g) || []).length;
  const signal = /<body[^>]*\sdata-origens-theme="([^"]*)"/.exec(text);
  if (!signal || !signal[1].split(/\s+/).includes('account')) problems.push('o <body> não sinaliza o tema da conta');
  if (kind === 'login') {
    if (loaders !== 0) problems.push(`loaders no login: ${loaders} (esperado nenhum)`);
    if (!/href="\/__origens\/theme\.css\?s=account&(amp;)?v=/.test(text)) problems.push('sem o <link> do CSS do tema da conta');
    if (home && !text.includes(`href="${home}"`)) problems.push('o "Voltar"/símbolo não leva à home do storefront');
  } else {
    if (loaders !== 1) problems.push(`loaders na página: ${loaders} (esperado 1)`);
    if (!/href="\/__origens\/theme\.css\?s=[a-z,]*account&(amp;)?v=/.test(text)) problems.push('sem o <link> do CSS com a conta');
  }
  return { ok: problems.length === 0, problems };
}

/** Smoke de uma tela do checkout com o tema: o <body> sinaliza o checkout, o <link> pede só a superfície do checkout, e NENHUM loader (o checkout nunca recebe JS nosso). */
export function evaluateCheckoutPage(html) {
  const problems = [];
  const text = String(html || '');
  const loaders = (text.match(/\/__origens\/loader\.js\?v=/g) || []).length;
  if (loaders !== 0) problems.push(`loaders no checkout: ${loaders} (esperado nenhum)`);
  const signal = /<body[^>]*\sdata-origens-theme="([^"]*)"/.exec(text);
  if (!signal || !signal[1].split(/\s+/).includes('checkout')) problems.push('o <body> não sinaliza o tema do checkout');
  if (!/href="\/__origens\/theme\.css\?s=checkout&(amp;)?v=/.test(text)) problems.push('sem o <link> do CSS do tema do checkout');
  return { ok: problems.length === 0, problems };
}

/**
 * Smoke da faixa do topo (`top-bar`): o que a INK serve em /__origens/top-bar tem de ser a faixa publicada no storefront (/api/top-bar/<região>), as
 * mesmas mensagens, na mesma ordem, o mesmo estilo e as mesmas cores; e o loader da página tem de trazer o módulo da faixa. `ink` e `site` são os JSON
 * já lidos (ou null); `loader` é o texto do loader.js. Retorna { ok, problems, messages }.
 */
/**
 * Smoke do assistente (`assistant`): o que a INK serve em /__origens/assistente tem de ser a abertura publicada no storefront (/api/assistente/<região>):
 * ligado, o mesmo texto, as mesmas sugestões e o mesmo atalho do WhatsApp; e o loader da página tem de trazer o módulo. `ink` e `site` são os JSON já
 * lidos (ou null); `loader` é o texto do loader.js. Retorna { ok, problems, opening }.
 */
export function evaluateAssistant(ink, site, loader) {
  const problems = [];
  if (!site || site.v !== 1 || site.enabled !== true || !site.opening) problems.push('o storefront não publica o assistente ligado (Atendimento › Assistente: ligar e Publicar)');
  if (!ink || ink.v !== 1 || ink.enabled !== true || !ink.opening) problems.push('/__origens/assistente não respondeu a abertura v1 ligada (a feature não está no ar?)');
  else if (site && site.opening) {
    if (ink.opening.text !== site.opening.text) problems.push(`abertura diferente: INK ${JSON.stringify(ink.opening.text)} x storefront ${JSON.stringify(site.opening.text)}`);
    if (JSON.stringify(ink.opening.suggestions ?? []) !== JSON.stringify(site.opening.suggestions ?? [])) problems.push('sugestões da abertura diferentes das do storefront');
    if ((ink.whatsapp ?? null) !== (site.whatsapp ?? null)) problems.push(`atalho do WhatsApp diferente: INK ${ink.whatsapp ?? 'nenhum'} x storefront ${site.whatsapp ?? 'nenhum'}`);
  }
  if (!String(loader || '').includes('/__origens/assistente')) problems.push('o loader.js não traz o módulo do assistente');
  return { ok: problems.length === 0, problems, opening: ink?.opening?.text ?? null };
}

export function evaluateTopBar(ink, site, loader) {
  const problems = [];
  const texts = (p) => (Array.isArray(p?.messages) ? p.messages.map((m) => String(m?.text ?? '')) : []);
  if (!site || site.v !== 1 || texts(site).length === 0) problems.push('o storefront não tem faixa publicada (sem mensagem no ar, a INK fica com as frases dela)');
  if (!ink || ink.v !== 1) problems.push('/__origens/top-bar não respondeu o contrato v1 (a feature não está no ar?)');
  else if (site) {
    if (JSON.stringify(texts(ink)) !== JSON.stringify(texts(site))) problems.push(`mensagens diferentes: INK ${JSON.stringify(texts(ink))} x storefront ${JSON.stringify(texts(site))}`);
    if ((ink.style ?? 'marquee') !== (site.style ?? 'marquee')) problems.push(`estilo diferente: INK ${ink.style} x storefront ${site.style}`);
    if (JSON.stringify(ink.colors ?? null) !== JSON.stringify(site.colors ?? null)) problems.push(`cores diferentes: INK ${JSON.stringify(ink.colors ?? null)} x storefront ${JSON.stringify(site.colors ?? null)}`);
  }
  if (!String(loader || '').includes('/__origens/top-bar')) problems.push('o loader.js não traz o módulo da faixa');
  return { ok: problems.length === 0, problems, messages: texts(ink) };
}
