# Expansão global — catálogo inteiro da Use Sul (preparada em 2026-09-24/25; NADA foi publicado)

## Status: **READY** (com pendências manuais listadas na seção 9)

Nada foi publicado, enviado ou mesclado. Sem `wrangler login`, sem deploy/rollback, sem push/merge, sem tocar em DNS, WAF, rotas ou KV real. Produção continua **nos cinco produtos, com as seis features** (conferido só por leitura pública, seção 3). Amanhã resta **uma decisão e um comando** (seção 10).

Branch local `feature/expansao-global` (a partir de `origin/main` = `aecd7a6`), commits locais: `4765488` (escopo + espelho sob demanda), `e7b8948` (preflight/release/verificações), `f479a8e` (falha aberta, URLs com hash, QA) e o commit desta documentação.

## 1. O que mudou (5 produtos → todo o catálogo)

**Escopo dinâmico `WIDGET_SCOPE_MODE=product-catalog`** — desligado por padrão. Sem a variável (ou com qualquer valor diferente, inclusive erro de digitação) vale a allowlist exata de cinco produtos; `ENABLE_WIDGET=false` continua sendo o kill switch global; o health mostra `scope_mode` e `scope_status`.
No modo novo o Worker só injeta o loader quando **todas** as condições valem: `GET`, host `www.usesul.com.br`, caminho canônico `/usesul/product/<slug>` (regex `^/usesul/product/[a-z0-9][a-z0-9_-]{0,127}$`; **os 9.775 slugs do catálogo conferem**, sem sub-caminho, barra final, `%`, `..`, maiúsculas, placeholders), sem `Turbo-Frame`, origem **200**, `text/html`, sem `attachment`, e o **formulário nativo de compra** (`form#form-product-<id>`) visto **no mesmo passe de streaming** (nada é bufferizado nem duplicado). Injeta **um** `<script src="/__origens/loader.js?v=4.3&c=<hash>">` no fim do `<body>` (depois da detecção); sem `</body>` ou sem formulário, o HTML segue intacto. Uma tag do loader já presente na origem impede a segunda injeção.
O loader recebe o modo embutido, valida a **URL** e a **presença do formulário nativo** a cada mudança relevante (`turbo:visit/render/load`, mutações) e desmonta tudo (UI, estilos, listeners) ao sair de um produto. Nenhum bundle por slug. A allowlist de cinco continua embutida como plano B instantâneo (reverter = voltar `WIDGET_SCOPE_MODE`).
Nunca atingidos: `/usesul`, `/usesul/products`, `/usesul/cart`, `/usesul/checkout*`, `/admin/*`, outros hosts/lojas, Turbo-Frame, POST/PUT/DELETE, 404/500/redirect, HTML sem o formulário nativo.
O `POST /__origens/cart-ref` aceita `Referer` de qualquer página canônica de produto no modo novo (e só as cinco no padrão); nunca listagem/carrinho/checkout/outra origem.

**Falha aberta** (a compra não depende do nosso sistema): qualquer erro na reescrita devolve a página original da INK; erro inesperado em `/__origens/cart-ref*` responde `503 {"error":"unavailable"}` (o cliente navega sem token); KV indisponível/429 (`put`/`get` que lançam) também vira 503 em vez de exceção. O loader e o espelho nunca interceptam controles nativos nem o checkout.

**Copy/descoberta**: intactos (título "Continue explorando", "Descubra outras estampas", busca rotulada "Buscar cidade ou estado" só do índice geográfico, "Explorar todas as estampas"). Eventos GA4 e consentimento: intactos (`origens_explore_storefront_click`, `origens_storefront_arrived`, `origens_go_to_cart_click`, `origens_native_cart_opened`, `origens_cart_mirror_view`, `origens_discovery_search_open`; `entry_point` = `ink_product_detail`/`ink_post_add`/`ink_cart_drawer`/`ink_product_return`/`storefront_*`). Nenhuma divergência encontrada.

## 2. Redução das gravações no KV (sem trocar de armazenamento)

