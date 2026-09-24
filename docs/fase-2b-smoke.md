# Fase 2B — smoke do proxy `www` e prontidão do Worker

Data: 2026-09-24. Somente leitura no site real; nenhuma alteração de DNS, Cloudflare, SSL/TLS, secrets, loja INK, root/Redirect.pizza. Sem deploy do Worker.

Legenda: **PASS** / **FAIL** / **NOT TESTED** (com motivo). Observado ≠ hipótese.

## 0. Correções ao contexto recebido

- A branch `feature/ink-loader-fase2a` **já foi enviada** ao `gatomazi/worker-lojas` (`ff3f5c4`, a pedido do usuário, na rodada anterior). `main` está em `3f6155b`.
- Por isso o `remote.origin.url` local **ainda tem o token embutido** (decisão anterior do usuário no `CLAUDE.md`). Nesta rodada nada foi enviado nem reconfigurado. O token segue sendo tratado como comprometido: revogar e depois limpar o remote (`git remote set-url origin https://github.com/gatomazi/worker-lojas.git`).

## 1. Smoke HTTP do proxy (somente GET)

| # | Verificação | Resultado |
|---|-------------|-----------|
| 1 | DNS `www` resolve para IPs Cloudflare | **PASS**: `172.67.150.130`, `104.21.55.177` (resolver local, `1.1.1.1` e `8.8.8.8` concordam) |
| 2 | Raiz `usesul.com.br` inalterada | **PASS**: `89.106.200.1` (Redirect.pizza), não tocada |
| 3 | NS delegados | **PASS**: `bristol`/`lennox.ns.cloudflare.com` |
| 4 | `GET /usesul` | **PASS**: 200, `server: cloudflare`, `cf-ray: …-GRU`, `cf-cache-status: DYNAMIC`, `content-encoding: br`, 0 redirects |
| 5 | `GET /usesul/product/serra-catarinense` | **PASS**: 200, mesmos cabeçalhos, 0 redirects, 5/5 respostas 200 em sequência |
| 6 | Política de cache | **PASS**: `cache-control: private, no-store` (vindo da INK) e `cf-cache-status: DYNAMIC`: páginas com sessão não são cacheadas pelo proxy |
| 7 | CSP | **PASS (nenhuma)**: sem cabeçalho e sem `<meta http-equiv>` em `/usesul` e no produto |
| 8 | `via: 2.0 heroku-router` | **PASS**: a requisição chega ao Heroku pela Cloudflare |
| 9 | Erros 52x / loop de redirect | **PASS**: nenhum 52x; `-L` com limite 5 termina com 0 redirects |
| 10 | `http://www…` | **PASS**: 302 → `https://`, servido pela Cloudflare |
| 11 | Set-Cookie | **PASS**: 8 linhas (4 nomes, cada um 2×; igual à origem antes do proxy). Valores não registrados |
| 12 | **Modo SSL/TLS da zona (Flexible/Full/Full strict)** | **NOT TESTED**: exige painel. Evidência indireta: 200 sem loop e sem 52x. Não distingue Full de Flexible. Conferir em SSL/TLS → Overview (esperado: Full ou Full (strict)). Não alterado |
| 13 | Certificado do edge | **PASS**: `ssl_verify_result: 0` (curl verificou a cadeia) |

Reprodução (somente leitura, sem cookies):

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
dig +short www.usesul.com.br A
for route in /usesul /usesul/product/serra-catarinense; do
  curl -sS -o /dev/null -D - --max-redirs 0 -H "User-Agent: $UA" -H 'Accept: text/html' \
    -H 'Accept-Encoding: gzip, deflate, br' -H 'Accept-Language: pt-BR,pt;q=0.9' \
    -w 'http:%{http_code} redirects:%{num_redirects} tls_verify:%{ssl_verify_result}\n' \
    "https://www.usesul.com.br$route" \
  | grep -iE '^(HTTP/|server:|cf-ray:|cf-cache-status:|location:|cache-control:|content-security-policy|content-encoding:|via:|http:)'
