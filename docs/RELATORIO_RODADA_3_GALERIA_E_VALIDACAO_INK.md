# Relatório — rodada 3: galeria com miniaturas e fechamento do fluxo INK

Rodada de 15/10/2026, a partir de `CLAUDE_RODADA_3_GALERIA_E_VALIDACAO_INK.md`, sobre a branch `feature/tema-fluxo-ink` e os PRs abertos **worker-lojas #24** (https://github.com/gatomazi/worker-lojas/pull/24) e **useorigens-storefront #83** (https://github.com/gatomazi/useorigens-storefront/pull/83). O storefront não precisou mudar nesta rodada. **Sem merge, sem deploy, sem rota.** Rodadas anteriores: [`RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md`](RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md), [`AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md`](AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md).

**Ferramenta de navegador:** Playwright (Chrome) com o harness da prévia, contra as páginas **reais** da INK passando pelo Worker local (Miniflare, mesmo código de produção). Claude in Chrome não foi necessário nesta rodada (nenhuma referência externa nova). Toda a validação é **emulação** de navegador; nenhum dispositivo real.

## 1. Alterações e arquivos principais

| O quê | Onde |
|---|---|
| **Galeria com miniaturas**: grade abaixo da foto com TODAS as fotos do conjunto nativo (6 colunas no celular, 8 no computador, quebrando em linhas, nunca faixa com rolagem); selecionada com borda na cor da região; foco de teclado visível; nomes "Foto N de M"; os pontos da INK saem de cena só depois da grade montada; uma foto só = sem grade. Substitui o contador "1 / 17" da rodada 2 | `src/loader/theme-ui.js`, `src/theme.js` |
| Galeria fixa no computador ajustada à altura da janela (`--o-gal-top`): em telas baixas a galeria sobe até a última miniatura ficar visível; o selo nativo "Clique para dar zoom" fica acima da grade | idem |
| **Desligamento efetivo** (§3 abaixo): escopo do CSS e sinal do loader passam do `<html>` para o `<body>`; o loader só atua com a feature do deploy **e** a superfície ligada na página atual; desligar desfaz tudo; voltar pelo cache do Turbo não religa | `src/worker.js`, `src/theme.js`, `src/loader/theme-ui.js`, `src/loader/discovery-ui.js` |
| **Ordem de foco = ordem visual**: o `order` do CSS da rodada 2 saiu; prazo, cupom e "Também disponível em" são reposicionados no DOM depois do quadro de compra, e "Guia/Informar medidas" antes da quantidade (mesmo pai; voltam ao lugar ao desligar; um frame que a INK ainda está carregando não é movido) | `src/loader/theme-ui.js` |
| Flutuantes (Ajuda, WhatsApp, cupons) também saem do caminho enquanto a grade de miniaturas está na tela do celular | idem |
| Harness da prévia passa a encaminhar também as **visitas Turbo** (fetch) pelo Worker — antes só documentos; QA novo da galeria e do liga/desliga | `scripts/lib/tema-harness.mjs`, `scripts/qa-galeria-tema.mjs`, `scripts/qa-desligamento-tema.mjs`, `scripts/preview-tema.mjs` |
| Testes | `test/theme-ui.dom.test.js` (reescrito: 10 casos), `test/theme.unit.test.js`, `test/theme.workerd.test.js`, fixture `product-page-theme.html` com carrossel |

## 2. Como a galeria se integra à INK (contrato observado)

Medido na PDP real (`florianopolis-legado-sc`, 17 fotos) e em produtos com 3, 4, 5, 8, 15, 16 e 19 fotos:

