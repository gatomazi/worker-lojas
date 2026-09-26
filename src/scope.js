// WIDGET_SCOPE_MODE: quais páginas podem receber o loader. Fail-closed e DESLIGADO por padrão.
//   ausente / "allowlist" / qualquer outro valor -> "allowlist": só os caminhos exatos de WIDGET_ALLOWLIST (comportamento atual)
//   "product-catalog"                            -> qualquer página VERDADEIRA de produto (/usesul/product/<slug>), sem lista de slugs
// Um valor com erro de digitação cai em "allowlist" (o escopo mais estreito) e o health mostra scope_status "invalid".
// ENABLE_WIDGET=false continua sendo o kill switch global; este modo nunca amplia hosts, métodos nem rotas além do produto.
export const SCOPE_MODES = ['allowlist', 'product-catalog'];
export const CATALOG_MODE = 'product-catalog';

// Slug canônico do catálogo (os 9.775 slugs reais do catálogo conferem): minúsculas, dígitos, "-" e "_"; sem subcaminho,
// sem barra final, sem "%", sem ".." e sem placeholders. O mesmo formato de allowlist.js.
export const CATALOG_PRODUCT_PATH = /^\/usesul\/product\/[a-z0-9][a-z0-9_-]{0,127}$/;

export function parseScopeMode(raw) {
  if (raw === undefined || raw === null || raw === '') return { mode: 'allowlist', status: 'default' };
  if (typeof raw !== 'string') return { mode: 'allowlist', status: 'invalid' };
  const value = raw.trim();
  if (value === 'allowlist') return { mode: 'allowlist', status: 'ok' };
  if (value === CATALOG_MODE) return { mode: CATALOG_MODE, status: 'ok' };
  return { mode: 'allowlist', status: 'invalid' };
}

export const isCatalogProductPath = (pathname) => typeof pathname === 'string' && CATALOG_PRODUCT_PATH.test(pathname);

// Uma rota está no escopo? (só o caminho; o Worker ainda exige GET, sem Turbo-Frame, 200, HTML e formulário nativo de compra.)
export function inScope(scope, allowlist, pathname) {
  return scope.mode === CATALOG_MODE ? isCatalogProductPath(pathname) : allowlist.paths.includes(pathname);
}

// ── Páginas "de casca" (shell): onde só o cabeçalho e o FAB nossos aparecem, sem nenhum módulo de produto ────────────────────────────────────
// A navbar (header-nav + FAB de WhatsApp + a ponte do carrinho) acompanha o cliente pelas páginas NÃO transacionais da loja: home, listagem, coleções, sobre e
// conta/pedidos. Ficam FORA, sempre: login (store_sessions), carrinho, checkout e qualquer outro caminho. Só vale com o escopo de catálogo E a feature header-nav.
// Função PURA e autocontida: o mesmo código roda no Worker e (via toString) no loader do navegador — uma única definição, testada aqui.
//   base = prefixo da loja na INK (ex.: "/usesul"). O pathname vem sem query string.
export function shellPageKind(pathname, base) {
  if (typeof pathname !== 'string' || typeof base !== 'string' || base === '') return null;
  if (pathname === base || pathname === base + '/') return 'home';
  if (pathname.slice(0, base.length + 1) !== base + '/') return null;
  const rest = pathname.slice(base.length + 1).replace(/\/$/, '');
  if (rest === 'products') return 'products';
  if (rest === 'about') return 'about';
  if (rest === 'orders') return 'orders';
  if (/^collections\/[a-z0-9][a-z0-9_-]{0,127}$/.test(rest)) return 'collection';
  if (/^orders\/[A-Za-z0-9_-]{1,64}$/.test(rest)) return 'order'; // /orders/<pedido> e /orders/trackings
  return null;
}
// O escopo de casca está ligado? (catálogo + header-nav; nunca no modo de allowlist de cinco produtos)
export const shellEnabled = (scopeMode, features) => scopeMode === CATALOG_MODE && Array.isArray(features) && features.includes('header-nav');
