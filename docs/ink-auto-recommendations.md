# auto-recommendations — "Você também pode gostar" na PDP (loader 4.9)

Relatório completo da rodada (arquitetura, sinais, score, índice, testes, exemplos, capturas, rollout e rollback): storefront,
`docs/worker/ink-auto-recommendations-round.md` (branch `feature/ink-auto-recommendations`).

Resumo do lado do Worker:

- **Flag** `auto-recommendations` (opt-in; fora de `STORE_FEATURES`, então um release por loja nunca a liga sozinho). Desligada = o módulo nem entra
  no loader: nenhum pedido, nenhum DOM, e `/__origens/recommendations/*` é o 404 da INK.
- **Rota** `GET|HEAD /__origens/recommendations/<id>` (`src/recommendations-gateway.js`): lê `<storefront>/api/recommendations/<região>/<id>` (URL fixa,
  sem cabeçalhos do visitante, 1,5 s, 16 KB), valida item a item (https, host e caminho de produto DESTA loja, sem credenciais/porta/query, imagem no
  host da INK, preço válido, nunca o produto atual) e devolve `{items}` (2–4) ou `{items:[]}` — sempre 200, `x-origens-reco` diz o porquê.
- **Loader** (`src/loader/recommendations.js`): produto atual = `form#form-product-<id>` nativo (nunca o do modal "Compre Junto"); 1 pedido por página;
  desktop em duas colunas: logo abaixo da imagem, no vão da coluna da galeria (`position:absolute; top:100%` dentro de `section.section-product-v2`,
  sem mudar a altura dela; só se couber, senão fluxo); empilhado: logo após `section.buy-together` (mantido), senão após o "Continue explorando",
  senão após o formulário; fora do `<form>`; card inteiro é link
  para a PDP real (mesma aba), sem carrinho; GA4 `origens_recommendation_click` só após o aceite do aviso de cookies da INK.
- **Testes:** `test/recommendations.{unit,workerd,dom}.test.js` (25). **QA real:** `scripts/qa-recommendations.mjs` (INK real → Worker local →
  rota real do storefront local), 253/253 em 2026-10-04.
- **Rollback:** redeploy sem `auto-recommendations` em `WIDGET_FEATURES` (demais features iguais); `ENABLE_WIDGET=false` continua sendo o kill switch.
