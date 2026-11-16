// Escopo do Worker do artigos: de que host, de quais caminhos e com que interruptor o topo é aplicado. Funções puras, testadas em test/artigos.topo.test.js.
// (O módulo de entrada do Worker, worker.js, só pode ter o `export default`: o workerd trata cada export dele como um ponto de entrada.)
export const ARTIGOS_HOST = 'artigos.useorigens.com.br';
export const HEALTH_PATH = '/__origens/health';

// Caminhos que recebem o topo: a home, a página de um artigo (/<tipo>/<slug>-<id>.html) e as páginas de conteúdo. Query string livre (filtros, utm).
// Carrinho, checkout, login, conta, rastreamento, APIs e arquivos estáticos ficam FORA: fail-closed, um caminho novo da Uma Penca só entra aqui de propósito.
const PRODUCT_PAGE = /^\/[a-z0-9-]+\/[a-z0-9-]+-\d+\.html$/;
const CONTENT_PAGES = new Set(['/', '/fale-conosco', '/sobre', '/newsletter']);
export const eligiblePath = (pathname) => typeof pathname === 'string' && (CONTENT_PAGES.has(pathname) || PRODUCT_PAGE.test(pathname));

// ARTIGOS_TOPO: só "true" liga. Ausente ou qualquer outro valor (inclusive "dry-run" e "1") = o Worker apenas repassa.
export const topoEnabled = (env) => String((env && env.ARTIGOS_TOPO) ?? 'false').trim().toLowerCase() === 'true';

// Só navegação de documento: GET (o HEAD e o resto passam), no host do artigos, num caminho da lista, que aceita HTML (as chamadas XHR/fetch da Uma Penca não).
export function eligibleRequest(request, url) {
  if (request.method !== 'GET' || url.hostname !== ARTIGOS_HOST || !eligiblePath(url.pathname)) return false;
  return /text\/html/i.test(request.headers.get('accept') || '');
}
