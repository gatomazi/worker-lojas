#!/usr/bin/env node
// VALIDAÇÃO com resposta REAL da INK nas duas telas do checkout do carrinho de TESTE (tema ligado, Worker local, dados pessoais sanitizados):
// contato/entrega -> pagamento -> Pix -> cartão -> parcelas -> volta à forma original -> "Editar" (volta ao contato). Só o recálculo do desconto
// (POST payment_discount, que não cria pedido nem cobrança) passa; process_payment, contato e entrega continuam ABORTADOS. Nada é salvo além de números.
//   PW_PATH=… node scripts/validacao-checkout.mjs --checkout <uuid de teste> --out <arquivo.json>
import { writeFileSync } from 'node:fs';
import { createHarness } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const UUID = opt('--checkout'); const OUT = opt('--out');
if (!UUID || !OUT) { console.error('uso: --checkout <uuid> --out <arquivo.json>'); process.exit(2); }
const H = await createHarness({ sanitize: true, allowPaymentDiscount: true });
const results = []; const steps = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + String(detail).slice(0, 220) : '')); };
const s = await H.session({ name: 'desktop', width: 1440, height: 900 }); const { page } = s;
const wait = (ms) => page.waitForTimeout(ms);
const money = (t) => { const m = /R\$\s*([\d.]+,\d{2})/.exec(t || ''); return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null; };
// O resumo da INK (rótulo -> valor), o rádio escolhido, as parcelas e o atributo do tema.
const read = () => page.evaluate(() => {
  const rows = {};
  const summary = document.querySelector('turbo-frame#cart_summary') || document;
  // Linhas do resumo: um rótulo e o(s) valor(es) logo ao lado (o menor bloco que tem os dois).
  for (const el of summary.querySelectorAll('div, li, p')) {
    if (!el.getClientRects().length || el.children.length < 2 || el.children.length > 3) continue;
    const label = el.children[0].textContent.replace(/\s+/g, ' ').trim();
    const m = /^(Subtotal|Desconto|Total|Prazo de entrega|Entrega para .+)$/.exec(label);
    if (m && !rows[m[1].startsWith('Entrega') ? 'Frete' : m[1]]) rows[m[1].startsWith('Entrega') ? 'Frete' : m[1]] = [...el.children].slice(1).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' ');
  }
  // Total: o valor logo depois do rótulo "Total" no texto do resumo (a linha do total tem também o "ou 5x de").
  const text = summary.textContent.replace(/\s+/g, ' ');
  const total = /\bTotal\s*R\$\s*([\d.]+,\d{2})/.exec(text);
  if (total) rows.Total = 'R$ ' + total[1];
  const sel = [...document.querySelectorAll('#formPaymentMethods input[type=radio]')].find((r) => r.checked);
  const inst = [...document.querySelectorAll('#cart_card_installments option')].map((o) => o.textContent.trim());
  return { rows, selected: sel ? sel.id : null, installments: inst, theme: document.body.getAttribute('data-origens-theme') };
});
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(1500); };

