# Spec-76: Despacho en móvil — la cuadrilla carga la ruta

> **Related:** [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio del mismo módulo), [spec-77](spec-77-despacho-movil-cierre.md) (cierre y despacho), [spec-78](spec-78-despacho-tablet-anden.md) (tablet del andén), [spec-61](spec-61-pickup-route-crew.md) (precedente de móvil de cuadrilla en Recogida), [spec-62](spec-62-reception-mobile.md) (precedente de móvil de andén en Recepción), [spec-68](spec-68-distribution-mobile.md) (`BatchScanner`, `QuickSortMobile`), [spec-70](spec-70-dispatch-state-machine.md) (estados de ruta y de paquete), [spec-74](spec-74-per-bulto-staging.md) (staging por bulto)

**Status:** in progress
**Verify:** unit, e2e-qa

_Date: 2026-09-03_

---

## Goal

Darle a la cuadrilla de andén las pantallas de Despacho que hoy **no existen en ninguna forma**. Recogida (`spec-61`), Recepción (`spec-62`) y Distribución (`spec-68`) ya tienen su superficie móvil; Despacho no tiene ninguna: cargar una ruta hoy sólo se puede hacer desde el escritorio, que está dibujado para el jefe de turno y no para alguien de pie en el andén con un lector en la mano.

Ocho pantallas, una por proceso, 390 × 844:

| Mock | Qué resuelve |
|---|---|
| `2a` Home de la cuadrilla | Una sola pregunta: qué cargo ahora. La tarjeta oscura es la tarea en curso. |
| `2b` Rutas para cargar | Elegir cuál se carga. El estado ordena la lista. |
| `2c` Antes de escanear | Qué hay en el andén, con qué vehículo, qué órdenes están incompletas. Un paso, no un formulario. |
| `2d` Asignar camión y conductor | Hoja inferior. El identificador del camión es el que viaja a DispatchTrack. |
| `2e` Escaneo continuo | El bucle principal. Sin confirmar bulto por bulto. |
| `2f` Rechazo de lectura | El motivo se nombra y el campo queda armado. No bloquea la fila. |
| `2g` Lectura con cámara | Para la cuadrilla sin handheld. Mismo bucle, misma salida. |
| `2h` Paquetes en la ruta | Agrupados por parada, con quitar por fila. |

El cierre (`2i`) y el despacho (`2j`–`2l`) son **`spec-77`**: ver *No-goals*.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, `Despacho.dc.html`, artboards `2a`–`2h` | Geometría, jerarquía y copy |
| `spec-61`, `spec-62`, `spec-68` | Precedente de móvil de cuadrilla: qué se comparte y qué es propio del módulo |
| `spec-70`, `spec-74` | Estados de ruta y de paquete que la UI nombra literalmente |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

**El handoff antiguo no cubre estas pantallas.** Sus secciones móviles (`3j`, `3k`, `3l`, `3o`, `3h`) son de **Recogida** — hablan de `manifests`, `pickup_scans`, `pickup_routes`, `add_manifest_to_route`, `close_pickup_route`. Despacho es otro flujo: `routes`, posiciones de carga, DispatchTrack. No se deben trasladar sus decisiones por analogía de nombre; en particular, aquí **no** hay cola offline de fotos ni `manifest_documents`.

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `2a` Home de cuadrilla | `/app/dispatch` bajo `lg` | No existe |
| `2b` Rutas para cargar | `/app/dispatch` bajo `lg`, lista | No existe |
| `2c` Antes de escanear | `/app/dispatch/[routeId]` bajo `lg` | Existe sólo el árbol de escritorio (`RoutePanel`) |
| `2d` Camión y conductor | Hoja dentro de `2c` | No existe en móvil |
| `2e` Escaneo continuo | `/app/dispatch/[routeId]` bajo `lg`, sesión | No existe: `ScanZone` es de escritorio |
| `2f` Rechazo | Estado dentro de `2e` | No existe |
| `2g` Cámara | Estado dentro de `2e` | No existe en Despacho |
| `2h` Paquetes en la ruta | Vista dentro de la sesión | Existe parcial: `PackageRow`, sin agrupar por parada |

### No-goals

- **Cierre y despacho.** `2i` (cerrar con faltantes), `2j` (despachar), `2k` (rechazo de DispatchTrack) y `2l` (acta) son `spec-77`. Son la única acción irreversible del módulo y merecen su propio PR y su propia revisión.
- **La tablet del andén.** `3a` es `spec-78`.
- **No se toca el escritorio.** `spec-75` lo cubre; los dos specs pueden merged en cualquier orden pero no deben editar los mismos archivos.
- **No hay migraciones.** Todos los estados que la UI nombra ya existen como valores de enum, verificado contra `packages/database/supabase/migrations`: `asignado`, `en_bodega`, `en_ruta`, `listo_para_despacho` para paquetes, y `draft`, `loading`, `closed`, `dispatched`, `planned` para rutas. La capacidad del camión es `fleet_vehicles.capacity_packages` (`spec-73`).
- **No se implementa modo offline.** Distinto de Recogida: el andén de la nave tiene red y el mock muestra `5G ▮▮▮` y `EN LÍNEA` en la barra de estado de `2a`. No se construye cola de reintento; si la red cae, se muestra el fallo. Inventar una cola offline aquí sería copiar una restricción de Recogida que no aplica.
- **No se crea un shell móvil compartido.** Ver decisión 2.

