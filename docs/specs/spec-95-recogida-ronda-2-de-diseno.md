# spec-95 — Recogida: la ronda 2 del mock, y el chip que por fin tiene regla

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-94-recogida-cuatro-estados.md, spec-82-recogida-movil-asignacion-y-ruta.md, spec-83-recogida-escritorio-datos-faltantes.md

## Qué es esto

El 2026-09-10 se recorrió Recogida en QA con `admin@musan.com` contra los nueve
artboards de `docs/design/Recogida.dc.html` y se escribió
`docs/design/mock-feedback-recogida.md`: lo que la implementación había aprendido
y el mock todavía no sabía. El diseñador respondió con una ronda nueva — subió
ese documento al propio proyecto de Claude Design (`uploads/mock-feedback-recogida.md`)
y devolvió **diez** artboards: `5a`–`5i` más `5f2`, nuevo.

Este spec implementa esa ronda. No es un diff visual más: seis de los puntos que
cierra estaban declarados como divergencias **abiertas** en specs anteriores, y
uno de ellos estaba declarado como **imposible de implementar** tal y como estaba
dibujado.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| `docs/design/Recogida.dc.html`, artboards `5a`–`5i` y `5f2` | **Canónico.** Geometría, jerarquía y copy |
| `docs/design/mock-feedback-recogida.md` | Qué pidió esta ronda y por qué |
| `docs/design/README.md` | La regla de desempate y cómo se refresca la copia |

Sigue vigente: **el mock manda en diseño, el spec manda en comportamiento.** Si
discrepan, se implementa el mock y la discrepancia se escribe aquí.

## Lo que esta ronda desbloquea

**El chip de grupo de `5c` ya tiene regla.** `spec-82` fase 1 lo declaró
indeterminable, y con razón: en el mock viejo, Falabella llevaba `EN RUTA`,
Ripley **nada**, Paris un botón «Ver carga» y Sodimac `COMPLETADA` — cuatro cosas
distintas en el mismo slot, con Ripley tan «en ruta» como Falabella. No había
predicado derivable de los datos.

La ronda 2 lo resuelve por diseño: **regla única `PENDIENTE` / `EN RUTA` /
`COMPLETADA` en todos los grupos**, y desaparece el botón «Ver carga». Ripley pasa
a `EN RUTA`, Paris a `PENDIENTE`. Eso ya es un predicado, y por eso la fase 1 de
este spec puede tomarse sin ninguna decisión de producto pendiente.

**El pie de `5c` ya acomoda `Cancelar ruta`.** `spec-82` fase 1 anotó que ese
botón «no tiene contraparte en el mock» y que cualquier decisión futura sobre esa
barra tendría que resolverlo. La ronda 2 dibuja un pie de **dos filas** que lo
incluye.

## Lo que sigue aparcado, y no se toca aquí

- **Barra de ocupación estimada** (`5a`). Sigue dibujada en el mock y sigue
  `[parked]` en `spec-83` fase 3 por decisión del usuario (2026-09-09): «No hay
  capacity para esto ahora». El mock la conserva a propósito; este spec **no** la
  implementa.
- **Andén en la tarjeta de `5c`.** `spec-82` fase 4 sigue abierta, y la pregunta
  no es dónde guardarlo sino si el alta del punto de recogida lo captura.
- **Asignación real** («MANIFIESTOS ASIGNADOS A TI»). La ronda 2 acepta el texto
  actual «MANIFIESTOS POR RETIRAR», así que `spec-82` fase 3 deja de bloquear
  nada visual.
- **Distancia y ETA en el panel de mapa de `5c`** («4,2 km · 11 min»). Decisión
  del usuario, 2026-09-10: se implementa dirección y navegación, y la cifra queda
  aparcada. Ver fase 3.

## Orden respecto a trabajo que ya existe

Dos colisiones reales, las dos decididas por el usuario el 2026-09-10:

1. **`5a` va después de `spec-94` fase 1.** El `5a` nuevo añade una séptima
   columna `ETIQUETAS` con acción Imprimir por fila; `spec-94` fase 1 reescribe
   las cuatro RPC de escritorio y dice explícitamente que re-templa esa misma
   columna de `spec-53` junto a `missing_count` y `signature_operator`. Quien
   fuera segundo reescribiría al primero. Queda expresado en el
   `**Depende de:**` de la fase 8.
