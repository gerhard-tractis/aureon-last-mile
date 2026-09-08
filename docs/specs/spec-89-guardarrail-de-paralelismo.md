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
correr esto contra código real, no sólo contra fixtures inventadas. Se corrió
contra las cuatro ramas vivas de Recogida el 2026-09-08:

```
node scripts/check-phase-overlap.mjs \
  "docs/specs/spec-81-recogida-cola-offline.md#Fase 2@feat/spec-81-fase-2-drenado" \
  "docs/specs/spec-80-recogida-movil-cierre-de-carga.md#Fase 2@feat/spec-80-fase-2-bloqueo-faltantes" \
  "docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md#Fase 1@feat/spec-82-fase-1" \
  "docs/specs/spec-88-anon-security-definer-audit.md#Fase 2@feat/spec-88-fase-2-assert-operator-access" \
  --base origin/main
```

Con el tope de profundidad **por defecto (2)**, sin flags extra — resultado
completo en el mensaje de cierre de la fase 1: **CONFLICTO DURO: ninguno.**
**ACOPLAMIENTO BLANDO — 2 casos**, ambos `apps/frontend/src/components/AppLayout.tsx`
— escrito por spec-81 fase 2, alcanzado por spec-80 fase 2 y por spec-82 fase 1,
los dos vía `layout.tsx` (convención de Next.js, no import) → `AppLayout`
(import). spec-88 (SQL puro) no aparece en ningún caso — disjunta. Veredicto:
**despachable en paralelo — sólo acoplamiento blando, revisar los casos de
arriba**. Con `--max-depth 3` aparecen dos casos más sobre `TopBar.tsx` (un hop
más allá de `AppLayout.tsx`) — mismo veredicto, más detalle.

Esto es exactamente lo que pedía el criterio de aceptación: las tres ramas de
Recogida se reportan compartiendo superficie (a través del shell de layout que
spec-81 tocó), y la cuarta —SQL puro— se reporta disjunta, sin aparecer en
ningún caso de solapamiento.

Esa corrida contra código real, no la fixture, es la que encontró y corrigió
dos bugs reales antes de este commit:

1. **CRLF rompía el emparejamiento de encabezados de fase.** `extractArchivosFiles`
   usaba un regex anclado con `$`; en un checkout de Windows (line endings
   CRLF), el `\r` sobrante entre el último carácter real y `$` hacía que
   **ningún** encabezado de fase matcheara nunca contra un spec real — sólo
   contra las fixtures de test, escritas con `\n` puro. Sin la corrida contra
   ficheros reales esto habría quedado invisible: los quince tests unitarios
   con fixtures `\n` pasaban en verde.
2. **El cierre de imports puro es ciego a los layouts de Next.js** (ver la
   sección anterior) — sin esta corrida real, el guard habría reportado
   "disjunto" entre las tres ramas de Recogida, un falso negativo exactamente
   del tipo que el requisito pide evitar ("ni indirectamente").

## Mutación verificada

Cada regla del núcleo (`computeOverlap`'s distinción duro/blando, el tope de
profundidad, el guard `isNextPageFile`) se mutó a mano y se confirmó que algún
test la atrapa — no basta con "los tests pasan", hace falta ver el test fallar
cuando la regla se desactiva. Documentado con la salida real en el reporte de
cierre de fase 1.

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
- **Consciente de renombres/borrados entre ramas.** Si una rama borra un
  fichero que la base tenía, `git show <rama>:<path>` falla y el resolvedor de
  contenido cae de vuelta al contenido de la base para ese path —
  documentado como limitación conocida en `check-phase-overlap.mjs`
  (`makeResolver`), no resuelto: una fase que borra un fichero compartido es
  exactamente el tipo de cambio que un humano debería estar mirando de todos
  modos, no algo que este guard deba adivinar en su nombre.

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
      `normalizeFrontendPath`, `parseImportSpecifiers` — TDD, 16/16 verde.
- [x] `check-phase-overlap-closure.mjs`: `buildClosure` (tope de profundidad,
      alias `@/`, barriles, convención de layout de Next.js) y
      `computeOverlap` (duro/blando) — TDD, 14/14 verde, mutación verificada
      en las dos reglas núcleo.
- [x] `check-phase-overlap.mjs` + `.sh`: CLI, integración con `git diff`/`git
      show` contra un repo temporal real (no fixtures fabricadas) — TDD,
      9/9 verde, mutación verificada en el exit code.
- [x] `check-spec-fields.sh`: regla `**Archivos:**` obligatoria en fases
      `[pending]`/`[in_progress]`, exenta en las demás — TDD, tests nuevos
      verdes junto con los 21 preexistentes.
- [x] Corrida real contra `feat/spec-81-fase-2-drenado`,
      `feat/spec-80-fase-2-bloqueo-faltantes`, `feat/spec-82-fase-1`,
      `feat/spec-88-fase-2-assert-operator-access`: conflicto duro ninguno,
      acoplamiento blando correctamente identificado en las tres de Recogida,
      spec-88 disjunta.

> Implementado por: (una sola sesión, spec + implementación — ver reporte de cierre)
> Review: sin revisión todavía — pendiente de `code-review`/`requesting-code-review` antes de PR.
> QA: PR todavía no abierto.
