# Ajustes finais: carrinho, incentivo de frete e validação funcional

Os PRs ativos são worker-lojas #24 e useorigens-storefront #83. Não houve merge, deploy nem mudança de rotas em produção. A PDP, a galeria e o checkout ficaram como estavam.

## 1. PRs atualizados com a `main`

- **Worker #24.** Estava em conflito com a loja única (#25), em 4 trechos do `src/worker.js`. Resolvi seguindo o padrão da própria loja única: o tema é **por região do visitante**, como a navbar e as promoções (serviço por `viewKey`, `inkThemeApi` nos campos da região). Um teste novo garante que o visitante do Norte lê `/api/ink-theme/norte` e nunca recebe o tema da Sul.
- **Storefront #83.** Estava 32 commits atrás, com 5 arquivos em conflito. Eram todos casos em que os dois lados acrescentaram algo (`statePage` da `main` e `inkTheme` deste PR), e os dois ficaram. O menu do painel agora é por grupos, e "Tema da INK" entrou em Configuração.
- **Worker de novo (`e0b2a47`):** a `main` ganhou os PRs #26 e #27 (redirecionar as lojas antigas, preparar a troca de domínio, coleções). Merge feito: as importações e a chave de serviço nova (região + domínio da INK) ganharam o serviço do tema. Com esse merge, a falha do teste `wrangler dev and production ship the same safe defaults`, que vinha da `main`, foi corrigida por ela mesma. Agora são **585/585**, e as QAs de navegador foram repetidas depois do merge: geral 65/65, liga/desliga 21/21.

## 2. Incentivo de frete

### Origem e situação da regra

| Fonte | O que tem | Serve como regra? |
| --- | --- | --- |
| Faixa do topo da INK | "Frete grátis para PR, RS, SC a partir de 2 itens" (texto) | Não: é só texto |
| Storefront `/api/promotions/sul` | "Frete Grátis para o Sul na compra de 2 peças ou mais" (texto) | Não: esse cadastro só **descreve** ofertas, por desenho |
| API da INK (`GET /v1/stores/promotions`, especificação OpenAPI) | Descontos (percentual ou em valor), progressivos por peças ou valor, "leve X" | Não há tipo "frete grátis"; o LEVEMAIS (progressivo) é estruturado, mas exige token no servidor |
| API da INK (`/v1/stores/shipping_simulation`) | Frete por CEP sobre **uma** camiseta de referência | Não confirma a regra de 2 peças |
| Carrinho da INK (barra nativa `ink-store--progress-bar`) | Barra de frete grátis por **valor** ("Você ganhou frete grátis!") | Só por valor; vem zerada no carrinho vazio |
| MCP Use Origens × INK | Catálogo, pedidos e vendas | Não expõe promoções nem frete |

**Conclusão: não existe fonte estruturada e acessível para a regra de frete.** Por isso:

