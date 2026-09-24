// Port FIEL de useorigens-storefront: src/lib/search/rank.ts + src/lib/geo/text.ts (normalizeText) + STATE_NAMES.
// Sem regra nova: a paridade com o storefront é provada por test/search-rank.test.js contra resultados gerados pelo
// próprio rank.ts (scripts/gen-search-fixtures.mjs). Se o storefront mudar o ranking, regenerar as fixtures e ajustar aqui.
export const SUL_UFS = ['PR', 'SC', 'RS'];
const STATE_NAMES = { PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul' }; // só a região Sul está habilitada no storefront

export function normalizeText(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function prepareCities(cities) {
  return cities.map((city) => {
    const key = normalizeText(city.n);
    return { city, key, words: key.split(' '), aliases: (city.a ?? []).map(normalizeText) };
  });
}

function scoreCity(p, q) {
  if (p.key === q) return 100;
  if (p.aliases.includes(q)) return 95;
  if (p.key.startsWith(q)) return p.aliases.length > 0 ? 88 : 80;
  if (p.aliases.some((a) => a.startsWith(q))) return 75;
  if (q.length >= 2 && p.words.some((w) => w.startsWith(q))) return 55;
  if (q.length >= 3 && p.key.includes(q)) return 30;
  return 0;
}

export function searchCities(prepared, query, { ufs = SUL_UFS, limit = 8 } = {}) {
  const q = normalizeText(query);
  if (q.length === 0) return [];
  const allowed = new Set(ufs);
  const results = [];

  for (const [uf, name] of Object.entries(STATE_NAMES)) {
    if (!allowed.has(uf)) continue;
    const nameKey = normalizeText(name);
    const score = q.length === 2 && normalizeText(uf) === q ? 90 : q.length >= 3 && nameKey.startsWith(q) ? 60 : 0;
    if (score > 0) results.push({ type: 'state', uf, name, score });
  }
  for (const p of prepared) {
    if (!allowed.has(p.city.u)) continue;
    const score = scoreCity(p, q);
    if (score > 0) results.push({ type: 'city', city: p.city, score });
  }
  const label = (r) => (r.type === 'city' ? r.city.n : r.name);
  return results
    .sort((a, b) => b.score - a.score || label(a).length - label(b).length || label(a).localeCompare(label(b), 'pt-BR'))
    .slice(0, limit);
}

export { STATE_NAMES };
