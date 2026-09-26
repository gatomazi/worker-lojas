// Funções puras do release global (testadas em test/release-scripts.test.js; sem rede, sem Wrangler, sem Cloudflare).
export const SIX_FEATURES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery'];
// A sétima feature entra SÓ no release da navbar (scripts/release-navbar.sh): as seis acima continuam obrigatórias em qualquer estado.
export const NAVBAR_FEATURE = 'header-nav';
export const SEVEN_FEATURES = [...SIX_FEATURES, NAVBAR_FEATURE];
export const FIVE_SLUGS = ['serra-catarinense', 'made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241', 'made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829', 'paranaense-essencia', 'made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a'];

// Versão ativa (100%) a partir da saída de `wrangler deployments list` (--json ou texto). null se não der para determinar.
export function parseActiveVersion(output) {
  const text = String(output || '');
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : (parsed.deployments || parsed.result || []);
    const sorted = [...list].sort((a, b) => new Date(b.created_on || b.created || 0) - new Date(a.created_on || a.created || 0));
    for (const dep of sorted) {
      const versions = dep.versions || [];
      const full = versions.find((v) => Number(v.percentage) === 100) || (versions.length === 1 ? versions[0] : null);
      const id = full && (full.version_id || full.id);
      if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) return id;
    }
  } catch (_) { /* cai no texto */ }
  const ids = [...text.matchAll(/Version\(s\):\s+\(100%\)\s+([0-9a-f-]{36})/g)].map((m) => m[1]);
  return ids.length ? ids[ids.length - 1] : null; // o texto lista do mais antigo para o mais novo
}

// O health está no estado esperado? expect: "allowlist" (cinco produtos) | "catalog". Retorna { ok, problems[] }.
// `features`: o conjunto EXATO esperado (padrão: as seis; o release da navbar passa as sete). `allowlistSize`: o tamanho capturado (padrão 5).
export function evaluateHealth(health, expect, { loaderVersion = null, features: expected = SIX_FEATURES, allowlistSize = 5 } = {}) {
  const problems = [];
  if (!health || typeof health !== 'object') return { ok: false, problems: ['health ilegível'] };
  if (health.service !== 'use-sul-widget') problems.push('service inesperado');
  if (health.widget_mode !== 'true') problems.push('widget_mode != true');
  if (health.allowlist_status !== 'ok' || health.allowlist_size !== allowlistSize) problems.push(`allowlist ${health.allowlist_status}/${health.allowlist_size} (esperado ok/${allowlistSize})`);
  if (health.features_status !== 'ok') problems.push('features_status != ok');
  const features = Array.isArray(health.widget_features) ? health.widget_features : [];
  for (const f of expected) if (!features.includes(f)) problems.push('feature ausente: ' + f);
  for (const f of features) if (!expected.includes(f)) problems.push('feature inesperada: ' + f); // nunca uma feature a mais por acidente
  if (features.length !== expected.length) problems.push(`número de features != ${expected.length}`);
  const scope = health.scope_mode === undefined ? 'allowlist' : health.scope_mode; // versão anterior não informa o modo = cinco produtos
  const want = expect === 'catalog' ? 'product-catalog' : 'allowlist';
  if (scope !== want) problems.push(`scope_mode ${scope} (esperado ${want})`);
  if (health.scope_status !== undefined && health.scope_status === 'invalid') problems.push('scope_status invalid');
  if (loaderVersion && health.version !== loaderVersion) problems.push(`version ${health.version} (esperado ${loaderVersion})`);
  return { ok: problems.length === 0, problems };
}

// Dois health descrevem a MESMA configuração de escopo/features? (usado para confirmar o rollback)
export function sameConfig(a, b) {
  const scope = (h) => (h && h.scope_mode === undefined ? 'allowlist' : h && h.scope_mode);
  return !!a && !!b && a.widget_mode === b.widget_mode && a.allowlist_size === b.allowlist_size && scope(a) === scope(b) && JSON.stringify(a.widget_features) === JSON.stringify(b.widget_features) && a.version === b.version;
}

// Contagem de loaders no HTML (tag injetada pelo Worker).
export const countLoaders = (html) => (String(html).match(/\/__origens\/loader\.js\?v=/g) || []).length;

