# Spec-82: Recogida en móvil — manifiestos asignados y recogidas del día (`5b`, `5c`)

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre al que estas pantallas conducen), [spec-81](spec-81-recogida-cola-offline.md) (`DESCARGAR` depende de su almacén), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (escritorio `5a`), [spec-61](spec-61-pickup-route-crew.md) (construyó estas dos pantallas contra el mock `3j`), [spec-64](spec-64-remove-manifest-from-open-route.md) (quitar una carga de una ruta abierta), [spec-54](spec-54-ui-rebrand.md) (mock `1i`, ruta activa)

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-83-recogida-escritorio-datos-faltantes.md

_Date: 2026-09-07_

## Mock de diseño

Este spec valida contra **`docs/design/Recogida.dc.html`, pantallas `5b` y `5c`**. El mock manda
en diseño; este spec manda en comportamiento — si discrepan, se implementa el mock y la
discrepancia se escribe aquí, no se resuelve en silencio.

`5b` y `5c` **ya están implementadas** contra mocks anteriores (`3j` de spec-61, `1i` de
spec-54). Lo que valida este fichero es la ronda nueva: los chips `EN RUTA`/`SIGUIENTE`/
`DESCARGAR`/`COMPLETADA` de `5c`, el «MANIFIESTOS ASIGNADOS A TI · 4» de `5b`, y el andén en la
tarjeta — no es una reconstrucción desde cero.

El 2026-09-08, la fase 1 de este spec se implementó sin este fichero disponible para el
subagente — no tenía la herramienta `DesignSync` — y dejó fuera, con buen criterio, la ubicación
de esos chips por no poder decidirla contra el mock. Cualquier fase pendiente de este spec debe
usar `docs/design/Recogida.dc.html` para resolver eso, y si algo que el código necesita no está
en el mock — un estado vacío, un error de descarga sin red — es un hallazgo para escalar, no una
invención.

Esta referencia caduca con el diseño: si el usuario actualiza los mocks, hay que volver a bajar
el fichero (`docs/design/README.md`) y comprobar que `5b`/`5c` siguen siendo las mismas
pantallas.

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

**Decisión del usuario (2026-09-09).** Ninguno de los tres caminos de arriba: no
es «nadie asigna», no es el escritorio en `5a`, y no es una derivación por zona.
Textual: **«El líder de recogida define la asignación. Al llegar al punto de
retiro recibe los manifiestos, y en ese momento los asigna.»** Ver fase 3.

### 2. `5c` — «DESCARGAR» por carga

El mock marca cada carga con `EN RUTA` / `SIGUIENTE` / `DESCARGAR` / `COMPLETADA`. `DESCARGAR` es precarga explícita: bajar el manifiesto al teléfono **antes** de entrar a la bodega sin cobertura.

Es la contraparte honesta de la cola de spec-81: una carga que nunca se descargó no se puede escanear sin red, y el diseño lo dice en la interfaz en vez de fingir lo contrario.

**Depende de spec-81 fase 1** (el almacén). Sin él no hay dónde dejar lo descargado.

### 3. `5c` — el andén en la tarjeta

«Mall Plaza Vespucio — **andén P2**». Hoy la tarjeta muestra el punto de recogida, no el andén.

`dock_zones` existe y Musan tiene dos (`QUIL-001`, `CONSOL`), pero son andenes **del hub**, no del punto de recogida del retailer. El andén de `5c` es el del local donde se retira.

**Corrección (2026-09-08).** Esto decía que `pickup_points.pickup_locations` es
un JSONB `{name, address, comuna}` y que el andén «es un dato nuevo» de
esquema. Es falso: el contrato real, declarado en
`20260318000004_agent_suite_tables.sql:68-69`, es
`[{name, address, comuna, lat, lng, contact_name, contact_phone,
operating_hours}]` — ya tiene sitio para más que nombre/dirección/comuna, y
`NextManifestCard.tsx:13` ya lee `pickup_locations[].contact_phone`, así que el
repo ya sabe leer campos de ese JSONB más allá de los tres que muestra el
formulario. `{name, address, comuna}` es lo que hoy **escribe**
`PickupPointForm.tsx:19-24` y valida `pickupLocationSchema`
(`api/pickup-points/route.ts:8-14`) — un recorte de formulario, no un límite de
columna. Añadir `dock` es cero migración: campo en `pickupLocationSchema` +
`PickupPointForm.tsx` + la tarjeta. La fase 4 sigue `[blocked]`, pero por la
razón correcta: falta decidir si el alta del punto de recogida captura el
andén, no dónde guardarlo si se decide capturarlo.

