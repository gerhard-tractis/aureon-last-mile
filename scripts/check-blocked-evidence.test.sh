#!/usr/bin/env bash
# Tests de scripts/check-blocked-evidence.sh (spec-90 pieza 1)
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/check-blocked-evidence.sh"
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
check_out() { # $1=nombre $2=archivo $3=needle esperado en stdout+stderr
  local out; out=$(bash "$S" "$2" 2>&1)
  if printf '%s' "$out" | grep -qF "$3"; then echo "  ok   $1"; PASS=$((PASS+1))
  else echo "  FAIL $1 (no contiene: $3)"; FAIL=$((FAIL+1)); fi
}

BLOQ_OK='> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: usuario'

echo "check-blocked-evidence.sh"

check "sin fases blocked pasa" 0 "$(mk ok-none.md '# S' '**Status:** backlog' '### F1 `[pending]`')"
check "blocked con Bloqueo completo pasa" 0 "$(mk ok-full.md '# S' '**Status:** backlog' "### F1 \`[blocked]\`" "$BLOQ_OK")"
check "blocked sin linea Bloqueo falla" 1 "$(mk bad-none.md '# S' '**Status:** backlog' '### F1 `[blocked]`' 'prosa cualquiera')"

check_out "blocked sin Bloqueo nombra la fase" "$(mk bad-name.md '# S' '**Status:** backlog' '### Fase 1 — Asignación `[blocked]`')" 'Fase 1'

check "falta fecha real falla" 1 "$(mk bad-date.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — fecha desconocida — desbloquea: usuario')"
check "fecha imposible falla" 1 "$(mk bad-caldate.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-02-30 — desbloquea: usuario')"

check "falta que-se-intento falla" 1 "$(mk bad-intento.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: nada relevante — verificado en foo.sql:12 — 2026-09-08 — desbloquea: usuario')"

check "falta verificado-contra falla" 1 "$(mk bad-verif.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — 2026-09-08 — desbloquea: usuario')"

check "falta desbloquea falla" 1 "$(mk bad-quien.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08')"

check "desbloquea con valor invalido falla" 1 "$(mk bad-quien2.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: quien-sabe')"

check "desbloquea dependencia sin nombrar spec falla" 1 "$(mk bad-dep.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: dependencia')"

check "desbloquea dependencia nombrando spec pasa" 0 "$(mk ok-dep.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: dependencia (spec-81)')"

check "desbloquea agente pasa" 0 "$(mk ok-agente.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: agente')"

check "Bloqueo de otra fase no cuenta" 1 "$(mk leak.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '### F2 `[blocked]`' "$BLOQ_OK")"

check "dos fases blocked, una sin evidencia falla" 1 "$(mk two.md '# S' '**Status:** backlog' '### F1 `[blocked]`' "$BLOQ_OK" '### F2 `[blocked]`')"

check "archivo inexistente no rompe" 0 "$D/no-existe.md"

# --- validación contra la realidad: hoy NINGUNA fase [blocked] real del repo
# trae `> Bloqueo:` (la línea no existía antes de spec-90) — así que el guard
# debe fallar sobre cada uno de los specs reales que la auditoría encontró.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for real in \
  spec-75-despacho-desktop-reshape.md \
  spec-82-recogida-movil-asignacion-y-ruta.md \
  spec-83-recogida-escritorio-datos-faltantes.md \
  spec-84-movil-conductor-home-y-prueba-de-entrega.md \
  spec-86-discrepancias-de-recepcion.md \
  spec-88-anon-security-definer-audit.md \
; do
  f="$ROOT/docs/specs/$real"
  if [ -f "$f" ]; then
    check "spec real $real sin Bloqueo falla (pre-spec-90)" 1 "$f"
  else
    echo "  SKIP $real (no existe en este checkout)"
  fi
done

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