## Decisiones

1. **Rama de árbol completo en `lg` (1024px), con `useIsBelowLg`.** Es el mecanismo que ya usan Recogida y Recepción (`useViewport` resuelve en un `useEffect` post-hidratación con `SSR_SAFE_DEFAULT`, precisamente porque leer `matchMedia` en el inicializador de `useState` ya causó un bug de hidratación en este repo). **No** se usa `useIsMobile` (768px): el árbol de escritorio de Despacho pasa a tres columnas en `spec-75` y entre 768 y 1024 no respira. El árbol móvil **no monta** el mapa, el panel de cuadrillas ni las tarjetas KPI de jefatura — no las esconde con CSS, no las renderiza.

2. **Componentes móviles propios del módulo, no primitivos compartidos nuevos.** Recogida tiene `PickupMobile*` y Recepción tiene `ReceptionMobile*`, cada uno dentro de su carpeta de módulo. Despacho hace lo mismo bajo `components/dispatch/mobile/`. Se comparte lo que **ya** es compartido (`ScanField`, `useScannerAutoSubmit`, `ScanResult`, `StatusBadge`, `Sheet`); no se extrae una capa nueva para un tercer consumidor. Tres módulos con el mismo patrón es la señal de que el patrón funciona, no la señal de que hay que abstraerlo antes de tener el tercero funcionando.

3. **El lector es el camino principal y sus dos defectos conocidos se manejan en el primitivo compartido.** El hardware de QA no emite Enter al final de la lectura y su distribución de teclado US/ES corrompe los guiones. `ScanField` + `useScannerAutoSubmit` ya resuelven ambos y son lo que usan `BatchScanner` y `ReturnReceptionSession`. Se reusan tal cual. `2e` rotula el lector activo (`ZEBRA TC22`) porque la cuadrilla necesita saber si el campo está armado.

4. **La cámara es fallback explícito y se dice que es peor.** `2g` reusa el enfoque de `RouteQRScannerEntry` (Recepción), no una librería nueva. El visor **no** ocupa toda la pantalla: el contador tiene que seguir visible, y el mock lo dice. El copy nombra el costo real («con el lector Zebra el ritmo es de tres a cuatro veces mayor: úsala sólo si el handheld no está disponible») en vez de presentar las dos entradas como equivalentes.

5. **El rechazo no bloquea la fila.** `2f` es un estado de `2e`, no una pantalla modal: el color y el icono cambian juntos, el motivo se nombra, y el campo **queda armado** para el siguiente paquete. Cuatro motivos, todos ya representables con datos existentes:
   - *Ya está en otra ruta* — el paquete tiene un despacho vigente en otra `route`. Se nombra la ruta y se ofrece verla; **no** se mueve el paquete solo.
   - *Estado `en_bodega`* — no pasó por andén.
   - *Código no encontrado en este operador* — sin fila para ese `operator_id`. Nunca revela si existe en otro operador.
   - *Retenido en consolidación* — la causa de las órdenes incompletas.

6. **`2d` asigna sobre `fleet_vehicles`, y el identificador del camión es contractual.** El mock advierte que «DispatchTrack necesita el identificador del camión para aceptar la ruta», así que la asignación es un prerrequisito del despacho, no un adorno — pero **no** del escaneo: `2c` permite empezar a escanear sin vehículo y ofrece asignar ahora o antes de despachar. Un camión que ya lleva otra ruta hoy aparece **bloqueado y visible**, con la ruta que lo tiene (`EN RUT-0088`), no oculto. Un vehículo con `capacity_packages IS NULL` se muestra como *Sin capacidad configurada* y no acepta la asignación, en vez de dibujar una barra falsa.

7. **Quitar un paquete lo devuelve al andén, no lo borra.** `2h` lo rotula: vuelve a estado `asignado` y queda registrado quién lo quitó y a qué hora. Es la razón por la que la fila de quitar existe en la lista agrupada y no en el bucle de escaneo: quitar es una corrección deliberada, no parte del ritmo.

8. **`2h` agrupa por parada, no lista plana.** Con 148 paquetes una lista plana no es navegable, y la unidad de trabajo del conductor es la parada. Los toggles del mock son *Por parada* / *Por hora* + un filtro *Incompletas*.

10. **La barra de estado del teléfono NO se construye.** Los artboards de 390 × 844 dibujan `09:14`, `5G ▮▮▮` y la batería arriba porque son maquetas de un teléfono completo. Eso es chrome del sistema operativo: lo pinta el teléfono, no la PWA. Lo mismo vale para el indicador `EN LÍNEA` de `2a` sólo en cuanto a posición — ese sí es nuestro, pero va dentro de nuestra cabecera, no en una barra de estado falsa.

    Es el mismo error que ya se cometió una vez en `spec-75`: se instruyó redibujar el breadcrumb `Operación / Despacho` que el `TopBar` ya renderiza (ver `spec-75` decisión 9). **Regla al leer este canvas: distinguir el chrome de la plataforma y de la aplicación del chrome del módulo.** Un elemento presente en un artboard no implica que haya que construirlo; puede pintarlo el sistema operativo o existir ya un nivel más arriba.

