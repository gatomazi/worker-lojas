// pdp-guide: ajuda guiada, opcional e discreta, na página de produto da INK: "Procurando sua cidade ou outra estampa?" com duas saídas
// ([Buscar uma cidade] [Ver outras estampas]) e, quando o produto é de uma cidade, "Mais estampas de <cidade>". Substitui o bloco "Continue explorando"
// (product-discovery) quando a flag está ligada: nunca os dois. Nada abre sozinho: o painel (folha inferior no celular, diálogo compacto no desktop) só
// aparece por toque do visitante, e os resultados são páginas de produto DESTA loja (o carrinho segue por conta própria) ou páginas do storefront.
//   Dados:   /__origens/guia (o Worker lê /api/guia/<região> do storefront: catálogo e coleções sincronizados + configuração publicada) e /__origens/search
//            (a mesma busca geográfica dos outros blocos). Uma consulta por passo, com cache por página; nunca a INK.
//   Dispensa: o ✕ guarda a dispensa por 30 dias (localStorage, chave versionada) e deixa só uma linha discreta que reabre o painel. Sem armazenamento, a
//            dispensa vale só para a página aberta. Vale só neste navegador e neste domínio (www.<loja>): não reconhece a pessoa em outro aparelho.
//   Regras:  nenhum modal automático; quem escolhe cor ou tamanho não é interrompido; Esc, voltar, fechar e foco corretos; alvos ≥ 44 px; reduced-motion;
//            falha de rede/API = mensagem honesta + link para a vitrine, e a compra nativa nunca depende disto. Só observa/insere; nunca toca no formulário,
//            variantes, CTA, barra fixa, POST, CSRF nem checkout da INK.
//   Medição: só pelo gtag que a própria INK carrega e só depois do aceite do aviso de cookies dela (mesma regra de tracking.js); nunca o texto digitado.
// Strings String.raw: nada de crase nem "${" aqui dentro.
export const PDP_GUIDE = String.raw`
  const GUIDE_ATTR = 'data-origens-guide';
  const GUIDE_STYLE_ID = 'o-guide-style';
  const GUIDE_PANEL_ID = 'o-guide';
  const GUIDE_ENDPOINT = '/__origens/guia';
  const GUIDE_SEARCH_ENDPOINT = '/__origens/search';
  const GUIDE_VERSION = 'guide_v1';
  const GUIDE_DISMISS_KEY = 'origens:guia:v1:dispensado';
  const GUIDE_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
  const GUIDE_TIMEOUT_MS = 4000;
  const GUIDE_SEARCH_MAX = 5;
  const GUIDE_MIN_CHARS = 2;
  const GUIDE_DEBOUNCE_MS = 200;
  const GUIDE_IMAGE_HOST = 'gcp-images.majestic.ink.rsvcloud.com';
  const GUIDE_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  const GUIDE_HOME = STOREFRONT_ORIGIN + STOREFRONT_BASE;
  const GUIDE_SAFE_PAGE = new RegExp('^' + STOREFRONT_BASE + '(?:/[a-z0-9_-]+)*$');
  const GUIDE_CITY_PATH = new RegExp('^' + STOREFRONT_BASE + '/([a-z]{2})/([a-z0-9]+(?:-[a-z0-9]+)*)$');
  const GUIDE_COPY = {
    title: 'Procurando sua cidade ou outra estampa?',
    city: 'Buscar uma cidade', prints: 'Ver outras estampas', more: 'Mais estampas de ',
    dismiss: 'Dispensar esta ajuda', reopen: 'Procurando sua cidade ou outra estampa? Abrir a busca',
    searchTitle: 'Buscar uma cidade', searchLabel: 'Cidade ou estado', searchPlaceholder: 'Digite a cidade (ex.: Floripa, Curitiba)',
    searching: 'Buscando…', noCity: 'Não encontramos essa cidade. Tente o nome completo ou veja outras estampas.',
    searchDown: 'A busca não está disponível agora. Você ainda pode ver todas as estampas na Use Origens.',
    stateHint: 'Ver as cidades do estado', loading: 'Carregando estampas…', error: 'Não deu para carregar agora.', retry: 'Tentar de novo',
    allOfCity: 'Ver todas as estampas de ', emptyCity: 'Ainda não temos estampas de ', emptyCityTail: '. Que tal outra cidade ou uma coleção?',
    collectionsTitle: 'Ver outras estampas', collectionsLead: 'Escolha uma coleção da Use ' + STORE.name.replace(/^Use /, '') + ':',
    allOfCollection: 'Ver a coleção completa', emptyCollection: 'Esta coleção está sem produtos no momento.', noCollections: 'As coleções não estão disponíveis agora.',
    storefront: 'Ver todas as estampas na Use Origens', back: 'Voltar', close: 'Fechar', product: 'Ver produto', prints: 'Ver outras estampas',
    menuTitle: 'Procurando sua cidade ou outra estampa?'
  };
  const guideCache = new Map(); // query -> body já validado (uma consulta por passo nesta página)
  let guideDismissedMemory = false; // sem armazenamento: a dispensa vale só para a página aberta

  // ── Medição (opcional) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function guideProductSlug() { const p = window.location.pathname; return allowedNow() ? p.slice(p.lastIndexOf('/') + 1) : null; }
  function guideTrack(name, params) {
    try {
      if (!allowedNow() || typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + STORE.ga + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      const payload = { send_to: STORE.ga, region: STORE.region, surface: 'ink', entry_point: 'ink_product_detail', feature_version: GUIDE_VERSION, transport_type: 'beacon' };
      const slug = guideProductSlug(); if (slug) payload.product_slug = slug;
      for (const key of Object.keys(params || {})) payload[key] = params[key];
      window.gtag('event', name, payload);
    } catch (_) { /* medir nunca quebra a INK */ }
  }

  // ── Produto atual e dispensa ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function guideMainForm() {
    const forms = Array.prototype.filter.call(document.querySelectorAll('form[id^="form-product-"]'), (f) => !f.closest('.modal-buy-together, #quick_add_frame, #modal-wrapper, turbo-frame#cart, [data-origens-reco], [' + GUIDE_ATTR + ']'));
    return forms.length === 1 ? forms[0] : null;
  }
  function guideProductId() { const form = guideMainForm(); const m = form && /^form-product-([1-9][0-9]{0,15})$/.exec(form.id); return m ? m[1] : null; }
  function guideDismissed() {
    if (guideDismissedMemory) return true;
    try { const raw = window.localStorage.getItem(GUIDE_DISMISS_KEY); if (!raw) return false; const at = Number(JSON.parse(raw).at); return Number.isFinite(at) && Date.now() - at < GUIDE_DISMISS_MS; } catch (_) { return false; }
  }
  function guideDismiss() {
    guideDismissedMemory = true;
    try { window.localStorage.setItem(GUIDE_DISMISS_KEY, JSON.stringify({ v: 1, at: Date.now() })); } catch (_) { /* sem armazenamento: só esta página */ }
  }

  // ── Rede (gateway do Worker, mesma origem, sem credenciais) ───────────────────────────────────────────────────────────────────────
  function guideFetchJson(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GUIDE_TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    return fetch(withRegion(url), { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null)).catch(() => null).finally(() => clearTimeout(timer));
  }
  // Defesa em profundidade: o Worker já validou; aqui o mesmo contrato antes de virar link/imagem.
  function guideItem(raw) {
    try {
      if (!raw || typeof raw !== 'object') return null;
      const id = String(raw.productId || '');
      if (!/^[1-9][0-9]{0,15}$/.test(id)) return null;
      const href = new URL(raw.href);
      if (href.protocol !== 'https:' || href.hostname !== STORE.inkHost || href.port || href.username || href.password || href.search || href.hash || !CATALOG_PRODUCT_PATH.test(href.pathname)) return null;
      const image = new URL(raw.image);
      if (image.protocol !== 'https:' || image.hostname !== GUIDE_IMAGE_HOST || image.port || image.username || image.password) return null;
      const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim() : '';
      if (!title || title.length > 90) return null;
      if (typeof raw.price !== 'number' || !isFinite(raw.price) || raw.price <= 0 || raw.price > 2000) return null;
      const context = typeof raw.context === 'string' && raw.context.length <= 60 ? raw.context.replace(/\s+/g, ' ').trim() : '';
      const listPrice = typeof raw.listPrice === 'number' && isFinite(raw.listPrice) && raw.listPrice > raw.price ? raw.listPrice : null;
      return { id, href: href.href, image: image.href, title, context, price: raw.price, listPrice };
    } catch (_) { return null; }
  }
  function guidePage(value) {
    try { const url = new URL(value); if (url.origin !== STOREFRONT_ORIGIN || url.username || url.password || url.search || url.hash || !GUIDE_SAFE_PAGE.test(url.pathname)) return null; return url.href; } catch (_) { return null; }
  }
  function guidePlace(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
    const url = guidePage(raw.url);
    if (!name || name.length > 60 || !url || typeof raw.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug) || typeof raw.uf !== 'string' || !/^[A-Z]{2}$/.test(raw.uf)) return null;
    return { name, uf: raw.uf, slug: raw.slug, kind: raw.kind === 'ra' ? 'ra' : 'city', url };
  }
  function guideCollection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
    const url = guidePage(raw.url);
    if (!name || name.length > 60 || !url || typeof raw.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug)) return null;
    let image = null;
    try { if (raw.image) { const u = new URL(raw.image); if (u.protocol === 'https:' && u.hostname === GUIDE_IMAGE_HOST) image = u.href; } } catch (_) { /* sem foto */ }
    return { name, slug: raw.slug, url, image, total: Number.isSafeInteger(raw.total) && raw.total > 0 ? raw.total : 0 };
  }
  function guideLoad(query, signal) {
    if (guideCache.has(query)) return Promise.resolve(guideCache.get(query));
    return guideFetchJson(GUIDE_ENDPOINT + (query ? '?' + query : ''), signal).then((data) => {
      if (!data || typeof data !== 'object') return { ok: false };
      let body = { ok: false, notFound: !!data.notFound };
      if (data.ok === true) {
        if (data.kind === 'produto') body = { ok: true, city: guidePlace(data.city) };
        else if (data.kind === 'cidade') { const city = guidePlace(data.city); if (city) body = { ok: true, city, items: (Array.isArray(data.items) ? data.items : []).map(guideItem).filter(Boolean).slice(0, 3), total: Number.isSafeInteger(data.total) ? data.total : 0 }; }
        else if (data.kind === 'colecao') { const collection = guideCollection(data.collection); if (collection) body = { ok: true, collection, items: (Array.isArray(data.items) ? data.items : []).map(guideItem).filter(Boolean).slice(0, 4), total: Number.isSafeInteger(data.total) ? data.total : 0 }; }
        else if (data.kind === 'colecoes') body = { ok: true, collections: (Array.isArray(data.collections) ? data.collections : []).map(guideCollection).filter(Boolean).slice(0, 8) };
      }
      if (body.ok) { if (guideCache.size > 30) guideCache.clear(); guideCache.set(query, body); }
      return body;
    });
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const GUIDE_CSS = [
    '[' + GUIDE_ATTR + '="invite"]{--o-tint:#1f2328;box-sizing:border-box;position:relative;margin:16px 0 8px;padding:14px 44px 14px 16px;border:1px solid #d9d5c3;border-radius:12px;background:#f6f4ec;color:#111827;font-family:inherit;text-align:left}',
    '[' + GUIDE_ATTR + '] *,#' + GUIDE_PANEL_ID + ' *{box-sizing:border-box;font-family:inherit}',
    '[' + GUIDE_ATTR + '="invite"] .o-g-title{margin:0 0 10px;font-size:16px;line-height:1.3;font-weight:600;color:#111827}',
    '[' + GUIDE_ATTR + '="invite"] .o-g-x{position:absolute;top:4px;right:4px;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:0;background:none;color:#4b5563;cursor:pointer;border-radius:8px}',
    '[' + GUIDE_ATTR + '="invite"] .o-g-x:focus-visible,[' + GUIDE_ATTR + '] .o-g-btn:focus-visible,[' + GUIDE_ATTR + '] .o-g-reopen:focus-visible{outline:2px solid var(--o-tint);outline-offset:2px}',
    '[' + GUIDE_ATTR + '] .o-g-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '[' + GUIDE_ATTR + '] .o-g-btn{flex:1 1 150px;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;margin:0;padding:8px 12px;border:1px solid var(--o-tint);border-radius:8px;background:#fff;color:var(--o-tint);font-size:14px;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '[' + GUIDE_ATTR + '] .o-g-btn.o-g-more{flex-basis:100%;background:transparent;border-style:dashed;font-weight:500}',
    '@media (hover:hover){[' + GUIDE_ATTR + '] .o-g-btn:hover{background:var(--o-tint);color:#fff}}',
    '[' + GUIDE_ATTR + '="reopen"]{margin:10px 0 6px;text-align:center}',
    '[' + GUIDE_ATTR + '] .o-g-reopen{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:6px 8px;border:0;background:none;color:#374151;font-size:13px;font-weight:500;line-height:1.3;text-decoration:underline;text-underline-offset:3px;cursor:pointer;border-radius:6px}',
    // Painel: folha inferior no celular, diálogo compacto no desktop. Largura VISÍVEL do documento (a PDP da INK é mais larga que a tela no celular).
    '#' + GUIDE_PANEL_ID + '{--o-tint:#1f2328;position:fixed;top:0;bottom:0;left:0;width:var(--o-vw,100%);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;font-family:inherit;color:#1f2328}',
    '#' + GUIDE_PANEL_ID + ' .o-g-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}',
    '#' + GUIDE_PANEL_ID + ' .o-g-sheet{position:relative;display:flex;flex-direction:column;width:100%;max-width:480px;max-height:min(86vh,86dvh);background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.18);padding-bottom:env(safe-area-inset-bottom)}',
    '@media (min-width:640px){#' + GUIDE_PANEL_ID + '{align-items:center}#' + GUIDE_PANEL_ID + ' .o-g-sheet{max-width:520px;max-height:min(80vh,720px);border-radius:14px}}',
    '#' + GUIDE_PANEL_ID + ' .o-g-head{display:flex;align-items:center;gap:4px;padding:8px 8px 4px 8px;border-bottom:1px solid #e5e7eb}',
    '#' + GUIDE_PANEL_ID + ' .o-g-head h2{flex:1;margin:0;padding:0 4px;font-size:17px;line-height:1.3;font-weight:600;overflow-wrap:anywhere}',
    '#' + GUIDE_PANEL_ID + ' .o-g-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:44px;min-height:44px;margin:0;padding:0;border:0;background:none;color:inherit;cursor:pointer;border-radius:8px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-icon[hidden]{display:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-icon:focus-visible,#' + GUIDE_PANEL_ID + ' .o-g-item:focus-visible,#' + GUIDE_PANEL_ID + ' .o-g-card:focus-visible,#' + GUIDE_PANEL_ID + ' .o-g-link:focus-visible,#' + GUIDE_PANEL_ID + ' .o-g-tile:focus-visible,#' + GUIDE_PANEL_ID + ' .o-g-btn:focus-visible{outline:2px solid var(--o-tint);outline-offset:2px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px 8px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-foot{flex:none;padding:8px 16px 14px;border-top:1px solid #e5e7eb;text-align:center}',
    '#' + GUIDE_PANEL_ID + ' .o-g-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:6px 8px;color:var(--o-tint);font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px;border-radius:6px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-lead{margin:0 0 10px;font-size:14px;line-height:1.4;color:#4b5563}',
    '#' + GUIDE_PANEL_ID + ' .o-g-menu{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-field{position:relative}',
    '#' + GUIDE_PANEL_ID + ' .o-g-field label{display:block;margin:0 0 6px;font-size:13px;font-weight:600;color:#374151}',
    '#' + GUIDE_PANEL_ID + ' .o-g-input{display:block;width:100%;height:48px;margin:0;padding:0 14px;border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#111827;font-size:16px;line-height:1.2;outline:none;-webkit-appearance:none;appearance:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-input:focus{border-color:var(--o-tint);box-shadow:0 0 0 2px var(--o-tint)}',
    '#' + GUIDE_PANEL_ID + ' .o-g-list{margin:8px 0 0;padding:0;list-style:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-list[hidden]{display:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-item{display:flex;flex-direction:column;justify-content:center;gap:1px;width:100%;min-height:48px;margin:0;padding:8px 12px;border:0;border-radius:8px;background:none;color:#111827;font-size:14px;text-align:left;text-decoration:none;cursor:pointer}',
    '#' + GUIDE_PANEL_ID + ' .o-g-item[aria-selected="true"],#' + GUIDE_PANEL_ID + ' .o-g-item:hover{background:#efede3}',
    '#' + GUIDE_PANEL_ID + ' .o-g-name{font-weight:600;line-height:1.3}',
    '#' + GUIDE_PANEL_ID + ' .o-g-sub{font-size:12px;line-height:1.3;color:#4b5563}',
    '#' + GUIDE_PANEL_ID + ' .o-g-status{margin:10px 0 0;font-size:13px;line-height:1.4;color:#4b5563}',
    '#' + GUIDE_PANEL_ID + ' .o-g-status:empty{display:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-grid.o-g-four{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '@media (min-width:640px){#' + GUIDE_PANEL_ID + ' .o-g-grid.o-g-four{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    '#' + GUIDE_PANEL_ID + ' .o-g-card{display:flex;flex-direction:column;height:100%;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#111827;text-decoration:none;overflow:hidden}',
    '#' + GUIDE_PANEL_ID + ' .o-g-card:hover{border-color:var(--o-tint)}',
    '#' + GUIDE_PANEL_ID + ' .o-g-media{display:block;position:relative;width:100%;aspect-ratio:920/1050;background:#f3f4f6}',
    '#' + GUIDE_PANEL_ID + ' .o-g-media img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;border:0}',
    '#' + GUIDE_PANEL_ID + ' .o-g-cbody{display:flex;flex-direction:column;gap:2px;padding:8px 8px 10px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-cname{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.3;font-weight:600;overflow-wrap:anywhere}',
    '#' + GUIDE_PANEL_ID + ' .o-g-ccontext{font-size:11px;line-height:1.3;color:#4b5563}',
    '#' + GUIDE_PANEL_ID + ' .o-g-cprice{margin-top:2px;font-size:14px;line-height:1.3;font-weight:700}',
    '#' + GUIDE_PANEL_ID + ' .o-g-cprice s{margin-right:4px;font-size:12px;font-weight:400;color:#6b7280}',
    '#' + GUIDE_PANEL_ID + ' .o-g-ccta{margin-top:auto;padding-top:4px;font-size:12px;font-weight:600;color:var(--o-tint);text-decoration:underline;text-underline-offset:2px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tile{display:flex;align-items:center;gap:10px;width:100%;min-height:64px;margin:0;padding:8px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#111827;font-size:14px;font-weight:600;line-height:1.25;text-align:left;cursor:pointer;overflow:hidden}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tile:hover{border-color:var(--o-tint)}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tile img{flex:none;width:48px;height:56px;object-fit:cover;border-radius:6px;background:#f3f4f6}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tile .o-g-tname{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '#' + GUIDE_PANEL_ID + ' .o-g-tile .o-g-tcount{font-size:11px;font-weight:400;color:#4b5563}',
    '#' + GUIDE_PANEL_ID + ' .o-g-after{margin:12px 0 0;text-align:center}',
    '#' + GUIDE_PANEL_ID + ' .o-g-actions{margin-top:12px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-btn{flex:1 1 140px;display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:8px 12px;border:1px solid var(--o-tint);border-radius:8px;background:#fff;color:var(--o-tint);font-size:14px;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer}',
    '#' + GUIDE_PANEL_ID + ' .o-g-menu .o-g-btn{width:100%;justify-content:flex-start;padding:10px 14px;min-height:52px}',
    '#' + GUIDE_PANEL_ID + ' .o-g-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '@media (prefers-reduced-motion:reduce){#' + GUIDE_PANEL_ID + ' *,[' + GUIDE_ATTR + '] *{transition:none!important;animation:none!important}}'
  ].join('');
  const GUIDE_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const GUIDE_BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  const GUIDE_PIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const GUIDE_GRID = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';

  function guideEl(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const key of Object.keys(attrs || {})) { if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]); }
    if (text != null) node.textContent = text;
    return node;
  }
  function guideIcon(cls, html, label) { const b = guideEl('button', { type: 'button', class: cls, 'aria-label': label }); b.innerHTML = html; return b; }
  function guideButton(label, iconHtml, extraClass) {
    const b = guideEl('button', { type: 'button', class: 'o-g-btn' + (extraClass ? ' ' + extraClass : '') });
    if (iconHtml) { const i = guideEl('span', { 'aria-hidden': 'true' }); i.innerHTML = iconHtml; i.style.cssText = 'display:inline-flex;flex:none'; b.appendChild(i); }
    b.appendChild(guideEl('span', null, label));
    return b;
  }
  const guidePrice = (value) => { try { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch (_) { return 'R$ ' + value.toFixed(2).replace('.', ','); } };
  function guideEnsureStyle() {
    if (document.getElementById(GUIDE_STYLE_ID)) return;
    const style = document.createElement('style'); style.id = GUIDE_STYLE_ID; style.textContent = GUIDE_CSS; document.head.appendChild(style);
  }
  function guideCard(item, path, position) {
    const li = guideEl('li');
    const a = guideEl('a', { class: 'o-g-card', href: item.href, 'data-product-id': item.id, 'data-position': String(position), 'data-guide-path': path, 'aria-label': item.title + (item.context ? ', ' + item.context : '') + ', ' + guidePrice(item.price) });
    const media = guideEl('span', { class: 'o-g-media' });
    const img = guideEl('img', { src: item.image, alt: '', width: '460', height: '525', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.remove(); media.setAttribute('data-missing', ''); }, { once: true }); // sem foto: só o fundo cinza, nunca um ícone quebrado
    media.appendChild(img);
    const body = guideEl('span', { class: 'o-g-cbody' });
    body.appendChild(guideEl('span', { class: 'o-g-cname' }, item.title));
    if (item.context) body.appendChild(guideEl('span', { class: 'o-g-ccontext' }, item.context));
    const price = guideEl('span', { class: 'o-g-cprice' });
    if (item.listPrice) price.appendChild(guideEl('s', null, guidePrice(item.listPrice)));
    price.appendChild(document.createTextNode(guidePrice(item.price)));
    body.appendChild(price);
    body.appendChild(guideEl('span', { class: 'o-g-ccta' }, GUIDE_COPY.product));
    a.append(media, body); li.appendChild(a);
    return li;
  }

  // ── Painel (uma instância; passos: menu | city | city-results | collections | collection-results) ────────────────────────────────
  let guidePanel = null; // { root, sheet, title, back, body, foot, ac, trigger, stack, step, search }
  function guideClose(returnFocus) {
    const p = guidePanel; if (!p) return;
    guidePanel = null;
    if (p.search && p.search.abort) p.search.abort.abort();
    if (p.load) p.load.abort();
    p.ac.abort(); p.root.remove();
    if (p.locked) document.documentElement.style.overflow = p.lock;
    if (returnFocus !== false && p.trigger && p.trigger.isConnected) { try { p.trigger.focus({ preventScroll: true }); } catch (_) { /* ignora */ } }
  }
  function guideFocusables(p) { return Array.from(p.sheet.querySelectorAll('button:not([hidden]), a[href], input')).filter((el) => el.getClientRects().length > 0 || el === document.activeElement); }
  function guideOpen(step, ctx, trigger, path) {
    if (!allowedNow()) return;
    guideClose(false);
    guideEnsureStyle();
    const root = guideEl('div', { id: GUIDE_PANEL_ID, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'o-g-title' });
    root.style.setProperty('--o-tint', GUIDE_TINT);
    root.style.setProperty('--o-vw', (document.documentElement.clientWidth || window.innerWidth) + 'px');
    const backdrop = guideEl('div', { class: 'o-g-backdrop' });
    const sheet = guideEl('div', { class: 'o-g-sheet' });
    const head = guideEl('div', { class: 'o-g-head' });
    const back = guideIcon('o-g-icon o-g-back', GUIDE_BACK, GUIDE_COPY.back); back.hidden = true;
    const title = guideEl('h2', { id: 'o-g-title' });
    const close = guideIcon('o-g-icon o-g-close', GUIDE_X, GUIDE_COPY.close);
    head.append(back, title, close);
    const body = guideEl('div', { class: 'o-g-body' });
    const foot = guideEl('div', { class: 'o-g-foot' });
    foot.appendChild(guideEl('a', { class: 'o-g-link', href: GUIDE_HOME }, GUIDE_COPY.storefront));
    sheet.append(head, body, foot);
    root.append(backdrop, sheet);
    document.body.appendChild(root);
    const ac = new AbortController();
    const p = { root, sheet, title, back, body, foot, ac, trigger, stack: [], step: null, search: null, load: null, ctx: ctx || {}, lock: document.documentElement.style.overflow, locked: false };
    guidePanel = p;
    if (window.matchMedia && window.matchMedia('(max-width: 639px)').matches) { document.documentElement.style.overflow = 'hidden'; p.locked = true; }
    close.addEventListener('click', () => guideClose(true), { signal: ac.signal });
    backdrop.addEventListener('click', () => guideClose(true), { signal: ac.signal });
    back.addEventListener('click', () => guideBack(p), { signal: ac.signal });
    // Esc fecha o painel (e não chega ao Turbo/INK); Tab fica dentro do diálogo.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); guideClose(true); return; }
      if (event.key !== 'Tab') return;
      const items = guideFocusables(p); if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }, { capture: true, signal: ac.signal });
    // Clique num produto do guia: medição e fim da orientação (a página de produto da INK abre normalmente).
    root.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a.o-g-card') : null;
      if (link && event.button === 0) guideTrack('origens_guide_product_click', { guide_path: link.getAttribute('data-guide-path') || '', position: Number(link.getAttribute('data-position')) || 0, target_product_id: link.getAttribute('data-product-id') || '' });
    }, { signal: ac.signal });
    window.__useOrigens.onTeardown(() => guideClose(false));
    guideTrack('origens_guide_open', { guide_path: path || step });
    guideGo(p, step, ctx, false);
  }
  function guideBack(p) {
    const prev = p.stack.pop();
    if (!prev) { guideClose(true); return; }
    guideGo(p, prev.step, prev.ctx, true);
  }
  function guideGo(p, step, ctx, isBack) {
    if (guidePanel !== p) return;
    if (p.step && !isBack) p.stack.push({ step: p.step, ctx: p.ctx });
    if (p.search && p.search.abort) p.search.abort.abort();
    if (p.load) { p.load.abort(); p.load = null; }
    p.step = step; p.ctx = ctx || {}; p.search = null;
    p.body.textContent = '';
    p.body.scrollTop = 0;
    p.back.hidden = p.stack.length === 0;
    if (step === 'menu') guideStepMenu(p);
    else if (step === 'city') guideStepCity(p);
    else if (step === 'city-results') guideStepCityResults(p);
    else if (step === 'collections') guideStepCollections(p);
    else if (step === 'collection-results') guideStepCollectionResults(p);
    const focus = p.body.querySelector('input, button, a[href]') || p.back.hidden ? (p.body.querySelector('input, button, a[href]') || p.root.querySelector('.o-g-close')) : p.back;
    try { (p.body.querySelector('input') || focus).focus({ preventScroll: true }); } catch (_) { /* ignora */ }
  }
  function guideStepMenu(p) {
    p.title.textContent = GUIDE_COPY.menuTitle;
    const list = guideEl('ul', { class: 'o-g-menu' });
    const add = (label, icon, onClick) => { const li = guideEl('li'); const b = guideButton(label, icon); b.addEventListener('click', onClick, { signal: p.ac.signal }); li.appendChild(b); list.appendChild(li); };
    if (p.ctx.city) add(GUIDE_COPY.more + p.ctx.city.name, GUIDE_PIN, () => guideGo(p, 'city-results', { city: p.ctx.city, path: 'city_context' }));
    add(GUIDE_COPY.city, GUIDE_PIN, () => guideGo(p, 'city', { city: p.ctx.city }));
    add(GUIDE_COPY.prints, GUIDE_GRID, () => guideGo(p, 'collections', { city: p.ctx.city }));
    p.body.appendChild(list);
  }
  // Busca de cidade: a mesma busca geográfica dos outros blocos (/__origens/search), cidade + UF, apelidos incluídos.
  function guideStepCity(p) {
    p.title.textContent = GUIDE_COPY.searchTitle;
    const uid = 'o-g-' + Math.random().toString(36).slice(2, 7);
    const field = guideEl('div', { class: 'o-g-field' });
    field.appendChild(guideEl('label', { for: uid + '-input' }, GUIDE_COPY.searchLabel));
    const input = guideEl('input', { id: uid + '-input', class: 'o-g-input', type: 'text', maxlength: '40', placeholder: GUIDE_COPY.searchPlaceholder, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': uid + '-list', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'search', enterkeyhint: 'go' });
    field.appendChild(input);
    const list = guideEl('ul', { id: uid + '-list', class: 'o-g-list', role: 'listbox', 'aria-label': 'Cidades e estados encontrados' }); list.hidden = true;
    const status = guideEl('p', { class: 'o-g-status', role: 'status', 'aria-live': 'polite' });
    p.body.append(field, list, status);
    const s = { input, list, status, uid, timer: null, abort: null, seq: 0, results: [], active: -1 };
    p.search = s;
    const setActive = (index) => {
      if (!s.results.length) return;
      s.active = (index + s.results.length) % s.results.length;
      Array.prototype.forEach.call(list.children, (node, i) => node.firstElementChild.setAttribute('aria-selected', i === s.active ? 'true' : 'false'));
      input.setAttribute('aria-activedescendant', uid + '-opt-' + s.active);
    };
    const render = (results) => {
      s.results = results; s.active = -1; list.textContent = '';
      results.forEach((r, i) => {
        const li = guideEl('li');
        const m = GUIDE_CITY_PATH.exec(new URL(r.href).pathname);
        // Cidade: abre o passo de resultados aqui mesmo. Estado: link normal para a página do estado no storefront (lá estão as cidades).
        const node = m ? guideEl('button', { type: 'button', class: 'o-g-item', id: uid + '-opt-' + i, role: 'option', 'aria-selected': 'false' }) : guideEl('a', { class: 'o-g-item', href: r.href, id: uid + '-opt-' + i, role: 'option', 'aria-selected': 'false' });
        node.appendChild(guideEl('span', { class: 'o-g-name' }, r.name));
        node.appendChild(guideEl('span', { class: 'o-g-sub' }, r.type === 'state' ? GUIDE_COPY.stateHint : (r.meso ? r.uf + ' · ' + r.meso : r.uf)));
        if (m) node.addEventListener('click', () => { guideTrack('origens_guide_city_select', { city_slug: m[2], uf: m[1].toUpperCase() }); guideGo(p, 'city-results', { city: { name: r.name, uf: r.uf, slug: m[2], kind: r.type === 'city' ? 'city' : 'city', url: r.href, ufPath: m[1] }, path: 'city' }); }, { signal: p.ac.signal });
        node.addEventListener('mouseenter', () => setActive(i), { signal: p.ac.signal });
        li.appendChild(node); list.appendChild(li);
      });
      list.hidden = results.length === 0;
      input.setAttribute('aria-expanded', results.length ? 'true' : 'false');
      input.removeAttribute('aria-activedescendant');
      if (results.length) setActive(0);
    };
    const validate = (data) => {
      if (!data || !Array.isArray(data.results)) return null;
      const out = [];
      for (const item of data.results) {
        if (out.length >= GUIDE_SEARCH_MAX) break;
        if (!item || (item.type !== 'city' && item.type !== 'state') || typeof item.name !== 'string' || item.name.length > 60 || typeof item.uf !== 'string' || !/^[A-Z]{2}$/.test(item.uf)) continue;
        const href = typeof item.href === 'string' ? guidePage(item.href) : null;
        if (!href) continue;
        out.push({ type: item.type, name: item.name, uf: item.uf, meso: typeof item.meso === 'string' && item.meso.length <= 80 ? item.meso : '', href });
      }
      return out;
    };
    const run = async (query) => {
      if (p.search !== s || !allowedNow()) return;
      if (s.abort) s.abort.abort();
      const seq = ++s.seq; const controller = new AbortController(); s.abort = controller;
      const timeout = setTimeout(() => controller.abort(), GUIDE_TIMEOUT_MS);
      status.textContent = GUIDE_COPY.searching;
      try {
        const response = await fetch(withRegion(GUIDE_SEARCH_ENDPOINT + '?q=' + encodeURIComponent(query)), { signal: controller.signal, credentials: 'omit', headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error('status ' + response.status);
        const results = validate(await response.json());
        if (results === null) throw new Error('schema');
        if (p.search !== s || seq !== s.seq) return;
        render(results);
        status.textContent = results.length ? results.length + (results.length === 1 ? ' resultado.' : ' resultados.') : GUIDE_COPY.noCity;
      } catch (_) {
        if (p.search !== s || seq !== s.seq) return;
        render([]); status.textContent = GUIDE_COPY.searchDown; guideTrack('origens_guide_error', { guide_step: 'city_search' });
      } finally { clearTimeout(timeout); }
    };
    input.addEventListener('input', () => {
      clearTimeout(s.timer);
      const query = input.value.replace(/[^\p{L}\p{M}\p{N} .,'’\-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (query.length < GUIDE_MIN_CHARS) { if (s.abort) s.abort.abort(); s.seq++; render([]); status.textContent = ''; return; }
      s.timer = setTimeout(() => run(query), GUIDE_DEBOUNCE_MS);
    }, { signal: p.ac.signal });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { if (s.results.length) { event.preventDefault(); setActive(s.active + 1); } }
      else if (event.key === 'ArrowUp') { if (s.results.length) { event.preventDefault(); setActive(s.active - 1); } }
      else if (event.key === 'Enter') { const li = list.children[s.active < 0 ? 0 : s.active]; if (li) { event.preventDefault(); li.firstElementChild.click(); } }
    }, { signal: p.ac.signal });
    if (p.ctx.city) {
      const after = guideEl('div', { class: 'o-g-actions o-g-after' });
      const more = guideButton(GUIDE_COPY.more + p.ctx.city.name, GUIDE_PIN, 'o-g-more');
      more.addEventListener('click', () => guideGo(p, 'city-results', { city: p.ctx.city, path: 'city_context' }), { signal: p.ac.signal });
      after.appendChild(more); p.body.appendChild(after);
    }
  }
  function guideLoading(p, text) { p.body.appendChild(guideEl('p', { class: 'o-g-status', role: 'status', 'aria-live': 'polite' }, text)); }
  function guideError(p, retry) {
    p.body.textContent = '';
    p.body.appendChild(guideEl('p', { class: 'o-g-lead', role: 'alert' }, GUIDE_COPY.error));
    const actions = guideEl('div', { class: 'o-g-actions' });
    const again = guideButton(GUIDE_COPY.retry); again.addEventListener('click', retry, { signal: p.ac.signal });
    actions.appendChild(again); p.body.appendChild(actions);
  }
  function guideStepCityResults(p) {
    const city = p.ctx.city; const path = p.ctx.path || 'city';
    p.title.textContent = 'Estampas de ' + city.name + (city.kind === 'ra' ? ' (RA)' : '');
    guideLoading(p, GUIDE_COPY.loading);
    const ac = new AbortController(); p.load = ac;
    const query = 'cidade=' + (city.ufPath || city.uf.toLowerCase()) + '/' + city.slug + (guideProductId() ? '&produto=' + guideProductId() : '');
    guideLoad(query, ac.signal).then((body) => {
      if (guidePanel !== p || p.load !== ac) return;
      p.load = null; p.body.textContent = '';
      if (!body.ok && !body.notFound) { guideTrack('origens_guide_error', { guide_step: 'city_results' }); return guideError(p, () => guideGo(p, 'city-results', p.ctx, true)); }
      const items = body.ok ? body.items : [];
      guideTrack('origens_guide_results', { guide_path: path, result_count: items.length, has_results: items.length ? 'true' : 'false' });
      if (!items.length) {
        p.body.appendChild(guideEl('p', { class: 'o-g-lead' }, GUIDE_COPY.emptyCity + city.name + GUIDE_COPY.emptyCityTail));
        const actions = guideEl('div', { class: 'o-g-actions' });
        const other = guideButton(GUIDE_COPY.city, GUIDE_PIN); other.addEventListener('click', () => guideGo(p, 'city', { city: p.ctx.contextCity }), { signal: p.ac.signal });
        const prints = guideButton(GUIDE_COPY.prints, GUIDE_GRID); prints.addEventListener('click', () => guideGo(p, 'collections', {}), { signal: p.ac.signal });
        actions.append(other, prints); p.body.appendChild(actions);
        return;
      }
      const grid = guideEl('ul', { class: 'o-g-grid', 'aria-label': 'Estampas de ' + city.name });
      items.forEach((item, i) => grid.appendChild(guideCard(item, path, i + 1)));
      p.body.appendChild(grid);
      const after = guideEl('p', { class: 'o-g-after' });
      const url = body.ok && body.city ? body.city.url : city.url;
      after.appendChild(guideEl('a', { class: 'o-g-link', href: url }, GUIDE_COPY.allOfCity + city.name + (body.total > items.length ? ' (' + body.total + ')' : '')));
      p.body.appendChild(after);
    });
  }
  function guideStepCollections(p) {
    p.title.textContent = GUIDE_COPY.collectionsTitle;
    guideLoading(p, GUIDE_COPY.loading);
    const ac = new AbortController(); p.load = ac;
    guideLoad('', ac.signal).then((body) => {
      if (guidePanel !== p || p.load !== ac) return;
      p.load = null; p.body.textContent = '';
      if (!body.ok) { guideTrack('origens_guide_error', { guide_step: 'collections' }); return guideError(p, () => guideGo(p, 'collections', p.ctx, true)); }
      if (!body.collections.length) { p.body.appendChild(guideEl('p', { class: 'o-g-lead' }, GUIDE_COPY.noCollections)); return; }
      p.body.appendChild(guideEl('p', { class: 'o-g-lead' }, GUIDE_COPY.collectionsLead));
      const tiles = guideEl('ul', { class: 'o-g-tiles' });
      for (const c of body.collections) {
        const li = guideEl('li');
        const b = guideEl('button', { type: 'button', class: 'o-g-tile', 'data-slug': c.slug, 'aria-label': c.name + (c.total ? ', ' + c.total.toLocaleString('pt-BR') + (c.total === 1 ? ' estampa' : ' estampas') : '') });
        if (c.image) { const img = guideEl('img', { src: c.image, alt: '', width: '48', height: '56', loading: 'lazy', decoding: 'async' }); img.addEventListener('error', () => img.remove(), { once: true }); b.appendChild(img); }
        const name = guideEl('span', { class: 'o-g-tname' }); name.appendChild(guideEl('span', null, c.name));
        if (c.total) name.appendChild(guideEl('span', { class: 'o-g-tcount' }, c.total.toLocaleString('pt-BR') + (c.total === 1 ? ' estampa' : ' estampas')));
        b.appendChild(name);
        b.addEventListener('click', () => guideGo(p, 'collection-results', { collection: c }), { signal: p.ac.signal });
        li.appendChild(b); tiles.appendChild(li);
      }
      p.body.appendChild(tiles);
    });
  }
  function guideStepCollectionResults(p) {
    const c = p.ctx.collection;
    p.title.textContent = c.name;
    guideLoading(p, GUIDE_COPY.loading);
    const ac = new AbortController(); p.load = ac;
    guideLoad('colecao=' + c.slug, ac.signal).then((body) => {
      if (guidePanel !== p || p.load !== ac) return;
      p.load = null; p.body.textContent = '';
      if (!body.ok && !body.notFound) { guideTrack('origens_guide_error', { guide_step: 'collection_results' }); return guideError(p, () => guideGo(p, 'collection-results', p.ctx, true)); }
      const items = body.ok ? body.items : [];
      guideTrack('origens_guide_results', { guide_path: 'prints', result_count: items.length, has_results: items.length ? 'true' : 'false' });
      if (!items.length) { p.body.appendChild(guideEl('p', { class: 'o-g-lead' }, GUIDE_COPY.emptyCollection)); }
      else { const grid = guideEl('ul', { class: 'o-g-grid o-g-four', 'aria-label': c.name }); items.forEach((item, i) => grid.appendChild(guideCard(item, 'prints', i + 1))); p.body.appendChild(grid); }
      const after = guideEl('p', { class: 'o-g-after' });
      const total = body.ok ? body.total : c.total;
      after.appendChild(guideEl('a', { class: 'o-g-link', href: body.ok && body.collection ? body.collection.url : c.url }, GUIDE_COPY.allOfCollection + (total > items.length ? ' (' + total.toLocaleString('pt-BR') + ')' : '')));
      p.body.appendChild(after);
    });
  }

  // ── Convite (na página, abaixo do CTA nativo e fora do formulário) e linha de reabertura ─────────────────────────────────────────
  function guideRenderInvite(root, ctx) {
    root.textContent = '';
    root.setAttribute(GUIDE_ATTR, 'invite');
    root.setAttribute('aria-labelledby', 'o-g-invite-title');
    const title = guideEl('h4', { id: 'o-g-invite-title', class: 'o-g-title' }, GUIDE_COPY.title);
    const x = guideIcon('o-g-x', GUIDE_X, GUIDE_COPY.dismiss);
    const actions = guideEl('div', { class: 'o-g-actions' });
    const city = guideButton(GUIDE_COPY.city, GUIDE_PIN); city.setAttribute('aria-haspopup', 'dialog');
    const prints = guideButton(GUIDE_COPY.prints, GUIDE_GRID); prints.setAttribute('aria-haspopup', 'dialog');
    actions.append(city, prints);
    if (ctx.city) { const more = guideButton(GUIDE_COPY.more + ctx.city.name, null, 'o-g-more'); more.setAttribute('aria-haspopup', 'dialog'); more.setAttribute('data-guide-more', ''); actions.appendChild(more); more.addEventListener('click', () => guideOpen('city-results', { city: ctx.city, path: 'city_context', contextCity: ctx.city }, more, 'city_context')); }
    city.addEventListener('click', () => guideOpen('city', { city: ctx.city, contextCity: ctx.city }, city, 'city'));
    prints.addEventListener('click', () => guideOpen('collections', { city: ctx.city }, prints, 'prints'));
    x.addEventListener('click', () => { guideDismiss(); guideTrack('origens_guide_dismiss', {}); const reopen = guideRenderReopen(root, ctx); try { reopen.querySelector('button').focus({ preventScroll: true }); } catch (_) { /* ignora */ } });
    root.append(title, x, actions);
    return root;
  }
  function guideRenderReopen(root, ctx) {
    root.textContent = '';
    root.setAttribute(GUIDE_ATTR, 'reopen');
    root.removeAttribute('aria-labelledby');
    const b = guideEl('button', { type: 'button', class: 'o-g-reopen', 'aria-haspopup': 'dialog' }, GUIDE_COPY.reopen);
    b.addEventListener('click', () => guideOpen('menu', { city: ctx.city, contextCity: ctx.city }, b, 'reopen'));
    root.appendChild(b);
    return root;
  }

  register({
    id: 'pdp-guide',
    ctxLoad: null, // { path, ac }
    viewed: new Set(), // pathnames cuja exposição já foi medida
    observer: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      const path = window.location.pathname;
      const current = document.querySelector('[' + GUIDE_ATTR + '="invite"], [' + GUIDE_ATTR + '="reopen"]');
      if (current && current.isConnected && current.getAttribute('data-path') === path) return; // idempotente pela existência
      if (current) current.remove(); // sobra de outra página (Turbo)
      const anchor = findAnchor();
      if (!anchor) return;
      const form = anchor.closest('form');
      const host = form && form.parentElement ? form : anchor;
      guideEnsureStyle();
      const root = guideEl('section');
      root.setAttribute('data-path', path);
      root.style.setProperty('--o-tint', GUIDE_TINT);
      const ctx = { city: null };
      if (guideDismissed()) guideRenderReopen(root, ctx); else guideRenderInvite(root, ctx);
      host.insertAdjacentElement('afterend', root);
      // Exposição visível (uma vez por página): o convite de fato na tela, não só no DOM.
      if (!this.viewed.has(path) && typeof IntersectionObserver === 'function' && root.getAttribute(GUIDE_ATTR) === 'invite') {
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) { this.viewed.add(path); guideTrack('origens_guide_view', {}); this.observer.disconnect(); this.observer = null; }
        }, { threshold: [0.5] });
        this.observer.observe(root);
      }
      // Contexto do produto (cidade): só acrescenta "Mais estampas de <cidade>" quando o storefront confirma que o produto é de uma cidade.
      const productId = guideProductId();
      if (!productId || (this.ctxLoad && this.ctxLoad.path === path)) return;
      if (this.ctxLoad) this.ctxLoad.ac.abort();
      const ac = new AbortController(); this.ctxLoad = { path, ac };
      guideLoad('produto=' + productId, ac.signal).then((body) => {
        if (this.ctxLoad && this.ctxLoad.ac === ac) this.ctxLoad = null;
        if (!body.ok || !body.city || window.location.pathname !== path || !root.isConnected) return;
        ctx.city = body.city;
        if (root.getAttribute(GUIDE_ATTR) === 'invite' && !root.querySelector('[data-guide-more]')) {
          const more = guideButton(GUIDE_COPY.more + body.city.name, null, 'o-g-more'); more.setAttribute('aria-haspopup', 'dialog'); more.setAttribute('data-guide-more', '');
          more.addEventListener('click', () => guideOpen('city-results', { city: body.city, path: 'city_context', contextCity: body.city }, more, 'city_context'));
          root.querySelector('.o-g-actions').appendChild(more);
        }
      });
    },

    unmount() {
      guideClose(false);
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ctxLoad) { this.ctxLoad.ac.abort(); this.ctxLoad = null; }
      for (const el of document.querySelectorAll('[' + GUIDE_ATTR + ']')) el.remove();
      const style = document.getElementById(GUIDE_STYLE_ID);
      if (style) style.remove();
    }
  });
`;
