# Redirect das lojas antigas (Use Norte e Use Centro-Oeste) para a loja única

16/10/2026. Os produtos de Norte e Centro-Oeste foram migrados para a Use Sul, que agora vende as três regiões (loja única). Os
planos das lojas antigas foram desativados, e quem chega por um link antigo vai para o lugar certo.

## O que o Worker da loja antiga faz com `LEGACY_REDIRECT=on` (`src/legacy-redirect.js`)

| Caminho | Destino |
|---|---|
| `/usenorte/product/<slug>` com correspondência no mapa | `https://www.usesul.com.br/usesul/product/<slug novo>?origens_r=norte` (o mesmo produto na loja única, com a região de origem) |
| `/usenorte/collections/<slug>` com correspondência no mapa (`c:<slug>`) | a página equivalente no storefront: estado (`/norte/ro`), coleção (`/norte/colecoes/fala-daqui`) ou busca do estilo (`/norte/busca?q=Território`) |
| produto ou coleção sem correspondência, `/usenorte`, `/products`, `/about` | `https://useorigens.com.br/norte` |
| `/usenorte/orders*`, carrinho, checkout, conta, qualquer outro | **sem redirect**: segue para a INK (quem comprou acompanha o pedido) |

- **Parâmetros:** só os de campanha seguem (`utm_*`, `fbclid`, `gclid`…).
- **Status:** 302 por padrão. `LEGACY_REDIRECT_STATUS=301` torna permanente, depois de conferido.
- **Mapa de produtos:** fica no KV `LEGACY_MAP` (slug antigo → slug novo). Vem só das correspondências **confirmadas** da reconciliação: Norte 30.575, Centro-Oeste 37.306.
- **Mapa de coleções:** mesmo KV, chave `c:<slug>`, com um caminho do storefront como valor. O Worker só aceita um destino dentro da região da loja; qualquer outro vai para a home da região. Norte 39, Centro-Oeste 34 (`redirect-colecoes-use-*.bulk.json`). O critério:
  - **estado:** UF, nome do estado e `ZZ - XX - UF` vão para `/<região>/<uf>`;
  - **estilo:** Território, Legado, Traço, Tipografia, Gentílico, Feito em, Ponto de Origem e Eixo (Coordenadas) vão para a busca do estilo, porque a loja única não tem uma coleção pública por estilo;
  - **coleção:** Da Nossa Terra e Fala Daqui vão para a coleção de mesmo nome;
  - **sem equivalente:** as linhas de merch (Made in, Básicos, Identidade, Fala de Onde, 10/10, Lenda, Dito, Personalizados…) vão para a home da região.

  Cada destino foi conferido com 200, e as buscas trazem de 448 a 504 resultados.

## Deploy (dono)

```bash
# 1. KV do mapa (um por loja) e carga
npx wrangler kv namespace create LEGACY_MAP_NORTE      # anotar o id
npx wrangler kv namespace create LEGACY_MAP_CENTRO
npx wrangler kv bulk put --namespace-id <id norte>  <...>/redirect-usenorte.bulk.json --remote
npx wrangler kv bulk put --namespace-id <id centro> <...>/redirect-usecentro.bulk.json --remote
# 2. TOML legado (mesmas rotas e KV do carrinho do TOML resolvido + LEGACY_MAP + LEGACY_REDIRECT=on)
node scripts/legacy-toml.mjs norte <id norte>
node scripts/legacy-toml.mjs centro <id centro>
# 3. deploy com as MESMAS --var da versão no ar (wrangler versions view <versão> --name use-<loja>-widget)
npx wrangler deploy -c wrangler.norte.legado.resolved.toml --var ...    # idem centro
```

**Rollback:** `npx wrangler rollback <versão anterior> --name use-<loja>-widget`. O KV pode ficar, porque sem `LEGACY_REDIRECT` ninguém o lê.
