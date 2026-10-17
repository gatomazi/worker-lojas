# Relatório — personalização do fluxo INK (PDP, carrinho, checkout)

Rodada de 15/10/2026, a partir de `CLAUDE_CODEX_PERSONALIZACAO_FLUXO_INK.md`. **Nada foi publicado:** nenhum deploy do Worker ou do storefront, nenhuma rota da zona criada, nenhum merge. Entrega em dois PRs abertos (Worker `worker-lojas` e storefront `useorigens`), branch `feature/tema-fluxo-ink` nos dois. Detalhe técnico, prévia e comandos: [`tema-fluxo-ink.md`](tema-fluxo-ink.md).

## O que mudou

**Worker (worker-lojas)** — três features opt-in, uma por superfície, que injetam só um `<link>` de CSS e um atributo no `<html>`:

- `theme-pdp`: fonte, fundo (o cinza das fotos), migalha, título, preço, prazo/cupom, chips de "Também disponível em", seletores de modelo/tamanho (selecionado na cor da região, indisponível apagado, foco de teclado visível), quantidade, botão "Adicionar ao carrinho" e a barra fixa do celular, abas de descrição e os nossos blocos (guia, recomendações) na linguagem do site.
- `theme-cart`: carrinho lateral (440 px no computador, tela cheia no celular com área segura), itens, quantidade/remover com toque de 44 px, cupom/CEP, totais com o total em destaque, "Finalizar compra", carrinho vazio, confirmação pós-adição e o nosso bloco "Descubra outras estampas"; Esc fecha pelo "X" nativo.
- `theme-checkout`: as telas de contato/entrega e de pagamento — fonte, títulos, campos (48 px, 16 px), erros em vermelho AA, opções de frete e pagamento como cartões, faixa "pagamento protegido" reduzida e neutra, botões "Ir para o pagamento" / "Finalizar compra" no estilo do site, resumo com desconto em verde AA e total em destaque. **Só CSS, sem nenhum script nosso.**
- `src/loader/theme-ui.js`: o mínimo de JS na PDP/carrinho (barra fixa some com o botão principal à vista ou o teclado aberto; toque na barra inerte leva à escolha que falta; Esc no carrinho).

**Storefront (useorigens)** — painel **Tema da INK** (por região, rascunho → Publicar): liga/desliga por superfície e quatro presets (botão preto ou da região, fundo cinza ou branco, cantos retos ou suaves, Hanken Grotesk ou Poppins), amostra do rascunho, aviso de contraste, linhas no diff de publicação. Endpoint público `GET /api/ink-theme/<região>` (contrato v1) e `npm run ink-theme:draft -- <região>` para a prévia com o rascunho.

### Ficha da referência (PDP do storefront, lida ao vivo)

| Item | Valor |
|---|---|
| Fonte | Hanken Grotesk (corpo e títulos); título 800 / 64 px (desktop), preço 800 / 48 px, `letter-spacing` −0,028em |
| Cores | fundo `#e5e5e5` (o das fotos), papel `#f2f2f0`, tinta `#000`, `#33332f`, `#56564f`, linha `rgb(0 0 0 / .22)`; região Sul `#4d543d` |
| Botão | preto, texto branco, maiúsculas 15 px/700, `letter-spacing` .04em, 52 px, borda 2 px, **raio 0**; hover invertido |
| Chips | borda 2 px tinta, 44 px, 15 px/600; selecionado na cor da região com texto branco |
| Layout | grade 1,15fr : 1fr, 64 px entre colunas; cabeçalho sticky; **sem barra fixa de compra no celular** |

### Arquivos principais

Worker: `src/theme.js`, `src/loader/theme-ui.js`, `src/worker.js` (rota do CSS, injeção, ramo do checkout), `src/features.js`, `src/stores.js` (`inkThemeApi`), `scripts/preview-tema.mjs`, testes `test/theme*.js`, `docs/tema-fluxo-ink.md`.
Storefront: `src/lib/site-config/ink-theme-schema.ts`, `ink-theme.ts`, `ink-theme-public.ts`, `src/app/api/ink-theme/[region]/route.ts`, `src/app/admin/(panel)/tema-ink/page.tsx`, `saveInkThemeAction`, op `set-ink-theme`, diff, sanitização, `scripts/ink-theme-draft.mts`, `tests/unit/ink-theme.test.ts`.

## Testes executados

| Onde | Resultado |
|---|---|
| Worker `npm test` (inclui 22 novos: contrato, escopo do CSS, workerd real, DOM) | **555/555** (533 anteriores + 22 novos) |
| Storefront `vitest tests/unit` | 1423/1423 (6 novos); `tsc` limpo; `eslint` 0 erros |
| QA no navegador, INK REAL + Worker local + rascunho exportado do painel (`--qa`) | **66/66** com tema: 360/375/390/768/1440 sem rolagem horizontal; CTA 52 px; seletores ≥ 47 px; Turbo para outra PDP e voltar sem duplicar tema/loader/guia; barra fixa some com o CTA à vista; toque na barra antes do quadro de variantes carregar rola até ele; carrinho abre pelo ícone e Esc fecha; checkout contato/entrega e pagamento sem loader, campos ≥ 48 px, botão 52 px, sem rolagem horizontal; nenhum erro de JS. `docs/evidence/tema-fluxo-ink/qa-com-tema.txt` |
| O mesmo QA sem as features (`--off`, a INK de hoje) | 23/26: a PDP nativa **já tinha** rolagem horizontal no celular (378/360, 386/375, 393/390). `qa-sem-tema.txt` |
| Painel local (`cms:dev`) | salvar rascunho pela interface (3 superfícies) → endpoint público continua desligado → `ink-theme:draft` exporta o ligado → a prévia usa esse arquivo. Painel sem rolagem horizontal a 390 px |

