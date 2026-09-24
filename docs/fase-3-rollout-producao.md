# Fase 3 — Rollout em produção: drawer + busca real na Serra Catarinense

Data: 2026-09-24. Branch `feature/ink-loader-fase2a` (commits só locais; **sem push, sem merge**). Este documento **substitui** o status "não publicado" de `fase-3-rodada-noturna-drawer.md`.

## Resultado

**Produção na Serra: SIM.** Somente `https://www.usesul.com.br/usesul/product/serra-catarinense` tem o loader, o link, o drawer com busca e o gateway ativos. **Sem rollback** (nenhum gate crítico falhou).

| Item | Valor efetivo (verificado em `/__origens/health` e na Cloudflare) |
|------|--------------------------------------------------------------------|
| Worker | `use-sul-widget` (rotas inalteradas: `www.usesul.com.br/usesul/product/*` e `www.usesul.com.br/__origens/*`) |
| Versão ativa (100%) | `87293a28-2800-4d1f-97bd-32feb2409433` (loader 3.0) |
| Fallback protegido | `a3a42109-2b6d-41e1-b480-bc06f99a0967` (loader 2c.1, só o link de retorno) |
| `ENABLE_WIDGET` | `true` |
| `WIDGET_ALLOWLIST` | `/usesul/product/serra-catarinense` (1 caminho) |
| `WIDGET_FEATURES` | `return-link,post-add-discovery,city-search` |
| `wrangler.production.toml` | fail-closed, **não alterado nesta rodada** (`false`, lista vazia); a configuração ativa está nas `--var` do deploy |

Versões publicadas nesta rodada, em ordem: `972a76f9` (estágio 1 manual) → `f32a4ea0` (estágio 1 pelo script) → `87293a28` (estágio 2, final).

## Gates antes do deploy (todos PASS)

Conta pessoal correta via `wrangler whoami` (ID mascarado `bc4a…54d4`; token nunca lido). Branch/commits `798f2f7` e `e045913`; `npm test` 137/137; dry-run de produção: 38,67 KiB, sem código de fixture/preview, sem bindings, origem do gateway fixa (`useorigens.com.br`); linha de base real: versão 2c.1, 1 loader só na Serra, `/__origens/search` e `/__origens/discovery.js` = 404 da INK; script `scripts/rollout-drawer.sh` revisado (rollback em 3 níveis). O login OAuth foi aprovado pelo proprietário; não cliquei "Allow".

## Comandos executados

```bash
npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true \
  --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense --var WIDGET_FEATURES:return-link        # estágio 1
PW_PATH=/tmp/pw bash scripts/rollout-drawer.sh    # refaz o estágio 1 → smoke → estágio 2 → smoke → QA ao vivo
# estágio 2 = mesmo comando com --var WIDGET_FEATURES:return-link,post-add-discovery,city-search
PW_PATH=/tmp/pw node scripts/qa-drawer.mjs mobile --width {320,768,1440} --live --tag after
```

## Evidências — separadas por camada

### Testes locais (nesta máquina)
`npm test`: **137 testes, 137 aprovados, 0 falhos, 0 ignorados** (unit, workerd real, jsdom). QA pré-deploy com build local sobre a INK real: 1280/390/320/768 = 24/24 cada (ver `fase-3-rodada-noturna-drawer.md`).

### Edge (Cloudflare real, HTTP)
| Verificação | Resultado |
|-------------|-----------|
| Health | `version 3.0`, `widget_mode true`, `allowlist ok (1)`, `features ok`, `widget_features` = as 3 |
| Serra | 200, `private, no-store`, `cf-cache-status: DYNAMIC`, 8 `Set-Cookie` (4 nomes ×2) como na linha de base, **1** loader (`/__origens/loader.js?v=3.0`, `defer`, `data-cfasync`), `discovery.js` **não** aparece no HTML (carregado sob demanda) |
| Código entregue pelo edge | `__useOrigensLoader = '3.0'`, `ALLOWED_PATHS` = só a Serra, `FEATURES` = 3, `discovery.js` com `SEARCH = true`; `loader.js` com `max-age=60` (páginas recém-carregadas verificadas: v3.0 no navegador) |
| Fora da Serra | **8 produtos**, `/usesul`, `/usesul/products`, `/usesul/cart` (404), `/usesul/checkout` (404): **0 loader, 0 referência a `__origens`**; requisição `Turbo-Frame` na Serra: 0 |
| Smoke `rollout-smoke.mjs on` | estágio 1: **30/30**; estágio 2: **30/30** |
| Gateway `GET /__origens/search?q=` | `floripa`→Florianópolis (`/sul/sc/florianopolis`); `sc`→Santa Catarina; `rio grande`→Rio Grande; `ctba`→Curitiba; `xyzq`→`[]`; `no-store`, `application/json`, sem `Set-Cookie`/CORS; sem `q`/`q=a`/`<script>`/41 caracteres → 400; POST/PUT/DELETE → 405; `Cookie`/`Authorization` do visitante não são ecoados; requisição do navegador sem Cookie/Authorization |

