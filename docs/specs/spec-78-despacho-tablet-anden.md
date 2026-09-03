# Spec-78: Despacho en la tablet del andén — el bucle a tres metros

> **Related:** [spec-76](spec-76-despacho-movil-carga.md) (el mismo bucle en 390 px), [spec-77](spec-77-despacho-movil-cierre.md) (cierre y despacho), [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio)

**Status:** backlog

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

1. **Tercer punto de corte, no un tercer árbol.** El repo ya bifurca en `lg` (1024) entre móvil y escritorio. `3a` cae justo en ese límite y es donde la heurística actual falla: a 1024 px de ancho una tablet del andén recibiría el árbol de **escritorio**, que está dibujado para el jefe de turno y tiene el mapa y los KPI. La condición de `3a` es **ancho ≥ 1024 y contexto de sesión de carga activa**, es decir: si la cuadrilla está escaneando esta ruta, la tablet muestra el bucle, no el panel de jefatura. Se implementa como una variante de layout del árbol de sesión, reusando sus componentes, **no** como un tercer conjunto de componentes.

2. **Legibilidad a tres metros es un requisito, no una preferencia.** El resultado de la última lectura y el contador se dimensionan para leerse de pie a distancia. Esto se verifica mirándolo, no sólo con tests: la comprobación es parte de la fase de QA, con la tablet donde va a vivir.

3. **Ambas acciones terminales están presentes, y por eso `spec-77` va primero.** `3a` ofrece *Cerrar ruta* y *Despachar a DispatchTrack* en la misma barra. Las dos pantallas que esas acciones abren son `2i` y `2j`, de `spec-77`. En una tablet fija y compartida el riesgo de toque accidental es mayor que en un teléfono en la mano, así que ambas mantienen su pantalla de confirmación completa — **no** se «simplifica» el cierre porque haya espacio.

4. **El estado del lector es información de primera clase.** En un teléfono la cuadrilla sabe si el campo está enfocado porque lo tiene en la mano. En una tablet montada no: `LECTOR LISTO` es lo que evita los bultos pasados en vano cuando el foco se perdió. Se muestra en la cabecera, y refleja el estado real del campo, no un literal.

5. **Sin scroll para el bucle.** Todo lo que la cuadrilla necesita durante el escaneo entra en la pantalla. Las listas largas (últimas lecturas, órdenes incompletas) tienen su propio scroll interno; la página no scrollea. Una tablet montada que exige scrollear con las manos ocupadas es una tablet que se ignora.

## Plan de implementación (TDD)

### Fase 1 — Punto de corte
1. Test: con sesión de carga activa y ancho ≥ 1024 → layout `3a`; sin sesión activa y ancho ≥ 1024 → árbol de escritorio (decisión 1).
2. Test: 844 × 390 (teléfono apaisado) **no** recibe el layout de tablet (corte por ancho y alto).
3. Test: sin bug de hidratación — mismo patrón `useViewport` / `SSR_SAFE_DEFAULT`.

### Fase 2 — Layout
4. Test: contador, resultado de última lectura y barra de acciones montan simultáneamente, sin navegación.
5. Test: la página no scrollea; las listas internas sí (decisión 5).
6. Test: `LECTOR LISTO` refleja el estado real del campo (decisión 4).

### Fase 3 — Paridad de comportamiento
7. Test: el bucle de escaneo se comporta igual que `2e` — mismos componentes, mismos 4 motivos de rechazo, campo que se rearma.
8. Test: *Cerrar ruta* y *Despachar* abren las confirmaciones completas de `spec-77` (decisión 3).

### Fase 4 — Cierre
9. `npm run test -- --pool=forks` + mutation-test antes de push.
10. E2E con viewport 1024 × 768.
11. **Verificación física en QA:** la tablet montada, a tres metros, con el lector real. Es el único modo de validar la decisión 2.

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


## Riesgos

- **El corte por viewport puede robarle el escritorio a un jefe de turno** que abra una ruta en carga en un monitor de 1024 px. Mitigado condicionando a la sesión de carga activa (decisión 1), pero es la parte del spec que más merece revisión: equivocarse hace que un jefe de turno pierda su panel.
- **Depende de `spec-76` y `spec-77` ya mergeados.** Si se adelanta, duplica componentes.
- **Legibilidad a distancia no se testea automáticamente.** Sin la verificación física de la fase 4, este spec se puede declarar terminado estando roto para su único caso de uso.
