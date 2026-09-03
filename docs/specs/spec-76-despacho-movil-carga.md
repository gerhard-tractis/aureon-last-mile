# Spec-76: Despacho en móvil — la cuadrilla carga la ruta

> **Related:** [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio del mismo módulo), [spec-77](spec-77-despacho-movil-cierre.md) (cierre y despacho), [spec-78](spec-78-despacho-tablet-anden.md) (tablet del andén), [spec-61](spec-61-pickup-route-crew.md) (precedente de móvil de cuadrilla en Recogida), [spec-62](spec-62-reception-mobile.md) (precedente de móvil de andén en Recepción), [spec-68](spec-68-distribution-mobile.md) (`BatchScanner`, `QuickSortMobile`), [spec-70](spec-70-dispatch-state-machine.md) (estados de ruta y de paquete), [spec-74](spec-74-per-bulto-staging.md) (staging por bulto)

**Status:** backlog

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

### Fase 1 — Rama móvil y home
1. Test: bajo `lg` monta el árbol móvil de Despacho; sobre `lg` monta el de escritorio. Sin bug de hidratación (patrón `SSR_SAFE_DEFAULT`).
2. Test: `2a` con tarea en curso → tarjeta oscura con progreso, `%` y *Seguir escaneando*.
3. Test: `2a` sin tarea en curso → no renderiza la tarjeta oscura vacía; ofrece elegir ruta.
4. Test: métricas del turno (escaneados hoy, ritmo) y la cola *Después de esta*.

### Fase 2 — `2b` Elegir ruta
5. Test: los 4 estados del mock (`TU CARGA`, `BORRADOR`, `LISTA`, `TURNO B`) y su orden.
6. Test: una ruta de otra cuadrilla se renderiza pero no navega (decisión 9).
7. Test: los filtros `Todas` / `Mis rutas` / `Listas` con su conteo.

### Fase 3 — `2c` + `2d` Antes de escanear
8. Test: contadores del andén, órdenes, paradas; comunas de la ruta.
9. Test: aviso de órdenes incompletas que nombra la consecuencia («el cliente recibe en dos visitas») y lista los `ORD-…`.
10. Test: sin vehículo → *Empezar a escanear* sigue habilitado (decisión 6).
11. Test: hoja `2d` — camión bloqueado visible con su ruta; `capacity_packages IS NULL` no asignable.

### Fase 4 — `2e` + `2f` El bucle
12. Test: `ScanField` con `useScannerAutoSubmit`; sin Enter del lector el envío ocurre igual.
13. Test: lectura correcta → resultado grande arriba, contador incrementa, historial abajo, sin confirmación por bulto.
14. Test: cada uno de los 4 motivos de rechazo (decisión 5) con su color, icono y copy, y el campo sigue armado.
15. Test: *Ingresar código* manual como salida cuando el código está ilegible.

### Fase 5 — `2g` Cámara
16. Test: el visor no ocupa toda la pantalla y el contador permanece visible.
17. Test: permiso denegado → mensaje y vuelta al lector, no pantalla en blanco.

### Fase 6 — `2h` Paquetes
18. Test: agrupado por parada con su conteo; filtro *Incompletas*.
19. Test: quitar una fila devuelve el paquete a `asignado` y registra autor y hora (decisión 7).
20. Test: paquete `NO EMBARCADO` retenido en consolidación se marca en su parada.

### Fase 7 — Fixture de E2E de Despacho (nueva, decisión del usuario)

Despacho **no tiene fixture de E2E**, y por eso `playwright.qa.config.ts` lo excluye: su `testMatch` es `/(spec52-.*|reception-mobile)\.spec\.ts$/` y su propio comentario lo dice — *«dispatch-route y spec47-pickup no tienen fixture… Ampliar este patrón cuando cada uno tenga una»*. El E2E de Despacho se concentra aquí y en `spec-77`, no en `spec-75`: es donde hay lector real, dispositivo real y una acción irreversible. En escritorio el E2E sólo repetiría los tests de componente.

21. **Namespace propio, no el de spec-52.** Todas las suites que la config de QA recoge comparten el namespace de spec-52 — mismo `PREFIX` (`'E2E52'`), misma patente, mismos dos correos — y `seed()` **empieza llamando a `teardown()`**. Un fixture de Despacho metido en ese namespace borraría la ruta en curso de spec-52, y la config advierte que el fallo «parece flakiness de la app, no un cambio de config». El fixture de Despacho usa su propio `PREFIX`, su propia patente y sus propios correos.
22. `workers: 1` se mantiene. Es load-bearing por lo anterior, no un default olvidado.
23. Escribir `e2e/support/despacho-fixture.ts` siguiendo el patrón de `reception-mobile-fixture.ts`: precondición verificada explícitamente (no asumir que `seed()` corrió), y estados alcanzados **conduciendo las pantallas reales**, no con `INSERT` directo — las RPC stampan `auth.uid()` y los triggers leen el estado en vivo, así que una fila insertada a mano produce un estado que el resto del sistema no reconoce.
24. Ampliar el `testMatch` de `playwright.qa.config.ts` para incluir la suite nueva.

### Fase 8 — Cierre
25. `npm run test -- --pool=forks` + mutation-test antes de push.
26. E2E móvil (390 × 844) del bucle completo: elegir ruta → asignar vehículo → escanear → rechazos → lista por parada.
27. Ejecutar el E2E **en el runner del VPS** (`e2e:qa`): cada puerto de QA escucha en localhost del VPS, así que no corre desde un runner de GitHub ni desde una máquina local.
28. **Leer el reporte, no el check verde.** El job `e2e-qa` es `continue-on-error: true`, así que un pipeline verde no prueba que el E2E pasó.
29. Verificación en QA con lector real: el andén es donde se descubren los defectos de teclado del hardware.

## Riesgos

- **El hardware de QA corrompe guiones y no manda Enter.** Mitigado usando los primitivos compartidos, no un input propio. Verificar en QA antes de declarar terminado.
- **«El fix no funcionó en QA» suele ser bundle PWA rancio.** Antes de re-depurar: verificar datos → RPC bajo RLS → chunk efectivamente desplegado.
- **`2f` motivo *ya está en otra ruta*.** La UI no debe ofrecer mover el paquete sola: implica quitarlo de una ruta que puede estar ya cerrada. Se nombra y se deriva.
- **Superficie grande.** Ocho pantallas en un PR es mucho; si crece, las fases 1–3 y 4–6 se pueden separar en dos PRs bajo este mismo spec sin renumerar.
