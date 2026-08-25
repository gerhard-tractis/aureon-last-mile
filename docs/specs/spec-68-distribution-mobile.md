# Spec-68: Distribución en móvil — la nave en el teléfono

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding; fase 4.3 modo rápido de escritorio), [spec-62](spec-62-reception-mobile.md) (precedente móvil: rama de árbol completo bajo `lg`), [spec-39](spec-39-distribution-pending-list.md) / [spec-41](spec-41-pending-list-order-grouping.md) (pendientes por sectorizar), [spec-40](spec-40-dock-zone-barcode-labels.md) (etiquetas de andén), [spec-66](spec-66-ops-leader-role.md) (`ops_leader`), [spec-67](spec-67-sidebar-information-architecture.md) (`MobileTabBar`, secciones de nav)

**Status:** in progress

_Date: 2026-08-24_

---

## Goal

Dar a la cuadrilla de nave las pantallas de Distribución en el teléfono. Hoy el módulo entero es de escritorio: el operario que clasifica bultos de pie, con las manos ocupadas, tiene que caminar hasta un computador para ver qué le falta o para desatascar un paquete.

Ocho pantallas del canvas, `4c` a `4j`:

1. **`4c` — home de la nave.** Qué hay que hacer ahora y las tres colas del turno.
2. **`4d` — pendientes de sectorizar**, agrupados por el andén que calcula el motor.
3. **`4e` — hoja "Enviar … a"**: envío manual a un andén o a consolidación.
4. **`4f` — consolidación**, con selección múltiple para mover a andén o liberar.
5. **`4g` / `4h` / `4i` / `4j` — el bucle de escaneo**: leer el paquete, leer el andén, y el rechazo cuando el andén no corresponde.

El escritorio (`3d` estado inicial, `1d` modo rápido) ya está implementado y **no se rediseña**. Lo único que cambia allí es lo que cae de rebote: el campo de capacidad de andén y el rol que puede asignar a mano.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, artboards `4c`–`4j` | Geometría, jerarquía y copy |
| `design_handoff_aureon_rebrand/README.md`, secciones *3d / 3e* y *Dependencias de schema* | Intención de diseño y el vocabulario real del schema |
| `spec-62` | Precedente móvil: `useIsBelowLg`, componentes propios del módulo, rutas inmersivas |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

Los artboards `4a` / `4b` (escritorio) **quedan fuera** — ver *No-goals*.

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `4c` Home de la nave | `/app/distribution` bajo `lg` | Solo existe el árbol de escritorio (`3d`) |
| `4d` Pendientes de sectorizar | `/app/distribution/pendientes` (nueva) | Solo como panel dentro del modo rápido de escritorio |
| `4e` Hoja "Enviar … a" | hoja dentro de `4d` | `ManualAssignMenu`, dropdown de escritorio, solo jefatura |
| `4f` Consolidación | `/app/distribution/consolidacion` (nueva) | `ConsolidationPanel` de escritorio, solo *liberar* |
| `4g` Escanear paquete | `/app/distribution/quicksort` bajo `lg`, paso 1 | Consola de dos columnas, solo escritorio |
| `4h` + `4j` Escanear andén | misma ruta, paso 2 | Ídem |
| `4i` Andén incorrecto | misma ruta, estado de rechazo | Ídem |
| — Lista de andenes | `/app/distribution/andenes` (nueva) | No dibujada; ver *Decisión 3* |

### No-goals

- **`4a` / `4b`, escritorio.** Ya entregados en la fase 4.3 de spec-54 como `3d` / `1d`. Este spec no los toca salvo por los dos cambios transversales de la sección *Cambios de servidor*.
- **Cola offline para clasificación.** `4g` muestra **EN LÍNEA** a propósito: la clasificación ocurre dentro de la bodega, con señal. El README lo dice explícitamente sobre `3e` — *"a diferencia de `1h`, `3e` asume conexión"*. Si el andén también pierde señal, es un spec aparte que extiende el mecanismo de Recogida, no una variante escondida aquí.
- **Reingresos en móvil (`3r` / `3s`).** Siguen fuera, igual que en spec-62.
- **Forzar tema oscuro.** Decisión ya tomada en spec-54: el usuario elige.
- **Rediseñar el motor de sectorización.** `determineDockZone` y `validateDockDestination` se reutilizan tal cual.

## Decisiones

### 1. Rama de árbol completo bajo `lg`, con `useIsBelowLg`

