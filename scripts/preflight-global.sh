#!/usr/bin/env bash
# Preflight do release global. SOMENTE LEITURA: não publica, não faz push, não pede login e não altera nada além de arquivos temporários.
#   bash scripts/preflight-global.sh            -> testes + verificação com HTML real + dry-run + health/smoke públicos
#   bash scripts/preflight-global.sh --quick    -> pula `npm test` e a verificação com HTML real (só configuração, dry-run, health e smoke)
# Última linha: READY (nenhum FAIL; WARN = pendência manual/autenticada listada) ou BLOCKED: <motivos>. Exit 0 = READY, 1 = BLOCKED.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/global-common.sh"
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
FAILS=(); WARNS=()
ok()   { log "  OK    $*"; }
warn() { WARNS+=("$*"); log "  WARN  $*"; }
bad()  { FAILS+=("$*"); log "  FAIL  $*"; }
cd "$ROOT" || exit 1

log "[1] Git"
BRANCH=$(git rev-parse --abbrev-ref HEAD); HEAD_SHA=$(git rev-parse --short HEAD)
ok "branch $BRANCH @ $HEAD_SHA"
DIRTY=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')
[ "$DIRTY" = 0 ] && ok "árvore sem alterações rastreadas pendentes" || bad "$DIRTY arquivo(s) rastreado(s) modificado(s) não commitados"
UNTRACKED=$(git status --porcelain | grep -c '^??' || true); [ "$UNTRACKED" = 0 ] || warn "$UNTRACKED arquivo(s) não rastreado(s) (conferir que nenhum é sensível): $(git status --porcelain | grep '^??' | head -3 | tr '\n' ' ')"
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then AHEAD=$(git rev-list --count '@{u}..HEAD'); [ "$AHEAD" = 0 ] && ok "HEAD já está no remoto" || warn "$AHEAD commit(s) local(is) ainda não enviados ao remoto (o release usa o código local; enviar/PR só com autorização)"; else warn "branch sem upstream (não enviada ao remoto)"; fi

log "[2] Configuração e scripts"
grep -q '^ENABLE_WIDGET = "false"' "$CFG" && ok "$CFG segue fail-closed (ENABLE_WIDGET=false)" || bad "$CFG não está fail-closed"
ROUTES=$(grep -o 'pattern = "[^"]*"' "$CFG" | sed -E 's/pattern = "(.*)"/\1/' | tr '\n' ' ')
[ "$(grep -c 'pattern = ' "$CFG")" = 7 ] && ! grep -Eq 'pattern = "[^"]*(cart|checkout|store_sessions)' "$CFG" && grep -q 'www.usesul.com.br/usesul/product/\*' "$CFG" && grep -q 'www.usesul.com.br/__origens/\*' "$CFG" && ok "rotas: produto, __origens e as 5 de casca (home, products, collections, about, orders); nenhuma de carrinho/checkout/login" || bad "rotas do TOML diferentes das esperadas: $ROUTES"
KVID=$(grep -A2 'binding = "CART_REFS"' "$CFG" | grep '^id' | sed -E 's/id = "([0-9a-f]+)"/\1/'); [ -n "$KVID" ] && ok "binding CART_REFS presente (id ${KVID:0:8}…)" || bad "binding CART_REFS ausente"
assert_deploy_vars allowlist >/dev/null && assert_deploy_vars product-catalog >/dev/null && ok "argumentos de deploy completos (6 features, 5 caminhos, CART_REFS, escopo explícito)" || bad "argumentos de deploy incompletos"
STRAY=$(grep -n 'wrangler deploy' scripts/release-global.sh scripts/rollout-cart.sh 2>/dev/null | grep -v '^scripts/[a-z-]*\.sh:[0-9]*:\s*#' | grep -v 'deploy_worker\|Não \|NUNCA\|^\S*:[0-9]*:#' || true)
[ -z "$STRAY" ] && ok "nenhum 'wrangler deploy' solto: todo deploy passa por deploy_worker" || bad "deploy fora de deploy_worker: $STRAY"
grep -q -- '--deploy' scripts/release-global.sh && grep -q 'PUBLICAR-CATALOGO-COMPLETO' scripts/release-global.sh && ok "release-global.sh exige --deploy e confirmação explícita" || bad "release-global.sh sem a dupla trava"
grep -q 'DEPRECATED' scripts/rollout-cart.sh && ok "rollout-cart.sh (obsoleto) está bloqueado" || bad "rollout-cart.sh obsoleto ainda executável"

