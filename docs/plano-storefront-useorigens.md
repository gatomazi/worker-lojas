# Plano curto — consumidor do espelho do carrinho no storefront (`useorigens`)

Não implementado e não publicado. Referência: `docs/storefront-cart-mirror-contract.md`. Pré-requisito: provisionar KV `CART_REFS` e ligar `cart-mirror` no Worker **depois** deste consumidor estar em produção (sem consumidor o espelho grava dados que ninguém lê).

1. **Rota server-side** `app/api/cart-mirror/route.ts`: lê `ref`, valida `^[A-Za-z0-9_-]{22}$`, `fetch('https://www.usesul.com.br/__origens/cart-ref/'+ref, { cache: 'no-store', signal: AbortSignal.timeout(2000) })` sem cookies, valida o esquema v1, responde `no-store` (404 se desconhecido/expirado). Nunca logar o `ref`.
2. **`sessionStorage` só do `cart_ref`** (nunca o snapshot). Ao ver `?cart_ref=` em `/sul...`, guardar e **remover o parâmetro da URL** (`router.replace`).
3. **UI "Meu carrinho"**: N produtos, linhas (nome, `cor · tamanho`, preço da linha, miniatura), preço cheio riscado quando existir; total exibido pela INK; nada calculado no storefront.
4. **Rótulo de idade** ("Última atualização há X min", nunca "agora" se `ageSeconds` > ~30 s) e **aviso de snapshot**: "Este resumo pode estar desatualizado; o carrinho oficial é o da INK."
5. **Estado neutro** se 404 ou `ageSeconds` > 1800.
6. **Ações**: "Continuar escolhendo" (fica no storefront) e "Ir para meu carrinho" → `https://www.usesul.com.br/usesul/product/serra-catarinense?origens_open_cart=1` (abre o drawer nativo). **Sem "Finalizar compra"**.
7. **`next.config`**: liberar a CDN da INK em `/images/product_art/**` (hoje só `/images/product_v2/**`).
8. Testes: rota (ref inválido, 404, timeout, esquema inválido), UI (idade, aviso, vazio), sem vazamento de `ref` em logs/URL.
