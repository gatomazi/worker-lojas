import { WIDGET_SOURCE } from './widget-source.js';

const HOST = 'www.usesul.com.br';
const PRODUCT_PREFIX = '/usesul/product/';
// Mantido dentro do padrão da rota */usesul/product/*.
const ASSET_PATH = '/usesul/product/__origens-widget.js';
const SCRIPT_TAG = '<script src="' + ASSET_PATH + '" defer data-cfasync="false" data-use-origens-widget="v0"></script>';

class InsertLoader {
  element(head) {
    head.append(SCRIPT_TAG, { html: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Permite validar que a versão foi publicada sem acessar a loja real.
    if (url.pathname === '/__health') {
      return Response.json({ service: 'use-sul-widget', version: 'poc-0', widget_enabled: env.WIDGET_ENABLED === 'true' });
    }

    // A URL de workers.dev NÃO é uma origem espelho da INK.
    if (url.hostname !== HOST) {
      return new Response('Acesso de teste: use /__health. A integração exige uma Worker Route no www.', { status: 404 });
    }

    if (url.pathname === ASSET_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      return new Response(request.method === 'HEAD' ? null : WIDGET_SOURCE, {
        status: 200,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // A primeira versão não altera carrinho, checkout, home, busca da INK ou APIs.
    if (request.method !== 'GET' || !url.pathname.startsWith(PRODUCT_PREFIX) ||
        env.WIDGET_ENABLED !== 'true') {
      return fetch(request);
    }

    const response = await fetch(request);
    const isHtml = (response.headers.get('content-type') || '')
      .toLowerCase().includes('text/html');
    const isAttachment = /attachment/i.test(response.headers.get('content-disposition') || '');
    if (response.status !== 200 || !isHtml || isAttachment) return response;

    // Só HTML da página de produto. O loader não toca o formulário ou o carrinho.
    // Se existir uma CSP restritiva, verificar no navegador se 'self' é autorizado.
    return new HTMLRewriter().on('head', new InsertLoader()).transform(response);
  }
};
