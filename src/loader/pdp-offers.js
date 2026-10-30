// pdp-cep e pdp-coupons: o prazo de entrega e os cupons da página de produto à vista, sem os modais da INK. Cada um atrás da SUA flag
// (WIDGET_FEATURES). Os dois só reapresentam o que a INK já faz e já mostra: a data vem do formulário de CEP da própria INK e os cupons vêm do
// frame de cupons dela. Nada é inventado (preço de frete a INK não informa aqui; nem a gente). Falhou algo ou a marcação não é a esperada? O bloco
// nativo fica como está. Strings String.raw: nada de crase nem "${" aqui dentro (o bundle é concatenado e não é um template).

// pdp-cep: "Calcule o prazo de entrega" (um link que abre um modal com o campo) vira o campo na própria página: CEP + "Calcular", e o prazo aparece logo
// abaixo. O cálculo é o da INK: o CEP vai pelo formulário EXTERNO da INK (#delivery-estimates-form, com o product_id), num envio que o Turbo dela
// atende igual ao modal (resposta turbo-stream: carrinho, conteúdo do modal e #remaining_delivery_time). Conferido na INK real em 26/10/2026:
//   · CEP atendido: chegam os streams "cart", "delivery-estimates-content-modal-frame" (o "CEP 01001-000 - Sé, São Paulo") e "remaining_delivery_time"
//     ("Entrega entre <span>…</span>." / "Entrega até <span>…</span>." + "Comprando dentro das próximas <span>…</span>"); o modal continua fechado;
//   · CEP sem entrega (ex. 00000-000): SÓ o stream "cart", com o erro "Não temos transportadora disponível…" (o carrinho não abre);
//   · o resultado é lido DESTE envio (streams entre o envio e logo depois do turbo:submit-end), nunca comparando o texto da página: um CEP inválido
//     depois de um válido deixaria o texto antigo.
// O envio é um evento "submit" sintético: o Turbo da INK o assume (preventDefault) e busca com fetch; sem Turbo, um evento sintético não navega —
// a página nunca troca de URL. O nosso campo fica num <form> NOSSO (criado pelo DOM): Enter nele nunca envia o formulário de compra, que é ancestral
// do frame do prazo. O nativo (estimativa, prazo, link do modal) só some com o NOSSO bloco dentro do frame (CSS :has) e volta quando ele sai.
export const PDP_CEP = String.raw`
  const CEP_STYLE_ID = 'o-cep-style';
  const CEP_FRAME = 'turbo-frame#delivery_estimates_frame';
  const CEP_FORM_ID = 'delivery-estimates-form';
  // Busca de CEP dos Correios (nova aba): para quem não sabe o próprio CEP.
  const CEP_FINDER = 'https://buscacepinter.correios.com.br/app/endereco/index.php';
  const CEP_KEY = 'origens:cep';
  const CEP_GRACE_MS = 2000;   // depois do submit-end, espera pelos streams (chegam ~2 ms depois)
  const CEP_TIMEOUT_MS = 15000;
  const CEP_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.5 6h11v10h-11zM13.5 9h4l3.5 3.5V16h-7.5"/><circle cx="6.5" cy="17.5" r="1.75" fill="#fff"/><circle cx="17" cy="17.5" r="1.75" fill="#fff"/></svg>';
  const CEP_CSS = [
    '.o-cep{--o-cep-ink:var(--o-ink,#1f2328);--o-cep-soft:var(--o-ink-soft,#3f3f3a);--o-cep-line:var(--o-line-soft,rgba(31,35,40,.16));--o-cep-field:var(--o-line,#b3b3b0);',
    '--o-cep-paper:var(--o-paper,#f4f4f2);--o-cep-surface:var(--o-surface,#fff);--o-cep-radius:var(--o-radius,8px);--o-cep-action:var(--o-action,#1f2328);--o-cep-on-action:var(--o-on-action,#fff);',
    'display:block;box-sizing:border-box;width:100%;margin:0;padding:14px 16px 12px;border:1px solid var(--o-cep-line);border-radius:var(--o-cep-radius);background:var(--o-cep-paper);',
    'color:var(--o-cep-ink);font-family:var(--o-font,inherit);text-align:left}',
    '.o-cep *{box-sizing:border-box}',
    '.o-cep [hidden]{display:none!important}',
    '.o-cep-head{display:flex;align-items:center;gap:8px;min-height:28px}',
    '.o-cep-icon{display:inline-flex;flex:none;color:var(--o-cep-ink)}',
    '.o-cep-icon svg circle{fill:var(--o-cep-paper)}',
    '.o-cep-title{margin:0;font-size:15px;font-weight:600;line-height:1.3}',
    '.o-cep-change{margin:-8px 0 -8px auto;min-height:44px;padding:0 2px;border:0;background:none;color:var(--o-cep-ink);font:inherit;font-size:14px;font-weight:600;',
    'text-decoration:underline;text-underline-offset:4px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.o-cep-form{display:flex;gap:8px;margin:10px 0 0}',
    '.o-cep-label{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.o-cep-input{flex:1 1 auto;min-width:0;height:48px;margin:0;padding:0 14px;border:1px solid var(--o-cep-field);border-radius:var(--o-cep-radius);background:var(--o-cep-surface);',
    'color:var(--o-cep-ink);font:inherit;font-size:16px;letter-spacing:.02em;box-shadow:none;-webkit-appearance:none;appearance:none}',
    '.o-cep-input::placeholder{color:var(--o-cep-soft);opacity:.8;letter-spacing:0}',
    '.o-cep-input:focus{border-color:var(--o-cep-ink);outline:2px solid var(--o-cep-ink);outline-offset:-1px}',
    '.o-cep-input[aria-invalid="true"]{border-color:var(--o-error,#b42318)}',
    '.o-cep-go{flex:none;height:48px;margin:0;padding:0 20px;border:2px solid var(--o-cep-action);border-radius:var(--o-cep-radius);background:var(--o-cep-action);color:var(--o-cep-on-action);',
    'font:inherit;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '@media (hover:hover){.o-cep-go:not([disabled]):hover{background:transparent;color:var(--o-cep-action)}}',
    '.o-cep-go:focus-visible,.o-cep-change:focus-visible,.o-cep-finder:focus-visible{outline:2px solid var(--o-cep-ink);outline-offset:2px}',
    '.o-cep-go[disabled]{opacity:.65;cursor:progress}',
    '.o-cep-finder{display:inline-flex;align-items:center;min-height:36px;margin-top:2px;color:var(--o-cep-soft);font-size:13px;text-decoration:underline;text-underline-offset:3px}',
    '.o-cep-hint{margin:0 0 4px;color:var(--o-cep-soft);font-size:14px;line-height:1.4}',
    '.o-cep-out{margin-top:8px}',
    '.o-cep-out:empty{display:none}',
    '.o-cep-where{margin:0 0 4px;color:var(--o-cep-soft);font-size:13px;line-height:1.4}',
    '.o-cep-when{margin:0;color:var(--o-cep-ink);font-size:15px;line-height:1.45}',
    '.o-cep-when strong{font-weight:600}',
    '.o-cep-cut{margin:2px 0 0;color:var(--o-cep-soft);font-size:14px;line-height:1.45}',
    '.o-cep-cut b{color:var(--o-ok,#1f6f43);font-weight:600}',
    '.o-cep-msg{margin:0;color:var(--o-error,#b42318);font-size:14px;line-height:1.4}',
    // O nativo só some com o NOSSO bloco dentro do frame (:has): o modal (fixo, escondido) continua no DOM e os streams da INK seguem atualizando os nós.
    CEP_FRAME + ':has(> .o-cep) :is(#cheapest-estimate,#remaining_delivery_time,#cheapest-estimate-button){display:none!important}',
    CEP_FRAME + ':has(> .o-cep){display:block}'
  ].join('');

  const cepDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 8);
  const cepFormat = (digits) => (digits.length > 5 ? digits.slice(0, 5) + '-' + digits.slice(5) : digits);
  const cepTidy = (text) => String(text || '').replace(/\s+/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
  function cepRecall() {
    try { const value = window.sessionStorage.getItem(CEP_KEY) || ''; return /^\d{5}-\d{3}$/.test(value) ? value : ''; } catch (_) { return ''; }
  }
  function cepRemember(value) { try { window.sessionStorage.setItem(CEP_KEY, value); } catch (_) { /* sem armazenamento: só não preenche na próxima */ } }
  function cepEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  // "Entrega entre <span>Sexta, 30 de Outubro e Sábado, 31 de Outubro</span>." + "Comprando dentro das próximas <span>1 hora e 41 minutos.</span>"
  // -> { lead, dates, cutLead, cut }. Marcação diferente: o texto inteiro, arrumado, em lead.
  function cepReadWhen(root) {
    const ps = root.querySelectorAll('p');
    if (!ps.length) { const text = cepTidy(root.textContent); return text ? { lead: text, dates: '', cutLead: '', cut: '' } : null; }
    const split = (p) => {
      const span = p.querySelector('span');
      if (!span) return { lead: cepTidy(p.textContent), inner: '' };
      const copy = p.cloneNode(true); copy.querySelector('span').remove();
      return { lead: cepTidy(copy.textContent).replace(/[.\s]+$/, ''), inner: cepTidy(span.textContent).replace(/[.\s]+$/, '') };
    };
    const main = split(ps[0]);
    if (!main.lead && !main.inner) return null;
    const cut = ps[1] ? split(ps[1]) : { lead: '', inner: '' };
    return { lead: main.lead, dates: main.inner.toLowerCase(), cutLead: cut.lead, cut: cut.inner };
  }
  // "CEP 01001-000 - Sé, São Paulo" (valor do campo desabilitado do modal) -> "Sé, São Paulo".
  function cepReadPlace(root) {
    const input = root.querySelector('input[name="postal_code"]');
    const match = /^CEP\s*\d{5}-?\d{3}\s*-\s*(.+)$/.exec(cepTidy(input && input.value));
    return match ? match[1] : '';
  }

  function cepEnsureStyle() {
    if (document.getElementById(CEP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CEP_STYLE_ID;
    style.textContent = CEP_CSS;
    document.head.appendChild(style);
  }

  function cepBuild(widget) {
    const block = cepEl('div', 'o-cep');
    block.setAttribute('role', 'group');
    block.setAttribute('aria-labelledby', 'o-cep-title');
    const head = cepEl('div', 'o-cep-head');
    const icon = cepEl('span', 'o-cep-icon'); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = CEP_ICON;
    const title = cepEl('p', 'o-cep-title', 'Prazo de entrega'); title.id = 'o-cep-title';
    const change = cepEl('button', 'o-cep-change', 'Alterar CEP'); change.type = 'button'; change.hidden = true;
    head.append(icon, title, change);
    const hint = cepEl('p', 'o-cep-hint'); hint.hidden = true;
    const form = cepEl('form', 'o-cep-form');
    form.noValidate = true;
    const label = cepEl('label', 'o-cep-label', 'CEP'); label.htmlFor = 'o-cep-input';
    const input = cepEl('input', 'o-cep-input');
    input.id = 'o-cep-input'; input.type = 'text'; input.name = 'o_cep'; input.inputMode = 'numeric'; input.autocomplete = 'postal-code';
    input.maxLength = 9; input.placeholder = 'Digite seu CEP'; input.setAttribute('enterkeyhint', 'go'); input.setAttribute('aria-describedby', 'o-cep-out');
    input.value = cepRecall();
    const go = cepEl('button', 'o-cep-go', 'Calcular'); go.type = 'submit';
    form.append(label, input, go);
    const finder = cepEl('a', 'o-cep-finder', 'Não sei meu CEP');
    finder.href = CEP_FINDER; finder.target = '_blank'; finder.rel = 'noopener noreferrer';
    const out = cepEl('div', 'o-cep-out'); out.id = 'o-cep-out';
    out.setAttribute('role', 'status'); out.setAttribute('aria-live', 'polite');
    block.append(head, hint, form, finder, out);

    const signal = widget.ac.signal;
    input.addEventListener('input', () => {
      const digits = cepDigits(input.value);
      const next = cepFormat(digits);
      if (input.value !== next) input.value = next;
      input.removeAttribute('aria-invalid');
    }, { signal });
    // O <form> é NOSSO: o envio dele nunca sobe para o formulário de compra (ancestral) nem para o Turbo.
    form.addEventListener('submit', (event) => { event.preventDefault(); event.stopPropagation(); cepCalc(widget, block, input.value); }, { signal });
    change.addEventListener('click', () => { cepShowForm(block); input.focus(); try { input.select(); } catch (_) { /* ignora */ } }, { signal });
    finder.addEventListener('click', () => pdpTrack('origens_cep_finder', {}), { signal });
    return block;
  }

  const cepParts = (block) => ({
    form: block.querySelector('.o-cep-form'), input: block.querySelector('.o-cep-input'), go: block.querySelector('.o-cep-go'), out: block.querySelector('.o-cep-out'),
    hint: block.querySelector('.o-cep-hint'), finder: block.querySelector('.o-cep-finder'), change: block.querySelector('.o-cep-change')
  });
  function cepShowForm(block) {
    const p = cepParts(block);
    p.form.hidden = false; p.finder.hidden = false; p.change.hidden = true;
    p.out.replaceChildren();
    block.removeAttribute('data-state');
  }
  // Mostra o prazo: CEP e lugar, a data (o trecho em negrito, como a INK) e o "comprando dentro de"; o campo recolhe atrás de "Alterar CEP".
  function cepShowResult(block, cep, place, when) {
    const p = cepParts(block);
    const where = cepEl('p', 'o-cep-where', 'CEP ' + cep + (place ? ' · ' + place : ''));
    const main = cepEl('p', 'o-cep-when', when.lead + (when.dates ? ' ' : ''));
    if (when.dates) main.appendChild(cepEl('strong', '', when.dates));
    const nodes = [where, main];
    if (when.cutLead || when.cut) {
      const cut = cepEl('p', 'o-cep-cut', when.cutLead + (when.cut ? ' ' : ''));
      if (when.cut) { cut.appendChild(cepEl('b', '', when.cut)); cut.appendChild(document.createTextNode('.')); }
      nodes.push(cut);
    }
    p.out.replaceChildren(...nodes);
    p.form.hidden = true; p.finder.hidden = true; p.hint.hidden = true; p.change.hidden = false;
    block.setAttribute('data-state', 'done');
  }
  function cepSay(block, text) {
    const p = cepParts(block);
    p.out.replaceChildren(cepEl('p', 'o-cep-msg', text));
    p.input.setAttribute('aria-invalid', 'true');
  }
  function cepBusy(block, on) {
    const p = cepParts(block);
    p.go.disabled = on;
    p.go.textContent = on ? 'Calculando…' : 'Calcular';
    if (on) block.setAttribute('aria-busy', 'true'); else block.removeAttribute('aria-busy');
  }

  // Um cálculo: o CEP vai num campo escondido TEMPORÁRIO do formulário externo da INK (o Turbo monta o pedido na hora do envio e o campo sai em seguida).
  function cepCalc(widget, block, value) {
    const digits = cepDigits(value);
    if (digits.length !== 8) { cepSay(block, 'Digite os 8 números do CEP.'); return; }
    if (widget.job) return;
    const nativeForm = document.getElementById(CEP_FORM_ID);
    if (!nativeForm || !window.Turbo) { cepSay(block, 'O cálculo não está disponível agora. Tente de novo em instantes.'); return; }
    const cep = cepFormat(digits);
    const job = { cep, place: '', when: null, problem: '', ac: new AbortController(), timers: [] };
    widget.job = job;
    cepBusy(block, true);
    const finish = (outcome) => {
      if (widget.job !== job) return;
      widget.job = null;
      job.ac.abort(); for (const t of job.timers) clearTimeout(t);
      if (!block.isConnected) return;
      cepBusy(block, false);
      if (outcome === 'ok' && job.when) {
        cepRemember(cep);
        cepShowResult(block, cep, job.place, job.when);
        pdpTrack('origens_cep_calc', { result: 'ok' });
      } else if (outcome === 'not_found') {
        cepSay(block, 'Não há entrega disponível para esse CEP. Confira os números ou tente outro.');
        pdpTrack('origens_cep_calc', { result: 'not_found' });
      } else {
        cepSay(block, 'Não foi possível calcular agora. Tente de novo em instantes.');
        pdpTrack('origens_cep_calc', { result: 'error' });
      }
    };
    const settle = () => finish(job.when ? 'ok' : (job.problem ? 'not_found' : 'error'));
    const opts = { signal: job.ac.signal };
    // Os streams de uma resposta entram juntos na página (o evento sai na hora, antes de a INK aplicar): lê o conteúdo de cada um e fecha no tick seguinte.
    document.addEventListener('turbo:before-stream-render', (event) => {
      const stream = event.target;
      const template = stream && stream.querySelector ? stream.querySelector('template') : null;
      const content = template && template.content;
      if (!content) return;
      const target = stream.getAttribute('target');
      if (target === 'remaining_delivery_time') job.when = cepReadWhen(content);
      else if (target === 'delivery-estimates-content-modal-frame') job.place = cepReadPlace(content) || job.place;
      else if (target === 'cart') { const err = content.querySelector('[data-ink-store--cart-target="cartErrors"]'); if (err && cepTidy(err.textContent)) job.problem = cepTidy(err.textContent); }
      else return;
      job.timers.push(setTimeout(() => { if (job.when || job.problem) settle(); }, 0));
    }, opts);
    nativeForm.addEventListener('turbo:submit-end', (event) => {
      if (!event.detail || event.detail.success !== true) { finish('error'); return; }
      job.timers.push(setTimeout(settle, CEP_GRACE_MS));
    }, opts);
    job.timers.push(setTimeout(() => finish('error'), CEP_TIMEOUT_MS));
    const field = document.createElement('input');
    field.type = 'hidden'; field.name = 'postal_code'; field.value = cep;
    // Na marcação inicial da INK o campo do modal também pertence ao formulário externo (atributo form) e iria VAZIO junto: fica de fora só durante o
    // envio (o pedido é montado na hora do evento) e volta em seguida, intacto.
    const others = Array.from(nativeForm.elements).filter((el) => el.name === 'postal_code' && !el.disabled);
    let taken = false;
    try {
      for (const el of others) el.disabled = true;
      nativeForm.appendChild(field);
      const submit = typeof SubmitEvent === 'function' ? new SubmitEvent('submit', { bubbles: true, cancelable: true }) : new Event('submit', { bubbles: true, cancelable: true });
      nativeForm.dispatchEvent(submit);
      taken = submit.defaultPrevented; // o Turbo da INK assumiu o envio
    } catch (_) { taken = false; } finally { field.remove(); for (const el of others) el.disabled = false; }
    if (!taken) finish('error');
  }

  // Prazo já calculado nesta página (o nativo foi atualizado e o nosso bloco foi refeito): mostra o mesmo, sem novo pedido.
  function cepFromPage(block, frame) {
    const remaining = frame.querySelector('#remaining_delivery_time');
    const field = frame.querySelector('#delivery-estimates-content-modal-frame input[name="postal_code"]');
    if (!remaining || !cepTidy(remaining.textContent) || !field || !field.disabled) return false;
    const match = /^CEP\s*(\d{5}-?\d{3})/.exec(cepTidy(field.value));
    const when = cepReadWhen(remaining);
    if (!match || !when) return false;
    cepShowResult(block, cepFormat(cepDigits(match[1])), cepReadPlace(frame.querySelector('#delivery-estimates-content-modal-frame') || frame), when);
    return true;
  }

  register({
    id: 'pdp-cep',
    ac: null,
    job: null,

    // Barato e idempotente (roda a cada tick do observer): só escreve quando o frame do prazo está pronto e ainda sem o nosso bloco.
    mount() {
      if (!this.ac) {
        this.ac = new AbortController();
        // Frame do prazo recarregado pela INK (o nosso bloco sai junto): refaz no mesmo instante, sem piscar o link nativo.
        document.addEventListener('turbo:frame-render', (event) => { if (event.target && event.target.id === 'delivery_estimates_frame' && allowedNow()) this.place(); }, { signal: this.ac.signal });
      }
      this.place();
    },

    place() {
      if (!window.Turbo || !document.getElementById(CEP_FORM_ID)) return;
      const frame = document.querySelector(CEP_FRAME);
      if (!frame || !frame.closest('form[id^="form-product-"]') || frame.hasAttribute('busy') || frame.getAttribute('aria-busy') === 'true') return;
      if (!frame.querySelector('#cheapest-estimate-button')) return; // marcação inesperada: o nativo fica como está
      if (frame.querySelector(':scope > .o-cep')) return;
      cepEnsureStyle();
      const block = cepBuild(this);
      const hint = cepTidy((frame.querySelector('#cheapest-estimate') || {}).textContent);
      if (hint) { const p = cepParts(block); p.hint.textContent = hint + '. Informe o CEP para o prazo exato.'; p.hint.hidden = false; }
      frame.prepend(block);
      cepFromPage(block, frame);
    },

    unmount() {
      if (this.job) { this.job.ac.abort(); for (const t of this.job.timers) clearTimeout(t); this.job = null; }
      if (this.ac) { this.ac.abort(); this.ac = null; }
      for (const block of document.querySelectorAll('.o-cep')) block.remove();
      const style = document.getElementById(CEP_STYLE_ID);
      if (style) style.remove();
    }
  });
`;

