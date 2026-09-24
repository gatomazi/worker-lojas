# Fase 4 — Carrinho da INK: descoberta no drawer + leitura + espelho para o storefront

Data: 2026-09-24/25. Branch `feature/ink-loader-fase2a`. Commits **só locais** (sem push, sem merge). Tudo restrito a `/usesul/product/serra-catarinense`.

## Estado de produção (leia primeiro)

> **STATUS DO DEPLOY: `__DEPLOY_STATUS__`**
>
> Produção verificada antes do deploy: Worker `use-sul-widget`, health `version 3.0`, `widget_features = return-link, post-add-discovery, city-search`, allowlist de 1 caminho. O `wrangler` estava deslogado; a publicação exige o login OAuth do proprietário.

Comando pronto (com rollback automático): `bash scripts/rollout-cart.sh`.

## 1. Auditoria técnica do carrinho da INK (P3)

Sessão anônima descartável, janela visível, só observação (`scripts/cart-audit.mjs`; dumps em `docs/evidence/cart/`). Valores de cookie/CSRF nunca foram registrados.

### Como a INK expõe o carrinho

| Pergunta | Resposta (comprovada) |
|----------|-----------------------|
| Existe endpoint GET para o carrinho atual? | `GET /usesul/cart` responde **200 com sessão** (404 sem itens/sessão), mas é o **fragmento do drawer sem layout/CSS** (ao navegar, aparece um ícone de sacola gigante sem estilos). **Não é uma página de carrinho utilizável.** Não há JSON |
| O drawer é carregado por Turbo Frame? | **Sim.** `turbo-frame#cart` é **renderizado pelo servidor em toda página** e **atualizado** por Turbo a cada mutação. O drawer é `div.cart-drawer` (fixo, `z-50`, classe `open` quando aberto) |
| O HTML já contém os dados? | **Sim**, estruturados (abaixo). Não é preciso nenhuma chamada extra |
| Existe estado JavaScript global? | Não foi encontrado: os dados vêm dos `data-*` do Stimulus (`ink-store--cart`, `ink-store--progress-bar`) no DOM |
| O carrinho pode ser reconstruído só do DOM? | **Sim**, de forma estrutural (sem raspar texto solto) |
| Fonte mais estável | `turbo-frame#cart` (DOM): existe em toda página, é atualizado pela própria INK após cada mutação e tem atributos de dados. Alternativa: `GET /usesul/cart` (mesma estrutura, útil só como leitura "fresca") |
| Como detectar alterações? | `MutationObserver` no subárvore do frame + eventos Turbo (`turbo:frame-load`, `turbo:before-stream-render`); o header `#quantity-header[data-quantityheader]` muda a cada alteração |

### Mapa de rede e semântica (todos com CSRF, todos `POST` via `_method=put`)

| Ação | Requisição | Resposta |
|------|-----------|----------|
| Adicionar | `POST /usesul/cart?product_id=…` (frame `cart`; corpo: `product_v2_id`, `product_variant_id`, `style`, `color`, `size`, `quantity`) | `text/vnd.turbo-stream.html` (atualiza `turbo-frame#cart` e `#last_added_product`) + `GET /usesul/cart/most_solds` |
| Quantidade +/− | `POST /usesul/cart/item` (`cart_item[id]`, `cart_item[quantity]`) | HTML do frame `cart` |
| Remover | o "−" com quantidade 1 (ícone de lixeira) faz o mesmo `POST /usesul/cart/item` até 0 | estado vazio (`.empty-cart`) |
| Abrir drawer | ícone `#shopping-cart-menu-desk` / `#shopping-cart-menu-mob` (`ink-store--drawer#openDrawer`) **ou** "Ver carrinho" do modal pós-adição (`ink-store--product-modal#openCart`, **não navega**) | só classe `open` no `.cart-drawer` |
| Finalizar compra | `button#checkout-btn` dentro de `form[action="/usesul/cart/checkout_cart_items"][method=post][data-turbo=false]` com `authenticity_token` e eventos de tracking (`finish_cart_click`, "Checkout Started") | `302` → `GET /usesul/checkout/contact_and_shipping_details` (mesmo host, mesma sessão) |

### Campos que conseguimos obter (DOM)

