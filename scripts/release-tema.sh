#!/usr/bin/env bash
# RELEASE DO TEMA DA COMPRA NA INK (Sul): liga as chaves do tema (theme-pdp, theme-cart; theme-checkout com --add) no Worker use-sul-widget PRESERVANDO o que está em produção.
#
#   bash scripts/release-tema.sh --check     <- SOMENTE LEITURA: tema publicado no storefront, health, rotas da zona x TOML, captura da versão ativa,
#                                               plano e dry-run com as variáveis capturadas.
#   bash scripts/release-tema.sh --deploy    <- ÚNICA forma de publicar. Sem --deploy/--check nada acontece (mostra a ajuda e sai).
#   --add=theme-checkout                     <- liga o tema do checkout (padrão: theme-pdp,theme-cart). Exige as duas rotas do checkout no ar
#                                               (node scripts/checkout-routes.mjs apply + probe) e TEMA_CHECKOUT_UUID=<carrinho de TESTE> para o smoke
#                                               (só GET; o uuid nunca é gravado nem impresso).
#
# Trava dupla: o argumento --deploy E a confirmação do proprietário (digite a frase pedida, ou exporte RELEASE_CONFIRM=PUBLICAR-TEMA-INK). Exige
# `npx wrangler login` FEITO PELO PROPRIETÁRIO na conta esperada. NÃO altera rotas, DNS, KV nem regras: as rotas da zona já estão no estado final
# da loja única e este script só confere que o TOML declara exatamente as mesmas. Nunca faz push/merge, nunca faz compra.
#
# Ordem do --deploy:
#   A. captura: versão ativa (para o rollback) + health + variáveis/bindings REAIS da versão; o plano preserva ENABLE_WIDGET, allowlist, escopo e as
#      features de hoje, e só acrescenta theme-pdp e theme-cart (as demais variáveis do TOML têm de ser iguais às da produção, senão para)
#   B. publica o código desta árvore (a main) com essas variáveis
#   C. health (features = as de antes + as duas do tema; modo, escopo, allowlist, domínio e regiões iguais) + smoke da página de produto (sinal do
#      tema no <body>, <link> do CSS, CSS 200 text/css com as regras, UM loader) + uma página de casca com UM loader
#   Falha em B ou C => `wrangler rollback` para a versão capturada e confirmação de que o health voltou ao que era.
#
# As duas rotas do checkout (scripts/checkout-routes.mjs) vivem na zona, fora do TOML: a conferência de rotas as aceita, e só elas, como extras.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/global-common.sh"
# A loja única mudou de domínio: o health e o smoke são os do host novo (o global-common ainda fala do www.usesul.com.br, que só redireciona).
SITE_URL="${UO_TEST_SITE_URL:-https://loja.useorigens.com.br}"; HEALTH_URL="${UO_TEST_HEALTH_URL:-$SITE_URL/__origens/health}"
SAMPLE_PDP="$SITE_URL/useorigens/product/florianopolis-legado-sc-b88373a3-9f47-418d-a6b4-f27757ac3fa4"
SHELL_PAGE="$SITE_URL/useorigens/products"
PHRASE="PUBLICAR-TEMA-INK"
usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
die() { log "PARADO: $*"; exit 1; }

MODE=""; ADD="theme-pdp,theme-cart"
for arg in "$@"; do case "$arg" in --deploy) MODE=deploy ;; --check) MODE=check ;; --add=*) ADD="${arg#--add=}" ;; -h|--help) usage; exit 0 ;; *) usage; log ""; log "argumento desconhecido: $arg"; exit 2 ;; esac; done
printf '%s' "$ADD" | tr ',' '\n' | grep -qvxE 'theme-pdp|theme-cart|theme-checkout' && { log "--add aceita só theme-pdp, theme-cart e theme-checkout (recebido: $ADD)"; exit 2; }
WITH_CHECKOUT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx theme-checkout && WITH_CHECKOUT=1
CHECKOUT_UUID="${TEMA_CHECKOUT_UUID:-}"
[ -z "$CHECKOUT_UUID" ] || [[ "$CHECKOUT_UUID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { log "TEMA_CHECKOUT_UUID fora do formato de uuid"; exit 2; }
[ -n "$MODE" ] || { usage; log ""; log "Nada foi feito (falta --check ou --deploy)."; exit 2; }
cd "$ROOT" || exit 1
LIB="$ROOT/scripts/lib/theme-release-lib.mjs"
FAILS=(); WARNS=()
ok()   { log "  OK    $*"; }
warn() { WARNS+=("$*"); log "  WARN  $*"; }
bad()  { FAILS+=("$*"); log "  FAIL  $*"; }
json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];console.log(Array.isArray(v)?v.join(","):v)})' "$1"; }

