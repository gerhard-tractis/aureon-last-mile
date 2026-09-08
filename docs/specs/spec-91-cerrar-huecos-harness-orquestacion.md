# Spec-91: Cerrar dos huecos del harness de orquestación (y una regresión de #695)

**Status:** in progress
**Verify:** unit
**Downstream:** ninguno — este spec construye herramienta interna del harness (hooks + guards); ningún spec de producto depende de su implementación.

_Date: 2026-09-08_

> No es fase 2 de spec-89: ese spec declara explícitamente en su fase 1 "sin
> fase 2 prevista — es un guard nuevo, autocontenido; si aparece trabajo
> derivado ... se abre como spec nuevo, no como fase de éste." Éste es ese
> spec nuevo.

---

## El problema, con evidencia — no hipótesis

### Hueco 1 — nadie cierra los tokens de fase, y el guard que debería avisar es ciego

Hoy quedaron dos fases en `[in_progress]` con su PR ya mergeado: spec-80 fase 1b
(PR #669) y spec-89 fase 1 (implementación completa, 24/24 verde, pero el token
sigue `[in_progress]` porque nadie lo cerró). La causa, verificada en el código:

- `.claude/agents/implementer.md:98` prohíbe explícitamente al implementer
  cerrar la fase — con buena razón: cerrar exige tres líneas de evidencia
  (`> Implementado por:`, `> Review:`, `> QA:`) y dos no las puede escribir con
  honestidad (no se revisa a sí mismo, y el PR aún no existe cuando termina su
  commit). **Esa regla no cambia en este spec.**
- El reviewer es de solo lectura.
- Cerrar es trabajo del orquestador, «después del review y de QA» — pero
  `.claude/hooks/keep-going.sh:64` identifica el spec activo **por el nombre
  de la rama del worktree actual**:
  ```bash
  SPEC_ID="$(printf '%s' "$BRANCH" | grep -oE 'spec-[0-9]+[a-z]?' | head -1)"
  [ -n "$SPEC_ID" ] || exit 0
  ```
  El orquestador mergea desde `main` (o desde una rama sin `spec-NN` en el
  nombre), y `.claude/active-spec` casi nunca existe → el hook sale en
  silencio justo en el momento en que el cierre toca.

### Hueco 2 — el guard de paralelismo no ve las dependencias declaradas en prosa

`scripts/check-phase-overlap.mjs` (spec-89, en `main`) sólo lee
`**Archivos:**`, así que juzga **colisión de superficie** pero no **orden**.

**Caso real:** el guard dictaminó «superficies disjuntas, exit 0» para
spec-84 fase 3 junto a spec-80 fase 3. Estructuralmente acierta —tocan
ficheros distintos—, pero `docs/specs/spec-84-movil-conductor-home-y-prueba-de-entrega.md`
fase 3 dice literalmente (línea 128):

> queda es orden: depende de que aterrice spec-80 fase 3
> (`manifest_documents`, `[pending]`), no de una persona.

Esto se detectó leyendo, no con la herramienta. Otro despacho igual se cuela.

### Hueco 3 — el mensaje de `exit 3` miente cuando el campo existe pero no resuelve (PR #695)

Regresión real, no hipotética: `check-spec-fields.sh` (spec-89) hizo
`**Archivos:**` obligatorio en fases `[pending]`/`[in_progress]`. Dos fases del
corpus no pueden declararlo con honestidad hoy — spec-83 fase 3 es condicional
(su primer punto es *decidir si se implementa*), spec-82 fase 2 habla de un
almacén de lectura que hoy no existe en `apps/frontend/src/lib/db.ts` — y el
backfill de #693 se negó a inventarlas, con razón. Resultado: cualquier rama
larga que mergea `main` hereda esas ediciones y CI la rechaza por un spec que
no toca. Tumbó a #679 en plena ronda 7.

PR #695 lo desbloqueó declarando el campo con el motivo real:

