// O topo da Use Origens na loja da Uma Penca (artigos.useorigens.com.br): a MESMA navegação da vitrine e da INK (logo, Sua cidade, Estados, Categorias, os
// links da barra com as cores do CMS), para quem chegou a uma caneca poder voltar à loja sem usar o botão "voltar" do navegador.
// Tudo é HTML e CSS montados NO SERVIDOR a partir do `site` que a vitrine publica (normalizeSite, o mesmo da INK): nenhum script nosso roda no navegador.
//   Computador (≥ 768 px): [logo] [Sua cidade] [Estados ▾] [Categorias ▾] [barra: Canecas, Natal…] | [Loja] [Contato]; a lupa, a conta e a sacola são as da
//                          Uma Penca, intactas. Abaixo de 1100 px a navegação cabe num único "Menu ▾" (o mesmo painel do celular).
//   Celular (< 768 px):    o ☰ nativo (que só abre "Loja/Contato") dá lugar ao nosso, com "Voltar para a Use Origens" no alto, "Encontre aqui a sua cidade",
//                          os blocos do menu da vitrine e, no fim, Loja e Contato da Uma Penca.
// Todo texto vem do payload já validado (sem "<" nem ">") e passa por esc() de novo aqui; todo endereço de saída é https e da origem da vitrine.
// "Loja" e "Contato" são os dois links que o painel da Uma Penca já publica (DESKTOP_MENU): ficam como estão, só mudam de lugar.
import { STORES } from '../stores.js';

const STORE = STORES.sul; // loja única: a vitrine da Sul entrega o topo das três regiões
export const STOREFRONT_HOME = STORE.storefront + STORE.storefrontBase;
export const LOGO_URL = STORE.storefront + '/brand/logo-origens.png';
export const BACK_LABEL = 'Voltar para a Use Origens';
// Links próprios da Uma Penca, no mesmo domínio: mantidos como o painel deles os publica.
export const NATIVE_LINKS = Object.freeze([{ label: 'Loja', href: '/' }, { label: 'Contato', href: '/fale-conosco' }]);

const HEX = /^#[0-9a-fA-F]{6}$/;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC[c]);

const CHEVRON = '<svg class="oa-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ARROW_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const MENU_ICON = '<svg class="oa-ico-open" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  + '<svg class="oa-ico-close" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// Cores do destaque do CMS (já validadas como #rrggbb); o texto padrão é branco.
function highlightStyle(item) {
  const h = item.highlight;
  if (!h) return '';
  const parts = [];
  if (h.background && HEX.test(h.background)) parts.push('background:' + h.background);
  parts.push('color:' + (h.text && HEX.test(h.text) ? h.text : '#fff'));
  if (h.underline && HEX.test(h.underline)) parts.push('box-shadow:inset 0 -3px 0 ' + h.underline);
  return ' style="' + parts.join(';') + '"';
}
const link = (item, cls = 'oa-l') => '<a class="' + cls + (item.highlight ? ' oa-hl' : '') + '" href="' + esc(item.url) + '"' + highlightStyle(item) + '>' + esc(item.label) + '</a>';
const nativeLinks = (cls) => NATIVE_LINKS.map((n) => '<a class="' + cls + '" href="' + esc(n.href) + '">' + esc(n.label) + '</a>').join('');

// Uma linha de um painel: o selo da UF (estados), o nome e a descrição.
function row(item) {
  return '<li><a class="oa-r' + (item.highlight ? ' oa-hl' : '') + '" href="' + esc(item.url) + '"' + highlightStyle(item) + '>'
    + (item.badge ? '<b class="oa-badge">' + esc(item.badge) + '</b>' : '')
    + '<span class="oa-rt">' + esc(item.label) + (item.detail ? '<small>' + esc(item.detail) + '</small>' : '') + '</span></a></li>';
}
const list = (items, extra = '') => '<ul class="oa-list">' + items.map(row).join('') + extra + '</ul>';

// "Estados ▾" e "Categorias ▾": abrem por foco/hover (CSS puro). O gatilho é um span focável (role=button) para o toque e o teclado funcionarem sem script.
function dropdown(label, body, cls = '') {
  return '<div class="oa-dd' + (cls ? ' ' + cls : '') + '"><span class="oa-t" tabindex="0" role="button" aria-haspopup="true">' + esc(label) + CHEVRON + '</span><div class="oa-p">' + body + '</div></div>';
}