# O tema publicado no storefront: sem ele (ou desligado no painel) o Worker liga as chaves e nada aparece.
storefront_theme() {
  local api; api=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/ink-theme/sul" 2>/dev/null)
  local out; out=$(printf '%s' "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.v!==1||j.region!=="sul"||!j.surfaces)process.exit(1);const on=Object.entries(j.surfaces).filter(([,v])=>v===true).map(([k])=>k);console.log((on.join(",")||"nenhuma")+" | paleta "+(j.palette||"neutra"));process.exit(j.surfaces.pdp&&j.surfaces.cart?0:3)}catch(e){process.exit(1)}})'); local rc=$?
  case $rc in 0) ok "storefront: tema da INK publicado (ligado: $out)" ;; 3) warn "storefront: tema publicado, mas página de produto e/ou carrinho DESLIGADOS no painel ($out): o Worker liga as chaves e essas partes seguem nativas" ;; *) bad "storefront: /api/ink-theme/sul indisponível ou fora do contrato v1" ;; esac
}

# Rotas COM o Worker na zona == as do TOML (o deploy publica as do TOML; uma divergência mudaria o roteamento junto com o tema).
routes_match() {
  local live; live=$(node scripts/domain-move-routes.mjs plan 2>/dev/null) || { bad "rotas da zona ilegíveis (domain-move-routes.mjs plan)"; return; }
  if LIVE="$live" WITH_CHECKOUT="$WITH_CHECKOUT" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import(process.argv[1]).then((m) => {
      const checkout = m.checkoutRoutes("loja.useorigens.com.br", "/useorigens");
      const all = m.parseLiveRoutes(process.env.LIVE); const extras = all.filter((p) => checkout.includes(p));
      const toml = m.parseTomlRoutes(readFileSync(process.argv[2], "utf8")).sort(); const live = all.filter((p) => !checkout.includes(p)).sort();
      if (JSON.stringify(toml) !== JSON.stringify(live)) { console.error("TOML [" + toml.join(" ") + "] x zona [" + live.join(" ") + "]"); process.exit(1); }
      if (process.env.WITH_CHECKOUT === "1" && extras.length !== checkout.length) { console.error("theme-checkout pede as duas rotas do checkout na zona (há " + extras.length + "): node scripts/checkout-routes.mjs apply e probe"); process.exit(1); }
      console.log(toml.length + (extras.length ? " + " + extras.length + " do checkout (zona)" : ""));
    });' "$LIB" "$CFG" >/tmp/tema-routes.$$ 2>&1; then ok "rotas: $(cat /tmp/tema-routes.$$) rotas COM Worker na zona = as do TOML (+ só as duas do checkout, se houver; o deploy não muda o roteamento)"; else bad "rotas da zona divergem do TOML: $(cat /tmp/tema-routes.$$)"; fi
  rm -f /tmp/tema-routes.$$
}

# Plano a partir da versão ativa: imprime o JSON do deploy ou os problemas (exit 1).
capture_plan() {
  local version="$1" health="$2" view
  view=$(cd "$ROOT" && $WRANGLER_CMD versions view "$version" --name "$WORKER_NAME" --json 2>/dev/null) || { log "não consegui ler a versão ativa ($version) com o Wrangler"; return 1; }
  T_VIEW="$view" T_HEALTH="$health" T_ADD="$ADD" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const rl = await import(process.argv[1] + "/scripts/lib/release-lib.mjs"); const m = await import(process.argv[1] + "/scripts/lib/theme-release-lib.mjs");
    const toml = readFileSync(process.argv[1] + "/" + process.argv[2], "utf8");
    const bindings = [...toml.matchAll(/^binding = "([A-Za-z0-9_]+)"/gm)].map((x) => x[1]);
    let health = null; try { health = JSON.parse(process.env.T_HEALTH); } catch (_) {}
    const plan = m.planThemeRelease({ health, captured: rl.parseVersionBindings(process.env.T_VIEW), tomlBindings: bindings, tomlVars: m.parseTomlVars(toml), add: process.env.T_ADD.split(",") });
    if (!plan.ok) { console.error(plan.problems.join("\n")); process.exit(1); }
    console.log(JSON.stringify(plan.deploy));' "$ROOT" "$CFG"
}

deploy_theme() {
  local plan="$1" mode="${2:-}" allow feats scope
  allow=$(printf '%s' "$plan" | json_field WIDGET_ALLOWLIST); feats=$(printf '%s' "$plan" | json_field WIDGET_FEATURES); scope=$(printf '%s' "$plan" | json_field WIDGET_SCOPE_MODE)
  log "── deploy do tema (${mode:-REAL}) — configuração não secreta ──"
  log "   ENABLE_WIDGET=true · WIDGET_SCOPE_MODE=$scope · WIDGET_ALLOWLIST=$(printf '%s\n' "$allow" | tr ',' '\n' | grep -c .) caminho(s) (preservados)"
  log "   WIDGET_FEATURES=$feats"
  if [ "$mode" = "--dry-run" ]; then
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --dry-run --outdir "${TMPDIR:-/tmp}/release-tema-dry" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$allow" --var "WIDGET_FEATURES:$feats" --var "WIDGET_SCOPE_MODE:$scope")
  else
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --message "release-tema: $ADD (git $(git rev-parse --short HEAD))" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$allow" --var "WIDGET_FEATURES:$feats" --var "WIDGET_SCOPE_MODE:$scope")
  fi
}