2. **`5d` va después del fix de ancho móvil.** PR #772
   (`fix/recogida-escaneo-viewport-movil`) toca `scan/[loadId]/page.tsx`,
   `PackageRow.tsx` y `ManifestNotDownloadedNotice.tsx` — los tres ficheros de la
   fase 5 — y arregla que la pantalla se maquetaba a 672px sobre un teléfono de
   375px. Se abrió precisamente para que la fase 5 se construya encima y no lo
   pierda. **Al escribir esta línea (2026-09-10) el PR seguía abierto con CI en
   curso** — quien tome la fase 5 lo comprueba con `gh pr view 772 --json
   state,mergedAt` antes de empezar, y si no está mergeado, no empieza.

---

## Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **1 — `5c` chip único y agrupación** | La regla `PENDIENTE`/`EN RUTA`/`COMPLETADA` por grupo de cliente | — |
| **2 — `5c` cabecera y pie** | Tarjeta de estado de ruta y pie de dos filas | fase 1 |
| **3 — `5c` panel de mapa** | Dirección real + «Abrir navegación»; la cifra aparcada | fase 2 |
| **4 — `5b` cuadrilla y vehículo** | `ACOMPAÑANTES` con rol y contador, selector con ícono | — |
| **5 — `5d` escaneo** | Cabecera, campo siempre enfocado, lista de órdenes, y los cuatro textos en inglés | — |
| **6 — `5f` firma** | Cabecera, rejilla de cuatro cifras, aviso, firma opt-in | — |
| **7 — `5f2` diálogo** | La confirmación irreversible como hoja inferior | fase 6 |
| **8 — `5a` escritorio** | Buscador, `ETIQUETAS`, panel de vehículo, «Cargar más» | spec-94 fase 1 |
| **9 — `5g` flash** | El botón que el mock ya dibujaba y la app no tiene | — |

> **Trampa al invocar `check-phase-overlap.mjs` sobre este spec.** El `faseMatch`
> del target se compara como **subcadena** contra la línea del heading
> (`check-phase-overlap-parse.mjs:57`), y aquí casi todos los headings llevan el
> id de un artboard: `5a`, `5c`, `5f2`… Así que `…#5` **no** resuelve a la fase 5,
> resuelve a la **fase 1**, cuyo heading contiene `` `5c` ``. Se comprobó el
> 2026-09-10: `#1` y `#5` devolvían la misma superficie y el guard reportaba un
> conflicto duro inexistente entre ambas. Hay que pasar **`#Fase 5`**, no `#5`.
> Con el selector correcto: las fases 1, 4, 5, 6 y 9 salen despachables en
> paralelo, sin conflicto duro.

### Fase 1 — `5c` chip único y agrupación por cliente `[in_progress]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/pickup/RouteManifestList.tsx`, `apps/frontend/src/components/pickup/RouteManifestCard.tsx`, `apps/frontend/src/lib/pickup/routeManifestGrouping.ts`, y sus tests

Hoy `route/active/page.tsx` trabaja sobre una **lista plana** de manifiestos:
`NextManifestCard` / `UpcomingManifestList` / `RouteManifestList` no agrupan por
cliente. `spec-82` fase 1 verificó que agrupar por `retailer_name` es barato — el
campo ya viaja en `RouteManifestRow` — y que lo caro era la semántica, no el
`groupBy`. La semántica ya está.

- [ ] Agrupar por `retailer_name`, con la cabecera del mock: nombre, `N puntos · M paquetes`.
- [ ] Chip por grupo con la regla única. Definir el predicado **en un solo sitio** y testearlo como unidad, no repartido por el render:
  - `COMPLETADA` — todas las cargas del grupo cerradas.
  - `EN RUTA` — alguna carga con escaneo empezado (`verified_count > 0`) **y esa misma carga sin cerrar**.
  - `PENDIENTE` — el resto, incluido el grupo vacío y el caso en que la única carga con escaneos ya cerró.
- [ ] Que desaparezca el botón «Ver carga» del slot de cabecera de grupo.
- [ ] TDD: el predicado primero, con un caso por rama y uno de frontera (grupo vacío).

