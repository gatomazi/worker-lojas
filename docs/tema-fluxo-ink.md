# Tema da compra na INK (theme-pdp, theme-cart, theme-checkout)

A PDP, o carrinho e o checkout da INK com a cara da PDP do storefront, para o cliente reconhecer a mesma loja do começo ao fim. **Só aparência.** Variantes, estoque, preço, descontos, frete, sessão, identificação, pagamento e pedido continuam com a INK: os controles nativos são os mesmos nós, com os mesmos cliques, formulários e validações. Relatório da rodada: [`RELATORIO_PERSONALIZACAO_FLUXO_INK.md`](RELATORIO_PERSONALIZACAO_FLUXO_INK.md).

## Como funciona

```text
Painel do storefront (Aparência › Tema da INK, rascunho → Publicar)
   └─ GET https://useorigens.com.br/api/ink-theme/<região>   contrato v1: interruptor por superfície + tokens #rrggbb (presets)
        └─ Worker da loja (src/theme.js), lido NO SERVIDOR, 60 s por isolate (falha = última boa por até 24 h; nunca houve = nada)
             ├─ produto e páginas de casca: <body data-origens-theme="pdp cart"> + <link /__origens/theme.css?s=pdp,cart&v=1&c=<hash>>
             ├─ checkout (contato/entrega e pagamento): <body data-origens-theme="checkout"> + <link …?s=checkout…>  — sem loader, sem JS
             └─ /__origens/theme.css: CSS da combinação pedida; hash igual = imutável por 1 ano; diferente = conteúdo atual com 60 s
```

- **Duas chaves por superfície:** a feature do deploy (`WIDGET_FEATURES`, teto técnico, opt-in em `scripts/lib/store-lib.mjs`) **e** o interruptor do painel. Qualquer uma desligada = a INK nativa naquela superfície.
- **Escopo:** todo seletor começa por `body[data-origens-theme~="<superfície>"]` (testado em `test/theme.unit.test.js`). Nenhuma regra muda `display` de algo que a INK mostra/esconde (o único `display` é no "Continuar Comprando" do carrinho vazio, um `<div>` sempre visível), nenhuma esconde preço, cupom, frete, totais ou termos, nenhuma gera texto.
- **Configuração:** só presets (botão preto ou da região, fundo claro — padrão da rodada 2, com o cinza das fotos só atrás da camiseta (token `photo`) — ou cinza do site na página inteira, cantos retos ou de 8 px, Hanken Grotesk ou Poppins). Cores vêm de `globals.css` e de `REGION_THEME` no storefront; nada digitado vira CSS. O Worker recusa o payload inteiro se uma cor não for `#rrggbb`, se o raio/fonte não for um preset ou se um par de texto não tiver contraste AA.
- **Identidade:** a da região da LOJA que o Worker atende (um Worker = uma loja = uma região). Não se deduz pelo produto: um carrinho com estampas de vários lugares mantém a mesma cara.
- **Fonte:** Hanken Grotesk via `@import` do Google Fonts no topo do CSS (a INK já carrega Poppins do mesmo serviço). Com o preset "Poppins", nenhum pedido de fonte.
- **Turbo e estado efetivo (rodada 3):** o atributo fica no `<body>`, que o Turbo troca a cada visita: é sempre o da resposta atual, conforme o painel publicado (um `<link>` antigo no `<head>` fica inerte). O `theme-ui` só atua com a feature do deploy **e** a superfície no `<body>`; ao desligar, desfaz tudo (miniaturas, classes, variáveis, observadores, ordem dos blocos). Num "voltar" restaurado do cache do Turbo vale o último estado vindo da rede. Mudança no painel: páginas buscadas depois de ~1 min já vêm certas; uma página aberta muda na próxima navegação.

## JS (só onde CSS não basta) — `src/loader/theme-ui.js`

Entra no loader com `theme-pdp` ou `theme-cart`; o checkout nunca recebe o loader.

| Comportamento | Como | Se falhar |
|---|---|---|
| Barra fixa "Adicionar ao Carrinho" do celular some com o botão principal à vista ou com o teclado aberto | `IntersectionObserver` só em `#add-to-cart-desk`; `focusin/focusout` em campos de texto | Barra fica sempre visível, como na INK |
| Toque na barra quando a INK a deixa inerte (`pointer-events-none`, antes do quadro de variantes carregar) | Rola até o quadro (lazy: carrega ao entrar na tela) ou, já carregado, foca a primeira escolha que falta e a destaca | O toque não faz nada, como hoje |
| Esc fecha o carrinho | Dispara o clique no "X" nativo (`#cart-drawer-close`); devolve o foco ao botão do carrinho | Fecha só pelo "X" |

