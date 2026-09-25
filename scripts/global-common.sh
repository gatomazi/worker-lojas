#!/usr/bin/env bash
# Funções e constantes COMPARTILHADAS por preflight-global.sh e release-global.sh. Este é o ÚNICO lugar com `wrangler deploy`:
# todo deploy passa por deploy_worker, que imprime a configuração NÃO secreta, valida os argumentos completos (seis features, cinco
# caminhos, escopo explícito) e nunca roda sem `--var` (o TOML é fail-closed: um deploy puro desligaria a integração inteira).
# Não faz nada sozinho; só é lido com `source`.
WORKER_NAME=use-sul-widget
CFG=wrangler.production.toml
HEALTH_URL=https://www.usesul.com.br/__origens/health
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FEATURES="return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery"
ALLOW="/usesul/product/serra-catarinense,/usesul/product/made-in-rio-grande-do-sul-8834d3a7-4ed3-49a3-8258-d2ba71fa8241,/usesul/product/made-in-santa-catarina-60ba13f6-62cf-4309-9d03-490ab9193829,/usesul/product/paranaense-essencia,/usesul/product/made-in-parana-cda5fe30-bb4e-4e2e-b416-01e3ec45649a"
STOREFRONT_URL=https://useorigens.com.br
EXPECTED_ACCOUNT_EMAIL="${EXPECTED_ACCOUNT_EMAIL:-tomazi.brand@gmail.com}"

log() { printf '%s\n' "$*"; }
health_json() { curl -sS --max-time 15 "$HEALTH_URL"; }

# Confere que os argumentos do deploy estão completos ANTES de qualquer publicação. Uso: assert_deploy_vars <scope>
assert_deploy_vars() {
  local scope="$1" n
  [ "$scope" = "allowlist" ] || [ "$scope" = "product-catalog" ] || { log "ERRO: escopo inválido '$scope'"; return 1; }
  n=$(printf '%s' "$FEATURES" | tr ',' '\n' | grep -c .); [ "$n" = 6 ] || { log "ERRO: WIDGET_FEATURES precisa ter as SEIS features (tem $n)"; return 1; }
  printf '%s' "$FEATURES" | tr ',' '\n' | grep -qx 'cart-mirror' || { log "ERRO: cart-mirror ausente de WIDGET_FEATURES"; return 1; }
  n=$(printf '%s' "$ALLOW" | tr ',' '\n' | grep -c '^/usesul/product/[a-z0-9][a-z0-9_-]*$'); [ "$n" = 5 ] || { log "ERRO: WIDGET_ALLOWLIST precisa ter EXATAMENTE 5 caminhos válidos (tem $n)"; return 1; }
  grep -q 'binding = "CART_REFS"' "$ROOT/$CFG" || { log "ERRO: binding CART_REFS ausente de $CFG"; return 1; }
}

# Publica com o conjunto COMPLETO de variáveis. Uso: deploy_worker <allowlist|product-catalog> [--dry-run]
deploy_worker() {
  local scope="$1" mode="${2:-}"
  assert_deploy_vars "$scope" || return 1
  log "── deploy (${mode:-REAL}) — configuração não secreta ──"
  log "   ENABLE_WIDGET=true"
  log "   WIDGET_SCOPE_MODE=$scope"
  log "   WIDGET_FEATURES=$FEATURES"
  log "   WIDGET_ALLOWLIST=$(printf '%s' "$ALLOW" | tr ',' '\n' | wc -l | tr -d ' ') caminhos exatos (Serra + 4)"
  log "   binding CART_REFS: $(grep -A2 'binding = "CART_REFS"' "$ROOT/$CFG" | grep '^id' | sed -E 's/id = "(.{8}).*/id = \1…/')"
  if [ "$mode" = "--dry-run" ]; then
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --dry-run --outdir "${TMPDIR:-/tmp}/release-global-dry" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$ALLOW" --var "WIDGET_FEATURES:$FEATURES" --var "WIDGET_SCOPE_MODE:$scope")
  else
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$ALLOW" --var "WIDGET_FEATURES:$FEATURES" --var "WIDGET_SCOPE_MODE:$scope")
  fi
}

