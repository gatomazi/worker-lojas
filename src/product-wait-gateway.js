// GET /__origens/produto/<id> — gateway SOMENTE LEITURA do andamento de uma camiseta da compra direta (personalização: o cliente digita o sobrenome, o
// storefront cria um produto escondido na INK e mostra a espera). A pílula "Criando camiseta…" do storefront segue o cliente pelo site; aqui ela segue
// também pelas páginas da INK (src/loader/product-wait.js). Os dados vêm do storefront (GET <storefront>/api/personalizar/produto/<id>), que não envia
// CORS para o host da INK: só o SERVIDOR (este Worker) fala com ele e re-serve no mesmo domínio. Mesmo desenho de assistant-gateway.js:
//   - origem FIXA vinda de stores.js; o visitante só escolhe um id no formato ULID (o mesmo do cookie uo_produtos), nunca uma URL;
//   - nada de Cookie/Authorization do visitante; o storefront recebe só o hash do endereço (x-origens-visitor, o mesmo do assistente) para o limite por visitante;
//   - timeout curto, limite de tamanho, sem cache (o estado muda a cada passo) e validação CAMPO A CAMPO do que volta: status do vocabulário fechado,
//     rótulo de uma linha, link só https no host DESTA loja na INK e no caminho canônico de produto, foto só do CDN da INK; link e foto só em "ready".
// Qualquer campo fora do contrato derruba a resposta (contrato estrito: o storefront já validou tudo). 404 do storefront (id desconhecido, ou o limite
// por visitante, que lá também responde 404) => 404 JSON e o cliente só espera a próxima rodada; qualquer outra falha => 503 JSON (a INK segue intacta).
// Contrato: { id, label, status: 'queued'|'creating'|'photos'|'ready'|'failed'|'check', url: string|null, image: string|null }.
import { ACTIVE_STORE, catalogProductPattern } from './stores.js';
import { visitorKey } from './assistant-gateway.js';

export const PRODUCT_WAIT_PATH = '/__origens/produto/';
const STOREFRONT_API = '/api/personalizar/produto/';
const FETCH_TIMEOUT_MS = 4000; // abaixo dos 5 s entre as consultas do cliente
const MAX_CHARS = 4096;
export const MAX_LABEL = 90;
// O id do trabalho no storefront (ULID: 26 caracteres do alfabeto Crockford, sem I, L, O e U). O mesmo formato do cookie uo_produtos.
export const JOB_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const STATUSES = Object.freeze(['queued', 'creating', 'photos', 'ready', 'failed', 'check']);
const IMAGE_HOSTS = new Set(['gcp-images.majestic.ink.rsvcloud.com']);
// Uma linha, sem controle nem marcação (o cliente usa textContent; isto é defesa em profundidade).
const CONTROL = /[\u0000-\u001f\u007f<>]/;

const cleanLine = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length >= 1 && text.length <= max && !CONTROL.test(text) ? text : null;
};
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null; } catch (_) { return null; }
}
const absent = (value) => value === null || value === undefined;

// O id pedido no caminho (/__origens/produto/<id>), ou null fora do formato.
export function jobIdOf(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(PRODUCT_WAIT_PATH)) return null;
  const id = pathname.slice(PRODUCT_WAIT_PATH.length);
  return JOB_ID.test(id) ? id : null;
}

// O link da camiseta pronta: página de produto DESTA loja na INK (host e prefixo de hoje), sem query nem fragmento. Sai remontado a partir da loja.
export function productUrl(value, store = ACTIVE_STORE) {
  const u = safeUrl(value);
  if (!u || u.hostname !== store.inkHost || u.search || u.hash || !catalogProductPattern(store).test(u.pathname)) return null;
  return 'https://' + store.inkHost + u.pathname;
}

// A resposta do storefront para o id pedido. Qualquer campo fora do contrato => null (503). Campos a mais são ignorados (só os de exibição saem).
// "ready" sem link é válido (o storefront anula um link que não reconhece): o cliente mostra o aviso de "não deu", como a pílula do storefront.
export function normalizeJob(data, id, store = ACTIVE_STORE) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== id || !STATUSES.includes(data.status)) return null;
  const label = cleanLine(data.label, MAX_LABEL);
  if (!label) return null;
  if (data.status !== 'ready') return absent(data.url) && absent(data.image) ? { id, label, status: data.status, url: null, image: null } : null;
  const url = absent(data.url) ? null : productUrl(data.url, store);
  if (!absent(data.url) && !url) return null;
  const photo = absent(data.image) ? null : safeUrl(data.image);
  if (!absent(data.image) && (!photo || !IMAGE_HOSTS.has(photo.hostname))) return null;
  return { id, label, status: 'ready', url, image: photo ? photo.href : null };
}

const log = (level, event, fields) => console[level](JSON.stringify({ event: 'use-origens.' + event, ...fields }));

export function createProductWaitGateway({ upstream = (request, init) => fetch(request, init), store = ACTIVE_STORE } = {}) {
  const json = (request, body, status) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  return {
    async handle(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const id = jobIdOf(new URL(request.url).pathname);
      if (!id) return json(request, { error: 'invalid id' }, 400);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // Pedido novo e sem cabeçalhos do visitante: nunca Cookie/Authorization. Sem cache: cada consulta é o estado de agora.
        const headers = { accept: 'application/json' };
        const visitor = await visitorKey(request, store);
        if (visitor) headers['x-origens-visitor'] = visitor;
        const response = await upstream(new Request(store.storefront + STOREFRONT_API + id, { method: 'GET', headers }), { redirect: 'manual', signal: controller.signal });
        const type = response.headers.get('content-type') || '';
        if (response.status === 404 && /json/i.test(type)) return json(request, { error: 'not found' }, 404);
        if (response.status !== 200 || !/json/i.test(type)) throw new Error('status ' + response.status);
        const text = await response.text();
        if (text.length > MAX_CHARS) throw new Error('too large');
        const clean = normalizeJob(JSON.parse(text), id, store);
        if (!clean) throw new Error('schema');
        return json(request, clean, 200);
      } catch (error) {
        // Nunca o id nem a resposta: só o motivo.
        log('warn', 'produto-unavailable', { reason: String(error && error.message).slice(0, 40) });
        return json(request, { error: 'unavailable' }, 503);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
