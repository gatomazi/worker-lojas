#!/usr/bin/env bash
# RELEASE DO TEMA DA COMPRA NA INK (Sul): liga as chaves do tema (theme-pdp, theme-cart; theme-checkout ou theme-account com --add) no Worker use-sul-widget PRESERVANDO o que está em produção.
#
#   bash scripts/release-tema.sh --check     <- SOMENTE LEITURA: tema publicado no storefront, health, rotas da zona x TOML, captura da versão ativa,
#                                               plano e dry-run com as variáveis capturadas.
#   bash scripts/release-tema.sh --deploy    <- ÚNICA forma de publicar. Sem --deploy/--check nada acontece (mostra a ajuda e sai).
#   --add=theme-checkout                     <- liga o tema do checkout (padrão: theme-pdp,theme-cart). As duas rotas do checkout vêm do TOML com este
#                                               deploy; depois, smoke nas duas telas com TEMA_CHECKOUT_UUID=<carrinho de TESTE> (só GET; o uuid nunca é
#                                               gravado nem impresso) e a sonda de execução (node scripts/checkout-routes.mjs probe).
#   --update                                 <- só código novo (CSS do tema, correções): as MESMAS chaves de hoje, nada ligado nem desligado. Confere o
#                                               produto, a casca e, se ligadas, a conta e (com TEMA_CHECKOUT_UUID) o checkout.
#   --remove=size-fit                        <- DESLIGA chaves que estão no ar (uma ou mais, separadas por vírgula; as do tema não). É um --update que tira
#                                               só essas: as demais seguem iguais e são conferidas como no --update; o health depois tem de ser o de antes
#                                               MENOS elas. Ignora --add. Rollback = a versão capturada (a chave volta).
#   --add=top-bar                            <- liga a "Faixa do topo" do CMS na faixa preta da INK (produto e casca; docs/top-bar.md). Antes, confere que
#                                               o storefront tem faixa publicada; depois, que /__origens/top-bar devolve as MESMAS mensagens, estilo e cores
#                                               de /api/top-bar/sul e que o loader traz o módulo da faixa. Rollback = a versão capturada (a faixa da INK volta).
#   --add=assistant                          <- liga o assistente "Pergunte aqui" (sem IA) no lugar do "Ajuda?" da INK (produto e casca; docs/assistente.md). Antes,
#                                               confere que o storefront publica o assistente LIGADO; depois, que /__origens/assistente devolve a MESMA abertura
#                                               de /api/assistente/sul e que o loader traz o módulo. Rollback = a versão capturada (o "Ajuda?" da INK volta).
#   --add=pdp-cep,pdp-coupons                <- liga o prazo de entrega na própria página (campo de CEP no lugar do modal) e os cupons em abas com "Copiar"
#                                               (docs/cep-cupons-pdp.md; uma chave ou as duas). Só navegador, nenhum gateway: depois, confere que o loader da PDP
#                                               traz o módulo de cada uma. Rollback = a versão capturada (o link do modal e o quadro de cupons da INK voltam).
#   --add=post-add-kit                       <- liga o "Monte seu kit" no modal "Produto adicionado ao carrinho" (docs/post-add-kit.md). Antes, confere que o
#                                               storefront responde /api/post-add-kit/sul (kit publicado ou desligado); depois, que /__origens/kit devolve o
#                                               MESMO kit (código e faixas) e que o loader da PDP traz o módulo. Rollback = a versão capturada (o modal da INK volta).
#   --add=product-wait                       <- liga a pílula "Criando camiseta…" da compra direta nas páginas da INK (produto e casca; docs/produto-em-criacao.md).
#                                               Antes, confere que o storefront responde /api/personalizar/produto/<id> (404 JSON para um id que não existe);
#                                               depois, que /__origens/produto/<id> responde o mesmo 404 JSON e que o loader traz o módulo. Rollback = a versão capturada.
#   --add=theme-account                      <- liga o tema da conta (login, pedidos, detalhe, rastreio, avaliação, trocas). As rotas da tela do login e de
#                                               trocas vêm do TOML com este deploy; depois, smoke do login (só CSS, nenhum loader, "Voltar"/símbolo para a home
#                                               do storefront) e do rastreio (casca), e a sonda (node scripts/checkout-routes.mjs probe --conta). Com a "Conta"
#                                               ainda desligada no painel, só AVISA e confere que o login segue intacto (a chave é o teto; o painel decide).
#
# Trava dupla: o argumento --deploy E a confirmação do proprietário (digite a frase pedida, ou exporte RELEASE_CONFIRM=PUBLICAR-TEMA-INK). Exige
# `npx wrangler login` FEITO PELO PROPRIETÁRIO na conta esperada. NÃO altera rotas, DNS, KV nem regras: as rotas da zona já estão no estado final
# da loja única e este script só confere que o TOML declara exatamente as mesmas. Nunca faz push/merge, nunca faz compra.
#
# Ordem do --deploy:
#   A. captura: versão ativa (para o rollback) + health + variáveis/bindings REAIS da versão; o plano preserva ENABLE_WIDGET, allowlist, escopo e as
#      features de hoje, e só acrescenta theme-pdp e theme-cart (as demais variáveis do TOML têm de ser iguais às da produção, senão para)
#   B. publica o código desta árvore (a main) com essas variáveis
#   C. health (features = as de antes + as duas do tema; modo, escopo, allowlist, domínio e regiões iguais) + smoke da página de produto (sinal do
#      tema no <body>, <link> do CSS, CSS 200 text/css com as regras, UM loader) + uma página de casca com UM loader
#   Falha em B ou C => `wrangler rollback` para a versão capturada e confirmação de que o health voltou ao que era.
#
# As rotas do checkout e as da conta estão no TOML (o deploy apaga as do Worker que ele não declara): o deploy que as cria (por grupo) e o rollback as apaga.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/global-common.sh"
# A loja única mudou de domínio: o health e o smoke são os do host novo (o global-common ainda fala do www.usesul.com.br, que só redireciona).
SITE_URL="${UO_TEST_SITE_URL:-https://loja.useorigens.com.br}"; HEALTH_URL="${UO_TEST_HEALTH_URL:-$SITE_URL/__origens/health}"
SAMPLE_PDP="$SITE_URL/useorigens/product/florianopolis-legado-sc-b88373a3-9f47-418d-a6b4-f27757ac3fa4"
SHELL_PAGE="$SITE_URL/useorigens/products"
LOGIN_PAGE="$SITE_URL/useorigens/store_sessions/new"
TRACKING_PAGE="$SITE_URL/useorigens/orders/trackings"
STOREFRONT_HOME="${STOREFRONT_URL}/sul"
PHRASE="PUBLICAR-TEMA-INK"
usage() { sed -n '2,41p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
die() { log "PARADO: $*"; exit 1; }

MODE=""; ADD="theme-pdp,theme-cart"; UPDATE=0; REMOVE=""
for arg in "$@"; do case "$arg" in --deploy) MODE=deploy ;; --check) MODE=check ;; --add=*) ADD="${arg#--add=}" ;; --update) UPDATE=1; ADD="" ;; --remove=*) REMOVE="${arg#--remove=}" ;; -h|--help) usage; exit 0 ;; *) usage; log ""; log "argumento desconhecido: $arg"; exit 2 ;; esac; done
if [ -n "$REMOVE" ]; then
  ! printf '%s' "$REMOVE" | tr ',' '\n' | grep -qvxE 'promo-fab|auto-recommendations|pdp-share|size-guide|pdp-guide|size-fit|top-bar|cart-incentive|assistant|pdp-cep|pdp-coupons|post-add-kit|product-wait' || { log "--remove aceita só chaves fora do tema (recebido: $REMOVE)"; exit 2; }
  UPDATE=1; ADD=""
