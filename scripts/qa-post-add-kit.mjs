#!/usr/bin/env node
// SIMULAÇÃO do "Monte seu kit" (post-add-kit) no modal pós-adição, sem carrinho real: adicionar ao carrinho real não é permitido nesta sessão (a trava do
// harness aborta todo não-GET do carrinho). Abre a PDP REAL pelo Worker LOCAL (harness de preview-tema, mesmo worker.js/loader de produção, tema da compra
// ligado), com o storefront respondendo um kit fixo em /api/post-add-kit/sul (as faixas reais da LEVEMAIS de 27/10/2026). O "envio" do formulário de compra
// é só o evento turbo:submit-start (nada sai); o modal é a marcação da INK (classes e ids de docs/evidence/drawer/before-drawer-*.audit.json) com a geometria
// MEDIDA nessa auditoria (folha inferior no celular, gaveta à direita no desktop), inserida em #last_added_product. Toda captura leva a faixa "SIMULAÇÃO".
// Não prova a integração com o modal real: a conferência real é do dono (docs/post-add-kit.md, roteiro manual).
//   PW_PATH=<pasta com playwright-core> node scripts/qa-post-add-kit.mjs --out <dir> [--antes]
import { mkdirSync } from 'node:fs';
import { createHarness, DEFAULT_PDP } from './lib/tema-harness.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('--out'); if (!OUT) { console.error('--out <dir>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const KIT = { v: 1, region: 'sul', kit: { id: 73095, code: 'LEVEMAIS', auto: false, kind: 'value', tiers: [{ items: 3, discount: 25 }, { items: 4, discount: 40 }, { items: 5, discount: 60 }, { items: 6, discount: 85 }], eyebrow: 'Economize montando seu kit', title: 'Monte seu kit e pague menos', lead: 'Você pode combinar produtos participantes. Os valores abaixo usam o preço atual deste produto como referência.' } };
const OFF = { v: 1, region: 'sul', kit: null };
const VIEWPORTS = [{ name: 'desktop-1440', width: 1440, height: 900 }, { name: 'celular-390', width: 390, height: 844 }, { name: 'celular-360x640', width: 360, height: 640 }];

// A marcação da INK (ids e classes da auditoria) com a geometria medida: no celular a folha encosta embaixo e rola por dentro; no desktop é a gaveta da direita.
const modalHtml = (imgs, mobile) => {
  const wrap = mobile
    // Sem altura máxima: a folha real CRESCE com o conteúdo, presa ao pé (visto ao vivo em 28/10/2026; a simulação com 76dvh escondia o topo cortado).
    ? 'position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;overflow:hidden auto;background:#fff;border-radius:24px 24px 0 0'
    : 'position:fixed;top:0;right:0;bottom:0;width:450px;z-index:50;display:flex;overflow:hidden auto;background:#fff';
  const sold = imgs.slice(0, 6).map((src) => '<li class="flex shrink-0 h-[135px]"><a class="flex shrink-0 h-[135px]" href="#"><img class="w-[130px] h-[135px] object-cover" style="width:130px;height:135px;object-fit:cover;background:#e5e5e5" src="' + src + '"></a></li>').join('');
  return '<div aria-hidden="true" style="position:fixed;inset:0;z-index:49;background:rgba(0,0,0,.45)"></div>' +
    '<div id="modal-wrapper" class="add-product-modal overflow-y-auto overflow-x-hidden" role="dialog" aria-modal="true" style="' + wrap + '"><div class="relative w-full md:h-[100dvh]"><div class="w-full p-4 md:min-h-screen" style="padding:16px">' +
    '<div class="flex items-center justify-between" style="display:flex;align-items:center;justify-content:space-between"><div class="flex items-center" style="display:flex;align-items:center;gap:10px">' +
    '<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#22a06b"/><path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.4" fill="none"/></svg>' +
    '<h3 class="text-center font-medium text-black-500" style="margin:0;font-size:' + (mobile ? 16 : 16) + 'px">Produto adicionado ao carrinho</h3></div>' +
    '<button id="modal-close-button" class="focus:ring-4 font-medium text-center" style="border:0;background:none;font-size:22px" aria-label="Fechar">✕</button></div>' +
    '<div class="flex flex-col add-product-modal__modal-content__footer" style="display:flex;flex-direction:column;gap:12px;margin-top:20px">' +
    '<button class="flex flex-row checkout-btn" style="display:flex;justify-content:center;align-items:center;gap:8px"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM5.2 4H2V2h4.8l1 2H21l-3.5 8H8.6l-1.1 2H19v2H4.2l2.6-4.7L5.2 4Z"/></svg><span class="pl-2">Ver carrinho</span></button>' +
    '<button id="continue-shopping-button" class="flex flex-row bg-white" style="display:flex;justify-content:center"><span class="pl-2">Continuar comprando</span></button></div>' +
    '<turbo-frame id="most_sold_frame" class="w-full" style="display:block"><h3 class="text-left pt-6 font-medium" style="padding-top:24px;font-size:16px">As mais vendidas</h3><div class="flex flex-row mt-4"><ul class="flex gap-2 overflow-x-auto" style="display:flex;gap:8px;overflow-x:auto;padding:0;margin:16px 0 0;list-style:none">' + sold + '</ul></div></turbo-frame>' +
    '</div></div></div>';
};
const BANNER = 'const b=document.createElement("div");b.textContent="SIMULAÇÃO · modal reconstruído, não é o carrinho real";b.style.cssText="position:fixed;left:8px;top:8px;z-index:2147483647;background:#b42318;color:#fff;font:700 12px/1 system-ui;padding:6px 8px;pointer-events:none";document.body.appendChild(b);';

