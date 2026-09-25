# Hotfix pré-release — gate de navegador reprovado no release global (2026-09-25)

## O que aconteceu

O `release-global.sh --deploy` publicou o código novo (etapa B), ligou `product-catalog` (etapa C), o QA em navegador reprovou e o **rollback automático restaurou `4a3c5d13-632e-4fed-b6b8-028c0c40595d`** (cinco produtos, seis features, `cart-mirror`, KV intactos). O rollback funcionou como projetado. Esta rodada **não fez deploy, push nem merge**; produção segue em `4a3c5d13` (health público: `version 4.2`, allowlist 5, seis features).

## Causa raiz das três falhas (classificação)

Não tenho os logs da execução original (ela rodou no terminal do proprietário e o QA antigo não registrava eventos de navegação), então a causa raiz vem de **reprodução + uma observação direta feita nesta rodada**:

> Durante a investigação, o **storefront (`useorigens.com.br` e `www.`) passou ~2 minutos recusando conexões de fora**: `curl` → `Recv failure: Connection reset by peer` já no `Client hello` do TLS, para os dois IPs da Cloudflare, 12/12 tentativas — enquanto `www.usesul.com.br` (INK/Worker) respondia 200 normalmente e `www.cloudflare.com` também. Voltou sozinho às 11:59 (sondagem a cada 9 s por ~6 min: 32/40 OK, 7 falhas só do storefront em sequência e 1 falha simultânea de storefront e Worker — um soluço de rede desta máquina; depois estável).

Um _connection reset_ é exatamente o que o Chrome apresenta como **`chrome-error://chromewebdata/`**. Isso explica as três falhas como **uma cadeia única**, sem defeito no código do Worker/loader:

| # | Sintoma | Causa raiz | Classe |
|---|---|---|---|
| 1 | `page.goto(guarani…)` "interrompida por `chrome-error://chromewebdata/`" | A navegação de **saída para o storefront** falhou por reset de conexão (a página ficou em `chrome-error://`), e o `goto` seguinte para a INK foi preemptado por essa navegação de erro. O slug `guarani-das-missoes-coordenadas-rs` é um produto real (200, formulário nativo, canonical correto, TTFB ~1,7 s por não estar em cache da INK) e **não reproduz**: 45 carregamentos (INK direto e via Worker local em modo catálogo) sem nenhum erro nele. Além disso o QA usava `waitUntil:'load'`, que **não é estável na INK**: reproduzi 2 de 40 timeouts de 45 s do evento `load` em outros produtos (resposta 200 e `framenavigated` ok; um recurso de terceiros segura o `load`). | **Storefront/rede** (gatilho) + **QA** (sinal frágil, sem retry nem evidência) — o Worker não participa: a resposta HTML dele nessa página está íntegra (verify-scope-real 60/60) |
| 2 | `arrived=false` na ida ao storefront | A saída **clicou e navegou**, mas a URL final era `chrome-error://…` (hostname vazio) porque o storefront recusou a conexão; `arrived` só olhava o hostname final, sem separar clique/POST/commit/status. Reproduzi a jornada **três vezes** (stub e **storefront real**): 19/19, `commit 200`, URL limpa pelo `CartRefCapture` real. | **Storefront/rede** (gatilho) + **QA** (critério de chegada sem sinais separados e sem pré-checagem do storefront) |
| 3 | 3 peças: total/desconto não confirmados | Cascata de #2: o token do snapshot era lido da URL final (que estava em `chrome-error://`), então não havia token, `status 0`. Somado a isso, o QA lia o snapshot **imediatamente** de outra região (KV é eventualmente consistente, até ~60 s+) e só exigia `!!totalText`, sem comparar com a INK. **Os valores estão corretos:** INK pura = com widget = snapshot (`subtotal 329,70`, `desconto 25`, `total R$ 304,70`, 3 peças, banner "LEVANDO 3 PEÇAS: R$ 25 OFF"). | **QA** (token pela URL, leitura imediata do KV, critério fraco); cascata de **Storefront/rede** |

**Nenhuma classe "Worker" ficou confirmada** e nenhuma linha do Worker/loader/storefront foi alterada nesta rodada. Recomendação ao proprietário (fora do código): olhar as Analytics/Security Events da zona `useorigens.com.br` em 2026-09-25 ~10:57–11:05 (horário local) para confirmar a origem do reset na borda.

## O que foi corrigido (só o necessário)