---

## Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **1 — Diff visual `5b`/`5c`** | Las dos pantallas contra el mock nuevo, sin datos nuevos | — |
| **2 — `DESCARGAR`** | Precarga por carga | spec-81 fase 1 |
| **3 — Asignación** | «asignados a ti» de verdad | decisión tomada, ver fase 3 |
| **4 — Andén en la tarjeta** | La línea del mock | decisión sobre si se captura, no sobre dónde guardarlo |

### Fase 1 — Diff visual `[done]`

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

> Implementado por: rama `feat/spec-82-fase-1`, SHA `fdc514dc`, PR #682
> (merge `0d1baeee`, 2026-09-08T17:16:39Z).
> Review: dos rondas. La ronda 1 bloqueó porque el spec registraba mal el
> mock — decía que `COMPLETADA` era «por carga» cuando el mock lo pone en la
> cabecera de grupo-cliente (líneas 486-493 del HTML), corregido arriba. La
> ronda 2 verificó las cuatro correcciones aplicándolas el reviewer, y
> comprobó la invalidación contra un `QueryClient` real.
> QA: `gh pr checks 682` verde (Lint/Type-Check/Test/Build en ambos jobs,
> Vercel deploy). Sin migración — no aplica `Verify Production Migrations`.
> `e2e-qa`: no hay reporte post-merge verificado en esta sesión; verificado
> en su lugar con `vitest run --pool=forks` sobre `src/components/pickup` y
> `src/app/app/pickup` (54 archivos, 490 tests, según el PR) y `tsc
> --noEmit`/`eslint` limpios.
> Downstream: revisado spec-83 — sin cambios; spec-83 (escritorio `5a`) no
> comparte ningún componente de `route/active/page.tsx`. Revisado spec-80
> (fase 2, en paralelo) y spec-81 (fase 3, en paralelo) — confirmado sin
> solape de archivos (ver "Coordinación con trabajo paralelo" en el PR).

### Fase 2 — `DESCARGAR` `[in_progress]`

**Decisión técnica (2026-09-09), tomada al implementar — ver corrección de
arriba, esto no era del usuario.**

Nuevo almacén de **lectura** offline, hermano del de salida (`scan_queue`/
`pickup_queue`) que ya vive en `lib/db.ts`: tabla Dexie `manifest_cache`
(`AureonOfflineDB` versión 3, `++id, operatorId, externalLoadId,
[operatorId+externalLoadId]`), una fila por `(operatorId, externalLoadId)`
con el snapshot completo que `5d` necesita para escanear sin red: cabecera
del manifiesto (`id`, `total_packages`, `pickup_route_id`, `retailer_name`,
`pickup_location`) + `orders` (con sus `packages`, igual forma que
`useManifestOrders`) + `downloadedAt`.

**Por qué una tabla nueva y no reusar `pickup_queue`:** `pickup_queue` es
una cola de **salida** (algo por enviar, con `status`/reintentos); esto es
una **caché de lectura** (algo ya recibido, sin reintento — se re-descarga a
mano, no se reintenta solo). Mezclar los dos en la misma tabla habría hecho
que `getPendingPickupCount` (el badge "COLA N") tuviera que aprender a
ignorar filas que no son trabajo pendiente.

**Qué NO se precarga:** documentos/fotos del manifiesto
(`useManifestDocuments`) — `5d` no los necesita para escanear, sólo para
imprimir etiquetas (control aparte, ya oculto sin red porque requiere
`window.print`). No inventar esa precarga sin que el checklist la pida.

**Invalidación:** ninguna automática. `manifest_cache` es una fotografía
tomada al tocar "DESCARGAR"; si el manifiesto cambia en el servidor después
(una orden agregada, un bulto corregido) la fila local queda desactualizada
hasta que alguien vuelva a tocar "DESCARGAR" con señal. Es la misma
honestidad que ya tiene `5d` para el trabajo pendiente: mejor una carga
descargada visiblemente vieja que ninguna carga descargable. Cerrar el
manifiesto (`close_manifest`, ya en la cola de spec-81) no borra la fila —
no hay señal de que limpiar el caché ayude más que dejarlo, y purgarlo son
bytes, no un IndexedDB que se llena solo (ver `checkStorageQuota` en
`lib/db.ts`, que ya barre lo viejo).