fi
[ "$UPDATE" = 1 ] || ! printf '%s' "$ADD" | tr ',' '\n' | grep -qvxE 'theme-pdp|theme-cart|theme-checkout|theme-account|top-bar|assistant|pdp-cep|pdp-coupons|post-add-kit|product-wait' || { log "--add aceita só theme-pdp, theme-cart, theme-checkout, theme-account, top-bar, assistant, pdp-cep, pdp-coupons, post-add-kit e product-wait (recebido: $ADD)"; exit 2; }
WITH_CHECKOUT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx theme-checkout && WITH_CHECKOUT=1
WITH_ACCOUNT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx theme-account && WITH_ACCOUNT=1
WITH_TOPBAR=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx top-bar && WITH_TOPBAR=1
WITH_ASSISTANT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx assistant && WITH_ASSISTANT=1
OFFERS=$(printf '%s' "$ADD" | tr ',' '\n' | grep -xE 'pdp-cep|pdp-coupons' | paste -sd, -)
WITH_KIT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx post-add-kit && WITH_KIT=1
WITH_WAIT=0; printf '%s' "$ADD" | tr ',' '\n' | grep -qx product-wait && WITH_WAIT=1
ACCOUNT_ON=0
CHECKOUT_UUID="${TEMA_CHECKOUT_UUID:-}"
[ -z "$CHECKOUT_UUID" ] || [[ "$CHECKOUT_UUID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { log "TEMA_CHECKOUT_UUID fora do formato de uuid"; exit 2; }
[ -n "$MODE" ] || { usage; log ""; log "Nada foi feito (falta --check ou --deploy)."; exit 2; }
cd "$ROOT" || exit 1
LIB="$ROOT/scripts/lib/theme-release-lib.mjs"
FAILS=(); WARNS=()
ok()   { log "  OK    $*"; }
warn() { WARNS+=("$*"); log "  WARN  $*"; }
bad()  { FAILS+=("$*"); log "  FAIL  $*"; }
json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];console.log(Array.isArray(v)?v.join(","):v)})' "$1"; }

# O tema publicado no storefront: sem ele (ou desligado no painel) o Worker liga as chaves e nada aparece.
storefront_theme() {
  local api; api=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/ink-theme/sul" 2>/dev/null)
  local out; out=$(printf '%s' "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.v!==1||j.region!=="sul"||!j.surfaces)process.exit(1);const on=Object.entries(j.surfaces).filter(([,v])=>v===true).map(([k])=>k);console.log((on.join(",")||"nenhuma")+" | paleta "+(j.palette||"neutra"));process.exit(j.surfaces.pdp&&j.surfaces.cart?0:3)}catch(e){process.exit(1)}})'); local rc=$?
  case $rc in 0) ok "storefront: tema da INK publicado (ligado: $out)" ;; 3) warn "storefront: tema publicado, mas página de produto e/ou carrinho DESLIGADOS no painel ($out): o Worker liga as chaves e essas partes seguem nativas" ;; *) bad "storefront: /api/ink-theme/sul indisponível ou fora do contrato v1" ;; esac
  # A conta (opcional no contrato: o storefront anterior nem manda o campo). Desligada = a chave do deploy fica pronta e nada aparece até o painel ligar.
  if printf '%s' "$api" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).surfaces.account===true?0:1)}catch(e){process.exit(1)}})'; then ACCOUNT_ON=1
  elif [ "$WITH_ACCOUNT" = 1 ]; then warn "storefront: a \"Conta\" está DESLIGADA no painel (ou o storefront ainda não publica surfaces.account): o deploy liga a chave, as páginas de conta seguem nativas e o smoke só confere que o login segue intacto"; fi
}

