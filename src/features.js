// WIDGET_FEATURES: módulos do loader liberados por deploy (não é flag de build). Fail-closed:
//   ausente           -> ["return-link"] (comportamento do piloto anterior; mantém compatibilidade)
//   "" (vazia)        -> [] (nenhum módulo)
//   nome desconhecido -> [] e status "invalid" (a lista INTEIRA é descartada)
// As features NÃO ampliam páginas: quem autoriza páginas continua sendo só WIDGET_ALLOWLIST (Worker e loader).
export const FEATURE_NAMES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav'];
export const DEFAULT_FEATURES = ['return-link'];

export function parseFeatures(raw) {
  if (raw === undefined || raw === null) return { status: 'default', features: [...DEFAULT_FEATURES] };
  if (typeof raw !== 'string' || raw.length > 200) return { status: 'invalid', features: [] };
  if (raw.trim() === '') return { status: 'empty', features: [] };
  const names = raw.split(',').map((name) => name.trim());
  if (!names.every((name) => FEATURE_NAMES.includes(name))) return { status: 'invalid', features: [] };
  return { status: 'ok', features: FEATURE_NAMES.filter((name) => names.includes(name)) };
}
