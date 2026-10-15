# Tema da compra na INK (theme-pdp, theme-cart, theme-checkout)

A PDP, o carrinho e o checkout da INK com a cara da PDP do storefront, para o cliente reconhecer a mesma loja do começo ao fim. **Só aparência.** Variantes, estoque, preço, descontos, frete, sessão, identificação, pagamento e pedido continuam com a INK: os controles nativos são os mesmos nós, com os mesmos cliques, formulários e validações. Relatório da rodada: [`RELATORIO_PERSONALIZACAO_FLUXO_INK.md`](RELATORIO_PERSONALIZACAO_FLUXO_INK.md).

## Como funciona

```text
Painel do storefront (Aparência › Tema da INK, rascunho → Publicar)
   └─ GET https://useorigens.com.br/api/ink-theme/<região>   contrato v1: interruptor por superfície + tokens #rrggbb (presets)
        └─ Worker da loja (src/theme.js), lido NO SERVIDOR, 60 s por isolate (falha = última boa por até 24 h; nunca houve = nada)
             ├─ produto e páginas de casca: <html data-origens-theme="pdp cart"> + <link /__origens/theme.css?s=pdp,cart&v=1&c=<hash>>
             ├─ checkout (contato/entrega e pagamento): <html data-origens-theme="checkout"> + <link …?s=checkout…>  — sem loader, sem JS
             └─ /__origens/theme.css: CSS da combinação pedida; hash igual = imutável por 1 ano; diferente = conteúdo atual com 60 s
```

- **Duas chaves por superfície:** a feature do deploy (`WIDGET_FEATURES`, teto técnico, opt-in em `scripts/lib/store-lib.mjs`) **e** o interruptor do painel. Qualquer uma desligada = a INK nativa naquela superfície.
- **Escopo:** todo seletor começa por `html[data-origens-theme~="<superfície>"]` (testado em `test/theme.unit.test.js`). Nenhuma regra muda `display` de algo que a INK mostra/esconde (o único `display` é no "Continuar Comprando" do carrinho vazio, um `<div>` sempre visível), nenhuma esconde preço, cupom, frete, totais ou termos, nenhuma gera texto.
- **Configuração:** só presets (botão preto ou da região, fundo cinza do site ou branco, cantos retos ou de 8 px, Hanken Grotesk ou Poppins). Cores vêm de `globals.css` e de `REGION_THEME` no storefront; nada digitado vira CSS. O Worker recusa o payload inteiro se uma cor não for `#rrggbb`, se o raio/fonte não for um preset ou se um par de texto não tiver contraste AA.
- **Identidade:** a da região da LOJA que o Worker atende (um Worker = uma loja = uma região). Não se deduz pelo produto: um carrinho com estampas de vários lugares mantém a mesma cara.
- **Fonte:** Hanken Grotesk via `@import` do Google Fonts no topo do CSS (a INK já carrega Poppins do mesmo serviço). Com o preset "Poppins", nenhum pedido de fonte.
- **Turbo:** o `<html>` sobrevive às visitas Turbo e o atributo é igual em produto e casca. Se a visita vier de uma página da INK que não passou pelo Worker, `theme-ui` repõe o atributo a partir do `<link>` (nunca inventa superfície; `checkout` nunca é superfície do loader).

## JS (só onde CSS não basta) — `src/loader/theme-ui.js`

Entra no loader com `theme-pdp` ou `theme-cart`; o checkout nunca recebe o loader.

| Comportamento | Como | Se falhar |
|---|---|---|
| Barra fixa "Adicionar ao Carrinho" do celular some com o botão principal à vista ou com o teclado aberto | `IntersectionObserver` só em `#add-to-cart-desk`; `focusin/focusout` em campos de texto | Barra fica sempre visível, como na INK |
| Toque na barra quando a INK a deixa inerte (`pointer-events-none`, antes do quadro de variantes carregar) | Rola até o quadro (lazy: carrega ao entrar na tela) ou, já carregado, foca a primeira escolha que falta e a destaca | O toque não faz nada, como hoje |
| Esc fecha o carrinho | Dispara o clique no "X" nativo (`#cart-drawer-close`); devolve o foco ao botão do carrinho | Fecha só pelo "X" |

Nada nele clica em compra, presume variante, cria item, lê carrinho, envia evento ou toca formulário. Inicialização idempotente (um observador; listeners removidos no `unmount`), testada em `test/theme-ui.dom.test.js`.

## Checkout: rota da zona (PENDENTE — não aplicada)

Hoje a zona exclui `/usesul/*` do Worker (rota sem script), então as telas do checkout **não** passam pelo Worker e `theme-checkout` não tem efeito em produção. Para ligar, criar **duas** rotas com o Worker, e só estas:

```text
www.usesul.com.br/usesul/checkout/contact_and_shipping_details*
www.usesul.com.br/usesul/checkout/payment_methods*
```

Elas são mais específicas que a exclusão `/usesul/*` e não cobrem os POSTs do checkout (`/checkout/buyer/…`, `/checkout/shipping_address/…`, `/checkout/process_payment`, `/checkout/payment_discount/…`), que seguem direto para a INK. `scripts/lib/routes-lib.mjs` (`safetyProblems`) ainda recusa qualquer rota em `checkout` de propósito: a liberação dessas duas deve ser um PR próprio, com `probe` do `zone-routes.mjs` mostrando que os POSTs não invocam o Worker. No Worker, o ramo do checkout só age em `GET` de documento inteiro (sem `Turbo-Frame`), chama `ctx.passThroughOnException()` (exceção = a Cloudflare entrega a origem) e nunca registra o caminho (o uuid do carrinho fica fora dos logs).

## Prévia e QA (sem publicar nada)

```bash
# 1) storefront: editar em Aparência › Tema da INK (npm run cms:dev) e exportar o rascunho
npm run -s ink-theme:draft -- sul > /tmp/tema-sul.json
# 2) Worker: as páginas REAIS da INK passando pelo Worker LOCAL (Miniflare) com esse rascunho
PW_PATH=<dir com playwright-core> node scripts/preview-tema.mjs --config /tmp/tema-sul.json --headed            # janelas computador + celular
PW_PATH=… node scripts/preview-tema.mjs --config /tmp/tema-sul.json --qa [--checkout <uuid de teste>]           # 360/375/390/768/1440, exit 1 se falhar
PW_PATH=… node scripts/preview-tema.mjs --config /tmp/tema-sul.json --shots <dir> [--checkout <uuid>] [--off]   # capturas antes/depois
```

**Trava:** no navegador da prévia, qualquer requisição não-GET para `/checkout` é abortada (nada de pedido, pagamento ou cobrança); as do carrinho também, salvo `--allow-cart` (uso manual). Nas capturas, campos e endereço do checkout saem mascarados. `--checkout` deve ser um carrinho de **teste**.

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
