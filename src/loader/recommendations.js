// auto-recommendations: bloco "Você também pode gostar" na página de produto, com até 4 estampas relacionadas. A lista vem PRONTA
// (pré-calculada no storefront, servida e validada pelo Worker em /__origens/recommendations/<id>): aqui só se busca uma vez por página,
// revalida e desenha. Desktop em duas colunas: logo abaixo da imagem do produto (ocupa o vão da coluna da galeria). Empilhado (mobile): depois do
// bloco principal de compra, logo após o "Compre junto" nativo (nunca o esconde nem o substitui nesta rodada).
// Só observa/insere: não toca no formulário, variantes, CTA, sticky mobile, POST, CSRF nem checkout da INK. Card inteiro é um link comum para a
// página real da INK (mesma aba; o carrinho segue por conta própria). Sem botão de carrinho, sem cookies, sem armazenamento, sem dado pessoal.
// Qualquer falha (sem índice, rede, timeout, < 2 itens válidos) = nenhum DOM: a página da INK fica exatamente como era.
export const RECOMMENDATIONS = String.raw`
  const RECO_ROOT = 'data-origens-reco';
  const RECO_STYLE_ID = 'use-origens-reco-style';
  const RECO_ENDPOINT = '/__origens/recommendations/';
  const RECO_TIMEOUT_MS = 3000;
  const RECO_MIN = 2;
  const RECO_MAX = 4;
  const RECO_GALLERY_GAP = 32;
  const RECO_IMAGE_HOST = 'gcp-images.majestic.ink.rsvcloud.com';
  const RECO_TITLE = 'Você também pode gostar';
  const RECO_GA = STORE.ga;
  const recoCache = new Map(); // productId -> itens já validados (navegação Turbo de volta não refaz o pedido)
  const recoDebug = (() => { try { return window.localStorage.getItem('origens_debug') === '1'; } catch (_) { return false; } })();
  const recoLog = (msg, data) => { if (recoDebug) { try { console.info('[Use Origens] recommendations: ' + msg, data || ''); } catch (_) { /* ignora */ } } };

  // Produto atual: o formulário NATIVO de compra da página (nunca o do modal "Compre junto", nem um quick-add/carrinho carregado depois).
  function recoMainForm() {
    const forms = Array.prototype.filter.call(document.querySelectorAll('form[id^="form-product-"]'), (f) => !f.closest('.modal-buy-together, #quick_add_frame, #modal-wrapper, turbo-frame#cart, [' + RECO_ROOT + ']'));
    return forms.length === 1 ? forms[0] : null;
  }
  function recoProductId() {
    const form = recoMainForm();
    const m = form && /^form-product-([1-9][0-9]{0,15})$/.exec(form.id);
    return m ? m[1] : null;
  }

  // Defesa em profundidade: o Worker já validou; aqui o mesmo contrato de novo, antes de virar link/imagem.
  function recoItem(raw, currentId) {
    try {
      if (!raw || typeof raw !== 'object') return null;
      const id = String(raw.productId || '');
      if (!/^[1-9][0-9]{0,15}$/.test(id) || id === currentId) return null;
      const href = new URL(raw.href);
      if (href.protocol !== 'https:' || href.hostname !== STORE.inkHost || href.port || href.username || href.password || href.search || href.hash || !CATALOG_PRODUCT_PATH.test(href.pathname)) return null;
      const image = new URL(raw.image);
      if (image.protocol !== 'https:' || image.hostname !== RECO_IMAGE_HOST || image.port || image.username || image.password) return null;
      const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim() : '';
      if (!title || title.length > 90) return null;
      if (typeof raw.price !== 'number' || !isFinite(raw.price) || raw.price <= 0 || raw.price > 2000) return null;
      const reason = typeof raw.reason === 'string' && /^[a-z:-]{3,40}$/.test(raw.reason) ? raw.reason : '';
      return { id, href: href.href, image: image.href, title, price: raw.price, reason };
    } catch (_) { return null; }
  }

  const recoPrice = (value) => { try { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch (_) { return 'R$ ' + value.toFixed(2).replace('.', ','); } };

  // Desktop (PDP em duas colunas: galeria à esquerda, detalhes à direita): a coluna da galeria termina bem antes da de detalhes e deixa um vão
  // (~1000 px medidos em 1280 na PDP real). O bloco ocupa esse vão, logo abaixo da imagem, SEM mudar a altura da seção da galeria: fica dentro dela
  // com position:absolute; top:100% (a INK posiciona o selo "Clique para dar zoom" pela base da seção; se a seção crescesse, o selo desceria
  // para cima dos cards). Só quando as duas colunas estão de fato lado a lado (medido) e o bloco CABE no vão; senão, posição em fluxo abaixo.
  function recoGallerySlot() {
    const gallery = document.querySelector('.details-product > section.section-product-v2');
    const details = document.querySelector('.details-product > section.section-details');
    if (!gallery || !details || getComputedStyle(gallery).position !== 'relative') return null;
    const g = gallery.getBoundingClientRect();
    const d = details.getBoundingClientRect();
    return g.width > 0 && d.width > 0 && g.right <= d.left + 1 ? { gallery, details, room: d.bottom - g.bottom } : null;
  }
  // Coloca (ou move) o bloco no lugar certo para o layout ATUAL. Devolve false quando não há lugar seguro.
  function recoPlace(root) {
    const slot = recoGallerySlot();
    if (slot) {
      // Mede onde o bloco JÁ está (as duas colunas têm a mesma largura no desktop); só no primeiro desenho ele entra na galeria para ser medido.
      // Decidir antes de mover evita o vaivém galeria <-> fluxo (cada movimento dispara o MutationObserver do runtime).
      if (!root.isConnected) slot.gallery.appendChild(root);
      if (root.offsetHeight + RECO_GALLERY_GAP <= slot.room) { // cabe no vão: não empurra nada
        if (root.parentElement !== slot.gallery || slot.gallery.lastElementChild !== root) slot.gallery.appendChild(root);
        if (root.getAttribute('data-placement') !== 'gallery') root.setAttribute('data-placement', 'gallery');
        return true;
      }
    }
    const anchor = recoAnchor();
    if (!anchor) { if (slot) root.remove(); return false; }
    if (anchor.nextElementSibling !== root) anchor.insertAdjacentElement('afterend', root);
    if (root.getAttribute('data-placement') !== 'flow') root.setAttribute('data-placement', 'flow');
    return true;
  }

  // Layout empilhado: depois do bloco principal de compra, logo após o "Compre junto" nativo quando existe (os dois lado a lado para comparação),
  // senão após o nosso "Continue explorando", senão após o formulário. Sempre FORA do <form> e do turbo-frame que a INK recarrega.
  function recoAnchor() {
    const together = document.querySelector('section.buy-together');
    if (together && together.parentElement && !together.closest('.modal-buy-together, form')) return together;
    const discovery = document.querySelector('[data-origens-discovery="product"]');
    if (discovery && discovery.parentElement) return discovery;
    const form = recoMainForm();
    return form && form.parentElement ? form : null;
  }

  const RECO_CSS = [
    '[' + RECO_ROOT + ']{box-sizing:border-box;width:100%;max-width:100%;margin:20px 0 12px;padding:0;font-family:inherit;color:#111827;text-align:left;overflow:hidden}',
    '[' + RECO_ROOT + '] *{box-sizing:border-box;font-family:inherit}',
    '[' + RECO_ROOT + '] .o-reco-title{margin:0 0 12px;font-size:18px;line-height:1.3;font-weight:600;color:#111827}',
    '[' + RECO_ROOT + '] .o-reco-track{display:flex;gap:12px;margin:0;padding:0 0 6px;list-style:none;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scrollbar-width:thin}',
    '[' + RECO_ROOT + '] .o-reco-item{flex:0 0 72%;max-width:260px;min-width:0;margin:0;padding:0;scroll-snap-align:start}',
    '[' + RECO_ROOT + '] .o-reco-card{display:flex;flex-direction:column;height:100%;min-height:44px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;color:#111827;text-decoration:none;overflow:hidden;transition:border-color .15s}',
    '[' + RECO_ROOT + '] .o-reco-card:hover{border-color:#4d543d}',
    '[' + RECO_ROOT + '] .o-reco-card:focus-visible{outline:2px solid #4d543d;outline-offset:2px}',
    '[' + RECO_ROOT + '] .o-reco-media{display:block;position:relative;width:100%;aspect-ratio:920/1050;background:#f3f4f6}',
    '[' + RECO_ROOT + '] .o-reco-media img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;border:0}',
    '[' + RECO_ROOT + '] .o-reco-body{display:flex;flex-direction:column;gap:4px;padding:10px 12px 12px}',
    '[' + RECO_ROOT + '] .o-reco-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.3;font-weight:500;overflow-wrap:anywhere;min-height:2.6em}',
    '[' + RECO_ROOT + '] .o-reco-price{font-size:15px;line-height:1.3;font-weight:700;color:#111827}',
    '[' + RECO_ROOT + '] .o-reco-cta{margin-top:2px;font-size:13px;line-height:1.3;font-weight:600;color:#4d543d;text-decoration:underline;text-underline-offset:2px}',
    '[' + RECO_ROOT + '][data-placement="gallery"]{position:absolute;top:100%;left:0;right:0;margin:' + RECO_GALLERY_GAP + 'px 0 0;z-index:1;background:#fff}',
    '@media (min-width: 768px){[' + RECO_ROOT + '] .o-reco-track{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:visible;scroll-snap-type:none;padding:0}[' + RECO_ROOT + '] .o-reco-item{max-width:none}}'
  ].join('');

  function recoEnsureStyle() {
    if (document.getElementById(RECO_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = RECO_STYLE_ID;
    style.textContent = RECO_CSS;
    document.head.appendChild(style);
  }

  // Medição opcional, só pelo gtag que a própria INK já carrega e só depois do aceite do aviso de cookies (mesma regra de tracking.js).
  // Evento próprio (nenhum evento padrão de Meta/GA: nada de AddToCart, ViewContent ou Purchase). Nunca impede a navegação.
  function recoTrack(root, link) {
    try {
      if (typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + RECO_GA + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      window.gtag('event', 'origens_recommendation_click', {
        send_to: RECO_GA, region: STORE.region, transport_type: 'beacon',
        source_product_id: root.getAttribute('data-product-id') || '',
        recommended_product_id: link.getAttribute('data-product-id') || '',
        position: Number(link.getAttribute('data-position')) || 0,
        reason: link.getAttribute('data-reason') || ''
      });
    } catch (_) { /* medir nunca quebra a INK */ }
  }

  function recoRender(items, productId) {
    if (!recoGallerySlot() && !recoAnchor()) { recoLog('no anchor'); return null; }
    recoEnsureStyle();
    const root = document.createElement('section');
    root.setAttribute(RECO_ROOT, '');
    root.setAttribute('data-product-id', productId);
    root.setAttribute('data-path', window.location.pathname);
    root.setAttribute('aria-labelledby', 'o-reco-title');
    const title = document.createElement('h2');
    title.className = 'o-reco-title';
    title.id = 'o-reco-title';
    title.textContent = RECO_TITLE;
    const track = document.createElement('ul');
    track.className = 'o-reco-track';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'o-reco-item';
      const a = document.createElement('a');
      a.className = 'o-reco-card';
      a.href = item.href;
      a.setAttribute('data-product-id', item.id);
      a.setAttribute('data-position', String(i + 1));
      if (item.reason) a.setAttribute('data-reason', item.reason);
      const media = document.createElement('span');
      media.className = 'o-reco-media';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.setAttribute('width', '460'); img.setAttribute('height', '525'); // proporção fixa: a imagem não desloca o layout ao carregar
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      media.appendChild(img);
      const body = document.createElement('span');
      body.className = 'o-reco-body';
      const name = document.createElement('span');
      name.className = 'o-reco-name';
      name.textContent = item.title;
      const price = document.createElement('span');
      price.className = 'o-reco-price';
      price.textContent = recoPrice(item.price);
      const cta = document.createElement('span');
      cta.className = 'o-reco-cta';
      cta.textContent = 'Ver produto';
      body.append(name, price, cta);
      a.append(media, body);
      li.appendChild(a);
      track.appendChild(li);
    });
    root.append(title, track);
    const onClick = (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a.o-reco-card') : null;
      if (link && (event.type === 'click' ? event.button === 0 : event.button === 1)) recoTrack(root, link);
    };
    root.addEventListener('click', onClick);
    root.addEventListener('auxclick', onClick);
    if (!recoPlace(root)) return null;
    return root;
  }

  function recoRemove() {
    for (const el of document.querySelectorAll('[' + RECO_ROOT + ']')) el.remove();
  }

  register({
    id: 'auto-recommendations',
    ac: null,
    onResize: null,
    observer: null,
    pending: null, // pathname do pedido em curso
    failed: new Set(), // pathnames sem lista (ou com falha): nunca se pede de novo nesta visita

    mount() {
      if (!allowedNow()) return this.unmount();
      const path = window.location.pathname;
      const current = document.querySelector('[' + RECO_ROOT + ']');
      if (!this.onResize) { this.onResize = () => schedule(); window.addEventListener('resize', this.onResize, { passive: true }); }
      // A galeria/coluna de compra mudam de altura depois do carregamento das imagens: reavalia se o bloco ainda cabe no vão.
      if (!this.observer && typeof ResizeObserver === 'function') {
        const cols = document.querySelectorAll('.details-product > section.section-product-v2, .details-product > section.section-details');
        if (cols.length) { this.observer = new ResizeObserver(() => schedule()); cols.forEach((c) => this.observer.observe(c)); }
      }
      // Idempotente: já desenhado para esta página; só muda de lugar se o layout mudou (ex.: janela redimensionada entre 1 e 2 colunas).
      if (current && current.isConnected && current.getAttribute('data-path') === path) { recoPlace(current); return; }
      if (current) recoRemove(); // sobra de outra página (Turbo)
      if (this.pending === path || this.failed.has(path)) return;
      const productId = recoProductId();
      if (!productId) { recoLog('no product id'); this.failed.add(path); return; }
      if (recoCache.has(productId)) { if (!recoRender(recoCache.get(productId), productId)) this.failed.add(path); return; }

      this.pending = path;
      const ac = new AbortController();
      this.ac = ac;
      const timer = setTimeout(() => ac.abort(), RECO_TIMEOUT_MS);
      fetch(RECO_ENDPOINT + productId, { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: ac.signal })
        .then((res) => (res.ok ? res.json() : { items: [] }))
        .then((data) => {
          if (this.ac !== ac || window.location.pathname !== path || !allowedNow()) return; // saiu da página no meio do caminho
          const items = (Array.isArray(data && data.items) ? data.items : []).map((raw) => recoItem(raw, productId)).filter(Boolean).slice(0, RECO_MAX);
          if (items.length < RECO_MIN) { recoLog('fewer than ' + RECO_MIN + ' items', items.length); this.failed.add(path); return; }
          if (recoCache.size > 20) recoCache.clear();
          recoCache.set(productId, items);
          if (!recoRender(items, productId)) this.failed.add(path);
          else recoLog('rendered', items.map((i) => i.reason));
        })
        .catch(() => { if (this.ac === ac) { this.failed.add(path); recoLog('request failed'); } })
        .finally(() => { clearTimeout(timer); if (this.ac === ac) { this.ac = null; this.pending = null; } });
    },

    unmount() {
      if (this.onResize) { window.removeEventListener('resize', this.onResize); this.onResize = null; }
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { try { this.ac.abort(); } catch (_) { /* ignora */ } this.ac = null; }
      this.pending = null;
      recoRemove();
    }
  });
`;