- O controlador nativo é `ink-store--carousel`. Os slides (`ul.aspect-square > li`) e os pontos (`button#dot-image-N`, alvo `indicator`) são **um para um**. O ponto ativo tem **`aria-current="true"`**, o sinal de estado usado aqui (mais confiável que a classe de cor da rodada 2).
- **Fotos × variantes:** a 1ª foto é a imagem principal do produto (`product_v2/main_image`); as demais são as artes por variante (`product_art/final_image`), **8 cores × 2 modelos** nas camisetas. Os textos alternativos são genéricos ("Imagem N"): não há rótulo de cor por foto.
- **Trocar modelo/cor:** a INK pula sozinha para a foto da variante (ex.: Clássica + Branca → foto 4 ou 7) **sem recriar** os slides; a miniatura ativa acompanha porque observa `aria-current`.
- **Navegar por fotos não muda a variante:** clicar num ponto, numa seta ou numa miniatura não marca nenhum rádio, e `product_variant_id` continua o mesmo. O item enviado ao carrinho é sempre o dos rádios (modelo, cor, tamanho), exatamente como na INK nativa com os pontos. Consequência herdada da INK: é possível olhar a foto de outra cor sem escolhê-la; a cor escolhida continua indicada ("Cor: Branca") ao lado dos seletores.
- **Integração:** tocar numa miniatura **aciona o ponto nativo** correspondente; nada da galeria é reconstruído. Mesmas URLs das fotos (o CDN da INK é um bucket sem redimensionamento: cada foto é um WebP de ~54 KB, 800×820), com `loading="lazy"`; abrir a foto depois a tira do cache.
- **Vídeo:** nenhum produto amostrado tinha vídeo; se houver, a miniatura recebe "Vídeo N de M" e um selo ▶, sem suporte novo.

## 3. Desligamento do tema — diagnóstico e correção

**Suspeita do diff, confirmada.** No código da rodada 2, `theme-ui` ligava os comportamentos olhando só `FEATURES` (do deploy). Reprodução:

- **Teste de DOM** (o teste novo rodado contra o commit da rodada 2): com a PDP desligada na página, os observadores da PDP montavam. Os dois testes de regressão falham no código antigo ("sem observadores da PDP") e passam no novo.
- **Navegador real**, prévia do commit da rodada 2 com a PDP desligada no painel: o `<html>` recebia a classe `o-gal-count` e o contador era inserido na galeria **sem estilo** (o "1 / 17" aparecia solto sobre a INK nativa). Com a rodada 3, no mesmo cenário: sem contador nem miniaturas, sem classes, ordem nativa e pontos visíveis.
- `themeSyncAttribute()` repunha o atributo a partir de um `<link>` que o Turbo podia manter. Esse caminho foi **removido**.

**Correção:**
- O Worker escreve `data-origens-theme` no **`<body>`** de cada resposta, conforme o painel publicado. O Turbo troca o `<body>` a cada visita, então o atributo é sempre o da página atual. O CSS inteiro passou a ser escopado por `body[data-origens-theme~=…]`; um `<link>` antigo no `<head>` fica inerte.
- `theme-ui` só atua com **feature do deploy E** a superfície no `<body>`. Ao desligar, sai tudo: miniaturas, classes `o-thumbs`/`o-cta-inview`/`o-choosing`/`o-typing`, `--o-gal-top`/`--o-thumbs-h`, observadores, listeners, e os blocos reposicionados voltam ao lugar.
- **Voltar pelo cache do Turbo** restaura o `<body>` antigo sem requisição. `theme-ui` guarda o último estado vindo da **rede**; numa restauração (`turbo:visit` com `action: "restore"`), o atributo do `<body>` restaurado é corrigido para ele. Coberto por um teste de regressão próprio e pela verificação no navegador.
- **Quando vale:** a configuração publicada chega ao Worker em até ~1 min (60 s no storefront + 60 s por isolate do Worker). Toda página buscada depois disso, inclusive por visita Turbo, já vem certa. Uma página **já aberta** só muda na próxima navegação ou recarga. Não há polling.

**Evidência, navegador real** (`evidence/tema-fluxo-ink/rodada-3/qa-desligamento.txt`): **21/21 + 6/6**.

| Cenário | PDP | Carrinho | Checkout |
|---|---|---|---|
| Tudo ligado | ligada (Hanken, 17 miniaturas, ordem do tema) | ligado (440 px, Hanken, vazio nosso) | ligado (atributo, assinatura, sem loader) |
| Tudo desligado no painel, features no deploy | **nativa** (Poppins, pontos, ordem nativa, sem classes) | **nativo** (390 px) | **nativo** |
| PDP desligada, carrinho ligado | nativa | ligado | ligado |
| PDP ligada, carrinho desligado | ligada | nativo | ligado |
| Checkout desligado | ligada | ligado | nativo |
| Features de tema ausentes no deploy (painel tudo ligado) | nativa | nativo | nativo |
| Só `theme-cart` no deploy | nativa | ligado | nativo |
| **Mudança no meio da sessão:** PDP ligada → painel desliga → visita Turbo / voltar (cache) / recarregar → religar | desligada nas três; volta ao religar, uma grade só | — | — |