**Estado de "descargando" nunca se persiste.** La descarga es una mutación
de React Query (`useDownloadManifest`), no una fila con `status:
'downloading'` en Dexie — así no hay estado de bloqueo que un fallo pueda
dejar congelado para siempre (la regla dura del módulo offline, ver
cabecera de esta tarea). Si la descarga falla a mitad, no queda nada escrito
en `manifest_cache`: el chip `DESCARGAR` sigue ahí, tocar de nuevo reintenta
limpio.

**Tres estados, no dos, para "¿está descargada?":** `unknown` (todavía no se
leyó Dexie — nunca se pinta como "no descargada"), `downloaded`,
`not_downloaded`. El hook que lee `manifest_cache`
(`useDownloadedManifestIds`) envuelve una lectura 100% local en
`useQuery({ networkMode: 'always', … })` — **no** el `networkMode: 'online'`
por defecto de TanStack Query, que pausaría la consulta con el dispositivo
sin red y la dejaría en `data: undefined`/`isLoading: false` aunque IndexedDB
sí tenga la respuesta. Ese es exactamente el error que este mismo spec (fase
1, y la ronda de hoy en spec-81 fase 5) ya cometió dos veces en otros sitios.

**Colisión con `COMPLETADA` (nota de fase 1): gana `COMPLETADA`.** Razón:
`isManifestComplete` lee `verified_count`/`total_packages`, que vienen del
servidor — es el estado autoritativo. `DESCARGAR`/nada-que-mostrar viene de
una tabla local que sólo existe para tolerar la falta de red; si un dato
inconsistente hiciera que ambos predicados fueran ciertos a la vez (una
carga marcada completa en el servidor pero cuya fila local de caché no se
escribió o quedó vieja), mostrar `DESCARGAR` sobre una carga ya verificada
sería peor mentira que ocultar el estado de descarga de una carga que de
todos modos ya no necesita re-descargarse para seguir trabajando: si está
completa, no hay escaneo pendiente que hacer sin red.

**Archivos:**
- `apps/frontend/src/lib/db.ts` — tabla `manifest_cache` (versión 3).
- `apps/frontend/src/lib/offline/manifest-cache.ts` (nuevo) — CRUD puro
  sobre esa tabla, sin DOM/React, mismo patrón que `lib/offline/queue.ts`.
- `apps/frontend/src/lib/offline/manifest-cache.test.ts` (nuevo).
- `apps/frontend/src/hooks/pickup/useManifestDownload.ts` (nuevo) —
  `useDownloadedManifestIds(operatorId)` (lectura, `networkMode: 'always'`)
  y `useDownloadManifest(operatorId)` (mutación: trae manifiesto + órdenes
  de Supabase y llama a `manifest-cache.ts`).
- `apps/frontend/src/hooks/pickup/useManifestDownload.test.ts` (nuevo).
- `apps/frontend/src/components/pickup/RouteManifestList.tsx` — chip
  `DESCARGAR` por fila (botón), con la precedencia de `COMPLETADA` de
  arriba.
- `apps/frontend/src/components/pickup/RouteManifestList.test.tsx`.
- `apps/frontend/src/app/app/pickup/route/active/page.tsx` — conecta los
  hooks nuevos a `RouteManifestList`.
- `apps/frontend/src/app/app/pickup/route/active/page.test.tsx`.
- `apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx` — sin red y
  con un snapshot cacheado, usa el snapshot para la cabecera y las órdenes
  en vez del fetch directo a Supabase; sin red y sin snapshot, bloquea la
  pantalla con el mensaje del estado "no descargada" en vez de dejar
  escanear contra datos que no van a llegar.
- `apps/frontend/src/app/app/pickup/scan/[loadId]/page.test.tsx`.

- [x] Test: una carga descargada abre `5d` sin red; una no descargada muestra el estado del mock y no deja entrar.
- [x] Precarga de manifiesto, órdenes y bultos al almacén nuevo (`manifest_cache`, no el de spec-81 — spec-81 es la cola de SALIDA; ver "Por qué una tabla nueva" arriba).
- [x] Chip de estado por carga, con la precedencia de `COMPLETADA` resuelta arriba.

**Límite honesto, declarado — no descubierto en review.** "Abrir `5d` sin
red" significa que la pantalla RENDERIZA desde el caché: cabecera, punto de
retiro, lista de órdenes/bultos. **Escanear un bulto sin red sigue sin
funcionar** — `useScanMutation` (`hooks/pickup/usePickupScans.ts`) escribe
directo a `pickup_scans` vía Supabase, sin pasar por la cola offline de
spec-81 (`pickup_queue`); el propio código ya lo decía antes de esta fase
("No writer populates `db.pickup_queue` from this screen yet"). Conectar el
escaneo a esa cola es trabajo de spec-81, no de éste — esta fase no lo
inventa ni lo silencia. Mismo límite para `usePickupScans` (lectura de
escaneos ya confirmados): es una query de red con `networkMode` por
defecto; sin señal queda en su `data = []` por defecto, así que el conteo
"verificados" arranca en 0 en cada sesión offline en vez de recordar lo ya
escaneado antes de perder señal. No se precachean escaneos en esta fase —
sólo manifiesto+órdenes+bultos, como dice "Qué NO se precarga" arriba.

