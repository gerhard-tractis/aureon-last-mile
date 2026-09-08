# Spec-82: Recogida en móvil — manifiestos asignados y recogidas del día (`5b`, `5c`)

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre al que estas pantallas conducen), [spec-81](spec-81-recogida-cola-offline.md) (`DESCARGAR` depende de su almacén), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (escritorio `5a`), [spec-61](spec-61-pickup-route-crew.md) (construyó estas dos pantallas contra el mock `3j`), [spec-64](spec-64-remove-manifest-from-open-route.md) (quitar una carga de una ruta abierta), [spec-54](spec-54-ui-rebrand.md) (mock `1i`, ruta activa)

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-83-recogida-escritorio-datos-faltantes.md

_Date: 2026-09-07_

---

## Goal

Revalidar las dos pantallas móviles que **ya existen** contra los mocks `5b` y `5c`, que son posteriores a los mocks contra los que se construyeron, y cerrar las tres diferencias funcionales que la ronda nueva introduce.

Esto no es una reconstrucción. `5b` y `5c` están implementadas y funcionan: `PickupMobileNoRoute` / `PickupMobileStartRoute` (spec-61, mock `3j`) y `/app/pickup/route/active` (spec-54 mock `1i`, spec-64). Lo que hace falta es un diff contra el diseño nuevo y tres capacidades que no existen.

## Por qué existe este spec y no un «ajuste» dentro de spec-80

Porque las diferencias no son visuales. Dos de las tres tocan datos que hoy no se escriben (asignación) o que no existen en el cliente (precarga). Meterlas en el PR del cierre de carga mezcla dos discusiones distintas.

## Las diferencias

### 1. `5b` — «MANIFIESTOS ASIGNADOS A TI · 4»

El mock lista los manifiestos **asignados a esa persona**, agrupados por cliente, con «2 puntos · 67 paquetes» por grupo, y un pie que cuenta lo seleccionado: «2 manifiestos · 67 paq. entran a la ruta».

**`manifests.assigned_to_user_id` existe en el esquema y está NULL en todas las filas de QA.** Nada lo escribe. Hoy la pantalla ofrece los manifiestos pendientes del operador, no los de la persona.

**Decisión de producto necesaria antes de implementar:** quién asigna y desde dónde. Tres caminos, y no es tarea de este spec elegir:

- **(a) Nadie asigna; «asignados a ti» se lee como «pendientes de tu operador».** Cero trabajo, pero entonces el título del mock miente en cuanto hay dos cuadrillas.
- **(b) El escritorio asigna** (`5a` tiene la tabla y la selección). Coherente con el flujo de armado de ruta que ya existe ahí.
- **(c) Se deriva del punto de recogida** y de a quién le toca esa zona. Necesita un modelo de zonas por persona que no existe.

Hasta que se decida, la pantalla se queda como está. **Implementar (a) en silencio sería peor que no tocarla**, porque congela una mentira en la UI.

### 2. `5c` — «DESCARGAR» por carga

El mock marca cada carga con `EN RUTA` / `SIGUIENTE` / `DESCARGAR` / `COMPLETADA`. `DESCARGAR` es precarga explícita: bajar el manifiesto al teléfono **antes** de entrar a la bodega sin cobertura.

Es la contraparte honesta de la cola de spec-81: una carga que nunca se descargó no se puede escanear sin red, y el diseño lo dice en la interfaz en vez de fingir lo contrario.

**Depende de spec-81 fase 1** (el almacén). Sin él no hay dónde dejar lo descargado.

### 3. `5c` — el andén en la tarjeta

«Mall Plaza Vespucio — **andén P2**». Hoy la tarjeta muestra el punto de recogida, no el andén.

`dock_zones` existe y Musan tiene dos (`QUIL-001`, `CONSOL`), pero son andenes **del hub**, no del punto de recogida del retailer. El andén de `5c` es el del local donde se retira, y no hay campo para él: `pickup_points.pickup_locations` es un JSONB con `{name, address, comuna}`.

**Es un dato nuevo.** O se añade al JSONB de `pickup_locations`, o se omite la línea. Omitirla es defendible — es el mismo criterio con el que spec-54 dejó fuera la columna VENTANA en vez de inventarla.

---

## Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **1 — Diff visual `5b`/`5c`** | Las dos pantallas contra el mock nuevo, sin datos nuevos | — |
| **2 — `DESCARGAR`** | Precarga por carga | spec-81 fase 1 |
| **3 — Asignación** | «asignados a ti» de verdad | decisión (a)/(b)/(c) |
| **4 — Andén en la tarjeta** | La línea del mock | decisión sobre el dato |

### Fase 1 — Diff visual `[in_progress]`

**Archivos:** `components/pickup/PickupMobileNoRoute.tsx`, `PickupMobileStartRoute.tsx`, `PickupMobileClientGroup.tsx`, `PickupMobileCompactRow.tsx`, `app/app/pickup/route/active/page.tsx`, y sus tests

Lo único que se toca aquí es lo que no necesita datos nuevos: jerarquía, chips de estado (`EN RUTA` / `SIGUIENTE` / `COMPLETADA`), el pie de conteo de `5b`, la cabecera de `5c` con el código de ruta y «Cerrar ruta», y **«Digitalizar manifiesto»**, que ya existe (`useCameraIntake`) y sólo hay que colocar donde el mock lo pone.

- [x] Screenshot diff pantalla a pantalla contra `5b` y `5c` antes de tocar nada; anotar cada diferencia como «visual» o «necesita dato».
- [x] Tests de los componentes tocados primero.
- [x] Implementar sólo lo marcado «visual».
- [x] Lista explícita en este spec de lo aplazado y por qué.

**Diff real hecho contra el mock**, tras recibir el export de Claude Design
(`Recogida.dc.html`, artboards `5b`/`5c` con `data-screen-label`). Ya no es el
diff textual más débil de la ronda anterior — lo de abajo se contrastó línea a
línea contra el HTML real de cada artboard.

