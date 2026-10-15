// size-fit: "Informar medidas" ao lado do "Guia de medidas" da página de produto. A pessoa mede uma peça que já veste bem (largura de axila a
// axila, comprimento opcional) e vê o tamanho DESTA peça com as medidas mais próximas, com a diferença em centímetros. Não estima nada por
// altura/peso e não escolhe sozinha: "Usar tamanho M" só clica no radio da própria INK depois do toque, e só se o tamanho existir e estiver
// disponível no modelo e na cor marcados. Sem tabela conhecida para a peça, o botão nem aparece. Só apresentação: nenhum formulário, carrinho,
// CSRF ou cookie é tocado; se algo falhar, a página nativa fica como está.
// Strings String.raw: nada de crase nem "${" aqui dentro (o bundle é concatenado e não é um template).

// TABELAS. As mesmas do "Guia de medidas" do storefront (useorigens: src/lib/catalog/size-guides.ts), transcritas valor a valor das imagens
// oficiais do modal "Confira suas medidas" da INK e conferidas em 2026-10-05. Nada inventado nem arredondado. Medidas da PEÇA estendida (larguras
// de um lado ao outro, não circunferência). A peça é reconhecida pela imagem que o modal oficial da INK mostra NESTA página (hash do arquivo em
// /images/size_table/, versão de computador e de celular): se a INK trocar a imagem, a tabela some e o botão não aparece (nunca números genéricos).
// `width`: a coluna comparada com a largura informada; `len`: a do comprimento. Peças infantis ficam de fora (a validação é de adulto): o botão
// não aparece e o "Guia de medidas" continua lá.
export const SIZE_FIT_TABLES = String.raw`
  const FIT_CLASSICA = [['P', [69, 52, 48, 19]], ['M', [72, 54, 49, 20]], ['G', [74, 56, 50, 21]], ['GG', [75, 59, 51.5, 22.5]], ['3G', [79, 64, 55.5, 23.5]], ['4G', [86, 72, 61, 25.5]]];
  const FIT_BABY = [['PP', [65, 41, 40, 36, 14]], ['P', [66, 43, 42, 37, 15]], ['M', [67, 45, 44, 38, 16]], ['G', [68, 47, 46, 39, 17]], ['GG', [69, 49, 48, 40, 18]], ['3G', [76.5, 55, 54, 44, 20]]];
  const FIT_COLS_MASC = [['comprimento', 'Comprimento'], ['abdomen', 'Abdômen'], ['ombro', 'Ombro'], ['manga', 'Manga']];
  const FIT_COLS_FEM = [['comprimento', 'Comprimento'], ['busto', 'Busto'], ['cintura', 'Cintura'], ['ombro', 'Ombro'], ['manga', 'Manga']];
  const FIT_COLS_SLIM = [['comprimento', 'Comprimento'], ['torax', 'Tórax'], ['manga', 'Manga']];
  const FIT_TABLES = [
    { id: 'camiseta-classica', name: 'Camiseta clássica (unissex)', model: 'Masculino', noun: 'camiseta', tol: 2, width: 'abdomen', len: 'comprimento', cols: FIT_COLS_MASC, rows: FIT_CLASSICA,
      imgs: ['84fe6b2adfc72123a5bc913f13e5b756', '3de43729fffae4430d4faf5dd1defed1'] },
    { id: 'camiseta-baby-look', name: 'Camiseta baby look (feminina)', model: 'Feminino', noun: 'camiseta', tol: 1, width: 'busto', len: 'comprimento', cols: FIT_COLS_FEM, rows: FIT_BABY,
      imgs: ['250d955bb3d4db4a1d213e34cadf56fc', '9c1ab7b24451dbe8454ad82398ce480d'] },
    { id: 'peruano-masculino', name: 'Camiseta Algodão Peruano (masculina)', model: 'Masculino', noun: 'camiseta', tol: 2, width: 'abdomen', len: 'comprimento', cols: FIT_COLS_MASC, rows: FIT_CLASSICA,
      imgs: ['93c4039b0ba5826c63f05d296ab5b1ff', 'c3467304d0731d0e9d30882164e13b45'],
      note: 'Nas cores verde musgo e oliva a modelagem é um pouco mais justa: a tabela oficial recomenda um tamanho acima do que você costuma usar.' },
    { id: 'peruano-feminino', name: 'Camiseta Algodão Peruano (feminina)', model: 'Feminino', noun: 'camiseta', tol: 1, width: 'busto', len: 'comprimento', cols: FIT_COLS_FEM, rows: FIT_BABY,
      imgs: ['8a196d5b04028c459e704a205f32688a', '098ab7086c1e607d5b186f51b5a05a10'] },
    { id: 'oversized', name: 'Camiseta oversized (unissex)', model: null, noun: 'camiseta', tol: 2, width: 'torax', len: 'comprimento',
      cols: [['comprimento', 'Comprimento'], ['manga', 'Manga'], ['torax', 'Tórax'], ['boca', 'Boca da manga']],
      rows: [['P', [73, 27, 60, 18.5]], ['M', [76, 28, 63, 19.5]], ['G', [79, 29, 67, 21]], ['GG', [82, 30, 71, 22.5]], ['3G', [85, 31, 75, 23.5]]],
      imgs: ['309bc4b433725b84f5903e7154d2e94c', '4de6b1ea033b0d7f966ca6ee4311ac81'],
      note: 'A oversized é larga de propósito. Se você mediu uma camiseta comum, o tamanho indicado tende a ser menor que o seu de sempre.' },
    { id: 'regata', name: 'Regata', model: null, noun: 'regata', tol: 1, width: 'abdomen', len: 'comprimento',
      cols: [['comprimento', 'Comprimento'], ['abdomen', 'Abdômen'], ['ombro', 'Ombro']],
      rows: [['P', [72, 51, 31]], ['M', [74, 53, 32]], ['G', [75, 55, 33]], ['GG', [76, 58, 36]], ['3G', [78, 62, 38]]],
      imgs: ['6b3b2c6187a441e2d0ef45c2b2e1b108', '862f7f37432bde2214a2f0509c5e5e02'] },
    { id: 'cropped', name: 'Cropped', model: null, noun: 'camiseta', tol: 1, width: 'busto', len: 'comprimento',
      cols: [['busto', 'Busto'], ['comprimento', 'Comprimento'], ['ombro', 'Ombro'], ['manga', 'Manga']],
      rows: [['PP', [51, 40, 43.5, 18]], ['P', [53, 41, 45.5, 19]], ['M', [55, 42, 47.5, 20]], ['G', [57, 43, 49.5, 21]], ['GG', [59, 44, 51.5, 22]]],
      imgs: ['5aae142b21dca104c1a489f9997dbf03', '7898071d887be98bdaed03d86ff415f2'] },
    { id: 'cropped-moletom', name: 'Cropped moletom', model: null, noun: 'moletom', tol: 1, width: 'busto', len: 'comprimento',
      cols: [['busto', 'Busto'], ['comprimento', 'Comprimento'], ['ombro', 'Ombro'], ['manga', 'Manga']],
      rows: [['PP', [50, 47, 53, 51]], ['P', [52, 48, 55, 52]], ['M', [54, 49, 57, 53]], ['G', [56, 50, 59, 54]], ['GG', [58, 51, 61, 55]]],
      imgs: ['fb672c56fc65b7ad70f25d74058537e5', '84eff0b71721f3c1bfbbb17cf4da5eae'] },
    { id: 'moletom-capuz', name: 'Moletom com capuz (Hoodie Slim)', model: null, noun: 'moletom', tol: 1, width: 'torax', len: 'comprimento', cols: FIT_COLS_SLIM,
      rows: [['PP', [67, 51, 65]], ['P', [69, 53, 66]], ['M', [71, 55, 67]], ['G', [73, 57, 68]], ['GG', [75, 59, 69]], ['3G', [77, 61, 70]]],
      imgs: ['e54f138be1ac03e8488a8289b60a9bd5', 'b045d3e0783dcedb8534df9b08c5dd02'] },
    { id: 'moletom-sueter', name: 'Moletom suéter (Suéter Slim)', model: null, noun: 'moletom', tol: 1, width: 'torax', len: 'comprimento', cols: FIT_COLS_SLIM,
      rows: [['PP', [68, 51, 66]], ['P', [70, 53, 67]], ['M', [72, 55, 68]], ['G', [74, 57, 69]], ['GG', [76, 59, 70]], ['3G', [78, 61, 71]]],
      imgs: ['fa46d82f524bc11b689e20ebae4d4f46', '047e86c4831bcaf1378e9b862db50c22'] }
  ];
`;