**Antes:** o espelho gravava 1 `KV.put` por página com carrinho (a cada carregamento completo e a cada remontagem do Turbo), por mudança de quantidade/variante (debounce de 800 ms) e a cada 20 min. **Agora** só há gravação **quando o cliente sai por um link nosso** (`Explorar todas as estampas`, resultado de busca, link de retorno), e só se o estado efetivo mudou ou o token venceu:
- O estado é um **fingerprint** determinístico (produto, variante, quantidade, preço da linha, preço cheio riscado, total, desconto, contagem), lido do DOM **no instante do clique**; classes, imagem e espaços não contam. Só `{fingerprint, token, criado-em}` fica em `sessionStorage` da aba, no domínio da INK (nunca compartilhado com o storefront; sem conteúdo do carrinho).
- Mesmo carrinho de novo (também após recarregar a aba) → **reutiliza o token, 0 writes**; nunca renova nem alonga o TTL (30 min no servidor; reuso até 25 min; token vencido descartado).
- `pointerdown` adianta o snapshot; chamadas simultâneas se **deduplicam**; a navegação espera **no máximo 1,2 s**; **timeout/429/5xx/JSON inválido/rede ⇒ navega normalmente sem token novo**, com _cool-down_ de 15 s para o mesmo estado (sem martelar). Cliques com Ctrl/⌘/Shift/botão do meio/`target=_blank` nunca esperam nem gravam.
- Carrinho vazio: só grava um snapshot vazio se **esta aba** já transferiu um carrinho com itens (para o espelho deixar de mostrá-lo), uma vez; sem token anterior, nada. Sem mecanismo cross-tab (duas abas escrevem uma vez cada; não afirmamos consistência entre abas).
- Contadores agregados **sem PII** no `health` (por isolate): `cart_ref_stats {writes, write_failures, reads, read_hits, read_misses, rate_limited, rejected}`; e, no navegador, `window.__useOrigensMirrorStats` (só memória, nada é enviado).
- Limitador por IP do Worker (20 POST/min/IP/isolate): **não alterado**. Com writes sob demanda o volume por IP cai muito; se um NAT legítimo exceder, a jornada continua sem espelho (testado: 429 ⇒ navega sem token). A regra WAF da zona (50 req/10 s/IP) **não foi alterada nem lida** (sem permissão).

**Custos medidos** (teste `test/kv-cost.dom.test.js`: cliente real em jsdom + módulo `cart-ref` real + KV instrumentado; e QA em navegador real):

| Cenário | `KV.put` |
|---|---|
| 100 visualizações de produto (cargas completas) com carrinho inalterado | **0** |
| Abrir/fechar o drawer 20×, eventos Turbo, buscas, visitas Turbo | **0** |
| Transferir o MESMO carrinho 5× seguidas (e após recarregar a aba) | **1** |
| Alterar quantidade/variante e transferir | **+1** (total 2; a mutação sozinha não grava) |
| KV indisponível (`put` lança) | 0 gravados; todas as saídas navegam; 1 tentativa por estado (depois _cool-down_) |

No navegador real (INK real, Worker+KV locais): adicionar 2 produtos (cidade + não geográfico), 3 recargas, 4 aberturas do drawer → **0 POST**; 1ª saída → 1 write, token válido, espera < 4 s; 2ª e 3ª saída (páginas novas) → **0 writes, mesmo token**; carrinho alterado (3 peças, promoção da INK) → não grava sozinho, a saída grava 1 e o token muda; POST devolvendo 503 → a saída chega ao storefront **sem token** em < 4 s e o carrinho nativo/`Finalizar compra` seguem intactos.

**Consistência eventual (risco conhecido).** O KV pode levar ~60 s ou mais para expor uma chave nova em outra região, e uma consulta negativa pode ficar em cache. Não prometemos leitura imediata global. Hoje, se o servidor do storefront receber `404` de um token recém-criado, ele o trata como vencido e limpa o token (estado neutro; o carrinho real da INK continua acessível). Não aumentei retries nem fiz a vitrine esperar o KV (o storefront não foi alterado). **Como monitorar antes de considerar outra tecnologia:** no `health`, `read_misses` vs `writes` (por isolate; amostrar várias vezes), no painel o KV (reads/writes) e nos logs do storefront a taxa de 404 do `GET /__origens/cart-ref/<token>` nos primeiros 2 minutos de vida do token; só se a taxa incomodar avaliar (a) um _retry_ único de ~1,5 s no servidor do storefront preservando o token, ou (b) D1/DO. Nada disso foi feito.