`#quantity-header[data-quantityheader]` (quantidade total) · por item (`li.main-list__item`): `form[data-ink-store--cart-product-id-value]` (id do produto), `…-product-variant-value` (ex.: `Preta-Masculino-M`), `…-id-value` (id do item), `.item-details p` (nome, cor, tamanho), `input[name="cart_item[quantity]"]`, `.price-details` (**preço efetivo da linha**, já × quantidade; **com promoção por quantidade** o preço cheio vem riscado em `<span><del>…</del></span>` e o efetivo em outro `<span>`), `img[src]` (CDN da INK) · rodapé: `.footer-details[data-ink-store--cart-subtotal-value|discount-value]` (subtotal = soma dos preços cheios; desconto) e o **Total exibido** como texto (`<p>Total</p>` + valor). **Frete:** não aparece sem CEP. O espelho **lê** o total exibido, **nunca calcula** preço, desconto ou frete.

### Estrutura visual do drawer (base do posicionamento)

`div.cart-drawer.open` (fixo; **desktop:** painel de 390 px à direita, altura total; **mobile:** tela cheia) → `turbo-frame#cart` → coluna: `header` (48 px) · `.cart-drawer__main` (**flex em LINHA, `overflow-y:auto`**, único filho `ul.flex-col`) · `.cart-drawer__footer` (cupom, CEP, subtotal, total e o form do checkout, ~249 px, estático) com `#checkout-btn` visível na base. Vazio: `.empty-cart` (recomendações + "Continuar Comprando"). Capturas "antes": `docs/evidence/cart/before-cart-*.jpg`.

### Conclusão de P3

**O conteúdo do carrinho pode ser lido com segurança e de forma estrutural a partir de `turbo-frame#cart`.** Confiável enquanto a INK mantiver esse markup; se mudar, `readCart()` devolve `null` e nada é espelhado (falha segura). **Limite inevitável:** o loader só roda na página autorizada, então mudanças em outras páginas da INK só são vistas quando a pessoa volta à Serra.

## 2. P1 — Descoberta no drawer do carrinho (`cart-discovery`)

Feature `cart-discovery` (fail-closed). Bloco **compacto** "Procurar outra cidade / Continue escolhendo sem perder seu carrinho." com **[Buscar cidade ou estado]** (abre o painel de busca no toque) e **[Explorar vitrine]** (→ `https://useorigens.com.br/sul`). Reusa integralmente o gateway `/__origens/search`, o ranking e o índice do storefront (placeholder "Busque cidade ou estado"); no carrinho mostra **no máximo 3 resultados**, com "Fechar busca" que restaura o layout.

**Posição:** dentro do `ul` dos itens (`li[role=none]`, `flex:0 0 auto`), **na área rolável** e **nunca no rodapé**. **1–2 itens:** no fim da lista, abaixo dos itens. **3 ou mais itens:** no **topo** da lista, em versão **densa** (`o-dense`: sem texto de apoio, ações numa linha) — medido com 8 variantes, no fim da lista o bloco ficava ~940 px abaixo da dobra de uma área de 471 px, praticamente invisível. Descoberta importante: `.cart-drawer__main` é flex em linha e um irmão do `<ul>` **espremia o item** (preço cortado); o QA visual pegou isso e o bloco foi movido para dentro do `ul`. O rodapé (cupom, CEP, totais) e o `#checkout-btn` **não são tocados** e nunca mudam de posição (medido). Carrinho vazio: o bloco entra no `.empty-cart`, antes das recomendações.

Abertura: pelo ícone **e** por "Ver carrinho" (ambos só adicionam a classe `open`; a detecção observa essa classe e o subárvore do drawer). Remonta idempotente a cada re-render do frame (quantidade/remoção); desmonta ao fechar e ao sair da rota.


### 2.1 Carrinho com muitos itens (8 variantes diferentes da Serra)

Pergunta do proprietário depois da primeira versão: "teve teste com 8 itens diferentes?". **Não**: todos os testes anteriores tinham 1 linha. Refeito com `scripts/qa-cart-many.mjs` (8 combinações de modelo/cor/tamanho da Serra = 8 linhas; sessão anônima; Worker/KV locais), que encontrou **dois problemas reais** (ambos corrigidos):

