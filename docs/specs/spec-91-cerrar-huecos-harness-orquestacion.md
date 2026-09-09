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

> **Nota de reconciliación (ronda 3 de review, mientras este spec seguía
> abierto):** una decisión de producto real —«la prueba de entrega la genera
> DispatchTrack y la envía vía webhook», no este repo— aparcó spec-84 fase 3 y
> le quitó la dependencia: «ya no depende de spec-80 fase 3 — no depende de
> nada, está aparcada». El caso de arriba sigue siendo el motivador real y
> verificado (así estaba el 2026-09-08, cuando se detectó), pero **ya no es el
> caso de aceptación vivo** — la fase 3 y 4 del plan de implementación usan un
> spec de scratch en su lugar, precisamente para no depender del contenido
> mutable de un spec de producto ajeno a éste.

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

### Hueco 1, corregido en ronda 2 de review: **ningún hook local cierra este hueco**

La primera versión de este spec razonaba sobre un hook `PostToolUse` con
matcher `gh pr merge` como si fuera el mecanismo que garantiza el cierre. El
review adversarial (ronda 2) lo tumbó con un hecho, no una opinión: **el
flujo obligatorio de este repo** (`CLAUDE.md`) corre

```
gh pr create
gh pr merge --auto --squash   # MANDATORY
```

**inmediatamente**, antes de que CI arranque. En ese instante el PR sigue
`OPEN` — `--auto` sólo lo encola. Cuando GitHub lo mergea de verdad, minutos
después, **no corre ningún comando Bash**: nada que un `PostToolUse` pueda
interceptar, porque no hay evento local que observar. **Los seis tokens
rancios que motivaron este spec vinieron exactamente de ese camino
`--auto`** — verificado, no supuesto.

**La conclusión no es "arreglar el hook": es que la garantía no puede vivir
en un hook.** Es la misma lección que ya está escrita en este repo:
`check-spec-fields.sh` funciona porque vive en **CI**, no en un hook local —
un guard que depende de que alguien lo dispare desde su propia sesión no es
un guardarraíl, es una esperanza. La garantía real es la **Fase 5**
(reconciliación en servidor), más abajo.

**El hook no se descarta — cambia de papel.** Se queda como **atajo de
latencia cero para el camino manual**: alguien corre `gh pr merge <N>
--squash` (sin `--auto`) y el merge es inmediato: confirmar y recordar en
ese momento es más rápido que esperar a la próxima corrida de la fase 5. Con
ese papel nuevo — accesorio, no garantía — sus bugs de la ronda 1 seguían
siendo baratos de arreglar y valía la pena hacerlo:

- **B2** (el número de PR puede ir DESPUÉS de las flags —
  `gh pr merge --auto --squash 693` — y el extractor original sólo miraba el
  primer token): se escanea cada token del segmento de comando, no sólo el
  primero.
- **B3** (dispara con cualquier comando que *mencione* el texto — un
  `grep -rn "gh pr merge" .claude/`, un mensaje de commit — le pasó
  literalmente al reviewer mientras revisaba esto): el comando se parte por
  los separadores de shell (`&&`, `||`, `;`, `|`) y se exige que un
  **segmento completo** empiece con `gh pr merge`, no que el texto lo
  contenga en cualquier posición.
- **M1** (~950ms en **cada** llamada Bash, no en cada merge — medido: un
  `.sh` que sólo hace `exit 0` tarda ~220ms): un `case` en bash antes del
  `exec node` evita pagar el arranque de node salvo que el comando contenga
  siquiera la palabra "gh". `keep-going.sh` es bash puro documentadamente
  por este motivo; éste paga el costo por comando, no por turno, así que el
  filtro barato es obligatorio, no opcional.
- **M2** (sin `node` en el PATH, `exit 127` ruidoso en cada llamada): un
  `command -v node` antes de invocar node degrada a silencio.

El diseño se mantiene simple a propósito: sigue siendo **una** llamada a
`gh pr view` (nunca cero, pero tampoco más de una), porque ya no es la
garantía — es un adelanto opcional de lo que la fase 5 encuentra de todas
formas.

### La garantía real: reconciliación en servidor (detalle de la fase 5)

**Por qué en CI y no en un hook.** Ningún evento local ocurre cuando
`--auto` mergea — así que la única forma de detectarlo es **mirar
periódicamente el estado real**, no esperar a que algo lo empuje. Un
workflow de GitHub Actions, disparado por `push: main` **y** por `schedule`
diario (para cubrir el caso en que nadie más pushea a `main` ese día):

