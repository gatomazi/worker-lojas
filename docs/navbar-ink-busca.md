# Navbar da INK com busca textual redirecionada ao storefront (loader 4.4, feature `header-nav`)

Estado: **implementado e testado localmente; NADA publicado** (nem Worker, nem storefront). Branch `feature/ink-navbar-search` (base: `main` com o release global). Storefront: `feature/navbar-text-search` no repositório `useorigens` (worktree `useorigens-navbar-search`). Plano de origem: `plano-navbar-ink-busca-textual.md`.

## Arquitetura encontrada e o que foi feito

**Worker (este repo).** O loader é um único script injetado no fim do `<body>` das páginas de produto (escopo `product-catalog`), composto por módulos ligados por `WIDGET_FEATURES`. O cabeçalho real da INK tem dois `<nav class="navbar">`: o desktop (`ul.navbar-list` + `a.brand` + busca nativa + `.menu-icons` de conta/carrinho) e o mobile (`.navbar__top` com hambúrguer, `a.brand`, lupa e carrinho, mais `#navbar-list-mobile`). A busca nativa da INK envia para a busca da própria INK; agora a lupa nossa leva ao storefront.

| Arquivo | Ação |
|---|---|
| `src/loader/header-nav.js` | **novo** módulo `header-nav` (idempotente, Turbo-safe) |
| `src/stores.js` | **novo** configuração por loja (Sul): host INK, base de caminhos, origem do storefront, API da navbar |
| `src/navbar-gateway.js` | **novo** `GET /__origens/navbar`: lê `useorigens.com.br/api/navbar/sul` no servidor, valida e re-serve (60 s) |
| `src/features.js`, `src/loader-source.js`, `src/worker.js` | feature `header-nav`, bundle, rota (só com `ENABLE_WIDGET=true` + feature); `LOADER_VERSION` 4.3 → **4.4** |
| `src/loader/cart-mirror.js` | 1 linha: links `[data-origens-nav]` contam como "nossos" (mesmo fluxo `cart_ref` já em produção) |
| `test/header-nav.dom.test.js` (20), `test/navbar-gateway.workerd.test.js` (6), fixture `test/fixtures/ink-header.html` (cabeçalho real) | testes |
| `scripts/qa-navbar.mjs` | QA em navegador real contra a página real da INK (local; nada é publicado) |
| listas de módulos (`test/helpers.js`, `scripts/*.mjs`) | novos módulos registrados (senão o workerd trava) |

**Storefront** (`useorigens`, ver `docs/navbar-text-search.md` lá): `GET /sul/busca?q=` (produtos reais, paginação real), `GET /api/navbar/sul` (configuração pública enxuta), CMS: coluna "Navbar da INK" na biblioteca de coleções.

## Comportamento

- **Fail-aberto.** Só monta se a configuração chegou e validou (uma tentativa por carregamento; falhou = nada muda). O cabeçalho nativo **nunca é removido**: é escondido por CSS `header:has([data-origens-nav]) …` enquanto o nosso existir no mesmo `<header>`; o Turbo troca o `<body>` e o cabeçalho volta nativo sozinho até remontar. Conta, carrinho, hambúrguer, menu lateral e serviços (Entrar/Rastreio/Trocar pedido/Dashboard) ficam intocados.
- **Desktop:** logo (→ `useorigens.com.br/sul`), até 5 coleções + "Mais", "Cidades" (→ `/sul#estados`), lupa. **Mobile:** hambúrguer, logo, lupa e carrinho; coleções e "Cidades" no topo do menu lateral nativo (a "Categorias" nativa some só quando as nossas existem).
- **Busca:** lupa fechada por padrão; clique abre UM campo com foco, sem sugestão nem requisição por tecla. Enter/"Buscar" → `https://useorigens.com.br/sul/busca?q=<URLSearchParams>` (consulta trimada, espaços colapsados, máx. 80). Vazio/só espaços: não navega, devolve o foco ao campo. Escape fecha e devolve o foco à lupa. Abrir a busca fecha o menu lateral aberto e vice-versa.
- **Carrinho:** o "Buscar" só é um link (`href`) quando há texto; a saída (logo, Cidades, Buscar) passa pelo cart-mirror existente: snapshot **uma vez** na saída se o carrinho mudou, token reaproveitado se não mudou, **0 POST** ao digitar/abrir/fechar, timeout seguro (1,2 s) e navegação com `q` mesmo se o snapshot falhar. `q` e `cart_ref` são independentes; nada do carrinho vai na URL além do token.
- **Coexiste** com o bloco "Continue explorando"/"Buscar cidade ou estado" (busca geográfica), que segue separado.

