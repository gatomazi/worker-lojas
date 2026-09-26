// Configuração POR LOJA das superfícies que o Worker desenha na INK. Nada específico de loja fica espalhado no código compartilhado:
// o loader e o gateway da navbar leem tudo daqui. Nesta rodada só a Use Sul está implementada; outra loja = nova entrada (e nova rota/host).
//   inkBase        prefixo dos caminhos da loja na INK (coleções: <inkBase>/collections/<slug>)
//   storefront     origem canônica do storefront (logo, cidades e busca textual)
//   navbarApi      configuração pública enxuta do CMS (coleções da navbar), lida SOMENTE pelo Worker no servidor
export const STORES = Object.freeze({
  sul: Object.freeze({
    region: 'sul',
    name: 'Use Sul',
    inkHost: 'www.usesul.com.br',
    inkBase: '/usesul',
    storefront: 'https://useorigens.com.br',
    storefrontBase: '/sul',
    navbarApi: '/api/navbar/sul'
  })
});
export const ACTIVE_STORE = STORES.sul;

// Parte da configuração que o navegador precisa (URLs já montadas aqui; o loader nunca compõe host de destino sozinho).
export const clientStore = (store = ACTIVE_STORE) => ({
  name: store.name,
  inkBase: store.inkBase,
  home: store.storefront + store.storefrontBase,
  cities: store.storefront + store.storefrontBase + '#estados',
  search: store.storefront + store.storefrontBase + '/busca'
});
