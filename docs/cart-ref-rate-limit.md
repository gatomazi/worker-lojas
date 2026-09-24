# Proteção de `POST /__origens/cart-ref` — rate limit da zona

Data: 2026-09-24. Estado: **PENDENTE — não aplicado.** A sessão do Wrangler tem `zone (read)` e nenhum escopo de WAF/Rate Limiting (`wrangler whoami`); a regra não foi criada e não se tentou contornar a autorização. Abaixo, a configuração proposta e o checklist para o proprietário.

## Taxa real esperada (legítima)

- O cliente (`src/loader/cart-mirror.js`) sincroniza com **debounce de 800 ms** e só depois de mudança do carrinho; renova o token a cada 20 min. Alterações consecutivas de quantidade viram, no pior caso, ~1 POST a cada 0,8 s (≈ 12 por 10 s, ≈ 75 por minuto); o uso real é bem menor (rajadas de poucos POSTs).
- Já existe um limite **no Worker**: 20 POST/min por IP, em memória **por isolate** (`src/cart-ref.js`, `429 rate_limited` + `retry-after: 60`). Ele não é global e não substitui a regra da zona.
- Atenção: 20/min já pode devolver 429 a quem edita muitos itens em sequência ou a vários compradores no mesmo IP (NAT/rede móvel). O cliente falha de forma segura (mantém o último ref), mas vale **observar os 429 antes de apertar qualquer limite** e, se aparecerem para compradores reais, subir o limite do Worker em uma rodada própria (exige deploy; fora do escopo desta).

## Regra proposta (WAF → Rate limiting rules)

Expressão (só o que precisa): `http.host eq "www.usesul.com.br" and http.request.method eq "POST" and http.request.uri.path eq "/__origens/cart-ref"`. **Não** cobre `GET /__origens/cart-ref/<ref>` nem a busca/INK.

Escolha conforme o plano da zona (confirmar no painel quais períodos/ações/características existem):

| Plano | Característica | Limite | Ação | Observação |
|-------|----------------|--------|------|-----------|
| Free (1 regra, período fixo de 10 s) | IP | **30 req / 10 s** | Block, timeout 10 s | 30 é ~2,5× o máximo teórico de um comprador (12,5/10 s): sobra folga para ~2 compradores ativos no mesmo NAT; o bloqueio de 10 s se recupera sozinho |
| Pro/Business/Enterprise | IP | **120 req / 1 min** (ou 60 req / 1 min se o painel não oferecer valor maior) | 1º: **Log** (se disponível) por 2–3 dias; depois Block/Managed Challenge com timeout de 60 s | Só endurecer depois de ver os eventos |

Notas: não usar cookie/header como característica; não usar limite por sessão (não há sessão nossa); não criar exceção nem ampliar a allowlist.

## Checklist para o proprietário (painel Cloudflare → zona `usesul.com.br`)

1. Security → WAF → Rate limiting rules → Create rule; nome `cart-ref POST guard`.
2. Colar a expressão acima (modo editor); característica **IP**; preencher limite/período/ação da tabela conforme o plano.
3. Salvar **primeiro em modo Log** se o plano permitir; senão, com o bloqueio conservador da linha Free.
4. Conferir em Security → Events (filtro pela regra) se há acertos de compradores reais; ajustar.
5. Confirmar que `GET /__origens/health` e a jornada da Serra seguem normais.

Alternativa via API: token com `Zone > Zone WAF > Edit` (ou equivalente de Rate Limiting) na zona; criar no ruleset de fase `http_ratelimit`. Criar esse token é decisão do proprietário.

## Monitoração sem dados sensíveis

- Painel de métricas do Worker `use-sul-widget` e Analytics da zona: contagem por **status** (429/4xx/5xx) filtrando `POST` + caminho **exato** `/__origens/cart-ref`. Não filtrar/agrupar por URL do `GET` (o caminho contém o `ref`).
- Security → Events para a regra acima (IP, contagem, ação) — sem corpo de requisição.
- Não habilitar log de corpo, cookies ou `Authorization`; não registrar `cart_ref` nem o snapshot (Worker, storefront ou analytics). `wrangler tail` só com `--status`/contagem, sem copiar URLs de `GET`.
- Sinais de alerta: 5xx > 0 sustentado no POST (KV indisponível), 429 recorrente vindo de compradores, 403 em volume (Referer/Origin fora da allowlist = sondagem).
