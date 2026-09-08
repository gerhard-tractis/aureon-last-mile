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

  # Downstream: los specs que dependen de LA IMPLEMENTACIÓN de éste.
  #
  # Por qué existe: un spec se escribe contra el estado del código de ese día.
  # Cuando la fase de la que depende se implementa de verdad, lo implementado
  # casi nunca es idéntico a lo planeado — un RPC cambia de firma, una columna
  # se llama distinto, una decisión se resuelve al revés. El spec siguiente
  # sigue afirmando lo viejo, y quien lo tome construye sobre una suposición
  # que dejó de ser cierta. Ya pasó en este repo: spec-54 daba por hecho un
  # flujo de Recogida que spec-47 había cambiado, y nadie lo notó durante
  # semanas.
  #
  # La regla: una fase no pasa a [done] hasta que cada spec downstream se haya
  # releído contra lo que REALMENTE se mergeó, y quede dicho — con cambios o
  # con un "sin cambios" explícito.
  down_raw="$(grep -m1 -E '^\*\*Downstream:\*\*' "$f" 2>/dev/null || true)"
  if [ -n "$down_raw" ]; then
    # 1) cada spec nombrado tiene que existir: una referencia colgada es peor
    #    que ninguna, porque promete una revisión que nadie puede hacer.
    for ref in $(printf '%s' "$down_raw" | grep -oE 'spec-[0-9]+[a-z]?-[a-z0-9-]+\.md'); do
      if [ ! -f "$(dirname "$f")/$ref" ]; then
        echo "::error file=$f::**Downstream:** nombra $ref, que no existe en docs/specs/."
        FAILED=1
      fi
    done

    # 2) toda fase [done] necesita su línea de reconciliación dentro del cuerpo
    #    de la fase. Se busca hasta el siguiente heading, no N líneas fijas.
    awk -v file="$f" '
      /^#{2,4} .*\[done\]`?[[:space:]]*$/ {
        if (pend && !seen) { print lineno "	" head; }
        pend=1; seen=0; head=$0; lineno=NR; next
      }
      /^#{2,4} / { if (pend && !seen) { print lineno "	" head; } pend=0; seen=0; next }
      /^> Downstream:/ { if (pend) seen=1 }
      END { if (pend && !seen) print lineno "	" head }
    ' "$f" > /tmp/_down_missing.$$ 2>/dev/null || true
    if [ -s /tmp/_down_missing.$$ ]; then
      echo "::error file=$f::Fase(s) [done] sin línea de reconciliación downstream. Añade dentro de la fase: \`> Downstream: revisado spec-NN (PR #X) — sin cambios\` (o describe el cambio)."
      while IFS=$'	' read -r ln head; do echo "    $f:$ln: $head"; done < /tmp/_down_missing.$$
      FAILED=1
    fi
    rm -f /tmp/_down_missing.$$
  fi

  # Un spec cerrado o completado no puede dejar fases abiertas.
  #
  # El `**Status:**` de cabecera no es lo que lee el hook Stop: lee los tokens de
  # fase. Así que un spec marcado `closed` con una fase `[blocked]` dentro sigue
  # apareciendo como trabajo declarado y sin tomar — justo lo que ese estado
  # existe para evitar. La cabecera y las fases tienen que decir lo mismo.
  status="$(grep -m1 -E '^\*\*Status:\*\*' "$f" 2>/dev/null             | sed -e 's/^\*\*Status:\*\*[[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d '