# Rotas COM o Worker na zona x as do TOML (o deploy publica as do TOML e APAGA as do Worker que ele não declara — medido em 17/10/2026). Iguais = o deploy não
# muda o roteamento. A zona sem um GRUPO inteiro de rotas de tema que o TOML declara (checkout: as duas telas; account: a tela do login e trocas) = o deploy
# cria esse grupo: esperado com a chave do grupo no --add; sem ela só avisa (sem a chave o Worker repassa a página; trocas vira casca com a navbar).
# Qualquer outra diferença para o release. `routes_state` imprime equal | creates:<grupos> | diverge:<detalhe>.
routes_state() {
  local live; live=$(node scripts/domain-move-routes.mjs plan 2>/dev/null) || { echo "diverge:rotas da zona ilegíveis (domain-move-routes.mjs plan)"; return; }
  LIVE="$live" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import(process.argv[1]).then((m) => {
      const groups = m.themeRouteGroups("loja.useorigens.com.br", "/useorigens");
      const toml = m.parseTomlRoutes(readFileSync(process.argv[2], "utf8")).sort(); const live = m.parseLiveRoutes(process.env.LIVE).sort();
      if (JSON.stringify(toml) === JSON.stringify(live)) return console.log("equal");
      const names = Object.keys(groups);
      for (let mask = 1; mask < 1 << names.length; mask++) {
        const created = names.filter((_, i) => mask & (1 << i));
        const missing = created.flatMap((g) => groups[g]);
        if (JSON.stringify(toml.filter((p) => !missing.includes(p))) === JSON.stringify(live)) return console.log("creates:" + created.join(","));
      }
      console.log("diverge:TOML [" + toml.join(" ") + "] x zona [" + live.join(" ") + "]");
    });' "$LIB" "$CFG"
}
CREATES=""
routes_match() {
  local st g; st=$(routes_state)
  case "$st" in
    equal) ok "rotas: as rotas COM Worker na zona são exatamente as do TOML (o deploy não muda o roteamento)" ;;
    creates:*)
      CREATES="${st#creates:}"
      for g in $(printf '%s' "$CREATES" | tr ',' ' '); do
        case "$g" in
          checkout) if [ "$WITH_CHECKOUT" = 1 ]; then ok "rotas: zona = TOML menos as duas telas do checkout, que este deploy cria (o rollback as apaga)"
                    else warn "rotas: o deploy vai criar as duas telas do checkout (TOML); sem theme-checkout o Worker só repassa a página"; fi ;;
          account)  if [ "$WITH_ACCOUNT" = 1 ]; then ok "rotas: zona = TOML menos a tela do login e trocas, que este deploy cria (o rollback as apaga)"
                    else warn "rotas: o deploy vai criar a tela do login e trocas (TOML); sem theme-account o login só é repassado e trocas ganha a navbar (casca)"; fi ;;
        esac
      done ;;
    *) bad "rotas da zona divergem do TOML: ${st#diverge:}" ;;
  esac
}

# Plano a partir da versão ativa: imprime o JSON do deploy ou os problemas (exit 1).
capture_plan() {
  local version="$1" health="$2" view
  view=$(cd "$ROOT" && $WRANGLER_CMD versions view "$version" --name "$WORKER_NAME" --json 2>/dev/null) || { log "não consegui ler a versão ativa ($version) com o Wrangler"; return 1; }
  T_VIEW="$view" T_HEALTH="$health" T_ADD="$ADD" T_REMOVE="$REMOVE" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const rl = await import(process.argv[1] + "/scripts/lib/release-lib.mjs"); const m = await import(process.argv[1] + "/scripts/lib/theme-release-lib.mjs");
    const toml = readFileSync(process.argv[1] + "/" + process.argv[2], "utf8");
    const bindings = [...toml.matchAll(/^binding = "([A-Za-z0-9_]+)"/gm)].map((x) => x[1]);
    let health = null; try { health = JSON.parse(process.env.T_HEALTH); } catch (_) {}
    const plan = m.planThemeRelease({ health, captured: rl.parseVersionBindings(process.env.T_VIEW), tomlBindings: bindings, tomlVars: m.parseTomlVars(toml), add: process.env.T_ADD.split(",").filter(Boolean), remove: process.env.T_REMOVE.split(",").filter(Boolean) });
    if (!plan.ok) { console.error(plan.problems.join("\n")); process.exit(1); }
    console.log(JSON.stringify(plan.deploy));' "$ROOT" "$CFG"
}