// CÁLCULO (puro, sem DOM): testado à parte (test/size-fit.unit.test.js). Porte de altura-trek/prototipo/src/modulos/medidas/calcular.ts.
export const SIZE_FIT_CALC = String.raw`
  function fitValue(table, row, key) { const i = table.cols.findIndex((c) => c[0] === key); return i < 0 ? null : (row[1][i] === undefined ? null : row[1][i]); }
  function fitReadCm(text) {
    const clean = String(text || '').trim().replace(/\s*cm$/i, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
  }
  const fitRound = (n) => Math.round(n * 10) / 10;
  function fitCheckWidth(text) {
    if (!String(text || '').trim()) return { field: 'width', message: 'Informe a largura de axila a axila, em centímetros.' };
    const v = fitReadCm(text);
    if (v === null) return { field: 'width', message: 'Use só números, em centímetros. Ex.: 53 ou 53,5.' };
    if (v >= 250) return { field: 'width', message: String(text).trim() + ' parece estar em milímetros. Informe em centímetros (ex.: 530 mm = 53 cm).' };
    if (v > 90) return { field: 'width', message: v + ' cm parece a volta inteira do peito. Meça só a frente da peça esticada, de uma axila à outra (ex.: ' + v + ' cm de volta ≈ ' + Math.round(v / 2) + ' cm).' };
    if (v < 30) return { field: 'width', message: 'Ficou pequeno para uma peça adulta. Confira se mediu de uma axila à outra, com a peça esticada.' };
    return v;
  }
  function fitCheckLength(text) {
    if (!String(text || '').trim()) return null;
    const v = fitReadCm(text);
    if (v === null) return { field: 'length', message: 'Use só números, em centímetros. Ex.: 72.' };
    if (v >= 250) return { field: 'length', message: 'Esse valor parece estar em milímetros. Informe em centímetros.' };
    if (v < 35 || v > 110) return { field: 'length', message: 'Meça do ponto mais alto do ombro até a barra, em centímetros (costuma ficar entre 40 e 90).' };
    return v;
  }
  // Mais próximo pela largura; o comprimento (se informado) desempata. Alternativa = a segunda, se estiver até 1 cm mais longe na largura.
  function fitCompare(table, input) {
    const W = fitCheckWidth(input.width);
    const L = fitCheckLength(input.length);
    const errors = [W, L].filter((x) => x !== null && typeof x === 'object');
    if (errors.length) return { ok: false, errors };
    const rows = table.rows.map((row) => {
      const w = fitValue(table, row, table.width);
      const l = fitValue(table, row, table.len);
      return { size: row[0], width: w, dWidth: fitRound(w - W), length: l, dLength: L === null || l === null ? null : fitRound(l - L) };
    });
    const order = rows.slice().sort((a, b) => Math.abs(a.dWidth) - Math.abs(b.dWidth) || Math.abs(a.dLength || 0) - Math.abs(b.dLength || 0));
    const main = order[0];
    const second = order[1];
    const alt = second && Math.abs(second.dWidth) - Math.abs(main.dWidth) <= 1 ? second : null;
    const widths = rows.map((r) => r.width);
    const biggest = rows[widths.indexOf(Math.max.apply(null, widths))];
    const smallest = rows[widths.indexOf(Math.min.apply(null, widths))];
    let outOfRange = null;
    if (W > biggest.width + table.tol) outOfRange = 'Nenhum tamanho desta peça chega a ' + fitCm(W) + ' de largura. O maior, ' + biggest.size + ', tem ' + fitCm(biggest.width) + '.';
    else if (W < smallest.width - table.tol) outOfRange = 'Nenhum tamanho desta peça é tão estreito. O menor, ' + smallest.size + ', tem ' + fitCm(smallest.width) + '.';
    const tie = !!alt && Math.abs(alt.dWidth) === Math.abs(main.dWidth) && (alt.dLength || 0) === (main.dLength || 0);
    return { ok: true, width: W, length: L, main, alt, tie, outOfRange };
  }
  function fitCm(n) { return String(n).replace('.', ',') + ' cm'; }
  function fitDiff(d) {
    if (d === 0) return 'igual';
    const v = String(Math.abs(d)).replace('.', ',');
    return d > 0 ? v + ' cm a mais' : v + ' cm a menos';
  }
  // Tabela da peça: as imagens do modal oficial desta página dizem quais tabelas valem; o modelo marcado (Masculino/Feminino) escolhe entre elas.
  // fitPick: com duas tabelas (masculina e feminina), só escolhe com o modelo marcado; sem ele, a pessoa escolhe antes de comparar.
  function fitTablesFor(imageSrcs) {
    const hashes = imageSrcs.map((src) => { const m = /\/images\/size_table\/([0-9a-f]{32})\.webp/.exec(src || ''); return m ? m[1] : null; }).filter(Boolean);
    const out = [];
    for (const h of hashes) { const t = FIT_TABLES.find((x) => x.imgs.includes(h)); if (t && !out.includes(t)) out.push(t); }
    return out;
  }
  function fitPick(tables, model) {
    if (tables.length === 1) return tables[0];
    return tables.find((t) => t.model && t.model === model) || null;
  }
`;