// O menu inteiro em seções: usado no celular (gaveta) e no "Menu ▾" do computador estreito. `site.blocks` é o menu do celular da vitrine, na ordem e com
// os títulos publicados; o endereço de "Voltar" é a home da vitrine.
export function menuSections(site) {
  const back = '<a class="oa-back" href="' + esc(STOREFRONT_HOME) + '">' + ARROW_BACK + '<span>' + esc(BACK_LABEL) + '</span></a>';
  const city = '<a class="oa-city" href="' + esc(site.journey.url) + '">' + esc(site.journey.menuLabel) + '</a>';
  const blocks = site.blocks.map((b) => '<section class="oa-sec"><h3 class="oa-h">' + esc(b.label) + '</h3>' + list(b.items) + '</section>').join('');
  const here = '<section class="oa-sec"><h3 class="oa-h">Nesta loja</h3><ul class="oa-list">' + NATIVE_LINKS.map((n) => '<li><a class="oa-r" href="' + esc(n.href) + '"><span class="oa-rt">' + esc(n.label) + '</span></a></li>').join('') + '</ul></section>';
  return back + city + blocks + here;
}

// Computador: a navegação inline (≥ 1100 px) e, abaixo disso, um único "Menu ▾".
export function desktopNav(site) {
  const more = site.statesMore ? '<li><a class="oa-r oa-all" href="' + esc(site.statesMore) + '"><span class="oa-rt">Ver todos os estados</span></a></li>' : '';
  const inline = '<nav class="oa-inline" aria-label="Principal">'
    + link(site.journey)
    + (site.states.length > 0 ? dropdown('Estados', list(site.states, more)) : '')
    + (site.categories.length > 0 ? dropdown(site.categoriesLabel, list(site.categories), 'oa-dd-wide') : '')
    + site.bar.map((b) => link(b)).join('')
    + '<span class="oa-sep" aria-hidden="true"></span>' + nativeLinks('oa-l oa-n') + '</nav>';
  const compact = '<div class="oa-compact">' + dropdown('Menu', menuSections(site), 'oa-dd-menu') + '</div>';
  return '<div class="oa-nav" data-origens-artigos="nav">' + inline + compact + '</div>';
}

// Celular: o ☰ e a gaveta (um <details>: abre e fecha sem script; o ícone vira ✕ aberto).
export function mobileMenu(site) {
  return '<details class="oa-m" data-origens-artigos="menu"><summary class="oa-m-btn" aria-label="Menu">' + MENU_ICON + '</summary><div class="oa-m-panel">' + menuSections(site) + '</div></details>';
}

// O logo: a etiqueta da vitrine e o nome, no mesmo desenho do topo da vitrine. Vai DENTRO do link do logo nativo (que passa a levar à vitrine).
export const logoHtml = () => '<img class="oa-logo-img" src="' + esc(LOGO_URL) + '" alt="" width="34" height="34"><span class="oa-logo-word" translate="no">Use Origens</span>';

