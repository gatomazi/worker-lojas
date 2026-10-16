# Refinamento com referência Aphago: carrinho e checkout INK

Esta rodada continua os PRs worker-lojas #24 e useorigens-storefront #83, depois dos ajustes finais. Não houve merge, deploy nem mudança de rotas.

## 1. O que já estava atendido e o que mudou

**Já atendido pela rodada anterior (mantido):**

- Rodapé compacto: o cupom fica recolhido atrás de "Adicionar cupom" (aplicado ou com erro, fica aberto), "Continuar comprando" é ação de texto, os alvos de toque têm 44 px, e cupom e frete dividem uma linha.
- Os estados do incentivo, lidos do que a INK já mostra, sem requisição a mais.
- A regra do incentivo vem do painel e fica desligada até a confirmação do dono.
- Checkout só com CSS, sanitização dos dados pessoais e validação com resposta real.

**O que este adendo mudou:**

| Pedido | Feito |
| --- | --- |
| Incentivo **no topo** do carrinho, abaixo do título e antes dos produtos, sem duplicar | Agora é o primeiro item da lista rolável: um `<li role="none">` de largura total, porque o miolo da gaveta da INK é um flex em linha. Aparece ao abrir, sem rolar, nas quatro telas medidas (360, 390, 1280×640, 1440). Rola junto com os produtos e saiu do rodapé. |
| Contraste pela cor | Fundo com 20 % da cor de seleção da marca e borda fina com 35 % dela. A quantidade que falta e o "frete grátis" ficam em negrito na cor da marca. A régua tem 6 px, cantos arredondados, trilho claro e preenchimento na cor da marca. Sem pulsar; a régua anda em 0,25 s e fica parada para quem pede menos movimento. |
| Texto natural e curto, com a restrição territorial e o CEP | **Abaixo da meta:** "Falta **1 peça** para o **frete grátis**" e embaixo "Vale para PR, SC e RS; confirme pelo CEP." · **Meta atingida:** "**Quantidade atingida!** Confirme seu CEP para verificar o frete grátis." com a régua cheia, mas o texto não promete o frete. · **A INK mostra "Grátis":** "**Frete grátis** disponível para o seu CEP". · **A INK cobra frete:** "O frete grátis com 2 peças vale para PR, SC e RS." e embaixo "Para este CEP, o frete é cobrado." A cor só complementa: o texto sempre diz o estado. |
| Rodapé fixo não pode cobrir nada, nem com o teclado aberto | Com até 520 px de altura (teclado do celular aberto), a gaveta rola inteira e o rodapé deixa de ser fixo. Medido em 390×420 e 360×420: o campo do cupom em foco fica visível e o último item é alcançável. |
| Checkout: escolhida com fundo leve da marca, borda discreta e indicador perceptível; demais neutras | **Frete e pagamento:** a opção escolhida tem fundo com 10 % da cor da marca, borda e sombra interna de 1 px nessa cor, e o rádio também na cor da marca; as demais ficam brancas com borda clara. O contorno azul nativo da INK no cabeçalho do cartão saiu. **Também:** desabilitado e carregando ficam esmaecidos e sem cursor de clique, há mais respiro entre as seções e a mensagem de erro da INK ficou mais compacta. As etapas, os rótulos, as máscaras e as validações continuam os da INK. |

**Referência.** Abri a Aphago pelo Claude in Chrome, como você autorizou. A sacola deles já tinha um item da sua sessão; não adicionei nem mudei nada, e não preenchi nem finalizei o checkout.

- **Aproveitado:** a barra logo abaixo do título, o fundo colorido suave, o valor em destaque na cor da marca, a régua fina, a forma de pagamento escolhida com fundo da marca e borda, e o botão principal escuro.
- **Não copiado:** o roxo, o bloco amarelo de recado, a personalização e o checkout em uma página só.
- **Prints:** os que o adendo cita não estavam na sessão; usei o site ao vivo.

## 2. Capturas antes/depois

As capturas estão no ZIP, em `desktop/`, `mobile/` e `comparacoes/`, com o mesmo conteúdo nas duas fases. Antes é o código da rodada anterior, e as duas fases usam a mesma regra de exemplo. As comparações lado a lado são estas:

| Comparação | Antes → depois |
| --- | --- |
| `comparacao_390_carrinho-6-pecas` | Incentivo no rodapé fixo (rodapé de 316 px) → no topo da lista, rolando com os produtos (rodapé de 261 px) |
| `comparacao_360_carrinho-1-item` | Abaixo da meta, no rodapé → no topo |
| `comparacao_1440_carrinho-6-pecas` | O mesmo no computador |
| `comparacao_390_checkout-cartao` | Contorno azul nativo e borda preta → fundo leve e borda na cor da marca, rádio na mesma cor |
| `comparacao_390_checkout-frete` | Escolhida com borda preta grossa → fundo leve e borda da marca |
| `comparacao_390_checkout-validacao` | A mesma mensagem da INK, agora com entrelinha mais curta |

As capturas individuais cobrem, em 360, 390 e 1440 px:

