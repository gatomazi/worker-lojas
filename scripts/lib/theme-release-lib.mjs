// Funções puras do release do TEMA DA COMPRA NA INK (scripts/release-tema.sh; testadas em test/theme-release.test.js; sem rede, sem Wrangler).
// O release liga `theme-pdp` e `theme-cart` no Worker da Sul PRESERVANDO tudo o que está em produção: as variáveis da versão ativa (escopo, allowlist,
// features, regiões, domínio), os bindings e as rotas. Nada é adivinhado: uma captura ilegível ou divergente do health público para o release.
import { FEATURE_NAMES } from '../../src/features.js';

/** O que este release liga. `theme-checkout` fica de fora: o Worker não tem rota no checkout (a exclusão da zona deixa compra e login com a INK). */
export const THEME_FEATURES = ['theme-pdp', 'theme-cart'];
/** As variáveis que o deploy passa por --var (o TOML é fail-closed nelas); as demais do TOML vão como estão e TÊM de ser iguais às da produção. */
export const DEPLOY_VARS = ['ENABLE_WIDGET', 'WIDGET_ALLOWLIST', 'WIDGET_FEATURES', 'WIDGET_SCOPE_MODE'];
const MAX_FEATURES_LENGTH = 260; // o mesmo teto de src/features.js parseFeatures
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
