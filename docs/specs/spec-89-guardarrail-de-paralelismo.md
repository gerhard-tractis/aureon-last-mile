# Spec-89: Guardarraíl de paralelismo — ¿estas fases se pisan?

**Status:** in progress
**Verify:** unit
**Downstream:** ninguno todavía — este spec construye una herramienta que el orquestador usa antes de dispatchar; ningún spec de producto depende de su implementación.

_Date: 2026-09-08_

---

## El problema, con evidencia

El orquestador despacha `implementer` en paralelo — dos o más fases a la vez, cada
una en su propio worktree — pero **no hay nada en el harness que impida que dos
fases toquen los mismos ficheros**, ni directa ni indirectamente. Comprobado hoy:

```
grep -rniE 'paralel|solap|overlap|shared' .claude/agents/*.md .claude/hooks/*.sh
```

devuelve **cero resultados**. La coordinación la hace el orquestador a mano,
leyendo los specs y confiando en la memoria — y hoy se le escapó.

**El caso concreto.** Se despachó `spec-82` fase 1 con la instrucción de «apoyarse
en la cola offline de spec-81», mientras **spec-81 fase 2 iba por su tercera
ronda de arreglos y su contrato seguía cambiando** — la semántica de
`ownEntries` se corrigió en esa misma ronda (ver `spec-81-recogida-cola-offline.md`
fase 2, notas de ronda 5). Se corrigió a mitad de sesión con un mensaje del
usuario, pero por suerte, no por diseño: nada en el harness lo habría detectado
si el usuario no estuviera mirando.

Requisito explícito: **«asegurar que solo se paraleliza cuando no se toquen
componentes compartidos ni directa ni indirectamente»**. Esto último — lo
indirecto — es la parte que un chequeo de "¿mismo fichero declarado?" no
atrapa, y es exactamente lo que pasó hoy: spec-82 fase 1 no declaraba tocar
ningún fichero de spec-81, pero **dependía en tiempo de ejecución** del
contrato que spec-81 estaba cambiando.

## Qué se construyó

`scripts/check-phase-overlap.mjs` (+ wrapper `.sh`, + `check-phase-overlap-parse.mjs`
y `check-phase-overlap-closure.mjs` como módulos puros, + sus tests): dado un
conjunto de "targets" (`<spec>#<fase>[@<rama>]`), responde si sus superficies de
ficheros se solapan — directamente, o a través de imports.

```
node scripts/check-phase-overlap.mjs \
  "docs/specs/spec-81-recogida-cola-offline.md#Fase 2@feat/spec-81-fase-2-drenado" \
  "docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md#Fase 1@feat/spec-82-fase-1" \
  --base origin/main
```

### Fuente de la superficie: lo declarado + lo real, nunca un registro nuevo

