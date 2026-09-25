// Funções puras do release global (testadas em test/release-scripts.test.js; sem rede, sem Wrangler, sem Cloudflare).
export const SIX_FEATURES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery'];
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
export function evaluateHealth(health, expect, { loaderVersion = null } = {}) {
  const problems = [];
  if (!health || typeof health !== 'object') return { ok: false, problems: ['health ilegível'] };
  if (health.service !== 'use-sul-widget') problems.push('service inesperado');
  if (health.widget_mode !== 'true') problems.push('widget_mode != true');
  if (health.allowlist_status !== 'ok' || health.allowlist_size !== 5) problems.push(`allowlist ${health.allowlist_status}/${health.allowlist_size} (esperado ok/5)`);
  if (health.features_status !== 'ok') problems.push('features_status != ok');
  const features = Array.isArray(health.widget_features) ? health.widget_features : [];
  for (const f of SIX_FEATURES) if (!features.includes(f)) problems.push('feature ausente: ' + f);
  if (features.length !== SIX_FEATURES.length) problems.push('número de features != 6');
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