9. **Una ruta en carga por otra cuadrilla se ve pero no se abre.** `2b` la muestra con quién la tiene (`la está cargando Javiera P.`) en vez de esconderla, y el toque no navega. Esconderla hace que la cuadrilla la busque; mostrarla sin bloquearla provoca dos sesiones sobre el mismo andén.

## Plan de implementación (TDD)

Test primero, en rojo, luego implementación. Cobertura sobre 70 %.

### Fase 1 — Rama móvil y home `[done]`
1. Test: bajo `lg` monta el árbol móvil de Despacho; sobre `lg` monta el de escritorio. Sin bug de hidratación (patrón `SSR_SAFE_DEFAULT`).
2. Test: `2a` con tarea en curso → tarjeta oscura con progreso, `%` y *Seguir escaneando*.
3. Test: `2a` sin tarea en curso → no renderiza la tarjeta oscura vacía; ofrece elegir ruta.
4. Test: métricas del turno (escaneados hoy, ritmo) y la cola *Después de esta*.

### Fase 2 — `2b` Elegir ruta `[done]`
5. Test: los 4 estados del mock (`TU CARGA`, `BORRADOR`, `LISTA`, `TURNO B`) y su orden.
6. Test: una ruta de otra cuadrilla se renderiza pero no navega (decisión 9).
7. Test: los filtros `Todas` / `Mis rutas` / `Listas` con su conteo.

### Fase 3 — `2c` + `2d` Antes de escanear `[done]`
8. Test: contadores del andén, órdenes, paradas; comunas de la ruta.
9. Test: aviso de órdenes incompletas que nombra la consecuencia («el cliente recibe en dos visitas») y lista los `ORD-…`.
10. Test: sin vehículo → *Empezar a escanear* sigue habilitado (decisión 6).
11. Test: hoja `2d` — camión bloqueado visible con su ruta; `capacity_packages IS NULL` no asignable.

### Fase 4 — `2e` + `2f` El bucle `[done]`
12. Test: `ScanField` con `useScannerAutoSubmit`; sin Enter del lector el envío ocurre igual.
13. Test: lectura correcta → resultado grande arriba, contador incrementa, historial abajo, sin confirmación por bulto.
14. Test: cada uno de los 4 motivos de rechazo (decisión 5) con su color, icono y copy, y el campo sigue armado.
15. Test: *Ingresar código* manual como salida cuando el código está ilegible.

### Fase 5 — `2g` Cámara `[in_progress]`
16. Test: el visor no ocupa toda la pantalla y el contador permanece visible.
17. Test: permiso denegado → mensaje y vuelta al lector, no pantalla en blanco.

### Fase 6 — `2h` Paquetes `[in_progress]`
18. Test: agrupado por parada con su conteo; filtro *Incompletas*.
19. ~~Test: quitar una fila devuelve el paquete a `asignado` y registra autor y hora (decisión 7).~~ **Tachado en la tarea 4** — no hay control de *Quitar* en `2h`. Ver `### Añadido tras la tarea 4 de spec-76` al final del documento: la remoción es una acción de planificación de un solo responsable (`canRemoveFromPlan`), no de la cuadrilla que escanea, y no vuelve a `asignado`.
20. Test: paquete `NO EMBARCADO` retenido en consolidación se marca en su parada.

### Fase 7 — Fixture de E2E de Despacho (nueva, decisión del usuario) `[pending]`

Despacho **no tiene fixture de E2E**, y por eso `playwright.qa.config.ts` lo excluye: su `testMatch` es `/(spec52-.*|reception-mobile)\.spec\.ts$/` y su propio comentario lo dice — *«dispatch-route y spec47-pickup no tienen fixture… Ampliar este patrón cuando cada uno tenga una»*. El E2E de Despacho se concentra aquí y en `spec-77`, no en `spec-75`: es donde hay lector real, dispositivo real y una acción irreversible. En escritorio el E2E sólo repetiría los tests de componente.

21. **Namespace propio, no el de spec-52.** Todas las suites que la config de QA recoge comparten el namespace de spec-52 — mismo `PREFIX` (`'E2E52'`), misma patente, mismos dos correos — y `seed()` **empieza llamando a `teardown()`**. Un fixture de Despacho metido en ese namespace borraría la ruta en curso de spec-52, y la config advierte que el fallo «parece flakiness de la app, no un cambio de config». El fixture de Despacho usa su propio `PREFIX`, su propia patente y sus propios correos.
22. `workers: 1` se mantiene. Es load-bearing por lo anterior, no un default olvidado.
23. Escribir `e2e/support/despacho-fixture.ts` siguiendo el patrón de `reception-mobile-fixture.ts`: precondición verificada explícitamente (no asumir que `seed()` corrió), y estados alcanzados **conduciendo las pantallas reales**, no con `INSERT` directo — las RPC stampan `auth.uid()` y los triggers leen el estado en vivo, así que una fila insertada a mano produce un estado que el resto del sistema no reconoce.
24. Ampliar el `testMatch` de `playwright.qa.config.ts` para incluir la suite nueva.