**Decisión de diseño explícita: no se creó ningún fichero de estado
("claims", "locks", "in-flight.json").** La rama de cada fase ya dice qué toca
de verdad (`git diff --name-only <base>...<rama>`), y el campo `**Archivos:**`
del spec dice qué **va** a tocar antes de que exista una rama con commits. Un
registro adicional habría significado un tercer lugar que puede desincronizarse
de los otros dos — el mismo error de fondo que llevó a que el harness perdiera
sus tres subagentes en 2026-09-07 (ver `docs/specs/CLAUDE.md`, "El harness tiene
que existir en el repo"): un estado que vive fuera de lo que ya es fuente de
verdad, se pudre.

Por eso `check-phase-overlap` no tiene "modo declarar" ni "modo reclamar": lee
`**Archivos:**` del spec (vía `check-phase-overlap-parse.mjs`) y, si la rama ya
tiene commits, une eso con el diff real. **Lo real siempre gana** — cuando una
fase ya tiene commits, su superficie declarada casi nunca coincide exactamente
con lo que terminó tocando (ver la fase 1 de este mismo spec-89 más abajo: el
run real contra las cuatro ramas lo demuestra), y ocultar esa diferencia detrás
de sólo lo declarado habría producido falsos negativos.

**Fase 0 aún no tiene commits.** Cuando una fase se está por dispatchar y su
rama no existe todavía, sólo hay `**Archivos:**` para trabajar — que es
precisamente el caso de uso principal (chequear ANTES de dispatchar, no
después).

### El campo `**Archivos:**` pasa a ser obligatorio en fases tomables

`scripts/check-spec-fields.sh` se extendió para exigir `**Archivos:**` dentro
del cuerpo de toda fase `[pending]` o `[in_progress]` — no en `[done]`,
`[blocked]`, `[parked]` ni `[awaiting_user_test]`, para no romper
retroactivamente las fases ya cerradas o paradas que nunca la llevaron (74 de
96 fases existentes, ver más abajo).

**Cuántas fases quedarían en falta con esta regla, contadas hoy:** de las 23
fases actualmente `[pending]`/`[in_progress]` en `docs/specs/`, **11 no
declaran `**Archivos:**`** (spec-80 fase 1b, spec-82 fase 2, spec-83 fases 3-4,
spec-86 fases 1/2a/3, spec-88 fases 1/2/4/5). No es un número que justifique
una campaña de retrofit: `check-spec-fields.sh` **sólo valida los specs
tocados en cada PR** (regla ya existente, ver el comentario en su cabecera), así
que ninguna de esas 11 rompe CI hoy — se ponen al día la próxima vez que alguien
las toque, exactamente como migran el resto de los campos exigidos por ese
script. Si en el futuro se quisiera una migración activa en vez de pasiva, la
palanca correcta es la que ya está descrita en `docs/specs/CLAUDE.md` para
`[in_progress]`: exigir `**Archivos:**` **al momento de que el orquestador pase
una fase a `[in_progress]`**, no antes — eso cubre el 100% del trabajo nuevo sin
tocar una sola fase vieja.

### Cierre transitivo — dónde se corta, y por qué ahí

Un fichero declarado importa otros. Dos fases pueden declarar páginas distintas
y compartir un componente sin que ninguna lo declare. `buildClosure` (en
`check-phase-overlap-closure.mjs`) hace un BFS desde la superficie de escritura
de cada target, siguiendo:

- imports relativos (`./`, `../`);
- el alias `@/` de `apps/frontend/tsconfig.json` (`"@/*": ["./src/*"]`);
- barriles (`carpeta/index.ts(x)`);
- imports de tipo (`import type { X } from '...'`) — **se siguen igual que un
  import de valor**, no se descartan. La razón es el propio incidente de hoy:
  lo que cambió en spec-81 fue la forma de `ownEntries`, un contrato de tipos.
  Un import de tipo que se ignorara en el cierre habría dejado invisible
  exactamente el tipo de acoplamiento que este guard existe para atrapar.
- **una convención de Next.js App Router que NO es un `import`**: un
  `page.tsx` bajo `apps/frontend/src/app/**` está envuelto por todo
  `layout.tsx` ancestro por convención de sistema de archivos, nunca por una
  declaración `import`. Esto se descubrió corriendo la herramienta contra las
  ramas reales (ver más abajo): `apps/frontend/src/app/app/layout.tsx`
  importa `AppLayout`, y **ningún** `page.tsx` de Recogida importa
  `layout.tsx` — un cierre de imports puro habría reportado "disjunto" cuando
  la realidad es que las tres ramas de Recogida comparten el mismo shell.
  `nextLayoutAncestors()` añade ese borde explícitamente, como un tipo de
  arista distinto ("convención", no "import"), para que el reporte sea
  honesto sobre por qué dos ficheros están conectados.

**Profundidad tope: 2 (configurable con `--max-depth`), no cierre completo.**
Argumento, con el caso real medido: `useOfflineQueue.ts` (declarado por
spec-81 fase 2) → `queue.ts` (1 hop) → `db.ts` (2 hops) ya alcanza el módulo de
infraestructura compartida; un tercer hop empieza a entrar en utilidades de
propósito general. Y por el lado de Next.js: `page.tsx` (seed) → `layout.tsx`
(1 hop, convención) → `AppLayout.tsx` (2 hops, import) — el incidente real de
hoy es alcanzable exactamente en el límite de profundidad 2, no más allá — un
hop 3 (`--max-depth 3`) agrega `AppLayout.tsx` → `TopBar.tsx`, y de ahí para
adelante se entra en territorio de componentes de `components/ui/*` que
**literalmente todas** las pantallas importan, donde el reporte deja de decir
algo útil: un guard que dice "todo se solapa con todo" no lo corre nadie dos
veces. `node_modules` queda excluido
por construcción, no por profundidad: `resolveSpecifier` sólo resuelve
especificadores relativos o con el alias `@/`; un specifier "pelado" (`react`,
`next/navigation`, `sonner`) se descarta sin intentar resolverlo.

### Conflicto duro vs. acoplamiento blando

- **Conflicto duro** — dos targets **escriben** el mismo fichero (declarado o
  en su diff real). Bloquea: exit code 1. Es un accidente de orden de merge
  esperando pasar.
- **Acoplamiento blando** — un target **escribe** un fichero que el otro sólo
  **alcanza** por import (directo o transitivo) sin escribirlo. **No bloquea**
  — se imprime con la cadena completa (`vía import "X" desde Y`) para que el
  orquestador decida con contexto, no a ciegas. Bloquear aquí habría hecho el
  guard inútil en un repo donde `AppLayout.tsx` cuelga de todas las pantallas:
  el run real de más abajo encuentra acoplamiento blando entre las tres ramas
  de Recogida a través de exactamente ese fichero, y **es correcto que no
  bloquee** — lo que hizo falta hoy no fue impedir el dispatch, fue que
  alguien lo supiera antes de dispatchar.

Dos targets que sólo **alcanzan** el mismo fichero por import, sin que
**ninguno** lo escriba, no se reportan — eso no es una señal de riesgo de
paralelismo, es "este repo tiene un sistema de diseño compartido".

## Validado contra la realidad, no contra fixtures

La lección más cara del día (el guard de cuarentena pasó siete rondas de review
fabricando un informe con una forma que Playwright nunca produce) obliga a
correr esto contra código real, no sólo contra fixtures inventadas. Y una
segunda lección, de la ronda 1 de review de este spec: **corrido en el momento
equivocado, un criterio de aceptación pasa por razones que no sostienen el
caso real.** El primer borrador de esta sección validaba con las cuatro ramas
YA COMMITEADAS — que es post-hoc, no el momento en que el orquestador de verdad
necesita la respuesta. El criterio correcto es **modo dispatch-time**: los
mismos targets, **sin rama**, porque en el momento de decidir si dos fases
nuevas se pueden despachar en paralelo casi nunca hay todavía una rama con
commits — sólo hay lo que el spec declaró.

### Modo dispatch-time (sin rama) — el caso real, corrido como se usa de verdad

```
node scripts/check-phase-overlap.mjs \
  "docs/specs/spec-81-recogida-cola-offline.md#Fase 2" \
  "docs/specs/spec-80-recogida-movil-cierre-de-carga.md#Fase 2" \
  "docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md#Fase 1" \
  --base origin/main
```

Resultado real, 2026-09-08, contra `origin/main` post-PR#693 (backfill de
`**Archivos:**`): **CONFLICTO DURO: ninguno. ACOPLAMIENTO BLANDO: ninguno.
VEREDICTO: despachable en paralelo — superficies disjuntas.**

