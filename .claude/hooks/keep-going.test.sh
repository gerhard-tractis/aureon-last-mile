#!/usr/bin/env bash
# Tests de .claude/hooks/keep-going.sh
# Crea un repo git temporal por caso; no toca el repo real.
# Uso: bash .claude/hooks/keep-going.test.sh

set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/keep-going.sh"
PASS=0; FAIL=0

setup() { # $1 = nombre de rama
  local d; d="$(mktemp -d)"
  ( cd "$d"
    git init -q .
    git config user.email t@t.t; git config user.name t
    mkdir -p docs/specs .claude
    echo x > x; git add -A; git commit -qm init
    git checkout -qb "$1"
    cp "$HOOK" .claude/hooks-keep-going.sh 2>/dev/null || true
    mkdir -p .claude/hooks && cp "$HOOK" .claude/hooks/keep-going.sh
  )
  printf '%s' "$d"
}

spec() { # $1=dir $2=id $3...=headings
  local d="$1" id="$2"; shift 2
  { echo "# $id"; echo; echo "**Status:** in progress"; echo "**Verify:** unit"; echo
    for h in "$@"; do echo "### $h"; echo; done
  } > "$d/docs/specs/${id}-x.md"
}
spec_noverify() { # igual pero sin la linea **Verify:**
  local d="$1" id="$2"; shift 2
  { echo "# $id"; echo; echo "**Status:** in progress"; echo
    for h in "$@"; do echo "### $h"; echo; done
  } > "$d/docs/specs/${id}-x.md"
}

run() { # $1=dir $2=json  -> imprime "code|stderr"
  local d="$1" json="$2" out code
  out="$( cd "$d" && printf '%s' "$json" | bash .claude/hooks/keep-going.sh 2>&1 )"
  code=$?
  printf '%s|%s' "$code" "$out"
}

check() { # $1=nombre $2=esperado_code $3=resultado
  local got="${3%%|*}"
  if [ "$got" = "$2" ]; then
    echo "  ok   $1"; PASS=$((PASS+1))
  else
    echo "  FAIL $1 (esperaba exit $2, obtuvo $got)"; echo "       ${3#*|}"; FAIL=$((FAIL+1))
  fi
}

echo "keep-going.sh"

d="$(setup feat/spec-99-demo)"; spec "$d" spec-99 "Fase 1 [done]" "Fase 2 [pending]"
check "sin keep-going.on no opina" 0 "$(run "$d" '{}')"

touch "$d/.claude/keep-going.on"
check "habilitado + fase pending -> bloquea" 2 "$(run "$d" '{}')"

check "stop_hook_active corta el loop" 0 "$(run "$d" '{"stop_hook_active":true}')"

echo "bloqueo" > "$d/.claude/BLOCKED.md"
check "BLOCKED.md no vacio -> permite parar" 0 "$(run "$d" '{}')"
rm -f "$d/.claude/BLOCKED.md" "$d/.claude/.keep-going-count"

spec "$d" spec-99 "Fase 1 [done]" "Fase 2 [done]"
check "sin fases pending -> permite parar" 0 "$(run "$d" '{}')"

spec "$d" spec-99 "Fase 1 [pending]"
rm -f "$d/.claude/.keep-going-count"; echo 12 > "$d/.claude/.keep-going-count"
check "tope de iteraciones -> permite parar" 0 "$(run "$d" '{}')"

d2="$(setup feat/sin-numero)"; touch "$d2/.claude/keep-going.on"
spec "$d2" spec-99 "Fase 1 [pending]"
check "rama sin spec-NN -> no opina" 0 "$(run "$d2" '{}')"
echo "spec-99" > "$d2/.claude/active-spec"
check "override .claude/active-spec funciona" 2 "$(run "$d2" '{}')"

