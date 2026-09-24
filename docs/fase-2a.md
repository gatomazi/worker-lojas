# Fase 2A — injeção por HTMLRewriter e link "← Voltar a procurar"

Data das observações: 2026-09-24. Escopo: somente o link na página de produto. Sem busca, sem drawer, sem DNS/Cloudflare, sem deploy.

Legenda: **OBSERVADO** = medido nesta rodada. **HIPÓTESE** = não comprovado. **NÃO VALIDADO** = exige ambiente que não estava disponível.

## 1. Evidências de auditoria

### Infra (OBSERVADO)

| Item | Resultado | Como |
|------|-----------|------|
| Nameservers do `usesul.com.br` | `bristol.ns.cloudflare.com`, `lennox.ns.cloudflare.com` (delegação feita no registro) | `dig NS`, `whois` |
| Zona Cloudflare `Active` | **NÃO VERIFICADO** | Sem credencial Cloudflare disponível. Confirmar no painel: Websites → usesul.com.br → status |
| `www` proxied? | **Não: DNS only.** Resolve para `*.herokudns.com` e IPs do Heroku; resposta `server: Heroku`, sem `cf-ray` | `dig`, `curl -I` |
| Rotas Workers existentes | **NÃO VERIFICADO** | Sem credencial. Confirmar: Workers & Pages → Routes; `wrangler` não foi executado |
| `@` (ápice) | Aponta para `89.106.200.1` (Redirect.pizza). Não tocado | `dig` |
| `www.usesul.com.br/sul` | **302 → `/usesul`**. NÃO é o storefront | `curl` |
| `https://useorigens.com.br/sul` | 200. Rota canônica do storefront | `curl` |

Consequência: o retorno padrão do widget é `https://useorigens.com.br/sul`, **não** `www.usesul.com.br/sul` (essa rota redireciona para a loja INK e faria o botão "voltar" ficar na própria INK).

### Página de produto (OBSERVADO em `/usesul/product/serra-catarinense`)

- HTTP 200, `content-type: text/html; charset=utf-8`, `cache-control: private, no-store`, ETag fraco, 4 `Set-Cookie` (sessão INK e rastreio), `server: Heroku`.
- **CSP: nenhuma.** Sem cabeçalho `Content-Security-Policy` e sem `<meta http-equiv>`. Presentes: `strict-transport-security`, `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff`. Um script same-origin não é barrado por CSP hoje. **Isto vale para esta resposta; a INK pode adicionar CSP depois.**
- Turbo Drive ativo (`window.Turbo` é objeto; `<meta name="turbo-cache-control" content="no-cache">`; `turbo-prefetch=false`). Eventos observados numa visita: `turbo:before-visit`, `turbo:render`, `turbo:load`.
- Um `<head>`, um `</head>`. Scripts da INK carregados de `gcp-heroku.majestic.ink.rsvcloud.com` (`data-turbo-track="reload"`).
- Formulário de compra: `form#form-product-<id>.form-product-options`, `action="/usesul/cart?product_id=<id>"`, `method=post`, `data-turbo-frame="cart"`, dentro de `<turbo-frame id="cart">`.
- CTAs (mesmo texto "Adicionar ao Carrinho"):
  - `button#add-to-cart-desk`: **em fluxo**, visível em desktop (1280) e no viewport estreito; pai `.form-product-options__add-to-cart` (flex, `gap-6`).
  - `button#add-to-cart-mob`: dentro de `.form-product-options__add-to-cart-mobile` (`position: fixed; bottom: 0`), `display:none` em desktop, barra fixa no rodapé em viewport estreito.
  - Ambos começam com `pointer-events-none opacity-60` no HTML e são habilitados por JS da INK.
  - Decisão: âncora = `#add-to-cart-desk`. A barra fixa **não** serve de âncora.
- **Drawer/modal pós-adição: NÃO OBSERVADO.** Exigiria adicionar ao carrinho (altera estado), o que não foi feito. Fica para a fase do drawer, com autorização explícita. Único dado: o alvo da adição é o `turbo-frame#cart`.

### Navegador real (OBSERVADO, Chrome, aba oculta)

- Loader colado na página real (não carregado por `<script src>`): montou 1 link após `#add-to-cart-desk`, fora da barra fixa, `href=https://useorigens.com.br/sul`, texto "← Voltar a procurar"; screenshot conferido: link centralizado abaixo do CTA nativo, barra "Adicionar ao Carrinho" fixa intacta.
- Navegação Turbo entre dois produtos: `turbo:render` e `turbo:load` dispararam, o `<body>` foi trocado e o link foi remontado uma única vez; CTA nativo visível e `form action` correto do novo produto.
- **Limitações:** a janela do navegador não desce de ~549 px de largura, então **390 px NÃO VALIDADO** (549 px sim). Teste de "voltar ao listing" via Turbo ficou inconclusivo (a visita a `/usesul/products` não navegou). O `<script src>` de `127.0.0.1` ficou pendente, provavelmente bloqueio de rede local do Chrome. Nenhum clique em "Adicionar ao Carrinho", nenhum pedido.
- **Não** foi validado: o script injetado pelo Worker na produção (Worker não publicado); comportamento do widget com a INK em `www` proxied.

## 2. O que mudou nesta rodada

