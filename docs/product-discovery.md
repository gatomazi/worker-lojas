# Descoberta na página de produto + revisão de comunicação (Fase 6)

Data: 2026-09-24. Estado: **EM PRODUÇÃO nas cinco páginas** (seção 6). Worker ativo `4a3c5d13-632e-4fed-b6b8-028c0c40595d` (loader **4.2**, seis features, cinco caminhos exatos, `CART_REFS`); storefront `main` com o enum `ink_product_detail`. Versão estável anterior: `5790535f-b7f4-439e-beac-1a8ee257b050` (passo A, bloco desligado) e `81ce3c6f-47f4-408f-a4f3-e168dc99d395` (loader 4.1). Contexto/eventos anteriores: [`expansao-cinco-produtos-analytics.md`](expansao-cinco-produtos-analytics.md).

## 1. Comunicação (todas as superfícies)

A Use Sul não vende só camisetas de cidade: também há expressões, humor e identidade regional. Por isso "cidade" ficou só na **busca**, e a **vitrine** passou a se chamar "todas as estampas". Duas ações distintas em todas as superfícies:

| Ação | Texto | O que faz |
|---|---|---|
| Busca | **Buscar cidade ou estado** | usa **exclusivamente** o índice geográfico (`/__origens/search`, o mesmo do storefront). Nunca é apresentada como busca no catálogo; sem resultado: "Não encontramos essa cidade ou estado. Tente o nome completo ou explore todas as estampas." |
| Vitrine | **Explorar todas as estampas** | link real para `https://useorigens.com.br/sul` (via `cart_ref` e marcador de origem existentes) |

| Superfície | Título | Texto de apoio |
|---|---|---|
| **Página do produto** (novo, `product-discovery`) | **Continue explorando** | *De cidades a expressões e outras ideias: descubra mais estampas com a sua cara.* |
| Drawer do carrinho (compacto) | **Descubra outras estampas** | Continue escolhendo sem perder seu carrinho. |
| Drawer pós-adição | (eyebrow) Continue explorando · **Descubra outras estampas** | Seu carrinho continua salvo enquanto você explora. |

Antes: "Procurar outra cidade", "Qual é a próxima cidade?", "Explorar vitrine", "Explorar outras camisetas", "← Voltar a procurar". Falha da busca: "A busca não está disponível agora. Você ainda pode explorar todas as estampas." (o link para a vitrine permanece).

**Verificação do destino antes de usar o texto** (`https://useorigens.com.br/sul`, lido em 2026-09-24, 200): a home da vitrine traz **Da Nossa Terra** (identidade regional), **Redesenhos do Sul**, **Feito Para Você**, **Fala daqui** (expressões: Bah, Tchê, Ô piá…), **Escolha o seu estado** e "O número de cada região" — 47 produtos distintos da INK linkados. O destino de fato dá acesso às demais categorias; o teste `qa-expansao.mjs` repete essa checagem a cada execução.

## 2. Componente `product-discovery`

- **Flag nova `product-discovery`** em `WIDGET_FEATURES` (fail-closed: nome desconhecido continua descartando a lista inteira). Com a flag ligada, o bloco **substitui** o link `← Voltar a procurar` (nunca os dois). **Plano B:** se `discovery.js` não carregar, volta um link simples "Explorar todas as estampas" (uma vez, sem laço de tentativas). Sem a flag, o link do piloto fica exatamente como era.
- **Reuso, sem segunda implementação:** o bloco é um terceiro `kind` (`product`) do mesmo `discovery.js` sob demanda (busca, gateway same-origin sem credenciais, ranking, destinos e CSS dos drawers). Só o lado leve (`src/loader/product-discovery.js`) é novo; a âncora de compra (`findAnchor`) foi movida para o runtime e é compartilhada.
- **Recolhido por padrão** (título, texto, "Buscar cidade ou estado" e "Explorar todas as estampas"; alvos ≥44 px); busca expandida limitada a **4 resultados**. Nenhuma ação preenchida: o `Adicionar ao Carrinho` nativo (verde-oliva cheio, maior) segue dominante.
- **Posição:** logo depois do `<form>` nativo de compra (abaixo do CTA, dos selos de troca/segurança e das bandeiras), **fora** do formulário e do `turbo-frame` que a INK recarrega. *Achado do QA:* colocado como irmão do CTA (dentro do frame), no mobile a INK re-renderiza o frame ~0,5–1,6 s depois de carregar/rolar e o bloco era refeito — a busca aberta perdia o foco e recolhia. Fora do `<form>` isso não acontece (teste `the INK re-rendering its turbo-frame … does NOT rebuild the block`). Idempotência por existência do bloco (não por posição: no mobile a âncora "visível" alterna).
- **Intocado:** HTML/`form`/variantes/CTA/sticky mobile/Stimulus/checkout/preços/sessão da INK; drawers e espelho no storefront (só a comunicação mudou). Cinco caminhos exatos inalterados; nada fora deles.
- **Carrinho na saída:** os links do bloco herdam a ponte existente — `cart_ref` no clique (último snapshot do espelho; sem cookies/CSRF; sem token → link normal para a vitrine) e o retorno `?origens_open_cart=1` não mudou.

