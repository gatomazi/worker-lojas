# Fase 2D — Etapa 1: Worker Preview isolado

**Status: PARCIAL / BLOQUEADO na URL do Preview.** O Preview foi criado na Cloudflare, mas **não tem URL ativa**; por isso **nenhum teste foi executado no edge**. Ativar a URL exige `wrangler deploy` (proibido por esta etapa) ou um ajuste no painel. Parei e peço nova aprovação (seção 7).

Data: 2026-09-24. Branch `feature/ink-loader-fase2a`. Commits locais: `84421a4` (allowlist) → `d22e017` (entrada de preview) → commit desta rodada de documentação/config (ver `git log`). **Nada enviado ao GitHub.**

Legenda: **EXECUTADO** (rodou), **NÃO TESTADO** (motivo), **BLOQUEADO**.

## 1. Conta e ferramentas

| Item | Valor |
|------|-------|
| Wrangler do projeto | 4.137.0 (`npx wrangler --version`; lockfile 4.137.0; requisito dos Previews ≥ 4.135.0). Nenhuma dependência atualizada |
| Autenticação | OAuth interativo feito pelo proprietário; `npx wrangler whoami` EXECUTADO |
| Conta de destino | conta pessoal do proprietário (`<e-mail>'s Account`), ID `bc4a…c4d4` (mascarado). Nenhum token foi lido, copiado, salvo em remote/.env/relatório ou pedido no chat. As credenciais ficam só no arquivo padrão do Wrangler fora do repositório |
| Escopos do token OAuth | incluem `workers_routes (write)`, `workers_scripts (write)`, `zone (read)`, `ssl_certs (write)` e outros. **É um token amplo** (o padrão do login do Wrangler); nada além do Preview foi usado. Recomenda-se `wrangler logout` ao terminar |

## 2. Configuração efetiva (sanitizada) — `wrangler.preview.toml`

```toml
name = "use-sul-widget-preview"     # diferente de "use-sul-widget" (produção)
main = "src/preview-entry.js"       # entrada de preview; produção usa src/worker.js
compatibility_date = "2026-08-01"
workers_dev = false
preview_urls = true                 # adicionado nesta rodada (ver seção 5)

[vars]           ENABLE_WIDGET = "false"   WIDGET_ALLOWLIST = ""
[previews.vars]  ENABLE_WIDGET = "false"   WIDGET_ALLOWLIST = ""
```

- **Sem** rotas, domínio customizado, `zone_name`, KV/D1/R2/queues/service bindings/Durable Objects/secrets, e sem referência a `usesul.com.br`. Teste automatizado (`test/preview.test.js`) falha se isso mudar.
- Previews **não herdam** produção (documentação oficial): por isso as variáveis estão repetidas em `[previews.vars]`. `--ignore-base-config` evita herdar a "Previews Base" do painel.
- Efetivo visto pelo `wrangler dev` local: apenas `env.ENABLE_WIDGET ("false")` e `env.WIDGET_ALLOWLIST ("")`; nenhum outro binding (EXECUTADO).
- `wrangler.production.toml` **não foi alterado** nesta rodada e continua com `main = src/worker.js` e as duas rotas do `www`, **nunca publicadas**.

Não foi executado `wrangler deploy`, `wrangler versions deploy` nem qualquer cadastro de rota. Como o Wrangler não oferece `--dry-run` para `preview`, a inspeção foi por leitura do arquivo + `wrangler dev` local.

## 3. Comando executado (único que chegou à Cloudflare)

```bash
npx wrangler preview -c wrangler.preview.toml --ignore-base-config --name etapa1-fixture \
  --tag etapa1 --message "Etapa 1: preview isolado, fixture, ENABLE_WIDGET=false"
```

Executado **duas vezes** (a segunda após adicionar `preview_urls = true`). Resultado:

- 1ª: `Worker "use-sul-widget-preview" does not exist yet … Creating new Worker` (em modo não interativo o Wrangler assumiu "yes"; era o esperado para um Preview antes do primeiro deploy). `Preview: etapa1-fixture (new)`.
- 2ª: `Preview: etapa1-fixture (updated)`.
- Ambas: **`Note: This Preview deployment has no active URLs.`** O Wrangler avisa que `wrangler deploy` é o que publica o Worker e suas configurações de URL (`preview_urls`), não o `wrangler preview`.

