# promo-fab — botão de cupons da Use Origens nas páginas da INK

Feature **opt-in** `promo-fab` (loader 4.9). O mesmo conceito do storefront (`useorigens` → `docs/storefront/cupons-e-promocoes.md`): um botão no canto
inferior **esquerdo** com selo de cupons copiáveis, que abre "Cupons e ofertas". Uma única fonte de dados, o CMS do storefront.

```
CMS (publicado) → GET https://useorigens.com.br/api/promotions/<região>  ← lido SÓ pelo Worker, no servidor
                → GET /__origens/promotions (mesmo domínio da loja; sem CORS) → loader (src/loader/promo-fab.js)
```

**O CMS descreve, a INK executa.** Copiar só copia: nada toca no campo de cupom da INK, nenhum POST, nenhum cálculo ou aplicação de desconto.
O checkout não é alterado (o Worker nunca injeta em login, carrinho ou checkout).

## Gateway `src/promotions-gateway.js`

- Só existe com `ENABLE_WIDGET=true` **e** `promo-fab` em `WIDGET_FEATURES`; fora disso a INK responde o caminho (404 dela).
- Origem **fixa** por loja (`stores.js` → `promotionsApi`: `/api/promotions/sul|norte|centro-oeste`): o visitante não escolhe região nem URL.
  Cookie/Authorization nunca são repassados. GET/HEAD; POST ⇒ 405.
- Timeout 3 s, máximo 32 KB, validação **estrita** do contrato v1 (região da própria loja, `id`, `type`, textos de uma linha sem `<>`/controle,
  código `A-Za-z0-9-_`, aviso sem código, cor `#rrggbb`, ≤20 itens, sem ids repetidos). Item já encerrado (`endsAt`) sai da lista; qualquer outro
  desvio invalida o payload inteiro.
- Sucesso: `200`, `public, max-age=30`, só os campos de exibição. Falha (storefront fora, 5xx, redirect, HTML, JSON inválido, outra região, timeout):
  `503 {"error":"unavailable"}`, `no-store`, log `use-origens.promotions-error`.

## Loader `src/loader/promo-fab.js` (widget `shell: true`: produto e páginas de casca)

- Busca `/__origens/promotions` uma vez (cache de 60 s em `sessionStorage`, por região; falha também lembrada): **erro ⇒ nada**, sem retentativa em loop.
- Botão 56 px, cor do cabeçalho da região (`theme` do payload), selo de cupons copiáveis (9+), `z-index: 31` (como a aba de WhatsApp).
- Painel: <640 px folha inferior (modal, fundo, foco preso, rolagem travada); senão cartão ancorado ao botão. Escape/×/fora fecham; foco volta ao botão.
- Copiar: Clipboard API → `execCommand` → código selecionado + aviso.
- Espaço: sobe acima de `#add-to-cart-mob` e de `.cookie-acceptance`; some com `.cart-drawer.open`, `#modal-wrapper`, menu (`#menu-hamburger[aria-expanded=true]`),
  painel do Ajuda, teclado virtual (campo de texto focado + viewport visual menor; o viewport sozinho engana numa página com zoom reduzido), campo de texto focado (toque), sem espaço sob o cabeçalho, ou quando ficaria sobre controles do `form#form-product-*`
  (variantes, quantidade, Adicionar ao carrinho em fluxo). Medido contra a base REAL dos fixos (sonda em `bottom:0`): a página da INK é mais larga que
  a tela no celular e o navegador reduz o zoom, então `clientHeight` não serve. Sem zoom reduzido (320 px: layout de 358 px), o viewport de layout passa
  da tela: botão e folha ficam ancorados no viewport **visual** (o que o visitante vê) e acompanham o deslocamento dele. O motivo atual fica em `#o-promo[data-promo-hidden]` (diagnóstico).
- Microanimação: 2 oscilações, 560 ms; 1ª após 4–6 s, depois a cada 12–18 s sem atividade, máx. 3 por página; nunca com painel/menu/carrinho/modal,
  digitando, aba oculta, botão escondido ou `prefers-reduced-motion`; parada pelo resto da sessão depois de abrir/copiar/fechar.