deploy_theme() {
  local plan="$1" mode="${2:-}" allow feats scope
  allow=$(printf '%s' "$plan" | json_field WIDGET_ALLOWLIST); feats=$(printf '%s' "$plan" | json_field WIDGET_FEATURES); scope=$(printf '%s' "$plan" | json_field WIDGET_SCOPE_MODE)
  log "── deploy do tema (${mode:-REAL}) — configuração não secreta ──"
  log "   ENABLE_WIDGET=true · WIDGET_SCOPE_MODE=$scope · WIDGET_ALLOWLIST=$(printf '%s\n' "$allow" | tr ',' '\n' | grep -c .) caminho(s) (preservados)"
  log "   WIDGET_FEATURES=$feats"
  if [ "$mode" = "--dry-run" ]; then
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --dry-run --outdir "${TMPDIR:-/tmp}/release-tema-dry" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$allow" --var "WIDGET_FEATURES:$feats" --var "WIDGET_SCOPE_MODE:$scope")
  else
    (cd "$ROOT" && npx wrangler deploy -c "$CFG" --message "release-tema: $([ -n "$REMOVE" ] && echo "remove $REMOVE" || echo "${ADD:-update}") (git $(git rev-parse --short HEAD))" --var ENABLE_WIDGET:true --var "WIDGET_ALLOWLIST:$allow" --var "WIDGET_FEATURES:$feats" --var "WIDGET_SCOPE_MODE:$scope")
  fi
}

# Smoke da página de produto com o tema (tenta algumas vezes: a configuração do tema é lida do storefront com cache de 60 s).
# A faixa do topo: o que a INK serve tem de ser a faixa publicada no storefront (mensagens, estilo, cores) e o loader tem de trazer o módulo dela.
smoke_top_bar() {
  local i ink site loader r
  site=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/top-bar/sul" 2>/dev/null)
  for i in 1 2 3 4 5 6; do
    ink=$(curl -sS --max-time 15 "$SITE_URL/__origens/top-bar?origens_smoke=$(date +%s)" 2>/dev/null)
    loader=$(curl -sS --max-time 20 "$SITE_URL$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null | grep -oE '/__origens/loader\.js\?v=[^"]+' | head -1 | sed 's/&amp;/\&/g')" 2>/dev/null)
    r=$(T_INK="$ink" T_SITE="$site" T_LOADER="$loader" node --input-type=module -e 'const p=(s)=>{try{return JSON.parse(s)}catch(e){return null}};import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluateTopBar(p(process.env.T_INK),p(process.env.T_SITE),process.env.T_LOADER))))' "$LIB")
    [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "faixa do topo: a INK serve a faixa do storefront ($(printf '%s' "$r" | json_field messages)) e o loader traz o módulo"; return 0; }
    [ "$i" = 6 ] && { bad "faixa do topo: $(printf '%s' "$r" | json_field problems)"; return 1; }
    sleep 10
  done
}

# O assistente: o que a INK serve tem de ser a abertura publicada no storefront (ligado, texto, sugestões, WhatsApp, texto do botão, temas fixos) e o
# loader tem de trazer o módulo.
smoke_assistant() {
  local i ink site loader r
  site=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/assistente/sul" 2>/dev/null)
  for i in 1 2 3 4 5 6; do
    ink=$(curl -sS --max-time 15 "$SITE_URL/__origens/assistente?origens_r=sul&origens_smoke=$(date +%s)" 2>/dev/null)
    loader=$(curl -sS --max-time 20 "$SITE_URL$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null | grep -oE '/__origens/loader\.js\?v=[^"]+' | head -1 | sed 's/&amp;/\&/g')" 2>/dev/null)
    r=$(T_INK="$ink" T_SITE="$site" T_LOADER="$loader" node --input-type=module -e 'const p=(s)=>{try{return JSON.parse(s)}catch(e){return null}};import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluateAssistant(p(process.env.T_INK),p(process.env.T_SITE),process.env.T_LOADER))))' "$LIB")
    [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "assistente: a INK serve a abertura do storefront e o loader traz o módulo"; return 0; }
    [ "$i" = 6 ] && { bad "assistente: $(printf '%s' "$r" | json_field problems)"; return 1; }
    sleep 10
  done
}

# Prazo e cupons à vista (pdp-cep, pdp-coupons): só navegador. O loader servido na PDP tem de trazer o módulo de cada chave.
smoke_pdp_offers() {
  local i loader r
  for i in 1 2 3 4 5 6; do
    loader=$(curl -sS --max-time 20 "$SITE_URL$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null | grep -oE '/__origens/loader\.js\?v=[^"]+' | head -1 | sed 's/&amp;/\&/g')" 2>/dev/null)
    r=$(T_LOADER="$loader" node --input-type=module -e 'import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluatePdpOffers(process.env.T_LOADER,process.argv[2].split(",").filter(Boolean)))))' "$LIB" "$OFFERS")
    [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "prazo e cupons: o loader da PDP traz $OFFERS"; return 0; }
    [ "$i" = 6 ] && { bad "prazo e cupons: $(printf '%s' "$r" | json_field problems)"; return 1; }
    sleep 10
  done
}

# "Monte seu kit": o que a INK serve tem de ser o kit que o storefront publica (código, tipo e faixas da promoção da INK) e o loader tem de trazer o módulo.
smoke_kit() {
  local i ink site loader r
  site=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/post-add-kit/sul" 2>/dev/null)
  for i in 1 2 3 4 5 6; do
    ink=$(curl -sS --max-time 15 "$SITE_URL/__origens/kit?origens_r=sul&origens_smoke=$(date +%s)" 2>/dev/null)
    loader=$(curl -sS --max-time 20 "$SITE_URL$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null | grep -oE '/__origens/loader\.js\?v=[^"]+' | head -1 | sed 's/&amp;/\&/g')" 2>/dev/null)
    r=$(T_INK="$ink" T_SITE="$site" T_LOADER="$loader" node --input-type=module -e 'const p=(s)=>{try{return JSON.parse(s)}catch(e){return null}};import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluatePostAddKit(p(process.env.T_INK),p(process.env.T_SITE),process.env.T_LOADER))))' "$LIB")
    [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "kit: a INK serve o kit do storefront ($(printf '%s' "$r" | json_field code)) e o loader traz o módulo"; return 0; }
    [ "$i" = 6 ] && { bad "kit: $(printf '%s' "$r" | json_field problems)"; return 1; }
    sleep 10
  done
}

