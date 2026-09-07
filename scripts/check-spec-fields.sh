#!/usr/bin/env bash
# Fail if a spec touched by this PR declares phases but no way to judge them.
#
# Why this exists: el estado de una fase vive en un token del heading
# (`### Fase 3 — la lista [pending]`) y el criterio de aceptación en el campo
# `**Verify:**`. Ambos son leídos por máquina: los hooks de `.claude/hooks/`
# deciden si queda trabajo, y `scripts/verify.sh` decide qué jueces correr.
# Un spec con fases pero sin `**Verify:**` deja al runner sin criterio de
# término, y un token mal escrito (`[in progress]`, `[pendign]`) es invisible
# para el grep: la fase simplemente desaparece de la cola sin que nadie avise.
#
# Valida SOLO los specs tocados en el PR, a propósito. Validar los 87 haría que
# el primer PR fallara con decenas de errores y el guard terminaría desactivado.
# Los specs viejos migran cuando se los toca.
#
# Uso:
#   check-spec-fields.sh                  specs cambiados vs origin/main
#   check-spec-fields.sh --base <ref>     vs otro ref
#   check-spec-fields.sh <archivo>...     archivos explícitos
set -uo pipefail

VALID='pending|in_progress|blocked|awaiting_user_test|done|parked'
BT='`'
# El token va SIEMPRE al final del heading, opcionalmente entre backticks.
# Anclar al final evita confundir un link markdown (### Ver [spec-42](x.md))
# con un token mal escrito.
TOKEN_END="\\]${BT}?[[:space:]]*$"
FAILED=0
FILES=""

case "${1:-}" in
  --base) BASE="${2:?--base requiere un ref}"; shift 2 ;;
  "")     BASE="origin/main" ;;
  -*)     echo "check-spec-fields: opción desconocida: $1" >&2; exit 2 ;;
  *)      FILES="$*" ;;
esac

if [ -z "$FILES" ]; then
  FILES="$(git diff --name-only "${BASE}...HEAD" -- 'docs/specs/spec-*.md' 2>/dev/null || true)"
  [ -n "$FILES" ] || FILES="$(git diff --name-only "$BASE" -- 'docs/specs/spec-*.md' 2>/dev/null || true)"
fi

if [ -z "$FILES" ]; then
  echo "check-spec-fields: ningún spec tocado."
  exit 0
fi

for f in $FILES; do
  [ -f "$f" ] || continue   # borrado en el PR

  if ! grep -qE '^\*\*Status:\*\*' "$f"; then
    echo "::error file=$f::Falta la línea **Status:** (backlog / in progress / completed / superseded). Ver docs/specs/CLAUDE.md."
    FAILED=1
  fi

  # Tokens mal escritos: un heading que parece fase y trae corchetes no válidos.
  bad="$(grep -nE "^#{2,4} .*${BT}?\[[A-Za-z][A-Za-z _-]{1,24}${TOKEN_END}" "$f" 2>/dev/null \
         | grep -vE "\[($VALID)\]" || true)"
  if [ -n "$bad" ]; then
    echo "::error file=$f::Token de fase no reconocido. Válidos: pending, in_progress, blocked, awaiting_user_test, done, parked."
    echo "$bad" | while IFS= read -r l; do echo "    $f:$l"; done
    FAILED=1
  fi

  phases="$(grep -cE "^#{2,4} .*\[($VALID)${TOKEN_END}" "$f" 2>/dev/null || true)"
  [ -n "$phases" ] || phases=0

  if [ "$phases" -gt 0 ] && ! grep -qE '^\*\*Verify:\*\*' "$f"; then
    echo "::error file=$f::El spec declara $phases fase(s) con token de estado pero no tiene línea **Verify:**."
    echo "    Declara los jueces de aceptación, p.ej.: **Verify:** unit, e2e-qa"
    echo "    scripts/verify.sh los consume. Sin esto el runner no tiene criterio de término."
    FAILED=1
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo "check-spec-fields: ok"
  exit 0
fi
exit 1
