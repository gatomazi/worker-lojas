# Assistente "Pergunte aqui" nas páginas da INK

A feature `assistant` põe o chat do storefront no canto inferior direito da página de produto e das páginas de casca. O botão se chamava
"Ajuda" até 26/10/2026; agora o texto vem do painel do storefront ("Pergunte aqui" por padrão). Ele fica **no
lugar** do botão "Ajuda?" da INK, que tem no menu dele Status do pedido, Troca, Devolução e WhatsApp. Não usa IA: as respostas vêm do
storefront (`/api/assistente/<região>`, contrato v1; ver `docs/storefront/assistente.md` no useorigens-storefront).

- **Gateway `/__origens/assistente`.**
  - GET abre o chat e POST responde uma mensagem.
  - A origem é fixa, nenhum Cookie é repassado, e o storefront recebe só um hash do endereço (`x-origens-visitor`) para o limite por
    visitante.
  - Cada cartão e cada link é revalidado. Os links de pedidos são remontados a partir da loja. O WhatsApp só passa como wa.me.
  - Qualquer falha devolve 503 JSON.
- **Texto do botão e temas fixos.**
  - O GET traz `label` (o texto do botão e o título do chat) e `topics` (até 4 temas sempre acima do campo).
  - No celular (abaixo de 640px), o botão é só o ícone (48px), para não disputar a atenção com a loja. O texto fica no botão,
    escondido só da vista, para leitores de tela. Os dois são opcionais no v1 e
    revalidados aqui e no navegador.
  - Texto fora do formato vira o padrão do loader ("Pergunte aqui"). Um tema fora do formato cai sozinho. Sem `topics`, não há linha de
    temas.
  - Tocar num tema envia o texto dele como pergunta (`message_source: "topic"`). Os temas ficam desabilitados enquanto a resposta "digita".
  - Com temas, o chat esconde as sugestões da abertura, que repetiriam os temas. O storefront continua mandando as sugestões: um Worker
    anterior a esta versão (ou um rollback) mostra "Ajuda" com as sugestões, como antes, e nunca uma abertura vazia.
  - No celular, os temas formam uma linha que rola para o lado, com o fim esmaecido enquanto houver mais. No computador, uma grade de duas
    colunas.
- **Brilho.**
  - Halo na cor de destaque da região (`theme.accent` em `stores.js`, a mesma do storefront; no Sul, o areia `#d6ba8d`) até a pessoa abrir
    o chat uma vez na visita (`sessionStorage` `origens:assistant:seen`).
  - São três respirações lentas e depois um halo parado (`data-glow="pulse"` → `rest` no `animationend`), para o botão escondido e
    mostrado de novo não recomeçar o pulso.
  - Só a opacidade de um pseudo-elemento se move. Com movimento reduzido, fica só o halo parado.
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
  - Código novo com a feature já no ar (como o texto do botão e os temas): `bash scripts/release-tema.sh --deploy --update`. Com
    `assistant` no ar, o smoke do `--update` confere que `/__origens/assistente` serve a mesma abertura, o mesmo texto do botão e os mesmos
    temas de `/api/assistente/sul`.
  - No storefront, o assistente precisa estar ligado e publicado em Atendimento › Assistente.
- **Evidência.** `docs/evidence/assistente/` tem a página de produto real (cópia local, sem os scripts da INK) com o assistente, no
  computador e no celular.