// pdp-coupons: o quadro "Cupom · Ver cupons disponíveis" (que abre um modal) vira abas, uma por código (o desenho do oria-worker, com o tema da
// Use Origens): o que o cupom dá, quanto economiza nesta peça, as faixas do progressivo e "Copiar". Os dados são os do frame de cupons da própria
// INK (#product_promotions_frame) — o modal oficial continua no DOM, só não é mais o caminho. Com o preço na página, as abas sobem para logo
// abaixo dele, fechadas atrás de "Cupons disponíveis" (perto do preço, sem ocupar espaço): o frame, preguiçoso e lá embaixo, é pedido já, e o
// quadro nativo some. Sem o preço, as abas ficam à vista dentro do frame, como antes.
// Só copia: quem valida e aplica o cupom é a INK, no carrinho. Nunca diz que o desconto foi aplicado.
export const PDP_COUPONS = String.raw`
  const CPN_STYLE_ID = 'o-cpn-style';
  const CPN_FRAME = 'turbo-frame#product_promotions_frame';
  const CPN_PRICE = '[data-ink-labs-anchor="product_price"]';
  const CPN_MOVED = 'data-o-cpn-moved';
  const CPN_CHEV = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="m4 6 4 4 4-4"/></svg>';
  const CPN_TAG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1 2.5A1.5 1.5 0 0 1 2.5 1h4.09a1.5 1.5 0 0 1 1.06.44l7 7a1.5 1.5 0 0 1 0 2.12l-4.09 4.09a1.5 1.5 0 0 1-2.12 0l-7-7A1.5 1.5 0 0 1 1 6.59V2.5Zm3.5 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/></svg>';
  const CPN_CSS = [
    '.o-cpn{--o-cpn-ink:var(--o-ink,#1f2328);--o-cpn-soft:var(--o-ink-soft,#3f3f3a);--o-cpn-mute:var(--o-ink-mute,#5f5f58);--o-cpn-line:var(--o-line-soft,rgba(31,35,40,.16));',
    '--o-cpn-paper:var(--o-paper,#f4f4f2);--o-cpn-surface:var(--o-surface,#fff);--o-cpn-radius:var(--o-radius,8px);',
    // A cor principal da loja (--o-selected do tema) num tom suave, como o fundo do escolhido no tema; sem tema, um neutro. Sem color-mix, o cinza acima.
    '--o-cpn-paper:color-mix(in srgb,var(--o-selected,#1f2328) 20%,var(--o-surface,#fff));--o-cpn-line:color-mix(in srgb,var(--o-selected,#1f2328) 40%,var(--o-surface,#fff));',
    'display:block;box-sizing:border-box;width:100%;margin:0;color:var(--o-cpn-ink);font-family:var(--o-font,inherit);text-align:left;container-type:inline-size}',
    '.o-cpn *{box-sizing:border-box}',
    '.o-cpn [hidden],.o-cpn[hidden]{display:none!important}',
    '.o-cpn-ttl{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:15px;font-weight:600;line-height:1.3}',
    '.o-cpn-tabs{position:relative;z-index:1;display:flex;gap:6px;margin:0 0 -1px;padding:0;overflow-x:auto;scrollbar-width:none}',
    '.o-cpn-tabs::-webkit-scrollbar{display:none}',
    '.o-cpn-tabs[data-more]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}',
    '.o-cpn-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:44px;margin:0;padding:0 14px;border:1px solid var(--o-cpn-line);',
    'border-radius:var(--o-cpn-radius) var(--o-cpn-radius) 0 0;background:var(--o-cpn-surface);color:var(--o-cpn-mute);font:inherit;font-size:13px;font-weight:700;',
    'letter-spacing:.04em;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.o-cpn-tab:is([aria-selected="true"],[data-current]){border-bottom-color:var(--o-cpn-paper);background:var(--o-cpn-paper);color:var(--o-cpn-ink);cursor:default}',
    'span.o-cpn-tab{cursor:default}',
    '.o-cpn-tab:focus-visible{outline:2px solid var(--o-cpn-ink);outline-offset:-3px}',
    '@media (hover:hover){button.o-cpn-tab[aria-selected="false"]:hover{color:var(--o-cpn-ink)}}',
    '.o-cpn-panel{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid var(--o-cpn-line);',
    'border-radius:0 var(--o-cpn-radius) var(--o-cpn-radius) var(--o-cpn-radius);background:var(--o-cpn-paper)}',
    '.o-cpn-txt{min-width:0}',
    '.o-cpn-main{margin:0;font-size:15px;font-weight:600;line-height:1.35}',
    '.o-cpn-save{margin:2px 0 0;color:var(--o-cpn-soft);font-size:14px;line-height:1.4}',
    '.o-cpn-tiers{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}',
    '.o-cpn-tiers li{margin:0;padding:6px 9px;border:1px solid var(--o-cpn-line);border-radius:var(--o-cpn-radius);background:var(--o-cpn-surface);font-size:13px;line-height:1.2;white-space:nowrap}',
    '.o-cpn-tiers b{font-weight:700}',
    '.o-cpn-rules{margin:8px 0 0;color:var(--o-cpn-mute);font-size:13px;line-height:1.4}',
    '.o-cpn-copy{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;margin:0;padding:0 18px;border:1px solid var(--o-cpn-ink);',
    'border-radius:var(--o-cpn-radius);background:var(--o-cpn-surface);color:var(--o-cpn-ink);font:inherit;font-size:13px;font-weight:700;letter-spacing:.06em;',
    'text-transform:uppercase;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.o-cpn-copy[data-done]{background:var(--o-cpn-ink);color:var(--o-cpn-surface)}',
    '.o-cpn-copy:focus-visible{outline:2px solid var(--o-cpn-ink);outline-offset:2px}',
    '.o-cpn-status{margin:8px 0 0;color:var(--o-cpn-soft);font-size:13px;line-height:1.4}',
    '.o-cpn-status:empty{display:none}',
    '.o-cpn-note{margin:8px 0 0;color:var(--o-cpn-mute);font-size:13px;line-height:1.4}',
    '@container (max-width:420px){.o-cpn-panel{flex-direction:column;align-items:stretch;gap:12px}.o-cpn-copy{width:100%}.o-cpn-tab{padding:0 10px}}',
    // Perto do preço: o botão que abre e fecha as abas (fora de .o-cpn, por isso as variáveis do tema direto).
    '.o-cpn-near{display:block;box-sizing:border-box;width:100%;margin:0;font-family:var(--o-font,inherit);text-align:left}',
    '.o-cpn-toggle{display:inline-flex;align-items:center;gap:8px;min-height:44px;margin:0;padding:0 14px;border:1px solid var(--o-line-soft,rgba(31,35,40,.16));',
    'border-color:color-mix(in srgb,var(--o-selected,#1f2328) 40%,var(--o-surface,#fff));border-radius:var(--o-radius,8px);background:var(--o-paper,#f4f4f2);',
    'background:color-mix(in srgb,var(--o-selected,#1f2328) 20%,var(--o-surface,#fff));color:var(--o-ink,#1f2328);font:inherit;font-size:14px;font-weight:600;line-height:1.2;',
    'cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.o-cpn-toggle > span{display:inline-flex;align-items:center}',
    '.o-cpn-toggle > span:first-child,.o-cpn-tab > span:first-child{color:var(--o-selected,currentColor)}',
    // O contador na cor cheia, com o texto que o tema garante legível sobre ela (contraste conferido em theme.js).
    '.o-cpn-count{justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--o-selected,#1f2328);color:var(--o-on-selected,#fff);',
    'font-size:12px;font-weight:700}',
    '.o-cpn-chev{transition:transform .2s ease}',
    '.o-cpn-toggle[aria-expanded="true"] .o-cpn-chev{transform:rotate(180deg)}',
    '.o-cpn-toggle:focus-visible{outline:2px solid var(--o-ink,#1f2328);outline-offset:2px}',
    '@media (hover:hover){.o-cpn-toggle:hover{border-color:var(--o-selected,#1f2328)}}',
    '@media (prefers-reduced-motion:reduce){.o-cpn-chev{transition:none}}',
    '.o-cpn-near > .o-cpn{margin-top:10px}',
    // O quadro nativo só some com o NOSSO bloco no lugar (dentro do frame, :has, ou perto do preço, a marca no frame); o modal oficial continua no DOM.
    CPN_FRAME + ':has(> .o-cpn) > div.border,' + CPN_FRAME + '[' + CPN_MOVED + '] > div.border{display:none!important}',
    CPN_FRAME + ':has(> .o-cpn){display:block}'
  ].join('');

  const cpnTidy = (text) => String(text || '').replace(/\s+/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
  const cpnMoney = (text) => cpnTidy(text).replace(/R\$\s?/g, 'R$ ').replace(/,00(?=\D|$)/g, '');
  function cpnEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  // Cupons do frame da INK (marcação conferida em 26/10/2026): cada cartão div.border tem o código no input escondido do controlador de cópia,
  // "Você economiza …" num span e as regras em ul > li (o progressivo traz as faixas numa lista interna).
  function cpnParse(frame) {
    const out = [];
    for (const input of frame.querySelectorAll('[data-controller~="ink-store--clipboard"] input[type="hidden"]')) {
      const code = cpnTidy(input.getAttribute('value'));
      const card = input.closest('div.border');
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(code) || !card || out.some((c) => c.code === code)) continue;
      const savings = Array.from(card.querySelectorAll(':scope > span')).map((el) => cpnTidy(el.textContent)).find((t) => /economiza/i.test(t)) || '';
      const rules = [];
      const tiers = [];
      for (const li of card.querySelectorAll(':scope > ul > li')) {
        const own = cpnTidy(Array.from(li.childNodes).filter((n) => !(n.nodeType === 1 && n.tagName === 'UL')).map((n) => n.textContent || '').join(' '));
        if (own) rules.push(own);
        for (const sub of li.querySelectorAll(':scope > ul > li')) {
          const text = cpnTidy(sub.textContent);
          const tier = /^(\d+)\s*(itens?|peças?)\s*-\s*(.+)$/i.exec(text);
          if (tier) tiers.push({ qty: tier[1] + ' ' + tier[2].toLowerCase(), off: cpnMoney(tier[3]) }); else if (text) rules.push(text);
        }
      }
      const offRule = rules.find((r) => /OFF/i.test(r)) || '';
      const off = offRule ? offRule.replace(/^.*?(R\$\s?[\d.,]+|\d+\s?%)\s*OFF.*$/i, '$1 OFF') : '';
      // "Primeira compra" só quando a INK escreve a regra (o nome do código não basta: nada é deduzido).
      const first = rules.some((r) => /primeira compra/i.test(r));
      out.push({ code, savings: cpnMoney(savings), tiers, off: off ? cpnMoney(off) : '', first, rules: rules.filter((r) => r !== offRule && !/^promoção progressiva$/i.test(r) && !/primeira compra/i.test(r)) });
    }
    return out;
  }
  // "10% OFF" -> "10% de desconto"; o progressivo pelo que ele é; sem valor legível, o próprio código.
  const cpnOff = (off) => off.replace(/\s*OFF$/i, ' de desconto');
  const cpnTitle = (c) => (c.tiers.length ? 'Leve mais, pague menos' : c.off ? cpnOff(c.off) + (c.first ? ' na primeira compra' : '') : c.first ? 'Desconto na primeira compra' : 'Cupom ' + c.code);

  async function cpnCopy(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* tenta o caminho antigo */ }
    try {
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(area); area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return !!ok;
    } catch (_) { return false; }
  }

  function cpnEnsureStyle() {
    if (document.getElementById(CPN_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CPN_STYLE_ID;
    style.textContent = CPN_CSS;
    document.head.appendChild(style);
  }

  // labelId: quem dá nome ao bloco — o título dele ('o-cpn-ttl', dentro do frame) ou o botão "Cupons disponíveis" (perto do preço, sem título).
  function cpnBuild(widget, coupons, labelId) {
    const signal = widget.ac.signal;
    const multi = coupons.length > 1;
    const block = cpnEl('section', 'o-cpn');
    block.setAttribute('aria-labelledby', labelId);
    const title = labelId === 'o-cpn-ttl' ? cpnEl('p', 'o-cpn-ttl', multi ? 'Cupons para esta peça' : 'Cupom para esta peça') : null;
    if (title) title.id = 'o-cpn-ttl';
    const status = cpnEl('p', 'o-cpn-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const strip = cpnEl('div', 'o-cpn-tabs');
    if (multi) { strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-labelledby', labelId); }
    const tabs = [];
    const panels = [];
    coupons.forEach((c, i) => {
      const tab = cpnEl(multi ? 'button' : 'span', 'o-cpn-tab');
      const icon = cpnEl('span', ''); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = CPN_TAG;
      tab.append(icon, cpnEl('span', 'o-cpn-code', c.code));
      if (multi) {
        tab.type = 'button'; tab.id = 'o-cpn-tab-' + i;
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'o-cpn-panel-' + i);
        tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false'); tab.tabIndex = i === 0 ? 0 : -1;
      } else tab.setAttribute('data-current', ''); // um cupom só: rótulo, não aba (sem papel de aba, sem aria-selected)
      tabs.push(tab);
      const panel = cpnEl('div', 'o-cpn-panel');
      if (multi) { panel.id = 'o-cpn-panel-' + i; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'o-cpn-tab-' + i); panel.tabIndex = 0; }
      panel.hidden = i !== 0;
      const txt = cpnEl('div', 'o-cpn-txt');
      txt.appendChild(cpnEl('p', 'o-cpn-main', cpnTitle(c)));
      if (c.savings) txt.appendChild(cpnEl('p', 'o-cpn-save', c.savings));
      if (c.tiers.length) {
        const list = cpnEl('ul', 'o-cpn-tiers');
        for (const t of c.tiers) { const li = cpnEl('li', ''); li.append(cpnEl('b', '', t.qty), document.createTextNode(': ' + t.off)); list.appendChild(li); }
        txt.appendChild(list);
      }
      if (c.rules.length) txt.appendChild(cpnEl('p', 'o-cpn-rules', c.rules.join(' · ')));
      const copy = cpnEl('button', 'o-cpn-copy', 'Copiar'); copy.type = 'button';
      copy.setAttribute('aria-label', 'Copiar o código ' + c.code);
      let reset = null;
      copy.addEventListener('click', async () => {
        const ok = await cpnCopy(c.code);
        if (!block.isConnected) return;
        clearTimeout(reset);
        if (ok) {
          copy.textContent = 'Copiado'; copy.setAttribute('data-done', '');
          status.textContent = 'Código ' + c.code + ' copiado. Cole no campo de cupom do carrinho.';
          reset = setTimeout(() => { copy.textContent = 'Copiar'; copy.removeAttribute('data-done'); }, 2500);
          widget.timers.push(reset);
          pdpTrack('origens_coupon_copy', { coupon: c.code });
        } else {
          status.textContent = 'Não deu para copiar sozinho. O código é ' + c.code + ': selecione e copie.';
          try { const range = document.createRange(); range.selectNodeContents(tabs[i].querySelector('.o-cpn-code')); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch (_) { /* ignora */ }
        }
      }, { signal });
      panel.append(txt, copy);
      panels.push(panel);
    });
    if (multi) {
      const select = (i, focus) => {
        tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; panels[j].hidden = i !== j; });
        status.textContent = '';
        if (focus) tabs[i].focus();
        try { tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) { /* ignora */ }
      };
      tabs.forEach((t, i) => {
        t.addEventListener('click', () => select(i, false), { signal });
        t.addEventListener('keydown', (event) => {
          const n = tabs.length;
          const to = event.key === 'ArrowRight' ? (i + 1) % n : event.key === 'ArrowLeft' ? (i - 1 + n) % n : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : -1;
          if (to < 0) return;
          event.preventDefault();
          select(to, true);
        }, { signal });
      });
      // Abas que não cabem: rolagem lateral, com esmaecido na borda enquanto houver mais à direita.
      const more = () => strip.toggleAttribute('data-more', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
      strip.addEventListener('scroll', more, { signal, passive: true });
      window.addEventListener('resize', more, { signal, passive: true });
      block.addEventListener('o-cpn-open', more, { signal }); // fechado, as abas não têm largura: mede de novo ao abrir
      widget.timers.push(setTimeout(more, 0));
    }
    strip.append(...tabs);
    if (title) block.appendChild(title);
    block.append(strip, ...panels, status, cpnEl('p', 'o-cpn-note', 'Um cupom por compra. A loja confere as condições no carrinho.'));
    return block;
  }

  // Abaixo do preço: "Cupons disponíveis" abre e fecha as mesmas abas (começa fechado; volta aberto se a INK refizer o frame com ele aberto).
  function cpnNear(widget, coupons, open) {
    const near = cpnEl('div', 'o-cpn-near');
    const toggle = cpnEl('button', 'o-cpn-toggle'); toggle.type = 'button'; toggle.id = 'o-cpn-toggle';
    toggle.setAttribute('aria-controls', 'o-cpn-box');
    const icon = cpnEl('span', ''); icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = CPN_TAG;
    toggle.append(icon, cpnEl('span', 'o-cpn-label', coupons.length > 1 ? 'Cupons disponíveis' : 'Cupom disponível'));
    if (coupons.length > 1) toggle.appendChild(cpnEl('span', 'o-cpn-count', String(coupons.length)));
    const chev = cpnEl('span', 'o-cpn-chev'); chev.setAttribute('aria-hidden', 'true'); chev.innerHTML = CPN_CHEV;
    toggle.appendChild(chev);
    const box = cpnBuild(widget, coupons, 'o-cpn-toggle'); box.id = 'o-cpn-box';
    const show = (on) => { box.hidden = !on; toggle.setAttribute('aria-expanded', String(on)); if (on) box.dispatchEvent(new CustomEvent('o-cpn-open')); };
    show(!!open);
    toggle.addEventListener('click', () => {
      const opening = box.hidden;
      show(opening);
      if (opening) pdpTrack('origens_coupon_open', { coupons: coupons.length });
    }, { signal: widget.ac.signal });
    near.append(toggle, box);
    return near;
  }

  register({
    id: 'pdp-coupons',
    ac: null,
    timers: [],

    mount() {
      if (!this.ac) {
        this.ac = new AbortController();
        // Quando a INK carrega (ou refaz) o frame, monta no mesmo instante (sem piscar o quadro nativo) e com os cupons novos.
        document.addEventListener('turbo:frame-render', (event) => {
          if (!event.target || event.target.id !== 'product_promotions_frame' || !allowedNow()) return;
          const open = !!document.querySelector('.o-cpn-toggle[aria-expanded="true"]');
          this.clearNear();
          this.place(open);
        }, { signal: this.ac.signal });
      }
      this.place(false);
    },

    place(open) {
      const frame = document.querySelector(CPN_FRAME);
      const form = frame && frame.closest('form[id^="form-product-"]');
      if (!form) return;
      const price = form.querySelector(CPN_PRICE);
      // Perto do preço o frame tem de vir já: a INK só o carrega quando ele chega perto da tela, e ele fica lá embaixo. "eager" faz a própria
      // INK (Turbo) pedir o mesmo endereço que pediria ao rolar.
      if (price && frame.getAttribute('loading') === 'lazy' && frame.getAttribute('src')) frame.setAttribute('loading', 'eager');
      if (frame.hasAttribute('busy') || frame.getAttribute('aria-busy') === 'true' || !frame.querySelector(':scope > div.border')) return;
      if (price ? form.querySelector('.o-cpn-near') : frame.querySelector(':scope > .o-cpn')) return;
      const coupons = cpnParse(frame);
      if (!coupons.length) return; // sem cupom legível: o quadro nativo fica
      cpnEnsureStyle();
      if (!price) { frame.appendChild(cpnBuild(this, coupons, 'o-cpn-ttl')); return; }
      price.after(cpnNear(this, coupons, open));
      frame.setAttribute(CPN_MOVED, '');
    },

    clearNear() {
      for (const near of document.querySelectorAll('.o-cpn-near')) near.remove();
      for (const frame of document.querySelectorAll('[' + CPN_MOVED + ']')) frame.removeAttribute(CPN_MOVED);
    },

    unmount() {
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      if (this.ac) { this.ac.abort(); this.ac = null; }
      this.clearNear();
      for (const block of document.querySelectorAll('.o-cpn')) block.remove();
      const style = document.getElementById(CPN_STYLE_ID);
      if (style) style.remove();
    }
  });
`;