## 3. Estado de produção protegido (leitura pública em 2026-09-25 00:xx; `wrangler` deslogado)

`GET /__origens/health`: `service use-sul-widget`, `version 4.2`, `widget_mode true`, `allowlist_status ok`, `allowlist_size 5`, `features_status ok`, features `return-link, post-add-discovery, city-search, cart-discovery, cart-mirror, product-discovery` (o health atual ainda não informa `scope_mode`: significa cinco produtos). Versão ativa **conhecida pelo último deploy do proprietário**: `4a3c5d13-632e-4fed-b6b8-028c0c40595d` (passo B da Fase 6); **não confirmada esta noite** (exigiria login): o release captura e valida a versão ativa real antes de qualquer deploy.
`scripts/smoke-global.mjs --expect=allowlist` contra produção: **35/35** (cinco páginas 200 com 1 loader; 15 produtos reais da amostra fora do escopo 200 **sem** loader; `/usesul`, `/usesul/products`, `/usesul/cart`, checkout, produto inexistente, sub-caminho e Turbo-Frame sem loader; gateway de busca e `cart-ref` respondendo). Binding `CART_REFS` no `wrangler.production.toml` versionado (id `d399f7d6…`); rotas: só `www.usesul.com.br/usesul/product/*` e `/__origens/*`; TOML segue fail-closed.

## 4. Testes desta rodada (resultados reais)

| Verificação | Resultado |
|---|---|
| `npm test` (Node test runner + workerd/Miniflare reais + jsdom) | **266/266** (baseline 217; ~46 s) |
| Escopo em workerd real (`scope.worker.test.js`): padrão = só cinco (`<head>`), catálogo = 1 loader no fim do `<body>` com o resto **byte a byte idêntico**, rotas transacionais/odd paths/POST/Turbo-Frame/404/500/302/JSON/texto/anexo/sem formulário/gzip/streaming grande, kill switch, valor de escopo inválido | ok |
| Loader (`scope.dom.test.js`): qualquer produto com formulário monta (allowlist vazia); rotas não-produto, URL de produto **sem** formulário, host errado = zero UI; Turbo A→B→home→A e 404→A = 1→1→0→0→1 | ok |
| Espelho (`cart-mirror.dom.test.js` 26 + `kv-cost.dom.test.js` 3 + `cart-ref.unit.test.js`): custo do KV, falhas 429/500/503/JSON/rede/timeout, token vencido, cliques rápidos/abas, 20 linhas, promoção, vazio, links só nossos | ok |
| **QA em navegador real** `scripts/qa-global.mjs` (páginas REAIS da INK, Worker+KV locais, HTML passando pelo Worker de verdade) | **50/50**: 20 produtos reais (8 famílias de cidade + 12 não geográficos: identidade regional, redesenhos, expressões, humor, "feito para você") em 1280 e 6 em 390 e 320×640, 1 loader/1 bloco/CTA e sticky livres, jornada com 2 produtos de coleções diferentes, KV, 3+ peças, `Finalizar compra` visível em 1280/390/320×640 com a busca aberta |
| QA legado adaptado: `qa-drawer` desktop 24/24, `qa-cart` desktop 29/29, `qa-cart-many` 3 itens desktop 18/18 e **8 itens em 320** 18/18 | ok |
| `scripts/verify-scope-real.mjs` (HTML real da INK pelo Worker local, só leitura): 20 produtos + rotas reais não-produto + modo padrão | **60/60** |
| `wrangler deploy --dry-run` (sem login/publicar) com o conjunto completo de variáveis | compila: 86,18 KiB / gzip 24,59 KiB, bindings `CART_REFS` + 4 vars |
| Benchmark local (`scripts/bench-injection.mjs`, HTML de 193 KB): repasse 3,7 ms p50 · injeção no `<head>` 3,6 ms · injeção no `<body>` 3,4 ms (indicador relativo, não CPU faturada); `loader.js` 33,5 KB (10,2 KB gzip), `discovery.js` 24,3 KB (7,7 KB gzip) | injeção ≈ custo de repasse |
| `bash scripts/preflight-global.sh` (sem deploy) | **READY**, 4 avisos manuais (seção 8) |