# Smoke da página de produto com o tema (tenta algumas vezes: a configuração do tema é lida do storefront com cache de 60 s).
smoke_theme() {
  local i html css_path code type body res
  for i in 1 2 3 4 5 6; do
    html=$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null)
    res=$(printf '%s' "$html" | node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);const r=m.evaluateThemePage(s);console.log(JSON.stringify(r))})' "$LIB")
    css_path=$(printf '%s' "$res" | json_field cssPath)
    if [ "$css_path" != "null" ] && [ -n "$css_path" ]; then
      code=$(curl -sS -o /tmp/tema-css.$$ --max-time 20 -w '%{http_code} %{content_type}' "$SITE_URL$css_path" 2>/dev/null); type=${code#* }; code=${code%% *}
      res=$(printf '%s' "$html" | T_CSS_STATUS="$code" T_CSS_TYPE="$type" node --input-type=module -e 'import { readFileSync } from "node:fs";let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);const r=m.evaluateThemePage(s,{status:Number(process.env.T_CSS_STATUS),type:process.env.T_CSS_TYPE,body:readFileSync(process.argv[2],"utf8")});console.log(JSON.stringify(r))})' "$LIB" /tmp/tema-css.$$)
      rm -f /tmp/tema-css.$$
    fi
    if [ "$(printf '%s' "$res" | json_field ok)" = "true" ]; then ok "produto: tema no <body>, CSS do tema 200 ($css_path), UM loader"; break; fi
    [ "$i" = 6 ] && { bad "produto: $(printf '%s' "$res" | json_field problems)"; return 1; }
    sleep 10
  done
  if [ "$WITH_CHECKOUT" = 1 ]; then
    local step page r
    for step in contact_and_shipping_details payment_methods; do
      for i in 1 2 3 4 5 6; do
        page=$(curl -sS --max-time 20 "$SITE_URL/useorigens/checkout/$step/$CHECKOUT_UUID" 2>/dev/null)
        r=$(printf '%s' "$page" | node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);console.log(JSON.stringify(m.evaluateCheckoutPage(s)))})' "$LIB")
        [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "checkout ($step): tema no <body>, CSS do checkout, nenhum loader"; break; }
        [ "$i" = 6 ] && { bad "checkout ($step): $(printf '%s' "$r" | json_field problems)"; return 1; }
        sleep 10
      done
    done
  fi
  local n; n=$(curl -sS --max-time 20 "$SHELL_PAGE" 2>/dev/null | grep -o '/__origens/loader\.js?v=' | wc -l | tr -d ' ')
  [ "$n" = 1 ] && ok "casca ($SHELL_PAGE): UM loader" || { bad "casca: $n loader(s) (esperado 1)"; return 1; }
}

log "== pré-condições =="
storefront_theme
HEALTH_NOW=$(health_json 2>/dev/null) || HEALTH_NOW=""
[ -n "$HEALTH_NOW" ] && ok "health ($HEALTH_URL): $(printf '%s' "$HEALTH_NOW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log("loader "+h.version+", "+h.ink_host+", escopo "+h.scope_mode+", "+(h.widget_features||[]).length+" features")})')" || bad "health ilegível em $HEALTH_URL"
git diff --quiet HEAD -- "$CFG" 2>/dev/null && ok "$CFG sem alterações locais" || bad "$CFG modificado localmente"
git rev-parse --verify -q origin/main >/dev/null && { git diff --quiet origin/main -- src "$CFG" && ok "código e TOML idênticos aos da main" || warn "src/ ou $CFG diferem de origin/main: o deploy publica ESTA árvore"; }
routes_match
WHO=$(npx wrangler whoami 2>&1)
if echo "$WHO" | grep -qi 'logged in' && echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL"; then ok "wrangler autenticado como $EXPECTED_ACCOUNT_EMAIL"; else bad "wrangler não autenticado na conta $EXPECTED_ACCOUNT_EMAIL (o proprietário roda: npx wrangler login)"; fi

