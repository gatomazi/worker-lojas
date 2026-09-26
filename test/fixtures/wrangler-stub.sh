#!/usr/bin/env bash
# Stub do Wrangler para testes HERMÉTICOS (UO_TEST_MODE=1): imprime o conteúdo de $STUB_VERSION_JSON para `versions view`, ou falha se ausente.
if [ "$1" = "versions" ] && [ "$2" = "view" ]; then [ -n "${STUB_VERSION_JSON:-}" ] && printf '%s' "$STUB_VERSION_JSON" && exit 0; exit 1; fi
echo "wrangler-stub: comando não previsto: $*" >&2; exit 3