### Fase 3 — Asignación `[pending]`

**Decisión del usuario (2026-09-09), textual:** «El líder de recogida define la
asignación. Al llegar al punto de retiro recibe los manifiestos, y en ese
momento los asigna.»

**Consecuencia de diseño, no invención de esta sesión.** La asignación **no es
previa a la ruta** — no se decide en un escritorio antes de salir — sino **in
situ y posterior a la llegada** al punto de retiro. Cualquier pantalla que dé
por hecho que la asignación ya existe cuando la cuadrilla arranca la ruta está
mal planteada.

**Hallazgo: el mock de `5b` supone justo eso.** `5b` es la pantalla de **antes**
de iniciar la ruta — el mock la titula «MANIFIESTOS ASIGNADOS A TI · 4» y deja
elegir cuáles entran a la ruta (pie «2 manifiestos · 67 paq. entran a la
ruta»), es decir, presenta una asignación ya resuelta **antes de llegar a
ningún punto de retiro**. Con la decisión del usuario, esa asignación todavía
no puede existir en ese momento: se hace al llegar y recibir los manifiestos
físicos, no antes de salir. El mock y la decisión de producto están en tensión
y esta sesión no la resuelve — se deja escrita para que el diseño de `5b` (o
una pantalla nueva de asignación en el punto de retiro) se revise contra esto
antes de implementar.

Lo que sí queda claro sin inventar nada más: `manifests.assigned_to_user_id`
(hoy NULL en todas las filas de QA, según el diagnóstico de arriba) se escribe
por el líder de la cuadrilla, en el móvil, en el momento de llegada al punto de
retiro — no desde `5a` (spec-83) ni por derivación de zona. El camino (b) del
listado original queda descartado por esta decisión.

**Archivos:** (indeterminado — la decisión resuelve *quién* y *cuándo* asigna,
no *dónde* en la interfaz ocurre esa asignación. Falta una pantalla o
interacción de asignación in-situ que hoy no existe en ningún mock revisado por
este spec — `5b` no la muestra, muestra el resultado de una asignación previa
que la decisión del usuario contradice. Nombrar componentes antes de que exista
ese diseño sería inventarlo. `check-phase-overlap.mjs` la reporta como «no
puedo juzgar» (exit 3), correctamente.)

- [ ] Resolver la tensión con el mock `5b` (arriba) antes de tocar código:
      ¿nueva pantalla de asignación al llegar al punto de retiro, o `5b` se
      redefine como esa pantalla?
- [ ] Escribir en `manifests.assigned_to_user_id` desde esa interacción.
- [ ] `5b` (o la pantalla que resulte) lee `assigned_to_user_id` en vez de
      "pendientes del operador".

### Fase 4 — Andén `[parked]`

**Decisión del usuario (2026-09-09), textual:** «No es necesario, déjalo así
por el momento.»

El alta de punto de recogida **no** captura el andén. No hay coste técnico en
ninguna de las dos opciones — el JSONB `pickup_locations` ya admitiría el campo
sin migración, ver corrección de arriba —, así que esto no se cerró por
dificultad técnica: se decidió que la cuadrilla pregunta el andén al llegar, en
vez de que quede escrito de antemano en el punto de recogida. Mismo cierre que
spec-54 hizo con VENTANA (`docs/specs/spec-54-ui-rebrand.md`, `1i` — un dato
real que el mock quiere y el negocio decide no capturar).

---

## Riesgos

- **La tentación de implementar la fase 3 leyendo `5b` tal cual, sin resolver la
  tensión con la decisión del usuario.** `5b` presenta la asignación como
  resuelta antes de salir; la decisión dice que se hace al llegar. Construir
  contra el mock literal congelaría en la UI una secuencia que el negocio
  acaba de decir que no es así.
- **Screenshot diff sobre datos de QA**: Musan tiene 4 cargas pendientes y 10 órdenes cada una; el mock muestra 12 manifiestos y grupos de varios puntos. Las diferencias de volumen no son diferencias de diseño.