`scripts/qa-global.mjs`
- **Navegação estável** (`gotoProduct`): o critério de "produto carregado" é resposta 2xx + `domcontentloaded` + `form#form-product-*` + URL canônica — **não** o evento `load`. Erro de rede/timeout recebe **uma** nova tentativa (registrada) e, se persistir, é **reprovado** (o gate não foi relaxado) com **sonda HTTP fora do navegador** (status, HTML completo, formulário, nº de loaders) para classificar: sonda saudável ⇒ QA/rede; status ≠ 200 ⇒ INK; loader ≠ 1 no catálogo ⇒ Worker.
- **Log de navegação** por sessão: `framenavigated`, `requestfailed`, `pageerror`, `console.error`, respostas de documento, cada `goto` (de/para, tentativas, ms, URL final, eventos).
- **Chegada por sinais separados** (`exitViaDrawer`): clique → href no clique → POST (só quando necessário, com status e latência) → **commit** no storefront → **resposta 200** → URL limpa. `arrived = commit + 200`, independente de analytics; GA4 e limpeza de URL são `INFO`, à parte. O token vem da **requisição** de navegação (não da URL final).
- **Pré-condição do storefront**: sonda TLS/HTTP antes da jornada; falha ⇒ classe **Storefront** imediata (em vez de um `chrome-error` cifrado). Saída que não chega é classificada Storefront (se o storefront não responde fora do navegador) ou Worker.
- **3 peças**: página de **controle no mesmo contexto com o loader bloqueado** (INK pura, sem widget) ⇒ subtotal, desconto e total; compara **INK pura = com widget = snapshot** (e a promoção nativa: banner + desconto > 0). Leitura do snapshot **paciente** (até 90 s no `--live`, tentativas registradas). Nenhum valor é calculado pelo widget (leitura estrutural do DOM; guarda estática nos testes).
- **Falhas classificadas** (`QA_FALHA_CLASSIFICADA {classes, primeira}`) e **evidência** em `QA_EVIDENCE_DIR`: screenshot, URL, últimos 60 eventos de navegação, resumo do carrinho, resposta do storefront (+ reprobe) e o motivo exato.

`scripts/release-global.sh` / `global-common.sh` / `preflight-global.sh`
- **Antes de qualquer rollback**, `capture_evidence` grava em `.release/evidence/<ts>/` (fora do Git, `chmod 700`): `reason.txt` (motivo **exato** do gate + commit), `health.json`, `http-probes.txt` (storefront, produto, busca), `deployments.txt`, mais `smoke-*.log`, `qa-output.log` e `qa/` (screenshot etc.). Tudo com limite de tempo e `|| true`: **nunca impede o rollback** e nada é depurado em produção.
- **Precondição**: `storefront_ok` antes do primeiro deploy (nada publicado ⇒ nada a reverter) e no preflight (**BLOCKED** enquanto o storefront estiver inacessível).
- A falha do QA no release imprime a **classificação** e as 2 primeiras falhas.

## Testes (regressão curta pedida)

| Verificação | Resultado |
|---|---|
| `npm test` | **269/269** (+3 do hotfix) |
| `verify-scope-real` | **60/60** |
| `qa-global` — 20 produtos + jornada INK → **storefront real** → INK, 3 peças, falha de KV | **51/51** (chegada `commit+200`, URL limpa pelo `CartRefCapture` real, INK pura = com widget = snapshot: 329,70 / 25 / R$ 304,70; KV: 3 tentativas, 2 writes) |
| `qa-cart` 1 item | 29/29 |
| `qa-cart-many` 3 itens (desktop) e 8 itens em 320 | 18/18 e 18/18 |

Testes novos em `test/release-scripts.test.js` (evidência antes do rollback, precondição do storefront, `capture_evidence` real, `run_limited`, garantias estáticas do QA: sem `load`, 1 retry com sonda, classificação, leitura paciente, controle sem widget, chegada por `commit`).

## Observações que NÃO viraram mudança de código (registradas)

- **Espera de saída (`EXIT_WAIT_MS` = 1,2 s)**: numa execução local o POST levou >1,2 s uma vez (e a saída navegou sem token; o write ocorreu mesmo assim). É o comportamento projetado (a compra não espera o KV), mas em rede lenta um token pode ser desperdiçado. Não alterei; se os logs do release mostrarem `POST` acima de ~1 s em produção, avaliar subir para ~2,5 s.
- **TTFB da INK** em produtos fora do cache dela (~1,7 s vs ~0,8 s nos cinco): custo da INK, não do Worker.
