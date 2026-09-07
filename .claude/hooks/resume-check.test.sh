#!/usr/bin/env bash
# Tests de .claude/hooks/resume-check.sh
# Repos git temporales; no toca el repo real.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/resume-check.sh"
PASS=0; FAIL=0

setup() {
  local d; d="$(mktemp -d)"
  ( cd "$d"
    git init -q .; git config user.email t@t.t; git config user.name t
    mkdir -p docs/specs .claude/hooks
    echo x > x; git add -A; git commit -qm init
    git checkout -qb "$1"
    cp "$HOOK" .claude/hooks/resume-check.sh
  )
  printf '%s' "$d"
}
spec() {
  local d="$1" id="$2"; shift 2
  { echo "# $id"; echo; echo "**Status:** in progress"; echo
    for h in "$@"; do echo "### $h"; echo; done; } > "$d/docs/specs/${id}-x.md"
}
run() {
  local d="$1" out code
  out="$( cd "$d" && bash .claude/hooks/resume-check.sh 2>&1 )"; code=$?
  printf '%s|%s' "$code" "$out"
}
expect_silence() {
  local r="$2" code="${2%%|*}" body="${2#*|}"
  if [ "$code" = 0 ] && [ -z "$body" ]; then echo "  ok   $1"; PASS=$((PASS+1))
  else echo "  FAIL $1 (exit $code, salida: $body)"; FAIL=$((FAIL+1)); fi
}
expect_warn() {
  local code="${2%%|*}" body="${2#*|}"
  case "$code|$body" in
    0\|*rancio*) echo "  ok   $1"; PASS=$((PASS+1)) ;;
    *) echo "  FAIL $1 (exit $code, salida: $body)"; FAIL=$((FAIL+1)) ;;
  esac
}

echo "resume-check.sh"

d="$(setup feat/spec-97-x)"; spec "$d" spec-97 "Fase 1 [in_progress]"
expect_silence "sin keep-going.on no dice nada" "$(run "$d")"

touch "$d/.claude/keep-going.on"
expect_warn "in_progress sin latido -> avisa" "$(run "$d")"

touch "$d/.claude/.keep-going-fp"
expect_silence "latido fresco -> no dice nada" "$(run "$d")"

touch -d '2 hours ago' "$d/.claude/.keep-going-fp" 2>/dev/null || touch -A -020000 "$d/.claude/.keep-going-fp"
expect_warn "latido de 2h -> avisa" "$(run "$d")"

spec "$d" spec-97 "Fase 1 [done]" "Fase 2 [pending]"
expect_silence "sin in_progress -> no dice nada" "$(run "$d")"

spec "$d" spec-97 "Fase 1 [in_progress]"
r="$(run "$d")"
case "${r#*|}" in *"Ultimo commit:"*) echo "  ok   incluye hechos de git"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL no incluye hechos de git"; FAIL=$((FAIL+1)) ;; esac

d2="$(setup feat/sin-numero)"; touch "$d2/.claude/keep-going.on"
spec "$d2" spec-97 "Fase 1 [in_progress]"
expect_silence "rama sin spec-NN -> no opina" "$(run "$d2")"

echo
echo "  $PASS ok, $FAIL fail"
[ "$FAIL" -eq 0 ]