El mismo mecanismo de `/app/pickup` y `/app/reception`. `useViewport` resuelve el valor en un `useEffect` post-hidratación con `SSR_SAFE_DEFAULT`, precisamente porque leer `matchMedia` en el inicializador de `useState` ya provocó un bug de hidratación en este repo.

El árbol móvil de `/app/distribution` **no monta** la grilla de KPIs, `ActiveSortersPanel` ni `ConsolidationPanel`. No los esconde con CSS — no los renderiza. Son la pantalla del jefe de nave sentado, no la del operario de pie.

El `<h1>` de escritorio queda tras `!isBelowLg`. Lección de QA de la fase 3h y repetida en spec-62: la cabecera de página siguió montándose junto a la cabecera móvil y a 390px salieron dos títulos.

### 2. La barra de pestañas del mock se descarta; gana la global

`4c` dibuja su propia barra inferior — Hoy · Clasificar · Andenes · Perfil. Choca con `MobileTabBar` (Recogida · Recepción · Distribución · Despacho), que spec-54 y spec-67 construyeron y que todo rol de operaciones recibe.

Gana la global. `4c` pasa a ser el árbol móvil de `/app/distribution`, no una ruta nueva con navegación propia. Dos barras de pestañas compitiendo en un teléfono es peor que una desviación de un mock, y una barra local le quitaría a la cuadrilla el acceso de un toque a las otras tres estaciones — que es justo lo que `ops_leader` necesita (spec-66).

`/app/distribution/pendientes`, `/consolidacion` y `/quicksort` se suman a `MOBILE_IMMERSIVE_PREFIXES`: las tres tienen barra de acciones fija abajo, y apilar `MobileTabBar` encima roba 60px de las pantallas más densas del módulo. `/app/distribution` **sí** conserva las pestañas: es la pantalla desde la que se navega.

`/app/distribution/andenes` **no** es inmersiva — es una lista sin barra fija.

### 3. `4c` promete una pantalla de Andenes que nadie dibujó

La fila *PROCESOS DE LA NAVE* de `4c` lista tres destinos: Pendientes de sectorizar, Consolidación y **Andenes**. Los dos primeros son `4d` y `4f`. El tercero no existe en el canvas.

En vez de inventar una pantalla o de dejar una fila muerta, `/app/distribution/andenes` es una lista plana: una fila por andén activo con código, nombre de zona, conteo y barra de llenado donde haya capacidad configurada. Sale entera de `useDockZones` + `useSectorizedByZone`. Sin datos nuevos, sin decisiones nuevas, sin mapa ni grilla — la grilla de tarjetas de `1d` es de escritorio y a 390px se convierte en una columna de scroll infinito.

Si el diseño dibuja después esa pantalla, esto es lo que se reemplaza.

### 4. `4h` y `4j` son la misma pantalla

Lo dice el propio canvas en su nota de cierre: *"`4j` queda como la variante del paso 2 con contexto de orden incompleta y capacidad del andén."*

El paso 2 se implementa una vez y renderiza, de arriba a abajo:

- la tarjeta de destino (`LLEVAR A` · código grande · comuna · rutas · código de bulto y orden);
- el aviso de **orden incompleta** cuando a la orden le quedan bultos hermanos sin sectorizar;
- el bloque de **capacidad del andén** cuando la zona la tiene configurada;
- el campo de escaneo de andén, armado;
- los últimos escaneos;
- la barra de acciones fija.

`4i` es esa misma pantalla con la tarjeta de destino en paleta de error y el campo re-armado. Tres artboards, un componente con tres estados — no tres componentes que se van a desincronizar al primer cambio de copy.

### 5. La capacidad de andén necesita una columna y una pantalla donde llenarla

`4e`, `4h` y `4j` muestran ocupación: *"169 / 180 · casi lleno"*, *"A3 va en 169 / 180 · si no cabe, mándalo a consolidación"*, *"Quedan 11 espacios · avisa al jefe de andén antes de llenarlo"*. Es una instrucción operativa: cambia lo que la persona hace con la caja que tiene en la mano.

Hoy el sistema conoce el numerador y nada más. `dock_zones` no tiene capacidad — se verificó contra todas las migraciones de `packages/database/supabase/migrations` — y por eso el comentario de cabecera de `app/app/distribution/page.tsx` dice que la ocupación *no se renderiza*.

```sql
ALTER TABLE public.dock_zones
  ADD COLUMN IF NOT EXISTS capacity INT;
```