## Validação (local, sem publicar)

- `npm test`: **296/296** (270 anteriores + 26 novos). Storefront `vitest`: **529/529** + `tsc` + `eslint` limpos.
- `scripts/qa-navbar.mjs` contra `https://www.usesul.com.br/usesul/product/paranaense-essencia` (loader local no lugar do de produção; configuração e `cart-ref` respondidos por `page.route`, nenhum KV real): **26/26** em 1280/390/320×640 (sem sobreposição, sem overflow novo, pesquisa nativa escondida, carrinho e conta nativos, 0 requisições ao digitar, destino/Escape/vazio, menu lateral sem busca junto).
- Claude in Chrome (Chrome real, sessão logada, carrinho com 4 itens): header desktop montado, lupa → campo → Enter navegou para `useorigens.com.br/sul/busca?q=chimarr%C3%A3o` **com `cart_ref`** (o `cart-ref` foi stubado: nada gravado em produção); "Mais"; mobile a 500 px com menu lateral. Capturas em `docs/evidence/navbar-ink-search/`.

## Lacunas e decisões

1. **Analytics da navbar não foi implementado** (o plano não pede): os links da navbar não emitem `origens_explore_storefront_click` nem levam `origens_src`; a chegada no storefront não tem atribuição `ink_navbar`. Exigiria valor novo no enum fechado do storefront (mesma ordem de publicação: storefront antes do Worker).
2. **Wordmark:** o logo é a imagem que a própria INK já carrega; "USE ORIGENS" usa a pilha `Big Shoulders Display, Arial Narrow, Impact` (a fonte do storefront não é carregada na INK: sem fontes externas).
3. **Sem coleção configurada no CMS a navbar monta só com logo, "Cidades" e busca** (e a "Categorias" nativa continua). Escolha as coleções no CMS **antes** de ligar a feature.
4. **Ordem do menu** = posição da coleção na INK (a opção "aproveitar a ordem existente" do plano); máx. 8 coleções.
5. **Loja única (Sul)** por enquanto, mas todo dado de loja mora em `src/stores.js`.

## Fechamento (rodada 2): os dois bloqueios resolvidos

**1. Busca completa por coleção (storefront).** O snapshot guardava só os 48 primeiros ids de cada coleção (`memberIds`, vitrine). Agora o sync de coleções grava também `searchMemberIds` = **todos** os ids casados com o catálogo, **só das coleções públicas** (a segmentação interna de 100 mil ids continua fora; o arquivo de coleções foi de 78 KB para 176 KB). A busca por nome de coleção usa a lista completa (`searchMembers`); um registro antigo, truncado, **não é listado por nome** (melhor omitir do que devolver uma fatia) e a biblioteca de coleções do admin mostra "Busca do site por nome de coleção: N completas / M parciais: sincronize as coleções". Dados reais (ressincronização local só de leitura, 2 GET, em cópia do snapshot): `fala daqui` **55** (3 páginas), `da nossa terra` **73** (4), `novidades` **53**, `seu lugar` 9.521 (397 páginas). Testes: `tests/unit/search-coverage.test.ts` (duas coleções de 55 e 73 com produtos após o 48º, sem duplicar entre páginas, interna fora, registro truncado não confiável) e o ajuste em `collections.test.ts`. **Em produção é preciso rodar "Sincronizar coleções agora" no admin depois do deploy do storefront** (senão a busca por nome de coleção segue parcial; o release confere `fala daqui > 48`).