# Camiseta em criação: GET de um id no formato que não existe (nenhum pedido real é tocado). Imprime { status, type, body } para evaluateProductWait.
probe_json() {
  local out code type body
  out=$(curl -sS --max-time 15 -o /tmp/produto-probe.$$ -w '%{http_code} %{content_type}' "$1" 2>/dev/null); code=${out%% *}; type=${out#* }
  body=$(head -c 2048 /tmp/produto-probe.$$ 2>/dev/null); rm -f /tmp/produto-probe.$$
  T_CODE="$code" T_TYPE="$type" T_BODY="$body" node -e 'console.log(JSON.stringify({status:Number(process.env.T_CODE),type:process.env.T_TYPE,body:process.env.T_BODY}))'
}
wait_probe_id() { node --input-type=module -e 'import(process.argv[1]).then((m)=>console.log(m.PRODUCT_WAIT_PROBE))' "$LIB"; }

# O storefront precisa ter a compra direta no ar: a rota de andamento responde 404 JSON para um id que não existe (uma página 404 em HTML = ainda não).
storefront_product_wait() {
  local site r; site=$(probe_json "$STOREFRONT_URL/api/personalizar/produto/$(wait_probe_id)")
  r=$(T_SITE="$site" node --input-type=module -e 'import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluateProductWait(JSON.parse(process.env.T_SITE)))))' "$LIB")
  if [ "$(printf '%s' "$r" | json_field ok)" = "true" ]; then ok "storefront: /api/personalizar/produto/<id> no ar (404 JSON para um id que não existe)"
  else bad "storefront: $(printf '%s' "$r" | json_field problems)"; fi
}

# Depois do deploy: /__origens/produto/<id> é o nosso gateway (o mesmo 404 JSON do storefront) e o loader da PDP traz o módulo.
smoke_product_wait() {
  local i site ink loader r id; id=$(wait_probe_id)
  site=$(probe_json "$STOREFRONT_URL/api/personalizar/produto/$id")
  for i in 1 2 3 4 5 6; do
    ink=$(probe_json "$SITE_URL/__origens/produto/$id")
    loader=$(curl -sS --max-time 20 "$SITE_URL$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null | grep -oE '/__origens/loader\.js\?v=[^"]+' | head -1 | sed 's/&amp;/\&/g')" 2>/dev/null)
    r=$(T_SITE="$site" T_INK="$ink" T_LOADER="$loader" node --input-type=module -e 'import(process.argv[1]).then((m)=>console.log(JSON.stringify(m.evaluateProductWait(JSON.parse(process.env.T_SITE),JSON.parse(process.env.T_INK),process.env.T_LOADER))))' "$LIB")
    [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "camiseta em criação: /__origens/produto/<id> é o gateway (404 JSON) e o loader traz o módulo"; return 0; }
    [ "$i" = 6 ] && { bad "camiseta em criação: $(printf '%s' "$r" | json_field problems)"; return 1; }
    sleep 10
  done
}

# O storefront precisa responder o kit no contrato v1. Desligado (kit null), a chave liga e o modal fica como a INK desenha até publicar ligado.
storefront_kit() {
  local on; on=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/post-add-kit/sul" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.v===1&&("kit" in j)?(j.kit?j.kit.code+" com "+j.kit.tiers.length+" faixas":"off"):"x")}catch(e){console.log("x")}})')
  if [ "$on" = x ]; then bad "storefront: /api/post-add-kit/sul indisponível ou fora do contrato v1 (o storefront com o kit já está no ar?)"
  elif [ "$on" = off ]; then warn "storefront: Monte seu kit DESLIGADO (ou sem promoção valendo na INK): a chave liga e o modal fica como a INK desenha até publicar ligado"
  else ok "storefront: kit publicado ($on)"; fi
}

# O storefront precisa ter o assistente publicado e LIGADO: desligado, a chave liga e nada muda na INK (o "Ajuda?" dela fica).
storefront_assistant() {
  local on; on=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/assistente/sul" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.v===1?String(j.enabled===true):"x")}catch(e){console.log("x")}})')
  if [ "$on" = true ]; then ok "storefront: assistente publicado e ligado"
  elif [ "$on" = false ]; then warn "storefront: assistente DESLIGADO no painel: a chave liga e a INK segue com o \"Ajuda?\" dela até publicar ligado"
  else bad "storefront: /api/assistente/sul indisponível ou fora do contrato v1"; fi
}

# O storefront precisa ter a faixa publicada: sem mensagem no ar, ligar a chave não muda nada na INK.
storefront_top_bar() {
  local n; n=$(curl -sS --max-time 15 "$STOREFRONT_URL/api/top-bar/sul" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.v===1&&Array.isArray(j.messages)?j.messages.length:-1)}catch(e){console.log(-1)}})')
  if [ "$n" -gt 0 ] 2>/dev/null; then ok "storefront: faixa do topo publicada ($n mensagem(ns) no ar)"
  elif [ "$n" = 0 ]; then warn "storefront: faixa do topo sem mensagem no ar agora: a chave liga e a INK segue com as frases dela até haver uma"
  else bad "storefront: /api/top-bar/sul indisponível ou fora do contrato v1"; fi
}

