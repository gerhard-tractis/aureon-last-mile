# Spec-78: Despacho en la tablet del andén — el bucle a tres metros

> **Related:** [spec-76](spec-76-despacho-movil-carga.md) (el mismo bucle en 390 px), [spec-77](spec-77-despacho-movil-cierre.md) (cierre y despacho), [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio)

**Status:** in progress
**Verify:** unit, e2e-qa

_Date: 2026-09-03_

---

## Goal

Una pantalla: `3a`, el bucle de escaneo de `2e` re-maquetado para una **tablet montada en el andén**, 1024 × 768 apaisado.

No es «el móvil más grande». Es un caso de uso distinto: la tablet está fija en un poste o en un carro, la cuadrilla la mira desde uno a tres metros mientras mueve bultos con las dos manos, y nadie la toca para scrollear. El ancho apaisado permite lo que 390 px no permite — **el contador, el resultado de la última lectura y las acciones de cierre visibles a la vez**, sin navegación intermedia.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, `Despacho.dc.html`, artboard `3a` (1024 × 768) | Geometría, jerarquía y copy |
| `spec-76`, decisiones 3 y 5 | Comportamiento del lector y de los rechazos, que aquí se reusan sin cambios |
| Este spec | Decisiones del lado del repo y plan |

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `3a` Tablet del andén | `/app/dispatch/[routeId]` en apaisado ≥ 1024 px | No existe |

Lo que `3a` muestra simultáneamente, y que en `2e` requiere navegar:

- Cabecera de ruta con andén, comuna, turno y **estado del lector** (`ZEBRA TC22 · LECTOR LISTO`).
- Resultado de la última lectura en grande, con parada, orden, dirección, cliente y `paquete 2 de 3`.
- Campo de escaneo con su ayuda (`Pasa el siguiente paquete · el campo se limpia solo`).
- Últimas lecturas con el conteo de rechazos del turno.
- Progreso: `148 de 172`, `86 %`, ritmo, y **cuántos quedan en el andén**.
- Órdenes, paradas, vehículo con su ocupación.
- Órdenes incompletas con su fracción (`ORD-48177 · 2 de 3`).
- **Ambas acciones terminales:** *Cerrar ruta* y *Despachar a DispatchTrack*.

### No-goals

- **No se implementa antes que `spec-76`.** `3a` reusa los componentes del bucle; construirlo primero significa escribirlos dos veces. Este spec es el último de los cuatro por dependencia, no por prioridad.
- **No es una ruta nueva.** Es la misma ruta de sesión, con un layout que responde al viewport. No se crea `/app/dispatch/tablet`.
- **No se soporta apaisado en teléfono.** Un teléfono en horizontal no es una tablet montada: 844 × 390 no tiene alto para este layout. El corte es por ancho **y** alto, no por orientación.
- **No hay migraciones ni endpoints nuevos.** Consume exactamente lo mismo que `2e`.

## Decisiones

