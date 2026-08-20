# Spec-62: Recepción en móvil — patio, descarga y acta

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding; fases 4.5 Recepción escritorio y 4.8 móvil), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`route_receptions`, recepción consolidada), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (`open_route_reception`, `unexpected_count`, bloqueo de escaneo de recogida), [spec-43](spec-43-failed-delivery-return-flow.md) (reingresos)

**Status:** backlog

_Date: 2026-08-20_

---

## Goal

Dar a la cuadrilla de andén las tres pantallas de Recepción que hoy solo existen en escritorio, dibujadas para el terreno y no como una condensación de la vista del jefe:

1. **`3i` — patio.** Qué camión espera y cuánto lleva esperando. Una sola acción.
2. **`3q` — descarga.** Escaneo continuo con lector Zebra, sin confirmar bulto por bulto.
3. **`3p` — acta.** Qué quedó registrado al cerrar y qué se dispara con eso.

Más la pantalla que el servidor ya exige y ninguna UI móvil captura: la **nota de discrepancia** antes de cerrar.

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

5. **La regla de nota obligatoria se extrae a `lib/reception/finalizeRule.ts`.** Vive dentro de `FinalizeReceptionButton` y es un espejo del guard de `complete_route_reception`:

   ```
   matched  := received_count - unexpected_count
   needsNote := matched !== expected_count || unexpected_count > 0
   ```

   Con dos consumidores (diálogo de escritorio y hoja móvil) no puede estar escrita dos veces: un servidor que exige nota donde la UI no la pide deja la recepción sin poder cerrarse. Se extrae con sus tests, y ambos la importan.

6. **La barra de pestañas cede en la sesión.** `/app/reception/route` se suma a `MOBILE_IMMERSIVE_PREFIXES`, junto a los tres prefijos de Recogida. `3q` y `3p` tienen barra de acciones fija abajo; apilarla con `MobileTabBar` deja dos barras y roba 60px de la pantalla más densa del módulo. `/app/reception` **sí** conserva las pestañas, con Recepción activa.

7. **El `<h1>` de escritorio no se renderiza en móvil.** Lección de QA en la fase 3h: la cabecera de página siguió montándose junto a la cabecera móvil y a 390px salieron dos títulos. La cabecera de página queda tras `!isBelowLg`.

## Lo que el mock pide y el sistema no tiene

Cada renuncia con su motivo. Ninguna se rellena con un dato inventado.

| Elemento del mock | Qué pasa | Por qué |
|---|---|---|
| `Recepción · Andén 2`, `turno AM` | Se cae. Cabecera: "Recepción" + nombre del receptor e iniciales | No hay andén de recepción ni turnos en el schema. `dock_zones` es distribución, no el andén donde se descarga |
| Barra de estado del teléfono (`12:41`, batería, `EN LÍNEA`) | No se dibuja. En su lugar, el chip real de `useSyncQueue` | Es cromo del sistema operativo. Dibujar una batería falsa es mentir sobre el dispositivo |
| `Zebra TC22 · lector listo` | Se muestra el foco real del `ScanField` ("Lector listo" / "Toca para reactivar el lector") + botón de código manual de 44px | No podemos identificar el modelo del lector. El foco del input sí es real, y es exactamente lo que determina si el gatillo va a aterrizar |
| `88 paquetes esperados` antes de abrir | Se muestra solo en rutas ya en patio (`in_transit`) | `expected_count` se congela en `open_route_reception`. Antes de eso no hay expectativa que mostrar |
| `Ver acta de la ruta` (segunda acción de `3p`) | Enlaza a `/app/reception/route/[routeId]/preview` | La pantalla ya es el acta. El botón lleva al detalle de la ruta, que sí es otra cosa |
| `Las 3 cargas de la ruta quedaron cerradas` | Se compone desde `snapshot.manifests.length` | Es un efecto real de `trg_route_receptions_status_sync`, no texto fijo |

## Pantallas

### `3i` — Patio (`/app/reception` bajo `lg`)

Datos: `useIncomingRoutes(operatorId, 'in_transit')` (patio), `'in_progress'` (en camino) y `useOpenDiscrepancies`. La espera sale de `buildArrivals` / `arrivals.ts`, que ya la deriva de `pickup_routes.in_transit_at` — se reutiliza, no se recalcula.

- **Héroe** = la ruta en patio que más espera. Código `PR-…` en mono 30px, conductor y patente, `N paquetes esperados`, badge de espera en paleta error sobre `YARD_WAIT_WARNING_MINUTES`. Acción **Iniciar conteo**, 64px → `/app/reception/route/[id]`. Navega directo: una ruta `in_transit` ya tiene su recepción abierta.
- **También en patio**: el resto, filas de 56px con chevron.
- **Diferencias abiertas**: bloque en paleta error con *Resolver*, desde `useOpenDiscrepancies`.
- **Pie fijo**: *Escanear QR de ruta* (`RouteQRScannerEntry` en hoja a pantalla completa) y *Recibir sin QR* (`ReceiveWithoutQRButton`). Son los dos únicos caminos que pueden llamar a `open_route_reception`, que congela `expected_count` y bloquea el escaneo de recogida del conductor: nunca se invoca al montar.
- Sin tarjetas KPI y sin conmutador de tema, como pide el mock.
- Vacío: `EmptyState` con `ArrowUpDown` — "Ningún camión en patio", y el pie sigue disponible.

