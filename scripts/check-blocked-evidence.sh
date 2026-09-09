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
# Un `> Bloqueo:` válido trae las cuatro cosas que la auditoría de ese día
# demostró que faltaban. Puede ser UNA línea o VARIAS líneas de blockquote
# consecutivas (cada continuación empieza por `>`, sin línea en blanco de por
# medio) — el guard concatena el bloque completo antes de validar los cuatro
# campos, porque el propio ejemplo canónico de `docs/specs/CLAUDE.md` los
# reparte en tres líneas para que quepan sin desbordar:
#   - qué se intentó (no "falta X", sino "se intentó Y y devolvió Z")
#   - contra qué se verificó (fichero:línea, consulta, o salida de comando)
#   - cuándo (fecha real, YYYY-MM-DD)
#   - quién puede desbloquearlo: usuario | agente | dependencia (spec-NN)
#
# Heurística léxica, no semántica — mismo trade-off que `check-spec-fields.sh`
# ya acepta para `> Implementado por:`: el guard fuerza la forma, la revisión
# humana (o del `reviewer`) juzga el contenido. Sí rechaza la negación vacía
# más obvia ("se intentó nada", "no se verificó nada") — round 2 de spec-90
# encontró que esas frases, con las palabras mágicas puestas, colaban.
#
# "No tengo acceso a X" NO es un bloqueo válido por sí solo — sólo lo es si
# la línea trae evidencia de que se escaló al orquestador y no llegó. Pasó
# tres veces el mismo día que se usó "no tengo acceso" para bajar el listón
# de verificación sin escalar nada. Ese caso se valida igual que cualquier
# otro: "qué se intentó" tiene que decir a quién se escaló, y "contra qué se
# verificó" tiene que decir qué contestó (o que no contestó) — sin caer en la
# negación vacía de arriba.
#
# Escape hatch, desde el primer día (spec-91 ya lo aprendió por las malas con
# `**Depende de:**`: un campo obligatorio sin forma honesta de decir "todavía
# no lo sé" convierte una negativa correcta en un build rojo):
#
#   > Bloqueo: (indeterminado — <razón real, no vacía>) — 2026-09-09 — desbloquea: usuario
#
# En este modo el guard NO exige "qué se intentó"/"contra qué se verificó" —
# exige que la razón no esté vacía ni sea un relleno ("razón", "TODO", "???")
# — pero SÍ exige fecha real y quién desbloquea, porque esas dos sí son
# conocidas aunque la causa del bloqueo todavía no se pueda articular.
#
# Valida SOLO los specs tocados en el PR, igual que check-spec-fields.sh y por
# la misma razón: validar de golpe todos los `[blocked]` reales que hoy no
# traen esta línea —porque no existía antes de este guard— haría que el
# primer PR fallara en masa por deuda acumulada, no por algo que introdujo.
# Los specs viejos migran cuando se los toca.
#
# Uso:
#   check-blocked-evidence.sh                  specs cambiados vs origin/main
#   check-blocked-evidence.sh --base <ref>     vs otro ref
#   check-blocked-evidence.sh <archivo>...     archivos explícitos
set -uo pipefail

FAILED=0
FILES=""

case "${1:-}" in
  --base) BASE="${2:?--base requiere un ref}"; shift 2 ;;
  "")     BASE="origin/main" ;;
  -*)     echo "check-blocked-evidence: opción desconocida: $1" >&2; exit 2 ;;
  *)      FILES="$*" ;;
esac

if [ -z "$FILES" ]; then
  DIFF_OUT="$(mktemp)"; DIFF_ERR="$(mktemp)"
  if git diff --name-only "${BASE}...HEAD" -- 'docs/specs/spec-*.md' > "$DIFF_OUT" 2>"$DIFF_ERR"; then
    FILES="$(cat "$DIFF_OUT")"
  elif git diff --name-only "$BASE" -- 'docs/specs/spec-*.md' > "$DIFF_OUT" 2>"$DIFF_ERR"; then
    FILES="$(cat "$DIFF_OUT")"
  else
    # Ambos `git diff` fallaron (ref inexistente, fetch insuficiente, etc.) —
    # eso NO es lo mismo que "ningún spec tocado". Fallar cerrado: un diff que
    # no se pudo calcular no es evidencia de que no hay nada que revisar.
    echo "check-blocked-evidence: no se pudo calcular el diff contra '$BASE'." >&2
    cat "$DIFF_ERR" >&2
    rm -f "$DIFF_OUT" "$DIFF_ERR"
    exit 1
  fi
  rm -f "$DIFF_OUT" "$DIFF_ERR"
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

# "qué se intentó": la línea debe nombrar el intento (cualquier conjugación
# de "intentar" — intentó/intento/intenté/intentado/intentaron) y NO ser la
# negación vacía "(no) se intentó nada/ninguna".
attempt_ok() {
  printf '%s' "$1" | grep -qiE 'intent' || return 1
  printf '%s' "$1" | grep -qiE 'intent[a-zóé]*[[:space:]]+(nada|ningun[ao]?)\b' && return 1
  return 0
}

