// Configuração POR LOJA das superfícies que o Worker desenha na INK. Nada específico de loja fica espalhado no código compartilhado:
// o Worker, o loader e os gateways leem tudo daqui. UM código, UM deploy por loja: cada Worker recebe `STORE_ID` (var do TOML da loja) e só atende o
// host da PRÓPRIA loja. Sem `STORE_ID` o padrão é a Use Sul (o Worker `use-sul-widget` em produção nunca declarou a variável); qualquer valor
// desconhecido é fail-closed (o Worker só repassa à INK e o health mostra `store_status: "invalid"`).
//   region         slug da região no storefront (caminhos /api/navbar/<region>, /api/cidades/<region> e a base <storefrontBase>)
//   inkHost/inkBase host público e prefixo dos caminhos da loja na INK (produto: <inkBase>/product/<slug>; coleções: <inkBase>/collections/<slug>)
//   storefront     origem canônica do storefront (logo, cidades e busca textual)
//   navbarApi      configuração pública enxuta do CMS (grupos `top` e `more` de coleções + estados fixos), lida SOMENTE pelo Worker no servidor
//   citiesApi      índice público de cidades (busca "cidade ou estado"), lido SOMENTE pelo Worker no servidor
//   kvBinding      binding do KV do espelho do carrinho: um namespace por loja, nunca compartilhado
//   ga             propriedade GA4 que a PRÓPRIA página da INK e o storefront da região carregam (conferida ao vivo)
//   shellPages     home/listagem/coleções/sobre/conta recebem a navbar? (só onde as rotas da zona foram validadas para isso: Sul, Norte e Centro-Oeste)
export const STORES = Object.freeze({
  sul: Object.freeze({
    id: 'sul',
    workerName: 'use-sul-widget',
    region: 'sul',
    name: 'Use Sul',
    inkHost: 'www.usesul.com.br',
    inkBase: '/usesul',
    storefront: 'https://useorigens.com.br',
    storefrontBase: '/sul',
    navbarApi: '/api/navbar/sul',
    citiesApi: '/api/cidades/sul',
    // "Meus Lugares" (ver docs/buy-session-contract.md): o Worker só faz GET <buySessionApi>/<id>, nunca minta nem interpreta o id.
    buySessionApi: '/api/buy-session',
    kvBinding: 'CART_REFS',
    ga: 'G-8GYTEJ1F77',
    shellPages: true,
    ufs: Object.freeze(['PR', 'SC', 'RS']),
    stateNames: Object.freeze({ PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul' })
  }),
  norte: Object.freeze({
    id: 'norte',
    workerName: 'use-norte-widget',
    region: 'norte',
    name: 'Use Norte',
    inkHost: 'www.usenorte.com.br',
    inkBase: '/usenorte',
    storefront: 'https://useorigens.com.br',
    storefrontBase: '/norte',
    navbarApi: '/api/navbar/norte',
    citiesApi: '/api/cidades/norte',
    buySessionApi: '/api/buy-session',
    kvBinding: 'NORTE_CART_REFS',
    ga: 'G-BC2SQTM7PL',
    shellPages: true,
    ufs: Object.freeze(['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO']),
    stateNames: Object.freeze({ AC: 'Acre', AM: 'Amazonas', AP: 'Amapá', PA: 'Pará', RO: 'Rondônia', RR: 'Roraima', TO: 'Tocantins' })
  }),
  centro: Object.freeze({
    id: 'centro',
    workerName: 'use-centro-widget',
    region: 'centro-oeste',
    name: 'Use Centro-Oeste',
    inkHost: 'www.usecentro.com.br',
    inkBase: '/usecentro',
    storefront: 'https://useorigens.com.br',
    storefrontBase: '/centro-oeste',
    navbarApi: '/api/navbar/centro-oeste',
    citiesApi: '/api/cidades/centro-oeste',
    buySessionApi: '/api/buy-session',
    kvBinding: 'CENTRO_CART_REFS',
    ga: 'G-XVDJYYC7YM',
    shellPages: true,
    ufs: Object.freeze(['DF', 'GO', 'MS', 'MT']),
    stateNames: Object.freeze({ DF: 'Distrito Federal', GO: 'Goiás', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso' })
  })
});
export const STORE_IDS = Object.freeze(Object.keys(STORES));
export const DEFAULT_STORE_ID = 'sul';
export const ACTIVE_STORE = STORES[DEFAULT_STORE_ID];

// STORE_ID -> loja. Ausente/vazio = Use Sul (status "default"); id conhecido = "ok"; qualquer outra coisa = sem loja (status "invalid", fail-closed).
export function resolveStore(raw) {
  if (raw === undefined || raw === null || raw === '') return { id: DEFAULT_STORE_ID, store: STORES[DEFAULT_STORE_ID], status: 'default' };
  if (typeof raw === 'string' && Object.hasOwn(STORES, raw.trim())) return { id: raw.trim(), store: STORES[raw.trim()], status: 'ok' };
  return { id: null, store: null, status: 'invalid' };
}

// Expressão do caminho de uma PÁGINA de produto da loja: <inkBase>/product/<slug>, sem subcaminhos e sem "__origens". `inkBase` vem só de STORES
// (letras minúsculas), então não há caractere especial de regex a escapar.
// Compiladas UMA vez por loja (o Worker as usa a cada pedido).
const patterns = new Map();
const compiled = (key, make) => { if (!patterns.has(key)) patterns.set(key, make()); return patterns.get(key); };
export const productPagePattern = (store) => compiled('page:' + store.id, () => new RegExp('^' + store.inkBase + '/product/(?!__)[^/]+/?$'));
// Slug canônico do catálogo: minúsculas, dígitos, "-" e "_"; sem subcaminho, sem barra final, sem "%", sem ".." e sem placeholders.
export const catalogProductPattern = (store) => compiled('catalog:' + store.id, () => new RegExp('^' + store.inkBase + '/product/[a-z0-9][a-z0-9_-]{0,127}$'));

// Parte da configuração que o navegador precisa (URLs já montadas aqui; o loader nunca compõe host de destino sozinho).
export const clientStore = (store = ACTIVE_STORE) => ({
  id: store.id,
  name: store.name,
  region: store.region,
  inkHost: store.inkHost,
  inkBase: store.inkBase,
  origin: store.storefront,
  base: store.storefrontBase,
  home: store.storefront + store.storefrontBase,
  cities: store.storefront + store.storefrontBase + '#estados',
  search: store.storefront + store.storefrontBase + '/busca',
  ga: store.ga
});