- **No painel** (#83, "Tema da INK › Incentivo de frete no carrinho") há uma configuração que **representa** a regra já cadastrada na INK. Ela não cria promoção: o frete e os totais continuam sendo calculados pela INK.
  - Campos: mínimo de 2 a 20 peças e os estados da região.
  - Só sai do painel se estiver **ligada e confirmada**. A confirmação é uma caixa que diz "Confirmo que essa regra está cadastrada e ativa na INK, para todos os produtos da loja".
  - Vem **desligada e vazia**, sem nenhum valor pré-preenchido.
- **No Worker** (#24), a regra vai para a página como atributo do `<body>` (`data-origens-incentive="2|PR,SC,RS"`), e só quando três coisas valem juntas:
  - o carrinho tematizado está ligado;
  - a feature `cart-incentive` (opt-in) está no deploy;
  - a regra é válida.

  O navegador não faz nenhuma requisição a mais por causa disso.
- **No fluxo real, o incentivo continua desligado.** Falta a sua confirmação e a feature no deploy.
- **Regra por valor:** fica com a barra nativa da INK. Se ela aparecer no carrinho, o nosso incentivo sai, para não repetir o aviso.

**O que você precisa confirmar na INK para ligar** (a mesma lista aparece no painel):

1. a quantidade mínima de peças;
2. se vale para todos os produtos;
3. os estados de destino;
4. quais formas de entrega ficam grátis;
5. se um cupom mantém ou tira o benefício;
6. a data de fim, se houver.

### Mensagens (todas no código, `theme-ui.js`)

| Estado | Linha principal | Linha de baixo |
| --- | --- | --- |
| Falta peça | **Falta 1 peça** para o frete grátis, com a régua na base da caixa | Para entregas em PR, SC e RS. |
| Meta atingida, CEP pendente | **Você já tem 2 peças!** | Consulte seu CEP para verificar o frete grátis. |
| A INK mostra "Grátis" no frete | **Frete grátis disponível** para o seu CEP. | — |
| A INK cobra frete para o CEP | O frete grátis com 2 peças ou mais vale para PR, SC e RS. (sem sucesso) | — |
| Sem regra, carrinho vazio ou barra nativa da INK | nada aparece | — |

Aparência e comportamento:

- **Visual:** fundo suave da cor de seleção da marca, ícone num círculo cheio dessa cor e "Falta 1 peça" na mesma cor. São 50 px fixos, em duas linhas no máximo.
- **Movimento:** sem pulsar; só a régua anda, em 0,25 s, e fica parada para quem pede menos movimento.
- **Enquanto a INK responde** (quantidade, remover, cupom), o conteúdo some e a caixa fica do mesmo tamanho, então nunca aparece mensagem velha. Ela volta com a resposta nova; se o envio der erro, mostra de novo o estado atual.

## 3. Rodapé do carrinho

O que mudou:

- **Cupom:** recolhido atrás de "Adicionar cupom".
  - Fica aberto quando há código digitado, foco no campo, cupom aplicado ou erro, e depois que o cliente o abriu.
  - Quem esconde é um atributo **nosso**: se o código falhar, o campo da INK aparece como sempre.
- **"Continuar comprando":** virou ação de texto, com 44 px de toque.
- **"Inserir CEP":** ganhou 44 px de toque (antes tinha 24 px).
- **Uma linha a menos:** com o cupom recolhido e o CEP fechado, "Adicionar cupom" e "Frete · Inserir CEP" dividem a mesma linha. Isso é só CSS; se a marcação não bater, volta a uma linha cada.

Medidas com a mesma gaveta (5 linhas, 6 peças):

| Tela | Situação | Rodapé antes → depois | Lista antes → depois | Itens inteiros à vista |
| --- | --- | --- | --- | --- |
| 390×844 | sem incentivo | 329 → 261 px | 458 → 526 px (**+68**) | 2 → 3 |
| 390×844 | com incentivo* | 399 → 316 px | 388 → 471 px (**+83**) | 2 → 2 |
| 360×740 | sem incentivo | 286 → 238 px | 397 → 445 px (**+48**) | 2 → 2 |
| 360×740 | com incentivo* | 356 → 291 px | 327 → 392 px (**+65**) | 1 → 1 |
| 1280×640 | sem incentivo | 286 → 238 px | 297 → 345 px (**+48**) | 1 → 2 |
| 1280×640 | com incentivo* | 356 → 291 px | 227 → 292 px (**+65**) | 1 → 1 |
| 1440×900 | sem incentivo | 329 → 261 px | 514 → 582 px (**+68**) | 3 → 3 |

\* "Antes" usa a proposta desenhada à mão da rodada anterior; "depois" usa o incentivo do código.

O menor alvo de toque do rodapé passou de **24 para 44 px**. "Finalizar compra" fica sempre à vista, numa linha, com 54 px (48 px em tela baixa), e nenhuma tela teve rolagem horizontal.

**Leveza:**

- Abrir o carrinho continua fazendo **1** requisição, antes e depois (`discovery.js`, que já existia).
- O loader passou de 261.167 para 270.452 bytes sem compressão (+9,3 KB).
- Não há polling nem observador novo: a camada roda nas remontagens que o runtime já faz.
- Os dois ouvintes (`turbo:submit-start` e `turbo:submit-end`) só existem com o carrinho tematizado e saem ao desligar.

## 4. Validação

### Validado com resposta real (INK de produção, carrinho de TESTE, dados pessoais sanitizados)

Roteiro `validacao-checkout.mjs`, 8 de 8 verificações passaram:

- **Contato → pagamento:** telas reais com o tema e o resumo da INK (subtotal R$ 659,40, desconto −R$ 85,00, frete R$ 27,49 riscado com "GRÁTIS", total R$ 574,40).
- **Pix ↔ cartão:** o recálculo `POST /checkout/payment_discount/<id>` foi liberado **só** para isso, e a INK respondeu **200** nas duas trocas. Os totais foram os mesmos (R$ 574,40, com os mesmos −R$ 85,00), então não há desconto extra no Pix.
- **Parcelas:** de 1x a 5x sem juros, e n × parcela = total. Escolher a parcela **não** faz requisição.
- **"Editar" o endereço:** volta ao contato por GET, com o tema e sem nenhum envio.
- **Carrinho de teste:** antes do teste não havia forma de pagamento marcada; depois de recarregar, continua sem nenhuma.
- **O que continuou abortado:** `process_payment` e o salvamento automático de contato e entrega. Nenhum pedido, nenhuma cobrança, nenhum dado real alterado.

Outras verificações em páginas reais:

- QA geral com o checkout, liga/desliga com o checkout e galeria: os números estão no fim do relatório.
- O tema liga e desliga por superfície, pelo deploy e pelo painel, e o Turbo não deixa resíduo.

### Validado localmente (testes automatizados)

- **Worker** (`npm test`):
  - `cart-footer.dom.test.js`, 7 cenários: recolher e abrir; aplicado e erro ficam abertos; tema desligado não mexe; os quatro estados do incentivo; carregamento e erro; Turbo sem duplicar.
  - Contrato `normalizeIncentive`.
  - Atributo no `<body>` só com a feature, o carrinho ligado e uma regra válida (workerd real).
  - Tema por região.
  - Sanitização.
- **Storefront** (vitest): validação do incentivo com mensagens em português, payload só quando ligado e confirmado, linha no diff da publicação.

### Simulado (marcado em cada imagem e no nome do arquivo)

- **Gaveta:** reconstruída com a marcação que o JS e o CSS públicos da INK confirmam (`#quantity-header`, `#coupon-form`/`cart[coupon][code]`, alvos `cepInputContainer` e `cartErrors`, classes `.cart-drawer__footer__*`) e injetada na PDP real. O tema e o loader são reais.
- **Partes reconstruídas sem marcação real disponível:** o texto do erro de cupom, a linha do frete depois do CEP ("Grátis" ou "R$ 27,49") e a remoção do código aplicado.
- **Regra do incentivo:** é o **exemplo** da faixa (2 peças, PR/SC/RS) e não foi confirmada.

### Bloqueado ou não testado

- **Carrinho real:** adicionar com a variante, quantidade, remover, esvaziar e adicionar de novo. A ação bloqueada foi **eu adicionar um produto ao carrinho real pela automação do navegador**, recusada pela política de permissões. Não repeti por nenhum outro meio.
- **Cupom e CEP reais no carrinho:** o texto que a INK mostra depois do CEP decide entre "disponível" e "cobra frete". Isso precisa da conferência abaixo.
- **Salvamento automático de contato e entrega:** alteraria dados reais, então não testei.

### Para liberar o fluxo

1. Fazer a conferência manual abaixo e me mandar as capturas, principalmente CEP e cupom.
2. Confirmar a regra na INK (lista da seção 2) e preencher o painel. Ligar o incentivo só depois disso.
3. Publicar o storefront (#83) e depois publicar o tema no painel.
4. Fazer o deploy do Worker da Sul com `theme-pdp,theme-cart`, e `cart-incentive` só depois da etapa 2.
5. Abrir um PR próprio para as rotas do checkout (`routes-lib` ainda recusa checkout).

## 5. Conferência manual (5 minutos, na prévia)

Na pasta `use-origens-workers-tema`, rode:

`PW_PATH=/Users/izamoti/projects/useorigens node scripts/preview-tema.mjs --headed --allow-cart --incentivo-exemplo --capturar-carrinho ~/Downloads/carrinho-real`

Abrem duas janelas, computador e celular, com sessões novas e o tema com a regra de exemplo. **Em cada janela:**

| Passo | Resultado esperado |
| --- | --- |
| Escolha modelo, cor e tamanho e adicione 1 peça; abra o carrinho; Enter | "Falta 1 peça para o frete grátis" com a régua; "Adicionar cupom" recolhido; "Continuar comprando" em texto |
| Clique em + na quantidade; Enter | Durante a resposta a caixa fica vazia; depois aparece "Você já tem 2 peças!" |
| "Adicionar cupom" → digite um código inválido → aplicar; Enter | O erro da INK aparece e o campo continua aberto |
| Aplique LEVEMAIS (se valer com 2 peças); Enter | Código e desconto à mostra |
| "Inserir CEP" com um CEP de SC; Enter | Se a INK mostrar "Grátis": "Frete grátis disponível para o seu CEP" |
| CEP de fora do Sul; Enter | "O frete grátis com 2 peças ou mais vale para PR, SC e RS." (sem sucesso) |
| Remova até 1 peça; esvazie; adicione de novo; Enter | Volta "Falta 1 peça"; o carrinho vazio fica sem incentivo; tudo volta ao adicionar |

O checkout continua travado na prévia: "Finalizar compra" não segue, sem pedido e sem cobrança. Se algum texto não bater, as capturas em `~/Downloads/carrinho-real` mostram onde está a diferença.

## Arquivos e testes

- **Worker #24:**
  - código: `src/theme.js`, `src/loader/theme-ui.js`, `src/worker.js`, `src/stores.js`, `src/features.js`;
  - testes: `test/cart-footer.dom.test.js` (novo), `test/theme.unit.test.js`, `test/theme.workerd.test.js`, `test/store-release.test.js`;
  - ferramentas: `scripts/lib/tema-harness.mjs`, `scripts/lib/store-lib.mjs`, `scripts/preview-tema.mjs`, `scripts/ajustes-finais.mjs` (novo), `scripts/validacao-checkout.mjs` (novo);
  - documentação: `docs/tema-fluxo-ink.md`.
- **Storefront #83:** `src/lib/site-config/ink-theme-schema.ts`, `ink-theme.ts`, `src/lib/admin/diff.ts`, `src/app/admin/actions.ts`, `src/app/admin/(panel)/tema-ink/page.tsx`, `tests/unit/ink-theme.test.ts`.
- **Resultados:** Worker `npm test` 585/585 (depois do segundo merge da `main`); QA geral com checkout 65/65; liga/desliga com checkout 21/21; galeria 163/163; validação com resposta real do checkout 8/8. Storefront: `tsc` e lint limpos, vitest 1570/1570.
