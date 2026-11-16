# Topo da Use Origens na loja da Uma Penca (artigos.useorigens.com.br)

**Problema.** Quem clica numa caneca vai parar em `artigos.useorigens.com.br`, a loja da Uma Penca, e lá não havia caminho de volta: o topo era só
"Use Origens · Loja · Contato". Na INK isso já foi resolvido (o topo da INK mostra a mesma navegação da vitrine). Este Worker faz o mesmo na Uma Penca.

## O que o cliente vê

| | Antes | Depois |
|---|---|---|
| Computador | logo em texto, Loja, Contato | etiqueta + **USE ORIGENS** (leva à vitrine), **Sua cidade**, **Estados ▾**, **Categorias ▾**, os links da barra (Canecas, Natal com a cor do CMS), e ao fim **Loja** e **Contato** da Uma Penca |
| Computador estreito (768–1099 px) | igual | tudo num único **Menu ▾** |
| Celular | ☰ que só abria Loja/Contato | ☰ nosso: **← Voltar para a Use Origens** no alto, "Encontre aqui a sua cidade", os blocos do menu da vitrine, e Loja/Contato no fim |

A lupa, a conta e a sacola são as da Uma Penca, intactas (a sacola continua abrindo o painel dela). A cor do topo continua a da loja (o verde `#4d543d`).
Capturas em `docs/screenshots/artigos-topo/`.

## Como funciona

- **Worker separado** (`use-origens-artigos`, `wrangler.artigos.toml`): rota e variáveis só do host do artigos. O `wrangler deploy` apaga as rotas *do próprio Worker* que o TOML
  não declara; como este TOML só declara a do artigos, não há como ele tocar nas rotas do Worker da INK (`use-sul-widget`).
- **HTML e CSS no servidor, nenhum script no navegador.** O Worker lê o `site` que a vitrine já publica em `/api/navbar/sul` (o mesmo que o topo da INK usa), valida com o mesmo
  normalizador (`normalizeNavbar`) e reescreve o topo com o `HTMLRewriter`. Os menus abrem por hover/foco (CSS) e a gaveta do celular é um `<details>`.
- **Sem segunda lista mantida à mão:** mudou o menu no painel da vitrine, muda aqui em até 60 s.
- **Os nós nossos são irmãos dos da Uma Penca**, nunca dentro do bloco que o Vue deles compila (`#header-desktop-nav`, que só é escondido por CSS). Conferido em navegador real
  que a navegação sobrevive ao Vue.

## Escopo (fail-closed)

Só `GET`, que aceita HTML, com resposta 200 em HTML e **num destes caminhos**: `/`, `/fale-conosco`, `/sobre`, `/newsletter` e a página de um artigo
(`/<tipo>/<slug>-<id>.html`), com qualquer query string. Todo o resto (carrinho, checkout, login, conta, rastreamento, APIs, `sw_v2.js`, `manifest.json`, imagens, CSS) passa
direto, sem leitura da vitrine e sem alteração. Um caminho novo da Uma Penca só entra em `src/artigos/escopo.js` de propósito.

## Fail-aberto

Se a vitrine estiver fora do ar, passar de 1,5 s, devolver um formato desconhecido ou qualquer erro acontecer, a página da Uma Penca chega **exatamente como a origem a entregou**
(teste: sete falhas diferentes, o corpo é idêntico). Com a vitrine instável, o Worker usa o último `site` bom por até 10 min. A leitura da vitrine nunca leva Cookie nem Authorization.

## Interruptor e reversão

- `ARTIGOS_TOPO = "true"` liga; ausente ou qualquer outro valor, o Worker só repassa.
- Desligar sem mexer em código: `npx wrangler deploy -c wrangler.artigos.toml --var ARTIGOS_TOPO:false`.
- Reverter de vez: `npx wrangler delete --name use-origens-artigos` (remove o Worker e a rota; o tráfego volta direto à Uma Penca).
- **Não há cache de página para esperar:** o service worker da Uma Penca (`/sw_v2.js`, Workbox) só guarda imagens, JS, CSS e fontes; documentos HTML são `NetworkOnly`. Desligou, voltou na hora.

## Antes de publicar (nada foi publicado)