1. **Bloco invisível:** no fim da lista de 8 linhas ele ficava ~940 px abaixo da dobra ⇒ regra "3+ itens ⇒ topo, denso" (acima).
2. **Preço errado no espelho:** com 3+ peças a INK aplica **promoção por quantidade** ("LEVANDO 3 PEÇAS: R$ 25 OFF | 4 PEÇAS: R$ 40 OFF | …"): cada linha mostra o preço cheio **riscado** e o efetivo, e o rodapé mostra "Desconto". O leitor pegava o primeiro `<span>` (o **riscado**). Corrigido: `linePriceText` = preço efetivo; `listPriceText` = cheio (opcional); `total`/`totalText` = total **exibido** pela INK. Validado: subtotal, desconto e total do snapshot **iguais** aos da INK (subtotal 769,30 · desconto 85,00 · total exibido R$ 684,30, com 7 linhas riscadas de 7).

Resultado com 8 variantes (desktop 1280 e mobile 390: **14/14** cada; 320×640: **14/14**): 1 bloco no topo da lista e visível **sem rolar**; a lista rola dentro do painel de itens (`mainScroll` 1044/471 no desktop) e o **rodapé com "Finalizar compra" fica imóvel e visível**; item nativo não espremido (largura igual com e sem o bloco); busca aberta com resultados utilizável; quantidade `+` na 1ª linha (re-render do frame com 8 itens) mantém 1 bloco; remover uma linha pela lixeira nativa ⇒ 7 itens, 1 bloco; **espelho com 7 itens idêntico ao carrinho real** (nome, cor, tamanho, quantidade, preço efetivo, preço cheio, variante) e 7 variantes distintas preservadas. A 320×640 o rodapé promocional da INK (banner de cupom em várias linhas) deixa só **211 px** para os itens: o bloco cabe acima da dobra, e com a busca aberta o campo e o 1º resultado ficam utilizáveis (o painel rola); o checkout permanece visível e imóvel. Limite do snapshot: **20 itens** (testado: 12 aceitos, 21 recusados).

## 3. P2 — Página de produto (avaliação; sem mudança)

Mantido o link **"← Voltar a procurar"** (já abaixo do CTA nativo, com alvo de toque ≥ 44 px no mobile). **Não** adicionei uma busca na página do produto: ela competiria com o CTA de compra (o briefing pede solução "discreta e subordinada"), e a jornada já oferece busca **depois** da adição (drawer pós-adição) e **no carrinho**. Recomendação: medir o uso do link e do bloco antes de decidir por uma busca inline; se for feita, deve ser o mesmo componente (`createSearchBlock`) recolhido por padrão.

## 4. P4/P5 — Espelho do carrinho e ponte INK → storefront (`cart-mirror`)

**Implementado do lado do Worker/loader e testado; DESLIGADO em produção.** O consumidor no storefront **não** foi alterado (outro repositório; publicar exigiria push/deploy fora do escopo). Contrato completo em [`storefront-cart-mirror-contract.md`](storefront-cart-mirror-contract.md).

- **Leitura:** `readCart()` (módulo `cart-mirror`) lê o DOM estrutural acima; snapshot v1 com produto, nome, variante, cor, tamanho, quantidade, preço da linha, imagem (só CDN da INK), subtotal/desconto. Sem cookies, CSRF, sessão ou dados pessoais.
- **Ponte (opção A, token opaco):** `POST /__origens/cart-ref` (só a página autorizada; Origin/Referer/JSON/esquema validados) guarda o resumo no KV `CART_REFS` por **30 min** sob um token de **128 bits**; `GET /__origens/cart-ref/<ref>` é lido pelo **servidor** do storefront (sem CORS, `no-store`). Sem o binding KV a feature responde `501 not_configured` e nada é gravado.
- **Sincronização:** debounce de 800 ms depois de qualquer mudança do carrinho; **um token novo por snapshot** (imutável). Só links **nossos** para `/sul` ganham `?cart_ref=` (no clique). Snapshot vazio limpa o espelho.
- **Risco de estado desatualizado:** **existe** e é inerente (ver P3). O storefront deve rotular "Última atualização há X min" e nunca "tempo real".
- **Validação ponta a ponta (navegador real + INK real + Worker/KV locais, `scripts/qa-mirror.mjs`): 15/15** — adicionar → 1 snapshot que **bate com o carrinho real** (nome, cor, tamanho, qtd, preço, imagem); link "Explorar vitrine" ganha `?cart_ref=`; storefront real abre (200); voltar à INK na mesma sessão; mudar quantidade → novo snapshot (2 × R$ 109,90); o token antigo continua mostrando o estado antigo (não é tempo real); remover → snapshot vazio; nenhum POST levou Cookie.