smoke_theme() {
  local i html css_path code type body res
  for i in 1 2 3 4 5 6; do
    html=$(curl -sS --max-time 20 "$SAMPLE_PDP?origens_smoke=$(date +%s)" 2>/dev/null)
    res=$(printf '%s' "$html" | node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);const r=m.evaluateThemePage(s);console.log(JSON.stringify(r))})' "$LIB")
    css_path=$(printf '%s' "$res" | json_field cssPath)
    if [ "$css_path" != "null" ] && [ -n "$css_path" ]; then
      code=$(curl -sS -o /tmp/tema-css.$$ --max-time 20 -w '%{http_code} %{content_type}' "$SITE_URL$css_path" 2>/dev/null); type=${code#* }; code=${code%% *}
      res=$(printf '%s' "$html" | T_CSS_STATUS="$code" T_CSS_TYPE="$type" node --input-type=module -e 'import { readFileSync } from "node:fs";let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);const r=m.evaluateThemePage(s,{status:Number(process.env.T_CSS_STATUS),type:process.env.T_CSS_TYPE,body:readFileSync(process.argv[2],"utf8")});console.log(JSON.stringify(r))})' "$LIB" /tmp/tema-css.$$)
      rm -f /tmp/tema-css.$$
    fi
    if [ "$(printf '%s' "$res" | json_field ok)" = "true" ]; then ok "produto: tema no <body>, CSS do tema 200 ($css_path), UM loader"; break; fi
    [ "$i" = 6 ] && { bad "produto: $(printf '%s' "$res" | json_field problems)"; return 1; }
    sleep 10
  done
  if [ "$WITH_CHECKOUT" = 1 ]; then
    local step page r
    for step in contact_and_shipping_details payment_methods; do
      for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        page=$(curl -sS --max-time 20 "$SITE_URL/useorigens/checkout/$step/$CHECKOUT_UUID" 2>/dev/null)
        r=$(printf '%s' "$page" | node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);console.log(JSON.stringify(m.evaluateCheckoutPage(s)))})' "$LIB")
        [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "checkout ($step): tema no <body>, CSS do checkout, nenhum loader"; break; }
        [ "$i" = 12 ] && { bad "checkout ($step): $(printf '%s' "$r" | json_field problems)"; return 1; }
        sleep 10
      done
    done
  fi
  if [ "$WITH_ACCOUNT" = 1 ]; then
    local page r
    if [ "$ACCOUNT_ON" = 1 ]; then
      for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        page=$(curl -sS --max-time 20 "$LOGIN_PAGE" 2>/dev/null)
        r=$(printf '%s' "$page" | T_HOME="$STOREFRONT_HOME" node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);console.log(JSON.stringify(m.evaluateAccountPage(s,{kind:"login",home:process.env.T_HOME})))})' "$LIB")
        [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "login: tema da conta no <body>, só o CSS (nenhum loader), \"Voltar\" e símbolo para $STOREFRONT_HOME"; break; }
        [ "$i" = 12 ] && { bad "login: $(printf '%s' "$r" | json_field problems)"; return 1; }
        sleep 10
      done
      for i in 1 2 3 4 5 6; do
        page=$(curl -sS --max-time 20 "$TRACKING_PAGE" 2>/dev/null)
        r=$(printf '%s' "$page" | node --input-type=module -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const m=await import(process.argv[1]);console.log(JSON.stringify(m.evaluateAccountPage(s,{kind:"shell"})))})' "$LIB")
        [ "$(printf '%s' "$r" | json_field ok)" = "true" ] && { ok "rastreio: tema da conta junto com a casca, UM loader"; break; }
        [ "$i" = 6 ] && { bad "rastreio: $(printf '%s' "$r" | json_field problems)"; return 1; }
        sleep 10
      done
    else
      # Conta desligada no painel: a chave está no ar, nada muda na página. Confere só que o login responde e segue sem nenhum script nosso.
      page=$(curl -sS --max-time 20 -w '\n%{http_code}' "$LOGIN_PAGE" 2>/dev/null)
      if [ "$(printf '%s' "$page" | tail -1)" = 200 ] && ! printf '%s' "$page" | grep -q '__origens/loader\.js'; then ok "login: responde 200 e segue nativo (a \"Conta\" está desligada no painel)"
      else bad "login: não respondeu 200 ou recebeu um loader com a conta desligada"; return 1; fi
    fi
  fi
  local n; n=$(curl -sS --max-time 20 "$SHELL_PAGE" 2>/dev/null | grep -o '/__origens/loader\.js?v=' | wc -l | tr -d ' ')
  [ "$n" = 1 ] && ok "casca ($SHELL_PAGE): UM loader" || { bad "casca: $n loader(s) (esperado 1)"; return 1; }
}

# A sonda lê o `wrangler tail`, que logo depois de um deploy pode perder eventos (30/10/2026: trocas e rastreio "sem invocação" logo após o deploy,
# com o smoke do rastreio provando que o Worker rodava lá; as duas sondas seguintes passaram). Uma reprovação é repetida UMA vez, 20 s depois: uma rota
# que de fato não executa (ou executa sem dever) reprova nas duas.
probe_routes() {
  local i
  for i in 1 2; do
    node scripts/checkout-routes.mjs probe "$@" 2>&1 | grep -v '^npm warn' | sed 's/^/   /'
    [ "${PIPESTATUS[0]}" = 0 ] && return 0
    [ "$i" = 1 ] && { log "   (sonda reprovada; o tail pode perder eventos logo após o deploy: repetindo em 20 s)"; sleep 20; }
  done
  return 1
}

