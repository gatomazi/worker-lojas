# Direção de arte: mais vida no carrinho e no checkout (propostas A e B)

**Duas propostas prontas em prévia, lado a lado com o tema atual.** Nenhuma foi aplicada: o tema aprovado continua o mesmo no código, no painel e para o cliente até a escolha. Não houve merge nem deploy. Branch `feature/tema-fluxo-ink` (worker-lojas #24).

## 1. Onde o resultado ficou neutro demais

- **Fundo do incentivo.** O verde-oliva da Sul (`#4d543d`) é escuro e pouco saturado. Clareado a 20 %, vira um cinza-esverdeado (`≈ #dbddd8`) e lê como aviso técnico.
- **Escolhas.** O mesmo oliva nas opções escolhidas fica entre cinza e verde. O cartão aberto ficava todo tingido de cinza, com borda de 2 px (1 px + anel), pesada.
- **Superfícies grandes cinzas.** O rodapé do carrinho, o resumo do checkout e o bloco de descoberta usam `#f2f2f0`, um cinza frio.
- **Preto puro.** O botão principal e o texto em `#000` deixam o conjunto correto, mas frio.

## 2. Skill usada

Usei o **Impeccable** (v4.5.0), instalado em `~/.claude/skills/impeccable`, sem baixar nada (o binário já estava em cache):

- `context`: não há PRODUCT.md nem DESIGN.md, então segui com o código como contexto.
- `colorize`: a cor ganhou papéis (ação, escolha, estado, atmosfera) em vez de virar uma coleção de amostras. No carrinho e no checkout ("operar"), a cor marca ação, escolha e estado, e o acento ganha força por ser raro.
- `craft-floor`: contraste medido; a tinta secundária sobre fundo colorido deriva da cor do fundo, e não de um cinza; nada de borda lateral colorida, brilho, degradê ou sombra decorativa; a seleção de texto e o cursor dos campos seguem a paleta.
- `detect`, rodado uma vez sobre o que mudou: apontou que a régua animava `width`. Troquei por `transform: scaleX()` e ele ficou limpo.

Há uma versão nova do Impeccable (v4.6.0). Não atualizei nada nesta rodada.

## 3. As propostas

As duas mexem **só nos papéis de cor** do carrinho e do checkout (seção 6), usando a mesma estrutura, os mesmos textos e os mesmos dados.

### A · verde com mais presença

| Função | Cor | Onde |
| --- | --- | --- |
| Ação principal | `#2e5b38` verde-mata (texto branco 7,9:1) | "Finalizar compra", "Ir para o pagamento", barra fixa do celular |
| Escolha | `#2e5b38` | Rádios, borda de 1 px da opção escolhida |
| Faixa de frete | fundo `#e4f0dc`, borda `#c7dcb7` | Incentivo no topo do carrinho |
| Destaque da faixa | `#24492b` (8,6:1) | "1 peça", "frete grátis", "Você já tem a quantidade necessária" |
| Ressalva | `#3d4f37` (7,5:1) | Destinos e CEP, em tinta verde e não cinza |
| Progresso | `#2e5b38` sobre trilho `#f6faf2` | Régua do incentivo |
| Opção escolhida | cabeçalho `#e7f1df`; frete `#eef6e9`; área do cartão branca | Pagamento e entrega |
| Base | `#faf7f0` off-white quente | Rodapé do carrinho, resumo do checkout, bloco de descoberta |
| Texto | `#1b1d19` carvão | Todo o texto do carrinho e do checkout |

### B · verde com acento ocre (recomendada)

| Função | Cor | Onde |
| --- | --- | --- |
| Ação principal | `#1b1d19` carvão (texto branco 17:1) | Os mesmos botões, em continuidade com o preto da PDP externa |
| Escolha | `#3a5a30` verde da identidade, um tom mais vivo | Rádios, borda de 1 px da opção escolhida |
| Faixa de frete | fundo `#f4ecda` palha/areia, borda `#e3d3b0` | Incentivo |
| **Acento** | círculo `#d6ba8d` atrás do ícone (o dourado-areia oficial da Sul; ícone sobre ele 5,2:1) | Só no ícone do incentivo |
| Destaque da faixa | `#2f4b28` (8,5:1) | Mesmas palavras de A |
| Ressalva | `#5a5340` (6,7:1), tinta quente da palha | Destinos e CEP |
| Progresso | `#2f4b28` sobre trilho `#fffaf1` | Régua |
| Opção escolhida | cabeçalho `#eef3e7`; frete `#f1f5ec`; área do cartão branca | Pagamento e entrega |
| Base | `#fbf8f2` off-white quente | Mesmas superfícies de A |
| Texto | `#1b1d19` carvão | Mesmo de A |

**Comum às duas:**

- **Opção escolhida:** borda de **1 px** sem o anel extra. A cor fica no cabeçalho, e a área aberta do cartão é branca, então os campos aparecem e há pouco fundo colorido.
- **O que não muda:** erro em vermelho (`#b42318`), sucesso da INK em verde (`#1f6f43`) e o contorno de foco grosso (2 px na cor do texto).
- **Seleção de texto e cursor:** seguem a paleta da proposta.
- **Faixa de frete compacta** (pedido seu, com a sacola da Aphago como referência): **uma linha e a régua fina** logo abaixo, com cerca de 44 px; antes eram cerca de 95 px. As mensagens:
  - abaixo da meta: "Falta **1 peça** para o **frete grátis** no Sul" (o rótulo "no Sul" vem do Worker quando a regra cobre a região inteira; senão, "em PR e SC");
  - meta atingida: "Agora é só **confirmar o CEP** para o frete grátis", com a régua cheia, sem prometer o frete;
  - a INK mostra "Grátis": "**Frete grátis** para o seu CEP!";
  - a INK cobra frete: "O frete grátis vale só para **PR, SC e RS**", sem régua.
- **Altura da faixa:** igual nas três versões; o círculo da B tem 22 px.

## 4. Recomendação: B

1. **Continuidade da ação de compra.** A PDP externa (referência nas capturas) e a página de produto da INK usam botão preto. A B mantém o botão escuro do produto até o pagamento. A A troca a cor do botão no meio do caminho, a menos que a PDP também mude, o que está fora do escopo desta rodada.
2. **Calor com a identidade da própria região.** A palha e o dourado-areia vêm da paleta da Sul (acento e fundo do herói). O efeito é regional e editorial, de roupa, sem nova família de cor e sem cara de software.
3. **Significado mais limpo.** Na A, a faixa verde-clara fica perto do verde de sucesso que a INK usa ("GRÁTIS", descontos). "Falta 1 peça" pode ser lido como algo já resolvido. Na B, o fundo palha é neutro-quente, e o estado fica a cargo do texto.

A **A** é a que tem mais presença de cor. Ela faz sentido se a decisão for levar o verde também ao botão da PDP (externa e INK) e, de preferência, separar mais o verde da faixa do verde de sucesso.

## 5. Comparações (no ZIP e na página de revisão)

Todas as comparações usam o mesmo código, os mesmos dados, o mesmo estado e o mesmo enquadramento.

| Estado | 390 px | 360 px | 1440 px |
| --- | --- | --- | --- |
| 1. Carrinho com 1 item, abaixo da meta | ✔ | ✔ | ✔ (recorte da gaveta, igual nos três) |
| 2. Vários itens, quantidade atingida, CEP pendente | ✔ | ✔ | ✔ |
| 3a. A INK mostra "Grátis" (benefício confirmado) | ✔ | — | — |
| 3b. A INK cobra frete (destino não elegível) | ✔ | — | — |
| 4. Contato e entrega com o frete escolhido | ✔ | — | ✔ |
| 5. Pagamento com o cartão aberto | ✔ | ✔ | ✔ |
| 6a. Pix escolhido | ✔ | — | — |
| 6b. Erro e foco (número apagado, Tab) | ✔ | — | — |
| Referência: PDP externa atual, sem mudança | ✔ | — | ✔ |

## 6. Como foi feito (e o que mudou no código)

- **`src/theme.js`:** as cores do carrinho e do checkout passaram a sair de **papéis**:
  - `--o-cta`, `--o-panel`, `--o-incentive-*`, `--o-choice-*`, todos derivados dos tokens publicados;
  - **o padrão é o visual aprovado:** as cores calculadas pelo navegador foram comparadas antes e depois da refatoração e saíram idênticas;
  - a régua usa `transform` em vez de `width`.
- **`src/loader/theme-ui.js`:** o texto novo da meta atingida.
- **`scripts/lib/propostas-cor.mjs` (novo):** as duas propostas, como trocas desses papéis. Valem só para o carrinho e o checkout tematizados, e só na prévia. O harness as injeta com `proposta: 'A' | 'B'`.
- **Nada no painel, nada para o cliente.** Aplicar a escolhida depois é trocar os valores padrão dos papéis no `theme.js`. Se fizer sentido, dá para virar um preset do painel em outra rodada.
- **`scripts/direcao-de-arte.mjs` (novo):** gera tudo o que está acima.

## 7. Validação e pendências (o mesmo de antes)

- **Simulado:** todas as capturas de carrinho (gaveta reconstruída, código real do tema), com a **regra de exemplo** (2 peças, PR/SC/RS) ainda **não confirmada**. Ela não foi promovida a regra de produção.
- **Checkout:** estrutura real, com os dados pessoais trocados por fictícios antes do navegador. A mensagem de erro é a validação real da INK no navegador. Os envios de pagamento, contato e entrega ficaram abortados.
- **Pendente:** carrinho real (itens, quantidade, remoção, cupom, CEP e elegibilidade). Adicionar pela automação foi recusado; não tentei de outro jeito. Nenhum pedido ou pagamento foi feito.
- **Testes:** Worker `npm test` 586/586; QA geral com checkout 65/65; liga/desliga 21/21; galeria 163/163; detector do Impeccable limpo.