**Lo que ya estaba (spec-54/spec-61), confirmado contra el mock real, sin cambios:**
- `5b` — eyebrow del mock es literalmente **"MANIFIESTOS ASIGNADOS A TI · 4"**,
  no "MANIFIESTOS POR RETIRAR". El código dice a propósito "POR RETIRAR" — una
  decisión de la ronda anterior para no mentir mientras la fase 3 (asignación
  real) sigue bloqueada. Confirmado con el mock delante: es la decisión
  correcta, no una laguna del diff — implementar el texto literal del mock
  aquí congelaría la mentira que el spec (línea 37) pide explícitamente evitar.
  Resto de `5b` (agrupación Cliente → Punto → Manifiesto, "N puntos ·
  N paquetes", pie "N manifiestos · N paq. / entran a la ruta") coincide
  exactamente. `PickupMobileStartRoute.tsx`, `PickupMobileClientGroup.tsx` —
  no tocados.
- `5c` — cabecera con `route.code`, agrupación por cliente con ícono de
  expand/collapse (`RouteProgressHeader.tsx`, ya en `route/active/page.tsx`).
  La cabecera real (metrics + barra de progreso) es más rica que la pastilla
  compacta del mock; esa diferencia de densidad de información no es un "diff
  visual" de fase 1 — es una reconstrucción de cabecera fuera de alcance, y no
  se toca.

**Implementado en esta fase, ahora con el mock como evidencia:**
- **Chips `SIGUIENTE` y `COMPLETADA` por carga en `5c`.** Confirmado: **sí van
  en `5c`**, no en `3h` — están presentes en el propio artboard `id="5c"` del
  mock (`data-screen-label="5c Recogidas movil"`), no es una confusión con
  `PickupMobileActiveRoute.tsx`. La ronda anterior tenía razón en no
  inventarlos sin verlos; con el mock delante, la decisión es:
  - `SIGUIENTE` → `NextManifestCard.tsx` (la tarjeta destacada con borde
    `accent`, botón primario). Reutiliza **el mismo chip** ya construido para
    el mismo estado en `PickupMobileNextLoadCard.tsx` (mock 3h) —
    `rounded-full bg-accent-light … text-accent-light-foreground`, texto
    "SIGUIENTE" — en vez de inventar un segundo estilo para la misma
    semántica.
  - `COMPLETADA` → `RouteManifestList.tsx`, por fila, cuando
    `isManifestComplete(m)`. Reutiliza el mismo lenguaje visual que
    `PickupMobileCompactRow.tsx` ya usa para su variante `completed`
    (`status-success-border/bg/text`). Reemplaza el texto plano "Verificación
    completa" que existía antes — el chip transmite lo mismo y es lo que el
    mock muestra.
  - `EN RUTA` **no se implementó** — ver "Aplazado" abajo, es un estado de
    **grupo de cliente**, no de carga, y esta pantalla no agrupa por cliente.
  - `DESCARGAR` **no se implementó** — confirmado en el mock como el mismo
    chip de precarga que describe la fase 2 de este spec (depende de spec-81
    fase 1); no aplica a fase 1.
- **Copy "Cerrar ruta" (no "y entregar").** El mock dice literalmente «Cerrar
  ruta», sin "y entregar". Es una diferencia real, no una paráfrasis del spec
  — corregido en `CloseRouteButton.tsx`. Ningún test afirmaba el texto
  anterior (`CloseRouteButton.test.tsx` y `route/active/page.test.tsx` usan
  `data-testid="close-route-button"`), así que no rompe nada. La navegación
  tras cerrar (`/app/pickup/route/:id/qr`) no cambia — el copy no implicaba
  ese paso, sólo lo nombraba de más.
- **"Digitalizar manifiesto" en `5c`.** (De la ronda anterior, sin cambios.)
  `DigitalizeManifestTrigger.tsx` (botón + diálogo autocontenidos, reutiliza
  `CameraIntake`/`useCameraIntake` íntegros — spec-47), montado en
  `app/app/pickup/route/active/page.tsx`. El mock lo pone en una fila fija al
  pie junto a un botón "Buscar" — ese "Buscar" no existe hoy en esta pantalla
  (sólo en 3h) y añadirlo sería una capacidad nueva, no un diff visual; queda
  fuera de fase 1 con esta razón. Deliberadamente **no** se tocó
  `PickupMobileStartRoute.tsx` (`5b`/3j) — spec-54 ya excluyó a propósito
  "Nuevo Manifiesto" de esa pantalla, con un test de regresión que lo protege.

**Aplazado, con la razón:**
- **Chip `EN RUTA` (grupo de cliente).** En el mock aparece en la cabecera del
  grupo "Falabella" (2 puntos, 2 cargas), un estado **agregado** — no de una
  carga individual, sino "este cliente tiene al menos una carga en curso en
  esta ruta". `route/active/page.tsx` no agrupa manifiestos por cliente hoy:
  `NextManifestCard`/`UpcomingManifestList`/`RouteManifestList` trabajan sobre
  una lista plana de manifiestos. Construir esa agrupación (cliente → puntos →
  cargas, con estado agregado) es la "jerarquía" del checklist llevada más
  lejos que un diff — es la reconstrucción que la intro del spec dice
  explícitamente que esta fase no es. Queda como hueco real, no inventado.
- **Andén / "SIN DESCARGAR" / otras señales de `5c` fuera del texto citado por
  este spec.** Fuera de alcance de fase 1 por diseño (fases 2 y 4).

### Fase 2 — `DESCARGAR` `[pending]`

- [ ] Test: una carga descargada abre `5d` sin red; una no descargada muestra el estado del mock y no deja entrar.
- [ ] Precarga de manifiesto, órdenes y bultos al almacén de spec-81.
- [ ] Chip de estado por carga.

### Fase 3 — Asignación `[blocked]`

Bloqueada por la decisión de producto. Si sale (b), el trabajo cae en `5a` (spec-83), no aquí, y esta fase se reduce a leer `assigned_to_user_id`.

### Fase 4 — Andén `[blocked]`

Bloqueada por la decisión del dato. Si se omite, se cierra esta fase con la razón escrita, como spec-54 hizo con VENTANA.

---

## Riesgos

- **La tentación de implementar (a) para «cerrar» la fase 3.** Congela en la UI una afirmación falsa sobre a quién le toca la carga. Preferible dejar la fase abierta.
- **Screenshot diff sobre datos de QA**: Musan tiene 4 cargas pendientes y 10 órdenes cada una; el mock muestra 12 manifiestos y grupos de varios puntos. Las diferencias de volumen no son diferencias de diseño.
