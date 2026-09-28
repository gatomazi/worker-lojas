# Workers da Use Norte e da Use Centro-Oeste

Rodada de 2026-09-28. Objetivo: levar às lojas INK da Norte e da Centro-Oeste a integração já comprovada na Use Sul, com **o mesmo código-base e dois Workers independentes** (`use-norte-widget`, `use-centro-widget`). Vitrines, catálogos, CMS e a Use Sul não foram reconstruídos nem alterados.

**Estado ao fim desta rodada: código, testes, QA em navegador real (Worker local na frente da INK real) e scripts de release prontos e commitados; NADA foi publicado.** As duas lojas estão **BLOCKED** por um item de infraestrutura que só o proprietário resolve (DNS) e por um pré-requisito do storefront (PR regional do espelho do carrinho). Detalhes e comandos exatos na seção 8.

## 1. Inventário real (medido em 2026-09-28)

| | Use Sul (não tocada) | Use Norte | Use Centro-Oeste |
|---|---|---|---|
| Host INK (real, `www` redireciona `/`→`/<prefixo>`) | `www.usesul.com.br` | `www.usenorte.com.br` | `www.usecentro.com.br` |
| Prefixo de produto | `/usesul/product/<slug>` | `/usenorte/product/<slug>` | `/usecentro/product/<slug>` |
| Região no storefront | `/sul` | `/norte` | `/centro-oeste` |
| Storefront (200) | `useorigens.com.br/sul` | `useorigens.com.br/norte` | `useorigens.com.br/centro-oeste` |
| Navbar/CMS | `/api/navbar/sul` (com coleções) | `/api/navbar/norte` (v2, 7 estados, **sem coleções**) | `/api/navbar/centro-oeste` (v2, 4 estados, **sem coleções**) |
| Cidades | `/api/cidades/sul` (1.191) | `/api/cidades/norte` (450) | `/api/cidades/centro-oeste` (468) |
| Busca textual / Meus lugares | 200 / 200 | `/norte/busca?q=` 200 / `/norte/meus-lugares` 200 | `/centro-oeste/busca?q=` 200 / `/centro-oeste/meus-lugares` 200 |
| GA4 (o da própria página da INK = o do storefront da região) | `G-8GYTEJ1F77` | `G-BC2SQTM7PL` | `G-XVDJYYC7YM` |
| Zona Cloudflare | `usesul.com.br` (ativa) | `usenorte.com.br` (ativa) | `usecentro.com.br` (ativa) |
| Conta | mesma (`bc4a9a…`, Workers Paid) | **mesma** | **mesma** |
| DNS do `www` | **Proxied** (IPs Cloudflare) | **DNS-only → Heroku** (`server: Heroku`, sem `cf-ray`) | **DNS-only → Heroku** |
| Workers Routes na zona | 10 (produto, `/__origens`, casca, exclusão `/usesul/*`) | **0** | **0** |
| Worker | `use-sul-widget` (versão ativa `594d5be5…`, 2026-09-27 21:04Z) | não existe | não existe |
| KV | `CART_REFS` (`d399f7d6…`) | não existe | não existe |

URLs reais testadas (todas 200, com `form#form-product-*`):

- **Norte:** `/usenorte/product/acara-origem-pa-51b9a32f-0281-478d-b641-77b8df830cc2`, `/usenorte/product/assis-brasil-origem-ac`, `/usenorte/product/labrea-origem-am`, `/usenorte/product/anori-coordenadas-am`, `/usenorte/product/chupinguaia-coordenadas-ro`.
- **Centro-Oeste:** `/usecentro/product/goiania-origem-go`, `/usecentro/product/campo-grande-origem-ms`, `/usecentro/product/sinop-origem-mt`, `/usecentro/product/made-in-distrito-federal-a5e3ed7c-0ee2-4c4c-b2d0-ba6134c22152`, `/usecentro/product/dourados-origem-ms`.

Registradas no arquivo validado `scripts/store-samples.json` (usado pelos testes, pelo QA e pelo release; `test/stores.test.js` prova que cada URL pertence só à loja dela).

### A Use Sul efetivamente ativa (não assumida)

