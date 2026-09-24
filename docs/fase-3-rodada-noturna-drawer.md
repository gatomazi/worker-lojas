# Fase 3 — Rodada noturna: drawer Use Sul + busca real (piloto em 1 produto)

Data: 2026-09-24 (madrugada). Branch `feature/ink-loader-fase2a`. Commits **só locais** (sem push, sem merge).

## Resumo direto para o proprietário

| Pergunta | Resposta |
|----------|----------|
| **Produção em Serra: sim/não** | **NÃO. O drawer e a busca NÃO foram publicados.** A produção continua exatamente como estava: Worker `use-sul-widget` v2c.1 (versão `a3a42109…`), só o link "← Voltar a procurar". Motivo: o `wrangler login` exige a sua aprovação do consentimento OAuth no navegador; abriu a página, aguardei ~10 min e expirou sem aprovação. Não cliquei "Allow" por você e não contornei nada. |
| Código pronto e testado | **Sim.** 137 testes locais 137/137; QA completo contra a **página real da INK** (build local servido em `/__origens/*`): desktop 1280 24/24, mobile 390 24/24, 320 24/24, 768 24/24. |
| Outros produtos intactos: testado/não testado | **Testado** localmente (unit, workerd real, jsdom, e no navegador real via Turbo com o drawer aberto: 0 bloco, 0 link, 0 estilo fora da Serra) e **verificado na produção atual** (loader só na Serra; `/__origens/search` e `/__origens/discovery.js` respondem 404 da INK). Depois do deploy, o smoke `rollout-smoke.mjs on` repete isso ao vivo. |
| Drawer desktop/mobile | Funciona no navegador real com o build local: bloco integrado à paleta oliva da loja, entre os botões nativos e "As mais vendidas"; "Ver carrinho" continua dominante e visível; capturas em `docs/evidence/drawer/`. |
| Busca real: sim/não e por quê | **Sim (implementada e validada localmente contra o índice REAL do storefront).** O contrato existe (`GET /api/cidades/sul`, 1191 cidades PR/SC/RS, sem CORS), então a busca passa por um gateway same-origin no Worker. Só cidade e estado (o índice não tem "coleção"), por isso o placeholder é "Busque cidade ou estado". Filtros por `searchParams` **não** existem no storefront e não são prometidos. |
| Carrinho preservado: sim/não | **Sim**, no navegador real: adicionar → buscar → Enter num resultado (página real da cidade no storefront, 200) → voltar à INK na mesma sessão → carrinho nativo idêntico. |
| Como desligar em um comando | Hoje nada novo está ligado. Depois do deploy: `npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense --var WIDGET_FEATURES:return-link` (desliga só o drawer e a busca; mantém o link). Para desligar tudo: `npx wrangler deploy -c wrangler.production.toml` **sem `--var`**. |

**Para publicar (um comando, com rollback automático):** faça `npx wrangler login` (aprovando no navegador) e rode `bash scripts/rollout-drawer.sh` (estágio 1: código novo com módulo desligado + smoke; estágio 2: drawer + busca + smoke + QA ao vivo desktop/mobile; qualquer falha → rollback para o piloto/versão anterior). Requer `playwright-core` em `/tmp/pw` (`npm i --prefix /tmp/pw playwright-core`) e Chrome instalado.

## 1. Estado real de produção (verificado nesta rodada, antes e depois do trabalho)

`GET /__origens/health` → `{"version":"2c.1","widget_mode":"true","allowlist_status":"ok","allowlist_size":1}`. Loader: 1 tag na Serra; 0 em outro produto, `/usesul`, `/usesul/cart`. `/__origens/search` e `/__origens/discovery.js` → 404 (INK). Nada foi alterado na Cloudflare/DNS/checkout. `wrangler` está deslogado.

## 2. O que foi construído

Ver [`architecture-loader.md`](architecture-loader.md). Em resumo:

- **Runtime modular** (`src/loader/*`): escopo por rota duplo (Worker + cada evento no cliente), teardown total, um único ponto de entrada `/__origens/loader.js`.
- **return-link:** comportamento do piloto preservado (fallback `https://useorigens.com.br/sul`); alvo de toque ≥ 44 px no mobile.
- **post-add-discovery:** bloco **"Continue descobrindo o Sul / Qual é a próxima cidade? / Seu carrinho continua salvo enquanto você procura."**, campo de busca (48 px), CTA **"Explorar outras camisetas" → `https://useorigens.com.br/sul`**. Carregado sob demanda (`/__origens/discovery.js`) só depois que a INK renderiza o drawer.
- **city-search + gateway** `GET /__origens/search?q=`: origem fixa, só leitura, sem cookies, timeout, limite de tamanho, esquema validado, ranking idêntico ao do storefront, no máximo 5 resultados, links montados no Worker.
- **`WIDGET_FEATURES`** (fail-closed) para ativar cada módulo por deploy sem reescrever o Worker; `LOADER_VERSION` = `3.0` (cache-buster).
- **Sem contrato = sem simulação:** sem `city-search` o bloco mostra só o CTA de retorno; nada de resultados, imagens, preços, prazos ou provas sociais inventados. P2 (busca no cabeçalho) e P3 ("Próxima da sua seleção") **não foram implementados** (não há contrato de seleção persistente; a ordem de prioridade foi respeitada).

