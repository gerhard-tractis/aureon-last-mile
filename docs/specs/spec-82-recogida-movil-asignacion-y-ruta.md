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
- `5c` — cabecera con `route.code` (`RouteProgressHeader.tsx`, ya en
  `route/active/page.tsx`). **Corrección tras revisión adversarial:** este
  párrafo afirmaba que la cabecera ya agrupaba por cliente con un ícono de
  expand/collapse. Es falso — `RouteProgressHeader.tsx` no tiene
  `retailer_name`, ni chevron, ni nada colapsable; renderiza `route.code` +
  fecha/patente + `StackedProgress` + tres métricas (VERIFICADOS / RESTAN /
  MANIFIESTOS), todo sobre una lista plana de manifiestos. La propia sección
  "Aplazado" de esta fase, cuatro párrafos más abajo, ya decía lo correcto
  (que la agrupación no existe); este párrafo se contradecía con ella y
  quien lo leyera primero se llevaba la versión falsa. La agrupación por
  cliente **no existe** en ningún componente de `5c` hoy — es trabajo de
  fase 4, no algo "ya construido, sin cambios". La cabecera real (metrics +
  barra de progreso) es más rica que la pastilla compacta del mock; esa
  diferencia de densidad de información no es un "diff visual" de fase 1 —
  es una reconstrucción de cabecera fuera de alcance, y no se toca.

**Implementado en esta fase, ahora con el mock como evidencia:**
- **Chip `SIGUIENTE` por carga en `5c`.** Confirmado: **sí va en `5c`**, no en
  `3h` — está presente en el propio artboard `id="5c"` del mock
  (`data-screen-label="5c Recogidas movil"`), no es una confusión con
  `PickupMobileActiveRoute.tsx`. La ronda anterior tenía razón en no
  inventarlo sin verlo; con el mock delante, la decisión es:
  `NextManifestCard.tsx` (la tarjeta destacada con borde `accent`, botón
  primario). Reutiliza **el mismo chip** ya construido para el mismo estado
  en `PickupMobileNextLoadCard.tsx` (mock 3h) — `rounded-full bg-accent-light
  … text-accent-light-foreground`, texto "SIGUIENTE" — en vez de inventar un
  segundo estilo para la misma semántica.
- **`COMPLETADA` — divergencia deliberada declarada, no lo que decía la
  primera versión de este párrafo.** Esta fase implementó `COMPLETADA` en
  `RouteManifestList.tsx`, por fila, cuando `isManifestComplete(m)`. La
  versión anterior de este párrafo afirmaba que eso era "el chip `COMPLETADA`
  por carga en `5c`", como si el mock lo pusiera ahí. **Es falso — revisión
  adversarial lo encontró.** En el mock, `COMPLETADA` está en la **cabecera
  del grupo-cliente** de Sodimac (`padding:6px 11px;border-radius:13px;
  background:var(--raised);border:1px solid var(--border)`, línea 486-493 del
  HTML) — el mismo contenedor que lleva `EN RUTA` en la cabecera de
  Falabella, con una línea secundaria de métrica de grupo ("1 punto ·
  cerrada 07:31"). Las filas de carga individuales (`CARGA-99817`,
  `CARGA-99820`, `margin-left:22px`) llevan `DESCARGAR`, nunca `COMPLETADA`.
  El mismo argumento con el que se aplaza `EN RUTA` más abajo — "es un estado
  de grupo-cliente, y esta pantalla no agrupa" — aplica idéntico a
  `COMPLETADA`.

  Dicho eso: **degradar `COMPLETADA` a la fila no se deshace.** `RouteManifestList`
  no agrupa por cliente hoy (ver la corrección de más arriba sobre
  `RouteProgressHeader`), así que no hay contenedor de grupo donde ponerlo
  con la semántica real del mock. `isManifestComplete(m)` es una señal
  honesta por manifiesto — "esta carga concreta está totalmente verificada"
  — y reemplaza limpiamente el texto plano "Verificación completa" que
  existía antes. Es una decisión defendible por el mismo motivo que otras
  fases han tomado divergencias similares. Lo que estaba mal no era la
  implementación, era **no decir** que era una divergencia.

  **Colisión futura anotada:** la fase 2 de este mismo spec pone `DESCARGAR`
  en el slot de fila (`CARGA-99817`/`CARGA-99820` en el mock) que hoy no
  lleva ningún chip en `RouteManifestList`. Quien implemente fase 2 leyendo
  este spec tiene que decidir la interacción entre `DESCARGAR` (fila, estado
  de precarga) y `COMPLETADA` (fila, estado de verificación) — son
  mutuamente excluyentes en el tiempo (una carga completada ya fue
  descargada y escaneada) pero comparten el mismo slot visual, y este spec
  no dice qué chip gana si ambos predicados aplicaran a la vez por un dato
  inconsistente.
