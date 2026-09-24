#!/usr/bin/env bash
# Rollout em cadeia do cart-discovery SOMENTE em /usesul/product/serra-catarinense, com rollback automático.
#   Pré-requisitos: `npx wrangler login` feito pelo proprietário; playwright-core em $PW_PATH (npm i --prefix /tmp/pw playwright-core).
#   Uso: bash scripts/rollout-cart.sh
# cart-mirror e checkout-bridge NÃO são ligados aqui (o espelho exige o KV CART_REFS e o consumidor no storefront).
# NUNCA usar `wrangler deploy -c wrangler.production.toml` puro como atualização normal: isso desliga o piloto (só no rollback final).
set -uo pipefail
cd "$(dirname "$0")/.."
export PW_PATH="${PW_PATH:-/tmp/pw}"
CFG=wrangler.production.toml
ALLOW=/usesul/product/serra-catarinense
HEALTH=https://www.usesul.com.br/__origens/health
BASELINE_FEATURES="return-link,post-add-discovery,city-search"                  # produção atual (drawer pós-adição + busca)
STAGE1_FEATURES="$BASELINE_FEATURES"                                              # código novo, módulo do carrinho DESLIGADO
STAGE2_FEATURES="return-link,post-add-discovery,city-search,cart-discovery"       # + descoberta no drawer do carrinho

deploy() { npx wrangler deploy -c "$CFG" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$ALLOW" --var "WIDGET_FEATURES:$1"; }
health_ok() { sleep 6; local h; h=$(curl -sS "$HEALTH") && echo "health: $h" && echo "$h" | grep -q '"widget_mode":"true"' && echo "$h" | grep -q '"allowlist_size":1' && echo "$h" | grep -q "\"widget_features\":\[$(printf '"%s"' "${1//,/\",\"}")\]"; }

rollback() {
  echo "!!! ROLLBACK: $1"
  if deploy "$BASELINE_FEATURES" && health_ok "$BASELINE_FEATURES"; then echo "rollback OK: cart-discovery desligado; drawer pós-adição, busca e link mantidos"; return 0; fi
  echo "!!! rollback 1 falhou; voltando para a versão anterior publicada"
  if npx wrangler rollback --name use-sul-widget -m "rollback cart-discovery" && sleep 6 && curl -sS "$HEALTH"; then echo; return 0; fi
  echo "!!! rollback 2 falhou; desligando o widget (deploy puro: ENABLE_WIDGET=false, allowlist vazia)"
  npx wrangler deploy -c "$CFG"; sleep 6; curl -sS "$HEALTH"; echo
  return 1
}

echo "== antes: $(curl -sS "$HEALTH")"
echo "== ESTÁGIO 1: código novo, cart-discovery DESLIGADO ($STAGE1_FEATURES)"
deploy "$STAGE1_FEATURES" || { echo "deploy do estágio 1 falhou"; exit 1; }
health_ok "$STAGE1_FEATURES" || { rollback "health do estágio 1"; exit 1; }
node scripts/rollout-smoke.mjs on || { rollback "smoke do estágio 1"; exit 1; }

echo "== ESTÁGIO 2: cart-discovery ($STAGE2_FEATURES)"
deploy "$STAGE2_FEATURES" || { rollback "deploy do estágio 2"; exit 1; }
health_ok "$STAGE2_FEATURES" || { rollback "health do estágio 2"; exit 1; }
node scripts/rollout-smoke.mjs on || { rollback "smoke do estágio 2"; exit 1; }
# Matriz completa em produção: 6 viewports x (vazio + 1 item + fluxos | 2 itens | 3 itens | 8 variantes)
for w in 1440 1280 768 440 390 320; do
  if [ "$w" = 1280 ]; then A=(desktop); elif [ "$w" = 390 ]; then A=(mobile); else A=(mobile --width "$w"); fi
  echo "== QA live viewport $w: carrinho vazio + 1 item + fluxos"
  node scripts/qa-cart.mjs "${A[@]}" --live --tag after || { rollback "QA live do carrinho (vazio/1 item) em $w"; exit 1; }
  for n in 2 3 8; do
    echo "== QA live viewport $w: $n itens (variantes diferentes)"
    node scripts/qa-cart-many.mjs "${A[@]}" --items "$n" --live || { rollback "QA live com $n itens em $w"; exit 1; }
  done
done
node scripts/qa-drawer.mjs desktop --live --tag after || { rollback "regressão do drawer pós-adição (desktop)"; exit 1; }
node scripts/qa-drawer.mjs mobile --live --tag after || { rollback "regressão do drawer pós-adição (mobile)"; exit 1; }
echo "== OK: cart-discovery ativo SOMENTE em $ALLOW"; curl -sS "$HEALTH"; echo
