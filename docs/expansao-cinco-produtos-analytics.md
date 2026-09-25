# Expansão para 5 produtos + eventos de navegação (Use Origens)

Data: 2026-09-24. Repos: `use-origens-workers` (branch `feature/ink-loader-fase2a`) e `useorigens` (worktree `useorigens-cartmirror`, branch `feature/expansao-5-tracking`, a partir de `origin/main` = `af830bf`). Eventos e como medir: [`analytics-origens-events.md` no storefront](../../useorigens-cartmirror/docs/analytics-origens-events.md) (cópia resumida na seção 6).

## Declaração de status

> **`5/5 em produção` (2026-09-24).** Worker `81ce3c6f-47f4-408f-a4f3-e168dc99d395` (loader **4.1**, `allowlist_size=5`, as cinco features, KV `CART_REFS` preservado) e storefront `main` = `c6b88a4` (PR #2, Railway) no ar. Verificado em produção: smoke HTTP nas cinco páginas + controles externos, jornada real de 31 checagens (31/31), e auditoria de requests reais do GA4 (sem token). **Não verificado:** GA4 Realtime/DebugView (sem acesso ao painel) e o rate limit da zona (sem permissão de WAF). Detalhes na seção 9.

## 1. Estado no início (verificado, não presumido)

| Item | Valor lido |
|---|---|
| Worker | `use-sul-widget`, versão ativa `f8178f82-31c4-4898-b8d0-9fe0bbeb0c39`, loader 4.0, health `allowlist_size=1`, features `return-link, post-add-discovery, city-search, cart-discovery, cart-mirror` |
| KV | `CART_REFS` `d399f7d6…` no `wrangler.production.toml` versionado (commit `9c2d1f1`) |
| `rollout-cart.sh` | corrigido em `1dd0bab` (preserva as features ativas, inclusive `cart-mirror`) — **ainda assim, para esta rodada use o comando explícito da seção 7**, não o script |
| Storefront | `origin/main` = `af830bf` (consumidor `Meu carrinho` já publicado); consentimento GA4/Meta já existente e restrito; `cart_ref` já era removido do URL e das URLs de analytics |
| Rate limit da zona | informado pelo proprietário: 50 req/10 s/IP em `POST /__origens/cart-ref`. **Não verifiquei** (sem permissão de WAF nesta sessão; `wrangler` deslogado). Limitador do Worker: 20 POST/min/IP/isolate (não alterado) |
| Analytics na INK | a página da INK já carrega `gtag.js` da propriedade **`G-8GYTEJ1F77`** (a mesma do storefront), GTM `GTM-TJWKDN9`, Meta Pixel e TikTok, **sem** condicioná-los ao aviso de cookies (o aviso `.cookie-acceptance` só grava `cookie_acceptance=true` e some) |

## 2. Cinco produtos (verificados ao vivo em 2026-09-24)

Critério: 5 produtos reais do catálogo Use Sul, distintos, por relevância comercial (`totalSalesCount` do snapshot do storefront), com pelo menos um por UF. Cada URL respondeu **200 direto** (sem redirect), com `turbo-frame#cart`, CTA `#add-to-cart-desk` e variantes nativas (modelo/cor/tamanho) e foi adicionado ao carrinho numa sessão anônima descartável (sem finalizar pedido).

| Nome | UF | Slug | URL INK | Storefront | Status |
|---|---|---|---|---|---|
| Serra Catarinense | SC | `serra-catarinense` | https://www.usesul.com.br/usesul/product/serra-catarinense | `/sul/sc` (produto de origem regional; não listado) | 200, em produção |
| Made in Rio Grande do Sul | RS | `made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241` | https://www.usesul.com.br/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241 | não listado em `/sul/rs` hoje | 200 (local) |
| Made in Santa Catarina | SC | `made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829` | https://www.usesul.com.br/usesul/product/made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829 | não listado em `/sul/sc` hoje | 200 (local) |
| Paranaense \| Essência | PR | `paranaense-essencia` | https://www.usesul.com.br/usesul/product/paranaense-essencia | listado em `/sul/pr` | 200 (local) |
| Made in Paraná | PR | `made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a` | https://www.usesul.com.br/usesul/product/made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a | não listado em `/sul/pr` hoje | 200 (local) |

Ficam de fora (200 também, candidatos futuros): `santa-catarina-clean` (layout com mais botões, exigiria auditoria própria), `catarinense-essencia`, `parana-clean`, `rio-grande-do-sul-atlas-do-sul`.

`WIDGET_ALLOWLIST` alvo (exatos, sem curinga):
```
/usesul/product/serra-catarinense,/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241,/usesul/product/made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829,/usesul/product/paranaense-essencia,/usesul/product/made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a
```

## 3. O que mudou

**Worker (`eeccb56`, loader 4.0 → 4.1)**
- A generalização para N produtos já estava na allowlist exata (`parseAllowlist`, `pathAllowed` no loader, `Referer` do `cart-ref` contra `allowlist.paths`); não havia condição fixa na Serra além do destino de retorno. Testes novos: cinco caminhos exatos (e falha fechada com 1 entrada inválida), `POST cart-ref` aceito só dos cinco Referers (com query) e negado para barra final/sufixo/outra rota/outra origem, carrinho de dois produtos.
- Módulo `tracking` (`src/loader/tracking.js`): marca **só os nossos links** para o storefront com `origens_src` (enum) e `origens_p` (slug da página atual, um dos cinco) e emite `origens_explore_storefront_click`; `origens_native_cart_opened` sai **depois** de o drawer nativo estar aberto. Despacho único: o `gtag` que a INK já carrega, `send_to: G-8GYTEJ1F77`, só se o `gtag.js` dessa propriedade estiver na página. **Nunca** intercepta o clique (sem `preventDefault`), nunca envia `cart_ref`/URL/conteúdo do carrinho/PII.
- **Consentimento na INK:** as medições do lado da INK só saem depois de o visitante aceitar o aviso de cookies da INK (o elemento `.cookie-acceptance` some ao aceitar). É conservador (subconta quem ignora o aviso) e reversível: `REQUIRE_INK_COOKIE_NOTICE_ACCEPTED = false` em `tracking.js`. O marcador nos links vai sempre (não é medição).
- Testes contratuais ajustados **conscientemente** (4): as guardas estáticas "sem interceptação de clique" passaram de "sem `addEventListener('click'`" para "sem `preventDefault/stopPropagation`", porque o loader agora escuta (capture) sem interceptar; e os dois testes de `cart-mirror` que comparam o `href` esperado agora incluem `origens_src`/`origens_p`.

**Storefront (`a333578`)**
- `CartRefCapture` consome `cart_ref` **e** o marcador na **mesma** `history.replaceState` síncrona (antes de o GA carregar), preservando UTMs; enum fechado, valor repetido/desconhecido descartado; só então `origens_storefront_arrived` (uma vez), com consentimento e `gtag` prontos (espera até ~10 s; depois descarta, nunca envia depois). Referrer de outra origem que não a INK é ignorado.
- `origens_cart_mirror_view` (uma vez por abertura do painel com snapshot válido) e `origens_go_to_cart_click` (no link, sem atrasar a navegação; `transport_type: beacon`). Tudo atrás do mesmo consentimento existente; `withoutCartRef` também remove os marcadores das URLs de analytics.
- `Ir para meu carrinho` continua apontando para a Serra (fallback estável, sem redesenho).

## 4. Testes locais (todos verdes)

| Suíte | Resultado |
|---|---|
| Worker `npm test` | **203/203** (baseline 190) |
| Storefront `tsc` / ESLint | limpos |
| Storefront Vitest | **211/211** (inclui `origens-events.test.ts`: enums, marcador repetido/injetado, consentimento negado, gtag que lança, espera pelo `gtag`) |
| Storefront Playwright (todas as specs, sem as capturas de evidência) | **124/124** (6 novos: chegada com URL limpa e sem token em nenhum payload, sem consentimento = sem evento, marcador inválido, view uma vez por abertura + clique com bucket, estado de erro sem view, gtag que lança não quebra o link) |
| **QA local em navegador real** `scripts/qa-expansao.mjs` (Worker+KV locais, páginas REAIS da INK, analytics da INK bloqueado) | **27/27** |

O QA local cobre: loader único, 5 features, `← Voltar a procurar` e CTA nativo nas **cinco** páginas em 1280 e 390 (capturas em `docs/evidence/expansao-5/`); dois produtos diferentes (Serra + Paranaense) no mesmo carrinho com snapshot contendo os dois com variantes; abertura do drawer por **"Ver carrinho"** e pelo **ícone**; `Explorar outras camisetas` (pós-adição) e `Explorar vitrine` (drawer) com evento e marcador corretos; retorno `?origens_open_cart=1` com drawer nativo aberto, 2 itens preservados, parâmetro consumido e 1 evento `origens_native_cart_opened`; 3 peças com a promoção da INK (o total/preços vêm da INK: `totalText R$ 304,70` no snapshot); **`Finalizar compra` visível em 1280, 390×844 e 320×640 com a busca aberta**; nenhum POST com Cookie.

Regressão Turbo (A→B→fora→Serra): teste jsdom `tracking.dom.test.js` (montado onde permitido; zero UI/listeners fora). Falha do KV e token expirado do `cart-ref`: já cobertos pelas suítes existentes (`cart-ref.unit`, `cart-ref.workerd`, e2e do consumidor); snapshot vazio: idem.

## 5. Limites do que foi verificado

- (Antes do rollout) Os eventos foram provados no `dataLayer`/`gtag` simulados e no navegador real com as tags bloqueadas para não poluir a propriedade de produção. Depois do rollout, ver a seção 9 para o que foi provado em produção.
- As capturas com "carrinho de 3 peças" mostram o drawer com a busca aberta; a captura exata "total promocional" e a do storefront `Meu carrinho`/retorno dependem do deploy do storefront (o espelho local já existente foi capturado na rodada anterior).
- Erros de Turbo/Stimulus preexistentes da INK não foram investigados nem alterados.
- 429: o limitador do Worker (20 POST/min/IP/isolate) não gerou 429 no fluxo de QA (poucos POSTs, debounce de 800 ms). Se aparecer 429 legítimo em rede compartilhada, documentar a causa **antes** de mexer nele.

## 6. Como medir (resumo; detalhes no doc do storefront)

Eventos: `origens_go_to_cart_click`, `origens_native_cart_opened`, `origens_explore_storefront_click`, `origens_storefront_arrived`, `origens_cart_mirror_view`. Dimensões personalizadas de evento a registrar: `entry_point`, `product_slug`, `cart_items_bucket`, `mirror_age_bucket`. Comparações: `mirror_view → go_to_cart_click → native_cart_opened`; `explore_storefront_click → storefront_arrived` por `entry_point`; volume por `product_slug`. **Clique observado ≠ chegada confirmada**; não há causalidade de vendas.

## 7. Rollout (executado; ver seção 9) e rollback

Ordem da rodada: **1) storefront, 2) Worker**. O `cart_ref` já é sanitizado hoje; o storefront novo só acrescenta eventos e o consumo do marcador, então é seguro publicar antes.