> **Regla A, «por progreso» — decisión del usuario/diseñador, 2026-09-11.**
> La primera redacción de esta fase pedía, para `EN RUTA`, «alguna carga con
> escaneo empezado **y ninguna pendiente de descarga**». Era una lectura
> equivocada de este spec, no del mock: al implementarla, el diff contra `5c`
> daba `PENDIENTE` en **Falabella y Ripley**, donde el mock dibuja `EN RUTA`.
>
> Al revisarlo con el mock delante apareció que **el mock era el inconsistente**.
> El diseñador lo confirmó, textual: «hoy el mock quedó inconsistente. Apliqué
> "sin cerrar = EN RUTA" y por eso Ripley lo lleva, pero entonces Paris también
> debería llevarlo — los cuatro grupos están igual de dentro de la ruta activa.»
>
> De las dos reglas candidatas, ambas derivables de los datos, se eligió la de
> progreso sobre la de siguiente parada **porque no duplica información**: un
> chip `SIGUIENTE` a nivel de grupo repetiría la pastilla `SIGUIENTE` que ya
> lleva la tarjeta destacada, y el operario ya ve ahí su próxima parada.
>
> **La descarga pendiente no entra en el predicado.** Es ortogonal al progreso y
> se sigue resolviendo por manifiesto con el chip `DESCARGAR` de `spec-82`
> fase 2, que esta fase no toca.
>
> **Pendiente aguas arriba:** bajo la regla A, Ripley es `PENDIENTE`. El
> artboard `5c` todavía lo dibuja `EN RUTA`. Hasta que se rebaje otra vez el
> mock, esa celda discrepa **a propósito** — no es un hallazgo nuevo y no hay
> que volver a reportarlo.

> **Desviaciones de alcance, declaradas.** (1) `RouteManifestCard.tsx` es nuevo:
> agregar la agrupación empujó `RouteManifestList.tsx` por encima de las 300
> líneas y la regla no es negociable, así que la tarjeta por manifiesto se
> extrajo. **La extracción NO fue neutra** —la primera redacción de esta línea
> decía «sin cambio de comportamiento» y era falsa contra el diff, lo encontró el
> review—: el título de la fila pasó de `retailer_name` a `pickup_location`,
> deliberadamente, porque el retailer ahora vive en la cabecera de grupo y
> repetirlo en cada fila era ruido. Para no perder información cuando
> `pickup_location` es null (frecuente: «Null when not captured at intake») el
> título cae a `pickup_location || retailer_name || 'Sin punto de recogida'`.
> Un tercer fichero, `lib/pickup/routeManifestGrouping.ts`, saca la agrupación
> pura del componente siguiendo la capa que `pickupStartRouteGrouping.ts` ya usa
> para `3j`. Líneas finales: 251 / 187 / 75. (2) **No se tocó
> `PickupMobileClientGroup.tsx`**, pese a estar en el `**Archivos:**` original:
> pertenece a la pantalla `3j` (selección pre-ruta, modelo
> `StartRouteClientGroup`/`ManifestRow`), una superficie de datos distinta de la
> de `5c` (`RouteManifestRow`); reutilizarlo habría mezclado dos modos
> —selección y progreso— en un componente ya ajustado a su pantalla.
> (3) `route/active/page.tsx` tampoco necesitó cambios: sigue pasando el mismo
> contrato a `RouteManifestList`.

> **Divergencias con `5c` declaradas, no arregladas aquí.** Las encontró el
> review comparando artboard y código lado a lado:
>
> 1. **La cabecera de grupo del mock lleva un control de plegado** (chevron abajo
>    en `EN RUTA`, a la derecha en `PENDIENTE`/`COMPLETADA`) y los grupos que no
>    están en ruta se dibujan **plegados**. La implementación no pinta chevron y
>    expande siempre. Plegar es comportamiento nuevo, no un ajuste visual — va a
>    su propia fase o a la fase 2, que ya toca esta pantalla.
> 2. **El subtítulo del grupo cerrado no es «M paquetes»**: Sodimac dice
>    `1 punto · cerrada 07:31`. Aquí la desviación es **del spec**, cuyo criterio
>    pedía `N puntos · M paquetes` para los cuatro casos por igual.
> 3. Efecto de (1): en un grupo de un solo manifiesto cerrado se pintan **dos
>    chips `COMPLETADA`** (fila + cabecera). En el mock no ocurre porque el grupo
>    está plegado. Un test congela hoy ese duplicado — si se implementa (1), hay
>    que revisarlo.

