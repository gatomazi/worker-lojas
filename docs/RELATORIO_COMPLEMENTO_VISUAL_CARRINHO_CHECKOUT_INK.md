# Complemento da rodada 3: carrinho preenchido e checkout

Este complemento mostra o carrinho com itens e as telas do checkout com o tema atual da rodada 3, que tem o escopo no `<body>`. As capturas são em 1440 px e 390 px, com conferência extra em 360 px e em desktop baixo (1280×640). Ele também corrige problemas visuais encontrados nessas telas e traz a proposta de incentivo de frete, que continua **desligada no fluxo real**.

## Ferramenta e origem das telas

As capturas foram feitas em um navegador real, o Google Chrome dirigido pelo Playwright, com as páginas da INK passando pelo Worker **local** (Miniflare). É o mesmo `worker.js` com o mesmo CSS e o mesmo loader de produção. O Claude in Chrome não foi usado porque abriria a loja de produção, onde o tema não está publicado.

Há duas origens, e as duas aparecem na faixa vermelha acima de cada imagem (a faixa não cobre nada da tela) e no nome do arquivo:

- **`SIMULACAO-VISUAL_…`: carrinho e confirmação após adicionar.** A PDP é a real da INK, com o tema e o loader reais (o bloco de descoberta é posto pelo nosso código). A gaveta, porém, recebe uma marcação de carrinho reconstruída com as classes da INK e dados fictícios. Adicionar ao carrinho real foi recusado pela política de permissões na rodada 1, e essa operação não foi repetida por nenhum outro meio. A trava da prévia aborta qualquer POST.
- **`SIMULACAO-VISUAL_checkout-dados-ficticios_…`: checkout.** A estrutura das duas telas é real: as páginas foram lidas por GET do carrinho de teste do dono, com os itens, os totais, o frete e o prazo que a INK calculou. Os dados pessoais são trocados **antes** de a página chegar ao navegador (`sanitizeCheckout`, coberto por `test/sanitize-checkout.test.js`):
  - Os valores de contato e endereço são lidos do próprio HTML e substituídos em atributos, textos e versões só com dígitos.
  - Nome, e-mail, telefone, CPF, CEP, rua, número, bairro e cidade viram dados fictícios.
  - Se algo sobrar, a captura é recusada.
  - Nenhum campo real foi editado. Os POSTs de checkout (salvamento automático, desconto, pagamento) são abortados.
  - Os campos de cartão ficam vazios.
  - Não houve captura sem sanitização, e o identificador do checkout não aparece em imagem, log nem nome de arquivo.

## Estados

As pastas são `desktop/` (1440 px), `desktop/1280x640/`, `mobile/` (390 px) e `mobile/360/`. Os números nos nomes dos arquivos são os mesmos nas quatro.