## 3. Eventos (nomes e contrato já existentes)

Nenhuma biblioteca nova. `origens_explore_storefront_click` (INK) e `origens_storefront_arrived` (storefront) reaproveitados; `entry_point` segue o enum `ink_*` que já estava em produção (mantido para não partir a série no GA4):

| Superfície | `entry_point` | Observação |
|---|---|---|
| Bloco da página do produto | **`ink_product_detail`** (novo) | proposta do briefing: `product_detail`; usei o prefixo `ink_` por consistência com os valores existentes |
| Drawer pós-adição | `ink_post_add` | (proposta `post_add_drawer` não adotada: dividiria a série) |
| Drawer do carrinho | `ink_cart_drawer` | (proposta `cart_drawer` idem) |
| Plano B (link simples) | `ink_product_return` | mesmo valor do link antigo |

Um evento novo de intenção, INK-side: **`origens_discovery_search_open`** (toque em "Buscar cidade ou estado", `entry_point` = `ink_product_detail` ou `ink_cart_drawer`, uma vez por toque; **nunca** o texto digitado). A seleção de resultado já é o `origens_explore_storefront_click` (o resultado é um link nosso). Sem evento por tecla.
**Storefront:** `ink_product_detail` entrou no enum fechado de chegada (`feature/product-discovery-entry`, commit `12bca55`, 1 linha + teste + doc). **Ordem de publicação:** storefront **antes** do Worker (senão a chegada vinda desse bloco seria descartada pelo enum antigo). Consentimento, dimensões e redação do `cart_ref`: como em [`analytics-origens-events.md`](../../useorigens-cartmirror/docs/analytics-origens-events.md). Continuam valendo os limites daquele doc (o gate do aviso de cookies da INK; nada aqui foi visto no painel do GA4).

## 4. Testes e QA (local)

| Suíte | Resultado |
|---|---|
| Worker `npm test` | **217/217** (baseline 203; +13 do bloco: cinco produtos/cópia/sem link antigo, form intacto, busca abre/fecha e só consulta o gateway geográfico, falha honesta, saída com `cart_ref`+marcador, Turbo 1→1→0→1, re-render do frame não refaz o bloco, plano B, flag OFF = link antigo, flag sozinha sem busca; +1 workerd da flag) |
| Storefront Vitest do enum | 17/17 (`origens-events`) |
| **QA em navegador real** `scripts/qa-expansao.mjs` (INK real, Worker+KV locais, tags da INK bloqueadas) | **36/36**: 5 páginas × 1280/390/320×640 com 1 loader 4.2, 6 features, **1 bloco, sem link antigo**, CTA/sticky nativos sem cobertura nossa, sem overflow atribuível ao bloco; busca aberta (gateway real, ≤4 resultados, sem cobrir o CTA); destino `/sul` com as categorias; jornada de 2 produtos, drawers (ícone e "Ver carrinho"), espelho, `?origens_open_cart=1`, 3+ peças com `Finalizar compra` visível em 1280/390/320×640 |

Overflow: em 320 (e 390 na 1ª visita) a **própria página da INK** já transborda na horizontal (`overflowWithout: true` com o bloco oculto); o QA compara com e sem o bloco e nenhum overflow é atribuível a ele.
Capturas: `docs/evidence/product-discovery/` (`produto-*-{1280,390,320}-fechado.png`, `produto-paranaense-{1280,390,320}-busca-aberta.png`) e os drawers com o texto novo em `docs/evidence/expansao-5/drawer-*`.

## 5. Publicação e rollback (executado; mantido como referência)