done
curl -sS -o /dev/null -L --max-redirs 5 -w 'final:%{url_effective} redirects:%{num_redirects}\n' https://www.usesul.com.br/usesul/product/serra-catarinense
```

## 2. Navegador real, proxy ligado, **sem Worker**

Chrome do usuário (sessão de convidado já existente). Viewport de 1920 px (a janela não desce de ~549 px). Sem pedido concluído e sem pagamento.

| # | Verificação | Resultado |
|---|-------------|-----------|
| 1 | Produto desktop renderiza; variantes carregam (modelo, cor, tamanho) | **PASS** |
| 2 | Escolha de variante habilita o CTA | **PASS**: Masculino + Preta + M → `product_variant_id=157436722`, CTA habilitado |
| 3 | Adicionar ao carrinho pelo proxy | **PASS**: `POST /usesul/cart` respondeu; item "Serra Catarinense Preta M R$ 109,90" |
| 4 | Drawer pós-adição | **PASS**: apareceu com "Produto adicionado ao carrinho / Ver carrinho / Continuar comprando" |
| 5 | Persistência do carrinho ao sair para `https://useorigens.com.br/sul` e voltar | **PASS**: antes e depois "Carrinho (3 produtos)", mesmo tamanho de HTML do `/usesul/cart` (29247) |
| 6 | Navegação Turbo entre produtos | **PASS**: `turbo:before-visit`, `turbo:render`, `turbo:load`; CTA presente |
| 7 | Erros de console | **FAIL (preexistente da INK, sem Worker)**: na navegação Turbo entre produtos o JS da INK lança `Identifier 'buttons' has already been declared` e `Identifier 'eventIDViewContent' has already been declared` (scripts inline re-executados pelo Turbo). Anotado como linha de base para não atribuir ao Worker |
| 8 | Mobile (≤ 549 px), variante/adição/drawer | **NOT TESTED**: janela não desce de ~549 px e a adição foi feita em 1920 px. Layout do CTA em 549 px foi observado na Fase 2A |
| 9 | Item barato / rollback do item de teste | O carrinho já tinha 2 itens e agora tem 3 (1 adicionado por mim, R$ 109,90). **Não removi** (evitar mais mudança de estado); remova pelo carrinho se quiser |

### Estrutura do drawer (observada; útil para a Fase 4, nada foi modificado)

- Clique em `#add-to-cart-desk` (Stimulus: `product-v2--customization-form#addToCart`) → `fetch POST /usesul/cart` (~0,9 s).
- Resultado no DOM: `turbo-frame#cart` atualizado ("Carrinho (N produtos)", linhas de item), `turbo-frame#last_added_product` dentro de `#modal-wrapper` (com "Ver carrinho" e "Continuar comprando") e um `div.modal-backdrop`.
- Confirmação real da adição = o `turbo-frame#last_added_product` aparecer com conteúdo, **não** o clique.
- Seletores ainda são **hipótese de trabalho** até serem revalidados no drawer com o Worker ativo; não implementados.

## 3. Revisão do Worker (`src/worker.js`)

| Requisito | Conferido em código e teste |
|-----------|----------------------------|
| Só reescreve `GET` + 200 + `text/html` + `/usesul/product/<slug>` exato | PASS. `PRODUCT_PAGE` regex, `isEligibleRequest`, teste "only exact product pages" |
| Múltiplos `Set-Cookie` | PASS. Teste workerd: os 2 cookies preservados |
| Redirects | PASS. `fetch(..., {redirect:'manual'})`, teste 302 com `Location` |
| POST / HEAD | PASS. Repassados; teste confere método e corpo na origem |
| Checkout / carrinho | PASS. Fora do regex e das rotas propostas; teste `/usesul/cart`, `/usesul/checkout` |
| Turbo Frame | PASS. Header `Turbo-Frame` → sem reescrita |
| Idempotência | PASS. `onEndTag` + detector `script[data-use-origens-widget]`; teste de duplicidade |
| `ENABLE_WIDGET=false` | Passa tudo intacto (`passThrough`). Só `/__origens/loader.js` responde no-op (`no-store`) e `/__origens/health` responde JSON. Qualquer valor desconhecido = `false` |
| `dry-run` | **NÃO é "só GET"**: faz a mesma requisição à origem, **não altera corpo nem cabeçalhos** e escreve **um `console.log`** por página elegível (visível em `wrangler tail`). O loader responde no-op |
| `content-encoding` no edge | **NOT TESTED** (precisa do Worker no edge). Guard: se a resposta chegar com `Content-Encoding`, o Worker repassa intacta (link não aparece, página segura). Com proxy ligado, o cliente recebe `br` da Cloudflare (observado), o que não prova o que o Worker vê |
| CSP | PASS hoje (nenhuma). Worker não define CSP, HSTS, CORS nem headers próprios (teste) |
| Cache | Worker não usa `cf.cacheEverything`/Cache API; páginas mantêm `private, no-store`. O loader com flag `true` tem `max-age=60` |