```
**Archivos:** (indeterminado — el segundo punto habla de precargar «al
almacén de spec-81», pero apps/frontend/src/lib/db.ts hoy sólo tiene colas de
SALIDA ... No hay tabla, hook ni componente que nombrar sin inventarlo.)
```

`check-phase-overlap.mjs` sigue devolviendo `exit 3` para ambas — comportamiento
correcto, no se despachan en paralelo con nada. Pero el mensaje que imprime:

```
check-phase-overlap: no puedo juzgar — target(s) sin superficie alguna:
  spec-83...#Fase 3 — sin **Archivos:** en el spec y sin rama (o rama sin commits todavía).
```

**miente.** El campo sí está. Lo que pasa es que su contenido no resuelve a
ningún fichero — exactamente la misma clase de mensaje falso que el review de
spec-89 ya cazó y arregló para las declaraciones de directorio («te manda a
añadir un campo que ya está»). PR #695 lo dejó anotado como «conocido, no
arreglado ahí» porque este spec ya estaba tocando ese fichero.

**La lección, para que quede escrita:** hacer un campo obligatorio en CI
**antes** de que exista una forma honesta de decir «todavía no lo sé» convierte
una negativa correcta en un build rojo. Es la razón de fondo por la que
`**Depende de:**` (hueco 2) se construye en este spec con sus tres estados
—`ninguna`, una lista, `(indeterminado — razón)`— **desde el día uno**, y por
la que no se hace obligatorio en `check-spec-fields.sh` todavía.

---

## Qué se construye — decisiones argumentadas

### Hueco 1: hook `PostToolUse` sobre `gh pr merge`, avisa — no bloquea

**¿Bloquea o avisa? Avisa.** Un hook `PostToolUse` dispara **después** de que
el proceso ya corrió — el merge, si tuvo éxito, ya es un hecho consumado en
GitHub. Bloquear no puede deshacerlo; lo único que puede hacer es negarse a
dejar que el turno progrese con el efecto ya ocurrido, lo cual no protege nada
que no proteja ya avisar. El contrato de Claude Code para `PostToolUse` es
justamente ese: `exit 2` no impide que la herramienta ya ejecutada revierta —
inyecta el `stderr` como contexto que el agente ve y con el que tiene que
lidiar antes de continuar limpiamente. Uso `exit 2` en vez de `exit 0` con
mensaje en `stdout` por eso: `stdout` de un `PostToolUse` no se garantiza que
se lea con la misma prioridad que una razón de bloqueo — y este spec ya
aprendió con `keep-going.sh` que un mensaje que se puede ignorar, se ignora.

**¿Cómo resuelve el spec? El PR, no la rama del agente que corre el hook.**
El hook vive en un worktree que casi nunca es el que mergeó — el orquestador
corre `gh pr merge <N>` desde donde sea. Así que la fuente de verdad es
`gh pr view <N> --json headRefName,state,mergedAt`: una sola llamada de red
que da la rama real del PR mergeado, confirmando además que el merge fue real
(no un `gh pr merge --auto` que sólo lo dejó en cola). El spec-id sale de esa
rama con el mismo patrón que ya usa `keep-going.sh`
(`grep -oE 'spec-[0-9]+[a-z]?'`), no de la rama en la que el hook corre.

**¿Y la fase?** No se infiere con confianza y no hace falta. El patrón de
rama de este repo (`feat/spec-80-fase-2-bloqueo-faltantes`) casi siempre trae
el número de fase, así que el hook lo extrae **como pista** (mismo patrón
tolerante que `phase_taken()` en `keep-going.sh`: `fase` u opcional separador,
número, sufijo de letra opcional) y lo nombra en el mensaje — pero no decide
por sí solo qué fase cerrar. Inventar una heurística más fina (mapear PR →
fase exacta con certeza) exigiría parsear `**Archivos:**` y cruzarlo contra el
diff del PR, que es exactamente el trabajo que ya hace
`check-phase-overlap.mjs` para un propósito distinto (paralelismo, no cierre).
Reutilizar esa lógica aquí sería acoplar un hook de disparo frecuente-ish a un
módulo que hace `git ls-tree`/`git show` por archivo — más caro de lo que un
recordatorio necesita. El orquestador, que tiene el spec abierto, confirma la
fase en dos segundos; la máquina no necesita adivinarla con certeza.