**Capturar antes** (registrar no relatório final): versão ativa do Worker (`f8178f82…`), versão/deployment do storefront no Railway, `curl https://www.usesul.com.br/__origens/health`.

1. **Storefront** — push da branch `feature/expansao-5-tracking` pelo fluxo Git autorizado (nunca com token no URL), merge/deploy pelo fluxo do Railway do proprietário; conferir `Meu carrinho` e que `/sul?cart_ref=…` limpa a URL.
2. **Worker** — login Cloudflare pelo proprietário (`npx wrangler login`), depois:
   ```bash
   npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true \
     --var "WIDGET_ALLOWLIST:<as cinco entradas da seção 2>" \
     --var WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror
   ```
   (o binding `CART_REFS` vem do TOML versionado). Conferir: `allowlist_size=5`, `version` `4.1` no health, cinco features, e `GET` nas cinco URLs com **exatamente um** loader; ≥5 outros produtos reais fora da allowlist (200, sem loader) + home/listagens/checkout sem nossos componentes; `Turbo-Frame` sem injeção. Depois `npx wrangler logout`.
3. **Verificação final curta em produção**: jornada com sessão descartável (dois produtos, os dois caminhos de abertura, `Explorar vitrine` dos dois pontos, `Ir para meu carrinho` no storefront, `Finalizar compra` visível), eventos no GA4 DebugView/Realtime (consentimento aceito nos dois domínios) e `page_location`/`page_referrer` sem `cart_ref`.