// ── captura da configuração REAL de produção para o release da navbar ────────────────────────────────────────────────────────────────────
// `wrangler versions view <id> --name <worker> --json` traz os bindings da versão ativa: variáveis (plain_text) e KV. Procura o array `bindings`
// em qualquer nível do JSON (o formato da API muda entre versões do Wrangler) e NÃO adivinha: sem bindings legíveis => null e o release para.
export function parseVersionBindings(output) {
  let parsed; try { parsed = JSON.parse(String(output || '')); } catch (_) { return null; }
  const find = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node.bindings) && node.bindings.every((b) => b && typeof b === 'object' && typeof b.name === 'string')) return node.bindings;
    for (const value of Object.values(node)) { const hit = find(value, depth + 1); if (hit) return hit; }
    return null;
  };
  const list = find(parsed);
  if (!list) return null;
  const vars = {}; const others = [];
  for (const b of list) {
    if (b.type === 'plain_text') { const v = b.text !== undefined ? b.text : b.value; if (typeof v === 'string') vars[b.name] = v; }
    else others.push({ type: String(b.type), name: b.name });
  }
  return { vars, bindings: others };
}

const SLUG_PATH = /^\/usesul\/product\/[a-z0-9][a-z0-9_-]{0,127}$/;
const sortedEq = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// Decide, SEM adivinhar, o que o release da navbar pode publicar. Entradas: o health público ATUAL, as variáveis/bindings da versão ativa e os
// nomes de binding do TOML. Saída: { ok, problems, deploy } — `deploy` preserva exatamente ENABLE_WIDGET, WIDGET_ALLOWLIST e WIDGET_SCOPE_MODE
// capturados e só acrescenta `header-nav` à lista de features (que TEM de ser exatamente as seis). Qualquer divergência entre o que a versão
// diz e o que o health público mostra é problema (a captura não é confiável).
export function planNavbarRelease({ health, captured, tomlBindings }) {
  const problems = [];
  if (!health || typeof health !== 'object') return { ok: false, problems: ['health ilegível'], deploy: null };
  if (!captured || !captured.vars) return { ok: false, problems: ['variáveis da versão ativa ilegíveis (wrangler versions view)'], deploy: null };
  const { vars, bindings } = captured;
  if (vars.ENABLE_WIDGET !== 'true') problems.push(`ENABLE_WIDGET capturado = ${vars.ENABLE_WIDGET} (esperado true)`);
  const scope = vars.WIDGET_SCOPE_MODE === undefined ? 'allowlist' : vars.WIDGET_SCOPE_MODE;
  if (scope !== 'allowlist' && scope !== 'product-catalog') problems.push(`WIDGET_SCOPE_MODE capturado inválido: ${scope}`);
  const featureList = (vars.WIDGET_FEATURES || '').split(',').map((f) => f.trim()).filter(Boolean);
  if (featureList.includes(NAVBAR_FEATURE)) problems.push('header-nav JÁ está ativa em produção (nada a publicar)');
  else if (!sortedEq(featureList, SIX_FEATURES)) problems.push(`WIDGET_FEATURES capturado = "${featureList.join(',')}" (esperado exatamente as seis: ${SIX_FEATURES.join(',')})`);
  const allow = (vars.WIDGET_ALLOWLIST || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (allow.length === 0 || allow.some((p) => !SLUG_PATH.test(p)) || new Set(allow).size !== allow.length) problems.push('WIDGET_ALLOWLIST capturada vazia, duplicada ou malformada');
  // O health público tem de descrever a MESMA configuração (a captura não pode estar velha nem ser de outra versão).
  const h = evaluateHealth(health, scope === 'product-catalog' ? 'catalog' : 'allowlist', { allowlistSize: allow.length });
  if (!h.ok) problems.push(...h.problems.map((x) => 'health x captura: ' + x));
  // Bindings: o deploy publica o TOML; um binding a mais/menos em produção seria perdido/criado sem querer.
  const captKv = bindings.map((b) => b.name);
  if (!sortedEq(captKv, tomlBindings || [])) problems.push(`bindings da versão ativa [${captKv.join(',')}] != TOML [${(tomlBindings || []).join(',')}]`);
  if (problems.length) return { ok: false, problems, deploy: null };
  return { ok: true, problems: [], deploy: { ENABLE_WIDGET: 'true', WIDGET_ALLOWLIST: allow.join(','), WIDGET_SCOPE_MODE: scope, WIDGET_FEATURES: SEVEN_FEATURES.join(','), expect: scope === 'product-catalog' ? 'catalog' : 'allowlist', allowlistSize: allow.length } };
}

// Depois do deploy da navbar (ou do rollback), o health mostra a configuração planejada? `before` = health capturado antes.
export function sameNavbarConfig(before, after, { withNavbar }) {
  if (!before || !after) return false;
  const scope = (h) => (h.scope_mode === undefined ? 'allowlist' : h.scope_mode);
  const want = withNavbar ? SEVEN_FEATURES : SIX_FEATURES;
  return before.widget_mode === after.widget_mode && before.allowlist_size === after.allowlist_size && scope(before) === scope(after) && JSON.stringify(after.widget_features) === JSON.stringify(want) && (withNavbar ? true : before.version === after.version);
}
