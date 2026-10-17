// WIDGET_FEATURES: módulos do loader liberados por deploy (não é flag de build). Fail-closed:
//   ausente           -> ["return-link"] (comportamento do piloto anterior; mantém compatibilidade)
//   "" (vazia)        -> [] (nenhum módulo)
//   nome desconhecido -> [] e status "invalid" (a lista INTEIRA é descartada)
// As features NÃO ampliam páginas: quem autoriza páginas continua sendo só WIDGET_ALLOWLIST (Worker e loader).
// auto-recommendations: bloco "Você também pode gostar" na página de produto (lista pré-calculada, /__origens/recommendations/<id>). Desligada = nenhum
// pedido e nenhum DOM: nem o módulo entra no loader.
// pdp-share: botão "Compartilhar" abaixo do título da página de produto. size-guide: o link nativo "Confira suas medidas" vira o botão "Guia de medidas"
// (mesmo nó, mesmo modal oficial da INK). size-fit: "Informar medidas" ao lado do link de medidas (compara com uma peça que a pessoa já usa e
// marca o tamanho no seletor da INK só depois do toque). Desligadas = nem o módulo entra no loader.
// pdp-guide: ajuda guiada "Procurando sua cidade ou outra estampa?" na página de produto (painel com busca de cidade, estampas da cidade e coleções da região,
// dados de /__origens/guia). Com ela ligada, o bloco "Continue explorando" (product-discovery) NÃO é montado: um recurso só por função. Desligada = nem o
// módulo nem o gateway entram; o bloco anterior volta como estava (rollback simples).
// top-bar: as mensagens da "Faixa do topo" do CMS na faixa preta do cabeçalho da INK (produto e casca), no lugar das frases nativas. Sem mensagem no ar,
// erro ou feature desligada = a faixa da INK fica exatamente como está (nem o módulo nem o gateway entram).
// theme-pdp, theme-cart, theme-checkout: tema da compra na INK (src/theme.js), um por superfície (PDP; carrinho e confirmação de adição; as duas telas do
// checkout). São o TETO do deploy: cada superfície só aparece se também estiver ligada no painel (Aparência › Tema da INK). Desligadas = nem o CSS
// nem o atributo do <html> nem a leitura da configuração.
// cart-incentive: no carrinho tematizado (theme-cart), o incentivo de frete grátis por quantidade de peças, SÓ quando o painel publica uma regra
// confirmada (Tema da INK › Incentivo). Sem regra, sem theme-cart ou desligada = nada aparece (a INK fica como é).
export const FEATURE_NAMES = ['return-link', 'post-add-discovery', 'city-search', 'cart-discovery', 'cart-mirror', 'product-discovery', 'header-nav', 'list-session', 'promo-fab', 'auto-recommendations', 'pdp-share', 'size-guide', 'pdp-guide', 'size-fit', 'top-bar', 'theme-pdp', 'theme-cart', 'theme-checkout', 'cart-incentive'];
export const DEFAULT_FEATURES = ['return-link'];

export function parseFeatures(raw) {
  if (raw === undefined || raw === null) return { status: 'default', features: [...DEFAULT_FEATURES] };
  if (typeof raw !== 'string' || raw.length > 260) return { status: 'invalid', features: [] };
  if (raw.trim() === '') return { status: 'empty', features: [] };
  const names = raw.split(',').map((name) => name.trim());
  if (!names.every((name) => FEATURE_NAMES.includes(name))) return { status: 'invalid', features: [] };
  return { status: 'ok', features: FEATURE_NAMES.filter((name) => names.includes(name)) };
}
