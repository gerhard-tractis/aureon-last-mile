#!/usr/bin/env bash
# El gate barato. Un comando, un exit code: "¿está verde el árbol?"
#
# Why this exists: hasta ahora "verificar" eran tres comandos sueltos que había
# que recordar y encadenar a mano (`turbo run lint`, `type-check`, `test:run`).
# Un agente no puede decidir nada con eso — necesita un único exit code. Sin
# este archivo no hay forma de automatizar "no te detengas mientras esté rojo",
# ni de que un runner sepa si una fase quedó lista.
#
# Uso:
#   ./scripts/verify.sh                    base: lint + type-check + unit
#   ./scripts/verify.sh e2e-qa             base, y reporta e2e-qa como diferido a CI
#   ./scripts/verify.sh golden invariants  base + los jueces de scripts/judges/
#
# Los jueces salen del campo **Verify:** del spec. Un juez desconocido FALLA:
# el skip silencioso es peor que el rojo, porque el agente cree que está verde.
#
# Exit 0 = todo lo juzgable acá pasó. Los jueces diferidos se listan en stdout y
# los cierra CI — una fase con jueces diferidos NO pasa a [done] hasta que
# `gh pr checks` esté verde (ver CLAUDE.md).
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

FAILED=0
DEFERRED=""

step() { # $1 = nombre, resto = comando
  local name="$1"; shift
  printf '\n── %s ──\n' "$name"
  if "$@"; then
    printf '   ok\n'
  else
    printf '   FALLO\n'
    echo "::error::verify: $name falló"
    FAILED=1
  fi
}

# ---- Base: siempre, en todos los repos ----
step "lint"       npx turbo run lint
step "type-check" npx turbo run type-check
step "unit"       npx turbo run test:run

# ---- Jueces declarados en el spec ----
for judge in "$@"; do
  case "$judge" in
    unit|lint|type-check)
      : ;;  # ya cubiertos por la base
    e2e-qa)
      DEFERRED="$DEFERRED e2e-qa" ;;
    *)
      if [ -x "scripts/judges/$judge.sh" ]; then
        step "$judge" "scripts/judges/$judge.sh"
      elif [ -f "scripts/judges/$judge.sh" ]; then
        step "$judge" bash "scripts/judges/$judge.sh"
      else
        echo "::error::verify: juez '$judge' declarado en el spec pero no existe scripts/judges/$judge.sh"
        echo "verify: juez desconocido '$judge' — no lo salto en silencio." >&2
        FAILED=1
      fi ;;
  esac
done

printf '\n────────────────────\n'
if [ -n "$DEFERRED" ]; then
  echo "DIFERIDO A CI:$DEFERRED"
  echo "  Estos jueces no corren en local. La fase no pasa a [done] hasta que"
  echo "  \`gh pr checks\` esté verde."
fi

if [ "$FAILED" -eq 0 ]; then
  echo "VERDE (local)"
  exit 0
fi
echo "ROJO"
exit 1
