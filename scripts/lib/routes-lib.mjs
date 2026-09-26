// Rotas do Worker na zona usesul.com.br: modelo PURO (sem rede) do que existe, do que o release precisa e de como desfazer.
// Testado em test/routes-lib.test.js. A parte com rede (API da Cloudflare) fica em scripts/zone-routes.mjs.
export const ZONE_NAME = 'usesul.com.br';
export const WORKER = 'use-sul-widget';
export const HOST = 'www.usesul.com.br';
const P = (path) => HOST + path;

// Rotas que JÁ existiam antes do release de casca (produto, loader/gateway, e as cinco de casca criadas no deploy 4.6 que foi revertido).
export const BASELINE_ROUTES = [
  { pattern: P('/usesul/product/*'), worker: true },
  { pattern: P('/__origens/*'), worker: true },
  { pattern: P('/usesul'), worker: true },
  { pattern: P('/usesul/products*'), worker: true },
  { pattern: P('/usesul/collections/*'), worker: true },
  { pattern: P('/usesul/about*'), worker: true },
  { pattern: P('/usesul/orders*'), worker: true },
];
// Exclusão: nenhum Worker associado. Gerenciada NO NÍVEL DA ZONA (API de rotas), nunca pelo `wrangler deploy` (o TOML só declara rotas COM script).
export const EXCLUSION = { pattern: P('/usesul/*'), worker: false };
// Home com barra final, SEM query: a Cloudflare recusa padrão de rota com query string (erro 10022), então `/usesul/?utm=…` NÃO tem como ser coberta por rota;
// ela cai na exclusão (cabeçalho nativo da INK, fail-open). Só um redirecionamento de zona (/usesul/ -> /usesul, com a query) resolveria — ver docs/navbar-ink-busca.md.
export const HOME_SLASH_ROUTES = [{ pattern: P('/usesul/'), worker: true }];
// Rota abrangente (só ativada por último, com a exclusão e a home com barra já validadas).
export const BROAD = { pattern: P('/usesul*'), worker: true };

export const STAGES = {
  baseline: BASELINE_ROUTES,
  staged: [...BASELINE_ROUTES, EXCLUSION, ...HOME_SLASH_ROUTES],
  final: [...BASELINE_ROUTES, EXCLUSION, ...HOME_SLASH_ROUTES, BROAD],
};
// O que o TOML (wrangler deploy) declara: TODAS as rotas COM Worker do estado final; a exclusão fica de fora por construção.
export const TOML_ROUTES = STAGES.final.filter((r) => r.worker).map((r) => r.pattern);

// Normaliza a resposta da API (script null/ausente = sem Worker).
export const normalize = (routes) => (routes || []).map((r) => ({ id: r.id || null, pattern: r.pattern, script: r.script || null }));
export const bySignature = (routes) => normalize(routes).map((r) => `${r.pattern} -> ${r.script || '(sem Worker)'}`).sort();

// Compara as rotas atuais com um estado esperado. Retorna { ok, missing[], extra[], wrongScript[] } (tudo em texto).
export function diffRoutes(current, stage) {
  const want = STAGES[stage];
  if (!want) throw new Error('estágio desconhecido: ' + stage);
  const cur = new Map(normalize(current).map((r) => [r.pattern, r]));
  const missing = []; const wrongScript = [];
  for (const w of want) {
    const c = cur.get(w.pattern);
    if (!c) { missing.push(w.pattern); continue; }
    if (w.worker && c.script !== WORKER) wrongScript.push(`${w.pattern}: ${c.script || '(sem Worker)'} (esperado ${WORKER})`);
    if (!w.worker && c.script) wrongScript.push(`${w.pattern}: ${c.script} (esperado SEM Worker)`);
  }
  const wanted = new Set(want.map((w) => w.pattern));
  const extra = [...cur.keys()].filter((p) => !wanted.has(p));
  return { ok: !missing.length && !extra.length && !wrongScript.length, missing, extra, wrongScript };
}

// Só nossas rotas (host www da loja): o release nunca toca em rota de outra loja/host, mesmo que apareça na zona.
export const isOurs = (pattern) => typeof pattern === 'string' && pattern.startsWith(HOST + '/');

// Operações para levar o estado ATUAL até um estágio (só cria; nunca apaga nem troca script de rota que não seja a nossa).
// Retorna { create: [{pattern, worker}], problems: [] }. `problems` bloqueia (rota nossa existente com script diferente, etc.).
export function planToStage(current, stage) {
  const want = STAGES[stage];
  const cur = new Map(normalize(current).map((r) => [r.pattern, r]));
  const create = []; const problems = [];
  for (const w of want) {
    const c = cur.get(w.pattern);
    if (!c) { create.push(w); continue; }
    if (w.worker && c.script !== WORKER) problems.push(`${w.pattern} existe com ${c.script || '(sem Worker)'}; esperado ${WORKER}`);
    if (!w.worker && c.script) problems.push(`${w.pattern} existe COM Worker (${c.script}); esperado a exclusão sem Worker`);
  }
  return { create, problems };
}

