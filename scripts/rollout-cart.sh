#!/usr/bin/env bash
# DEPRECATED — NÃO USE.
# Este script (rollout do cart-discovery) publicava com listas de features e allowlist fixas e antigas e o seu rollback restaurava um
# estado anterior ao cart-mirror: rodá-lo hoje DESLIGARIA o espelho e o Product Discovery. Foi substituído por:
#   scripts/preflight-global.sh   (somente leitura)  e  scripts/release-global.sh --deploy   (publicação controlada, com rollback automático)
# O histórico do script está no Git. Nenhum deploy é feito aqui.
echo "scripts/rollout-cart.sh está DEPRECATED e bloqueado. Use scripts/preflight-global.sh e scripts/release-global.sh --deploy (docs/expansao-global-ready.md)." >&2
exit 2