- Health público: `use-sul-widget`, loader **4.7**, `product-catalog`, allowlist 5, **8 features** (`…, header-nav, list-session`), `shell_pages: true`.
- **Prova de qual código é o de produção:** o `loader.js` servido (`?v=4.7&c=1xljuq5vj4h`, allowlist real embutida) foi comparado byte a byte com o `buildLoaderSource` de cada commit candidato; **`829cbb9`** (`perf(list-session): prefetch…`, ponta da branch `feature/meus-lugares-ink`) coincide (a única diferença é a minificação de aspas de `shellPageKind.toString()` feita pelo esbuild). Esse commit **não é o `main`**: o `main` tem também as abas WhatsApp/Ajuda (PR #8, loader 4.8) **ainda não publicadas** e uma versão anterior de `list-watch.js`.
- **Base desta rodada = `829cbb9` + `a7cbd9e`** (correção do release da Sul). As abas laterais **não** entram; quando forem publicadas na Sul, entram nas duas lojas no próximo deploy delas (merge do `main` nesta branch antes do PR).

## 2. Arquitetura: um código, um Worker por loja

`src/stores.js` é a única fonte por loja (host, prefixo, storefront, endpoints, binding do KV, GA4, UFs/nomes de estado, `shellPages`). **`STORE_ID`** (var do TOML de cada Worker) escolhe a loja:

- ausente = Use Sul (o Worker `use-sul-widget` nunca declarou a variável: nada muda para ele); id conhecido (`norte`, `centro`) = a loja; **qualquer outro valor = fail-closed** (só o health responde, `store_status: "invalid"`, tudo o mais vai direto à INK).
- O Worker só atende o host da própria loja (`www.usenorte.com.br` etc.); outro host = 404. Os gateways (busca, navbar, sessão de compra) nascem por loja, leem **só** `/api/navbar/<região>` e `/api/cidades/<região>` e recusam payload de outra região, link `usesul` ou coleção de outra loja.
- Allowlist: entrada de outra loja invalida a lista inteira (fail-closed).
- O loader é **gerado por loja** (`buildLoaderSource(paths, features, scope, store)`): carrega host, prefixo, base do storefront, região e GA4 da loja e **nenhum literal de outra** (teste). Os módulos deixaram de ter `/usesul`, `/sul`, `useorigens.com.br/sul` e o GA4 da Sul fixos.
- `shellPages: false` para Norte e Centro: home, listagens, coleções, sobre e conta **não** recebem nada (nem rota, nem código). Só produto.
- **KV por loja** (`NORTE_CART_REFS`, `CENTRO_CART_REFS`; a Sul segue `CART_REFS`). Cada registro leva o id da loja; um token de outra loja (ou sem marca, lido por uma loja que não é a Sul) responde 404 **mesmo que um namespace fosse ligado por engano à loja errada**; não há fallback para outro namespace nem uso do nome `CART_REFS` pelas novas lojas (teste com binding trocado = 501). O token tem 128 bits aleatórios (não há segredo criptográfico a sincronizar: o storefront só lê o Worker da região; o segredo do "Meus Lugares" é do storefront e não é compartilhado).
- Otimizações de KV preservadas (nenhuma escrita por pageview/digitação/abertura de menu; snapshot só ao sair para o storefront; TTL 30 min e limites).
- Health por loja: `service` = nome do Worker, `store`, `store_status`, `kv_bound` (só existência do binding), `shell_pages`, features, escopo, versão.

### Configuração e deploys isolados

| | Norte | Centro-Oeste |
|---|---|---|
| TOML | `wrangler.norte.toml` | `wrangler.centro.toml` |
| Worker | `use-norte-widget` | `use-centro-widget` |
| Rotas | `www.usenorte.com.br/usenorte/product/*` e `www.usenorte.com.br/__origens/*` | `www.usecentro.com.br/usecentro/product/*` e `www.usecentro.com.br/__origens/*` |
| KV | `use-norte-cart-refs` → `NORTE_CART_REFS` | `use-centro-cart-refs` → `CENTRO_CART_REFS` |
| Confirmação | `PUBLICAR-NORTE-INK` | `PUBLICAR-CENTRO-INK` |

O TOML é fail-closed (`ENABLE_WIDGET=false`, feature `return-link`, allowlist vazia, id do KV = marcador que faz o `wrangler deploy` falhar). O release resolve o id real num arquivo **ignorado pelo git** (`wrangler.<loja>.resolved.toml`). **Um deploy nunca atualiza dois Workers:** `scripts/release-store.mjs` aceita exatamente uma loja (`sul`, `all`, vazio, lista, etc. são recusados), `deployArgs` amarra arquivo + `--name` + `STORE_ID` à mesma loja (combinação errada = exceção antes de qualquer chamada), e cada loja tem a sua frase de confirmação.

## 3. Rotas e segurança

Só **produto** e **`/__origens/*`** têm Worker. Login (`store_sessions`), carrinho, checkout, pagamentos, pedidos, conta, administração, home, listagens, coleções e sobre **não invocam o Worker**. Não há rota curinga nem exclusão de zona (não há padrão mais amplo que `<prefixo>/product/*`); portanto não há o risco da sobreposição `/usesul*` vs. `/usesul/*` da Sul.

- **Dupla proteção:** rotas restritas + allowlist de `hostname` + `pathname` (slug canônico, sem barra final) + método `GET` + sem `Turbo-Frame` + resposta 200 HTML sem `attachment`/`Content-Encoding` + formulário nativo `form[id^="form-product-"]` (modo catálogo). Página estranha, não-200 ou exceção ao reescrever devolve a INK intacta.
- **Snapshot de rotas antes de qualquer alteração:** `scripts/store-routes.mjs <loja> snapshot` grava id, padrão e Worker de **todas** as rotas da zona com `schema`, `count`, `digest` (sha256) e `zone_id`; é validado (`validateSnapshot`). Snapshot **ilegível, de outra loja/zona, com `count`/digest divergente, sem o campo `routes`, ou de outra zona ativa** bloqueia tudo. Um snapshot **vazio** (zona sem rotas — o caso de Norte e Centro hoje) é válido mas **nunca autoriza `restore`**; o desfazer de uma loja nova é `retire`, que remove **somente** as duas rotas conhecidas cujo Worker é o da loja e confere o resultado contra o snapshot. `restore` (snapshot não vazio) só mexe no host da loja.
- Verificado por teste: nenhuma rota com Worker pode cair em `cart`, `checkout`, `store_sessions`, `login`, `orders`, `payments`, `admin` ou ser curinga do prefixo (`safetyProblems`).
- **Comportamento medido** (QA no navegador + testes workerd): com UTM = 1 loader; **com barra final** (`…/produto/`) a INK responde 200 sem redirect e o escopo é o do slug canônico (igual à Sul): **página nativa, sem loader** — a compra segue normal; slug inexistente = 404 da INK sem loader; cookies, `Set-Cookie`, `Location`, POST e CSRF passam intactos.
- **Fail-open — o que é e o que não é garantido:** exceção ao reescrever, não-200, não-HTML, corpo codificado e formulário ausente → HTML original. **Não** há garantia técnica se a plataforma Cloudflare falhar antes do código (erro 1101/5xx do próprio Worker) ou se a origem estiver fora do ar (a INK estaria fora de qualquer forma). Workers Paid não tem o teto diário do plano gratuito.

## 4. Identidade, navbar, busca e carrinho por região

Cada loja mostra a navbar com o **logo nativo da própria INK** (lido de `a.brand img`), o nome e os estados da própria região, e todos os destinos (logo, Cidades, Regiões, Buscar, "Explorar todas as estampas", resultados de cidade) vão ao storefront **da mesma região** (`/norte`, `/centro-oeste`) preservando `cart_ref` quando há carrinho. A busca textual (lupa, Enter → `/<região>/busca?q=`) não faz requisição ao digitar. Ações nativas da INK (conta, variantes, carrinho, cupom, pedido, "Finalizar compra") não são tocadas; se a navbar não montar, o cabeçalho nativo fica. `/__origens/cart-ref` só aceita `Origin`/`Referer` do próprio host e de uma página autorizada; token de outra loja = 404.

**CMS vazio:** `/api/navbar/norte` e `/api/navbar/centro-oeste` devolvem `top: []` e `more: []` (só estados). A navbar monta com logo, Regiões, Cidades e busca; as coleções aparecem sozinhas quando forem escolhidas no CMS (sem deploy do Worker). É uma lacuna de conteúdo, não de código.

## 5. Pré-requisito no storefront: espelho do carrinho REGIONAL (achado desta rodada)

O consumidor do espelho no storefront (`useorigens-storefront`, `main` c1945c9) **é fixo na Use Sul**: `GET /api/cart-mirror?ref=` consulta `https://www.usesul.com.br/__origens/cart-ref/<ref>`, "Ir para meu carrinho" abre a INK da Sul e a chegada só é aceita com referrer da Sul. Com Workers e KVs separados por loja, um `cart_ref` de `/norte` seria procurado no Worker da Sul (404) e o "Meu carrinho" ficaria neutro — e o botão levaria o cliente Norte ao carrinho da Sul, exatamente o que a tarefa proíbe.

**Adaptação mínima feita (não publicada):** branch `feature/regional-cart-mirror` (worktree `../useorigens-regional-cart-mirror`, commit `88bae68`, base `origin/main`): `GET /api/cart-mirror?ref=&region=sul|norte|centro-oeste` (padrão `sul`; região desconhecida = 404 sem nenhuma consulta), token e captura por região (a Sul mantém a chave `origens:cart_ref`), "Ir para meu carrinho" volta à INK da mesma região, fonte única `CART_MIRROR_STORES`. 90 testes de cart-mirror passam (`tests/unit/cart-mirror-regional.test.ts`); `tsc` e `eslint` limpos; as 14 falhas restantes da suíte (`pages-model`, `pg-stores`) **já existem no `origin/main`** (coleções não sincronizadas no ambiente). Sem esse PR mergeado e no ar, o QA ao vivo reprova o passo "Meu carrinho" com a classe **[Storefront]** — é a lacuna que a seção 8 lista.

## 6. Testes

`npm test` (Worker): suíte compartilhada da Sul **sem alteração de contrato** (um único teste de string foi atualizado: o loader agora expõe `const STORE = {…"inkBase":"/usesul"…}` e `INK_BASE = STORE.inkBase`) + os novos, parametrizados para Norte e Centro com as **URLs reais**:

- `test/stores.test.js` (unit): consistência e unicidade dos campos por loja; `resolveStore`; amostras reais só da própria loja; padrões de produto (nenhum caminho transacional/subcaminho/barra/`%2e`); TOMLs ligados à loja; busca por região (UF/nomes; cidade da Sul não vaza); marca de loja no `cart-ref`.
- `test/stores.workerd.test.js` (workerd real): 1 loader nas páginas reais + UTM; barra final nativa; transacionais/admin/casca **sem** loader; POST e `Turbo-Frame` intactos; `shell_pages:false`; health/identidade/`kv_bound`; loader só com literais da loja; navbar/busca só da própria região (payload de outra região, link Sul, coleção de outra loja e storefront fora do ar → 503 e cabeçalho nativo); cart-ref (origem/Referer de outra loja 403, binding ausente 501, binding da Sul não usado); **token cruzado Norte/Centro/Sul** (namespaces separados e namespace compartilhado por engano); `STORE_ID` ausente = Sul, inválido = fail-closed; allowlist de outra loja recusada.
- `test/stores.dom.test.js` (jsdom, HTML real da INK com host/prefixo trocados): só monta no host+prefixo da loja; logo/Cidades/estados/busca vão a `/<região>`; digitar não faz requisição; ponte do carrinho só para links da região; retorno e descoberta só aceitam `/<região>`; GA4/região corretos.
- `test/store-release.test.js`: recusa de `sul`/`all`/inválidos; TOML de outra loja; snapshot (tudo que o invalida); rotas (apply/retire/restore/segurança); health; sondas de execução.

**QA em navegador real** (`scripts/qa-store.mjs`, Chrome, INK REAL de cada loja atrás do Worker local com KV local e o storefront de produção): ver a seção 7. `qa-store.mjs <loja> --live` repete o mesmo roteiro contra o Worker publicado.

## 7. Resultado do QA local (Worker local na frente da INK real)

`node scripts/qa-store.mjs <loja> --local-worker` (Chrome real; a página de produto é a da INK REAL de cada loja, atravessa o Worker local — mesma reescrita do HTMLRewriter —, com KV local e o storefront de produção respondendo navbar e cidades). Viewports 1280×900, 390×844 e 320×640, sessão anônima descartável, sem compra (o carrinho de teste é esvaziado no fim). Cada viewport confere: 1 loader v4.7 e as 8 features; navbar montada com identidade da loja (logo → `/<região>`, estados da região, **nenhum** literal de outra loja no que é nosso); nada nosso ultrapassa a largura da tela; digitar na busca = **0 requisições** e 0 escritas no KV; Enter → `/<região>/busca?q=belem|goiania` (200); abrir o menu = 0 requisições; variantes nativas → "Adicionar ao carrinho" nativo → modal nativo com o bloco pós-adição (CTA → `/<região>`); drawer com **"Finalizar compra" visível, habilitado, não coberto por nada nosso**; saída com `cart_ref` válido (22 caracteres) e **exatamente uma escrita**; o Worker da loja devolve o resumo só para o token dela (os hosts das outras lojas não o têm). Negativos: UTM (1 loader), barra final (nativa), slug inexistente (404 da INK, sem loader), carrinho/login/início/listagem/rastreio (sem nada nosso), Turbo produto→produto→não coberta→voltar (sem duplicar), outros hosts sem o loader.

| Execução | Resultado |
|---|---|
| **Norte**, completa (`docs/evidence/norte-centro/norte-local-execucao-completa.txt`) | **77 PASS, 3 FAIL** — as 3 falhas são o mesmo passo `[Storefront]` (um por viewport): "Meu carrinho" não aparece porque o storefront em produção ainda consulta o Worker da Sul. Todo o lado Worker/INK passou nos 3 viewports e nos negativos. |
| **Centro-Oeste**, 1280 e 390 completos, 320 até o fim da busca (`…centro-local-execucao-1280-390-320parcial.txt`) | 53 PASS; as únicas falhas registradas são `[Storefront]` (mesmo motivo). A execução caiu no 320 por um `ETIMEDOUT` da INK real ao buscar o HTML (o QA agora tolera isso e segue com a página nativa). |
| Centro-Oeste, 3ª execução (`…com-storefront-fora-do-ar.txt`) | **inválida como prova:** o storefront `useorigens.com.br` passou a **resetar conexões TLS** (`Connection reset by peer`, o mesmo incidente da rodada anterior): a navbar não monta (o gateway recebe 503 e o Worker, corretamente, deixa a INK nativa), `ERR_CONNECTION_RESET` ao navegar ao storefront. Reexecutar quando o storefront voltar: `node scripts/qa-store.mjs centro --local-worker`. |

Evidências (PNG por viewport: produto, busca aberta, menu, pós-adição, carrinho, resultado da busca no storefront) em `docs/evidence/norte-centro/{norte,centro}-local/`. Achado do QA (não é do Worker): o `scrollWidth` da INK **nativa** já excede a tela (+3 px em 390, +38 px em 320, medido sem Worker nas três lojas, por causa do drawer do carrinho fora da tela); a verificação é que **nada nosso** ultrapasse a largura.

Suíte do Worker: **418/418** (`npm test`)

## 8. Release (comandos exatos) e o que precisa de confirmação

### O que exige ação/confirmação (por loja — hoje ambas BLOCKED)

1. **DNS (bloqueante, só o proprietário):** no Cloudflare da zona `usenorte.com.br` (e `usecentro.com.br`), mudar o registro do host `www` (CNAME `…herokudns.com`) de **DNS only** para **Proxied**. Sem isso, Workers Routes **não têm efeito**. O token OAuth do wrangler não tem permissão de DNS (403 medido), por isso não foi feito. Antes: conferir em *SSL/TLS → Visão geral* que o modo é o mesmo da zona da Sul (Full/Full strict); depois: abrir a INK e conferir que `curl -I https://www.usenorte.com.br/usenorte` mostra `server: cloudflare`.
2. **Criar** (feito pelo `--deploy`, só com a frase de confirmação): Worker `use-<loja>-widget`, KV `use-<loja>-cart-refs` (binding próprio) e as **duas** Workers Routes da loja. Nenhum segredo é necessário.
3. **Storefront:** mergear e publicar o PR regional do espelho (seção 5) antes do QA ao vivo do carrinho.
4. (Opcional, sem deploy do Worker) escolher coleções no CMS das duas regiões.

### Comandos

```bash
# 1) SOMENTE LEITURA (sem rede de escrita): pré-condições, plano e dry-run local. Exit 0 = APTO.
node scripts/release-store.mjs norte  --check
node scripts/release-store.mjs centro --check

# 2) Publicar UMA loja (trava dupla: --deploy + frase). Uma de cada vez; a segunda só depois de a primeira passar.
RELEASE_CONFIRM=PUBLICAR-NORTE-INK  PW_PATH=/Users/gtomazi/projects/useorigens node scripts/release-store.mjs norte  --deploy
RELEASE_CONFIRM=PUBLICAR-CENTRO-INK PW_PATH=/Users/gtomazi/projects/useorigens node scripts/release-store.mjs centro --deploy
```

`--deploy`: (0) `--check` sem FAIL → (1) snapshot validado das rotas → (2) KV + TOML resolvido → (3) **fase 1** (Worker + rotas, escopo `allowlist` com 3 produtos reais, 8 features): espera de propagação, health, rotas finais e segurança estática, **prova de execução com `wrangler tail`** (produto invoca o Worker; login, carrinho, checkout, pedidos, home, listagens e coleções **não**, com e sem query), smoke público → (4) **fase 2** (`product-catalog` só neste domínio): health, smoke e **QA ao vivo** (1280/390/320, carrinho anônimo real, `cart_ref`, negativos) → falha crítica em qualquer passo: **evidência salva antes** (`.release/<loja>/evidence/<ts>/`) e desfazer só esta loja (fase 2 → `wrangler rollback` para a versão da fase 1; fase 1 → `retire` das duas rotas). Não faz compra, push nem merge.

### Rollback independente (por loja)

```bash
RELEASE_CONFIRM=REVERTER-NORTE-INK  node scripts/release-store.mjs norte  --rollback   # fase 2 → volta à fase 1; só fase 1 → retira as 2 rotas
RELEASE_CONFIRM=REVERTER-CENTRO-INK node scripts/release-store.mjs centro --rollback
# manuais equivalentes:
node scripts/store-routes.mjs norte retire --snapshot=.release/norte/routes-snapshot-<ts>.json
npx wrangler rollback <versão-da-fase-1> --name use-norte-widget
```

Nenhum desses comandos referencia `use-sul-widget`; a outra loja não é tocada.

## 9. Medição inicial (Cloudflare GraphQL, `scripts/store-metrics.mjs`, últimas 24 h, 2026-09-28)

Conta (agregado): **26.592 requisições, 0 erros, 25.489 subrequisições** — `use-sul-widget` 26.297 req (25.489 subreq, 0 erros), `diones-bonadiman` 295 req (outro projeto). KV `CART_REFS` (Sul): **13 leituras, 19 escritas**. Norte e Centro: sem Worker nem KV ainda (0). As franquias de Worker e KV do plano **Workers Paid são da conta** (10 M req/mês e 1 M escritas de KV/mês inclusas): o volume atual usa uma fração ínfima; cada loja nova acrescenta uma invocação por abertura de produto (HTML) mais, na 1ª visita por configuração, `loader.js`/`discovery.js` (imutáveis por 1 ano) e `/__origens/navbar` (cache de 60 s). Rode `node scripts/store-metrics.mjs` antes e depois de cada publicação para registrar o consumo por Worker e por namespace. Nenhuma assinatura extra é necessária.

## 10. Confirmações e lacunas honestas

- **`use-sul-widget` não foi alterado:** nenhum `wrangler deploy/rollback/versions` foi executado contra ele; `wrangler.production.toml` está idêntico ao do `main`; nenhuma rota, DNS, KV ou WAF da Sul foi tocado (todas as chamadas à Cloudflare desta rodada foram GETs). O código compartilhado mudou no repositório, mas **só chega à Sul se ela for publicada de novo** (o comportamento com `STORE_ID` ausente = Sul está coberto por teste).
- Lacunas conhecidas: URL com barra final fica nativa (igual à Sul); páginas de casca e conta **fora** nas duas lojas nesta rodada; sem analytics `ink_navbar`; coleções vazias nos CMS regionais; o QA ao vivo depende do DNS proxied e do PR regional do storefront.
- Antes do merge do PR do Worker: publicar as duas lojas e só então mergear; se um QA crítico falhar, **não** mergear. Ao mergear, fazer antes o merge do `main` nesta branch (traz as abas WhatsApp/Ajuda; o `list-watch.js` desta branch, mais novo que o do `main`, prevalece) e rodar `npm test` de novo — as abas só passam a valer nas lojas no próximo deploy delas.
