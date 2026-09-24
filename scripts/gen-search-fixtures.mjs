#!/usr/bin/env node
// Gera as fixtures de PARIDADE da busca executando o rank.ts REAL do storefront (somente leitura no outro repositório).
//   STOREFRONT_PATH=/Users/gtomazi/projects/useorigens node scripts/gen-search-fixtures.mjs
// - Copia rank.ts, text.ts e regions.ts para um diretório temporário e acrescenta ".ts" aos imports relativos
//   (o storefront usa resolução de bundler; o Node exige extensão). Nenhum arquivo do storefront é alterado.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.STOREFRONT_PATH || '/Users/gtomazi/projects/useorigens';
const tmp = mkdtempSync(join(tmpdir(), 'rank-'));
mkdirSync(join(tmp, 'search'), { recursive: true }); mkdirSync(join(tmp, 'geo'), { recursive: true });
const cp = (from, to) => writeFileSync(join(tmp, to), readFileSync(join(root, 'src/lib', from), 'utf8').replace(/from "(\.\.?\/[^"]+)"/g, 'from "$1.ts"'));
cp('search/rank.ts', 'search/rank.ts'); cp('geo/text.ts', 'geo/text.ts'); cp('geo/regions.ts', 'geo/regions.ts');
const rank = await import(join(tmp, 'search/rank.ts'));

const index = JSON.parse(readFileSync(new URL('../test/fixtures/search/cidades-sul.json', import.meta.url), 'utf8'));
const prepared = rank.prepareCities(index);
const queries = ['floripa', 'florianopolis', 'Florianópolis', 'FLORIANOPOLIS', 'ctba', 'curitiba', 'poa', 'porto alegre', 'foz', 'foz do iguacu', 'bc', 'caxias', 'sao', 'são', 'santa', 'santa maria', 'sc', 'rs', 'pr', 'SC', 'santa catarina', 'parana', 'paraná', 'rio grande', 'joinville', 'blumenau', 'gramado', 'torres', 'ijui', 'ijuí', 'agudos', 'do sul', 'nova', 'sao jose', "d'oeste", 'pato', 'xyzq', 'zz', 'a', 'ab', 'abc', '  curitiba  ', 'curitiba!!', 'tijucas', 'pomerode', 'pelotas'];
const out = queries.map((q) => ({
  q,
  results: rank.searchCities(prepared, q, { ufs: ['PR', 'SC', 'RS'], limit: 5 }).map((r) => (r.type === 'city' ? { type: 'city', n: r.city.n, u: r.city.u, s: r.city.s, score: r.score } : { type: 'state', uf: r.uf, name: r.name, score: r.score }))
}));
writeFileSync(new URL('../test/fixtures/search/expected.json', import.meta.url), JSON.stringify({ generatedFrom: 'useorigens-storefront src/lib/search/rank.ts (limit 5, ufs PR/SC/RS)', cities: index.length, queries: out }, null, 1));
console.log('queries', out.length, '| with results', out.filter((o) => o.results.length).length);
