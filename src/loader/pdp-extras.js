// pdp-share e size-guide: duas melhorias pequenas da página de produto, cada uma atrás da SUA flag (WIDGET_FEATURES). Ambas são só apresentação
// em volta do que a INK já faz: nenhuma intercepta o formulário, o carrinho, o CSRF, os cookies ou o checkout; se algo falhar, a página nativa fica como está.
// Strings String.raw: nada de crase nem "${" aqui dentro (o bundle é concatenado e não é um template).

// Medição opcional compartilhada pelas duas (entra no bundle quando qualquer uma está ligada). Mesmas regras de tracking.js: só pelo gtag que a
// própria INK carrega desta loja, só depois do aceite do aviso de cookies da INK, baixa cardinalidade, nunca URL nem query. Nunca bloqueia nada.
export const PDP_EVENTS = String.raw`
  function pdpTrack(name, params) {
    try {
      if (!allowedNow() || typeof window.gtag !== 'function' || !document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + STORE.ga + '"]')) return;
      if (document.querySelector('.cookie-acceptance, [data-controller~="ink-store--cookie-acceptance"]')) return;
      const payload = { send_to: STORE.ga, region: STORE.region, surface: 'ink', transport_type: 'beacon' };
      for (const key of Object.keys(params || {})) payload[key] = params[key];
      window.gtag('event', name, payload);
    } catch (_) { /* medir nunca quebra a INK */ }
  }
  // Escopo: o bloco de detalhes do produto da INK (a PDP real não tem <main>; títulos, frame da variante e modal ficam em div.details-product).
  const PDP_SCOPE = '.details-product';
  // Fora do formulário principal: o "Compre Junto", a compra rápida e o drawer têm seus próprios nós e nunca recebem nada nosso.
  const PDP_OUTSIDE = '.modal-buy-together, #quick_add_frame, #modal-wrapper, turbo-frame#cart, [data-origens-reco]';
`;

