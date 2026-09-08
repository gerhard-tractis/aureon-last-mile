# Plans

## Naming Convention

```
spec-XX-description-of-the-spec.md
```

Scan for highest existing number, add one. Zero-padded (01, 02, ...). Never skip or reuse.

**A number is only reserved by a file in this directory.** Do not pre-assign numbers to future work in any other document — a planning table, a roadmap, an issue. Those reservations are invisible to the scan above, so two people working in parallel will pick the same number. This has already happened twice: `docs/architecture/phased-rollout-strategy.md` claimed 47/48/49, which were taken on disk; it was corrected to 53/54/55, and spec-53 was taken on disk two days later. Describe planned work by name and assign the number when you create the file.

**One file per spec only.** The spec and implementation plan live in the same file. Never create a separate `...Plan.md` or any companion file for a spec.

## Spec States

Every spec file must have a `**Status:**` line at the top. Keep it updated.

| State | When |
|---|---|
| `backlog` | Spec written, not yet started |
| `in progress` | Implementation has begun, y queda trabajo que un agente puede tomar |
| `awaiting_user_test` | No queda nada que un agente pueda hacer: toda fase restante espera a una persona |
| `completed` | Las cuatro pruebas de abajo pasaron. No hace falta que el usuario confirme |
| `closed` | Entregó lo suyo y **no queda nada abierto en él**: lo que faltaba se movió a specs nombrados o se descartó explícitamente. No se vuelve a abrir |
| `superseded` | The feature was removed or replaced — the spec is history, not live behaviour |

Rules:
- Set to `in progress` when the first implementation commit is made
- Set to `completed` cuando **las cuatro** se cumplen, con evidencia, sin preguntar:
  1. **Code review hecho** — revisión adversarial de lo implementado, y sus hallazgos
     cerrados o anotados explícitamente en el spec como abiertos y por qué.
  2. **CI verde** — `gh pr checks <N>`, no la impresión de que pasó.
  3. **PR mergeado** — `gh pr view <N> --json state,mergedAt` lo confirma.
  4. **E2E en QA verde** — leyendo el reporte, no el check: el job `e2e-qa` es
     `continue-on-error: true`, así que un pipeline verde no prueba nada.
- Set to `awaiting_user_test` cuando **ninguna fase restante la puede tomar un
  agente**: todas están en `awaiting_user_test` (algo que sólo cierra una persona
  con el hardware o con acceso a producción) o en `blocked` (espera una decisión
  del usuario). Es el estado honesto para un spec terminado por nuestro lado:
  `in progress` dice «hay trabajo en curso» y hace que el spec se lea como activo
  cuando en realidad la pelota es del usuario. Junto al `**Status:**`, una línea
  diciendo **qué falta y quién puede cerrarlo** — sin eso el estado no sirve.
- De `awaiting_user_test` se sale en dos direcciones: a `completed` cuando la
  persona cierra lo que faltaba, o de vuelta a `in progress` si su respuesta abre
  trabajo nuevo.
- **Ninguna fase en `awaiting_user_test` puede quedar abierta.** Ese token existe
  para lo que sólo cierra una persona con el hardware o con acceso a producción
  (legibilidad a tres metros, una medición en el dispositivo real, un conteo en
  prod). Si queda una, el spec **no** está `completed`: sigue `in progress`, y se
  dice en una línea qué falta y quién puede cerrarlo.
- Si falta cualquiera de las cuatro, o el E2E no existe para ese spec, no se marca
  `completed` — se dice qué falta. La regla vieja («esperar a que el usuario
  confirme») se cambió porque el usuario ya no es el cuello de botella cuando hay
  evidencia; la evidencia sí es el requisito.
- Set to `closed` cuando el spec **ya no tiene nada abierto** y no queremos volver a
  verlo: entregó lo que le tocaba, y cada fase que quedaba o se **movió a un spec
  nombrado** o se marcó `[parked]` con la razón escrita. Junto al `**Status:**`,
  una línea diciendo **a dónde se fue lo que faltaba**.

  No es `completed`: eso afirma las cuatro pruebas sobre *todo* el spec, y aquí
  hay partes que deliberadamente no se construyeron. No es `superseded`: eso dice
  que lo descrito ya no es el comportamiento vivo, y lo entregado por un spec
  `closed` **sí** está corriendo en producción. Tampoco es `dropped` — nada se
  tiró — ni `deferred`, que promete una vuelta que no va a ocurrir.

  **Un spec `closed` no puede tener ninguna fase en `pending`, `in_progress`,
  `blocked` ni `awaiting_user_test`.** Ésa es la parte que hace verdad el «no lo
  vemos más»: el estado de cabecera no basta, porque el hook `Stop` lee los
  tokens de fase, no el `**Status:**`. Un spec `closed` con una fase `[blocked]`
  seguiría apareciendo como trabajo declarado. `scripts/check-spec-fields.sh` lo
  aplica en CI, con la misma regla para `completed`.

