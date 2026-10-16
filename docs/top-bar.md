# top-bar: a "Faixa do topo" do CMS na faixa preta da INK

Feature **opt-in** `top-bar` (`WIDGET_FEATURES`). Troca as frases nativas da faixa preta do cabeçalho da INK (`header .header-benefits`: "Parcele em até 5x",
"Frete grátis para PR, RS, SC", "Primeira troca sem custo") pelas mensagens publicadas no painel do storefront (**Marketing → Faixa do topo**), por região.

- **Dados:** `GET /__origens/top-bar` (só com `ENABLE_WIDGET=true` + `top-bar`; senão a INK responde o caminho). O Worker lê `<storefront>/api/top-bar/<região>`
  no servidor (`stores.js → topBarApi`), sem cabeçalhos do visitante, com timeout de 3 s, limite de 16 KB, cache de 30 s e contrato estrito `v: 1`. O texto
  já vem preenchido (`{producao}`, `{faltam}`); `href` precisa ser um caminho do storefront da MESMA região e sai como URL absoluta. Falha = 503 e nada muda.
- **Loja única:** a região vem do visitante (`storeView`), como a navbar e os cupons. O visitante do Norte vê a faixa do Norte.
- **Cliente** (`src/loader/top-bar.js`, widget `shell: true`: produto e casca): uma busca por minuto (sessionStorage). As frases nativas são escondidas só por
  CSS (o nó da INK continua no DOM) e as nossas entram no mesmo lugar. Mais de uma mensagem = revezam a cada 5 s, com pausa sob o ponteiro e com o foco,
  e ficam paradas com `prefers-reduced-motion`. Texto só por `textContent`.
- **Turbo:** o `turbo:before-cache` desmonta tudo ANTES do `turbo:before-render`. Por isso o estado e o ouvinte de `turbo:before-render` ficam no módulo
  (não no widget): o corpo novo ganha a faixa antes de ser pintado, sem "piscar" a frase da INK, e só quando o destino (`turbo:visit`) está no escopo.
- **Fail-open:** erro, lista vazia, payload fora do contrato ou feature desligada deixam a faixa da INK exatamente como veio.
- **Testes:** `test/top-bar-gateway.workerd.test.js` (workerd real) e `test/top-bar.dom.test.js` (jsdom com o cabeçalho real da INK).

## Ligar (passo do dono)

Depende do storefront com `/api/top-bar/<região>` no ar e da faixa publicada no painel. Depois, publicar o Worker da Sul com `top-bar` somado às features
que já estão no ar. `scripts/lib/store-lib.mjs` lista `top-bar` em `OPT_IN_FEATURES`, então um release de rotina nunca a liga sozinho.
Rollback = tirar `top-bar` de `WIDGET_FEATURES`; a faixa da INK volta na hora.