log "== pré-condições =="
storefront_theme
[ "$WITH_TOPBAR" = 1 ] && storefront_top_bar
[ "$WITH_ASSISTANT" = 1 ] && storefront_assistant
[ "$WITH_KIT" = 1 ] && storefront_kit
[ "$WITH_WAIT" = 1 ] && storefront_product_wait
HEALTH_NOW=$(health_json 2>/dev/null) || HEALTH_NOW=""
# --update: confere o que já está ligado (a conta sempre; o checkout só com um carrinho de teste).
if [ "$UPDATE" = 1 ] && [ -n "$HEALTH_NOW" ]; then
  LIVE_FEATURES=$(printf '%s' "$HEALTH_NOW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s).widget_features||[]).join(",")))')
  # --remove: o que vai ser desligado não é conferido depois do deploy.
  [ -z "$REMOVE" ] || LIVE_FEATURES=$(printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -vxF -f <(printf '%s' "$REMOVE" | tr ',' '\n') | paste -sd, -)
  printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -qx theme-account && WITH_ACCOUNT=1
  printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -qx theme-checkout && [ -n "$CHECKOUT_UUID" ] && WITH_CHECKOUT=1
  # O assistente no ar: depois do deploy, a INK tem de servir a abertura, o texto do botão e os temas fixos que o storefront publica.
  printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -qx assistant && WITH_ASSISTANT=1
  # Prazo e cupons no ar: depois do deploy, o loader da PDP tem de continuar trazendo os módulos.
  OFFERS=$(printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -xE 'pdp-cep|pdp-coupons' | paste -sd, -)
  # O kit no ar: depois do deploy, a INK tem de servir o mesmo kit do storefront.
  printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -qx post-add-kit && WITH_KIT=1
  # A camiseta em criação no ar: depois do deploy, o gateway e o módulo continuam lá.
  printf '%s' "$LIVE_FEATURES" | tr ',' '\n' | grep -qx product-wait && WITH_WAIT=1
fi
[ -n "$HEALTH_NOW" ] && ok "health ($HEALTH_URL): $(printf '%s' "$HEALTH_NOW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log("loader "+h.version+", "+h.ink_host+", escopo "+h.scope_mode+", "+(h.widget_features||[]).length+" features")})')" || bad "health ilegível em $HEALTH_URL"
git diff --quiet HEAD -- "$CFG" 2>/dev/null && ok "$CFG sem alterações locais" || bad "$CFG modificado localmente"
git rev-parse --verify -q origin/main >/dev/null && { git diff --quiet origin/main -- src "$CFG" && ok "código e TOML idênticos aos da main" || warn "src/ ou $CFG diferem de origin/main: o deploy publica ESTA árvore"; }
routes_match
WHO=$(npx wrangler whoami 2>&1)
if echo "$WHO" | grep -qi 'logged in' && echo "$WHO" | grep -q "$EXPECTED_ACCOUNT_EMAIL"; then ok "wrangler autenticado como $EXPECTED_ACCOUNT_EMAIL"; else bad "wrangler não autenticado na conta $EXPECTED_ACCOUNT_EMAIL (o proprietário roda: npx wrangler login)"; fi

