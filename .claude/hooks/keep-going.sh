#!/usr/bin/env bash
# .claude/hooks/keep-going.sh — Stop hook
#
# Impide que el agente termine el turno mientras el spec activo declare trabajo
# sin cerrar: fases [pending] por tomar, o fases [in_progress] sin terminar.
#
# La señal es de ESTADO, no de prosa. Un turno que dice "arrancando la fase 3"
# y termina sin haber movido nada se bloquea igual: se compara la huella de git
# contra la del turno anterior. Si el agente dijo que trabajaba y el repo no se
# movió, no trabajó.
#
# Contrato de Claude Code:
#   exit 0 -> el agente puede terminar el turno
#   exit 2 -> se bloquea el fin de turno; stderr le llega como razón para seguir
#
# Habilitar en este worktree:  touch .claude/keep-going.on
# Deshabilitar:                rm .claude/keep-going.on
#
# Barato a propósito: solo git local y lectura de archivos. Nunca tests ni
# type-check — dispara en CADA fin de turno.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" 2>/dev/null || exit 0

STDIN_JSON="$(cat)"

# --- Guarda 1: ya venimos de un Stop hook. Sin esto, loop infinito. ---
case "$STDIN_JSON" in
  *'"stop_hook_active"'*[Tt]rue*) exit 0 ;;
esac

# --- Guarda 2: opt-in explícito por worktree ---
[ -f ".claude/keep-going.on" ] || exit 0

# --- Guarda 3: bloqueo declarado por el agente -> se le permite parar ---
if [ -s ".claude/BLOCKED.md" ]; then
  echo "keep-going: bloqueo declarado en .claude/BLOCKED.md — se permite terminar." >&2
  exit 0
fi

# --- Guarda 4: tope de continuaciones automáticas ---
COUNTER=".claude/.keep-going-count"
FPFILE=".claude/.keep-going-fp"
MAX="${KEEP_GOING_MAX:-12}"
n=0
[ -f "$COUNTER" ] && n="$(cat "$COUNTER" 2>/dev/null || true)"
case "${n:-}" in ''|*[!0-9]*) n=0 ;; esac
if [ "$n" -ge "$MAX" ]; then
  rm -f "$COUNTER" "$FPFILE"
  echo "keep-going: tope de $MAX continuaciones automáticas alcanzado. Revisa el spec a mano." >&2
  exit 0
fi

# --- Identificar el spec activo: primero por rama, luego por override ---
SPEC_ID=""
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
SPEC_ID="$(printf '%s' "${BRANCH:-}" | grep -oE 'spec-[0-9]+[a-z]?' | head -1 || true)"
if [ -z "${SPEC_ID:-}" ] && [ -f ".claude/active-spec" ]; then
  SPEC_ID="$(tr -d ' \t\r\n' < .claude/active-spec 2>/dev/null || true)"
fi
[ -n "${SPEC_ID:-}" ] || exit 0

SPEC_FILE="$(ls docs/specs/${SPEC_ID}-*.md 2>/dev/null | head -1 || true)"
[ -n "${SPEC_FILE:-}" ] && [ -f "$SPEC_FILE" ] || exit 0

BT='`'
# El token va al final del heading. Anclar evita confundir un link markdown
# (### Ver [spec-42](x.md)) con un token de fase.
count_token() {
  local c
  c="$(grep -cE "^#{2,4} .*\[$1\]${BT}?[[:space:]]*$" "$SPEC_FILE" 2>/dev/null || true)"
  [ -n "${c:-}" ] || c=0
  printf '%s' "$c"
}
first_token() {
  grep -m1 -E "^#{2,4} .*\[$1\]${BT}?[[:space:]]*$" "$SPEC_FILE" 2>/dev/null \
    | sed -E 's/^#+[[:space:]]*//; s/[[:space:]]*`?\['"$1"'\]`?[[:space:]]*$//' || true
}

# --- Una fase con rama abierta ya esta tomada, diga lo que diga el token ---
#
# El token vive en el archivo del spec, que es POR RAMA. Cuando se delega una
# fase y el implementer trabaja en su propia rama, la rama del spec sigue
# diciendo [pending] hasta que aquello mergee — asi que este hook, y cualquier
# otra sesion, ven trabajo libre que en realidad esta tomado. Observado el
# 2026-09-07: la fase 1 de spec-87 se senalo como pendiente tres turnos
# seguidos mientras un implementer la construia.
#
# Las ramas SI son estado global: se leen de las refs locales de seguimiento,
# sin red y sin merge. Por eso son la senal fiable de "esto ya esta tomado".
#
# Convencion: la rama de una fase lleva <spec-id>-fase-<n> en el nombre
# (feat/spec-85-fase-1-esquema). Sin eso no hay forma de relacionarlas.
#
# Limitacion honesta: usa las refs de la ultima vez que se hizo fetch. Una rama
# recien empujada por otra maquina no se ve hasta el siguiente fetch. Se acepta:
# este hook no puede hacer red (dispara en cada fin de turno).
ALL_BRANCHES="$(git branch -a --format='%(refname:short)' 2>/dev/null || true)"

