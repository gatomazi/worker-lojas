# Fase 2C — `WIDGET_ALLOWLIST` (fail-closed)

Base: commit local `b824382` (branch `feature/ink-loader-fase2a`). Escopo: código local, testes e documentação. **Sem deploy, sem preview remoto, sem alteração de Cloudflare/DNS, sem push.** `docs/fase-2b-smoke.md` foi preservado sem edição.

Legenda: **EXECUTADO** = rodou nesta máquina. **NÃO VALIDADO** = exige Cloudflare/INK reais ou dispositivo que não estava disponível.

## 1. Segurança Git (feito antes de qualquer push)

| Item | Estado |
|------|--------|
| Credencial na URL do remote | **Removida.** `git config remote.origin.url` = `https://github.com/gatomazi/worker-lojas.git`; 0 credenciais em `.git/config` (EXECUTADO) |
| Regra global `insteadOf` | **Não alterada.** A URL efetiva de push é `ssh://git@github.com/gatomazi/worker-lojas.git` |
| Identidade efetiva | `ssh -T git@github.com` responde **`gtomazi`** (corporativa). Push **permanece bloqueado**: essa conta não é `gatomazi` |
| Token antigo | Continua exposto no chat/histórico de conversa. **Você precisa revogá-lo no GitHub.** Não foi reutilizado nesta rodada e nenhum token novo foi pedido |
| Outros repositórios com credencial na URL do remote | `useorigens`, `oria`, `orgulhoregional`, `rituel`, `estamparia-api`, `estamparia-criativos` (detectados na rodada 2A por padrão `user:token@` no `git remote -v`, valores não lidos). **Não modificados**; exigem auditoria separada |

Antes de propor o próximo push: `git remote get-url --push origin` deve resolver para uma URL cuja autenticação seja `gatomazi`, e essa autenticação precisa ser comprovada por você por um método seguro fora do chat.

## 2. Formato da allowlist

Variável `WIDGET_ALLOWLIST` (string). Caminhos **exatos**, separados por vírgula, sem host:

```text
WIDGET_ALLOWLIST="/usesul/product/serra-catarinense"
WIDGET_ALLOWLIST="/usesul/product/serra-catarinense,/usesul/product/vida-no-sul-estancia-edition"
```

Cada entrada deve casar `^/usesul/product/[a-z0-9][a-z0-9_-]{0,127}$`. Máximo 20 entradas e 2048 caracteres.

| Entrada | Resultado |
|---------|-----------|
| ausente, `""`, só espaços | `empty` → **nenhuma** página |
| todas as entradas válidas | `ok` |
| **qualquer** entrada inválida | `invalid` → a lista **inteira** é descartada → **nenhuma** página |
| `*`, `/usesul/product/*`, `/usesul/product/`, `/usesul/*` | inválida (sem curinga nem prefixo) |
| `…/a?x=1`, `…/a#f` | inválida (sem query nem fragmento) |
| `…/a/` (barra final), `…/A` (maiúscula), `…/a%2Fb`, `…/a/b`, `…/__x`, URL completa | inválida |
| entrada vazia (`a,,b`, `a,`) | inválida |

Decisões de casamento (aplicadas ao `pathname` da requisição, comparação exata e sensível a maiúsculas):

- **Query string não participa**: `/usesul/product/a?utm=1` casa com `a`; `/usesul/product/b?x=/usesul/product/a` **não** casa.
- Variantes não listadas (`/a/`, `/A`, `/a%2Dx`, `/a/extra`) não casam. Se a INK servir slugs com maiúsculas, eles **não** poderão ser liberados (limitação consciente; a INK usa minúsculas nos slugs observados).
- Mesmos padrões em dev e produção: `wrangler.dev.toml` e `wrangler.production.toml` trazem `ENABLE_WIDGET = "false"` e `WIDGET_ALLOWLIST = ""`, e `test/allowlist.test.js` falha se divergirem.

## 3. `ENABLE_WIDGET` × `WIDGET_ALLOWLIST`