## 5. P6 — "Finalizar compra" a partir do storefront (investigado; NÃO reproduzido)

| Pergunta | Resposta |
|----------|----------|
| Existe URL GET estável para abrir o checkout do carrinho atual? | O botão faz `POST /usesul/cart/checkout_cart_items` (CSRF, `data-turbo=false`, tracking) → `302` → `/usesul/checkout/contact_and_shipping_details`. Um `GET` direto nessa URL respondeu **200** numa sessão com carrinho, mas é comportamento **não documentado**, pula o fluxo e o tracking da INK e pode depender de estado criado pelo POST |
| O botão faz POST? | **Sim**, com token CSRF |
| Depende da sessão de `www.usesul.com.br`? | Sim (mesma sessão/host); a sessão já é preservada na ida e volta ao storefront |
| Rota de carrinho mais segura? | **O drawer nativo.** `GET /usesul/cart` **não** serve (fragmento sem layout) |

**Decisão (regra do briefing):** dependência de POST, CSRF e lógica interna ⇒ **não reproduzir**. O storefront **não** terá "Finalizar compra". O botão será **"Ir para meu carrinho"**, que abre o **drawer nativo** da INK: `https://www.usesul.com.br/usesul/product/serra-catarinense?origens_open_cart=1`. O loader (feature `cart-discovery`) entende esse parâmetro **somente na página autorizada**: ativa o botão nativo do carrinho (≤ 8 tentativas em ~4 s), remove o parâmetro da URL e não altera o carrinho. Validado no navegador real em 6 viewports.

## 6. Arquitetura e flags

`src/loader/`: `runtime`, `return-link`, `discovery-loader`, `drawer-watch` (pós-adição), `cart-watch` (carrinho), `cart-mirror`, `discovery-ui` (blocos + busca, sob demanda). Worker: injeção por allowlist, `discovery.js`, `/__origens/search`, `/__origens/cart-ref*`. Loader **4.0**. `WIDGET_FEATURES` aceitas (todas fail-closed; nome desconhecido descarta a lista): `return-link`, `post-add-discovery`, `city-search`, **`cart-discovery`**, **`cart-mirror`**. (`checkout-bridge` **não** foi criada: nada a habilitar.) Ver [`architecture-loader.md`](architecture-loader.md).

Melhoria de resiliência descoberta no caminho: o gateway de busca **continua buscando o índice do storefront em segundo plano** (teto 10 s, `ctx.waitUntil`) se ele estiver lento, em vez de abortar aos 3 s e nunca aquecer o cache (o visitante ainda espera no máximo 3 s e cai no fallback).

## 7. Testes

### Locais (nesta máquina) — `npm test`: **190 testes, 190 aprovados, 0 falhos, 0 ignorados**
137 anteriores + `cart-discovery.dom` (24, incluindo 3–12 itens), `cart-mirror.dom` (10, incluindo promoção), `cart-ref.unit` (12), `cart-ref.workerd` (6) e ajustes do gateway. Cobrem: mount/unmount, posição fim/topo conforme o nº de itens, drawer aberto por ícone e por "Ver carrinho", re-render do frame, fechamento/reabertura, observer idempotente (25 mutações → 1 bloco), mudança de quantidade, remoção, carrinho vazio, 1 e vários itens, busca sem resultado e falha do gateway, altura baixa, Turbo, carga direta fora da Serra, gating por flag, rodapé/checkout byte a byte idênticos, intenção de abrir o carrinho (limitada), schema/token/TTL/rate limit/Origin/Referer do `cart-ref`.

### Navegador real (INK real + Worker local em `/__origens/*`; sessão anônima; janela visível) — `scripts/qa-cart.mjs`

**29/29 em cada um dos 6 viewports: 1440, 1280, 768, 440, 390, 320×640.** Em cada tamanho: "Finalizar compra" visível e no **mesmo** lugar (rodapé imóvel); item nativo **não** espremido; nosso bloco não altera contagem/subtotal; sem overflow novo; busca acessível (Enter, setas, 3 resultados); com resultados o checkout continua visível; fechar a busca restaura a altura; quantidade nativa com re-render; ida ao storefront e volta na mesma sessão com carrinho idêntico; Turbo com drawer aberto → 0 UI fora da Serra; carrinho vazio; intenção `?origens_open_cart=1`; console sem erro nosso.

