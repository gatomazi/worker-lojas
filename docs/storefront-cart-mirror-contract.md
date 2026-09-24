# Contrato do espelho do carrinho (INK → storefront)

Estado: **Worker e loader prontos e testados; ligados por flag, DESLIGADOS em produção.** O consumidor no storefront (repositório `useorigens`, Next.js) **não foi implementado nem alterado** nesta rodada. Este documento é o contrato para implementá-lo com segurança.

## Princípios

- O carrinho verdadeiro é **sempre o da INK**. O storefront só exibe um **espelho do último estado conhecido**, rotulado com a idade. Nunca "tempo real", nunca transacional, nunca calcula preço, frete ou desconto.
- Nada de cookie/sessão/CSRF da INK, endereço, pagamento ou dados pessoais entra no snapshot.
- Sem `localStorage` compartilhado entre domínios: a ponte é um **token opaco temporário** (opção A do briefing).

## Fluxo

```text
Serra (INK)                                  Worker use-sul-widget                      Storefront (Next.js, servidor)
 ├─ cart-mirror lê turbo-frame#cart (DOM)
 ├─ POST /__origens/cart-ref  {snapshot}  ─▶  valida (Origin/Referer/JSON/schema) ─▶ KV CART_REFS (TTL 30 min)  ◀─ GET /__origens/cart-ref/<ref>
 │◀─ {ref, ttl}                                                                        (fetch do SERVIDOR; sem CORS)
 └─ clique no NOSSO link para /sul  ─▶ href ganha ?cart_ref=<ref> (só links nossos) ─▶ /sul?cart_ref=<ref>
```

## Endpoints do Worker (todos sob `www.usesul.com.br`, rota `/__origens/*`)

| Endpoint | Quem chama | Regras |
|----------|-----------|--------|
| `POST /__origens/cart-ref` | o loader, na página autorizada da INK | `Origin` = `https://www.usesul.com.br`, `Referer` na allowlist, `Sec-Fetch-Site: same-origin`, `Content-Type: application/json`, corpo ≤ 8 KB, esquema v1 estrito, ≤ 20 itens, 20 req/min por IP (memória do isolate). Devolve `201 {ref, ttl:1800}`. Erros: 400/403/413/429; **501 `not_configured`** se o KV não existir |
| `GET /__origens/cart-ref/<ref>` | **somente o servidor do storefront** | `ref` = 22 caracteres base64url (128 bits). `200` com o snapshot + `ageSeconds` + `expiresInSeconds`; `404` para token desconhecido, malformado ou expirado (indistinguíveis). `Cache-Control: no-store`, **sem CORS** (o navegador do storefront não deve chamá-lo) |
| `GET /__origens/search?q=` | loader (já em produção) | inalterado |

Habilitação: `ENABLE_WIDGET=true` **e** `WIDGET_FEATURES` contendo `cart-mirror` **e** o binding KV `CART_REFS`. Sem qualquer um, a INK responde (404 dela) ou o Worker responde 501.

## Snapshot v1 (o que o GET devolve)

```json
{
  "v": 1,
  "count": 2,
  "items": [{
    "productId": "4932916", "name": "Serra Catarinense", "color": "Preta", "size": "M",
    "variant": "Preta-Masculino-M", "quantity": 2,
    "linePriceText": "R$ 199,80", "linePrice": 199.8,
    "listPriceText": "R$ 219,80", "listPrice": 219.8,
    "image": "https://gcp-images.majestic.ink.rsvcloud.com/images/product_art/final_image/<hash>.jpg"
  }],
  "subtotal": 219.8, "discount": 20, "total": 199.8, "totalText": "R$ 199,80",
  "ageSeconds": 42, "expiresInSeconds": 1758
}
```

- `linePrice`/`linePriceText` é o **preço efetivo da linha** exibido pela INK (já × quantidade e já com promoção por quantidade). `listPrice`/`listPriceText` (opcional) é o preço cheio **riscado**: só existe quando há promoção. Não derive preço unitário.
- `subtotal` (soma dos preços cheios) e `discount` vêm dos `data-*` da INK. `total`/`totalText` (opcional) é o **total exibido** pela INK, lido do DOM: o storefront **nunca** recalcula nada. **Frete não existe** no snapshot (só aparece na INK depois do CEP).
- Carrinhos reais têm várias linhas (cada variante é uma linha): até **20 itens** por snapshot.
- Carrinho vazio: `count: 0, items: []` (é o que "limpa" o espelho).
- A imagem só é aceita se for `https` no host da CDN da INK; o `next.config` do storefront hoje só libera `/images/product_v2/**` — **é preciso liberar também `/images/product_art/**`** para exibir essas miniaturas.

