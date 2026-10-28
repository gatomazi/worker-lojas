# Camiseta em criação nas páginas da INK (product-wait)

Feature **opt-in** `product-wait` (`WIDGET_FEATURES`). Na compra direta da personalização do storefront, o cliente digita o sobrenome, o servidor cria
um produto escondido na INK e uma tela de espera mostra o andamento. Com "Continuar navegando", uma pílula ("Criando camiseta…", depois "Camiseta
pronta!") segue o cliente pelo site. Esta feature mostra a **mesma pílula nas páginas da INK** (loja.useorigens.com.br), que são outra origem e não
leem o armazenamento do site.

## O que aparece

- **Pílula** no centro de baixo da página de produto e das páginas de casca, entre o botão de cupons (esquerda) e o assistente (direita).
  - Visual igual ao do storefront: borda de 2px na cor de tinta, texto em negrito de 14px, altura mínima de 48px e o ícone de camiseta.
  - Fazendo: "Criando camiseta…", com um pontinho amarelo pulsando.
  - Pronta: "Camiseta pronta!" (ou "2 camisetas prontas!"), cheia na cor da região (`theme.primary` em `stores.js`; no Sul, `#4d543d`). Pulsa
    (`uo-glow`) e dá uma mexidinha a cada 2,8 s (`uo-nudge`). As duas animações são as do storefront e só existem com
    `prefers-reduced-motion: no-preference`. A mexidinha usa a propriedade `rotate`, para não brigar com o `translate` que centraliza a pílula.
  - Só falhas ("não deu"): "Sua camiseta".
- **Painel** (toque na pílula): "Sua camiseta" / "Suas camisetas" e "Fechar". Não é modal: Esc ou um toque fora também fecham. Para cada camiseta:
  - o rótulo (ex.: "Universitário", "Eu vim pela ceia · Infantil");
  - os quatro passos, com o atual marcado: 1 "Arte com o nome", 2 "Camiseta criada na loja", 3 "Tirando as fotos", 4 "Abrindo a sua camiseta"
    (`queued` → passo 1, `creating` → 2, `photos` → 3, `ready` → os quatro feitos);
  - pronta: a foto da INK e **"Ver minha camiseta"**, que tira o id do cookie e segue o link (o Turbo da INK faz a visita);
  - `failed`/`check` (ou pronta sem link): "Não deu para criar agora. A equipe pode mandar o link.";
  - sempre **"Tirar da lista"**.
- **Espaço**: as mesmas regras do botão de cupons e do assistente.
  - Sobe acima da barra fixa do "Adicionar ao carrinho" do celular (`#add-to-cart-mob` e `.form-product-options__add-to-cart-mobile`) e do aviso de
    cookies.
  - Some com o carrinho, um modal, o menu, o painel do assistente ou dos cupons, o "Ajuda?" nativo aberto e o teclado virtual. Também some sem espaço
    sob o cabeçalho e quando cobriria controles do formulário de compra ou os botões do guia.
  - No celular, a largura é limitada a `100vw - 176px`, o mesmo cálculo do storefront, para não encostar nos botões dos cantos.
  - `data-wait-hidden` no `#o-wait` diz por que ela saiu da frente.

## Contrato com o storefront (fixo)

1. **Cookie `uo_produtos`**, gravado pelo storefront com `Domain=.useorigens.com.br; Path=/; Max-Age=86400; SameSite=Lax; Secure`, sem
   `HttpOnly`.
   - Valor: até 6 ids de trabalho separados por `.`. Cada id é um ULID (`/^[0-9A-HJKMNP-TV-Z]{26}$/`); o que não casa é ignorado.
   - O cookie é a verdade compartilhada de **quais** camisetas a pessoa acompanha. "Ver minha camiseta" e "Tirar da lista" na INK regravam o cookie
     com os mesmos atributos e o apagam (`Max-Age=0`) quando fica vazio; o storefront lê o mesmo cookie, então a camiseta some lá também.
   - É o único cookie que o loader lê ou escreve. Fora de `*.useorigens.com.br` o módulo não lê nem grava nada.
2. **`GET <storefront>/api/personalizar/produto/<id>`** → 200 `{ id, label, status, url, image }` ou 404 JSON; `Cache-Control: no-store`.
   - Lê `x-origens-visitor` como chave do limite por visitante. O storefront não envia CORS: só o Worker fala com ele.
3. **Estados**: `queued`, `creating`, `photos` = em andamento; `ready` = pronta; `failed`, `check` = não deu automaticamente (a equipe assume).

## Gateway `GET /__origens/produto/<id>`

Arquivo `src/product-wait-gateway.js`, mesmo desenho de `src/assistant-gateway.js`.

- Só existe com `ENABLE_WIDGET=true` + `product-wait`. Sem isso, a INK responde o caminho (o 404 dela).
- O id precisa ser um ULID, senão 400 JSON. Só GET/HEAD (405 nos demais).
- A origem é fixa (`stores.js → storefront`), sem Cookie nem Authorization do visitante. Vai só o hash do endereço em `x-origens-visitor`, o mesmo
  do assistente (`visitorKey`).
- Timeout de 4 s, limite de 4 KB, sem cache.
- **Validação campo a campo**:
  - `id` igual ao pedido;
  - `status` do vocabulário fechado;
  - `label` numa linha, até 90 caracteres, sem controle nem `<`/`>`;
  - `url` e `image` só em `ready`;
  - `url` só https no host DESTA loja na INK (`loja.useorigens.com.br`), no caminho canônico de produto (`/useorigens/product/<slug>`), sem query,
    fragmento, credenciais ou porta, remontada a partir da loja;
  - `image` só do CDN da INK (`gcp-images.majestic.ink.rsvcloud.com`);
  - campos a mais são ignorados.
- **Respostas**: 200 `no-store` com só os cinco campos; 404 JSON do storefront → 404 JSON; qualquer outra coisa (campo fora do contrato, HTML,
  redirect, 5xx, corpo grande, falha de rede) → 503 JSON. O log leva só o motivo, nunca o id.

## Cliente (`src/loader/product-wait.js`)

Widget `shell: true` (produto e casca).

- Monta só com ao menos um id válido no cookie, e só desenha a pílula quando ao menos um deles respondeu 200. Um cookie velho, com trabalhos que o
  storefront não conhece mais, não mostra nada.
- Pergunta a cada 5 s, só com a aba visível e só pelos que ainda estão sendo feitos. Pronta, `failed` ou `check` param de ser consultadas. Ao
  voltar a aba, pergunta na hora.
- O estado fica em memória: o Turbo mantém o JS entre páginas, então a pílula volta na hora depois de cada navegação, sem pedido extra dentro dos 5 s.
- 404 ou 503: a última resposta boa continua valendo e a próxima pergunta espera mais (15 s, 30 s, depois 60 s). **Um id nunca sai do cookie por
  erro**, só pelos dois toques da pessoa.
- Todo texto entra por `textContent`. Link e foto são revalidados aqui.

## Limites conhecidos

- **Limite por visitante do storefront**: 300 consultas a cada 10 min por chave. Ele responde **404** quando estoura, igual a um id desconhecido.
  - Com 3 ou mais camisetas em andamento ao mesmo tempo, 5 s por camiseta passa do limite. A pílula então fica no último estado conhecido e pergunta
    com mais espaço (as esperas acima) até o limite liberar.
  - A chave é o hash do endereço: pessoas atrás do mesmo IP (CGNAT, Wi-Fi de empresa) dividem a chave.
- **Link num host antigo**: o link vem da API da INK (`url` do produto criado), e o storefront aceita qualquer host de loja da INK
  (`www.usesul.com.br` etc.). Uma camiseta pronta com link fora de `loja.useorigens.com.br/useorigens` sai do contrato daqui (503) e fica como
  "Criando camiseta…" na INK, mesmo pronta no storefront. Conferir o host do primeiro produto real antes de ligar (o exemplo do contrato é o do
  domínio novo).
- **Só na loja única no domínio novo** (`SINGLE_STORE_DOMAIN=next`, Worker `use-sul-widget`): só lá o cookie de `.useorigens.com.br` chega. Nos
  Workers do Norte e do Centro-Oeste a feature não faz nada (e o release de rotina deles nunca a liga: `OPT_IN_FEATURES`).
- Medição (GA4): nenhuma por enquanto.

## Testes

- `test/product-wait.dom.test.js` (jsdom, PDP real da INK, domínio `loja.useorigens.com.br`, relógio acelerado):
  - sem cookie, cookie com lixo ou fora do domínio = nada;
  - "Criando camiseta…" com o ponto; "Camiseta pronta!" com a classe de atenção (`o-wait-nudge`), as animações e o bloco de movimento;
  - painel e passos;
  - "Tirar da lista" e "Ver minha camiseta" regravando o cookie com os atributos exatos;
  - consulta a cada 5 s só com a aba visível; 404 sem pílula e sem mexer no cookie;
  - acima da barra fixa; Turbo.
- `test/product-wait-gateway.workerd.test.js` (workerd real): formato do id, contrato campo a campo, flag desligada = rota da INK, 400 para id
  ruim, cabeçalhos enviados ao storefront, 404/503, loader com e sem o módulo.
- `test/theme-release.test.js` (`evaluateProductWait`) e `test/store-release.test.js` (um release de rotina nunca liga `product-wait`).

## Ligar (passo do dono)

Pré-requisitos:

1. A compra direta do storefront no ar (branch `feature/personalizacao-produto-ink` do useorigens), com `GET /api/personalizar/produto/<id>` e o
   cookie `uo_produtos`.
2. Este branch mergeado na `main` do worker-lojas.

Não há rota nova: `loja.useorigens.com.br/__origens/*` já está em `wrangler.production.toml`. A feature entra em **`WIDGET_FEATURES` do Worker
`use-sul-widget`**. O release do tema passa a variável por `--var`, preservando as demais features, o modo, o escopo e a allowlist de hoje.

```bash
bash scripts/release-tema.sh --check --add=product-wait    # somente leitura: pré-condições, plano e dry-run
bash scripts/release-tema.sh --deploy --add=product-wait   # o dono, com `npx wrangler login` feito e a frase PUBLICAR-TEMA-INK
```

- Antes do deploy, o script confere que o storefront responde um id que não existe (`00000000000000000000000000`) com 404 JSON. Uma página 404 em HTML
  quer dizer que a compra direta ainda não está no ar.
- Depois do deploy, confere que `/__origens/produto/<id>` responde o mesmo 404 JSON (o nosso gateway; o 404 da INK é HTML) e que o loader da PDP traz
  o módulo.
- Falha = rollback automático para a versão capturada.
- Código novo com a feature já no ar: `bash scripts/release-tema.sh --deploy --update`, que repete essa conferência.

## Rollback

- `npx wrangler rollback <versão capturada> --name use-sul-widget --yes`. O script imprime a versão no fim, e ela fica em
  `.release/tema-capture-*.json`. A pílula some da INK na hora.
- Mais tarde, com outros releases já no ar, voltar à versão capturada desfaria esses também. Para tirar só `product-wait`, publicar de novo com
  `WIDGET_FEATURES` igual à de produção menos a chave, pelo mesmo caminho de `--var` (o `release-tema.sh` só acrescenta chaves). Nunca um
  `wrangler deploy` sem as `--var`: o TOML é fail-closed.
- O cookie fica como está: é do storefront, que continua usando.
- Nada na compra depende disto. Com a feature desligada, a INK fica exatamente como é.