- Set to `superseded` when later work removes or replaces what the spec describes,
  and say so in a note at the top: what replaced it, which PR, and what a revival
  would actually require. A `completed` spec reads as a description of the running
  system, and a `backlog` one reads as ready to pick up — both mislead once the
  feature is gone. The landing specs (17, 26a-c) are the worked example.

## Estado por fase: el token en el heading

`**Status:**` describe el spec entero. **El estado de cada fase va en un token al final de su heading**, y esa es la única fuente de verdad por fase — la prosa explica, el token decide.

```
### Fase 1 — webhook_events y el registro de eventos `[done]`
### Fase 2 — SLA en SQL y get_orders_list `[in_progress]`
### Fase 3 — 3a, la lista `[pending]`
### Fase 4 — 3b y 1f `[blocked]`
```

| Token | Quién tiene la pelota | ¿Un agente la toma? |
|---|---|---|
| `pending` | nadie | **sí — la única que toma** |
| `in_progress` | un agente, ahora | no |
| `blocked` | el usuario, para poder continuar | no |
| `awaiting_user_test` | el usuario, para poder cerrar | no |
| `done` | nadie | no |
| `parked` | no se construye **aquí**: se descartó, o se movió a un spec nombrado (dilo en la línea de al lado) | no |

**Por qué importa.** Lo lee una máquina: el hook `Stop` (`.claude/hooks/keep-going.sh`) usa estos tokens para decidir si queda trabajo declarado y sin tomar. Un spec con el estado sólo en prosa — «fase 4 aparcada», «esta ya está hecha» — es invisible para él, así que el agente termina el turno y pregunta en vez de seguir. Los specs 75–79 nacieron así y hubo que retrofitearlos.

**Cuidado al asignar.** El token dice quién tiene la pelota, no si el trabajo fue difícil. Dos errores que ya se cometieron al retrofitear:
- Marcar `blocked` una fase que en realidad estaba **terminada** (`spec-77` fase 0).
- Marcar `blocked` la fase que precisamente **desbloquea** a las demás (`spec-79` fase 0). Si nadie está esperando a nadie para empezarla, es `pending`.

Los dos hacen que el hook se salte trabajo disponible, que es justo lo que existe para evitar.

## La rama de una fase lleva su número

Cuando se delega una fase, la rama **debe** llevar `<spec-id>-fase-<n>` en el
nombre:

```
feat/spec-85-fase-1-esquema      ✅
feat/spec-80-fase-0-reconectar-firma  ✅
work/spec-85-fix                 ❌ no dice qué fase
```

**Por qué es obligatorio y no estético.** El token `[in_progress]` vive en el
archivo del spec, que es **por rama**: mientras el trabajo no mergee, la rama del
spec sigue diciendo `[pending]`. Así que ni el hook `Stop` ni otra sesión pueden
saber por el archivo que la fase está tomada.

Las ramas sí son estado global. `keep-going.sh` lee las refs locales de
seguimiento y **trata como tomada toda fase que tenga una rama con su número**,
diga lo que diga el token. Sin el número en el nombre, esa relación no existe.

Ocurrió el 2026-09-07: la fase 1 de spec-87 se señaló como pendiente tres turnos
seguidos mientras un implementer la construía. Con una sesión eso es ruido; con
dos en paralelo es trabajo duplicado sobre los mismos archivos.

**Limitación honesta:** el hook usa las refs del último `fetch`. Una rama recién
empujada desde otra máquina no se ve hasta el siguiente. Se acepta a propósito —
el hook dispara en cada fin de turno y no puede hacer red.

## Evidencia por fase — quién implementó, quién revisó, qué dijo QA

El flujo de implementación es **determinista y delegado**. La sesión principal
orquesta; no escribe código:

