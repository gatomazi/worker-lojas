# PDP da INK — marcação nova (novembro/2026) e o que o Worker faz com ela

## O que a INK mudou

A página de produto foi refeita por dentro. O que importa para o tema e para os nossos blocos:

| Antes | Agora |
| --- | --- |
| Um `<form id="form-product-…">` com tudo: variações, quantidade, botão, prazo, cupons. | O `<form>` só guarda os campos ocultos, o **prazo** e os **cupons**, dentro de `.container-form`. As escolhas e a barra de compra moram **fora** dele, num bloco filho da coluna `section[data-buy-column]`. |
| Modelo/tamanho: `input[type=radio]` + `label`; "Confira suas medidas": `a#open-modal-size`. | `a[data-step="model" \| "color" \| "size"]`, estado por `aria-current` e `aria-disabled`; "Guia de Medidas" é um cartão nativo. |
| Botão `#add-to-cart-desk` (em fluxo) e `#add-to-cart-mob` (barra fixa). | Um só: `button[data-ink-labs-anchor="buy_button"]` dentro de `[data-video-gallery-floor]` (resumo + quantidade + botão). No celular essa barra é `fixed bottom-0 z-[31]`; no computador corre com a página. |
| Ordem: título › preço › variações › CTA › prazo › cupons. | Ordem nativa: título › preço › **prazo › cupons** › variações › botão. |
| Classes `.details-product`, `.section-product-v2`, `.section-details`. | **Não existem mais.** Título: `h1[data-ink-labs-anchor="product_title"]`; a galeria nova já traz miniaturas (o grid nosso fica inativo). |
| "Também disponível em" como botões. | Seção nativa `[data-testid="product-styles"]` (carrossel de cartões), só em produtos que têm outras peças. |

O aviso de cookies da INK (`.cookie-acceptance`) é `fixed bottom-0 z-[31]`: **o mesmo z-index e a mesma borda** da barra de compra do celular. Como vem depois no DOM, ele cobria o botão.

## Ganchos estáveis que usamos

`[data-buy-column]`, `[data-ink-labs-anchor="product_price" | "size_selector" | "buy_button" | "buy_together"]`, `[data-testid="product-price" | "product-guarantees" | "product-details" | "product-styles"]`, `[data-video-gallery-floor]`, `a[data-step]`, `aria-current`, `aria-disabled`, `turbo-frame[id^="variant-selection-"]`. Evitamos classes Tailwind arbitrárias (`grid-cols-6`, `mt-[22px]`…): elas mudam a cada versão da INK.

## O que o Worker faz agora

- **Ordem** (theme-ui, `themeReorderBuy`): título › preço › **"Cupons disponíveis" (fechado)** › modelo/cor/tamanho › botão de compra › **prazo (CEP)** › guia › confiança › detalhes › "Também disponível em" › "Compre junto" › "Você também pode gostar". O conjunto prazo (`.container-form`, o nó inteiro) desce para logo depois do bloco das escolhas e do botão. Quando o frame está carregando (`busy`) o nó **não** é movido (mover aborta o pedido da INK); a ordem **visual** já sai certa pelo CSS (`order`, só enquanto o conjunto ainda está acima; `:has` sem aninhar), e a ordem do DOM (teclado, leitor de tela) alcança a visual quando o frame termina. Desligar o tema devolve o nó ao lugar nativo.
- **Cupons**: "Cupons disponíveis" **fechado**, só abre no toque, logo abaixo do preço (com o tema do preço compacto, ele não pesa mais lá em cima). Sem preço na página, entra depois do `<form>`.
- **Preço**: riscado, preço e selo na mesma linha; o selo diz **"Economize X%"** (o theme-ui troca o "X% OFF" da INK e devolve ao desligar) na cor principal da região; as **parcelas** ficam num selo verde logo embaixo, em negrito.
- **Chips** de modelo e tamanho com o CSS do tema de novo (linha fina; escolhido na cor da região; indisponível tracejado). Os sete tamanhos cabem numa linha. **Cores**: todas numa linha (a bolinha segue com 28 px; cada cor ocupa 36–44 px de largura por 44 de altura, sem vão entre elas: 40 px no 390, 36 px no 360).
- **"Adicionando…"** de volta: o botão de compra atual (fora do `<form>`, ligado a ele pelo atributo `form`) ganha `data-turbo-submits-with`, e o Turbo põe o texto enquanto a INK demora. **Toque no botão ainda inerte**: o CSS deixa o toque passar para a barra, e o theme-ui leva à escolha que falta (`data-missing-step` da INK) e a marca.
- **Compartilhar** (pdp-share) volta a montar: ele ancorava em `.details-product h1`.
- **Celular — barra fixa × aviso de cookies**: a barra sobe a altura do aviso (`--o-cookie-h`, medida no theme-ui) em vez de ficar debaixo dele, e o aviso fica mais baixo na PDP (texto e botão na mesma linha). A barra some com o teclado aberto.
- **Flutuantes** (chat "Pergunte aqui", cupom, WhatsApp, Ajuda): recuam acima da barra fixa **e** do aviso, repetindo o cálculo até assentar (antes subiam acima do aviso e caíam em cima da barra). Contam como obstáculo só quando a barra é `fixed`.
- **Guia da PDP / descoberta**: a âncora (`findAnchor`) é o bloco das escolhas (ou o conjunto prazo+cupons quando já está logo depois dele).
- **"Você também pode gostar"**: sem "Compre junto", entra depois dos detalhes do produto; nunca dentro de `.container-form`.
- **"Também disponível em"** (seção nativa, só em produtos que têm outras peças), no desenho da Use Graxa: título grande, cada peça num cartão de linha fina, foto no cinza das fotos, setas na cor da região, selo Premium legível; a **peça desta página entra na frente com "Você está aqui"** (cartão com a linha forte; o theme-ui monta com o tipo da migalha, a primeira foto de produto da galeria e os preços do bloco de preço, e sai ao desligar).

## Como conferir

```bash
PW_PATH=<dir com playwright-core> node scripts/probe-pdp-layout.mjs <dir> [--sem-tema] [--medidas]   # capturas e medidas, computador e celular
PW_PATH=<dir com playwright-core> node scripts/qa-cep-cupons.mjs [--shots <dir>]                       # prazo e cupons contra a INK real (sem POST)
npm test
```

Publicação: só código novo, mesmas flags → `scripts/release-tema.sh --update`.