Nullable a propósito. Una zona sin capacidad configurada muestra el conteo **sin barra y sin umbral**, no una barra al 0 %. Los umbrales son de presentación, no de datos: ≥ 90 % casi lleno.

Y una columna que nadie puede llenar se queda nula para siempre, así que el cambio incluye el campo en `DockZoneForm` (*Capacidad (paquetes)*, opcional) y su paso por `useCreateDockZone` / `useUpdateDockZone`.

La aritmética vive en `lib/distribution/dock-capacity.ts` — porcentaje, tono y *"quedan N espacios"* — con sus tests. Cuatro pantallas la leen; escrita cuatro veces se desincroniza a la primera.

### 6. El envío manual suma `ops_leader`, no a toda la cuadrilla

`4e` y `4f` ponen el envío manual en el teléfono de la nave. Hoy `useManualDockAssignment` lo restringe a `operations_manager` y `admin`: es la salida de emergencia cuando el lector falla, y queda auditada con `manual_override = true`.

Se suma `ops_leader` — el rol de piso que trabaja las cuatro estaciones (spec-66). `warehouse_staff` **no**: si cualquiera puede asignar a mano, el escaneo físico del andén deja de ser una confirmación y pasa a ser opcional, que es exactamente lo que `validateDockDestination` existe para impedir.

El cambio también enciende `ManualAssignMenu` en el escritorio para ese rol. Es correcto y es intencional: es la misma salida de emergencia, la misma fila de auditoría y la misma responsabilidad nominal. La frase de `4e` — *"El envío manual queda registrado con tu nombre y hora"* — sigue siendo cierta.

### 7. *Mover a andén* no necesita mutación nueva

La acción primaria de `4f` es una asignación manual a la zona elegida: `useManualDockAssignment` por cada paquete seleccionado. `trg_dock_scan_advance_package_status` ya enruta las filas de override leyendo `dock_scans.dock_zone_id` directamente (migración `20260504000002`), sin pasar por lote.

*Liberar a sectorización* es `useReleaseFromConsolidation`, que ya existe.

**Verificado en QA el 2026-08-25** (paso 0 del plan): se insertó una fila en `dock_scans` con `manual_override = TRUE` y `dock_zone_id` de una zona no-consolidación sobre un paquete en `retenido`. Resultado: `before=retenido after=sectorizado zone_moved=t` — el trigger promueve el paquete a `sectorizado` y apunta `dock_zone_id` a la zona elegida, sin guarda sobre el estado previo. Confirma la lectura del cuerpo del trigger: decide por `is_consolidation` de la zona destino, no por el estado previo del paquete. *Mover a andén* en `4f` reutiliza `useManualDockAssignment` — no hace falta mutación ni RPC nueva.

### 8. Componentes propios del módulo, no primitivos compartidos nuevos

Recogida y Recepción no extrajeron un shell móvil genérico: cada una tiene sus `*MobileHeader`, `*MobileFooterActions`, `*MobileCompactRow` dentro de su carpeta. Distribución hace lo mismo bajo `components/distribution/`.

Se comparte lo que ya es compartido — `ScanField`, `ScanResult` (con su tono `warn` de spec-62), `StatusBadge`, `EmptyState`, `Skeleton` — y no se inventa una capa nueva para dos consumidores.

La única excepción es `DockCapacityBar`, que nace compartida porque la leen `4e`, el paso 2, `/andenes` y, opcionalmente, la `DockCard` de escritorio.

### 9. Lo que el mock promete y el schema no tiene

- **`4c`, *"Nave Quilicura · turno 14:00"*.** No hay turnos en el schema. La cabecera queda como saludo + contexto de módulo + chip de conexión. No se inventa un turno.
- **`4c`, KPI *SALEN YA*.** Sí es derivable: paquetes en consolidación cuya `orders.delivery_date` es hoy o mañana. Se calcula sobre `useConsolidation`, que ya trae `delivery_date`. No es columna ni hook nuevo.
- **`4d`, agrupación por andén con bloque *SIN ANDÉN*.** `usePendingSectorization` ya devuelve buckets por zona con su `matchResult`; el bloque *SIN ANDÉN* del mock es el bucket con `flagged` (comuna sin mapear). No hace falta consulta nueva.
- **`4h`/`4j`, *rutas R-2481 · R-2483* bajo el nombre del andén.** Se omite en la primera entrega: ligar andén → rutas del día es una consulta que hoy no existe y que no cambia la decisión del operario, que es *dónde pongo esta caja*. Queda anotado, no inventado.

## Accesibilidad