0. **Nenhuma rota curinga cobre o artigos hoje:** conferidas as 15 rotas da zona, todas são de `loja.useorigens.com.br`. A do artigos será a primeira rota de Worker nesse host.
1. **O registro `artigos` precisa estar proxiado (nuvem laranja) na zona `useorigens.com.br`.** Conferido de fora: `artigos` resolve para os **mesmos dois IPs** que `loja.useorigens.com.br`
   (que a nossa zona já proxia), sem CNAME visível, que é o padrão de um registro proxiado na nossa zona. Não consegui ler o registro em si (o token do `wrangler` não tem
   escopo de DNS). **A prova é a sonda depois do deploy:** `curl -s https://artigos.useorigens.com.br/__origens/health` deve responder
   `{"ok":true,"worker":"use-origens-artigos","topo":"on"}`. Se vier a página da Uma Penca, a zona não está vendo o tráfego (registro só-DNS apontando para a Cloudflare da Uma
   Penca): nesse caso **não mexa no DNS** (a Uma Penca costuma exigir só-DNS para renovar o certificado do domínio) e use o caminho abaixo.
2. Publicar: `npx wrangler deploy -c wrangler.artigos.toml` (login do proprietário). Só depois do pedido do dono.
3. Conferir ao vivo: `PW_PATH=<raiz com playwright-core> node scripts/qa-artigos.mjs` (o mesmo script que gerou as capturas, contra o Worker local; só lê, nunca adiciona item).

## Caminho sem código (alternativa, ou complemento)

O painel da Uma Penca já guarda `logo_url` (hoje vazio) e o menu (`DESKTOP_MENU`: Loja, Newsletter, Sobre, Contato). Subir o logo e acrescentar um link externo para a vitrine dá um
caminho de volta mínimo, sem Worker. Serve de plano B se o item 1 acima falhar.

## Decisões deixadas para o dono

- **Região: este topo é sempre o da Sul (a loja única), diferente da INK.** A Uma Penca vende canecas das três regiões, mas nenhum sinal de região chega a este host: o storefront não grava cookie de região
  no domínio compartilhado (conferido: `/norte` não manda `Set-Cookie`) e os links dos cartões levam direto ao artigo, sem `?origens_r=`. Então "Voltar para a Use Origens" leva a `/sul`, e "Estados"
  mostra PR, SC e RS, mesmo para quem veio de uma caneca do Norte. O jeito de espelhar a INK é o storefront acrescentar `?origens_r=<região>` aos links para o artigos e este Worker ler o parâmetro
  (`storeView(STORES.sul, região)` já devolve a navbar e a base da região). É mudança no storefront, fora deste PR.
- **Rótulos "Loja" e "Contato":** mantidos como o painel da Uma Penca os publica. Com "Canecas" (da vitrine) ao lado, "Loja" pode confundir; trocar por "Todas as canecas" é uma linha em `NATIVE_LINKS` (`src/artigos/topo.js`).
- **Rodapé e aviso de cookies:** o rodapé da Uma Penca não mudou. O aviso de cookies dela (fixo, z-index 30) cobre o pé da gaveta do celular até a pessoa clicar em "Concordar".
- **Medição dos cliques de volta:** os links de saída não têm GA4/Meta próprios (a Uma Penca tem o pixel dela). Se quiser medir, é um passo à parte.
- **Outras páginas da Uma Penca** (listagens por categoria, se existirem) ficam de fora até alguém dizer o caminho; é só acrescentar em `escopo.js`.

## Testes

- `test/artigos.topo.test.js` (puro): marcação, escape, endereços, escopo, interruptor.
- `test/artigos.workerd.test.js` (workerd real, Uma Penca e vitrine simuladas): topo aplicado; vitrine lida uma vez e sem cookie; fora do escopo nada muda; interruptor; fail-aberto (500, não-JSON, JSON quebrado, esquema, região errada, rede, lentidão); redirect/404/não-HTML; fragmento; saúde.
- `scripts/qa-artigos.mjs` (navegador real, loja real, Worker local): 26 conferências (inclui: a sacola e a lupa da Uma Penca fechadas antes e abertas depois do toque, no computador e no celular) e as capturas.
