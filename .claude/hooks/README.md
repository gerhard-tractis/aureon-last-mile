# keep-going + resume-check

Quitan las pausas de "¿avanzo a la siguiente fase?" sin quitar las preguntas
legítimas por ambigüedad del spec.

## Convención de estado

Cada heading de fase termina con un token. Es la única fuente de verdad de
estado por fase; la prosa explica, el token decide.

```
### Fase 1 — webhook_events `[parked]`
### Fase 2 — SLA en SQL `[done]`
### Fase 3 — 3a, la lista `[in_progress]`
### Fase 4 — 3b y 1f `[pending]`
```

| Token | Quién tiene la pelota | ¿El agente la toma? |
|---|---|---|
| `[pending]` | nadie | **sí — la única que toma** |
| `[in_progress]` | un agente, ahora | no |
| `[blocked]` | el usuario, para continuar | no |
| `[awaiting_user_test]` | el usuario, para cerrar | no |
| `[done]` | nadie | no |
| `[parked]` | decisión de no construirla | no |

El `**Status:**` del spec no cambia y sigue mandando a nivel de spec.

## keep-going.sh — Stop hook

Bloquea el fin de turno mientras el spec activo declare trabajo sin cerrar.
La señal es de **estado, no de prosa**: un turno que dice "arrancando la fase 3"
y termina sin mover nada se bloquea igual, porque compara la huella de git
(`HEAD` + archivos sucios) contra la del turno anterior.

También bloquea si el spec tiene fases pero no tiene línea `**Verify:**` — sin
jueces declarados no hay criterio de término y el PR falla igual en CI.

Deja terminar cuando: no está habilitado · `stop_hook_active` · `.claude/BLOCKED.md`
tiene contenido · no identifica el spec · no quedan `[pending]` ni `[in_progress]` ·
se pasó de `KEEP_GOING_MAX` (12) continuaciones.

Nunca corre tests ni type-check — dispara en cada fin de turno.

## resume-check.sh — SessionStart hook

Un agente que muere (529, crash) nunca dispara `Stop`, así que deja el token
`[in_progress]` mintiendo. Este hook usa la mtime de `.claude/.keep-going-fp`
—que keep-going reescribe en cada turno— como latido. Si hay `[in_progress]` y
el latido es de hace más de `KEEP_GOING_STALE_MIN` (30) minutos, entrega los
hechos de git y pide reconciliar. **No reescribe el spec.**

## Activación

`CLAUDE.md` prohíbe modificar `.claude/settings*.json`, así que este paso es tuyo.
En `.claude/settings.local.json`, junto a `permissions`:

```json
"hooks": {
  "Stop": [
    { "hooks": [{ "type": "command", "command": "bash .claude/hooks/keep-going.sh" }] }
  ],
  "SessionStart": [
    { "hooks": [{ "type": "command", "command": "bash .claude/hooks/resume-check.sh" }] }
  ]
}
```

Opcional, en `.gitignore`:

```
.claude/keep-going.on
.claude/.keep-going-count
.claude/.keep-going-fp
.claude/BLOCKED.md
.claude/active-spec
```

## Uso

```bash
touch .claude/keep-going.on              # encender en este worktree
rm    .claude/keep-going.on              # apagar
bash .claude/hooks/keep-going.test.sh      # 17 casos
bash .claude/hooks/resume-check.test.sh    #  7 casos
bash scripts/check-spec-fields.test.sh     #  9 casos
```

Es opt-in por worktree: puedes probarlo en uno sin tocar el resto.

## Piezas relacionadas

| Archivo | Rol |
|---|---|
| `scripts/verify.sh` | El gate barato. Un exit code: ¿está verde? |
| `scripts/check-spec-fields.sh` | Guard de CI: exige `**Status:**`, `**Verify:**` y tokens válidos en los specs del PR |
| `.claude/agents/*.md` | implementer (sonnet, worktree) · reviewer (opus, solo lectura) · qa-e2e |
| `docs/specs/CLAUDE.md` | La convención: Phase Status y Verify |