Regla del handoff, obligatoria en las ocho pantallas: **ninguna zona táctil bajo 44px**; acciones primarias de 56–60px porque se usan con guantes y en movimiento; nada informativo bajo 11px (9.5px solo para eyebrows en mayúsculas con tracking).

Es la misma regla que ya sostienen `3i`/`3q`/`3p`, y los tests de cada pantalla la comprueban sobre las clases de altura, no de vista.

## Arquitectura de componentes

```
apps/frontend/src/
  app/app/distribution/
    page.tsx                       ← rama isBelowLg → DistributionMobileView
    pendientes/page.tsx            ← nueva (4d)
    consolidacion/page.tsx         ← nueva (4f)
    andenes/page.tsx               ← nueva (decisión 3)
    quicksort/page.tsx             ← rama isBelowLg → QuickSortMobile
  components/distribution/
    DistributionMobileView.tsx     4c   home: tarea, 3 KPIs, procesos, aviso de comunas
    DistributionMobileHeader.tsx   —    flecha atrás + título + subtítulo + chip de estado
    PendingMobileList.tsx          4d   lista agrupada por zona
    SendToDockSheet.tsx            4e   sugerido primero, alternativas, consolidación, nota
    ConsolidationMobileView.tsx    4f   urgentes / próximos, selección, dos acciones
    DockListMobile.tsx             —    lista de andenes (decisión 3)
    QuickSortMobile.tsx            4g   paso 1: campo + últimos escaneos
    QuickSortMobileDock.tsx       4h/4j paso 2: destino, orden incompleta, capacidad, campo
    QuickSortMobileRejected.tsx    4i   rechazo + campo re-armado
    DockCapacityBar.tsx            —    compartida
  lib/distribution/
    dock-capacity.ts               —    porcentaje, tono, "quedan N espacios"
```

Todos los archivos bajo 300 líneas. Si `QuickSortMobileDock` se acerca al límite, se parte por bloque (tarjeta de destino / bloque de escaneo), no se deja crecer.

**Sobre reutilizar la máquina de estados del escaneo.** `QuickSortScanner` ya implementa el flujo de dos pasos completo — búsqueda del paquete, `determineDockZone`, apertura de lote, `validateDockDestination`, redirección a consolidación, cierre de lote. Este spec le da presentación móvil; **no lo reescribe**. Si envolver ambas presentaciones sobre el mismo componente resulta forzado, la lógica se extrae a un hook (`useQuickSortFlow`) con sus tests y las dos presentaciones lo consumen. Lo que no se hace es duplicarla.

## Plan de implementación

Cada tarea es TDD: test primero, rojo, implementación, verde. `npx vitest --pool=forks` corre localmente (no hay prettier en este repo — no invocar `npx prettier`).

Cada fase es un PR revisable por separado, con auto-merge.

### Fase 0 — Verificación previa (sin código de UI)

**0.1** ✅ Verificado en QA el 2026-08-25: insertar `dock_scans` con `manual_override = true` y `dock_zone_id` de una zona no-consolidación, sobre un paquete en `retenido`, deja el paquete en `sectorizado` con `dock_zone_id` puesto (`before=retenido after=sectorizado zone_moved=t`). Decisión 7 queda confirmada tal como estaba escrita — `4f` no necesita mutación propia.

### Fase 1 — Capacidad de andén

**1.1** Migración `ALTER TABLE public.dock_zones ADD COLUMN IF NOT EXISTS capacity INT;` con `COMMENT ON COLUMN` que explique el nullable.
**1.2** `lib/distribution/dock-capacity.ts` + tests: `null` → sin barra; `0 < n < 90 %` → neutro; `≥ 90 %` → warning; `≥ 100 %` → error; *"quedan N espacios"* con N nunca negativo.
**1.3** `DockZoneRecord` gana `capacity: number | null`; `useDockZones` lo selecciona; `useCreateDockZone` / `useUpdateDockZone` lo escriben. Tests de hook.
**1.4** `DockZoneForm`: campo *Capacidad (paquetes)*, opcional, numérico, vacío → `null`. Test de formulario.
**1.5** `DockCapacityBar` + test: no renderiza nada sin capacidad.

Verificación: correr la migración contra QA y confirmar que la columna existe. Recordatorio del repo — un check verde de PR **no** prueba que la migración se aplicó; el filtro de rutas de `deploy.yml` puede saltarse el job de base de datos.

### Fase 2 — Shell móvil y home (`4c`)