Nada nele clica em compra, presume variante, cria item, lê carrinho, envia evento ou toca formulário. Inicialização idempotente (um observador; listeners removidos no `unmount`), testada em `test/theme-ui.dom.test.js`.

## Conta (`theme-account`)

O mesmo tema nas páginas de conta, com a superfície **Conta** do painel. O contrato aceita `surfaces.account` ausente (= desligada): o storefront anterior não manda o campo e o tema no ar segue igual.

| Página | Caminho | Como entra |
|---|---|---|
| Login | `/useorigens/store_sessions/new` | rota própria (`store_sessions/new*`; o POST `/store_sessions` não casa); **só CSS**, nenhum script nosso; "Voltar" e o símbolo levam à home do storefront |
| Compras, detalhe, rastreio | `/orders`, `/orders/<pedido>`, `/orders/trackings` | páginas de casca (rota de pedidos): `account` junto com `pdp cart`, loader e navbar como antes |
| Avaliação | `/orders/<pedido>/review/<id>`, `/orders/guest_reviews/new` | fora da casca: só CSS |
| Trocas e devoluções | `/exchanges_and_returns` | rota própria; página de **casca** (conteúdo, como "sobre"): navbar + `account` |

Com `theme-account`, as páginas da conta são pedidas à INK sem compressão (a INK entrega em brotli). Paleta "acento" também na conta.

```
bash scripts/release-tema.sh --check --add=theme-account     # avisa se a "Conta" está desligada no painel
RELEASE_CONFIRM=PUBLICAR-TEMA-INK bash scripts/release-tema.sh --deploy --add=theme-account   # cria as 2 rotas (TOML), smoke e sonda
node scripts/checkout-routes.mjs probe --conta                # login e trocas executam; POST do login, sessão, carrinho e checkout não
node scripts/checkout-routes.mjs remove --conta               # desfaz sem deploy (o próximo deploy recria pelo TOML)
PW_PATH=… node scripts/tema-conta.mjs --out docs/evidence/tema-conta   # prova visual (Compras e detalhe com estrutura real e textos fictícios)
```

## Checkout: as duas rotas da zona (`scripts/checkout-routes.mjs`)

A zona exclui `loja.useorigens.com.br/useorigens/*` do Worker (rota sem script): login, carrinho e checkout vão direto para a INK. Para o tema do checkout, **duas** rotas com o Worker, e só estas, mais específicas que a exclusão (e a da confirmação do pedido, ver abaixo):

```
loja.useorigens.com.br/useorigens/checkout/contact_and_shipping_details*
loja.useorigens.com.br/useorigens/checkout/payment_methods*
loja.useorigens.com.br/useorigens/payment_confirmation/*
```

Elas não cobrem os envios do checkout (`/checkout/buyer/…`, `/checkout/shipping_address/…`, `/checkout/process_payment`, `/checkout/payment_discount/…`), que seguem direto para a INK. Estão **declaradas no `wrangler.production.toml`**: o `wrangler deploy` apaga as rotas do Worker que o TOML não declara (medido em 17/10/2026, quando as duas tinham sido criadas só na zona). O deploy com `theme-checkout` as cria; o rollback do `release-tema.sh` as apaga com `checkout-routes.mjs remove` (o próximo deploy as recria pelo TOML).

A INK entrega as duas telas comprimidas (brotli) e um corpo codificado não pode ser reescrito: só nelas o Worker pede a página com `Accept-Encoding: identity` (a Cloudflare comprime de novo para o cliente). No Worker, o ramo do checkout só age com `theme-checkout`, em `GET` de documento inteiro (sem `Turbo-Frame`), chama `ctx.passThroughOnException()` (exceção = a Cloudflare entrega a origem) e nunca registra o caminho (o uuid do carrinho fica fora dos logs).

```
TEMA_CHECKOUT_UUID=<carrinho de TESTE> bash scripts/release-tema.sh --deploy --add=theme-checkout   # cria as rotas (TOML), liga a chave, smoke nas duas telas e sonda
node scripts/checkout-routes.mjs plan     # SOMENTE LEITURA: rotas do host e o que apply/remove fariam
node scripts/checkout-routes.mjs probe    # wrangler tail: as duas telas executam; envios, /checkout, carrinho e login NÃO (só GET)
node scripts/checkout-routes.mjs remove   # desfaz sem deploy: o checkout volta inteiro para a INK (o próximo deploy recria pelo TOML)
```

