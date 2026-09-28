// Funções PURAS do release por loja (Norte e Centro-Oeste): sem rede, sem Wrangler, sem Cloudflare. Testadas em test/store-release.test.js.
// A parte com rede fica em scripts/store-routes.mjs (rotas da zona) e scripts/release-store.mjs (orquestração). Nada aqui publica.
import { createHash } from 'node:crypto';
import { STORES } from '../../src/stores.js';
import { FEATURE_NAMES } from '../../src/features.js';

// Só estas lojas passam por este release. A Use Sul tem o SEU release (release-navbar.sh) e NUNCA é tocada daqui; "all" não existe: um comando = um Worker.
export const RELEASABLE = Object.freeze(['norte', 'centro']);
// As oito features estáveis já ao ar na Sul (todas as do código; nenhuma flag nova). A ordem é a canônica de features.js.
export const STORE_FEATURES = Object.freeze([...FEATURE_NAMES]);
export const CONSERVATIVE = 'allowlist';
export const CATALOG = 'product-catalog';
// Caminhos que NUNCA podem ter Worker (login, carrinho, checkout, pagamento, conta, administração), com ou sem query, nas rotas de qualquer loja.
export const TRANSACTIONAL = Object.freeze(['cart', 'checkout', 'store_sessions', 'login', 'orders', 'payments', 'payment', 'admin', 'users', 'account']);

// Páginas "de casca" (home, listagem, coleções, sobre, conta/pedidos) — o MESMO desenho da Use Sul (docs/navbar-ink-busca.md, "Rotas da zona"):
//   1. a EXCLUSÃO `<host><base>/*` (rota SEM Worker, criada na zona pela API; nunca pelo `wrangler deploy`) tira do Worker, por padrão, tudo sob <base>/ (login, carrinho, checkout…);
//   2. rotas COM Worker, mais específicas que a exclusão, reabrem só as páginas autorizadas; a abrangente `<host><base>*` (só a home sem barra COM query) entra por último.
// Cloudflare não aceita `?` em padrão de rota: `<base>/?utm=…` (barra + query) cai na exclusão e fica nativa. Rotas não são versionadas: rollback de versão não as remove.
function shellPatterns(store) {
  const h = store.inkHost; const b = store.inkBase;
  return Object.freeze({
    exclusion: h + b + '/*',
    homeSlash: h + b + '/',
    specific: Object.freeze([h + b, h + b + '/products*', h + b + '/collections/*', h + b + '/about*', h + b + '/orders*']),
    broad: h + b + '*',
    // ordem de criação: exclusão e home com barra primeiro; a abrangente por último
    workerRoutes: Object.freeze([h + b + '/', h + b, h + b + '/products*', h + b + '/collections/*', h + b + '/about*', h + b + '/orders*', h + b + '*'])
  });
}

export function releaseStore(id) {
  if (typeof id !== 'string' || !RELEASABLE.includes(id)) {
    throw new Error(`loja inválida: ${JSON.stringify(id)} (use exatamente uma de: ${RELEASABLE.join(', ')}; a Use Sul tem o seu próprio release e "all" não existe)`);
  }
  const store = STORES[id];
  return Object.freeze({
    id, store,
    tomlFile: `wrangler.${id}.toml`,
    zoneName: store.inkHost.replace(/^www\./, ''),
    kvTitle: `use-${id}-cart-refs`,
    confirmPhrase: `PUBLICAR-${id.toUpperCase()}-INK`,
    rollbackPhrase: `REVERTER-${id.toUpperCase()}-INK`,
    shellPhrase: `PUBLICAR-CASCA-${id.toUpperCase()}-INK`,
    shellRollbackPhrase: `REVERTER-CASCA-${id.toUpperCase()}-INK`,
    routePatterns: Object.freeze([store.inkHost + store.inkBase + '/product/*', store.inkHost + '/__origens/*']),
    shell: shellPatterns(store)
  });
}

