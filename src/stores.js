// Configuração POR LOJA das superfícies que o Worker desenha na INK. Nada específico de loja fica espalhado no código compartilhado:
// o Worker, o loader e os gateways leem tudo daqui. UM código, UM deploy por loja: cada Worker recebe `STORE_ID` (var do TOML da loja) e só atende o
// host da PRÓPRIA loja. Sem `STORE_ID` o padrão é a Use Sul (o Worker `use-sul-widget` em produção nunca declarou a variável); qualquer valor
// desconhecido é fail-closed (o Worker só repassa à INK e o health mostra `store_status: "invalid"`).
//   region         slug da região no storefront (caminhos /api/navbar/<region>, /api/cidades/<region> e a base <storefrontBase>)
//   inkHost/inkBase host público e prefixo dos caminhos da loja na INK (produto: <inkBase>/product/<slug>; coleções: <inkBase>/collections/<slug>)
//   storefront     origem canônica do storefront (logo, cidades e busca textual)
//   navbarApi      configuração pública enxuta do CMS (grupos `top` e `more` de coleções + estados fixos), lida SOMENTE pelo Worker no servidor
//   promotionsApi  cupons e promoções publicados no CMS (contrato v1), lidos SOMENTE pelo Worker no servidor
//   topBarApi      mensagens da "Faixa do topo" publicadas no CMS (contrato v1), lidas SOMENTE pelo Worker no servidor
//   citiesApi      índice público de cidades (busca "cidade ou estado"), lido SOMENTE pelo Worker no servidor
//   kvBinding      binding do KV do espelho do carrinho: um namespace por loja, nunca compartilhado
//   ga             propriedade GA4 que a PRÓPRIA página da INK e o storefront da região carregam (conferida ao vivo)
//   shellPages     home/listagem/coleções/sobre/conta recebem a navbar? (só onde as rotas da zona foram validadas para isso: Sul, Norte e Centro-Oeste)
//   theme          cor primária da região, a MESMA do storefront (src/lib/theme/region-theme.ts no useorigens): fixa aqui, nunca vinda de parâmetro
//   nextInk        domínio para onde a loja vai mudar na INK (host + prefixo). Só vale com SINGLE_STORE_DOMAIN=next (ver withInkDomain)
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
    promotionsApi: '/api/promotions/sul',
    topBarApi: '/api/top-bar/sul',
    citiesApi: '/api/cidades/sul',
    // "Meus Lugares" (ver docs/buy-session-contract.md): o Worker só faz GET <buySessionApi>/<id>, nunca minta nem interpreta o id.
    buySessionApi: '/api/buy-session',
    kvBinding: 'CART_REFS',
    ga: 'G-8GYTEJ1F77',
    shellPages: true,
    theme: Object.freeze({ primary: '#4d543d' }),
    ufs: Object.freeze(['PR', 'SC', 'RS']),
    stateNames: Object.freeze({ PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul' }),
    // A loja única vai sair de www.usesul.com.br/usesul para loja.useorigens.com.br/useorigens (mesma loja na INK: mesmos produtos, slugs e pedidos).
    nextInk: Object.freeze({ host: 'loja.useorigens.com.br', base: '/useorigens' })
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
    promotionsApi: '/api/promotions/norte',
    topBarApi: '/api/top-bar/norte',
    citiesApi: '/api/cidades/norte',
    buySessionApi: '/api/buy-session',
    kvBinding: 'NORTE_CART_REFS',
    ga: 'G-BC2SQTM7PL',
    shellPages: true,
    theme: Object.freeze({ primary: '#234b50' }),
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
    promotionsApi: '/api/promotions/centro-oeste',
    topBarApi: '/api/top-bar/centro-oeste',
    citiesApi: '/api/cidades/centro-oeste',
    buySessionApi: '/api/buy-session',
    kvBinding: 'CENTRO_CART_REFS',
    ga: 'G-XVDJYYC7YM',
    shellPages: true,
    theme: Object.freeze({ primary: '#8c3b1f' }),
    ufs: Object.freeze(['DF', 'GO', 'MS', 'MT']),
    stateNames: Object.freeze({ DF: 'Distrito Federal', GO: 'Goiás', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso' })
  })
});
export const STORE_IDS = Object.freeze(Object.keys(STORES));

// ── Loja única: uma loja vendendo as três regiões ─────────────────────────────────────────────────────────────────────────────────────────────
// Na loja única (a Use Sul vendendo Sul, Norte e Centro-Oeste), o que o visitante vê na INK segue a REGIÃO DE ONDE ELE VEIO no storefront, não a loja:
// navbar, busca de cidades, guia, recomendações, promoções, cor e o caminho de volta são os da região. Host, prefixo, KV do carrinho e sessão de compra
// continuam os da loja. Ligado só por SERVE_REGIONS (var do TOML da loja); sem ela, cada Worker atende só a própria região, como sempre.
export const REGION_PARAM = 'origens_r';
export const REGION_COOKIE = 'origens_r';
const REGION_FIELDS = ['region', 'name', 'storefrontBase', 'navbarApi', 'promotionsApi', 'topBarApi', 'citiesApi', 'theme', 'ufs', 'stateNames'];
const PROFILES = Object.freeze(Object.fromEntries(Object.values(STORES).map((s) => [s.region, Object.freeze(Object.fromEntries(REGION_FIELDS.map((k) => [k, s[k]])))])));
export const REGION_SLUGS = Object.freeze(Object.keys(PROFILES));

