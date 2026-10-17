# Mudança de domínio da loja única

A loja única (a Use Sul na INK) vai sair de `https://www.usesul.com.br/usesul` para `https://loja.useorigens.com.br/useorigens`. É a **mesma loja**:
os produtos, slugs, variantes, cupons e pedidos não mudam, só o host e o prefixo. O Worker está pronto e fica **dormente** até `SINGLE_STORE_DOMAIN=next`.

## O que muda com `SINGLE_STORE_DOMAIN=next`

| Onde | Comportamento |
|---|---|
| Worker da Sul em `loja.useorigens.com.br` | o mesmo de hoje (loader, navbar, regiões, carrinho), com o prefixo `/useorigens` |
| Worker da Sul em `www.usesul.com.br` | **tudo** redireciona para o mesmo caminho no domínio novo (`/usesul/x` → `/useorigens/x`, `/` → `/useorigens`), com **todos** os parâmetros. Pedidos, carrinho e checkout também, porque a INK só atende no domínio novo. A região que estava no cookie vai como `?origens_r=`. Nada chega à INK pelo domínio antigo |
| Workers de Norte e Centro-Oeste (`LEGACY_REDIRECT=on`) | o produto vai **direto** para o domínio novo, sem passar pelo antigo |

- **Status:** 302 em GET/HEAD e 307 nos outros métodos, que mantém o método. `DOMAIN_MOVE_STATUS=301` torna permanente (301/308).
- **Health no domínio antigo:** `https://www.usesul.com.br/__origens/health` continua respondendo, com `ink_host`, `former_ink_host` e `ink_domain_status`.

## Antes (sem pressa)

1. DNS na zona `useorigens.com.br`: `loja` apontando para a INK, **Proxied**, conforme a INK pedir.
2. **Storefront** (repositório useorigens, #94): já está pronto atrás de `NEXT_PUBLIC_INK_SUL_DOMAIN=next` no Railway, que entra no build.
   O sync aceita a URL da INK nos dois domínios, então nenhuma peça cai no meio da troca.
   O roteiro completo do dia, com valores, conferência e rollback, está em `docs/migracao-ink/mudanca-dominio-loja-unica.md` naquele repositório.
3. Conferir as `--var` da versão no ar (`wrangler versions view <versão> --name use-sul-widget`). Qualquer caminho com `/usesul` em `WIDGET_ALLOWLIST` passa a ser `/useorigens`.

## No dia (dono), nesta ordem

```bash
node scripts/domain-move-routes.mjs plan                          # leitura
node scripts/domain-move-routes.mjs apply --step=new-exclusion    # 1. login/carrinho/checkout do domínio novo fora do Worker
# 2. trocar o domínio no painel da INK e conferir que loja.useorigens.com.br/useorigens abre
node scripts/domain-move-toml.mjs                                  # 3. gera wrangler.useorigens.resolved.toml
npx wrangler deploy -c wrangler.useorigens.resolved.toml --dry-run --var ...
npx wrangler deploy -c wrangler.useorigens.resolved.toml --var ...    # mesmas --var da versão no ar
node scripts/domain-move-routes.mjs apply --step=drop-old          # 4. sem a exclusão antiga, www.usesul.com.br/* inteiro chama o Worker
node scripts/domain-move-routes.mjs apply --step=copy-extra        #    rotas com Worker criadas direto na zona (fora do TOML, ex.: telas do checkout do tema) também no host novo
# storefront: NEXT_PUBLIC_INK_SUL_DOMAIN=next no Railway (novo build) e um sync manual
# 5. Norte e Centro-Oeste: redeploy do TOML legado com --var SINGLE_STORE_DOMAIN:next
```

Conferência: `curl -sI https://www.usesul.com.br/usesul/product/<slug>?variant=1&utm_source=x` deve devolver um 302 para `https://loja.useorigens.com.br/useorigens/product/<slug>?variant=1&utm_source=x`.
A página nova deve trazer o loader, e `/useorigens/cart` não deve passar pelo Worker (`domain-move-routes.mjs plan`).

**Rollback:** `node scripts/domain-move-routes.mjs apply --step=restore-old`, depois `npx wrangler rollback <versão anterior> --name use-sul-widget`. O rollback só faz sentido se a INK também voltar para o domínio antigo.

O apex `usesul.com.br` hoje é DNS-only (fora da Cloudflare proxy). O Worker já reconhece esse host, mas só vai rodar nele se o registro passar a ser Proxied e ganhar uma rota `usesul.com.br/*`.