Falhas encontradas e corrigidas pela própria QA: (1) bloco espremia o item (flex em linha) → movido para dentro do `ul`; (2) botão "Buscar" continuava visível com o painel aberto (`display:flex` vs `hidden`) → CSS; (3) 320×640 criava barra de rolagem no item → modo compacto em telas baixas. Erro **meu de método** (corrigido): a primeira rodada de "440/768/1440/320" usou argumentos inválidos e rodou em 1280; foi descartada e refeita com os argumentos certos.

### Limitação preexistente da INK (não causada por nós)
Depois de navegação Turbo entre produtos, o **ícone do carrinho mobile não abre o drawer** (o controller Stimulus da INK falha ao conectar: `Error connecting controller TypeError…`). Reproduzido em produtos **sem** o Worker. A QA recarrega a página nesse passo. Também preexistem `Identifier 'buttons' has already been declared` e `Identifier 'eventIDViewContent' …`.

### Edge / produção
`__EDGE_RESULTS__`

## 8. Evidências

`docs/evidence/cart/` (inclui `after-cart-many-*` com 8 itens em desktop, mobile e 320): **antes** — `before-cart-desktop.jpg`, `before-cart-mobile.jpg`, `before-cart-empty-desktop.jpg`, `before-cart-open-by-ver-desktop.jpg`, `before-cart-page-desktop.jpg` (o fragmento sem layout de `/usesul/cart`), `drawer-desktop.json`, `item-outerhtml.txt`. **Depois (build local sobre a INK real)** — `after-cart-drawer-*`, `after-cart-search-open-*`, `after-cart-search-results-*`, `after-cart-search-empty-*`, `after-cart-search-error-*`, `after-cart-empty-*` em `desktop` (1280), `mobile` (390), `w1440`, `w768`, `w440`, `w320`. Conferidas visualmente; sem dados pessoais.

## 9. Respostas objetivas

- **Como a INK expõe o carrinho?** `turbo-frame#cart` no DOM (server-rendered + Turbo), sem JSON; mutações por `POST` com CSRF.
- **Fonte escolhida / confiável?** `turbo-frame#cart`; confiável enquanto o markup existir; falha segura (`null`) se mudar.
- **Campos obtidos?** produto, nome, variante, cor, tamanho, quantidade, preço efetivo da linha, preço cheio riscado (quando há promoção), imagem, subtotal, desconto, **total exibido pela INK** (lido, não calculado) e quantidade total. Sem frete (não aparece sem CEP).
- **Detecção de mudanças?** `MutationObserver` + eventos Turbo; só na página autorizada.
- **Cart mirror implementado / como sincroniza?** Worker + loader + KV sim (testado ponta a ponta local); **desligado**; sincroniza por token novo a cada mudança (debounce 800 ms), TTL 30 min. **Storefront não alterado.**
- **Risco de estado desatualizado?** Sim (inerente); rótulo de idade obrigatório.
- **"Finalizar compra" reproduzível no storefront?** Não: POST+CSRF+tracking; usar "Ir para meu carrinho" (drawer nativo).
- **Botão nativo continuou visível?** Sim, nos 6 viewports, na mesma posição.
- **Outros produtos intactos?** Sim (testes locais + Turbo com drawer aberto no navegador real; verificação em produção depois do deploy).

## 10. Rollback

Desligar só o carrinho (mantém link, drawer pós-adição e busca): `npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense --var WIDGET_FEATURES:return-link,post-add-discovery,city-search`. Versão anterior: `npx wrangler rollback --name use-sul-widget`. Tudo desligado: o mesmo deploy **sem** `--var`. Depois: conferir `/__origens/health` e 0 `data-origens-discovery="cart"`. Nunca desligar o proxy do `www` como primeira ação.

## 11. Commits locais desta fase

`b5d912c` (cart-discovery, cart-mirror/cart-ref, auditoria e QA) e `1107436` (modo compacto, intenção de abrir o carrinho, loader 4.0, contrato, evidências de 6 viewports); commit da documentação: ver `git log`.