- `EN RUTA` **no se implementó** — ver "Aplazado" abajo, es un estado de
  **grupo de cliente**, no de carga, y esta pantalla no agrupa por cliente.
- `DESCARGAR` **no se implementó** — confirmado en el mock como el mismo
  chip de precarga que describe la fase 2 de este spec (depende de spec-81
  fase 1); no aplica a fase 1.
- **Copy "Cerrar ruta" (no "y entregar").** El mock dice literalmente «Cerrar
  ruta», sin "y entregar". Es una diferencia real, no una paráfrasis del spec
  — corregido en `CloseRouteButton.tsx`. La ronda anterior no dejó ningún
  test que fijara el copy antiguo (`CloseRouteButton.test.tsx` y
  `route/active/page.test.tsx` usaban sólo `data-testid="close-route-button"`,
  así que la mutación "Cerrar ruta" → "Cerrar ruta y entregar" pasaba en
  verde en los cuatro ficheros que la tocan). Corregido en esta revisión:
  `CloseRouteButton.test.tsx` ahora tiene
  `getByRole('button', { name: 'Cerrar ruta' })`, mutation-testeado contra
  el texto viejo. La navegación tras cerrar (`/app/pickup/route/:id/qr`) no
  cambia — el copy no implicaba ese paso, sólo lo nombraba de más.
  `docs/specs/spec-47-pickup-route-and-consolidated-reception.md` seguía
  documentando el copy viejo en su diagrama de flujo; corregido también.
- **"Digitalizar manifiesto" en `5c`.** `DigitalizeManifestTrigger.tsx`
  (botón + diálogo autocontenidos, reutiliza `CameraIntake`/`useCameraIntake`
  íntegros — spec-47), montado en `app/app/pickup/route/active/page.tsx`. El
  mock lo pone en una fila fija al pie junto a un botón "Buscar" (línea
  497-503 del HTML). **Corrección tras revisión adversarial:** la razón
  escrita aquí para dejar el botón inline en vez de en esa fila fija era «ese
  "Buscar" no existe hoy y añadirlo sería una capacidad nueva» — es un *non
  sequitur*: la barra fija al pie de `5c` **ya existe** en
  `app/app/pickup/route/active/page.tsx:251` (es donde vive hoy el botón
  "Cancelar ruta", ver nota más abajo) y poner "Digitalizar manifiesto" ahí
  no exige implementar "Buscar" — son dos controles independientes en la
  misma fila. La razón real por la que este spec no movió el botón a esa
  barra: mover un control existente entre dos posiciones dentro de la misma
  pantalla es un cambio de layout, no un "no tocar" — y esta fase decidió
  minimizar el diff sobre `page.tsx` en vez de perseguir la posición exacta
  del mock para un control que, dondequiera que esté, ya es funcional y
  visible. Queda **abierta**: si una fase futura toca la barra fija (ver la
  nota de "Cancelar ruta" abajo), debe decidir también dónde va
  "Digitalizar manifiesto" contra el mock real. Deliberadamente **no** se
  tocó `PickupMobileStartRoute.tsx` (`5b`/3j) — spec-54 ya excluyó a
  propósito "Nuevo Manifiesto" de esa pantalla, con un test de regresión que
  lo protege.