### Navegador real (Chrome visível, sessão anônima descartável; produção real, sem interceptação)
`scripts/qa-drawer.mjs --live`: **1280 = 24/24, 390 = 24/24, 320×640 = 23/23, 768 = 23/23, 1440 = 23/23** (as 23 sem o estado de erro; 1280 e 390 refeitos com 24 incluindo o erro). Em cada um: loader de produção v3.0; 1 link; **1 bloco** só depois da confirmação nativa; ordem "Continuar comprando" → bloco → "As mais vendidas"; "Ver carrinho" visível; campo 48 px, CTA ≥ 44 px; sem overflow horizontal causado por nós (417 = 417 com/sem o bloco, preexistente da INK); busca `floripa`/`sc`/vazio; teclado; **Enter no resultado → `useorigens.com.br/sul/pr/curitiba` 200 → volta à INK na mesma sessão → carrinho nativo idêntico**; segunda adição sem duplicar; X nativo remove o bloco e o estilo; **Turbo com o drawer aberto → produto não permitido: 0 bloco, 0 link, 0 estilo**; volta à Serra 1→0→1; nenhum erro de console atribuível a nós.

- **Erro da busca em produção:** simulado **somente no cliente de teste** (resposta 502 na rota do navegador; nada foi derrubado na loja): mensagem "A busca não está disponível agora…", CTA "Explorar outras camisetas" e botões nativos intactos.
- **Claude in Chrome (acompanhamento visível, somente leitura; carrinho do proprietário não tocado):** `__useOrigensLoader = '3.0'`, features corretas, 1 script/1 link, 0 bloco e 0 script de descoberta antes de abrir o drawer, Turbo Serra→outro→Serra 1→0→1, carrinho do proprietário inalterado (3004 bytes antes/depois), busca `floripa` respondida same-origin. Sem problema, sem necessidade de rollback.
- **Erros de console:** só os preexistentes da INK (`Identifier 'buttons' has already been declared`, `'eventIDViewContent' …`, `Error connecting controller TypeError…`); não atribuídos ao nosso código.

### Capturas de produção (sem dados pessoais) — `docs/evidence/drawer/`
- **Antes (drawer nativo):** `before-drawer-desktop.jpg`, `before-drawer-mobile.jpg`, `before-product-*.jpg`, `before-drawer-*.audit.json`.
- **Depois (produção):** `after-live-drawer-{desktop,mobile,w320,w768,w1440}.jpg`, `after-live-search-results-*`, `after-live-search-empty-*`, `after-live-search-error-{desktop,mobile}.jpg`. Conferidas visualmente (desktop e 320×640 em modo compacto).
- Pré-deploy (build local): `after-drawer-*`, `after-search-*`.

## Problemas e observações

1. Nenhuma falha crítica; nenhum rollback. O script tem rollback em 3 níveis (redeploy só com `return-link` → `wrangler rollback` → deploy fail-closed) e não foi acionado.
2. O deploy manual do estágio 1 (`972a76f9`) foi feito antes do script por acompanhamento; o script o refez (`f32a4ea0`) e seguiu. Estado idêntico.
3. O QA ao vivo cria itens no carrinho **anônimo descartável** (contexto novo do navegador; a INK não expõe remoção simples); o carrinho do proprietário não foi tocado.
4. Não validado: dispositivo físico; o `Content-Encoding` continua sendo o comportamento já comprovado do fetch decodificado no edge (injeção funciona em produção); nenhum teste de carga do gateway.

## Custos e recursos relevantes

Mesmo Worker `use-sul-widget`, mesmas duas rotas; sem novos bindings, KV, secrets ou domínios. O gateway faz até 1 subrequest por 5 min ao índice público do storefront (`cf.cacheTtl=300`, memória por isolate). Nenhum recurso pago novo verificado (plano da conta não consultado).

## Rollback (pronto, não executado)

- **Só o novo módulo (mantém o link):** `npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense --var WIDGET_FEATURES:return-link`.
- **Versão anterior comprovada:** `npx wrangler rollback --name use-sul-widget` (volta para uma versão publicada anterior; a estável de referência é `a3a42109…`).
- **Tudo desligado (fail-closed):** `npx wrangler deploy -c wrangler.production.toml` **sem `--var`**.
- Depois de qualquer rollback: `curl https://www.usesul.com.br/__origens/health` e conferir 0 `data-origens-discovery`/`discovery.js`. Não desligar o proxy do `www` como primeira ação.
- **Atenção:** um `wrangler deploy -c wrangler.production.toml` sem `--var` (por engano) desliga o piloto inteiro.

## Pendências suas

- Revogar o token do GitHub exposto e auditar os 6 remotes com credencial embutida. O push segue bloqueado (identidade SSH `gtomazi`).
- Ampliar para outros produtos exige nova decisão (allowlist, um por vez) e repetir `rollout-smoke.mjs` + `qa-drawer.mjs --live`.