PREV_VERSION=""; PLAN=""
if [ ${#FAILS[@]} -eq 0 ]; then
  PREV_VERSION=$(active_version) || bad "versão ativa não capturável (necessária para o rollback)"
  if [ -n "$PREV_VERSION" ]; then
    if PLAN=$(capture_plan "$PREV_VERSION" "$HEALTH_NOW" 2>&1); then ok "versão ativa ${PREV_VERSION:0:8}… capturada; $([ -n "$REMOVE" ] && echo "tira $REMOVE das" || { [ "$UPDATE" = 1 ] && echo "só código novo, as mesmas"; } || echo "acrescenta $(printf '%s' "$PLAN" | json_field added) às") $(printf '%s' "$PLAN" | json_field before | tr ',' '\n' | wc -l | tr -d ' ') features de hoje"; else bad "plano: $(printf '%s' "$PLAN" | tr '\n' ';')"; PLAN=""; fi
  fi
fi

if [ "$MODE" = check ]; then
  if [ -n "$PLAN" ]; then DRY=$(deploy_theme "$PLAN" --dry-run 2>&1); [ $? -eq 0 ] && echo "$DRY" | grep -q 'CART_REFS' && ok "dry-run do bundle: $(echo "$DRY" | grep -o 'Total Upload: [^/]*/ gzip: [0-9.]* KiB')" || bad "dry-run falhou: $(echo "$DRY" | tail -3 | tr '\n' ' ')"; fi
  log ""; if [ ${#FAILS[@]} -eq 0 ]; then log "READY (${#WARNS[@]} pendência(s) acima). Nada foi publicado."; exit 0; else log "BLOCKED: $(IFS='; '; echo "${FAILS[*]}")"; exit 1; fi
fi

[ ${#FAILS[@]} -eq 0 ] || die "pré-condições reprovadas: $(IFS='; '; echo "${FAILS[*]}")"
[ "$WITH_CHECKOUT" = 0 ] || [ -n "$CHECKOUT_UUID" ] || die "theme-checkout pede TEMA_CHECKOUT_UUID=<uuid de um carrinho de TESTE> para conferir as duas telas (só GET)"
if [ "${RELEASE_CONFIRM:-}" != "$PHRASE" ]; then
  [ -t 0 ] || die "sem terminal interativo e sem RELEASE_CONFIRM=$PHRASE"
  read -r -p "Vai $([ -n "$REMOVE" ] && echo "DESLIGAR ($REMOVE)" || echo "ligar (${ADD:-só código novo})") no Worker da Sul em produção. Digite $PHRASE para continuar: " ANS; [ "$ANS" = "$PHRASE" ] || die "confirmação não digitada"
fi

log "== A. captura =="
PREV_HEALTH="$HEALTH_NOW"
mkdir -p .release; TS=$(date +%Y%m%d-%H%M%S); CAP=".release/tema-capture-$TS.json"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({captured_at:new Date().toISOString(),previous_version:process.argv[2],health:JSON.parse(process.argv[3])},null,1),{mode:0o600})' "$CAP" "$PREV_VERSION" "$PREV_HEALTH"
log "   versão de rollback: $PREV_VERSION — captura em $CAP"

rollback() {
  log ""; log "!!! ROLLBACK ($1) → versão capturada $PREV_VERSION"
  case ",$CREATES," in *,checkout,*) node scripts/checkout-routes.mjs remove 2>&1 | sed 's/^/!!! /' || log "!!! as rotas do checkout não foram apagadas: node scripts/checkout-routes.mjs remove" ;; esac
  case ",$CREATES," in *,account,*) node scripts/checkout-routes.mjs remove --conta 2>&1 | sed 's/^/!!! /' || log "!!! as rotas da conta não foram apagadas: node scripts/checkout-routes.mjs remove --conta" ;; esac
  if npx wrangler rollback "$PREV_VERSION" --name "$WORKER_NAME" --message "release-tema rollback: $1" --yes; then
    sleep 10
    if NOW=$(health_json) && node -e 'import(process.argv[1]).then((m)=>{const a=JSON.parse(process.argv[2]),b=JSON.parse(process.argv[3]);process.exit(m.sameConfig(a,b)&&a.ink_host===b.ink_host?0:1)})' "$ROOT/scripts/lib/release-lib.mjs" "$PREV_HEALTH" "$NOW"; then
      log "!!! rollback CONFIRMADO: o health voltou exatamente ao capturado."; return 0; fi
    log "!!! rollback aplicado, mas o health não confere com o capturado."
  fi
  log "!!! CRÍTICO: confira à mão: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes   (NUNCA publique sem as --var: o TOML é fail-closed)"; return 1
}
fail() { rollback "$1"; log ""; log "RELEASE ABORTADO: $1"; exit 1; }

log "== B. publicação =="
deploy_theme "$PLAN" || fail "deploy falhou"
sleep 10

log "== C. conferência =="
NOW_HEALTH=$(health_json) || fail "health ilegível após o deploy"
node -e 'import(process.argv[1]).then((m)=>process.exit(m.sameThemeConfig(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),process.argv[4].split(",").filter(Boolean),process.argv[5].split(",").filter(Boolean))?0:1))' "$LIB" "$PREV_HEALTH" "$NOW_HEALTH" "$ADD" "$REMOVE" && ok "health: features = as de antes${ADD:+ + $ADD}${REMOVE:+ − $REMOVE}; modo, escopo, allowlist, domínio e regiões iguais" || fail "o health pós-deploy não é o planejado: $(printf '%s' "$NOW_HEALTH" | head -c 400)"
[ "$(routes_state)" = equal ] && ok "rotas: zona = TOML depois do deploy" || fail "as rotas da zona não ficaram iguais às do TOML depois do deploy"
smoke_theme || fail "smoke do tema reprovado: $(IFS='; '; echo "${FAILS[*]}")"
if [ "$WITH_TOPBAR" = 1 ]; then smoke_top_bar || fail "smoke da faixa do topo reprovado: $(IFS='; '; echo "${FAILS[*]}")"; fi
if [ "$WITH_ASSISTANT" = 1 ]; then smoke_assistant || fail "smoke do assistente reprovado: $(IFS='; '; echo "${FAILS[*]}")"; fi
if [ -n "$OFFERS" ]; then smoke_pdp_offers || fail "smoke do prazo e dos cupons reprovado: $(IFS='; '; echo "${FAILS[*]}")"; fi
if [ "$WITH_KIT" = 1 ]; then smoke_kit || fail "smoke do kit reprovado: $(IFS='; '; echo "${FAILS[*]}")"; fi
if [ "$WITH_WAIT" = 1 ]; then smoke_product_wait || fail "smoke da camiseta em criação reprovado: $(IFS='; '; echo "${FAILS[*]}")"; fi
if [ "$WITH_CHECKOUT" = 1 ]; then
  probe_routes && ok "sonda: só as duas telas do checkout executam o Worker; envios, carrinho e login não" || fail "a sonda das rotas do checkout reprovou"
fi
if [ "$WITH_ACCOUNT" = 1 ]; then
  probe_routes --conta && ok "sonda: a tela do login e trocas executam o Worker; o POST do login, outros caminhos de sessão, carrinho e checkout não" || fail "a sonda das rotas da conta reprovou"
fi

log ""
log "RELEASE DO TEMA CONCLUÍDO: $([ -n "$REMOVE" ] && echo "$REMOVE desligado(s)" || { [ "$UPDATE" = 1 ] && echo "código novo, as mesmas chaves"; } || echo "$ADD ligado(s)") (versão anterior, para voltar: $PREV_VERSION)."
log "   Voltar a qualquer momento: npx wrangler rollback $PREV_VERSION --name $WORKER_NAME --yes"
log "   Ou desligar só a aparência, sem deploy: painel › Tema da INK › desmarcar e Publicar (as chaves do Worker são o teto; o painel decide)."
