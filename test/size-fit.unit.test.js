import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIZE_FIT_TABLES, SIZE_FIT_CALC } from '../src/loader/size-fit.js';

// Cálculo do "Informar medidas" (puro): as funções do bundle avaliadas fora do navegador.
const calc = new Function(SIZE_FIT_TABLES + SIZE_FIT_CALC + 'return { FIT_TABLES, fitCompare, fitTablesFor, fitPick, fitReadCm, fitDiff };')();
const table = (id) => calc.FIT_TABLES.find((t) => t.id === id);
const IMG = 'https://gcp-images.majestic.ink.rsvcloud.com/images/size_table/';

test('tables: same numbers as the storefront size guide (useorigens size-guides.ts), every row complete, width/length columns exist', () => {
  for (const t of calc.FIT_TABLES) {
    assert.ok(t.cols.some((c) => c[0] === t.width), t.id + ' width column');
    assert.ok(t.cols.some((c) => c[0] === t.len), t.id + ' length column');
    for (const row of t.rows) assert.equal(row[1].length, t.cols.length, t.id + ' ' + row[0]);
    assert.equal(t.imgs.length, 2);
    for (const h of t.imgs) assert.match(h, /^[0-9a-f]{32}$/);
  }
  const all = calc.FIT_TABLES.flatMap((t) => t.imgs);
  assert.equal(new Set(all).size, all.length, 'one image = one table');
  // Conferência cruzada com o storefront, quando o repositório irmão estiver disponível na máquina.
  let source = null;
  try { source = readFileSync(new URL('../../useorigens/src/lib/catalog/size-guides.ts', import.meta.url), 'utf8'); } catch (_) { /* fora da máquina do dono */ }
  if (source) for (const t of calc.FIT_TABLES) for (const h of t.imgs) assert.ok(source.includes(h), t.id + ' image ' + h + ' is in the storefront guide');
  assert.deepEqual(table('camiseta-classica').rows.find((r) => r[0] === 'GG')[1], [75, 59, 51.5, 22.5]);
});

test('identifies the piece by the official modal images (desktop or phone) and picks by the checked model', () => {
  const tables = calc.fitTablesFor([IMG + '3de43729fffae4430d4faf5dd1defed1.webp', IMG + '250d955bb3d4db4a1d213e34cadf56fc.webp', IMG + '84fe6b2adfc72123a5bc913f13e5b756.webp', 'https://x/other.webp']);
  assert.deepEqual(tables.map((t) => t.id), ['camiseta-classica', 'camiseta-baby-look']);
  assert.equal(calc.fitPick(tables, 'Feminino').id, 'camiseta-baby-look');
  assert.equal(calc.fitPick(tables, 'Masculino').id, 'camiseta-classica');
  assert.equal(calc.fitPick(tables, null), null, 'two models, none checked: ask');
  assert.equal(calc.fitPick(calc.fitTablesFor([IMG + '309bc4b433725b84f5903e7154d2e94c.webp']), null).id, 'oversized');
  assert.deepEqual(calc.fitTablesFor([IMG + '7c28ff77ab96e626e016a462cef00ab2.webp']), [], 'kids table: no comparison (the guide stays)');
  assert.deepEqual(calc.fitTablesFor([IMG + '00000000000000000000000000000000.webp']), [], 'an unknown (replaced) image: nothing');
});

test('closest size by width; length breaks ties; alternative within 1 cm; differences in cm', () => {
  const r = calc.fitCompare(table('camiseta-classica'), { width: '54', length: '72' });
  assert.equal(r.ok, true);
  assert.equal(r.main.size, 'M');
  assert.equal(r.main.dWidth, 0);
  assert.equal(r.alt, null);
  const near = calc.fitCompare(table('camiseta-classica'), { width: '55,5' });
  assert.equal(near.main.size, 'G');
  assert.equal(near.alt.size, 'M');
  assert.equal(near.tie, false);
  const tie = calc.fitCompare(table('camiseta-classica'), { width: '55' });
  assert.equal(tie.tie, true);
  assert.deepEqual([tie.main.size, tie.alt.size].sort(), ['G', 'M']);
  const byLength = calc.fitCompare(table('camiseta-classica'), { width: '55', length: '74' });
  assert.equal(byLength.main.size, 'G', 'same width distance: the length decides');
  assert.equal(byLength.tie, false);
  assert.equal(calc.fitDiff(-1.5), '1,5 cm a menos');
  assert.equal(calc.fitDiff(2), '2 cm a mais');
  assert.equal(calc.fitDiff(0), 'igual');
});

test('validation: empty, text, millimetres, a full circumference, too small, length out of range', () => {
  const t = table('camiseta-classica');
  const msg = (input) => calc.fitCompare(t, input).errors.map((e) => e.field + ':' + e.message);
  assert.match(msg({ width: '' })[0], /^width:Informe a largura/);
  assert.match(msg({ width: 'abc' })[0], /^width:Use só números/);
  assert.match(msg({ width: '530' })[0], /milímetros/);
  assert.match(msg({ width: '104' })[0], /volta inteira do peito.*52 cm/);
  assert.match(msg({ width: '20' })[0], /pequeno/);
  assert.match(msg({ width: '54', length: '20' })[0], /^length:Meça do ponto mais alto/);
  assert.equal(calc.fitReadCm(' 53,5 cm '), 53.5);
  assert.equal(calc.fitCompare(t, { width: '53 cm', length: '' }).ok, true, 'length is optional');
});

test('out of range is said plainly (beyond the table tolerance)', () => {
  const big = calc.fitCompare(table('camiseta-baby-look'), { width: '60' });
  assert.equal(big.main.size, '3G');
  assert.match(big.outOfRange, /Nenhum tamanho desta peça chega a 60 cm.*3G, tem 55 cm/);
  const small = calc.fitCompare(table('camiseta-classica'), { width: '45' });
  assert.match(small.outOfRange, /tão estreito.*P, tem 52 cm/);
  assert.equal(calc.fitCompare(table('camiseta-classica'), { width: '73' }).outOfRange, null, 'within ±2 cm of 4G');
});