| `ENABLE_WIDGET` | Página na allowlist | Página fora / lista vazia ou inválida |
|-----------------|--------------------|---------------------------------------|
| `false` ou **qualquer valor desconhecido** | passa intacta | passa intacta |
| `dry-run` | **nada é reescrito**; 1 log JSON por página elegível com `would_inject: true` | nada reescrito; log com `would_inject: false` |
| `true` | injeta o `<script>` do loader (idempotente) | passa intacta, sem sequer inspecionar a resposta |

Log de `dry-run`: `{"event":"use-origens.dry-run","path":"/usesul/product/…","allowlisted":true,"would_inject":true,"allowlist_status":"ok"}`. Apenas o caminho: **nunca** query, cookies, cabeçalhos ou parâmetros. Logs do Worker: `dry-run` (log) e `skip-encoded-body` (warn, com o valor curto de `Content-Encoding`). Testado com segredos plantados em query, `Cookie` e `Authorization` (nenhum aparece).

Loader (`/__origens/loader.js`):

- Só entrega código com `ENABLE_WIDGET=true`; caso contrário devolve um no-op (`no-store`).
- **Publicar o loader não autoriza injetá-lo**: com `true` e lista vazia o loader é servido com `ALLOWED_PATHS = []` e nenhuma página o recebe.
- **Defesa em profundidade:** a lista validada é embutida no loader entregue (`const ALLOWED_PATHS = [...]`). Motivo real: o Turbo Drive mantém o JavaScript vivo entre páginas; sem isso, depois de abrir a URL liberada, uma navegação Turbo para um produto **não** liberado montaria o link. Agora o loader só monta em caminho exato da lista.
- Consequência: alterar a allowlist muda o que o Worker injeta imediatamente; abas já abertas com o loader antigo mantêm a lista antiga até recarregar. Cache do loader: `max-age=60`.

`/__origens/health` informa `widget_mode`, `allowlist_status` e `allowlist_size` (nunca os caminhos), para conferir a configuração antes de ativar.

## 4. Comportamento preservado (33 testes originais)

Os 33 testes de `b824382` continuam no repositório e passam. Adaptação mínima e intencional: agora `ENABLE_WIDGET=true` só injeta em caminhos da allowlist, então os testes que esperam injeção passam `WIDGET_ALLOWLIST` com os slugs que usam; o número do loader saiu de `2a.1` (fixo) para `LOADER_VERSION` (`2c.1`). Nada mais nas asserções foi enfraquecido. Preservado e coberto: só `GET` HTML 200 de `/usesul/product/<slug>`; só o `<script>` do loader é inserido, sem duplicar; `Set-Cookie` múltiplos; `ETag`/`Content-Length` removidos **apenas** quando reescreve; redirects (`manual`), erros, POST/HEAD, `Turbo-Frame`, não-HTML e `attachment` intactos; corpo ainda codificado → repassa intacto e registra `skip-encoded-body` sem dados sensíveis; sem headers de segurança/CORS/custom próprios.

## 5. Testes (EXECUTADO: `npm test`)

**70 testes: 70 aprovados, 0 falhos, 0 ignorados** (33 originais + 37 novos).

| Arquivo | Total | Novos | Cobertura nova |
|---------|-------|-------|----------------|
| `test/worker.test.js` (mock) | 15 | 7 | lista vazia/ausente/malformada; só caminho permitido; query; flag `false`; valor desconhecido; `dry-run` + log seguro; health |
| `test/integration.workerd.test.js` (**HTMLRewriter real, workerd**) | 30 | 14 | fail-closed com 8 listas inválidas; permitido × não permitido; query; barra final/caixa/encoding; várias entradas; `false`; `dry-run` com segredos plantados; `dry-run` fora da lista; sequência Turbo (permitida, bloqueada, `Turbo-Frame`, permitida); loader não autoriza injeção; lista embutida; health; corpo codificado; **ponta a ponta workerd + jsdom** |
| `test/loader.dom.test.js` (jsdom) | 16 | 7 | lista vazia nunca monta; caminho fora da lista; query; caminhos parecidos; **Turbo permitido→bloqueado→permitido**; re-execução do script sem duplicar; JSON embutido |
| `test/allowlist.test.js` | 9 | 9 | parser (vazio, válido, dedupe, curingas, query/fragmento/barra/caixa/encoding, invalidação total, limites) e paridade dev/produção dos `wrangler.*.toml` |