### Fase 8 — Cierre `[pending]`
25. `npm run test -- --pool=forks` + mutation-test antes de push.
26. E2E móvil (390 × 844) del bucle completo: elegir ruta → asignar vehículo → escanear → rechazos → lista por parada.
27. Ejecutar el E2E **en el runner del VPS** (`e2e:qa`): cada puerto de QA escucha en localhost del VPS, así que no corre desde un runner de GitHub ni desde una máquina local.
28. **Leer el reporte, no el check verde.** El job `e2e-qa` es `continue-on-error: true`, así que un pipeline verde no prueba que el E2E pasó.
29. Verificación en QA con lector real: el andén es donde se descubren los defectos de teclado del hardware.

## Lecciones aplicadas

Reglas que **ya costaron caro** en otro spec de esta serie. No son teoría: cada una nombra dónde se aprendió. Léelas antes de escribir la primera línea de este spec.

1. Confirmá qué pantalla es un archivo por sus **imports y su ruta**, nunca por su número de artboard.

   *Dónde se aprendió:* `spec-75` decisión 2 afirmaba que `RouteBuilder.tsx` era la pre-ruta (`1a`) y había que partirlo. Es la pantalla de **una ruta** (`/app/dispatch/[routeId]`, `1c`), y las tres columnas de `1a` ya existían. La renumeración entre el handoff viejo y el canvas nuevo lo provocó. De haberse implementado, un agente habría desarmado una pantalla que funciona.

2. El canvas dibuja la **página completa**: separá el chrome de la plataforma y de la app del chrome del módulo.

   *Dónde se aprendió:* `spec-75` mandó redibujar el breadcrumb `Operación / Despacho` que `TopBar` ya renderiza — habría salido dos veces en pantalla. Un elemento presente en un artboard no implica que haya que construirlo: puede pintarlo el sistema operativo o existir un nivel más arriba.

3. Verificá que los campos que el spec da por existentes **estén realmente en el payload**.

   *Dónde se aprendió:* `spec-75` decía que el chevron expandía `sku_items` «que el RPC ya devuelve». No los devuelve. Se resolvió con una consulta perezosa al expandir, sin migración. Antes de prometer «sólo es aplanar la respuesta», leé la definición de la función más reciente.

4. **ARIA anidado se rompe en silencio.** Un rol interactivo con descendientes enfocables los borra del árbol de accesibilidad.

   *Dónde se aprendió:* `spec-75` produjo dos defectos de este tipo en dos tareas. (1) Dos raíces `Tabs` de Radix separadas: cada `aria-controls` apuntaba a un id inexistente — cuatro pestañas huérfanas y cuatro paneles sin etiqueta. (2) Un `div role="checkbox"` con un `<button>` de chevron adentro: `checkbox` es un rol de *presentational children*, así que el chevron desaparecía del árbol, y el nombre accesible de la fila absorbía la etiqueta del botón. **Ninguno de los dos lo detectaron los tests, ni `tsc`, ni la revisión de spec.**

5. **Un `onKeyDown` en un contenedor sin guard de `target` secuestra a sus hijos.**

   *Dónde se aprendió:* En `spec-75`, Enter sobre el chevron enfocado **deseleccionaba la orden** y no expandía nada: el evento burbujeaba al `div`, `preventDefault()` cancelaba la activación del botón y corría el handler del padre. Usá `<button>` nativos como hermanos en vez de manejo de teclado propio; si hace falta un handler en el contenedor, cortá con `if (e.target !== e.currentTarget) return`. **Escribí un test de teclado**: no había ninguno, y por eso se fue a revisión.

6. Un `<button>` dentro de un `<div onClick>` dispara **los dos** handlers.

   *Dónde se aprendió:* Detectado al reestructurar la fila de `spec-75`. Si el patrón «toda la fila es el hit target» convive con un control propio adentro, hace falta `stopPropagation` y un test que fije que la acción ocurre **una** vez.

7. `enabled: false` evita el *fetch*, no el **observer**.

   *Dónde se aprendió:* En `spec-75` cada una de las ~204 filas colapsadas montaba igual un `QueryObserver`, su entrada de caché y su suscripción. La solución es mover el hook al componente que **sólo se monta** cuando hace falta, no gatearlo desde arriba.

8. Sin `memo` + `useCallback` juntos, un clic re-renderiza la lista entera.

   *Dónde se aprendió:* En `spec-75` los handlers se redeclaraban en cada render, así que `memo` por sí solo no habría hecho nada. Es el camino del clic en una pantalla de andén usada a las apuradas: las dos mitades van juntas o no sirve ninguna.

9. Nada de fechas calculadas **al cargar el módulo**.

   *Dónde se aprendió:* En `spec-75`, `sevenDaysAgo` se evaluaba una vez por carga: en una PWA abierta todo el turno, «últimos 7 días» pasaba a significar 8 después de medianoche, y el test se recalculaba en el momento de la aserción, así que habría *flakeado* en vez de detectarlo. Calculá dentro del componente y testeá con *fake timers* cruzando medianoche.