Não executado à noite (por regra): qualquer coisa que exija Cloudflare autenticada (versão ativa via `deployments list`, plano, rotas/WAF no painel), o QA `--live` e o GA4 Realtime/DebugView.

## 5. Estimativa de consumo (hipóteses explícitas — trocar pelos números reais do painel)

**Fatos do código:** a rota `www.usesul.com.br/usesul/product/*` já invoca o Worker em **toda** página de produto hoje (fora da allowlist ele só repassa), então o volume de invocações de HTML **não aumenta** com o escopo global. O que cresce: `loader.js` e `discovery.js` — mas agora com URL por hash de conteúdo e cache **imutável de 1 ano** no navegador: 1 requisição de cada por navegador **por configuração** (deploy/troca de escopo), não por visualização. Referência informada pelo proprietário (Workers Paid): 10 M requests/mês e 1 M writes de KV/mês incluídos; excedentes podem gerar cobrança (não afirmo valores).

Modelo: requests ≈ P × (1 + f·2 + 0,15 + 0,03), onde P = visualizações de produto/mês, f = fração de visualizações com cache frio (≈ 0,5 no primeiro mês, ≈ 0,3 estável), 0,15 = buscas digitadas (≈ 5 % das visualizações × 3 consultas) e 0,03 = `cart-ref` (POST + GETs do storefront).

| P (visualizações/mês) | Requests do Worker (f=0,5) | % de 10 M | Writes KV (0,5–2 % de P) | % de 1 M |
|---|---|---|---|---|
| 300 k | ≈ 0,7 M | 7 % | 1,5–6 k | < 1 % |
| 1,5 M | ≈ 3,3 M | 33 % | 7,5–30 k | 1–3 % |
| 4,5 M | ≈ 9,9 M | ≈ 100 % | 22,5–90 k | 2–9 % |

O primeiro limite a olhar é **requests**, só acima de ~4 M visualizações/mês; o KV fica muito abaixo de 1 M writes. **Antes** do ajuste, com ~7 % das visualizações com carrinho, um carregamento completo gravava por visualização (a base de 1 M seria atingida perto de 10–15 M de visualizações/mês, mais cedo com muitas mudanças de quantidade). O Pixel/GA4 medem visualizações do navegador (com consentimento) e **não** são invocações do Worker; use o painel do Worker (Requests), não o Pixel.
**Limites de observabilidade para o operador (dia 0, 1, 7):** requests/dia > 250 k (75 % da média de 333 k/dia); writes KV/dia > 25 k; erros 5xx do Worker > 1 % por 15 min; qualquer 5xx de `/__origens/cart-ref*`; 429 acima de ruído; CPU p99 acima de ~10 ms.
**Roteiro de painel (amanhã):** Cloudflare → Workers & Pages → `use-sul-widget` → **Metrics** (Requests por status, Errors, CPU time p50/p99, Subrequests, Duration) → Workers KV → `CART_REFS` → **Metrics** (Reads, Writes, Storage) → Security → **Events** filtrando a regra de `cart-ref` (429) → registrar o baseline **antes** do release e às +1 h, +24 h, +7 d.

## 6. Modo de falha das Workers Routes (documentado, NÃO alterado)

No painel, Workers Routes → rota `www.usesul.com.br/usesul/product/*` → **Failure mode**: preferir **Fail open** (se o Worker falhar ou estourar limite, a requisição segue para a origem/INK), quando suportado na conta; `/__origens/*` pode continuar como está. O código já cobre a parte que controla: falha na reescrita devolve a página original e o espelho responde 503 JSON. **Conferir/ajustar amanhã, manualmente.**

## 7. Rollback (automático no release e manual)

