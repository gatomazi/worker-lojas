# Arquitetura do loader (v3.0)

Um único ponto de entrada no HTML da INK: `<script src="/__origens/loader.js?v=3.0" defer data-use-origens-widget="3.0">`, injetado pelo Worker **somente** em caminhos exatos da `WIDGET_ALLOWLIST`. Tudo o resto é interno e independente.

```text
Worker (src/worker.js)
 ├─ injeção de HTML ........ GET + 200 + text/html + caminho exato da allowlist (senão passa intacto)
 ├─ /__origens/loader.js ... loader composto SÓ com os módulos de WIDGET_FEATURES (allowlist embutida)
 ├─ /__origens/discovery.js  módulo de descoberta, carregado sob demanda (só com post-add-discovery)
 ├─ /__origens/search ...... gateway GET somente leitura (só com true + city-search)
 └─ /__origens/health ...... modo, allowlist e features (sem caminhos)

Loader no navegador (src/loader/*)
 ├─ runtime.js ............. escopo por rota, ciclo de vida Turbo, teardown total, mount/unmount idempotentes
 ├─ return-link.js ......... "← Voltar a procurar" abaixo de #add-to-cart-desk (comportamento do piloto)
 ├─ drawer-watch.js ........ detecta o drawer JÁ renderizado pela INK e carrega discovery.js sob demanda
 └─ discovery-ui.js ........ (discovery.js) bloco "Qual é a próxima cidade?" + busca real
```

## Flags (todas por deploy, via `--var`; nenhuma é de build)

| Variável | Valores | Padrão / fail-closed |
|----------|---------|----------------------|
| `ENABLE_WIDGET` | `false` · `dry-run` · `true` | qualquer outro valor = `false` |
| `WIDGET_ALLOWLIST` | caminhos **exatos**, separados por vírgula | vazia/ausente/malformada = nenhuma página |
| `WIDGET_FEATURES` | `return-link`, `post-add-discovery`, `city-search` | ausente = `return-link` (piloto); `""` = nenhum módulo; nome desconhecido = lista inteira descartada (nenhum módulo) |

Features **não ampliam páginas**: quem autoriza páginas é só a allowlist, no Worker **e** dentro do loader.

## Regras de escopo (duplas)

1. **Edge:** o loader só é injetado com `ENABLE_WIDGET=true` + caminho exato na allowlist + ao menos 1 feature.
2. **Client:** o runtime confere `location.pathname` contra a allowlist embutida no carregamento, a cada mutação e a cada evento (`turbo:visit`, `turbo:before-render`, `turbo:render`, `turbo:load`, `turbo:frame-load`, `turbo:frame-render`, `turbo:before-cache`, `popstate`, `pageshow`). Saiu da rota: `teardown()` remove UI, estilos, observers, timers, listeners e aborta requisições. Um loader ainda vivo após navegação Turbo não deixa UI nem age fora da allowlist.

## Drawer pós-adição

- Detecção: `#modal-wrapper` **visível**, com "Produto adicionado" e botões nativos (`.checkout-btn` / `#continue-shopping-button`). O clique/POST nunca é usado como prova.
- Observador restrito ao subárvore de `#last_added_product` (reatado se o frame for trocado) + eventos Turbo.
- Âncora: logo depois de `.add-product-modal__modal-content__footer` (botões nativos), antes de `#most_sold_frame` ("As mais vendidas"). Sem âncora, nada é montado (drawer nativo intacto).
- CSS só sob `[data-origens-discovery]` (raiz exclusiva), em `<style data-origens-discovery-style>` removido ao desmontar. Sem fontes/imagens externas, sem `innerHTML`.
- `Esc` **não** é tratado: a INK fecha o próprio drawer nesse atalho e o bloco sai junto.
- Telas baixas: se o bottom sheet da INK crescer e empurrar "Ver carrinho" para fora do topo, linhas de resultado são escondidas do fim até o botão caber (mínimo 1); em `max-height:700px` o texto de apoio some enquanto há resultados.

## Busca

`GET /__origens/search?q=` (mesma origem do navegador, `credentials: 'omit'`). O Worker:

- consulta **somente** `https://useorigens.com.br/api/cidades/sul` (origem e caminho fixos; nada vem do visitante), sem Cookie/Authorization, timeout 3 s, limite de 600 KB / 5000 itens, validação de esquema (descarta entradas fora do formato), índice em memória por 5 min (stale por até 24 h), `cf.cacheTtl=300`;
- aplica o ranking do storefront (`src/search-rank.js`, port fiel de `rank.ts`; paridade provada por fixtures geradas do `rank.ts` real: `scripts/gen-search-fixtures.mjs`);
- devolve no máximo 5 resultados com só campos públicos (`type,name,uf,meso,href`), links montados pelo Worker (`/sul/{uf}` e `/sul/{uf}/{slug}`), `Cache-Control: no-store`; não registra a consulta em log.

O cliente ainda revalida o formato e só aceita links `https://useorigens.com.br/sul[/uf[/slug]]` sem credenciais/query/fragmento. Texto sempre via `textContent`.

## Sem contrato = sem busca

O storefront **não** suporta filtros por `searchParams`; nada disso é prometido nem preservado. Sem `city-search` o bloco mostra só o CTA "Explorar outras camisetas" → `https://useorigens.com.br/sul`.