PREV_VERSION=""; PLAN=""
if [ ${#FAILS[@]} -eq 0 ]; then
  PREV_VERSION=$(active_version) || bad "versão ativa não capturável (necessária para o rollback)"
  if [ -n "$PREV_VERSION" ]; then
    if PLAN=$(capture_plan "$PREV_VERSION" "$HEALTH_NOW" 2>&1); then ok "versão ativa ${PREV_VERSION:0:8}… capturada; acrescenta $(printf '%s' "$PLAN" | json_field added) às $(printf '%s' "$PLAN" | json_field before | tr ',' '\n' | wc -l | tr -d ' ') features de hoje"; else bad "plano: $(printf '%s' "$PLAN" | tr '\n' ';')"; PLAN=""; fi
  fi
fi

if [ "$MODE" = check ]; then
  if [ -n "$PLAN" ]; then DRY=$(deploy_theme "$PLAN" --dry-run 2>&1); [ $? -eq 0 ] && echo "$DRY" | grep -q 'CART_REFS' && ok "dry-run do bundle: $(echo "$DRY" | grep -o 'Total Upload: [^/]*/ gzip: [0-9.]* KiB')" || bad "dry-run falhou: $(echo "$DRY" | tail -3 | tr '\n' ' ')"; fi
  log ""; if [ ${#FAILS[@]} -eq 0 ]; then log "READY (${#WARNS[@]} pendência(s) acima). Nada foi publicado."; exit 0; else log "BLOCKED: $(IFS='; '; echo "${FAILS[*]}")"; exit 1; fi
fi

[ ${#FAILS[@]} -eq 0 ] || die "pré-condições reprovadas: $(IFS='; '; echo "${FAILS[*]}")"
[ "$WITH_CHECKOUT" = 0 ] || [ -n "$CHECKOUT_UUID" ] || die "theme-checkout pede TEMA_CHECKOUT_UUID=<uuid de um carrinho de TESTE> para conferir as duas telas (só GET)"
if [ "${RELEASE_CONFIRM:-}" != "$PHRASE" ]; then
  [ -t 0 ] || die "sem terminal interativo e sem RELEASE_CONFIRM=$PHRASE"
  read -r -p "Vai ligar o tema da compra ($ADD) no Worker da Sul em produção. Digite $PHRASE para continuar: " ANS; [ "$ANS" = "$PHRASE" ] || die "confirmação não digitada"
fi

log "== A. captura =="
PREV_HEALTH="$HEALTH_NOW"
mkdir -p .release; TS=$(date +%Y%m%d-%H%M%S); CAP=".release/tema-capture-$TS.json"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({captured_at:new Date().toISOString(),previous_version:process.argv[2],health:JSON.parse(process.argv[3])},null,1),{mode:0o600})' "$CAP" "$PREV_VERSION" "$PREV_HEALTH"
log "   versão de rollback: $PREV_VERSION — captura em $CAP"

rollback() {
  log ""; log "!!! ROLLBACK ($1) → versão capturada $PREV_VERSION"
  if npx wrangler rollback "$PREV_VERSION" --name "$WORKER_NAME" --message "release-tema rollback: $1" --yes; then
    sleep 10
    if NOW=$(health_json) && node -e 'import(process.argv[1]).then((m)=>{const a=JSON.parse(process.argv[2]),b=JSON.parse(process.argv[3]);process.exit(m.sameConfig(a,b)&&a.ink_host===b.ink_host?0:1)})' "$ROOT/scripts/lib/release-lib.mjs" "$PREV_HEALTH" "$NOW"; then
      log "!!! rollback CONFIRMADO: o health voltou exatamente ao capturado."; return 0; fi
    log "!!! rollback aplicado, mas o health não confere com o capturado."
  fi
  log "!!! CRÍTICO: confira à mão: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes   (NUNCA publique sem as --var: o TOML é fail-closed)"; return 1
}
fail() { rollback "$1"; log ""; log "RELEASE ABORTADO: $1"; exit 1; }

log "== B. publicação =="
deploy_theme "$PLAN" || fail "deploy falhou"
sleep 10

log "== C. conferência =="
NOW_HEALTH=$(health_json) || fail "health ilegível após o deploy"
node -e 'import(process.argv[1]).then((m)=>process.exit(m.sameThemeConfig(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),process.argv[4].split(","))?0:1))' "$LIB" "$PREV_HEALTH" "$NOW_HEALTH" "$ADD" && ok "health: features = as de antes + $ADD; modo, escopo, allowlist, domínio e regiões iguais" || fail "o health pós-deploy não é o planejado: $(printf '%s' "$NOW_HEALTH" | head -c 400)"
smoke_theme || fail "smoke do tema reprovado"

log ""
log "RELEASE DO TEMA CONCLUÍDO: $ADD ligado(s) (versão anterior, para voltar: $PREV_VERSION)."
log "   Voltar a qualquer momento: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes"
log "   Ou desligar só a aparência, sem deploy: painel › Tema da INK › desmarcar e Publicar (as chaves do Worker são o teto; o painel decide)."