// Restauração a partir de um snapshot: apaga nossas rotas que NÃO estavam no snapshot e recria as que sumiram ou mudaram de script. Nada fora do host www.
export function planRestore(snapshot, current) {
  // Trava contra snapshot ilegível/vazio: sem ela, "restaurar" apagaria TODAS as rotas nossas (aconteceu num drill com um arquivo de formato errado).
  if (!Array.isArray(snapshot) || !normalize(snapshot).some((r) => isOurs(r.pattern) && r.script)) throw new Error('snapshot inválido ou sem nenhuma rota nossa com Worker: restauração recusada');
  const snap = new Map(normalize(snapshot).filter((r) => isOurs(r.pattern)).map((r) => [r.pattern, r]));
  const cur = normalize(current).filter((r) => isOurs(r.pattern));
  const remove = []; const create = []; const update = [];
  for (const c of cur) if (!snap.has(c.pattern)) remove.push(c);
  const curMap = new Map(cur.map((c) => [c.pattern, c]));
  for (const s of snap.values()) {
    const c = curMap.get(s.pattern);
    if (!c) create.push(s);
    else if ((c.script || null) !== (s.script || null)) update.push({ ...c, script: s.script });
  }
  return { remove, create, update };
}

// Casamento de padrão de rota da Cloudflare: `*` = qualquer sequência (inclui `/` e `?`), o resto literal. O casamento é sobre host + caminho + query.
export function matchesPattern(pattern, hostAndPathAndQuery) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(hostAndPathAndQuery);
}

// MODELO da resolução (o mais específico vence: mais caracteres literais; empate: sem curinga). Serve para travar o DESENHO nos testes unitários;
// a prova real é o ensaio com `wrangler tail` (scripts/zone-routes.mjs rehearse/probe), porque a regra vale na Cloudflare, não neste modelo.
export function resolveRoute(routes, hostAndPathAndQuery) {
  const hits = normalize(routes).filter((r) => matchesPattern(r.pattern, hostAndPathAndQuery));
  const literal = (p) => p.replace(/\*/g, '').length;
  hits.sort((a, b) => literal(b.pattern) - literal(a.pattern) || (a.pattern.includes('*') ? 1 : 0) - (b.pattern.includes('*') ? 1 : 0));
  return hits[0] || null;
}

// Sondas de EXECUÇÃO. exec=true: o Worker TEM de ser invocado; exec=false: NÃO pode ser. `base` permite o ensaio num prefixo inofensivo.
// (Transacional aqui = login, carrinho, checkout, com e sem query string.)
export function probeSet(stage, base = '/usesul') {
  // `info`: mostradas, sem veredito (lacuna conhecida: home com barra E query).
  const exec = [`${base}/product/serra-catarinense`, `${base}/products`, `${base}/products?product_type=1`, `${base}/collections/novidades`, `${base}/about`, `${base}/orders/trackings`, `${base}/orders?x=1`];
  const skip = [`${base}/cart`, `${base}/cart?x=1`, `${base}/checkout`, `${base}/checkout/contact_and_shipping_details`, `${base}/checkout/contact_and_shipping_details?x=1`,
    `${base}/store_sessions/new`, `${base}/store_sessions/new?next=%2Fusesul%2Forders`, `${base}/login`, `${base}/login?x=1`];
  if (stage === 'baseline') exec.push(base); // exata: já existia
  const info = [];
  if (stage === 'staged' || stage === 'final') { exec.push(`${base}/`); info.push(`${base}/?utm_source=probe`); }
  if (stage === 'final') exec.push(base, `${base}?utm_source=probe`);
  return { exec, skip, info };
}

// Segurança estática: nenhuma rota COM Worker pode ser mais ampla que as permitidas, e a exclusão precisa existir quando a abrangente existe.
export function safetyProblems(routes) {
  const rs = normalize(routes).filter((r) => isOurs(r.pattern));
  const problems = [];
  const allowed = new Set(STAGES.final.filter((r) => r.worker).map((r) => r.pattern));
  for (const r of rs) if (r.script && !allowed.has(r.pattern)) problems.push(`rota com Worker fora da lista autorizada: ${r.pattern}`);
  const hasBroad = rs.some((r) => r.pattern === BROAD.pattern && r.script);
  const hasExclusion = rs.some((r) => r.pattern === EXCLUSION.pattern && !r.script);
  if (hasBroad && !hasExclusion) problems.push('rota abrangente /usesul* ativa SEM a exclusão /usesul/* (o Worker ficaria no caminho da compra)');
  return problems;
}
