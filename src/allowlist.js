// WIDGET_ALLOWLIST: lista de caminhos EXATOS de produto separados por vírgula.
//   "/usesul/product/serra-catarinense,/usesul/product/vida-no-sul-estancia-edition"
// Fail-closed: ausente, vazia ou com qualquer entrada malformada => nenhuma página é permitida.
// Sem curinga, sem prefixo, sem query string, sem barra final, sem maiúsculas, sem %-encoding.
export const MAX_ALLOWLIST_ENTRIES = 20;
const MAX_RAW_LENGTH = 2048;
const ENTRY = /^\/usesul\/product\/[a-z0-9][a-z0-9_-]{0,127}$/;

// status: "empty" (ausente/vazia), "ok", "invalid" (qualquer problema; a lista inteira é descartada).
export function parseAllowlist(raw) {
  if (raw === undefined || raw === null) return { status: 'empty', paths: [] };
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) return { status: 'invalid', paths: [] };
  if (raw.trim() === '') return { status: 'empty', paths: [] };

  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.length > MAX_ALLOWLIST_ENTRIES || !entries.every((entry) => ENTRY.test(entry))) {
    return { status: 'invalid', paths: [] };
  }
  return { status: 'ok', paths: [...new Set(entries)] };
}