const runs = argv.includes('--antes') ? [['antes', OFF], ['depois', KIT]] : [['depois', KIT]];
for (const [tag, payload] of runs) {
  const H = await createHarness({ themeFeatures: 'theme-pdp,theme-cart,post-add-kit', storefront: { '/api/post-add-kit/sul': payload } });
  for (const vp of VIEWPORTS) {
    const s = await H.session(vp);
    const { page } = s;
    await page.goto(H.HOST + DEFAULT_PDP, { waitUntil: 'networkidle', timeout: 90000 });
    await H.acceptCookies(page); await page.waitForTimeout(1200);
    const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => i.currentSrc || i.getAttribute('src')).filter((src) => src && /majestic\.ink.*\/images\/product/.test(src)).slice(0, 8));
    for (const priced of tag === 'depois' ? [true, false] : [true]) {
      // Sem preço: página nova (o preço da adição anterior vale 30 s) e nenhum envio antes do modal.
      if (!priced) { await page.reload({ waitUntil: 'networkidle', timeout: 90000 }); await page.waitForTimeout(1200); }
      // O "envio": só o evento que o Turbo dispara no formulário de compra (nenhum pedido sai).
      if (priced) await page.evaluate(() => { const f = [...document.querySelectorAll('form[id^="form-product-"]')].find((x) => !x.closest('.modal-buy-together, #quick_add_frame')); if (f) f.dispatchEvent(new CustomEvent('turbo:submit-start', { bubbles: true })); });
      await page.evaluate(({ html }) => { let f = document.getElementById('last_added_product'); if (!f) { f = document.createElement('turbo-frame'); f.id = 'last_added_product'; document.body.appendChild(f); } f.innerHTML = html; }, { html: modalHtml(imgs, s.mobile) });
      await page.waitForTimeout(1500);
      await page.evaluate(BANNER);
      const m = await page.evaluate(() => {
        const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const x = e.getBoundingClientRect(); return { y: Math.round(x.y), bottom: Math.round(x.bottom), h: Math.round(x.height), w: Math.round(x.width) }; };
        const label = (sel) => document.querySelector(sel + ' span')?.textContent ?? null;
        return { vh: innerHeight, kit: r('[data-origens-kit]'), close: r('#modal-close-button'), sheet: r('#modal-wrapper'), priced: document.querySelector('[data-origens-kit]')?.getAttribute('data-priced') ?? null, tiers: document.querySelectorAll('.o-kit-tier').length,
          checkout: r('#modal-wrapper .checkout-btn'), more: r('#continue-shopping-button'), labels: [label('#modal-wrapper .checkout-btn'), label('#continue-shopping-button')],
          hScroll: document.documentElement.scrollWidth > innerWidth, sheetScroll: (() => { const w = document.getElementById('modal-wrapper'); return w ? w.scrollWidth > w.clientWidth : null; })() };
      });
      const visible = m.checkout && m.checkout.y >= 0 && m.checkout.bottom <= m.vh;
      const closable = m.close && m.close.y >= 0 && m.close.bottom <= m.vh;
      console.log(`[${tag} ${vp.name}${priced ? '' : ' sem preço'}]`, JSON.stringify(m), visible ? 'OK: "Finalizar compra" à vista' : 'ATENÇÃO: botão fora da tela', closable ? '| OK: × à vista' : '| ATENÇÃO: × fora da tela');
      const name = `${tag}-${vp.name}${priced ? '' : '-sem-preco'}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      if (s.mobile && tag === 'depois' && priced) {
        // Rola a folha até o fim: os botões seguem presos ao pé enquanto há kit; depois a busca e "As mais vendidas".
        await page.evaluate(() => { const w = document.getElementById('modal-wrapper'); if (w) w.scrollTop = w.scrollHeight; });
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => { const c = document.getElementById('modal-close-button'); const b = document.querySelector('#modal-wrapper .checkout-btn'); const r = (e) => e ? Math.round(e.getBoundingClientRect().y) : null; return { closeY: r(c), checkoutY: r(b), vh: innerHeight }; });
        console.log(`[${tag} ${vp.name} rolado]`, JSON.stringify(after), after.closeY !== null && after.closeY >= 0 ? 'OK: × continua à vista' : 'ATENÇÃO: × sumiu');
        await page.screenshot({ path: `${OUT}/${name}-rolado.png` });
        await page.evaluate(() => { const w = document.getElementById('modal-wrapper'); if (w) w.scrollTop = 0; });
      }
      await page.evaluate(() => { const f = document.getElementById('last_added_product'); if (f) f.innerHTML = ''; });
      await page.waitForTimeout(400);
      if (tag !== 'depois') break;
    }
    await s.ctx.close();
  }
  console.log('requisições bloqueadas:', H.blocked.length ? H.blocked.join(' | ') : 'nenhuma');
  await H.close();
}