phase_taken() { # $1 = numero de fase
  [ -n "${1:-}" ] || return 1
  printf '%s
' "$ALL_BRANCHES"     | grep -qiE "${SPEC_ID}[-_](fase|phase)[-_]$1([^0-9]|$)"
}

# Cuenta las [pending] que NADIE tiene tomada.
count_free_pending() {
  local n=0 num
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    num="$(printf '%s' "$line" | grep -oiE '(fase|phase|step)[[:space:]]+[0-9]+(\.[0-9]+)?' | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)"
    phase_taken "$num" || n=$((n + 1))
  done <<EOF
$(grep -E "^#{2,4} .*\[pending\]${BT}?[[:space:]]*$" "$SPEC_FILE" 2>/dev/null || true)
EOF
  printf '%s' "$n"
}

first_free_pending() {
  local num
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    num="$(printf '%s' "$line" | grep -oiE '(fase|phase|step)[[:space:]]+[0-9]+(\.[0-9]+)?' | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)"
    if ! phase_taken "$num"; then
      printf '%s' "$line" | sed -E 's/^#+[[:space:]]*//; s/[[:space:]]*`?\[pending\]`?[[:space:]]*$//'
      return 0
    fi
  done <<EOF
$(grep -E "^#{2,4} .*\[pending\]${BT}?[[:space:]]*$" "$SPEC_FILE" 2>/dev/null || true)
EOF
}

PENDING="$(count_free_pending)"
INPROG="$(count_token in_progress)"

# Nada declarado sin cerrar -> se puede terminar
if [ "$PENDING" -eq 0 ] && [ "$INPROG" -eq 0 ]; then
  rm -f "$COUNTER" "$FPFILE"
  exit 0
fi

# Hay trabajo declarado, pero el spec no dice como se juzga. Sin **Verify:**
# no hay criterio de termino: scripts/verify.sh no sabe que jueces correr.
# CI lo exige igual (scripts/check-spec-fields.sh); avisar aca es mas barato.
if ! grep -qE '^\*\*Verify:\*\*' "$SPEC_FILE"; then
  echo $((n + 1)) > "$COUNTER"
  cat >&2 <<MSG
${SPEC_FILE} declara fases con token de estado pero no tiene linea **Verify:**.

Sin ese campo no hay criterio de aceptacion: scripts/verify.sh no sabe que
jueces correr y el PR va a fallar en el guard de CI.

Agregala junto al **Status:**, nombrando los jueces de este spec. Ejemplos:
  **Verify:** unit, e2e-qa          (spec de pantallas)
  **Verify:** unit, golden, invariants   (spec de logica pesada)

Hazlo ahora y continua.
MSG
  exit 2
fi

# --- Huella de estado: ¿se movió algo desde el turno anterior? ---
FP="$(git rev-parse HEAD 2>/dev/null || echo nohead)|$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
PREV=""
[ -f "$FPFILE" ] && PREV="$(cat "$FPFILE" 2>/dev/null || true)"
printf '%s' "$FP" > "$FPFILE"
echo $((n + 1)) > "$COUNTER"

RULES='
Cómo declarar un bloqueo real: escribe la pregunta en .claude/BLOCKED.md y detente.
Eso es válido cuando el spec pide algo que el código no puede sostener honestamente
y resolverlo es una decisión de producto. NO es válido para preferencias, nombres,
colores ni "¿sigo?" — esas resuélvelas tú y sigue.

Estado: mantén el token del heading al día — [pending] -> [in_progress] -> [done],
o [awaiting_user_test] si necesita validación manual del usuario.'

if [ "$INPROG" -gt 0 ] && [ -n "$PREV" ] && [ "$FP" = "$PREV" ]; then
  cat >&2 <<MSG
Hay ${INPROG} fase(s) marcadas [in_progress] en ${SPEC_FILE}, pero el repositorio NO se movió
desde el turno anterior: mismo HEAD y mismo working tree. Declaraste trabajo en curso
y no hay trabajo en curso.

Fase: $(first_token in_progress)

Despacha el trabajo ahora, o si de verdad no puedes avanzar, declara el bloqueo.
${RULES}
MSG
  exit 2
fi

if [ "$PENDING" -gt 0 ]; then
  cat >&2 <<MSG
Quedan ${PENDING} fase(s) [pending] en ${SPEC_FILE}.

Siguiente: $(first_free_pending)

Continúa con ella ahora. No pidas autorización para pasar de una fase a la siguiente.
${RULES}
MSG
  exit 2
fi

cat >&2 <<MSG
La fase "$(first_token in_progress)" sigue [in_progress] en ${SPEC_FILE}.

Termínala y cierra su token antes de detenerte.
${RULES}
MSG
exit 2
