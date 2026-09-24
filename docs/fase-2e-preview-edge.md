# Fase 2E — Etapa 1B: Worker isolado + Preview no edge

Data: 2026-09-24. Branch `feature/ink-loader-fase2a`, base `164b56c` (80/80). **Nada foi enviado ao GitHub. Nenhum merge.** Não foram tocados: Worker de produção `use-sul-widget` (não existe na conta), rotas, DNS, proxy do `www`, SSL/TLS, cache, regras, secrets, checkout ou carrinho da INK.

Legenda: **EDGE** = executado na rede real da Cloudflare (URL pública). **LOCAL** = só workerd/Miniflare nesta máquina. **PENDENTE** = não validado.

## 1. Gates obrigatórios (antes do deploy)

| # | Gate | Resultado |
|---|------|-----------|
| 1 | Working tree / conta | Branch correta; conta pessoal via `npx wrangler whoami` (ID mascarado `bc4a…54d4`; nenhum token/cookie em log) — **PASS** |
| 2a | `name = "use-sul-widget-preview"` | **PASS** |
| 2b | `main = src/preview-entry.js`, só fixture sanitizada + sonda; `ENABLE_WIDGET` fixo `false` no código | **PASS** (`preview-entry.js` linhas 24 e 32; bundle contém `ENABLE_WIDGET:"false"` 2×, nenhum `"true"`) |
| 2c | `workers_dev = true` e `preview_urls = true` explícitos | **PASS** — estava `workers_dev = false`; corrigido nesta rodada (`wrangler.preview.toml`) e coberto por teste |
| 2d | Sem `route(s)`, `custom_domain`, zonas, crons, bindings, secrets, recursos de produção | **PASS** (grep vazio; dry-run lista só as duas variáveis) |
| 2e | Sem herança de `wrangler.production.toml` / `.wrangler/deploy/config.json` | **PASS** (`config.json` inexistente; `wrangler.production.toml` e `src/worker.js` sem diff desde `164b56c`) |
| 3 | Painel/API: Worker isolado sem rotas no `www`; não aponta para `use-sul-widget` | **PENDENTE**: sem leitura de rotas por API/painel (evitei manusear o token OAuth). Evidências indiretas: o Worker foi criado pelo nosso `wrangler preview` na rodada anterior; `use-sul-widget` **não existe** na conta (API 10007); `https://www.usesul.com.br/__origens/health` e `/__origens/loader.js` → **404** e o produto no `www` → 200 sem `data-use-origens-widget` |
| 4 | `npm test` + `npx wrangler deploy -c wrangler.preview.toml --dry-run` | **PASS**: 80 testes, 80 aprovados, 0 falhos, 0 ignorados; dry-run: 16,11 KiB, bindings = só `ENABLE_WIDGET ("false")` e `WIDGET_ALLOWLIST ("")`, nenhuma rota; bundle sem padrões de rota de produção, sem `process.env`, sem strings de segredo |

## 2. Comandos executados na Cloudflare

```bash
npx wrangler deploy -c wrangler.preview.toml                       # único deploy; sempre com -c
npx wrangler preview -c wrangler.preview.toml --ignore-base-config --name etapa1-fixture
```

- Deploy: `Uploaded use-sul-widget-preview` → `https://use-sul-widget-preview.tomazi-brand.workers.dev`; **Current Version ID `d9e8483a-ed11-4e0d-a627-275445460030`** (100% do tráfego). Nenhuma rota listada no resultado.
- Preview: `etapa1-fixture (updated)`, agora com URLs ativas (a 1ª tentativa tinha ficado sem URL):
  - Preview URL `https://etapa1-fixture-use-sul-widget-preview.tomazi-brand.workers.dev`
  - Unique Deployment URL `https://a581e6cf-use-sul-widget-preview.tomazi-brand.workers.dev`
- Não foi necessário mexer no controle *Preview URLs* do painel. Não foi associado domínio nem rota.

## 3. Resultados no EDGE