- **Automático** (`release-global.sh`, etapa F): qualquer falha crítica após a captura ⇒ `wrangler rollback <versão capturada na etapa A> --name use-sul-widget --yes`, confirma que o health volta a ser **idêntico** ao capturado (versão, escopo, seis features, allowlist 5) e roda o smoke dos cinco produtos. Se falhar, plano B: republica **o código atual** no escopo de cinco produtos com as **seis features** e confirma; se também falhar, imprime o comando manual e para. **Nunca** faz rollback genérico para "a versão anterior" nem desliga o `cart-mirror`; nunca usa deploy sem `--var`.
- **Manual, só o escopo** (mantém o código novo): `deploy_worker allowlist` (via `bash -c 'source scripts/global-common.sh && deploy_worker allowlist'`) ou o comando completo com `--var WIDGET_SCOPE_MODE:allowlist` e as demais variáveis (`scripts/global-common.sh` mostra o conjunto exato).
- **Manual, tudo:** `npx wrangler rollback <versão capturada> --name use-sul-widget --message "rollback" --yes` (a versão fica registrada em `.release/capture-*.json`, fora do Git).
- Cache: o loader/discovery têm URL por hash de conteúdo; troca de escopo/rollback muda a URL, sem janela de conteúdo velho. Tags antigas (`?v=`) recebem o conteúdo atual com cache de 60 s.

## 8. Scripts (nenhum publica sem `--deploy` + confirmação)

- `scripts/preflight-global.sh` — **somente leitura**, sem login: Git (árvore limpa), configuração (TOML fail-closed, rotas, `CART_REFS`, argumentos de deploy completos, nenhum `wrangler deploy` fora de `deploy_worker`, `rollout-cart.sh` bloqueado), `npm test`, `verify-scope-real`, `--dry-run`, health e smoke públicos; termina em **READY** ou **BLOCKED: motivos**. Resultado desta noite: **READY** (4 avisos manuais/autenticados, seção 9; nenhum bloqueia).
- `scripts/release-global.sh --deploy` — trava dupla (`--deploy` **e** a frase `PUBLICAR-CATALOGO-COMPLETO` digitada, ou `RELEASE_CONFIRM`), confirmação do plano Workers Paid, `wrangler whoami` na conta esperada; etapas A (captura) → B (código novo, cinco produtos) → C (só `WIDGET_SCOPE_MODE=product-catalog`) → D/E (smoke público em 20 produtos + `qa-global.mjs --live`) → F (rollback). Imprime a configuração não secreta antes de cada deploy. **Não foi publicado esta noite.** Testado: sem argumento/argumento errado/sem confirmação/sem plano ⇒ nada publica; com `--deploy` + as duas confirmações e o Wrangler **deslogado** ⇒ roda o preflight completo (READY) e **para** em "PARADO: wrangler NÃO autenticado… rode npx wrangler login", sem deploy. (Não testei o rollback automático contra a Cloudflare: exige login; a lógica de captura/comparação de versão e de health tem testes unitários.)
- `scripts/smoke-global.mjs`, `scripts/verify-scope-real.mjs`, `scripts/qa-global.mjs` (local e `--live`), `scripts/bench-injection.mjs`, `scripts/catalog-sample.json` (20 slugs reais verificados em 2026-09-24).
- `scripts/rollout-cart.sh` (obsoleto: desligaria o espelho) e `qa-expansao.mjs`/`qa-mirror.mjs` (semântica antiga do espelho) ficaram **bloqueados** (`QA_LEGACY=1` reabre os dois QAs históricos).

## 9. Pendências que exigem o proprietário (nenhuma bloqueia o comando)

1. `npx wrangler login` (aprovar o OAuth) — o comando já inclui.
2. Confirmar **no painel** que a conta está em **Workers Paid** (o script pergunta).
3. Painel: modo de falha da rota de produto (seção 6); regra WAF de `cart-ref` (50 req/10 s/IP) ativa; baseline de Requests/KV (seção 5).
4. GA4: Realtime/DebugView e dimensões (`entry_point`, `product_slug`, `cart_items_bucket`, `mirror_age_bucket`) — não bloqueia.
5. Decidir se e quando enviar/abrir PR da branch (nenhum push foi feito; o release usa o código local).

## 10. O comando de amanhã

```bash
cd /Users/gtomazi/projects/use-origens-workers && npx wrangler login && bash scripts/release-global.sh --deploy
```

`wrangler login` abre o OAuth no navegador (**você aprova**); o script então pede duas confirmações interativas (a frase `PUBLICAR-CATALOGO-COMPLETO` e "sim" para o plano Workers Paid), roda o preflight completo, captura a versão ativa **real** (é ela que vai a rollback) e executa A→F. Ao terminar: `npx wrangler logout`. Para só conferir sem publicar: `bash scripts/preflight-global.sh` (ou `--quick`).
