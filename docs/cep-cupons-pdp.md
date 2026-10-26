# Prazo de entrega e cupons à vista na página de produto (`pdp-cep`, `pdp-coupons`)

Pedido do dono em 26/10/2026. Na página de produto da INK, o CEP aparecia só como o texto "Calcule o prazo de entrega" e abria um modal. Os cupons
apareciam como "Cupom · Ver cupons disponíveis" e abriam outro modal. Agora as duas coisas ficam na própria página:

- **Prazo de entrega** (`pdp-cep`): um campo de CEP com "Calcular", e o prazo aparece logo abaixo. Também tem o link "Não sei meu CEP", que abre a
  busca dos Correios em outra aba, e "Alterar CEP" depois do cálculo.
- **Cupons** (`pdp-coupons`): uma aba por código, com o desenho do oria-worker no tema da Use Origens. Cada aba mostra o que o cupom dá, quanto se
  economiza nesta peça, as faixas do progressivo e as condições, com o botão "Copiar".

Cada um tem a sua chave em `WIDGET_FEATURES` (opt-in). Desligada, nem o módulo entra no loader, e o link e o quadro da INK ficam como sempre foram.

Capturas (sessão anônima, CEPs públicos) em [`docs/evidence/cep-cupons-pdp/`](evidence/cep-cupons-pdp/): `antes-*` é a INK de hoje, `cep-*` e
`cupons-*` mostram com o tema da PDP, e `sem-tema/` mostra sem ele.

## De onde vem cada dado

Tudo vem da INK. Nada é inventado nem calculado por nós.

### Prazo

O CEP vai pelo **formulário externo da INK**, `#delivery-estimates-form`, que leva o `product_id`. O envio é um evento `submit` sintético, e o Turbo
da INK o assume igual faz com o modal. A resposta é um turbo-stream. Comportamento conferido na INK real em 26/10/2026:

| CEP | O que a INK devolve | O que aparece |
| --- | --- | --- |
| atendido (ex. 88010-000) | os streams `cart`, `delivery-estimates-content-modal-frame` ("CEP 88010-000 - Centro, Florianópolis") e `remaining_delivery_time` ("Entrega até terça, 3 de novembro" e "Comprando dentro das próximas …") | CEP e lugar, a data em negrito e o "comprando dentro de" |
| sem entrega (ex. 00000-000) | só o stream `cart`, com o erro "Não temos transportadora disponível…"; o carrinho não abre | "Não há entrega disponível para esse CEP. Confira os números ou tente outro." |
| incompleto | nada é enviado | "Digite os 8 números do CEP." |
| falha, ou ninguém assumiu o envio | — | "Não foi possível calcular agora. Tente de novo em instantes." |

- O resultado é lido **deste envio**: são os streams que chegam entre o envio e logo depois do `turbo:submit-end`. O módulo nunca compara com o texto
  que já está na página, porque um CEP sem entrega depois de um válido deixaria o prazo antigo lá.
- **A INK informa só o prazo, não o preço do frete**, e por isso o bloco se chama "Prazo de entrega" e não promete valor.
- O último CEP calculado fica no `sessionStorage` (`origens:cep`) só para **preencher** o campo na próxima página de produto da mesma aba. O cálculo
  só acontece quando a pessoa pede.
- Quando a INK já mostra uma estimativa da região ("Estimativa de entrega até … em Santa Catarina"), ela vira a dica acima do campo.

### Cupons

Os cupons vêm do frame `#product_promotions_frame`, o mesmo que alimenta o modal oficial. Ele é preguiçoso: carrega quando chega perto da tela, e o
nosso bloco entra no mesmo instante (`turbo:frame-render`).

O módulo lê de cada cartão o código (o campo escondido do controlador de cópia), o "Você economiza…" e as regras. O título sai dessas regras:

- "10% de desconto" quando a regra é um valor;
- "Leve mais, pague menos" quando há faixas;
- "… na primeira compra" **só quando a INK escreve essa regra**. O nome do código não basta.

"Copiar" só copia. Quem valida e aplica o cupom é a INK, no carrinho, e o texto nunca diz que o desconto foi aplicado.

## Segurança do fluxo de compra

- **O frame do prazo fica dentro do formulário de compra.** O nosso campo está num `<form>` NOSSO, criado pelo DOM. Por isso Enter ou "Calcular" nunca
  enviam o formulário de compra nem disparam a validação "Selecione o tamanho", e o envio para no nosso formulário (`stopPropagation`). O teste DOM
  confere isso.
- **Nada navega.** Um `submit` sintético que o Turbo não assume não troca de página, e o bloco mostra "tente de novo".
- **Sem Turbo na página, o módulo não monta**, e o nativo fica.
- **Na marcação inicial da INK, o campo do modal também pertence ao formulário externo.** Ele é desligado só durante o envio, para não ir vazio junto,
  e volta em seguida.
- **O nativo só some com o nosso bloco dentro do frame**, pela regra CSS `:has(> .o-cep)` / `:has(> .o-cpn)`. Os modais oficiais continuam no DOM e os
  streams da INK seguem atualizando os nós dela. No `turbo:before-cache` e ao desligar, tudo o que é nosso sai.
- **A resposta de cada cálculo também substitui o carrinho** (`replace cart`), como no modal. O descobridor pós-adição olha `#modal-wrapper`
  ("Produto adicionado") e o espelho, `turbo-frame#cart`: um cálculo não é lido como "item adicionado". No QA real, o carrinho continuou fechado e
  nada foi adicionado. **O caso "carrinho com itens" não foi exercitado ao vivo**, porque adicionar ao carrinho real é bloqueado no harness.

## Medição

A medição usa as mesmas regras do `PDP_EVENTS`: o gtag da INK, só depois do aviso de cookies e com baixa cardinalidade.

- `origens_cep_calc` com `result` = `ok` | `not_found` | `error`;
- `origens_cep_finder`;
- `origens_coupon_copy` com `coupon` = o código.

**Nunca vão o CEP, o bairro ou a cidade.**

## Ligar, conferir e voltar

```bash
# leitura: o que seria publicado
bash scripts/release-tema.sh --check --add=pdp-cep,pdp-coupons
# publicar (dono): uma chave ou as duas
RELEASE_CONFIRM=PUBLICAR-TEMA-INK bash scripts/release-tema.sh --deploy --add=pdp-cep,pdp-coupons
```

O release preserva as chaves de hoje e só acrescenta as pedidas. Depois, ele confere que o loader da PDP traz o módulo de cada uma.

Com as chaves no ar, `--update` também confere isso. Para voltar, use a versão capturada, que traz de volta o link do modal e o quadro da INK.

As chaves estão em `OPT_IN_FEATURES`, e um release de rotina das outras lojas nunca as liga.

QA real, sem publicar: o Worker local entre o navegador e a PDP da INK; a sessão é anônima e nenhum POST sai.

```bash
PW_PATH=<dir com playwright-core> PREVIEW_PDP=/useorigens/product/balneario-camboriu-origem-sc node scripts/qa-cep-cupons.mjs --shots docs/evidence/cep-cupons-pdp
```

## Em aberto (decisão do dono)

O botão flutuante de cupons (`promo-fab`, CMS do storefront) mostra os mesmos códigos PRIMEIRACOMPRA e LEVEMAIS, mais o frete grátis do Sul. Com
`pdp-coupons` ligado, eles aparecem também nas abas da página de produto. Fica a escolha entre manter os dois (o botão vale também nas outras
páginas) ou esconder o botão na página de produto.