Todos rodados nas **duas** URLs públicas (Worker `…-preview.…workers.dev` e Preview `etapa1-fixture-…`), com resultados idênticos. Fixture = origem falsa sanitizada, sem dados da INK. `sha256` do HTML esperado da fixture: `5b26a5a2…d49583` (446 bytes). `cf-ray` registrados só em prefixo (POP GRU).

| Teste | Resultado (EDGE) |
|-------|------------------|
| Health | 200 `application/json`, `server: cloudflare`; `{"service":"use-sul-widget","version":"2c.1","widget_mode":"false","allowlist_status":"empty","allowlist_size":0}` (sem caminhos nem segredos) |
| Fixture produto, `Accept-Encoding: identity` | 200, corpo **byte a byte idêntico** (446 B, mesmo sha256), `cache-control: private, no-store`, 2 `Set-Cookie` (`fixture_a`, `fixture_b`), sem `Content-Encoding` |
| Fixture produto, `gzip, br` | 200, `content-encoding: br` aplicado **pelo edge**; após decodificar (`curl --compressed`) idêntico à fixture |
| Variante `allowlisted` (serra e outro) com flag fixa `false` | corpo idêntico, **0** tags `data-use-origens-widget`, 2 cookies |
| Produto `outro`, query string (`?utm=1&token=…`), `Turbo-Frame: cart` | corpo idêntico, 0 loaders, 2 cookies |
| `/usesul/cart`, `/usesul/checkout` (fixture GET) | corpo idêntico, 0 loaders |
| Redirect 302 | 302, `Location: /usesul/product/serra-catarinense` **não seguido**, 2 cookies |
| 404 e 500 HTML | status preservados, corpo idêntico, 0 loaders |
| JSON 200 (não HTML) | 200, 18 B, intacto |
| POST na fixture (caminho não relacionado a compra) | 201, eco `method=POST` e 5 bytes; nenhum POST tocou a INK |
| Fixture "header-encoded" | `Accept-Encoding: gzip` → `content-encoding: gzip` (280 B) e **um** decode → idêntico à fixture; `identity` → sem cabeçalho, 446 B idêntico. (`br`: não decodifiquei localmente — falta módulo brotli no Python; o `curl --compressed` já tinha decodificado `br` corretamente) |
| Recusas | `/`, variante inexistente, `/__preview/fixture/default/etc/passwd`, caminho real em host de preview → 404; `PUT` → 405 |
| `www` (caixa-preta) | `/__origens/health` e `/__origens/loader.js` → 404; produto → 200 e **0** `data-use-origens-widget` |

### 3.1 Sonda `Content-Encoding` — `GET /__preview/live` (EDGE, INK pública, somente leitura)

A sonda faz um `GET` público a **um caminho fixo** (`https://www.usesul.com.br/usesul/product/serra-catarinense`) com `Accept-Encoding: gzip, br` **definido no código** (nenhum cabeçalho, cookie, `Authorization` ou sessão do cliente é repassado), passa pelo Worker de produção com flag fixa `false`, e devolve só metadados. Saída idêntica nas duas URLs e em 3 repetições:

```json
{ "status": 200, "content_type": "text/html; charset=utf-8",
  "content_encoding_seen_by_worker": null, "content_length_header": null,
  "cache_control": "private, no-store", "csp_present": false, "etag_present": false,
  "set_cookie_names": ["ahoy_visitor","ahoy_visit","guest_token","_reserva_ink_store_session", "…(repetidos 2×)"],
  "body_bytes_seen": 173481, "body_looks_like_html": true,
  "has_native_cta": true, "loader_present": false }
```

Leitura (EDGE): quando o Worker faz `fetch()` da INK, o runtime entrega **corpo HTML já decodificado (173 481 bytes, legível, com o CTA nativo) e sem o cabeçalho `Content-Encoding`**, mesmo tendo pedido `gzip, br`. Portanto:

