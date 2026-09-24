# Plano — Use Sul: Worker + widgets na INK

> Atualização (Fase 2E, Etapa 1B): Worker isolado `use-sul-widget-preview` implantado e Preview `etapa1-fixture` ativo; testes de edge e sonda de `Content-Encoding` em [`fase-2e-preview-edge.md`](fase-2e-preview-edge.md). **Parado antes da Etapa 2.**
>
> Atualização (Fase 2D, Etapa 1): Preview isolado criado, **sem URL ativa** (bloqueio); nenhuma evidência de edge ainda. Ver [`fase-2d-preview-isolado.md`](fase-2d-preview-isolado.md) e as opções A/B/C.
>
> Atualização (Fase 2C): `WIDGET_ALLOWLIST` fail-closed implementada e testada localmente; plano de ativação e rollback em [`fase-2c-allowlist.md`](fase-2c-allowlist.md). Nada publicado; push bloqueado (identidade SSH efetiva é `gtomazi`).
>
> Atualização (Fase 2B, proxy `www` ativo): smoke, revisão do Worker, bloqueios e rollout progressivo em [`fase-2b-smoke.md`](fase-2b-smoke.md). Próxima aprovação: conferir painel Cloudflare e autorizar preview isolado.
>
> Atualização (Fase 2A): implementação, evidências e riscos em [`fase-2a.md`](fase-2a.md). Flag renomeada para `ENABLE_WIDGET`; loader em `/__origens/loader.js`; retorno padrão `https://useorigens.com.br/sul`.

## Context

A loja Use Sul roda na Reserva INK (`www.usesul.com.br/usesul/...`). O storefront próprio (`useorigens.com.br/sul`, repo `gatomazi/useorigens-storefront`, Next.js) tem busca de cidades e catálogo. Arquitetura confirmada pela BitGeek: Cloudflare Worker injeta só um loader via `HTMLRewriter`; o loader carrega módulos que alteram o DOM. Carrinho e checkout permanecem 100% da INK.

Estado do DNS: zona em migração para Cloudflare, ainda **não** `Active`. Nenhum deploy, push de Worker ou mudança de DNS nesta rodada.

## Objective

Fase 1 (POC): botão "← Voltar a procurar outra cidade" após o CTA nativo do produto, atrás do kill switch `WIDGET_ENABLED=false`. Fases 2–5: apenas planejadas aqui.

## Files

| File | Action | Description |
|------|--------|-------------|
| `src/worker.js` | existente | Rota `/usesul/product/*`, GET+200+HTML, injeta `<script defer data-cfasync="false">`, `/__health`, kill switch |
| `src/widget-source.js` | existente | Widget Fase 1, idempotente, Turbo-aware, falha aberta |
| `test/worker.test.js` | existente | 8 testes de rota/exclusões (mock de `HTMLRewriter`) |
| `wrangler.dev.toml` | existente | Staging isolado em `workers.dev` |
| `wrangler.production.toml` | existente | Rota real, `WIDGET_ENABLED="false"` |
| `README.md` | existente | Ativação gradual pós-DNS |
| `docs/plan.md` | novo | Este documento |

## Technical Details — auditoria do storefront (`/Users/gtomazi/projects/useorigens`)

Achados verificados no código:

- **URLs de produto INK**: vêm de `store_product_url` do catálogo INK (`src/lib/ink/normalize.ts`), expostas por `purchaseUrl()` em `src/lib/catalog/commerce.ts`. A URL é entregue **exatamente como a INK devolve**, validada só por https + `ALLOWED_COMMERCE_HOSTS` (`src/lib/ink/config.ts`). Hoje **não** carrega nenhum parâmetro de retorno.
  - Consequência: o widget lê `origens_return`, mas **nada no storefront o produz ainda**. Sem ele o retorno sempre cai em `https://useorigens.com.br/sul` (comportamento esperado da Fase 1).
- **Busca existente**: `src/components/search/CitySearch.tsx` (client component, combobox acessível) + ranking em `src/lib/search/rank.ts` (`prepareCities`, `searchCities`: exato > alias > prefixo > palavra > substring; sem fuzzy de propósito).
- **Índice de busca**: `GET /api/cidades/[region]` (`src/app/api/cidades/[region]/route.ts`) devolve `SearchCity[]` compacto (`n,u,s,a?,m?`), só cidades com produto comprável; ISR/CDN (`s-maxage=86400`); 503 enquanto catálogo não está pronto. Hoje só `sul` habilitada (`ENABLED_REGIONS`).
- **Rotas de destino**: `/{region}/{uf}` e `/{region}/{uf}/{city}` (+ `[family]`). **Nenhum `searchParams`** em `src/`: o storefront **não suporta filtros/região via query string**. A Fase 3 não pode assumir "preservar filtros" — só retorno à cidade/UF via path.
- **CORS**: nenhuma configuração `Access-Control-*` no storefront. Um `fetch` a partir de `www.usesul.com.br` para `useorigens.com.br/api/cidades/sul` será bloqueado pelo navegador.
- **CSP da INK**: desconhecida. Precisa ser verificada no navegador na página real antes da ativação.
- **Analytics**: `trackSearch`/`trackSelectCity` estão em `src/lib/analytics/track`. A busca embutida na INK precisa decidir se reutiliza esses eventos (consentimento incluso) ou fica sem tracking na primeira versão.

