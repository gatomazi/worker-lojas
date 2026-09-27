# Contrato da sessão de compra "Meus Lugares" (storefront → INK)

Estado (2026-09-27): implementado dos dois lados, **não publicado**. Feature `list-session`, loader 4.7. Direção
**oposta** à do espelho do carrinho (`storefront-cart-mirror-contract.md`): lá o Worker MINTA e o storefront LÊ; aqui
o **storefront MINTA e VERIFICA**, o Worker só relay o id de volta e reexpõe a resposta no domínio da INK.

## Princípios

- **Sem banco/KV novo em nenhum dos dois lados.** O id da sessão é auto-descritivo e assinado (HMAC-SHA256) pelo
  storefront; o Worker nunca o interpreta, só o repassa.
- **A chave de assinatura nunca é compartilhada.** Só o storefront (`LIST_SESSION_SECRET`) mina e verifica; o
  Worker é um relay burro. Isso evita o problema operacional de manter um segredo sincronizado entre dois deploys
  independentes.
- **"Produto adicionado" é sempre o sinal já existente e confiável do drawer** (`drawer-watch.js`/`isOpen()`: texto
  "Produto adicionado" + botões nativos presentes) — nunca um parâmetro de query nem uma simples visita à página.
- **Progresso é local, não um contador de servidor.** O cliente (list-watch.js) mantém, em `sessionStorage` desta
  aba, os ids já confirmados adicionados nesta sessão, e os envia como `done=` a cada leitura — puramente
  informativo (decide só QUAL produto público sugerir a seguir), nunca controle de acesso: mesmo um `done`
  fabricado só pode "pular" para outro produto que já estava na sessão original, assinada pelo storefront.
- **Idempotente por construção.** Repetir a mesma leitura com o mesmo `done` dá exatamente a mesma resposta — não
  há contador mutável para dessincronizar entre abas, atualizações de página ou eventos de adição repetidos.
- **Nunca um open redirect.** A URL do próximo produto só é aceita pelo Worker se `https:` e host == desta loja.

## Fluxo

```text
Storefront (Next.js)                         Worker use-sul-widget                              Serra (INK)
 ├─ POST /api/buy-session {storeKey, ids} (mesma origem, do próprio /meus-lugares)
 ├─ revalida cada id no catálogo AO VIVO (nunca confia em preço/título/URL do cliente)
 ├─ mina id = base64url(payload).base64url(hmac) — SEM banco, SEM KV
 │◀ {sessionId, firstProductUrl}
 └─ redireciona para firstProductUrl?ls=<sessionId>
                                                                                          página do 1º produto ▶
                                              ◀─ loader lê ?ls=, guarda em sessionStorage, limpa a URL
                            drawer "Produto adicionado" abre (sinal já existente e confiável)
                                              ├─ marca o produto ATUAL como "done" (sessionStorage desta aba)
                            GET /__origens/list-session?ls=<id>&done=<ids>  ─────────────────▶
                                              │  (mesmo desenho de navbar-gateway.js: origem fixa,
                                              │   sem Cookie/Authorization, timeout 2s, schema estrito)
                                                                    GET /api/buy-session/<id>?done=<ids> (server-to-server)
                                                                    verifica HMAC + validade, resolve cada id
                                                                    ainda não-`done` contra o catálogo AO VIVO
                                                                    ◀ {next:{...}|null, position, total}
                                              ◀─────────────────────────────────────────────
                            card "Sua próxima camiseta" (foto/nome/contador/"Ver próxima →")
                            href leva ?ls=<id> de novo (a sessão acompanha a navegação)
```

## Endpoints

| Endpoint | Quem chama | Regras |
|----------|-----------|--------|
| `POST /api/buy-session` (storefront) | o navegador, mesma origem, de `/[region]/meus-lugares` | Corpo `{storeKey, inkProductIds}`; cada id é revalidado contra o catálogo ao vivo (nunca confia em preço/URL/título do cliente); ids inelegíveis são descartados silenciosamente; `422` se nenhum sobrar. Mina um id assinado (HMAC, TTL 1h, até 24 ids). `501 not_configured` se `LIST_SESSION_SECRET` não estiver definida |
| `GET /api/buy-session/<id>` (storefront) | **só este Worker, servidor-a-servidor** | Aceita `?done=<ids>` (informativo). Verifica assinatura + TTL; `404` para inválido/expirado/adulterado (indistinguíveis, como `/api/cart-mirror`). `200` sempre com `{next, position, total}` — `next: null` quando tudo já foi confirmado. `Cache-Control: no-store`. O id nunca é logado |
| `GET /__origens/list-session?ls=&done=` (este Worker) | o loader (list-watch.js), mesma origem da INK | Repassa para `GET /api/buy-session/<id>` (`fetch` novo, sem Cookie/Authorization, timeout 2s, corpo ≤ 4 KB). Valida a URL do próximo produto (`https:`, host desta loja) antes de devolver. Qualquer falha (rede, schema, host errado, timeout) vira `{next:null}` **200** — nunca quebra o drawer nativo |

