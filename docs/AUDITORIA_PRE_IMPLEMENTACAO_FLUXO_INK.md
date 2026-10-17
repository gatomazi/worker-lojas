# Auditoria pré-implementação — fluxo INK (rodada 2)

Data: 15/10/2026. Base: tema da rodada 1 (`feature/tema-fluxo-ink`, commit `190b87b`) nas páginas REAIS da INK, servidas pelo Worker local (Miniflare, mesmo `worker.js`/HTMLRewriter/loader de produção) — `scripts/estados-tema.mjs`. Para comparação, a mesma matriz com o tema desligado (INK nativa) e depois da rodada 2. Produto: `florianopolis-legado-sc` (Sul). Viewports: computador 1440×900 e celular 390×844 (emulação Chrome/Playwright, **não** dispositivo real). Dados brutos: `evidence/tema-fluxo-ink/rodada-2/estados-{ink-nativa,rodada-1,rodada-2}.json`.

**Ferramentas:** referência Bendita Fé no **Claude in Chrome** (computador; só leitura, sem clicar em compra). O redimensionamento da janela do Chrome não pegou (a janela manteve 1920 px), então o celular da referência foi capturado com Playwright (só GET; qualquer outro método abortado). Nossas superfícies: Playwright com o harness da prévia.

**Origem de cada componente:** **INK** = nativo, só estilizado; **nosso** = widget do Worker (loader). O DOM nativo nunca é movido; reordenações são `order` no mesmo pai flex.

## Estados acessados e bloqueios

| Ação | Situação | Motivo |
|---|---|---|
| Abrir PDP, trocar modelo/cor/tamanho, abrir modais de medidas, prazo, cupons, zoom, "Informar medidas", carrinho vazio | **Testado** (navegador, INK real) | Só cliques do lado do navegador e GETs |
| Checkout contato/entrega e pagamento (carrinho de teste do dono) | **Testado por GET**; foco em campo sem digitar | Dados do dono preservados; nada digitado |
| Escolher Cartão/Pix, abrir campos do cartão e o endereço de cobrança | **Testado no navegador**; o clique no Pix dispara `POST /checkout/payment_discount/<id>` que a trava **abortou** (4 vezes, registradas) | Nenhum POST do checkout chega à INK |
| Adicionar ao carrinho, alterar quantidade, remover, carrinho com vários itens, pós-adição | **Bloqueado** — `POST /usesul/cart` abortado pela trava; adicionar ao carrinho real foi **negado pela política de permissões** desta ferramenta na rodada 1 ("Real-World Transactions") e não foi contornado | Ver "Simulação" e o roteiro manual no relatório |
| Cupom válido/inválido, CEP/frete com recálculo | **Não testado** — exige POST no carrinho/checkout | Roteiro manual |
| Finalizar compra | **Não executado** (nem em teste): `POST /checkout/process_payment` cria o pedido | Regra do dono: não ir além |
| Teclado real iOS/Android | **Não testado** (só emulação) | Sem dispositivo |

**Simulação** (marcada nas capturas): carrinho com 4 linhas e pós-adição reconstruídos a partir das classes do CSS da INK e injetados no próprio `turbo-frame#cart` da PDP real (`scripts/simulacao-carrinho.mjs`). Serve para aparência; não prova integração.

## Matriz (problema → decisão)

