#!/usr/bin/env bash
# Tests de scripts/check-spec-fields.sh
set -uo pipefail
S="$(cd "$(dirname "$0")" && pwd)/check-spec-fields.sh"
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

echo "check-spec-fields.sh"
: > "$D/down-target.md"

check "spec completo pasa" 0 "$(mk ok.md '# S' '**Status:** in progress' '**Verify:** unit, e2e-qa' '### Fase 1 `[pending]`' '**Archivos:** `a.ts`')"
check "sin fases no exige Verify" 0 "$(mk idea.md '# S' '**Status:** backlog' '## Goal' 'texto')"
check "fases sin Verify falla" 1 "$(mk noverify.md '# S' '**Status:** in progress' '### Fase 1 `[pending]`')"
check "sin Status falla" 1 "$(mk nostatus.md '# S' '**Verify:** unit' '### Fase 1 `[done]`')"
check "token mal escrito falla" 1 "$(mk typo.md '# S' '**Status:** in progress' '**Verify:** unit' '### Fase 1 `[in progress]`')"
check "token inventado falla" 1 "$(mk typo2.md '# S' '**Status:** in progress' '**Verify:** unit' '### Fase 1 `[pendign]`')"
check "todos los tokens validos pasan" 0 "$(mk all.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[pending]`' '**Archivos:** `a.ts`' '### F2 `[in_progress]`' '**Archivos:** `b.ts`' '### F3 `[blocked]`' '### F4 `[awaiting_user_test]`' '### F5 `[done]`' '> Implementado por: implementer — rama x, SHA abc1234' '> Review: reviewer — sin hallazgos' '> QA: PR #1 merged, e2e verde' '### F6 `[parked]`')"
check "archivo inexistente no rompe" 0 "$D/no-existe.md"

# closed / completed no pueden dejar fases abiertas — el hook Stop lee los tokens,
# no el **Status:**, así que la cabecera y las fases tienen que coincidir.
check "closed con fase blocked falla" 1 "$(mk closed-open.md '# S' '**Status:** closed' '**Verify:** unit' '### F1 `[done]`' '### F2 `[blocked]`')"
check "closed con fase pending falla" 1 "$(mk closed-pending.md '# S' '**Status:** closed' '**Verify:** unit' '### F1 `[pending]`')"
check "closed todo done pasa" 0 "$(mk closed-ok.md '# S' '**Status:** closed' '**Verify:** unit' '### F1 `[done]`' '### F2 `[parked]`')"
check "completed con fase abierta falla" 1 "$(mk comp-open.md '# S' '**Status:** completed' '**Verify:** unit' '### F1 `[awaiting_user_test]`')"
check "in progress con fase abierta pasa" 0 "$(mk inprog.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[blocked]`')"

# Downstream: un spec que declara dependientes debe reconciliarlos al cerrar una
# fase. La referencia colgada y la fase [done] sin reconciliar son los dos modos
# de fallo que dejan al spec siguiente construyendo sobre una suposición vieja.
check "downstream a spec inexistente falla" 1 "$(mk down-dangling.md '# S' '**Status:** in progress' '**Verify:** unit' '**Downstream:** spec-99-no-existe.md' '### F1 `[pending]`')"
check "fase done sin reconciliacion falla" 1 "$(mk down-norec.md '# S' '**Status:** in progress' '**Verify:** unit' '**Downstream:** down-target.md' '### F1 `[done]`' 'prosa cualquiera')"
check "fase done con reconciliacion pasa" 0 "$(mk down-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '**Downstream:** down-target.md' '### F1 `[done]`' '> Downstream: revisado down-target (PR #1) — sin cambios' '> Implementado por: implementer — rama x, SHA abc1234' '> Review: reviewer — sin hallazgos' '> QA: PR #1 merged, e2e verde')"
check "sin Downstream no exige reconciliacion" 0 "$(mk down-absent.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '> Implementado por: implementer — rama x, SHA abc1234' '> Review: reviewer — sin hallazgos' '> QA: PR #1 merged, e2e verde')"
check "reconciliacion de otra fase no cuenta" 1 "$(mk down-wrongphase.md '# S' '**Status:** in progress' '**Verify:** unit' '**Downstream:** down-target.md' '### F1 `[done]`' '### F2 `[done]`' '> Downstream: revisado (PR #1) — sin cambios')"

