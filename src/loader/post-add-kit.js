// post-add-kit: "Monte seu kit" no modal "Produto adicionado ao carrinho" da INK (página de produto), o bloco da promoção progressiva escolhida no CMS.
//   Dados:    /__origens/kit (o Worker lê /api/post-add-kit/<região> do storefront, que lê a promoção na API da INK; contrato v1). Buscado uma vez ao montar
//             (para o bloco nascer junto com o modal) e guardado 1 min (sessionStorage), validado de novo aqui. Erro, timeout, JSON inválido ou kit null =>
//             NADA aparece: o modal fica exatamente como a INK desenha.
//   Preço:    o da peça que ACABOU de ser adicionada, lido no próprio formulário de compra enviado (form-product-<id>: o da página, o do "compre junto" ou o do
//             quick add), no envio. Sem preço legível (ou envio de mais de 30 s atrás), as faixas mostram só o desconto ("R$ 25 OFF no total"), sem contas.
//             As contas são as da INK aplicadas a esse preço: `value` = R$ fora do total; `percentage` = % fora do total. Quem aplica é o carrinho da INK.
//   Modal:    o bloco entra ANTES dos botões nativos; "Ver carrinho" vira "Finalizar compra" (o mesmo botão da INK, só o texto do rótulo muda) e ocupa a
//             largura toda: "Continuar comprando" fica escondido enquanto há kit (decisão do dono: a busca logo abaixo já leva a outras estampas, e o × e o
//             clique fora continuam fechando o modal). Ao desmontar, o texto e o botão voltam. No celular o botão fica preso ao pé da folha enquanto se rola,
//             para "Finalizar compra" nunca sair da tela. A busca e "As mais vendidas" continuam abaixo.
//   Copiar:   SÓ copia o código (Clipboard API e, sem ela, execCommand; sem nenhum, o código fica selecionado). Nunca toca no campo de cupom da INK.
// Todo texto vem do CMS e entra só por textContent.
export const POST_ADD_KIT = String.raw`
  const KIT_ENDPOINT = '/__origens/kit';
  const KIT_CACHE_KEY = 'origens:kit:v1';
  const KIT_CACHE_MS = 60 * 1000;
  const KIT_FETCH_MS = 4000;
  const KIT_PRICE_MS = 30 * 1000;
  const KIT_MAX_TIERS = 6;
  const KIT_CODE = /^[A-Za-z0-9_-]{2,40}$/;
  const KIT_CONTROL = /[\u0000-\u001f\u007f<>]/;
  const KIT_LIMITS = { eyebrow: 40, title: 60, lead: 160 };
  const KIT_MONEY = /^R\$\s?(\d{1,3}(?:\.\d{3})*|\d{1,6}),(\d{2})$/;
  const KIT_LABEL_CHECKOUT = 'Finalizar compra';
  const KIT_NOTE = 'Em peças com preços diferentes, o total do kit pode variar.';

  function kitText(value, max) {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 1 && text.length <= max && !KIT_CONTROL.test(text) ? text : null;
  }
  // O mesmo contrato que o gateway já aplicou; repetido aqui porque o sessionStorage é do visitante. Qualquer desvio => null (nada aparece).
  function kitValidate(data) {
    if (!data || typeof data !== 'object' || data.v !== 1 || !('kit' in data)) return null;
    const k = data.kit;
    if (k === null) return { kit: null };
    if (!k || typeof k !== 'object' || !Number.isInteger(k.id) || k.id < 1 || typeof k.code !== 'string' || !KIT_CODE.test(k.code) || typeof k.auto !== 'boolean') return null;
    if (k.kind !== 'value' && k.kind !== 'percentage') return null;
    if (!Array.isArray(k.tiers) || k.tiers.length < 1 || k.tiers.length > KIT_MAX_TIERS) return null;
    const tiers = [];
    for (const t of k.tiers) {
      if (!t || !Number.isInteger(t.items) || t.items < 2 || t.items > 999 || typeof t.discount !== 'number' || !isFinite(t.discount) || t.discount <= 0) return null;
      if (k.kind === 'percentage' && t.discount >= 100) return null;
      if (tiers.length && t.items <= tiers[tiers.length - 1].items) return null;
      tiers.push({ items: t.items, discount: t.discount });
    }
    const kit = { id: k.id, code: k.code, auto: k.auto, kind: k.kind, tiers: tiers };
    for (const key of Object.keys(KIT_LIMITS)) { const text = kitText(k[key], KIT_LIMITS[key]); if (!text) return null; kit[key] = text; }
    if (k.endsAt !== undefined && !(Date.parse(k.endsAt) > Date.now())) return { kit: null }; // acabou enquanto estava em cache
    return { kit: kit };
  }
  function kitReadCache() {
    try {
      const raw = window.sessionStorage.getItem(KIT_CACHE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored || stored.region !== STORE.region || typeof stored.at !== 'number' || Date.now() - stored.at > KIT_CACHE_MS || stored.at > Date.now()) return undefined;
      return stored.data === null ? null : kitValidate(stored.data) || undefined;
    } catch (_) { return undefined; }
  }
  function kitWriteCache(data) { try { window.sessionStorage.setItem(KIT_CACHE_KEY, JSON.stringify({ at: Date.now(), region: STORE.region, data: data })); } catch (_) { /* sem storage: só não há cache */ } }
  // Uma busca por minuto no máximo (o Turbo mantém o JS entre páginas): a promessa é reaproveitada; uma falha também é lembrada (null) por um minuto.
  let kitPending = null; let kitPendingAt = 0;
  function kitLoad() {
    const cached = kitReadCache();
    if (cached !== undefined) return Promise.resolve(cached);
    if (kitPending && Date.now() - kitPendingAt < KIT_CACHE_MS) return kitPending;
    kitPendingAt = Date.now();
    kitPending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), KIT_FETCH_MS);
      try {
        const response = await fetch(withRegion(KIT_ENDPOINT), { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        const clean = kitValidate(data);
        if (!clean) throw new Error('schema');
        kitWriteCache(data);
        return clean;
      } catch (_) {
        kitWriteCache(null);
        return null;
      } finally { clearTimeout(timer); }
    })();
    return kitPending;
  }

  // "R$ 109,90" -> 10990. Só um preço inteiro, sozinho no elemento (as parcelas "5x de R$ 21,98" não passam).
  function kitCents(text) {
    const m = KIT_MONEY.exec(String(text || '').replace(/ /g, ' ').trim());
    if (!m) return null;
    const cents = Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]);
    return cents > 0 && cents <= 100000 * 100 ? cents : null;
  }
  // O preço COBRADO no formulário enviado. Na PDP real (27/10/2026) ele mora em [data-ink-labs-anchor="product_price"]: ali vale o MENOR preço inteiro
  // (numa promoção o cobrado é sempre menor que o cheio, venha o cheio riscado ou não). Sem a âncora, o primeiro elemento-folha com só um preço. Sempre
  // fora de riscados (o "de" de uma promoção) e do que é nosso.
  function kitPriceIn(form) {
    const anchor = form.querySelector('[data-ink-labs-anchor="product_price"]');
    let best = null;
    for (const el of (anchor || form).querySelectorAll('p, span, strong, b, div')) {
      if (el.children.length || el.closest('del, s, strike, [class*="line-through"], [data-origens-kit], [data-origens-discovery], [data-origens-reco]')) continue;
      const cents = kitCents(el.textContent);
      if (!cents) continue;
      if (!anchor) return cents;
      if (best === null || cents < best) best = cents;
    }
    return best;
  }
  let kitLast = null; // { at, cents } do último envio de um formulário de compra
  function kitCapture(target) {
    const form = target && target.closest ? target.closest('form[id^="form-product-"]') : null;
    if (!form) return;
    let cents = null;
    try { cents = kitPriceIn(form); } catch (_) { /* sem preço: o bloco mostra só os descontos */ }
    kitLast = { at: Date.now(), cents: cents };
  }
  const kitPrice = () => (kitLast && Date.now() - kitLast.at < KIT_PRICE_MS ? kitLast.cents : null);

  const kitMoney = (cents) => { try { return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch (_) { return 'R$ ' + (cents / 100).toFixed(2).replace('.', ','); } };
  const kitOff = (kind, discount) => (kind === 'value' ? kitMoney(Math.round(discount * 100)).replace(/,00$/, '') : String(discount).replace('.', ',') + '%') + ' OFF';
  // As mesmas contas do painel (src/lib/ink/progressive-promotions.ts no useorigens), em centavos. Uma faixa que zeraria o total => null (só os descontos).
  function kitPrices(unit, kit) {
    if (!unit) return null;
    const out = [];
    for (const t of kit.tiers) {
      const full = unit * t.items;
      const total = kit.kind === 'value' ? full - Math.round(t.discount * 100) : Math.round(full * (100 - t.discount) / 100);
      if (total <= 0 || total >= full) return null;
      out.push({ full: full, total: total, each: Math.round(total / t.items), saved: full - total });
    }
    return out;
  }

  // Medição: só com o gtag da PRÓPRIA INK para a propriedade da região na página e com o aviso de cookies da INK aceito (a mesma regra de tracking.js).
  // Nunca o código do cupom nem preços: só o id da promoção e quantas faixas.
  function kitTrack(name, kit) {
    try {
      if (typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + STORE.ga + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      window.gtag('event', name, { send_to: STORE.ga, region: STORE.region, surface: 'ink', promo_id: String(kit.id), tiers: kit.tiers.length, transport_type: 'beacon' });
    } catch (_) { /* medir nunca quebra a INK */ }
  }

  async function kitCopy(text, host) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* tenta o plano B */ }
    try {
      // Dentro do próprio bloco: o modal da INK é aria-modal e o foco não deve sair dele.
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', ''); area.setAttribute('aria-hidden', 'true'); area.tabIndex = -1;
      area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
      const active = document.activeElement;
      host.appendChild(area); area.select(); area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      if (active && active.focus) active.focus({ preventScroll: true });
      return !!ok;
    } catch (_) { return false; }
  }

  function kitEl(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    if (text != null) node.textContent = text;
    return node;
  }
  function kitIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    // Etiqueta de preço.
    const tag = document.createElementNS(ns, 'path'); tag.setAttribute('d', 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z');
    const hole = document.createElementNS(ns, 'circle'); hole.setAttribute('cx', '7.5'); hole.setAttribute('cy', '7.5'); hole.setAttribute('r', '1.5');
    svg.appendChild(tag); svg.appendChild(hole);
    return svg;
  }

  // Dois retângulos sobrepostos (copiar).
  function kitCopyIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const front = document.createElementNS(ns, 'rect'); front.setAttribute('x', '9'); front.setAttribute('y', '9'); front.setAttribute('width', '12'); front.setAttribute('height', '12'); front.setAttribute('rx', '2');
    const back = document.createElementNS(ns, 'path'); back.setAttribute('d', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1');
    svg.appendChild(front); svg.appendChild(back);
    return svg;
  }

  const KIT_PRIMARY = (STORE.theme && STORE.theme.primary) || '#4d543d';
  const KIT_CSS = [
    // Cores e raio do tema da compra (theme-cart) quando ele está no ar; sem ele, a cor da região e o raio dos botões da INK.
    '[data-origens-kit]{--k-accent:var(--o-selected,' + KIT_PRIMARY + ');--k-ink:var(--o-ink,#111827);--k-mute:var(--o-ink-mute,#4b5563);--k-line:var(--o-line-soft,rgba(17,24,39,.14));--k-radius:var(--o-radius,8px);--k-surface:var(--o-surface,#fff);box-sizing:border-box;margin:18px 0 16px;font-family:inherit;color:var(--k-ink);text-align:left}',
    '[data-origens-kit] *{box-sizing:border-box;font-family:inherit}',
    '[data-origens-kit] .o-kit-eyebrow{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-size:11px;font-weight:700;line-height:1.3;letter-spacing:.08em;text-transform:uppercase;color:var(--k-accent)}',
    '[data-origens-kit] .o-kit-eyebrow svg{width:14px;height:14px;flex:none}',
    '[data-origens-kit] .o-kit-title{margin:0;font-size:20px;line-height:1.2;font-weight:700;letter-spacing:normal;text-transform:none;color:var(--k-ink)}',
    '[data-origens-kit] .o-kit-lead{margin:6px 0 0;font-size:13px;line-height:1.4;color:var(--k-mute)}',
    '[data-origens-kit] .o-kit-code{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 0}',
    '[data-origens-kit] .o-kit-chip{display:inline-flex;align-items:center;gap:.3em;min-height:40px;padding:6px 12px;border-radius:var(--k-radius);background:color-mix(in srgb,var(--k-accent) 12%,var(--k-surface));color:var(--k-accent);font-size:14px;font-weight:700;line-height:1.2}',
    // "Copiar cupom" é um botão de verdade (borda, ícone), não um texto: a mesma altura do selo do cupom ao lado.
    '[data-origens-kit] .o-kit-copy{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;min-height:40px;margin:0;padding:0 14px;border:1.5px solid var(--k-accent);border-radius:var(--k-radius);background:var(--k-surface);color:var(--k-accent);font-size:14px;font-weight:700;line-height:1.2;letter-spacing:normal;text-transform:none;text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s}',
    '[data-origens-kit] .o-kit-copy svg{width:16px;height:16px;flex:none}',
    '[data-origens-kit] .o-kit-copy:hover,[data-origens-kit] .o-kit-copy[data-copied]{background:var(--k-accent);color:var(--o-on-selected,#fff)}',
    '[data-origens-kit] .o-kit-copy:focus-visible{outline:2px solid var(--k-accent);outline-offset:2px}',
    '[data-origens-kit] .o-kit-tiers{display:grid;gap:8px;margin:10px 0 0;padding:0;list-style:none}',
    '[data-origens-kit] .o-kit-tier{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:12px;min-height:56px;margin:0;padding:8px 12px;border:1px solid var(--k-line);border-radius:var(--k-radius);background:var(--k-surface)}',
    '[data-origens-kit] .o-kit-tier[data-best]{border-color:var(--k-accent);background:color-mix(in srgb,var(--k-accent) 7%,var(--k-surface))}',
    '[data-origens-kit] .o-kit-qty{font-size:15px;font-weight:700;line-height:1.2;white-space:nowrap}',
    '[data-origens-kit] .o-kit-total,[data-origens-kit] .o-kit-each{display:flex;flex-direction:column;line-height:1.25;min-width:0}',
    '[data-origens-kit] .o-kit-each{align-items:flex-end;text-align:right}',
    '[data-origens-kit] .o-kit-total s{font-size:12px;color:var(--k-mute)}',
    '[data-origens-kit] .o-kit-total strong{font-size:15px;font-weight:700;white-space:nowrap}',
    '[data-origens-kit] .o-kit-each strong{font-size:14px;font-weight:700;color:var(--k-accent);white-space:nowrap}',
    '[data-origens-kit] .o-kit-each small{font-size:11px;color:var(--k-mute);white-space:nowrap}',
    '[data-origens-kit] .o-kit-off{grid-column:2 / 4;justify-self:end;font-size:15px;font-weight:700;color:var(--k-accent)}',
    '[data-origens-kit] .o-kit-note{margin:8px 0 0;font-size:11.5px;line-height:1.4;color:var(--k-mute)}',
    '[data-origens-kit] .o-kit-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    // Um botão só, na largura toda: "Finalizar compra". O "Continuar comprando" nativo fica escondido enquanto há kit (a busca logo abaixo faz esse papel).
    '#modal-wrapper [data-origens-kit-footer]{display:grid!important;grid-template-columns:1fr;gap:8px;align-items:stretch}',
    // !important: o tema da compra (theme-cart) põe caixa alta e espaçamento no botão; aqui a letra é a do resto do bloco, e o ícone do carrinho fica
    // colado ao texto, os dois centralizados juntos.
    '#modal-wrapper [data-origens-kit-footer] > *{display:flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;width:auto!important;min-width:0;min-height:52px!important;margin:0!important;padding:6px 12px!important;font-size:15px!important;line-height:1.2!important;letter-spacing:normal!important;text-transform:none!important;white-space:normal;text-align:center}',
    '#modal-wrapper [data-origens-kit-footer] > * > span{padding:0!important;margin:0!important}',
    '#modal-wrapper [data-origens-kit-footer] > * > :is(svg,i,img){flex:none;width:16px;height:16px;margin:0!important;font-size:16px;line-height:1}',
    '#modal-wrapper [data-origens-kit-footer] .checkout-btn{font-weight:700!important}',
    // Depois da regra geral acima (ordem e especificidade dizem o mesmo).
    '#modal-wrapper [data-origens-kit-footer] #continue-shopping-button{display:none!important}',
    // Enquanto há kit, o modal é TOPO fixo + MEIO que rola + PÉ fixo (pedido do dono em 28/10/2026): o topo ("Produto adicionado ao carrinho" e o ×)
    // preso no alto, "Finalizar compra" preso embaixo, e o kit, a busca e "As mais vendidas" rolando entre os dois. Vale no celular e no desktop.
    '#modal-wrapper[data-origens-kit-open]{overflow-y:auto!important;overscroll-behavior:contain}',
    '#modal-wrapper [data-origens-kit-head]{position:sticky;top:0;z-index:3;margin:-16px -16px 0!important;padding:16px 16px 12px!important;background:var(--o-surface,#fff);box-shadow:0 1px 0 var(--o-line-soft,rgba(17,24,39,.12))}',
    // O pé vai para o FIM do conteúdo só na exibição (order, num corpo em coluna): preso embaixo do começo ao fim da rolagem, também sobre a busca e
    // "As mais vendidas" (no HTML da INK ele vem antes delas; nada é movido no DOM).
    '#modal-wrapper [data-origens-kit-body]{display:flex!important;flex-direction:column!important}',
    '#modal-wrapper [data-origens-kit-body] > [data-origens-kit-footer]{order:99;position:sticky;bottom:0;z-index:2;margin:auto -16px -16px!important;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:var(--o-surface,#fff);box-shadow:0 -1px 0 var(--o-line-soft,rgba(17,24,39,.12))}',
    // Celular: a folha da INK CRESCE com o conteúdo (sem altura máxima, presa ao pé da tela). Com o kit ela passava da tela e o topo, com o ×, sumia para
    // cima sem volta (visto ao vivo em 28/10/2026). Aqui ela vai no máximo até a altura da tela e rola por dentro (no desktop a gaveta já tem a altura da tela).
    '@media (max-width:767px){#modal-wrapper[data-origens-kit-open]{max-height:calc(100vh - 12px)!important;max-height:calc(100dvh - 12px)!important}[data-origens-kit]{margin:14px 0 12px}[data-origens-kit] .o-kit-title{font-size:18px}}',
    '@media (max-width:359px){[data-origens-kit] .o-kit-tier{column-gap:8px;padding:8px 10px}[data-origens-kit] .o-kit-each small{display:none}}',
    '@media (max-height:700px){[data-origens-kit] .o-kit-lead{display:none}}'
  ].join('');

  function kitStyle() {
    if (document.getElementById('o-kit-style')) return;
    const style = kitEl('style', { id: 'o-kit-style' });
    style.textContent = KIT_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // Rótulo nativo de um botão: o <span> do texto (o ícone fica). Sem <span>, nada é trocado (nunca apagamos o ícone).
  function kitRelabel(button, text) {
    const label = button ? button.querySelector('span') : null;
    if (!label || label.hasAttribute('data-origens-kit-label')) return;
    label.setAttribute('data-origens-kit-label', label.textContent);
    label.textContent = text;
  }
  function kitRestore(scope) {
    const root = scope || document;
    for (const block of root.querySelectorAll('[data-origens-kit]')) block.remove();
    for (const label of root.querySelectorAll('[data-origens-kit-label]')) { label.textContent = label.getAttribute('data-origens-kit-label'); label.removeAttribute('data-origens-kit-label'); }
    for (const footer of root.querySelectorAll('[data-origens-kit-footer]')) footer.removeAttribute('data-origens-kit-footer');
    for (const head of root.querySelectorAll('[data-origens-kit-head]')) head.removeAttribute('data-origens-kit-head');
    for (const sheet of root.querySelectorAll('[data-origens-kit-open]')) sheet.removeAttribute('data-origens-kit-open');
    for (const body of root.querySelectorAll('[data-origens-kit-body]')) body.removeAttribute('data-origens-kit-body');
  }

  function kitBuild(kit, unit, signal) {
    const root = kitEl('section', { 'data-origens-kit': '', 'aria-labelledby': 'o-kit-title' });
    const eyebrow = kitEl('p', { class: 'o-kit-eyebrow' });
    eyebrow.appendChild(kitIcon()); eyebrow.appendChild(document.createTextNode(kit.eyebrow));
    root.appendChild(eyebrow);
    root.appendChild(kitEl('h4', { id: 'o-kit-title', class: 'o-kit-title' }, kit.title));
    root.appendChild(kitEl('p', { class: 'o-kit-lead' }, kit.lead));

    const code = kitEl('div', { class: 'o-kit-code' });
    const status = kitEl('span', { class: 'o-kit-sr', role: 'status', 'aria-live': 'polite' });
    if (kit.auto) code.appendChild(kitEl('span', { class: 'o-kit-chip' }, 'Desconto aplicado no carrinho'));
    else {
      const chip = kitEl('span', { class: 'o-kit-chip' }, 'Cupom');
      const codeText = kitEl('span', { 'data-origens-kit-code': '' }, kit.code);
      chip.appendChild(codeText);
      const copy = kitEl('button', { type: 'button', class: 'o-kit-copy', 'aria-label': 'Copiar o cupom ' + kit.code });
      copy.appendChild(kitCopyIcon());
      const copyLabel = kitEl('span', null, 'Copiar cupom');
      copy.appendChild(copyLabel);
      let reset = null;
      copy.addEventListener('click', async () => {
        const ok = await kitCopy(kit.code, root);
        if (ok) {
          copyLabel.textContent = 'Copiado'; copy.setAttribute('data-copied', ''); status.textContent = 'Cupom ' + kit.code + ' copiado. Cole no carrinho.';
          clearTimeout(reset); reset = setTimeout(() => { copyLabel.textContent = 'Copiar cupom'; copy.removeAttribute('data-copied'); status.textContent = ''; }, 2000);
          kitTrack('kit_coupon_copy', kit);
        } else {
          // Sem área de transferência: o código fica selecionado para copiar à mão.
          try { const range = document.createRange(); range.selectNodeContents(codeText); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch (_) { /* ignora */ }
          status.textContent = 'Selecione e copie o cupom ' + kit.code + '.';
        }
      }, { signal: signal });
      code.appendChild(chip); code.appendChild(copy);
    }
    root.appendChild(code);

    const prices = kitPrices(unit, kit);
    const list = kitEl('ol', { class: 'o-kit-tiers' });
    kit.tiers.forEach((t, i) => {
      const li = kitEl('li', { class: 'o-kit-tier' });
      if (i === kit.tiers.length - 1 && kit.tiers.length > 1) li.setAttribute('data-best', '');
      const qty = t.items + ' peças';
      const p = prices ? prices[i] : null;
      if (p) {
        li.appendChild(kitEl('span', { class: 'o-kit-sr' }, qty + ': de ' + kitMoney(p.full) + ' por ' + kitMoney(p.total) + ', ' + kitMoney(p.each) + ' cada, economia de ' + kitMoney(p.saved) + '.'));
        li.appendChild(kitEl('span', { class: 'o-kit-qty', 'aria-hidden': 'true' }, qty));
        const total = kitEl('span', { class: 'o-kit-total', 'aria-hidden': 'true' });
        total.appendChild(kitEl('s', null, 'de ' + kitMoney(p.full)));
        total.appendChild(kitEl('strong', null, 'por ' + kitMoney(p.total)));
        li.appendChild(total);
        const each = kitEl('span', { class: 'o-kit-each', 'aria-hidden': 'true' });
        each.appendChild(kitEl('strong', null, kitMoney(p.each) + ' cada'));
        each.appendChild(kitEl('small', null, 'economize ' + kitMoney(p.saved)));
        li.appendChild(each);
      } else {
        li.appendChild(kitEl('span', { class: 'o-kit-qty' }, qty));
        li.appendChild(kitEl('span', { class: 'o-kit-off' }, kitOff(kit.kind, t.discount) + ' no total'));
      }
      list.appendChild(li);
    });
    root.appendChild(list);
    root.appendChild(kitEl('p', { class: 'o-kit-note' }, KIT_NOTE));
    root.appendChild(status);
    root.setAttribute('data-priced', prices ? 'true' : 'false');
    return root;
  }

  register({
    id: 'post-add-kit',
    host: null,
    observer: null,
    ac: null,
    shown: null, // { at, kit } do bloco montado agora
    clicks: null,

    mount() {
      if (!allowedNow()) return this.unmount();
      if (!this.ac) {
        this.ac = new AbortController();
        const opts = { signal: this.ac.signal, capture: true };
        // O preço é lido NO ENVIO (antes da resposta trocar a página ou o quadro do formulário).
        document.addEventListener('submit', (event) => kitCapture(event.target), opts);
        document.addEventListener('turbo:submit-start', (event) => kitCapture(event.target), opts);
        for (const name of ['turbo:frame-load', 'turbo:frame-render', 'turbo:before-stream-render']) {
          document.addEventListener(name, () => setTimeout(() => this.check(), 30), { signal: this.ac.signal });
        }
        kitLoad(); // antecipa: o bloco nasce junto com o modal
      }
      // Observa só o subárvore do frame onde a INK renderiza o modal; reata se o frame for trocado.
      const host = document.getElementById('last_added_product');
      if (host && host !== this.host) {
        if (this.observer) this.observer.disconnect();
        this.host = host;
        this.observer = new MutationObserver(() => this.check());
        this.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
      }
      this.check();
    },

    // Modal "aberto de verdade": existe, está visível, mostra a confirmação da INK e os botões nativos.
    isOpen(wrapper) {
      return !!wrapper && wrapper.getClientRects().length > 0 && /Produto adicionado/i.test(wrapper.textContent || '') &&
        !!wrapper.querySelector('.add-product-modal__modal-content__footer .checkout-btn, .add-product-modal__modal-content__footer #continue-shopping-button');
    },

    check() {
      if (!allowedNow()) return this.unmount();
      const wrapper = document.getElementById('modal-wrapper');
      if (!this.isOpen(wrapper)) { this.clear(); return; }
      const present = wrapper.querySelector('[data-origens-kit]');
      // Mesmo modal reaberto por uma nova adição (a INK pode só mostrar de novo os mesmos nós): o preço é outro, o bloco é refeito.
      if (present && !(kitLast && this.shown && kitLast.at > this.shown.at)) return;
      kitLoad().then((data) => {
        const current = document.getElementById('modal-wrapper');
        // Revalida depois do carregamento assíncrono: rota, modal ainda aberto.
        if (!data || !data.kit || !allowedNow() || !this.isOpen(current)) return;
        const footer = current.querySelector('.add-product-modal__modal-content__footer');
        if (!footer) return;
        const block = current.querySelector('[data-origens-kit]');
        if (block && !(kitLast && this.shown && kitLast.at > this.shown.at)) return;
        this.clear();
        kitStyle();
        this.clicks = new AbortController();
        const root = kitBuild(data.kit, kitPrice(), this.clicks.signal);
        footer.insertAdjacentElement('beforebegin', root);
        footer.setAttribute('data-origens-kit-footer', '');
        // A folha (o próprio #modal-wrapper), o corpo (o pai dos botões, que vira coluna) e o topo com o × (o pai do botão de fechar), para o CSS.
        current.setAttribute('data-origens-kit-open', '');
        if (footer.parentElement && footer.parentElement !== current) footer.parentElement.setAttribute('data-origens-kit-body', '');
        const close = current.querySelector('#modal-close-button');
        if (close && close.parentElement && close.parentElement !== current && !close.parentElement.contains(footer)) close.parentElement.setAttribute('data-origens-kit-head', '');
        const checkout = footer.querySelector('.checkout-btn');
        kitRelabel(checkout, KIT_LABEL_CHECKOUT);
        // Só medimos: o clique segue para a INK (abrir o carrinho) exatamente como antes.
        if (checkout) checkout.addEventListener('click', () => kitTrack('kit_checkout_click', data.kit), { signal: this.clicks.signal });
        this.shown = { at: Date.now(), kit: data.kit };
        kitTrack('kit_view', data.kit);
      });
    },

    // Tira o bloco e devolve os rótulos (o modal fechou, foi trocado ou a rota saiu do escopo).
    clear() {
      if (this.clicks) { this.clicks.abort(); this.clicks = null; }
      if (this.shown || document.querySelector('[data-origens-kit], [data-origens-kit-label], [data-origens-kit-footer], [data-origens-kit-head], [data-origens-kit-open], [data-origens-kit-body]')) kitRestore();
      this.shown = null;
    },

    unmount() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.host = null;
      this.clear();
      const style = document.getElementById('o-kit-style');
      if (style) style.remove();
    }
  });
`;