// ── configuração: o arquivo TOML TEM de ser o da loja pedida (uma combinação errada de storeId/host/prefixo/KV é recusada antes de qualquer deploy) ──
const tomlValue = (text, key) => new RegExp('^' + key + '\\s*=\\s*"([^"]*)"', 'm').exec(text)?.[1] ?? null;
export function configProblems(tomlText, rel) {
  const { store } = rel; const problems = [];
  if (tomlValue(tomlText, 'name') !== store.workerName) problems.push(`name do TOML = ${tomlValue(tomlText, 'name')} (esperado ${store.workerName})`);
  if (tomlValue(tomlText, 'STORE_ID') !== rel.id) problems.push(`STORE_ID do TOML = ${tomlValue(tomlText, 'STORE_ID')} (esperado ${rel.id})`);
  const routes = [...tomlText.matchAll(/\[\[routes\]\]\s*\npattern = "([^"]+)"\s*\nzone_name = "([^"]+)"/g)].map((m) => ({ pattern: m[1], zone: m[2] }));
  const expected = [...rel.routePatterns, ...rel.shell.workerRoutes];
  if (JSON.stringify(routes.map((r) => r.pattern)) !== JSON.stringify(expected)) problems.push(`rotas do TOML [${routes.map((r) => r.pattern).join(', ')}] != esperadas [${expected.join(', ')}]`);
  if (routes.some((r) => r.pattern === rel.shell.exclusion)) problems.push('a exclusão (sem Worker) NÃO pode estar no TOML: o wrangler só declara rotas COM Worker; ela é criada na zona por store-routes.mjs');
  if (routes.some((r) => r.zone !== rel.zoneName)) problems.push('zone_name do TOML diferente da zona da loja');
  const bindings = [...tomlText.matchAll(/^binding = "([^"]+)"/gm)].map((m) => m[1]);
  if (JSON.stringify(bindings) !== JSON.stringify([store.kvBinding])) problems.push(`bindings KV do TOML [${bindings.join(', ')}] != [${store.kvBinding}]`);
  if (tomlValue(tomlText, 'ENABLE_WIDGET') !== 'false') problems.push('ENABLE_WIDGET do TOML precisa ser "false" (fail-closed)');
  for (const other of Object.values(STORES).filter((s) => s.id !== rel.id)) {
    for (const literal of [other.inkHost, other.inkBase + '/', other.workerName]) if (tomlText.includes(literal)) problems.push(`o TOML menciona ${literal} (de outra loja)`);
    if (new RegExp('\\b' + other.kvBinding + '\\b').test(tomlText)) problems.push(`o TOML menciona o binding ${other.kvBinding} (de outra loja)`);
  }
  return problems;
}
// TOML resolvido: só troca o marcador do id do KV pelo id REAL (32 hex) do namespace da própria loja.
// `shell` (padrão false): as sete rotas de CASCA só ficam no arquivo resolvido quando a exclusão de zona já existe. O `wrangler deploy` SINCRONIZA as rotas COM Worker
// do script com o TOML (apaga as que não estão nele; a exclusão, sem Worker, ele não toca) — por isso, com a casca ligada, todas as sete TÊM de estar no arquivo.
export function resolveToml(tomlText, rel, kvId, { shell = false } = {}) {
  if (typeof kvId !== 'string' || !/^[0-9a-f]{32}$/.test(kvId)) throw new Error('id do namespace KV inválido');
  const marker = `REPLACE_WITH_${rel.store.kvBinding}_NAMESPACE_ID`;
  if (!tomlText.includes(marker)) throw new Error('marcador do id do KV ausente no TOML');
  let out = tomlText.replace(marker, kvId);
  if (!shell) for (const pattern of rel.shell.workerRoutes) out = out.replace(new RegExp('\\[\\[routes\\]\\]\\s*\\npattern = "' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*\\nzone_name = "[^"]+"\\s*\\n?'), '');
  return out;
}

// ── variáveis do deploy: sempre explícitas (o TOML é fail-closed); duas fases ──────────────────────────────────────────────────────────────────
export function releaseVars(rel, phase, samples) {
  const list = samples[rel.id] && samples[rel.id].allowlist;
  if (!Array.isArray(list) || list.length < 3) throw new Error('a loja precisa de pelo menos 3 produtos reais na allowlist (scripts/store-samples.json)');
  const prefix = rel.store.inkBase + '/product/';
  if (!list.every((p) => typeof p === 'string' && p.startsWith(prefix))) throw new Error('allowlist com caminho fora do prefixo da loja');
  if (phase !== CONSERVATIVE && phase !== CATALOG) throw new Error('fase inválida: ' + phase);
  return { STORE_ID: rel.id, ENABLE_WIDGET: 'true', WIDGET_SCOPE_MODE: phase, WIDGET_FEATURES: STORE_FEATURES.join(','), WIDGET_ALLOWLIST: list.join(',') };
}
// Argumentos do `wrangler deploy` (SEM shell). Recusa qualquer combinação em que o arquivo, o nome do Worker e o STORE_ID não sejam da mesma loja.
export function deployArgs(rel, configFile, vars) {
  if (vars.STORE_ID !== rel.id) throw new Error('STORE_ID das variáveis != loja do release');
  if (!/wrangler\.(norte|centro)(\.resolved)?\.toml$/.test(configFile) || !configFile.includes(rel.id)) throw new Error('arquivo de configuração não é o da loja ' + rel.id);
  const args = ['wrangler', 'deploy', '-c', configFile, '--name', rel.store.workerName];
  for (const key of ['STORE_ID', 'ENABLE_WIDGET', 'WIDGET_SCOPE_MODE', 'WIDGET_FEATURES', 'WIDGET_ALLOWLIST']) args.push('--var', `${key}:${vars[key]}`);
  return args;
}

// ── rotas da zona ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (routes) => (routes || []).map((r) => ({ id: r.id || null, pattern: r.pattern, script: r.script || null }));
const sortRoutes = (routes) => [...norm(routes)].sort((a, b) => (a.pattern + '|' + a.id).localeCompare(b.pattern + '|' + b.id));
export const snapshotDigest = (routes) => createHash('sha256').update(JSON.stringify(sortRoutes(routes).map((r) => [r.id, r.pattern, r.script]))).digest('hex');
export function buildSnapshot({ rel, zoneId, routes, now = new Date() }) {
  const list = sortRoutes(routes);
  return { schema: 1, captured_at: now.toISOString(), store: rel.id, zone: rel.zoneName, zone_id: zoneId, count: list.length, digest: snapshotDigest(list), routes: list };
}
// Snapshot ilegível, de outra loja/zona, adulterado ou divergente da zona ativa NÃO vale. `empty` (0 rotas) é um snapshot legítimo de uma zona sem rotas,
// mas NUNCA autoriza um restore (restaurar "nada" apagaria as rotas): o desfazer de uma loja nova é `retire`, que só remove as duas rotas conhecidas dela.
export function validateSnapshot(snap, rel, { zoneId = null } = {}) {
  const problems = [];
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return { ok: false, empty: false, problems: ['snapshot ilegível (não é um objeto)'] };
  if (snap.schema !== 1) problems.push('schema desconhecido');
  if (snap.store !== rel.id) problems.push(`snapshot de outra loja (${snap.store})`);
  if (snap.zone !== rel.zoneName) problems.push(`snapshot de outra zona (${snap.zone})`);
  if (typeof snap.zone_id !== 'string' || !/^[0-9a-f]{32}$/.test(snap.zone_id)) problems.push('zone_id ausente/malformado');
  else if (zoneId && snap.zone_id !== zoneId) problems.push('zone_id do snapshot != zona ativa');
  if (typeof snap.captured_at !== 'string' || Number.isNaN(Date.parse(snap.captured_at))) problems.push('captured_at inválido');
  if (!Array.isArray(snap.routes)) { problems.push('campo routes ausente (use o arquivo gerado por `store-routes.mjs snapshot`)'); return { ok: false, empty: false, problems }; }
  if (snap.count !== snap.routes.length) problems.push(`count ${snap.count} != ${snap.routes.length} rotas`);
  for (const r of snap.routes) {
    if (!r || typeof r.pattern !== 'string' || typeof r.id !== 'string' || !/^[0-9a-f]{32}$/.test(r.id) || !(r.script === null || typeof r.script === 'string')) { problems.push('rota malformada no snapshot'); break; }
  }
  if (!problems.length && snap.digest !== snapshotDigest(snap.routes)) problems.push('digest não confere (snapshot adulterado ou divergente)');
  return { ok: problems.length === 0, empty: problems.length === 0 && snap.routes.length === 0, problems };
}
const onStoreHost = (rel, pattern) => typeof pattern === 'string' && pattern.startsWith(rel.store.inkHost + '/');
// Todas as rotas que ESTE release pode criar/tocar na zona da loja: as duas de produto + a exclusão + as sete de casca. Nada fora disso, nunca.
const ownedPatterns = (rel) => [...rel.routePatterns, rel.shell.exclusion, ...rel.shell.workerRoutes];
const allowedWorkerPatterns = (rel) => new Set([...rel.routePatterns, ...rel.shell.workerRoutes]);
// Estado das rotas da loja frente ao esperado. Rotas de outros hosts/Workers são só reportadas (nunca tocadas).
// stage: baseline (nada nosso) | final (só produto + /__origens) | shell-staged (final + exclusão + home com barra) | shell (tudo) | parcial
export function routeState(current, rel) {
  const cur = norm(current); const worker = rel.store.workerName; const sh = rel.shell;
  const owned = new Set(ownedPatterns(rel));
  const ours = cur.filter((r) => owned.has(r.pattern));
  const has = (pattern, withWorker) => ours.some((r) => r.pattern === pattern && (withWorker ? r.script === worker : !r.script));
  const missing = rel.routePatterns.filter((p) => !has(p, true));
  const conflicts = ours.filter((r) => (r.pattern === sh.exclusion ? !!r.script : r.script !== worker)).map((r) => `${r.pattern} existe com ${r.script || '(sem Worker)'} (esperado ${r.pattern === sh.exclusion ? 'SEM Worker' : worker})`);
  const foreignOnStoreHost = cur.filter((r) => onStoreHost(rel, r.pattern) && !owned.has(r.pattern)).map((r) => `${r.pattern} -> ${r.script || '(sem Worker)'}`);
  const product = missing.length === 0;
  const excl = has(sh.exclusion, false);
  const shellWorker = sh.workerRoutes.filter((p) => has(p, true));
  let stage = 'parcial';
  if (ours.length === 0) stage = 'baseline';
  else if (conflicts.length === 0 && product && !excl && shellWorker.length === 0) stage = 'final';
  else if (conflicts.length === 0 && product && excl && shellWorker.length === 1 && shellWorker[0] === sh.homeSlash) stage = 'shell-staged';
  else if (conflicts.length === 0 && product && excl && shellWorker.length === sh.workerRoutes.length) stage = 'shell';
  return { ours, missing, conflicts, foreignOnStoreHost, stage, shellWorkerPresent: shellWorker.length, exclusion: excl };
}
// Segurança estática: só as rotas autorizadas podem ter o Worker da loja; a exclusão NUNCA tem Worker; a rota abrangente exige a exclusão ativa;
// e nenhuma rota (com Worker) do host da loja pode estar fora da lista autorizada (login, carrinho, checkout, pagamento, conta, administração…).
export function safetyProblems(current, rel) {
  const problems = []; const worker = rel.store.workerName; const allowed = allowedWorkerPatterns(rel); const rs = norm(current);
  for (const r of rs) {
    if (r.script === worker && !allowed.has(r.pattern)) problems.push(`rota com o Worker ${worker} fora da lista autorizada: ${r.pattern}`);
    if (r.script && onStoreHost(rel, r.pattern) && !allowed.has(r.pattern)) problems.push(`rota com Worker no host da loja fora da lista autorizada (caminho transacional/abrangente?): ${r.pattern}`);
    if (r.pattern === rel.shell.exclusion && r.script) problems.push(`a exclusão ${r.pattern} tem Worker (${r.script}): ela TEM de ser SEM Worker`);
  }
  const hasBroad = rs.some((r) => r.pattern === rel.shell.broad && r.script === worker);
  const hasExclusion = rs.some((r) => r.pattern === rel.shell.exclusion && !r.script);
  if (hasBroad && !hasExclusion) problems.push(`rota abrangente ${rel.shell.broad} ativa SEM a exclusão ${rel.shell.exclusion} (o Worker ficaria no caminho da compra)`);
  return [...new Set(problems)];
}
// Cria só o que falta, na ORDEM segura (nunca apaga nem troca rota que não seja nossa). `problems` bloqueia.
// stage: 'product' (as duas de produto; padrão) | 'shell-staged' (+ exclusão e home com barra) | 'shell' (+ as específicas e, por último, a abrangente).
export function planApply(current, rel, stage = 'product') {
  const st = routeState(current, rel); const worker = rel.store.workerName; const sh = rel.shell;
  const want = [{ pattern: rel.routePatterns[0], script: worker }, { pattern: rel.routePatterns[1], script: worker }];
  if (stage === 'shell-staged' || stage === 'shell') want.push({ pattern: sh.exclusion, script: null }, { pattern: sh.homeSlash, script: worker });
  if (stage === 'shell') for (const p of sh.workerRoutes.filter((x) => x !== sh.homeSlash)) want.push({ pattern: p, script: worker });
  if (!['product', 'shell-staged', 'shell'].includes(stage)) throw new Error('estágio inválido: ' + stage);
  const have = new Set(st.ours.map((r) => r.pattern));
  return { create: want.filter((w) => !have.has(w.pattern)), problems: [...st.conflicts, ...safetyProblems(current, rel)] };
}
// Desfazer: remove SOMENTE rotas conhecidas nossas (Worker da loja; a exclusão sem Worker). scope 'all' (padrão) = todas as nossas (loja nova); 'shell' = só a casca
// (exclusão + as sete), mantendo as duas de produto. Nunca toca em outra rota, host ou Worker. Ordem: a abrangente e as específicas saem ANTES da exclusão.
export function planRetire(current, rel, scope = 'all') {
  const worker = rel.store.workerName; const sh = rel.shell; const rs = norm(current);
  const shellWorker = new Set(sh.workerRoutes); const product = new Set(rel.routePatterns);
  const pick = (r) => (scope === 'shell' ? (shellWorker.has(r.pattern) && r.script === worker) || (r.pattern === sh.exclusion && !r.script) : (product.has(r.pattern) || shellWorker.has(r.pattern)) && r.script === worker || (r.pattern === sh.exclusion && !r.script));
  if (scope !== 'all' && scope !== 'shell') throw new Error('escopo inválido: ' + scope);
  const order = (r) => (r.pattern === sh.exclusion ? 2 : (shellWorker.has(r.pattern) ? 0 : 1)); // casca com Worker -> produto -> exclusão por último
  const remove = rs.filter(pick).sort((a, b) => order(a) - order(b)).map((r) => ({ id: r.id, pattern: r.pattern }));
  return { remove };
}
// Restore a partir de um snapshot: só com snapshot VÁLIDO e NÃO vazio; só no host da loja; recusa qualquer divergência. (Vazio -> use `retire`.)
export function planRestore(snap, current, rel, { zoneId = null } = {}) {
  const v = validateSnapshot(snap, rel, { zoneId });
  if (!v.ok) throw new Error('restore recusado: ' + v.problems.join('; '));
  if (v.empty) throw new Error('restore recusado: snapshot vazio (zona sem rotas quando foi capturado); para desfazer a loja use `retire`, que remove só as duas rotas dela');
  const want = new Map(norm(snap.routes).filter((r) => onStoreHost(rel, r.pattern)).map((r) => [r.pattern, r]));
  const cur = norm(current).filter((r) => onStoreHost(rel, r.pattern));
  const owned = new Set(ownedPatterns(rel));
  const remove = cur.filter((c) => !want.has(c.pattern) && owned.has(c.pattern)); // só as nossas; qualquer outra rota do host fica como está
  const curMap = new Map(cur.map((c) => [c.pattern, c]));
  const create = []; const update = [];
  for (const w of want.values()) { const c = curMap.get(w.pattern); if (!c) create.push(w); else if (c.script !== w.script) update.push({ ...c, script: w.script }); }
  return { remove, create, update };
}

// ── health e smoke ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `shell`: as páginas de casca estão ligadas? (false até o release da casca; true depois)
export function evaluateStoreHealth(health, rel, { scope, allowlistSize, version = null, shell = false }) {
  const problems = [];
  if (!health || typeof health !== 'object') return { ok: false, problems: ['health ilegível'] };
  if (health.service !== rel.store.workerName) problems.push(`service ${health.service} (esperado ${rel.store.workerName})`);
  if (health.store !== rel.id || health.store_status !== 'ok') problems.push(`store ${health.store}/${health.store_status} (esperado ${rel.id}/ok)`);
  if (health.widget_mode !== 'true') problems.push('widget_mode != true');
  if (health.kv_bound !== true) problems.push('binding do KV da loja ausente (kv_bound != true)');
  if (health.scope_mode !== scope || health.scope_status !== 'ok') problems.push(`scope ${health.scope_mode}/${health.scope_status} (esperado ${scope}/ok)`);
  if (health.allowlist_status !== 'ok' || health.allowlist_size !== allowlistSize) problems.push(`allowlist ${health.allowlist_status}/${health.allowlist_size} (esperado ok/${allowlistSize})`);
  if (health.features_status !== 'ok') problems.push('features_status != ok');
  const features = Array.isArray(health.widget_features) ? health.widget_features : [];
  for (const f of STORE_FEATURES) if (!features.includes(f)) problems.push('feature ausente: ' + f);
  for (const f of features) if (!STORE_FEATURES.includes(f)) problems.push('feature inesperada: ' + f);
  if (health.shell_pages !== shell) problems.push(`shell_pages ${health.shell_pages} (esperado ${shell})`);
  if (version && health.version !== version) problems.push(`version ${health.version} (esperado ${version})`);
  return { ok: problems.length === 0, problems };
}
export const countLoaders = (html) => (String(html).match(/\/__origens\/loader\.js\?v=/g) || []).length;

// Sondas de EXECUÇÃO do Worker (wrangler tail): exec=true = tem de ser invocado; exec=false = NÃO pode ser (com e sem query); info = mostrada, sem veredito.
// stage 'product' (só produto) ou 'shell-staged' | 'shell' (páginas de casca). `collection` = uma coleção REAL da loja (samples.collection).
export function probeSet(rel, samples, stage = 'product') {
  if (!['product', 'shell-staged', 'shell'].includes(stage)) throw new Error('estágio inválido: ' + stage);
  const base = rel.store.inkBase; const sample = samples[rel.id];
  const transactional = [`${base}/cart`, `${base}/cart?x=1`, `${base}/checkout`, `${base}/checkout/contact_and_shipping_details`, `${base}/checkout/contact_and_shipping_details?x=1`,
    `${base}/store_sessions/new`, `${base}/store_sessions/new?next=%2F`, `${base}/login`, `${base}/login?x=1`];
  const shellPaths = [`${base}/products`, `${base}/products?product_type=1`, `${base}/collections/${sample.collection}`, `${base}/about`, `${base}/orders/trackings`, `${base}/orders?x=1`];
  const product = [...sample.allowlist, sample.allowlist[0] + '?utm_source=probe', '/__origens/health'];
  if (stage === 'product') return { exec: product, skip: [...transactional, `${base}/orders`, base, `${base}/`, ...shellPaths], info: [] };
  // shell-staged: só a home COM barra executa; as demais páginas de casca ainda caem na exclusão (nativas).
  if (stage === 'shell-staged') return { exec: [...product, `${base}/`], skip: [...transactional, `${base}/orders`, base, ...shellPaths], info: [`${base}/?utm_source=probe`] };
  // shell: casca autorizada executa (com e sem query); login, carrinho e checkout continuam sem Worker. `<base>/?x` (barra + query) cai na exclusão: lacuna conhecida, só informativa.
  return { exec: [...product, ...shellPaths, `${base}/`, base, `${base}?utm_source=probe`], skip: transactional, info: [`${base}/?utm_source=probe`] };
}