- carrinho com 1 item e com 6 peças, topo e fim da lista;
- "Grátis" da INK, frete cobrado e item removido;
- cupom aberto, aplicado e com erro, e teclado aberto (só no celular);
- checkout: contato, frete, validação, Pix, e cartão com parcelas.

O carrinho também foi capturado em 1280×640.

## 3. Regra promocional

A conclusão não mudou: **não há fonte estruturada** para a regra de frete grátis.

- A frase "PR, RS e SC a partir de 2 itens" só existe como texto, na faixa da INK e no cadastro de promoções do storefront.
- Na API da INK, frete grátis não é um tipo de promoção, e a simulação de frete usa uma peça só.

A regra que o código usa vem do painel ("Tema da INK › Incentivo de frete no carrinho"):

- frete grátis por **quantidade de peças**, de 2 a 20, nos estados da região;
- só sai do painel ligada **e** confirmada pelo dono;
- vem desligada e vazia;
- e só aparece na loja com a feature `cart-incentive` no deploy.

As condições de uso:

- **Peças elegíveis:** a confirmação do painel declara que a regra vale para **todos os produtos**, então todas as peças contam (o total de `#quantity-header`). Se houver exceção na INK, o incentivo não deve ser ligado.
- **Unidade:** só por peças. Se a regra for por valor, a INK já mostra a régua dela, e o nosso incentivo sai quando ela aparece, para não repetir o aviso.
- **CEP ainda desconhecido:** o texto diz a restrição ("Vale para PR, SC e RS; confirme pelo CEP"). Com a meta atingida, ele pede o CEP e não promete o frete. "Disponível" só aparece quando a própria INK mostra "Grátis" na linha do frete.
- **"Frete grátis aplicado":** não usei no carrinho. Ali a INK mostra o frete estimado para o CEP, e a entrega ainda não foi escolhida. No checkout, quem confirma é a INK ("GRÁTIS" na forma de entrega e no resumo).
- **Recálculo:** acontece a cada resposta da INK (quantidade, remover, cupom). Durante a resposta, o conteúdo some sem mudar a altura. Desconto não afeta uma regra por peças.

## 4. Matriz de estados

| Estado | Real | Simulado | Bloqueado / não validado |
| --- | --- | --- | --- |
| Checkout: contato, entrega, seleção de frete | ✔ telas da INK com o tema (estrutura e valores reais, dados trocados por fictícios) | — | — |
| Checkout: validação | ✔ número apagado só no navegador → a INK mostra "Insira um número válido" e mantém o cliente no contato; nada foi enviado | — | Erros que só vêm do servidor (o salvamento automático fica abortado) |
| Checkout: Pix/cartão, parcelas, "Editar" | ✔ `validacao-checkout.mjs` 8/8: a INK respondeu 200 às duas trocas Pix/cartão; n × parcela = total; escolher a parcela não faz requisição; "Editar" volta ao contato por GET; o carrinho de teste continua sem forma de pagamento marcada | — | Finalizar e pagar: nunca |
| Carrinho: incentivo (abaixo da meta, meta atingida, "Grátis", frete cobrado, item removido) | — | ✔ gaveta reconstruída, código real do tema | Com itens reais, cupom e CEP reais |
| Carrinho: cupom fechado, aberto, aplicado, erro | — | ✔ | Cupom real |
| Rolagem, último item, botão de finalizar, teclado aberto, ordem de foco | — | ✔ medido nas quatro telas (foco: 21 controles na ordem visual) | — |
| Tema desligado e Turbo sem duplicar | ✔ QA liga/desliga nas páginas reais, mais testes de DOM | — | — |

**Carrinho real.** Adicionar ao carrinho real da Use Sul pela automação foi recusado pela política de permissões (rodada 1). Não tentei de novo por outro meio. O roteiro manual da rodada anterior continua valendo. A pasta `~/Downloads/carrinho-real` estava vazia: nenhum Enter foi apertado, e você validou no olho. Testei o modo de captura e ele salva normalmente.

## 5. Leveza

- **Abrir o carrinho:** continua fazendo 1 requisição, antes e depois (`discovery.js`, que já existia).
- **Loader:** passou de 270.452 para 271.076 bytes sem compressão (+624 bytes).
- **Nada novo de infraestrutura:** nenhuma biblioteca, nenhum polling, nenhum observador. O incentivo segue nas remontagens que o runtime já faz.
- **Checkout:** continua sem JS nosso.
- **Sem configuração promocional:** a compra segue normal, só sem o incentivo.

## 6. Arquivos, testes e PRs

- **Worker #24:**
  - código: `src/loader/theme-ui.js` (incentivo no topo da lista) e `src/theme.js` (cor do incentivo, tela muito baixa, acabamento do checkout);
  - testes: `test/cart-footer.dom.test.js` e `test/theme.unit.test.js`;
  - ferramentas e documentação: `scripts/refinamento-aphago.mjs` (novo) e `docs/tema-fluxo-ink.md`.
- **Storefront #83:** nada mudou nesta rodada; o painel do incentivo segue como estava.
- **Testes:** Worker `npm test` 585/585; QA geral com checkout 65/65; liga/desliga com checkout 21/21; galeria 163/163; validação real do checkout 8/8.
