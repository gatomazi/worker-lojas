# post-add-kit: "Monte seu kit" no modal pós-adição

Feature opt-in `post-add-kit`. No modal **"Produto adicionado ao carrinho"** da INK (página de produto), o bloco da promoção progressiva da INK escolhida
no CMS do storefront (Marketing › Monte seu kit; `docs/storefront/kit-pos-adicao.md` no useorigens):

- chamada, título e texto de apoio (do CMS);
- "Cupom LEVEMAIS" + o botão **Copiar cupom** (com borda e ícone; "Copiado" por 2 s), ou "Desconto aplicado no carrinho" quando a INK aplica sozinha;
- uma linha por faixa (até 6): `3 peças | de R$ 329,70 por R$ 304,70 | R$ 101,57 cada, economize R$ 25,00`; a maior faixa em destaque;
- o aviso "Em peças com preços diferentes, o total do kit pode variar.".

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

## Preço e contas

O preço é o da peça que **acabou** de ser adicionada, lido no formulário de compra enviado (`form[id^="form-product-"]`: o da página, o do "compre
junto" ou o do quick add) no `submit`/`turbo:submit-start`: o primeiro elemento-folha com só um preço, fora de riscados (`del`, `s`, `line-through`).
Parcelas ("5x de R$ 21,98") não passam. Vale por 30 s. Sem preço legível: as faixas mostram só o desconto ("R$ 25 OFF no total"), nenhuma conta.

Contas em centavos, iguais às do painel: `value` = total − desconto; `percentage` = total × (100 − d)/100; cada = total/peças. Uma faixa que zeraria o
total = só os descontos. **Quem aplica é o carrinho da INK**: isto é só o que o modal mostra.

## Medição

GA4 da própria INK, só com cookies aceitos (a regra de `tracking.js`): `kit_view`, `kit_coupon_copy`, `kit_checkout_click`, com
`region`, `surface=ink`, `promo_id`, `tiers`. Nunca o código nem preços.

## Testes

- `test/post-add-kit.dom.test.js` (8): posição, contas, rótulo (com o ícone) e "Continuar comprando" escondido, copiar, preço do formulário enviado (promoção do "compre junto"), sem
  preço, promoção automática, fechar/sair devolve os rótulos, fail-closed (desligada não busca nada).
- `test/kit-gateway.workerd.test.js` (5): contrato, cabeçalhos, origem fixa, 503 em tudo fora do contrato, só com `post-add-kit`, região da loja única.
- `test/theme-release.test.js`: `evaluatePostAddKit`. `test/store-release.test.js`: um release de rotina nunca liga `post-add-kit`.
- Visual (SIMULAÇÃO, sem carrinho real): `PW_PATH=<pasta com playwright-core> node scripts/qa-post-add-kit.mjs --out docs/evidence/post-add-kit --antes`.
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