**Rollback** (sempre mantendo `cart-mirror`):
- **Worker com defeito num produto novo ou fora da allowlist:** voltar a allowlist só à Serra **mantendo as cinco features**:
  ```bash
  npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true \
    --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense \
    --var WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror
  ```
  ou `npx wrangler rollback f8178f82-31c4-4898-b8d0-9fe0bbeb0c39 --name use-sul-widget -m "rollback expansao-5"` (**informe a versão**: sem ela o Wrangler não garante o estado estável).
- **Só a medição na INK:** o loader 4.1 não altera carrinho/checkout; para desligá-la sem rollback total, publicar sem os módulos que criam links seria excessivo — prefira o rollback acima.
- **Storefront com erro:** reverter só o release dele no Railway (o Worker segue). Sem mexer no proxy do `www`, no DNS nem no checkout da INK.
- Nunca um `wrangler deploy -c wrangler.production.toml` sem `--var` (desliga todo o piloto).

## 8. Commits

- Worker (`feature/ink-loader-fase2a`, no remoto): `eeccb56` (tracking, testes, allowlist/referer), `df78a87` (gate do aviso de cookies da INK, `qa-expansao.mjs`, capturas, este documento) e o commit desta atualização (modo `--live`, capturas de produção, seção 9). A branch do Worker **não foi mergeada** em `main`.
- Storefront: `c95502e` (eventos + marcador) e `bafff82` (`docs/analytics-origens-events.md`), mergeados no `main` pelo PR #2 (`c6b88a4`).