```
orquestador   lee el spec, toma LA fase [pending], la pasa a [in_progress]
    ↓
implementer   worktree propio, TDD de superpowers, UNA fase, commitea
    ↓
reviewer      opus, sólo lectura, adversarial sobre ese rango de SHAs
    ↓
implementer   corrige (el orquestador nunca parchea el trabajo del otro)
    ↓
orquestador   abre PR + auto-merge
    ↓
qa-e2e        gh pr checks + estado de merge + LEE el reporte de e2e
    ↓
orquestador   pasa la fase a [done] con la evidencia
```

Nada de eso se puede comprobar leyendo el spec… salvo que el spec cargue los
identificadores. Por eso **una fase `[done]` necesita tres líneas en su cuerpo**:

```
### Fase 1 — close_manifest RPC `[done]`

> Implementado por: implementer — rama feat/spec-80-fase-1, SHA abc1234
> Review: reviewer — 2 hallazgos, cerrados en def5678
> QA: PR #643 merged 2026-09-08T10:12Z, e2e-qa leído en el reporte: 14 passed
> Downstream: revisado spec-81, spec-83 — sin cambios
```

Rama, SHA y número de PR se verifican contra `git` y contra `gh`. **No dependen
de que un subagente diga «listo»** — que es precisamente lo que no vale como
evidencia.

**El hueco se declara, no se maquilla.** Si no hubo review, la línea lo dice y
por qué. La fase 0 de spec-80 es el ejemplo vivo: se mergeó sin review porque el
review se detuvo a medias, y así está escrito. Un hueco declarado se puede
cerrar después; una casilla marcada en falso, no.

`scripts/check-spec-fields.sh` lo aplica en CI. Exentos `closed` y `superseded`:
son historia, y pedirles evidencia obligaría a inventarla.

## El harness tiene que existir en el repo

`scripts/check-harness-present.sh` verifica que los tres agentes
(`implementer`, `reviewer`, `qa-e2e`), los dos hooks y `.claude/settings.json`
estén **trackeados**, con el `name:` del frontmatter igual al del archivo — el
runtime resuelve por ese campo.

Existe porque el 2026-09-07 los tres agentes desaparecieron a mitad de sesión.
No los borró nadie a propósito: vivían **sólo como archivos sin trackear** en un
checkout 106 commits por detrás de `main`. `git restore` no recupera lo que no
está trackeado, un worktree nuevo no lo hereda, y el runtime —que escanea el
directorio de trabajo— dejó de ofrecerlos sin avisar. El orquestador se quedó
sin a quién delegar y siguió implementando él mismo.

Ningún guard puede impedir que alguien borre archivos de su disco. Lo que sí
impide es que salgan del repo: mientras estén trackeados y CI lo verifique,
cualquier checkout limpio los recupera.

## `**Downstream:**` — los specs que dependen de lo que éste implemente

Un spec se escribe contra el estado del código **del día en que se escribió**.
Cuando la fase de la que depende se implementa, lo que se mergeó casi nunca es
idéntico a lo planeado: un RPC cambia de firma, una columna se llama distinto,
una decisión de las que quedaron abiertas se resuelve al revés de lo previsto.
El spec siguiente sigue afirmando lo viejo, y quien lo tome construye sobre una
suposición que dejó de ser cierta.

**No es hipotético.** spec-54 daba por implementado un flujo de Recogida que
spec-47 había cambiado — borró la pantalla de Entrega y dejó la de Firma
inalcanzable — y nadie lo notó durante semanas, hasta que un tester intentó
firmar un manifiesto y no pudo.

Un spec que tenga dependientes los declara junto al `**Status:**`:

```
**Status:** backlog
**Verify:** unit, e2e-qa
**Downstream:** spec-81-recogida-cola-offline.md, spec-82-recogida-movil-asignacion-y-ruta.md
```

**La regla: una fase no pasa a `[done]` hasta que cada spec downstream se haya
releído contra lo que REALMENTE se mergeó**, y quede dicho dentro de esa fase:

```
### Fase 1 — `close_manifest` RPC `[done]`

> Downstream: revisado spec-81 y spec-83 (PR #641) — spec-83 fase 1 asumía que
> el RPC devolvía el conteo de faltantes; devuelve el id del cierre. Corregido allí.
```

Si de verdad no cambió nada, se dice igual: `> Downstream: revisado spec-82
(PR #641) — sin cambios`. El silencio no distingue «lo revisé y está bien» de
«no lo revisé», y esa diferencia es justamente la que cuesta semanas.