export const SIZE_FIT = String.raw`
  const FIT_ATTR = 'data-origens-fit';
  const FIT_ROW_ATTR = 'data-origens-fit-row';
  const FIT_STYLE_ID = 'o-fit-style';
  const FIT_DIALOG_ID = 'o-fit';
  const FIT_OPTIONS = '[data-controller~="ink-store--product--product-options"]';
  const FIT_OPT_ATTR = 'data-ink-store--product--product-options-';
  const FIT_LINKS = 'a#open-modal-size, a.form-product-options__size-modal-link';
  const FIT_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  const FIT_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8.5 3.5 4 6l1.6 4H8v10.5h8V10h2.4L20 6l-4.5-2.5c-.6 1.6-2 2.5-3.5 2.5s-2.9-.9-3.5-2.5Z"/><path d="M10 13.5h4M10 16h4"/></svg>';
  const FIT_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const FIT_SHIRT = '<svg viewBox="0 0 240 200" role="img" aria-label="Peça esticada: a largura é medida de uma axila à outra; o comprimento, do ombro até a barra."><path d="M84 14 Q120 36 156 14 L198 27 L232 64 L199 86 L186 74 L186 192 L54 192 L54 74 L41 86 L8 64 L42 27 Z" fill="#ececea" stroke="#1f2328" stroke-width="2.5" stroke-linejoin="round"/><g stroke="currentColor" stroke-width="2.5" fill="currentColor"><line x1="60" y1="84" x2="180" y2="84"/><path d="M58 84 l9 -6 v12 z M182 84 l-9 -6 v12 z" stroke="none"/><line x1="96" y1="22" x2="96" y2="186" stroke-dasharray="5 5"/><path d="M96 20 l-6 9 h12 z M96 188 l-6 -9 h12 z" stroke="none"/></g><text x="120" y="104" text-anchor="middle" font-size="13" font-weight="700" fill="#1f2328">largura</text><text x="104" y="150" font-size="13" font-weight="600" fill="#57606a">comprimento</text></svg>';
  // A linha junta o link de medidas da INK (já como "Guia de medidas" se size-guide estiver ligado) e o nosso botão: lado a lado, mesma altura.
  const FIT_CSS = [
    '[data-origens-fit-row]{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px;width:100%;margin:2px 0 12px}',
    '[data-origens-fit-row] > a{margin:0!important}',
    '[data-origens-fit-row] > a[data-origens-size]{flex:1 1 0;width:auto;min-width:0;padding:0 12px;font-size:14px}',
    '[data-origens-fit-row] > a[data-origens-size] .o-size-chevron{display:none}',
    '[data-origens-fit-row] > a:not([data-origens-size]){display:inline-flex;align-items:center}',
    'button[data-origens-fit]{--o-fit-tint:#1f2328;flex:1 1 0;display:inline-flex;align-items:center;gap:8px;min-width:0;min-height:46px;margin:0;padding:0 12px;box-sizing:border-box;',
    'border:1px solid rgba(31,35,40,.22);border-radius:10px;background:#f6f6f4;background:color-mix(in srgb,var(--o-fit-tint) 6%,#fff);color:#1f2328;',
    'font-family:inherit;font-size:14px;font-weight:500;line-height:1.2;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:border-color .15s ease,background-color .15s ease}',
    'button[data-origens-fit] svg{flex:none;color:var(--o-fit-tint)}',
    '@media (hover:hover){button[data-origens-fit]:hover{border-color:var(--o-fit-tint);background:color-mix(in srgb,var(--o-fit-tint) 11%,#fff)}}',
    'button[data-origens-fit]:focus-visible{outline:2px solid var(--o-fit-tint);outline-offset:2px}',
    '@media (max-width:359px){[data-origens-fit-row] > a,button[data-origens-fit]{flex-basis:100%}}',
    '@media (min-width:1024px){[data-origens-fit-row]{width:auto;align-self:flex-start}[data-origens-fit-row] > a[data-origens-size],button[data-origens-fit]{flex:0 0 auto;min-width:200px;padding:0 14px;font-size:15px}}',
    '#o-fit{position:fixed;top:0;bottom:0;left:0;width:var(--o-fit-vw,100%);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;font-family:inherit;color:#1f2328}',
    '#o-fit *{box-sizing:border-box}',
    '#o-fit .o-fit-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}',
    '#o-fit .o-fit-panel{position:relative;width:100%;max-width:480px;max-height:90vh;max-height:90dvh;overflow-y:auto;overscroll-behavior:contain;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.18)}',
    '@media (min-width:640px){#o-fit{align-items:center}#o-fit .o-fit-panel{border-radius:14px}}',
    '#o-fit .o-fit-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 10px 12px 20px;background:#fff;border-bottom:1px solid rgba(31,35,40,.12)}',
    '#o-fit h2{margin:0;font-size:18px;font-weight:600}',
    '#o-fit .o-fit-close{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:0;background:none;color:inherit;cursor:pointer}',
    '#o-fit .o-fit-body{display:grid;gap:12px;padding:16px 20px calc(22px + env(safe-area-inset-bottom))}',
    '#o-fit p{margin:0}',
    '#o-fit .o-fit-muted{font-size:14px;color:#57606a}',
    '#o-fit .o-fit-muted strong{color:#1f2328;font-weight:600}',
    '#o-fit .o-fit-lead{font-size:17px;font-weight:600;line-height:1.3}',
    '#o-fit .o-fit-swap{padding:10px 12px;border-radius:8px;background:#fdf3e7;font-size:14px}',
    '#o-fit figure{margin:0;display:grid;gap:6px;justify-items:center;padding:12px;border-radius:10px;background:#f6f6f4;color:var(--o-fit-tint)}',
    '#o-fit figure svg{width:190px;height:auto}',
    '#o-fit figcaption{font-size:13px;color:#57606a;text-align:center}',
    '#o-fit form{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}',
    '#o-fit .o-fit-field{display:grid;gap:6px;align-content:start}',
    '#o-fit label{font-size:14px;font-weight:600}',
    '#o-fit label span{font-weight:400;color:#57606a}',
    '#o-fit .o-fit-input{display:flex;align-items:center;gap:8px}',
    '#o-fit input{width:100%;min-width:0;height:48px;padding:0 12px;border:1px solid rgba(31,35,40,.35);border-radius:8px;font:inherit;font-size:17px;color:#1f2328;background:#fff}',
    '#o-fit input:focus-visible{outline:2px solid var(--o-fit-tint);outline-offset:1px}',
    '#o-fit input[aria-invalid="true"]{border-color:#b3261e}',
    '#o-fit .o-fit-help{font-size:12.5px;color:#57606a}',
    '#o-fit .o-fit-error{font-size:13px;color:#b3261e}',
    '#o-fit .o-fit-error:empty{display:none}',
    '#o-fit .o-fit-cta{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;border:0;border-radius:10px;background:var(--o-fit-tint);color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer}',
    '#o-fit form .o-fit-cta{grid-column:1 / -1;margin-top:6px}',
    '#o-fit .o-fit-cta.o-fit-sec{background:#fff;color:#1f2328;box-shadow:inset 0 0 0 1px rgba(31,35,40,.3)}',
    '#o-fit .o-fit-result{display:grid;gap:10px;padding:14px;border-radius:10px;background:#f6f6f4;background:color-mix(in srgb,var(--o-fit-tint) 7%,#fff)}',
    '#o-fit .o-fit-verdict{font-size:16px;line-height:1.4}',
    '#o-fit .o-fit-verdict:focus{outline:none}',
    '#o-fit .o-fit-verdict strong{font-size:20px}',
    '#o-fit table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:8px;overflow:hidden}',
    '#o-fit th,#o-fit td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(31,35,40,.1);vertical-align:top}',
    '#o-fit td small{display:block;font-size:12px;color:#57606a}',
    '#o-fit .o-fit-alert{padding:8px 10px;border-left:3px solid var(--o-fit-tint);background:#fff;font-size:13.5px}',
    '#o-fit .o-fit-note{font-size:12px;color:#57606a}',
    '#o-fit .o-fit-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '#o-fit .o-fit-status{font-size:14px;font-weight:600;color:#8a4b12}',
    '#o-fit .o-fit-status:empty{display:none}',
    '#o-fit .o-fit-link{min-height:44px;padding:0;border:0;background:none;color:#1f2328;font:inherit;font-size:14px;font-weight:500;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    '#o-fit .o-fit-foot{display:flex;flex-wrap:wrap;gap:0 18px}',
    '#o-fit .o-fit-models{display:flex;flex-wrap:wrap;gap:8px}',
    '#o-fit .o-fit-full{overflow-x:auto}',
    '#o-fit .o-fit-full table{font-size:13.5px}',
    '#o-fit .o-fit-full caption{text-align:left;font-size:12.5px;color:#57606a;padding-bottom:6px}',
    '#o-fit .o-fit-full th,#o-fit .o-fit-full td{white-space:nowrap}',
    '#o-fit button:focus-visible,#o-fit [tabindex="0"]:focus-visible{outline:2px solid var(--o-fit-tint);outline-offset:2px}'
  ].join('');

  function fitEl(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, attrs[key]);
    for (const child of children || []) if (child !== null && child !== undefined) node.append(child);
    return node;
  }
  // A PDP tem DOIS quadros de opções com o mesmo id (o da peça e o do "Compre Junto"): vale o do product_id do formulário principal.
  function fitOptions() {
    const input = document.querySelector(PDP_SCOPE + ' input#product_id');
    const id = input && input.value;
    const all = Array.from(document.querySelectorAll(FIT_OPTIONS)).filter((el) => el.closest(PDP_SCOPE) && !el.closest(PDP_OUTSIDE));
    if (id) { const own = all.find((el) => el.getAttribute(FIT_OPT_ATTR + 'id-value') === id); if (own) return own; }
    return all[0] || null;
  }
  function fitChecked(name) {
    const opts = fitOptions();
    const input = opts && opts.querySelector('input[name="' + name + '"]:checked');
    return input ? input.value : null;
  }
  function fitModels() {
    const opts = fitOptions();
    return opts ? Array.from(opts.querySelectorAll('input[name="style"]')).map((i) => i.value) : [];
  }
  function fitPageTables() {
    const imgs = Array.from(document.querySelectorAll('.modal-size-product img[src*="/images/size_table/"]')).filter((img) => !img.closest(PDP_OUTSIDE));
    return fitTablesFor(imgs.map((img) => img.getAttribute('src')));
  }
  // Modelos com tabela: só os que existem no seletor desta peça (o modal pode mostrar uma tabela que a peça não vende).
  function fitState() {
    const tables = fitPageTables();
    const models = fitModels();
    const withTable = tables.length > 1 ? models.filter((m) => tables.some((t) => t.model === m)) : [];
    const model = fitChecked('style');
    return { tables, models: withTable, model, table: fitPick(tables, model) };
  }
  // Tamanhos que existem e estão disponíveis no modelo e na cor marcados, na ordem do seletor da INK.
  function fitAvailable() {
    const opts = fitOptions();
    if (!opts) return [];
    const order = Array.from(opts.querySelectorAll('input[name="size"]')).map((i) => i.value);
    let variants = [];
    try { variants = JSON.parse(opts.getAttribute(FIT_OPT_ATTR + 'variants-value') || '[]'); } catch (_) { variants = []; }
    if (!Array.isArray(variants) || !variants.length) return order;
    const model = fitChecked('style'); const color = fitChecked('color');
    const ok = new Set(variants.filter((v) => v && v.is_available && (!model || v.model === model) && (!color || v.color === color)).map((v) => v.size));
    return order.filter((s) => ok.has(s));
  }
  function fitSelectSize(size) {
    const opts = fitOptions();
    const input = opts && Array.from(opts.querySelectorAll('input[name="size"]')).find((i) => i.value === size);
    if (!input) return false;
    input.click(); // o controller da própria INK reage (preço, estoque, botão de compra continuam dela)
    return true;
  }
  // Nome do modelo como a INK mostra no botão ("Clássica | Unissex"); o valor do radio ("Masculino") é só a reserva.
  function fitModelLabel(model) {
    const opts = fitOptions();
    const input = opts && Array.from(opts.querySelectorAll('input[name="style"]')).find((i) => i.value === model);
    const label = input && input.id ? opts.querySelector('label[for="' + input.id.replace(/"/g, '') + '"]') : null;
    const text = label ? label.textContent.replace(/\s+/g, ' ').trim() : '';
    return text || model;
  }
  function fitSelectModel(model) {
    const opts = fitOptions();
    const input = opts && Array.from(opts.querySelectorAll('input[name="style"]')).find((i) => i.value === model);
    if (input) input.click();
  }
  function fitLinks() {
    return Array.from(document.querySelectorAll(FIT_LINKS)).filter((link) => link.closest(PDP_SCOPE) && !link.closest(PDP_OUTSIDE));
  }
  function fitEnsureStyle() {
    if (document.getElementById(FIT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FIT_STYLE_ID;
    style.textContent = FIT_CSS;
    document.head.appendChild(style);
  }

  // Painel (um por vez). Estado da comparação sobrevive a fechar/abrir e à troca do quadro da variante.
  const fit = { input: { width: '', length: '' }, compared: null, swap: null, showTable: false, close: null, render: null, trigger: null };

  function fitClose() { if (fit.close) fit.close(); }
  function fitOpen(trigger) {
    fitClose();
    fit.trigger = trigger;
    pdpTrack('origens_size_fit_open', {});
    const root = fitEl('div', { id: FIT_DIALOG_ID, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'o-fit-title' });
    root.style.setProperty('--o-fit-tint', FIT_TINT);
    // A PDP nativa é mais larga que a tela no celular (drawer fora dela): o painel usa a largura VISÍVEL do documento, não inset:0.
    root.style.setProperty('--o-fit-vw', (document.documentElement.clientWidth || window.innerWidth) + 'px');
    const backdrop = fitEl('div', { class: 'o-fit-backdrop' });
    const close = fitEl('button', { type: 'button', class: 'o-fit-close', 'aria-label': 'Fechar' });
    close.innerHTML = FIT_CLOSE;
    const body = fitEl('div', { class: 'o-fit-body' });
    const panel = fitEl('div', { class: 'o-fit-panel' }, [fitEl('div', { class: 'o-fit-head' }, [fitEl('h2', { id: 'o-fit-title' }, ['Informar medidas']), close]), body]);
    root.append(backdrop, panel);
    document.body.appendChild(root);

    const ac = new AbortController();
    const done = () => {
      ac.abort(); root.remove(); fit.close = null; fit.render = null;
      const back = fit.trigger && fit.trigger.isConnected ? fit.trigger : document.querySelector('button[' + FIT_ATTR + ']');
      if (back) back.focus({ preventScroll: true });
    };
    fit.close = done;
    close.addEventListener('click', done, { signal: ac.signal });
    backdrop.addEventListener('click', done, { signal: ac.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); done(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll('button, input, a[href], [tabindex="0"]')).filter((x) => !x.disabled);
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, { capture: true, signal: ac.signal });
    fit.render = () => fitRender(body);
    fit.render();
    const first = body.querySelector('#o-fit-width, .o-fit-models button');
    (first || close).focus({ preventScroll: true });
  }

  function fitOriginalGuide() {
    const b = fitEl('button', { type: 'button', class: 'o-fit-link' }, ['Abrir guia oficial da loja']);
    b.addEventListener('click', () => { fitClose(); const link = fitLinks()[0]; if (link) link.click(); });
    return b;
  }

  function fitRender(body) {
    const st = fitState();
    if (!st.table && st.models.length > 1) {
      const group = fitEl('div', { class: 'o-fit-models', role: 'group', 'aria-label': 'Modelo' });
      for (const m of st.models) {
        const b = fitEl('button', { type: 'button', class: 'o-fit-cta o-fit-sec' }, [fitModelLabel(m)]);
        b.addEventListener('click', () => { fitSelectModel(m); if (fit.render) fit.render(); const next = body.querySelector('#o-fit-width'); if (next) next.focus({ preventScroll: true }); });
        group.append(b);
      }
      body.replaceChildren(fitEl('p', { class: 'o-fit-lead' }, ['Qual modelo você quer comparar?']), fitEl('p', { class: 'o-fit-muted' }, ['Esta peça tem modelagem masculina e feminina, com medidas diferentes.']), group);
      const firstModel = group.querySelector('button'); if (firstModel) firstModel.focus({ preventScroll: true });
      return;
    }
    const table = st.table;
    if (!table) { body.replaceChildren(fitEl('p', {}, ['Não encontramos a tabela desta peça. Use o guia oficial da loja.']), fitOriginalGuide()); return; }

    const parts = [fitEl('p', { class: 'o-fit-muted' }, ['Comparando com: ', fitEl('strong', {}, [table.name])])];
    if (fit.swap) parts.push(fitEl('p', { class: 'o-fit-swap', role: 'status' }, [fit.swap]));
    parts.push(fitEl('p', { class: 'o-fit-lead' }, ['Meça uma ' + (table.noun === 'moletom' ? 'peça' : table.noun) + ' que já veste bem em você.']));
    const fig = fitEl('figure', {});
    fig.innerHTML = FIT_SHIRT;
    fig.append(fitEl('figcaption', {}, ['Estique a peça numa mesa e meça a frente, de uma axila à outra.']));
    parts.push(fig);

    const width = fitEl('input', { id: 'o-fit-width', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'o-fit-width-err' });
    width.value = fit.input.width;
    const length = fitEl('input', { id: 'o-fit-length', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'o-fit-length-help o-fit-length-err' });
    length.value = fit.input.length;
    const widthErr = fitEl('p', { class: 'o-fit-error', id: 'o-fit-width-err' });
    const lengthErr = fitEl('p', { class: 'o-fit-error', id: 'o-fit-length-err' });
    const form = fitEl('form', { novalidate: '' }, [
      fitEl('div', { class: 'o-fit-field' }, [fitEl('label', { for: 'o-fit-width' }, ['Largura (cm)']), width, fitEl('p', { class: 'o-fit-help' }, ['De axila a axila.']), widthErr]),
      fitEl('div', { class: 'o-fit-field' }, [fitEl('label', { for: 'o-fit-length' }, ['Comprimento ', fitEl('span', {}, ['(opcional)'])]), length, fitEl('p', { class: 'o-fit-help', id: 'o-fit-length-help' }, ['Do ombro até a barra.']), lengthErr]),
      fitEl('button', { type: 'submit', class: 'o-fit-cta' }, ['Comparar'])
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      fit.input = { width: width.value, length: length.value };
      fit.compared = table.id; fit.swap = null;
      if (fit.render) fit.render();
      const target = body.querySelector('.o-fit-verdict, .o-fit-error:not(:empty)');
      if (target) target.focus({ preventScroll: false });
    });
    parts.push(form);

    if (fit.compared) {
      const r = fitCompare(table, fit.input);
      if (!r.ok) {
        for (const err of r.errors) {
          const pair = err.field === 'width' ? [width, widthErr] : [length, lengthErr];
          pair[0].setAttribute('aria-invalid', 'true');
          pair[1].textContent = err.message;
          pair[1].setAttribute('tabindex', '-1');
        }
      } else parts.push(fitResult(table, r));
    }

    const toggle = fitEl('button', { type: 'button', class: 'o-fit-link', 'aria-expanded': String(fit.showTable) }, [fit.showTable ? 'Esconder tabela completa' : 'Ver tabela completa']);
    toggle.addEventListener('click', () => { fit.input = { width: width.value, length: length.value }; fit.showTable = !fit.showTable; if (fit.render) fit.render(); });
    parts.push(fitEl('div', { class: 'o-fit-foot' }, [toggle, fitOriginalGuide()]));
    if (fit.showTable) parts.push(fitFullTable(table));
    body.replaceChildren.apply(body, parts);
  }

  function fitResult(table, r) {
    const options = [r.main, r.alt].filter(Boolean);
    const box = fitEl('div', { class: 'o-fit-result', 'aria-live': 'polite' });
    const verdict = fitEl('p', { class: 'o-fit-verdict', tabindex: '-1' });
    if (r.tie && r.alt) verdict.append('Os tamanhos ', fitEl('strong', {}, [r.main.size]), ' e ', fitEl('strong', {}, [r.alt.size]), ' ficam igualmente próximos da peça que você mediu.');
    else verdict.append('O tamanho ', fitEl('strong', {}, [r.main.size]), ' tem as medidas mais próximas da peça que você mediu.');
    box.append(verdict);
    const head = fitEl('tr', {}, [fitEl('th', { scope: 'col' }, ['Medida']), fitEl('th', { scope: 'col' }, ['A sua'])].concat(options.map((o) => fitEl('th', { scope: 'col' }, [o.size]))));
    const rowW = fitEl('tr', {}, [fitEl('th', { scope: 'row' }, ['Largura']), fitEl('td', {}, [fitCm(r.width)])].concat(options.map((o) => fitEl('td', {}, [fitCm(o.width), fitEl('small', {}, [fitDiff(o.dWidth)])]))));
    const tbody = fitEl('tbody', {}, [rowW]);
    if (r.length !== null) tbody.append(fitEl('tr', {}, [fitEl('th', { scope: 'row' }, ['Comprimento']), fitEl('td', {}, [fitCm(r.length)])].concat(options.map((o) => fitEl('td', {}, [o.length === null ? '—' : fitCm(o.length), fitEl('small', {}, [o.dLength === null ? '' : fitDiff(o.dLength)])])))));
    box.append(fitEl('table', {}, [fitEl('thead', {}, [head]), tbody]));
    if (r.alt) {
      const roomier = r.alt.width > r.main.width ? r.alt : r.main;
      box.append(fitEl('p', {}, [r.tie ? 'Se você gosta de mais folga, fique com o ' + roomier.size + '.' : 'O ' + r.alt.size + ' também fica perto. Se você gosta de mais folga, fique com o ' + roomier.size + '.']));
    }
    if (r.outOfRange) box.append(fitEl('p', { class: 'o-fit-alert' }, [r.outOfRange]));
    if (table.note) box.append(fitEl('p', { class: 'o-fit-alert' }, [table.note]));
    box.append(fitEl('p', { class: 'o-fit-note' }, ['Comparação entre medidas de peças, com a tolerância de ±' + table.tol + ' cm da tabela oficial. Não é garantia de caimento.']));
    const actions = fitEl('div', { class: 'o-fit-actions' });
    const status = fitEl('p', { class: 'o-fit-status', role: 'status' });
    options.forEach((o, i) => {
      const b = fitEl('button', { type: 'button', class: i === 0 ? 'o-fit-cta' : 'o-fit-cta o-fit-sec' }, ['Usar tamanho ' + o.size]);
      b.addEventListener('click', () => {
        if (!fitAvailable().includes(o.size)) { status.textContent = 'O ' + o.size + ' não está disponível nesta cor e modelo. Escolha outro tamanho no seletor da página.'; return; }
        if (!fitSelectSize(o.size)) { status.textContent = 'Não conseguimos marcar o ' + o.size + '. Escolha no seletor da página.'; return; }
        pdpTrack('origens_size_fit_use', { size: o.size, fit_table: table.id });
        fitClose();
      });
      actions.append(b);
    });
    const manual = fitEl('button', { type: 'button', class: 'o-fit-link' }, ['Escolher na página']);
    manual.addEventListener('click', fitClose);
    actions.append(manual);
    box.append(actions, status);
    if (fit.reported !== table.id + '|' + r.main.size + '|' + fit.input.width + '|' + fit.input.length) {
      fit.reported = table.id + '|' + r.main.size + '|' + fit.input.width + '|' + fit.input.length;
      pdpTrack('origens_size_fit_result', { size: r.main.size, fit_table: table.id });
    }
    return box;
  }

  function fitFullTable(table) {
    const t = fitEl('table', {}, [
      fitEl('caption', {}, [table.name + ' · medidas da peça em cm, tolerância ±' + table.tol + ' cm']),
      fitEl('thead', {}, [fitEl('tr', {}, [fitEl('th', { scope: 'col' }, ['Tam.'])].concat(table.cols.map((c) => fitEl('th', { scope: 'col' }, [c[1]]))))]),
      fitEl('tbody', {}, table.rows.map((row) => fitEl('tr', {}, [fitEl('th', { scope: 'row' }, [row[0]])].concat(row[1].map((v) => fitEl('td', {}, [String(v).replace('.', ',')]))))))
    ]);
    return fitEl('div', { class: 'o-fit-full', tabindex: '0', role: 'region', 'aria-label': 'Tabela completa' }, [t]);
  }

  // Monta a linha em volta do link nativo: o link é MOVIDO para dentro dela (mesmo nó, mesmo href e data-action da INK) e volta para o lugar
  // no unmount. O quadro da variante é lazy e volta a cada troca: um link novo ganha uma linha nova; o painel aberto continua e relê tudo.
  function fitDecorate(link) {
    const row = fitEl('div', { [FIT_ROW_ATTR]: '' });
    link.parentNode.insertBefore(row, link);
    row.appendChild(link);
    const button = fitEl('button', { type: 'button', [FIT_ATTR]: '', 'aria-haspopup': 'dialog' });
    button.style.setProperty('--o-fit-tint', FIT_TINT);
    button.innerHTML = FIT_ICON;
    button.append(fitEl('span', {}, ['Informar medidas']));
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); fitOpen(button); });
    row.appendChild(button);
  }
  function fitUndecorate(row) {
    const link = row.querySelector(':scope > a');
    if (link) row.parentNode.insertBefore(link, row);
    row.remove();
  }

  register({
    id: 'size-fit',
    ac: null,

    // Idempotente: só escreve quando há um link de medidas ainda sem a nossa linha e a peça tem tabela conhecida nesta página.
    mount() {
      const pending = fitLinks().filter((link) => !(link.parentElement && link.parentElement.hasAttribute(FIT_ROW_ATTR)));
      if (!pending.length) return;
      if (!fitPageTables().length) return;
      fitEnsureStyle();
      for (const link of pending) { try { fitDecorate(link); } catch (_) { /* o link nativo continua como veio */ } }
      if (!this.ac) {
        this.ac = new AbortController();
        // Troca de modelo na INK: a comparação feita passa a usar a tabela do novo modelo (e avisa).
        document.addEventListener('change', (event) => {
          if (!event.target || event.target.name !== 'style' || !fit.render) return;
          const table = fitState().table;
          if (fit.compared && table && table.id !== fit.compared) { fit.swap = 'Você trocou para ' + fitModelLabel(fitChecked('style')) + '. A comparação foi refeita com a tabela ' + table.name + '.'; fit.compared = table.id; }
          fit.render();
        }, { signal: this.ac.signal });
      }
    },

    unmount() {
      fitClose();
      if (this.ac) { this.ac.abort(); this.ac = null; }
      for (const row of document.querySelectorAll('[' + FIT_ROW_ATTR + ']')) { try { fitUndecorate(row); } catch (_) { /* idem */ } }
      const style = document.getElementById(FIT_STYLE_ID);
      if (style) style.remove();
      fit.input = { width: '', length: '' }; fit.compared = null; fit.swap = null; fit.showTable = false; fit.reported = null;
    }
  });
`;