## 4. Testes do Preview

| # | Teste pedido | Resultado |
|---|--------------|-----------|
| 1 | URL isolada em `workers.dev` e ausência de associação a `www` | **BLOQUEADO**: sem URL ativa. Ausência de associação a `www`: EXECUTADO por caixa-preta (abaixo) |
| 2 | `/__origens/health` com flag `false`, sem allowlist nem segredos | **NÃO TESTADO no edge** (sem URL). Local (`wrangler dev`): `{"service":"use-sul-widget","version":"2c.1","widget_mode":"false","allowlist_status":"empty","allowlist_size":0}` |
| 3 | Caminho permitido e não permitido com flag desligada | **NÃO TESTADO no edge**. Local (workerd, `test/preview.test.js`): cenário `allowlisted` com a flag **fixa em `false` no código** deixa o HTML intacto |
| 4 | Redirects, não-HTML, erros, carrinho/checkout, dois cookies | **NÃO TESTADO no edge**. Local: 302 sem seguir, JSON, 404, 500, `/usesul/cart`, `/usesul/checkout`, POST e `Turbo-Frame` passam intactos; os dois `Set-Cookie` da fixture e o `ETag` preservados |
| 5 | `Content-Encoding` e headers no ambiente real do Preview | **NÃO TESTADO**. A sonda `/__preview/live` (metadados de uma resposta pública da INK, sem corpo nem cookies) foi implementada e testada localmente, mas só roda quando houver URL |
| 6 | `npm test` | **EXECUTADO: 80 testes, 80 aprovados, 0 falhos, 0 ignorados** (70 anteriores + 10 de preview) |
| 7 | Nenhuma rota Worker em `www` por efeito colateral | Painel: **não conferido** (sem acesso ao painel). Caixa-preta EXECUTADA: `https://www.usesul.com.br/__origens/health` → **404** (nenhuma rota Worker respondendo) e produto → 200 pela INK. O Worker de produção `use-sul-widget` **não existe** na conta (`wrangler deployments list --name use-sul-widget` sem resultado) |

Fatos locais adicionais úteis (EXECUTADOS, workerd local):

- A entrada de preview ignora um ambiente hostil (`ENABLE_WIDGET=true` + allowlist cheia): **nunca injeta**.
- Achado sobre `Content-Encoding`: no workerd, uma `Response` construída com `Content-Encoding: gzip` tem o corpo **comprimido na saída**; quando o cabeçalho existe em um `fetch()` de origem com corpo já decodificado, o **guard do Worker** (não reescrever se `Content-Encoding` presente) faria o link **nunca aparecer**. Se o runtime real mantiver esse cabeçalho, o guard precisará ser revisto **com evidência da sonda live**. Este é o principal desconhecido a fechar no edge.

## 5. Problemas encontrados

1. **Preview sem URL ativa.** Uma `preview_urls` só passa a valer no Worker via `wrangler deploy` (ou pelo painel). Como `wrangler deploy` é proibido, **não é possível expor o Preview** por este caminho.
2. O `wrangler preview` **criou o Worker** `use-sul-widget-preview` (vazio de produção; sem rotas, sem deployment de produção) como parte do primeiro Preview. Isso era inevitável e está isolado do `use-sul-widget`.
3. Comando `wrangler preview` é *open beta*.

## 6. Custos e recursos criados

| Recurso | Detalhe |
|---------|---------|
| Worker `use-sul-widget-preview` | criado; sem rotas, sem domínio, sem bindings, sem secrets |
| Preview `etapa1-fixture` | 2 deployments (`new`, `updated`); sem URL ativa; `ENABLE_WIDGET="false"`, allowlist vazia |
| KV/D1/R2/queues/DO/containers | nenhum |
| Custo | Nenhum binding pago criado; o plano da conta não foi consultado, então **custo não verificado** (uso esperado desprezível) |

## 7. Opções para desbloquear (peço escolha explícita)

