# Assistente "Ajuda" nas páginas da INK

A feature `assistant` põe o chat do storefront no canto inferior direito da página de produto e das páginas de casca. Ele fica **no
lugar** do botão "Ajuda?" da INK, que tem no menu dele Status do pedido, Troca, Devolução e WhatsApp. Não usa IA: as respostas vêm do
storefront (`/api/assistente/<região>`, contrato v1; ver `docs/storefront/assistente.md` no useorigens-storefront).

- **Gateway `/__origens/assistente`.**
  - GET abre o chat e POST responde uma mensagem.
  - A origem é fixa, nenhum Cookie é repassado, e o storefront recebe só um hash do endereço (`x-origens-visitor`) para o limite por
    visitante.
  - Cada cartão e cada link é revalidado. Os links de pedidos são remontados a partir da loja. O WhatsApp só passa como wa.me.
  - Qualquer falha devolve 503 JSON.
- **Troca do nativo.** O "Ajuda?" (`[data-controller~="ink-store--help-button"]`) é escondido por um `<style>` dentro do nosso nó, só
  depois que o nosso montou. Desmontou, ele volta. Off, erro ou boot inválido: a INK fica exatamente como é.
- **Posição.** Fica acima do CTA fixo e do aviso de cookies. Some com o carrinho, um modal, o menu ou o teclado, e quando cobriria
  controles do formulário de compra (a mesma regra do botão de cupons). O cupom sai da frente quando o painel do assistente abre.
- **Comportamento.**
  - "digitando…" de 0,7 s a 1,8 s antes de cada resposta.
  - "tem mais?" e "sim" são resolvidos no navegador.
  - CPF, cartão e senha nunca são enviados.
  - O WhatsApp da loja fica a um toque no cabeçalho.
- **Liberação.**
  - `assistant` é opt-in (`OPT_IN_FEATURES`): um release de rotina nunca o liga.
  - Primeiro vai ao ar o deploy que conhece a feature (`FEATURE_NAMES`), e só depois ela entra em `WIDGET_FEATURES`, porque um nome
    desconhecido descarta a lista inteira.
  - O teto do tamanho da lista passou de 260 para 320 caracteres: com todas as features, ela tem 265.
  - No storefront, o assistente precisa estar ligado e publicado em Atendimento › Assistente.
- **Evidência.** `docs/evidence/assistente/` tem a página de produto real (cópia local, sem os scripts da INK) com o assistente, no
  computador e no celular.