**Esto es exacto para lo que cada fase DECLARA, y honesto sobre el límite de
esa declaración.** spec-81 fase 2 declara un solo fichero
(`useOfflineQueue.ts`), que a dos hops de profundidad no alcanza
`AppLayout.tsx` — sólo lo alcanza porque la rama real, con sus 26+ ficheros
commiteados, sí lo toca. La cobertura de `**Archivos:**` de spec-81 fase 2 es
~4% de lo que la fase termina tocando de verdad. **Esta herramienta no puede
arreglar la calidad de una declaración escasa** — puede negarse a opinar
cuando no hay declaración en absoluto (bloqueante 3, abajo), pero no puede
inventar ficheros que el spec nunca nombró. El criterio de aceptación de este
spec es que la herramienta **razone correctamente sobre lo que se le da**, no
que adivine lo que falta.

### Modo post-hoc (con rama, cuando ya existe) — más preciso, no el caso de dispatch

```
node scripts/check-phase-overlap.mjs \
  "docs/specs/spec-81-recogida-cola-offline.md#Fase 2@origin/feat/spec-81-fase-2-drenado" \
  "docs/specs/spec-80-recogida-movil-cierre-de-carga.md#Fase 2@feat/spec-80-fase-2-bloqueo-faltantes" \
  "docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md#Fase 1@origin/feat/spec-82-fase-1" \
  "docs/specs/spec-88-anon-security-definer-audit.md#Fase 2@origin/feat/spec-88-fase-2-assert-operator-access" \
  --base origin/main
```

Con las ramas reales ya commiteadas, la misma corrida (2026-09-08 — ver
"Rendimiento" abajo para el tiempo real medido) — **CONFLICTO DURO: ninguno. ACOPLAMIENTO BLANDO — 4
casos**, incluido `apps/frontend/src/components/AppLayout.tsx` (escrito por
spec-81 fase 2, alcanzado por spec-80 fase 2 y spec-82 fase 1 vía
`layout.tsx` — convención de Next.js, no import). spec-88 (SQL puro) no
aparece en ningún caso — disjunta. Veredicto: **despachable en paralelo —
sólo acoplamiento blando, revisar los casos de arriba**.

**Cuándo usar cuál:** dispatch-time es el chequeo real *antes* de dispatchar
una fase que todavía no tiene rama. Post-hoc es útil para revalidar una fase
que ya está en curso contra otra que se va a dispatchar junto a ella — en ese
caso sí hay una rama real que consultar, y consultarla siempre gana sobre la
declaración (ver "Fuente de la superficie" arriba). Ninguno de los dos modos
es "el correcto" en abstracto; dispatch-time es el que importa para el
requisito original ("antes de dispatchar en paralelo").