- Turbo: `turbo:before-cache` desmonta (o snapshot nunca leva o botão), a remontagem cria exatamente um. Todo texto via `textContent`.
- Medição (GA4 da própria INK, só com o aviso de cookies dela aceito): `promo_fab_open`, `promo_coupon_copy`, `promo_panel_close` com `region`,
  `promo_id`, `surface=ink`.

Os releases de rotina **não** ligam `promo-fab` (`scripts/lib/store-lib.mjs` → `OPT_IN_FEATURES`; `global-common.sh` mantém as listas explícitas).

## Testes

- `test/promotions-gateway.workerd.test.js` (9, workerd real): contrato com/sem callout, aviso, zero itens, cache, URL fixa, sem cabeçalhos do visitante,
  JSON inválido/esquema/outra região/HTML/5xx/redirect/tamanho ⇒ 503, storefront fora, timeout, flag desligada, isolamento Norte/Centro.
- `test/promo-fab.dom.test.js` (13, jsdom + página real da INK como fixture): selo, painel, Copiar, Escape, folha × cartão, colisões, fail-open sem loop,
  cache de sessão, Turbo, animação (e reduced motion), texto nunca como HTML.
- `scripts/qa-promo-live.mjs`: Chrome real nas páginas REAIS das três lojas com o loader LOCAL e dados de teste (nada publicado, nenhuma compra), 7 larguras,
  toques reais no centro do botão (nada por cima). `QA_WIDTHS=390,320` limita as larguras.
  `PW_PATH=<pasta com playwright-core> node scripts/qa-promo-live.mjs [sul|norte|centro]` → `docs/evidence/promo-fab/`.

## Rollout (NÃO executado; exige autorização e `npx wrangler login` do proprietário)

Pré-requisitos: storefront com `/api/promotions/*` em produção e os cupons **publicados** no CMS (conferir
`curl -s https://useorigens.com.br/api/promotions/sul`). Uma loja por vez; o resto das variáveis fica **idêntico** ao que está no ar (só entra `promo-fab`).

```bash
# Antes de cada loja: anotar a versão atual para o rollback
npx wrangler deployments list --name use-sul-widget | head

# Sul (www.usesul.com.br)
npx wrangler deploy -c wrangler.production.toml \
  --var ENABLE_WIDGET:true --var WIDGET_SCOPE_MODE:product-catalog \
  --var "WIDGET_ALLOWLIST:/usesul/product/serra-catarinense,/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241,/usesul/product/made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829,/usesul/product/paranaense-essencia,/usesul/product/made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a" \
  --var "WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,list-session,header-nav,promo-fab"

# Norte (www.usenorte.com.br) — TOML com o id REAL do KV (gerado pelo release-store, ignorado pelo git)
npx wrangler deploy -c wrangler.norte.resolved.toml --name use-norte-widget \
  --var STORE_ID:norte --var ENABLE_WIDGET:true --var WIDGET_SCOPE_MODE:product-catalog \
  --var "WIDGET_ALLOWLIST:/usenorte/product/acara-origem-pa-51b9a32f-0281-478d-b641-77b8df830cc2,/usenorte/product/assis-brasil-origem-ac,/usenorte/product/labrea-origem-am" \
  --var "WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab"

# Centro-Oeste (www.usecentro.com.br)
npx wrangler deploy -c wrangler.centro.resolved.toml --name use-centro-widget \
  --var STORE_ID:centro --var ENABLE_WIDGET:true --var WIDGET_SCOPE_MODE:product-catalog \
  --var "WIDGET_ALLOWLIST:/usecentro/product/goiania-origem-go,/usecentro/product/campo-grande-origem-ms,/usecentro/product/sinop-origem-mt" \
  --var "WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab"
```

Conferir depois de cada loja: `curl -s https://<host>/__origens/health` (version `4.9`, nove features, `scope_mode` e `shell_pages` iguais aos de antes),
`curl -s https://<host>/__origens/promotions` (200 com os itens da região), e QA no navegador. As rotas da zona **não mudam** (só a versão do Worker).

Rollback: `npx wrangler rollback <versão anotada> --name <worker>` (rotas, KV e checkout intactos), ou simplesmente desativar/despublicar os itens no
CMS (o botão some sem deploy). As allowlists acima são as dos releases atuais (`global-common.sh` e `scripts/store-samples.json`); se tiverem mudado,
use as da versão ativa (`npx wrangler versions view <id> --name <worker>`).