| Arquivo | Mudança |
|---------|---------|
| `src/worker.js` | Reescrito. Página exata `/usesul/product/<slug>`, só `GET`, só 200 + `text/html`, sem `Turbo-Frame`. `HTMLRewriter` com `onEndTag` (idempotente). `fetch(..., {redirect:'manual'})`. Sem headers de segurança/custom. Guard: se `Content-Encoding` ainda estiver no corpo, passa sem reescrever. Remove `ETag`/`Content-Length` só quando reescreve. |
| `src/loader-source.js` (era `widget-source.js`) | Loader v`2a.1`: link "← Voltar a procurar", âncora `#add-to-cart-desk` com fallbacks, `turbo:*`, observer em `<html>`, `setTimeout` (não rAF), guard global contra dupla execução. |
| `wrangler.*.toml` | Flag `ENABLE_WIDGET` (era `WIDGET_ENABLED`), 2 rotas, `compatibility_date = 2026-08-01`. |
| `test/` | 8 testes originais adaptados (nome da flag, caminho do loader, mock com `onEndTag`). Novos: `integration.workerd.test.js` (HTMLRewriter real), `loader.dom.test.js` (jsdom), fixture sanitizada. |

## 3. Rotas propostas (NÃO associadas a nenhuma zona)

| Rota | Serve | Colisão |
|------|-------|---------|
| `www.usesul.com.br/usesul/product/*` | Reescrita do HTML de produto | Nenhuma rota anterior conhecida (**não verificado no painel**) |
| `www.usesul.com.br/__origens/*` | `loader.js` e `health`, respondidos pelo Worker sem ir à INK | O prefixo `/__origens/` é nosso; a INK não usa `__`. Rota `/usesul/product/*` não cobre `/__origens/*`, por isso há duas rotas |

O padrão `/usesul/product/*` cobre também subcaminhos e `__`-paths; o Worker filtra internamente por regex exata (`/usesul/product/<slug>`). O loader **não** fica em `/usesul/product/...` para não misturar com o espaço de nomes de produto da INK.

Flag `ENABLE_WIDGET`: `"false"` (padrão; qualquer valor desconhecido também) → tudo passa intacto e o loader responde no-op (`/* ... disabled */`, `no-store`). `"dry-run"` → nada muda no HTML e uma linha de log (`wrangler tail`) diz o que seria injetado. `"true"` → injeta.

## 4. Matriz de riscos

| Risco | Prob. | Impacto | Mitigação / Estado |
|-------|-------|---------|--------------------|
| INK passar a enviar CSP que bloqueia o script | Média | Widget some (compra não afeta) | Não relaxar CSP. Decidir nonce/allowlist só com autorização. Hoje: sem CSP (OBSERVADO) |
| `Content-Encoding` chegar ao Worker com corpo não decodificado no edge | Baixa | Widget nunca aparece (guard passa a resposta intacta) | Guard implementado. **NÃO VALIDADO no edge real**; smoke após ativar mostra se o link aparece |
| Proxy laranja mudar cookies/sessão/TLS da INK sem Worker | Média | **Alto** (compra) | Etapa "www Proxied sem Worker" e compra nativa antes de qualquer rota |
| Seletor `#add-to-cart-desk` mudar | Média | Widget some | Fallback por classe e por rótulo; se nada achar, não monta |
| Cache do navegador com HTML antigo apontando para loader desligado | Baixa | Nenhum | Com flag off o loader vira no-op 200 |
| `HTMLRewriter` alterar bytes da página além do `</head>` | Baixa | Médio | Teste: HTML sem o `<script>` é idêntico ao original (workerd real) |
| Reescrever quando não deve (checkout/carrinho) | Baixa | Alto | Regex exata + testes de exclusão; rota Worker só cobre produto e `/__origens/` |
| Latência extra do Worker | Baixa | Baixo | Só páginas de produto; streaming do `HTMLRewriter` |
| Colisão de rota com outro Worker/regra Cloudflare | Desconhecida | Médio | **NÃO VERIFICADO**; checar painel antes de publicar |

## 5. Rollback

1. Desligar: `ENABLE_WIDGET = "false"` e publicar. Efeito imediato nas páginas novas; o loader vira no-op.
2. Se persistir: remover as duas rotas do Worker (`wrangler triggers`/painel) ou desassociar. A INK responde direto.
3. Se o problema for o proxy: `www` volta a **DNS only** no painel Cloudflare.

## 6. Ativação futura, em ordem (nada disso foi feito)

1. Painel: zona `usesul.com.br` **Active** e registros de e-mail (MX/TXT) conferidos. Anotar rotas Workers existentes.
2. Com `www` em **DNS only**: testar loja e uma compra de teste autorizada.
3. Ligar proxy laranja **só no `www`**; testar TLS, cookies, produto, carrinho, checkout e pagamento **sem Worker**. Falhou: voltar a DNS only.
4. Publicar `wrangler.production.toml` com `ENABLE_WIDGET="false"` (rotas passam a existir, tudo passa intacto). Conferir `https://www.usesul.com.br/__origens/health` e repetir a compra nativa.
5. Mudar para `"dry-run"`, olhar `wrangler tail`; depois `"true"` em janela supervisionada. Smoke: link presente 1 vez, desktop e mobile, Turbo, retorno, CTA/carrinho nativos.
6. Qualquer anomalia: seção 5.

Requisito da Cloudflare: Workers Routes em hostname existente exigem zona ativa e registro proxied.

## 7. Fica para depois

- **Busca (Fase 2B/3):** reutilizar `src/lib/search/rank.ts` e `/api/cidades/sul`. O índice **não tem CORS**; decidir entre proxy pelo Worker (medir payload e cache antes) ou CORS mínimo. Ponto de extensão do loader: adicionar item ao array `widgets` (`{ id, mount() }`).
- **`origens_return`:** o loader já valida (só `https://useorigens.com.br/sul[/...]`, sem credenciais nem porta), mas o `purchaseUrl()` do storefront **não envia** o parâmetro; ponta a ponta **não funciona hoje**. Não há filtros em `searchParams`, portanto nada de preservar filtros.
- **Drawer pós-adição:** sem estrutura observada (ver seção 1). Requer autorização para uma adição de teste.