# "contra qué se verificó": cualquier conjugación de "verificar" (el cambio
# ortográfico c→qu antes de "é" — "verifiqué" — necesita su propia rama) y NO
# la negación vacía "(no) se verificó nada/ninguna".
verify_ok() {
  printf '%s' "$1" | grep -qiE 'verific|verifiqu' || return 1
  printf '%s' "$1" | grep -qiE '(verific|verifiqu)[a-zóé]*[[:space:]]+(nada|ningun[ao]?)\b' && return 1
  return 0
}

# `> Bloqueo: (indeterminado — <razón>)` — escape hatch. Rechaza relleno
# obvio (vacío, "razón", "TODO", "???") sin intentar juzgar el contenido real.
indeterminado_reason() { # $1 = línea completa -> imprime la razón o nada
  printf '%s' "$1" | grep -oiE 'indeterminado[[:space:]]*[—-][[:space:]]*[^)]+' \
    | sed -E 's/^[Ii][Nn][Dd][Ee][Tt][Ee][Rr][Mm][Ii][Nn][Aa][Dd][Oo][[:space:]]*[—-][[:space:]]*//'
}

reason_ok() { # $1 = razón extraída
  local r; r="$(printf '%s' "$1" | tr -d '[:space:]')"
  [ "${#r}" -ge 12 ] || return 1
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *razón*real*|*todo*|*'???'*|*'tbd'*|*pendiente' de razón'*) return 1 ;;
  esac
  return 0
}

for f in $FILES; do
  [ -f "$f" ] || continue   # borrado en el PR

  # Pasada 1: fases [blocked] sin ninguna línea `> Bloqueo:` en absoluto.
  awk -v file="$f" '
    function flush() {
      if (pend) {
        if (!bloq) print lineno "\t" head
      }
    }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; head=$0; lineno=NR; next }
    /^#{2,4} /                       { flush(); pend=0; next }
    /^> Bloqueo:/                    { if (pend) { bloq=1 } }
    END { flush() }
  ' "$f" > "/tmp/_bloq_missing_$$" 2>/dev/null || true

  if [ -s "/tmp/_bloq_missing_$$" ]; then
    echo "::error file=$f::Fase(s) [blocked] sin línea '> Bloqueo:'. Cada fase bloqueada necesita en su cuerpo una línea (o bloque de varias) 'Bloqueo:' con qué se intentó, contra qué se verificó, la fecha, y quién puede desbloquearla — o '(indeterminado — razón)' si todavía no se puede articular. Ver docs/specs/CLAUDE.md."
    while IFS="$(printf '\t')" read -r ln head; do echo "    $f:$ln: $head"; done < "/tmp/_bloq_missing_$$"
    FAILED=1
  fi
  rm -f "/tmp/_bloq_missing_$$"

  # Pasada 2: fases con `> Bloqueo:` presente — concatena el bloque completo
  # (la línea inicial + continuaciones consecutivas que empiezan por `>`)
  # antes de validar sus campos.
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
  ' "$f" > "/tmp/_bloq_present_$$" 2>/dev/null || true

  while IFS="$(printf '\t')" read -r ln line; do
    [ -n "$ln" ] || continue

    if printf '%s' "$line" | grep -qiE 'Bloqueo:[[:space:]]*\(indeterminado\b'; then
      razon="$(indeterminado_reason "$line")"
      if ! reason_ok "$razon"; then
        echo "::error file=$f::$f:$ln: '> Bloqueo: (indeterminado — …)' necesita una razón real, no vacía ni de relleno."
        FAILED=1
      fi
    else
      if ! attempt_ok "$line"; then
        echo "::error file=$f::$f:$ln: '> Bloqueo:' no dice qué se intentó (usa 'se intentó ... y devolvió ...', no 'falta X' ni 'se intentó nada')."
        FAILED=1
      fi

      if ! verify_ok "$line"; then
        echo "::error file=$f::$f:$ln: '> Bloqueo:' no dice contra qué se verificó (fichero:línea, consulta, o salida de comando) — no vale 'no se verificó nada'."
        FAILED=1
      fi
    fi

    # fecha real — exigida en ambos modos.
    d="$(printf '%s' "$line" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"
    if [ -z "$d" ] || ! is_real_date "$d"; then
      echo "::error file=$f::$f:$ln: '> Bloqueo:' no trae una fecha real (YYYY-MM-DD)."
      FAILED=1
    fi

    # quién puede desbloquearlo — exigido en ambos modos.
    quien="$(printf '%s' "$line" | grep -oiE 'desbloquea:[[:space:]]*[a-zañ]+' | head -1)"
    case "$(printf '%s' "$quien" | tr '[:upper:]' '[:lower:]')" in
      *usuario*|*agente*) ;;
      *dependencia*)
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
