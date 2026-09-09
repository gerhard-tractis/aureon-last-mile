#!/usr/bin/env bash
# Avisa cuando un `> Bloqueo:` lleva más de 30 días verificado, o cuando una
# fase `[blocked]` no trae esa línea. NUNCA falla — es una revisión pendiente,
# no un error. Ver spec-90: "avisa, no rompe" es una decisión tomada, no un
# accidente — romper CI por esto hace que alguien desactive el guard.
#
# Por qué 30 días: mismo horizonte que `check-quarantine-validate.mjs`
# (MAX_HORIZON_DAYS) para la caducidad de tests en cuarentena — un mecanismo
# análogo, ya probado, con la misma pregunta detrás ("¿sigue siendo cierto lo
# que se afirmó?"). El caso real que motiva esto: `drivers.user_id` se
# afirmó "sin ligar" cinco meses después de que una migración lo ligara. Un
# bloqueo verificado hace cinco meses no es un bloqueo verificado.
#
# A diferencia de check-blocked-evidence.sh (diff-scoped, hard error, sólo
# specs tocados), este guard recorre TODOS los specs del repo en cada corrida
# — un bloqueo puede caducar sin que nadie vuelva a tocar ese archivo, y algo
# que sólo avisa puede correr sobre el estado completo desde el día uno sin
# el problema de transición que sí tiene el guard duro.
#
# `::warning file=…,line=…::` — no `::warning::` a secas. El review de
# spec-87 encontró que un aviso sin file=/line= anota el job y no aparece en
# el diff ni en `gh pr checks`, invisible en un flujo con auto-merge.
#
# Uso:
#   check-blocked-freshness.sh                    docs/specs/spec-*.md
#   check-blocked-freshness.sh --today YYYY-MM-DD  fecha fija (tests, CI)
#   check-blocked-freshness.sh <archivo>...        archivos explícitos
set -uo pipefail

HORIZON_DAYS=30
TODAY=""
FILES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --today) TODAY="${2:?--today requiere YYYY-MM-DD}"; shift 2 ;;
    *) FILES="$FILES $1"; shift ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
cd "$ROOT" || exit 0

[ -n "$TODAY" ] || TODAY="$(date -u +%Y-%m-%d)"

if [ -z "$FILES" ]; then
  FILES="$(ls docs/specs/spec-*.md 2>/dev/null || true)"
fi
[ -n "$FILES" ] || { echo "check-blocked-freshness: sin specs que revisar."; exit 0; }

is_real_date() {
  local d="$1"
  case "$d" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) return 1 ;;
  esac
  date -u -d "${d}T00:00:00Z" +%Y-%m-%d 2>/dev/null | grep -qx "$d"
}
age_days() { # $1 = YYYY-MM-DD -> dias transcurridos hasta TODAY
  local d="$1"
  local d_s today_s
  d_s=$(date -u -d "${d}T00:00:00Z" +%s 2>/dev/null) || { echo 0; return; }
  today_s=$(date -u -d "${TODAY}T00:00:00Z" +%s 2>/dev/null) || { echo 0; return; }
  echo $(( (today_s - d_s) / 86400 ))
}

SUMMARY_ROWS=""
WARN_COUNT=0

for f in $FILES; do
  [ -f "$f" ] || continue

  # Fases [blocked] sin `> Bloqueo:` en absoluto.
  awk -v file="$f" '
    function flush() { if (pend && !bloq) print lineno }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; lineno=NR; next }
    /^#{2,4} /                       { flush(); pend=0; next }
    /^> Bloqueo:/                    { if (pend) bloq=1 }
    END { flush() }
  ' "$f" > "/tmp/_fresh_missing_$$" 2>/dev/null || true

  while IFS= read -r ln; do
    [ -n "$ln" ] || continue
    echo "::warning file=$f,line=$ln::Fase [blocked] sin '> Bloqueo:' — bajo la regla nueva, el próximo PR que toque $f deberá añadirla (ver docs/specs/CLAUDE.md)."
    SUMMARY_ROWS="$SUMMARY_ROWS
| $f:$ln | (sin \`> Bloqueo:\`) | — |"
    WARN_COUNT=$((WARN_COUNT + 1))
  done < "/tmp/_fresh_missing_$$"
  rm -f "/tmp/_fresh_missing_$$"

  # Fases con `> Bloqueo:` presente: comprobar caducidad. Concatena bloques
  # multi-línea igual que check-blocked-evidence.sh — la fecha puede vivir en
  # una línea de continuación (el ejemplo canónico de CLAUDE.md la pone en la
  # tercera), y leer sólo la primera línea la perdía.
  awk -v file="$f" '
    function flush() { if (pend && bloq) print bloqlineno "\t" bloqline }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; capturing=0; next }
    /^#{2,4} /                       { flush(); pend=0; capturing=0; next }
    /^> Bloqueo:/ {
      if (pend && !bloq) { bloq=1; bloqline=$0; bloqlineno=NR; capturing=1 }
      else { capturing=0 }
      next
    }
    capturing && /^>/ { bloqline = bloqline " " $0; next }
    { capturing=0 }
    END { flush() }
  ' "$f" > "/tmp/_fresh_present_$$" 2>/dev/null || true

  while IFS="$(printf '\t')" read -r ln line; do
    [ -n "$ln" ] || continue
    d="$(printf '%s' "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"
    if [ -z "$d" ] || ! is_real_date "$d"; then
      echo "::warning file=$f,line=$ln::'> Bloqueo:' sin fecha real — no se puede evaluar caducidad."
      SUMMARY_ROWS="$SUMMARY_ROWS
| $f:$ln | (fecha inválida) | — |"
      WARN_COUNT=$((WARN_COUNT + 1))
      continue
    fi
    age="$(age_days "$d")"
    if [ "$age" -gt "$HORIZON_DAYS" ]; then
      echo "::warning file=$f,line=$ln::Bloqueo caducado — verificado el $d, hace $age días (horizonte ${HORIZON_DAYS}d). Revisar si sigue vigente."
      SUMMARY_ROWS="$SUMMARY_ROWS
| $f:$ln | $d | ${age}d — CADUCADO |"
      WARN_COUNT=$((WARN_COUNT + 1))
    fi
  done < "/tmp/_fresh_present_$$"
  rm -f "/tmp/_fresh_present_$$"
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### check-blocked-freshness"
    if [ "$WARN_COUNT" -eq 0 ]; then
      echo "Sin bloqueos caducados ni sin evidencia."
    else
      echo "| fase | verificado | edad |"
      echo "|---|---|---|"
      printf '%s\n' "$SUMMARY_ROWS"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "check-blocked-freshness: $WARN_COUNT aviso(s). No bloquea (avisa, no rompe)."
exit 0
