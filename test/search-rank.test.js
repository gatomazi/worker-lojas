import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareCities, searchCities, normalizeText } from '../src/search-rank.js';
import { validateIndex } from '../src/search-gateway.js';

// Paridade com o storefront: os resultados esperados foram gerados pelo rank.ts REAL (scripts/gen-search-fixtures.mjs)
// sobre um snapshot real de GET https://useorigens.com.br/api/cidades/sul (1191 cidades PR/SC/RS).
const load = (name) => JSON.parse(readFileSync(new URL('./fixtures/search/' + name, import.meta.url), 'utf8'));
const index = load('cidades-sul.json');
const expected = load('expected.json');
const prepared = prepareCities(index);

test('the real index snapshot passes the gateway schema validation untouched', () => {
  const clean = validateIndex(index);
  assert.equal(clean.length, index.length);
  assert.equal(clean.length, expected.cities);
});

test('ranking parity with the storefront rank.ts for every recorded query', () => {
  assert.ok(expected.queries.length >= 40);
  for (const { q, results } of expected.queries) {
    const got = searchCities(prepared, q, { limit: 5 }).map((r) => (r.type === 'city'
      ? { type: 'city', n: r.city.n, u: r.city.u, s: r.city.s, score: r.score }
      : { type: 'state', uf: r.uf, name: r.name, score: r.score }));
    assert.deepEqual(got, results, 'query ' + JSON.stringify(q));
  }
});

test('behavior spot checks that matter to users (aliases, states, accents, no fuzzy)', () => {
  const top = (q) => searchCities(prepared, q, { limit: 5 })[0];
  assert.equal(top('floripa').city.n, 'Florianópolis');
  assert.equal(top('ctba').city.n, 'Curitiba');
  assert.equal(top('SC').name, 'Santa Catarina');
  assert.deepEqual(searchCities(prepared, 'xyzq', { limit: 5 }), []);
  assert.deepEqual(searchCities(prepared, '   ', { limit: 5 }), []);
  assert.equal(normalizeText("Sant'Ana  do Livramento!"), 'santana do livramento');
});
