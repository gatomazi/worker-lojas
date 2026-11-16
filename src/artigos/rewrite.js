// A reescrita do topo da Uma Penca com o HTMLRewriter (streaming, sem bufferizar a página): troca o logo, põe a navegação da vitrine e o ☰ nosso.
// O CSS entra antes do cabeçalho do celular (no corpo, dentro de #page) e só se o cabeçalho existir: um fragmento sem os topos da Uma Penca fica intacto.
// O logo e a navegação vão como IRMÃOS dos nós da Uma Penca, nunca dentro do bloco que o Vue deles compila (#header-desktop-nav): o que o Vue mexe, não mexemos.
import { desktopNav, mobileMenu, logoHtml, topoCss, STOREFRONT_HOME, BACK_LABEL } from './topo.js';

class LogoLink {
  constructor(html) { this.html = html; }
  element(el) {
    el.setAttribute('href', STOREFRONT_HOME);
    el.setAttribute('title', BACK_LABEL);
    el.setInnerContent(this.html, { html: true });
  }
}
class InsertAfter {
  constructor(html) { this.html = html; }
  element(el) { el.after(this.html, { html: true }); }
}
class InsertBefore {
  constructor(html) { this.html = html; }
  element(el) { el.before(this.html, { html: true }); }
}

export function applyTopo(response, site) {
  const logo = logoHtml();
  const rewritten = new HTMLRewriter()
    .on('header#header-mobile', new InsertBefore('<style data-origens-artigos="css">' + topoCss() + '</style>'))
    .on('#header-desktop a.header-logo-up', new LogoLink(logo))
    .on('#header-mobile a.header-logo-up', new LogoLink(logo))
    .on('#header-desktop-logo-wrapper', new InsertAfter(desktopNav(site)))
    .on('#header-drawer-icon', new InsertAfter(mobileMenu(site)))
    .transform(response);
  rewritten.headers.set('X-Origens-Artigos', 'topo');
  return rewritten;
}