## Confirmação do pedido (`payment_confirmation`)

A página depois do pagamento (`<base>/payment_confirmation/<pedido>/<pagamento>`, os dois números) usa o **mesmo tema do checkout** (`theme-checkout`, a mesma caixa
no painel). Uma terceira rota, `loja.useorigens.com.br/useorigens/payment_confirmation/*`, está declarada no TOML e entra no grupo `checkout` do
`checkout-routes.mjs` (plan/apply/remove/probe; a sonda usa `/payment_confirmation/0/0`). O Worker trata a página como as telas do checkout: só CSS, só
GET de documento inteiro, sem `Turbo-Frame`, `Accept-Encoding: identity`, fail-open, o caminho fora dos logs. Os scripts de conversão da INK (GA4
`purchase`, GTM, os `<span>` do pedido) passam intactos (teste no workerd).

Só nela o `<body>` recebe também `data-origens-step="confirmation"`, e as regras próprias da página só valem com esse atributo (nunca nas telas do checkout):

- **Convite para criar conta.** Na INK ele fica num bloco depois da grade (confirmação | resumo), no fim da página. Com `display:contents` na grade e nesse
  bloco (contêineres que a INK nunca alterna), as peças passam a ser filhas do mesmo contêiner. No celular: confirmação › convite › resumo › selos da INK.
  No computador: a confirmação à esquerda; à direita, o resumo e logo abaixo o convite, à vista sem rolar. O convite vira um cartão em destaque (as cores
  da faixa de incentivo) com o botão principal do site. Nenhum nó é movido no DOM; quem já tem conta não recebe o bloco, e a página fica igual sem ele.
- O título, os cartões do pedido, a linha do tempo (na cor de seleção) e o "Acompanhar pedido" (botão principal) seguem o checkout.

O release-tema não faz smoke nesta página (exigiria um pedido real); a prova de execução é a sonda.

## Aviso de cookies (toda página tematizada)

O aviso de cookies da INK (`.cookie-acceptance`) ganha a cara do aviso do storefront (`ConsentBanner.tsx`), desde 26/10/2026:
- barra preta de ponta a ponta na base, com a mesma largura de conteúdo do site;
- uma linha em branco, com a Política de Privacidade em negrito;
- o botão "Aceitar cookies" branco, retangular e em maiúsculas: a largura toda no celular, à direita no computador.

Antes era um cartão branco translúcido, por cima do preço, com um botão em pílula.

O que continua da INK:
- **Só aparência.** O nó, o texto, o link para a política da INK e o botão continuam os da INK, e quem mostra e esconde é o atributo `hidden`
  do controlador dela (nenhum `display` nas regras). Os nossos módulos leem a presença do aviso como "não aceito", então ele nunca é
  removido.
- **Sem "Rejeitar".** O storefront tem "Rejeitar", a INK não, e nenhum botão é inventado: o que um aceite libera nas páginas da INK é a
  INK que decide.

Vale em qualquer superfície ligada (`body[data-origens-theme]`): o aviso aparece na primeira visita, em qualquer página.

## Rodada 2 (composição)

PDP com galeria fixa no computador e coluna de compra na ordem da decisão (`order` no mesmo pai flex), chips de linha fina com o escolhido cheio, medidas como links, contador da galeria e flutuantes fora do caminho no celular (`theme-ui`), assinatura "USE ORIGENS" no cabeçalho do celular e do checkout (no checkout, o Worker insere o nome no HTML), faixa superior sem sobreposição, carrinho com o nosso bloco depois dos itens e estado vazio com uma abertura só (`discovery-ui`, só com o tema ligado), pagamento com a garantia depois do botão. Detalhes e evidências: [`RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md`](RELATORIO_RODADA_2_LAYOUT_FLUXO_INK.md) e [`AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md`](AUDITORIA_PRE_IMPLEMENTACAO_FLUXO_INK.md).

## Rodada 3 (galeria e desligamento)