**2. Release: seis → sete features, sem presumir o estado.** `scripts/release-navbar.sh` (`--check` somente leitura; `--deploy` com trava dupla `PUBLICAR-NAVBAR-INK`). O release global (`release-global.sh`, `deploy_worker`) continua exigindo **exatamente as seis**: `header-nav` só existe em `deploy_worker_navbar` (segundo e último `wrangler deploy` real, ambos em `global-common.sh`), e o TOML segue fail-closed (`WIDGET_FEATURES="return-link"`), então um `wrangler deploy` genérico não liga a navbar.
- **Captura da produção real** antes de qualquer coisa: versão ativa (`wrangler deployments list`), health público e as variáveis/bindings da versão (`wrangler versions view <id> --json`). `planNavbarRelease` (puro, `scripts/lib/release-lib.mjs`) preserva `ENABLE_WIDGET`, `WIDGET_ALLOWLIST` e `WIDGET_SCOPE_MODE` capturados e só acrescenta `header-nav`; **recusa** (sem publicar) se as features capturadas não forem exatamente as seis, se `header-nav` já estiver ativa, se o health divergir da versão, se a allowlist/escopo/`ENABLE_WIDGET` forem inválidos ou se os bindings da versão diferirem dos do TOML.
- **Depois do deploy:** health com as sete features e o mesmo escopo/allowlist/`widget_mode` (`sameNavbarConfig`), smoke público (`smoke-global.mjs --features=seven --allowlist-size=N`, inclui `/__origens/navbar` igual a `/api/navbar/sul` do storefront) e o QA ao vivo (`scripts/qa-navbar-live.mjs`).
- **Rollback automático** se qualquer etapa crítica falhar: evidência primeiro (`capture_evidence`), depois `wrangler rollback <versão capturada>` e conferência de que o health é idêntico ao capturado (`sameConfig`) + smoke. KV e checkout não são tocados.
- Pré-condições em produção que o script confere **antes** de publicar (o storefront e o CMS vêm antes): `/api/navbar/sul` válido e (por padrão) com ≥ 1 coleção (`NAVBAR_ALLOW_EMPTY=1` assume o estado vazio), `/sul/busca` 200 sem cache compartilhado, "nenhum resultado", `chimarrao`/`florianopolis` e `fala daqui > 48`.
- Testes: `test/release-navbar.test.js` (10) + `test/release-scripts.test.js` ajustado; stub do Wrangler em `test/fixtures/wrangler-stub.sh`; `npm test` **306/306**.

**Estado real da produção (leitura, 2026-09-25, `release-navbar.sh --check`):** Worker `use-sul-widget` versão ativa `a7fe807a…`, loader 4.3, `product-catalog`, seis features, allowlist com 5 caminhos; `wrangler.production.toml` idêntico ao da `main`; o plano capturado é "preservar `product-catalog` + 5 caminhos e acrescentar `header-nav`" e o dry-run do bundle compila com essas variáveis (106,87 KiB / 29,33 KiB gzip). O `--check` está **BLOCKED só pelas pré-condições do storefront** (`/api/navbar/sul` e `/sul/busca` ainda 404 em produção, o que é o esperado antes do deploy do storefront).

**QA:** `scripts/qa-navbar-live.mjs --rehearse` (ensaio contra a INK real com o loader local, `cart-ref` e navbar por `page.route`, nenhum KV escrito): **22/22** — inclui cabeçalho, coleções com página 200, Turbo (produto → produto → página que não é produto → produto), busca (0 requisições ao digitar), Enter com `cart_ref` (1 POST), logo reaproveitando o token, drawer nativo com "Finalizar compra" visível/habilitado (não clicado) e 390/320/500. **Ao vivo** (token e KV verdadeiros) só roda dentro do release, depois do deploy.

## Rollout controlado (nada disso foi executado; nenhum push/merge/deploy sem autorização)

1. **Storefront** (PR `feature/navbar-text-search` → `main` → Railway; a branch já tem o merge do `origin/main`, incluindo o trabalho do CMS de outro agente). Verificar em produção: `/api/navbar/sul` (200, JSON), `/sul/busca?q=chimarrao` (200, `Cache-Control: private, no-store`), termo inexistente, paginação, sem 500.
2. **Admin de produção:** "Sincronizar coleções agora" (completa a busca por coleção), depois Coleções → "Mostrar" nas coleções da navbar → **Publicar**. Conferir `/api/navbar/sul`.
3. **Worker:** `bash scripts/release-navbar.sh --check` (tem de dar READY) e então `bash scripts/release-navbar.sh --deploy` (precisa de `npx wrangler login` do proprietário; o script captura, publica, verifica e reverte sozinho se algo crítico falhar).
4. **Só a navbar** (se preciso, mantendo o resto): republicar com as seis features e o mesmo escopo/allowlist capturados; **tudo:** `npx wrangler rollback <versão capturada em .release/navbar-capture-*.json> --name use-sul-widget --yes`. Nunca publicar sem as `--var` (o TOML é fail-closed).