### Fase 2 — `5c` cabecera de ruta y pie de dos filas `[pending]`

**Depende de:** spec-95 fase 1

**Archivos:** `apps/frontend/src/app/app/pickup/route/active/page.tsx`, `apps/frontend/src/components/pickup/RouteProgressHeader.tsx`, `apps/frontend/src/components/pickup/CancelRouteButton.tsx`, `apps/frontend/src/components/pickup/CloseRouteButton.tsx`, y sus tests

La cabecera que ya existe **se conserva**: `spec-82` fase 1 la declaró «más rica
que la pastilla compacta del mock», y la ronda 2 le da la razón — el mock nuevo
dibuja exactamente eso (código de ruta, `12/28`, barra y las tres cifras
`VERIFICADOS` / `RESTAN` / `MANIFIESTOS`). Esta fase la alinea, no la reescribe.

- [ ] Cabecera al layout del mock, sin perder ningún dato de los que ya muestra.
- [ ] Pie de **dos filas**: arriba `Buscar`, `Ver manifiesto`, `Digitalizar`, `+`; abajo `Cerrar ruta` (primario) y `Cancelar ruta`.
- [ ] `Digitalizar manifiesto` pasa del inline a la fila fija — el punto que `spec-82` fase 1 dejó **abierto** por minimizar el diff, y que esta fase cierra por tocar la barra igualmente.
- [ ] `Cancelar ruta` conserva su comportamiento de `spec-61` Task 5 intacto; sólo cambia de sitio.

### Fase 3 — `5c` panel de mapa `[pending]`

**Depende de:** spec-95 fase 2

**Archivos:** `apps/frontend/src/components/pickup/RouteMapPlaceholder.tsx`, `apps/frontend/src/app/app/pickup/route/active/page.tsx`, y sus tests

El mock cuelga el panel de la carga siguiente y muestra dirección, distancia y
ETA. **Sólo se implementan dirección y navegación.**

- [ ] Dirección real del punto de recogida desde `pickup_locations` (el JSONB ya trae `address`, y `NextManifestCard.tsx:13` ya demuestra que se leen campos suyos más allá de los tres del formulario).
- [ ] Botón «Abrir navegación» con la posición del punto.
- [ ] **No se pinta ninguna distancia ni ETA.** Queda declarado aquí, no inventado.

> **Decisión del usuario (2026-09-10), textual en la pregunta que la originó:**
> sólo dirección y navegación; «4,2 km · 11 min» queda aparcado con su razón,
> igual que la barra de ocupación. El cálculo por arco conducido está diferido a
> un spec de routing futuro; una distancia en línea recta tampoco sirve, porque
> no es lo que conduce el operario y el mock no dice cuál de las dos dibuja.

### Fase 4 — `5b` cuadrilla y selector de vehículo `[in_progress]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/pickup/CrewSelect.tsx`, `apps/frontend/src/components/pickup/VehicleSelect.tsx`, `apps/frontend/src/components/pickup/PickupMobileStartRoute.tsx`, `apps/frontend/src/hooks/pickup/useCrewCandidates.ts`, y sus tests

El bloque `ACOMPAÑANTES` ya existe (`spec-61`) — era lo que el mock viejo no
dibujaba. La ronda 2 lo incorpora y le añade dos cosas que hoy no tiene.

- [ ] Contador `N de M` en la cabecera del bloque, en vez de `· 0`.
- [ ] **Rol por persona** a la derecha de cada fila (`auxiliar`, `conductor`).
- [ ] Selector de vehículo con ícono de camión y chevron, conservando el placeholder «Patente» y **sin preselección** — el mock de esta ronda ya no muestra una patente elegida.
- [ ] No se toca el título ni el eyebrow: la ronda 2 acepta «Recogidas de hoy» y «MANIFIESTOS POR RETIRAR» tal cual están.

