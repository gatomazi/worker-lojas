// post-add-kit: "Monte seu kit" no modal "Produto adicionado ao carrinho" da INK (página de produto), o bloco da promoção progressiva escolhida no CMS.
//   Dados:    /__origens/kit (o Worker lê /api/post-add-kit/<região> do storefront, que lê a promoção na API da INK; contrato v1). Buscado uma vez ao montar
//             (para o bloco nascer junto com o modal) e guardado 1 min (sessionStorage), validado de novo aqui. Erro, timeout, JSON inválido ou kit null =>
//             NADA aparece: o modal fica exatamente como a INK desenha.
//   Onde o cliente está: a frase e a trilha de passos dizem quanto ele já ganhou e quanto falta para a próxima faixa ("Você já ganhou R$ 25 OFF · Mais 1
//             peça e o desconto sobe para R$ 50 OFF"). A fonte é a barra da própria INK no carrinho ([data-ink-labs-progressive-discount], shadow root
//             aberto): ela já aplica a elegibilidade da promoção. Sem a barra (ou com números que não batem com as faixas do kit), as peças do carrinho
//             (#quantity-header). Sem nenhuma das duas, o título e o texto do CMS, com a trilha sem destaque. Refeito quando o carrinho da INK atualiza.
//             Antes (até 08/11/2026) eram 4 cartões com de/por/cada/economize por faixa: 16 preços e nenhum "você está aqui".
//   Modal:    o bloco entra ANTES dos botões nativos; "Ver carrinho" vira "Finalizar compra" (o mesmo botão da INK, só o texto do rótulo muda) e ocupa a
//             largura toda: "Continuar comprando" fica escondido enquanto há kit (decisão do dono: a busca logo abaixo já leva a outras estampas, e o × e o
//             clique fora continuam fechando o modal). Ao desmontar, o texto e o botão voltam. No celular o botão fica preso ao pé da folha enquanto se rola,
//             para "Finalizar compra" nunca sair da tela. A busca e "As mais vendidas" continuam abaixo.
//   Copiar:   SÓ copia o código (Clipboard API e, sem ela, execCommand; sem nenhum, o código fica selecionado). Nunca toca no campo de cupom da INK.
// Todo texto vem do CMS ou é montado aqui, e entra só por textContent.
export const POST_ADD_KIT = String.raw`
  const KIT_ENDPOINT = '/__origens/kit';
  const KIT_CACHE_KEY = 'origens:kit:v1';
  const KIT_CACHE_MS = 60 * 1000;
  const KIT_FETCH_MS = 4000;
  const KIT_MAX_TIERS = 6;
  const KIT_CODE = /^[A-Za-z0-9_-]{2,40}$/;
  const KIT_CONTROL = /[\u0000-\u001f\u007f<>]/;
  const KIT_LIMITS = { eyebrow: 40, title: 60, lead: 160 };
  const KIT_LABEL_CHECKOUT = 'Finalizar compra';
  const KIT_NATIVE = '[data-ink-labs-progressive-discount]';

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

  // Hora do último envio de um formulário de compra (o da página, o do "compre junto" ou o do quick add): o mesmo modal reaberto por uma nova adição
  // é refeito. Lida NO ENVIO, antes de a resposta trocar a página ou o quadro do formulário.
  let kitLast = null;
  function kitCapture(target) {
    if (target && target.closest && target.closest('form[id^="form-product-"]')) kitLast = { at: Date.now() };
  }

  const kitMoney = (cents) => { try { return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch (_) { return 'R$ ' + (cents / 100).toFixed(2).replace('.', ','); } };
  const kitOff = (kind, discount) => (kind === 'value' ? kitMoney(Math.round(discount * 100)).replace(/,00$/, '') : String(discount).replace('.', ',') + '%') + ' OFF';
  const kitPieces = (n) => n + (n === 1 ? ' peça' : ' peças');
  const kitStepOff = (kind, discount) => '−' + kitOff(kind, discount).replace(/ OFF$/, '');
  // "R$ 1.234,50" / "25,00" -> 1234.5
  const kitNumber = (text) => Number(String(text).replace(/\./g, '').replace(',', '.'));
  // Só o texto visível (sem o de um <style> dentro do shadow root).
  function kitVisibleText(root) {
    let out = '';
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!(n.parentElement && n.parentElement.closest('style, script'))) out += ' ' + n.nodeValue;
    return out.replace(/\s+/g, ' ').trim();
  }
  // A barra da INK no carrinho: "R$ 25,00 OFF aplicado · adicione 1 peça e sobe para R$ 50,00 OFF" ou "Adicione 1 peça e ganhe R$ 25,00 OFF".
  function kitNative() {
    for (const host of document.querySelectorAll(KIT_NATIVE)) {
      const text = kitVisibleText(host.shadowRoot || host);
      const applied = /R\$\s?([\d.]+(?:,\d{1,2})?)\s*OFF aplicado/i.exec(text);
      const add = /adicione\s+(\d{1,3})\s+peças?/i.exec(text);
      const next = /(?:para|ganhe)\s+R\$\s?([\d.]+(?:,\d{1,2})?)\s*OFF/i.exec(text);
      if (applied || add) return { applied: applied ? kitNumber(applied[1]) : 0, missing: add ? Number(add[1]) : 0, next: next ? kitNumber(next[1]) : null };
    }
    return null;
  }
  // { reached, missing }: reached = índice da última faixa alcançada (-1 = nenhuma); missing = peças até a próxima (0 na última). null = não dá para saber.
  function kitState(kit) {
    const tiers = kit.tiers;
    const native = kit.kind === 'value' ? kitNative() : null;
    if (native) {
      const reached = native.applied ? tiers.findIndex((t) => t.discount === native.applied) : -1;
      const next = tiers[reached + 1];
      const fits = (native.applied === 0 || reached >= 0) && (next ? native.missing >= 1 && native.next === next.discount : native.missing === 0);
      if (fits) return { reached: reached, missing: next ? native.missing : 0 };
    }
    const header = document.querySelector('.cart-drawer #quantity-header[data-quantityheader], #quantity-header[data-quantityheader]');
    const count = header ? Number.parseInt(header.getAttribute('data-quantityheader'), 10) : NaN;
    if (!(count >= 1 && count <= 999)) return null;
    let reached = -1;
    tiers.forEach((t, i) => { if (count >= t.items) reached = i; });
    const next = tiers[reached + 1];
    return { reached: reached, missing: next ? next.items - count : 0 };
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
    '[data-origens-kit]{--k-accent:var(--o-selected,' + KIT_PRIMARY + ');--k-ok:var(--o-ok,#1f6f43);--k-ink:var(--o-ink,#111827);--k-mute:var(--o-ink-mute,#4b5563);--k-line:var(--o-line-soft,rgba(17,24,39,.14));--k-radius:var(--o-radius,8px);--k-surface:var(--o-surface,#fff);box-sizing:border-box;margin:18px 0 16px;font-family:inherit;color:var(--k-ink);text-align:left}',
    '[data-origens-kit] *{box-sizing:border-box;font-family:inherit}',
    '[data-origens-kit] .o-kit-eyebrow{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-size:11px;font-weight:700;line-height:1.3;letter-spacing:.08em;text-transform:uppercase;color:var(--k-accent)}',
    '[data-origens-kit] .o-kit-eyebrow svg{width:14px;height:14px;flex:none}',
    '[data-origens-kit] .o-kit-title{margin:0;font-size:21px;line-height:1.2;font-weight:700;letter-spacing:normal;text-transform:none;color:var(--k-ink)}',
    '[data-origens-kit] .o-kit-lead{margin:4px 0 0;font-size:14px;line-height:1.4;color:var(--k-mute)}',
    '[data-origens-kit] .o-kit-code{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 0}',
    '[data-origens-kit] .o-kit-chip{display:inline-flex;align-items:center;gap:.3em;min-height:40px;padding:6px 12px;border-radius:var(--k-radius);background:color-mix(in srgb,var(--k-accent) 12%,var(--k-surface));color:var(--k-accent);font-size:14px;font-weight:700;line-height:1.2}',
    // "Copiar cupom" é um botão de verdade (borda, ícone), não um texto: a mesma altura do selo do cupom ao lado.
    '[data-origens-kit] .o-kit-copy{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;min-height:40px;margin:0;padding:0 14px;border:1.5px solid var(--k-accent);border-radius:var(--k-radius);background:var(--k-surface);color:var(--k-accent);font-size:14px;font-weight:700;line-height:1.2;letter-spacing:normal;text-transform:none;text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s}',
    '[data-origens-kit] .o-kit-copy svg{width:16px;height:16px;flex:none}',
    '[data-origens-kit] .o-kit-copy:hover,[data-origens-kit] .o-kit-copy[data-copied]{background:var(--k-accent);color:var(--o-on-selected,#fff)}',
    '[data-origens-kit] .o-kit-copy:focus-visible{outline:2px solid var(--k-accent);outline-offset:2px}',
    // Trilha: um passo por faixa, o desconto em destaque e as peças embaixo. Alcançado = barra e número na cor da marca; o próximo = barra clara e
    // número em tinta; os demais apagados. Sem preço por peça: o que decide é quanto falta para o próximo desconto.
    '[data-origens-kit] .o-kit-lead strong{font-weight:700;color:var(--k-ink)}',
    '[data-origens-kit] .o-kit-steps{display:grid;grid-template-columns:repeat(var(--k-n,4),minmax(0,1fr));gap:6px;margin:14px 0 0;padding:0;list-style:none}',
    '[data-origens-kit] .o-kit-step{display:flex;flex-direction:column;gap:1px;min-width:0;margin:0;padding:0}',
    '[data-origens-kit] .o-kit-step > i{display:block;height:6px;margin:0 0 7px;border-radius:3px;background:var(--k-line)}',
    '[data-origens-kit] .o-kit-step > b{font-size:15px;font-weight:600;line-height:1.2;color:var(--k-mute);white-space:nowrap}',
    '[data-origens-kit] .o-kit-step > small{font-size:12px;line-height:1.3;color:var(--k-mute);white-space:nowrap}',
    // Faixa alcançada em verde (o "ok" do tema) com o certo; a próxima enche de verde na proporção das peças que já estão no carrinho.
    '[data-origens-kit] .o-kit-step[data-state="done"] > i{background:var(--k-ok)}',
    '[data-origens-kit] .o-kit-step[data-state="done"] > b{display:flex;align-items:center;gap:3px;font-weight:800;color:var(--k-ok)}',
    '[data-origens-kit] .o-kit-step > b > svg{width:14px;height:14px;flex:none}',
    '[data-origens-kit] .o-kit-step[data-state="done"] > small{color:var(--k-ok)}',
    '[data-origens-kit] .o-kit-step[data-state="next"] > i{background:linear-gradient(90deg,var(--k-ok) var(--k-fill,0%),var(--k-line) var(--k-fill,0%))}',
    '[data-origens-kit] .o-kit-step[data-state="next"] > b{font-weight:800;color:var(--k-ink)}',
    '[data-origens-kit] .o-kit-step[data-state="todo"] > i{background:color-mix(in srgb,var(--k-line) 55%,var(--k-surface))}',
    '[data-origens-kit] .o-kit-auto{display:flex;align-items:center;gap:6px;margin:12px 0 0;font-size:13px;line-height:1.35;color:var(--k-mute)}',
    '[data-origens-kit] .o-kit-auto svg{width:15px;height:15px;flex:none;color:var(--k-ok)}',
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
    // align-items:flex-start: a folha da INK é flex em linha com items-center; com o conteúdo mais alto que ela, o centro empurrava metade da sobra para
    // CIMA, fora do alcance da rolagem (o começo do kit sumia sob o topo fixo, visto num iPhone de verdade; medido: o corpo começava 64 px acima da folha).
    '#modal-wrapper[data-origens-kit-open]{align-items:flex-start!important;overflow-y:auto!important;overscroll-behavior:contain}',
    // Topo e pé de ponta a ponta da folha: o recuo que eles "desfazem" é o MEDIDO no corpo da INK (kitBleed: --k-bl/--k-br/--k-bt/--k-bb, em px), não um
    // número fixo (com 16 px fixos a faixa do topo não chegava à borda direita no modal real, no celular e no desktop).
    // width:auto: o topo da INK vem com w-full (100% do conteúdo), que travava a largura 32 px abaixo da folha mesmo com as margens negativas (medido no
    // modal real: 346 de 378 no celular, 406 de 438 no desktop). Os cantos de cima seguem os da folha (arredondada no celular).
    '#modal-wrapper [data-origens-kit-head]{position:sticky;top:0;z-index:3;width:auto!important;max-width:none!important;align-self:stretch;border-radius:0!important;border-top-left-radius:inherit!important;border-top-right-radius:inherit!important;margin:calc(-1 * var(--k-bt,16px)) calc(-1 * var(--k-br,16px)) 0 calc(-1 * var(--k-bl,16px))!important;padding:max(12px,var(--k-bt,16px)) var(--k-br,16px) 12px var(--k-bl,16px)!important;background:var(--o-surface,#fff);box-shadow:0 1px 0 var(--o-line-soft,rgba(17,24,39,.12))}',
    // O pé vai para o FIM do conteúdo só na exibição (order, num corpo em coluna): preso embaixo do começo ao fim da rolagem, também sobre a busca e
    // "As mais vendidas" (no HTML da INK ele vem antes delas; nada é movido no DOM).
    '#modal-wrapper [data-origens-kit-body]{display:flex!important;flex-direction:column!important}',
    '#modal-wrapper [data-origens-kit-body] > [data-origens-kit-footer]{order:99;position:sticky;bottom:0;z-index:2;width:auto!important;max-width:none!important;align-self:stretch;border-radius:0!important;border-bottom-left-radius:inherit!important;border-bottom-right-radius:inherit!important;margin:auto calc(-1 * var(--k-br,16px)) calc(-1 * var(--k-bb,16px)) calc(-1 * var(--k-bl,16px))!important;padding:10px var(--k-br,16px) calc(10px + env(safe-area-inset-bottom,0px)) var(--k-bl,16px)!important;background:var(--o-surface,#fff);box-shadow:0 -1px 0 var(--o-line-soft,rgba(17,24,39,.12))}',
    // Celular: a folha da INK CRESCE com o conteúdo (sem altura máxima, presa ao pé da tela). Com o kit ela passava da tela e o topo, com o ×, sumia para
    // cima sem volta (visto ao vivo em 28/10/2026). Aqui ela vai no máximo até a altura da tela e rola por dentro (no desktop a gaveta já tem a altura da tela).
    // Altura inteira (sem folga em cima: ela mostrava a faixa preta do topo da INK atrás) e cantos retos no alto (arredondados, deixavam a faixa
    // aparecer nas pontas).
    '@media (max-width:767px){#modal-wrapper[data-origens-kit-open]{max-height:100vh!important;max-height:100dvh!important}' +
      '#modal-wrapper [data-origens-kit-body],#modal-wrapper [data-origens-kit-head]{border-top-left-radius:0!important;border-top-right-radius:0!important}[data-origens-kit]{margin:14px 0 12px}[data-origens-kit] .o-kit-title{font-size:19px}}',
    '@media (max-width:359px){[data-origens-kit] .o-kit-steps{gap:4px}[data-origens-kit] .o-kit-step > b{font-size:14px}[data-origens-kit] .o-kit-step > small{font-size:11px}}'
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
  // Quanto o topo e o pé precisam avançar para encostar nas bordas do PAINEL visível (o primeiro, do corpo para cima, com fundo; no desktop o
  // #modal-wrapper ocupa a tela toda e a gaveta branca é um filho dele), sem passar da área visível da folha (a barra de rolagem fica de fora).
  // Medido, não suposto: o padding da INK não é o mesmo em todo lugar. Sem layout (aba oculta, teste), fica o padrão do CSS.
  const KIT_BLEED = ['--k-bl', '--k-br', '--k-bt', '--k-bb'];
  const kitOpaque = (el) => { const bg = getComputedStyle(el).backgroundColor || ''; return bg !== '' && bg !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(bg); };
  function kitBleed(sheet, body, els) {
    try {
      const px = (v) => parseFloat(v) || 0;
      let panel = body;
      for (let n = body; n && n !== sheet.parentElement; n = n.parentElement) { if (kitOpaque(n)) { panel = n; break; } }
      const s = sheet.getBoundingClientRect(); const p = panel.getBoundingClientRect(); const b = body.getBoundingClientRect();
      if (!(s.width > 0) || !(b.width > 0)) return;
      const ps = getComputedStyle(panel); const bs = getComputedStyle(body);
      const vLeft = s.left + sheet.clientLeft; const vRight = vLeft + sheet.clientWidth;
      const pLeft = Math.max(p.left + px(ps.borderLeftWidth), vLeft); const pRight = Math.min(p.right - px(ps.borderRightWidth), vRight);
      const left = b.left + px(bs.borderLeftWidth) + px(bs.paddingLeft) - pLeft;
      const right = pRight - (b.right - px(bs.borderRightWidth) - px(bs.paddingRight));
      const top = b.top + px(bs.borderTopWidth) + px(bs.paddingTop) - (p.top + px(ps.borderTopWidth));
      const bottom = px(bs.paddingBottom) + px(bs.borderBottomWidth);
      const values = [left, right, top, bottom].map((n) => Math.round(Math.max(0, Math.min(n, 64))) + 'px');
      for (const el of els) if (el) KIT_BLEED.forEach((name, i) => el.style.setProperty(name, values[i]));
    } catch (_) { /* sem medida: o padrão do CSS */ }
  }

  function kitRestore(scope) {
    const root = scope || document;
    for (const el of root.querySelectorAll('[data-origens-kit-head], [data-origens-kit-footer]')) for (const name of KIT_BLEED) el.style.removeProperty(name);
    for (const block of root.querySelectorAll('[data-origens-kit]')) block.remove();
    for (const label of root.querySelectorAll('[data-origens-kit-label]')) { label.textContent = label.getAttribute('data-origens-kit-label'); label.removeAttribute('data-origens-kit-label'); }
    for (const footer of root.querySelectorAll('[data-origens-kit-footer]')) footer.removeAttribute('data-origens-kit-footer');
    for (const head of root.querySelectorAll('[data-origens-kit-head]')) head.removeAttribute('data-origens-kit-head');
    for (const sheet of root.querySelectorAll('[data-origens-kit-open]')) sheet.removeAttribute('data-origens-kit-open');
    for (const body of root.querySelectorAll('[data-origens-kit-body]')) body.removeAttribute('data-origens-kit-body');
  }

  // Certo (o desconto entra sozinho).
  function kitCheckIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', 'm5 12 5 5 9-10');
    svg.appendChild(path);
    return svg;
  }

  // Frase de onde o cliente está + trilha de passos (uma faixa = um passo: o desconto e as peças). Partes em [tipo, texto]; 'b' = destaque.
  function kitCopyFor(kit, st) {
    const tiers = kit.tiers;
    if (!st) return { title: kit.title, sub: [['', kit.lead]] };
    const next = tiers[st.reached + 1];
    if (st.reached < 0) {
      return { title: (st.missing === 1 ? 'Falta ' : 'Faltam ') + kitPieces(st.missing) + ' para ' + kitOff(kit.kind, next.discount),
        sub: [['', kit.auto ? 'O desconto entra sozinho no carrinho.' : 'Use o cupom no carrinho.']] };
    }
    const got = kitOff(kit.kind, tiers[st.reached].discount);
    const title = (kit.auto ? 'Você já ganhou ' : 'Seu kit já vale ') + got;
    if (!next) return { title: title, sub: [['', 'É o maior desconto do kit.']] };
    return { title: title, sub: [['', 'Mais '], ['b', kitPieces(st.missing)], ['', ' e o desconto sobe para '], ['b', kitOff(kit.kind, next.discount)], ['', '.']] };
  }
  // Quanto da próxima faixa as peças do carrinho já cobrem (0–100), contando a partir da faixa alcançada.
  function kitFill(kit, st) {
    const next = kit.tiers[st.reached + 1];
    const from = st.reached >= 0 ? kit.tiers[st.reached].items : 0;
    const span = next.items - from;
    if (!(span > 0)) return 0;
    return Math.round(Math.min(1, Math.max(0, (next.items - st.missing - from) / span)) * 100);
  }
  const kitKey = (st) => (st ? st.reached + ':' + st.missing : '-');
  function kitProgress(kit, st) {
    const box = kitEl('div', { class: 'o-kit-progress', 'data-key': kitKey(st) });
    const copy = kitCopyFor(kit, st);
    box.appendChild(kitEl('h4', { id: 'o-kit-title', class: 'o-kit-title' }, copy.title));
    const sub = kitEl('p', { class: 'o-kit-lead' });
    for (const [kind, text] of copy.sub) sub.appendChild(kind === 'b' ? kitEl('strong', null, text) : document.createTextNode(text));
    box.appendChild(sub);
    const steps = kitEl('ol', { class: 'o-kit-steps', 'aria-label': 'Faixas de desconto' });
    steps.style.setProperty('--k-n', String(kit.tiers.length));
    kit.tiers.forEach((t, i) => {
      const state = !st ? 'todo' : i <= st.reached ? 'done' : i === st.reached + 1 ? 'next' : 'todo';
      const li = kitEl('li', { class: 'o-kit-step', 'data-state': state });
      if (st && i === st.reached) li.setAttribute('aria-current', 'step');
      if (state === 'next') li.style.setProperty('--k-fill', kitFill(kit, st) + '%');
      li.appendChild(kitEl('i', { 'aria-hidden': 'true' }));
      const off = kitEl('b', null, kitStepOff(kit.kind, t.discount));
      if (state === 'done') off.prepend(kitCheckIcon());
      li.appendChild(off);
      li.appendChild(kitEl('small', null, kitPieces(t.items)));
      li.appendChild(kitEl('span', { class: 'o-kit-sr' }, state === 'done' ? ', alcançado' : state === 'next' ? ', próximo' : ''));
      steps.appendChild(li);
    });
    box.appendChild(steps);
    return box;
  }

  function kitBuild(kit, signal) {
    const root = kitEl('section', { 'data-origens-kit': '', 'aria-labelledby': 'o-kit-title' });
    const eyebrow = kitEl('p', { class: 'o-kit-eyebrow' });
    eyebrow.appendChild(kitIcon()); eyebrow.appendChild(document.createTextNode(kit.eyebrow));
    root.appendChild(eyebrow);
    const st = kitState(kit);
    root.appendChild(kitProgress(kit, st));
    root.setAttribute('data-state', st ? 'known' : 'unknown');

    const status = kitEl('span', { class: 'o-kit-sr', role: 'status', 'aria-live': 'polite' });
    if (kit.auto) {
      const auto = kitEl('p', { class: 'o-kit-auto' });
      auto.appendChild(kitCheckIcon()); auto.appendChild(document.createTextNode('Desconto automático, sem cupom'));
      root.appendChild(auto);
    } else {
      const code = kitEl('div', { class: 'o-kit-code' });
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
      root.appendChild(code);
    }
    root.appendChild(status);
    return root;
  }
  // O carrinho da INK mudou (a resposta da adição chegou depois do modal, ou a barra dela terminou de desenhar): refaz só a frase e a trilha.
  function kitRefresh(kit) {
    const root = document.querySelector('#modal-wrapper [data-origens-kit]');
    const box = root && root.querySelector('.o-kit-progress');
    if (!box) return;
    const st = kitState(kit);
    if (box.getAttribute('data-key') === kitKey(st)) return;
    box.replaceWith(kitProgress(kit, st));
    root.setAttribute('data-state', st ? 'known' : 'unknown');
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
        // A hora da adição é lida NO ENVIO (antes da resposta trocar a página ou o quadro do formulário).
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
      // Mesmo modal reaberto por uma nova adição (a INK pode só mostrar de novo os mesmos nós): o bloco é refeito. Senão, só a frase e a trilha
      // acompanham o carrinho.
      if (present && !(kitLast && this.shown && kitLast.at > this.shown.at)) { if (this.shown) kitRefresh(this.shown.kit); return; }
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
        const root = kitBuild(data.kit, this.clicks.signal);
        footer.insertAdjacentElement('beforebegin', root);
        footer.setAttribute('data-origens-kit-footer', '');
        // A folha (o próprio #modal-wrapper), o corpo (o pai dos botões, que vira coluna) e o topo com o × (o pai do botão de fechar), para o CSS.
        current.setAttribute('data-origens-kit-open', '');
        if (footer.parentElement && footer.parentElement !== current) footer.parentElement.setAttribute('data-origens-kit-body', '');
        const close = current.querySelector('#modal-close-button');
        const head = close && close.parentElement && close.parentElement !== current && !close.parentElement.contains(footer) ? close.parentElement : null;
        if (head) head.setAttribute('data-origens-kit-head', '');
        // Mede depois de o CSS (folha limitada, corpo em coluna) valer, e de novo quando a tela muda de tamanho (girar o celular, redimensionar).
        const body = footer.parentElement && footer.parentElement !== current ? footer.parentElement : null;
        if (body) {
          const bleed = () => kitBleed(current, body, [head, footer]);
          requestAnimationFrame(bleed); setTimeout(bleed, 300);
          window.addEventListener('resize', bleed, { signal: this.clicks.signal });
        }
        const checkout = footer.querySelector('.checkout-btn');
        kitRelabel(checkout, KIT_LABEL_CHECKOUT);
        // Só medimos: o clique segue para a INK (abrir o carrinho) exatamente como antes.
        if (checkout) checkout.addEventListener('click', () => kitTrack('kit_checkout_click', data.kit), { signal: this.clicks.signal });
        this.shown = { at: Date.now(), kit: data.kit };
        // A barra da INK (um web component) pode terminar de desenhar depois do modal: confere de novo.
        const shown = this.shown;
        for (const ms of [600, 1500]) setTimeout(() => { if (this.shown === shown) kitRefresh(shown.kit); }, ms);
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
