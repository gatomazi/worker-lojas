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

## Rollout controlado (nada disso foi executado)

O tooling de release atual **fixa exatamente seis features** (`scripts/global-common.sh` `FEATURES`, `SIX_FEATURES` em `scripts/lib/release-lib.mjs`, health `número de features != 6`) e o deploy sai só por `release-global.sh` (trava dupla, rollback automático). Para publicar o `header-nav`, primeiro adapte esses três pontos para sete features (e o rollback para "as seis" continua válido: é a versão capturada).

1. **Storefront** (PR → `main` → Railway): `/sul/busca`, `/api/navbar/sul`, CMS. Confirmar `curl https://useorigens.com.br/api/navbar/sul` (200, JSON) e `/sul/busca?q=chimarrao`.
2. **CMS:** em Coleções, "Mostrar" nas coleções desejadas (públicas) → publicar. Conferir a lista em `/api/navbar/sul`.
3. **Worker:** deploy do loader 4.4 com `WIDGET_FEATURES` = as seis atuais **+ `header-nav`**, cinco/todos os caminhos e `CART_REFS` explícitos, como hoje. Health: `version 4.4`, sete features. Se algo estranho: repetir o deploy **sem** `header-nav` (só a navbar sai; o resto fica) ou `wrangler rollback` para a versão capturada.
4. Smoke: um produto em 1280/390/320; Enter na busca com e sem carrinho; alternar coleção no CMS e ver a lista mudar em ≤ ~2 min sem novo deploy do Worker.