> **El rol sí estaba en los datos.** `useCrewCandidates.ts` ya declaraba
> `role` y lo seleccionaba de `users` — se verificó antes de implementar, no
> hubo que parar.
>
> **Tres roles, dos palabras — es una lectura, no una cita.** El mock rotula
> `auxiliar` / `conductor`, pero `useCrewCandidates` trae **tres** roles. El
> mapa es `pickup_crew → auxiliar` y `pickup_leader`/`ops_leader → conductor`,
> y lo que lo justifica es `ROUTE_LEADER_ROLES` (`permissions.ts:98-103`): esos
> dos pueden abrir ruta y `pickup_crew` no. **No** lo justifica
> `ROLE_DEFAULT_PERMISSIONS`, donde `pickup_leader` es idéntico a `pickup_crew`
> — el comentario original citaba ese artefacto y era falso; lo encontró el
> review. Si el diseñador quiere una tercera palabra para `ops_leader`, es
> decisión suya y el mock no la distingue hoy.
>
> **La costura está cerrada por tipos, no por vigilancia.** `CREW_ROLES` vive
> una sola vez, alimenta el `.in(...)` de la consulta y tipa
> `CrewCandidate.role`; las etiquetas son un `Record<CrewRole, string>`
> exhaustivo. Verificado: añadir `'warehouse_staff'` a la lista **rompe la
> compilación** (`TS2741`) hasta que alguien decida su palabra — en vez de
> rotularlo «conductor» en silencio, que es lo que hacía el `else` atrapa-todo.

### Fase 5 — `5d` escaneo, y los cuatro textos en inglés `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx`, `apps/frontend/src/components/pickup/ScanHistoryList.tsx`, `apps/frontend/src/components/pickup/ScannerInput.tsx`, `apps/frontend/src/components/pickup/ManifestDetailList.tsx`, `apps/frontend/src/components/pickup/PackageRow.tsx`, y sus tests

La ronda 2 **adopta** lo que la app ya tenía y el mock viejo no dibujaba: miga de
pan, temporizador de sesión, «Imprimir etiquetas» y la lista de órdenes y bultos.
Así que esta fase es sobre todo de orden y de copy.

- [ ] Cabecera al layout del mock: miga de pan, temporizador e «Imprimir etiquetas».
- [ ] **Campo de escaneo siempre enfocado** donde el mock viejo ponía «Escanear siguiente». El mock nuevo ya lo dibuja así: el lector de QA es una pistola que teclea el código y **no manda Enter** (`ScanField`/`useScannerAutoSubmit`), así que un botón de «escanear» nunca fue el gesto real.
- [ ] Lista de órdenes y bultos con `n/m` y acción por bulto, **sobre** el historial, per mock.
- [ ] Pie de un solo «Continuar a revisión» más la entrada manual de código.
- [ ] **Los cuatro textos en inglés**, que viven en estos mismos ficheros y por eso entran aquí y no en una fase suya:
  - `ScanHistoryList.tsx:43` — `'No scans yet'`
  - `ScannerInput.tsx:83` — `placeholder="Scan barcode..."`
  - `ManifestDetailList.tsx:54` — `Orders & Packages`, y `:57` — `{n}/{m} verified`
  - `PackageRow.tsx:150` — `Mark Verified`

> **Orden:** esta fase se construye **encima** de PR #772, que arregla el ancho
> de esta misma pantalla (672px sobre un teléfono de 375px) en tres de estos
> cinco ficheros. No se revierte ninguno de sus `w-full` ni el `flex-wrap` de
> `PackageRow` — son load-bearing y están comentados como tal en el código.

### Fase 6 — `5f` firma y finalización `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/app/app/pickup/complete/[loadId]/page.tsx`, y sus tests

La ronda 2 **adopta** las tres cosas que la app tenía y el mock no dibujaba: la
rejilla de cifras, el aviso legal y la firma del cliente opt-in.

- [ ] Cabecera `Firma y finalización` con `CARGA-… · <cliente>` debajo.
- [ ] Rejilla de cuatro cifras, con **`FALTANTES (CON NOTA)` en dos líneas** — el mock lo dibuja así precisamente porque en una sola se cortaba, que es el defecto que el recorrido de QA encontró.
- [ ] `DURACIÓN` con el valor real; hoy pinta `—`.
- [ ] Tarjeta de aviso de transferencia de custodia, con el copy del mock.
- [ ] Casilla «Agregar firma del cliente» con la etiqueta `opcional` a la derecha.
- [ ] `TU FIRMA` sin campo de nombre, como ya está.
- [ ] La leyenda ámbar de offline: decidir y **escribir** si es condicional a estar sin red. Hoy se muestra siempre. `spec-80` fase 3 (ronda 2) dejó anotado que la promesa «Las fotos también» sólo es completa con `spec-81` fase 5 — no prometer de más en el copy.

