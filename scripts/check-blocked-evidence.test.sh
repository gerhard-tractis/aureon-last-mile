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

# --- round 2 (B1): el `> Bloqueo:` puede repartirse en varias líneas de
# blockquote consecutivas — es literalmente lo que enseña el ejemplo canónico
# de docs/specs/CLAUDE.md (y su copia en spec-90-...md). Antes de esto, un
# spec que siguiera la documentación al pie de la letra se comía un rojo por
# los tres campos que sí trajo, sólo porque vivían en la línea 2 y 3.
check "Bloqueo multilinea (ejemplo canonico de CLAUDE.md) pasa" 0 "$(mk ok-multiline.md '# S' '**Status:** backlog' '### Fase 3 — Asignación `[blocked]`' '> Bloqueo: se intentó resolver "asignados a ti" contra manifests.assigned_to_user_id' '> — verificado en el esquema QA: la columna existe y está NULL en todas las filas' '> — 2026-09-08 — desbloquea: usuario (quién asigna y desde dónde: spec-82 §1)')"

check "continuacion cortada por linea en blanco no se une" 1 "$(mk cut-multiline.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X' '' '> — verificado en foo.sql:12 — 2026-09-08 — desbloquea: usuario')"

# --- round 2 (B2 + S1): la frase EXACTA que el review encontró ya no cuela.
# round 3 (F2): esto tapa esa frase puntual, no la clase — el nombre del test
# lo dice a propósito para que nadie lo lea como "S1 cerrado". La clase sigue
# abierta (heurística léxica, no semántica): ver el test siguiente.
check "bingo de palabras clave con 'nada' explicito falla (frase puntual, no la clase)" 1 "$(mk bingo.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó nada y no se verificó nada — 2026-09-08 — desbloquea: usuario')"

# --- round 3 (F2), caracterización deliberada de un límite conocido: sólo se
# tapó la frase con "nada" pegado a intentó/verificó. Reformular la misma
# negación vacía sin esa palabra exacta sigue pasando — documentado como
# comportamiento esperado, no como bug pendiente, para que quede explícito en
# la suite y nadie lo redescubra como si fuera nuevo.
check "negacion vacia SIN la palabra 'nada' sigue colando (limite conocido, no un bug)" 0 "$(mk bingo-class.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó absolutamente nada y no se verificó absolutamente nada — 2026-09-08 — desbloquea: usuario')"

check "escalar al orquestador con respuesta real pasa" 0 "$(mk ok-escalado.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó escalar la pregunta al orquestador — verificado: escaló al orquestador el 2026-09-08 y no contestó — desbloquea: usuario')"

# --- round 2 (S2): conjugaciones reales del español, no sólo la 3a persona
# del pretérito ("intentó"/"verificó"). "usuarios" en plural también cuenta.
check "primera persona (intente/verifique) pasa" 0 "$(mk ok-conj.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: lo intenté y lo verifiqué en foo.sql:12 — 2026-09-08 — desbloquea: usuario')"

check "desbloquea usuario en plural pasa" 0 "$(mk ok-plural.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: se intentó X y devolvió Z — verificado en foo.sql:12 — 2026-09-08 — desbloquea: usuarios')"

# --- round 2 (escape hatch): `(indeterminado — razón)` — la lección de
# `**Depende de:**` (spec-91, #699) aplicada aquí desde el primer día: un
# campo obligatorio sin forma honesta de decir "todavía no lo sé" convierte
# una negativa correcta en un build rojo.
check "indeterminado con razon real pasa" 0 "$(mk ok-indet.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — la pantalla de indemnización no está diseñada, no se puede evaluar el efecto aguas abajo todavía) — 2026-09-09 — desbloquea: usuario')"

check "indeterminado sin razon falla" 1 "$(mk bad-indet-empty.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado —) — 2026-09-09 — desbloquea: usuario')"

check "indeterminado con relleno (razon real) falla" 1 "$(mk bad-indet-fill.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — razón real) — 2026-09-09 — desbloquea: usuario')"

# --- round 3 (F3): un contador de caracteres puro dejaba pasar un solo
# "token" repetido sin espacios. Exigir al menos dos palabras lo descarta sin
# pretender juzgar contenido real — mismo nivel de heurística que el resto.
check "indeterminado con token repetido sin espacios falla" 1 "$(mk bad-indet-token.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — aaaaaaaaaaaaaaaaaa) — 2026-09-09 — desbloquea: usuario')"

# --- round 3 (F1, el más serio): el escape hatch reabría justo el caso que
# `docs/specs/CLAUDE.md` prohíbe — "(indeterminado — no tengo acceso a
# producción)" pasaba sin ninguna evidencia de haber escalado nada.
check "indeterminado con 'no tengo acceso' sin escalar falla" 1 "$(mk bad-indet-access.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — no tengo acceso a producción) — 2026-09-09 — desbloquea: usuario')"