// size-guide: o link nativo "Confira suas medidas" (azul, sublinhado) vira um botão secundário "Guia de medidas" com fita métrica, na cor da região.
// O nó NATIVO é mantido (mesmo <a>, mesmo href, mesmo data-action do Stimulus que abre o modal oficial da INK): só ganha um atributo, um estilo
// escopado a esse atributo e três spans nossos; o texto e a imagem originais ficam no DOM, só escondidos, e voltam intactos no unmount
// (teardown, turbo:before-cache). Um clique = uma abertura do modal da INK; nada é clonado nem substituído. Sem o link na página, nada acontece.
export const SIZE_GUIDE = String.raw`
  const SIZE_ATTR = 'data-origens-size';
  const SIZE_STYLE_ID = 'o-size-style';
  // Seletores da PDP real (auditada em 2026-10-05): o link vem num turbo-frame lazy (product_variants_options_frame) e volta a cada troca de variante.
  const SIZE_LINKS = 'a#open-modal-size, a.form-product-options__size-modal-link';
  const SIZE_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  const SIZE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="11" r="6"/><circle cx="9" cy="11" r="1.6"/><path d="M15 11v6h6.5M17.5 17v-2M20 17v-2"/></svg>';
  const SIZE_CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6"/></svg>';
  const SIZE_CSS = [
    'a[data-origens-size]{--o-size-tint:#1f2328;display:flex!important;align-items:center;gap:8px;width:100%;min-height:46px;margin:2px 0 12px;padding:0 14px;box-sizing:border-box;',
    'border:1px solid rgba(31,35,40,.22);border-radius:10px;background:#f6f6f4;background:color-mix(in srgb,var(--o-size-tint) 6%,#fff);color:#1f2328!important;',
    'font-family:inherit;font-size:15px;font-weight:500;line-height:1.2;text-decoration:none!important;cursor:pointer;-webkit-tap-highlight-color:transparent;',
    'transition:border-color .15s ease,background-color .15s ease}',
    'a[data-origens-size] > img,a[data-origens-size] .o-size-native{display:none!important}',
    'a[data-origens-size] span{pointer-events:none}',
    'a[data-origens-size] .o-size-icon{display:inline-flex;flex:none;color:var(--o-size-tint)}',
    'a[data-origens-size] .o-size-chevron{display:inline-flex;flex:none;margin-left:auto;opacity:.55}',
    '@media (hover:hover){a[data-origens-size]:hover{border-color:var(--o-size-tint);background:color-mix(in srgb,var(--o-size-tint) 11%,#fff)}}',
    'a[data-origens-size]:focus-visible{outline:2px solid var(--o-size-tint);outline-offset:2px}',
    '@media (min-width:1024px){a[data-origens-size]{display:inline-flex!important;width:auto;min-width:260px;align-self:flex-start}}'
  ].join('');

  function sizeLinks() {
    return Array.from(document.querySelectorAll(SIZE_LINKS)).filter((link) => link.closest(PDP_SCOPE) && !link.closest(PDP_OUTSIDE));
  }
  function sizeEnsureStyle() {
    if (document.getElementById(SIZE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SIZE_STYLE_ID;
    style.textContent = SIZE_CSS;
    document.head.appendChild(style);
  }
  function sizeSpan(className, html, text) {
    const span = document.createElement('span');
    span.className = className;
    if (html) { span.setAttribute('aria-hidden', 'true'); span.innerHTML = html; } else span.textContent = text;
    return span;
  }
  // Os textos originais vão para um span escondido (continuam no DOM): restaurar é só tirar de volta, mesmo depois de um snapshot do Turbo.
  function sizeDecorate(link) {
    try {
      const native = sizeSpan('o-size-native', null, '');
      for (const node of Array.from(link.childNodes)) if (node.nodeType === 3) native.appendChild(node);
      link.appendChild(native);
      link.insertBefore(sizeSpan('o-size-icon', SIZE_ICON), link.firstChild);
      link.appendChild(sizeSpan('o-size-label', null, 'Guia de medidas'));
      link.appendChild(sizeSpan('o-size-chevron', SIZE_CHEVRON));
      link.style.setProperty('--o-size-tint', SIZE_TINT);
      link.setAttribute(SIZE_ATTR, '');
    } catch (err) { sizeRestore(link); throw err; }
  }
  function sizeRestore(link) {
    const native = link.querySelector(':scope > .o-size-native');
    if (native) { while (native.firstChild) link.insertBefore(native.firstChild, native); native.remove(); }
    for (const el of link.querySelectorAll(':scope > .o-size-icon, :scope > .o-size-label, :scope > .o-size-chevron')) el.remove();
    link.style.removeProperty('--o-size-tint');
    if (!link.getAttribute('style')) link.removeAttribute('style');
    link.removeAttribute(SIZE_ATTR);
  }

  register({
    id: 'size-guide',
    ac: null,

    // Barato e idempotente: roda a cada tick do observer, só escreve no DOM quando há um link nativo ainda não tratado (o frame da variante voltou).
    mount() {
      const pending = sizeLinks().filter((link) => !link.hasAttribute(SIZE_ATTR));
      if (!pending.length) return;
      sizeEnsureStyle();
      for (const link of pending) { try { sizeDecorate(link); } catch (_) { /* o link nativo continua como veio */ } }
      if (!this.ac) {
        this.ac = new AbortController();
        // Só medição (captura, sem preventDefault/stopPropagation): quem abre o modal continua sendo o controller da INK.
        document.addEventListener('click', (event) => {
          const link = event.target && event.target.closest ? event.target.closest('a[' + SIZE_ATTR + ']') : null;
          if (link) pdpTrack('origens_size_guide_open', {});
        }, { capture: true, signal: this.ac.signal });
      }
    },

    unmount() {
      if (this.ac) { this.ac.abort(); this.ac = null; }
      for (const link of document.querySelectorAll('a[' + SIZE_ATTR + ']')) { try { sizeRestore(link); } catch (_) { /* idem */ } }
      const style = document.getElementById(SIZE_STYLE_ID);
      if (style) style.remove();
    }
  });
`;

