// Mudança de domínio da loja na INK (SINGLE_STORE_DOMAIN=next, stores.js withInkDomain): a Use Sul sai de www.usesul.com.br/usesul para
// loja.useorigens.com.br/useorigens. É a MESMA loja (mesmos produtos, slugs, variantes, cupons e pedidos), então o redirect leva o caminho inteiro e
// TODOS os parâmetros: /usesul/product/x?variant=9 -> /useorigens/product/x?variant=9. Inclui pedidos, carrinho e checkout (a INK só atende no domínio novo).
// A região do visitante, que no domínio antigo vivia num cookie, vai junto como ?origens_r= (o cookie não atravessa domínios).
import { REGION_PARAM, visitorRegion } from './stores.js';

export const onFormerHost = (store, url) => Boolean(store && store.formerInk) && (url.hostname === store.formerInk.host || url.hostname === store.formerInk.host.replace(/^www\./, ''));

// Caminho no domínio novo: o prefixo antigo vira o novo; a raiz do host vira a home da loja; o resto (/checkout, /__origens/…) segue igual.
function nextPath(pathname, store) {
  const { base } = store.formerInk;
  if (pathname === '/' || pathname === '') return store.inkBase;
  if (pathname === base) return store.inkBase;
  if (pathname.startsWith(base + '/')) return store.inkBase + pathname.slice(base.length);
  return pathname;
}

export function domainMoveRedirect(request, url, store, served, env = {}) {
  const target = new URL('https://' + store.inkHost + nextPath(url.pathname, store) + url.search);
  if (!target.searchParams.has(REGION_PARAM)) {
    const visitor = visitorRegion(url, request.headers.get('cookie'), served, store);
    if (visitor.region !== store.region) target.searchParams.set(REGION_PARAM, visitor.region);
  }
  const permanent = String(env.DOMAIN_MOVE_STATUS ?? '') === '301';
  // GET/HEAD: 302 (ou 301). Outros métodos: 307/308, que mantêm o método e o corpo.
  const status = request.method === 'GET' || request.method === 'HEAD' ? (permanent ? 301 : 302) : (permanent ? 308 : 307);
  return new Response(null, { status, headers: { Location: target.href, 'Cache-Control': 'no-store', 'X-Origens-Moved': '1' } });
}
