# Guia na página de produto (`pdp-guide`): "Procurando sua cidade ou outra estampa?"

Data: 13/10/2026. Estado: **código pronto, testado localmente e em navegador real contra as PDPs reais das três lojas; NÃO publicado** (nenhum deploy, nenhuma rota tocada). Loader **5.2**. Rodada e evidências completas: `useorigens/docs/relatorio-conversao-use-origens.md`.

## 1. O que é

Uma ajuda guiada, opcional e discreta, para quem chega numa página de produto da INK que não é a estampa que procurava. Substitui o bloco "Continue explorando" (`product-discovery`) quando a flag está ligada; nunca os dois.

- **Convite** (na página, logo abaixo do CTA nativo, dos selos e das bandeiras; fora do `<form>` e do turbo-frame que a INK recarrega): **Procurando sua cidade ou outra estampa?** com **[Buscar uma cidade] [Ver outras estampas]** e, quando o produto é de uma cidade, **[Mais estampas de <cidade>]**. ✕ dispensa.
- **Painel** (folha inferior no celular, diálogo compacto no desktop; só por toque, nunca sozinho):
  - **Caminho A — cidade:** busca com cidade + UF e apelidos (a mesma busca geográfica dos drawers, `/__origens/search`); cidade escolhida → até **3 estampas** com foto real, nome e preço da INK + "Ver todas as estampas de <cidade> (N)" (página da cidade no storefront). Um estado da busca é link para a página do estado. Cidade sem estampa: mensagem honesta + as duas outras saídas. RAs do DF vêm como lugares próprios (ex.: Taguatinga).
  - **Caminho B — estampas:** até **8 coleções reais** da região (o menu publicado no CMS, só as que têm página no site; coleções de estado ficam de fora porque a busca já cobre estados), cada uma com a foto do primeiro produto e o total; coleção escolhida → até **4 produtos** + "Ver a coleção completa (N)".
  - Um produto abre a página dele **na própria loja da INK** (link comum, mesma aba; o carrinho segue). Rodapé fixo do painel: "Ver todas as estampas na Use Origens".
  - Voltar, Fechar, Escape, foco preso dentro do diálogo e devolvido ao botão; alvos ≥ 44 px; `prefers-reduced-motion`; largura pela parte visível do documento (a PDP da INK é mais larga que a tela no celular).
- **Dispensa:** ✕ guarda `origens:guia:v1:dispensado` (`{v:1, at}`) no `localStorage` por **30 dias** e deixa uma linha discreta ("Procurando sua cidade ou outra estampa? Abrir a busca") que reabre o painel no menu das três saídas. **Limites:** vale só neste navegador e neste domínio (cada loja da INK é um domínio; o storefront é outro) e não reconhece a pessoa em outro aparelho nem sem conta. Sem armazenamento (modo privado, bloqueio), a dispensa vale só para a página aberta.
- **Nada automático:** quem escolhe cor ou tamanho não é interrompido; navegar entre PDPs mostra o convite de novo (não é onboarding, não abre nada). O contexto da cidade vem de UMA consulta por página (`?produto=<id>`), cacheada no Worker e no storefront.
- **Falhas:** busca fora → "A busca não está disponível agora…"; API do guia fora → "Não deu para carregar agora." + **Tentar de novo** + link da vitrine; sem contexto → convite com 2 botões; imagem ausente → só o fundo cinza. A compra nativa nunca depende de nada disto (só observa/insere; nunca toca em `form`, variantes, CTA, barra fixa, POST, CSRF ou checkout).

## 2. Dados

| Pedido do navegador (mesma origem, `credentials: omit`) | O Worker lê no storefront (servidor, sem Cookie/Authorization, timeout 2,5 s, ≤ 24 KB) | Cache |
|---|---|---|
| `GET /__origens/guia?produto=<id>` | `/api/guia/<região>?produto=<id>` → `{ city \| null }` | 300 s (edge + navegador) |
| `GET /__origens/guia?cidade=<uf>/<slug>[&produto=<id>]` | `/api/guia/<região>?cidade=…` → cidade + até 3 itens (nunca o produto aberto) | 300 s; miss 60 s |
| `GET /__origens/guia?colecao=<slug>` | `/api/guia/<região>?colecao=…` → coleção + até 4 itens | 300 s |
| `GET /__origens/guia` | `/api/guia/<região>` → até 8 coleções | 300 s |

`src/guide-gateway.js` valida item a item (link `https://<host desta loja><base>/product/<slug>` sem query; imagem no host de imagens da INK; preço 0–2000; páginas do storefront só na base desta região, host normalizado para a origem que o loader já usa) e responde **sempre 200** com `ok:false` em qualquer falha (nunca uma página de erro). Parâmetros fora do formato fechado = 400. O storefront lê só o catálogo e as coleções sincronizados + a configuração publicada: **nenhuma consulta à INK por visitante**. O loader revalida tudo de novo antes de virar link/imagem (defesa em profundidade).

## 3. Flag, rollout e rollback

