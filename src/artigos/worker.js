// Worker `use-origens-artigos`: o topo da Use Origens na loja da Uma Penca (artigos.useorigens.com.br), para o cliente voltar à vitrine. Ver docs/artigos-topo.md.
// UM Worker só deste host, com TOML e rota próprios (wrangler.artigos.toml): nada aqui toca as rotas nem o código do Worker da INK (use-sul-widget).
// O que faz: em páginas de documento, GET, HTML, 200 e de uma lista FECHADA de caminhos (escopo.js), troca o logo e a navegação do topo pelos da vitrine
// (topo.js, rewrite.js), sem entregar nenhum script ao navegador. A lupa, a conta e a sacola da Uma Penca, o carrinho, o login, o checkout, as APIs e os
// arquivos estáticos passam pelo Worker intactos (fail-closed: caminho fora da lista = só repassa).
// FAIL-ABERTO: sem o `site` da vitrine (fora do ar, lento, formato desconhecido), com qualquer erro ou fora do escopo, a página da Uma Penca chega como a origem
// a entregou. ARTIGOS_TOPO é o interruptor: só "true" liga; ausente ou qualquer outro valor = o Worker apenas repassa.
// Este módulo só tem o `export default` (o workerd trata cada export do módulo de entrada como um ponto de entrada): a lógica fica nos módulos ao lado.
import { ARTIGOS_HOST, HEALTH_PATH, eligibleRequest, topoEnabled } from './escopo.js';
import { createSiteSource, log } from './site.js';
import { applyTopo } from './rewrite.js';

// Redirects e erros da origem chegam ao cliente sem serem seguidos nem alterados.
const passThrough = (request) => fetch(request, { redirect: 'manual' });
const sites = createSiteSource();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === HEALTH_PATH && url.hostname === ARTIGOS_HOST) {
      return new Response(JSON.stringify({ ok: true, worker: 'use-origens-artigos', topo: topoEnabled(env) ? 'on' : 'off' }), {
        status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }
    if (!topoEnabled(env) || !eligibleRequest(request, url)) return passThrough(request);
    try {
      // A página e o `site` da vitrine são lidos em paralelo: o topo não soma latência quando a vitrine responde.
      const [response, site] = await Promise.all([passThrough(request), sites.get()]);
      if (!site || response.status !== 200 || !/text\/html/i.test(response.headers.get('content-type') || '')) return response;
      return applyTopo(response, site);
    } catch (error) {
      // A leitura da página falhou: refaz o pedido sem o topo (o erro da origem, se for dela, chega ao cliente como é).
      log('warn', 'rewrite-error', { reason: String(error && error.message).slice(0, 40) });
      return passThrough(request);
    }
  }
};