# Versão ativa (100%) do Worker; vazio se não autenticado / não determinável.
active_version() {
  local out
  out=$(cd "$ROOT" && npx wrangler deployments list --name "$WORKER_NAME" --json 2>/dev/null) && [ -n "$out" ] || out=$(cd "$ROOT" && npx wrangler deployments list --name "$WORKER_NAME" 2>/dev/null) || return 1
  printf '%s' "$out" | node -e 'import("'"$ROOT"'/scripts/lib/release-lib.mjs").then((m)=>{let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const v=m.parseActiveVersion(s);if(!v)process.exit(1);console.log(v)})})'
}

# Avalia o health público contra o estado esperado. Uso: health_ok <allowlist|catalog> [versão]
health_ok() {
  health_json | node -e 'import("'"$ROOT"'/scripts/lib/release-lib.mjs").then((m)=>{let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{let h=null;try{h=JSON.parse(s)}catch(e){}const r=m.evaluateHealth(h,process.argv[1],{loaderVersion:process.argv[2]||null});if(!r.ok){console.log(r.problems.join("; "));process.exit(1)}})})' "$1" "${2:-}"
}
smoke() { (cd "$ROOT" && node scripts/smoke-global.mjs --expect="$1" ${2:+--version="$2"}); }

# ── storefront e evidência (usados pelo preflight e pelo release; nada aqui publica) ──────────────────────────────────────────────────────
# O storefront precisa estar ALCANÇÁVEL para o QA validar a ida e volta (INK → storefront → INK). Erro de rede/TLS ali (Chrome mostra
# chrome-error://chromewebdata/) não é falha do Worker: é pré-condição e deve parar o release ANTES de qualquer deploy.
storefront_ok() { [ "$(curl -sS -o /dev/null --max-time 12 -w '%{http_code}' "$STOREFRONT_URL/api/ready" 2>/dev/null)" = "200" ]; }
storefront_probe() { curl -sS -o /dev/null --max-time 12 -w 'http=%{http_code} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s' "$STOREFRONT_URL/api/ready" 2>&1 | tr '\n' ' '; }

# Roda um comando com limite de tempo (o macOS não tem `timeout`). Uso: run_limited <segundos> <cmd...>
run_limited() { local secs="$1"; shift; "$@" & local pid=$!; ( sleep "$secs"; kill "$pid" 2>/dev/null ) >/dev/null 2>&1 & local killer=$!; wait "$pid" 2>/dev/null; local rc=$?; kill "$killer" 2>/dev/null; return $rc; }

# Grava a evidência de uma falha ANTES do rollback (nunca o impede: tudo com limite de tempo e `|| true`). Uso: capture_evidence <dir> <motivo exato>
capture_evidence() {
  local dir="$1" reason="$2"; mkdir -p "$dir" 2>/dev/null || return 0
  { echo "quando: $(date -u +%FT%TZ)"; echo "motivo exato do gate: $reason"; echo "git: $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null)"; } > "$dir/reason.txt" 2>/dev/null
  health_json > "$dir/health.json" 2>&1 || true
  { echo "storefront: $(storefront_probe)"; echo "produto da allowlist: $(curl -sS -o /dev/null --max-time 12 -w 'http=%{http_code} total=%{time_total}s' "https://www.usesul.com.br/usesul/product/serra-catarinense" 2>&1)"; echo "busca: $(curl -sS -o /dev/null --max-time 12 -w 'http=%{http_code}' "https://www.usesul.com.br/__origens/search?q=floria" 2>&1)"; } > "$dir/http-probes.txt" 2>&1 || true
  run_limited 25 bash -c "cd '$ROOT' && npx wrangler deployments list --name '$WORKER_NAME' 2>&1 | tail -30" > "$dir/deployments.txt" 2>&1 || true
  chmod -R go-rwx "$dir" 2>/dev/null || true
  log "   evidência salva em ${dir#$ROOT/}"
  return 0
}