- `WIDGET_FEATURES` ganha **`pdp-guide`** (fail-closed como as outras: nome desconhecido descarta a lista inteira). É **opt-in** no release por loja (`scripts/lib/store-lib.mjs`): um release de rotina não a liga sozinha.
- Com a flag: o loader entra com o módulo do guia **no lugar** de `product-discovery` (o `discovery.js` dos drawers não muda) e `/__origens/guia` responde. Sem a flag: nem o módulo nem o gateway entram; a INK responde 404 em `/__origens/guia`; o bloco "Continue explorando" volta exatamente como está hoje.
- **Ordem de publicação:** storefront primeiro (`/api/guia/<região>` precisa estar no ar; sem ele o convite aparece com 2 botões e o painel mostra o erro honesto), depois o Worker, **uma loja por vez**, com as MESMAS variáveis que estão no ar acrescentando só `,pdp-guide` (mesmo roteiro de `docs/pdp-share-size-guide.md`):
  ```bash
  npx wrangler deployments list --name use-<loja>-widget            # anotar a versão ativa (rollback)
  npx wrangler versions view <versão ativa> --name use-<loja>-widget # copiar as vars
  npx wrangler deploy -c <toml da loja> --var ENABLE_WIDGET:true --var WIDGET_SCOPE_MODE:product-catalog --var WIDGET_ALLOWLIST: \
    --var "WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror,product-discovery,header-nav,list-session,promo-fab,auto-recommendations,pdp-share,size-guide,pdp-guide"
  curl -s https://www.<loja>.com.br/__origens/health   # version 5.2, pdp-guide na lista
  PW_PATH=<playwright-core> GUIDE_API=https://www.useorigens.com.br node scripts/qa-guide.mjs --stores=<loja>   # QA ao vivo
  ```
  Norte e Centro-Oeste **sempre** com o TOML resolvido a partir do TOML completo (9 rotas; `store-routes.mjs <loja> verify --stage=shell` depois).
- **Rollback:** (a) só o guia: republicar com as mesmas vars **sem** `,pdp-guide` (o bloco anterior volta); (b) tudo: `npx wrangler rollback <versão anotada> --name use-<loja>-widget`. As rotas da zona não mudam nesta rodada.
- **Comparação (variante estável):** a flag é por loja e por deploy, não por visitante (não existe experimentação por visitante no projeto e esta rodada não cria uma). Dá para comparar (1) antes × depois na mesma loja, e (2) loja com guia × loja sem guia no mesmo período. Todo evento do guia leva `feature_version: guide_v1`; o bloco anterior é identificado pelos eventos que já existem (`origens_discovery_search_open`, `origens_explore_storefront_click` com `entry_point=ink_product_detail`).

## 4. Eventos (GA4, pelo gtag que a própria INK carrega; só depois do aceite do aviso de cookies dela; `transport_type: beacon`)

Parâmetros comuns: `send_to` (propriedade da loja), `region`, `surface: ink`, `entry_point: ink_product_detail`, `feature_version: guide_v1`, `product_slug` (slug da PDP aberta). Nunca: texto digitado, `cart_ref`, URL com query, dado pessoal.

| Evento | Quando | Parâmetros próprios |
|---|---|---|
| `origens_guide_view` | convite ≥ 50 % visível na tela, uma vez por página (IntersectionObserver) | — |
| `origens_guide_open` | painel aberto por toque | `guide_path`: `city` \| `prints` \| `city_context` \| `reopen` |
| `origens_guide_dismiss` | ✕ no convite | — |
| `origens_guide_city_select` | cidade escolhida na busca | `city_slug`, `uf` |
| `origens_guide_results` | resultados desenhados (cidade ou coleção) | `guide_path`, `result_count`, `has_results` |
| `origens_guide_product_click` | clique num produto do guia (PDP da INK) | `guide_path`, `position`, `target_product_id` |
| `origens_guide_error` | busca ou API do guia falhou | `guide_step`: `city_search` \| `city_results` \| `collections` \| `collection_results` |
| `origens_explore_storefront_click` (já existia) | links do guia para o storefront ("Ver todas as estampas de…", "Ver a coleção completa", rodapé) | `entry_point=ink_product_detail`; o storefront conta `origens_storefront_arrived` com o marcador `origens_src`/`origens_p` |

Nenhum evento padrão (PageView, ViewContent, AddToCart, Purchase) é enviado ou duplicado. Produto escolhido → a PDP da INK dispara os eventos nativos dela normalmente.

## 5. Testes e QA

| Suíte | Resultado (13/10/2026) |
|---|---|
| `npm test` (workerd + jsdom) | **518/518** (base 497; +13 `pdp-guide.dom.test.js`, +6 `guide-gateway.workerd.test.js`, +2 navbar) |
| `scripts/qa-guide.mjs` em navegador real (Chrome, INK real das 3 lojas, Worker local Miniflare, `/api/guia` do storefront local, analytics bloqueado) | Sul 1440/390/375/320 + Norte e Centro-Oeste 1440/390: convite, busca (Floripa, Manaus, Taguatinga), estampas da cidade, "Mais estampas de…", coleções, coleção, voltar, Tab preso, Escape, dispensa e recarga, reabertura, API fora/Tentar de novo, variantes escolhidas sem abrir o guia, adicionar ao carrinho e drawer com "Finalizar compra" (não clicado), produto do guia abrindo a PDP dele. Capturas em `useorigens/docs/screenshots/conversao-use-origens/*-guia-*-depois.png` |

Também nesta rodada (mesmo PR): `promo-fab` recolhe no celular enquanto o aviso de cookies da INK está na tela e nunca cobre o preço nem os botões do guia; navbar da INK com **"Estados"** (era "Regiões"), **"Categorias"** (era "Demais categorias"; o CMS pode renomear via `moreLabel`) e links para as páginas de coleção do site quando o CMS as manda (`url` do storefront → `page`; senão a página da INK, como antes); `auto-recommendations` ancora depois do convite.