# un heading con corchetes que NO es fase (link markdown) no debe fallar
check "link markdown en heading no confunde" 0 "$(mk link.md '# S' '**Status:** backlog' '### Ver [spec-42](spec-42.md)')"

# **Archivos:** — declara la superficie de ficheros de la fase; es lo que
# scripts/check-phase-overlap.mjs lee para decidir si dos fases se pueden
# despachar en paralelo sin pisarse. Sólo se exige en [pending]/[in_progress]
# (el trabajo que un agente todavía puede tomar) — no en [done]/[blocked]/
# [parked]/[awaiting_user_test], para no romper retroactivamente las fases
# ya cerradas o paradas que nunca la llevaron.
check "fase pending sin Archivos falla" 1 "$(mk arch-pend-missing.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[pending]`' 'prosa')"
check "fase in_progress sin Archivos falla" 1 "$(mk arch-inprog-missing.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[in_progress]`' 'prosa')"
check "fase pending con Archivos pasa" 0 "$(mk arch-pend-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[pending]`' '**Archivos:** `a.ts`')"
check "fase in_progress con Archivos pasa" 0 "$(mk arch-inprog-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[in_progress]`' '**Archivos:** `a.ts`' '> Implementado por: x')"
check "fase blocked sin Archivos pasa" 0 "$(mk arch-blocked-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[blocked]`' 'prosa')"
check "fase done sin Archivos pasa" 0 "$(mk arch-done-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '> Implementado por: implementer — rama x, SHA abc1234' '> Review: reviewer — sin hallazgos' '> QA: PR #1 merged, e2e verde')"
check "fase parked sin Archivos pasa" 0 "$(mk arch-parked-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[parked]`' 'prosa')"
check "fase awaiting_user_test sin Archivos pasa" 0 "$(mk arch-await-ok.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[awaiting_user_test]`' 'prosa')"
check "Archivos de otra fase no cuenta para esta" 1 "$(mk arch-wrongphase.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '**Archivos:** `a.ts`' '### F2 `[pending]`' 'prosa sin archivos')"


# Evidencia de fase: el flujo orquestador -> implementer -> reviewer -> qa-e2e
# sólo es comprobable si la fase carga rama, SHA y PR. Sin eso, "listo" es la
# palabra de un subagente y nada más.
check "done sin evidencia falla" 1 "$(mk ev-none.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`')"
check "done con evidencia parcial falla" 1 "$(mk ev-partial.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '> Implementado por: implementer — SHA abc1234')"
check "done con evidencia completa pasa" 0 "$(mk ev-full.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '> Implementado por: implementer — rama x, SHA abc1234' '> Review: reviewer — 2 hallazgos cerrados' '> QA: PR #9 merged, e2e verde')"
check "evidencia de otra fase no cuenta" 1 "$(mk ev-leak.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[done]`' '> Implementado por: x' '> Review: y' '> QA: z' '### F2 `[done]`')"
check "spec closed exento de evidencia" 0 "$(mk ev-closed.md '# S' '**Status:** closed' '**Verify:** unit' '### F1 `[done]`')"
check "fases no-done no exigen evidencia" 0 "$(mk ev-open.md '# S' '**Status:** in progress' '**Verify:** unit' '### F1 `[pending]`' '**Archivos:** `a.ts`' '### F2 `[parked]`')"
echo
echo "  $PASS ok, $FAIL fail"
[ "$FAIL" -eq 0 ]