**¿Por qué una llamada a `gh` es defendible aquí y no en `keep-going.sh`?**
`keep-going.sh` documenta como principio ser "barato... porque dispara en
CADA fin de turno" — docenas de veces por sesión. `PostToolUse` sobre un
matcher de `gh pr merge` dispara, en el caso normal, **una vez por PR
mergeado** — no por turno. El costo de una llamada de red bien vale la certeza
de que el merge fue real (`state == MERGED`, `mergedAt` no vacío) en vez de
adivinar desde texto de `stdout` cuyo formato exacto de `tool_response` no
está documentado de forma estable para este runtime. Si `gh` falla (sin red,
sin auth), el hook se degrada a silencio — nunca a bloquear un turno por un
problema de conectividad ajeno al trabajo.

**Fallback en `keep-going.sh` para ramas sin nombre de spec: no se construye.**
Evaluado y descartado. Escanear "toda fase `[in_progress]` cuya rama remota ya
no existe" exigiría un `git fetch` (red) o confiar en refs locales
potencialmente viejas, dentro de un hook que corre en cada fin de turno de
**cualquier** worktree — incluidos los que no tienen nada que ver con el spec
cuya rama desapareció. Cada worktree activo emitiría el mismo aviso sobre la
misma fase huérfana, con la única señal real (`git branch -a` desactualizado
por falta de red) mintiendo sobre cuán fresca es la comprobación. Es ruido
correlacionado sin beneficio proporcional: el hook de `PostToolUse` ya cubre
el momento correcto (justo tras el merge, en el worktree que lo hizo). No se
construye.

### Hueco 2: `**Depende de:**` con tres estados, más red heurística que avisa

**Tres estados desde el día uno — es la lección del Hueco 3.** El mismo error
que rompió `**Archivos:**` (obligar antes de tener una forma honesta de decir
"no lo sé") no se repite aquí:

| Valor del campo | Significa | Cómo lo lee el guard |
|---|---|---|
| Campo ausente | Nadie lo rellenó todavía (backfill pendiente) | No bloquea nada — el campo no es obligatorio en este spec (ver más abajo) |
| `ninguna` | Declarado explícito: esta fase no depende de otra fase | No bloquea nada |
| `spec-N fase M[, spec-N2 fase M2...]` | Depende de que esa(s) fase(s) aterricen | Chequeo duro — ver tabla de exit codes |
| `(indeterminado — <razón>)` | Se evaluó y no se pudo determinar la dependencia todavía (razón real, no inventada) | No bloquea nada — se reporta, no se falla |