// pdp-share: "Compartilhar" logo abaixo do título (os dois <h1> da INK: o do celular, antes da galeria, e o do desktop, na coluna de detalhes;
// a própria INK mostra um por vez). Compartilha o produto exibido: https://<host da loja><caminho canônico do produto>, sem query nem hash
// (cart_ref, ls, origens_*, utm… nunca seguem). Dados prontos no mount: o clique chama navigator.share direto, sem nada assíncrono antes.
// Sem compartilhamento nativo (ou se ele falhar sem ser cancelamento): um painel pequeno com "Copiar link" e "WhatsApp". Cancelar = nada.
// type="button" e fora do formulário: nunca submete nem adiciona ao carrinho.
export const PDP_SHARE = String.raw`
  const SHARE_ATTR = 'data-origens-share';
  const SHARE_STYLE_ID = 'o-share-style';
  const SHARE_MENU_ID = 'o-share';
  const SHARE_TINT = (STORE.theme && /^#[0-9a-f]{6}$/i.test(STORE.theme.primary)) ? STORE.theme.primary : '#1f2328';
  const SHARE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';
  const SHARE_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const SHARE_CSS = [
    'button[data-origens-share]{--o-share-tint:#1f2328;display:inline-flex;align-items:center;gap:8px;align-self:flex-start;min-height:44px;margin:0;padding:0 2px;border:0;',
    'background:none;color:#1f2328;font-family:inherit;font-size:14px;font-weight:500;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    'button[data-origens-share] svg{color:var(--o-share-tint);flex:none}',
    '@media (hover:hover){button[data-origens-share]:hover span{text-decoration:underline;text-underline-offset:3px}}',
    'button[data-origens-share]:focus-visible{outline:2px solid var(--o-share-tint);outline-offset:2px;border-radius:6px}',
    '#o-share{position:fixed;top:0;bottom:0;left:0;width:var(--o-share-vw,100%);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;font-family:inherit;color:#1f2328}',
    '#o-share *{box-sizing:border-box}',
    '#o-share .o-share-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45)}',
    '#o-share .o-share-panel{position:relative;width:100%;max-width:420px;background:#fff;border-radius:16px 16px 0 0;padding:16px 18px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px rgba(0,0,0,.18)}',
    '@media (min-width:640px){#o-share{align-items:center}#o-share .o-share-panel{border-radius:14px;padding:18px 22px 22px}}',
    '#o-share .o-share-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '#o-share h2{margin:0;font-size:18px;font-weight:600}',
    '#o-share .o-share-close{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin-right:-10px;border:0;background:none;color:inherit;cursor:pointer}',
    '#o-share .o-share-name{margin:2px 0 16px;font-size:14px;color:#57606a}',
    '#o-share .o-share-action{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0 0 10px;border-radius:10px;font:inherit;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}',
    '#o-share .o-share-copy{border:0;background:var(--o-share-tint);color:#fff}',
    '#o-share .o-share-wa{border:1px solid rgba(31,35,40,.25);background:#fff;color:#1f2328}',
    '#o-share .o-share-action:focus-visible,#o-share .o-share-close:focus-visible{outline:2px solid var(--o-share-tint);outline-offset:2px}',
    '#o-share .o-share-status{min-height:20px;margin:4px 0 0;font-size:14px;font-weight:600}',
    '#o-share .o-share-field{width:100%;margin-top:8px;padding:10px 12px;border:1px solid rgba(31,35,40,.35);border-radius:8px;font-size:16px;color:#1f2328;background:#fff}'
  ].join('');

  function shareTitles() {
    return Array.from(document.querySelectorAll(PDP_SCOPE + ' h1')).filter((h1) => !h1.closest(PDP_OUTSIDE));
  }
  // Nome real do produto: o nó de dados da própria INK; o título visível como reserva.
  function shareName() {
    const data = document.querySelector('.product-data-js data[data-product-name]');
    const title = shareTitles()[0];
    const raw = (data && data.getAttribute('data-product-name')) || (title && title.textContent) || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  // "camiseta" só quando o modal oficial de medidas da INK mostra uma camiseta adulta (Clássica, Baby Look, Oversized "Unissex"); senão o texto neutro.
  function shareIsTee() {
    return Array.from(document.querySelectorAll('.modal-size-product__title')).some((el) => /cl[aá]ssica|baby look|unissex/i.test(el.textContent || ''));
  }
  function sharePayload() {
    const path = window.location.pathname;
    const name = shareName();
    if (!CATALOG_PRODUCT_PATH.test(path) || !name) return null;
    return { url: 'https://' + STORE.inkHost + path, title: name + ' | ' + STORE.name, text: (shareIsTee() ? 'Olha essa camiseta da Use Origens: ' : 'Olha o que encontrei na Use Origens: ') + name };
  }
  function shareEnsureStyle() {
    if (document.getElementById(SHARE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SHARE_STYLE_ID;
    style.textContent = SHARE_CSS;
    document.head.appendChild(style);
  }
  async function shareCopy(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* tenta o plano B */ }
    try {
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px';
      const active = document.activeElement;
      document.body.appendChild(area); area.select(); area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      if (active && active.focus) active.focus({ preventScroll: true });
      return !!ok;
    } catch (_) { return false; }
  }

  let shareMenuClose = null;
  function shareCloseMenu() { if (shareMenuClose) shareMenuClose(); }
  function shareOpenMenu(trigger, data) {
    shareCloseMenu();
    const root = document.createElement('div');
    root.id = SHARE_MENU_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'o-share-title');
    root.style.setProperty('--o-share-tint', SHARE_TINT);
    // A PDP nativa da INK é mais larga que a tela no celular (o drawer do carrinho fica fora dela: ~417 px num aparelho de 390). Um painel fixo com
    // inset:0 acompanharia essa largura e sairia pela direita; ele usa a largura VISÍVEL do documento.
    root.style.setProperty('--o-share-vw', (document.documentElement.clientWidth || window.innerWidth) + 'px');
    const backdrop = document.createElement('div'); backdrop.className = 'o-share-backdrop';
    const panel = document.createElement('div'); panel.className = 'o-share-panel';
    const head = document.createElement('div'); head.className = 'o-share-head';
    const title = document.createElement('h2'); title.id = 'o-share-title'; title.textContent = 'Compartilhar';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'o-share-close'; close.setAttribute('aria-label', 'Fechar'); close.innerHTML = SHARE_CLOSE;
    head.append(title, close);
    const name = document.createElement('p'); name.className = 'o-share-name'; name.textContent = data.title.replace(/ \| [^|]+$/, '');
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'o-share-action o-share-copy'; copy.textContent = 'Copiar link';
    const wa = document.createElement('a'); wa.className = 'o-share-action o-share-wa'; wa.textContent = 'WhatsApp';
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(data.text + ' ' + data.url);
    wa.target = '_blank'; wa.rel = 'noopener noreferrer';
    const status = document.createElement('p'); status.className = 'o-share-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    panel.append(head, name, copy, wa, status);
    root.append(backdrop, panel);
    document.body.appendChild(root);

    const ac = new AbortController();
    const done = () => {
      ac.abort(); root.remove(); shareMenuClose = null;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    shareMenuClose = done;
    close.addEventListener('click', done, { signal: ac.signal });
    backdrop.addEventListener('click', done, { signal: ac.signal });
    wa.addEventListener('click', () => pdpTrack('origens_share', { method: 'whatsapp' }), { signal: ac.signal });
    copy.addEventListener('click', async () => {
      const ok = await shareCopy(data.url);
      if (ok) { status.textContent = 'Link copiado!'; pdpTrack('origens_share', { method: 'copy' }); return; }
      status.textContent = 'Selecione e copie o link';
      let field = panel.querySelector('.o-share-field');
      if (!field) {
        field = document.createElement('input'); field.className = 'o-share-field'; field.readOnly = true; field.value = data.url; field.setAttribute('aria-label', 'Link para compartilhar');
        panel.appendChild(field);
      }
      field.focus(); field.select();
    }, { signal: ac.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); done(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll('button, a[href], input'));
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, { capture: true, signal: ac.signal });
    copy.focus({ preventScroll: true });
  }

  async function shareClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    const data = trigger.__origensShare;
    if (!data) return;
    if (typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
      try { await navigator.share(data); pdpTrack('origens_share', { method: 'native' }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; /* outra falha: oferece o painel */ }
    }
    shareOpenMenu(trigger, data);
  }

  register({
    id: 'pdp-share',

    // Idempotente: só escreve quando um título ainda não tem o botão logo depois dele (ou o botão é de outro produto, após uma visita Turbo).
    mount() {
      const path = window.location.pathname;
      const titles = shareTitles();
      const missing = titles.filter((h1) => { const next = h1.nextElementSibling; return !(next && next.hasAttribute(SHARE_ATTR) && next.getAttribute('data-path') === path); });
      if (!missing.length) return;
      const data = sharePayload();
      if (!data) return;
      shareEnsureStyle();
      for (const h1 of missing) {
        const stale = h1.nextElementSibling;
        if (stale && stale.hasAttribute(SHARE_ATTR)) stale.remove();
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(SHARE_ATTR, '');
        button.setAttribute('data-path', path);
        button.setAttribute('aria-haspopup', 'dialog');
        button.style.setProperty('--o-share-tint', SHARE_TINT);
        button.innerHTML = SHARE_ICON;
        const label = document.createElement('span'); label.textContent = 'Compartilhar';
        button.appendChild(label);
        button.__origensShare = data;
        button.addEventListener('click', shareClick);
        h1.insertAdjacentElement('afterend', button);
      }
    },

    unmount() {
      shareCloseMenu();
      for (const button of document.querySelectorAll('button[' + SHARE_ATTR + ']')) button.remove();
      const style = document.getElementById(SHARE_STYLE_ID);
      if (style) style.remove();
    }
  });
`;
