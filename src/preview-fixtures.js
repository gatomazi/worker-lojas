// SOMENTE PREVIEW. Origem falsa e sanitizada: HTML mínimo, cookies inventados, nenhum dado da INK ou de clientes.
// Nunca importado por src/worker.js nem pelo wrangler.production.toml (garantido por test/config.test.js).
export const FIXTURE_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Fixture de produto (sanitizada)</title>
<meta name="turbo-cache-control" content="no-cache">
</head>
<body>
<main>
<form id="form-product-0" class="form-product-options" method="post" action="/usesul/cart?product_id=0">
<button id="add-to-cart-desk" class="form-product-options__add-to-cart-btn" type="button">Adicionar ao Carrinho</button>
</form>
</main>
</body>
</html>
`;

const HTML = 'text/html; charset=utf-8';

function withFixtureCookies(response) {
  response.headers.append('set-cookie', 'fixture_a=1; Path=/; HttpOnly; Secure');
  response.headers.append('set-cookie', 'fixture_b=2; Path=/; Secure');
  return response;
}

function htmlResponse(body, init = {}) {
  const response = new Response(body, { status: 200, ...init, headers: { 'content-type': HTML, etag: 'W/"fixture-etag"', 'cache-control': 'private, no-store', ...init.headers } });
  return withFixtureCookies(response);
}

// Substitui a INK. Só usa método, caminho e (para POST) o tamanho do corpo; nunca devolve cabeçalhos do cliente.
export async function fixtureFetch(request) {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const bytes = (await request.arrayBuffer()).byteLength;
    return withFixtureCookies(Response.json({ fixture: 'post', method: request.method, path: url.pathname, body_bytes: bytes }, { status: 201 }));
  }

  switch (url.pathname) {
    case '/usesul/product/serra-catarinense':
    case '/usesul/product/outro':
    case '/usesul/cart':
    case '/usesul/checkout':
      return htmlResponse(FIXTURE_PAGE);
    case '/usesul/product/redirect':
      return withFixtureCookies(new Response(null, { status: 302, headers: { location: '/usesul/product/serra-catarinense' } }));
    case '/usesul/product/data':
      return withFixtureCookies(Response.json({ fixture: 'json' }));
    case '/usesul/product/missing':
      return htmlResponse(FIXTURE_PAGE, { status: 404 });
    case '/usesul/product/boom':
      return htmlResponse(FIXTURE_PAGE, { status: 500 });
    case '/usesul/product/gzip':
      // Corpo em texto puro com Content-Encoding declarado: o runtime comprime na saída (é o mesmo formato em que um
      // fetch() de origem comprimida chega ao Worker, com o cabeçalho ainda presente). Exercita o guard do Worker.
      return htmlResponse(FIXTURE_PAGE, { headers: { 'content-encoding': 'gzip' } });
    default:
      return new Response('fixture: not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}
