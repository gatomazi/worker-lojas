// assistant: o assistente "Pergunte aqui" do storefront (sem IA) nas páginas da INK cobertas pelo Worker (produto e casca), NO LUGAR do "Ajuda?" da INK.
//   Dados:    GET /__origens/assistente abre o chat (respostas publicadas no CMS do storefront; v1, revalidado aqui) e POST responde uma mensagem. A abertura
//             é lembrada por um minuto (sessionStorage). Desligado, erro, timeout ou JSON inválido => NADA nosso aparece e o "Ajuda?" da INK fica como está.
//   Troca:    o botão nativo ([data-controller~="ink-store--help-button"], com Status do pedido, Troca, Devolução e WhatsApp) só é escondido DEPOIS que o
//             nosso montou, por um <style> dentro do nosso nó: desmontou (Turbo para fora do escopo, feature desligada) = o nativo volta sozinho.
//   Botão:    canto inferior DIREITO (o de cupons fica à esquerda), com o texto do painel ("Pergunte aqui" por padrão) e ícone (no celular, só o ícone); sobe acima do CTA fixo
//             (#add-to-cart-mob) e do aviso de cookies; some com o carrinho, um modal, o menu, o teclado virtual ou quando cobriria controles do formulário de
//             compra. Brilho suave na cor de destaque da região até a pessoa abrir o chat uma vez na visita: três respirações lentas, depois um halo parado.
//   Painel:   celular = folha inferior (modal, foco preso, rolagem travada); telas maiores = cartão ancorado ao botão. Cartões de estampa (foto e preço reais),
//             botões (pedidos da INK, página do storefront, WhatsApp) e sugestões. Os temas fixos do painel ficam sempre acima do campo (tocar = enviar o
//             texto do tema). A conversa desta visita fica na aba (sessionStorage).
//   Privacidade: CPF, cartão ou senha são recusados AQUI, antes de enviar (o storefront recusa de novo). A medição nunca leva o texto digitado.
// Todo texto vem do storefront e entra só por textContent; links só os que o gateway validou (e revalidados aqui).
export const ASSISTANT = String.raw`
  const ASSIST_ENDPOINT = '/__origens/assistente';
  const ASSIST_BOOT_KEY = 'origens:assistant:boot:v1';
  const ASSIST_TALK_KEY = 'origens:assistant:v1';
  // Aberto uma vez nesta visita = o botão para de brilhar (a mesma regra do "quiet" do botão de cupons).
  const ASSIST_SEEN_KEY = 'origens:assistant:seen';
  // O texto do botão quando o storefront não manda um (o padrão do painel).
  const ASSIST_LABEL = 'Pergunte aqui';
  const ASSIST_BOOT_MS = 60 * 1000;
  const ASSIST_FETCH_MS = 6000;
  const ASSIST_MAX_MESSAGE = 300;
  const ASSIST_KEEP = 30;
  const ASSIST_MARGIN = 16;
  const ASSIST_GAP = 8;
  const ASSIST_HEIGHT = 48;
  // O mesmo z-index do botão de cupons e da aba nativa: acima do carrossel de imagens (30) e abaixo de qualquer modal real da INK.
  const ASSIST_Z = 31;
  const ASSIST_KINDS = ['greeting', 'answer', 'designs', 'order', 'handoff', 'refuse', 'ask', 'not-found', 'fallback', 'chat'];
  const ASSIST_LINKS = ['page', 'collection', 'orders', 'tracking', 'whatsapp', 'search'];
  // As duas respostas de seguimento que o chat dá sozinho, a partir da anterior (as mesmas regras de engine.ts followUp, no storefront).
  const ASSIST_MORE = /^(e )?(tem )?(mais|outras?|outros?|mostra mais|ver mais|quero ver mais|mais op[cç][oõ]es|ver todas?|todas?)[\s!?.]*$/i;
  const ASSIST_YES = /^(sim|s|pode|pode ser|quero|claro|isso|ok|bora|vamos)[\s!.]*$/i;
  // "digitando…" antes de cada resposta: de 0,7 s a 1,8 s conforme o tamanho (engine.ts typingDelay), descontado o tempo da rede.
  const assistDelay = (text) => Math.min(1800, Math.max(700, 450 + String(text || '').length * 9));
  const assistWait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const ASSIST_IMAGE_HOST = 'gcp-images.majestic.ink.rsvcloud.com';
  const ASSIST_LINE = /[\u0000-\u001f\u007f<>]/;
  const ASSIST_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f<>]/;
  const ASSIST_SENSITIVE = /(\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\bcpf\b|cart[aã]o de cr[eé]dito|n[uú]mero do cart[aã]o|\bcvv\b|\bsenha\b|\b(?:\d[ -]?){13,19}\b)/i;
  const ASSIST_REFUSE = { v: 1, kind: 'refuse', text: 'Por segurança, não mande CPF, dados de cartão nem senha por aqui. Para ver ou mudar um pedido, entre em Meus pedidos com o e-mail da compra.' };
  const ASSIST_NATIVE = '[data-controller~="ink-store--help-button"]';
  // A cor do cabeçalho da região (stores.js), a mesma do guia e do "Compartilhar": botão, balão de quem pergunta e o hover dos botões.
  const ASSIST_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  // O brilho do botão: a cor de destaque da região (stores.js, a mesma do storefront) no anel e, no halo, um tom mais fundo dela (o mesmo
  // color-mix do storefront: 65% do destaque com #a8741f), porque o areia puro some no cinza-claro das páginas.
  const ASSIST_ACCENT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.accent)) ? STORE.theme.accent : '#d6ba8d';
  const ASSIST_HALO = '#' + [1, 3, 5].map((i) => Math.round(parseInt(ASSIST_ACCENT.slice(i, i + 2), 16) * 0.65 + parseInt('a8741f'.slice(i - 1, i + 1), 16) * 0.35).toString(16).padStart(2, '0')).join('');

  function assistLine(value, max) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 1 && text.length <= max && !ASSIST_LINE.test(text) ? text : null;
  }
  // Um link já validado pelo gateway: só https para a INK DESTA loja, o storefront desta região ou wa.me. Qualquer outro some (storage é do visitante).
  function assistHref(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      if (u.hostname === STORE.inkHost && u.pathname.startsWith(INK_BASE + '/')) return u.href;
      if (u.origin === STOREFRONT_ORIGIN && isStorefrontPath(u.pathname)) return u.href;
      if (u.hostname === 'wa.me') return u.href;
      return null;
    } catch (_) { return null; }
  }
  // O mesmo contrato do gateway, repetido porque a conversa guardada é do visitante. Desvio => null.
  function assistReply(data) {
    if (!data || typeof data !== 'object' || data.v !== 1 || ASSIST_KINDS.indexOf(data.kind) < 0) return null;
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text || text.length > 1000 || ASSIST_TEXT.test(text)) return null;
    const out = { v: 1, kind: data.kind, text: text, items: [], links: [], suggestions: [] };
    for (const raw of Array.isArray(data.items) ? data.items.slice(0, 4) : []) {
      const title = raw && assistLine(raw.title, 90); const href = raw && assistHref(raw.href);
      let image = null;
      try { const u = raw && new URL(raw.image); image = u && u.protocol === 'https:' && u.hostname === ASSIST_IMAGE_HOST ? u.href : null; } catch (_) { image = null; }
      if (!title || !href || !image) continue;
      out.items.push({ title: title, href: href, image: image, context: assistLine(raw.context, 60), price: typeof raw.price === 'number' && raw.price > 0 && raw.price <= 2000 ? raw.price : null, productId: typeof raw.productId === 'string' && /^[1-9][0-9]{0,15}$/.test(raw.productId) ? raw.productId : null });
    }
    for (const raw of Array.isArray(data.links) ? data.links.slice(0, 4) : []) {
      const label = raw && assistLine(raw.label, 60); const href = raw && assistHref(raw.href);
      if (label && href && ASSIST_LINKS.indexOf(raw.kind) >= 0) out.links.push({ kind: raw.kind, label: label, href: href });
    }
    for (const raw of Array.isArray(data.suggestions) ? data.suggestions.slice(0, 4) : []) { const s = assistLine(raw, 140); if (s) out.suggestions.push(s); }
    return out;
  }
  // O atalho do WhatsApp do cabeçalho: só wa.me (o gateway já validou; o storage é do visitante).
  function assistWhatsapp(value) { const href = typeof value === 'string' ? assistHref(value) : null; return href && href.indexOf('https://wa.me/') === 0 ? href : null; }
  // A abertura que o chat usa: o texto do botão (ou o padrão) e os temas fixos, revalidados aqui também (o storage é do visitante).
  function assistOpen(data) {
    const opening = data && data.v === 1 && data.enabled === true ? assistReply(data.opening) : null;
    if (!opening) return null;
    const topics = [];
    for (const raw of Array.isArray(data.topics) ? data.topics.slice(0, 4) : []) { const t = assistLine(raw, 40); if (t && topics.indexOf(t) < 0) topics.push(t); }
    return { opening: opening, whatsapp: assistWhatsapp(data.whatsapp), label: assistLine(data.label, 24) || ASSIST_LABEL, topics: topics };
  }
  function assistFollowUp(message, previous) {
    if (!previous) return null;
    const all = previous.links.find((l) => l.kind === 'search' || l.kind === 'page' || l.kind === 'collection');
    if (ASSIST_MORE.test(message) && previous.kind === 'designs' && all) return { v: 1, kind: 'designs', text: 'Todas estão nesta página:', items: [], links: [all], suggestions: [] };
    const whatsapp = previous.links.find((l) => l.kind === 'whatsapp');
    if (ASSIST_YES.test(message) && whatsapp && ['not-found', 'fallback', 'handoff', 'answer'].indexOf(previous.kind) >= 0) return { v: 1, kind: 'handoff', text: 'Combinado! Toque abaixo para falar com a nossa equipe.', items: [], links: [whatsapp], suggestions: [] };
    return null;
  }
  function assistBootRead() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(ASSIST_BOOT_KEY) || 'null');
      if (!stored || stored.region !== STORE.region || typeof stored.at !== 'number' || Date.now() - stored.at > ASSIST_BOOT_MS || stored.at > Date.now()) return undefined;
      if (stored.data === null) return null;
      return assistOpen(stored.data);
    } catch (_) { return undefined; }
  }
  function assistBootWrite(data) { try { window.sessionStorage.setItem(ASSIST_BOOT_KEY, JSON.stringify({ at: Date.now(), region: STORE.region, data: data })); } catch (_) { /* sem storage: só não há cache */ } }
  // Uma busca por vida da página (o Turbo mantém o JS entre páginas); uma falha também é lembrada por um minuto.
  let assistPending = null; let assistPendingAt = 0;
  function assistBoot() {
    const cached = assistBootRead();
    if (cached !== undefined) return Promise.resolve(cached);
    if (assistPending && Date.now() - assistPendingAt < ASSIST_BOOT_MS) return assistPending;
    assistPendingAt = Date.now();
    assistPending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASSIST_FETCH_MS);
      try {
        const response = await fetch(withRegion(ASSIST_ENDPOINT), { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        if (data && data.v === 1 && data.enabled === false) { assistBootWrite(null); return null; }
        const boot = assistOpen(data);
        if (!boot) throw new Error('schema');
        assistBootWrite(data);
        return boot;
      } catch (_) {
        assistBootWrite(null);
        return null;
      } finally { clearTimeout(timer); }
    })();
    return assistPending;
  }
  function assistTalkRead() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(ASSIST_TALK_KEY) || 'null');
      if (!stored || stored.region !== STORE.region || !Array.isArray(stored.entries)) return [];
      const out = [];
      for (const e of stored.entries.slice(-ASSIST_KEEP)) {
        if (e && e.from === 'me' && assistLine(e.text, ASSIST_MAX_MESSAGE)) out.push({ from: 'me', text: e.text });
        else if (e && e.from === 'bot') { const r = assistReply(e.reply); if (r) out.push({ from: 'bot', reply: r }); }
      }
      return out;
    } catch (_) { return []; }
  }
  function assistSeen() { try { return !!window.sessionStorage.getItem(ASSIST_SEEN_KEY); } catch (_) { return false; } }
  function assistMarkSeen() { try { window.sessionStorage.setItem(ASSIST_SEEN_KEY, '1'); } catch (_) { /* sem storage: só esta página */ } }
  function assistTalkWrite(entries) { try { window.sessionStorage.setItem(ASSIST_TALK_KEY, JSON.stringify({ region: STORE.region, entries: entries.slice(-ASSIST_KEEP) })); } catch (_) { /* idem */ } }

  const assistShown = (selector) => { const el = document.querySelector(selector); return !!el && el.getClientRects().length > 0; };
  const assistHits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const assistTyping = (el) => !!el && el.closest && !el.closest('#o-assist') && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image|hidden)$/i.test(el.type || '')));
  const assistSheet = () => document.documentElement.clientWidth < 640;
  const assistCoarse = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function assistViewportBottom() {
    const probe = document.querySelector('#o-assist .o-assist-probe');
    const top = probe ? probe.getBoundingClientRect().top : 0;
    return top > 0 ? top : document.documentElement.clientHeight;
  }
  const assistPrice = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');

  // Medição: só com o gtag da PRÓPRIA INK para a propriedade da região e com o aviso de cookies da INK aceito (a regra de tracking.js). Nunca o texto.
  function assistTrack(name, extra) {
    try {
      if (typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + STORE.ga + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      const params = { send_to: STORE.ga, region: STORE.region, surface: 'ink', feature_version: 'assistant_v1', transport_type: 'beacon' };
      if (extra) for (const k of Object.keys(extra)) params[k] = extra[k];
      window.gtag('event', name, params);
    } catch (_) { /* medir nunca quebra a INK */ }
  }

  // Balão quadrado com três pontos (conversa; quadrado como as formas da marca): o mesmo desenho do botão do storefront.
  const ASSIST_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path stroke-width="2.8" d="M8 10h.01M12 10h.01M16 10h.01"/></svg>';
  const ASSIST_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const ASSIST_CSS = [
    ASSIST_NATIVE + '{display:none!important}',
    '#o-assist{font-family:inherit;color:#111827}',
    '#o-assist *{box-sizing:border-box}',
    '#o-assist .o-assist-fab{position:fixed;z-index:' + ASSIST_Z + ';display:inline-flex;align-items:center;gap:8px;height:' + ASSIST_HEIGHT + 'px;padding:0 16px 0 14px;margin:0;border:0;border-radius:12px;background:' + ASSIST_TINT + ';color:#fff;font:inherit;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;box-shadow:0 6px 18px rgba(0,0,0,.24);cursor:pointer;outline-offset:4px;-webkit-tap-highlight-color:transparent}',
    '#o-assist .o-assist-fab[hidden]{display:none}',
    // Celular: só o ícone (um quadrado de 48px), para o botão não disputar a atenção com a loja; o texto fica para leitores de tela.
    '@media (max-width:639px){#o-assist .o-assist-fab{width:' + ASSIST_HEIGHT + 'px;padding:0;justify-content:center}#o-assist .o-assist-fab [data-assist-label]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}}',
    // O brilho: a sombra de um pseudo-elemento, para só a opacidade mexer (sombra externa nunca pinta por cima do botão). Sem movimento: o halo parado.
    '#o-assist .o-assist-fab[data-glow]::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:0 0 0 2px ' + ASSIST_ACCENT + ',0 0 18px 3px ' + ASSIST_HALO + ';opacity:.5;pointer-events:none}',
    '#o-assist .o-assist-fab[data-glow="pulse"]::before{animation:o-assist-glow 2.4s ease-in-out .8s 3}',
    '@keyframes o-assist-glow{0%,100%{opacity:.5}50%{opacity:.85}}',
    '@media (prefers-reduced-motion: reduce){#o-assist .o-assist-fab[data-glow]::before{animation:none}}',
    '#o-assist .o-assist-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45)}',
    '#o-assist .o-assist-panel{position:fixed;z-index:2147483001;display:flex;flex-direction:column;background:#f2f2f0;color:#111827;box-shadow:0 18px 40px rgba(0,0,0,.28);text-align:left;font-size:15px;line-height:1.35}',
    '#o-assist .o-assist-panel.is-sheet{left:0;right:0;bottom:0;height:min(85vh,672px);border-top:2px solid #111827;padding-bottom:env(safe-area-inset-bottom,0px)}',
    '#o-assist .o-assist-panel.is-pop{width:384px;max-width:calc(100vw - 32px);height:min(72vh,608px);border:2px solid #111827}',
    '#o-assist .o-assist-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 4px 4px 16px;border-bottom:2px solid #111827}',
    '#o-assist .o-assist-head h2{margin:0;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.01em;line-height:1;color:#111827}',
    '#o-assist .o-assist-head p{margin:2px 0 0;font-size:12px;color:#56564f}',
    '#o-assist .o-assist-head>div{min-width:0;margin-right:auto}',
    '#o-assist .o-assist-wa{display:inline-flex;align-items:center;min-height:36px;padding:0 10px;border:2px solid #1f7a43;background:#fff;color:#1f7a43;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-decoration:none;flex-shrink:0;transition:background-color .2s,color .2s}',
    '#o-assist .o-assist-wa:hover{background:#1f7a43;color:#fff}',
    '#o-assist a:focus-visible,#o-assist button:focus-visible,#o-assist input:focus-visible{outline:2px solid ' + ASSIST_TINT + ';outline-offset:2px}',
    '#o-assist .o-assist-typing{display:inline-flex;align-items:center;gap:4px;padding:12px 14px;border-radius:3px;border:1px solid rgba(0,0,0,.15);background:#fff;font-size:13px;color:#56564f}',
    '#o-assist .o-assist-typing i{width:6px;height:6px;border-radius:999px;background:#56564f;animation:o-assist-dot 1.2s infinite cubic-bezier(.22,1,.36,1)}',
    '#o-assist .o-assist-typing i:nth-child(2){animation-delay:.15s}#o-assist .o-assist-typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes o-assist-dot{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '@media (prefers-reduced-motion: reduce){#o-assist .o-assist-typing i{animation:none}}',
    '#o-assist .o-assist-x{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;background:transparent;color:#111827;cursor:pointer}',
    '#o-assist .o-assist-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px}',
    '#o-assist .o-assist-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}',
    '#o-assist .o-assist-me{align-self:flex-end;max-width:85%;margin:0;padding:8px 14px;border-radius:3px;background:' + ASSIST_TINT + ';color:#fff;white-space:pre-line;overflow-wrap:anywhere}',
    '#o-assist .o-assist-bot{display:flex;flex-direction:column;align-items:flex-start;gap:8px}',
    '#o-assist .o-assist-say{max-width:92%;margin:0;padding:10px 14px;border-radius:3px;border:1px solid rgba(0,0,0,.15);background:#fff;line-height:1.45;white-space:pre-line;overflow-wrap:anywhere}',
    '#o-assist .o-assist-items{list-style:none;margin:0;padding:0;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '#o-assist .o-assist-card{display:flex;flex-direction:column;height:100%;overflow:hidden;border:1px solid rgba(0,0,0,.15);background:#fff;color:#111827;text-decoration:none;transition:border-color .2s}',
    '#o-assist .o-assist-card:hover{border-color:' + ASSIST_TINT + '}#o-assist .o-assist-card:hover .o-assist-t{text-decoration:underline;text-underline-offset:2px}',
    '#o-assist .o-assist-card img{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#e5e5e5}',
    '#o-assist .o-assist-card span{display:block;padding:0 8px}',
    '#o-assist .o-assist-card .o-assist-t{padding-top:8px;font-size:13px;font-weight:600;line-height:1.2}',
    '#o-assist .o-assist-card .o-assist-c{font-size:12px;color:#56564f}',
    '#o-assist .o-assist-card .o-assist-p{margin-top:auto;padding-top:4px;padding-bottom:8px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}',
    '#o-assist .o-assist-links,#o-assist .o-assist-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '#o-assist .o-assist-link{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;border:2px solid #111827;background:#fff;color:#111827;font-size:15px;font-weight:600;text-decoration:none;transition:border-color .2s,background-color .2s}',
    '#o-assist .o-assist-link:hover{border-color:' + ASSIST_TINT + ';background:#f2f2f0}',
    '#o-assist .o-assist-link.is-whatsapp{border-color:#1f7a43;background:#1f7a43;color:#fff}#o-assist .o-assist-link.is-whatsapp:hover{border-color:#17633a;background:#17633a}',
    '#o-assist .o-assist-chip{min-height:40px;padding:6px 12px;border:1px solid rgba(0,0,0,.3);border-radius:0;background:#fff;color:#111827;font:inherit;font-size:13px;font-weight:500;line-height:1.2;text-align:left;cursor:pointer;transition:border-color .2s,background-color .2s}',
    '#o-assist .o-assist-chip:hover{border-color:#111827;background:#f2f2f0}',
    '#o-assist .o-assist-chip:disabled{opacity:.5}',
    // Temas fixos: no celular, uma linha que rola para o lado (o fim esmaece enquanto houver mais); no cartão do computador, uma grade de duas colunas.
    '#o-assist .o-assist-topics{display:flex;gap:6px;padding:8px 10px;border-top:1px solid rgba(0,0,0,.15);overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}',
    '#o-assist .o-assist-topics::-webkit-scrollbar{display:none}',
    '#o-assist .o-assist-panel.is-pop .o-assist-topics{display:grid;grid-template-columns:1fr 1fr;overflow:visible}',
    '#o-assist .o-assist-panel.is-sheet .o-assist-topics[data-more]{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 40px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 40px),transparent)}',
    '#o-assist .o-assist-topic{flex-shrink:0;min-height:40px;margin:0;padding:0 12px;border:1px solid rgba(0,0,0,.3);border-radius:3px;background:#fff;color:#111827;font:inherit;font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;cursor:pointer;transition:border-color .2s,background-color .2s}',
    '#o-assist .o-assist-topic:hover{border-color:#111827;background:#f2f2f0}#o-assist .o-assist-topic:disabled{opacity:.5}',
    '#o-assist .o-assist-form{display:flex;align-items:stretch;gap:0;padding:10px;border-top:2px solid #111827;background:#fff}',
    '#o-assist .o-assist-input{flex:1;min-width:0;min-height:44px;margin:0;padding:0 14px;border:2px solid #111827;border-right:0;border-radius:0;background:#fff;color:#111827;font:inherit;font-size:16px;-webkit-appearance:none;appearance:none}',
    '#o-assist .o-assist-input::placeholder{color:#56564f;opacity:1}',
    '#o-assist .o-assist-input:focus{box-shadow:none;outline:2px solid ' + ASSIST_TINT + ';outline-offset:-4px}',
    '#o-assist .o-assist-send{flex-shrink:0;min-height:44px;margin:0;padding:0 16px;border:2px solid #111827;border-radius:0;background:#111827;color:#fff;font:inherit;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;transition:background-color .2s,color .2s}',
    '#o-assist .o-assist-send:hover:not(:disabled){background:#fff;color:#111827}#o-assist .o-assist-send:disabled{border-color:rgba(0,0,0,.25);background:rgba(0,0,0,.25);cursor:default}',
    '#o-assist .o-assist-note{margin:0;padding:0 12px 10px;background:#fff;font-size:12px;line-height:1.35;color:#56564f}',
    '#o-assist .o-assist-probe{position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none}'
  ].join('');

  function assistEl(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  register({
    id: 'assistant',
    shell: true,
    ac: null,
    opening: null,
    entries: [],
    loading: false,
    pending: false,
    timer: null,
    open: false,
    label: ASSIST_LABEL,
    topics: [],

    mount() {
      if (!pageNow()) return this.unmount();
      if (document.getElementById('o-assist')) { this.place(); return; }
      if (this.loading) return;
      this.loading = true;
      assistBoot().then((boot) => {
        this.loading = false;
        if (!boot || !pageNow() || document.getElementById('o-assist')) return;
        this.opening = boot.opening;
        this.whatsapp = boot.whatsapp;
        this.label = boot.label;
        this.topics = boot.topics;
        this.entries = assistTalkRead();
        this.build();
      }).catch(() => { this.loading = false; });
    },

    build() {
      const root = assistEl('div', { id: 'o-assist', 'data-origens-assistant': '' });
      // O <style> esconde o "Ajuda?" nativo: vive e morre com o nosso nó.
      root.appendChild(assistEl('style', null, ASSIST_CSS));
      root.appendChild(assistEl('span', { class: 'o-assist-probe', 'aria-hidden': 'true' }));
      const fab = assistEl('button', { type: 'button', class: 'o-assist-fab', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'o-assist-panel', 'data-assist-fab': '' });
      fab.innerHTML = ASSIST_ICON;
      fab.appendChild(assistEl('span', { 'data-assist-label': '' }, this.label));
      // Brilha até ser aberto nesta visita; depois das respirações (animationend), fica o halo parado: reaparecer (hidden) não recomeça o pulso.
      if (!assistSeen()) fab.setAttribute('data-glow', 'pulse');
      fab.addEventListener('animationend', () => { if (fab.getAttribute('data-glow') === 'pulse') fab.setAttribute('data-glow', 'rest'); });
      root.appendChild(fab);
      document.body.appendChild(root);
      this.ac = new AbortController();
      const signal = this.ac.signal;
      const later = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.place(), 60); };
      window.addEventListener('resize', later, { signal: signal });
      window.addEventListener('scroll', later, { passive: true, signal: signal });
      document.addEventListener('click', later, { capture: true, signal: signal });
      document.addEventListener('keydown', later, { signal: signal });
      document.addEventListener('focusin', later, { signal: signal });
      document.addEventListener('focusout', later, { signal: signal });
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', later, { signal: signal }); window.visualViewport.addEventListener('scroll', later, { signal: signal }); }
      fab.addEventListener('click', () => (this.open ? this.close(true) : this.show()), { signal: signal });
      this.place();
    },

    // Abaixo à direita; recua acima do CTA fixo e do aviso de cookies; some quando a página precisa do espaço ou da atenção.
    place() {
      const root = document.getElementById('o-assist');
      if (!root) return;
      const fab = root.querySelector('.o-assist-fab');
      const vh = assistViewportBottom();
      const vv = window.visualViewport;
      const visibleBottom = vv && vv.height > 0 ? Math.min(vh, (vv.offsetTop || 0) + vv.height) : vh;
      const width = fab.offsetWidth || 112;
      const visibleRight = vv && vv.width > 0 ? (vv.offsetLeft || 0) + vv.width : document.documentElement.clientWidth;
      const right = Math.max(ASSIST_MARGIN, document.documentElement.clientWidth - visibleRight + ASSIST_MARGIN);
      const left = document.documentElement.clientWidth - right - width;
      let bottom = ASSIST_MARGIN + Math.max(0, vh - visibleBottom);
      for (const selector of ['#add-to-cart-mob', '.cookie-acceptance']) {
        const el = document.querySelector(selector);
        if (!el || el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.right > left && r.left < left + width && r.bottom > vh - bottom - ASSIST_HEIGHT && r.top < visibleBottom) bottom = Math.max(bottom, vh - r.top + ASSIST_GAP);
      }
      fab.style.right = 'max(' + right + 'px, env(safe-area-inset-right, 0px))';
      fab.style.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
      const ours = { left: left, right: left + width, top: vh - bottom - ASSIST_HEIGHT, bottom: vh - bottom };
      const header = document.querySelector('header');
      const noRoom = ours.top < (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + ASSIST_GAP;
      const burger = document.getElementById('menu-hamburger');
      const menuOpen = !!burger && burger.getAttribute('aria-expanded') === 'true';
      const keyboard = assistTyping(document.activeElement) && !!window.visualViewport && window.visualViewport.height < window.innerHeight - 120;
      const typing = assistTyping(document.activeElement) && assistCoarse();
      let covers = false;
      for (const form of document.querySelectorAll('form[id^="form-product-"]')) {
        for (const control of form.querySelectorAll('button, label, select, input:not([type="hidden"])')) {
          if (control.getClientRects().length > 0 && assistHits(ours, control.getBoundingClientRect())) { covers = true; break; }
        }
        if (covers) break;
      }
      const promoOpen = assistShown('#o-promo-panel');
      const overlay = assistShown('.cart-drawer.open') || assistShown('#modal-wrapper') || menuOpen || promoOpen;
      const blocked = overlay || keyboard || typing || noRoom || covers;
      root.setAttribute('data-assist-hidden', blocked ? [overlay && 'overlay', keyboard && 'keyboard', typing && 'typing', noRoom && 'no-room', covers && 'purchase-controls'].filter(Boolean).join(' ') : '');
      fab.hidden = blocked && !this.open;
      if (this.open && (overlay || (keyboard && !root.contains(document.activeElement)))) this.close(false);
      if (this.open) this.placePanel();
    },

    placePanel() {
      const panel = document.getElementById('o-assist-panel');
      const fab = document.querySelector('#o-assist .o-assist-fab');
      if (!panel || !fab) return;
      const sheet = assistSheet();
      panel.classList.toggle('is-sheet', sheet);
      panel.classList.toggle('is-pop', !sheet);
      const backdrop = document.querySelector('#o-assist .o-assist-backdrop');
      if (backdrop) backdrop.hidden = !sheet;
      if (sheet) {
        const vv = window.visualViewport;
        const vh = assistViewportBottom();
        const visibleBottom = vv && vv.height > 0 ? Math.min(vh, (vv.offsetTop || 0) + vv.height) : vh;
        panel.style.left = (vv && vv.offsetLeft > 0 ? vv.offsetLeft : 0) + 'px';
        panel.style.right = 'auto';
        panel.style.width = (vv && vv.width > 0 ? vv.width : document.documentElement.clientWidth) + 'px';
        panel.style.bottom = Math.max(0, vh - visibleBottom) + 'px';
        panel.style.height = '';
        return;
      }
      panel.style.left = 'auto'; panel.style.width = '';
      const r = fab.getBoundingClientRect();
      panel.style.right = Math.max(ASSIST_MARGIN, document.documentElement.clientWidth - r.right) + 'px';
      const bottom = assistViewportBottom() - r.top + ASSIST_GAP;
      panel.style.bottom = bottom + 'px';
      const header = document.querySelector('header');
      const top = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + ASSIST_GAP;
      panel.style.height = Math.max(280, Math.min(608, assistViewportBottom() - bottom - top)) + 'px';
    },

    show() {
      const root = document.getElementById('o-assist');
      if (!root || this.open) return;
      this.open = true;
      const panelAc = new AbortController();
      this.panelAc = panelAc;
      const backdrop = assistEl('div', { class: 'o-assist-backdrop', 'aria-hidden': 'true' });
      backdrop.addEventListener('click', () => this.close(false), { signal: panelAc.signal });
      const panel = assistEl('div', { id: 'o-assist-panel', class: 'o-assist-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'o-assist-title' });
      const head = assistEl('div', { class: 'o-assist-head' });
      const titles = assistEl('div');
      titles.appendChild(assistEl('h2', { id: 'o-assist-title' }, this.label));
      titles.appendChild(assistEl('p', null, 'Estampas, pedidos e trocas'));
      head.appendChild(titles);
      if (this.whatsapp) {
        const wa = assistEl('a', { class: 'o-assist-wa', href: this.whatsapp, target: '_blank', rel: 'noopener noreferrer', 'data-assist-whatsapp': '' }, 'WhatsApp');
        wa.addEventListener('click', () => assistTrack('origens_assistant_link_click', { link_kind: 'whatsapp_shortcut' }), { signal: panelAc.signal });
        head.appendChild(wa);
      }
      const x = assistEl('button', { type: 'button', class: 'o-assist-x', 'aria-label': 'Fechar o assistente', 'data-assist-close': '' });
      x.innerHTML = ASSIST_CLOSE;
      x.addEventListener('click', () => this.close(true), { signal: panelAc.signal });
      head.appendChild(x);
      const body = assistEl('div', { class: 'o-assist-body', 'aria-live': 'polite' });
      body.appendChild(assistEl('ol', { class: 'o-assist-list', 'data-assist-messages': '' }));
      const form = assistEl('form', { class: 'o-assist-form' });
      const input = assistEl('input', { type: 'text', class: 'o-assist-input', maxlength: String(ASSIST_MAX_MESSAGE), enterkeyhint: 'send', autocomplete: 'off', placeholder: 'Escreva sua pergunta ou cidade', 'aria-label': 'Sua pergunta', 'data-assist-input': '' });
      const send = assistEl('button', { type: 'submit', class: 'o-assist-send', 'data-assist-send': '' }, 'Enviar');
      send.disabled = true;
      input.addEventListener('input', () => { send.disabled = this.pending || input.value.trim() === ''; }, { signal: panelAc.signal });
      form.addEventListener('submit', (event) => { event.preventDefault(); this.ask(input.value, 'typed'); }, { signal: panelAc.signal });
      form.appendChild(input); form.appendChild(send);
      panel.appendChild(head); panel.appendChild(body);
      if (this.topics.length) {
        const row = assistEl('div', { class: 'o-assist-topics', role: 'group', 'aria-label': 'Temas', 'data-assist-topics': '' });
        for (const topic of this.topics) {
          const b = assistEl('button', { type: 'button', class: 'o-assist-topic', 'data-assist-topic': '' }, topic);
          b.addEventListener('click', () => this.ask(topic, 'topic'), { signal: panelAc.signal });
          row.appendChild(b);
        }
        // Celular: enquanto houver temas escondidos à direita, o fim da linha esmaece.
        const more = () => { if (row.scrollWidth - row.clientWidth - row.scrollLeft > 4) row.setAttribute('data-more', ''); else row.removeAttribute('data-more'); };
        row.addEventListener('scroll', more, { passive: true, signal: panelAc.signal });
        window.addEventListener('resize', more, { signal: panelAc.signal });
        panel.appendChild(row);
        requestAnimationFrame(more);
      }
      panel.appendChild(form);
      panel.appendChild(assistEl('p', { class: 'o-assist-note' }, 'Não envie CPF, cartão ou senha. Pedidos e trocas ficam em Meus pedidos, na loja.'));
      const fab = root.querySelector('.o-assist-fab');
      root.insertBefore(backdrop, fab);
      root.insertBefore(panel, fab);
      fab.setAttribute('aria-expanded', 'true');
      fab.querySelector('[data-assist-label]').textContent = 'Fechar';
      fab.removeAttribute('data-glow');
      assistMarkSeen();
      fab.hidden = false;
      this.render();
      this.placePanel();
      if (assistSheet()) { this.lock = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; this.locked = true; }
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); this.close(true); return; }
        if (event.key === 'Tab' && assistSheet()) {
          const focusable = Array.from(panel.querySelectorAll('button, a[href], input')).filter((el) => el.getClientRects().length > 0 && !el.disabled);
          if (!focusable.length) return;
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }, { signal: panelAc.signal });
      document.addEventListener('pointerdown', (event) => { const t = event.target; if (t && !panel.contains(t) && !fab.contains(t) && t !== backdrop) this.close(false); }, { capture: true, signal: panelAc.signal });
      if (assistCoarse()) x.focus({ preventScroll: true }); else input.focus({ preventScroll: true });
      assistTrack('origens_assistant_open');
    },

    // A conversa inteira (abertura + o que foi dito), só com textContent.
    render() {
      const list = document.querySelector('#o-assist [data-assist-messages]');
      if (!list) return;
      list.textContent = '';
      const shown = [{ from: 'bot', reply: this.opening }].concat(this.entries);
      let lastBot = -1;
      shown.forEach((e, i) => { if (e.from === 'bot') lastBot = i; });
      shown.forEach((entry, i) => {
        if (entry.from === 'me') { list.appendChild(assistEl('li', { class: 'o-assist-me' }, entry.text)); return; }
        const reply = entry.reply;
        const li = assistEl('li', { class: 'o-assist-bot', 'data-assist-reply': reply.kind });
        li.appendChild(assistEl('p', { class: 'o-assist-say' }, reply.text));
        if (reply.items.length) {
          const items = assistEl('ul', { class: 'o-assist-items' });
          reply.items.forEach((item, j) => {
            const card = assistEl('a', { class: 'o-assist-card', href: item.href });
            const img = assistEl('img', { src: item.image, alt: '', loading: 'lazy', decoding: 'async' });
            card.appendChild(img);
            card.appendChild(assistEl('span', { class: 'o-assist-t' }, item.title));
            if (item.context) card.appendChild(assistEl('span', { class: 'o-assist-c' }, item.context));
            if (item.price) card.appendChild(assistEl('span', { class: 'o-assist-p' }, assistPrice(item.price)));
            card.addEventListener('click', () => assistTrack('origens_assistant_item_click', item.productId ? { position: j + 1, target_product_id: item.productId } : { position: j + 1 }));
            const cell = assistEl('li'); cell.appendChild(card); items.appendChild(cell);
          });
          li.appendChild(items);
        }
        if (reply.links.length) {
          const links = assistEl('div', { class: 'o-assist-links' });
          for (const link of reply.links) {
            const a = assistEl('a', { class: 'o-assist-link' + (link.kind === 'whatsapp' ? ' is-whatsapp' : ''), href: link.href, 'data-assist-link': link.kind }, link.label);
            if (link.kind === 'whatsapp') { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); a.appendChild(assistEl('span', { 'aria-hidden': 'true' }, ' ↗')); }
            a.addEventListener('click', () => assistTrack('origens_assistant_link_click', { link_kind: link.kind }));
            links.appendChild(a);
          }
          li.appendChild(links);
        }
        // As sugestões da abertura repetiriam os temas fixos ("Frete e prazo" e "Como é calculado o frete?"): com a linha de temas, ficam escondidas.
        // O storefront continua mandando: um Worker sem temas segue mostrando as sugestões.
        if (i === lastBot && reply.suggestions.length && !(i === 0 && this.topics.length)) {
          const chips = assistEl('div', { class: 'o-assist-chips' });
          for (const s of reply.suggestions) {
            const chip = assistEl('button', { type: 'button', class: 'o-assist-chip' }, s);
            chip.disabled = this.pending;
            chip.addEventListener('click', () => this.ask(s, 'chip'));
            chips.appendChild(chip);
          }
          li.appendChild(chips);
        }
        list.appendChild(li);
      });
      if (this.pending) {
        const typing = assistEl('li', { class: 'o-assist-typing', role: 'status', 'aria-label': 'Digitando', 'data-assist-typing': '' });
        for (let k = 0; k < 3; k++) typing.appendChild(assistEl('i', { 'aria-hidden': 'true' }));
        typing.appendChild(assistEl('span', null, ' digitando'));
        list.appendChild(typing);
      }
      for (const b of document.querySelectorAll('#o-assist [data-assist-topic]')) b.disabled = this.pending;
      const body = list.parentElement;
      if (body) body.scrollTop = body.scrollHeight;
    },

    async ask(raw, source) {
      const message = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, ASSIST_MAX_MESSAGE);
      if (!message || this.pending) return;
      const input = document.querySelector('#o-assist [data-assist-input]');
      if (input) input.value = '';
      assistTrack('origens_assistant_message', { message_source: source });
      const started = Date.now();
      const sensitive = ASSIST_SENSITIVE.test(message);
      const previous = (this.entries.filter((e) => e.from === 'bot').pop() || { reply: this.opening }).reply;
      // Nunca enviado nem guardado: o balão mostra uma máscara no lugar.
      const local = sensitive ? assistReply(ASSIST_REFUSE) : assistFollowUp(message, previous);
      this.entries.push({ from: 'me', text: sensitive ? '••••' : message });
      this.pending = true;
      this.render();
      if (local) {
        await assistWait(assistDelay(local.text) - (Date.now() - started));
        this.pending = false;
        if (!document.getElementById('o-assist')) return;
        this.entries.push({ from: 'bot', reply: local });
        assistTalkWrite(this.entries);
        assistTrack('origens_assistant_reply', { reply_kind: local.kind });
        this.render();
        return;
      }
      let reply = null; let failure = 'Não consegui responder agora. Tente de novo em instantes.';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASSIST_FETCH_MS + 1000);
      try {
        const response = await fetch(withRegion(ASSIST_ENDPOINT), { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ message: message }), signal: controller.signal });
        if (response.status === 429) failure = 'Muitas mensagens seguidas. Espere um minuto e tente de novo.';
        reply = response.ok ? assistReply(await response.json()) : null;
      } catch (_) { reply = null; } finally { clearTimeout(timer); }
      await assistWait(assistDelay(reply ? reply.text : failure) - (Date.now() - started));
      this.pending = false;
      if (!document.getElementById('o-assist')) return; // desmontado durante a resposta (Turbo)
      this.entries.push({ from: 'bot', reply: reply || { v: 1, kind: 'fallback', text: failure, items: [], links: [], suggestions: [] } });
      assistTalkWrite(this.entries);
      assistTrack(reply ? 'origens_assistant_reply' : 'origens_assistant_error', reply ? { reply_kind: reply.kind, result_count: reply.items.length } : undefined);
      this.render();
      const send = document.querySelector('#o-assist [data-assist-send]');
      if (send && input) send.disabled = input.value.trim() === '';
      if (input && !assistCoarse()) input.focus({ preventScroll: true });
    },

    close(refocus) {
      if (!this.open) return;
      this.open = false;
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      for (const sel of ['#o-assist-panel', '#o-assist .o-assist-backdrop']) { const el = document.querySelector(sel); if (el) el.remove(); }
      if (this.locked) { document.documentElement.style.overflow = this.lock || ''; this.locked = false; }
      const fab = document.querySelector('#o-assist .o-assist-fab');
      if (fab) {
        fab.setAttribute('aria-expanded', 'false');
        const label = fab.querySelector('[data-assist-label]'); if (label) label.textContent = this.label;
        if (refocus) fab.focus({ preventScroll: true });
      }
      assistTrack('origens_assistant_close');
      this.place();
    },

    unmount() {
      clearTimeout(this.timer);
      if (this.panelAc) { this.panelAc.abort(); this.panelAc = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      if (this.locked) { document.documentElement.style.overflow = this.lock || ''; this.locked = false; }
      this.open = false; this.opening = null; this.whatsapp = null; this.pending = false; this.label = ASSIST_LABEL; this.topics = [];
      const root = document.getElementById('o-assist');
      if (root) root.remove();
    }
  });
`;