## 3. Auditoria do drawer real (sessão anônima descartável, janela visível; `scripts/drawer-audit.mjs`)

Estrutura observada após `POST /usesul/cart` (arquivos `before-drawer-*.audit.json`):

- `#modal-wrapper.add-product-modal` (`role="dialog" aria-modal="true"`, `position: fixed`, `z-index: 50`), criado dentro do `turbo-frame#last_added_product` (existe vazio antes da adição).
- Cabeçalho "Produto adicionado ao carrinho" + `button#modal-close-button` (`ink-store--product-modal#closeModal`).
- `div.add-product-modal__modal-content__footer`: `button.checkout-btn` "Ver carrinho" (fundo `rgb(31,41,55)`, Poppins 14/500, raio 8 px) e `button#continue-shopping-button` "Continuar comprando" (branco).
- `turbo-frame#most_sold_frame` "As mais vendidas".
- Desktop: painel à direita (422 px). Mobile 390: bottom sheet de ~401 px de altura.
- Paleta da loja: oliva `rgb(77,84,61)` (CTA/cabeçalho), Poppins. O bloco usa fundo quente `#f6f4ec`, borda `#d9d5c3`, raio 12 px, botão secundário oliva, para não competir com "Ver carrinho".

**Âncora escolhida:** depois de `.add-product-modal__modal-content__footer`, antes de `#most_sold_frame`. Fora de regiões que o Turbo substitui? Não (o wrapper inteiro é re-renderizado a cada adição): por isso a remontagem é idempotente (observador no subárvore de `#last_added_product` + eventos Turbo) e testada com 4 adições seguidas.

## 4. Testes

**`npm test`: 137 testes, 137 aprovados, 0 falhos, 0 ignorados** (80 originais preservados + 57 novos):

| Arquivo | Total | Cobertura nova |
|---------|-------|----------------|
| `test/features.test.js` | 7 | `WIDGET_FEATURES` fail-closed; módulos no bundle; loader sem `fetch`/cookies/storage/`innerHTML`; discovery sem HTML injection/hosts externos/polling |
| `test/search-rank.test.js` | 3 | **paridade** com o `rank.ts` real (46 consultas, snapshot real de 1191 cidades); comportamentos de usuário |
| `test/search-gateway.unit.test.js` | 6 | validação de esquema, dedupe em voo, TTL/stale-on-error, timeout 3 s, sem headers do visitante, teto de 5 |
| `test/search-gateway.workerd.test.js` | 11 | workerd real: consultas reais, 400/405, origem fixa (sem SSRF), sem Cookie/Authorization, gating por flag+feature, 502 sem vazar detalhes, cache, injeção inalterada (Serra 1 loader; outros 0) |
| `test/features.worker.test.js` | 5 | health com features, loader/discovery por flag, injeção só com features válidas |
| `test/discovery.dom.test.js` | 25 | drawer só após confirmação real; 1 bloco após N re-renders; fechamento; Turbo 1→0→1 com drawer aberto/fechado; carga direta de outro produto; XSS; links inválidos; corrida; timeout 4 s; teclado; a11y; CSS escopado; telas baixas |
| `test/integration.workerd.test.js`, `test/worker.test.js`, `test/preview.test.js`, etc. | 80 | preservados (só ajuste de módulos do workerd e versão) |

**QA pré-deploy contra a página REAL da INK** (`scripts/qa-drawer.mjs`, Worker local em `/__origens/*`, sessão anônima, janela visível):

| Viewport | Resultado | Destaques |
|----------|-----------|-----------|
| desktop 1280 | **24/24** | 1 bloco; ordem botões→bloco→"mais vendidas"; "Ver carrinho" visível; input 48 px; busca "floripa"→Florianópolis (link real); "sc"→estado; vazio; erro 502; teclado; Enter→`/sul/pr/curitiba` 200; volta com carrinho idêntico; X remove o bloco; Turbo com drawer aberto → 0 UI; volta 1 link |
| mobile 390 (emulação CDP, `innerWidth` 390) | **24/24** | idem + nosso bloco não causa overflow horizontal (417 com e sem o bloco; 417 é overflow preexistente da INK) |
| 320×640 | **24/24** | depois de um ajuste (item 5) |
| 768 | **24/24** | |