Habilitação no Worker: `ENABLE_WIDGET=true` **e** `WIDGET_FEATURES` contendo `list-session`. Sem isso, a INK responde
(404 dela) para `/__origens/list-session`, e o loader nunca inclui `list-watch.js` no bundle.

## Payload do `next` (o que o Worker repassa ao cliente, já validado)

```json
{
  "next": {
    "inkProductId": "222",
    "title": "Feito em Florianópolis",
    "imageUrl": "https://gcp-images.majestic.ink.rsvcloud.com/images/product_v2/<hash>.jpg",
    "url": "https://www.usesul.com.br/usesul/product/produto-222"
  },
  "position": 1,
  "total": 3
}
```

`url` sempre `https:` e do host desta loja (validado tanto no storefront quanto de novo aqui, defesa em
profundidade). Sem produto seguinte: `{"next": null, "position": total, "total": total}`.

## Comportamento do cliente (`list-watch.js`)

- Captura `?ls=` da URL (uma vez, na chegada), guarda em `sessionStorage` (`origens:ls`) e limpa o parâmetro —
  igual ao `?cart_ref=` do storefront. Sem `?ls=` na URL, usa o que já estiver guardado (a sessão sobrevive a
  navegar por outros produtos da INK sem o nosso link).
- Ao confirmar a adição (o mesmo sinal de `post-add-discovery`), marca o produto ATUAL como feito
  (`sessionStorage`, `origens:ls:done`, um Set — repetir o mesmo id não muda nada) e busca o próximo.
- Card "Sua próxima camiseta": foto, nome, contador (`N de total`) e "Ver próxima →", inserido no mesmo ponto de
  `post-add-discovery` (entre os botões nativos e "As mais vendidas"), nunca dentro do formulário nativo. O link
  para a próxima página leva `data-turbo="false"` — é o único link MESMA ORIGEM (INK → INK) que este código
  injeta; sem isso o Turbo Drive da INK intercepta o clique como uma visita e a navegação real nunca acontece
  (achado em produção durante o aceite real).
- **Pré-busca (latência)**: `mount()` já dispara a mesma pergunta ao gateway assim que a página carrega, apostando
  que o produto DESTA página será o confirmado (`done` especulativo = done atual + produto atual, nunca gravado
  de verdade). Na maioria dos casos reais (escolher variante/tamanho leva bem mais que a ida-e-volta ao Worker,
  ~300ms medidos em produção) a resposta já está pronta quando o add é confirmado, e o card aparece junto dos
  botões nativos em vez de com um atraso perceptível depois deles. Se a aposta errar (ex.: troca de variante muda
  o produto da página antes do add), `check()` detecta a chave errada e busca de novo — nunca mostra um palpite
  errado. A pré-busca é lida por chave estável (sessão + conjunto `done` ordenado), então nunca duplica a mesma
  pergunta entre montagens seguidas da mesma página.
- Sem sessão válida, sessão esgotada ou qualquer falha: nada é mostrado — a área "Encontre a próxima camiseta" e
  os controles nativos (Ver carrinho / Continuar comprando) seguem exatamente como estão.
- Independente de `post-add-discovery`: pode estar ligada mesmo com o bloco genérico de descoberta desligado.

## Testes

- `test/list-session.workerd.test.js` — gateway no workerd real (Miniflare): relay, validação de schema/host,
  fail-open, feature gate, health.
- `test/list-watch.dom.test.js` — widget cliente (jsdom): captura/limpeza de `?ls=`, sessão persistida, marcação
  de "done", card, fallback silencioso, idempotência.
- Lado storefront: `tests/unit/favorites-session.test.ts` (mint/verify), `tests/integration/buy-session.test.ts`
  (as duas rotas) no repositório `useorigens`.
