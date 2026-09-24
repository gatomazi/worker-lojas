# Fase 2F — Rollout único controlado (concluído)

Data: 2026-09-24. Branch `feature/ink-loader-fase2a` (commits só locais; **sem push, sem merge**). Não foram alterados: DNS, proxy do `www`, CNAME, Redirect.pizza, SSL/TLS, cache, regras, checkout, carrinho da INK, secrets.

## Estado final

**`ENABLE_WIDGET=true` somente em `https://www.usesul.com.br/usesul/product/serra-catarinense`.** Worker `use-sul-widget` (versão `a3a42109-2b6d-41e1-b480-bc06f99a0967`, 100%), rotas: `www.usesul.com.br/usesul/product/*` e `www.usesul.com.br/__origens/*`. Health: `{"widget_mode":"true","allowlist_status":"ok","allowlist_size":1}`. Nenhuma expansão automática.

> A configuração `true` + allowlist foi aplicada com `--var` no deploy. **Um `wrangler deploy -c wrangler.production.toml` sem `--var` volta aos padrões do toml (`false`, lista vazia): é a direção segura.** O toml não foi alterado.

## 1. Pré-voo (antes de qualquer deploy)

| Item | Resultado |
|------|-----------|
| `npm test` | 80 testes, 80 aprovados, 0 falhos, 0 ignorados |
| Dry-run da config de **produção** | `name=use-sul-widget`, `main=src/worker.js`, vars `false`/`""`, 2 rotas do `www`; bundle 10,76 KiB **sem** código de fixture/preview; produção não importa preview |
| Conta | `wrangler whoami`: conta pessoal (ID mascarado `bc4a…54d4`); token OAuth não lido nem impresso |
| Linha de base do `www` (HTTP) | 200, `cf-ray` (GRU), `private, no-store`, `cf-cache-status: DYNAMIC`, HTML sem loader, `/__origens/health` 404, sem 52x, sem redirect nosso |
| Linha de base do navegador | Erros de console **preexistentes da INK** (não são regressão): `Identifier 'buttons' has already been declared`, `Identifier 'eventIDViewContent' has already been declared`, `Error connecting controller TypeError…` |
| Verificação de TLS Full/Strict, regras de cache/redirect/transform e rotas Worker conflitantes **por painel/API** | **NÃO VERIFICADA POR FERRAMENTA.** O `wrangler` não lê essas configurações e não li o token OAuth para chamar a API. Substitutos: caixa-preta (`DYNAMIC`, sem `Location`, sem 52x, 200 sem loop); o `wrangler deploy` não reportou conflito de rota; o Worker não altera SSL/TLS. Registrei a lacuna e segui porque `false` é passagem pura reversível em segundos |

## 2. Sequência executada

| Etapa | Comando (sempre `-c wrangler.production.toml`) | Versão | Resultado |
|-------|-----------------------------------------------|--------|-----------|
| 1. rotas + flag desligada | `npx wrangler deploy -c wrangler.production.toml` | `7e2e5e89` | health `false`/`empty`; smoke `off` **21/21**; compra anônima **6/6** |
| 2. dry-run | `… --var ENABLE_WIDGET:dry-run --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense` | `7bb970f2` | smoke `dry` **21/21**; logs abaixo |
| 3. ativo em 1 URL | `… --var ENABLE_WIDGET:true --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense` | `a3a42109` | smoke `on` **30/30**; compra anônima com link **8/8**; Chrome visível OK |

### Dry-run (`wrangler tail`, 8 eventos, 0 exceções, `outcome: ok`)

- `serra-catarinense` → `allowlisted=true`, `would_inject=true` (2 requisições, uma delas com query string).
- 5 outros produtos (tráfego real de visitantes durante a janela, por slug) → `allowlisted=false`, `would_inject=false`.
- Zero modificação no HTML (nenhum `data-use-origens-widget` em nenhuma resposta do `dry-run`).
- **Sem vazamento nos nossos logs:** valor plantado em query (`utm_source`, `email`), `Cookie`, `Authorization` e cabeçalho custom **não** aparecem; campos registrados: só `event`, `path`, `allowlisted`, `would_inject`, `allowlist_status`. (O evento de plataforma do `tail` da Cloudflare contém URL/headers da requisição por natureza; não é log nosso.)

## 3. Evidências reais com a flag `true`

HTTP (`scripts/rollout-smoke.mjs on`, sem cookies, sem seguir redirects):

- Produto autorizado: 200, `text/html`, `private, no-store`, `cf-cache-status: DYNAMIC`, `content-encoding: br` (edge), **exatamente 1** `<script … data-use-origens-widget="2c.1">` antes de `</head>`, também com query string; cookies de sessão da INK (`_reserva_ink_store_session`, `guest_token`, …) preservados; HTML restante estruturalmente igual à linha de base; sem CSP/CORS adicionados por nós.
- **Sem loader** em: outro produto, `/usesul`, `/usesul/cart`, `/usesul/checkout`, requisição `Turbo-Frame` do produto autorizado.
- `/__origens/loader.js`: 200 JavaScript (5070 bytes) com `ALLOWED_PATHS = ["/usesul/product/serra-catarinense"]` apenas.

Navegador (DOM):

| Verificação | Desktop 1280 | Mobile 390 (emulação Playwright/CDP, `innerWidth` = 390) |
|-------------|--------------|-----------------------------------------------------------|
| Links "← Voltar a procurar" | exatamente 1; 1 script | exatamente 1 |
| Posição | logo abaixo do CTA nativo, sem sobreposição, fora da barra fixa | abaixo do CTA nativo, fora da barra fixa; centralizado no viewport, sem sobrepor CTA nem barra |
| `href` | `https://useorigens.com.br/sul` | idem |
| Rolagem horizontal | — | a página da INK já tem overflow (417 px, vindo de `turbo-frame#cart`/gaveta do carrinho, igual em outro produto sem o link); **largura igual com e sem o link (417/417)**: o link não o causa |
| Turbo permitido → não permitido → permitido | **1 → 0 → 1** (scripts=1), sem duplicação | — |