No se hace obligatorio en `check-spec-fields.sh` en este PR. Backfill del
corpus existente va aparte (como fue `**Archivos:**` en #693); obligatoriedad
en CI, después de eso. El orden explícito: **guard primero, backfill después,
obligatoriedad al final.**

**(a) Chequeo duro de dependencia — nuevo exit code, separado del conflicto
de superficie.** Cuando un target declara `spec-N fase M` y esa fase no está
`[done]`, es un motivo de "no despachable" distinto de "se pisan los
ficheros" — dos preguntas distintas que merecen dos respuestas distintas.
Nueva tabla de exit codes de `check-phase-overlap.mjs`:

| Exit | Significa |
|---|---|
| `0` | Despachable — sin conflicto duro de superficie (puede haber acoplamiento blando, se imprime) |
| `1` | Conflicto duro — dos targets escriben el mismo fichero |
| `2` | Error de uso |
| `3` | No se puede juzgar la superficie — ver el mensaje: dos causas posibles ahora (campo ausente, o campo presente que no resuelve a ningún fichero — Hueco 3) |
| `4` | **Nuevo.** Dependencia declarada en `**Depende de:**` no satisfecha: la fase de la que depende no está `[done]` |

El chequeo de dependencia corre **antes** que el cómputo de solapamiento de
superficie: si una fase no es despachable por orden, discutir si sus ficheros
chocan con otra es una pregunta que todavía no toca. `exit 4` gana sobre
`exit 1`/`exit 3` si ambos aplicarían.

**(b) Red heurística: avisa, no bloquea.** El campo tarda en backfillearse
—ver la tabla de arriba, es opcional hoy—, así que mientras tanto el guard
escanea el cuerpo de cada fase buscando referencias en prosa a `spec-N fase M`
(y las variantes reales del corpus: separador tolerante entre el número de
spec y la palabra "fase"/"Fase"/"phase"/"paso"/"step", backticks intermedios,
sufijo de letra en el número de fase — verificado contra los 89 specs
existentes, no asumido). Si aparece una referencia y no está en
`**Depende de:**` de esa fase, ni es una autorreferencia (la fase citándose a
sí misma, común en líneas de evidencia `> Implementado por: ... rama
feat/spec-80-fase-1-...`), se **avisa nombrándola** — sin bloquear, sin exit
code distinto. Bloquear aquí generaría falsos positivos: los specs de este
repo se citan constantemente entre sí sin que eso implique una dependencia de
orden (ver "depende de" en spec-88, spec-86 — la mayoría de esas menciones
describen relaciones que ya se resolvieron, no bloqueos activos).

### Hueco 3: mensaje honesto en el `exit 3`

`check-phase-overlap-parse.mjs` (`extractArchivosFiles`) empieza a distinguir
"la línea `**Archivos:**` no existe en el cuerpo de la fase" de "la línea
existe, pero su contenido no resolvió a ningún fichero ni directorio" —
exponiendo un flag nuevo (`fieldPresent`) y el texto crudo declarado. El
mensaje de `exit 3` en `check-phase-overlap.mjs` cambia según cuál de los dos
casos aplica, citando el texto declarado en el segundo caso para que quien lo
lea vea por qué no resolvió, en vez de recibir una instrucción que ya se
cumplió ("declara `**Archivos:**`" cuando ya está declarado).

---

## Fases

### Fase 1 — Hook `post-merge-remind.sh`: recordatorio tras `gh pr merge` `[in_progress]`

**Archivos:** `.claude/hooks/post-merge-remind.sh`, `.claude/hooks/post-merge-remind.test.sh`,
`.claude/settings.json` (registro del hook `PostToolUse`), `scripts/check-harness-present.sh`
(añadir a `REQUIRED_HOOKS`), `scripts/check-harness-present.test.sh`, `.github/workflows/ci.yml`
(wiring del nuevo `.test.sh`)

- [ ] `PostToolUse` matcher `Bash`, filtra por comando que casa `gh pr merge` (con o sin
      número/flags).
- [ ] Extrae el número de PR del comando si es un argumento numérico o URL; si no,
      resuelve vía `gh pr view --json number,headRefName,state,mergedAt` (PR de la rama
      actual) — una sola llamada.
- [ ] Confirma `state == MERGED` y `mergedAt` no vacío antes de avisar — un
      `gh pr merge --auto` que sólo encoló, o un merge fallido, no dispara nada.
- [ ] Extrae `spec-[0-9]+[a-z]?` de `headRefName` (mismo patrón que
      `keep-going.sh`); si no hay match, sale en silencio (`exit 0`) — no todo
      merge cierra una fase de spec.
- [ ] Extrae, como pista opcional, un número de fase de `headRefName`
      (`fase`/`phase`, separador tolerante, sufijo de letra) y lo incluye en el
      mensaje sin afirmarlo como certeza.
- [ ] Mensaje vía `stderr` + `exit 2`: nombra el spec (y la fase, si se infirió),
      recuerda las tres líneas de evidencia y el token `[done]`, y remite a
      `docs/specs/CLAUDE.md`.
- [ ] Degradación: sin `gh` en PATH, sin red, o JSON inesperado → `exit 0`
      silencioso. Nunca bloquea un turno por un problema de infraestructura
      ajeno al trabajo.
- [ ] `check-harness-present.sh`: `post-merge-remind.sh` entra en
      `REQUIRED_HOOKS` — es harness, no accesorio.
- [ ] Tests contra un `gh` falso en `PATH` (mismo patrón de mocking de binario
      externo que ya usan `check-phase-overlap.test.sh` para `git`, aplicado
      aquí a `gh`): merge real con spec en la rama → avisa; merge real sin
      spec en la rama → silencio; comando que no es `gh pr merge` → silencio;
      `gh pr merge` que falla/queda en cola (`state != MERGED`) → silencio;
      `gh` ausente → silencio, no crashea.

### Fase 2 — El `exit 3` deja de mentir cuando `**Archivos:**` existe pero no resuelve `[in_progress]`

**Archivos:** `scripts/check-phase-overlap-parse.mjs` (`extractArchivosFiles`
expone `fieldPresent` y el texto crudo), `scripts/check-phase-overlap-parse.test.mjs`,
`scripts/check-phase-overlap.mjs` (mensaje del `exit 3` bifurcado), `scripts/check-phase-overlap.test.sh`

- [ ] `extractArchivosFiles` devuelve `fieldPresent: boolean` (la línea
      `**Archivos:**` existe en el cuerpo de la fase, exista o no contenido
      resoluble) y `raw` (el bloque de texto declarado, para citarlo).
- [ ] `check-phase-overlap.mjs`: el filtro de "unjudgeable" ya no asume que
      superficie vacía == campo ausente. Dos mensajes distintos:
      - campo ausente: mensaje actual, sin cambios.
      - campo presente sin resolver: nuevo mensaje que cita el texto
        declarado y dice explícitamente que el campo existe pero no resolvió
        a ningún fichero — no le pide a quien lo lea que añada algo que ya
        escribió.
- [ ] Caso de aceptación (reproduce la regresión real de #695, con fixture
      propia — no depende de que #695 esté mergeado): una fase con
      `**Archivos:** (indeterminado — <razón real>)` sigue devolviendo `exit 3`,
      pero el mensaje ya no dice "sin **Archivos:** en el spec".

### Fase 3 — Campo `**Depende de:**`: tres estados y chequeo duro (`exit 4`) `[in_progress]`

**Archivos:** `scripts/check-phase-overlap-depends.mjs`, `scripts/check-phase-overlap-depends.test.mjs`,
`scripts/check-phase-overlap.mjs` (wiring del chequeo y `exit 4`), `scripts/check-phase-overlap.test.sh`,
`docs/specs/CLAUDE.md` (documenta el campo, sus tres estados y la tabla de exit codes),
`docs/specs/spec-84-movil-conductor-home-y-prueba-de-entrega.md` (declara
`**Depende de:** spec-80 fase 3` en su fase 3 — un único caso real, no
backfill del corpus, necesario para que el caso de aceptación de abajo corra
contra datos reales)

- [ ] `extractDependsField(mdContent, faseMatch)`: localiza la fase, lee
      `**Depende de:**` (misma convención de continuación de línea que
      `**Archivos:**`). Devuelve `{ headingFound, fieldPresent, explicitNone,
      indeterminate, entries: [{specId, faseNum}], raw }`.
      - `ninguna` (case-insensitive) → `explicitNone: true`, `entries: []`.
      - `(indeterminado — ...)` → `indeterminate: true`, `entries: []`.
      - si no, se extrae cada `spec-N fase M` del bloque (backticks tolerados).
- [ ] `findPhaseTokenByNumber(mdContent, faseNum)`: dado el contenido de OTRO
      spec y un número de fase, devuelve su token de heading
      (`pending|in_progress|blocked|awaiting_user_test|done|parked`) o `null`
      si no hay heading que case.
- [ ] `check-phase-overlap.mjs`: por cada target, lee sus dependencias
      declaradas. Ausente o `explicitNone` o `indeterminate` → no bloquea.
      Por cada entrada declarada, resuelve `docs/specs/spec-<N>-*.md` en el
      repo, lee su fase `M`; si no existe el spec, o el token no es `done`,
      se acumula como dependencia no satisfecha.
- [ ] Si hay una o más dependencias no satisfechas: mensaje propio («no
      despachable todavía: spec-X fase Y depende de spec-N fase M, que está
      `[token]`»), `exit 4`, **antes** de calcular solapamiento de superficie
      (no se llega a imprimir el reporte de conflicto duro/blando).
- [ ] Caso de aceptación real, sin fixture: `spec-84 fase 3` declarando
      `**Depende de:** spec-80 fase 3` — dado que `spec-80 fase 3` sigue
      `[pending]` hoy en el repo real, el CLI corrido contra los specs reales
      (no una copia) devuelve `exit 4` nombrando ambos.
- [ ] `docs/specs/CLAUDE.md`: nueva sección junto a `**Archivos:**`
      documentando `**Depende de:**`, sus tres estados y por qué no es
      obligatorio todavía (la lección del Hueco 3, citada).

### Fase 4 — Red heurística: referencias no declaradas, avisa sin bloquear `[in_progress]`

**Archivos:** `scripts/check-phase-overlap-depends.mjs` (`scanUndeclaredReferences`),
`scripts/check-phase-overlap-depends.test.mjs`, `scripts/check-phase-overlap.mjs`
(wiring del aviso), `scripts/check-phase-overlap.test.sh`

- [ ] `scanUndeclaredReferences(mdContent, faseMatch, ownSpecId)`: sobre el
      cuerpo de la fase (mismo rango que `extractArchivosFiles`), busca
      referencias con el regex tolerante validado contra el corpus real:
      `spec-(\d+[a-z]?)` seguido, a hasta ~15 caracteres de distancia y
      cualquier puntuación intermedia, de `fase|phase|paso|step` y un
      número (con sufijo de letra opcional). Excluye la autorreferencia
      (mismo spec + misma fase que la que se está escaneando).
- [ ] Cada referencia encontrada que no esté en `**Depende de:**` de esa fase
      se imprime como `::warning::` nombrándola — nunca cambia el exit code.
- [ ] Caso de aceptación real: `spec-84 fase 3` con su `**Depende de:**` ya
      declarado (fase 3) NO genera warning para `spec-80 fase 3` (está
      declarada); una fase de control con una mención de `spec-N fase M` sin
      declarar SÍ genera warning nombrándola.
- [ ] Mutation-test: invertir la condición de exclusión de autorreferencia y
      confirmar que el test de aceptación (arriba) empieza a fallar (ruido
      sobre sí misma) — prueba que el guard realmente distingue las dos
      cosas y no que casualmente no encontró nada.

---

## Deliberadamente NO en este spec

- Backfill de `**Depende de:**` en el corpus existente — va aparte, spec
  nombrado, como fue `**Archivos:**` (#693).
- Hacer `**Depende de:**` obligatorio en `check-spec-fields.sh` — rompería CI
  en toda fase activa hoy sin ese campo. Orden: guard (este spec) → backfill →
  obligatoriedad.
- Fallback en `keep-going.sh` para ramas sin nombre de spec (fases
  `[in_progress]` con rama remota desaparecida) — evaluado y descartado, ver
  razón arriba.
- Inferencia certera de "qué fase exacta cierra este PR" — el hook nombra el
  spec y, como pista, la fase que el nombre de rama sugiere; el orquestador
  confirma.
