# Relatório — rodada 2: layout e validação do fluxo INK

Rodada de 15/10/2026, a partir de `CLAUDE_RODADA_2_LAYOUT_FLUXO_INK.md`, sobre os PRs existentes (branch `feature/tema-fluxo-ink`): **worker-lojas #24** (https://github.com/gatomazi/worker-lojas/pull/24) e **useorigens-storefront #83** (https://github.com/gatomazi/useorigens-storefront/pull/83). **Sem merge, sem deploy, sem rota criada.** Auditoria: [`AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md`](AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md). Técnica e prévia: [`tema-fluxo-ink.md`](tema-fluxo-ink.md). Rodada 1: [`RELATORIO_PERSONALIZACAO_FLUXO_INK.md`](RELATORIO_PERSONALIZACAO_FLUXO_INK.md).

## O que mudou (composição, não só cor)

### PDP

| Mudança | O que ficou mais fácil |
|---|---|
| **Computador:** galeria maior (1,3 : 1) e **fixa** enquanto a coluna de compra rola; colunas alinhadas pelo topo | A camiseta continua à vista enquanto se escolhe cor e tamanho; a imagem troca com a cor sem sair da tela. Título → CTA cabem ao lado da foto na 1ª dobra (1440×900) |
| Coluna de compra na ordem da decisão: título · compartilhar/avaliações · preço · **modelo › cor › tamanho › medidas › quantidade › CTA** · confiança · prazo · cupom · "Também disponível em" | Cada decisão logo abaixo da anterior; o que é opcional (outros tipos de peça, cupom) não disputa com o obrigatório |
| Chips com **linha fina** no normal e **cheios na cor da região** quando escolhidos; indisponível tracejado; modelo em 2 colunas iguais; tamanhos ocupando a linha | O escolhido salta aos olhos sem todo controle parecer botão primário; 7 tamanhos numa linha a 390 px (≥ 44 px) |
| "Guia de medidas" e "Informar medidas" como **links de ação** lado a lado, logo abaixo do tamanho | Cabem sem truncar no celular e ficam no momento da dúvida |
| "Também disponível em" depois da compra, rótulo pequeno e chips finos | Deixa de parecer uma escolha obrigatória antes do modelo |
| Pesos aliviados (título 700, preço 700, rótulos 600) sobre fundo claro; **cinza das fotos só atrás da camiseta** | Menos texto pesado e menos contorno preto; a foto continua "sentada" no cinza dela |
| **Celular:** título + ações numa faixa compacta (foto sobe ~65 px); contador "1 / 17" no lugar de 17 pontos; flutuantes saem do caminho durante a escolha; barra fixa só quando o CTA sai da tela | Menos distração até a compra; nada cobre "Informar medidas" ou o CTA |
| Cabeçalho do celular com **símbolo + USE ORIGENS** (Big Shoulders Display) | Mesma assinatura do storefront |
| Faixa superior: animação sem sobreposição (0/60 quadros, era 14–15/60) | As mensagens da INK passam a ser legíveis em qualquer momento |

### Carrinho

| Mudança | O que ficou mais fácil |
|---|---|
| Cabeçalho enxuto (Carrinho + quantidade + fechar), itens separados por linha fina, miniatura 88 px no cinza das fotos, quantidade compacta | Leitura rápida do que está no carrinho |
| Cupom e CEP em segundo plano; total em destaque; **"Finalizar compra" única ação principal**; "Continuar comprando" secundário | A próxima ação é inequívoca |
| Nosso bloco "Descubra outras estampas" **sempre depois dos itens** e compacto (antes: no topo com 3+ itens) | Produtos e finalização vêm primeiro |
| **Vazio:** "Seu carrinho está vazio" + **Encontrar minha cidade** (principal) + **Explorar estampas**; sem "sem perder seu carrinho"; a frase repetida da INK sai só quando o nosso bloco existe; recomendações da INK abaixo | Uma abertura só, com a intenção certa |
| Pós-adição: "Ver carrinho" principal, "Continuar comprando" secundário | Caminho para finalizar claro |

### Checkout