// SERVE_REGIONS -> regiões que esta loja atende. Ausente/vazio = só a própria (status "single"). Lista válida que inclui a própria = "ok".
// Qualquer região desconhecida, ou uma lista sem a própria região da loja, = fail-closed para só a própria ("invalid").
export function parseServedRegions(raw, store) {
  if (!store) return { regions: [], status: 'invalid' };
  if (raw === undefined || raw === null || String(raw).trim() === '') return { regions: [store.region], status: 'single' };
  const list = [...new Set(String(raw).split(',').map((r) => r.trim()).filter(Boolean))];
  if (list.some((r) => !Object.hasOwn(PROFILES, r)) || !list.includes(store.region)) return { regions: [store.region], status: 'invalid' };
  return { regions: list, status: 'ok' };
}

// A loja vista por um visitante de `region`: tudo da região, menos o que é da loja (host, prefixo, KV, sessão, GA da página da INK, workerName).
// `id` continua o da loja (chave do KV e dos padrões de URL); `viewKey` separa caches e serviços por região.
const views = new Map();
export function storeView(store, region) {
  if (!store || !region || region === store.region) return store;
  const key = store.id + '@' + region + (store.formerInk ? '@next' : '');
  if (!views.has(key)) views.set(key, Object.freeze({ ...store, ...PROFILES[region], viewKey: key }));
  return views.get(key);
}

// Região do visitante: o parâmetro do link do storefront (?origens_r=norte) vence; senão o cookie que o Worker gravou na 1ª visita; senão a da loja.
// Só vale uma região que esta loja atende. `fromParam` diz se é preciso (re)gravar o cookie.
export function visitorRegion(url, cookieHeader, served, store) {
  const ok = (r) => typeof r === 'string' && served.includes(r);
  const param = url.searchParams.get(REGION_PARAM);
  if (ok(param)) return { region: param, fromParam: true };
  const match = /(?:^|;\s*)origens_r=([a-z-]{2,20})(?:;|$)/.exec(cookieHeader || '');
  if (match && ok(match[1])) return { region: match[1], fromParam: false };
  return { region: store.region, fromParam: false };
}

export const regionCookie = (region) => REGION_COOKIE + '=' + region + '; Path=/; Max-Age=2592000; Secure; SameSite=Lax';
export const DEFAULT_STORE_ID = 'sul';
export const ACTIVE_STORE = STORES[DEFAULT_STORE_ID];

// STORE_ID -> loja. Ausente/vazio = Use Sul (status "default"); id conhecido = "ok"; qualquer outra coisa = sem loja (status "invalid", fail-closed).
export function resolveStore(raw) {
  if (raw === undefined || raw === null || raw === '') return { id: DEFAULT_STORE_ID, store: STORES[DEFAULT_STORE_ID], status: 'default' };
  if (typeof raw === 'string' && Object.hasOwn(STORES, raw.trim())) return { id: raw.trim(), store: STORES[raw.trim()], status: 'ok' };
  return { id: null, store: null, status: 'invalid' };
}

// ── Mudança de domínio da loja na INK ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// SINGLE_STORE_DOMAIN (var do TOML, a MESMA em todos os Workers): ausente/"current" = a loja única está no domínio de hoje; "next" = já mudou para o
// `nextInk` da Use Sul. No Worker da Sul, "next" troca o host e o prefixo que ele atende e guarda o antigo em `formerInk` (quem chega por ele é redirecionado,
// ver domain-move.js). Nos Workers das lojas antigas, só muda o destino do redirect (legacy-redirect.js), sem salto pelo domínio antigo.
// Qualquer outro valor = fail-closed para o domínio de hoje (status "invalid").
const moved = new Map();
export function withInkDomain(store, raw) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (value === '' || value === 'current') return { store, status: value === '' ? 'default' : 'ok' };
  if (value !== 'next') return { store, status: 'invalid' };
  if (!store || !store.nextInk) return { store, status: 'ok' };
  if (!moved.has(store.id)) moved.set(store.id, Object.freeze({ ...store, inkHost: store.nextInk.host, inkBase: store.nextInk.base, formerInk: Object.freeze({ host: store.inkHost, base: store.inkBase }) }));
  return { store: moved.get(store.id), status: 'ok' };
}
// A loja única (a Use Sul) no domínio que SINGLE_STORE_DOMAIN indica: o destino dos redirects das lojas antigas.
export const singleStore = (env = {}) => withInkDomain(STORES.sul, env.SINGLE_STORE_DOMAIN).store;

// Expressão do caminho de uma PÁGINA de produto da loja: <inkBase>/product/<slug>, sem subcaminhos e sem "__origens". `inkBase` vem só de STORES
// (letras minúsculas), então não há caractere especial de regex a escapar.
// Compiladas UMA vez por loja (o Worker as usa a cada pedido).
const patterns = new Map();
const compiled = (key, make) => { if (!patterns.has(key)) patterns.set(key, make()); return patterns.get(key); };
export const productPagePattern = (store) => compiled('page:' + store.id + store.inkBase, () => new RegExp('^' + store.inkBase + '/product/(?!__)[^/]+/?$'));
// Slug canônico do catálogo: minúsculas, dígitos, "-" e "_"; sem subcaminho, sem barra final, sem "%", sem ".." e sem placeholders.
export const catalogProductPattern = (store) => compiled('catalog:' + store.id + store.inkBase, () => new RegExp('^' + store.inkBase + '/product/[a-z0-9][a-z0-9_-]{0,127}$'));

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
  ga: store.ga,
  theme: { primary: store.theme.primary }
});