- **A (recomendada, sem deploy do meu lado):** você ativa os *Preview URLs* do Worker `use-sul-widget-preview` no painel (Workers & Pages → `use-sul-widget-preview` → Settings → Domains & Routes → Preview URLs; o nome exato do controle pode variar) e depois eu rodo de novo o mesmo `npx wrangler preview …` e executo os testes 1–5 no edge.
- **B:** você aprova, de forma expressa e só para este Worker isolado, `npx wrangler deploy -c wrangler.preview.toml`. Publica a **entrada de preview** (fixtures, flag fixa off) sob o nome `use-sul-widget-preview`. **Não** toca em `use-sul-widget` nem em rotas do `www`.
- **C:** encerrar a Etapa 1 aqui e seguir com os testes locais (80/80) como única evidência.

## 8. Rollback específico do Preview

1. `npx wrangler preview delete --name etapa1-fixture -c wrangler.preview.toml` remove o Preview e seus deployments.
2. Se quiser remover também o Worker isolado: `npx wrangler delete -c wrangler.preview.toml` (nome `use-sul-widget-preview`; confira o nome antes de confirmar) ou pelo painel.
3. Encerrar o acesso: `npx wrangler logout` (revoga o login OAuth local).
Nada disso afeta o `www`, o proxy, o checkout nem a INK.

## 9. Limites da evidência

Todas as evidências desta rodada, além da caixa-preta do `www`, são **locais (workerd/Miniflare)**. Elas **não** provam TLS Cloudflare↔INK, cabeçalho Host, cookies reais, nem codificação no edge. Mesmo com o Preview no ar, ele **não** provaria o comportamento no `www` real (Host, cookies e TLS); isso só se valida na rota real (Etapa 2, com nova aprovação).

## 10. Pendências paralelas do proprietário (sem alteração aqui)

- **GitHub:** revogar o token exposto; auditar os seis remotes com credencial embutida (`useorigens`, `oria`, `orgulhoregional`, `rituel`, `estamparia-api`, `estamparia-criativos`). Não presumo que o token cobre todos os repositórios; não comparei valores. O push segue bloqueado: a identidade efetiva por SSH é `gtomazi`.
- **Checklist Cloudflare (painel; não conferido por mim):** (a) zona Active; (b) `www` Proxied → INK/Heroku; (c) SSL/TLS Full ou Full (strict); (d) nenhuma rota Worker conflitante (`/*`, `/usesul/*`, `/usesul/product/*`, `/__origens/*`); (e) nenhuma regra que cacheie HTML `/usesul/*`; (f) nenhuma regra de redirect/transform nas rotas alvo. Gate da associação futura ao `www`, não do Preview.

## 11. Mudanças de código desta rodada (explicação)

| Arquivo | Mudança | Por quê |
|---------|---------|---------|
| `src/worker.js` | `createWorker(upstream)`; `export default createWorker(fetch global)` | Permitir trocar só a origem (fixtures). Comportamento de produção idêntico (70 testes anteriores intactos) |
| `src/preview-entry.js`, `src/preview-fixtures.js` | Novos, **só preview** | `workers.dev` ≠ host `www`, então o Worker real devolveria 404; a entrada de preview o exercita contra fixtures sanitizadas. Flag fixa `false`; sonda `live` devolve só metadados |
| `wrangler.preview.toml` | Novo (`preview_urls = true`) | Config isolada com nome próprio, sem rotas/bindings |
| `package.json` | scripts `preview` e `preview:local` | Comando reprodutível; `preview` usa `-c wrangler.preview.toml` |
| `test/preview.test.js` | Novo (10 testes) | Fixtures, ambiente hostil, sonda `live`, isolamento da configuração |

## 12. Próxima etapa (após desbloqueio e nova aprovação)

1. Com URL do Preview: executar os testes 1–5 no edge e registrar (com e sem `Accept-Encoding`), incluindo `/__preview/live` para ver o `Content-Encoding` que o Worker realmente recebe da INK.
2. Se o guard de `Content-Encoding` bloquear injeção no edge: propor ajuste com evidência (nada assumido).
3. Só então, **nova aprovação expressa** para associar as duas rotas do `www` com a flag desligada (Etapa 2).
