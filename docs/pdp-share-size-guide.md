# "Compartilhar" e "Guia de medidas" na página de produto (pdp-share, size-guide)

Duas flags opt-in de `WIDGET_FEATURES`, independentes, no módulo `src/loader/pdp-extras.js` (loader `5.1`). Desligadas, nem o código entra no bundle.

## size-guide

O link nativo da INK **"Confira suas medidas"** (azul, sublinhado, `a#open-modal-size.form-product-options__size-modal-link`, que chega no turbo-frame
lazy `product_variants_options_frame` e volta a cada troca de variante) vira um botão secundário **"Guia de medidas"**: fita métrica de traço simples
(20 px), fundo neutro com 6% da cor da região, borda de 1 px, texto `#1f2328`, 46 px de altura, cantos de 10 px, 15 px/500, chevron no fim; largura total
no celular, `inline-flex` (mín. 260 px) a partir de 1024 px; hover só em `(hover:hover)`, foco visível.

- **Mesmo nó**: nada é clonado nem substituído. O `<a>` mantém `href="#modal-product"`, `data-action="click->ink-store--product-page#openModalOfSizes"` e os
  listeners; ganha `data-origens-size`, a variável `--o-size-tint` e três spans nossos (`pointer-events:none`, então o alvo do clique é sempre o `<a>`).
  O texto e a imagem originais ficam no DOM, escondidos, e voltam intactos no `unmount` (teardown, `turbo:before-cache`).
- **Modal oficial**: abre o modal de medidas da própria INK (imagens `images/size_table/*`), uma ativação por clique. Sem o link na página, nada acontece.
- **Cor**: `STORE.theme.primary` (`src/stores.js`), fixa por loja e igual ao storefront — Sul `#4d543d`, Norte `#234b50`, Centro-Oeste `#8c3b1f`.
- **Escopo**: só links dentro de `.details-product` (a PDP real não tem `<main>`) e fora de "Compre Junto", compra rápida e drawer.

## pdp-share

Botão **"Compartilhar"** (ícone + texto, sem preenchimento, 44 px) logo depois de cada `<h1>` do produto — a INK tem dois cabeçalhos (celular, antes da
galeria; desktop, em `section.section-details`) e mostra um por vez. `type="button"`, fora do formulário.

- **Destino**: `https://<host da loja><caminho canônico do produto>` (`CATALOG_PRODUCT_PATH`), montado no mount, sem query nem hash: `cart_ref`, `ls`,
  `origens_*`, utm e qualquer outro parâmetro da navegação nunca seguem. A URL atual não é alterada.
- **Texto**: `Olha essa camiseta da Use Origens: <nome>` quando o modal oficial mostra uma camiseta adulta (Clássica, Baby Look, Oversized "Unissex");
  senão `Olha o que encontrei na Use Origens: <nome>`. Nome = `data-product-name` da própria INK.
- **Interação**: `navigator.share` direto do clique quando existe e aceita os dados (detecção de recurso). `AbortError` = nada. Outra falha, ou sem
  suporte: painel com **Copiar link** ("Link copiado!" só após sucesso; senão o link aparece selecionável com "Selecione e copie o link") e **WhatsApp**
  (`https://wa.me/?text=…`, sem destinatário, `noopener noreferrer`). Escape/fundo/fechar fecham e devolvem o foco; Tab fica no painel.
  O painel usa a largura **visível** do documento: no celular a PDP nativa já é mais larga que a tela (~417 px num aparelho de 390, drawer fora da tela).
- **Prévia do link**: a PDP já serve `og:title`, `og:description`, `og:image` (800×800) e `link rel=canonical`; sem `og:url` (o WhatsApp usa a própria URL).
  Nenhuma reescrita de meta foi necessária.

## Medição

`origens_share` (`method`: `native` | `copy` | `whatsapp`) e `origens_size_guide_open`, com `region` e `surface: 'ink'`. Mesmas regras de `tracking.js`:
só pelo `gtag` da própria INK desta loja, só depois do aceite do aviso de cookies, nunca URL. `native` significa que a folha do sistema resolveu, não que
uma mensagem foi enviada.

## Verificação

- `node --test test/pdp-extras.dom.test.js` (fixture sanitizada da PDP real `test/fixtures/product-page-size-share.html`) e `npm test` (497 OK).
- `PW_PATH=<dir com playwright-core> node scripts/qa-pdp-extras.mjs`: PDPs **reais** pelas 3 lojas, Worker local (Miniflare), 1440/390/360 px — 58 PASS
  em 2026-10-05, inclusive uma compra real até o drawer com "Finalizar compra" visível (não clicado), troca de modelo e navegação Turbo ida e volta
  sem duplicar. Capturas em `docs/evidence/pdp-share-size-guide/`.
- Observado na INK **nativa** (sem nada nosso): no celular, o link de medidas valida o formulário antes de abrir o modal ("Selecione o modelo/cor").
  Comportamento preservado.

## Rollout (NÃO executado; exige autorização e `npx wrangler login` do proprietário)

Igual ao de `promo-fab` (`docs/promo-fab.md`): uma loja por vez, anotar a versão ativa (`npx wrangler deployments list --name <worker>`), publicar com as
**mesmas** variáveis que estão no ar (`npx wrangler versions view <versão ativa> --name <worker>`) acrescentando só `,pdp-share,size-guide` ao
`WIDGET_FEATURES`; Norte e Centro-Oeste **sempre** com o TOML resolvido a partir do TOML completo (9 rotas). Depois: `/__origens/health` com versão `5.1`
e as features novas, `store-routes.mjs <loja> verify --stage=shell` e QA no navegador. Rollback: `npx wrangler rollback <versão anotada> --name <worker>`.
As flags são independentes: dá para ligar só `size-guide` (ou só `pdp-share`).
