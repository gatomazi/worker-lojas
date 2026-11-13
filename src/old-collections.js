// Coleções antigas da loja única que não existem mais na INK (404): os estados pela sigla (/collections/rs) e os modelos (/collections/territorio),
// que o Google e links velhos ainda pedem. Com a INK respondendo 404, o Worker leva o visitante (301) para a página equivalente no storefront:
// a sigla vai para a página do estado na região dele (/sul/rs, /norte/am…) e o modelo para a busca da vitrine por ele (/sul/busca?q=Território).
// Só a loja que vende as regiões (a Use Sul); se a INK voltar a ter uma coleção com um destes slugs (resposta diferente de 404), ela continua no ar.
import { STORES } from './stores.js';
import { withCampaign } from './legacy-redirect.js';

const FAMILIES = Object.freeze({
  'ponto-origem': 'Ponto de Origem',
  'ponto-de-origem': 'Ponto de Origem',
  origem: 'Ponto de Origem',
  'feito-em': 'Feito em',
  coordenadas: 'Coordenadas',
  legado: 'Legado',
  territorio: 'Território',
  tipografia: 'Tipografia',
  traco: 'Traço',
  gentilico: 'Gentílico'
});

// Sigla -> a loja (região) que tem o estado em `ufs`: o destino é a página do estado no storefront daquela região.
const UF_STORE = new Map(Object.values(STORES).flatMap((store) => store.ufs.map((uf) => [uf.toLowerCase(), store])));

export function oldCollectionTarget(slug, store) {
  if (UF_STORE.has(slug)) {
    const region = UF_STORE.get(slug);
    return new URL(region.storefront + region.storefrontBase + '/' + slug);
  }
  if (Object.hasOwn(FAMILIES, slug)) {
    const target = new URL(store.storefront + store.storefrontBase + '/busca');
    target.searchParams.set('q', FAMILIES[slug]);
    return target;
  }
  return null;
}

// Resposta 301, ou null quando o pedido segue o caminho normal (outra loja, outro caminho, slug fora do mapa, ou a INK tem a coleção).
export async function oldCollectionRedirect(request, url, store, upstream) {
  if (store.id !== STORES.sul.id || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const prefix = store.inkBase + '/collections/';
  if (!url.pathname.startsWith(prefix)) return null;
  const slug = url.pathname.slice(prefix.length).replace(/\/$/, '');
  const target = oldCollectionTarget(slug, store);
  if (!target) return null;
  let status = 0;
  try {
    const res = await upstream(new Request(url.href, { method: 'HEAD', headers: { 'User-Agent': request.headers.get('User-Agent') ?? '' } }), { redirect: 'manual' });
    status = res.status;
  } catch (_) { return null; } // a INK não respondeu: segue o caminho normal, que já sabe lidar com isso
  if (status !== 404) return null;
  return new Response(null, { status: 301, headers: { Location: withCampaign(target, url).href, 'Cache-Control': 'public, max-age=3600', 'X-Origens-Old-Collection': '1' } });
}
