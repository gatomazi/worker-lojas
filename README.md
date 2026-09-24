# Use Sul — Worker de widgets para a Reserva INK

Cloudflare Worker injeta **um único loader** no HTML da INK; o loader adiciona elementos ao DOM. Hoje o único widget é o link **"← Voltar a procurar"** na página de produto, apontando para `https://useorigens.com.br/sul`.

Estado: **Fase 2C (allowlist), nada publicado**. Sem deploy, sem rota em produção, sem alteração de DNS/Cloudflare. Evidências, riscos e rollback em [`docs/fase-2a.md`](docs/fase-2a.md), [`docs/fase-2b-smoke.md`](docs/fase-2b-smoke.md) e [`docs/fase-2c-allowlist.md`](docs/fase-2c-allowlist.md); plano geral em [`docs/plan.md`](docs/plan.md).

## Estrutura

| Arquivo | Papel |
|---------|-------|
| `src/worker.js` | Passa tudo para a INK; em `GET /usesul/product/<slug>` (200, HTML) injeta o loader com `HTMLRewriter`. Serve `/__origens/loader.js` e `/__origens/health`. |
| `src/loader-source.js` | Código do loader (string entregue pelo Worker) e `LOADER_VERSION`. |
| `wrangler.dev.toml` | Staging isolado em `workers.dev`, sem rotas. |
| `wrangler.production.toml` | Duas rotas em `www.usesul.com.br`. **Não publicar** antes da ativação (ver docs). |
| `test/` | `worker.test.js` (mock), `integration.workerd.test.js` (HTMLRewriter real via Miniflare/workerd), `loader.dom.test.js` (jsdom), `fixtures/`. |

## Flags

`WIDGET_FEATURES`: módulos do loader por deploy (`return-link`, `post-add-discovery`, `city-search`); ausente = `return-link`; nome desconhecido = nenhum módulo. Arquitetura em [`docs/architecture-loader.md`](docs/architecture-loader.md).

`ENABLE_WIDGET`: `"false"` (padrão, e qualquer valor desconhecido) · `"dry-run"` (nada é reescrito; só loga o caminho) · `"true"`.

`WIDGET_ALLOWLIST`: caminhos **exatos** de produto separados por vírgula, ex. `"/usesul/product/serra-catarinense"`. Vazia, ausente ou com qualquer entrada malformada = **nenhuma página** (fail-closed). Sem curinga, prefixo, query ou barra final.

Com `true`, o loader só é injetado em caminhos da allowlist (e o próprio loader só monta neles, inclusive em navegação Turbo). Com `false`, o Worker repassa tudo intacto e o loader responde um no-op. Formato completo em [`docs/fase-2c-allowlist.md`](docs/fase-2c-allowlist.md).

## Rodar localmente (sem tokens, sem rede, sem DNS)

```bash
npm install
npm test          # usa workerd local (Miniflare), não a Cloudflare
npm run dev       # wrangler dev com wrangler.dev.toml
curl http://localhost:8787/__origens/health   # widget_mode, allowlist_status, allowlist_size
```

`npm test` não exige login em nenhum serviço. O `workers.dev`/`wrangler dev` **não** espelha a INK: só responde `/__origens/health`.

## O que os testes provam e o que não provam

- **Provam:** regras de rota/método/status/content-type, flag OFF/dry-run/ON, deduplicação, preservação de `Set-Cookie`, redirects, POST, `Turbo-Frame`, loader no DOM (jsdom) e `HTMLRewriter` real do runtime workerd.
- **Não provam:** o edge Cloudflare, a INK real por trás do proxy, CSP futura da INK, comportamento com `Content-Encoding` no edge, viewport de 390 px, drawer pós-adição. Ver "NÃO VALIDADO" em `docs/fase-2a.md`.

## Ativação (resumo; detalhes em `docs/fase-2a.md`)

Painel conferido → preview isolado → rotas do `www` com `ENABLE_WIDGET="false"` → `dry-run` → `true` com **uma** URL na allowlist → ampliar. Cada etapa com aprovação. Rollback: flag `false`; depois remover rotas; por último `www` a DNS only.

## Limites

Sem carrinho paralelo; sem endpoints privados, CSRF ou cookies da INK; sem headers de segurança ou CORS próprios; `origens_return` é validado no loader, mas o storefront ainda não o envia.