### `3q` — Descarga (`/app/reception/route/[routeId]` bajo `lg`)

Datos: `useRouteReceptionSnapshot`, `useReceptionScan`, `useSyncQueue`. Mutaciones sin cambios.

- **Cabecera fija**: `PR-…`, conductor, `61 / 88` en mono 26px y barra de 8px. Chip de cola cuando `useSyncQueue` no está `online`, con la redacción del handoff: *"Se guardan en el dispositivo y se envían solos al recuperar señal."*
- **`ScanField size="sm"`** (62px), siempre enfocado, con `useScannerAutoSubmit` para el lector de QA que no manda sufijo Enter.
- **Bloque de resultado persistente** (`ScanResult`), hasta el siguiente escaneo. Hoy la página lo borra con un `setTimeout` de 3s; el handoff pide lo contrario y esa línea se elimina en móvil y escritorio.

  | `scanResult` | Tono | Titular |
  |---|---|---|
  | `received` | ok | `RECIBIDO` + contador |
  | `received` con `unexpected` | warn | `AJENO · NO VENÍA EN ESTA RUTA` |
  | `duplicate` | warn | `YA ESCANEADO` + hora del primero |
  | `not_found` | error | `NO ESTÁ EN LA RUTA` |
  | `route_mismatch` | error | `ES DE OTRA RUTA` |

- **Historial** desde `snapshot.scans`, más reciente arriba, con chips `AJENO` / `REPETIDO`. Ningún resultado bloquea el flujo: se registra, se marca y el conteo sigue.
- **Pie fijo**: *Reportar discrepancia* (abre la hoja de nota) y *Confirmar*, 56px. *Confirmar* aplica `needsNote` de `finalizeRule.ts`: si es falso llama `complete_route_reception` con `null`; si es verdadero abre la hoja.
- **Hoja de nota**: `Sheet` inferior a pantalla completa, textarea, el conteo que la motiva ("faltan 2 · 1 ajeno") y confirmación. Sin texto no cierra — igual que el guard del servidor.

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
components/reception/ReceptionMobileSession.tsx     A  3q
components/reception/ReceptionScanFeedback.tsx      A  mapea scanResult → props de ScanResult
components/reception/DiscrepancyNoteSheet.tsx       A
components/reception/ReceptionReceipt.tsx           A  cuerpo de 3p
components/reception/FinalizeReceptionButton.tsx    M  importa finalizeRule
components/scan/ScanResult.tsx                      M  tono warn
components/sidebar/navigation.ts                    M  /app/reception/route inmersiva

lib/reception/finalizeRule.ts                       A  needsNote / matched / missing
lib/reception/receptionMobileHelpers.ts             A  iniciales, hora, etiquetas de espera
```

Hooks: ninguno nuevo. `useIncomingRoutes`, `useOpenDiscrepancies`, `useRouteReceptionSnapshot`, `useReceptionScan`, `useCompleteRouteReception`, `useSyncQueue`, `useIsBelowLg`, `useCurrentUserName` se consumen tal cual.

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

- `finalizeRule.test.ts` — la tabla completa, incluido el caso `10 esperados · 10 recibidos · 1 ajeno` que exige nota pese a cuadrar en crudo.
- `ReceptionMobileView.test.tsx` — el héroe es la ruta que más espera; sin rutas en patio va a vacío; *Iniciar conteo* navega; el pie no llama a `open_route_reception` al montar.
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
| **1 — Base compartida** | `finalizeRule.ts` extraído con tests, `ScanResult` tono `warn`, `/app/reception/route` inmersiva, `receptionMobileHelpers.ts`. Sin cambios visibles. |
| **2 — `3i` patio** | `ReceptionMobileView` y sus cuatro componentes; rama en `page.tsx`. |
| **3 — `3q` descarga + nota** | `ReceptionMobileSession`, `ReceptionScanFeedback`, `DiscrepancyNoteSheet`; rama en la página de sesión; se elimina el auto-ocultado de 3s. |
| **4 — `3p` acta** | Ruta nueva, `ReceptionReceipt`, y la redirección de cierre en ambos árboles. |
| **5 — E2E** | Playwright móvil contra QA. |

## Preguntas abiertas

1. **Reingresos (`3r`/`3s`).** Al abrirlos hay que decidir con el negocio si el tercer intento fallido obliga a elegir destino y si esa regla se valida en el servidor — hoy no hay RPC de cierre para reingresos.
2. **Rutas en patio simultáneas.** El mock asume una en curso; el schema no lo impide. La sesión es por ruta, así que abrir una segunda no rompe nada, pero conviene confirmar si operaciones quiere permitirlo o advertirlo.
