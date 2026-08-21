# Spec-62: Recepción en móvil — patio, descarga y acta

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding; fases 4.5 Recepción escritorio y 4.8 móvil), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`route_receptions`, recepción consolidada), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (`open_route_reception`, `unexpected_count`, bloqueo de escaneo de recogida), [spec-43](spec-43-failed-delivery-return-flow.md) (reingresos)

**Status:** in progress

_Date: 2026-08-20_

---

## Goal

Dar a la cuadrilla de andén las tres pantallas de Recepción que hoy solo existen en escritorio, dibujadas para el terreno y no como una condensación de la vista del jefe:

1. **`3i` — patio.** Qué camión espera y cuánto lleva esperando. Una sola acción.
2. **`3q` — descarga.** Escaneo continuo con lector Zebra, sin confirmar bulto por bulto.
3. **`3p` — acta.** Qué quedó registrado al cerrar y qué se dispara con eso.

Más la pantalla que ninguna UI móvil captura hoy: la **nota de discrepancia** antes de cerrar. El servidor la exige cuando faltan paquetes; la UI la exige en más casos que ese, a propósito — ver decisión 5.

El escritorio (`3c` estado inicial, `1e` sesión de conteo) ya está implementado y **no se toca**.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, artboards `3i`, `3q`, `3p` | Geometría, jerarquía y copy |
| `design_handoff_aureon_rebrand/README.md`, secciones *3i*, *3q*, *3p* | Intención de diseño y restricciones de terreno |
| `spec-54` fases 4.5 y 4.8 | Estado del rebranding y precedente móvil de Recogida |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

Los artboards `3r` / `3s` (reingresos agrupados por ruta) **quedan fuera** — ver *No-goals*.

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `3i` Patio, estado inicial | `/app/reception` bajo `lg` | Solo existe el árbol de escritorio (`3c`) |
| `3q` Descarga, escaneo continuo | `/app/reception/route/[routeId]` bajo `lg` | Solo existe el árbol de escritorio (`1e`, tres columnas) |
| Nota de discrepancia | hoja dentro de `3q` | Existe como `Dialog` de escritorio en `FinalizeReceptionButton` |
| `3p` Acta de cierre | `/app/reception/route/[routeId]/completa` (nueva) | No existe: hoy el cierre solo lanza un toast y redirige |

### No-goals

