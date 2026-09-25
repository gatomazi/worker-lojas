#!/usr/bin/env bash
# RELEASE GLOBAL: expande a integração de cinco produtos para TODAS as páginas de produto da Use Sul (WIDGET_SCOPE_MODE=product-catalog).
#
#   bash scripts/release-global.sh --deploy        <- ÚNICA forma de publicar. Sem --deploy nada é publicado (mostra a ajuda e sai).
#
# Trava dupla (nunca publica por padrão): o argumento --deploy E a confirmação do proprietário — digite a frase pedida no prompt, ou exporte
# RELEASE_CONFIRM=PUBLICAR-CATALOGO-COMPLETO. Também pede a confirmação manual do plano Workers Paid (WORKERS_PAID_CONFIRMED=1 para pré-aprovar).
# Exige `npx wrangler login` FEITO PELO PROPRIETÁRIO (OAuth) na conta esperada; se faltar, para com uma mensagem legível.
# Não cria recursos, não altera DNS/WAF/rotas e nunca faz push/merge.
#
# Etapas (cada deploy passa por deploy_worker: seis features, cinco caminhos, CART_REFS e escopo SEMPRE explícitos):
#   A. captura health + versão ativa (para rollback) + valida o estado protegido (cinco produtos)
#   B. publica o código novo AINDA no escopo de cinco produtos; smoke
#   C. muda SOMENTE WIDGET_SCOPE_MODE=product-catalog (mesmas features/allowlist/KV)
#   D/E. smoke público em 20 produtos + não-produto/transacional + QA em navegador real (1280/390/320×640, drawers, 3+ peças, espelho ida e volta)
#   F. qualquer falha crítica: restaura a versão capturada em A (cinco produtos, seis features, KV intacto) e confirma health + smoke
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/global-common.sh"
PHRASE="PUBLICAR-CATALOGO-COMPLETO"
usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
die() { log "PARADO: $*"; exit 1; }

DEPLOY=0
for arg in "$@"; do case "$arg" in --deploy) DEPLOY=1 ;; -h|--help) usage; exit 0 ;; *) usage; log ""; log "argumento desconhecido: $arg"; exit 2 ;; esac; done
[ "$DEPLOY" = 1 ] || { usage; log ""; log "Nada foi publicado (falta --deploy)."; exit 2; }

# ── confirmação do proprietário ───────────────────────────────────────────────────────────────────────────────────────────────────────
if [ "${RELEASE_CONFIRM:-}" != "$PHRASE" ]; then
  [ -t 0 ] || die "sem terminal interativo e sem RELEASE_CONFIRM=$PHRASE"
  read -r -p "Vai publicar TODO o catálogo em produção. Digite $PHRASE para continuar: " ANS; [ "$ANS" = "$PHRASE" ] || die "confirmação não digitada"
fi
if [ "${WORKERS_PAID_CONFIRMED:-}" != "1" ]; then
  [ -t 0 ] || die "sem terminal interativo e sem WORKERS_PAID_CONFIRMED=1"
  read -r -p "Você conferiu NO PAINEL que a conta está no plano Workers Paid (franquias: 10 M requests e 1 M writes de KV por mês)? Digite sim: " ANS; [ "$ANS" = "sim" ] || die "plano Workers Paid não confirmado"
fi

cd "$ROOT" || exit 1
PW_PATH="${PW_PATH:-/Users/gtomazi/projects/useorigens-cartmirror}"
if [ "${RELEASE_SKIP_BROWSER:-}" != "1" ]; then [ -d "$PW_PATH/node_modules/playwright-core" ] || die "playwright-core não encontrado em PW_PATH=$PW_PATH (ou exporte RELEASE_SKIP_BROWSER=1 assumindo a lacuna)"; fi
NEW_VERSION=$(node -e 'import("./src/loader-source.js").then((m)=>console.log(m.LOADER_VERSION))')

# ── preflight completo (testes, HTML real, dry-run, health/smoke públicos) ────────────────────────────────────────────────────────────────
log "== preflight =="; bash scripts/preflight-global.sh || die "preflight BLOCKED (veja os motivos acima)"

# ── conta Cloudflare (OAuth do proprietário) ──────────────────────────────────────────────────────────────────────────────────────────────
WHO=$(npx wrangler whoami 2>&1); echo "$WHO" | grep -qi 'logged in' || die "wrangler NÃO autenticado. O proprietário precisa rodar: npx wrangler login  (e aprovar o OAuth)"
echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL" || die "wrangler autenticado em outra conta (esperado $EXPECTED_ACCOUNT_EMAIL)"

# ── A. captura e estado protegido ─────────────────────────────────────────────────────────────────────────────────────────────────────────
log "== A. captura =="
PREV_VERSION=$(active_version) || die "não consegui capturar a versão ativa do Worker (necessária para o rollback)"
PREV_HEALTH=$(health_json) || die "health ilegível"
health_ok allowlist || die "produção NÃO está no estado protegido (cinco produtos, seis features)"
PREV_LOADER=$(printf '%s' "$PREV_HEALTH" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
mkdir -p .release; TS=$(date +%Y%m%d-%H%M%S); CAP=".release/capture-$TS.json"; EVID="$ROOT/.release/evidence/$TS"; mkdir -p "$EVID"; chmod 700 "$EVID"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({captured_at:new Date().toISOString(),previous_version:process.argv[2],health:JSON.parse(process.argv[3])},null,1),{mode:0o600})' "$CAP" "$PREV_VERSION" "$PREV_HEALTH"
log "   versão de rollback: $PREV_VERSION (loader $PREV_LOADER) — capturada em $CAP"
smoke allowlist >/dev/null || die "smoke no estado atual falhou (as cinco páginas e a amostra fora do escopo precisam estar 200)"
storefront_ok || die "storefront INACESSÍVEL ($(storefront_probe)). Nada foi publicado. Pré-condição: o QA valida INK → storefront → INK; erro de rede/TLS ali não é falha do Worker. Tente de novo quando o storefront responder."