// CSS: tudo escopado em classes .oa-* e nos ids do topo da Uma Penca. O topo nativo é fixo (70 px no computador, 46 no celular) e já tem a cor da loja
// (o verde #4d543d do painel deles), que não mexemos. A navegação nativa do computador (Vue) só é escondida: Loja e Contato voltam como links nossos.
export function topoCss(accent = STORE.theme.accent) {
  return [
    // computador: o logo e a nossa navegação no lugar da nativa; a lupa, a conta e a sacola ficam como são
    '#header-desktop-nav{display:none!important}',
    '#header-desktop-logo-wrapper{flex:0 0 auto}',
    '.oa-logo-img{display:inline-block;height:34px;width:auto;margin-right:9px;vertical-align:middle}',
    '.oa-logo-word{display:inline-block;vertical-align:middle;font-weight:800;font-size:21px;line-height:1;letter-spacing:.02em;text-transform:uppercase;color:#fff;white-space:nowrap}',
    '#header-desktop-logo-wrapper a.header-logo-up{display:flex;align-items:center;text-decoration:none}',
    '.oa-nav{display:flex;align-items:center;flex:1 1 auto;min-width:0;height:70px;margin-left:24px;font-family:inherit}',
    '.oa-inline{display:none;align-items:center;gap:2px;min-width:0}',
    '.oa-compact{display:block}',
    '@media (min-width:1100px){.oa-inline{display:flex}.oa-compact{display:none}}',
    '.oa-l,.oa-t{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 13px;border-radius:8px;color:#fff;font-size:15px;font-weight:500;line-height:1;text-decoration:none;white-space:nowrap;cursor:pointer;transition:background-color .15s}',
    '.oa-l:hover,.oa-t:hover,.oa-dd:hover>.oa-t,.oa-dd:focus-within>.oa-t{background:rgba(255,255,255,.14);color:#fff}',
    '.oa-l:focus-visible,.oa-t:focus-visible,.oa-back:focus-visible,.oa-r:focus-visible,.oa-city:focus-visible{outline:2px solid ' + accent + ';outline-offset:2px}',
    '.oa-l.oa-hl{font-weight:700}.oa-l.oa-hl:hover{filter:brightness(1.08)}',
    '.oa-n{opacity:.88}',
    '.oa-sep{display:inline-block;width:1px;height:20px;margin:0 8px;background:rgba(255,255,255,.28)}',
    '.oa-chev{transition:transform .15s}.oa-dd:hover .oa-chev,.oa-dd:focus-within .oa-chev{transform:rotate(180deg)}',
    // painéis (Estados, Categorias, Menu): abrem por hover e por foco, sem script
    '.oa-dd{position:relative;display:flex;align-items:center;height:70px}',
    '.oa-p{position:absolute;top:62px;left:0;z-index:20;display:none;min-width:260px;max-height:calc(100vh - 96px);overflow:auto;padding:8px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#fff;color:#1f2417;box-shadow:0 14px 40px rgba(0,0,0,.22)}',
    '.oa-dd:hover>.oa-p,.oa-dd:focus-within>.oa-p{display:block}',
    '.oa-dd-wide>.oa-p{min-width:340px}.oa-dd-menu>.oa-p{width:340px;padding:12px}',
    '.oa-list{margin:0;padding:0;list-style:none}',
    '.oa-r{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#1f2417;font-size:15px;line-height:1.25;text-decoration:none}',
    '.oa-r:hover{background:#f4efe3;color:#1f2417}',
    '.oa-r.oa-hl{margin:2px 0}',
    '.oa-rt{display:flex;flex-direction:column;gap:2px}.oa-rt small{font-size:12.5px;color:#6b6f60;font-weight:400}.oa-r.oa-hl .oa-rt small{color:inherit;opacity:.85}',
    '.oa-badge{flex:0 0 auto;min-width:30px;padding:3px 5px;border-radius:6px;background:#4d543d;color:#fff;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-align:center}',
    '.oa-all{border-top:1px solid rgba(0,0,0,.08);margin-top:4px;padding-top:12px;border-radius:0 0 8px 8px;font-weight:600}',
    '.oa-back{display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:11px 12px;border-radius:10px;background:#4d543d;color:#fff;font-size:15px;font-weight:700;text-decoration:none}',
    '.oa-back:hover{color:#fff;filter:brightness(1.12)}',
    '.oa-city{display:block;margin:0 0 4px;padding:11px 12px;border-radius:10px;background:#f4efe3;color:#1f2417;font-size:15px;font-weight:700;text-decoration:none}',
    '.oa-sec{margin-top:10px}.oa-h{margin:0;padding:8px 10px 4px;color:#6b6f60;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}',
    // celular: o ☰ nosso no lugar do nativo (que só abria Loja/Contato), o logo ao centro e a gaveta de tela cheia abaixo da barra
    '#header-mobile #header-drawer-icon{display:none!important}',
    '#header-mobile a.header-logo-up{display:flex!important;align-items:center;text-decoration:none}',
    '#header-mobile .oa-logo-img{height:26px;margin-right:6px}#header-mobile .oa-logo-word{font-size:16px}',
    // o ☰ nativo era o único filho que dava altura à linha (42 px + 4 de respiro): escondido, a linha encolheria e o logo, a lupa e a sacola subiriam. 46 px fixos mantêm tudo onde estava.
    '#header-mobile-topbar-wrapper>div{position:relative;box-sizing:border-box;height:46px}',
    '.oa-m{position:absolute;left:0;top:0;z-index:12;font-family:inherit}',
    '.oa-m-btn{display:flex;align-items:center;justify-content:center;width:46px;height:46px;color:#fff;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent}',
    '.oa-m-btn::-webkit-details-marker{display:none}.oa-m-btn::marker{content:""}',
    '.oa-ico-close,.oa-m[open] .oa-ico-open{display:none}.oa-m[open] .oa-ico-close{display:block}',
    '.oa-m-panel{position:fixed;left:0;right:0;top:46px;bottom:0;z-index:11;overflow:auto;padding:14px 14px 40px;background:#fff;color:#1f2417;-webkit-overflow-scrolling:touch}',
    '.oa-m-panel .oa-r{padding:12px 10px;font-size:16px}'
  ].join('\n');
}