check "indeterminado con 'no puedo' sin escalar falla" 1 "$(mk bad-indet-nopuedo.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — no puedo verificar esto) — 2026-09-09 — desbloquea: usuario')"

check "indeterminado con 'no tengo acceso' Y escalado pasa" 0 "$(mk ok-indet-access.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — no tengo acceso a producción, se escaló al orquestador y no contestó) — 2026-09-09 — desbloquea: usuario')"

check "indeterminado sigue exigiendo fecha" 1 "$(mk bad-indet-date.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — todavía no se pudo determinar el efecto) — desbloquea: usuario')"

check "indeterminado sigue exigiendo desbloquea" 1 "$(mk bad-indet-quien.md '# S' '**Status:** backlog' '### F1 `[blocked]`' '> Bloqueo: (indeterminado — todavía no se pudo determinar el efecto) — 2026-09-09')"

# --- round 2 (S6): un diff que no se pudo calcular NO es lo mismo que "nada
# tocado" — antes ambos devolvían exit 0 en silencio.
out=$(cd "$(cd "$(dirname "$0")/.." && pwd)" && bash "$S" --base "refs/heads/rama-que-no-existe-en-ningun-lado-xyz" 2>&1); code=$?
if [ "$code" -ne 0 ]; then echo "  ok   --base irresoluble falla cerrado, no pasa en silencio"; PASS=$((PASS+1))
else echo "  FAIL --base irresoluble debia fallar cerrado, obtuvo exit 0: $out"; FAIL=$((FAIL+1)); fi

# --- validación contra la realidad, derivada dinámicamente (round 2): la
# lista fija de specs murió porque congelaba una foto del corpus a un SHA —
# spec-86 salió de ella sin que el guard cambiara, sólo porque `bbc6eb7`
# (PR #687, 2026-09-08T15:18:52Z) resolvió su decisión pendiente 18 minutos
# ANTES de que este mismo fixture se escribiera (`fb6fa0a`,
# 2026-09-08T15:37:19Z) — no fue deriva concurrente, fue que el checkout de
# esta rama partía de un commit (`8fcb4c8`, 14:58:41Z) ya viejo para cuando
# se escribió la lista. Fijar a un SHA no arregla eso, sólo lo pospone al
# próximo spec que se backfillee.
#
# En su lugar: recorre docs/specs/spec-*.md HOY, construye el conjunto de
# specs con al menos una fase `[blocked]` sin `> Bloqueo:` en su cuerpo (una
# detección independiente de la del guard, para no validar el guard contra sí
# mismo), y afirma dos invariantes que no dependen de qué specs sean:
#   (a) el conjunto no está vacío — mata el mutante "el guard no ve nada",
#       que es el fallo real que costó una ronda de review esta semana;
#   (b) cada miembro del conjunto hace fallar al guard de verdad (exit 1).
# Si mañana alguien backfillea uno, el conjunto encoge solo y el test sigue
# verde — no hay lista que mantener.
has_unguarded_blocked() { # $1=archivo -> "yes" si tiene [blocked] sin > Bloqueo:
  awk '
    function flush() { if (pend && !bloq) found=1 }
    /^#{2,4} .*\[blocked\]`?[ \t]*$/ { flush(); pend=1; bloq=0; next }
    /^#{2,4} /                       { flush(); pend=0; next }
    /^> Bloqueo:/                    { if (pend) bloq=1 }
    END { flush(); if (found) print "yes" }
  ' "$1"
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANDIDATES=""
for f in "$ROOT"/docs/specs/spec-*.md; do
  [ -f "$f" ] || continue
  [ "$(has_unguarded_blocked "$f")" = "yes" ] || continue
  CANDIDATES="$CANDIDATES $f"
done
CANDIDATES="$(printf '%s' "$CANDIDATES" | sed -E 's/^ +//')"

if [ -z "$CANDIDATES" ]; then
  echo "  FAIL smoke: el corpus real no tiene HOY ningún spec [blocked] sin '> Bloqueo:' — el conjunto no debería estar vacío (o el backfill ya terminó y este test necesita repensarse, no sólo pasar)."
  FAIL=$((FAIL+1))
else
  n=0; for _ in $CANDIDATES; do n=$((n+1)); done
  echo "  ok   smoke: hay $n spec(s) real(es) con [blocked] sin '> Bloqueo:' hoy"
  PASS=$((PASS+1))
  for f in $CANDIDATES; do
    check "smoke: $(basename "$f") sin Bloqueo falla contra el guard real" 1 "$f"
  done
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