## 9. Rollout executado e verificação em produção

**Antes (capturado):** Worker `f8178f82-31c4-4898-b8d0-9fe0bbeb0c39`, loader 4.0, `allowlist_size=1`; storefront `main` `81f2477` (CMS, PR #1). **Depois:** storefront `main` `c6b88a4` (PR #2, deploy automático no Railway; o bundle publicado passou a conter `origens_storefront_arrived`; `/sul` 200, `/api/ready` `ready:true`, `/admin` no host público 404); Worker `81ce3c6f-47f4-408f-a4f3-e168dc99d395` (deploy manual do proprietário com o comando da seção 7; `wrangler` deslogado ao final). Ordem respeitada: storefront primeiro, Worker depois.

**Health** (`GET /__origens/health`): `version 4.1`, `widget_mode "true"`, `allowlist_status ok`, `allowlist_size 5`, `features_status ok`, `widget_features = return-link, post-add-discovery, city-search, cart-discovery, cart-mirror`.

**Smoke HTTP:** as cinco URLs → 200, `turbo-frame#cart` presente, **exatamente um** loader (`/__origens/loader.js?v=4.1`) cada; requisição com `Turbo-Frame: cart` → 200 **sem** loader. Controles externos **reais**, fora da allowlist: `santa-catarina-clean`, `catarinense-essencia`, `parana-clean`, `rio-grande-do-sul-atlas-do-sul`, `gaucho-essencia` → todos 200 sem loader. `/usesul` e `/usesul/products` 200 sem loader; `/usesul/checkout/contact_and_shipping_details` 302 sem loader; `/` 301. (Um slug inventado para testar 404 não conta como prova de isolamento.)

**Jornada real em produção** (`scripts/qa-expansao.mjs --live`, sessão anônima descartável, tags de analytics da INK bloqueadas, sem finalizar pedido): **31/31**. Loader único + 5 features + retorno + CTA nativo nas cinco páginas em 1280 e 390; Serra + Paranaense no mesmo carrinho com snapshot dos dois e variantes; drawer aberto por "Ver carrinho" e pelo ícone; `Explorar outras camisetas`/`Explorar vitrine` com evento e marcador corretos; **storefront real**: chegada com `?origens_src=…&origens_p=…&cart_ref=…` deixa o endereço em `/sul`, guarda só o token, `Meu carrinho` mostra os dois produtos (`Paranaense | Essência`, `Serra Catarinense`, `Preta · M`, total `R$ 219,80` vindo da INK); `Ir para meu carrinho` → INK com drawer nativo aberto, 2 itens e total preservados, parâmetro consumido, 1 `origens_native_cart_opened`; 3 peças com a promoção da INK (`totalText R$ 304,70`); **`Finalizar compra` visível** em 1280, 390×844 e 320×640 com a busca aberta; nenhum POST do espelho com Cookie. Capturas: `docs/evidence/expansao-5/live-*` (e as locais).

**Requests reais do GA4 (storefront, propriedade `G-8GYTEJ1F77`, uma visita de teste com consentimento aceito e um token sintético na URL):** 2 hits — `page_view` e `origens_storefront_arrived`; `dl=https://www.useorigens.com.br/sul?utm_source=qa` e `dr=https://www.usesul.com.br/usesul/product/paranaense-essencia`; o token e `origens_src`/`origens_p` **não aparecem em nenhum payload**. (O Meta Pixel foi bloqueado no teste. Esses 2 hits reais entram na propriedade: origem `utm_source=qa`, produto `paranaense-essencia`.)

**429 / rate limit:** nenhum 429 no fluxo (todos os POSTs de `cart-ref` retornaram 201). O rate limit da zona (50 req/10 s/IP informado pelo proprietário) **continua não verificado** por mim; o limitador do Worker (20 POST/min/IP/isolate) não foi alterado.

**Não verificado / pendências:** (1) GA4 Realtime/DebugView e o cadastro das dimensões personalizadas e da redação de `cart_ref` no painel (passos em `analytics-origens-events.md`); (2) medição do lado da INK só depois de aceitar o aviso de cookies da INK — os eventos `origens_explore_storefront_click`/`origens_native_cart_opened` foram provados no `dataLayer`, não no painel; (3) regressões preexistentes de Turbo/Stimulus da INK não foram avaliadas; (4) a branch do Worker ainda não foi mergeada em `main`.