Nenhuma alteração de código foi necessária nesta rodada.

## 4. Bloqueios

| Bloqueio | Consequência | Alternativa segura |
|----------|--------------|--------------------|
| Sem credencial Cloudflare (`CLOUDFLARE_API_TOKEN`/OAuth do wrangler ausentes) | Não deu para: publicar Worker isolado, listar rotas existentes, ver modo SSL/TLS, ver "Always Use HTTPS" | Usuário confere no painel (lista abaixo) ou faz `wrangler login` localmente por conta própria; eu não peço token no chat |
| Janela do navegador ≥ ~549 px | 390 px não testado | Testar no celular real ou DevTools device mode |
| Token GitHub exposto | Já citado | Revogar; limpar remote |

Conferir no painel (somente leitura): (1) Websites → usesul.com.br → **Overview: Active**; (2) SSL/TLS → Overview: **Full** ou **Full (strict)**; (3) Workers Routes: nenhuma rota em `www.usesul.com.br/*`; (4) Rules → Page/Cache/Redirect Rules: nada que cacheie `/usesul/*`; (5) DNS: `www` Proxied → destino Heroku.

## 5. Implantação progressiva (nada foi executado)

Pré-requisito: seção 4 conferida e aprovação expressa do usuário em cada etapa.

1. **Preview isolado** (`wrangler.dev.toml`, `workers.dev`, sem rota): `npx wrangler deploy -c wrangler.dev.toml` (usuário logado). Verificar `https://use-sul-widget-staging.<subdomínio>.workers.dev/__origens/health` → `widget_mode: "false"`. Não espelha a INK.
2. **Rotas, flag desligada** (`ENABLE_WIDGET="false"`): associar **somente** `www.usesul.com.br/usesul/product/*` e `www.usesul.com.br/__origens/*`. Nada de `/usesul/*` amplo, nada de checkout/carrinho. Conferir: `/__origens/health` no `www` e uma compra nativa completa (adição + drawer + carrinho) com o Worker no caminho.
3. **`dry-run`**: alterar `ENABLE_WIDGET`, publicar, `npx wrangler tail use-sul-widget` durante 10–15 min de navegação; deve haver logs e **nenhuma mudança visível**. Confirmar `content-encoding`/HTML no navegador.
4. **Uma página de teste**: hoje o Worker não tem allowlist de slugs. Antes desta etapa, adicionar variável `WIDGET_ALLOWLIST` (ex.: `serra-catarinense`) no código, com teste, e só então `ENABLE_WIDGET="true"` (**mudança de código pendente de aprovação**). Smoke: link 1 vez, Turbo, retorno, CTA/drawer/carrinho nativos, console sem erros novos (comparar com a linha de base da seção 2, item 7).
5. **Ampliar** só depois de 24 h estável.

**Rollback em segundos:**
1. `ENABLE_WIDGET="false"` + publicar (loader vira no-op; páginas passam intactas).
2. Se preciso: remover as duas rotas (painel → Workers Routes → Delete, ou `wrangler triggers`). A INK responde direto.
3. Se o problema for o proxy: `www` a **DNS only** no painel.
Checkout e carrinho nunca entram nas rotas. Sem cache de páginas com sessão (mantido `private, no-store`).

## 6. Resumo PASS/FAIL/NOT TESTED

- **PASS:** proxy ativo, DNS, TLS do edge, 200 sem loop nem 52x, cache dinâmico, sem CSP, compra/drawer/persistência do carrinho sem Worker, Turbo, revisão do Worker, `npm test` (33/33).
- **FAIL (não causado por nós):** erros de console da INK ao navegar por Turbo entre produtos.
- **NOT TESTED:** modo SSL/TLS, rotas Workers existentes, Worker no edge (incl. `Content-Encoding`), preview `workers.dev`, mobile ≤ 549 px com adição/drawer, 390 px.

## 7. Próxima aprovação necessária

Você conferir a lista do painel (seção 4) e me dizer se autoriza a etapa 1 do rollout (preview isolado, feito por você com `wrangler login` local), ou se prefere que eu primeiro implemente a `WIDGET_ALLOWLIST` (etapa 4) com testes, ainda sem deploy.
