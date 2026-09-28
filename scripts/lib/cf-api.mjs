// Cliente mínimo da API da Cloudflare para os scripts de release por loja. Token: CLOUDFLARE_API_TOKEN, ou o OAuth do `wrangler login` do proprietário
// (lido do arquivo do próprio Wrangler; NUNCA impresso nem gravado). Precisa de workers_routes (write) e zone (read) para as rotas.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const API = 'https://api.cloudflare.com/client/v4';
export function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const f of [homedir() + '/Library/Preferences/.wrangler/config/default.toml', homedir() + '/.config/.wrangler/config/default.toml', homedir() + '/.wrangler/config/default.toml']) {
    try { const m = /^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync(f, 'utf8')); if (m) return m[1]; } catch (_) { /* próximo */ }
  }
  throw new Error('sem credencial Cloudflare: rode `npx wrangler login` (proprietário) ou exporte CLOUDFLARE_API_TOKEN');
}
let refreshed = false;
export async function cf(method, path, body) {
  const go = () => fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let r = await go();
  if ((r.status === 401 || r.status === 403) && !refreshed) { refreshed = true; spawnSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' }); r = await go(); } // o wrangler renova o OAuth ao ser usado
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`Cloudflare ${method} ${path.replace(/\/zones\/[0-9a-f]+/, '/zones/<id>')}: HTTP ${r.status} ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.result;
}
export async function zoneOf(name) { const z = await cf('GET', '/zones?name=' + encodeURIComponent(name)); if (!z.length) throw new Error('zona não encontrada: ' + name); return { id: z[0].id, status: z[0].status, account: z[0].account && z[0].account.id }; }
export const listRoutes = (zoneId) => cf('GET', `/zones/${zoneId}/workers/routes`);