1. **Tercer punto de corte, no un tercer árbol — el discriminador es un flag de dispositivo, no la sesión.** El repo ya bifurca en `lg` (1024) entre móvil y escritorio. `3a` cae justo en ese límite y es donde la heurística actual falla: a 1024 px de ancho una tablet del andén recibiría el árbol de **escritorio**, que está dibujado para el jefe de turno.

   La condición real es **`isDock` (flag de dispositivo persistido) Y ancho ≥ 1024 Y alto ≥ ~700**:
   - **`isDock`** viene de `?dock=1` en la URL, persistido en `localStorage` (`useIsDockDevice()`); `?dock=0` lo limpia (una tablet reasignada no queda pegada). No es identidad ni autorización — es una preferencia de visualización por dispositivo: una tablet marcada lee los mismos datos bajo el mismo RLS que cualquier otra sesión, sólo cambia qué layout se monta.
   - El corte de **alto** (no sólo ancho) sigue existiendo — un teléfono en horizontal iguala el ancho de escritorio pero no el alto.
   - **`route.status === 'loading'` NO es parte de esta condición**, a propósito: es un hecho de servidor visible para cualquier viewer al mismo ancho, dock o no. Usarlo aquí le robaría `1c` a un jefe de turno mirando la misma ruta desde su monitor — exactamente el riesgo que este spec identificó y que motivó la corrección de esta decisión.

   Se implementa como una variante de layout del árbol de sesión, reusando sus componentes, **no** como un tercer conjunto de componentes.

   **Por qué no el flag local `scanning` que el árbol móvil ya tiene** (la primera versión de esta decisión, "ancho ≥ 1024 y contexto de sesión de carga activa", asumía que podía servir): ese flag vive en un `useState` de `DispatchRouteSurface`, se resetea en cada carga de página, y la única pantalla que alguna vez lo pone en `true` (`DispatchRouteBeforeScan`, `2c`) sólo montaba por debajo de `lg` — nunca a ancho ≥ 1024. Una tablet del andén, por definición, se abre siempre a ese ancho; con esa primera versión de la condición no existía ningún camino de código por el que esa tablet pudiera llegar alguna vez a `3a`. Una tablet montada en un poste para todo un turno además necesita sobrevivir una recarga de página (u otra cuadrilla moviendo la ruta a `loading`) sin perder el camino de vuelta al bucle — un dispositivo que nadie quiere tocar a mitad de turno es exactamente el dispositivo que no debe necesitar que lo toquen para recuperarse. El flag de dispositivo se aprovisiona una vez, al montar la tablet en la pared, y no se vuelve a tocar — coincide con cómo se usa realmente.

2. **Legibilidad a tres metros es un requisito, no una preferencia.** El resultado de la última lectura y el contador se dimensionan para leerse de pie a distancia. Esto se verifica mirándolo, no sólo con tests: la comprobación es parte de la fase de QA, con la tablet donde va a vivir.

3. **Ambas acciones terminales están presentes, y por eso `spec-77` va primero.** `3a` ofrece *Cerrar ruta* y *Despachar a DispatchTrack* en la misma barra. *Cerrar ruta* abre `2i`, de `spec-77` — deshabilitado con su motivo como texto visible hasta que esa pantalla exista. *Despachar a DispatchTrack*, en cambio, se implementó en esta tarea con su propia confirmación completa (`AlertDialog`) contra el endpoint real (`POST /api/dispatch/routes/[id]/dispatch`, el mismo que usa escritorio) — no depende de `2j`/`spec-77`; su única condición pendiente es que la ruta llegue a `loaded`, lo que hoy sólo pasa sellando desde escritorio (el camino de cuadrilla, `2i`, todavía no existe). En una tablet fija y compartida el riesgo de toque accidental es mayor que en un teléfono en la mano, así que ambas mantienen su pantalla de confirmación completa — **no** se «simplifica» ninguna de las dos porque haya espacio.

4. **El estado del lector es información de primera clase.** En un teléfono la cuadrilla sabe si el campo está enfocado porque lo tiene en la mano. En una tablet montada no: `LECTOR LISTO` es lo que evita los bultos pasados en vano cuando el foco se perdió. Se muestra en la cabecera, y refleja el estado real del campo, no un literal.

5. **Sin scroll para el bucle.** Todo lo que la cuadrilla necesita durante el escaneo entra en la pantalla. Las listas largas (últimas lecturas, órdenes incompletas) tienen su propio scroll interno; la página no scrollea. Una tablet montada que exige scrollear con las manos ocupadas es una tablet que se ignora.

## Plan de implementación (TDD)

### Fase 1 — Punto de corte `[done]`
1. Test: con `isDock` (flag de dispositivo persistido) y ancho ≥ 1024 y alto ≥ ~700 → layout `3a`; sin el flag, al mismo ancho → árbol de escritorio, **incluida una ruta en `loading`** (regresión explícita: un jefe de turno sin el flag nunca pierde `1c`) (decisión 1, revisada).
2. Test: 844 × 390 (teléfono apaisado) **no** recibe el layout de tablet, aun con el flag puesto (corte por ancho y alto, no sólo por el flag).
3. Test: sin bug de hidratación — mismo patrón `useViewport` / `SSR_SAFE_DEFAULT`, y `useIsDockDevice` resuelto igual (post-hidratación, default `false`).