')"
  case "$status" in
    closed|completed)
      OPEN='pending|in_progress|blocked|awaiting_user_test'
      still_open="$(grep -nE "^#{2,4} .*\[($OPEN)${TOKEN_END}" "$f" 2>/dev/null || true)"
      if [ -n "$still_open" ]; then
        echo "::error file=$f::Status '$status' pero quedan fases abiertas. Muévelas a otro spec o márcalas [parked] con la razón. Ver docs/specs/CLAUDE.md."
        echo "$still_open" | while IFS= read -r l; do echo "    $f:$l"; done
        FAILED=1
      fi
      ;;
  esac

  # Evidencia por fase: quién la implementó, quién la revisó, qué dijo QA.
  #
  # El flujo determinista es orquestador -> implementer -> reviewer -> qa-e2e,
  # y nada de eso se puede comprobar leyendo el spec... salvo que el spec cargue
  # los identificadores. Por eso se piden rama, SHA y número de PR: se verifican
  # contra git y contra `gh`, y no dependen de que un subagente diga "listo".
  # Un review que NO se hizo se declara igual, con esas palabras — el hueco
  # honesto vale más que la casilla marcada.
  #
  # Exentos `closed` y `superseded`: son historia, y exigirles evidencia
  # obligaría a inventarla para trabajo de hace meses.
  case "$status" in
    closed|superseded) ;;
    *)
      awk '
        function flush() {
          if (pend) {
            miss = ""
            if (!impl) miss = miss " Implementado-por"
            if (!rev)  miss = miss " Review"
            if (!qa)   miss = miss " QA"
            if (miss != "") print lineno "	" miss "	" head
          }
        }
        /^#{2,4} .*\[done\]`?[ 	]*$/ { flush(); pend=1; impl=0; rev=0; qa=0; head=$0; lineno=NR; next }
        /^#{2,4} /            { flush(); pend=0; next }
        /^> Implementado por:/ { if (pend) impl=1 }
        /^> Review:/           { if (pend) rev=1 }
        /^> QA:/               { if (pend) qa=1 }
        END { flush() }
      ' "$f" > "/tmp/_ev_$$" 2>/dev/null || true
      if [ -s "/tmp/_ev_$$" ]; then
        echo "::error file=$f::Fase(s) [done] sin evidencia. Cada fase cerrada necesita en su cuerpo: '> Implementado por:' (agente + rama + SHA), '> Review:' (hallazgos, o 'sin revisión' y por qué) y '> QA:' (PR y resultado leido del reporte)."
        while IFS="$(printf '	')" read -r ln miss head; do echo "    $f:$ln: falta$miss — $head"; done < "/tmp/_ev_$$"
        FAILED=1
      fi
      rm -f "/tmp/_ev_$$"
      ;;
  esac

  # **Archivos:** — la superficie de ficheros que la fase va a tocar. Es lo
  # que scripts/check-phase-overlap.mjs lee para decidir si dos fases se
  # pueden despachar en paralelo sin pisarse (ver spec-89). Sólo se exige en
  # [pending]/[in_progress] — el trabajo que un agente todavía puede tomar.
  # No en [done]/[blocked]/[parked]/[awaiting_user_test]: retrofitear esa
  # línea a fases ya cerradas o paradas no ayuda a nadie a decidir un
  # dispatch futuro, y rompería en bloque las que nunca la llevaron.
  awk '
    function flush() {
      if (pend && !seen) print lineno "\t" head
    }
    /^#{2,4} .*\[(pending|in_progress)\]`?[ \t]*$/ { flush(); pend=1; seen=0; head=$0; lineno=NR; next }
    /^#{2,4} /                                     { flush(); pend=0; next }
    /^\*\*Archivos:\*\*/                           { if (pend) seen=1 }
    END { flush() }
  ' "$f" > "/tmp/_arch_$$" 2>/dev/null || true
  if [ -s "/tmp/_arch_$$" ]; then
    echo "::error file=$f::Fase(s) [pending]/[in_progress] sin **Archivos:**. Declara qué ficheros toca la fase — scripts/check-phase-overlap.mjs lo necesita para el guardarraíl de paralelismo (ver docs/specs/spec-89-guardarrail-de-paralelismo.md)."
    while IFS="$(printf '\t')" read -r ln head; do echo "    $f:$ln: $head"; done < "/tmp/_arch_$$"
    FAILED=1
  fi
  rm -f "/tmp/_arch_$$"

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