## O que o storefront deve fazer (implementação de referência, não aplicada)

1. **Rota de servidor** (ex.: `app/api/cart-mirror/route.ts`): lê `ref` da query, valida `^[A-Za-z0-9_-]{22}$`, faz `fetch('https://www.usesul.com.br/__origens/cart-ref/'+ref, { cache: 'no-store', signal: AbortSignal.timeout(2000), headers: {} })` **sem cookies**, valida o esquema, devolve JSON `no-store` (ou `404`). Nunca registrar o `ref` em logs/analytics.
2. **Cliente**: ao ver `?cart_ref=` em `/sul...`, guardar o `ref` em `sessionStorage` (mesma origem do storefront) e **remover o parâmetro da URL** (`router.replace`). Buscar o espelho por essa rota; `404` ou `ageSeconds > 1800` ⇒ **estado neutro** (não mostrar itens).
3. **UI "Meu carrinho"**: "`N` produtos na INK", linhas (nome, `cor · tamanho`, preço da linha, miniatura), rótulo **"Última atualização há X min"** (nunca "agora" se `ageSeconds` > ~30 s) e aviso curto: "Este resumo pode estar desatualizado; o carrinho oficial é o da INK."
4. **Ações**: **"Continuar escolhendo"** (mantém no storefront) e **"Ir para meu carrinho"** →
   `https://www.usesul.com.br/usesul/product/serra-catarinense?origens_open_cart=1`
   (abre o **drawer nativo** da INK; ver abaixo). **Não** há botão "Finalizar compra" no storefront.

## Por que "Ir para meu carrinho" abre o drawer, e não `/usesul/cart`

Auditado em sessão anônima: `GET /usesul/cart` (com sessão) devolve **200, mas é o fragmento do drawer sem layout/CSS** (ícone gigante, sem estilos): não é uma página de carrinho utilizável. O carrinho real da INK é o **drawer** aberto numa página com o layout. O loader, na página autorizada, entende `?origens_open_cart=1`: ativa o botão nativo do carrinho (até 8 tentativas em ~4 s, sem alterar o carrinho) e remove o parâmetro da URL. **Limitação do piloto:** só funciona na URL da allowlist (hoje a Serra); ao ampliar a allowlist, a mesma URL de retorno passa a poder ser qualquer página autorizada.

## Provisionamento (aprovação e login do proprietário; NADA disto foi feito)

```bash
npx wrangler kv namespace create CART_REFS          # anote o id
# wrangler.production.toml:
#   [[kv_namespaces]]
#   binding = "CART_REFS"
#   id = "<id>"
npx wrangler deploy -c wrangler.production.toml --var ENABLE_WIDGET:true \
  --var WIDGET_ALLOWLIST:/usesul/product/serra-catarinense \
  --var WIDGET_FEATURES:return-link,post-add-discovery,city-search,cart-discovery,cart-mirror
```

Recomendado antes de ligar: regra de rate limit da zona para `POST /__origens/cart-ref` (o limitador do Worker é só em memória por isolate), monitoração de erros 4xx/5xx do endpoint e o consumidor do storefront **já publicado** (sem consumidor o espelho grava dados que ninguém lê).

## Riscos conhecidos

- **Estado desatualizado é normal**: o loader só roda na página autorizada. Mudanças no carrinho feitas em outras páginas da INK (sem loader) **não** são vistas até a pessoa voltar à Serra. O espelho é "o último estado conhecido" e o rótulo de idade é obrigatório.
- **Token é portador**: quem tiver a URL (30 min) lê o resumo. Conteúdo: nomes, variantes, quantidades e preços de linha; nada pessoal. Mitigações: TTL curto, 128 bits, `no-store`, sem CORS, parâmetro removido da URL, sem log.
- **Estrutura da INK pode mudar**: `readCart()` devolve `null` se o DOM não bater com o auditado, e nada é espelhado (falha segura). Existe teste contra a estrutura real.
