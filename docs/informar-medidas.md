# "Informar medidas" na página de produto (size-fit)

Botão **"Informar medidas"** ao lado do **"Guia de medidas"** (o link nativo "Confira suas medidas" da INK, reestilizado por `size-guide`), na
mesma linha e com a mesma altura. A pessoa mede uma peça que já veste bem (largura de axila a axila; comprimento opcional) e vê o tamanho
**desta** peça com as medidas mais próximas, com a diferença em centímetros. Porte do módulo da Altura Trek
(`storefronts/altura-trek/prototipo/src/modulos/medidas`), que lá ficava junto do rótulo "Tamanho".

> **Desligado em 30/10/2026.** A INK passou a ter o próprio quadro de medidas com provador ("Ficou com dúvidas sobre o seu tamanho? Guia de
> Medidas"), e o nosso botão ficou solto embaixo dele. A chave sai da produção com `release-tema.sh --deploy --remove=size-fit` (ver
> "Desligamento" abaixo); o código continua no repositório.

Código: `src/loader/size-fit.js` (tabelas, cálculo puro e o módulo do loader). Flag `size-fit` em `WIDGET_FEATURES`, **opt-in** (fica fora de
`STORE_FEATURES`: um release de rotina não a liga). Independe de `size-guide`: sem ela, o botão fica ao lado do link nativo "Confira suas medidas".

## Como funciona

- **Qual tabela.** As mesmas do "Guia de medidas" do storefront (`useorigens/src/lib/catalog/size-guides.ts`, transcritas das imagens oficiais e
  conferidas em 2026-10-05). A peça é reconhecida pelas **imagens do modal oficial** da INK nesta página (`/images/size_table/<hash>.webp`, versão de
  computador e de celular). Imagem desconhecida (a INK trocou) ou peça infantil = **sem botão**; o "Guia de medidas" continua lá. Nada de números
  genéricos.
- **Modelo.** Camiseta clássica/baby look e algodão peruano têm duas tabelas: vale o modelo marcado no seletor da INK. Sem modelo marcado, o painel
  pergunta antes ("Baby Look | Feminina" / "Clássica | Unissex", os nomes que a INK mostra) e marca o radio da própria INK. Trocar o modelo na página
  com o painel aberto refaz a comparação com a tabela nova e avisa.
- **Comparação.** Mais próximo pela largura (coluna Abdômen, Busto ou Tórax, conforme a peça); o comprimento desempata. A segunda opção aparece se
  estiver até 1 cm mais longe. Avisa quando a medida passa da faixa da tabela (com a tolerância oficial), quando parece em milímetros ou a volta
  inteira do peito, e repete a nota oficial do peruano (verde musgo/oliva) e o aviso da oversized.
- **"Usar tamanho G".** Clica no radio do tamanho da INK (o controller dela cuida de preço, estoque e botão de compra) **só** se o tamanho existir e
  estiver disponível no modelo e na cor marcados (JSON de variantes do próprio quadro). Senão, avisa e não marca nada. Nunca adiciona ao carrinho.
- **Ciclo de vida.** O link nativo é **movido** para uma linha nossa (`[data-origens-fit-row]`, mesmo nó, mesmo `href` e `data-action`) e volta para
  o lugar no unmount (`turbo:before-cache`, saída do escopo). O quadro das variantes é lazy e volta a cada troca: a linha é refeita; o painel aberto
  relê tudo da página.
- **Painel.** Folha inferior no celular, diálogo centralizado do `sm` em diante, `role=dialog`, `aria-modal`, foco preso, Esc fecha e devolve o foco.
  Largura pela área visível do documento (`documentElement.clientWidth`), por causa do drawer da INK fora da tela no celular.
- **Medição** (mesmas regras de `pdp-share`/`size-guide`: só pelo gtag da INK, só após o aceite de cookies): `origens_size_fit_open`,
  `origens_size_fit_result` e `origens_size_fit_use` com `size` e `fit_table`. Nenhuma medida da pessoa e nenhuma URL vão nos eventos.

## Verificação

- `node --test test/size-fit.unit.test.js test/size-fit.dom.test.js` (fixture `test/fixtures/product-page-size-fit.html`, reduzida da PDP real de
  2026-10-15) e `npm test`.
- `PW_PATH=<dir com playwright-core> node scripts/qa-size-fit.mjs`: PDPs **reais** da Use Sul (camiseta clássica e oversized) pelo Worker local,
  1440×900 e 390×844: botão ao lado do guia, painel livre e dentro da tela, resultado esperado, tamanho marcado na INK, nenhum POST.
  Capturas em `docs/evidence/informar-medidas/`.

## Rollout

Ligado na Sul em 15/10/2026; desligado em 30/10/2026 (abaixo).

Igual ao de `size-guide` (`docs/pdp-share-size-guide.md`): uma loja por vez, mesmas variáveis no ar acrescentando só `,size-fit` ao
`WIDGET_FEATURES`. Rollback: `npx wrangler rollback <versão anotada> --name <worker>`.

## Desligamento

Na pasta de release (checkout em `origin/main`), com o `wrangler login` do proprietário:

```bash
bash scripts/release-tema.sh --check --remove=size-fit                                   # só leitura: plano sem size-fit e dry-run
RELEASE_CONFIRM=PUBLICAR-TEMA-INK bash scripts/release-tema.sh --deploy --remove=size-fit
```

O plano preserva todas as outras chaves; a conferência exige o health de antes **menos** `size-fit` e repete as checagens do `--update`.
Para religar: `--add` não aceita `size-fit`; use `npx wrangler rollback <versão anotada>` ou acrescente a chave ao `--add` do script.