if [ "$QUICK" = 0 ]; then
  log "[3] Testes locais (npm test)"
  TEST_LOG=/tmp/use-origens-global-test.log; T0=$(date +%s); npm test > "$TEST_LOG" 2>&1; RC=$?; T1=$(date +%s)
  SUMMARY=$(grep -E '^ℹ (tests|pass|fail|skipped|cancelled)' "$TEST_LOG" | tr '\n' ' ')
  if [ $RC -eq 0 ]; then ok "npm test: $SUMMARY($((T1-T0))s)"; else
    bad "npm test falhou: $SUMMARY — log completo em $TEST_LOG (fora do Git)"
    # O erro ORIGINAL (teste, tipo da falha, stack, esperado x recebido) precisa aparecer: sem deduzir a causa por "268/269".
    log "  ── teste(s) reprovado(s) ──"; awk '/^✖ failing tests:/{f=1} f' "$TEST_LOG" | head -60 | sed 's/^/     /'
  fi
  log "[4] Escopo contra o HTML REAL da INK (leitura pública, Worker local)"
  V=$(node scripts/verify-scope-real.mjs 2>&1 | tail -1); node scripts/verify-scope-real.mjs >/dev/null 2>&1 && ok "verify-scope-real: $V" || bad "verify-scope-real falhou: $V"
else warn "testes e verify-scope-real PULADOS (--quick)"; fi

log "[5] Bundle (wrangler deploy --dry-run, sem publicar e sem login)"
DRY=$(deploy_worker product-catalog --dry-run 2>&1); [ $? -eq 0 ] && echo "$DRY" | grep -q 'CART_REFS' && echo "$DRY" | grep -q 'WIDGET_SCOPE_MODE' && ok "bundle compila: $(echo "$DRY" | grep -o 'Total Upload: [^/]*/ gzip: [0-9.]* KiB')" || bad "dry-run falhou: $(echo "$DRY" | tail -3 | tr '\n' ' ')"

log "[6] Produção pública (somente leitura)"
if H=$(health_ok allowlist 2>&1); then ok "health: seis features, allowlist 5, escopo allowlist (estado protegido)"; else
  if health_ok catalog >/dev/null 2>&1; then warn "produção JÁ está em product-catalog (release já aplicado?)"; else bad "health fora do estado protegido: $H"; fi; fi
if node scripts/smoke-global.mjs --expect=allowlist >/tmp/preflight-smoke.out 2>&1; then ok "smoke público: $(tail -1 /tmp/preflight-smoke.out | cut -c1-110)"; else bad "smoke público falhou: $(grep '^FAIL' /tmp/preflight-smoke.out | head -3 | tr '\n' ' ')"; fi

if storefront_ok; then ok "storefront alcançável ($(storefront_probe))"; else bad "storefront INACESSÍVEL agora ($(storefront_probe)): o QA da ida e volta INK → storefront → INK não pode ser validado (erro de rede/TLS, não do Worker)"; fi

log "[7] Rollback e conta Cloudflare (exigem login; NÃO pedido esta noite)"
if WHO=$(npx wrangler whoami 2>&1) && echo "$WHO" | grep -qi 'logged in'; then
  echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL" && ok "wrangler autenticado como $EXPECTED_ACCOUNT_EMAIL" || bad "wrangler autenticado em OUTRA conta"
  V=$(active_version) && ok "versão ativa capturável para rollback: ${V:0:8}…" || bad "não consegui capturar a versão ativa"
else
  warn "wrangler NÃO autenticado: a versão de rollback será capturada no release (login OAuth do proprietário obrigatório)"
fi
warn "plano Workers Paid: confirmar manualmente no painel (o release pede confirmação explícita)"
warn "regra WAF de cart-ref (50 req/10 s/IP) e modo de falha das Workers Routes: conferir no painel (não alterados)"

log ""
if [ ${#FAILS[@]} -eq 0 ]; then log "READY (${#WARNS[@]} pendência(s) manual(is)/autenticada(s) acima)"; exit 0; else log "BLOCKED: $(IFS='; '; echo "${FAILS[*]}")"; exit 1; fi
