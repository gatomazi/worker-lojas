#!/usr/bin/env bash
# RELEASE DA NAVBAR DA INK: liga a sétima feature `header-nav` (loader 4.4) PRESERVANDO o que está em produção agora.
#
#   bash scripts/release-navbar.sh --check         <- SOMENTE LEITURA: pré-condições do storefront em produção, estado atual do Worker, plano e dry-run.
#   bash scripts/release-navbar.sh --deploy        <- ÚNICA forma de publicar. Sem --deploy/--check nada acontece (mostra a ajuda e sai).
#
# Trava dupla (nunca publica por padrão): o argumento --deploy E a confirmação do proprietário — digite a frase pedida no prompt, ou exporte
# RELEASE_CONFIRM=PUBLICAR-NAVBAR-INK. Exige `npx wrangler login` FEITO PELO PROPRIETÁRIO (OAuth) na conta esperada. Não cria recursos,
# não altera DNS/WAF/rotas, não apaga KV e nunca faz push/merge. Não faz compra: o QA ao vivo só adiciona um item ao carrinho ANÔNIMO.
#
# Ordem (o storefront e o CMS vêm ANTES; este script confere que já estão no ar e NÃO publica o storefront):
#   0. pré-condições em produção: /api/navbar/sul (contrato v2: grupos top/more e estados), /sul/busca (resultados, sem resultado, cabeçalho de cache, coleção >48 completa)
#   A. captura: versão ativa + health + variáveis/bindings REAIS da versão (escopo, allowlist, features); as features TÊM de ser exatamente as seis
#      (header-nav já ativa, feature a mais/menos ou health divergente da versão => para, sem publicar)
#   B. publica o mesmo código com as MESMAS variáveis (escopo/allowlist/ENABLE_WIDGET preservados) e WIDGET_FEATURES = as seis + header-nav
#   C. health (sete features, mesmo escopo/allowlist, loader novo, shell_pages) + smoke público (produto, páginas de casca com 1 loader, conta/login/carrinho sem) + /__origens/navbar igual à do storefront
#   D. QA em navegador REAL ao vivo (1280/390/320, Enter na lupa, cart_ref verdadeiro, drawer/CTA nativos)
#   E. falha crítica: evidência ANTES, depois `wrangler rollback` para a versão CAPTURADA em A (KV e checkout intactos) + health/smoke conferidos
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/global-common.sh"
PHRASE="PUBLICAR-NAVBAR-INK"
usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
die() { log "PARADO: $*"; exit 1; }

MODE=""
for arg in "$@"; do case "$arg" in --deploy) MODE=deploy ;; --check) MODE=check ;; -h|--help) usage; exit 0 ;; *) usage; log ""; log "argumento desconhecido: $arg"; exit 2 ;; esac; done
[ -n "$MODE" ] || { usage; log ""; log "Nada foi feito (falta --check ou --deploy)."; exit 2; }
cd "$ROOT" || exit 1
NEW_VERSION=$(node -e 'import("./src/loader-source.js").then((m)=>console.log(m.LOADER_VERSION))'); export NAV_NEW_VERSION="$NEW_VERSION"
FAILS=(); WARNS=()
ok()   { log "  OK    $*"; }
warn() { WARNS+=("$*"); log "  WARN  $*"; }
bad()  { FAILS+=("$*"); log "  FAIL  $*"; }