10. Una reescritura puede **perder un campo** que el resto de la UI da por presente.

   *Dónde se aprendió:* En `spec-75` la reescritura de la columna dejó de renderizar el `subtitle` del grupo — el único lugar que nombra **entre qué andenes** se reparte una comuna — mientras seguía mostrando el ícono de advertencia. La UI avisaba del problema y ocultaba el dato. Al reescribir un componente, compará campo por campo contra la versión anterior y decilo explícitamente.


### Añadido tras la tarea 3 de `spec-75` (monitor de carga)

### Campos del canvas que **no existen en el schema**

Verificado durante `spec-75` tarea 3 recorriendo migraciones y tipos. El canvas los dibuja; la base no los tiene. **No los inventes y no agregues migración para tenerlos** — si el diseño los pide, se renderiza nada y se anota.

| Figura del mock | Realidad |
|---|---|
| `Turno A` / `Turno B` (turno de cuadrilla) | **No existe tabla de turnos.** `pickup_route_crew` es otro dominio (viajes de recogida, no carga en andén). |
| `furgón 12,4 m³` (volumen del vehículo) | `fleet_vehicles` tiene `vehicle_type` (texto) y `capacity_packages` (conteo). No hay columna de volumen. `drivers.max_volume_m3` es un tope de planificación por conductor, otra tabla, no el volumen del camión. |
| `A3 Sur Oriente` — la parte «sector» | Sólo existe `load_positions.code`/`label` (el andén). No hay columna de sector por ruta. |
| `Cerró 08:41` (hora de cierre) | No hay `sealed_at`/`closed_at`. Ver la regla sobre proxies abajo. |

1. **Un proxy no se muestra bajo una etiqueta que afirma un hecho.**

   *Dónde se aprendió:* `spec-75` tarea 3 renderizó `Cerró 08:41` desde `routes.updated_at`, razonando que nada más muta una ruta `loaded`. **Es falso:** `sweep_load_position_assignments` incluye `loaded` y llama a `assign_load_position`, que hace `updated_at = now()` — y ese barrido corre después del despacho exitoso de **cualquier otra ruta**. Una ruta sellada a las 08:41 sin andén libre pasa a mostrar «Cerró 11:20» cuando otro despacho libera una posición. Si el dato real hace falta, sale de `audit_logs` (el trigger guarda `{before, after}`, así que la transición a `loaded` está registrada), no de una columna que se mueve por otros motivos.

2. **Un test que pasa sobre datos imposibles no prueba nada.**

   *Dónde se aprendió:* En `spec-75` tarea 3 la línea de conductor + vehículo **no podía renderizarse nunca** en esa pestaña: `routes.vehicle_id` y `driver_name` los escribe sólo `/dispatch`, *después* de la transición a `dispatched`, así que toda ruta de ese conjunto los tiene en `NULL` — y el join a `fleet_vehicles` se pedía cada 30 s para nada. Los tests pasaban porque el fixture inyectaba a mano `driverName: 'Mario González'`. **Los fixtures sólo deben contener datos que el hook realmente pueda producir.**

3. **Las fechas «de hoy» se calculan en la zona horaria de Chile, no en UTC.**

   *Dónde se aprendió:* `spec-75` tarea 3 usó `new Date().toISOString().slice(0,10)` en la cabecera de una pantalla de turno de tarde: desde las ~20:00 de Santiago imprimía la fecha de mañana. El repo ya tiene `todayISOInTimezone()` en `lib/utils/dateFormat.ts`, y su comentario describe exactamente este fallo. Usalo, y pasá `timeZone: TIMEZONE` a todo `toLocale*`.

4. **Un tick por segundo re-renderiza todo lo que lo consume: bajalo al componente que muestra el tiempo.**

   *Dónde se aprendió:* En `spec-75` tarea 3 el tick de 1 s vivía en la pestaña, así que cada segundo se re-renderizaban todas las tarjetas — incluidas las que no muestran ningún texto dependiente del tiempo — y sus subárboles de `AlertDialog`. Se extrajo un componente mínimo que posee su propio tick; el resto pasó a un tick lento alineado con el refetch, y recién ahí `memo` sirve para algo.

5. **Una consulta sin cota temporal crece para siempre.**

   *Dónde se aprendió:* En `spec-75` tarea 3 la consulta de rutas no tenía límite de fecha: toda ruta jamás dejada abierta seguía en alcance, abriéndose a sus despachos y de ahí a todos los paquetes de esas órdenes, en `await` secuencial por lote, cada 30 s. En producción son ~112k despachos y ~61k paquetes. Acotá por fecha y paralelizá los lotes con `Promise.all`.

6. **Dos señales distintas no se colapsan en una.**

   *Dónde se aprendió:* `spec-75` tarea 3 quitó el borde de «atrasada» (`route_date` en el pasado) argumentando que el borde de «detenida» lo reemplazaba. No lo reemplaza: una cuadrilla escaneando a buen ritmo en la ruta de ayer está *atrasada* pero no *detenida*, y como la consulta ordenaba por fecha descendente, esa ruta quedaba **al final**. La señal no fue superada, fue invertida.