# --- fases in_progress (falsa continuacion) ---
d3="$(setup feat/spec-98-x)"; touch "$d3/.claude/keep-going.on"
spec "$d3" spec-98 "Fase 1 [in_progress]"
check "in_progress solo, primer turno -> bloquea" 2 "$(run "$d3" '{}')"
check "in_progress y repo sin moverse -> bloquea" 2 "$(run "$d3" '{}')"
r="$(run "$d3" '{}')"
case "$r" in *"NO se movio"*|*"NO se movi"*) echo "  ok   avisa que no hubo movimiento"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL no avisa falta de movimiento"; FAIL=$((FAIL+1)) ;; esac
( cd "$d3" && echo cambio >> x && git add -A && git commit -qm avance )
r2="$(run "$d3" '{}')"
case "$r2" in *"NO se movi"*) echo "  FAIL sigue diciendo que no se movio tras commit"; FAIL=$((FAIL+1)) ;;
  *) echo "  ok   tras commit cambia el mensaje"; PASS=$((PASS+1)) ;; esac

spec "$d3" spec-98 "Fase 1 [done]"
rm -f "$d3/.claude/.keep-going-count" "$d3/.claude/.keep-going-fp"
check "sin pending ni in_progress -> permite parar" 0 "$(run "$d3" '{}')"


# --- exige **Verify:** ---
d4="$(setup feat/spec-96-x)"; touch "$d4/.claude/keep-going.on"
spec_noverify "$d4" spec-96 "Fase 1 [pending]"
r="$(run "$d4" '{}')"
check "spec sin **Verify:** -> bloquea" 2 "$r"
case "${r#*|}" in *"**Verify:**"*) echo "  ok   dice que falta Verify"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL no menciona Verify"; FAIL=$((FAIL+1)) ;; esac
spec "$d4" spec-96 "Fase 1 [pending]"
rm -f "$d4/.claude/.keep-going-count" "$d4/.claude/.keep-going-fp"
r="$(run "$d4" '{}')"
case "${r#*|}" in *"Siguiente:"*) echo "  ok   con Verify pasa al mensaje normal"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL no llega al mensaje normal"; FAIL=$((FAIL+1)) ;; esac

# --- link markdown en heading no cuenta como fase ---
d5="$(setup feat/spec-95-x)"; touch "$d5/.claude/keep-going.on"
spec "$d5" spec-95 "Ver [spec-42](spec-42.md)" "Fase 1 [done]"
check "link markdown no cuenta como fase" 0 "$(run "$d5" '{}')"


# --- Una fase con rama abierta ya esta tomada -------------------------------
# El token vive en el archivo del spec, que es POR RAMA: cuando se delega una
# fase, la rama del spec sigue diciendo [pending] hasta que el trabajo mergee.
# Las ramas si son estado global, asi que son la senal fiable.

d6="$(setup feat/spec-96-x)"; touch "$d6/.claude/keep-going.on"
spec "$d6" spec-96 "Fase 1 \`[pending]\`"
( cd "$d6" && git branch -q feat/spec-96-fase-1-algo )
check "fase pending con rama abierta -> no la reclama" 0 "$(run "$d6" '{}')"

d7="$(setup feat/spec-97-x)"; touch "$d7/.claude/keep-going.on"
spec "$d7" spec-97 "Fase 1 \`[pending]\`"
check "fase pending sin rama -> sigue bloqueando" 2 "$(run "$d7" '{}')"

# fase-1 no debe casar con fase-10: si casara, delegar la 1 silenciaria la 10.
d8="$(setup feat/spec-98-x)"; touch "$d8/.claude/keep-going.on"
spec "$d8" spec-98 "Fase 10 \`[pending]\`"
( cd "$d8" && git branch -q feat/spec-98-fase-1-algo )
check "fase-1 no silencia a fase-10" 2 "$(run "$d8" '{}')"

# Una tomada y otra libre: reclama la libre, no la tomada.
d9="$(setup feat/spec-99-x)"; touch "$d9/.claude/keep-going.on"
spec "$d9" spec-99 "Fase 1 \`[pending]\`" "Fase 2 \`[pending]\`"
( cd "$d9" && git branch -q feat/spec-99-fase-1-algo )
r9="$(run "$d9" '{}')"
check "con una tomada, sigue reclamando la libre" 2 "$r9"
case "$r9" in *"Fase 2"*) echo "  ok   nombra la fase libre, no la tomada"; PASS=$((PASS+1));;
  *) echo "  FAIL nombra la fase libre, no la tomada"; FAIL=$((FAIL+1));; esac

echo
echo "  $PASS ok, $FAIL fail"
[ "$FAIL" -eq 0 ]
