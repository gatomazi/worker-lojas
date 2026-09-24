// discovery.js (sob demanda): bloco "Qual é a próxima cidade?" dentro do drawer pós-adição + busca real.
// Regras: nada de innerHTML com dados externos (só textContent/atributos), links validados, CSS sob raiz exclusiva
// [data-origens-discovery], sem fontes/imagens externas, sem polling, sem cookies/armazenamento, tudo abortável.
// __SEARCH__ é true/false (feature city-search): sem busca o bloco mostra só o retorno à vitrine.
export const DISCOVERY_TEMPLATE = String.raw`(() => {
  'use strict';
  const rt = window.__useOrigens;
  if (!rt || window.__useOrigensDiscovery) return;

  const SEARCH = __SEARCH__;
  const STOREFRONT = rt.storefront + '/sul';
  const SEARCH_ENDPOINT = '/__origens/search';
  const OLIVE = '#4d543d';
  const MAX_RESULTS = 5;
  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 200;
  const TIMEOUT_MS = 4000;
  const SAFE_HREF = /^\/sul(?:\/[a-z]{2}(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)?$/;

  let state = null; // { root, style, ac, timer, seq, results, active }

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
    '@media (max-width:767px){[data-origens-discovery]{margin:12px 0 0;padding:14px}[data-origens-discovery] .o-cta{min-height:48px}}',
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

  // Aceita só o formato conhecido; qualquer outra coisa é descartada. Máximo de resultados imposto aqui também.
  function validate(data) {
    if (!data || !Array.isArray(data.results)) return null;
    const out = [];
    for (const item of data.results) {
      if (out.length >= MAX_RESULTS) break;
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

  // O bottom sheet da INK cresce com o conteúdo e pode empurrar "Ver carrinho" para fora do topo em telas baixas.
  // Depois de renderizar resultados, esconde linhas do fim até o botão nativo caber (mínimo 1 linha). Sem efeito se já cabe.
  function fit() {
    const s = state;
    if (!s || !s.wrapper) return;
    const ver = s.wrapper.querySelector('.checkout-btn');
    if (!ver) return;
    const rows = [...s.list.children];
    rows.forEach((row) => { row.hidden = false; });
    let visible = rows.length;
    while (visible > 1 && ver.getBoundingClientRect().top < 0) { visible--; rows[visible].hidden = true; }
  }

  function setStatus(text) { if (state) state.status.textContent = text; }

  function renderResults(results) {
    const s = state;
    if (!s) return;
    s.results = results;
    s.active = -1;
    s.list.textContent = '';
    results.forEach((r, i) => {
      const a = el('a', 'o-item');
      a.href = r.href; a.id = s.uid + '-opt-' + i; a.setAttribute('role', 'option'); a.setAttribute('aria-selected', 'false');
      a.appendChild(el('span', 'o-name', r.name));
      a.appendChild(el('span', 'o-sub', r.type === 'state' ? 'Ver as cidades do estado' : (r.meso ? r.uf + ' · ' + r.meso : r.uf)));
      a.addEventListener('mouseenter', () => setActive(i));
      s.list.appendChild(a);
    });
    const open = results.length > 0;
    s.root.classList.toggle('o-has-results', open);
    s.list.hidden = !open;
    s.input.setAttribute('aria-expanded', open ? 'true' : 'false');
    s.input.removeAttribute('aria-activedescendant');
    if (open) { setActive(0); fit(); }
  }

  function setActive(index) {
    const s = state;
    if (!s || !s.results.length) return;
    const shown = [...s.list.children].filter((node) => !node.hidden).length || s.results.length;
    s.active = (index + shown) % shown;
    [...s.list.children].forEach((node, i) => node.setAttribute('aria-selected', i === s.active ? 'true' : 'false'));
    s.input.setAttribute('aria-activedescendant', s.uid + '-opt-' + s.active);
  }

  async function runSearch(query) {
    const s = state;
    if (!s || !rt.allowed()) return;
    if (s.abort) s.abort.abort();
    const seq = ++s.seq;
    const controller = new AbortController();
    s.abort = controller;
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    setStatus('Buscando…');
    try {
      // Mesma origem, sem credenciais: o gateway não recebe Cookie nem Authorization do visitante.
      const response = await fetch(SEARCH_ENDPOINT + '?q=' + encodeURIComponent(query), { signal: controller.signal, credentials: 'omit', headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('status ' + response.status);
      const results = validate(await response.json());
      if (results === null) throw new Error('schema');
      if (!state || seq !== state.seq || !rt.allowed()) return; // resposta atrasada/obsoleta é descartada
      renderResults(results);
      setStatus(results.length ? results.length + (results.length === 1 ? ' resultado.' : ' resultados.') : 'Ainda não encontramos essa cidade. Tente o nome completo ou explore todas as camisetas.');
    } catch (_) {
      if (!state || seq !== state.seq) return;
      renderResults([]);
      setStatus('A busca não está disponível agora. Você ainda pode explorar todas as camisetas.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function onInput() {
    const s = state;
    if (!s) return;
    clearTimeout(s.timer);
    const query = sanitizeQuery(s.input.value);
    if (query.length < MIN_CHARS) {
      if (s.abort) s.abort.abort();
      s.seq++;
      renderResults([]);
      setStatus('');
      return;
    }
    s.timer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  }

  function onKeydown(event) {
    const s = state;
    if (!s) return;
    if (event.key === 'ArrowDown') { if (s.results.length) { event.preventDefault(); setActive(s.active + 1); } }
    else if (event.key === 'ArrowUp') { if (s.results.length) { event.preventDefault(); setActive(s.active - 1); } }
    else if (event.key === 'Enter') {
      // Aciona o próprio link do resultado (navegação normal do navegador), em vez de navegar por script.
      const link = s.list.children[s.active < 0 ? 0 : s.active];
      if (link) { event.preventDefault(); link.click(); }
    }
    // Esc NÃO é tratado: a INK fecha o próprio drawer nesse atalho (fase anterior à nossa) e o bloco sai junto.
  }

  function build(uid) {
    const root = el('section');
    root.setAttribute('data-origens-discovery', '');
    root.setAttribute('aria-labelledby', uid + '-title');
    root.appendChild(el('p', 'o-eyebrow', 'Continue descobrindo o Sul'));
    const title = el('h4', 'o-title', 'Qual é a próxima cidade?');
    title.id = uid + '-title';
    root.appendChild(title);
    root.appendChild(el('p', 'o-lead', 'Seu carrinho continua salvo enquanto você procura.'));
    let input = null, list = null, status = null;
    if (SEARCH) {
      const field = el('div', 'o-field');
      const label = el('label', null, 'Buscar cidade ou estado');
      label.setAttribute('for', uid + '-input');
      label.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
      input = el('input', 'o-input');
      input.id = uid + '-input'; input.type = 'text'; input.maxLength = 40; input.placeholder = 'Busque cidade ou estado';
      input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', uid + '-list');
      input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'none'); input.setAttribute('spellcheck', 'false');
      input.setAttribute('inputmode', 'search'); input.setAttribute('enterkeyhint', 'go');
      field.appendChild(label); field.appendChild(icon()); field.appendChild(input);
      list = el('div', 'o-list'); list.id = uid + '-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Resultados da busca'); list.hidden = true;
      status = el('p', 'o-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      root.appendChild(field); root.appendChild(list); root.appendChild(status);
    }
    const cta = el('a', 'o-cta', 'Explorar outras camisetas');
    cta.href = STOREFRONT;
    root.appendChild(cta);
    return { root, input, list, status };
  }

  function unmount() {
    const s = state;
    if (!s) return;
    state = null;
    clearTimeout(s.timer);
    if (s.abort) s.abort.abort();
    s.ac.abort();
    if (s.root && s.root.parentNode) s.root.remove();
    if (s.style && s.style.parentNode) s.style.remove();
  }

  function mount(ctx) {
    if (!rt.allowed() || !ctx || !ctx.wrapper) return;
    unmount(); // remonta limpo se o drawer foi trocado pela INK; nunca duplica
    const wrapper = ctx.wrapper;
    // Âncora: logo depois dos botões nativos (Ver carrinho / Continuar comprando), antes de "As mais vendidas".
    const footer = wrapper.querySelector('.add-product-modal__modal-content__footer');
    const mostSold = wrapper.querySelector('#most_sold_frame');
    if (!footer && !mostSold) return; // sem âncora segura: o drawer nativo fica como está
    const uid = 'origens-' + Math.random().toString(36).slice(2, 8);
    const parts = build(uid);
    const style = document.createElement('style');
    style.setAttribute('data-origens-discovery-style', '');
    style.textContent = CSS;
    document.head.appendChild(style);
    if (footer) footer.insertAdjacentElement('afterend', parts.root); else mostSold.insertAdjacentElement('beforebegin', parts.root);
    const ac = new AbortController();
    state = { wrapper: wrapper, root: parts.root, style: style, ac: ac, timer: null, abort: null, seq: 0, results: [], active: -1, uid: uid, input: parts.input, list: parts.list, status: parts.status };
    if (SEARCH) {
      window.addEventListener('resize', fit, { signal: ac.signal });
      parts.input.addEventListener('input', onInput, { signal: ac.signal });
      parts.input.addEventListener('keydown', onKeydown, { signal: ac.signal });
      // Em telas pequenas o teclado cobre o campo: garante que ele fique visível dentro do bottom sheet da INK.
      parts.input.addEventListener('focus', () => { try { parts.input.scrollIntoView({ block: 'nearest' }); } catch (_) { /* ignora */ } }, { signal: ac.signal });
    }
    rt.onTeardown(unmount);
  }

  window.__useOrigensDiscovery = Object.freeze({ mount: mount, unmount: unmount });
})();`;

export function buildDiscoverySource({ search = false } = {}) {
  return DISCOVERY_TEMPLATE.replace('__SEARCH__', () => (search ? 'true' : 'false'));
}