Capturas (antes/depois, desktop 1440 e celular 390): `docs/evidence/tema-fluxo-ink/` — PDP (dobra, inteira, variantes), carrinho vazio, checkout contato e pagamento (**dados pessoais mascarados**), comparativo lado a lado `comparativo-pdp-{desktop,mobile}.jpg` (site × INK hoje × INK com tema) e uma variação de presets. Painel: `useorigens/docs/evidence/tema-ink/`.

## Regressões encontradas e resolvidas na rodada

1. **Botão escondido reaparecendo:** o estilo de botão definia `display`, o que derrubava o `hidden md:block` da INK — no pagamento do celular o "Finalizar compra" do computador voltava, atrás da barra fixa. Removido; teste agora trava `display` no CSS.
2. **Vermelho em texto que não é erro:** a regra de erro pegava todo `<small>` visível (nome do frete, "ou 5x de…"). Agora só as mensagens de campo da INK (`small[class*="-bottom-5"]`).
3. **Preço sem o peso da vitrine:** uma regra da linha "ou 5x de…" também casava com o parágrafo do preço.
4. **Fonte do checkout:** a INK fixa Inter no contêiner do checkout e no resumo; sobrescrito sem tocar nos ícones.
5. **Rolagem horizontal nativa** no celular (17 pontos da galeria = 396 px): pontos menores só com o tema.
6. **Quadro de variantes lazy:** antes de carregar, a barra fixa é inerte e o toque não fazia nada; agora rola até o quadro.

## Limites da validação (não apresentar como aprovado)

- **Carrinho com itens e confirmação pós-adição NÃO foram vistos ao vivo com o tema.** Adicionar item ao carrinho real da INK foi bloqueado pela política de permissões desta sessão (transação real) e não foi contornado. O CSS foi escrito sobre o DOM documentado nas rodadas anteriores (`fase-4-cart-bridge.md`, `stores/application.css` da INK). Para conferir: `preview-tema.mjs --headed --allow-cart` e adicionar à mão (o checkout continua travado na prévia).
- **Checkout:** só GET das duas telas de um carrinho de teste do dono, sem preencher, clicar ou enviar nada (0 requisições não-GET). Não testados: alternar Pix/cartão (o clique no Pix dispara `payment_discount`), campos do cartão, parcelas, endereço de cobrança diferente, cupom válido/inválido, recálculo de CEP/frete, erro de campo provocado (os campos salvam sozinhos ao mudar), voltar do pagamento e editar. **Pagamento e confirmação não foram validados.**
- "Finalizar compra" na tela de pagamento faz `POST /checkout/process_payment`: cria o pedido, **não há tela de revisão**. Por isso o tema não mostra indicador de etapas nem promete revisão.
- Teclado do celular real (iOS/Android) e Safari não testados: a barra some com campo focado (testado em jsdom e Chrome emulado).
- Tracking: o tema não dispara nem altera evento (nenhum código de medição novo; `theme-ui` não emite nada). Duplicação **não medida ao vivo** (analytics bloqueado no QA).
- Indicador de frete grátis: **não criado.** A regra real ("Frete grátis para PR, RS, SC a partir de 2 itens") é da INK e já aparece na faixa dela; não temos valor confiável por carrinho.
- Descrição: as abas da INK (`role=tablist`) foram mantidas e restilizadas, não viraram acordeões.
- Norte e Centro-Oeste: código pronto (o endpoint e o Worker são por região), mas essas lojas vão ser desativadas; nenhuma QA nelas.

## Depende de ambiente/acesso

1. Deploy do storefront (endpoint `/api/ink-theme/sul` e o painel) **antes** do Worker.
2. Publicar o tema no painel de produção (por padrão tudo desligado: publicar o storefront sozinho não muda a INK).
3. Deploy do Worker da Sul com `theme-pdp,theme-cart` em `WIDGET_FEATURES` (e `theme-checkout` quando houver rota).
4. Checkout: PR próprio liberando as duas rotas da zona (`tema-fluxo-ink.md` › "rota da zona") com `probe` provando que os POSTs do checkout não passam pelo Worker.

## Como desligar/reverter cada módulo

Painel (por superfície, ~1 min) · `WIDGET_FEATURES` sem a feature (deploy) · `wrangler rollback` · remover as duas rotas do checkout. Em todos os casos a INK volta ao visual nativo sem perder carrinho nem formulário: o tema não guarda dado nenhum. Tabela completa em `tema-fluxo-ink.md`.

## Pronto × depende × não testado

| Pronto (código + teste + prévia) | Depende de acesso/ambiente | Não testado |
|---|---|---|
| PDP (desktop e celular), carrinho vazio, checkout contato/entrega e pagamento (visual, GET), painel e endpoint, prévia com rascunho, QA automatizado | deploys, publicação no painel, rotas do checkout | carrinho com itens e pós-adição ao vivo, cupom, frete, Pix/cartão, cobrança, erros de campo provocados, teclado real, Safari, tracking ao vivo, pagamento/confirmação |