| Mudança | O que ficou mais fácil |
|---|---|
| Cabeçalho com **símbolo + USE ORIGENS** (o Worker insere o nome no HTML; nenhum script) | Mesma assinatura da loja |
| Largura máxima 1180 px, 48 px entre colunas; grupos (Identificação, Entrega, Formas de entrega) separados por linha fina; resumo como superfície própria, fixo só em telas altas | Formulário e resumo alinhados e legíveis no computador; sem corte em telas baixas |
| Pagamento: opções como linhas de escolha, a escolhida com borda forte; **campos do cartão e endereço de cobrança** no mesmo estilo; faixa "pagamento protegido" depois do botão e neutra | A decisão vem antes da garantia; sem três mensagens repetindo segurança antes das opções |
| "Finalizar compra" do celular numa linha (**54 px a 360 px**; era 96 px porque o botão da barra fixa quebrava a linha) | Barra fixa compacta com total e ação |

O texto do CTA final segue "Finalizar compra": o formulário faz `POST /checkout/process_payment` (confirmado no DOM: `form#formPaymentMethods action=…/process_payment`), cria o pedido e não há etapa de revisão — nada sugere revisão posterior.

## Onde a composição veio da Bendita Fé (e onde não)

Observado na PDP e no carrinho deles (Claude in Chrome no computador; Playwright no celular): coluna de compra estreita ao lado de uma galeria dominante; rótulos leves e controles de 1 px com o escolhido forte; modelo em duas colunas iguais; tamanhos em linha; medidas como links com ícone logo abaixo do tamanho; quantidade discreta antes do CTA; confiança logo abaixo do CTA; prazo como linha; no celular, imagem logo após o cabeçalho e contador/miniaturas no lugar de pontos; gaveta do carrinho com cabeçalho enxuto e "Continuar comprando" secundário.

**Não copiado:** código, imagens, textos, logo, paleta, a grade de duas fotos (as nossas fotos são as cores da variante: duas lado a lado mostrariam cores erradas), barra de frete grátis (não temos regra/elegibilidade confiável), favoritos, provador e oferta extra no checkout. A identidade é a da PDP da Use Origens (Hanken Grotesk, Big Shoulders na assinatura, botão preto reto, selecionado na cor da região, cinza das fotos).

## Testes

| Onde | Resultado |
|---|---|
| Worker `npm test` | **555/555** (inclui os testes do tema atualizados: contrato com `photo`, `display`/`visibility` só onde listados, `@keyframes` da faixa, assinatura do checkout, 2 observadores do theme-ui) |
| Storefront `vitest tests/unit`, `tsc`, `eslint` | **1423/1423**; `tsc` limpo; `eslint` 0 erros (10 avisos antigos, nenhum nos arquivos do tema) |
| QA numérico na INK real (`preview-tema.mjs --qa`): 360/375/390/768/1440 sem rolagem horizontal, CTA e seletores ≥ 44 px, Turbo e voltar sem duplicar tema/loader/guia, barra fixa, Esc no carrinho, checkout só CSS, campos ≥ 44 px, **botão de seguir numa linha (≤ 60 px)** | **65/65** — `evidence/tema-fluxo-ink/rodada-2/qa-rodada-2.txt` |
| Matriz de estados (`estados-tema.mjs`): INK nativa × rodada 1 × rodada 2, 22 ações × 2 viewports | `estados-*.json` + capturas |
| Simulação de carrinho com itens e pós-adição (`simulacao-carrinho.mjs`) — **SIMULAÇÃO**, marcada nas capturas | bloco depois dos itens; "Finalizar compra" visível no rodapé em 1440 e 390 |

### Matriz de estados

| Estado | Situação |
|---|---|
| Variantes: escolher, trocar cor (imagem e contador acompanham), troca que invalida tamanho (INK limpa) | **Testado** |
| Modal de medidas, Informar medidas, prazo, cupons, "Também disponível em", zoom (computador) | **Testado** (abrir; nenhum CEP enviado) |
| Turbo (outra PDP pela recomendação) e voltar | **Testado** (1 tema, 1 link, 1 guia) |
| Carrinho vazio | **Testado** |
| Carrinho com itens, quantidade, remover, CTA em lista longa | **Simulado** (aparência) / **Bloqueado** (integração) |
| Pós-adição | **Simulado** / **Bloqueado** |
| Cupom válido/inválido no carrinho; CEP/frete e recálculo | **Bloqueado** (POST) |
| Checkout contato/entrega | **Testado por GET** (foco sem digitar) |
| Pagamento: Cartão (campos abertos), Pix, cobrança diferente, mensagem de campo vazio | **Testado no navegador**, POSTs abortados; nada digitado |
| Parcelas mudando total, pagamento, confirmação | **Não testado** (não aplicável sem pagar) |
| Voltar do pagamento e editar contato | **Testado por GET** (o link "Editar" é GET); edição em si não |
| Teclado | **Emulação** (classe `o-typing` em jsdom e Chrome); **dispositivo real não testado** |