### Fase 7 — `5f2` la confirmación irreversible `[pending]`

**Depende de:** spec-95 fase 6

**Archivos:** `apps/frontend/src/app/app/pickup/complete/[loadId]/page.tsx`, y sus tests

El diálogo ya existe («¿Confirmar transferencia de custodia? … Esta acción es
irreversible»). `5f2` lo rediseña como **hoja inferior** y le añade datos.

- [ ] Hoja inferior con tirador, no diálogo centrado.
- [ ] Copy del mock, que cuenta las dos mitades: los verificados que pasan a custodia y los faltantes que quedan registrados.
- [ ] Resumen `Firmas` / `Respaldo` (nombres de quien firma, número de fotos).
- [ ] Botones `Sí, cerrar la carga` (primario) y `Volver a revisar`.
- [ ] **No se toca ninguna rama de `handleComplete`.** La cola offline de `spec-81` fase 2 queda intacta; esto es la capa de confirmación, no el cierre.

### Fase 8 — `5a` escritorio `[pending]`

**Depende de:** spec-94 fase 1

**Archivos:** `apps/frontend/src/components/pickup/PickupDesktopView.tsx`, `apps/frontend/src/components/pickup/PickupDesktopHeader.tsx`, `apps/frontend/src/components/pickup/ClientFilter.tsx`, `apps/frontend/src/components/pickup/ManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupRouteDraftPanel.tsx`, `apps/frontend/src/components/pickup/StartRouteButton.tsx`, y sus tests

`spec-83` fase 4 diffeó cuatro de los ocho componentes que pintan `5a` y lo dijo:
«`5a` no está completamente revisado». Esta fase cubre los cuatro que faltaban.

- [ ] Buscador de la cabecera pasa a ser el **global** (orden/paquete/RUT); el del módulo baja a su propia barra sobre los chips, con su copy del mock.
- [ ] Chips de cliente con **conteos** y la etiqueta `CLIENTE` delante.
- [ ] Séptima columna `ETIQUETAS` con acción `Imprimir` por fila — sobre el contrato que deje `spec-94` fase 1, no sobre el de hoy.
- [ ] Panel de vehículo pasa a decir «Se elige al confirmar la ruta. La cuadrilla la asigna quien la lidera» — el mock **adopta** el modelo de `spec-61` en vez de pedir el picker inline, y desaparece el conductor. Cierra la divergencia 2 de `spec-83` fase 4.
- [ ] CTA `Iniciar ruta de retiro` (se queda) más secundario `Ver QR de la ruta`. Cierra la divergencia 3 de `spec-83` fase 4.
- [ ] «Mostrando 7 de 12 · Cargar más» en vez de paginación con Anterior/Siguiente.
- [ ] **No** se implementa la barra de ocupación: sigue `[parked]` en `spec-83` fase 3.

### Fase 9 — `5g` el botón de flash `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/pickup/ManifestCameraSheet.tsx`, y sus tests

`5g` ya calzaba casi pixel a pixel; lo único que faltaba era el flash, y el mock
ya lo dibujaba antes de esta ronda.

- [ ] Botón de flash arriba a la derecha de la hoja de cámara.
- [ ] Degradar en silencio donde el dispositivo no lo soporte — no mostrar un control muerto.

---

## Riesgos

**El predicado del chip se inventa igualmente.** Es el riesgo principal y ya
ocurrió una vez en esta misma pantalla. La fase 1 lleva instrucción explícita de
parar y declarar antes que adivinar.

**`5a` se toma antes que `spec-94` fase 1.** El `**Depende de:**` lo bloquea en
`check-phase-overlap.mjs` (exit 4), así que el guard lo atrapa; el riesgo real es
que alguien lo quite para desatascarse.

**Las fases 5 y 6/7 tocan pantallas contiguas del mismo flujo.** No comparten
ficheros — `scan/[loadId]` frente a `complete/[loadId]` — así que se pueden
despachar en paralelo, pero un cambio de copy en una debería mirarse contra la
otra.

**`5e`, `5h` y `5i` no se tocan.** `5e` calzaba casi exacto. `5h` y `5i` siguen
**sin verificar**: `5h` necesita una captura de cámara real y `5i` exige confirmar
el diálogo irreversible, que en QA consume el fixture. Cerrarlos es trabajo de una
persona con el teléfono en la mano, no de este spec.