## Riesgos

- **El hardware de QA corrompe guiones y no manda Enter.** Mitigado usando los primitivos compartidos, no un input propio. Verificar en QA antes de declarar terminado.
- **«El fix no funcionó en QA» suele ser bundle PWA rancio.** Antes de re-depurar: verificar datos → RPC bajo RLS → chunk efectivamente desplegado.
- **`2f` motivo *ya está en otra ruta*.** La UI no debe ofrecer mover el paquete sola: implica quitarlo de una ruta que puede estar ya cerrada. Se nombra y se deriva.
- **Superficie grande.** Ocho pantallas en un PR es mucho; si crece, las fases 1–3 y 4–6 se pueden separar en dos PRs bajo este mismo spec sin renumerar.

### Añadido tras la tarea 3 de `spec-76` (`2e`/`2f`, el bucle)

**Decisión 5 / motivo 2 ("Estado `en_bodega` — no pasó por andén") — resuelto.** Se detectó durante la implementación de la tarea 3 que `DISPATCHABLE_STATUSES` (el conjunto que `validateScan` acepta) incluía `en_bodega`, así que ese motivo de rechazo era inalcanzable: un escaneo de un paquete `en_bodega` se aceptaba, no se rechazaba. `anden-status.ts` (tarea 2, review I4) ya lo había anotado contra esta misma decisión sin corregirlo. Escalado y decidido: **`en_bodega` sale de `DISPATCHABLE_STATUSES`** (`lib/dispatch/scan-validator.ts`) y pasa a tener su propio código de rechazo, `NOT_ON_DOCK`, con el copy `«Paquete en bodega — no pasó por andén»`.

Dos argumentos lo sustentan:
- **Norma de la industria**: los sistemas de verificación de andén son *block-not-warn* — "no escaneado, verificado y liberado" implica "no carga", con anulación explícita de un supervisor en vez de una aceptación silenciosa.
- **La evidencia local es más fuerte todavía**: el propio análisis de la migración `20260817000003` anota que `dock_zone_id IS NOT NULL AND status = 'en_bodega'` son *"casi mutuamente excluyentes"*, porque el único escritor de `dock_zone_id` — el trigger de escaneo de andén — pone `status = 'sectorizado'` en el mismo `UPDATE`. Un paquete físicamente sorteado a un andén es `sectorizado`; uno que sigue en `en_bodega` genuinamente no ha sido sorteado. Esa migración agregó `sectorizado` — no agregó `en_bodega` a este conjunto; su presencia ahí era vestigial, no deliberada. (Nota: esa migración corrigió el cohorte de Pre-Ruta agregando `sectorizado`; no fue la que agregó `en_bodega`.)

