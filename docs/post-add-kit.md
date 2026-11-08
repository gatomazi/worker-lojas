# post-add-kit: "Monte seu kit" no modal pós-adição

Feature opt-in `post-add-kit`. No modal **"Produto adicionado ao carrinho"** da INK (página de produto), o bloco da promoção progressiva da INK escolhida
no CMS do storefront (Marketing › Monte seu kit; `docs/storefront/kit-pos-adicao.md` no useorigens):

- a chamada (do CMS);
- **onde o cliente está**, em tamanho de título: "Você já ganhou R$ 25 OFF" + "Mais **1 peça** e o desconto sobe para **R$ 50 OFF**." (ou "Falta 1
  peça para R$ 25 OFF", ou "É o maior desconto do kit."). Numa promoção com cupom, "Seu kit já vale R$ 25 OFF". Sem como saber, o título e o texto do CMS;
- uma **trilha de passos**, um por faixa (até 6): o desconto ("−R$ 25") e as peças ("3 peças"). Alcançado = barra e número na cor da marca, o próximo
  marcado, os demais apagados;
- "Cupom BLACKMONTH" + o botão **Copiar cupom** (com borda e ícone; "Copiado" por 2 s), ou "✓ Desconto automático, sem cupom" quando a INK aplica sozinha.

Até 08/11/2026 eram cartões por faixa com de/por/cada/economize (16 preços com 4 faixas), a maior faixa em destaque e nenhum "você está aqui"; a
crítica de 08/11 (com o dono) trocou pela frase + trilha.

Abaixo do kit fica **um botão só**, na largura toda: "Ver carrinho" → **"Finalizar compra"** (o mesmo botão da INK, só o texto do rótulo muda, sem
caixa alta e com o ícone colado ao texto; o clique abre o carrinho, onde o cliente cola o cupom). O "Continuar comprando" nativo fica **escondido**
enquanto há kit (decisão do dono em 27/10/2026: a busca logo abaixo já leva a outras estampas; o × e o clique fora continuam fechando o modal). O
modal, enquanto há kit, vira **topo fixo + meio que rola + pé fixo** (celular e desktop): "Produto adicionado ao carrinho" e o × presos no alto,
"Finalizar compra" preso embaixo (levado ao fim do conteúdo só na exibição, com `order`, num corpo em coluna; nada é movido no DOM) e o kit, a busca e
"As mais vendidas" rolando no meio. No celular a folha da INK **cresce com o conteúdo** (sem altura máxima, presa ao pé da tela): com o kit ela passava
da tela e o topo com o × sumia para cima, sem como fechar (visto ao vivo em 28/10/2026, logo depois do primeiro deploy). Por isso, no celular, a folha
vai no máximo até a altura da tela (`100dvh`, sem folga: a folga mostrava a faixa preta do topo da INK) e rola por dentro, com os cantos de cima retos. O conteúdo é alinhado pelo topo (`align-items:flex-start`): a folha da INK é flex em linha com
`items-center`, e com o conteúdo mais alto que ela o centro empurrava metade da sobra para cima, fora do alcance da rolagem (o começo do kit sumia sob
o topo fixo, visto num iPhone de verdade em 28/10/2026). Ao fechar o
modal ou sair da página, o bloco sai, o rótulo volta e o "Continuar comprando" reaparece.

## Dados

`GET /__origens/kit` (`src/kit-gateway.js`) → storefront `GET /api/post-add-kit/<região>` (`kitApi` em `src/stores.js`; na loja única, a região do
visitante). Mesmo desenho de `promotions-gateway.js`: origem fixa, sem Cookie/Authorization, 3 s, 8 KB, esquema estrito, cache de 60 s; falha = 503 e
nada monta. Contrato v1:

```json
{ "v": 1, "kit": null }
{ "v": 1, "kit": { "id": 73095, "code": "LEVEMAIS", "auto": false, "kind": "value", "tiers": [{ "items": 3, "discount": 25 }], "endsAt": "…", "eyebrow": "…", "title": "…", "lead": "…" } }
```

Faixas: 1 a 6, de 2 a 999 peças, crescentes; desconto > 0 (e < 100 quando `percentage`). Textos de uma linha, sem `<`/`>`, até 40/60/160.

## Onde o cliente está

1. **A barra da própria INK** no carrinho (`[data-ink-labs-progressive-discount]`, web component com shadow root aberto, presente em toda página com a
   gaveta): "R$ 25,00 OFF aplicado · adicione 1 peça e sobe para R$ 50,00 OFF" ou "Adicione 1 peça e ganhe R$ 25,00 OFF". Ela já aplica a
   elegibilidade da promoção (canecas e placas podem não contar). Só vale se os valores batem com as faixas do kit (promoção em R$).
2. Sem a barra, ou com números que não batem: as peças do carrinho (`#quantity-header[data-quantityheader]`).
3. Sem nenhum dos dois: o título e o texto do CMS, a trilha sem destaque (`data-state="unknown"` no bloco).

A resposta da adição pode chegar depois do modal, e a barra da INK desenha depois: a frase e a trilha são refeitas a cada `turbo:*` e de novo 0,6 s e
1,5 s depois de montar. Nada de preço por peça: **quem aplica é o carrinho da INK**; isto é só o que o modal mostra.

## Medição

GA4 da própria INK, só com cookies aceitos (a regra de `tracking.js`): `kit_view`, `kit_coupon_copy`, `kit_checkout_click`, com
`region`, `surface=ink`, `promo_id`, `tiers`. Nunca o código nem preços.

## Testes

- `test/post-add-kit.dom.test.js` (7): posição, trilha sem estado, rótulo (com o ícone) e "Continuar comprando" escondido, copiar, estado pela barra
  da INK (antes da 1ª faixa, no meio, na última), estado pela contagem (barra que não bate, promoção em %), promoção automática, fechar/sair devolve os
  rótulos, fail-closed (desligada não busca nada).
- `test/kit-gateway.workerd.test.js` (5): contrato, cabeçalhos, origem fixa, 503 em tudo fora do contrato, só com `post-add-kit`, região da loja única.
- `test/theme-release.test.js`: `evaluatePostAddKit`. `test/store-release.test.js`: um release de rotina nunca liga `post-add-kit`.
- Visual (SIMULAÇÃO, sem carrinho real; com e sem a barra da INK): `PW_PATH=<pasta com playwright-core> node scripts/qa-post-add-kit.mjs --out docs/evidence/post-add-kit --antes`.
  A PDP real passa pelo Worker local; o modal é reconstruído com os ids/classes da auditoria (`docs/evidence/drawer/before-drawer-*.audit.json`) e a
  geometria medida: no celular a folha CRESCE com o conteúdo, como a real (a 1ª versão da simulação limitava a altura e escondeu o topo cortado). O
  script mede se o × e "Finalizar compra" ficam à vista, também depois de rolar, e se o começo do kit é alcançável (a folha simulada é flex com
  items-center, como a real). Prints em `docs/evidence/post-add-kit/` e, da correção da folha,
  `docs/evidence/post-add-kit-folha/` (com `antes-da-correcao/`).

## Rollout (nada publicado)

1. Storefront com `/api/post-add-kit/<região>` no ar e o kit **publicado** no painel.
2. `bash scripts/release-tema.sh --check --add=post-add-kit` (pré-condição: o storefront responde o v1; desligado só avisa).
3. Com o dono: `--deploy --add=post-add-kit`. Depois do deploy o script confere que `/__origens/kit` serve o mesmo kit do storefront e que o loader da
   PDP traz o módulo. Rollback = a versão capturada (o modal volta a ser o da INK).
4. Conferência real (passo do dono, com carrinho de verdade): `node scripts/preview-tema.mjs --headed --allow-cart`, adicionar uma peça, ver o modal no
   desktop e no celular, copiar o cupom, "Finalizar compra" abre o carrinho e o cupom vale lá.

Limites conhecidos: só página de produto (o quick add das listagens não monta o kit); a marcação real do modal não foi vista com carrinho de verdade
nesta rodada (só a auditoria e a simulação).