# ── F. rollback automático ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
rollback() {
  log ""; log "!!! ROLLBACK ($1) → versão capturada $PREV_VERSION"
  if (cd "$ROOT" && npx wrangler rollback "$PREV_VERSION" --name "$WORKER_NAME" --message "release-global rollback: $1" --yes); then
    sleep 8
    if printf '%s' "$PREV_HEALTH" | node -e 'import("./scripts/lib/release-lib.mjs").then((m)=>{let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const now=await (await fetch(process.argv[1])).json();process.exit(m.sameConfig(JSON.parse(s),now)?0:1)})})' "$HEALTH_URL" && smoke allowlist "$PREV_LOADER" >/dev/null; then
      log "!!! rollback CONFIRMADO: versão anterior, cinco produtos, seis features (incluindo cart-mirror), KV intacto."; return 0; fi
    log "!!! rollback aplicado, mas o health/smoke não conferem com o capturado."
  fi
  log "!!! plano B: republicar o código atual no escopo de cinco produtos com as seis features"
  if deploy_worker allowlist && sleep 8 && health_ok allowlist && smoke allowlist >/dev/null; then log "!!! estado seguro restaurado (código novo, cinco produtos, seis features)."; return 0; fi
  log "!!! CRÍTICO: o rollback automático NÃO se confirmou. Ação manual imediata:"
  log "    npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes     (NUNCA publique sem as --var: o TOML é fail-closed e desliga a integração)"; return 1
}
# Evidência ANTES do rollback (screenshot/URL/eventos vêm do QA em $EVID/qa; aqui health, sondas HTTP e deployments). Nunca impede o rollback.
fail() { capture_evidence "$EVID/falha-$(date +%H%M%S)" "$1" || true; rollback "$1"; log ""; log "RELEASE ABORTADO: $1"; log "   evidências: .release/evidence/$TS/ (fora do Git)"; exit 1; }
smoke_logged() { smoke "$@" 2>&1 | tee -a "$EVID/smoke-$1.log"; return "${PIPESTATUS[0]}"; }

# ── B. código novo, escopo antigo ─────────────────────────────────────────────────────────────────────────────────────────────────────────
log "== B. código novo mantendo os cinco produtos =="
deploy_worker allowlist || fail "deploy B falhou"
sleep 8
MSG=$(health_ok allowlist "$NEW_VERSION" 2>&1) || fail "health após B: $MSG"
smoke_logged allowlist "$NEW_VERSION" || fail "smoke após B: $(grep -h '^FAIL' "$EVID"/smoke-allowlist.log | head -3 | tr '\n' ' ')"

# ── C. liga o catálogo inteiro (só o escopo muda) ─────────────────────────────────────────────────────────────────────────────────────────
log "== C. WIDGET_SCOPE_MODE=product-catalog =="
deploy_worker product-catalog || fail "deploy C falhou"
sleep 8
MSG=$(health_ok catalog "$NEW_VERSION" 2>&1) || fail "health após C: $MSG"

# ── D/E. smoke público + navegador ────────────────────────────────────────────────────────────────────────────────────────────────────────
log "== D/E. smoke =="
smoke_logged catalog "$NEW_VERSION" || fail "smoke do catálogo: $(grep -h '^FAIL' "$EVID"/smoke-catalog.log | head -3 | tr '\n' ' ')"
if [ "${RELEASE_SKIP_BROWSER:-}" = "1" ]; then log "   AVISO: QA em navegador PULADO (RELEASE_SKIP_BROWSER=1) — lacuna assumida pelo proprietário"
else
  # O QA grava screenshot, URL, eventos de navegação, resumo do carrinho, resposta do storefront e o motivo em $EVID/qa e CLASSIFICA a falha (QA|INK|Worker|Storefront).
  PW_PATH="$PW_PATH" QA_EVIDENCE_DIR="$EVID/qa" node scripts/qa-global.mjs --live 2>&1 | tee "$EVID/qa-output.log"; QA_RC="${PIPESTATUS[0]}"
  if [ "$QA_RC" != 0 ]; then
    CLS=$(grep '^QA_FALHA_CLASSIFICADA' "$EVID/qa-output.log" | tail -1); FIRST=$(grep '^FAIL' "$EVID/qa-output.log" | head -2 | cut -c1-160 | tr '\n' ' ')
    log "   classificação do QA: ${CLS:-sem classificação}"; fail "QA em navegador reprovou — ${CLS:-sem classificação} — $FIRST"
  fi
fi
MSG=$(health_ok catalog "$NEW_VERSION" 2>&1) || fail "health final: $MSG"

log ""; log "RELEASE CONCLUÍDO: catálogo inteiro em produção (Worker $NEW_VERSION)."
log "   rollback disponível: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --message \"rollback\" --yes"
log "   só o escopo (voltar aos cinco, mantendo o código novo): reexecutar deploy_worker allowlist (ou o comando do docs/expansao-global-ready.md)"
log "   Depois: npx wrangler logout"
exit 0