## Fases seguintes (somente plano)

### Fase 2 — busca no cabeçalho da INK

Decisão necessária: como o widget obtém o índice sem duplicar a regra de ranking.

| Opção | Prós | Contras |
|-------|------|---------|
| A. Endpoint no Worker que faz proxy de `/api/cidades/sul` (mesma origem que a INK) | Sem CORS no storefront; cache no edge | Rota nova no Worker fora de `/usesul/product/*`; ampliar escopo da rota |
| B. Habilitar CORS mínimo no storefront só para `https://www.usesul.com.br`, GET, só `/api/cidades/*` | Simples | Superfície nova no storefront (política: menos permissivo possível) |
| C. Publicar `rank.ts` + índice como bundle estático (pacote/CDN) consumido pelo Worker | Reuso real do ranking | Pipeline de build/versão extra |

Recomendação: **A + reaproveitar `rank.ts` empacotado** (extraído como módulo puro, já sem dependência de React). A regra de pesquisa fica num só lugar (`src/lib/search/rank.ts`); o widget só renderiza.
Pré-requisito: ampliar a rota do Worker para o cabeçalho (páginas de produto e coleção) só depois da POC validada.

### Fase 3 — busca na página do produto + retorno contextual

- Reutiliza o módulo da Fase 2.
- Retorno a cidade/UF: precisa que o storefront anexe `origens_return` (URL `https://useorigens.com.br/sul/...`) ao link de compra em `purchaseUrl()` **ou** que o widget infira por `document.referrer`. O `origens_return` já é validado no widget (origem + prefixo `/sul`).
- **Não prometer** preservar filtros: hoje não existem como parâmetros. Só implementar depois de o storefront suportá-los.
- Risco: a INK pode remover query params desconhecidos ou ignorá-los; testar em produto real.

### Fase 4 — drawer/modal pós-adição

- Detectar **confirmação real** da inclusão (mudança observável no DOM do drawer/contador do carrinho vinda da resposta da INK), nunca só o clique no CTA.
- Inserir módulo com "Procurar outra camiseta", "Voltar à vitrine" e, com seleção pendente, "Ver próximo produto". Preservar "Ver carrinho" e "Continuar comprando".
- Seletores do drawer precisam de levantamento no DOM real; documentar fallback (se não achar, não injeta nada).

### Fase 5 (opcional) — "Minha seleção"

- ID opaco temporário (ULID/UUID) entre domínios; nunca estado de carrinho. Armazenamento no storefront (não no Worker). Requer política de expiração e consentimento (LGPD; storefront já tem banner de consentimento).
- Carrinho INK continua única fonte de verdade.

## Test Impact

- Fase 1: 8 testes `node --test` passando (rota, kill switch, POST, JSON, checkout/carrinho, asset).
- Lacunas a cobrir antes de ativar: cabeçalhos preservados (`Set-Cookie`, `Content-Length` após rewrite), `HEAD`/`304`/redirect 3xx, `Content-Disposition`, e teste do widget em DOM (jsdom/Playwright) para idempotência e Turbo.
- Testes do widget em DOM real exigem ambiente com a INK acessível; não relatar como executado sem isso.

## Verification

1. `npm test` local (sem tokens).
2. `npm run dev` + `curl http://localhost:8787/__health` → `widget_enabled:false`.
3. Após DNS `Active`: seguir README (www DNS only → Proxied → compra sem Worker → Worker desligado → ativar supervisionado).
4. Rollback: `WIDGET_ENABLED=false` e republicar; se for o proxy, voltar www a DNS only.

## Riscos reais

- Seletor do CTA ("Adicionar ao Carrinho") ainda não validado no DOM real.
- CSP da INK pode bloquear script same-origin injetado: não relaxar; investigar nonce.
- `HTMLRewriter` mockado nos testes; comportamento do edge real não coberto.
- Cache/rewrite do proxy Cloudflare em frente ao Heroku da INK pode afetar cookies/sessão: validar compra **sem** Worker antes.