- **`3r` / `3s`, reingresos móviles.** Exigen migración (`return_reception_scans.disposition` + `disposition_reason`) y una decisión de negocio — si el tercer intento fallido obliga a elegir destino, y si esa regla se valida en el servidor. `1k` ya restyleó `ReturnReceptionSession` en móvil (#449), así que el flujo actual no queda roto mientras tanto. Spec aparte.
- **Rediseñar `3c` / `1e`.** Escritorio intacto salvo la redirección de cierre, que pasa a la nueva ruta del acta.
- **Forzar tema oscuro.** Decisión ya tomada en spec-54: el usuario elige.
- **Reabrir una recepción desde móvil.** `reopen_pickup_route` es corrección de hub, no del andén; `ReopenRouteButton` sigue siendo solo de escritorio.

## Decisiones

1. **Rama de árbol completo en `lg` (1024px), con `useIsBelowLg`.** Es el mecanismo que ya usa `/app/pickup` para alternar `PickupMobileView` ↔ `PickupDesktopView`. `useViewport` resuelve el valor en un `useEffect` post-hidratación con `SSR_SAFE_DEFAULT`, precisamente porque leer `matchMedia` en el inicializador de `useState` ya provocó un bug de hidratación en este repo. **No** se usa `useIsMobile` (768px): el árbol de escritorio de Recepción es una grilla de tres columnas que solo respira desde `xl`, y entre 768 y 1024 hoy se ve apretada.
   Estas pantallas son de cuadrilla, no de jefatura: el árbol móvil **no monta** la columna de sincronización, el switcher de rutas ni las tarjetas KPI. No las esconde con CSS — no las renderiza.

2. **Componentes móviles propios del módulo, no primitivos compartidos nuevos.** Recogida no extrajo un shell móvil genérico: tiene `PickupMobileHeader`, `PickupMobileCompactRow`, `PickupMobileFooterActions` dentro de `components/pickup/`. Recepción hace lo mismo bajo `components/reception/`. Se comparte lo que ya es compartido (`ScanField`, `ScanResult`, `StatusBadge`), no se inventa una capa nueva para dos consumidores.

3. **`ScanResult` gana un tono `warn`.** Hoy acepta `status: 'ok' | 'error'`. El discriminador de recepción tiene cuatro salidas y una advertencia, y dos de ellas — `duplicate` y el bulto ajeno — no son ni éxito ni error: el conteo sigue, pero el operario tiene que verlo. Es un cambio aditivo al primitivo de la fase 3 que también sirve a `1d` y `1e`, y es preferible a forkear una tarjeta de resultado propia de recepción.

4. **El acta es una ruta, no un estado en memoria.** `/app/reception/route/[routeId]/completa` sobrevive a un refresco, se puede volver a abrir, y es adonde navega también el escritorio al cerrar. Espeja lo que hace Recogida al cerrar una ruta (`close_pickup_route` → `/app/pickup/route/[id]/qr`). Hoy el cierre de recepción solo deja un toast: el acta no existe en ninguna parte.

5. **La regla de nota obligatoria se extrae a `lib/reception/finalize-rule.ts`, y es más estricta que el servidor a propósito.** Hoy vive dentro de `FinalizeReceptionButton`:

   ```
   matched   := received_count - unexpected_count
   needsNote := matched !== expected_count || unexpected_count > 0
   ```

   **No es un espejo del guard actual.** `complete_route_reception` conserva su definición de spec-47 y solo exige nota cuando `received_count < expected_count`. La migración `20260812000006_spec52_unexpected_count.sql`, PART 3, dice explícitamente que la regla anterior **no** se aplicó ahí y que no hay que "terminar el trabajo": el endurecimiento del servidor es trabajo de fase de contrato (spec-56).

   La asimetría es en la dirección segura: la UI pide nota en casos donde el servidor la aceptaría vacía, nunca al revés. El caso que el servidor deja pasar en silencio es `10 esperados · 10 recibidos · 1 ajeno` — cuadra en crudo, pero un paquete esperado no llegó y uno ajeno sí.

   Consecuencias para el plan, ambas load-bearing:
   - **Ningún test de paridad UI ↔ servidor.** Lo que se testea es la inclusión: todo caso en que el servidor exige nota, la UI también. La igualdad hoy falla y debe fallar.
   - **El endurecimiento del servidor queda fuera de este spec.** Es de spec-56 y traería migración, lo que contradice el "sin migraciones" de más abajo.

   Con dos consumidores (diálogo de escritorio y hoja móvil) la regla no puede estar escrita dos veces. Se extrae con sus tests y ambos la importan.

6. **La barra de pestañas cede en la sesión.** `/app/reception/route` se suma a `MOBILE_IMMERSIVE_PREFIXES`, junto a los tres prefijos de Recogida. `3q` y `3p` tienen barra de acciones fija abajo; apilarla con `MobileTabBar` deja dos barras y roba 60px de la pantalla más densa del módulo. `/app/reception` **sí** conserva las pestañas, con Recepción activa.

7. **El `<h1>` de escritorio no se renderiza en móvil.** Lección de QA en la fase 3h: la cabecera de página siguió montándose junto a la cabecera móvil y a 390px salieron dos títulos. La cabecera de página queda tras `!isBelowLg`.

## Decisiones tomadas durante la implementación

Tres preguntas que aparecieron en revisión y que no se podían resolver dentro de
una tarea, porque cada una toca superficie ya desplegada.

### 1. El piso de 13.5px aplica al dato operativo, no a la identificación

La regla de terreno dice "nada informativo bajo 13.5px". El subtítulo que lleva
el nombre del receptor va en 12.5px, igual que el de Recogida (`PickupMobileHeader`),
que ya está en producción.

**El piso se mantiene en 13.5px para lo que el operario lee y usa** — códigos,
conteos, esperas, números de paquete, todo lo que se lee a distancia con las
manos ocupadas. **No aplica a la identificación secundaria** — quién tiene el
turno abierto, la fecha —, que se lee una vez al empezar y nunca más.

Por qué no al revés: subir solo esta cabecera a 13.5px la separa de su gemela de
Recogida, y dos cabeceras con el mismo trabajo y distinta escala tipográfica es
peor que cualquiera de las dos respuestas. Si algún día el piso se quiere
literal, las dos se mueven juntas y en su propio PR.

### 2. Un camión que espera va en paleta **warning**, no error — en las dos superficies

El mock `3i` dibuja el badge de espera en rojo y este plan lo copió. El
`ArrivalsPanel` de escritorio — que ya está desplegado — pinta exactamente la
misma condición, con la misma constante y la misma comparación, en ámbar.

**Gana el escritorio: warning.** Tres razones:

- **El mismo hecho no puede tener dos colores.** El supervisor mira la tabla de
  llegadas y el receptor mira el teléfono; si una pantalla dice ámbar y la otra
  roja, van a discutir sobre si el camión es urgente en vez de descargarlo.
- **30 minutos es un umbral de atención, no una falla.** En este sistema los
  tres pares semánticos significan algo: warning es "esto necesita atención",
  error es "esto ya falló". Un camión esperando todavía se puede descargar a
  tiempo.
- **El rojo hay que reservarlo.** En la misma pantalla `3i` el bloque de
  diferencias abiertas sí es un error: paquetes que no llegaron y nadie ha
  resuelto. Si la espera también es roja, el operario ve dos alarmas iguales
  donde solo una exige acción distinta.

Se conserva el icono `AlertTriangle` junto a la paleta: el estado sigue viajando
por dos canales.

**Es una desviación deliberada del mock**, registrada aquí y no en un comentario
de componente, para que la próxima persona que compare pantalla y artboard no la
"corrija" de vuelta.

### 3. El contraste de los chips de estado se va a un spec propio

El glifo blanco sobre `--color-status-warning` da ~2.15:1, bajo el 3:1 que pide
WCAG 1.4.11 para elementos no textuales. No lo introdujo este spec — blanco
sobre `--color-status-success` ya venía en ~2.56:1 —, pero `warn` quedó como el
peor de los tres justo en el canal del que depende la regla de dos canales.

Arreglarlo bien significa auditar la paleta completa y tocar todos sus
consumidores: torre, distribución, despacho, recogida. Eso no cabe en un PR de
recepción, y meterlo aquí haría irrevisable un cambio de diseño transversal.
Queda como **spec-63**, con las mediciones ya tomadas.

## Lo que el mock pide y el sistema no tiene

Cada renuncia con su motivo. Ninguna se rellena con un dato inventado.

| Elemento del mock | Qué pasa | Por qué |
|---|---|---|
| `Recepción · Andén 2`, `turno AM` | Se cae. Cabecera: "Recepción" + nombre del receptor e iniciales | No hay andén de recepción ni turnos en el schema. `dock_zones` es distribución, no el andén donde se descarga |
| Barra de estado del teléfono (`12:41`, batería, `EN LÍNEA`) | No se dibuja. En su lugar, el chip real de `useSyncQueue` | Es cromo del sistema operativo. Dibujar una batería falsa es mentir sobre el dispositivo |
| `Zebra TC22 · lector listo` | Se muestra el foco real del `ScanField` ("Lector listo" / "Toca para reactivar el lector") + botón de código manual de 44px | No podemos identificar el modelo del lector. El foco del input sí es real, y es exactamente lo que determina si el gatillo va a aterrizar. **Requiere trabajo**: `ScanField` hoy fuerza el foco al montar y no observa el `blur`, ni tiene entrada manual — ver fase 1 |
| `88 paquetes esperados` antes de abrir | Se muestra solo en rutas ya en patio (`in_transit`) | `expected_count` se congela en `open_route_reception`. Antes de eso no hay expectativa que mostrar |
| `Ver acta de la ruta` (segunda acción de `3p`) | Enlaza a `/app/reception/route/[routeId]/preview` | La pantalla ya es el acta. El botón lleva al detalle de la ruta, que sí es otra cosa |
| `Las 3 cargas de la ruta quedaron cerradas` | Se compone desde `snapshot.manifests.length` | Es un efecto real de `trg_route_receptions_status_sync`, no texto fijo |

## Pantallas

### `3i` — Patio (`/app/reception` bajo `lg`)

Datos: `useIncomingRoutes(operatorId, 'in_transit')` (patio), `'in_progress'` (en camino) y `useOpenDiscrepancies`. La espera se deriva de `pickup_routes.in_transit_at` con `minutesSince`, el helper que hoy es privado dentro de `arrivals.ts` y que este spec mueve a `lib/reception/reception-mobile-helpers.ts` para que las dos pantallas lo compartan — se reutiliza, no se recalcula.

- **Héroe** = la ruta en patio que más espera. Código `PR-…` en mono 30px, conductor y patente, `N paquetes esperados`, badge de espera en paleta error sobre `YARD_WAIT_WARNING_MINUTES`. Acción **Iniciar conteo**, 64px → `/app/reception/route/[id]`. Navega directo: una ruta `in_transit` ya tiene su recepción abierta.
  El héroe recibe el `IncomingRoute` crudo, **no** el `ArrivalRow`: `buildArrivals` no propaga `plate`, y la patente es lo que el receptor coteja contra el camión que tiene delante. `ArrivalRow` sigue alimentando la espera y el estado.
- **También en patio**: el resto, filas de 56px con chevron.
- **Diferencias abiertas**: bloque en paleta error desde `useOpenDiscrepancies`. *Resolver* abre el acta de esa recepción (`/completa`), que es donde están las cuatro cifras y la nota. Requiere sumar `pickup_route_id` al `select` del hook y `routeId` a `OpenDiscrepancy` — hoy solo devuelve el id de la recepción y el código de ruta, con los que no se puede construir la URL. No se inventa una acción de "resolver" que hoy no existe en ninguna capa: el botón lleva a leer el caso, no lo cierra.
- **Reingresos**: sección propia bajo las diferencias, con `ReturnRouteList` → `ReturnReceptionSession`, los mismos componentes que hoy monta la pestaña Retornos del escritorio. **No es una pantalla nueva** — `1k` ya los restyleó para móvil (#449) —, pero sí un punto de entrada obligatorio: `/app/reception/page.tsx` es el **único** lugar del que cuelgan, así que un árbol móvil que no los monte deja los reingresos inalcanzables bajo 1024px. `3r`/`3s` reemplazarán esta sección cuando se abran.
- **Pie fijo**: *Escanear QR de ruta* (`RouteQRScannerEntry` en hoja a pantalla completa) y *Recibir sin QR*.
  `ReceiveWithoutQRButton` exige `{ routeId, code, plate }` y hoy solo se monta en la página de una ruta concreta (`/route/[routeId]/preview`), así que **no puede vivir tal cual en un pie sin ruta seleccionada**. El pie abre `ReceiveWithoutQRSheet`: lista las rutas `in_progress` (en camino, sin QR escaneado) con código, conductor y patente; al elegir una, monta el `ReceiveWithoutQRButton` existente con su confirmación, sin duplicar la mutación ni el texto de advertencia. Es el caso real — el camión llegó y el QR está ilegible o el conductor no lo trae.
  Estos dos son los únicos caminos que pueden llamar a `open_route_reception`, que congela `expected_count` y bloquea el escaneo de recogida del conductor: nunca se invoca al montar.
- Sin tarjetas KPI y sin conmutador de tema, como pide el mock.
- Vacío: `EmptyState` con `ArrowUpDown` — "Ningún camión en patio", y el pie sigue disponible.

### `3q` — Descarga (`/app/reception/route/[routeId]` bajo `lg`)

Datos: `useRouteReceptionSnapshot`, `useReceptionScan`, `useSyncQueue`. Mutaciones sin cambios.

- **Cabecera fija**: `PR-…`, conductor, `61 / 88` en mono 26px y barra de 8px. Chip de cola cuando `useSyncQueue` no está `online`, con la redacción del handoff: *"Se guardan en el dispositivo y se envían solos al recuperar señal."*
- **`ScanField size="sm"`** (62px), siempre enfocado, con `useScannerAutoSubmit` para el lector de QA que no manda sufijo Enter. El primitivo gana una prop opcional `onFocusStateChange`: sin ella se comporta igual que hoy, con ella informa foco/blur para que la sesión pueda decir "Lector listo" o "Toca para reactivar el lector". Un lector que dispara contra un input desenfocado pierde escaneos en silencio, y hoy nada lo delata.
- **Código manual**: botón de 44px junto al estado del lector que abre `ManualCodeSheet` — la única entrada táctil de la pantalla, para etiqueta ilegible. Envía por la misma mutación que el lector.
- **Bloque de resultado persistente** (`ScanResult`), hasta el siguiente escaneo. Hoy la página lo borra con un `setTimeout` de 3s; el handoff pide lo contrario y esa línea se elimina en móvil y escritorio.

  | `scanResult` | Tono | Titular |
  |---|---|---|
  | `received` | ok | `RECIBIDO` + contador |
  | `received` con `unexpected` | warn | `AJENO · NO VENÍA EN ESTA RUTA` |
  | `duplicate` | warn | `YA ESCANEADO` + hora del primero |
  | `not_found` | error | `NO ESTÁ EN LA RUTA` |
  | `route_mismatch` | error | `ES DE OTRA RUTA` |

  La hora del primer escaneo en el caso `duplicate` sale de `snapshot.scans` — el escaneo previo con ese `barcode` —, no del validador: su rama `duplicate` selecciona solo `id` y no devuelve marca de tiempo. Si no está en el snapshot, el titular va sin hora; no se inventa.

- **Historial** desde `snapshot.scans`, más reciente arriba, con chips `AJENO` / `REPETIDO`. Ningún resultado bloquea el flujo: se registra, se marca y el conteo sigue.
- **Pie fijo**: *Reportar discrepancia* (abre la hoja de nota) y *Confirmar*, 56px. *Confirmar* aplica `needsNote` de `finalize-rule.ts`: si es falso llama `complete_route_reception` con `null`; si es verdadero abre la hoja.
- **Hoja de nota**: `Sheet` inferior a pantalla completa, textarea, el conteo que la motiva ("faltan 2 · 1 ajeno") y confirmación. Sin texto no cierra — por la regla de la decisión 5, que es más estricta que el guard del servidor: en el caso que se compensa (`10 esperados · 10 recibidos · 1 ajeno`) el servidor aceptaría la nota vacía y la hoja no.

### `3p` — Acta (`/app/reception/route/[routeId]/completa`, nueva)

Lee el snapshot ya completado. Cuatro cifras que son columnas reales de `route_receptions`: `expected_count`, `received_count`, la diferencia, y `unexpected_count`. Debajo, `discrepancy_notes` tal como quedó guardada; luego *Qué pasa ahora* compuesto desde el snapshot (manifiestos cerrados, paquetes que pasan a clasificación, diferencias abiertas); y la siguiente ruta en patio si la hay. Pie: *Volver a recepción* (60px) y *Ver detalle de la ruta* → `/preview`.

El escritorio también aterriza aquí al cerrar, en vez del toast actual.

## Arquitectura de archivos

Todo bajo 300 líneas. Espeja `PickupMobile*`.

```
app/app/reception/page.tsx                     M  rama useIsBelowLg; <h1> tras !isBelowLg
app/app/reception/route/[routeId]/page.tsx     M  rama useIsBelowLg; quita el setTimeout de 3s
app/app/reception/route/[routeId]/completa/page.tsx   A  3p

components/reception/ReceptionMobileView.tsx        A  3i
components/reception/ReceptionMobileHeader.tsx      A
components/reception/ReceptionMobileYardCard.tsx    A  héroe + Iniciar conteo
components/reception/ReceptionMobileCompactRow.tsx  A
components/reception/ReceptionMobileFooterActions.tsx A
components/reception/ReceiveWithoutQRSheet.tsx      A  selector de ruta in_progress
components/reception/ReceptionMobileSession.tsx     A  3q
components/reception/ReceptionScanFeedback.tsx      A  mapea scanResult → props de ScanResult
components/reception/ManualCodeSheet.tsx            A  entrada manual de código
components/reception/DiscrepancyNoteSheet.tsx       A
components/reception/ReceptionReceipt.tsx           A  cuerpo de 3p
components/reception/FinalizeReceptionButton.tsx    M  importa finalize-rule
components/scan/ScanResult.tsx                      M  tono warn
components/scan/ScanField.tsx                       M  onFocusStateChange opcional
components/sidebar/navigation.ts                    M  /app/reception/route inmersiva

lib/reception/finalize-rule.ts                      A  needsNote / matched / missing
lib/reception/reception-mobile-helpers.ts           A  iniciales, hora, etiquetas de espera
```

Nombres en kebab-case, que es la convención de `lib/reception/` en disco (`reception-scan-validator.ts`, `route-ref.ts`).

Hooks: ninguno nuevo. `useIncomingRoutes`, `useRouteReceptionSnapshot`, `useReceptionScan`, `useCompleteRouteReception`, `useSyncQueue`, `useIsBelowLg`, `useCurrentUserName` se consumen tal cual. `useOpenDiscrepancies` es el único que se toca: suma `pickup_route_id` al `select` y `routeId` a `OpenDiscrepancy`, para poder enlazar el acta.

Base de datos: **sin migraciones**. Todo sale de columnas y RPCs existentes.

## Reglas de terreno (obligatorias en las tres pantallas)

- Ninguna zona táctil bajo **44px**; acción primaria 56–64px.
- Nada informativo bajo **13.5px**; primario 15–17px.
- Todo número comparable en `font-mono` con `tabular-nums`.
- Cada estado por dos canales: color **y** icono o forma.
- Ninguna acción se bloquea por estar sin conexión; el texto dice qué pasa con el trabajo hecho.
- `prefers-reduced-motion` respetado; el resultado de escaneo aparece sin animación de entrada (máx. 120ms).

## Testing

TDD, con Vitest + Testing Library, siguiendo el patrón de `PickupMobileView.test.tsx`. Cobertura sobre 70%.

- `finalize-rule.test.ts` — la tabla completa, incluido el caso `10 esperados · 10 recibidos · 1 ajeno` que exige nota pese a cuadrar en crudo. Y el test de **inclusión**, no de paridad: todo caso en que el servidor exigiría nota (`received < expected`) la UI también la exige. La igualdad con el servidor no se testea porque hoy no se cumple, por diseño (decisión 5).
- `ReceptionMobileView.test.tsx` — el héroe es la ruta que más espera y muestra la patente; sin rutas en patio va a vacío; *Iniciar conteo* navega; el pie no llama a `open_route_reception` al montar.
- `ReceiveWithoutQRSheet.test.tsx` — lista solo rutas `in_progress`; elegir una monta la confirmación existente; cerrar sin elegir no muta nada.
- `ReceptionScanFeedback.test.tsx` — las cinco filas de la tabla de tonos.
- `ReceptionMobileSession.test.tsx` — el bloque persiste tras un segundo escaneo; *Confirmar* sin diferencias cierra sin hoja; con diferencias la abre y no cierra sin texto.
- `ReceptionReceipt.test.tsx` — las cuatro cifras salen del snapshot; sin nota no se inventa el bloque.
- `navigation.test.ts` — `/app/reception/route/x` es inmersiva; `/app/reception` no.
- E2E Playwright contra QA a 390×844: patio → conteo → confirmar con faltante → acta.

Vitest no corre en esta máquina (Norton bloquea los workers): validación local con `tsc --noEmit` y `eslint`; los tests corren en CI.

## Fases

Un PR por fase, con auto-merge.

| Fase | Alcance |
|---|---|
| **1 — Base compartida** | `finalize-rule.ts` extraído con tests, `ScanResult` tono `warn`, `ScanField` con `onFocusStateChange`, `/app/reception/route` inmersiva, `reception-mobile-helpers.ts`, `pickup_route_id` en `useOpenDiscrepancies`. Sin cambios visibles salvo el estado del lector. |
| **2 — `3i` patio** | `ReceptionMobileView` y sus componentes, incluido `ReceiveWithoutQRSheet`; rama en `page.tsx`. |
| **3 — `3q` descarga + nota** | `ReceptionMobileSession`, `ReceptionScanFeedback`, `ManualCodeSheet`, `DiscrepancyNoteSheet`; rama en la página de sesión; se elimina el auto-ocultado de 3s. |
| **4 — `3p` acta** | Ruta nueva, `ReceptionReceipt`, y la redirección de cierre en ambos árboles. |
| **5 — E2E** | Playwright móvil contra QA. |

## Preguntas abiertas

1. **Reingresos (`3r`/`3s`).** Al abrirlos hay que decidir con el negocio si el tercer intento fallido obliga a elegir destino y si esa regla se valida en el servidor — hoy no hay RPC de cierre para reingresos.
2. **El endurecimiento de `complete_route_reception`.** La regla `matched`/`unexpected_count` sigue pendiente en el servidor desde spec-52 y pertenece a spec-56 (fase de contrato). Mientras no aterrice, la UI es la única que la aplica: un cliente que llame la RPC directamente puede cerrar sin nota un caso que la UI habría bloqueado.
3. **Rutas en patio simultáneas.** El mock asume una en curso; el schema no lo impide. La sesión es por ruta, así que abrir una segunda no rompe nada, pero conviene confirmar si operaciones quiere permitirlo o advertirlo.

---

# Plan de implementación

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a la cuadrilla de andén las tres pantallas móviles de Recepción — patio (`3i`), descarga con escaneo continuo (`3q`) y acta de cierre (`3p`) — más la captura de la nota de discrepancia, sin tocar el árbol de escritorio y sin migraciones.

**Architecture:** Mismas URLs. Cada página elige un árbol completo con `useIsBelowLg()` (1024px), igual que `/app/pickup` alterna `PickupMobileView` ↔ `PickupDesktopView`. Los componentes móviles son propios del módulo (`components/reception/ReceptionMobile*`), la lógica pura vive en `lib/reception/*.ts` con tests unitarios, y los hooks existentes se consumen sin cambios salvo una columna añadida a `useOpenDiscrepancies`.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind + shadcn-ui · TanStack Query · Supabase · Vitest + Testing Library · Playwright.

## Cómo verificar cada paso

Desde `apps/frontend/`:

| Qué | Comando |
|---|---|
| Un test | `npx vitest run src/ruta/al/Archivo.test.tsx` |
| Tipos | `npm run type-check` |
| Lint | `npm run lint` |
| Todo | `npm run test:run` |

**Si Vitest no arranca en esta máquina** (los workers quedan bloqueados por el antivirus — es un problema conocido del entorno, no del test): no lo pelees. Verifica con `npm run type-check` y `npm run lint`, y deja que CI corra la suite en el PR. **Nunca** declares un test como pasando sin haber visto la salida, ni local ni en CI.

## Convenciones que este plan da por sentadas

- **Un PR por chunk**, con `gh pr create` seguido de `gh pr merge --auto --squash`. Nunca push directo a `main`.
- **Una rama por chunk**, creada desde `main` recién actualizado, no encadenada sobre la anterior:

  ```bash
  git fetch origin && git checkout -b feat/spec-62-chunkN-<nombre> origin/main
  ```

  Los chunks son secuenciales — cada uno usa lo que el anterior mergeó —, así que empezar el siguiente antes de que el anterior esté en `main` obliga a rebasar. El spec y su plan viven en la rama `docs/spec-62-reception-mobile`, que es aparte del código.
- Archivos bajo 300 líneas. Si uno se pasa, pártelo por responsabilidad.
- Español de Chile en toda la UI. Números comparables en `font-mono`.
- Todo componente nuevo lleva su `.test.tsx` al lado.
- **Los comentarios de código y los nombres de test van en INGLÉS.** El español es
  solo para texto que el usuario ve renderizado: literales de UI, `aria-label`,
  mensajes. Es la convención del repo — mira `ScanField.tsx`, `useViewport.ts`,
  `MobileTabBar.tsx` o cualquier `*.test.tsx` existente.

  > **Los fragmentos de código de este plan tienen los `it()` y algunos
  > comentarios en español.** Está mal y es un defecto del plan, no una
  > excepción a la regla: se escribieron así por inercia al redactarlo en
  > español. Cinco tareas seguidas lo copiaron fielmente y cinco revisiones lo
  > devolvieron. **Traduce al implementar** — el contenido del comentario es lo
  > que importa, el idioma del snippet no.
- **Cada estado va por dos canales, color Y forma.** Nunca solo color: un badge
  que distingue "atrasado" de "en tiempo" cambiando únicamente la paleta es
  invisible para un receptor daltónico y en una foto en escala de grises. Si
  añades un estado, añade también su icono o su forma — y aféctalo en el test,
  porque un icono que nunca se renderiza pasa igual un test que solo compara
  clases de color.

---

## Chunk 1: Base compartida (fase 1)

Sin cambios visibles salvo el estado del lector. Es lo que las tres pantallas necesitan que exista antes.

### Task 1: Extraer la regla de cierre a `lib/reception/finalize-rule.ts`

Hoy vive dentro de `FinalizeReceptionButton` y va a tener un segundo consumidor (la hoja móvil). Lee la decisión 5 del spec antes de escribir: la regla es **deliberadamente más estricta** que el guard del servidor.

**Files:**
- Create: `apps/frontend/src/lib/reception/finalize-rule.ts`
- Create: `apps/frontend/src/lib/reception/finalize-rule.test.ts`
- Modify: `apps/frontend/src/components/reception/FinalizeReceptionButton.tsx:65-68`

- [ ] **Step 1: Escribe el test que falla**

```ts
// apps/frontend/src/lib/reception/finalize-rule.test.ts
import { describe, it, expect } from 'vitest';
import { finalizeRule, serverRequiresNote } from './finalize-rule';

describe('finalizeRule', () => {
  it('no pide nota cuando todo lo esperado llegó y nada ajeno entró', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 10, unexpectedCount: 0 });
    expect(r).toEqual({ matched: 10, missing: 0, needsNote: false });
  });

  it('pide nota cuando faltan paquetes', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 8, unexpectedCount: 0 });
    expect(r).toEqual({ matched: 8, missing: 2, needsNote: true });
  });

  // El caso que el conteo crudo esconde: cuadra en total, pero un paquete
  // esperado no llegó y uno de otro camión sí. Es exactamente para lo que
  // existe el reporte de discrepancia.
  it('pide nota cuando las cifras se compensan entre sí', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 10, unexpectedCount: 1 });
    expect(r.matched).toBe(9);
    expect(r.missing).toBe(1);
    expect(r.needsNote).toBe(true);
  });

  it('nunca reporta faltantes negativos', () => {
    const r = finalizeRule({ expectedCount: 5, receivedCount: 9, unexpectedCount: 0 });
    expect(r.missing).toBe(0);
    expect(r.needsNote).toBe(true);
  });
});

describe('la relación con el guard del servidor', () => {
  // NO se testea paridad: complete_route_reception conserva el guard de
  // spec-47 (received < expected) y la regla matched/unexpected quedó
  // diferida a spec-56 — ver decisión 5 del spec y la PART 3 de
  // 20260812000006_spec52_unexpected_count.sql. Lo que sí debe cumplirse
  // siempre es la INCLUSIÓN: donde el servidor exige nota, la UI también.
  // Si esto se rompe, la recepción queda sin poder cerrarse: el servidor
  // levanta la excepción y la UI nunca abrió la hoja para escribir la nota.
  it('exige nota en todos los casos en que el servidor la exigiría', () => {
    for (let expectedCount = 0; expectedCount <= 6; expectedCount++) {
      for (let receivedCount = 0; receivedCount <= 6; receivedCount++) {
        for (let unexpectedCount = 0; unexpectedCount <= receivedCount; unexpectedCount++) {
          const counts = { expectedCount, receivedCount, unexpectedCount };
          if (serverRequiresNote(counts)) {
            expect(finalizeRule(counts).needsNote).toBe(true);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/lib/reception/finalize-rule.test.ts`
Expected: FAIL — `Failed to resolve import "./finalize-rule"`.

- [ ] **Step 3: Implementación mínima**

```ts
// apps/frontend/src/lib/reception/finalize-rule.ts
/**
 * Cuándo cerrar una recepción exige nota de discrepancia.
 *
 * Vivía dentro de FinalizeReceptionButton; se extrajo al aparecer el segundo
 * consumidor (la hoja móvil de spec-62). Una regla con dos consumidores no
 * puede estar escrita dos veces.
 *
 * POR QUÉ NO ES received < expected. spec-52 acepta un paquete que llega sin
 * retiro verificado en esa ruta: incrementa received_count Y unexpected_count,
 * así que los dos errores se compensan y el conteo crudo cuadra:
 *
 *   10 esperados · 10 recibidos · 1 ajeno
 *     -> cuadra, y sin embargo UN paquete esperado no llegó y UNO de otro
 *        camión sí. Comparar totales lo deja pasar en silencio.
 *
 * Separar las poblaciones no lo deja pasar:
 *   matched   := received - unexpected
 *   needsNote := matched !== expected || unexpected > 0
 *
 * ASIMETRÍA DELIBERADA CON EL SERVIDOR. complete_route_reception conserva el
 * guard de spec-47 (`received_count < expected_count`); la regla de arriba
 * quedó explícitamente diferida — ver PART 3 de
 * 20260812000006_spec52_unexpected_count.sql — y es trabajo de spec-56. La UI
 * pide nota en más casos que el servidor, nunca en menos: esa dirección es la
 * segura. La inversa dejaría la recepción sin poder cerrarse.
 */
export interface ReceptionCounts {
  expectedCount: number;
  receivedCount: number;
  unexpectedCount: number;
}

export interface FinalizeDecision {
  /** Esperados que efectivamente llegaron. */
  matched: number;
  /** Esperados que no llegaron. Nunca negativo. */
  missing: number;
  needsNote: boolean;
}

export function finalizeRule({
  expectedCount,
  receivedCount,
  unexpectedCount,
}: ReceptionCounts): FinalizeDecision {
  const matched = receivedCount - unexpectedCount;
  return {
    matched,
    missing: Math.max(0, expectedCount - matched),
    needsNote: matched !== expectedCount || unexpectedCount > 0,
  };
}

/**
 * Lo que el servidor exige HOY, ni más ni menos. Existe para que el test de
 * inclusión pueda nombrarlo; no lo uses para decidir en la UI.
 */
export function serverRequiresNote({ expectedCount, receivedCount }: ReceptionCounts): boolean {
  return receivedCount < expectedCount;
}
```

- [ ] **Step 4: Córrelo y confirma que pasa**

Run: `npx vitest run src/lib/reception/finalize-rule.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Haz que `FinalizeReceptionButton` importe la regla**

Reemplaza las tres líneas de cálculo (`matchedCount` / `needsNotes` / `missingCount`) por:

```tsx
import { finalizeRule } from '@/lib/reception/finalize-rule';
// ...
const { missing: missingCount, needsNote: needsNotes } = finalizeRule({
  expectedCount,
  receivedCount,
  unexpectedCount,
});
```

`matchedCount` queda sin uso propio en el componente: bórralo. El bloque de comentario largo que documenta la regla se va con ella al módulo nuevo — deja en el componente solo un puntero de una línea a `finalize-rule.ts`.

- [ ] **Step 6: La suite existente del botón debe seguir verde sin tocarla**

Run: `npx vitest run src/components/reception/FinalizeReceptionButton.test.tsx`
Expected: PASS. Si algún test falla, es que la extracción cambió el comportamiento — arregla el código, no el test.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reception/finalize-rule.ts src/lib/reception/finalize-rule.test.ts src/components/reception/FinalizeReceptionButton.tsx
git commit -m "refactor(spec-62): extraer la regla de cierre de recepción a finalize-rule"
```

### Task 2: `ScanResult` gana el tono `warn`

`duplicate` y el bulto ajeno no son éxito ni error: el conteo sigue, pero el operario tiene que verlo.

**Files:**
- Modify: `apps/frontend/src/components/scan/ScanResult.tsx`
- Modify: `apps/frontend/src/components/scan/ScanResult.test.tsx`

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('el tono warn cambia color e icono a la vez', () => {
  // Misma regla que ya cubre ok/error: cada estado por dos canales. Un tercer
  // tono que reusara el check de ok sería indistinguible en una foto en
  // escala de grises.
  render(<ScanResult status="warn" title="YA ESCANEADO" timestamp="12:58" />);
  expect(screen.getByText('YA ESCANEADO')).toBeInTheDocument();
  expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
  expect(screen.queryByTestId('scan-result-icon-ok')).not.toBeInTheDocument();
  expect(screen.queryByTestId('scan-result-icon-error')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/scan/ScanResult.test.tsx`
Expected: FAIL — TypeScript rechaza `status="warn"` y no existe `scan-result-icon-warn`.

- [ ] **Step 3: Implementa**

1. `type ScanStatus = 'ok' | 'warn' | 'error';`
2. Añade a `TONE`:

```ts
warn: {
  box: 'bg-status-warning-bg border-status-warning-border',
  icon: 'bg-status-warning',
  text: 'text-status-warning-text',
},
```

3. Añade un `WarnIcon` con `data-testid="scan-result-icon-warn"` — exclamación en círculo (`<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>`), mismo tamaño y `stroke="#fff"` que los otros dos.
4. Reemplaza el ternario `status === 'ok' ? <CheckIcon /> : <CrossIcon />` por una selección de tres.

- [ ] **Step 4: Corre los tests y los tipos**

Run: `npx vitest run src/components/scan/ScanResult.test.tsx && npm run type-check`
Expected: PASS. Los consumidores actuales (`1d`, `1e`, `1h`) no cambian: el tipo se amplía, no se rompe.

- [ ] **Step 5: Commit**

```bash
git add src/components/scan/ScanResult.tsx src/components/scan/ScanResult.test.tsx
git commit -m "feat(spec-62): tono warn en el bloque de resultado de escaneo"
```

### Task 3: `ScanField` informa si tiene el foco

Un lector que dispara contra un input desenfocado pierde escaneos en silencio, y hoy nada lo delata.

**Files:**
- Modify: `apps/frontend/src/components/scan/ScanField.tsx`
- Modify: `apps/frontend/src/components/scan/ScanField.test.tsx`

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('informa cuando pierde y recupera el foco', async () => {
  const onFocusStateChange = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <ScanField onScan={vi.fn()} onFocusStateChange={onFocusStateChange} />
      <button type="button">roba el foco</button>
    </>,
  );
  // El efecto de montaje enfoca el input: el primer aviso es `true`.
  expect(onFocusStateChange).toHaveBeenLastCalledWith(true);

  await user.click(screen.getByRole('button', { name: 'roba el foco' }));
  expect(onFocusStateChange).toHaveBeenLastCalledWith(false);
});

```

> **Corrección tras la implementación.** Este paso pedía además un segundo test:
> `expect(() => render(<ScanField onScan={vi.fn()} />)).not.toThrow()`, con el
> comentario "los tres consumidores actuales no la pasan". Ambas cosas estaban mal
> y se corrigieron al implementar la fase 1:
>
> - **Los consumidores son dos**, no tres: `QuickSortScanner.tsx` y
>   `ReturnReceptionSession.tsx`.
> - **El test era una tautología.** Pasaba antes de que `onFocusStateChange`
>   existiera y ningún cambio salvo un crash podía ponerlo rojo. Parecía cobertura
>   de compatibilidad hacia atrás sin garantizar nada, que es la clase de test
>   peligrosa: invita a creer que hay una garantía donde no la hay. Se eliminó.
>   Lo que sí cubre esa garantía son los 11 tests preexistentes que no pasan la
>   prop, más `tsc --noEmit`.
>
> No lo reintroduzcas si vuelves a ejecutar esta tarea.

`ScanField.test.tsx` hoy importa `render, screen, fireEvent, act`. Añade `import userEvent from '@testing-library/user-event'` — la dependencia ya está instalada.

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/scan/ScanField.test.tsx`
Expected: FAIL — la prop no existe.

- [ ] **Step 3: Implementa**

Añade a `ScanFieldProps`:

```ts
/**
 * Avisa cuando el campo gana o pierde el foco. Un lector de mano escribe en
 * lo que esté enfocado: sin foco, el gatillo dispara y no se registra nada.
 * La pantalla que la pasa muestra "Lector listo" o "Toca para reactivar el
 * lector" (spec-62, mock 3q).
 */
onFocusStateChange?: (focused: boolean) => void;
```

Y en el `<input>`: `onFocus={() => onFocusStateChange?.(true)}` y `onBlur={() => onFocusStateChange?.(false)}`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/scan/ScanField.test.tsx && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scan/ScanField.tsx src/components/scan/ScanField.test.tsx
git commit -m "feat(spec-62): ScanField avisa si el lector va a aterrizar o no"
```

### Task 4: La sesión de recepción es una ruta inmersiva

`3q` y `3p` tienen barra de acciones fija abajo. Apilarles `MobileTabBar` deja dos barras y roba 60px de la pantalla más densa del módulo.

**Files:**
- Modify: `apps/frontend/src/components/sidebar/navigation.ts:241-245`
- Modify: `apps/frontend/src/components/sidebar/navigation.test.ts`

- [ ] **Step 1: Escribe el test que falla**

```ts
it('la sesión de recepción es inmersiva, el listado de patio no', () => {
  // El listado necesita las pestañas: es donde el operario cambia de módulo.
  // La sesión y el acta tienen su propia barra fija de acciones.
  expect(isImmersiveMobileRoute('/app/reception')).toBe(false);
  expect(isImmersiveMobileRoute('/app/reception/route/abc-123')).toBe(true);
  expect(isImmersiveMobileRoute('/app/reception/route/abc-123/completa')).toBe(true);
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/sidebar/navigation.test.ts`
Expected: FAIL — las dos últimas dan `false`.

- [ ] **Step 3: Implementa**

Añade `'/app/reception/route'` a `MOBILE_IMMERSIVE_PREFIXES` y extiende el comentario del bloque nombrando por qué (barra de acciones fija propia en `3q`/`3p`).

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/sidebar/navigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/navigation.ts src/components/sidebar/navigation.test.ts
git commit -m "feat(spec-62): la sesión de recepción no apila barra de pestañas"
```

### Task 5: `useOpenDiscrepancies` devuelve la ruta

Sin `pickup_route_id` no se puede construir el enlace al acta: el hook solo trae el id de la recepción y el código de la ruta.

**Files:**
- Modify: `apps/frontend/src/hooks/reception/useOpenDiscrepancies.ts`
- Create: `apps/frontend/src/hooks/reception/useOpenDiscrepancies.test.ts`

- [ ] **Step 1: Escribe el test que falla** — mockea el cliente de Supabase igual que `useIncomingRoutes.test.ts` y afirma que una fila con `pickup_route_id: 'r1'` produce `routeId: 'r1'`, y que el `delta` sigue derivándose de `expected - received`.

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/hooks/reception/useOpenDiscrepancies.test.ts`
Expected: FAIL — `routeId` es `undefined`.

- [ ] **Step 3: Implementa** — añade `pickup_route_id` al `select`, al tipo `Row`, y `routeId: string` a `OpenDiscrepancy`. Es una columna `NOT NULL` con FK en `route_receptions`, así que no necesita fallback.

- [ ] **Step 4: Corre los tests y los tipos**

Run: `npx vitest run src/hooks/reception/ && npm run type-check`
Expected: PASS. `PendingResolutionPanel` (escritorio) no cambia: solo recibe un campo más.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/reception/useOpenDiscrepancies.ts src/hooks/reception/useOpenDiscrepancies.test.ts
git commit -m "feat(spec-62): las diferencias abiertas conocen su ruta"
```

### Task 6: `lib/reception/reception-mobile-helpers.ts`

**Files:**
- Create: `apps/frontend/src/lib/reception/reception-mobile-helpers.ts`
- Create: `apps/frontend/src/lib/reception/reception-mobile-helpers.test.ts`
- Modify: `apps/frontend/src/app/app/reception/arrivals.ts` (mueve `timeLabel` y `minutesSince`, e impórtalos)

- [ ] **Step 1: Escribe el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { receptionInitials, waitLabel, timeLabel, minutesSince } from './reception-mobile-helpers';

describe('receptionInitials', () => {
  it('toma la inicial del nombre y del apellido', () => {
    expect(receptionInitials('Paulina Valdés')).toBe('PV');
  });
  it('con un solo nombre da una letra', () => {
    expect(receptionInitials('Paulina')).toBe('P');
  });
  it('sin nombre no inventa iniciales', () => {
    expect(receptionInitials(null)).toBe('—');
  });
});

describe('waitLabel', () => {
  it('bajo una hora habla en minutos', () => {
    expect(waitLabel(41)).toBe('41 min');
  });
  it('sobre una hora habla en horas y minutos', () => {
    expect(waitLabel(95)).toBe('1 h 35 min');
  });
  it('sin hora de llegada no hay espera que mostrar', () => {
    expect(waitLabel(null)).toBeNull();
  });
});

describe('timeLabel', () => {
  it('devuelve null ante una fecha inválida en vez de "Invalid Date"', () => {
    expect(timeLabel('no-es-una-fecha')).toBeNull();
  });
});

describe('minutesSince', () => {
  const now = new Date('2026-08-20T13:00:00Z');
  it('cuenta los minutos desde la llegada', () => {
    expect(minutesSince('2026-08-20T12:19:00Z', now)).toBe(41);
  });
  it('sin llegada no hay espera', () => {
    expect(minutesSince(null, now)).toBeNull();
  });
  it('nunca devuelve una espera negativa por relojes desfasados', () => {
    expect(minutesSince('2026-08-20T13:05:00Z', now)).toBe(0);
  });
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/lib/reception/reception-mobile-helpers.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementa** los cuatro helpers.

  `timeLabel` y `minutesSince` **ya existen**, privados, dentro de `arrivals.ts` (`toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })` con `null` ante fecha inválida, y `Math.max(0, floor((now - at) / 60_000))`). **Muévelos** aquí, expórtalos, y haz que `arrivals.ts` los importe. No los dupliques: `minutesSince` es de donde sale el `waitingMinutes` de toda la pantalla de patio, y una segunda copia de esa aritmética se desincroniza en la primera corrección.

  `lib/pickup/pickupMobileHelpers.ts` ya tiene su propio `timeLabel` y su `driverInitials`. No los importes desde aquí: los componentes móviles son propios de cada módulo (decisión 2 del spec), y un import cruzado Recepción → Recogida ata dos módulos por un formateo de tres líneas. Deja un comentario de una línea en el archivo nuevo diciendo esto, o el próximo revisor lo preguntará.

- [ ] **Step 4: Corre los tests del módulo entero**

Run: `npx vitest run src/lib/reception/ src/app/app/reception/arrivals.test.ts`
Expected: PASS — incluidos los tests de `arrivals.ts`, que no deben tocarse.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reception/reception-mobile-helpers.ts src/lib/reception/reception-mobile-helpers.test.ts src/app/app/reception/arrivals.ts
git commit -m "feat(spec-62): helpers de presentación para recepción móvil"
```

### Task 7: Cierra el chunk

- [ ] **Step 1: Verifica todo**

Run: `npm run type-check && npm run lint && npm run test:run`
Expected: PASS. Si Vitest no arranca localmente, corre los dos primeros y deja que CI corra el tercero.

- [ ] **Step 2: PR con auto-merge**

```bash
git push -u origin feat/spec-62-chunk1-base
gh pr create --title "feat(spec-62): base compartida para Recepción móvil (fase 1)" --body "Chunk 1 del plan de spec-62. Sin cambios visibles salvo el estado del lector."
gh pr merge --auto --squash
```

- [ ] **Step 3: Espera el merge** — `gh pr checks <N>` y `gh pr view <N> --json state,mergedAt`. No sigas al chunk 2 hasta que esté mergeado.

---

## Chunk 2: `3i` — patio (fase 2)

Todo bajo `components/reception/`, mismo patrón que `PickupMobile*`. Ninguna acción de este chunk llama `open_route_reception` al montar.

### Task 8: `ReceptionMobileHeader`

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionMobileHeader.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileHeader.test.tsx`

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('muestra el título, el nombre del receptor y sus iniciales', () => {
  render(<ReceptionMobileHeader userName="Paulina Valdés" />);
  expect(screen.getByRole('heading', { name: 'Recepción' })).toBeInTheDocument();
  expect(screen.getByText(/Paulina Valdés/)).toBeInTheDocument();
  expect(screen.getByTestId('reception-mobile-avatar')).toHaveTextContent('PV');
});

it('sin nombre no inventa turno ni andén', () => {
  // El mock dice "Recepción · Andén 2 · turno AM": ninguno de los dos existe
  // en el schema (ver la tabla de renuncias del spec). No se rellenan.
  render(<ReceptionMobileHeader userName={null} />);
  expect(screen.queryByText(/turno/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/andén/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionMobileHeader.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementa** — `<h2>` "Recepción" en `font-heading text-[22px] font-semibold`, subtítulo con el nombre en `text-[12.5px] text-text-secondary`, y avatar de 40px `rounded-full border border-border bg-surface-raised` con `receptionInitials(userName)` y `data-testid="reception-mobile-avatar"`. Espeja `PickupMobileHeader.tsx`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceptionMobileHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionMobileHeader.tsx src/components/reception/ReceptionMobileHeader.test.tsx
git commit -m "feat(spec-62): cabecera móvil de Recepción"
```

### Task 9: `ReceptionMobileYardCard` — el héroe

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionMobileYardCard.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileYardCard.test.tsx`

Props: `{ route: IncomingRoute; waitingMinutes: number | null; onStart: () => void }`.

- [ ] **Step 1: Escribe el test que falla**

```tsx
const route: IncomingRoute = {
  id: 'r1', code: 'PR-2026-0148', driver_id: 'd1', driver_name: 'Marcela Rojas',
  plate: 'JKLM-42', in_transit_at: '2026-08-20T12:00:00Z', started_at: null,
  manifest_count: 3, expected_packages: 88,
};

it('nombra la ruta, el conductor, la patente y lo que se espera', () => {
  render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={vi.fn()} />);
  expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
  // La patente es lo que el receptor coteja contra el camión que tiene
  // delante — por eso la tarjeta recibe el IncomingRoute crudo y no el
  // ArrivalRow, que no la propaga.
  expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();
  expect(screen.getByText(/Marcela Rojas/)).toBeInTheDocument();
  expect(screen.getByText('88')).toBeInTheDocument();
  expect(screen.getByText('41 min')).toBeInTheDocument();
});

it('la acción primaria abre el conteo y mide 64px', async () => {
  const onStart = vi.fn();
  const user = userEvent.setup();
  render(<ReceptionMobileYardCard route={route} waitingMinutes={41} onStart={onStart} />);
  const button = screen.getByRole('button', { name: /Iniciar conteo/ });
  expect(button.className).toContain('h-16');
  await user.click(button);
  expect(onStart).toHaveBeenCalledTimes(1);
});

it('sin patente registrada no deja un separador huérfano', () => {
  render(
    <ReceptionMobileYardCard route={{ ...route, plate: null }} waitingMinutes={5} onStart={vi.fn()} />,
  );
  expect(screen.getByTestId('yard-card-driver').textContent).not.toMatch(/·\s*$/);
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionMobileYardCard.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementa** — contenedor `rounded-2xl border-2 border-accent bg-accent-muted p-5`; eyebrow `EN PATIO ESPERANDO` en `font-mono text-xs tracking-[.1em]`; badge de espera a la derecha, en paleta error cuando `waitingMinutes >= YARD_WAIT_WARNING_MINUTES` (impórtalo de `arrivals.ts`) y neutro si no; código en `font-mono text-[30px] font-bold`; conductor y patente en `text-base text-text-body` con `data-testid="yard-card-driver"`; `expected_packages` en `font-mono text-[17px]` seguido de "paquetes esperados"; botón `h-16 rounded-[14px] bg-accent-light` con icono `Barcode` de `lucide-react`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceptionMobileYardCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionMobileYardCard.tsx src/components/reception/ReceptionMobileYardCard.test.tsx
git commit -m "feat(spec-62): tarjeta de la ruta que más espera en patio"
```

### Task 10: `ReceptionMobileCompactRow`

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionMobileCompactRow.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileCompactRow.test.tsx`

Props: `{ route: IncomingRoute; waitingMinutes: number | null; onOpen: () => void }`.

- [ ] **Step 1: Escribe el test que falla** — afirma: el código, `N paquetes`, la espera cuando la hay, `min-h-[56px]` en el botón, y que `onOpen` se dispara al tocar la fila entera (toda la fila es zona táctil, no solo el chevron).

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionMobileCompactRow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — `<button>` de ancho completo, `min-h-[56px] rounded-[13px] border border-border bg-surface px-3.5 py-3`, código en `font-mono text-base font-bold`, subtexto en `text-[13.5px] text-text-secondary`, `ChevronRight` en una caja de 44×44 a la derecha. Espeja `PickupMobileCompactRow.tsx`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceptionMobileCompactRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionMobileCompactRow.tsx src/components/reception/ReceptionMobileCompactRow.test.tsx
git commit -m "feat(spec-62): fila compacta de ruta en patio"
```

### Task 11: `ReceiveWithoutQRSheet`

`ReceiveWithoutQRButton` exige `{ routeId, code, plate }` y hoy solo se monta en la página de una ruta concreta. El pie de `3i` no tiene ruta seleccionada, así que primero hay que elegirla.

**Files:**
- Create: `apps/frontend/src/components/reception/ReceiveWithoutQRSheet.tsx`
- Create: `apps/frontend/src/components/reception/ReceiveWithoutQRSheet.test.tsx`

Props: `{ open: boolean; onOpenChange: (open: boolean) => void; routes: IncomingRoute[] }`.

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('lista las rutas todavía en camino, con lo que identifica al camión', () => {
  render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[routeA, routeB]} />);
  expect(screen.getByText('PR-2026-0148')).toBeInTheDocument();
  expect(screen.getByText(/JKLM-42/)).toBeInTheDocument();
});

it('no abre ninguna recepción hasta que se elige una ruta', () => {
  // open_route_reception termina el viaje del conductor: congela
  // expected_count y bloquea el escaneo de recogida. No puede dispararse por
  // montar la hoja.
  render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[routeA]} />);
  expect(mockOpenRouteReception).not.toHaveBeenCalled();
});

it('al elegir una ruta aparece la confirmación', async () => {
  const user = userEvent.setup();
  render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[routeA]} />);
  await user.click(screen.getByRole('button', { name: /PR-2026-0148/ }));
  expect(screen.getByRole('button', { name: /Recibir sin QR/i })).toBeInTheDocument();
});

it('sin rutas en camino lo dice en vez de mostrar una lista vacía', () => {
  render(<ReceiveWithoutQRSheet open onOpenChange={vi.fn()} routes={[]} />);
  expect(screen.getByText(/Ninguna ruta en camino/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceiveWithoutQRSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — `Sheet` con `side="bottom"`. Lista de `ReceptionMobileCompactRow` (el de la task 10) sobre `routes`; al elegir una, la hoja pasa a montar `<ReceiveWithoutQRButton routeId={r.id} code={r.code} plate={r.plate} />`, que trae su propio diálogo de confirmación y su propia mutación. **No copies** el texto de advertencia ni la llamada a la RPC: el botón ya los tiene y, al tener éxito, navega a la sesión, con lo que la hoja se desmonta sola.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceiveWithoutQRSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceiveWithoutQRSheet.tsx src/components/reception/ReceiveWithoutQRSheet.test.tsx
git commit -m "feat(spec-62): elegir la ruta antes de recibir sin QR"
```

### Task 12: `ReceptionMobileFooterActions` y `ReceptionMobileView`

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionMobileFooterActions.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileView.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileView.test.tsx`

Props de la vista:

```ts
export interface ReceptionMobileViewProps {
  /** Rutas en patio (`in_transit`), con su recepción ya abierta. */
  yardRoutes: IncomingRoute[];
  /** Rutas todavía en camino (`in_progress`) — la población del fallback sin QR. */
  transitRoutes: IncomingRoute[];
  discrepancies: OpenDiscrepancy[];
  isLoading: boolean;
  userName: string | null;
  onStartCount: (routeId: string) => void;
  onOpenQRScanner: () => void;
  onOpenDiscrepancy: (routeId: string) => void;
  /**
   * El bloque de reingresos que hoy vive en la pestaña Retornos del
   * escritorio (`ReturnRouteList` / `ReturnReceptionSession`). Llega como
   * slot porque su estado — qué ruta está seleccionada — es de la página, y
   * porque los dos árboles montan exactamente el mismo bloque.
   */
  returnsSlot?: React.ReactNode;
  /** Inyectable para los tests. */
  now?: Date;
}
```

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('el héroe es la ruta que lleva más tiempo esperando', () => {
  // No la primera de la lista ni la más nueva: la que más espera es la que
  // hay que descargar, y es la única decisión que esta pantalla toma por el
  // operario.
  render(<ReceptionMobileView {...props} yardRoutes={[esperaCorta, esperaLarga]} />);
  const hero = screen.getByTestId('reception-yard-hero');
  expect(within(hero).getByText(esperaLarga.code)).toBeInTheDocument();
});

it('las demás rutas en patio son filas, no decisiones', () => {
  render(<ReceptionMobileView {...props} yardRoutes={[esperaCorta, esperaLarga]} />);
  expect(screen.getAllByRole('button', { name: /Iniciar conteo/ })).toHaveLength(1);
});

it('sin camiones en patio muestra el vacío y conserva el pie', () => {
  render(<ReceptionMobileView {...props} yardRoutes={[]} />);
  expect(screen.getByText(/Ningún camión en patio/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Escanear QR de ruta/i })).toBeInTheDocument();
});

it('no monta KPIs ni conmutador de tema', () => {
  // Decisión del mock 3i: el operario no actúa sobre un promedio del turno.
  // Eso vive en 3c, que es la pantalla del jefe.
  render(<ReceptionMobileView {...props} />);
  expect(screen.queryByText(/Rutas esperadas hoy/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /tema/i })).not.toBeInTheDocument();
});

it('las diferencias abiertas llevan a leer el caso', async () => {
  const onOpenDiscrepancy = vi.fn();
  const user = userEvent.setup();
  render(
    <ReceptionMobileView {...props} onOpenDiscrepancy={onOpenDiscrepancy} discrepancies={[dif]} />,
  );
  await user.click(screen.getByRole('button', { name: /Resolver/i }));
  expect(onOpenDiscrepancy).toHaveBeenCalledWith(dif.routeId);
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionMobileView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — la vista ordena `yardRoutes` por `in_transit_at` ascendente (más antiguo primero), pasa el primero a `ReceptionMobileYardCard` envuelto en `data-testid="reception-yard-hero"` y el resto a filas compactas bajo el eyebrow `TAMBIÉN EN PATIO`. Debajo, el bloque de diferencias en paleta error con su botón *Resolver*. El pie es `ReceptionMobileFooterActions` (`{ onScanQR, onNoQR }`, dos botones de 52px), que abre el escáner QR o `ReceiveWithoutQRSheet` con `transitRoutes`.

  **De dónde sale `waitingMinutes`:** de `minutesSince(route.in_transit_at, now ?? new Date())`, el helper que la task 6 sacó de `arrivals.ts`. Es el único cálculo de espera de la pantalla; no lo reimplementes en la tarjeta ni en la fila, que lo reciben ya calculado justamente para poder testearse con un número fijo.

  **Vacío:** `EmptyState` con el icono `ArrowUpDown` de `lucide-react` — el mismo que la nav usa para Recepción —, título "Ningún camión en patio" y una descripción que diga qué hacer (escanear el QR cuando llegue uno). El pie sigue montado: es la salida.

  **Carga:** `Skeleton` con la geometría de la tarjeta héroe (mismo alto y radio), nunca un spinner centrado.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionMobileFooterActions.tsx src/components/reception/ReceptionMobileView.tsx src/components/reception/ReceptionMobileView.test.tsx
git commit -m "feat(spec-62): pantalla de patio en móvil (mock 3i)"
```

### Task 13: Ramificar `/app/reception`

**Files:**
- Modify: `apps/frontend/src/app/app/reception/page.tsx`
- Modify: `apps/frontend/src/app/app/reception/page.test.tsx`

- [ ] **Step 1: Escribe el test que falla** — mockea `useIsBelowLg` y afirma que con `true` se renderiza `ReceptionMobileView` y **no** la tabla de llegadas ni los `StatTile`; con `false`, al revés. Mockea los hooks de datos como hace `PickupMobileView.test.tsx`. Añade además este test, que es el que evita una regresión:

```tsx
it('los reingresos siguen alcanzables en móvil', () => {
  // ReturnRouteList y ReturnReceptionSession cuelgan ÚNICAMENTE de esta
  // página. Un árbol móvil que no los monte deja los reingresos
  // inalcanzables bajo 1024px — y ya están restyleados para móvil (1k,
  // #449). 3r/3s reemplazarán esta sección cuando se abran.
  mockUseIsBelowLg.mockReturnValue(true);
  render(<ReceptionPage />);
  expect(screen.getByText(/Reingresos/i)).toBeInTheDocument();
});
```

Mockea `useOperatorId` devolviendo un id no nulo. El bloque de reingresos está guardado por `operatorId && (...)`, así que con `null` no renderiza nada y el test se pone rojo por el motivo equivocado.

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/app/app/reception/page.test.tsx`
Expected: FAIL — hoy siempre se renderiza el árbol de escritorio.

- [ ] **Step 3: Implementa**

```tsx
const isBelowLg = useIsBelowLg();
const { data: userName = null } = useCurrentUserName();
// ...
if (isBelowLg) {
  return (
    <>
      <ReceptionMobileView
        yardRoutes={yardRoutes}
        transitRoutes={incomingRoutes}
        discrepancies={discrepancies}
        isLoading={isLoading}
        userName={userName}
        onStartCount={(routeId) => router.push(`/app/reception/route/${routeId}`)}
        onOpenQRScanner={() => setShowScanner(true)}
        onOpenDiscrepancy={(routeId) => router.push(`/app/reception/route/${routeId}/completa`)}
        returnsSlot={returnsSlot}
      />
      {scannerDialog}
    </>
  );
}
```

Tres cosas que este paso tiene que resolver, y ninguna es opcional:

1. **Importa `useRouter`** de `next/navigation`. La página **no** lo tiene hoy: navega solo a través de componentes hijos. Sin esto, `onStartCount` no compila.

2. **Los reingresos tienen que seguir alcanzables.** `ReturnRouteList` y `ReturnReceptionSession` cuelgan únicamente de este archivo (líneas 15-16, 147-154 hoy). Extrae ese bloque — el que hoy vive dentro del `<Tabs value="returns">` — a una constante `returnsSlot`, y móntala en **los dos** árboles: en escritorio dentro de su pestaña, como hoy, y en móvil como sección propia de `ReceptionMobileView` (una prop `returnsSlot?: React.ReactNode`, bajo el bloque de diferencias, con el encabezado `REINGRESOS`). Si la rama móvil no la monta, los reingresos desaparecen bajo 1024px y la regresión no la ve nadie hasta que un operario la reporte desde el andén.

   Aprovecha y renombra la pestaña de escritorio de **"Retornos" a "Reingresos"**: es el término de `labels.es.ts` y el que ya usa `ReturnReceptionSession` ("Reingreso {id}"). Dos nombres para lo mismo entre el escritorio y el teléfono es exactamente lo que las reglas de copy de spec-54 existen para evitar. Es una palabra, y va en este PR o no va.

3. **El `<Dialog>` del escáner QR** también se extrae a una constante (`scannerDialog`) y lo montan los dos árboles: es el mismo flujo en ambos.

El `<h1>` y el subtítulo de escritorio quedan solo en la rama de escritorio — si se montan junto a `ReceptionMobileHeader` salen dos títulos a 390px, que es lo que pasó en QA con `3h`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/app/app/reception/ && npm run type-check && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/reception/page.tsx src/app/app/reception/page.test.tsx
git commit -m "feat(spec-62): /app/reception elige árbol de terreno bajo lg"
```

### Task 14: Cierra el chunk

- [ ] **Step 1: Verifica** — `npm run type-check && npm run lint && npm run test:run`.
- [ ] **Step 2: Míralo a 390×844** (`npm run dev`, DevTools en iPhone 12): el héroe es el camión que más espera, ningún texto informativo bajo 13.5px, ninguna zona táctil bajo 44px, y la barra de pestañas sigue visible en esta pantalla.
- [ ] **Step 3: PR con auto-merge** desde `feat/spec-62-chunk2-patio`, y espera el merge antes de crear la rama del chunk 3.

---

## Chunk 3: `3q` — descarga y nota de discrepancia (fase 3)

La pantalla más sensible del módulo: se usa de pie, con el bulto en una mano y el lector en la otra. Todo es salida; la única entrada táctil es el código manual.

### Task 15: `ReceptionScanFeedback`

Traduce el discriminador de recepción a las props de `ScanResult`. Es lógica de presentación con cinco casos, así que va en su propio componente con su propio test — no incrustada en la sesión.

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionScanFeedback.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionScanFeedback.test.tsx`

Props:

```ts
export interface ReceptionScanFeedbackProps {
  /** Última lectura, o null antes del primer escaneo de la sesión. */
  result: ReceptionScanValidationResult | null;
  /** received_count tras esa lectura, para el contador grande. */
  receivedCount: number;
  /** Hora del primer escaneo del mismo código, si el snapshot la tiene. */
  firstScanAt?: string | null;
}
```

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('un paquete recibido es éxito y muestra el contador', () => {
  render(
    <ReceptionScanFeedback
      result={{ scanResult: 'received', packageId: 'p1', packageLabel: 'CL7742891088' }}
      receivedCount={61}
    />,
  );
  expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
  expect(screen.getByText('61')).toBeInTheDocument();
  expect(screen.getByTestId('scan-result-icon-ok')).toBeInTheDocument();
});

it('un bulto ajeno se marca sin bloquear: se recibió igual', () => {
  // spec-52: un paquete sin retiro verificado en esta ruta se acepta —
  // rechazarlo obligaría al receptor a mentirle al sistema. Suma a received
  // Y a unexpected, y la revisión ocurre al cerrar, no en medio de la
  // descarga.
  render(
    <ReceptionScanFeedback
      result={{ scanResult: 'received', packageId: 'p1', packageLabel: 'CL774', unexpected: true }}
      receivedCount={62}
    />,
  );
  expect(screen.getByText(/AJENO/)).toBeInTheDocument();
  expect(screen.getByTestId('scan-result-icon-warn')).toBeInTheDocument();
});

it('un repetido dice a qué hora se leyó la primera vez', () => {
  render(
    <ReceptionScanFeedback
      result={{ scanResult: 'duplicate', packageId: 'p1', packageLabel: 'CL774' }}
      receivedCount={61}
      firstScanAt="2026-08-20T12:58:00Z"
    />,
  );
  expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
  expect(screen.getByText(/12:58/)).toBeInTheDocument();
});

it('sin hora del primer escaneo no se inventa una', () => {
  // El validador no devuelve marca de tiempo en su rama duplicate: solo
  // selecciona `id`. La hora sale del snapshot o no sale.
  render(
    <ReceptionScanFeedback
      result={{ scanResult: 'duplicate', packageId: 'p1', packageLabel: 'CL774' }}
      receivedCount={61}
      firstScanAt={null}
    />,
  );
  expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
  expect(screen.queryByText(/NaN|Invalid/)).not.toBeInTheDocument();
});

it('no está en la ruta y es de otra ruta son errores distintos', () => {
  const { rerender } = render(
    <ReceptionScanFeedback result={{ scanResult: 'not_found', packageId: null, packageLabel: null }} receivedCount={61} />,
  );
  expect(screen.getByText(/NO ESTÁ EN LA RUTA/)).toBeInTheDocument();
  rerender(
    <ReceptionScanFeedback result={{ scanResult: 'route_mismatch', packageId: null, packageLabel: null }} receivedCount={61} />,
  );
  expect(screen.getByText(/ES DE OTRA RUTA/)).toBeInTheDocument();
});

it('antes del primer escaneo no ocupa espacio con un bloque vacío', () => {
  const { container } = render(<ReceptionScanFeedback result={null} receivedCount={0} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionScanFeedback.test.tsx`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementa** — un mapa `scanResult → { status, title }` según la tabla del spec, con la salvedad de `received` + `unexpected`, que es `warn`. El código escaneado va en `context`, el `receivedCount` en `code` (es el número grande de la derecha del mock) y la hora en `timestamp`. `result === null` devuelve `null`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceptionScanFeedback.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionScanFeedback.tsx src/components/reception/ReceptionScanFeedback.test.tsx
git commit -m "feat(spec-62): el resultado de escaneo de recepción, con sus cinco salidas"
```

### Task 16: `ManualCodeSheet`

Para la etiqueta ilegible. Es la única entrada táctil de `3q`.

**Files:**
- Create: `apps/frontend/src/components/reception/ManualCodeSheet.tsx`
- Create: `apps/frontend/src/components/reception/ManualCodeSheet.test.tsx`

Props: `{ open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (code: string) => void }`.

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('envía el código y cierra', async () => {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(<ManualCodeSheet open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
  await user.type(screen.getByRole('textbox', { name: /código/i }), 'CL7742891088');
  await user.click(screen.getByRole('button', { name: /Registrar/i }));
  expect(onSubmit).toHaveBeenCalledWith('CL7742891088');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('no envía un código en blanco', async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
  await user.click(screen.getByRole('button', { name: /Registrar/i }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it('limpia espacios al costado — el teclado del andén los mete solos', async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  render(<ManualCodeSheet open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
  await user.type(screen.getByRole('textbox', { name: /código/i }), '  CL774  ');
  await user.click(screen.getByRole('button', { name: /Registrar/i }));
  expect(onSubmit).toHaveBeenCalledWith('CL774');
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ManualCodeSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — `Sheet side="bottom"`, `<Input>` con `aria-label="Código del bulto"`, `inputMode="text"`, `autoCapitalize="characters"`, y un botón *Registrar* de 52px. Envía por `onSubmit` y limpia el campo al cerrar.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ManualCodeSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ManualCodeSheet.tsx src/components/reception/ManualCodeSheet.test.tsx
git commit -m "feat(spec-62): entrada manual de código para etiqueta ilegible"
```

### Task 17: `DiscrepancyNoteSheet`

**Files:**
- Create: `apps/frontend/src/components/reception/DiscrepancyNoteSheet.tsx`
- Create: `apps/frontend/src/components/reception/DiscrepancyNoteSheet.test.tsx`

Props: `{ open; onOpenChange; counts: ReceptionCounts; isPending: boolean; onConfirm: (note: string) => void }`.

`ReceptionCounts` es el tipo de `@/lib/reception/finalize-rule` (task 1). Ojo con el nombre: existe además un componente `components/reception/ReceptionCounts.tsx`, que la página de sesión ya importa. Son cosas distintas.

- [ ] **Step 1: Escribe el test que falla**

```tsx
const counts = { expectedCount: 88, receivedCount: 86, unexpectedCount: 1 };

it('nombra la diferencia que obliga a escribir la nota', () => {
  render(<DiscrepancyNoteSheet open onOpenChange={vi.fn()} counts={counts} isPending={false} onConfirm={vi.fn()} />);
  // 86 recibidos - 1 ajeno = 85 calzados contra 88 esperados -> faltan 3.
  expect(screen.getByText(/3/)).toBeInTheDocument();
  expect(screen.getByText(/ajeno/i)).toBeInTheDocument();
});

it('no cierra sin texto', async () => {
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  render(<DiscrepancyNoteSheet open onOpenChange={vi.fn()} counts={counts} isPending={false} onConfirm={onConfirm} />);
  await user.click(screen.getByRole('button', { name: /Cerrar recepción/i }));
  expect(onConfirm).not.toHaveBeenCalled();
});

it('con texto envía la nota limpia', async () => {
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  render(<DiscrepancyNoteSheet open onOpenChange={vi.fn()} counts={counts} isPending={false} onConfirm={onConfirm} />);
  await user.type(screen.getByRole('textbox'), '  Faltan 3 de CARGA-99814  ');
  await user.click(screen.getByRole('button', { name: /Cerrar recepción/i }));
  expect(onConfirm).toHaveBeenCalledWith('Faltan 3 de CARGA-99814');
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/DiscrepancyNoteSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — `Sheet side="bottom"` a pantalla completa. Deriva `missing` con `finalizeRule(counts)`; **no** recalcules la resta a mano. `Textarea` de 5 filas, y botón *Cerrar recepción* de 56px deshabilitado mientras el texto esté vacío o `isPending`.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/DiscrepancyNoteSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/DiscrepancyNoteSheet.tsx src/components/reception/DiscrepancyNoteSheet.test.tsx
git commit -m "feat(spec-62): captura móvil de la nota de discrepancia"
```

### Task 18: `ReceptionMobileSession`

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionMobileSession.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionMobileSession.test.tsx`

Props:

```ts
export interface ReceptionMobileSessionProps {
  snapshot: RouteReceptionSnapshot;
  lastScanResult: ReceptionScanValidationResult | null;
  syncStatus: ConnectionState;
  queuedCount: number;
  isScanPending: boolean;
  isFinalizePending: boolean;
  onScan: (barcode: string) => void;
  onFinalize: (note: string | null) => void;
}
```

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('la cabecera muestra el avance sobre lo esperado', () => {
  render(<ReceptionMobileSession {...props} />);
  expect(screen.getByText('61')).toBeInTheDocument();
  expect(screen.getByText(/\/ 88/)).toBeInTheDocument();
});

it('el resultado del escaneo persiste hasta el siguiente', async () => {
  // El bloque NO se auto-oculta. Un operario que mira el bulto y vuelve a la
  // pantalla tiene que seguir viendo dónde quedó la última lectura; el
  // setTimeout de 3s que hacía esto se elimina en la task 19.
  const { rerender } = render(<ReceptionMobileSession {...props} lastScanResult={recibido} />);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByText(/RECIBIDO/)).toBeInTheDocument();
  rerender(<ReceptionMobileSession {...props} lastScanResult={duplicado} />);
  expect(screen.getByText(/YA ESCANEADO/)).toBeInTheDocument();
});

it('avisa cuando el lector dejó de apuntar al campo', async () => {
  const user = userEvent.setup();
  render(<ReceptionMobileSession {...props} />);
  expect(screen.getByText(/Lector listo/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /código manual/i }));
  expect(await screen.findByText(/Toca para reactivar el lector/i)).toBeInTheDocument();
});

it('sin diferencias, Confirmar cierra sin pedir nota', async () => {
  const onFinalize = vi.fn();
  const user = userEvent.setup();
  render(<ReceptionMobileSession {...props} snapshot={cuadrado} onFinalize={onFinalize} />);
  await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
  expect(onFinalize).toHaveBeenCalledWith(null);
});

it('con diferencias, Confirmar abre la hoja y no cierra todavía', async () => {
  const onFinalize = vi.fn();
  const user = userEvent.setup();
  render(<ReceptionMobileSession {...props} snapshot={conFaltantes} onFinalize={onFinalize} />);
  await user.click(screen.getByRole('button', { name: /^Confirmar/ }));
  expect(onFinalize).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

it('sin conexión dice qué pasa con el trabajo hecho, y no bloquea nada', () => {
  render(<ReceptionMobileSession {...props} syncStatus="offline" queuedCount={14} />);
  expect(screen.getByText(/14/)).toBeInTheDocument();
  expect(screen.getByText(/se envían solos/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Confirmar/ })).toBeEnabled();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionMobileSession.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — de arriba abajo: cabecera fija (código, conductor, `N / M` en `font-mono text-[26px]`, barra de 8px, chip de cola cuando `syncStatus !== 'online'`), `ScanField size="sm"` con `onFocusStateChange`, fila de estado del lector con el botón de código manual de 44px, `ReceptionScanFeedback`, historial de `snapshot.scans` con chips `AJENO` / `REPETIDO`, y pie fijo de dos botones de 56px. *Confirmar* consulta `finalizeRule` sobre `snapshot.route_reception`: si `needsNote` abre `DiscrepancyNoteSheet`, si no llama `onFinalize(null)`.

  **La hora del primer escaneo, con cuidado.** Para el caso `duplicate` sale de `snapshot.scans`, pero un `find` por `barcode` a secas devuelve el escaneo equivocado: la mutación invalida el snapshot, así que **la lectura duplicada ya es una fila más** con ese mismo `barcode` y `scan_result: 'duplicate'`. Mostrarías su propia hora como "hora del primero" — una mentira en pantalla, y los tests de la task 15 no la atrapan porque ahí `firstScanAt` se pasa a mano. Filtra por `scan_result === 'received'` y toma el `scanned_at` más antiguo:

```ts
const firstScanAt = snapshot.scans
  .filter((s) => s.barcode === barcode && s.scan_result === 'received')
  .map((s) => s.scanned_at)
  .sort()[0] ?? null;
```

  Escribe un test de la sesión para esto: con dos filas del mismo `barcode` — una `received` a las 12:58 y una `duplicate` a las 13:04 — el bloque dice 12:58.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionMobileSession.tsx src/components/reception/ReceptionMobileSession.test.tsx
git commit -m "feat(spec-62): sesión de descarga en móvil (mock 3q)"
```

### Task 19: Ramificar la página de sesión y matar el auto-ocultado

**Files:**
- Modify: `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx`
- Modify: `apps/frontend/src/app/app/reception/route/[routeId]/page.test.tsx`

- [ ] **Step 1: Escribe el test que falla** — con `useIsBelowLg` en `true` se renderiza `ReceptionMobileSession` y **no** `RouteSwitcherColumn` ni `SyncQueuePanel`; con `false`, al revés. Y un test de que `lastScanResult` sigue en pantalla pasados 3,5 segundos (usa timers falsos).

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run "src/app/app/reception/route/[routeId]/page.test.tsx"`
Expected: FAIL — hoy el resultado se borra a los 3s y no hay árbol móvil.

- [ ] **Step 3: Implementa**

Borra el auto-ocultado en `handleScan`:

```tsx
onSuccess: (result) => {
  setLastScanResult(result);
  // Sin setTimeout: el bloque persiste hasta la siguiente lectura. Es la
  // regla del handoff — un operario que mira el bulto y vuelve tiene que
  // seguir viendo dónde quedó la última.
},
```

Y añade la rama móvil antes del `return` de escritorio, pasando `sync.status`, `sync.queuedCount` y las mutaciones ya existentes. El árbol móvil **no** monta `RouteSwitcherColumn`, `SyncQueuePanel`, `ReceptionCounts`, `ConsolidatedScanList`, `ReceptionScanner`, `FinalizeReceptionButton` ni `ReopenRouteButton` — la lista completa de lo que hoy cuelga del árbol de escritorio. `ReceptionMobileSession` trae sus propios equivalentes de escaneo y cierre; reabrir no tiene equivalente móvil a propósito, porque es una corrección de hub y no del andén. Construye el árbol móvil desde el mock, no restando piezas del JSX de escritorio.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/app/app/reception/ && npm run type-check && npm run lint`
Expected: PASS. El árbol de escritorio queda igual salvo la línea del `setTimeout`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/app/reception/route/[routeId]/page.tsx" "src/app/app/reception/route/[routeId]/page.test.tsx"
git commit -m "feat(spec-62): la sesión elige árbol de terreno y el resultado ya no se auto-oculta"
```

### Task 20: Cierra el chunk

- [ ] **Step 1: Verifica** — `npm run type-check && npm run lint && npm run test:run`.
- [ ] **Step 2: Pruébalo con el lector de QA** si tienes acceso: ráfaga sin sufijo Enter, un código repetido y uno que no pertenezca a la ruta. Los tres tienen que quedar registrados y visibles sin tocar la pantalla.
- [ ] **Step 3: PR con auto-merge** desde `feat/spec-62-chunk3-descarga`, y espera el merge antes de crear la rama del chunk 4.

---

## Chunk 4: `3p` — acta y E2E (fases 4 y 5)

### Task 21: `ReceptionReceipt`

**Files:**
- Create: `apps/frontend/src/components/reception/ReceptionReceipt.tsx`
- Create: `apps/frontend/src/components/reception/ReceptionReceipt.test.tsx`

Props: `{ snapshot: RouteReceptionSnapshot; nextYardRoute: IncomingRoute | null; onBack: () => void; onOpenRoute: () => void }`.

- [ ] **Step 1: Escribe el test que falla**

```tsx
it('las cuatro cifras salen de route_receptions, no de un recuento propio', () => {
  render(<ReceptionReceipt {...props} />);
  expect(screen.getByTestId('acta-esperados')).toHaveTextContent('88');
  expect(screen.getByTestId('acta-recibidos')).toHaveTextContent('86');
  expect(screen.getByTestId('acta-faltantes')).toHaveTextContent('3');  // 86 - 1 ajeno vs 88
  expect(screen.getByTestId('acta-ajenos')).toHaveTextContent('1');  // unexpected_count
});

it('muestra la nota tal como quedó guardada', () => {
  render(<ReceptionReceipt {...props} />);
  expect(screen.getByText(/Faltan 2 paquetes de CARGA-99814/)).toBeInTheDocument();
});

it('sin nota no dibuja el bloque de discrepancia', () => {
  // Una recepción que cuadró no tiene nota. Un bloque vacío con el título
  // "NOTA DE DISCREPANCIA" sugiere que hubo una y se perdió.
  render(<ReceptionReceipt {...props} snapshot={sinNota} />);
  expect(screen.queryByText(/NOTA DE DISCREPANCIA/)).not.toBeInTheDocument();
});

it('nombra lo que la recepción dejó hecho', () => {
  render(<ReceptionReceipt {...props} />);
  expect(screen.getByText(/3 cargas/)).toBeInTheDocument();
  expect(screen.getByText(/clasificación/i)).toBeInTheDocument();
});

it('reincorpora al flujo cuando queda otro camión esperando', () => {
  render(<ReceptionReceipt {...props} nextYardRoute={otraRuta} />);
  expect(screen.getByText(otraRuta.code)).toBeInTheDocument();
});

it('sin más camiones no inventa una siguiente ruta', () => {
  render(<ReceptionReceipt {...props} nextYardRoute={null} />);
  expect(screen.queryByText(/Queda 1 ruta en patio/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run src/components/reception/ReceptionReceipt.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementa** — check de 74px en paleta success, título en `font-heading text-[23px]`, tabla de cuatro filas de 52px (faltantes desde `finalizeRule`, no una resta suelta), bloque de nota condicionado a `discrepancy_notes`, bloque *Qué pasa ahora* compuesto desde `snapshot.manifests.length` y las cifras, la siguiente ruta si la hay, y pie con *Volver a recepción* (60px) y *Ver detalle de la ruta*.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/components/reception/ReceptionReceipt.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/reception/ReceptionReceipt.tsx src/components/reception/ReceptionReceipt.test.tsx
git commit -m "feat(spec-62): acta de la recepción cerrada (mock 3p)"
```

### Task 22: La ruta `/completa`

**Files:**
- Create: `apps/frontend/src/app/app/reception/route/[routeId]/completa/page.tsx`
- Create: `apps/frontend/src/app/app/reception/route/[routeId]/completa/page.test.tsx`

- [ ] **Step 1: Escribe el test que falla** — la página carga el snapshot por `routeId`, monta `ReceptionReceipt`, muestra `Skeleton` mientras carga, y un mensaje si la ruta no existe. *Volver a recepción* navega a `/app/reception`; *Ver detalle de la ruta* a `/app/reception/route/[routeId]/preview`.

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run "src/app/app/reception/route/[routeId]/completa/page.test.tsx"`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementa** — `'use client'`, `useRouteReceptionSnapshot(routeId)`, y `useIncomingRoutes(operatorId, 'in_transit')` — con el `operatorId` de `useOperatorId`, como la página hermana — para la siguiente ruta en patio (excluyendo la actual, y tomando la que más espera). La página es la misma en móvil y escritorio: es un acta, no una herramienta de andén, y a 1440px se lee igual en una columna centrada.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/app/app/reception/ && npm run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/app/reception/route/[routeId]/completa/"
git commit -m "feat(spec-62): ruta del acta de recepción"
```

### Task 23: Los dos árboles aterrizan en el acta

Hoy cerrar una recepción deja un toast y devuelve al listado: el acta no existe en ninguna parte y no se puede volver a abrir.

**Files:**
- Modify: `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx` (`handleFinalize`)
- Modify: `apps/frontend/src/app/app/reception/route/[routeId]/page.test.tsx`

- [ ] **Step 1: Escribe el test que falla** — al cerrar con éxito, `router.push` recibe `/app/reception/route/<id>/completa`, en ambos árboles.

- [ ] **Step 2: Córrelo y confirma que falla**

Run: `npx vitest run "src/app/app/reception/route/[routeId]/page.test.tsx"`
Expected: FAIL — hoy empuja a `/app/reception`.

- [ ] **Step 3: Implementa** — cambia el destino del `onSuccess`. El toast se queda: confirma la acción mientras navega.

- [ ] **Step 4: Corre los tests**

Run: `npx vitest run src/app/app/reception/ && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/app/reception/route/[routeId]/page.tsx" "src/app/app/reception/route/[routeId]/page.test.tsx"
git commit -m "feat(spec-62): cerrar una recepción termina en su acta"
```

### Task 24: Hacer que el E2E móvil pueda siquiera correr

**Lee esto antes de escribir una línea de test.** `playwright.qa.config.ts` no recoge un archivo nuevo ni abre un teléfono, y su suite no corre desde un laptop. Tres hechos del entorno, los tres verificados:

1. **`testMatch: /spec52-.*\.spec\.ts$/`.** Está acotado a propósito — es la única suite con fixture de seed/teardown — y su comentario dice "widen this pattern as each grows a fixture". Un `e2e/reception-mobile.spec.ts` **no se recoge**: corre cero casos y reporta verde.
2. **`use.viewport = { width: 1440, height: 900 }`**, un solo proyecto `chromium`. A 1440px `useIsBelowLg` es `false` y el árbol móvil que este test existe para ejercitar **nunca se monta**.
3. **No corre localmente.** Apunta a `E2E_BASE_URL=http://localhost:3200` y el fixture necesita `E2E_DATABASE_URL` en `:5433`; ambos puertos son de localhost **en el VPS**. Lo ejecuta el job `e2e-qa` de `.github/workflows/deploy.yml` en el runner self-hosted, después del merge, y es `continue-on-error: true` — o sea, advisory.

**Files:**
- Modify: `apps/frontend/playwright.qa.config.ts` (`testMatch`)
- Modify: `apps/frontend/e2e/support/spec52-fixture.ts` (lo que falte del escenario)

- [ ] **Step 1: Ensancha `testMatch`**

```ts
testMatch: /(spec52-.*|reception-mobile)\.spec\.ts$/,
```

Actualiza el comentario de arriba: ya no es "scoped to spec-52", es "las suites con fixture". Si no haces esto, todo lo demás de este chunk es decorativo.

- [ ] **Step 2: Averigua qué le falta al escenario**

El recorrido necesita, en la base de QA: una `pickup_routes` en `in_transit` con su `route_receptions` **abierta**, los códigos de barra de sus paquetes, y **al menos uno que no se escanee** para que el cierre pida nota. `e2e/support/spec52-fixture.ts` ya expone `seed`, `teardown`, `signIn`, `db` y `scanUntilStatus`, y su suite recorre una jornada completa de recogida + recepción, así que la mayor parte ya existe.

Lee el fixture y responde por escrito, en el PR: ¿deja una ruta en patio al terminar, o hay que añadir un helper que la deje ahí? **No mires `packages/database/supabase/seed-qa.sql` ni `packages/database/seed-qa/`** para esto: el seed de QA es el estado inicial del ambiente, y un E2E que dependa de él es intermitente por construcción. El estado que este test necesita lo crea su fixture.

- [ ] **Step 3: Extiende el fixture con lo que falte** y commitea eso solo, antes de escribir el test. Si resulta que no falta nada, dilo en el commit igual.

```bash
git add e2e/support/spec52-fixture.ts playwright.qa.config.ts
git commit -m "test(spec-62): el runner de QA recoge la suite móvil de recepción"
```

### Task 25: El E2E móvil, de patio a acta

**Files:**
- Create: `apps/frontend/e2e/reception-mobile.spec.ts`

- [ ] **Step 1: Escribe el test**

Empieza el archivo fijando el teléfono — es lo único que hace que el árbol correcto se monte:

```ts
test.use({ viewport: { width: 390, height: 844 } });
```

**El nombre accesible del campo de escaneo.** El helper `scanBarcode(page, label, code)` del fixture resuelve el input con `getByLabel`, y la suite existente le pasa `'Escáner de recepción'`, que es el nombre del escáner de escritorio. `ScanField` usa su prop `ariaLabel`, que por defecto es `'Código de barras'`. Decide una de las dos y déjala escrita: o el `ScanField` de `ReceptionMobileSession` recibe `ariaLabel="Escáner de recepción"` y reusas la constante, o el test lleva la suya. Descubrir esto en el log de CI post-merge es el ciclo de feedback más lento que tiene este plan.

Recorrido, con el fixture de la task 24: `signIn` como receptor → `/app/reception` → el héroe es la ruta que más espera → *Iniciar conteo* → escanear tres códigos, uno repetido → el bloque de resultado muestra `YA ESCANEADO` y el conteo **no** sube con el repetido → *Confirmar* → la hoja de nota se abre porque falta un paquete → escribir la nota → aterrizar en `/completa` → las cuatro cifras y la nota están ahí. Cierra con `teardown`.

- [ ] **Step 2: No lo corras localmente — no puede correr**

`npm run e2e:qa` desde tu máquina falla por los puertos del VPS, no por tu test. Este test se ejecuta en el job `e2e-qa` tras el merge del PR. Revisa ahí su salida (`gh run view <id> --log`) y **no declares el E2E como pasando hasta haberla leído**: el job es `continue-on-error`, así que un PR verde no significa que este test haya pasado, ni siquiera que se haya recogido.

- [ ] **Step 3: Commit**

```bash
git add e2e/reception-mobile.spec.ts
git commit -m "test(spec-62): E2E móvil de patio a acta"
```

### Task 26: Cierra el spec

- [ ] **Step 1: Verifica todo** — `npm run type-check && npm run lint && npm run test:run`, y la cobertura sobre 70% con `npm run test:coverage`.
- [ ] **Step 2: PR con auto-merge** desde `feat/spec-62-chunk4-acta`, espera `gh pr checks` y confirma el merge con `gh pr view <N> --json state,mergedAt`.
- [ ] **Step 3: Revisa las tres pantallas en QA** desde un teléfono real o DevTools a 390×844, con el tema claro y el oscuro.
- [ ] **Step 4: Deja el `**Status:**` del spec en `in progress`** hasta que el usuario confirme que está terminado. Nunca lo declares `completed` por tu cuenta.