| Estado | Arquivo | Larguras | Origem | Verificado | Limitação restante |
| --- | --- | --- | --- | --- | --- |
| Carrinho com 1 item | `01-carrinho-1-item_incentivo-falta-1-peca` | 1440, 390, 360 | simulação | Foto, nome, modelo/cor/tamanho, quantidade e remoção (44 px), cupom, frete, subtotal/total, finalizar e continuar; gaveta de 440/390/360 px; sem rolagem horizontal | Valores fictícios; cupom e CEP não executados |
| Carrinho com 6 peças (5 linhas): topo | `02-carrinho-varios-itens_topo_incentivo-atingido` | 1440, 390, 360, 1280×640 | simulação | Nome longo quebra sem cortar; preço numa linha; finalizar sempre à vista (rodapé fixo da gaveta) | Idem |
| Carrinho com 6 peças: fim da lista | `03-carrinho-varios-itens_fim-da-lista` | 1440, 390, 360, 1280×640 | simulação | Último item inteiro; descoberta depois dos itens, compacta (duas ações de 44 px); total e finalizar visíveis | Idem |
| Item removido | `04-carrinho-item-removido_incentivo-volta` | 1440, 390, 360 | simulação | O incentivo volta a "falta 1 peça" | Recálculo real não validado |
| Frete grátis confirmado | `05-carrinho-frete-gratis-confirmado` | 1440, 390, 360 | simulação | "Aplicado" só com o "Grátis" vindo da INK na linha do frete | Proposta |
| Sem oferta ou regra indisponível | `06-carrinho-sem-incentivo` | 1440, 390, 360 | simulação | Sem bloco de incentivo (é o estado atual do fluxo real) | — |
| Confirmação após adicionar | `07-confirmacao-apos-adicionar` | 1440, 390, 360 | simulação | Produto, "Ver carrinho", "Continuar comprando" e descoberta resumida | Marcação reconstruída |
| Checkout: contato e entrega | `10-…contato-e-entrega` (+`_primeira-tela`) e `11-…pagina-inteira` | 1440, 390, 360, 1280×640 | estrutura real, dados fictícios | Grupos, rótulos, campos de 48 px, resumo e "Ir para o pagamento"; Tab não esconde campo atrás de barra | Salvamento automático abortado |
| Checkout: opções de entrega | `12-checkout-opcoes-de-entrega` | 1440, 390, 360 | estrutura real, dados fictícios | Opção da INK (J&T, prazo, "GRÁTIS") em destaque; resumo com desconto, prazo e frete riscado + "GRÁTIS" | Frete calculado pela INK para o CEP real do carrinho de teste (CEP trocado só na imagem) |
| Checkout: Pix | `13-checkout-pix-selecionado` | 1440, 390, 360 | estrutura real, dados fictícios | Opção ativa, informações do Pix, resumo e botão final | **POST de desconto abortado: o total não foi recalculado** |
| Checkout: cartão | `14-checkout-cartao-selecionado`, `14b-…campos_tela` | 1440, 390, 360, 1280×640 | estrutura real, dados fictícios | Campos vazios de 48 px, parcela 3x escolhida (opções da INK), barra fixa "Total · Finalizar compra" numa linha | Idem (desconto) |
| Checkout: cobrança diferente | `15-checkout-cobranca-diferente`, `15b-…cobranca_tela` | 1440, 390, 360, 1280×640 | estrutura real, dados fictícios | Campos de endereço vazios, alinhados; continuidade até o botão e a garantia | — |

Nos arquivos de celular, `_tela` é o que cabe na tela com as barras fixas reais, e `pagina-inteira` mostra a página completa. Só nessas capturas de página inteira a barra fixa do rodapé vai para o fim, para não congelar no meio da imagem.

## Correções (Worker, PR #24)

| Problema visto | Correção | Conferência |
| --- | --- | --- |
| Na gaveta, a foto encostava na borda e o preço quebrava em "R$ / 109,90" quando o nome era longo | Respiro de 16 px no item; preço com `nowrap` | Nenhum nome cortado; preço numa linha em 360, 390 e 1440 |
| Quantidade e remoção com 40 px | 44 px; número centralizado | Menor alvo medido: 44 px |
| Bloco de descoberta alto no carrinho cheio | Versão compacta depois dos itens, com duas ações de 44 px | Captura 03 |
| Confirmação após adicionar comprida no celular | Sem o rótulo e o texto de apoio do nosso bloco (fica só o título e as ações) | Captura 07 |
| Em tela baixa (≤760 px de altura), o rodapé fixo da gaveta (329 px) comia a lista | Rodapé compacto (286 px), sem esconder nada da INK e sem alvo menor que 44 px | Lista de 254 → 297 px em 360×640 e 1280×640 |
| **Checkout no celular: ao navegar com Tab, o campo em foco parava atrás da barra fixa "Total · Finalizar compra"** (em 390 px: parcelas, estado e complemento; em 360 px: validade, CVC e CEP) | `scroll-padding` no `<html>` do checkout tematizado: 48 px no topo (faixa fixa) e 104 px embaixo (só quando a barra existe). É só CSS, sem loader | 0 campos encobertos em 390, 360 e 1280×640 |
| Achado ao investigar uma falha da QA de liga/desliga na PDP. Medido na INK: o Turbo tira o `busy` do quadro de entrega **antes** de ler a resposta (~20 ms); só depois troca o conteúdo e marca `complete`. Uma reordenação nesse intervalo move o quadro e aborta a leitura | O quadro visto carregando conta como carregando até o `complete`, e então a ordem é refeita (`theme-ui.js`). A falha de ordem vista uma vez (promoções antes de entrega, com outra captura rodando em paralelo) não se repetiu, e a causa dela não foi isolada | Teste DOM com a sequência medida (falha no código anterior, passa agora); QA geral sem erro de abort |

