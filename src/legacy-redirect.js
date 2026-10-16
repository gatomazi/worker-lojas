// Lojas antigas (Use Norte, Use Centro-Oeste) depois da loja única (16/10/2026): os produtos foram migrados para a Use Sul, que vende as três
// regiões. Com LEGACY_REDIRECT=on, o Worker da loja antiga leva o visitante para o MESMO produto na loja única (mapa slug antigo -> slug novo
// no KV LEGACY_MAP, gerado da reconciliação), já com a região de origem (?origens_r=), ou para a home da região no storefront.
// Pedidos, carrinho, checkout e conta NUNCA são redirecionados: quem comprou na loja antiga segue acompanhando o pedido lá.
import { STORES, REGION_PARAM, productPagePattern } from './stores.js';
import { shellPageKind } from './scope.js';

const SINGLE = STORES.sul;
// Só os parâmetros de campanha seguem para o destino (os da INK — variante, cupom, sessão — não fazem sentido na outra loja).
const CARRY = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid'];
const SLUG = /^[a-z0-9][a-z0-9_-]{0,160}$/;

export const legacyRedirectOn = (env, store) => String(env.LEGACY_REDIRECT ?? '').toLowerCase() === 'on' && Boolean(store) && store.id !== SINGLE.id;

function withCampaign(target, from) {
  for (const name of CARRY) {
    const value = from.searchParams.get(name);
    if (value && value.length <= 500 && !target.searchParams.has(name)) target.searchParams.set(name, value);
  }
  return target;
}

const redirect = (target, status) => new Response(null, { status, headers: { Location: target.href, 'Cache-Control': 'no-store', 'X-Origens-Legacy': '1' } });

// Resposta de redirect, ou null quando o pedido segue para a INK (pedidos, carrinho, checkout, conta, qualquer outro caminho).
export async function legacyRedirect(request, url, store, kv, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const status = String(env.LEGACY_REDIRECT_STATUS ?? '') === '301' ? 301 : 302;
  const regionHome = () => withCampaign(new URL(store.storefront + store.storefrontBase), url);

  if (productPagePattern(store).test(url.pathname)) {
    const slug = url.pathname.slice((store.inkBase + '/product/').length).replace(/\/$/, '');
    let next = null;
    if (SLUG.test(slug) && kv) {
      try { next = await kv.get(slug); } catch (_) { next = null; } // KV indisponível: a home da região (nunca uma página de erro)
    }
    if (next && SLUG.test(next)) {
      const target = new URL('https://' + SINGLE.inkHost + SINGLE.inkBase + '/product/' + next);
      target.searchParams.set(REGION_PARAM, store.region);
      return redirect(withCampaign(target, url), status);
    }
    return redirect(regionHome(), status);
  }
  const kind = shellPageKind(url.pathname, store.inkBase);
  if (kind === 'home' || kind === 'products' || kind === 'about' || kind === 'collection') return redirect(regionHome(), status);
  return null;
}
