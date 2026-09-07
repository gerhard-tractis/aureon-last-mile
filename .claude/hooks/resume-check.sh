#!/usr/bin/env bash
# .claude/hooks/resume-check.sh — SessionStart hook
#
# Detecta tokens [in_progress] rancios: una fase que dice "un agente tiene la
# pelota" cuando ese agente murio (529, cierre de terminal, crash) y por lo
# tanto nunca disparo un Stop para corregirlo.
#
# El latido es gratis: keep-going.sh reescribe .claude/.keep-going-fp en cada
# fin de turno, asi que la mtime de ese archivo es la ultima senal de vida de
# este worktree. Si hay [in_progress] y el latido es viejo, el token miente.
#
# NO reescribe el spec. Solo entrega los hechos y pide reconciliar: reescribir
# estado desde un hook es como se corrompe un spec en silencio.
#
# stdout se inyecta como contexto inicial de la sesion. Nunca bloquea.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" 2>/dev/null || exit 0

[ -f ".claude/keep-going.on" ] || exit 0

SPEC_ID=""
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
SPEC_ID="$(printf '%s' "${BRANCH:-}" | grep -oE 'spec-[0-9]+[a-z]?' | head -1 || true)"
if [ -z "${SPEC_ID:-}" ] && [ -f ".claude/active-spec" ]; then
  SPEC_ID="$(tr -d ' \t\r\n' < .claude/active-spec 2>/dev/null || true)"
fi
[ -n "${SPEC_ID:-}" ] || exit 0

SPEC_FILE="$(ls docs/specs/${SPEC_ID}-*.md 2>/dev/null | head -1 || true)"
[ -n "${SPEC_FILE:-}" ] && [ -f "$SPEC_FILE" ] || exit 0

INPROG="$(grep -cE '^#{2,4} .*\[in_progress\]' "$SPEC_FILE" 2>/dev/null || true)"
[ -n "${INPROG:-}" ] || INPROG=0
[ "$INPROG" -gt 0 ] || exit 0

mtime_of() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}
NOW="$(date +%s)"
FPFILE=".claude/.keep-going-fp"
STALE_MIN="${KEEP_GOING_STALE_MIN:-30}"

if [ -f "$FPFILE" ]; then
  BEAT="$(mtime_of "$FPFILE")"
  case "${BEAT:-}" in ''|*[!0-9]*) BEAT=0 ;; esac
  AGE_MIN=$(( (NOW - BEAT) / 60 ))
  BEAT_DESC="hace ${AGE_MIN} min"
else
  AGE_MIN=999999
  BEAT_DESC="nunca (no hay latido registrado en este worktree)"
fi

[ "$AGE_MIN" -ge "$STALE_MIN" ] || exit 0

PHASE="$(grep -m1 -E '^#{2,4} .*\[in_progress\]' "$SPEC_FILE" 2>/dev/null \
         | sed -E 's/^#+[[:space:]]*//; s/[[:space:]]*`?\[in_progress\]`?[[:space:]]*$//' || true)"
LAST_COMMIT="$(git log -1 --format='%h %cr - %s' 2>/dev/null || echo 'sin commits')"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

cat <<MSG
[resume-check] Token [in_progress] posiblemente rancio.

${SPEC_FILE} declara ${INPROG} fase(s) [in_progress], pero la ultima senal de vida
de este worktree fue ${BEAT_DESC}. Lo mas probable: la sesion anterior murio sin
cerrar el token, no que haya un agente trabajando.

  Fase:          ${PHASE}
  Rama:          ${BRANCH}
  Ultimo commit: ${LAST_COMMIT}
  Sin commitear: ${DIRTY} archivo(s)

Antes de tocar codigo, reconcilia. Git es la verdad del codigo, el spec es la
verdad de la intencion:

1. Revisa el commit y el working tree contra lo que esa fase dice construir.
2. Si esta terminada: ponle [done] (o [awaiting_user_test]) y sigue con la siguiente.
3. Si esta a medias: retomala donde quedo, dejando el token en [in_progress].
4. Si no se empezo: devuelvela a [pending].

No supongas cual de los tres es. Verificalo contra git primero.
MSG
exit 0