Claude in Chrome (visível, Chrome do proprietário, Worker real em produção, **sem colar código**):
- 1 link, `script src="/__origens/loader.js?v=2c.1"` com atributos `defer`, `data-cfasync`, `data-use-origens-widget`; CTA nativo "Adicionar ao Carrinho" intacto; link abaixo do CTA (top 1038 vs CTA bottom 1014).
- Turbo para outro produto → link 0; volta → link 1.
- **Clique real no link** levou a `https://useorigens.com.br/sul` ("Camisetas da sua cidade no Sul | Use Origens"); volta à INK: carrinho idêntico (`Carrinho (0 produtos)`, HTML 3004 bytes antes e depois; carrinho desse perfil estava vazio, então a prova forte é a sessão anônima abaixo). Não alterei o carrinho do proprietário.
- Mobile 390 dentro do Chrome visível: iframe de 390 px same-origin (`innerWidth`=390): 1 link, `linkVsDesk=false`, `linkVsBar=false`, barra fixa `position: fixed` íntegra (captura conferida).
- Erros de console: só os 4 `Uncaught SyntaxError … replaceWith … Identifier … already declared` **preexistentes da INK**; nenhum atribuível ao loader/Worker.

Compra assistida (sessão anônima isolada, janela visível, `scripts/cart-flow.mjs`; sem checkout, sem pagamento):

| Fase | Resultado |
|------|-----------|
| `off` | 6/6: POST `/usesul/cart` 200, drawer da INK ("Ver carrinho"/"Continuar comprando"), carrinho preservado na ida e volta ao storefront |
| `on` | **8/8**: 1 link antes e depois de adicionar, POST 200, drawer intacto, **clique no link → storefront 200 → volta na mesma sessão → carrinho idêntico** (`Carrinho (1 produto)`, mesmo tamanho), 1 link após a volta |

O item de teste foi adicionado só à sessão anônima descartável (contexto novo do navegador) e o controle de remoção da INK foi acionado. O carrinho do proprietário não foi tocado.

Capturas (sem cookies/dados de visitantes; cabeçalho de frete e banner de cookies da própria INK): `docs/evidence/rollout/on-desktop-1280.jpg`, `docs/evidence/rollout/on-mobile-390-link.jpg`.

## 4. Limitações (não validado / observações)

1. **TLS Full/Strict, regras de cache/redirect/transform e rotas de outros Workers** não foram verificados por painel/API (ver seção 1). Continuam sendo gate manual do proprietário.
2. **Mobile:** o 390 px foi por emulação (Playwright/CDP e iframe), não em dispositivo físico. Ao rolar o link até a borda inferior da viewport (`linkBottom=844`, `barTop=784`) a barra fixa da INK **o cobre temporariamente**; com rolagem normal ele fica acima. Comportamento da INK, não do link.
3. **Chrome headless** é tratado como bot pela INK (a compra não funciona); por isso a compra assistida usou janela visível.
4. O carrinho do Chrome do proprietário estava vazio; a preservação com item foi comprovada na sessão anônima.
5. O `ETag`/`Content-Length` da INK não chegam ao Worker via `fetch()` no edge; irrelevante (páginas `private, no-store`).
6. **Sem push:** a identidade SSH efetiva é `gtomazi` e o token antigo não foi usado. O token exposto **precisa ser revogado pelo proprietário**; os seis remotes com credencial embutida seguem para auditoria.

## 5. Operação (rollback e ampliação)

- **Rollback em segundos (sem tocar no `www` nem no checkout):** `npx wrangler deploy -c wrangler.production.toml` **sem `--var`** (volta a `false`/lista vazia) ou `npx wrangler rollback --name use-sul-widget`. Confirmar por `curl https://www.usesul.com.br/__origens/health` (`widget_mode:"false"`) e pela ausência de `data-use-origens-widget` na página.
- Se desligar a flag não bastar: remover as duas rotas do Worker (painel → Workers Routes). `www` em DNS only só como último recurso (desativa todo o proxy).
- **Ampliar (nova decisão):** acrescentar caminhos exatos em `WIDGET_ALLOWLIST` (`--var WIDGET_ALLOWLIST:/usesul/product/a,/usesul/product/b`), um por vez, repetindo `node scripts/rollout-smoke.mjs on`. Requer `wrangler login` e `PW_PATH` com `playwright-core` (não é dependência do projeto).

## 6. Recursos de preview removidos

Confirmado antes: nomes `use-sul-widget-preview` / `etapa1-fixture` (diferentes de `use-sul-widget`); a configuração de preview não tem rotas e as duas rotas do `www` pertencem ao Worker de produção (o `/__origens/health` do `www` responde `widget_mode:"true"`, coisa que o preview nunca fazia). Removidos: Preview `etapa1-fixture` e Worker `use-sul-widget-preview`. As URLs `*.workers.dev` de preview agora retornam 404. `use-sul-widget` intacto. `wrangler logout` executado.

## 7. Arquivos desta rodada

`scripts/rollout-smoke.mjs`, `scripts/cart-flow.mjs`, `docs/evidence/rollout/*.jpg`, `docs/fase-2f-rollout.md`, `.gitignore` (`.DS_Store`), `docs/plan.md`. Nenhuma mudança em `src/` nem nos `wrangler.*.toml`.
