#!/usr/bin/env bash
# Fail if a spec touched by this PR declares a `[blocked]` phase without the
# evidence that earns it that token.
#
# Why this exists: un bloqueo declarado se propaga sin verificarse, y la
# afirmación no verificada se vuelve permanente porque el siguiente que la lee
# la hereda. Pasó de verdad el 2026-09-08: dos specs afirmaron "nada liga
# users con drivers" cuando `20260318000004_agent_suite_tables.sql:253-254`
# ya lo ligaba desde marzo, y esa única afirmación sin comprobar paró cuatro
# fases. `check-spec-fields.sh` ya exige evidencia para CERRAR una fase
# (`[done]`); este guard exige la simétrica para ABRIRLA como bloqueada.
#
# Un `> Bloqueo:` válido trae, en una sola línea, las cuatro cosas que la
# auditoría de ese día demostró que faltaban:
#   - qué se intentó (no "falta X", sino "se intentó Y y devolvió Z")
#   - contra qué se verificó (fichero:línea, consulta, o salida de comando)
#   - cuándo (fecha real, YYYY-MM-DD)
#   - quién puede desbloquearlo: usuario | agente | dependencia (spec-NN)
#
# "No tengo acceso a X" NO es un bloqueo válido por sí solo — sólo lo es si
# la línea trae evidencia de que se escaló al orquestador y no llegó. Pasó
# tres veces el mismo día que se usó "no tengo acceso" para bajar el listón
# de verificación sin escalar nada. Ese caso se valida igual que cualquier
# otro: "qué se intentó" tiene que decir a quién se escaló, y "contra qué se
# verificó" tiene que decir qué contestó (o que no contestó).
#
# Valida SOLO los specs tocados en el PR, igual que check-spec-fields.sh y por
# la misma razón: validar los ~10 `[blocked]` reales de hoy —ninguno trae esta
# línea, porque no existía— haría que el primer PR fallara en masa. Los specs
# viejos migran cuando se los toca.
#
# Uso:
#   check-blocked-evidence.sh                  specs cambiados vs origin/main
#   check-blocked-evidence.sh --base <ref>     vs otro ref
#   check-blocked-evidence.sh <archivo>...     archivos explícitos
set -uo pipefail

BT='`'
TOKEN_END="\\]${BT}?[[:space:]]*$"
DAY_MS=$((24 * 60 * 60))
FAILED=0
FILES=""

case "${1:-}" in
  --base) BASE="${2:?--base requiere un ref}"; shift 2 ;;
  "")     BASE="origin/main" ;;
  -*)     echo "check-blocked-evidence: opción desconocida: $1" >&2; exit 2 ;;
  *)      FILES="$*" ;;
esac

if [ -z "$FILES" ]; then
  FILES="$(git diff --name-only "${BASE}...HEAD" -- 'docs/specs/spec-*.md' 2>/dev/null || true)"
  [ -n "$FILES" ] || FILES="$(git diff --name-only "$BASE" -- 'docs/specs/spec-*.md' 2>/dev/null || true)"
fi

if [ -z "$FILES" ]; then
  echo "check-blocked-evidence: ningún spec tocado."
  exit 0
fi

is_real_date() { # $1 = YYYY-MM-DD -> 0 si es una fecha real de calendario
  local d="$1"
  case "$d" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    *) return 1 ;;
  esac
  date -u -d "${d}T00:00:00Z" +%Y-%m-%d 2>/dev/null | grep -qx "$d"
}

for f in $FILES; do
  [ -f "$f" ] || continue   # borrado en el PR

  awk -v file="$f" '
    function flush() {
      if (pend) {
        if (!bloq) print lineno "\t" head
      }
    }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; head=$0; lineno=NR; next }
    /^#{2,4} /                       { flush(); pend=0; next }
    /^> Bloqueo:/                    { if (pend) { bloq=1; bloqline=$0; bloqlineno=NR } }
    END { flush() }
  ' "$f" > "/tmp/_bloq_missing_$$" 2>/dev/null || true

  if [ -s "/tmp/_bloq_missing_$$" ]; then
    echo "::error file=$f::Fase(s) [blocked] sin línea '> Bloqueo:'. Cada fase bloqueada necesita en su cuerpo una línea 'Bloqueo:' con qué se intentó, contra qué se verificó (fichero:línea / consulta / comando), la fecha, y quién puede desbloquearla (usuario, agente, o dependencia con el spec nombrado). Ver docs/specs/CLAUDE.md."
    while IFS="$(printf '\t')" read -r ln head; do echo "    $f:$ln: $head"; done < "/tmp/_bloq_missing_$$"
    FAILED=1
  fi
  rm -f "/tmp/_bloq_missing_$$"

  # Fases con `> Bloqueo:` presente: validar sus cuatro campos.
  awk -v file="$f" '
    function flush() {
      if (pend && bloq) print bloqlineno "\t" bloqline
    }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; next }
    /^#{2,4} /                       { flush(); pend=0; next }
    /^> Bloqueo:/                    { if (pend && !bloq) { bloq=1; bloqline=$0; bloqlineno=NR } }
    END { flush() }
  ' "$f" > "/tmp/_bloq_present_$$" 2>/dev/null || true

  while IFS="$(printf '\t')" read -r ln line; do
    [ -n "$ln" ] || continue

    # qué se intentó: heurística — la línea debe nombrar el intento.
    if ! printf '%s' "$line" | grep -qiE 'intent[oó]'; then
      echo "::error file=$f::$f:$ln: '> Bloqueo:' no dice qué se intentó (usa 'se intentó ... y devolvió ...', no 'falta X')."
      FAILED=1
    fi

    # contra qué se verificó
    if ! printf '%s' "$line" | grep -qiE 'verific(ad|ó)'; then
      echo "::error file=$f::$f:$ln: '> Bloqueo:' no dice contra qué se verificó (fichero:línea, consulta, o salida de comando)."
      FAILED=1
    fi

    # fecha real
    d="$(printf '%s' "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"
    if [ -z "$d" ] || ! is_real_date "$d"; then
      echo "::error file=$f::$f:$ln: '> Bloqueo:' no trae una fecha real (YYYY-MM-DD)."
      FAILED=1
    fi

    # quién puede desbloquearlo
    quien="$(printf '%s' "$line" | grep -oiE 'desbloquea:[[:space:]]*[a-zañ]+' | head -1)"
    case "$(printf '%s' "$quien" | tr '[:upper:]' '[:lower:]')" in
      *usuario|*agente) ;;
      *dependencia)
        if ! printf '%s' "$line" | grep -qE 'spec-[0-9]+'; then
          echo "::error file=$f::$f:$ln: '> Bloqueo:' dice 'desbloquea: dependencia' pero no nombra el spec del que depende."
          FAILED=1
        fi
        ;;
      *)
        echo "::error file=$f::$f:$ln: '> Bloqueo:' no dice quién puede desbloquearla — usa 'desbloquea: usuario', 'desbloquea: agente' o 'desbloquea: dependencia (spec-NN)'."
        FAILED=1
        ;;
    esac
  done < "/tmp/_bloq_present_$$"
  rm -f "/tmp/_bloq_present_$$"
done

if [ "$FAILED" -eq 0 ]; then
  echo "check-blocked-evidence: ok"
  exit 0
fi
exit 1