**Bloqueio, exatamente:** a ação "adicionar item ao carrinho real da INK" (POST `/usesul/cart`) foi negada pela política de permissões desta ferramenta na rodada 1 (categoria "Real-World Transactions"). Não foi tentada de novo por outro meio. Os POSTs de checkout disparados por cliques em rádios (`/checkout/payment_discount/<id>`, 4×) foram **abortados no navegador** pela trava da prévia.

## Roteiro manual (5 min, prévia local)

```bash
# Worker (pasta use-origens-workers-tema); --allow-cart libera SÓ o carrinho; o checkout continua travado
PW_PATH=/Users/izamoti/projects/useorigens node scripts/preview-tema.mjs --headed --allow-cart
```

Nas duas janelas (computador e celular):
1. Escolher Clássica, uma cor e M; conferir a imagem trocando e o escolhido em destaque. Trocar para Baby Look com 4G marcado: o tamanho deve ser limpo.
2. **Adicionar ao carrinho** → a confirmação mostra o item, "Ver carrinho" (principal) e "Continuar comprando". Abrir o carrinho.
3. Carrinho: `+` e lixeira; o total muda; o bloco "Descubra outras estampas" fica **depois** dos itens; "Finalizar compra" visível no rodapé mesmo com 4+ itens (adicionar outras peças).
4. Cupom inválido (ex.: `TESTE`) → mensagem da INK; CEP → frete e total.
5. Esvaziar → "Seu carrinho está vazio" + "Encontrar minha cidade" (abre a busca) + "Explorar estampas".
6. **Não** clicar em "Finalizar compra" (ele já leva ao checkout da sessão de prévia; o checkout fica sem POST pela trava, mas não há motivo para ir adiante).

Se algo divergir da simulação (sobretudo o carrinho com itens), anote o estado e a largura.

## Limitações

- Carrinho com itens e pós-adição: só **simulados**; a marcação real pode diferir.
- Teclado: só emulação. Safari/iOS e Android reais não testados.
- Galeria: mantida como carrossel de uma imagem (as fotos são as cores); miniaturas não foram criadas para não reconstruir o controle nativo.
- Medição de sobreposição dos flutuantes: o script mede uma posição de rolagem; a evidência real é visual (`mobile-05` da rodada 1 × rodada 2).
- A sonda do cabeçalho no computador marcou "só o símbolo" porque media a palavra do cabeçalho móvel, escondido; a captura mostra símbolo + nome (sonda corrigida no script).
- Checkout segue dependendo das duas rotas da zona (PR próprio).

## Como desligar / reverter

Igual à rodada 1: painel (por superfície), feature do deploy, `wrangler rollback`, rotas do checkout. As mudanças de comportamento desta rodada (bloco do carrinho, contador, flutuantes, assinatura no checkout) dependem do tema estar ligado: com ele desligado, a INK e os nossos widgets voltam ao que eram.

## Arquivos principais (rodada 2)

Worker: `src/theme.js` (composição das três superfícies, faixa superior, cabeçalho, token `photo`), `src/loader/theme-ui.js` (contador da galeria, flutuantes durante a escolha), `src/loader/discovery-ui.js` (posição e texto do bloco do carrinho com o tema), `src/worker.js` (assinatura no checkout), `scripts/lib/tema-harness.mjs`, `scripts/estados-tema.mjs`, `scripts/simulacao-carrinho.mjs`, testes `test/theme*.js`.
Storefront: `src/lib/site-config/ink-theme.ts` e `ink-theme-schema.ts` (token `photo`, fundo claro como padrão, rótulos), `tests/unit/ink-theme.test.ts`.

Evidências: `evidence/tema-fluxo-ink/rodada-2/` — `rodada-1/`, `rodada-2/`, `ink-nativa/` (mesmos estados), `simulacao/` (marcada), `referencia/` (Bendita Fé), `comparativo-identidade-*` (site × INK hoje × rodada 2), `comparativo-composicao-*` (Bendita Fé × rodada 2). Campos pessoais do checkout mascarados em rosa.