**Esto también cambia el escritorio** (`RouteBuilder`'s `ScanZone` usa el mismo validador — correcto e intencional, ambas superficies deben rechazarlo), **la pasada de staging en el andén** (`POST /api/dispatch/load-positions/scan` / `load-position-scan.ts` — ver el hallazgo dedicado más abajo) y **el conteo de `packagesTotal`/`boxesTotal`** en **los cuatro** lugares que comparten `DISPATCHABLE_STATUSES` — no tres: `useRoutePackages.ts:83`, `crew-board.ts:95` (`aggregateBoxesByRoute`), `loading-monitor-aggregate.ts:66`, y **`seal-route.ts:225`**, el que una primera versión de esta nota omitió y que es la causa directa del hallazgo Crítico 1 más abajo — decide si una ruta puede sellarse. Un paquete `en_bodega` sin `loaded_at` ya no cuenta como outstanding/total en ninguno de los cuatro, por la misma razón que un `dañado`/`retenido` nunca contó — contarlo inflaba un total (o bloqueaba un sello) que la ruta nunca podía alcanzar. `ON_ANDEN_STATUSES` (`anden-status.ts`) pasó a ser un alias de `DISPATCHABLE_STATUSES` en vez de una copia a mano — los dos conjuntos convergieron, así que la figura "EN EL ANDÉN" (`2c`) y lo que el bucle de escaneo acepta (`2e`) ahora están de acuerdo, cerrando la inconsistencia que la tarea 2 dejó abierta.

**Crítico 1 (review posterior) — las copias SQL no se movieron con la de TypeScript.** `recompute_dispatch_stage` (última definición: `20260902000001`, línea 456) y `get_pre_route_snapshot` (última definición: `20260825000004`, línea 47) seguían listando `'en_bodega'` a mano — el comentario de la primera (`20260902000001:398-409`) afirmaba que la lista SQL *"MUST stay identical to DISPATCHABLE_STATUSES"* y que dos suites se pondrían rojas si divergía; verificado que esa guardia **no existía** (`spec74_phase3_partially_staged.test.sql` tenía 0 ocurrencias de `en_bodega` antes de esta corrección, y los tests SQL no corren en CI de todos modos). Consecuencia real, en una ruta: `seal-route.ts` ya excluía un hermano `en_bodega` de "outstanding" (la ruta **sella** como completa) mientras `recompute_dispatch_stage` lo seguía contando (el despacho queda **`partially_staged`** para siempre) — exactamente la bandera que `2c`/`2h` pintan como *órdenes incompletas* / `NO EMBARCADO`. Una cuadrilla que escanea todo lo que puede se queda con una ruta sellada cuyas órdenes leen incompletas para siempre.

**Resuelto dentro de spec-76** (se anuló el no-goal "no hay migraciones" explícitamente para esto — dejar TS y SQL desincronizados en cualquier estado desplegado no es aceptable, y diferir a spec-79 habría desplegado la divergencia en vivo): migración `packages/database/supabase/migrations/20260907000001_spec76_en_bodega_not_dock_ready.sql`, `CREATE OR REPLACE` de ambas funciones desde su definición más reciente (regla del repo), solo cambia la lista de estados. Guardia pgTAP agregada donde se había prometido y nunca se escribió: `spec74_phase3_partially_staged.test.sql` TEST 10 (un hermano `en_bodega` ya no bloquea el sello) y `pre_route_snapshot.test.sql` TEST 14 (un paquete `en_bodega` sale del cohorte de Pre-Ruta) — el resto de fixtures de ese segundo archivo, que usaban `en_bodega` solo como placeholder genérico de "listo" (TEST 11 ya lo documentaba así), se migraron a `sectorizado`. Verificado localmente con `scripts/pgtap-local.sh` (contenedor `spec52-pg`, compartido entre worktrees — se confirmó que no había otra sesión con conexiones activas antes de correr `sync`/`apply`/`run`; ver el reporte de esta tarea para el detalle).

**Important #5 (review posterior) — rastreo de la cadena de triggers de `load-position-scan.ts`.** Pregunta: ¿puede un paquete llegar a una posición de carga (`POST /api/dispatch/load-positions/scan`, la pasada de staging del andén) sin ya estar `sectorizado`, haciendo circular el rechazo `NOT_ON_DOCK` ahí ("no está en el andén, por lo tanto no puede entrar al andén")? **Rastreado, no asumido.** `load-position-scan.ts` reusa `validateScan` apuntado a la ruta que ocupa la posición escaneada, y exige `action.kind === 'stage'` — rechaza `'adopt'` de plano (`NOT_PLANNED_FOR_POSITION`), así que nunca admite un paquete que no estuviera ya planificado en esa ruta. Es un paso *distinto* del escaneo de sorteo real (`useQuickSortFlow` / `dock-scan-validator.ts`, que tiene su **propio** `SCANNABLE_STATUSES = ['en_bodega', 'sectorizado']` sin relación con `DISPATCHABLE_STATUSES` — ese es el que efectivamente mueve un paquete de `en_bodega` a `sectorizado`, y esta corrección no lo toca). Las posiciones de carga (`load_positions.fronts_dock_zone_id`) son las bahías físicas de carga del camión, corriente abajo del sorteo — un paquete genuinamente aún en `en_bodega` no puede estar físicamente ahí, porque nunca pasó por ningún andén. **Conclusión: no, no es circular; no se necesita excepción.** El ensanche de la unión de tipos en `PositionScanResult` (`load-position-scan.ts`) que `tsc` exigió es correcto tal cual, sin cambios adicionales.

**Caveat de despliegue — anotado, no ejecutado, alcance ampliado.** Esto altera comportamiento en vivo en **tres** superficies, no solo el escaneo de ruta: el escaneo de ruta (`2e`/escritorio), la pasada de staging en la posición de carga, y el sello de ruta (`seal-route.ts` ahora deja de esperar por un hermano `en_bodega`, así que una ruta que antes se bloqueaba en "faltan bultos" por un paquete `en_bodega` ahora puede sellar). Antes de que esto llegue a producción, alguien debe contar cuántos paquetes se escanearon (a una ruta O a una posición de carga) estando en `en_bodega` en los últimos 30 días, y por separado cuántas rutas habrían sellado antes de lo que sellaron por este cambio. Si es ~0, es un cierre de brecha sin costo; si no lo es, algún flujo real depende de eso y hace falta una ruta de anulación (override) en vez de un bloqueo sin salida. Estas consultas **no se ejecutaron** contra producción como parte de esta tarea — son un chequeo pre-despliegue pendiente, no un hallazgo verificado.

**`parada NN`** no tiene columna de secuencia en el schema (verificado: `assignments.sequence_number` es la tabla del optimizador OR-Tools, sin relación con `routes`/`dispatches`). `2e`/`2f` reusan la misma definición de "parada" que `2c` ya envía (`route-load-brief.ts`'s `countStops`): direcciones de entrega distintas, ordenadas alfabéticamente. Es un índice de agrupación estable, no una afirmación sobre el orden real de visita del conductor — ver `stopIndexByOrder` en `route-load-brief.ts`.

**`ALREADY_IN_ROUTE` ahora devuelve `conflictingRouteId`** (`scan-validator.ts`, `types.ts`, `route.ts`, `useScanPackage.ts`) — antes el endpoint no exponía qué ruta ya tenía el paquete, y decisión 5 pide nombrarla y ofrecer verla. Cambio aditivo (campo opcional), sin migración.

El "dock_scans hardcodeado a `scan_result: 'accepted'`" citado en el encargo de esta tarea describe `POST /api/dispatch/load-positions/scan` (el escaneo de posición), no `POST /api/dispatch/routes/[id]/scan` (el que usan `2e`/`2f`) — este último no escribe en `dock_scans` en ningún caso, aceptado o rechazado. La conclusión que importa para `2e`/`2f` sigue siendo verdadera: un rechazo no se persiste en ningún lado, así que el historial de `2f` es memoria de esta pestaña, no una fuente de verdad.

### Añadido tras la tarea 4 de `spec-76` (`2g`/`2h`)

**Decisión 7 — corregida. `2h` no tiene control de *Quitar*.** La decisión original («Quitar un paquete lo devuelve al andén... la fila de quitar existe en la lista agrupada») y la tabla de *Scope* («`2h`... con quitar por fila») describían una acción que la cuadrilla no puede tener, verificado contra el endpoint real (`DELETE /api/dispatch/routes/[id]/packages/[pkgId]`, spec-70) en vez de asumido. Tres hallazgos, escalados durante la tarea 4:

1. **Granularidad de orden completa, no de paquete.** `[pkgId]` es en realidad un `dispatches.id` pese al nombre del segmento de ruta — el endpoint quita TODA la orden (todos sus bultos) de la ruta, no el único paquete que la fila representa. No existe ningún endpoint de remoción por paquete individual en este repo.
2. **El estado resultante es `sectorizado`, no `asignado`.** Verificado contra el propio test del endpoint (*"resets the package to sectorizado, not asignado"*) y un comentario ya existente en el repo ("breakage #9 — nada escribe `asignado` nunca más"). Sigue dentro de `DISPATCHABLE_STATUSES`, así que la única parte de la decisión 7 que sobrevive es que el paquete puede volver a escanearse.
3. **`canRemoveFromPlan` — solo un responsable.** El endpoint está deliberadamente restringido por spec-70 a `ops_leader`/`operations_manager`/`admin`/`super_admin` («quitar es una acción de un responsable, no del lector — la persona que carga no puede ser quien reduce el plan»). Nada en este módulo de cuadrilla autentica a la cuadrilla con uno de esos roles.

**Decisión, tras investigar el patrón de la industria:** el rol restringido de spec-70 es correcto — sigue siéndolo — para esta acción, precisamente porque es una decisión de planificación (quita una orden entera del plan), no una decisión de "este bulto no sube". Infor WMS exige un código de motivo para un envío corto y no dice nada sobre restringir quién puede reportarlo; el modelo de andén de Oracle retiene una carga hasta que las discrepancias son *"remedied or overridden"* — el patrón de la industria para "la cuadrilla no puede cargar este bulto" es **trazabilidad, no autorización**: un gate de rol en el piso de carga hace que "bloquear el camión" o "cargarlo igual" sean más atractivos que buscar a un responsable, lo que invierte la intención del control. Pero eso no aplica aquí: la acción que `2h` ofrecía es "quitar la orden entera del plan", y esa sí es una decisión de planificación — spec-70 tenía razón sobre ESA acción. Las dos specs tenían razón sobre acciones distintas; spec-76 le pidió a un solo control que hiciera los dos trabajos.

**Resuelto:** *Quitar* se elimina del camino de la cuadrilla en `2h` — no se muestra deshabilitado (un botón deshabilitado en un andén invita a tocarlo repetidamente). `canRemoveFromPlan` no gana un rol de cuadrilla. `RouteBuilder` (escritorio, la superficie de un responsable) ya tiene su propio control de remoción contra el mismo endpoint (`handleRemove`, con `window.prompt` para el motivo) — no se duplica.

**La necesidad real de la cuadrilla — "este bulto no sube, y por qué" — es el patrón de código de motivo, y ya está en el alcance de `spec-79` H4** (persistir los rechazos de escaneo). No se construye acá. `DispatchPackagesByStop.tsx` deja un comentario nombrando H4 como el destino de esta acción para que el próximo agente no vuelva a derivar esta misma conclusión.

**Test #19 de la Fase 6 — tachado explícitamente.** *"quitar una fila devuelve el paquete a `asignado` y registra autor y hora"* es ahora imposible de satisfacer (no hay control que probar, y el estado real nunca fue `asignado`) — no es un test faltante, es un test que dejó de aplicar. Ver la Fase 6 arriba.

**No se inventa un estado de orden "parcialmente despachada".** `recalculate_order_status` ya deriva `orders.status` de `MIN(pipeline_position)` y `orders.leading_status` de `MAX(...)`, por trigger — `status != leading_status` **es** "parcialmente despachada", calculado, no una columna nueva. Un segundo escritor competiría con esa derivación, exactamente lo que la propia cabecera de esa migración advierte. `parcialmente_entregado` existe solo porque la entrega es terminal y el spread colapsa ahí — no es un precedente para inventar un estado equivalente en otras etapas.