### Fase 2 — Layout `[done]`
4. Test: contador, resultado de última lectura y barra de acciones montan simultáneamente, sin navegación.
5. Test: la página no scrollea (altura real `100dvh - 3.5rem`, no `100vh`/`h-screen` — ver hallazgo de revisión sobre `AppLayout`/`TopBar`); las listas internas sí (decisión 5).
6. Test: `LECTOR LISTO` refleja el estado real del campo (decisión 4).

### Fase 3 — Paridad de comportamiento `[done]`
7. Test: el bucle de escaneo se comporta igual que `2e` — mismos componentes, mismos 4 motivos de rechazo, campo que se rearma (incluido tras cancelar la confirmación de despacho, no sólo tras un resultado de escaneo).
8. Test: *Cerrar ruta* deshabilitado con su motivo como texto visible (`2i` es `spec-77`, no construido). *Despachar a DispatchTrack* con su propia confirmación completa, contra el endpoint real — no depende de `spec-77` (ver decisión 3).

### Fase 4 — Cierre `[awaiting_user_test]`
9. `[done]` `npm run test -- --pool=forks` antes de push — 572/576 archivos, 5399/5450 tests verdes (los 4 archivos que fallan — `ManualCodeSheet`, `NewOrderModal`, `RealtimeStatusIndicator`, `OrderComunaChipsFilter` — son timeouts de worker/entorno preexistentes, ninguno toca `dispatch` ni este cambio; confirmado antes y después de este trabajo). `tsc --noEmit` y `npm run lint` limpios.
10. `[done]` **E2E con viewport 1024 × 768** — `e2e/despacho-tablet-dock.spec.ts` (namespace propio `E2E78`, `e2e/support/despacho-tablet-fixture.ts` + `despacho-tablet-journey.ts`, mismo patrón split que `spec-76`). Corre en el job `e2e-qa` (VPS), añadido a `playwright.qa.config.ts`'s `testMatch`. Cubre: sin `?dock=1` a 1024×768 el árbol sigue siendo el de escritorio (regresión de la decisión 1); con el flag puesto, el campo de escaneo llega enfocado sin intervención; el contador y el panel de última lectura se actualizan en una lectura aceptada y el campo queda armado (`toBeFocused()` + `LISTO`, no inferido); una lectura rechazada muestra su motivo, no incrementa el contador, y el campo también queda armado; y que el bucle no fuerza scroll de página a 968×712 (sidebar colapsado, el estado por defecto de un contexto de navegador nuevo — `useSidebarPin` sin `localStorage` previo).
11. **Medir el espacio real antes de validar nada más** (pendiente — requiere la tablet real): `3a` es un artboard a sangre completa de 1024 × 768, pero a `≥lg` `AppLayout` dibuja además el sidebar (56 px colapsado / 216 px fijado) y el `TopBar` de 56 px — el espacio real es **968 × 712, o 808 × 712 con el sidebar fijado**. Con el panel lateral fijo en 340 px, un sidebar fijado deja 468 px para contador, última lectura y campo de escaneo. Verificar en el dispositivo real si el layout entra en ese espacio antes de continuar — puede no entrar. El E2E del ítem 10 corre en el estado por defecto (sidebar colapsado, 968×712) y confirma que ESE caso no scrollea; no mide el caso fijado (808×712), que sigue siendo este ítem.
12. **Verificación física en QA** (pendiente — requiere la tablet real, montada, a tres metros, con el lector real): es el único modo de validar la decisión 2.

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

- **El corte por viewport puede robarle el escritorio a un jefe de turno** que abra una ruta en carga en un monitor de 1024 px. Mitigado condicionando a la sesión de carga activa (decisión 1), pero es la parte del spec que más merece revisión: equivocarse hace que un jefe de turno pierda su panel.
- **Depende de `spec-76` y `spec-77` ya mergeados.** Si se adelanta, duplica componentes.
- **Legibilidad a distancia no se testea automáticamente.** Sin la verificación física de la fase 4, este spec se puede declarar terminado estando roto para su único caso de uso.