Miniaturas de TODAS as fotos numa linha abaixo da principal (rolagem lateral quando não cabem; a ativa sempre visível) (o toque aciona o ponto nativo `#dot-image-N`; a seleção segue `aria-current`; navegar por fotos não muda a variante), galeria fixa ajustada à altura da janela, ordem do DOM = ordem visual (prazo/cupom/outros tipos e medidas reposicionados no mesmo pai, sem mover frame que a INK está carregando) e o desligamento efetivo acima. Detalhes: [`RELATORIO_RODADA_3_GALERIA_E_VALIDACAO_INK.md`](RELATORIO_RODADA_3_GALERIA_E_VALIDACAO_INK.md).

## Prévia e QA (sem publicar nada)

```bash
# 1) storefront: editar em Aparência › Tema da INK (npm run cms:dev) e exportar o rascunho
npm run -s ink-theme:draft -- sul > /tmp/tema-sul.json
# 2) Worker: as páginas REAIS da INK passando pelo Worker LOCAL (Miniflare) com esse rascunho
PW_PATH=<dir com playwright-core> node scripts/preview-tema.mjs --config /tmp/tema-sul.json --headed            # janelas computador + celular
PW_PATH=… node scripts/preview-tema.mjs --config /tmp/tema-sul.json --qa [--checkout <uuid de teste>]           # 360/375/390/768/1440, exit 1 se falhar
PW_PATH=… node scripts/preview-tema.mjs --config /tmp/tema-sul.json --shots <dir> [--checkout <uuid>] [--off]   # capturas antes/depois
PW_PATH=… node scripts/estados-tema.mjs --out <dir> [--off] [--checkout <uuid>]       # matriz de estados (modais, variantes, cartão/Pix/cobrança) + estados.json
PW_PATH=… node scripts/simulacao-carrinho.mjs --out <dir> [--off]                       # SIMULAÇÃO de carrinho com itens e pós-adição (aparência)
PW_PATH=… node scripts/qa-galeria-tema.mjs [--shots <dir>]                               # miniaturas, foco, Turbo real (6 larguras, 3–19 fotos)
PW_PATH=… node scripts/qa-desligamento-tema.mjs [--checkout <uuid>] [--rapido]           # liga/desliga por superfície, deploy × painel, mudança no meio
PW_PATH=… node scripts/complemento-visual.mjs --out <dir> --checkout <uuid de teste>    # carrinho preenchido + incentivo (simulação) e checkout SANITIZADO, 1440/390/360/1280×640
PW_PATH=… node scripts/preview-tema.mjs --headed --allow-cart [--incentivo-exemplo] --capturar-carrinho <dir> # carrinho REAL montado à mão; Enter fotografa a gaveta
PW_PATH=… node scripts/ajustes-finais.mjs --fase antes|depois --out <dir> [--checkout <uuid>] # rodapé do carrinho antes/depois, medidas e custo de abrir o carrinho
PW_PATH=… node scripts/refinamento-aphago.mjs --fase antes|depois --out <dir> [--checkout <uuid>] # incentivo no topo, teclado aberto, foco, validação e pagamento
PW_PATH=… node scripts/validacao-checkout.mjs --checkout <uuid de teste> --out <json>     # resposta REAL: Pix/cartão (só payment_discount), parcelas, "Editar"
```

**Trava:** no navegador da prévia, qualquer requisição não-GET para `/checkout` é abortada (nada de pedido, pagamento ou cobrança); as do carrinho também, salvo `--allow-cart` (uso manual). Nas capturas, campos e endereço do checkout saem mascarados. `--checkout` deve ser um carrinho de **teste**.

**Checkout sanitizado** (`createHarness({ sanitize: true })`, usado pelo `complemento-visual.mjs`): antes de a página chegar ao navegador, `sanitizeCheckout` lê do próprio HTML os valores de contato e endereço e troca todas as ocorrências (atributos, textos, só dígitos; o número da casa só no campo e depois da rua) por dados fictícios. A tela de pagamento usa o que foi aprendido na de contato. Se nada foi aprendido, ou se sobrar um valor ou um CEP real no texto, a página é recusada (451) e a captura não acontece. Nenhum dado real fica no código (`test/sanitize-checkout.test.js`).

## Ligar e desligar

| O quê | Como | Efeito |
|---|---|---|
| Uma superfície, pelo dono | Painel › Tema da INK › desmarcar › Publicar | Páginas novas sem aquela superfície em até ~1 min (cache do endpoint + isolate) |
| Uma superfície, no deploy | Tirar `theme-pdp`/`theme-cart`/`theme-checkout` de `WIDGET_FEATURES` | Imediato após o deploy; sem leitura do painel |
| Todo o tema | Tirar as três features (ou `wrangler rollback`) | A INK nativa; carrinho/formulários intactos (o tema nunca guarda dado) |
| Só o checkout | Remover as duas rotas acima | O Worker deixa de ver as telas do checkout |
| Falha do CSS ou do storefront | — | O `<link>` falha sozinho ou nem é injetado: a compra nativa segue |