| Componente (origem) | Ação / estado | Viewport | Problema encontrado (rodada 1) | Decisão (rodada 2) | Evidência |
|---|---|---|---|---|---|
| Faixa superior (INK) | animação de 16 s, 9 s amostrados a cada 150 ms | ambos | **2 mensagens visíveis e sobrepostas em 14–15 de 60 quadros** (nativo: idem). Persistente, não é artefato de captura: as três animações nativas se cruzam | Animação nossa com a mesma duração, um terço por mensagem, a seguinte entra depois que a anterior sai; só com exatamente 3 mensagens. Resultado: **0/60** | `estados-*.json` (Faixa superior) |
| Cabeçalho (nosso header-nav) | carregar | celular | Só o símbolo: o `header-nav` escondia "USE ORIGENS" no celular; a fonte da palavra nem era carregada na INK | Símbolo 34 px + "USE ORIGENS" em Big Shoulders Display (carregada com o tema); menu, busca e carrinho intactos | `mobile-01-pdp-topo` |
| Título/compartilhar/avaliações (INK) | carregar | celular | Três linhas empilhadas antes da foto; foto começava em y=307 | Título numa linha, compartilhar + avaliações compactas na de baixo; foto em y≈241 | `mobile-01-pdp-topo` |
| Galeria (INK) | carregar | ambos | 17 pontos de 12 px (passavam de 390 px); fotos são as cores da variante, não fotos complementares | Imagem única mantida (duas lado a lado mostrariam cores erradas); **computador: galeria fixa (sticky)** enquanto a compra rola; contador "1 / 17" lido dos próprios pontos da INK (some se o estado não for confiável e os pontos voltam); setas discretas | `desktop-03`, `mobile-01` |
| Galeria (INK) | trocar cor | ambos | — | Imagem e contador acompanham a cor (Branca → 4/17) | `desktop-03-variantes-escolhidas` |
| Seletores (INK) | sem escolha / escolhidos | ambos | Todos os chips com borda preta de 2 px e peso alto: nada se destacava; tamanhos em 2 linhas no celular | Linha fina (tinta 16%) no normal; escolhido cheio na cor da região; indisponível tracejado; modelo em 2 colunas iguais; tamanhos em grade que ocupa a linha (7 em 390 px, ≥ 44 px) | `*-02`, `*-03` |
| Seletores (INK) | 4G na Clássica → Baby Look | ambos | — | A INK **limpa** o tamanho que não existe no outro modelo (e some o 4G); variante volta a pendente. Mantido nativo | `*-04-troca-invalida-tamanho` |
| Guia de medidas (INK) + Informar medidas (nosso) | rolar até eles | celular | Dois botões largos; **WhatsApp cobria "Informar medidas" e o "Ajuda" cobria a borda do CTA** (rodada 1, captura `mobile-02` da rodada 1) | Dois links de ação lado a lado, logo abaixo do tamanho; flutuantes (Ajuda, WhatsApp, cupons) saem do caminho enquanto as escolhas/CTA estão na tela do celular e voltam fora dela (o atendimento segue no menu) | `mobile-05-medidas-flutuantes` (r1 × r2) |
| Modal de medidas (INK), Informar medidas (nosso), prazo, cupons, zoom | abrir | ambos | Funcionavam | Sem mudança de comportamento; abrem iguais | `*-06` a `*-10` |
| Quantidade (INK) + CTA | carregar | ambos | Quantidade com borda grossa ao lado do tamanho | Quantidade discreta logo antes do CTA; CTA na largura da coluna | `*-03` |
| Prazo, cupom, "Também disponível em" (INK) | carregar | ambos | "Também disponível em" antes do modelo, com o peso das escolhas obrigatórias (y=644 desktop) | Depois do CTA e da confiança (y=1177), rótulo pequeno, chips finos; prazo e cupom como linhas discretas logo após a confiança | `estados-*.json` |
| Barra fixa de compra (INK) | rolar | celular | Ok (rodada 1) | Fica; some com o CTA à vista, teclado ou escolha; uma ação fixa só | QA |
| Recomendações (nosso) | carregar | computador | Absolutas no vão sob a galeria | Com a galeria fixa, passam a vir depois da compra (comportamento já existente do módulo) | `desktop-01` |
| Carrinho vazio (INK + nosso) | abrir | ambos | Nosso bloco "Descubra outras estampas · Continue escolhendo sem perder seu carrinho" + a frase da INK "Seu carrinho está vazio…" (duas aberturas, copy errada para vazio) | Abertura única "Seu carrinho está vazio" + **Encontrar minha cidade** (principal) + **Explorar estampas** (secundária); a frase repetida da INK some só quando o nosso bloco existe; recomendações da INK abaixo; "Continuar comprando" secundário | `*-11-carrinho-vazio` |
| Carrinho com itens (INK + nosso) | SIMULAÇÃO | ambos | Nosso bloco ia para o TOPO da lista com 3+ itens, empurrando os produtos | Sempre depois dos itens e compacto; rodapé com total em destaque e "Finalizar compra" único; miniaturas de 88 px; quantidade compacta | `simulacao/*-carrinho-*` |
| Pós-adição (INK) | SIMULAÇÃO | ambos | — | "Ver carrinho" principal, "Continuar comprando" secundário, mesma linguagem do carrinho | `simulacao/*-pos-adicao-*` |
| Cabeçalho do checkout (INK) | abrir | ambos | Só o símbolo | Símbolo + "USE ORIGENS" inserido pelo Worker no HTML (sem script); sem menu | `*-20`, `*-22` |
| Checkout contato/entrega (INK) | abrir, foco | ambos | Grupos sem separação; resumo colado à borda direita | Largura máxima 1180 px e 48 px entre colunas; linha fina entre Identificação/Entrega/Formas de entrega; resumo como superfície própria (fixo só em telas ≥ 760 px de altura) | `*-20`, `*-21` |
| Pagamento (INK) | abrir; Cartão; Pix; cobrança diferente; foco em campo vazio | ambos | Faixa "pagamento protegido" grande antes das opções, repetindo o subtítulo; "Finalizar compra" do celular com **96 px a 360 px** (o botão da barra fixa quebrava a linha) | Faixa descida para depois do botão, neutra; opção escolhida com borda forte; campos do cartão e de cobrança no mesmo estilo; mensagem de campo em vermelho AA; botão da barra numa linha (54 px em 360/375/390) | `*-22` a `*-26`, `qa-rodada-2.txt` |

## O que fica da INK, sem mudança de comportamento

Variantes, preço, imagem por variante, estoque, quantidade, adição, carrinho, cupom, CEP/frete, modais, zoom, formulários e máscaras do checkout, Pix/cartão, parcelas, cobrança, validação e "Finalizar compra" (que processa o pagamento: não há revisão depois).