## 4. Matriz de verificação

| Item | Situação | Justificativa |
|---|---|---|
| Miniaturas: todas as fotos, ordem e URLs nativas, 6/8 por linha, sem rolagem lateral, alvos ≥ 44×44 | **Validado localmente** (INK real + Worker local) | 360, 375, 390, 768, 1440 e 1440×680; 3, 5, 17 e 19 fotos |
| 1ª, intermediária e última miniatura; seta nativa; teclado (foco + Enter, anel visível); swipe sintético | **Validado localmente** | Swipe por eventos de toque sintéticos; a miniatura acompanha o que a INK fizer |
| Foto intermediária → troca de modelo/cor | **Validado localmente** | A INK pula para a foto da variante; a miniatura acompanha; a variante é a dos rádios |
| Zoom e retorno (computador) | **Validado localmente** | Seleção e grade intactas |
| Desktop baixo (680 px): últimas miniaturas | **Validado localmente** | `--o-gal-top` −273 px; a última fica visível no fim da coluna |
| Produto com uma foto | **Validado localmente (DOM)** | Nenhum produto com foto única entre ~60 PDPs varridas; teste de DOM cobre (sem grade, pontos intactos) |
| Variante indisponível e tamanho invalidado | **Validado localmente** | 4G na Clássica → Baby Look: a INK limpa o tamanho; "P" indisponível tracejado e riscado |
| Turbo (sem recarregar o documento) para outra PDP, voltar (cache), avançar, atualizar | **Validado localmente** | Uma grade, fotos do produto certo, uma seleção. **Correção de honestidade:** nas rodadas 1 e 2 o "Turbo" do QA era um clique em link de recomendação que fazia **carga inteira** (o harness só passava documentos pelo Worker); agora é `Turbo.visit` de verdade |
| Ordem de Tab/Shift+Tab na compra | **Validado localmente** | modelo › cor › tamanho › Guia › Informar › quantidade › CTA › prazo › outros tipos. "Ver cupons disponíveis" é um `<a>` da INK **sem `href`**: não recebe foco nem na INK nativa (limitação nativa) |
| Liga/desliga por superfície, deploy × painel, mudança no meio, cache do Turbo | **Validado localmente** | §3 |
| Erros de JS | **Validado localmente** | Nenhum nosso. Após visita Turbo, a INK lança `Identifier 'buttons'/'eventIDViewContent' has already been declared` (scripts inline reexecutados): **igual com o tema desligado** |
| Pedido abortado do prazo de entrega | **Corrigido e validado** | Mover o frame de prazo enquanto a INK o carregava abortava o `GET /usesul/delivery_estimates`; agora frame `busy` não é movido |
| Checkout contato/entrega e pagamento (visual, campos, botões, sem rolagem lateral) | **Validado com resposta real (GET)** | Carrinho de teste do dono, só leitura; sem capturas nesta rodada (dados pessoais) |
| Parcelas | **Validado com resposta real** | A INK renderiza 1x–5x sem juros para este carrinho (5x de R$ 114,88 = total R$ 574,40); trocar a parcela não dispara pedido |
| Alternar Pix/cartão: campos e detalhes abertos | **Validado localmente** | Interface ok |
| Recálculo de desconto ao alternar Pix/cartão | **Bloqueado** | O clique dispara `POST /checkout/payment_discount/<id>`, abortado pela trava para não alterar o carrinho de teste do dono |
| Cobrança diferente da entrega (campos) | **Validado localmente** | Campos abertos e estilizados; nada digitado |
| Contato/entrega: validações com resposta, continuidade, retorno para editar | **Bloqueado** | Os campos salvam sozinhos por POST (`/checkout/buyer`, `/shipping_address`); preservar os dados do dono e não ir além da finalização |
| Adicionar, alterar quantidade, remover, esvaziar, vários itens, pós-adição | **Bloqueado** | Política de permissões da ferramenta negou "adicionar ao carrinho real" (rodada 1, "Real-World Transactions"); não foi tentado de novo por nenhum meio. A **simulação** da rodada 2 continua só simulação |
| Cupom válido/inválido, CEP/frete e opção de entrega | **Bloqueado** | Exigem POST no carrinho/checkout |
| Teclado virtual (iOS/Android) | **Não testado** | Sem dispositivo; só emulação (classe `o-typing` em jsdom e Chrome) |
| Pagamento e criação do pedido | **Não testado** | Fora do escopo: `process_payment` cria o pedido |