`scripts/check-spec-fields.sh` lo aplica en CI: rechaza una referencia colgada
(un spec downstream que no existe) y una fase `[done]` sin su línea de
reconciliación. La línea se busca **dentro del cuerpo de esa fase**, hasta el
siguiente heading — la de otra fase no cuenta.

Declararlo es del que escribe el spec: si al escribirlo tienes que leer otro
spec para saber qué asumir, ese otro spec te tiene a ti como downstream.

## `**Verify:**`, junto al `**Status:**`

Un spec que declara fases con token **debe** llevar una línea `**Verify:**` nombrando los jueces de aceptación. Sin ella no hay criterio de término.

`scripts/check-spec-fields.sh` lo aplica en CI, sólo sobre los specs que toca el
PR — los antiguos migran cuando alguien los toca. El script se escribió para
cerrar exactamente este agujero: este documento afirmaba durante meses que la
regla estaba aplicada cuando no existía nada que la aplicara, el mismo error que
`pgtap-local.sh` (daba PASS a archivos inexistentes). Una afirmación de
verificación sin verificación detrás es peor que no tener la regla.

```
**Status:** in progress
**Verify:** unit, e2e-qa
```

Ejemplos por tipo de spec: `unit` (lógica pura), `unit, e2e-qa` (pantallas), `unit, sql, e2e-qa` (cambios de schema o RPC), `unit, golden, invariants` (lógica pesada).

`scripts/verify.sh` consume estos nombres para decidir qué jueces correr. `unit`
va siempre incluido; `e2e-qa` corre sólo en CI y se reporta como diferido;
cualquier otro nombre tiene que existir como `scripts/judges/<nombre>.sh`. Un
juez desconocido falla ruidosamente — un skip silencioso es peor que un build
rojo, porque el agente cree que el árbol está verde.

No condiciones la verificación a los paths tocados. Un cambio en una RPC de
Supabase rompe una pantalla sin tocar `apps/frontend/`, y un refactor de tipos
toca cuarenta ficheros de frontend sin cambiar comportamiento. Los paths son una
optimización de coste; el spec es el criterio de corrección.

Una fase cuyo spec declara un juez que sólo corre en CI no pasa a `[done]` hasta
que `gh pr checks` esté verde.

**El sustantivo da igual.** Este repo ha usado Fase, Phase, Step, Story y «PR N»
para lo mismo. Lo que importa es que el heading termine en el token. Un spec cuyo
trabajo es un bloque indivisible no necesita tokens: entonces el `**Status:**` del
spec lo lleva todo.

## Required Skills — In Order

**IMPORTANT: Assess before invoking.** Read and evaluate what already exists before invoking any skill. If a spec is already written and approved, skip brainstorming and writing-plans. If a spec already contains detailed stories, data model, component architecture, and file paths, it IS the plan — don't invoke writing-plans to rewrite it. Only invoke a skill when it will produce something that doesn't already exist.

### Spec Creation
1. `superpowers:using-superpowers` — start of every conversation
2. `superpowers:brainstorming` — before writing any spec; explores intent and requirements. **Skip if spec already exists and is approved.**
3. `superpowers:writing-plans` — produces the spec file with TDD steps. **Skip if spec already contains sufficient implementation detail (data model, stories, component architecture, file paths).**

### Implementation
4. `superpowers:using-git-worktrees` — before starting implementation; isolates work from current workspace
5. `superpowers:subagent-driven-development` — when the plan has independent tasks that can run in parallel in the current session
6. `superpowers:executing-plans` — when executing a plan in a separate session with review checkpoints
7. `superpowers:test-driven-development` — when implementing any feature or bugfix; write tests first
8. `superpowers:dispatching-parallel-agents` — when 2+ independent tasks can be worked without shared state

### Debugging
9. `superpowers:systematic-debugging` — on any bug, test failure, or unexpected behavior; before proposing fixes

### Completion
10. `superpowers:verification-before-completion` — before claiming work is done, fixed, or passing; run verification commands and confirm output
11. `superpowers:requesting-code-review` — after implementation is complete and tests pass; before merging
12. `superpowers:receiving-code-review` — when code review feedback arrives; before implementing suggestions
13. `superpowers:finishing-a-development-branch` — when all tests pass and work is ready to integrate