1. Recorre `docs/specs/spec-*.md`, extrae toda fase con token `[in_progress]`.
2. Para cada una, `gh pr list --state open` y el mismo patrón que ya usa
   `keep-going.sh` (`grep -oE 'spec-[0-9]+[a-z]?'`) sobre el nombre de cada
   rama abierta: si **ningún** PR abierto nombra ese spec, el token es
   rancio — el trabajo se mergeó (o se abandonó) y nadie cerró la fase.
3. Mantiene **un único issue** con la lista viva de fases rancias — lo
   actualiza en cada corrida, y lo **cierra solo** cuando la lista queda
   vacía. No abre un issue nuevo por hallazgo: eso generaría ruido
   proporcional al número de fases rancias en vez de una sola señal que se
   lee de un vistazo.

**No bloquea, y es deliberado.** El merge ya ocurrió — fallar el CI de
`main` por un token de documentación castigaría los despliegues por un
problema que no es del código que se está desplegando, y eso ya costó días
de trabajo esta semana (ver `docs/architecture/...` u otras notas del
historial de incidentes de este repo). El issue es la señal; nadie pierde un
deploy por ella.

**Ventana legítima, no un bug.** El token de una fase se cierra en un PR de
**documentación posterior** al merge del código — hay minutos, a veces horas,
en los que la fase está genuinamente `[in_progress]` con el PR de código ya
mergeado y el de cierre todavía sin abrir. El workflow no intenta adivinar
ese margen con un umbral de tiempo: eso exigiría timestamps que hoy no se
registran en ningún lado fiable (el `git log` del propio spec podría
usarse, pero acopla el guard a la historia de commits de un archivo que
cualquier `docs:` trivial puede tocar). En su lugar, **el issue mismo dice
"detectado por primera vez el <fecha>"**, actualizado en cada corrida — quien
lo lee ve de inmediato si es de hace cinco minutos (probablemente la ventana
legítima) o de hace tres días (probablemente rancio de verdad).

**Falso positivo conocido y aceptado, dos variantes de la misma clase
(la segunda añadida en la ronda 3 de review, señalada por el reviewer sin que
el cuerpo del issue la nombrara):**

1. **Trabajo en una rama LOCAL sin pushear.** Si alguien tiene una fase
   `[in_progress]` en su spec local, con commits sin pushear, el workflow no
   ve ninguna rama remota que la nombre y la reporta como rancia.
2. **Rama YA pusheada, pero sin PR abierto todavía** — la ventana entre
   `git push` y `gh pr create` (o entre el push y que alguien se acuerde de
   abrir el PR). `gh pr list --state open` tampoco ve nada que nombre esa
   rama en ese momento, exactamente igual que en el caso 1.

Las dos son transitorias (desaparecen en cuanto se pushea, o en cuanto se
abre el PR) e inofensivas (un issue no bloqueante, no un build rojo) — **se
dejan así a propósito**. Cualquier heurística para distinguir "de verdad
abandonada" de "en tránsito todavía" (por ejemplo, exigir que la fase lleve
`[in_progress]` más de N días) sería peor que el falso positivo: escondería
fases genuinamente rancias detrás de una ventana de gracia que alguien
tendría que calibrar sin datos, y el costo de un falso positivo aquí es leer
una línea de un issue, no un despliegue roto. El cuerpo del propio issue
(`renderIssueBody`) nombra ambas variantes, no sólo la primera.

**Propiedades que lo hacen distinto de todo lo que hay hoy en el harness:**
no depende de `cwd`, no depende de que una sesión concreta corra un comando,
no depende de qué agente mergeó. Es idempotente (correrlo dos veces con el
mismo estado no cambia nada) y auto-curativo (en cuanto alguien cierra el
token, la siguiente corrida lo saca de la lista y, si era la última, cierra
el issue solo).

