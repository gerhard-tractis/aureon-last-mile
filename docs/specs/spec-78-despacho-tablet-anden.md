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

## Riesgos

- **El corte por viewport puede robarle el escritorio a un jefe de turno** que abra una ruta en carga en un monitor de 1024 px. Mitigado condicionando a la sesión de carga activa (decisión 1), pero es la parte del spec que más merece revisión: equivocarse hace que un jefe de turno pierda su panel.
- **Depende de `spec-76` y `spec-77` ya mergeados.** Si se adelanta, duplica componentes.
- **Legibilidad a distancia no se testea automáticamente.** Sin la verificación física de la fase 4, este spec se puede declarar terminado estando roto para su único caso de uso.