Evidência visual (conferida): `docs/evidence/drawer/` — antes: `before-drawer-{desktop,mobile}.jpg`; depois: `after-drawer-*`, `after-search-results-*`, `after-search-empty-*`, `after-search-error-*` em `desktop`, `mobile` (390), `w320`, `w768`. Nomes com viewport.

## 5. Problemas encontrados e corrigidos

1. **Esc:** a INK fecha o drawer no `Esc` numa fase anterior à do nosso handler; tentar interceptá-lo não era confiável. **Decisão:** não tratar o `Esc`; o drawer nativo fecha e o bloco sai junto (testado).
2. **320×640:** com resultados, o bottom sheet crescia e empurrava "Ver carrinho" 10 px para fora do topo. **Correção:** `fit()` esconde linhas de resultado do fim até o botão nativo caber (mínimo 1) e um modo compacto em `max-height:700px`; testado em jsdom e refeito no navegador real (24/24).
3. **Variantes da INK carregam sob demanda** (só com a área de compra visível): os scripts de QA agora rolam até o CTA antes de escolher variante.
4. **Banner de cookies da INK** cobre a barra do CTA mobile: **não aceitei consentimento**; o clique no CTA foi programático no botão (sessão descartável).
5. O mouse parado sobre uma linha de resultado a ativa por hover (padrão de combobox, igual ao storefront): o Enter segue a linha destacada; o QA move o ponteiro antes de digitar.

## 6. Bloqueio e o que NÃO foi feito

- **Deploy/rollout ao vivo: não realizado** (login OAuth não aprovado). Portanto **não há** smoke real do drawer em produção, nem capturas ao vivo, nem compra assistida ao vivo com o novo build. Tudo o que está marcado como aprovado acima é: testes locais, workerd real, jsdom, e o navegador real contra a INK com o build local.
- Dry-run offline de produção com as variáveis do estágio 2: bundle 38,67 KiB, **sem** código de fixture/preview, origem do gateway fixa em `useorigens.com.br` (verificado).
- Não validado: comportamento do gateway no edge real (`cf.cacheTtl` e o `fetch` do Worker a `useorigens.com.br` em produção); dispositivo físico; 1440 px.
- Pendências suas (inalteradas): revogar o token do GitHub exposto e auditar os 6 remotes; o push segue bloqueado (identidade SSH efetiva `gtomazi`).

## 7. Configuração final de produção (hoje) e prevista

| | Hoje (verificado) | Depois de `scripts/rollout-drawer.sh` |
|--|-------------------|----------------------------------------|
| Versão | Worker `use-sul-widget`, loader 2c.1 (`a3a42109`) | loader 3.0 |
| `ENABLE_WIDGET` | `true` | `true` |
| `WIDGET_ALLOWLIST` | `/usesul/product/serra-catarinense` | idem (um produto) |
| `WIDGET_FEATURES` | (inexistente; equivale a `return-link`) | `return-link,post-add-discovery,city-search` |
| `wrangler.production.toml` | fail-closed (`false`, lista vazia) + `WIDGET_FEATURES="return-link"` | inalterado |

## 8. Rollback

- **Automático** no `scripts/rollout-drawer.sh`: 1) redeploy com `WIDGET_FEATURES=return-link`; 2) `npx wrangler rollback --name use-sul-widget`; 3) deploy puro (widget desligado). Confere o health depois de cada passo.
- **Manual, só o novo módulo:** `npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense --var WIDGET_FEATURES:return-link`.
- **Tudo desligado:** `npx wrangler deploy -c wrangler.production.toml` sem `--var`, ou o painel (Workers Routes). Confirmar `/__origens/health` e 0 loaders. Não mexer no `www` como primeira ação.

## 9. Commits e arquivos (locais)

`798f2f7` — código (src/loader/*, features, gateway, ranking, testes, fixtures, scripts de QA, evidências); commit seguinte (ver `git log`) — esta documentação, a arquitetura e `scripts/rollout-drawer.sh`. Arquivos: `src/{worker,loader-source,features,search-gateway,search-rank}.js`, `src/loader/{runtime,return-link,drawer-watch,discovery-ui}.js`, `test/*`, `scripts/{qa-drawer,drawer-audit,gen-search-fixtures,rollout-drawer.sh}`, `docs/evidence/drawer/*`, `docs/architecture-loader.md`, este relatório. Não incluídos: `.claude/settings.local.json`, `.env`, capturas com PII (nenhuma).
