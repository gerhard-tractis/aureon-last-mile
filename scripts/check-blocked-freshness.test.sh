#!/usr/bin/env bash
# Tests de scripts/check-blocked-freshness.sh (spec-90 pieza 2)
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/check-blocked-freshness.sh"
D="$(mktemp -d)"; PASS=0; FAIL=0

mk() { # $1=archivo, resto=lineas
  local f="$D/$1"; shift
  : > "$f"; for l in "$@"; do printf '%s\n' "$l" >> "$f"; done
  printf '%s' "$f"
}
run() { # $1=archivo $2=--today opcional
  bash "$S" --today "${2:-2026-09-08}" "$1"
}

echo "check-blocked-freshness.sh"

# Nunca rompe — es un aviso, no un gate. Ver spec-90: "avisa, no rompe".
f="$(mk fresh.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X — verificado en foo.sql:12 — 2026-09-01 — desbloquea: usuario')"
out=$(run "$f"); rc=$?
if [ "$rc" -eq 0 ]; then echo "  ok   siempre exit 0 (fresco)"; PASS=$((PASS+1)); else echo "  FAIL exit 0 esperado, obtuvo $rc"; FAIL=$((FAIL+1)); fi
if ! printf '%s' "$out" | grep -q '::warning'; then echo "  ok   bloqueo fresco (7 dias) no genera warning"; PASS=$((PASS+1)); else echo "  FAIL no debia avisar: $out"; FAIL=$((FAIL+1)); fi

f="$(mk stale.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X — verificado en foo.sql:12 — 2026-06-01 — desbloquea: usuario')"
out=$(run "$f"); rc=$?
if [ "$rc" -eq 0 ]; then echo "  ok   caducado tambien exit 0"; PASS=$((PASS+1)); else echo "  FAIL exit 0 esperado, obtuvo $rc"; FAIL=$((FAIL+1)); fi
if printf '%s' "$out" | grep -qE '::warning file=.*line=[0-9]+::'; then echo "  ok   caducado (>30d) genera ::warning file=,line="; PASS=$((PASS+1)); else echo "  FAIL esperaba ::warning file=,line=: $out"; FAIL=$((FAIL+1)); fi

f="$(mk missing.md '# S' '**Status:** backlog' '### F1 `[blocked]`' 'sin linea Bloqueo')"
out=$(run "$f"); rc=$?
if [ "$rc" -eq 0 ]; then echo "  ok   sin Bloqueo tambien exit 0"; PASS=$((PASS+1)); else echo "  FAIL exit 0 esperado, obtuvo $rc"; FAIL=$((FAIL+1)); fi
if printf '%s' "$out" | grep -qE '::warning file=.*line=[0-9]+::'; then echo "  ok   sin linea Bloqueo genera warning con file=,line="; PASS=$((PASS+1)); else echo "  FAIL esperaba warning: $out"; FAIL=$((FAIL+1)); fi

f="$(mk exact30.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X — verificado en foo.sql:12 — 2026-08-09 — desbloquea: usuario')"
out=$(run "$f");
if ! printf '%s' "$out" | grep -q '::warning'; then echo "  ok   exactamente 30 dias no caduca todavia"; PASS=$((PASS+1)); else echo "  FAIL no debia avisar a los 30 dias exactos: $out"; FAIL=$((FAIL+1)); fi

f="$(mk over30.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X — verificado en foo.sql:12 — 2026-08-08 — desbloquea: usuario')"
out=$(run "$f");
if printf '%s' "$out" | grep -q '::warning'; then echo "  ok   31 dias caduca"; PASS=$((PASS+1)); else echo "  FAIL debia avisar a los 31 dias: $out"; FAIL=$((FAIL+1)); fi

# GITHUB_STEP_SUMMARY: el aviso tiene que quedar tambien en el resumen del job,
# no solo en stdout — un ::warning sin file=/line= es invisible en gh pr checks
# (hallazgo de spec-87); el summary es el respaldo legible.
SUMFILE="$D/summary.md"
f="$(mk sum.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X — verificado en foo.sql:12 — 2026-06-01 — desbloquea: usuario')"
GITHUB_STEP_SUMMARY="$SUMFILE" bash "$S" --today 2026-09-08 "$f" >/dev/null
if [ -f "$SUMFILE" ] && grep -q "sum.md" "$SUMFILE"; then echo "  ok   escribe tabla en \$GITHUB_STEP_SUMMARY"; PASS=$((PASS+1)); else echo "  FAIL no escribio el summary"; FAIL=$((FAIL+1)); fi

# validación contra la realidad: corre sobre el repo real completo (sin args)
# y no debe romper nunca — sean cuales sean los blocked de hoy.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$ROOT" && bash scripts/check-blocked-freshness.sh --today 2026-09-08 >/tmp/_real_freshness_out 2>&1 )
rc=$?
if [ "$rc" -eq 0 ]; then echo "  ok   corrida real sobre docs/specs/ completo no rompe"; PASS=$((PASS+1)); else echo "  FAIL corrida real devolvio $rc"; FAIL=$((FAIL+1)); fi
rm -f /tmp/_real_freshness_out

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