# ── 0. storefront em produção (somente leitura) ─────────────────────────────────────────────────────────────────────────────────────────
# Conta os produtos de uma consulta na página real; imprime o número (0 = "Nenhum produto") ou "ERRO" se a página não for a de resultados.
search_count() { curl -sS --max-time 20 "$STOREFRONT_URL/sul/busca?q=$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=s.replace(/<!--.*?-->/gs,"");const m=/([\d.]+) produtos? para/.exec(t);if(m)return console.log(Number(m[1].replace(/\./g,"")));console.log(/Nenhum produto encontrado/.test(t)?0:"ERRO")})'; }
storefront_prereqs() {
  local api code cache n
  api=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/navbar/sul" 2>/dev/null)
  if printf '%s' "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const slug=/^[a-z0-9][a-z0-9-]{0,80}$/;const grp=(g)=>Array.isArray(g)&&g.length<=60&&g.every(c=>c&&Number.isInteger(c.id)&&typeof c.title==="string"&&slug.test(c.slug)&&typeof c.url==="string"&&Number.isInteger(c.order));const both=[...j.top||[],...j.more||[]].map(c=>c.slug);const ok=j.v===2&&j.region==="sul"&&grp(j.top)&&grp(j.more)&&new Set(both).size===both.length&&Array.isArray(j.states)&&j.states.length>0&&j.states.every(x=>/^[A-Z]{2}$/.test(x.uf)&&x.path==="/sul/"+x.uf.toLowerCase());if(!ok)process.exit(1);console.log(j.top.length+" no topo, "+j.more.length+" em demais");console.log(both.length)}catch(e){process.exit(1)}})' >/tmp/navbar-count.$$ 2>/dev/null; then
    n=$(sed -n 2p /tmp/navbar-count.$$); ok "storefront: /api/navbar/sul (v2) válido: $(sed -n 1p /tmp/navbar-count.$$)"
    [ "$n" -ge 1 ] || { if [ "${NAVBAR_ALLOW_EMPTY:-}" = "1" ]; then warn "grupos da navbar VAZIOS (NAVBAR_ALLOW_EMPTY=1): o cabeçalho monta só com logo, Regiões, Cidades e busca"; else bad "grupos da navbar VAZIOS: escolha as coleções (Topo / Demais categorias) no CMS de produção e publique (ou exporte NAVBAR_ALLOW_EMPTY=1 para assumir o estado vazio)"; fi; }
  else bad "storefront: /api/navbar/sul indisponível ou fora do formato (o storefront precisa estar no ar ANTES do Worker)"; fi
  rm -f /tmp/navbar-count.$$
  code=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$STOREFRONT_URL/sul/busca?q=chimarrao" 2>/dev/null)
  cache=$(curl -sSI --max-time 20 "$STOREFRONT_URL/sul/busca?q=chimarrao" 2>/dev/null | tr -d '\r' | grep -i '^cache-control' | tr 'A-Z' 'a-z')
  n=$(search_count chimarrao)
  if [ "$code" = 200 ] && [ "$n" != ERRO ] && [ "$n" -ge 1 ] 2>/dev/null; then ok "storefront: /sul/busca?q=chimarrao 200 com $n produto(s)"; else bad "storefront: /sul/busca?q=chimarrao HTTP $code, contagem '$n' (500 = rota fora do modo dinâmico?)"; fi
  echo "$cache" | grep -Eq 'no-store|private' && ok "storefront: resultados sem cache compartilhado ($cache)" || bad "storefront: resultados com cache compartilhado ($cache): uma consulta serviria a outra"
  [ "$(search_count zzqqxx9)" = 0 ] && ok "storefront: termo inexistente mostra 'nenhum produto'" || bad "storefront: termo inexistente não mostrou o estado sem resultado"
  n=$(search_count fala%20daqui)
  if [ "$n" != ERRO ] && [ "$n" -gt 48 ] 2>/dev/null; then ok "storefront: busca pelo nome de coleção com mais de 48 produtos completa ('fala daqui' = $n)"; else bad "storefront: 'fala daqui' = '$n' (esperado > 48: ressincronize as coleções no admin de produção; a busca ainda estaria truncada)"; fi
  [ "$(search_count florianopolis)" -ge 1 ] 2>/dev/null && ok "storefront: 'florianopolis' com resultados" || bad "storefront: 'florianopolis' sem resultados"
}

# ── estado atual do Worker (somente leitura) ────────────────────────────────────────────────────────────────────────────────────────────
log "== pré-condições em produção (storefront) =="
storefront_prereqs
log "== Worker atual (somente leitura) =="
HEALTH_NOW=$(health_json 2>/dev/null) || HEALTH_NOW=""
[ -n "$HEALTH_NOW" ] && ok "health lido: versão $(printf '%s' "$HEALTH_NOW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log(h.version+", escopo "+(h.scope_mode||"allowlist")+", "+(h.widget_features||[]).length+" features, allowlist "+h.allowlist_size)})')" || bad "health ilegível"
if [ "$MODE" = check ]; then
  git diff --quiet HEAD -- "$CFG" 2>/dev/null && ok "$CFG sem alterações locais" || bad "$CFG modificado localmente"
  ROUTES=$(grep -c '^pattern = ' "$CFG"); grep -Eq '^pattern = "[^"]*(cart|checkout|store_sessions)' "$CFG" && bad "rota do TOML no caminho de compra/login" || ok "rotas do TOML: $ROUTES (produto, __origens e as de casca: home, products, collections, about, orders); nenhuma de carrinho/checkout/login. O deploy aplica as rotas; elas NÃO são versionadas (um rollback de versão as mantém, e o código anterior só repassa essas páginas)"
  git rev-parse --verify -q origin/main >/dev/null && { git diff --quiet origin/main -- "$CFG" && ok "$CFG idêntico ao da main (rotas e bindings iguais aos do último release)" || warn "$CFG difere de origin/main: conferir rotas/bindings"; }
  if WHO=$(npx wrangler whoami 2>&1) && echo "$WHO" | grep -qi 'logged in' && echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL"; then
    ok "wrangler autenticado como $EXPECTED_ACCOUNT_EMAIL"
    if V=$(active_version) && PLAN=$(capture_navbar_plan "$V" "$HEALTH_NOW" 2>&1); then
      ok "versão ativa ${V:0:8}… capturada; plano: $(printf '%s' "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log("escopo "+p.WIDGET_SCOPE_MODE+", "+p.allowlistSize+" caminho(s) preservado(s), features "+p.WIDGET_FEATURES)})')"
      NAV_ALLOW=$(printf '%s' "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).WIDGET_ALLOWLIST))'); NAV_SCOPE=$(printf '%s' "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).WIDGET_SCOPE_MODE))')
      DRY=$(deploy_worker_navbar "$NAV_ALLOW" "$NAV_SCOPE" --dry-run 2>&1); [ $? -eq 0 ] && echo "$DRY" | grep -q 'CART_REFS' && ok "dry-run do bundle com as variáveis capturadas: $(echo "$DRY" | grep -o 'Total Upload: [^/]*/ gzip: [0-9.]* KiB')" || bad "dry-run falhou: $(echo "$DRY" | tail -3 | tr '\n' ' ')"
    else bad "captura/plano da produção: ${PLAN:-versão ativa não capturável}"; fi
  else warn "wrangler NÃO autenticado: a captura das variáveis reais e o dry-run com elas só rodam autenticado (o release exige login OAuth do proprietário)"; fi
  log ""; if [ ${#FAILS[@]} -eq 0 ]; then log "READY (${#WARNS[@]} pendência(s) acima). Nada foi publicado."; exit 0; else log "BLOCKED: $(IFS='; '; echo "${FAILS[*]}")"; exit 1; fi
fi

# ── --deploy ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[ ${#FAILS[@]} -eq 0 ] || die "pré-condições em produção reprovadas: $(IFS='; '; echo "${FAILS[*]}")"
if [ "${RELEASE_CONFIRM:-}" != "$PHRASE" ]; then
  [ -t 0 ] || die "sem terminal interativo e sem RELEASE_CONFIRM=$PHRASE"
  read -r -p "Vai ligar a navbar da INK (header-nav) em produção. Digite $PHRASE para continuar: " ANS; [ "$ANS" = "$PHRASE" ] || die "confirmação não digitada"
fi
PW_PATH="${PW_PATH:-/Users/gtomazi/projects/useorigens-cartmirror}"
if [ "${RELEASE_SKIP_BROWSER:-}" != "1" ]; then [ -d "$PW_PATH/node_modules/playwright-core" ] || die "playwright-core não encontrado em PW_PATH=$PW_PATH (ou exporte RELEASE_SKIP_BROWSER=1 assumindo a lacuna)"; fi
WHO=$(npx wrangler whoami 2>&1); echo "$WHO" | grep -qi 'logged in' || die "wrangler NÃO autenticado. O proprietário precisa rodar: npx wrangler login  (e aprovar o OAuth)"
echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL" || die "wrangler autenticado em outra conta (esperado $EXPECTED_ACCOUNT_EMAIL)"

log "== A. captura da produção REAL =="
PREV_VERSION=$(active_version) || die "não consegui capturar a versão ativa do Worker (necessária para o rollback)"
PREV_HEALTH=$(health_json) || die "health ilegível"
PLAN=$(capture_navbar_plan "$PREV_VERSION" "$PREV_HEALTH" 2>&1) || die "a produção atual não permite o release com segurança: $PLAN"
PLAN_FIELD() { printf '%s' "$PLAN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
NAV_ALLOW=$(PLAN_FIELD WIDGET_ALLOWLIST); NAV_SCOPE=$(PLAN_FIELD WIDGET_SCOPE_MODE); NAV_EXPECT=$(PLAN_FIELD expect); NAV_SIZE=$(PLAN_FIELD allowlistSize); NAV_MODE=$(PLAN_FIELD mode)
# "enable": as seis -> seis + header-nav. "update": a navbar JÁ está ativa (sete features, loader mais antigo): o estado ANTERIOR e o restaurado por um rollback também têm as sete, sem páginas de casca ainda.
[ "$NAV_MODE" = update ] && PRE_FLAGS="--features=seven --shell=off" || PRE_FLAGS=""
PREV_LOADER=$(printf '%s' "$PREV_HEALTH" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
mkdir -p .release; TS=$(date +%Y%m%d-%H%M%S); CAP=".release/navbar-capture-$TS.json"; EVID="$ROOT/.release/evidence/navbar-$TS"; mkdir -p "$EVID"; chmod 700 "$EVID"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({captured_at:new Date().toISOString(),previous_version:process.argv[2],health:JSON.parse(process.argv[3]),plan:{scope:process.argv[4],allowlist_paths:Number(process.argv[5])}},null,1),{mode:0o600})' "$CAP" "$PREV_VERSION" "$PREV_HEALTH" "$NAV_SCOPE" "$NAV_SIZE"
log "   modo: $NAV_MODE — versão de rollback: $PREV_VERSION (loader $PREV_LOADER), escopo $NAV_SCOPE, $NAV_SIZE caminho(s) — capturados em $CAP"
smoke_six() { (cd "$ROOT" && node scripts/smoke-global.mjs --expect="$1" --allowlist-size="$NAV_SIZE" $PRE_FLAGS ${2:+--version="$2"}); }
smoke_six "$NAV_EXPECT" >/dev/null || die "smoke no estado atual falhou (nada foi publicado)"
storefront_ok || die "storefront INACESSÍVEL ($(storefront_probe)). Nada foi publicado."

rollback() {
  log ""; log "!!! ROLLBACK ($1) → versão capturada $PREV_VERSION"
  if (cd "$ROOT" && npx wrangler rollback "$PREV_VERSION" --name "$WORKER_NAME" --message "release-navbar rollback: $1" --yes); then
    sleep 8
    if printf '%s' "$PREV_HEALTH" | node -e 'import("./scripts/lib/release-lib.mjs").then((m)=>{let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const now=await (await fetch(process.argv[1])).json();process.exit(m.sameConfig(JSON.parse(s),now)?0:1)})})' "$HEALTH_URL" && smoke_six "$NAV_EXPECT" "$PREV_LOADER" >/dev/null; then
      log "!!! rollback CONFIRMADO: versão capturada, mesmo escopo/allowlist/features, KV intacto. (As rotas da Cloudflare não são versionadas e continuam: o código restaurado só repassa as páginas de casca.)"; return 0; fi
    log "!!! rollback aplicado, mas o health/smoke não conferem com o capturado."
  fi
  log "!!! CRÍTICO: o rollback automático NÃO se confirmou. Ação manual imediata:"
  log "    npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes     (NUNCA publique sem as --var: o TOML é fail-closed e desliga a integração)"; return 1
}
fail() { capture_evidence "$EVID/falha-$(date +%H%M%S)" "$1" || true; rollback "$1"; log ""; log "RELEASE ABORTADO: $1"; log "   evidências: .release/evidence/navbar-$TS/ (fora do Git)"; exit 1; }
smoke_navbar() { (cd "$ROOT" && node scripts/smoke-global.mjs --expect="$NAV_EXPECT" --features=seven --allowlist-size="$NAV_SIZE" --version="$NEW_VERSION") 2>&1 | tee -a "$EVID/smoke-navbar.log"; return "${PIPESTATUS[0]}"; }

log "== B. publicação ($NAV_MODE): mesmo escopo/allowlist, features = as seis + header-nav =="
deploy_worker_navbar "$NAV_ALLOW" "$NAV_SCOPE" || fail "deploy da navbar falhou"
sleep 8
MSG=$(health_ok_navbar "$NAV_EXPECT" "$NAV_SIZE" "$NEW_VERSION" 2>&1) || fail "health após o deploy: $MSG"
NOW_HEALTH=$(health_json) && node -e 'import("./scripts/lib/release-lib.mjs").then((m)=>process.exit(m.sameNavbarConfig(JSON.parse(process.argv[1]),JSON.parse(process.argv[2]),{withNavbar:true})?0:1))' "$PREV_HEALTH" "$NOW_HEALTH" || fail "o health pós-deploy mudou algo além de header-nav (escopo/allowlist/widget_mode)"

log "== C. smoke público =="
smoke_navbar || fail "smoke da navbar: $(grep -h '^FAIL' "$EVID"/smoke-navbar.log | head -3 | tr '\n' ' ')"

log "== D. QA em navegador real (ao vivo) =="
if [ "${RELEASE_SKIP_BROWSER:-}" = "1" ]; then log "   AVISO: QA em navegador PULADO (RELEASE_SKIP_BROWSER=1) — lacuna assumida pelo proprietário"
else
  PW_PATH="$PW_PATH" QA_EVIDENCE_DIR="$EVID/qa" node scripts/qa-navbar-live.mjs 2>&1 | tee "$EVID/qa-output.log"; QA_RC="${PIPESTATUS[0]}"
  [ "$QA_RC" = 0 ] || fail "QA ao vivo da navbar reprovou — $(grep '^FAIL' "$EVID/qa-output.log" | head -2 | cut -c1-160 | tr '\n' ' ')"
fi
MSG=$(health_ok_navbar "$NAV_EXPECT" "$NAV_SIZE" "$NEW_VERSION" 2>&1) || fail "health final: $MSG"

log ""; log "RELEASE CONCLUÍDO: navbar da INK em produção (Worker $NEW_VERSION, escopo $NAV_SCOPE preservado)."
log "   rollback disponível: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --message \"rollback navbar\" --yes"
log "   só a navbar (mantendo o resto): republicar com as seis features (o mesmo escopo e allowlist) — ver docs/navbar-ink-busca.md"
log "   Depois: npx wrangler logout"
exit 0