Verificação de que os testes pegam regressões (mutação, EXECUTADO): removendo o gate da allowlist no Worker → **11 falhas**; removendo o gate no loader → **4 falhas**; restaurado → 70/70.

Também EXECUTADO: `npx wrangler deploy -c wrangler.dev.toml --dry-run --outdir …` (build offline; mostra `ENABLE_WIDGET` e `WIDGET_ALLOWLIST` como variáveis; nenhum deploy).

Turbo **real** no INK (Chrome do usuário, GETs de leitura, sem carrinho): com o loader colado (allowlist de uma URL) — URL liberada: 1 link; Turbo para outro produto: 0 links e CTA nativo presente; Turbo de volta à liberada: 1 link. Isto **não** foi feito com o Worker injetando (o Worker não está no ar).

### Limitações NÃO VALIDADAS

- Edge Cloudflare real, incluindo comportamento de `Content-Encoding`, TLS Cloudflare↔INK, cabeçalho `Host` e casamento das rotas.
- Preview `workers.dev` (não publicado).
- Mobile a 390 px (a janela do navegador não desce de ~549 px) e qualquer teste em dispositivo.
- Injeção real do script na INK (o Worker nunca rodou diante da INK); só HTML de fixture e o navegador com script colado.
- Erros de console preexistentes da INK ao navegar por Turbo (`Identifier 'buttons' has already been declared`, `eventIDViewContent`) — linha de base da rodada 2B, não causados por este código.

## 6. Plano de ativação progressiva

Cada etapa exige **nova aprovação expressa**. Nada abaixo foi executado. Versão instalada: **wrangler 4.137.0** (comandos abaixo conferidos com `--help` local; sem atualização de dependências).

### O que cada ambiente prova

| | Preview `workers.dev` | Rota real `www.usesul.com.br` |
|--|----------------------|------------------------------|
| Prova | O bundle sobe no runtime real; variáveis chegam ao Worker; `/__origens/health` com `widget_mode` e `allowlist_status`; parser da allowlist em produção | Casamento das duas rotas; **TLS** Cloudflare↔INK; cabeçalho **Host**; **cookies** (`Set-Cookie` múltiplos, sessão) passando pelo Worker; **codificação** (`Content-Encoding`) no edge; HTML real da INK; convivência com regras de cache/redirect da zona |
| Não prova | Nada sobre a INK (o host `workers.dev` responde 404 a tudo, exceto health); nem TLS, Host, cookies ou codificação diante da INK | — |

### Etapas

0. **Pré-requisitos (você, no painel; ver seção 8)** e revogação do token antigo.
1. **Preview isolado** (você faz `wrangler login` localmente; nenhum token vai ao chat):
   `npx wrangler deploy -c wrangler.dev.toml` → conferir `https://use-sul-widget-staging.<subdomínio>.workers.dev/__origens/health`: `widget_mode:"false"`, `allowlist_status:"empty"`. Opcional: repetir com `--var ENABLE_WIDGET:dry-run --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense` para ver `allowlist_status:"ok"`. Remover depois com `npx wrangler delete -c wrangler.dev.toml` se não for mais necessário.