- **O guard de segurança** (não reescrever se `Content-Encoding` ainda estiver presente) **não bloquearia a injeção** nesse caminho: o cabeçalho não chega ao Worker. **Guard mantido, nenhum código de produção alterado.**
- O cabeçalho `ETag` da INK e o `Content-Length` também **não** chegam ao Worker via `fetch()`; a fixture criada no Worker também sai sem `ETag` no edge (o teste local "ETag preservado" não se aplica ao edge; sem impacto, pois as páginas são `private, no-store`).
- Nenhum HTML, `Set-Cookie` ou valor de cookie é devolvido pela sonda (verificado: 0 ocorrências de `guest_token=`/`_reserva_ink_store_session=`/HTML no JSON). Só nomes de cookies.

Limite desta evidência: foi um **subrequest de um Worker em `workers.dev` para o `www` (zona com proxy)**, não um Worker acionado por **rota** no `www`. A entrega decodificada/sem cabeçalho é comportamento do runtime `fetch()`, mas o caminho por rota (Host, TLS Cloudflare↔INK, cookies do visitante) só será comprovado na Etapa 2.

## 4. LOCAL (workerd) — não repetido no edge

80 testes locais (`npm test`: 80 pass, 0 fail, 0 skipped): injeção só na allowlist, `dry-run`, deduplicação, `Turbo-Frame`, HTMLRewriter real, jsdom, navegação Turbo simulada, isolamento das configs de preview/produção, ambiente hostil na entrada de preview. **O HTMLRewriter injetando o loader não foi exercitado no edge** (a flag do preview é fixa `false` por desenho; a página real da INK não recebe o loader).

## 5. PENDENTE (nada disso foi validado)

- INK atrás de **rota real** do `www` (Worker acionado por Workers Route): Host, TLS Cloudflare↔INK, cookies do visitante, resposta com o Worker no caminho.
- Injeção do loader no edge (HTMLRewriter) e comportamento visual do link.
- Mobile 390 px e drawer pós-compra com o Worker ativo.
- Painel: rotas do Worker isolado (gate 3), checklist da zona (Active, `www` Proxied, SSL/TLS Full/Full strict, sem Worker conflitante, sem cache de HTML em `/usesul/*`, sem redirect/transform nas rotas alvo).
- Observabilidade: não usei logs (Preview URLs têm limitação); a evidência é HTTP/cabeçalhos/saída do CLI.

## 6. Problemas e observações

1. `workers_dev` estava `false` na config de preview; a especificação exige `true`. Corrigido antes do deploy.
2. O `wrangler preview` (beta) só ativou URL após o deploy do Worker isolado (comportamento documentado pela Cloudflare/CLI).
3. As duas URLs são **públicas**. Conteúdo: fixture sanitizada e sonda de metadados; a sonda dispara 1 GET público à INK por chamada. Sem dados sensíveis, mas convém remover quando não forem mais necessárias.

## 7. Custos e recursos criados

Worker `use-sul-widget-preview` (versão `d9e8483a`, sem rotas/bindings/secrets) e Preview `etapa1-fixture`. Nenhum recurso pago adicional; plano da conta não consultado (custo não verificado; uso desprezível).

## 8. Rollback (não executado; alvos confirmados)

1. Remover o Preview: `npx wrangler preview delete --name etapa1-fixture -c wrangler.preview.toml`.
2. Remover o Worker isolado (**confirmar que o nome é `use-sul-widget-preview`**): `npx wrangler delete -c wrangler.preview.toml`.
3. Nunca excluir `use-sul-widget` (nem existe) nem retirar o proxy do `www` como rollback deste teste.

`npx wrangler logout` foi executado ao final (login OAuth não é mais necessário); faça novo `wrangler login` só para a próxima etapa aprovada.

## 9. Próxima etapa (parada aqui; exige aprovação específica)

**Etapa 2** (não iniciada): associar `www.usesul.com.br/usesul/product/*` e `www.usesul.com.br/__origens/*` a `use-sul-widget` **com `ENABLE_WIDGET="false"` e allowlist vazia**, validar compra nativa completa e `/__origens/health`; depois `dry-run` e uma única URL. Antes: gate do painel (seção 5) e **decisão sobre manter ou remover** as URLs públicas de preview. Pendências do proprietário: revogar o token GitHub exposto e auditar os seis remotes com credencial embutida; push segue bloqueado (identidade SSH efetiva `gtomazi`).