**Aplazado, con la razón:**
- **Chip `EN RUTA` (grupo de cliente).** En el mock aparece en la cabecera del
  grupo "Falabella" (2 puntos, 2 cargas), un estado **agregado** — no de una
  carga individual. `route/active/page.tsx` no agrupa manifiestos por
  cliente hoy: `NextManifestCard`/`UpcomingManifestList`/`RouteManifestList`
  trabajan sobre una lista plana de manifiestos. Construir esa agrupación
  (cliente → puntos → cargas, con estado agregado) es la "jerarquía" del
  checklist llevada más lejos que un diff — es la reconstrucción que la
  intro del spec dice explícitamente que esta fase no es. Queda como hueco
  real, no inventado.

  **Corrección de la razón, tras revisión adversarial.** La primera versión
  de este párrafo aplazaba `EN RUTA` porque agrupar sería "caro" —
  construir la jerarquía cliente → puntos → cargas. Es cierto que agrupar es
  trabajo, pero **no es la razón real**: agrupar por `retailer_name` (campo
  que ya viaja en `RouteManifestRow`) es un `groupBy` barato, no una
  reconstrucción cara. La razón real, verificada leyendo las cuatro
  cabeceras de grupo del mock una junto a otra: **la semántica del chip de
  grupo es indeterminable sin inventarla.** Falabella lleva `EN RUTA`,
  Ripley (línea 461-467 del HTML, mismo contenedor) no lleva **ningún**
  chip, Paris lleva un botón "Ver carga", y Sodimac lleva `COMPLETADA`.
  Cuatro grupos, cuatro cosas distintas en el mismo slot visual, y Ripley
  está tan "en la ruta" como Falabella — ambos tienen cargas activas sin
  completar. No hay un predicado derivable de los datos que reconstruya esa
  distinción sin inventar una regla que el mock no declara (¿por qué
  Falabella sí y Ripley no?). Implementar `EN RUTA` hoy sería adivinar esa
  regla, no leerla.
- **Andén / "SIN DESCARGAR" / otras señales de `5c` fuera del texto citado por
  este spec.** Fuera de alcance de fase 1 por diseño (fases 2 y 4).
- **`Cancelar ruta`.** El botón que `page.tsx:264` pone en la barra fija,
  bajo `Cerrar ruta`, **no tiene contraparte en el mock.** `5c` no muestra
  ningún control de cancelación — sólo `Cerrar ruta` en la cabecera fija
  superior (línea 424 del HTML) y `Buscar` + `Digitalizar manifiesto` en la
  fila fija del pie (línea 497-503). Esto no es un hallazgo que bloquee esta
  fase — `Cancelar ruta` es una capacidad real con su propia razón de ser
  (spec-61 Task 5, la salida para una ruta que no debió abrirse) y no se
  toca aquí. Se deja anotado porque cualquier decisión futura sobre la barra
  inferior de `5c` (mover `Digitalizar manifiesto` a ella, por ejemplo — ver
  la nota de arriba) tiene que decidir también qué hacer con `Cancelar
  ruta`, que hoy vive ahí sin que el mock lo prevea.

### Fase 2 — `DESCARGAR` `[pending]`

- [ ] Test: una carga descargada abre `5d` sin red; una no descargada muestra el estado del mock y no deja entrar.
- [ ] Precarga de manifiesto, órdenes y bultos al almacén de spec-81.
- [ ] Chip de estado por carga. **Ver la nota "Colisión futura anotada" en
      la sección "Implementado en esta fase" de Fase 1 (arriba, bajo
      `COMPLETADA`)**: `RouteManifestList` ya usa ese mismo slot de fila
      para el chip `COMPLETADA` (`isManifestComplete(m)`); decidir aquí qué
      chip gana si ambos predicados aplicaran a la vez por un dato
      inconsistente, antes de renderizar `DESCARGAR` ahí.

### Fase 3 — Asignación `[blocked]`

Bloqueada por la decisión de producto. Si sale (b), el trabajo cae en `5a` (spec-83), no aquí, y esta fase se reduce a leer `assigned_to_user_id`.

### Fase 4 — Andén `[blocked]`

Bloqueada por la decisión del dato. Si se omite, se cierra esta fase con la razón escrita, como spec-54 hizo con VENTANA.

---

## Riesgos

- **La tentación de implementar (a) para «cerrar» la fase 3.** Congela en la UI una afirmación falsa sobre a quién le toca la carga. Preferible dejar la fase abierta.
- **Screenshot diff sobre datos de QA**: Musan tiene 4 cargas pendientes y 10 órdenes cada una; el mock muestra 12 manifiestos y grupos de varios puntos. Las diferencias de volumen no son diferencias de diseño.