O botão final ficou numa linha em todos os tamanhos (54 px; 48 px no carrinho em tela baixa). Não houve rolagem horizontal em nenhuma captura, nem widget flutuante sobre as ações.

Arquivos alterados:

- **Código:** `src/theme.js` e `src/loader/theme-ui.js`.
- **Testes:** `test/theme.unit.test.js`, `test/theme-ui.dom.test.js` e `test/sanitize-checkout.test.js` (novo).
- **Ferramentas:**
  - `scripts/lib/tema-harness.mjs`: opção `sanitize`.
  - `scripts/complemento-visual.mjs`: novo, gera todas as capturas acima.
  - `scripts/preview-tema.mjs`: opção `--capturar-carrinho`, para a sessão real feita à mão.
- **Storefront (PR #83):** sem alteração. O incentivo não ganhou chave no painel porque não há regra para ligar.

Testes (Worker): `npm test` 563/563; QA geral com o checkout 65/65; liga/desliga com o checkout 21/21; galeria 163/163. Nenhum erro de abort.

## Ofertas e incentivo

| Oferta encontrada | Fonte | Regra acessível de forma confiável? | Destaque |
| --- | --- | --- | --- |
| Frete grátis para PR, RS e SC a partir de 2 itens | Faixa do topo da INK e storefront (`/api/promotions/sul`: "Frete Grátis para o Sul na compra de 2 peças ou mais") | **Não.** Só existe como texto. Na API da INK, frete grátis não é um tipo de promoção (os tipos são desconto percentual ou em valor). A `shipping_simulation` calcula sobre **uma** camiseta de referência e não confirma a regra de 2 peças. A barra nativa do carrinho é por **valor** e vem zerada (`max-progress-value=0`). O MCP da INK (somente leitura) não expõe promoções nem regras de frete | Proposta em simulação |
| LEVEMAIS (3 peças: R$ 25; 4: R$ 40; 5: R$ 60; 6: R$ 85) | Storefront (texto) e, na INK, provavelmente uma promoção "progressiva" | **É a mais estruturada.** A especificação da API da INK (`GET /v1/stores/promotions?type=progressive`) traz faixas com `min_cart_items`, produtos elegíveis (`list_type`, `product_ids`, coleções), `apply_automatically`, `show_in_cart` e vigência. Mas exige token no servidor com o escopo `store.promotions.read`, que o Worker não tem e o MCP não expõe. O −R$ 85,00 do carrinho de teste (6 peças) bate com a faixa de 6; se foi digitado ou automático, não dá para saber por GET | Não destacado (um incentivo só); é o melhor candidato a incentivo real |
| PRIMEIRACOMPRA (10%) | Storefront (cupom) | É cupom digitado | Não destacado |

**Proposta (só simulação, desligada no fluxo real):** uma linha curta com um ícone de caminhão, logo acima do cupom e do total, antes de "Finalizar compra". Usa a cor de seleção da marca, sem pulsar nem piscar, e a barra fina só anda ao mudar (respeita a preferência de redução de movimento). Os estados são:

- "Falta **1 peça** para a condição de frete grátis no Sul (PR, SC e RS)", com a barra.
- "**Condição de 2 peças atingida.** Informe o CEP para verificar o frete grátis", porque o destino ainda não foi verificado.
- "**Frete grátis aplicado** à entrega escolhida", só depois de a INK devolver "Grátis".
- Ao remover um item, volta a "falta 1 peça".
- Sem regra, nenhum bloco.

No checkout não entrou nada: a INK já confirma o benefício ("R$ 27,49 GRÁTIS" no resumo e "GRÁTIS" na opção J&T), e o checkout segue sem loader.

**Falta, para ligar de verdade:**

1. Uma regra estruturada e com dono (mínimo de peças, produtos elegíveis, UFs), publicada pela INK ou pelo painel como espelho declarado da regra cadastrada na INK. Hoje, se a regra mudar na INK, a mensagem prometeria algo errado.
2. Decidir o que conta como peça **elegível**. A contagem total existe (`data-quantityheader`), a elegibilidade não.
3. Na integração: recalcular depois de cada resposta do `turbo-frame#cart` e esconder o bloco enquanto o frame estiver ocupado ou com erro, para nunca mostrar sucesso com dado velho.

Outro caminho para um incentivo real é o desconto progressivo: "Falta 1 peça para R$ 25 de desconto", que a API da INK descreve com faixas e produtos elegíveis. Ele exige três coisas: um token de leitura de promoções no servidor, uma leitura com cache no Worker (sem chamada a cada página) e confirmar no painel da INK se a promoção é automática ou por código. Isso é uma integração nova e depende de você decidir.

A faixa do topo da INK já anuncia a mesma oferta. Ela continua lá, porque não escondemos conteúdo da INK, e o bloco da gaveta seria a versão contextual.

## Aparência, comportamento e integração

**Aparência aprovada na prévia (para sua revisão):** todas as capturas acima, ou seja, a composição do carrinho com 1 e com 6 peças, a confirmação, as duas telas do checkout com Pix, cartão e cobrança diferente, e os quatro estados do incentivo.

**Comportamento validado com resposta real:**

- **Telas do checkout lidas por GET da INK:** estrutura, itens, desconto, frete grátis e prazo calculados pela INK para o carrinho de teste.
- **Campos e foco:** os campos do cartão e de cobrança abrem; as parcelas vêm prontas da INK e trocar a parcela não faz requisição; o foco por Tab fica fora das barras.
- **Liga/desliga:** o tema obedece ao painel e às features do deploy (QA liga/desliga).

**Integração pendente:**

- Carrinho real com itens: adicionar, quantidade e remover.
- Recálculo do desconto de Pix/cartão (`payment_discount`, abortado).
- Salvamento automático do contato e da entrega.
- Cupom e CEP no carrinho.
- Incentivo: falta a regra.
- Rotas de checkout na zona: ficam para um PR próprio.
- **O PR #24 está em conflito com a `main` desde o merge da loja única (#25)**, em 4 trechos do `src/worker.js`. Para resolver, é preciso decidir se o tema é um só para a loja usesul ou um por região (a loja única serve cada visitante pela região dele, e o painel publica `/api/ink-theme/<região>`). Depois, a bateria inteira precisa rodar de novo. Não resolvi nesta entrega.

## Sessão real do carrinho (se você quiser fechar a pendência)

A operação recusada na rodada 1 foi **eu adicionar um produto ao carrinho real da loja** pela automação do navegador. Não repeti isso por nenhum outro meio. Para fotografar o carrinho real com o tema, quem adiciona é você:

1. Na pasta `use-origens-workers-tema`, rode `PW_PATH=/Users/izamoti/projects/useorigens node scripts/preview-tema.mjs --headed --allow-cart --capturar-carrinho ~/Downloads/carrinho-real`.
2. Abrem duas janelas (computador e celular) na PDP, com o tema, via Worker local. São sessões novas, sem o seu carrinho de teste.
3. Em **cada** janela, adicione 1 camiseta à mão e aperte Enter no terminal (o script só abre a gaveta e fotografa o topo e o fim).
4. Adicione até ter 4 ou mais peças e aperte Enter. Depois remova uma e aperte Enter.
5. Encerre com Ctrl+C e me avise. Eu confiro e monto as comparações.

O checkout continua travado: nenhum POST para `/checkout` sai da prévia, então não há pedido nem cobrança. Os itens ficam no carrinho dessas sessões de teste. Não é preciso esvaziar, mas pode.
