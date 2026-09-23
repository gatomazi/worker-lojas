# Use Sul — Worker de widgets para a Reserva INK (POC)

## Objetivo

Preparar, sem alteração de produção, a técnica confirmada pelo desenvolvedor da BitGeek: Cloudflare Worker injeta um **único loader** no HTML, e o loader adiciona elementos ao DOM da loja da INK.

Nesta POC, a única alteração visual é o link **«← Voltar a procurar outra cidade»** na página de produto, apontando para `https://useorigens.com.br/sul`. A busca real do storefront, a seleção pendente e o modal pós-compra são fases futuras: **não estão implementados**.

## Estrutura

- `src/worker.js`: intercepta exclusivamente `www.usesul.com.br/usesul/product/*`, busca o HTML original e injeta um script. Também serve o script em `/usesul/product/__origens-widget.js`.
- `src/widget-source.js`: JavaScript do widget, reinicializado em navegação Turbo; procura botão nativo «Adicionar ao Carrinho» e insere o link depois dele. Seletores serão validados no DOM real antes da ativação.
- `wrangler.dev.toml`: deploy isolado em `workers.dev` para conferir build e `/__health`. **Não** é espelho da loja.
- `wrangler.production.toml`: configuração da rota real, desativada por padrão pela variável `WIDGET_ENABLED = "false"`.
- `test/worker.test.js`: testes de roteamento, segurança de escopo e não alteração do carrinho.

## Testes locais, sem DNS e sem deploy

```bash
npm install
npm test
npm run dev
curl http://localhost:8787/__health
```

`/__health` retorna `widget_enabled: false`. O `workers.dev` também permite verificar o health após `npm run deploy:staging`. Não espere que o domínio de staging renderize a INK: a origem real só fica disponível via rota `www.usesul.com.br`.

## Quando a zona estiver ativa — sequenciamento recomendado

1. Verificar Cloudflare Zone `Active`, MX/TXT da Zoho e verificações; concluir redirecionamento do ápice **separadamente**.
2. Verificar a loja e uma compra com o `www` em DNS only.
3. Ativar a nuvem laranja apenas no `www`, mantendo o CNAME original Heroku/INK. Validar HTTPS, cookies, páginas de produto, carrinho, checkout e pagamento **sem** Worker. Voltar a DNS only se falhar.
4. Com tudo estável, publicar `wrangler.production.toml` com `WIDGET_ENABLED = "false"`; a rota passa a existir, mas todas as páginas são encaminhadas intactas.
5. Após validação do DNS e do produto, alterar `WIDGET_ENABLED` para `"true"` e republicar numa janela supervisionada. Confirmar que o link aparece no produto e que o carrinho continua funcionando.
6. Caso haja qualquer problema, voltar `WIDGET_ENABLED` para `"false"` e publicar ou desassociar a rota do Worker. Se o problema for o próprio proxy, desativar a nuvem laranja para voltar a DNS only.

**Não alterar** nameservers novamente durante a transição. Não modificar carrinho, checkout, headers `Set-Cookie`, regras de sessão, TLS ou DNS dentro deste projeto.

## Limites da POC

- Não reimplementa o carrinho, não acessa endpoints privados da INK, não registra eventos de pagamento, não manipula CSRF, não altera CSS global.
- O link de retorno usa destino padrão `https://useorigens.com.br/sul`. Se o storefront fornecer o parâmetro `origens_return`, ele só será aceito se apontar para URLs HTTPS da mesma origem e dentro de `/sul`.
- Se a INK publicar CSP estrita que bloqueie o script, não reduza a segurança global para contornar. Investigue uma integração com nonce ou uma política permitida pela plataforma.
- Como os seletores DOM exatos podem mudar, a POC deve ser verificada visualmente em mobile e desktop na página real antes de lançar.
- O navegador pode preservar o carrinho da INK no vai e volta (comportamento observado pelo usuário), mas isso não é uma garantia cross-browser, cross-device ou depois da expiração da sessão.
- Testes unitários rodam com um mock do `HTMLRewriter`; não substituem validação no edge real.

## Evolução após a POC

1. Extrair a busca React existente do storefront para componente embutível ou publicá-la por um endpoint de widget, compartilhando API/catálogo.
2. Montar a busca no cabeçalho da INK e acrescentar a busca contextual na página de produto.
3. Detectar o drawer/modal nativo após a confirmação de adição ao carrinho e adicionar busca + botão de volta; nunca considerar clique como confirmação de compra.
4. Se houver lista opcional de produtos escolhidos no storefront, transportar somente um identificador opaco e temporário, nunca estado de carrinho como verdade paralela.

## Documentação oficial

- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/examples/turnstile-html-rewriter/
