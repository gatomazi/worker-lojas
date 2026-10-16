// DIREÇÃO DE ARTE em PRÉVIA: duas propostas de cor para o carrinho e o checkout, como TROCAS dos papéis de cor do tema (src/theme.js, `--o-cta`,
// `--o-incentive-*`, `--o-choice-*`, `--o-panel`…). Só o harness injeta este CSS; o tema aprovado, o painel e o cliente não mudam até a escolha.
// Escopo: a gaveta do carrinho tematizada e as telas do checkout tematizadas (a PDP da INK fica como está).
const CART = 'body[data-origens-theme~="cart"] .cart-drawer';
const CHECKOUT = 'body[data-origens-theme~="checkout"]';

// papel -> [cor, uso] ; a cor vira a variável `--o-<papel>` nos dois escopos.
export const PROPOSTAS = {
  A: {
    nome: 'A · verde com mais presença',
    resumo: 'Verde mais profundo e saturado no botão principal e nas escolhas; faixa de frete verde-clara; base branca e off-white quente no lugar do cinza; carvão no texto.',
    papeis: {
      cta: ['#2e5b38', 'Botão principal (Finalizar compra, Ir para o pagamento): verde-mata no lugar do preto'],
      'on-cta': ['#ffffff', 'Texto do botão principal (7,9:1)'],
      selected: ['#2e5b38', 'Escolhas e rádios'],
      ink: ['#1b1d19', 'Texto: carvão no lugar do preto puro'],
      paper: ['#faf7f0', 'Superfícies de apoio: off-white quente'],
      panel: ['#faf7f0', 'Rodapé do carrinho e resumo do checkout: off-white quente no lugar do cinza #f2f2f0'],
      'incentive-bg': ['#e4f0dc', 'Fundo da faixa de frete: verde-claro fresco'],
      'incentive-line': ['#c7dcb7', 'Borda da faixa'],
      'incentive-ink': ['#24492b', 'Destaque ("1 peça", "frete grátis"): verde escuro (8,6:1)'],
      'incentive-text': ['#1b1d19', 'Texto da faixa'],
      'incentive-soft': ['#3d4f37', 'Ressalva (destinos, CEP): tinta verde, não cinza (7,5:1)'],
      'incentive-icon': ['#2e5b38', 'Ícone do caminhão'],
      'incentive-track': ['#f6faf2', 'Trilho da régua'],
      'incentive-fill': ['#2e5b38', 'Progresso'],
      'choice-line': ['#2e5b38', 'Borda de 1 px da opção escolhida (sem o anel extra: mais leve)'],
      'choice-ring': ['transparent', '—'],
      'choice-bg': ['#eef6e9', 'Forma de entrega escolhida: fundo verde muito claro'],
      'choice-head': ['#e7f1df', 'Cabeçalho do pagamento escolhido (Pix/Cartão)'],
      'choice-body': ['#ffffff', 'Área aberta do cartão: branca (campos em destaque, pouco verde)'],
      'choice-mark': ['#2e5b38', 'Rádio escolhido']
    }
  },
  B: {
    nome: 'B · verde com acento ocre',
    resumo: 'O verde segue como identidade nas escolhas e no progresso; a faixa de frete vira palha/areia com o ícone num círculo dourado-areia (o acento da Sul); o botão principal continua carvão, como na PDP externa.',
    papeis: {
      cta: ['#1b1d19', 'Botão principal: carvão (continuidade com o botão preto da PDP externa)'],
      'on-cta': ['#ffffff', 'Texto do botão principal (17:1)'],
      selected: ['#3a5a30', 'Escolhas e rádios: verde da identidade, um tom mais vivo'],
      ink: ['#1b1d19', 'Texto: carvão'],
      paper: ['#fbf8f2', 'Superfícies de apoio: off-white quente'],
      panel: ['#fbf8f2', 'Rodapé do carrinho e resumo do checkout: off-white quente'],
      'incentive-bg': ['#f4ecda', 'Fundo da faixa de frete: palha/areia clara'],
      'incentive-line': ['#e3d3b0', 'Borda da faixa'],
      'incentive-ink': ['#2f4b28', 'Destaque: verde escuro (8,5:1)'],
      'incentive-text': ['#1b1d19', 'Texto da faixa'],
      'incentive-soft': ['#5a5340', 'Ressalva: tinta quente derivada da palha (6,7:1)'],
      'incentive-icon': ['#2f4b28', 'Ícone do caminhão: verde escuro'],
      'incentive-icon-bg': ['#d6ba8d', 'ACENTO: círculo dourado-areia atrás do ícone (o acento oficial da Sul; ícone sobre ele 5,2:1)'],
      'incentive-icon-size': ['22px', '—'],
      'incentive-icon-pad': ['3px', '—'],
      'incentive-track': ['#fffaf1', 'Trilho da régua'],
      'incentive-fill': ['#2f4b28', 'Progresso: verde escuro'],
      'choice-line': ['#3a5a30', 'Borda de 1 px da opção escolhida'],
      'choice-ring': ['transparent', '—'],
      'choice-bg': ['#f1f5ec', 'Forma de entrega escolhida: fundo verde quase branco'],
      'choice-head': ['#eef3e7', 'Cabeçalho do pagamento escolhido'],
      'choice-body': ['#ffffff', 'Área aberta do cartão: branca'],
      'choice-mark': ['#3a5a30', 'Rádio escolhido']
    }
  }
};

export function propostaCss(id) {
  const p = PROPOSTAS[id];
  if (!p) return '';
  const vars = Object.entries(p.papeis).map(([papel, [cor]]) => '--o-' + papel + ':' + cor).join(';');
  // As cores derivadas no <body> (line-soft) seguem a tinta nova; o foco continua evidente (contorno da tinta).
  return CART + ',' + CHECKOUT + '{' + vars + '}' +
    CART + ' ::selection,' + CHECKOUT + ' ::selection{background:' + (id === 'A' ? '#cfe3c2' : '#ecdcb8') + ';color:#1b1d19}' +
    CHECKOUT + ' :is(input,textarea){caret-color:' + p.papeis.selected[0] + '}' +
    '';
}
