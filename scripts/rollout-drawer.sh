#!/usr/bin/env bash
# Rollout em cadeia do drawer + busca SOMENTE em /usesul/product/serra-catarinense, com rollback automático.
#   Pré-requisitos: `npx wrangler login` feito pelo proprietário; playwright-core em $PW_PATH (npm i --prefix /tmp/pw playwright-core).
#   Uso: bash scripts/rollout-drawer.sh
# NUNCA usar `wrangler deploy -c wrangler.production.toml` puro como atualização normal: isso desliga o piloto (só no rollback final).
set -uo pipefail
cd "$(dirname "$0")/.."
export PW_PATH="${PW_PATH:-/tmp/pw}"
CFG=wrangler.production.toml
ALLOW=/usesul/product/serra-catarinense
HEALTH=https://www.usesul.com.br/__origens/health
STAGE1_FEATURES="return-link"                                   # módulo novo DESLIGADO (estado do piloto)
STAGE2_FEATURES="return-link,post-add-discovery,city-search"     # drawer + busca

deploy() { npx wrangler deploy -c "$CFG" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$ALLOW" --var "WIDGET_FEATURES:$1"; }
health_ok() { sleep 6; local h; h=$(curl -sS "$HEALTH") && echo "health: $h" && echo "$h" | grep -q '"widget_mode":"true"' && echo "$h" | grep -q '"allowlist_size":1' && echo "$h" | grep -q "\"widget_features\":\[$(printf '"%s"' "${1//,/\",\"}")\]"; }

rollback() {
  echo "!!! ROLLBACK: $1"
  if deploy "$STAGE1_FEATURES" && health_ok "$STAGE1_FEATURES"; then echo "rollback OK: módulo novo desligado, piloto (return-link) mantido"; return 0; fi
  echo "!!! rollback 1 falhou; voltando para a versão anterior publicada"
  if npx wrangler rollback --name use-sul-widget -m "rollback drawer" && sleep 6 && curl -sS "$HEALTH"; then echo; return 0; fi
  echo "!!! rollback 2 falhou; desligando o widget (deploy puro: ENABLE_WIDGET=false, allowlist vazia)"
  npx wrangler deploy -c "$CFG"; sleep 6; curl -sS "$HEALTH"; echo
  return 1
}

echo "== antes: $(curl -sS "$HEALTH")"
echo "== ESTÁGIO 1: código novo, módulo novo DESLIGADO ($STAGE1_FEATURES)"
deploy "$STAGE1_FEATURES" || { echo "deploy do estágio 1 falhou"; exit 1; }
health_ok "$STAGE1_FEATURES" || { rollback "health do estágio 1"; exit 1; }
node scripts/rollout-smoke.mjs on || { rollback "smoke do estágio 1"; exit 1; }

echo "== ESTÁGIO 2: drawer + busca ($STAGE2_FEATURES)"
deploy "$STAGE2_FEATURES" || { rollback "deploy do estágio 2"; exit 1; }
health_ok "$STAGE2_FEATURES" || { rollback "health do estágio 2"; exit 1; }
node scripts/rollout-smoke.mjs on || { rollback "smoke do estágio 2"; exit 1; }
node scripts/qa-drawer.mjs desktop --live --tag after || { rollback "QA live desktop"; exit 1; }
node scripts/qa-drawer.mjs mobile --live --tag after || { rollback "QA live mobile"; exit 1; }
echo "== OK: drawer + busca ativos SOMENTE em $ALLOW"; curl -sS "$HEALTH"; echo