await page.goto(`${H.HOST}${H.store.inkBase}/checkout/contact_and_shipping_details/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(1000);
let r = await read(); steps.push({ step: 'contato', ...r });
check('contato: tela da INK com o tema (atributo checkout) e resumo com total', r.theme === 'checkout' && money(r.rows.Total) > 0, JSON.stringify(r.rows));
await page.goto(`${H.HOST}${H.store.inkBase}/checkout/payment_methods/${UUID}`, { waitUntil: 'networkidle', timeout: 90000 }); await wait(1000);
r = await read(); steps.push({ step: 'pagamento (inicial)', ...r });
const original = r.selected;
check('pagamento: forma escolhida e total lidos', !!money(r.rows.Total), `forma inicial: ${original} · ${JSON.stringify(r.rows)}`);
const before = H.passed.length;
await page.evaluate(() => document.getElementById('pix')?.click()); await settle();
const pix = await read(); steps.push({ step: 'Pix', ...pix });
check('Pix: a INK respondeu ao recálculo (POST payment_discount liberado)', H.passed.length > before, H.passed.slice(before).join(' | '));
await page.evaluate(() => document.getElementById('credit_card')?.click()); await settle();
const card = await read(); steps.push({ step: 'cartão', ...card });
check('cartão: a INK respondeu ao recálculo', H.passed.length > before + 1, H.passed.slice(before).join(' | '));
check('Pix × cartão: totais lidos depois de cada resposta', money(pix.rows.Total) && money(card.rows.Total), `Pix ${pix.rows.Total} (desconto ${pix.rows.Desconto || '—'}) · cartão ${card.rows.Total} (desconto ${card.rows.Desconto || '—'})`);
// Parcelas: escolher não dispara requisição; n × parcela = total do cartão (centavos de arredondamento).
const reqs = []; const onReq = (q) => { if (q.method() !== 'GET') reqs.push(q.method() + ' ' + new URL(q.url()).pathname); }; page.on('request', onReq);
await page.selectOption('#cart_card_installments', { index: 2 }).catch(() => {}); await wait(800);
page.off('request', onReq);
const inst = await read();
const parsed = inst.installments.map((t) => { const m = /^(\d+)x de R\$\s*([\d.]+,\d{2})/.exec(t); return m ? { n: Number(m[1]), v: Number(m[2].replace(/\./g, '').replace(',', '.')) } : null; }).filter(Boolean);
const total = money(card.rows.Total);
check('parcelas: escolher não faz requisição', reqs.length === 0, reqs.join(' | '));
check('parcelas: n × valor da parcela = total do cartão (±R$ 0,05)', parsed.length > 0 && parsed.every((p) => Math.abs(p.n * p.v - total) <= 0.05 * p.n), inst.installments.join(' · '));
// Volta à forma de pagamento que estava escolhida (o carrinho de teste fica como estava). Sem nenhuma escolhida antes, não há como "desmarcar": registra.
if (original && original !== 'credit_card') { await page.evaluate((id) => document.getElementById(id)?.click(), original); await settle(); }
await page.reload({ waitUntil: 'networkidle' }); await wait(1000);
const restored = await read(); steps.push({ step: 'recarregado', ...restored });
if (original) check('forma de pagamento original restaurada (depois de recarregar)', restored.selected === original, `${original} -> ${restored.selected}`);
else console.log('INFO nenhuma forma estava marcada antes do teste; depois de recarregar a INK mostra: ' + (restored.selected || 'nenhuma'));
// "Editar" o endereço: volta ao contato por GET, com o tema; nada é enviado.
const posts = []; const onPost = (q) => { const u = new URL(q.url()); if (q.method() !== 'GET' && u.host === H.store.inkHost && u.pathname.startsWith(H.store.inkBase + '/')) posts.push(q.method() + ' ' + new URL(q.url()).pathname.replace(/[0-9a-f-]{36}/g, '<uuid>')); }; page.on('request', onPost);
const edit = await page.evaluateHandle(() => [...document.querySelectorAll('a[aria-label="Editar endereço de entrega"]')].find((a) => a.getClientRects().length) || null).then((h) => h.asElement());
if (edit) { await Promise.all([page.waitForURL(/contact_and_shipping_details/, { timeout: 30000 }).catch(() => {}), edit.click()]); await settle(); }
page.off('request', onPost);
const back = await read();
check('"Editar" volta ao contato (GET), com o tema, sem envio', !!edit && /contact_and_shipping_details/.test(page.url()) && back.theme === 'checkout' && posts.length === 0, `${posts.join(' | ') || 'sem POST'}`);
writeFileSync(OUT, JSON.stringify({ geradoEm: new Date().toISOString(), resultados: results, passos: steps, liberadas: H.passed, bloqueadas: H.blocked }, null, 1));
console.log(results.filter((x) => x.ok).length + '/' + results.length + ' PASS · liberadas: ' + (H.passed.join(' | ') || 'nenhuma') + ' · bloqueadas: ' + (H.blocked.join(' | ') || 'nenhuma'));
await s.ctx.close(); await H.close();
process.exit(results.every((x) => x.ok) ? 0 : 1);