**Dato a anotar (ronda 3 de review), para que la primera corrida no parezca
un bug — y ejemplo vivo de por qué no vale la pena perseguir el número
exacto:** una versión anterior de este párrafo decía "la lista da 5 filas",
corrido contra el estado de ese momento. **Ese número quedó atrás del propio
merge de este PR** — el mismo `git merge origin/main` que resolvió el
conflicto con spec-84 (ver más abajo) trajo `docs: cerrar seis tokens de
fase rancios` (#697), que cerró de un tirón las cinco fases que ese párrafo
nombraba. Corrido de nuevo, hoy: **6 fases `[in_progress]`** —
`spec-83 fase 4` (rancia, real, sin PR abierto) más las **5 fases de este
mismo spec-91** (con PR abierto — no rancias todavía). Ese número también
quedará atrás antes de que el workflow corra por primera vez de verdad.

**Lo que sí es estable, y es lo único que vale la pena afirmar:** en cuanto
este PR mergee, las 5 fases de spec-91 (ninguna cerrada por el orquestador
todavía) pierden su único PR abierto y se suman a lo que sea que la lista
diga en ese momento. Es el comportamiento correcto — nadie cerró esos
tokens todavía —, pero es lo primero que va a aparecer, y no debería leerse
como que el workflow está mal calibrado. Quien quiera el número exacto del
día que lo lea: `node scripts/reconcile-stale-phases-lib.mjs` no tiene CLI
de sólo-lectura hoy, pero la lógica es la misma que corre en CI — el propio
issue de seguimiento es la fuente de verdad, no este párrafo.

**Fallback en `keep-going.sh` para ramas sin nombre de spec: sigue sin
construirse.** Ver el razonamiento original más abajo — la fase 5 lo
reemplaza con una versión que sí funciona (corre en servidor, no en cada
fin de turno de cada worktree).

**Limitación conocida y documentada, no arreglada aquí:**
`.claude/hooks/keep-going.sh` puede pedirle al orquestador que cierre la
fase de OTRO worktree si la sesión se queda posicionada dentro de un
worktree ajeno (identifica el spec activo por la rama del `cwd`). La
solución es salir del worktree, no apagar el guard — apagarlo silenciaría la
señal precisamente para los `implementer` a los que existe para empujar, a
cambio de evitarle al orquestador una comprobación de dos segundos.

**Evaluado y descartado (razón original, sigue aplicando):** un fallback
directamente en `keep-going.sh` que escaneara "toda fase `[in_progress]` cuya
rama remota ya no existe" exigiría red (`git fetch`) o refs locales
potencialmente viejas, dentro de un hook que corre en cada fin de turno de
**cualquier** worktree — ruido correlacionado sin beneficio proporcional. La
fase 5 lo reemplaza con una versión que sí corre donde debe: en servidor, una
vez por push/día, no una vez por turno.

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

**Dato para quien retome esto (R3-4, review ronda 3):** al mergear este PR,
**ningún spec vivo declara `**Depende de:**`**. El único caso real que existió
—`spec-84` fase 3, motivador de este guard— dejó de aplicar cuando una
decisión de producto la aparcó y le quitó la dependencia mientras este spec
seguía en review (ver la nota de reconciliación más abajo). El campo entra en
`main` con **cero usuarios reales**: es consecuencia correcta de no
backfillear —la instrucción explícita era no hacerlo en este PR—, pero
significa que el guard nunca habrá corrido contra una declaración escrita de
verdad por una persona, sólo contra los scratch specs de sus propios tests.
Quien escriba la primera declaración real de `**Depende de:**` estrena el
camino — vale la pena que lo sepa antes de asumir que "ya está probado en
producción" porque los tests pasan.

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

### Fase 1 — Hook `post-merge-remind.sh`: atajo de latencia cero, no la garantía `[in_progress]`

**Reescrita en ronda 2 de review.** La versión original de esta fase matcheaba
`gh pr merge` y asumía que eso bastaba. El review adversarial lo tumbó con
un hecho verificado: el flujo obligatorio de este repo corre
`gh pr merge --auto --squash` **antes** de que CI arranque, dejando el PR
`OPEN` — GitHub lo mergea de verdad minutos después, sin ningún comando Bash
que un hook pueda interceptar. Las seis fases rancias que motivaron este
spec vinieron exactamente de ese camino. **La garantía real es la fase 5**
(reconciliación en servidor, más abajo). Este hook se queda como atajo
opcional para el camino manual (`gh pr merge <N> --squash`, sin `--auto`,
que sí mergea al instante) — ver "Hueco 1, corregido en ronda 2" arriba para
el razonamiento completo.

**Archivos:** `.claude/hooks/post-merge-remind.sh`, `.claude/hooks/post-merge-remind.mjs`,
`.claude/hooks/post-merge-remind.test.sh`, `.claude/settings.json` (registro del hook
`PostToolUse`), `scripts/check-harness-present.sh` (añadir a `REQUIRED_HOOKS`),
`scripts/check-harness-present.test.sh`, `.github/workflows/ci.yml` (wiring del nuevo `.test.sh`)

- [ ] `PostToolUse` matcher `Bash`. El comando se parte por los separadores
      de shell (`&&`, `||`, `;`, `|`) y se exige que un **segmento completo**
      empiece con `gh pr merge` — no que el texto lo mencione en cualquier
      posición (bloqueante 3 de la ronda 1: un `grep -rn "gh pr merge"
      .claude/` o un `git commit -m "gh pr merge era el problema"` no deben
      disparar nada; le pasó literalmente al reviewer).
- [ ] Extrae el número de PR escaneando **todos** los tokens del segmento,
      no sólo el primero (bloqueante 2 de la ronda 1: `gh pr merge --auto
      --squash 693` pone el número al final, no justo después de `merge`).
      Si no hay ninguno, se resuelve contra la rama actual.
- [ ] Confirma `state == MERGED` y `mergedAt` no vacío antes de avisar — un
      `gh pr merge --auto` que sólo encoló, o un merge fallido, no dispara nada.
- [ ] Extrae `spec-[0-9]+[a-z]?` de `headRefName` (mismo patrón que
      `keep-going.sh`); si no hay match, sale en silencio (`exit 0`) — no todo
      merge cierra una fase de spec.
- [ ] Extrae, como pista opcional, un número de fase de `headRefName`
      (`fase`/`phase`, separador tolerante, sufijo de letra) y lo incluye en el
      mensaje sin afirmarlo como certeza.
- [ ] Mensaje vía `stderr` + `exit 2`: nombra el spec (y la fase, si se infirió),
      recuerda las tres líneas de evidencia y el token `[done]`, remite a
      `docs/specs/CLAUDE.md`, y menciona que la fase 5 lo detecta igual si nadie
      actúa sobre el recordatorio.
- [ ] `.sh`: filtro barato en bash antes de invocar node. **Estrechado en la
      ronda 3 (H-3)** de `case "$INPUT" in *gh*)` a `*'gh pr merge'*)` — la
      versión con `*gh*` pagaba el arranque de node por cualquier payload que
      contuviera el bigrama "gh" en cualquier parte (incluido el
      `tool_response`, que este hook también recibe por stdin: "through",
      "right", un hash de git). Estrechar es gratis y correcto porque el
      `.mjs` ya exige que un SEGMENTO empiece literalmente así
      (`extractMergeSegment`) — el filtro de bash nunca puede rechazar algo
      que el `.mjs` habría aceptado. Medido tres veces en la misma ventana
      (medio de la ronda 1, recalibrado en la ronda 3 porque comparar tiempos
      entre rondas en una máquina bajo carga variable no es válido): con un
      payload sin "gh pr merge", este hook cuesta **lo mismo** que un `exit 0`
      — el prefiltro corta antes de que node arranque. `command -v node`
      antes de invocar node — sin él, `node` ausente da un `exit 127` ruidoso
      en cada llamada que mencione "gh pr merge" (M2 de la ronda 1).
- [ ] **H-1 (ronda 3):** `extractMergeSegment` partía el comando por
      `&&`/`||`/`;`/`|` pero no por salto de línea — la forma HABITUAL de
      escribir la secuencia que `CLAUDE.md` manda (`git push` / `gh pr
      create` / `gh pr merge --auto --squash`, una línea por comando, sin
      operadores de shell entre ellas) caía en "no matchea nada". Un
      carácter (`\n`) en el regex de partición lo cierra.
- [ ] Degradación: sin `gh` en PATH, sin red, o JSON inesperado → `exit 0`
      silencioso. Nunca bloquea un turno por un problema de infraestructura
      ajeno al trabajo.
- [ ] `check-harness-present.sh`: `post-merge-remind.sh` entra en
      `REQUIRED_HOOKS` — es harness, no accesorio.
- [ ] Tests contra un `gh` falso en `PATH` (mismo patrón de mocking de binario
      externo que ya usan `check-phase-overlap.test.sh` para `git`, aplicado
      aquí a `gh` — incluyendo un fake **sensible a argumentos**, necesario
      para que el test de "número tras las flags" detecte de verdad una
      consulta al PR equivocado, no sólo "algo respondió"): merge real con
      spec en la rama → avisa; merge real sin spec en la rama → silencio;
      número tras las flags → consulta el PR correcto; `grep`/mensaje de
      commit que menciona el patrón → nunca llama a `gh`; comando encadenado
      (`echo x && gh pr merge ...`) → sí dispara; `gh pr merge` que
      falla/queda en cola (`state != MERGED`) → silencio; `gh` ausente →
      silencio, no crashea; `node` ausente → silencio, no `exit 127`; el
      filtro de bash mide más rápido que el camino real (smoke test de
      tiempo, no un presupuesto estricto).

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
`docs/specs/CLAUDE.md` (documenta el campo, sus tres estados y la tabla de exit codes)

> **Nota de reconciliación (ronda 3):** el plan original tocaba
> `docs/specs/spec-84-...md` para declarar `**Depende de:** spec-80 fase 3` en
> su fase 3, como caso real de aceptación. Mientras este spec seguía abierto,
> una decisión de producto real aparcó esa fase y le quitó la dependencia
> (ver la nota junto al "Caso real" del Hueco 2, arriba) — el spec de
> producto ya no es el ejemplo correcto. El caso de aceptación de abajo usa
> un spec de scratch dentro del repo real en su lugar (creado y borrado por
> el propio test), targeteando `spec-80 fase 3` (que sigue `[pending]`) sin
> depender del contenido mutable de un spec ajeno a éste.

- [ ] `extractDependsField(mdContent, faseMatch)`: localiza la fase, lee
      `**Depende de:**` (misma convención de continuación de línea que
      `**Archivos:**`). Devuelve `{ headingFound, fieldPresent, explicitNone,
      indeterminate, entries: [{specId, faseNum}], raw }`.
      - `ninguna` (case-insensitive) → `explicitNone: true`, `entries: []`.
      - `(indeterminado — ...)` → `indeterminate: true`, `entries: []`.
      - si no, se extrae cada `spec-N fase M` del bloque (backticks tolerados).
- [ ] `findPhaseTokenByNumber(mdContent, faseNum)`: dado el contenido de OTRO
      spec y un número de fase, devuelve su token de heading
      (`pending|in_progress|blocked|awaiting_user_test|done|parked`) o
      `found: false` si ningún heading con token reconocido calza ese
      número. **Bloqueante 1 de la ronda 2, cerrado aquí:** un heading en
      prosa que MENCIONA "fase N" sin ser un heading de fase real (sin
      token) ya no gana sobre el heading real que aparece después — sigue
      buscando hasta encontrar uno con un token del vocabulario válido.
      Reproducido literalmente contra `spec-85-discrepancias.md`: el heading
      de la línea 222 ("### La costura entre esta fase y spec-80 fase 2",
      sin token) casaba antes que el heading real de la línea 338
      ("### Fase 2 — RPCs `[done]`") — spec-85 fase 2 es la dependencia más
      citada del corpus (spec-86 fases 1/2a/2b/3, spec-80 fases 1/1b, spec-88
      fase 1); el bug bloqueaba el primer backfill de lleno.
- [ ] `check-phase-overlap.mjs`: por cada target, lee sus dependencias
      declaradas. Ausente o `explicitNone` o `indeterminate` → no bloquea.
      Por cada entrada declarada, resuelve `docs/specs/spec-<N>-*.md` en el
      repo, lee su fase `M`. Tres desenlaces distintos, no dos: spec
      referenciado inexistente → dependencia no satisfecha (bloquea); token
      encontrado y no es `done` → dependencia no satisfecha (bloquea); NINGÚN
      heading con token reconocido calza ese número → **ambiguo, se avisa
      (`::warning::`) y no bloquea** (no se puede distinguir de un typo real
      en el número de fase, y adivinar sería peor que reportarlo).
- [ ] Si hay una o más dependencias no satisfechas (los dos primeros casos,
      nunca el ambiguo): mensaje propio («no despachable todavía: spec-X fase
      Y depende de spec-N fase M, que está `[token]`»), `exit 4`, **antes**
      de calcular solapamiento de superficie (no se llega a imprimir el
      reporte de conflicto duro/blando).
- [ ] Caso de aceptación real, sin fixture: un spec de scratch dentro del
      repo real (`spec-998-scratch-dep-repro.md`, creado y borrado por el
      propio test) declarando `**Depende de:** spec-80 fase 3` — dado que
      `spec-80 fase 3` sigue `[pending]` hoy en el repo real, el CLI corrido
      contra los specs reales (no una copia) devuelve `exit 4` nombrando
      ambos. **Reemplaza al plan original** (que usaba `spec-84 fase 3` de
      verdad): una decisión de producto real le quitó esa dependencia
      mientras este spec seguía abierto — ver la nota de reconciliación
      junto al "Caso real" del Hueco 2, arriba.
- [ ] Caso de aceptación real del bloqueante 1: un spec temporal dentro del
      repo real declarando `**Depende de:** spec-85 fase 2` — el CLI corrido
      contra el repo real devuelve `exit 0` (spec-85 fase 2 SÍ está `[done]`),
      no `exit 4` con `[null]`.
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
- [ ] Caso de aceptación real (unitario, texto inline — no lee el fichero
      real, así que no depende de su contenido mutable): reproduce el texto
      literal que `spec-84 fase 3` tenía cuando declaraba `**Depende de:**
      spec-80 fase 3` — con esa declaración, NO genera warning para
      `spec-80 fase 3`; una fase de control con una mención de `spec-N fase
      M` sin declarar SÍ genera warning nombrándola.
- [ ] Mutation-test: invertir la condición de exclusión de autorreferencia y
      confirmar que el test de aceptación (arriba) empieza a fallar (ruido
      sobre sí misma) — prueba que el guard realmente distingue las dos
      cosas y no que casualmente no encontró nada.

**Validado contra el corpus real (review ronda 2), no supuesto — corrido, no
estimado:** contra las 104 fases con token de `docs/specs/`, produce 49
avisos repartidos en 30 fases — 0 a 4 líneas por invocación, un volumen que
se lee de un vistazo, no ruido.

**Caveat conocido, aceptado, no arreglado — verificado con la corrida real,
no asumido de oído:** tres fases se avisan sobre **otra fase de sí mismas**
—`spec-79` fase 4h (menciona su propia fase 4), `spec-85` fase 1 (menciona
su propia fase 2), `spec-87` fase 1 (menciona su propia fase 2)—.
`scanUndeclaredReferences` excluye la autorreferencia exacta (mismo spec,
misma fase que la que se está escaneando), pero deliberadamente **no**
excluye que una fase cite a OTRA fase de su propio spec: si esa cita
describe una dependencia de orden real (como en estos tres casos), el aviso
es correcto — es exactamente la señal que la red heurística existe para dar,
sólo que resulta que el spec citado y el spec citante son el mismo. No es
ruido a eliminar; es la razón por la que la exclusión de autorreferencia se
limita al par exacto (spec, fase) y no a "toda mención del propio spec".

**Segundo caveat, distinto del anterior y más grande — señalado en la ronda 3
de review, verificado con la corrida real, no de oído:** el caveat de arriba
describe el caso MÁS CHICO de los dos. El más grande es que **los specs que
documentan el propio guard citan fases de ejemplo de OTROS specs**, y esas
citas no son dependencias de orden — son ejemplos dentro de la prosa que
explica cómo funciona la herramienta. Corrido contra el corpus real (51
avisos, no 49 — la cifra de arriba quedó vieja tras esta misma ronda de
fixes): `spec-89` fase 1 genera 4 avisos, `spec-91` fases 3/4/5 generan 11 —
**15 de 51, el ~30 % del volumen total**, y ninguno de los 15 es una
dependencia de orden real. Es ruido estructural inherente a que este guard
se documenta a sí mismo citando ejemplos reales del corpus — no hay forma de
excluirlo sin también excluir citas legítimas de otros specs a este mismo
spec (que sí pueden ser dependencias reales). Aceptado, no arreglado, por la
misma razón que el caveat anterior: adivinar cuál cita es "sólo un ejemplo
de la documentación" y cuál es una dependencia real sería peor que avisar
de más en un canal que no bloquea nada.

### Fase 5 — Reconciliación en servidor: la garantía real del Hueco 1 `[in_progress]`

**Añadida en ronda 2 de review.** Ver "La garantía real: reconciliación en
servidor (detalle de la fase 5)" arriba para el razonamiento completo — esta
fase existe porque ningún hook local puede cerrar el Hueco 1 de verdad.

**Archivos:** `scripts/reconcile-stale-phases-lib.mjs`, `scripts/reconcile-stale-phases-lib.test.mjs`,
`scripts/reconcile-stale-phases.mjs` (CLI + orquestación testeable por inyección de dependencias),
`scripts/reconcile-stale-phases.test.mjs`, `.github/workflows/reconcile-stale-phases.yml`,
`.github/workflows/ci.yml` (wiring de los dos `.test.mjs`)

- [ ] `findInProgressPhases(specFiles)`: escanea `docs/specs/spec-*.md` y
      extrae toda fase con token `[in_progress]`, con su spec id (del
      nombre de fichero, no del contenido) y el texto de la fase.
- [ ] `extractSpecIdsFromBranches(branchNames)`: mismo patrón tolerante que
      `keep-going.sh` (`grep -oE 'spec-[0-9]+[a-z]?'`) sobre nombres de rama.
- [ ] `computeStalePhases(inProgressPhases, openPrSpecIds)`: una fase es
      rancia cuando su spec no tiene NINGÚN PR abierto que lo nombre —
      chequeo a nivel de **spec**, no de fase individual (limitación
      documentada, no bug: un PR abierto de OTRA fase del mismo spec
      igual suprime el aviso para ésta; se acepta el falso negativo
      ocasional a cambio de nunca gritar lobo sobre un spec genuinamente
      activo).
- [ ] `parseIssueBody`/`renderIssueBody`/`mergeStaleEntries`: el issue de
      seguimiento es una tabla markdown con `firstSeen` por entrada. Una fase
      YA rastreada conserva su fecha original (nunca se resetea a "hoy" sólo
      porque el workflow corrió de nuevo); una fase nueva recibe "hoy"; una
      fase que dejó de ser rancia se elimina de la tabla.
- [ ] `runReconciliation(deps)`: orquestación con **toda su E/S inyectada**
      (lectura de specs ya hecha, funciones para listar PRs abiertos y
      leer/crear/editar/reabrir/cerrar el issue) — decisión de diseño
      explícita: un `gh` falso en el `PATH` (el patrón usado en la fase 1)
      no sirve aquí porque este script necesita pasar texto ARBITRARIO (el
      cuerpo del issue) como argumento, no sólo un número validado; fabricar
      ese `gh` de forma segura choca con el mismo muro de `.cmd`/`EINVAL` de
      Windows documentado en `post-merge-remind.mjs`, sin ganar nada sobre
      la inyección de dependencias.
- [ ] Un único issue por repo, identificado por **label** (mismo patrón que
      `qa-drift-watchdog.yml`, `--label qa-drift`), no por búsqueda de texto
      en el título — más estable que confiar en que `gh issue list --search`
      calce el título exacto.
- [ ] Lista vacía y no había issue → no hace nada. Lista vacía y había issue
      **abierto** → lo cierra con comentario. Issue **ya cerrado** y lista
      sigue vacía → no-op (no lo vuelve a tocar). Issue cerrado y aparece una
      fase rancia nueva → actualiza el cuerpo Y lo reabre.
- [ ] Fallo al listar PRs abiertos (red/auth) → aborta SIN tocar el issue —
      fail open a propósito: un error de listado no debe crear ruido falso
      ("todo está rancio"). **F5-4 (ronda 3):** el `JSON.parse` de esa
      respuesta vivía FUERA del mismo `try` — un `gh` que sale 0 con salida
      no-JSON lanzaba sin capturar, contradiciendo el fail-open declarado.
      Movido dentro.
- [ ] **F5-1 (BLOQUEANTE, ronda 3), cerrado:** `findTrackingIssue` que no
      pudo determinar si ya existe un issue (blip de red/parseo de `gh`)
      devolvía `null` — indistinguible de "confirmado: no existe issue".
      Reproducido con el issue #42 ya abierto: `runReconciliation` creaba un
      SEGUNDO issue en vez de abortar. Corregido con un sentinel
      (`{ error: true }`) que `runReconciliation` chequea antes de decidir
      nada — mismo tratamiento fail-open que `listOpenPrBranches` ya tenía.
      Corre en cada push a `main` (cada PR mergeado); sin este fix, un rate
      limit o un 5xx puntual acumula issues duplicados para siempre (el
      `--limit 1` de la búsqueda siempre engancha el más nuevo).
- [ ] **F5-2 (seguimiento, ronda 3):** cerrar el issue a mano no sirve — la
      corrida siguiente lo reabre si sigue habiendo algo rancio. Escotilla:
      el label `wontfix` en el propio issue significa "no lo toques"; el
      script lo respeta y no actualiza ni reabre ni cierra nada mientras
      esté puesto.
- [ ] **F5-3 (seguimiento, ronda 3):** la clave de identidad de una entrada
      es spec + NÚMERO de fase (`faseKey`), no el texto completo del
      heading — corregir el TÍTULO de una fase (después del número) ya no
      resetea `firstSeen` a "hoy", que es justo la columna que el cuerpo del
      issue le pide al lector usar para distinguir un falso positivo
      transitorio de uno real.
- [ ] **F5-5 (aceptado, no arreglado):** `--state all --limit 1` sobre el
      label toma el issue más reciente con ese label. Si alguien abriera a
      mano OTRO issue con el mismo label, el script lo secuestraría. Riesgo
      bajo (el label es específico de esta herramienta, nadie lo usa para
      otra cosa hoy) y el costo de blindarlo (comprobar también el título, o
      un segundo campo de identidad) no se justifica todavía — se deja
      escrito para que la próxima persona que lo toque no lo redescubra
      desde cero.
- [ ] Workflow `.github/workflows/reconcile-stale-phases.yml`: dispara en
      `push: main` y `schedule` diario. `permissions: issues: write,
      pull-requests: read, contents: read`. No bloquea CI — es su propio job
      independiente, nunca falla el pipeline de `main`.
- [ ] Caso de aceptación real, como test: reproduce la forma exacta del
      incidente que motivó el spec — `spec-89 fase 1` sigue `[in_progress]`
      con su PR (#691) ya mergeado, cero PRs abiertos para `spec-89` hoy →
      se reporta como rancia; `spec-91` (esta misma fase, con su propio PR
      todavía abierto) NO aparece en la misma corrida.
- [ ] Mutation-test: invertir la condición `existing.state === 'OPEN'` antes
      de cerrar (rompe "no cierra dos veces"), e invertir la condición de
      reapertura (rompe "sólo reabre si estaba cerrado") — las dos rompen un
      test cuando se aplican, confirmado y revertido.

---

## Deliberadamente NO en este spec

- Backfill de `**Depende de:**` en el corpus existente — va aparte, spec
  nombrado, como fue `**Archivos:**` (#693).
- Hacer `**Depende de:**` obligatorio en `check-spec-fields.sh` — rompería CI
  en toda fase activa hoy sin ese campo. Orden: guard (este spec) → backfill →
  obligatoriedad.
- Fallback en `keep-going.sh` para ramas sin nombre de spec (fases
  `[in_progress]` con rama remota desaparecida) — evaluado y descartado, ver
  razón arriba. La fase 5 lo reemplaza con una versión que sí funciona.
- Inferencia certera de "qué fase exacta cierra este PR" — el hook nombra el
  spec y, como pista, la fase que el nombre de rama sugiere; el orquestador
  confirma.
- Chequeo de dependencia a nivel de FASE en la fase 5 (sólo a nivel de spec)
  — evaluado y descartado por ahora: exigiría parsear el número de fase de
  cada rama abierta con el mismo patrón tolerante que ya falla a veces
  (`fase1` sin separador, `fase-1b` con sufijo), y el costo de un falso
  negativo ocasional (un PR abierto de otra fase del mismo spec suprime el
  aviso) es más barato que el de un falso positivo que le pida a alguien
  revisar una fase que en realidad sigue activa bajo otro PR.
- Apagar `.claude/hooks/keep-going.sh` cuando el orquestador está dentro de
  un worktree ajeno — evaluado y descartado (ver "Limitación conocida y
  documentada, no arreglada aquí" arriba): apagaría la señal justo para los
  `implementer` a los que existe para empujar. La solución es salir del
  worktree, no apagar el guard.
- Partir `scripts/check-phase-overlap.mjs` en más módulos — evaluado y
  descartado en la ronda 3 de review, con el dato exacto: el fichero estaba
  en 318 líneas **antes** de que este spec lo tocara (herencia de spec-89),
  y de las 388 actuales, 225 son código y 163 son comentario explicativo —
  la regla de 300 líneas existe contra ficheros que nadie puede sostener en
  la cabeza, no contra prosa que explica por qué una regla es como es. El
  corte que sí se hizo aquí (`resolveDependency`/`checkDependencies` a
  `-depends.mjs`) separó por concern, no por conteo, y es el corte correcto.
  **Dicho eso: la PRÓXIMA adición a este fichero saca `buildTarget` y
  `printReport`** a sus propios módulos — no hay margen para crecer más sin
  hacerlo, y dejarlo dicho aquí es lo que evita que "no lo partas todavía"
  se convierta en "nunca se parte".
