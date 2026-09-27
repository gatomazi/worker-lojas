// GET /__origens/list-session?ls=<id>&done=<ids> — gateway SOMENTE LEITURA para a sessão de compra de
// "Meus Lugares" (ver docs/buy-session-contract.md). O storefront é quem MINTA e VERIFICA o id (HMAC, chave só
// lá, nunca compartilhada); este Worker só repassa o id de volta para lá e reexpõe a resposta no mesmo domínio
// da INK — sem isso o loader (rodando em www.usesul.com.br) precisaria chamar useorigens.com.br direto do
// navegador, o que exigiria CORS. Mesmo desenho de navbar-gateway.js: origem FIXA (stores.js), sem repassar
// Cookie/Authorization, timeout curto, limite de tamanho, validação estrita de esquema — a URL do próximo
// produto só é aceita se pertencer a ESTA loja (nunca um open redirect, mesmo que o storefront devolvesse algo
// inesperado). Opcional por natureza: qualquer falha vira `{next:null}` 200, nunca quebra o drawer nativo.
import { ACTIVE_STORE } from './stores.js';

export const LIST_SESSION_PATH = '/__origens/list-session';
const FETCH_TIMEOUT_MS = 2000;
const MAX_CHARS = 4096;
// base64url(payload) "." base64url(assinatura) — formato solto de propósito: só o storefront interpreta o conteúdo.
const ID_FORMAT = /^[A-Za-z0-9_-]{1,700}\.[A-Za-z0-9_-]{1,50}$/;
const DONE_FORMAT = /^[A-Za-z0-9_,-]{0,2400}$/;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,40}$/;

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const EMPTY = { next: null };

// Só o formato conhecido sobrevive; a URL do próximo produto TEM de ser desta loja (nunca outro host).
function normalizeNext(data, store) {
  if (!data || typeof data !== 'object' || typeof data.total !== 'number' || typeof data.position !== 'number') return null;
  if (data.next === null) return { next: null, position: data.position, total: data.total };
  const next = data.next;
  if (!next || typeof next !== 'object' || typeof next.inkProductId !== 'string' || !PRODUCT_ID.test(next.inkProductId)) return null;
  const title = typeof next.title === 'string' ? next.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!title) return null;
  if (typeof next.imageUrl !== 'string' || typeof next.url !== 'string') return null;
  try {
    const imageUrl = new URL(next.imageUrl);
    const url = new URL(next.url);
    if (imageUrl.protocol !== 'https:') return null;
    if (url.protocol !== 'https:' || url.host !== store.inkHost) return null;
    return { next: { inkProductId: next.inkProductId, title, imageUrl: imageUrl.href, url: url.href }, position: data.position, total: data.total };
  } catch (_) {
    return null;
  }
}

export function createListSession({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const url = new URL(request.url);
      const ls = url.searchParams.get('ls') || '';
      const done = url.searchParams.get('done') || '';
      if (!ID_FORMAT.test(ls) || !DONE_FORMAT.test(done)) return json(EMPTY);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const target = new URL(store.storefront + store.buySessionApi + '/' + ls);
        if (done) target.searchParams.set('done', done);
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization. O id nunca é logado.
        const response = await upstream(new Request(target, { method: 'GET', headers: { accept: 'application/json' } }), { redirect: 'manual', signal: controller.signal });
        if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeNext(JSON.parse(text), store);
        if (!clean) throw new Error('schema');
        return json(clean);
      } catch (error) {
        console.warn(JSON.stringify({ event: 'use-origens.list-session-error', reason: String(error && error.message).slice(0, 40) }));
        return json(EMPTY);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