## 5. Testes

| Suíte | Resultado |
|---|---|
| Worker `npm test` | **559/559** (inclui 10 casos novos do theme-ui: miniaturas, ordem do DOM, frame carregando, desligamento pelo painel, Turbo, cache do Turbo, feature ausente) |
| `qa-galeria-tema.mjs` (galeria, foco, Turbo) | **141/141** |
| `preview-tema.mjs --qa` (larguras, barra fixa, Esc, Turbo real, checkout só CSS, campos e botões) | **66/66** |
| `qa-desligamento-tema.mjs` | **21/21** + **6/6** (mudança no meio) |
| `estados-tema.mjs` (matriz da rodada 2 refeita) | sem regressão: faixa superior sem sobreposição, símbolo + nome no cabeçalho, variantes, modais, carrinho vazio |

### Roteiro manual (o que segue bloqueado)

```bash
cd ~/projects/use-origens-workers-tema
PW_PATH=$HOME/projects/useorigens node scripts/preview-tema.mjs --headed --allow-cart   # computador + celular; só o carrinho liberado
```

1. Na PDP, clicar numa miniatura intermediária, depois escolher Clássica + Branca + M: a foto e a miniatura vão para a branca. **Adicionar ao carrinho** e conferir no carrinho: produto, **Branca**, **Clássica**, **M**, quantidade 1.
2. Carrinho: `+` (total muda com a resposta da INK), lixeira, esvaziar ("Seu carrinho está vazio" + "Encontrar minha cidade"), adicionar de novo. Com 4+ itens: o primeiro e o último itens alcançáveis, "Descubra outras estampas" depois dos itens, "Finalizar compra" sempre visível.
3. Cupom inválido (`TESTE`): mensagem da INK. CEP de teste (ex.: `01310-100`): frete e total.
4. **Parar aqui.** O checkout da prévia aborta qualquer POST; validar contato/entrega com resposta real exige um carrinho de teste próprio na loja real, preenchido à mão, **sem** clicar em "Finalizar compra".

## 6. PRs, commits, prévia e reversão

- PRs: worker-lojas #24, useorigens-storefront #83 (sem mudança nesta rodada). Commit da rodada 3: ver o comentário no PR #24.
- Prévia: o comando acima; capturas e QA: os scripts da seção 5 (`--shots`, `--qa`).
- Reverter: painel (por superfície, ~1 min para páginas novas), `WIDGET_FEATURES` sem a feature, `wrangler rollback`, rotas do checkout. Sem o tema, galeria, ordem e flutuantes voltam ao nativo; nada fica guardado.

Evidências: `evidence/tema-fluxo-ink/rodada-3/` — `comparativo-galeria-desktop.jpg` e `comparativo-galeria-celular.jpg` (rodada 2 × rodada 3 × tema desligado), `galeria-poucas-e-muitas-fotos.jpg`, `galeria/` (todas as larguras, selecionada, desktop baixo no fim da coluna), estados da PDP e do carrinho vazio, logs `qa-galeria.txt`, `qa-geral.txt`, `qa-desligamento.txt`. **Checkout sem capturas nesta rodada** (só descrição), como pedido.

**Pendente para considerar o fluxo pronto:** a validação real do carrinho (adicionar, editar, cupom, frete) e do contato/entrega/pagamento até antes da finalização, feita pelo dono ou com permissão explícita; as duas rotas do checkout (PR próprio); deploys na ordem storefront → painel → Worker.