## Testes

`test/theme.unit.test.js` (contrato, contraste, escopo do CSS, `display`, telas do checkout), `test/theme.workerd.test.js` (HTMLRewriter real: injeção, painel × feature, fail-open, checkout só CSS, POST/Turbo-Frame/dry-run intactos, cache do CSS), `test/theme-ui.dom.test.js` (barra fixa, toque na barra inerte, Esc, Turbo, idempotência).

## Carrinho: cupom recolhido e incentivo de frete (theme-cart, cart-incentive)

- **Cupom.** Com o carrinho tematizado, o `theme-ui` põe `data-origens-collapsed` na linha do cupom da INK (`.cart-drawer__footer__coupon`) e um botão
  "Adicionar cupom" no lugar. Isso só acontece quando o campo está vazio, sem foco, sem cupom aplicado (ações `clearCoupon`/`removeCoupon`) e sem erro
  (`cartErrors`). Depois de aberto pelo cliente, fica aberto até a próxima página. Sem o código (falhou, tema desligado), o campo da INK aparece. Com o
  cupom recolhido e o CEP fechado, "Adicionar cupom" e "Frete · Inserir CEP" dividem uma linha (grade do rodapé por `:has()`, só CSS).
- **Incentivo.** Regra publicada pelo painel (`incentive` no contrato v1, só ligada e confirmada pelo dono), validada pelo Worker (`normalizeIncentive`:
  frete grátis por peças, 2–20, UFs da região) e escrita no `<body>` como `data-origens-incentive="2|PR,SC,RS"`, só com `cart-incentive` no deploy e o
  carrinho tematizado. O `theme-ui` lê a contagem em `#quantity-header[data-quantityheader]` e a linha do frete da INK (`.cart-drawer__footer__cep`:
  "Grátis" = disponível; "R$ …" = cobrado) e mostra o incentivo no TOPO da lista, logo abaixo do título (um `<li role="none">` de largura total, porque o `.cart-drawer__main` da INK é um flex em
  linha; rola com os produtos, sem área fixa). Entre `turbo:submit-start` e a resposta (rodapé ou
  contagem novos), o conteúdo some sem mudar a altura; erro no envio = volta o estado atual. A barra nativa da INK (por valor) com meta > 0 tira o nosso
  incentivo (um aviso só). Nenhuma requisição a mais.
- **Tela muito baixa** (até 520 px de altura, como com o teclado do celular aberto no cupom ou no CEP): a gaveta rola inteira e o rodapé deixa de ser
  fixo, para não cobrir o campo em uso nem o último produto.
- **Checkout, frete e pagamento**: a opção escolhida tem fundo leve e borda na cor de seleção da marca, e o indicador nativo nessa cor; as outras ficam
  neutras. O contorno azul nativo da INK (`peer-checked:border-blue-600`) sai. Os controles desabilitados ficam esmaecidos e sem cursor de clique.

## Papéis de cor do carrinho e do checkout (direção de arte)

As cores do carrinho e do checkout saem de **papéis** derivados dos tokens publicados (`tokensCss`): `--o-cta`/`--o-on-cta` (botão principal),
`--o-panel` (rodapé do carrinho, resumo do checkout), `--o-incentive-*` (fundo, linha, destaque, texto, ressalva, ícone e círculo, trilho e progresso
do incentivo) e `--o-choice-*` (linha, anel, fundo, cabeçalho, área aberta e rádio da opção escolhida). O padrão reproduz o tema aprovado: as cores
calculadas foram comparadas antes e depois da refatoração e saíram idênticas. Uma direção de arte nova troca os papéis, não as regras.

Propostas em comparação (`scripts/lib/propostas-cor.mjs`, A e B) existem **só na prévia**: o harness injeta com `createHarness({ proposta: 'A' })`,
e `scripts/direcao-de-arte.mjs` gera Atual / A / B com o mesmo código, os mesmos dados e o mesmo enquadramento. Aplicar a escolhida é trocar os valores
padrão dos papéis no `theme.js` (ou, se fizer sentido, criar um preset no painel).