**2.1** `DistributionMobileHeader` + test (altura, back, chip).
**2.2** `DistributionMobileView` + test: tarjeta *TU TAREA AHORA* → `/app/distribution/quicksort`; tres KPIs (pendientes, consolidación, salen ya); tres filas de proceso ≥ 60px; aviso de comunas sin andén solo cuando `useUnmatchedComunas` trae alguna.
**2.3** Rama en `app/app/distribution/page.tsx` con `useIsBelowLg`; `<h1>` y paneles de escritorio tras `!isBelowLg`. Test: el árbol de escritorio no monta bajo `lg` y viceversa.
**2.4** Cálculo *salen ya* con test de límites (hoy, mañana, pasado, sin fecha).

### Fase 3 — Pendientes y envío manual (`4d`, `4e`)

**3.1** `PendingMobileList` + test: grupos por zona con encabezado `ANDÉN <code>` y conteo; bucket `flagged` como *SIN ANDÉN* en paleta warning; órdenes de varios bultos expandidas, de un bulto en fila compacta; toda fila ≥ 44px.
**3.2** Ruta `/app/distribution/pendientes` + barra fija (*Escanear* + selección). Sumar el prefijo a `MOBILE_IMMERSIVE_PREFIXES` con su test.
**3.3** `useManualDockAssignment`: sumar `ops_leader` al set de roles. Test: `warehouse_staff` → `canUse` falso, `ops_leader` → verdadero.
**3.4** `SendToDockSheet` + test: andén sugerido primero con badge *SUGERIDO* y su ocupación; alternativas; Consolidación al final; nota de auditoría; ausente por completo cuando `canUse` es falso.

### Fase 4 — Consolidación (`4f`)

**4.1** `ConsolidationMobileView` + test: partición urgentes (hoy/mañana) vs próximos; paquetes sin andén marcados en error; selección múltiple; contador *N SELECCIONADOS*.
**4.2** Ruta `/app/distribution/consolidacion` + prefijo inmersivo + test.
**4.3** *Mover a andén* (asignación manual en lote, gated por `canUse`) y *Liberar a sectorización*. Tests sobre ambas mutaciones y sobre el estado deshabilitado con cero selección.

### Fase 5 — Bucle de escaneo (`4g`, `4h`, `4i`, `4j`)

**5.1** Extraer `useQuickSortFlow` desde `QuickSortScanner` **solo si** la presentación móvil no puede consumir el componente actual; si se extrae, los tests existentes de `QuickSortScanner` se mueven al hook y el escritorio pasa a consumirlo sin cambio de comportamiento.
**5.2** `QuickSortMobile` (paso 1) + test: campo enfocado, últimos escaneos, contador de sesión, dos acciones secundarias.
**5.3** `QuickSortMobileDock` (paso 2) + tests: código de andén a 62px; aviso de orden incompleta solo cuando corresponde; bloque de capacidad solo con capacidad configurada; campo de andén armado.
**5.4** `QuickSortMobileRejected` (`4i`) + test: el paquete sigue sin asignar, el campo vuelve a quedar armado, y el mensaje nombra el andén esperado.
**5.5** Rama `isBelowLg` en `quicksort/page.tsx` + prefijo inmersivo + test.

### Fase 6 — Lista de andenes y cierre

**6.1** `DockListMobile` + ruta `/app/distribution/andenes` + test.
**6.2** Repaso de accesibilidad sobre las ocho pantallas: sin zona táctil bajo 44px, sin texto informativo bajo 11px.
**6.3** Verificación en QA con hardware real de escáner. Recordatorios del repo: el lector de QA **no** emite Enter — usar `ScanField` / `useScannerAutoSubmit`, nunca un submit propio — y el layout US/ES corrompe guiones. Si un arreglo "no funciona" en QA, descartar primero un bundle PWA rancio antes de volver a depurar.

## Cobertura

Mantener sobre 70 %. Cada componente nuevo llega con su test en el mismo commit.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El trigger no promueve `retenido → sectorizado` en el camino de override | Fase 0 lo comprueba antes de que nada dependa de ello |
| `QuickSortScanner` resulta imposible de reutilizar en móvil sin reescribirlo | Fase 5.1 hace la extracción explícita, con los tests migrados, en vez de duplicar la máquina de estados |
| La migración de capacidad pasa el PR sin aplicarse | Verificación manual contra QA en la fase 1, no confianza en los checks verdes |
| El árbol móvil monta cabeceras duplicadas | Test explícito por pantalla; es el bug que ya apareció en 3h y en spec-62 |