Versão estável a preservar no rollback: **`81ce3c6f-47f4-408f-a4f3-e168dc99d395`** (loader 4.1, cinco features, cinco caminhos, `CART_REFS`). Não usar deploy sem `--var` (desliga o piloto).

1. **Storefront:** publicar `feature/product-discovery-entry` (`12bca55`) pelo fluxo normal (PR → Railway).
2. **Worker, passo A (código novo, flag OFF):** cinco features, cinco caminhos idênticos. Smoke: health `version 4.2`, cinco páginas com 1 loader e o link antigo (sem bloco), cinco produtos externos reais com 200 sem loader. (A comunicação dos drawers já muda neste passo: não está atrás da flag.)
   ```bash
   npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true \
     --var "WIDGET_ALLOWLIST:/usesul/product/serra-catarinense,/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241,/usesul/product/made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829,/usesul/product/paranaense-essencia,/usesul/product/made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a" \
     --var WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror
   ```
3. **Worker, passo B (liga o bloco):** o mesmo comando com `WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery`. Health deve listar as seis; `node scripts/qa-expansao.mjs --live` (36 checagens + ida e volta pelo storefront).
4. **Rollback:** (a) só o bloco: repetir o passo A (tira `product-discovery`, mantém as outras cinco); (b) tudo: `npx wrangler rollback 81ce3c6f-47f4-408f-a4f3-e168dc99d395 --name use-sul-widget -m "rollback fase-6"` (volta também a comunicação antiga). Confirmar health e smoke depois. Nunca rollback para a versão de um produto só.

## 6. Produção (2026-09-24)

**Sequência real:** storefront `12bca55` (PR → `main`, Railway; o bundle publicado passou a conter `ink_product_detail`) → Worker **passo A** `5790535f` (loader 4.2, bloco OFF; smoke: health `4.2`, 5 páginas com 1 loader e link antigo, `PRODUCT = false`, 5 produtos externos reais 200 sem loader, `/usesul`, `/usesul/products` sem loader, checkout 302, busca e `cart-ref` respondendo) → Worker **passo B** `4a3c5d13` (health: `version 4.2`, `allowlist_size 5`, seis features, `features_status ok`).

**QA ao vivo** (`scripts/qa-expansao.mjs --live`, sessão anônima descartável, tags de analytics da INK bloqueadas, sem finalizar pedido): **40/40**. Cinco páginas × 1280/390/320×640 com 1 loader 4.2, seis features, **1 bloco e nenhum link antigo**, CTA/sticky nativos sem cobertura nossa; busca aberta pelo gateway real (≤4 resultados); destino `/sul` com as categorias; jornada de dois produtos, espelho, retorno pelo drawer nativo; 3+ peças com `Finalizar compra` visível em 1280/390/320×640. Capturas: `docs/evidence/product-discovery/live-*`.

**Eventos observados no Network real** (uma visita de teste, `utm_source=qa`, propriedade `G-8GYTEJ1F77`; só o GA4 liberado — GTM, Meta, TikTok, Ads e New Relic bloqueados; cookies aceitos na INK e consentimento aceito no storefront): na INK `origens_discovery_search_open` e `origens_explore_storefront_click` (ambos `entry_point=ink_product_detail`, `product_slug=paranaense-essencia`); no storefront `origens_storefront_arrived` (`ink_product_detail`, mesmo slug) com `dl=https://useorigens.com.br/sul` e `dr=https://www.usesul.com.br/`. **Nenhum request GA contém `cart_ref`, `origens_src` ou `origens_p`.** (Junto vieram os hits normais da própria INK — `page_view`, `view_item` nas duas propriedades dela — e do storefront.)

**Ainda NÃO confirmado no painel do GA4:** não há acesso ao Realtime/DebugView; evidência em Network não equivale a confirmação no painel. Dimensões `entry_point`, `product_slug`, `cart_items_bucket`, `mirror_age_bucket` e a redação de `cart_ref` ("Encobrir dados" no fluxo) dependem do proprietário. Vale o gate do aviso de cookies da INK (as medições do lado da INK só saem depois do aceite).

**Rollback vigente:** só o bloco → repetir o passo A (`WIDGET_FEATURES` com as cinco features, sem `product-discovery`); tudo → `npx wrangler rollback 81ce3c6f-47f4-408f-a4f3-e168dc99d395 --name use-sul-widget -m "rollback fase-6"` (volta também a comunicação antiga). Confirmar health e smoke depois. Nunca a versão de um produto só.