### El número que importa: cuántas fases quedan en "no puedo juzgar" hoy

Recontado tras el merge de spec-88 fase 2 (PR #683) y mi backfill de spec-88
fases 1/4/5 (que este mismo commit añade): de las **25 fases
`[pending]`/`[in_progress]` activas hoy** en `docs/specs/`, **3 no declaran
`**Archivos:**` en absoluto**: spec-80 fase 1b, spec-82 fase 2, spec-83
fase 3.

- **1 es juzgable igual** si el orquestador le pasa la rama que ya existe
  (`feat/spec-80-fase-1b-close-manifest-acl`) — el diff real sustituye a la
  declaración ausente.
- **2 quedan en "no puedo juzgar" pase lo que pase hoy**: spec-82 fase 2 y
  spec-83 fase 3 — ni declaración ni rama. Son, textualmente, las dos que el
  agente del backfill (PR #693) **se negó a rellenar por ambigüedad
  honesta** — spec-82 fase 2 habla de precargar al «almacén de spec-81»,
  pero hoy `lib/db.ts` sólo tiene colas de salida, no caché de lectura;
  spec-83 fase 3 es un condicional explícito en el propio spec («leer
  spec-73 y decidir»). Que la herramienta se niegue a opinar exactamente
  donde un agente humano-en-el-loop también se negó no es una coincidencia
  — es la señal de que el rechazo es la respuesta correcta, no un hueco de
  cobertura.

**23 de 25 (92%) son juzgables hoy sin tocar nada más** (22 por declaración
directa, 1 más si el orquestador pasa la rama existente). Sólo **2 de 25
(8%)** quedan genuinamente sin poder juzgar — y son exactamente las dos que
un humano también se negó a decidir sin más contexto.

**Corrección sobre una ronda anterior de esta misma sección — bug real, no
sólo un número desactualizado (review ronda 3).** Un borrador anterior
contaba spec-88 fase 4 y fase 5 como "sin declaración ni rama", cuando
**spec-88 fase 5 sí declara `**Archivos:**`** (una referencia de directorio,
`packages/database/supabase/migrations/`) — y **spec-84 fase 3** usa la
misma forma. La razón por la que parecían indistinguibles de "no declarado"
era un bug real: `check-phase-overlap.mjs` devolvía el campo como
`declaredDirs`, `check-phase-overlap-closure.mjs` lo leía como
`a.directories ?? []` — el `?? []` se tragaba el desajuste de nombre en
silencio, `directoryConflicts` nunca iteraba nada, y una fase que sólo
declara un directorio quedaba con `writeSet.size === 0`, cayendo en el mismo
"no puedo juzgar" que una fase sin declarar nada. Ambos bugs (el nombre de
campo, y que una declaración de sólo-directorio no debe contar como "sin
superficie") están corregidos con test de regresión que ejercita el camino
real de la CLI, no un fixture que fabrica la forma correcta — ver
"Mutación verificada" abajo.

## Mutación verificada

Cada regla del núcleo se mutó a mano y se confirmó que algún test la atrapa —
no basta con "los tests pasan", hace falta ver el test fallar cuando la regla
se desactiva:

- `computeOverlap`: la distinción duro/blando, la exclusión de `docs/**` de
  ambos tiers (bloqueante 1), y la semántica de directorio-vs-fichero-concreto
  (bloqueante 5 — dos declaraciones de directorio nunca chocan entre sí; una
  declaración de directorio SÍ choca con un fichero concreto de la otra fase
  bajo ese directorio).
- `buildClosure`: el guard `isNextPageFile` (con un fichero señuelo que
  demuestra que el guard hace falta, no que coincide por casualidad), Y **el
  valor por defecto del tope de profundidad (2)** — no sólo el mecanismo. La
  primera ronda de tests pasaba `maxDepth` explícito siempre, así que una
  mutación del *default* (`maxDepth = 2` → `99`, tanto en
  `check-phase-overlap-closure.mjs` como, por separado, en
  `check-phase-overlap.mjs`) sobrevivía sin que ningún test lo notara —
  corregido con un test end-to-end que omite `--max-depth` a propósito.
- **Ronda 3 — el desajuste de nombre de campo `declaredDirs`/`directories`,
  y la mutación que sí lo habría atrapado si hubiera existido.** El primer
  test de directorio-vs-fichero (ronda 1) vivía sólo en
  `check-phase-overlap-closure.test.mjs`, cuya fábrica de fixtures
  (`target()`) construye el objeto con la clave `directories` a mano — la
  misma clave que `computeOverlap` lee. Eso prueba que la REGLA es correcta;
  no prueba que el CLI real (`check-phase-overlap.mjs`) construya el objeto
  con esa clave. Devolvía `declaredDirs`, y `a.directories ?? []` en
  `computeOverlap` se tragaba el desajuste sin lanzar — una fase que declara
  sólo un directorio nunca chocaba con nada, vía CLI, aunque los 22 tests de
  `check-phase-overlap-closure.test.mjs` siguieran en verde. Corregido con
  cuatro tests nuevos en `check-phase-overlap.test.sh` que ejercen el camino
  real (spec → CLI → closure), no la fábrica de fixtures — mutando
  `directories: declaredDirs` de vuelta a `declaredDirs`, y mutando
  `directoryConflicts` a un `return` inmediato, cada uno hace morir esos
  cuatro tests. Lección aplicada, no sólo anotada: una regla de
  `check-phase-overlap-closure.mjs` sin un test correspondiente en
  `check-phase-overlap.test.sh` que la alcance por el camino real de la CLI
  es una regla que puede estar desconectada de la CLI sin que nada lo note.

Salida real de cada mutación (mutante → test que muere) está en el reporte de
cierre de fase 1.

## Rendimiento — de incompatible con un hook a segundos

Medido por el review (ronda 1, medio 7) contra las cuatro ramas reales:
**86s para 2 targets pequeños, más de 15 minutos para el cuarteto completo**.
Causa: `resolveSpecifier` prueba hasta 7 candidatos de extensión por
especificador (sin extensión, `.ts`, `.tsx`, `.js`, `.jsx`, dos sufijos de
barril), y cada candidato era un `git show` — un proceso nuevo por intento,
la mayoría de los cuales fallan (el candidato no existe). Un `PreToolUse` que
tarda minutos se desactiva la primera semana, y "de aquí a un hook" es
exactamente el destino declarado para este guard.

**Arreglo:** `git ls-tree -r --name-only <ref>` lista el árbol ENTERO de un
ref en una sola llamada — una vez por ref distinto en toda la corrida, no una
vez por candidato. La existencia de un candidato pasa a ser un `Set.has()` en
memoria (gratis); `git show` se llama como máximo una vez por fichero, sólo
para el candidato ya confirmado, y su resultado también se cachea (un mismo
fichero compartido se resuelve una vez, no una vez por importador que lo
alcanza). `makeResolver` se simplificó de paso: la rama de una fase ya
contiene, por herencia de árbol, todo lo que no cambió respecto a la base —
"probar rama, si falla probar base" nunca hacía falta.

**Medido después del arreglo, mismo cuarteto real:** en esta sesión, ~15.4s
(`Date.now()` antes/después del proceso completo, en este entorno Windows +
Git Bash, con el overhead de proceso que eso conlleva). **El review (ronda 3)
midió, en su entorno, números bastante mejores**: un par pequeño en 1.8s, el
cuarteto en modo dispatch-time (sin ramas) en 2.5s, y el cuarteto post-hoc
(con las cuatro ramas reales) en 6.6s — es decir, mi cifra subestimó la
mejora, no al revés. De más de 15 minutos a segundos en un solo cambio, sin
tocar la superficie pública del CLI. Comportamiento verificado sin cambios:
los 21 tests de `check-phase-overlap.test.sh` (17 + 4 de la ronda 3, ver
"Mutación verificada") siguen en verde tras el refactor.

**Efecto colateral encontrado y corregido en el camino:** el mismo repo real
expuso un crash — un candidato de `resolveSpecifier` sin extensión puede
coincidir con un DIRECTORIO real del árbol de trabajo (`existsSync` es cierto
para directorios también; `readFileSync` sobre uno lanza `EISDIR`, no "no
encontrado"). `readWorkingTree` ahora comprueba `statSync().isFile()` antes
de leer. Sin la corrida contra el repo real esto habría quedado invisible —
ninguna fixture pequeña tiene un candidato que coincida por accidente con una
carpeta real.

## Cómo se usa — y qué queda fuera a propósito

**El orquestador lo corre antes de dispatchar dos o más fases en paralelo.**
Documentado en `.claude/agents/implementer.md` (nota breve, ver ese archivo) y
aquí: si el veredicto es "CONFLICTO DURO", no se dispatcha en paralelo — se
serializa o se reparte el trabajo para que no se pisen. Si es "ACOPLAMIENTO
BLANDO", se dispatcha con la advertencia leída, no a ciegas.

**Deliberadamente NO es:**

- **Un gate de CI.** No hay forma de saber en un `pull_request` contra qué
  otras ramas comparar — el solapamiento importa en el momento del *dispatch*,
  antes de que exista una PR, no en el momento del merge. Forzarlo a CI habría
  significado inventar una lista de "ramas activas ahora mismo", que es
  exactamente el registro de estado que la sección de diseño de arriba
  rechazó.
- **Automático dentro de `implementer`.** Se consideró que el propio agente
  se autochequeara al arrancar contra las demás ramas vivas, y se descartó por
  ahora: el costo no es técnico (el CLI ya soporta pasarle ramas), es de
  **quién tiene la vista completa**. Un `implementer` aislado en su worktree
  no sabe qué otras fases están en vuelo — eso lo sabe el orquestador, que es
  quien decide el dispatch. Automatizarlo ahí requeriría que el propio
  `implementer` descubriera "¿qué otras ramas del harness están activas
  ahora?", que es un problema distinto (y más frágil: la limitación ya
  documentada en `docs/specs/CLAUDE.md` sobre refs de `fetch` desactualizadas
  aplicaría igual aquí). Queda como una mejora futura nombrada, no como un
  vacío sin registrar.
- **Detector de acoplamiento a nivel de dominio.** Dos fases pueden compartir
  una tabla de Supabase, un RPC, o un contrato de negocio sin compartir una
  sola línea de TypeScript — spec-81 y spec-82 comparten la tabla
  `pickup_scans` conceptualmente sin que ningún fichero de frontend lo
  refleje. Esta herramienta sólo ve ficheros y sus imports; el resto lo sigue
  decidiendo el orquestador leyendo los specs, como hasta ahora.
- **Ilimitadamente preciso en la resolución de módulos.** No replica el
  resolver de TypeScript/Next.js (paths condicionales, `exports` de
  `package.json`, alias adicionales de otros `tsconfig`). Cubre lo que este
  monorepo usa hoy: `@/*` → `apps/frontend/src/*`, imports relativos,
  barriles `index.ts(x)`, y la convención de layout de Next.js. Un alias
  nuevo que se añada a `tsconfig.json` sin actualizar
  `check-phase-overlap-closure.mjs` degrada en falso negativo silencioso —
  riesgo aceptado y documentado, no una garantía de completitud.
- **Ciego a la colisión en SQL puro (bloqueante 2 del review, estructural —
  no se ataca aquí).** Dos migraciones DISTINTAS que hacen `CREATE OR
  REPLACE FUNCTION` sobre la MISMA función no se detectan: cada una es un
  fichero `.sql` diferente, así que ni el tier duro (mismo fichero) ni el
  cierre de imports (SQL no tiene imports) las conecta — aunque en tiempo de
  ejecución sean la misma colisión que dos fases escribiendo la misma
  función de TypeScript. Encaja mal en un cierre de imports por diseño: la
  pieza correcta sería parsear el nombre de función objetivo de cada
  migración (`check-migration-safety-rule1-match.mjs` ya hace algo parecido
  para otro propósito) y comparar NOMBRES DE FUNCIÓN, no rutas de fichero —
  un modelo de datos distinto al de este guard. Se deja registrado como
  candidato a fase separada, no como hueco silencioso.
- **Consciente de renombres/borrados entre ramas, con un límite.** Una rama
  que borra un fichero que la base tenía se resuelve correctamente hoy: su
  `git ls-tree` ya no lo lista, así que el resolvedor cae al árbol de
  trabajo en vez de al contenido stale de la base (corregido en la ronda 2
  de review, junto con la cache de `git show` — ver "Rendimiento" abajo).
  El límite que queda: si el fichero tampoco existe en el árbol de trabajo
  local (un checkout que no sea el que se está inspeccionando), la
  resolución para ahí — no hay drama, buildClosure simplemente no puede
  extender más allá de ese punto, que es el resultado honesto para un
  fichero que ya no existe en ningún lado consultable.
- **`import()` dinámico y side-effect imports no se reconocen.** `IMPORT_RE`
  (en `check-phase-overlap-parse.mjs`) cubre `import`/`import type`/
  re-exports/`require()`, pero no `next/dynamic(() => import(...))` ni un
  `import './x.css'` sin binding. Verificado contra el repo real: **hoy no
  hay ningún `next/dynamic` ni `await import(` fuera de tests** en
  `apps/frontend/src` — hueco latente, no activo. Si aparece uno, degrada en
  falso negativo silencioso (un borde de acoplamiento invisible), no en un
  crash — anotado aquí para que la próxima persona que añada un
  `next/dynamic` sepa que este guard no lo sigue todavía.
- **`nextLayoutAncestors` sólo busca `layout.{tsx,ts}`.** Next.js aplica
  `template.tsx`, `error.tsx` y `loading.tsx` a una ruta por la MISMA
  convención de sistema de archivos — `apps/frontend/src/app/error.tsx`
  existe hoy y se aplica a todo el árbol. El mismo razonamiento que justificó
  el edge de `layout.tsx` aplica igual a esos tres ficheros; el código
  todavía no los sigue. Tier blando si se añadiera (nunca lo escribe una
  fase directamente sin querer), impacto bajo — anotado, no implementado en
  esta fase.

## Fases

### Fase 1 — `check-phase-overlap` + extensión de `check-spec-fields.sh` `[in_progress]`

**Archivos:** `scripts/check-phase-overlap.mjs`, `scripts/check-phase-overlap.sh`,
`scripts/check-phase-overlap-parse.mjs`, `scripts/check-phase-overlap-closure.mjs`,
y sus `.test.mjs`/`.test.sh`; `scripts/check-spec-fields.sh` (regla `**Archivos:**`)
y `scripts/check-spec-fields.test.sh`; `.claude/agents/implementer.md` (nota de
uso); `.github/workflows/ci.yml` (wiring de los nuevos `.test.sh`/`.test.mjs`).

Todo lo descrito arriba: los tres módulos, la extensión del guard de specs, la
validación contra las cuatro ramas reales de Recogida, y la nota de uso para el
orquestador. Sin fase 2 prevista — es un guard nuevo, autocontenido; si aparece
trabajo derivado (el hook automático descartado arriba, soporte para más
alias), se abre como spec nuevo, no como fase de éste.

- [x] `check-phase-overlap-parse.mjs`: `parseTarget`, `extractArchivosFiles`,
      `normalizeFrontendPath`, `resolveArchivosEntries` (bloqueante 5 —
      arrastre de directorio, sufijo de línea, declaración de directorio),
      `parseImportSpecifiers` — TDD, 22/22 verde.
- [x] `check-phase-overlap-closure.mjs`: `buildClosure` (tope de profundidad
      **con test del valor por defecto**, alias `@/`, barriles, convención
      de layout de Next.js) y `computeOverlap` (duro/blando, exclusión de
      `docs/**` de ambos tiers — bloqueante 1, semántica
      directorio-vs-fichero-concreto — bloqueante 5) — TDD, 22/22 verde,
      mutación verificada en cada regla.
- [x] `check-phase-overlap.mjs` + `.sh`: CLI, integración con `git diff`/`git
      show`/`git ls-tree` contra un repo temporal real (no fixtures
      fabricadas), write set vacío rechazado con exit 3 (bloqueante 3),
      advertencia explícita de ceguera SQL en el mensaje (M-3) — TDD,
      24/24 verde, mutación verificada en el exit code, el tope de
      profundidad por defecto de la CLI, el nombre de campo
      `directories`/`directoryConflicts` por el camino real (ronda 3), la
      exclusión de `docs/**` por el camino real (M-2), y la advertencia SQL.
- [x] `check-spec-fields.sh`: regla `**Archivos:**` obligatoria en fases
      `[pending]`/`[in_progress]`, exenta en las demás — TDD, 34/34 verde.
- [x] Corrida real en **modo dispatch-time** (sin ramas) y en modo post-hoc
      (con las cuatro ramas reales) — ver "Validado contra la realidad"
      arriba para ambas salidas completas y la cuenta de fases en
      "no puedo juzgar" (23/25 juzgables hoy — 22 por declaración directa, 1
      más si se pasa la rama existente —, 2/25 genuinamente no verificables
      sin backfill ni rama; corregido en ronda 3, ver más abajo).
- [x] Rendimiento: >15min → segundos en el cuarteto real (bloqueante/medio 7;
      medido de forma independiente por dos entornos, ver "Rendimiento").

**Ronda 2 de review — hallazgos cerrados:**
- Bloqueante 1 (falso positivo en `docs/**` entre fases hermanas del mismo
  spec) — `isIgnoredForOverlap`, mutación verificada.
- Bloqueante 3 (write set vacío informaba "disjunto" en vez de negarse) —
  exit 3 explícito, con el nombre de cada target sin superficie.
- Bloqueante 4 (el criterio de aceptación se validaba post-hoc) — reescrito
  en modo dispatch-time; ver la sección de arriba con ambos modos y el
  número de fases sin poder juzgar.
- Bloqueante 5 (paths sueltos sin directorio, sufijo de línea, referencia de
  directorio tratada como fichero literal) — `resolveArchivosEntries` +
  semántica de directorio en `computeOverlap` (una declaración de directorio
  nunca choca con otra declaración de directorio; SÍ choca con un fichero
  concreto de otra fase bajo ese directorio — escalado por el coordinador
  tras el backfill de PR #693, que expuso el mismo patrón en spec-86).
- Medio 6 (el valor por defecto del tope de profundidad no estaba
  mutation-testeado, sólo el mecanismo) — test end-to-end sin `--max-depth`
  en ambas capas (closure y CLI).
- Medio 7 (rendimiento incompatible con un hook) — cache de `git ls-tree` +
  `git show`, ver "Rendimiento" arriba.
- Bug encontrado en el camino (no reportado por el review; apareció al
  correr el modo dispatch-time real): `extractArchivosFiles` devolvía una
  forma distinta (sin `directories`/`warnings`) en sus dos ramas de retorno
  temprano — crasheaba con `TypeError` exactamente en las dos fases
  (spec-82 fase 2, spec-83 fase 3) que son el mejor caso de prueba del
  bloqueante 3. Corregido con test de regresión en ambas formas de retorno.
- Bug encontrado en el camino (durante la medición de rendimiento): un
  candidato de resolución sin extensión puede coincidir con un directorio
  real del árbol de trabajo — `EISDIR` crasheaba la corrida en vez de tratar
  el candidato como "no encontrado". Corregido con test de regresión.

**Ronda 3 de review — hallazgos cerrados:**
- **Bloqueante — desajuste de nombre de campo (`declaredDirs` vs
  `directories`)** entre `check-phase-overlap.mjs` y
  `check-phase-overlap-closure.mjs`. El `?? []` de `computeOverlap` lo
  absorbía en silencio: `directoryConflicts` nunca iteraba nada desde el CLI,
  aunque los 22 tests de `check-phase-overlap-closure.test.mjs` siguieran en
  verde — construían el objeto con la clave correcta a mano. Corregido
  unificando el nombre, con 4 tests nuevos en `check-phase-overlap.test.sh`
  que ejercen el camino real (spec → CLI → git diff → closure), y mutación
  verificada tanto en el nombre de campo como en `directoryConflicts` (un
  `return` inmediato ahí también hace morir esos 4 tests).
- **Daño colateral del bug anterior:** una fase que declara **sólo** un
  directorio (spec-88 fase 5, spec-84 fase 3 — la forma canónica del corpus
  para trabajo pgTAP/migración) quedaba con `writeSet.size === 0` y caía en
  "no puedo juzgar" con un mensaje que afirmaba, falso, que no había
  `**Archivos:**` declarado. Corregido: el chequeo de "no puedo juzgar" ahora
  excluye a los targets con `directories.length > 0`.
- **M-2** (exclusión de `docs/**`, bloqueante 1 de la ronda 1, sin cobertura
  extremo a extremo — mismo tipo de agujero que dejó pasar el bug de arriba)
  — test nuevo en `check-phase-overlap.test.sh` con dos ramas reales que
  sólo editan su spec compartido, mutación verificada.
- **M-3** (ceguera a colisiones en SQL, de "rojo accidental" en la ronda 1 a
  "verde silencioso" tras el bloqueante 1) — el mensaje del CLI ahora imprime
  una advertencia explícita cuando algún target incluye un `.sql` en su
  superficie, con test y mutación.
- **Conteos corregidos** en "El número que importa" (arriba): la sección
  decía «24 activas, 7 sin declarar, 71%» en el mismo commit que ya había
  añadido las cuatro líneas de spec-88 que nombraba como carentes —
  autocontradicción señalada por el coordinador. Recontado contra el árbol
  real: 25 activas, 3 sin campo, 2 genuinamente no juzgables (8%, no 29%).

**Lo que NO se atacó, y por qué:** la ceguera a colisiones en SQL puro
(bloqueante 2 del review) — ver el bullet correspondiente en "Deliberadamente
NO es" arriba; sí se le añadió la advertencia explícita (M-3) sin resolver el
problema estructural. `import()` dinámico/side-effect imports y
`template.tsx`/`error.tsx`/`loading.tsx` — hueco latente documentado, sin
uso activo en el repo hoy (verificado, ver bullets correspondientes).

> Implementado por: una sola sesión, spec + implementación, tres rondas de
> review adversarial atendidas en la misma rama (`feat/spec-89-guardarrail-paralelismo`).
> Review: ronda 1 (10 hallazgos: 5 bloqueantes, 2 medios, 2 menores, 1 "no
> atacar"), ronda 2 (escalada del bloqueante 5 con evidencia de spec-86), y
> ronda 3 (desajuste de nombre de campo que dejaba la regla de directorio
> como código muerto en producción, más dos notas para el futuro hook) — ver
> los resúmenes de hallazgos cerrados arriba. Pendiente de una cuarta ronda
> antes de merge.
> QA: PR #691 abierto, sin auto-merge — `gh pr checks 691` verde tras cada
> ronda (ver reporte de cierre de sesión para el detalle por commit).
