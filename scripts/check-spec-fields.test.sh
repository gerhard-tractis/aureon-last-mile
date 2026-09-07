#!/usr/bin/env bash
# Tests de scripts/check-spec-fields.sh
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/check-spec-fields.sh"
D="$(mktemp -d)"; PASS=0; FAIL=0

mk() { # $1=archivo, resto=lineas
  local f="$D/$1"; shift
  : > "$f"; for l in "$@"; do printf '%s\n' "$l" >> "$f"; done
  printf '%s' "$f"
}
check() { # $1=nombre $2=esperado $3=archivo
  bash "$S" "$3" >/dev/null 2>&1; local got=$?
  if [ "$got" = "$2" ]; then echo "  ok   $1"; PASS=$((PASS+1))
  else echo "  FAIL $1 (esperaba $2, obtuvo $got)"; FAIL=$((FAIL+1)); fi
}

echo "check-spec-fields.sh"

check "spec completo pasa" 0 "$(mk ok.md '# S' '**Status:** in progress' '**Verify:** unit, e2e-qa' '### Fase 1 `[pending]`')"
check "sin fases no exige Verify" 0 "$(mk idea.md '# S' '**Status:** backlog' '## Goal' 'texto')"
check "fases sin Verify falla" 1 "$(mk noverify.md '# S' '**Status:** in progress' '### Fase 1 `[pending]`')"
check "sin Status falla" 1 "$(mk nostatus.md '# S' '**Verify:** unit' '### Fase 1 `[done]`')"
check "token mal escrito falla" 1 "$(mk typo.md '# S' '**Status:** in progress' '**Verify:** unit' '### Fase 1 `[in progress]`')"
check "token inventado falla" 1 "$(mk typo2.md '# S' '**Status:** in progress' '**Verify:** unit' '### Fase 1 `[pendign]`')"
check "todos los tokens validos pasan" 0 "$(mk all.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[pending]`' '### F2 `[in_progress]`' '### F3 `[blocked]`' '### F4 `[awaiting_user_test]`' '### F5 `[done]`' '### F6 `[parked]`')"
check "archivo inexistente no rompe" 0 "$D/no-existe.md"

# un heading con corchetes que NO es fase (link markdown) no debe fallar
check "link markdown en heading no confunde" 0 "$(mk link.md '# S' '**Status:** backlog' '### Ver [spec-42](spec-42.md)')"

echo
echo "  $PASS ok, $FAIL fail"
[ "$FAIL" -eq 0 ]
