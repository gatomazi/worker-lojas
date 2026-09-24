// discovery.js (sob demanda): blocos de descoberta + busca real. Duas instâncias independentes:
//   'post-add' -> "Qual é a próxima cidade?" no drawer pós-adição (feature post-add-discovery)
//   'cart'     -> "Procurar outra cidade" COMPACTO dentro da área rolável do drawer do carrinho (feature cart-discovery);
//                 o rodapé nativo (cupom, frete, totais, "Finalizar compra") nunca é tocado.
// Regras: nada de innerHTML com dados externos (só textContent/atributos), links validados, CSS sob raiz exclusiva
// [data-origens-discovery], sem fontes/imagens externas, sem polling, sem cookies/armazenamento, tudo abortável.
// __SEARCH__ / __POSTADD__ / __CART__ são true/false (features): sem busca o bloco mostra só o retorno à vitrine.
export const DISCOVERY_TEMPLATE = String.raw`(() => {
  'use strict';
  const rt = window.__useOrigens;
  if (!rt || window.__useOrigensDiscovery) return;

  const SEARCH = __SEARCH__;
  const POSTADD = __POSTADD__;
  const CART = __CART__;
  const STOREFRONT = rt.storefront + '/sul';
  const SEARCH_ENDPOINT = '/__origens/search';
  const OLIVE = '#4d543d';
  const MAX_RESULTS = { 'post-add': 5, cart: 3 };
  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 200;
  const TIMEOUT_MS = 4000;
  const SAFE_HREF = /^\/sul(?:\/[a-z]{2}(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)?$/;

  const instances = {}; // kind -> { kind, root, style, ac, timer, abort, seq, results, active, uid, input, list, status, wrapper, panel, toggle }

  const CSS = [
    '[data-origens-discovery]{box-sizing:border-box;margin:16px 0 4px;padding:16px;background:#f6f4ec;border:1px solid #d9d5c3;border-radius:12px;font-family:inherit;color:#111827;text-align:left}',
    '[data-origens-discovery] *{box-sizing:border-box;font-family:inherit}',
    '[data-origens-discovery] .o-eyebrow{margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + OLIVE + '}',
    '[data-origens-discovery] .o-title{margin:0;font-size:16px;line-height:1.3;font-weight:600;color:#111827}',
    '[data-origens-discovery] .o-lead{margin:4px 0 12px;font-size:13px;line-height:1.4;color:#4b5563}',
    '[data-origens-discovery] .o-field{position:relative}',
    '[data-origens-discovery] .o-icon{position:absolute;left:14px;top:50%;width:18px;height:18px;margin-top:-9px;color:#6b7280;pointer-events:none}',
    '[data-origens-discovery] .o-input{display:block;width:100%;height:48px;margin:0;padding:0 14px 0 42px;border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#111827;font-size:16px;line-height:1.2;outline:none;-webkit-appearance:none;appearance:none;scroll-margin-bottom:calc(24px + env(safe-area-inset-bottom,0px))}',
    '[data-origens-discovery] .o-input::placeholder{color:#6b7280}',
    '[data-origens-discovery] .o-input:focus{border-color:' + OLIVE + ';box-shadow:0 0 0 2px ' + OLIVE + '}',
    '[data-origens-discovery] .o-list{margin:8px 0 0;padding:0}',
    '[data-origens-discovery] .o-list[hidden]{display:none}',
    '[data-origens-discovery] .o-item{display:flex;flex-direction:column;justify-content:center;gap:1px;min-height:44px;padding:8px 12px;border-radius:8px;color:#111827;text-decoration:none;cursor:pointer}',
    '[data-origens-discovery] .o-item[aria-selected="true"],[data-origens-discovery] .o-item:hover{background:#e9e6d6}',
    '[data-origens-discovery] .o-item:focus-visible{outline:2px solid ' + OLIVE + ';outline-offset:-2px}',
    '[data-origens-discovery] .o-name{font-size:14px;font-weight:600;line-height:1.3}',
    '[data-origens-discovery] .o-sub{font-size:12px;line-height:1.3;color:#4b5563}',
    '[data-origens-discovery] .o-status{min-height:0;margin:8px 0 0;font-size:13px;line-height:1.4;color:#4b5563}',
    '[data-origens-discovery] .o-status:empty{display:none}',
    '[data-origens-discovery] .o-cta{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:12px;padding:8px 12px;border:1px solid ' + OLIVE + ';border-radius:8px;background:transparent;color:' + OLIVE + ';font-size:14px;font-weight:500;line-height:20px;text-decoration:none}',
    '[data-origens-discovery] .o-cta:hover{background:' + OLIVE + ';color:#fff}',
    '[data-origens-discovery] .o-cta:focus-visible{outline:2px solid ' + OLIVE + ';outline-offset:2px}',
    '[data-origens-discovery="cart"]{margin:12px 16px 16px;padding:12px 14px;background:#f6f4ec}',
    '[data-origens-discovery="cart"] .o-title{font-size:15px}',
    '[data-origens-discovery="cart"] .o-lead{margin:2px 0 10px;font-size:12px}',
    '[data-origens-discovery] .o-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '[data-origens-discovery] .o-actions>*{flex:1 1 140px;margin-top:0}',
    '[data-origens-discovery] .o-toggle{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 12px;border:1px solid #9ca3af;border-radius:8px;background:#fff;color:#111827;font-size:14px;font-weight:500;line-height:20px;cursor:pointer}',
    '[data-origens-discovery] .o-toggle[hidden]{display:none}',
    '[data-origens-discovery] .o-toggle:focus-visible,[data-origens-discovery] .o-close:focus-visible{outline:2px solid ' + OLIVE + ';outline-offset:2px}',
    '[data-origens-discovery] .o-panel{margin-top:10px}',
    '[data-origens-discovery] .o-panel[hidden]{display:none}',
    '[data-origens-discovery] .o-close{display:block;margin:8px 0 0 auto;min-height:44px;padding:8px 12px;border:0;background:transparent;color:' + OLIVE + ';font-size:13px;font-weight:500;text-decoration:underline;cursor:pointer}',
    '[data-origens-discovery="cart"].o-dense{margin:8px 12px;padding:8px 12px}',
    '[data-origens-discovery="cart"].o-dense .o-lead{display:none}',
    '[data-origens-discovery="cart"].o-dense .o-title{position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:767px){[data-origens-discovery]{margin:12px 0 0;padding:14px}[data-origens-discovery="cart"]{margin:12px 12px 12px}[data-origens-discovery] .o-cta{min-height:48px}}',
    '@media (max-height:700px){[data-origens-discovery="cart"] .o-lead{display:none}[data-origens-discovery="cart"]{padding:10px 12px}}',
    '@media (max-height:700px){[data-origens-discovery].o-has-results .o-eyebrow,[data-origens-discovery].o-has-results .o-lead{display:none}[data-origens-discovery].o-has-results .o-status{position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip:rect(0 0 0 0)}}',
    '@media (prefers-reduced-motion:reduce){[data-origens-discovery] *{transition:none!important;animation:none!important}}'
  ].join('');

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // Aceita só links para o storefront (mesma origem fixa, caminhos /sul[/uf[/slug]]), sem credenciais, query nem fragmento.
  function safeHref(href) {
    try {
      const url = new URL(href);
      if (url.origin !== rt.storefront || url.username || url.password || url.search || url.hash) return null;
      return SAFE_HREF.test(url.pathname) ? url.href : null;
    } catch (_) { return null; }
  }

  // Aceita só o formato conhecido; qualquer outra coisa é descartada. O teto de resultados é imposto aqui também.
  function validate(data, max) {
    if (!data || !Array.isArray(data.results)) return null;
    const out = [];
    for (const item of data.results) {
      if (out.length >= max) break;
      if (!item || (item.type !== 'city' && item.type !== 'state') || typeof item.name !== 'string' || item.name.length > 60 || typeof item.uf !== 'string' || !/^[A-Z]{2}$/.test(item.uf)) continue;
      const href = typeof item.href === 'string' ? safeHref(item.href) : null;
      if (!href) continue;
      out.push({ type: item.type, name: item.name, uf: item.uf, meso: typeof item.meso === 'string' && item.meso.length <= 80 ? item.meso : '', href: href });
    }
    return out;
  }

  function sanitizeQuery(value) {
    return value.replace(/[^\p{L}\p{M}\p{N} .,'’\-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  function icon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'o-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
    const circle = document.createElementNS(ns, 'circle'); circle.setAttribute('cx', '11'); circle.setAttribute('cy', '11'); circle.setAttribute('r', '7');
    const line = document.createElementNS(ns, 'path'); line.setAttribute('d', 'M20 20l-3.5-3.5');
    svg.appendChild(circle); svg.appendChild(line);
    return svg;
  }

  function setStatus(s, text) { if (s.status) s.status.textContent = text; }

  // O bottom sheet da INK (pós-adição) cresce com o conteúdo e pode empurrar "Ver carrinho" para fora do topo em telas baixas.
  // Depois de renderizar resultados, esconde linhas do fim até o botão nativo caber (mínimo 1 linha). Só no pós-adição:
  // no carrinho o bloco vive na área rolável e não afeta o "Finalizar compra".
  function fit(s) {
    if (!s || s.kind !== 'post-add' || !s.wrapper) return;
    const ver = s.wrapper.querySelector('.checkout-btn');
    if (!ver) return;
    const rows = [...s.list.children];
    rows.forEach((row) => { row.hidden = false; });
    let visible = rows.length;
    while (visible > 1 && ver.getBoundingClientRect().top < 0) { visible--; rows[visible].hidden = true; }
  }

  function renderResults(s, results) {
    if (instances[s.kind] !== s) return;
    s.results = results;
    s.active = -1;
    s.list.textContent = '';
    results.forEach((r, i) => {
      const a = el('a', 'o-item');
      a.href = r.href; a.id = s.uid + '-opt-' + i; a.setAttribute('role', 'option'); a.setAttribute('aria-selected', 'false');
      a.appendChild(el('span', 'o-name', r.name));
      a.appendChild(el('span', 'o-sub', r.type === 'state' ? 'Ver as cidades do estado' : (r.meso ? r.uf + ' · ' + r.meso : r.uf)));
      a.addEventListener('mouseenter', () => setActive(s, i));
      s.list.appendChild(a);
    });
    const open = results.length > 0;
    s.root.classList.toggle('o-has-results', open);
    s.list.hidden = !open;
    s.input.setAttribute('aria-expanded', open ? 'true' : 'false');
    s.input.removeAttribute('aria-activedescendant');
    if (open) { setActive(s, 0); fit(s); }
  }

  function setActive(s, index) {
    if (!s.results.length) return;
    const shown = [...s.list.children].filter((node) => !node.hidden).length || s.results.length;
    s.active = (index + shown) % shown;
    [...s.list.children].forEach((node, i) => node.setAttribute('aria-selected', i === s.active ? 'true' : 'false'));
    s.input.setAttribute('aria-activedescendant', s.uid + '-opt-' + s.active);
  }

  async function runSearch(s, query) {
    if (instances[s.kind] !== s || !rt.allowed()) return;
    if (s.abort) s.abort.abort();
    const seq = ++s.seq;
    const controller = new AbortController();
    s.abort = controller;
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    setStatus(s, 'Buscando…');
    try {
      // Mesma origem, sem credenciais: o gateway não recebe Cookie nem Authorization do visitante.
      const response = await fetch(SEARCH_ENDPOINT + '?q=' + encodeURIComponent(query), { signal: controller.signal, credentials: 'omit', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('status ' + response.status);
      const results = validate(await response.json(), MAX_RESULTS[s.kind]);
      if (results === null) throw new Error('schema');
      if (instances[s.kind] !== s || seq !== s.seq || !rt.allowed()) return; // resposta atrasada/obsoleta é descartada
      renderResults(s, results);
      setStatus(s, results.length ? results.length + (results.length === 1 ? ' resultado.' : ' resultados.') : 'Ainda não encontramos essa cidade. Tente o nome completo ou explore todas as camisetas.');
    } catch (_) {
      if (instances[s.kind] !== s || seq !== s.seq) return;
      renderResults(s, []);
      setStatus(s, 'A busca não está disponível agora. Você ainda pode explorar todas as camisetas.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function onInput(s) {
    clearTimeout(s.timer);
    const query = sanitizeQuery(s.input.value);
    if (query.length < MIN_CHARS) {
      if (s.abort) s.abort.abort();
      s.seq++;
      renderResults(s, []);
      setStatus(s, '');
      return;
    }
    s.timer = setTimeout(() => runSearch(s, query), DEBOUNCE_MS);
  }

  function onKeydown(s, event) {
    if (event.key === 'ArrowDown') { if (s.results.length) { event.preventDefault(); setActive(s, s.active + 1); } }
    else if (event.key === 'ArrowUp') { if (s.results.length) { event.preventDefault(); setActive(s, s.active - 1); } }
    else if (event.key === 'Enter') {
      // Aciona o próprio link do resultado (navegação normal do navegador), em vez de navegar por script.
      const link = s.list.children[s.active < 0 ? 0 : s.active];
      if (link) { event.preventDefault(); link.click(); }
    }
    // Esc NÃO é tratado: a INK fecha o próprio drawer nesse atalho (fase anterior à nossa) e o bloco sai junto.
  }

  // Campo + lista + status (compartilhado pelas duas variantes).
  function buildSearch(uid) {
    const field = el('div', 'o-field');
    const label = el('label', null, 'Buscar cidade ou estado');
    label.setAttribute('for', uid + '-input');
    label.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    const input = el('input', 'o-input');
    input.id = uid + '-input'; input.type = 'text'; input.maxLength = 40; input.placeholder = 'Busque cidade ou estado';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', uid + '-list');
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'none'); input.setAttribute('spellcheck', 'false');
    input.setAttribute('inputmode', 'search'); input.setAttribute('enterkeyhint', 'go');
    field.appendChild(label); field.appendChild(icon()); field.appendChild(input);
    const list = el('div', 'o-list'); list.id = uid + '-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Resultados da busca'); list.hidden = true;
    const status = el('p', 'o-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    return { field, input, list, status };
  }

  function build(kind, uid) {
    const root = el('section');
    root.setAttribute('data-origens-discovery', kind);
    root.setAttribute('aria-labelledby', uid + '-title');
    const parts = { root, input: null, list: null, status: null, panel: null, toggle: null, close: null };
    if (kind === 'post-add') {
      root.appendChild(el('p', 'o-eyebrow', 'Continue descobrindo o Sul'));
      const title = el('h4', 'o-title', 'Qual é a próxima cidade?'); title.id = uid + '-title'; root.appendChild(title);
      root.appendChild(el('p', 'o-lead', 'Seu carrinho continua salvo enquanto você procura.'));
      if (SEARCH) { const b = buildSearch(uid); Object.assign(parts, b); root.appendChild(b.field); root.appendChild(b.list); root.appendChild(b.status); }
      const cta = el('a', 'o-cta', 'Explorar outras camisetas'); cta.href = STOREFRONT; root.appendChild(cta);
      return parts;
    }
    // Carrinho: COMPACTO. Recolhido = título + 2 ações; a busca só aparece quando o visitante toca em "Buscar cidade ou estado".
    const title = el('h4', 'o-title', 'Procurar outra cidade'); title.id = uid + '-title'; root.appendChild(title);
    root.appendChild(el('p', 'o-lead', 'Continue escolhendo sem perder seu carrinho.'));
    const actions = el('div', 'o-actions');
    if (SEARCH) {
      const toggle = el('button', 'o-toggle', 'Buscar cidade ou estado');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', uid + '-panel');
      actions.appendChild(toggle); parts.toggle = toggle;
    }
    const cta = el('a', 'o-cta', 'Explorar vitrine'); cta.href = STOREFRONT; actions.appendChild(cta);
    root.appendChild(actions);
    if (SEARCH) {
      const panel = el('div', 'o-panel'); panel.id = uid + '-panel'; panel.hidden = true;
      const b = buildSearch(uid); Object.assign(parts, b);
      const close = el('button', 'o-close', 'Fechar busca'); close.type = 'button';
      panel.appendChild(b.field); panel.appendChild(b.list); panel.appendChild(b.status); panel.appendChild(close);
      root.appendChild(panel); parts.panel = panel; parts.close = close;
    }
    return parts;
  }

  function unmountKind(kind) {
    const s = instances[kind];
    if (!s) return;
    delete instances[kind];
    clearTimeout(s.timer);
    if (s.abort) s.abort.abort();
    s.ac.abort();
    if (s.root && s.root.parentNode) s.root.remove();
    if (s.slot && s.slot.parentNode) s.slot.remove();
    if (!Object.keys(instances).length && s.style && s.style.parentNode) s.style.remove();
  }

  function ensureStyle() {
    let style = document.querySelector('style[data-origens-discovery-style]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-origens-discovery-style', '');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    return style;
  }

  function collapse(s) {
    if (!s.panel) return;
    if (s.abort) s.abort.abort();
    s.seq++;
    s.input.value = '';
    renderResults(s, []);
    setStatus(s, '');
    s.panel.hidden = true;
    s.toggle.hidden = false;
    s.toggle.setAttribute('aria-expanded', 'false');
  }

  function mountKind(kind, place) {
    if (!rt.allowed()) return false;
    unmountKind(kind); // remonta limpo se o drawer foi trocado pela INK; nunca duplica
    const uid = 'origens-' + Math.random().toString(36).slice(2, 8);
    const parts = build(kind, uid);
    const placed = place(parts.root); // devolve o contêiner extra criado (slot) ou true
    if (!placed) return false; // sem âncora segura: o drawer nativo fica como está
    const ac = new AbortController();
    const s = { kind: kind, wrapper: null, slot: placed === true ? null : placed, root: parts.root, style: ensureStyle(), ac: ac, timer: null, abort: null, seq: 0, results: [], active: -1, uid: uid, input: parts.input, list: parts.list, status: parts.status, panel: parts.panel, toggle: parts.toggle };
    instances[kind] = s;
    if (SEARCH) {
      window.addEventListener('resize', () => fit(s), { signal: ac.signal });
      parts.input.addEventListener('input', () => onInput(s), { signal: ac.signal });
      parts.input.addEventListener('keydown', (event) => onKeydown(s, event), { signal: ac.signal });
      // Em telas pequenas o teclado cobre o campo: garante que ele fique visível dentro do painel rolável da INK.
      parts.input.addEventListener('focus', () => { try { parts.input.scrollIntoView({ block: 'nearest' }); } catch (_) { /* ignora */ } }, { signal: ac.signal });
      if (kind === 'cart') {
        parts.toggle.addEventListener('click', () => {
          parts.panel.hidden = false; parts.toggle.hidden = true; parts.toggle.setAttribute('aria-expanded', 'true');
          parts.input.focus(); // ação do próprio visitante (toque no botão): foco no campo é esperado
        }, { signal: ac.signal });
        parts.close.addEventListener('click', () => { collapse(s); parts.toggle.focus(); }, { signal: ac.signal });
        // Selecionar um resultado leva ao storefront; ao voltar (bfcache) o painel reabre limpo.
        window.addEventListener('pageshow', () => collapse(s), { signal: ac.signal });
      }
    }
    rt.onTeardown(() => unmountKind(kind));
    return s;
  }

  // ---- pós-adição: dentro de #modal-wrapper, entre os botões nativos e "As mais vendidas"
  function mount(ctx) {
    if (!POSTADD || !ctx || !ctx.wrapper) return;
    const wrapper = ctx.wrapper;
    const footer = wrapper.querySelector('.add-product-modal__modal-content__footer');
    const mostSold = wrapper.querySelector('#most_sold_frame');
    if (!footer && !mostSold) return;
    const s = mountKind('post-add', (root) => { if (footer) footer.insertAdjacentElement('afterend', root); else mostSold.insertAdjacentElement('beforebegin', root); return true; });
    if (s) s.wrapper = wrapper;
  }
  function unmount() { unmountKind('post-add'); }

  // ---- carrinho: dentro da área ROLÁVEL (.cart-drawer__main) ou do estado vazio (.empty-cart); nunca no rodapé
  function mountCart(ctx) {
    if (!CART || !ctx || !ctx.drawer) return;
    const main = ctx.drawer.querySelector('.cart-drawer__main');
    const empty = ctx.drawer.querySelector('.empty-cart');
    if (!main && !empty) return;
    mountKind('cart', (root) => {
      if (main) {
        // .cart-drawer__main é um flex em LINHA (overflow auto) cujo único filho é o <ul> em coluna: um irmão do <ul> o espremeria
        // (o item do carrinho perderia largura/preço). Por isso o bloco vai DENTRO do <ul>, como último item de largura total.
        const list = main.querySelector('ul');
        if (!list) return false;
        const slot = document.createElement('li');
        slot.setAttribute('role', 'none');
        slot.setAttribute('data-origens-slot', '');
        slot.style.cssText = 'flex:0 0 auto;list-style:none;margin:0;padding:0;width:100%';
        slot.appendChild(root);
        // Poucos itens: o bloco fica no FIM da lista (abaixo dos itens). 3 ou mais: no TOPO e em versão densa, senão ficaria
        // centenas de pixels abaixo da dobra (medido: 8 linhas = ~940 px). Em ambos os casos vive na área rolável, nunca no rodapé.
        if (list.querySelectorAll('li.main-list__item').length >= 3) { list.insertBefore(slot, list.firstChild); root.classList.add('o-dense'); }
        else list.appendChild(slot);
        return slot;
      }
      const sold = empty.querySelector('#most_sold_frame');
      if (sold) sold.insertAdjacentElement('beforebegin', root); else empty.insertAdjacentElement('afterbegin', root);
      return true;
    });
  }
  function unmountCart() { unmountKind('cart'); }

  const api = { unmount: unmount };
  if (POSTADD) api.mount = mount;
  if (CART) { api.mountCart = mountCart; api.unmountCart = unmountCart; }
  window.__useOrigensDiscovery = Object.freeze(api);
})();`;

export function buildDiscoverySource({ search = false, postAdd = true, cart = false } = {}) {
  return DISCOVERY_TEMPLATE
    .replace('__SEARCH__', () => (search ? 'true' : 'false'))
    .replace('__POSTADD__', () => (postAdd ? 'true' : 'false'))
    .replace('__CART__', () => (cart ? 'true' : 'false'));
}