2. **Rotas do `www` com a flag desligada** (aprovação): `npx wrangler deploy -c wrangler.production.toml` (as duas rotas do toml; `ENABLE_WIDGET="false"`, lista vazia). Conferir `https://www.usesul.com.br/__origens/health` e uma compra nativa completa (variante, adição, drawer, carrinho) com o Worker no caminho. Verificar `curl -I` do produto: `set-cookie` ainda com os 4 nomes, `cache-control: private, no-store`.
3. **`dry-run`** (aprovação): `npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:dry-run --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense`. Em outro terminal: `npx wrangler tail use-sul-widget --format json`. Navegar 10–15 min; esperado: linhas `use-origens.dry-run`, **nenhuma mudança visível**, nenhum `skip-encoded-body` inesperado, nenhum erro novo no console além da linha de base.
4. **Uma única URL** (aprovação): mesmo comando com `--var ENABLE_WIDGET:true` e `WIDGET_ALLOWLIST:/usesul/product/serra-catarinense`. Conferir: `/__origens/health` = `ok`/`1`; view-source contém **um** `<script data-use-origens-widget>` só nessa URL; a URL mostra "← Voltar a procurar" abaixo do CTA nativo; outro produto **não** mostra; navegação Turbo entre os dois; fluxo completo de compra até o drawer (sem concluir pedido); console sem erros novos; se `skip-encoded-body` aparecer no `tail`, o link não aparece e o problema é de codificação no edge (não do código da INK).
5. **Ampliar** só após resultado satisfatório e nova aprovação: acrescentar caminhos exatos, um por vez ou em pequenos lotes.

Nota: valores passados com `--var` valem para aquela publicação; um `wrangler deploy` posterior **sem** `--var` volta aos padrões do toml (`false`, lista vazia), que é a direção segura.

## 7. Rollback (em ordem)

1. **`ENABLE_WIDGET=false`**: `npx wrangler deploy -c wrangler.production.toml` (sem `--var`, volta ao padrão do toml) ou `npx wrangler rollback --name use-sul-widget` para a versão anterior. Efeito nas páginas novas em segundos; o loader vira no-op. Não toca no checkout.
2. **Remover as rotas do Worker** se o item 1 não bastar: painel → Workers Routes → apagar as duas rotas do `www` (ou `npx wrangler delete -c wrangler.production.toml`). A INK passa a responder direto pelo proxy.
3. **`www` em DNS only — último recurso.** Isto desativa **todo** o proxy Cloudflare naquele hostname (WAF, regras, cache, redirects, TLS da Cloudflare, `cf-ray`). Só se o problema for o próprio proxy.

Nunca: mexer no checkout, no carrinho, nas rotas da INK ou em cookies.

## 8. Configuração mínima a conferir no painel Cloudflare

**Não verifiquei o painel** (sem credenciais). Item a item, somente leitura:

1. **Zona `usesul.com.br`: Active** (Overview).
2. **DNS: `www` = Proxied** (nuvem laranja), destino Heroku/INK; raiz `@` inalterada (Redirect.pizza).
3. **SSL/TLS: Full ou Full (strict)** (não Flexible, não Off).
4. **Workers Routes: nenhum Worker conflitante** em `www.usesul.com.br/*`, `/usesul/*`, `/usesul/product/*` ou `/__origens/*`.
5. **Regras de cache: nada que cacheie HTML em `/usesul/*`** (Cache Rules, Page Rules, Cache Level "Cache Everything", Tiered Cache/Argo não devem sobrescrever `private, no-store`). O observado hoje é `cf-cache-status: DYNAMIC`.
6. **Redirect/Transform Rules**: nada que reescreva ou redirecione `/usesul/product/*` ou `/__origens/*`.

## 9. Arquivos alterados nesta rodada

| Arquivo | Mudança |
|---------|---------|
| `src/allowlist.js` | **Novo**: `parseAllowlist` fail-closed |
| `src/worker.js` | Gate da allowlist, `dry-run` sem reescrita com log seguro, `skip-encoded-body`, loader com lista embutida, health com status da lista |
| `src/loader-source.js` | `buildLoaderSource(paths)`; loader só monta em caminho da lista; `LOADER_VERSION = 2c.1`; `LOADER_SOURCE` = versão sem lista (nunca monta) |
| `wrangler.dev.toml`, `wrangler.production.toml` | `WIDGET_ALLOWLIST = ""` e os mesmos padrões |
| `test/allowlist.test.js` | **Novo** |
| `test/worker.test.js`, `test/integration.workerd.test.js`, `test/loader.dom.test.js` | Adaptados (allowlist/versão) e ampliados |
| `README.md`, `docs/plan.md`, `docs/fase-2c-allowlist.md` | Documentação. `docs/fase-2b-smoke.md` **intocado** |
