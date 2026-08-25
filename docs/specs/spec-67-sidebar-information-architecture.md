# Spec-67: Arquitectura de información del sidebar — tres secciones por ritmo

> **Related:** [spec-54](spec-54-ui-rebrand.md) (creó las dos secciones actuales), [spec-65](spec-65-pedidos-tab.md) (añadió Pedidos a OPERACIÓN y litigó `resolveLandingPath`), [spec-45](spec-45-module-activation-layer.md) (activación de módulos), [spec-66](spec-66-ops-leader-role.md) (`ops_leader` y la barra de pestañas móvil), [spec-60](spec-60-control-tower-fleet-map.md) (Torre de control)

**Status:** in progress

_Date: 2026-08-24_

---

## Goal

Reagrupar el sidebar de **dos secciones a tres**, ordenadas por **ritmo de lectura** en vez de por tipo de objeto, y sacar del árbol de rutas las páginas que no pertenecen a ninguna.

El disparador no es feedback de usuarios: **todavía no hay producción**. Es que `OPERACIÓN` dejó de significar una sola cosa. Hoy contiene seis ítems, de los cuales cuatro son estaciones físicas —módulo, permiso, contador de cola y escáner— y dos no son ninguna de esas cosas: `Torre de control` (superficie de monitoreo) y `Pedidos` (índice transversal de entidades).

El síntoma ya está escrito en el código. `navigation.mobile.ts` mantiene a mano un `MOBILE_TAB_EXCLUDED_HREFS` con exactamente esos dos `href` y diez líneas de comentario explicando por qué no son pestañas de conductor. El código ya sabe que no pertenecen ahí; la estructura de secciones simplemente no se lo deja decir.

## Contexto: qué hace el resto de la industria

Se revisaron las plataformas de referencia antes de decidir el corte. El patrón es consistente:

| Producto | Cómo agrupa | Fuente |
|---|---|---|
| **Bringg** | Por horizonte temporal: **Planning** (antes — Order Manager, Route Monitor) → **Dispatch** (ahora — List, Map) → **History** (después). El listado transversal de órdenes (*Order Manager*) **no** cuelga de ninguna etapa de ejecución. | [about the platform](https://help.bringg.com/docs/about-the-bringg-platform), [find an order](https://help.bringg.com/docs/find-an-order-in-bringg) |
| **Onfleet** | La superficie de monitoreo en vivo tiene slot propio de primer nivel (**Command Center**), separada de la lista de trabajo; lo retrospectivo se colapsa en un solo **Analyze**. | [Command Center](https://support.onfleet.com/hc/en-us/articles/35183133144980-Command-Center), [Dashboard Analytics](https://support.onfleet.com/hc/en-us/articles/360023910431-Dashboard-Analytics) |
| **Bringg (docs)** | Organiza por rol: **Admin / Dispatcher / Driver**. | [help.bringg.com](https://help.bringg.com/) |

Cuatro reglas se repiten en todos:

1. Agrupar por **ritmo** (ahora / antes y después), no por tipo de objeto.
2. La **torre de control siempre es su propia cosa**, primera. Es una superficie de monitoreo, no una cola.
3. Un **índice transversal de entidades** (pedidos) nunca se anida dentro de una etapa de ejecución.
4. **Ajustes/Admin al final**, separados visualmente.

El patrón de Bringg de agrupar por rol **no se adopta**: `isVisible` más las compuertas de módulo ya producen un sidebar específico por rol. Poner encabezados de rol etiquetaría lo que el filtrado ya hace.

## Non-Goals

- **Renombrar `OPERACIÓN` o `GESTIÓN`.** Ambos nombres siguen siendo correctos una vez que su contenido queda bien acotado. Solo se añade una sección.
- **Agrupar por rol.** Ver arriba: redundante con la capa de permisos.
- **Quitarle el contador a `Pedidos`.** `countKey: 'orders'` se conserva. Ver *Decisión 2*.
- **Tocar la tabla `todo_list` ni su migración.** Se borra la página que la consume y los métodos de cliente que quedan huérfanos, no el esquema. Dropear una tabla es una decisión aparte.
- **Unificar las dos páginas de auditoría.** Fuera de alcance por decisión explícita del usuario. Ver *Trabajo derivado*.
- **Rediseño visual.** No cambian tokens, iconos, tipografía ni el componente `SidebarNavItem`. Esto es agrupación y orden, nada más.
- **Variante móvil nueva.** La barra de pestañas se **simplifica** como efecto secundario, pero no cambia lo que el conductor ve.

> **Ojo:** *"no cambiar `resolveLandingPath`"* era un Non-Goal en el borrador de este spec y **se retiró** durante la revisión. La reagrupación lo rompe y hay que cambiarlo a propósito. Ver *Decisión 8*, que es el cambio de comportamiento más importante del spec.

---

## Estado actual

```
OPERACIÓN                      GESTIÓN
  Torre de control               Dashboard ejecutivo
  Pedidos                        Capacidad
  Recogida                       Conversaciones
  Recepción                      Auditoría
  Distribución                   Admin
  Despacho
```

Rutas existentes sin entrada en el sidebar: `/app/storage`, `/app/table`, `/app/ocr-test`, `/app/dev/wismo-test`, `/app/user-settings`.

## Estado objetivo

```
SEGUIMIENTO          ← transversal, en vivo, se lee antes de actuar
  Torre de control      toda la operación de un vistazo
  Pedidos               un pedido, en cualquier etapa
  Conversaciones        un cliente

OPERACIÓN            ← las estaciones del turno, en orden de flujo físico
  Recogida
  Recepción
  Distribución
  Despacho

GESTIÓN              ← antes y después del turno
  Dashboard ejecutivo
  Capacidad
  Auditoría
  ─────────
  Admin                 separado, último
```

---

## Decisiones tomadas

### 1. Tres secciones, cortadas por ritmo de lectura

`SEGUIMIENTO` responde *"¿qué está pasando ahora?"* y desciende por nivel de zoom: operación → pedido → cliente. `OPERACIÓN` responde *"¿qué me toca hacer?"*. `GESTIÓN` responde *"¿qué planeo y de qué rindo cuentas?"*.

El criterio de pertenencia a `OPERACIÓN` queda duro y verificable, en **una sola dirección**:

> **Invariante A — todo ítem de `OPERATION_ITEMS` tiene `module` y `countKey` definidos.**

Es una condición necesaria, no una equivalencia. `Pedidos` también tiene `countKey` y se queda en `SEGUIMIENTO` (*Decisión 2*), así que la recíproca —"nada fuera de OPERACIÓN tiene `countKey`"— es **falsa** y no debe afirmarse en ningún test.

En prosa, y sin equivalente testeable: los cuatro ítems de `OPERACIÓN` son además los únicos que llevan a una pantalla con escáner. "Tener escáner" no es una propiedad de `NavItem` (`navigation.ts:39-49`) y no se puede afirmar desde la definición de navegación; queda como justificación del corte, no como aserción.

### 2. `Conversaciones` se muda a SEGUIMIENTO; `Pedidos` conserva su contador

El bucle real de atención al cliente es Pedidos ↔ Conversaciones, y hoy esos dos ítems están a lados opuestos de un divisor. Además `Conversaciones` es reactiva y en vivo, que es exactamente la definición de `SEGUIMIENTO`; en `GESTIÓN` era el único ítem que no era ni planificación ni retrospectiva.

`Pedidos` mantiene `countKey: 'orders'` (`navigation.ts:84`) y su umbral `orders: 40` (`navigation.ts:175`). El contador de pedidos pendientes es información útil y quitarlo sería una regresión visible que este spec no busca. Por eso el Invariante A es unidireccional: la sección se define por lo que **debe** tener, no por lo que las demás tienen prohibido.

Nota de visibilidad: `Conversaciones` y `Pedidos` comparten predicado (`isAdminOrManager(ctx) || hasPermission('customer_service')(ctx)`), lo que confirma que sirven a la misma audiencia. `Torre de control` es más estrecha (`isAdminOrManager`), así que para un usuario `customer_service` la sección `SEGUIMIENTO` se renderiza con dos ítems, no tres. `buildNavSections` ya descarta secciones vacías, de modo que ningún rol ve un encabezado huérfano.

### 3. `Dashboard ejecutivo` se queda en GESTIÓN

Se consideró moverlo a `SEGUIMIENTO` junto a la torre. Se rechaza: el dashboard ejecutivo se lee por período (ayer, la semana), no por turno. La torre es tiempo real; el dashboard es retrospectiva agregada. Ponerlos juntos volvería a mezclar ritmos, que es el problema que este spec existe para resolver.

Es además el único ítem con `isVisible: () => true`, así que es el suelo garantizado de `GESTIÓN`: esa sección nunca queda vacía para ningún rol.

### 4. `MOBILE_TAB_EXCLUDED_HREFS` se borra

Una vez que `OPERATION_ITEMS` es exactamente las cuatro estaciones, `buildMobileTabs` puede mapear el array completo. La lista de exclusión y su comentario desaparecen; la promesa de "exactamente cuatro pestañas, siempre" pasa a estar garantizada por la estructura en lugar de por una lista mantenida a mano.

Se conserva intacta la restricción de import circular documentada en la cabecera de `navigation.mobile.ts`: `OPERATION_ITEMS` se sigue leyendo **solo dentro del cuerpo de la función**, nunca a nivel de módulo. Leerla a nivel de módulo tira `ReferenceError` por TDZ en tiempo de import — un crash de arranque, no un test rojo.

### 5. Herramientas internas: se mueven bajo `/admin`

`/app/ocr-test` y `/app/dev/wismo-test` son herramientas de diagnóstico reales, no restos:

| Ruta actual | Qué es | Compuerta actual | Destino |
|---|---|---|---|
| `/app/ocr-test` | Carga los `pickup_points` activos del operador y hace POST a `/api/ocr-test`, que proxea al sidecar GLM-OCR. Permite probar el OCR de manifiestos sin correr una recogida. | `ocr-test/page.tsx:16-18` — `role !== 'admin'` → `redirect('/app')` | `/admin/tools/ocr` |
| `/app/dev/wismo-test` | Simulador del flujo WISMO de cara al cliente. API completa detrás: crear/listar órdenes de prueba, empujar transiciones de estado, leer snapshot, purgar. | `dev/wismo-test/page.tsx:5,23-25` — `['admin','maintainer']`, si no → `notFound()`. **`maintainer` no existe** — ver *Decisión 9* | `/admin/tools/wismo` |

`/admin` ya es un contenedor establecido con subpáginas (`admin/users`, `admin/modules`, `admin/audit-logs`), así que es el hogar natural. No entran al sidebar principal: un banco de pruebas en la barra de un operador se lee como producto.

> **`/admin` NO tiene compuerta de layout.** `src/app/admin/layout.tsx` son 18 líneas de providers (`GlobalProvider` / `Providers` / `BrandingProvider` / `AppLayout` / `Toaster`) **sin ninguna comprobación de auth**. Cada subpágina se protege sola, y con criterios distintos: `admin/page.tsx:16-22` admite `admin`, `operations_manager` **y** `super_admin`; `admin/modules/page.tsx` exige `super_admin`; `admin/audit-logs/page.tsx` exige `admin`.
>
> El riesgo real es el inverso del intuitivo: quien mueva las páginas **no debe** asumir que el layout protege `/admin/tools/**` y quitar el chequeo de la página. Hacerlo dejaría ambas herramientas abiertas a cualquier usuario autenticado. **Las dos compuertas per-page se copian textualmente**, incluida la diferencia entre `redirect` y `notFound()` — es deliberada, `wismo` es más silenciosa a propósito, y no se uniformiza aquí.

**Render condicional del bloque Herramientas.** `operations_manager` y `super_admin` llegan a `/admin` (`page.tsx:16-22`) pero **no** pueden abrir ninguna de las dos herramientas, que son solo para `admin` (*Decisión 9*). Renderles el enlace les daría un destino que los rebota. **El bloque Herramientas entero se renderiza solo para `admin`.**

Como ambas quedan con la misma audiencia que `/admin` mismo más el estrechamiento a `admin`, la mudanza no pierde acceso para nadie: hoy `/app/ocr-test` y `/app/dev/wismo-test` ya son alcanzables únicamente por `admin`.

### 6. `/app/table` y `/app/storage` se borran, y con ellos sus métodos de cliente

Ambas son restos de la plantilla SaaS sobre la que se arrancó el repo, no funcionalidad del producto:

- **`/app/table`** — un demo de lista de tareas sobre `todo_list`, creada por `packages/database/supabase/migrations/20250130181641_todo_list.sql`, fechada enero de 2025, antes de que este producto existiera. Importa un componente `Confetti` que se dispara al marcar una tarea.
- **`/app/storage`** — un gestor de archivos genérico sobre Supabase Storage. El problema no es que no se use: **cada llamada se indexa por `user!.id` y no aparece `operator_id` en ninguna**, lo que viola directamente la regla no negociable del proyecto. Es un bucket compartido acotado por usuario, no por operador.

**Corrección respecto del borrador de este spec:** es falso que `todo_list` no aparezca fuera de la migración y los tipos generados. `src/lib/supabase/unified.ts` define ocho métodos vivos en el cliente Supabase compartido cuyo **único** consumidor son estas dos páginas:

| Métodos | Líneas | Único consumidor |
|---|---|---|
| `uploadFile`, `getFiles`, `deleteFile`, `shareFile` | `unified.ts:59-80` | `app/app/storage/page.tsx` |
| `getMyTodoList`, `createTask`, `removeTask`, `updateAsDone` | `unified.ts:82-100` | `app/app/table/page.tsx` |

**Los ocho métodos se borran junto con las páginas.** Los cuatro de storage son precisamente las llamadas sin `operator_id` que este spec condena: borrar la página y dejar los métodos dejaría la violación viva en `lib/`, que es peor que dejarla en una página sin enlazar.

La tabla `todo_list`, su migración y sus tipos generados **se quedan** (*Non-Goals*).

### 7. `/app/user-settings` no cambia

Cambio de contraseña más configuración de MFA. Ya es alcanzable: `UserAccountMenuItems.tsx:42` enlaza desde el menú de avatar, y `TopBar.test.tsx:80` fija ese enlace. Ya tiene migaja en `navigation.breadcrumbs.ts:26` (`Gestión › Mi cuenta`). Que los ajustes de cuenta vivan en el menú de usuario y no en la navegación primaria es el patrón estándar — Onfleet y Bringg lo hacen igual.

### 8. `resolveLandingPath` deja de derivar su orden de escaneo del orden de las secciones

**Este es el cambio de comportamiento del spec, y no es opcional: sin él la reagrupación es una regresión.**

Hoy la función aplana **todas** las secciones visibles **en orden de sección** y elige el primer ítem que tenga `module` (`navigation.ts:217-221`). Ese acoplamiento —el orden de aterrizaje es un efecto secundario del orden de display— es la raíz del problema: cualquier reordenamiento visual mueve el aterrizaje de rebote.

Con la estructura nueva y la función sin tocar, `Conversaciones` (`module: ModuleKey.CONVERSATIONS`, `navigation.ts:138-143`) sube de la segunda sección a la posición 3 de la **primera** y salta por delante de las cuatro colas de estación:

| Contexto | Aterrizaje hoy | Tras reagrupar, función sin tocar |
|---|---|---|
| `operations_manager`, permisos `['distribution']`, `OPS_CONTROL` deshabilitado, `CONVERSATIONS` + `DISTRIBUTION` habilitados | `/app/distribution` | `/app/conversations` |
| permisos `['distribution','customer_service']`, módulos `[CONVERSATIONS, DISTRIBUTION]` | `/app/distribution` | `/app/conversations` |

> Los permisos son parte del caso, no decoración: `Distribución` se gatea con `hasPermission('distribution')` (`navigation.ts:112`), **no** por rol. Un `operations_manager` con `permissions: []` —como el de `navigation.test.ts:179-186`— no la ve, y esa fila no probaría nada.

Es la misma clase de regresión que spec-65 ya litigó: su cabecera documenta que la decisión original se revirtió porque un admin activado solo en `PICKUP` aterrizaba en `Pedidos` en vez de en su cola.

#### La regla

Se descartó una primera propuesta —*"preferir el primer ítem visible de `OPERATION_ITEMS`"*— porque es **incorrecta**: `Torre de control` se muda a `TRACKING_ITEMS`, así que dejaría de ser candidata y solo se alcanzaría por el fallback. Un `admin` con todo habilitado aterrizaría en `/app/pickup`, rompiendo `navigation.test.ts:169-176` ("sends an admin to the control tower") y `page.test.tsx:58-62` ("starts an admin in the control tower"). Queda registrada aquí para que no se reintente.

**Decisión:** la preferencia sigue siendo *"el primer ítem visible con `module`"*, pero el escaneo deja de leer `NAV_SECTIONS` y pasa a recorrer una **lista de precedencia explícita**, `LANDING_SCAN_ORDER`, que reproduce el orden aplanado de **hoy**:

```
Torre de control → Pedidos → Recogida → Recepción → Distribución → Despacho
                 → Dashboard ejecutivo → Capacidad → Conversaciones → Auditoría → Admin
```

Los once ítems, enumerados, **en el orden exacto en que `buildNavSections` los aplana hoy** (`OPERATION_ITEMS` y luego `MANAGEMENT_ITEMS`, `navigation.ts:72-156`). No es el orden de display nuevo, y no debe "ordenarse" para parecerse a él: su único trabajo es congelar la precedencia actual.

**Las dos pasadas recorren `LANDING_SCAN_ORDER`**: la preferencia (primer visible con `module`) y el fallback (primer visible, sin importar `module`). Ninguna vuelve a leer `NAV_SECTIONS`. La lista debe estar completa por eso: si faltara un ítem de `GESTIÓN`, el fallback cambiaría en silencio para un rol cuyo único ítem visible viva ahí. Hoy ningún caso lo expone — el default `?? '/app/dashboard'` (`navigation.ts:220`) lo absorbe — pero apoyarse en eso sería apoyarse en una coincidencia.

La neutralidad deja de depender de un trazado caso por caso y pasa a ser **cierta por construcción**: la lista *es*, literalmente, el orden aplanado de hoy. Y el acoplamiento se rompe para siempre — reordenar el sidebar mañana ya no mueve el aterrizaje de nadie.

Comportamiento resultante, **idéntico al de hoy en todas las filas**, sin excepciones ni hedges:

| Contexto | Aterrizaje | ¿Cambia? |
|---|---|---|
| `admin`, todos los módulos y permisos | `/app/operations-control` | no |
| `admin` + `ALL_PERMISSIONS`, solo `PICKUP` | Torre cae por módulo → `/app/pickup` (el caso de spec-65). El permiso `'pickup'` es obligatorio: `Recogida` se gatea por permiso (`navigation.ts:96`), no por rol | no |
| `admin`, solo `OPS_CONTROL` | `/app/operations-control` | no |
| `operations_manager`, `permissions: []` | ninguna estación visible → `/app/operations-control` | no |
| `operations_manager` + `['distribution']`, sin `OPS_CONTROL` | `/app/distribution` | no |
| `['distribution','customer_service']` + `[CONVERSATIONS, DISTRIBUTION]` | `/app/distribution` | no |
| `customer_service`, `CONVERSATIONS` habilitado | ni Torre ni estaciones; `Pedidos` no tiene `module` → `/app/conversations` | no |
| `customer_service`, `CONVERSATIONS` deshabilitado | ningún ítem con `module` → fallback → `/app/orders` | no |
| roles de `OPERATIONS_ROLES`, cada uno con **su módulo y su permiso** | su propia estación | no |

La cabecera de `resolveLandingPath` documenta dos rondas previas de razonamiento (la de Task 3 de spec-65 y la que la revirtió). **Se reescribe entera**, conservando el registro histórico y añadiendo esta tercera ronda: qué se rompía, por qué la lista explícita, y la advertencia de no volver a derivar el orden de `NAV_SECTIONS`.

### 9. `maintainer` no existe: se elimina de las compuertas al moverlas

`ALLOWED_ROLES = ['admin', 'maintainer']` aparece en **tres** archivos, pero **`maintainer` no está en el enum `user_role`**. El enum, tras todas sus migraciones, es:

```
pickup_crew · warehouse_staff · loading_crew · operations_manager · admin
  + super_admin (spec-45) · pickup_leader (spec-61) · ops_leader (spec-66)
```

`grep -rn maintainer packages/database/supabase/migrations/` devuelve **cero resultados**. Como `app_metadata.claims.role` se puebla desde ese enum, ningún usuario puede tener el valor. Las compuertas dicen `['admin','maintainer']` y evalúan a `['admin']` para todo usuario real.

**Origen del fantasma:** `docs/specs/spec-33-admin-maintainer.md` se titula *"Admin Maintainer"* pero describe un **panel de mantenimiento** — la página `/admin` con pestañas — y fija su acceso en `admin` y `operations_manager`. Nunca define un rol. Después `spec-36-wismo-agent-test-console.md:22` lo citó como *"spec-33 (admin/maintainer role — used for page gating)"*, leyendo el título del spec como si fuera un nombre de rol. De ahí se propagó.

Alcance de la propagación, todo código muerto:

| Archivo | Qué dice |
|---|---|
| `app/app/dev/wismo-test/page.tsx:5` | `ALLOWED_ROLES = ['admin', 'maintainer']` |
| `app/api/dev/wismo-test/_proxy.ts:4` | ídem, más el mensaje de error `'Forbidden: admin or maintainer role required'` (`:44`) |
| `app/api/ocr-test/route.ts:7` | ídem (`:65`). **Ya era inconsistente**: la API acepta `maintainer` mientras la página `/app/ocr-test` es solo `admin` |
| `apps/agents/src/dev/index.ts:49` | Comentario que describe la compuerta como *"requires an admin or maintainer session"*. No es código, pero queda mintiendo |
| **Tests — 8 archivos, 18 líneas.** Cuatro clases, y **no se tratan igual** | Ver el desglose completo debajo de esta tabla |

Desglose de las 18 líneas de test, que **no** son todas del mismo tipo. Tratarlas por igual borraría cobertura real:

| Clase | Líneas | Qué hacer |
|---|---|---|
| **4 casos que afirman el acceso** — *"allows maintainer role"* | `simulate-event/route.test.ts:101` (+mock `:104`), `_proxy.test.ts:97` (+`:98`), `ocr-test/route.test.ts:163` (+`:165`), `dev/wismo-test/page.test.tsx:79` (+`:80`) | **Se borran.** Afirman el acceso de un rol imposible |
| **8 títulos** — *"returns 401 when role is not admin/maintainer"* | `simulate-event/route.test.ts:53`, `purge/route.test.ts:49`, `test-orders/route.test.ts:64`, `[id]/snapshot/route.test.ts:49`, `[id]/state/route.test.ts:53`, `_proxy.test.ts:79`, `ocr-test/route.test.ts:157`, `dev/wismo-test/page.test.tsx:66` | **Se renombran, no se borran.** Es cobertura real de camino negativo; solo el nombre miente |
| **1 aserción sobre el texto del error** | `_proxy.test.ts:84` — `expect(body.error).toMatch(/admin or maintainer/)` | **Se actualiza al mensaje nuevo.** No es un nombre: al cambiar `_proxy.ts:44` este test **falla de verdad** |
| **1 comentario de cabecera** | `ocr-test/route.test.ts:6` | Se reescribe |

**Decisión:** se elimina `maintainer` de los tres `ALLOWED_ROLES` y del comentario de `agents`, y se aplica a los tests el tratamiento por clase de la tabla de arriba — **no** un borrado indiscriminado. Task 5 ya reescribe las compuertas de las dos páginas al moverlas, así que el cambio cae dentro de trabajo que de todos modos hay que hacer. Las dos rutas de API **no se mueven**, pero sí se les corrige el `ALLOWED_ROLES` y el texto del error.

**No se añade `maintainer` como rol real.** Sería una migración de enum, defaults de RBAC y UI de administración — su propio spec, y nadie ha pedido el rol.

Efecto neto sobre las compuertas: ambas herramientas quedan explícitamente `admin`-only, que es lo que ya eran en la práctica. **Ningún usuario real pierde acceso.**

---

## Riesgos

### Riesgo 1 — El aterrizaje depende del orden de la navegación (alto — materializado)

Ya no es hipotético: la *Decisión 8* documenta la regresión concreta y su arreglo. Lo que queda es asegurar que el arreglo es correcto para toda la matriz, no solo para los dos casos hallados.

**Mitigación, en este orden estricto:**
1. Escribir la matriz completa de Task 1 y correrla en verde **contra la estructura actual y la función actual**.
2. Reagrupar (Task 2 pasos 1-2, sin tocar `resolveLandingPath`). Se ponen rojas **exactamente dos filas**, las dos de la tabla de regresión de la *Decisión 8*: el `operations_manager` con `['distribution']` y sin `OPS_CONTROL`, y el contexto `['distribution','customer_service']`. Ambas pasan de su estación a `/app/conversations`. **Todas las demás siguen verdes** — incluida la del `admin` con todo habilitado, porque `Torre` conserva su `module` y su primera posición mientras la función siga leyendo `NAV_SECTIONS`.
3. Aplicar la *Decisión 8* (`LANDING_SCAN_ORDER`). Las dos filas vuelven a verde y ninguna otra se mueve, **sin editar ninguna expectativa**.

Si en el paso 3 hace falta tocar un valor esperado, parar: significa que el spec eligió mal y hay que replantear, no ajustar el test.

### Riesgo 2 — Las migas se desincronizan (medio)

`navigation.breadcrumbs.ts` mapea rutas a `{ section, page }`. Tres frentes:

1. Los tres ítems mudados necesitan `section: 'Seguimiento'`.
2. Las dos rutas borradas salen; las dos movidas apuntan a su destino en `/admin`.
3. **`EXTRA_CRUMBS` (`navigation.breadcrumbs.ts:24-25`) codifica `/app/orders/new` y `/app/orders/import` como `section: 'Gestión'`**, afirmado en `navigation.breadcrumbs.test.ts:36-42` y `:68-79`. Sin tocarlos, `/app/orders` renderizaría `Seguimiento › Pedidos` mientras sus propios hijos renderizan `Gestión › Nuevo pedido`. **Ambos pasan a `Seguimiento`.**

Las aserciones de `navigation.breadcrumbs.test.ts` que cambian son **cinco**, no dos:

| Línea | Ruta | Hoy | Pasa a |
|---|---|---|---|
| `:6-9` | `/app/operations-control` | `Operación › Torre de control` | `Seguimiento › …` |
| `:36-42`, `:68-79` | `/app/orders/new`, `/app/orders/import` | `Gestión › …` | `Seguimiento › …` |
| `:61-65` | `/app/orders` | `Operación › Pedidos` | `Seguimiento › Pedidos` |
| `:82-86` | `/app/orders/<uuid>` | `Operación › Pedidos` | `Seguimiento › Pedidos` |

El título del `describe` en `:58` (*"Pedidos (spec-65) vs. its longer EXTRA_CRUMBS siblings"*) sigue describiendo bien la mecánica de prefijo más largo y no necesita cambio.

Diferencia con `/app/user-settings`, que la *Decisión 7* sí deja en `Gestión`: "Mi cuenta" no es hija de ningún ítem del sidebar, así que su sección es una etiqueta libre y `Gestión` sigue leyéndose bien. `new` e `import` **sí** son hijas de `Pedidos`, y una hija que se contradice con su padre en la misma migaja es un bug, no una etiqueta.

Ojo también con `/app/ocr-test`: hoy `navigation.breadcrumbs.test.ts:28` **afirma que devuelve `null`** — se renderiza sin miga. Al moverla bajo `/admin` esa afirmación deja de tener sentido y hay que decidir la miga en vez de heredar el `null` por accidente.

### Riesgo 3 — Enlaces entrantes a las rutas movidas (bajo)

Un `grep` de `/app/ocr-test` y `/app/dev/wismo-test` sobre `apps/frontend/src` solo devuelve las rutas de API (`/api/dev/wismo-test/*`, `/api/ocr-test`) y sus tests. **Las rutas de API no se mueven** — solo cambia la página que las consume, y los hooks de wismo siguen apuntando a `/api/dev/wismo-test/*` sin cambios. No se detectaron enlaces de UI entrantes, pero el paso de verificación debe repetir el grep tras la mudanza.

### Riesgo 4 — Memoria muscular (bajo, aceptado)

Nadie fuera del equipo ha usado todavía el sidebar: no hay producción. El costo de reaprendizaje es esencialmente cero **ahora** y crece con cada semana de retraso. Ese es el argumento principal para hacerlo en este momento y no después.

---

## Trabajo derivado (fuera de alcance, registrado a propósito)

**Hay dos implementaciones independientes de logs de auditoría en el repo:**

| Ruta | Qué es | Roles |
|---|---|---|
| `/admin/audit-logs` | Original de Story 1.6. Server component. Filtros, export CSV, paginación de 50. | solo `admin` |
| `/app/audit-logs` | Rediseño de spec-13c. Client component, hooks propios (`useAuditLogsOps`, `useAuditLogUsers`) y componentes propios de tabla/filtros/export. | `operations_manager`, `admin` |

Ambas están vivas y ambas enlazadas. Que "Auditoría" aparezca tanto en `GESTIÓN` como dentro de Admin es el síntoma visible. Colapsarlas es una decisión de producto con pérdida de funcionalidad a evaluar, no un refactor de navegación — merece su propio spec.

---

## Plan de implementación

TDD en todos los pasos: test primero, verlo rojo, implementar, verlo verde. Sin excepciones.

### Task 1 — Fijar el comportamiento actual de aterrizaje (red antes de tocar nada)

**Este task no cambia código de producción.** Solo añade la red de seguridad del *Riesgo 1*.

1. En `src/app/app/page.test.tsx` (o un archivo hermano si crece de más), añadir un test parametrizado sobre la matriz **rol × módulos habilitados**, cubriendo como mínimo:
   - `admin` con todos los módulos y `ALL_PERMISSIONS` (hoy → `/app/operations-control`, fijado en `navigation.test.ts:169-176` y `page.test.tsx:58-62`)
   - `admin` con `ALL_PERMISSIONS` y solo el módulo `PICKUP` (el caso de la regresión de spec-65)
   - `admin` con solo `OPS_CONTROL`
   - `operations_manager` con todos los módulos
   - **`operations_manager` con `permissions: ['distribution']`, sin `OPS_CONTROL`, con `CONVERSATIONS` + `DISTRIBUTION`** ← fila de la *Decisión 8*. El permiso es obligatorio: `Distribución` se gatea por permiso, no por rol (`navigation.ts:112`).
   - **permisos `['distribution','customer_service']`, módulos `[CONVERSATIONS, DISTRIBUTION]`** ← fila de la *Decisión 8*
   - `customer_service` **con `CONVERSATIONS` habilitado** (hoy aterriza en `/app/conversations`, no en `Pedidos`)
   - `customer_service` **con `CONVERSATIONS` deshabilitado** (hoy aterriza en `/app/orders`; ver el caveat ya documentado en `navigation.test.ts:265-273`)
   - cada rol de `OPERATIONS_ROLES` con su módulo **y su permiso** correspondientes — las cuatro estaciones se gatean por permiso, no por rol
2. Correr en verde **contra la estructura actual**. Commitear.

Criterio de aceptación: la suite pasa antes de que exista ningún cambio de navegación.

### Task 2 — Reagrupar la navegación y arreglar el aterrizaje

1. Test en `navigation.test.ts`, primero. **Cinco bloques existentes se reescriben** — conviene mirarlos antes de escribir nada nuevo:

   | Línea | Qué afirma hoy | Por qué cambia |
   |---|---|---|
   | `:13-15` | *"groups into exactly two sections"*, `['OPERACIÓN','GESTIÓN']` | Ahora son tres |
   | `:27-46` | `NAV_SECTIONS[0]` = los seis hrefs viejos de OPERACIÓN; `[1]` = los cinco de GESTIÓN | Ambas listas cambian |
   | `:48-51` | *"positions Pedidos second — **resolveLandingPath depends on this order**"* | La premisa deja de ser cierta: la *Decisión 8* elimina esa dependencia. Se reescribe apuntando a `LANDING_SCAN_ORDER`, no se re-indexa |
   | `:53-64` | countKeys de `OPERATION_ITEMS` = `['orders','pickup','reception','distribution','dispatch']` | `orders` sale del array (sigue existiendo en `Pedidos`, ya en `TRACKING_ITEMS`) |
   | `:66-69` | `OPERATION_ITEMS.find('/app/orders')?.module` es `undefined` | ⚠️ **Pasa en vacío, no falla.** Al mudarse Pedidos, el `find` devuelve `undefined` y `undefined?.module` sigue siendo `undefined`: el test queda verde sin probar nada. Hay que moverlo a `TRACKING_ITEMS` a mano — la suite no avisará |

   Y las aserciones nuevas:
   - `NAV_SECTIONS` tiene exactamente tres secciones, en el orden `SEGUIMIENTO`, `OPERACIÓN`, `GESTIÓN`.
   - **Invariante A** (*Decisión 1*): todo ítem de `OPERATION_ITEMS` tiene `module` **y** `countKey`. **No afirmar la recíproca** — `Pedidos` conserva `countKey`.
   - `SEGUIMIENTO` contiene `/app/operations-control`, `/app/orders`, `/app/conversations` en ese orden.
   - `buildNavSections` sigue descartando secciones vacías.
   - Un usuario `customer_service` ve `SEGUIMIENTO` con dos ítems (sin la torre).
2. Implementar en `navigation.ts`: crear `TRACKING_ITEMS`, recortar `OPERATION_ITEMS` a las cuatro estaciones, sacar `Conversaciones` de `MANAGEMENT_ITEMS`, reconstruir `NAV_SECTIONS` con los tres `{ title, crumb, items }`.
3. **Correr Task 1.** Se ponen rojas exactamente las dos filas de la tabla de regresión de la *Decisión 8*; ninguna otra. Es lo esperado (*Riesgo 1*, paso 2).
4. Aplicar la *Decisión 8*: introducir `LANDING_SCAN_ORDER` — la lista de precedencia explícita que reproduce el orden aplanado de hoy — y hacer que `resolveLandingPath` la recorra en vez de `NAV_SECTIONS`. La preferencia (*primer ítem visible con `module`*) y el fallback **no cambian**. Reescribir el comentario de cabecera conservando el historial de las dos rondas previas, añadiendo esta, y advirtiendo de no volver a derivar el orden de `NAV_SECTIONS`.
5. **Correr Task 1 otra vez.** Verde entero **sin editar ninguna expectativa**.
6. Actualizar el comentario de cabecera de `navigation.ts`: hoy describe una lista plana de 10 ítems agrupada en dos secciones.

### Task 3 — Simplificar la barra de pestañas móvil

1. Test en `navigation.mobile.test.ts`, primero: `buildMobileTabs` devuelve exactamente cuatro pestañas para cada rol de `OPERATIONS_ROLES`, en el orden Recogida → Recepción → Distribución → Despacho, y `[]` para los roles de escritorio. Debe seguir marcando `disabled` en vez de omitir, tanto por permiso faltante como por módulo deshabilitado.
2. Borrar `MOBILE_TAB_EXCLUDED_HREFS` y simplificar `buildMobileTabs` a un `.map` directo sobre `OPERATION_ITEMS`.
3. Reescribir los dos comentarios que quedan obsoletos: `navigation.mobile.ts:64-84` (20 líneas cuya única razón de ser es justificar la lista de exclusión) y `navigation.mobile.ts:22-27` (habla de "the 9-item nav" para los roles de escritorio).
4. Verificar que `OPERATION_ITEMS` se sigue leyendo solo dentro del cuerpo de la función (*Decisión 4*).

### Task 4 — Migas y encabezados renderizados

1. Test primero en `navigation.breadcrumbs.test.ts`: actualizar **las cinco aserciones tabuladas en el *Riesgo 2* punto 3** — `:6-9`, `:36-42`, `:61-65`, `:68-79`, `:82-86` — a `section: 'Seguimiento'`. Las rutas borradas no resuelven; las movidas resuelven a su nueva ruta.
2. Actualizar `navigation.breadcrumbs.ts`, incluidas las dos entradas de `EXTRA_CRUMBS` en `:24-25`.
3. Reemplazar la aserción `breadcrumbForPath('/app/ocr-test') === null` (`:28`) por la decisión explícita del *Riesgo 2*.
4. **Actualizar `src/components/AppLayout.test.tsx`**, que es el único test que afirma sobre encabezados renderizados y migas renderizadas:
   - `:419-420` — el test *"renders both section headings"* busca `'OPERACIÓN'` y `'GESTIÓN'`; ahora son tres.
   - `:429`, `:437-438` — aserciones de riel colapsado y de descarte de secciones vacías sobre esos mismos dos nombres.
   - `:485-486` — para `/app/operations-control` exige que la miga contenga `'Operación'` y `'Torre de control'`. **Este falla seguro**: la miga pasa a ser `Seguimiento › Torre de control`.

### Task 5 — Mover las herramientas internas bajo `/admin`

1. Test primero, y lo más importante son las compuertas: ambas herramientas quedan **solo `admin`** (*Decisión 9*), conservando la diferencia de mecanismo — `ocr` → `redirect('/app')`, `wismo` → `notFound()`. Los tests que ya las afirman (`ocr-test/page.test.tsx`, `dev/wismo-test/page.test.tsx:66,79`) se mueven con las páginas; el caso *"renders WismoTestClient when role is maintainer"* (`:79-80`) **se borra**, no se adapta.
   **Trampa:** `/admin` no protege nada a nivel de layout (*Decisión 5*). Copiar las compuertas per-page textualmente, salvo por quitar `maintainer`. Quitarlas dejaría ambas herramientas abiertas a cualquier usuario autenticado.
2. Mover **los directorios completos, tests colocados incluidos**:
   - `app/app/ocr-test/**` → `app/admin/tools/ocr/**` — incluye `OcrTestClient.tsx`, `OcrTestClient.test.tsx`, `page.test.tsx` (que mockea `'./OcrTestClient'`).
   - `app/app/dev/wismo-test/**` → `app/admin/tools/wismo/**` — incluye `WismoTestClient.tsx(.test.tsx)`, 7 tests en `components/`, 3 en `hooks/`.
3. Las rutas de API **no se mueven**; los hooks de wismo siguen apuntando a `/api/dev/wismo-test/*`.
4. Añadir el bloque **Herramientas** en `src/components/admin/AdminPage.tsx` — no en `app/admin/page.tsx`, que es solo una cáscara de auth de 29 líneas. El componente es un layout de `Tabs` (`:40-67`) con un trigger de Módulos ya condicionado a `super_admin` (`:45-53`); Herramientas sigue ese mismo patrón, con el render condicional por herramienta de la *Decisión 5*. Actualizar `AdminPage.test.tsx`.
5. Aplicar la *Decisión 9* fuera de las páginas movidas: `api/dev/wismo-test/_proxy.ts:4,44` y `api/ocr-test/route.ts:7,65` (quitar `maintainer` de `ALLOWED_ROLES` y del texto del error — **estas rutas no se mueven**), y el comentario de `apps/agents/src/dev/index.ts:49`. En los tests, **borrar** los ≈4 casos que afirman acceso de `maintainer` y **renombrar** — sin borrar — los ≈5 títulos *"...not admin/maintainer"*, que cubren camino negativo real.
6. Re-ejecutar el grep del *Riesgo 3*, más `grep -rn maintainer apps/`. El resultado esperado es el del criterio de aceptación: **una sola** ocurrencia superviviente, `apps/frontend/scripts/check-sentry-members.js:53` (inglés corriente sobre Sentry), que no se toca. Los specs 33 y 36 viven en `docs/` y el grep sobre `apps/` no los alcanza.

### Task 6 — Borrar los restos de plantilla

1. Borrar `app/app/table/**` y `app/app/storage/**`.
2. Borrar los ocho métodos de `src/lib/supabase/unified.ts` listados en la *Decisión 6* (`:59-80` y `:82-100`). **No hay tests que borrar:** `src/lib/supabase/` contiene `environment-guard.test.ts`, `no-detached-rpc.test.ts` y `rpc.test.ts`, no existe `unified.test.ts`, y ningún test del repo referencia esos ocho métodos. Verificado.
3. Borrar `src/components/Confetti.tsx`. **Su único consumidor es `app/app/table/page.tsx` (`:22` import, `:315` uso) y no tiene test propio.** Verificado — no hace falta re-derivarlo.
4. Grep de `todo_list`, `/app/table`, `/app/storage`, `getMyTodoList`, `uploadFile`, `getFiles`, `shareFile` en `apps/frontend/src` para confirmar cero referencias colgantes.
5. La tabla `todo_list`, su migración y sus tipos generados **se quedan** (*Non-Goals*).

### Task 7 — Verificación

1. `vitest --pool=forks` en verde en toda la suite del frontend, no solo en los archivos tocados.
2. Mutation testing sobre `navigation.ts`, `navigation.mobile.ts` y `navigation.breadcrumbs.ts`.
3. Recorrido manual del sidebar por rol en QA: tres encabezados donde corresponde, ningún encabezado huérfano, contador visible en `Pedidos`, cuatro pestañas en móvil, y las dos herramientas abriéndose desde Admin **solo para `admin`**, con el bloque Herramientas entero ausente para `operations_manager` y `super_admin`.

---

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/sidebar/navigation.ts` | `TRACKING_ITEMS` nuevo; `OPERATION_ITEMS` y `MANAGEMENT_ITEMS` recortados; `NAV_SECTIONS` a tres; **`LANDING_SCAN_ORDER` nuevo y `resolveLandingPath` recorriéndolo (Decisión 8)**; comentarios de cabecera |
| `src/components/sidebar/navigation.mobile.ts` | Borrar `MOBILE_TAB_EXCLUDED_HREFS`; simplificar `buildMobileTabs`; reescribir comentarios `:22-27` y `:64-84` |
| `src/components/sidebar/navigation.breadcrumbs.ts` | Sección nueva; `EXTRA_CRUMBS:24-25` a `Seguimiento`; rutas borradas y movidas |
| `src/components/sidebar/navigation.test.ts` | Cinco bloques a reescribir — `:13-15`, `:27-46`, `:48-51`, `:53-64`, `:66-69` (detalle en Task 2). `:169-176` y `:179-186` deben seguir **verdes sin editarse** |
| `src/components/sidebar/navigation.mobile.test.ts` | Cuatro pestañas, estructuralmente |
| `src/components/sidebar/navigation.breadcrumbs.test.ts` | `:6-9`, `:28`, `:36-42`, `:61-65`, `:68-79`, `:82-86` |
| `src/components/AppLayout.test.tsx` | `:419-420`, `:429`, `:437-438`, `:485-486` |
| `src/app/app/page.test.tsx` | Matriz rol × módulos de Task 1 |
| `src/app/admin/tools/ocr/**` | Movido completo desde `app/app/ocr-test/**`; compuerta `admin` + `redirect('/app')` copiada textual |
| `src/app/admin/tools/wismo/**` | Movido completo desde `app/app/dev/wismo-test/**`; compuerta `notFound()` conservada, `maintainer` eliminado (Decisión 9) |
| `src/app/api/dev/wismo-test/_proxy.ts` (+ tests) | `:4`, `:44` — quitar `maintainer`. La ruta **no** se mueve |
| `src/app/api/ocr-test/route.ts` (+ tests) | `:7`, `:65` — quitar `maintainer`. La ruta **no** se mueve |
| `apps/agents/src/dev/index.ts` | `:49` — comentario que describe la compuerta con `maintainer` |
| `src/components/admin/AdminPage.tsx` | Bloque **Herramientas**, renderizado solo para `admin` |
| `src/components/admin/AdminPage.test.tsx` | Cobertura del bloque nuevo |
| `src/lib/supabase/unified.ts` | Borrar los ocho métodos de storage y todo_list (`:59-80`, `:82-100`). Sin tests que tocar |
| `src/components/Confetti.tsx` | Borrado — único consumidor era `app/app/table` |
| `src/app/app/table/**`, `src/app/app/storage/**` | Borrados |

**No se tocan:** `SidebarNavItem.tsx`, `SidebarBrand.tsx`, `useNavCounts.ts` ni `countKeyThresholds`. Los cinco `countKey` siguen siendo los mismos —las cuatro estaciones más `orders`— porque `Pedidos` conserva su contador (*Decisión 2*). Tampoco `src/app/admin/layout.tsx`: sigue sin compuerta, a propósito, y cada página se protege sola.

---

## Criterios de aceptación

- [ ] El sidebar muestra tres secciones en el orden `SEGUIMIENTO` · `OPERACIÓN` · `GESTIÓN`.
- [ ] Todo ítem de `OPERACIÓN` tiene `module` y `countKey`. Afirmado por test. La recíproca **no** se afirma.
- [ ] `Pedidos` sigue mostrando su contador `orders`.
- [ ] Para **todas** las filas de la matriz de Task 1 — sin excepción ni hedge — `resolveLandingPath` devuelve exactamente lo mismo que antes del cambio, con la matriz sin editar entre el paso 1 y el paso 5 de Task 2.
- [ ] `navigation.test.ts:169-176` y `page.test.tsx:58-62` (admin → torre de control) siguen verdes sin modificarse.
- [ ] `resolveLandingPath` ya no lee `NAV_SECTIONS`: recorre `LANDING_SCAN_ORDER`.
- [ ] `buildMobileTabs` devuelve cuatro pestañas para todo rol de operaciones, sin lista de exclusión.
- [ ] Ningún rol ve un encabezado de sección vacío.
- [ ] `/app/operations-control`, `/app/orders`, `/app/orders/new`, `/app/orders/import` y `/app/orders/<uuid>` renderizan todas la sección `Seguimiento`.
- [ ] `/admin/tools/ocr` y `/admin/tools/wismo` accesibles solo para `admin`, conservando `redirect` y `notFound()` respectivamente; el bloque Herramientas no se renderiza para `operations_manager` ni `super_admin`.
- [ ] No queda ninguna referencia a `maintainer` **como rol** en `apps/`. La única ocurrencia superviviente es `apps/frontend/scripts/check-sentry-members.js:53` (*"project maintainers"*, inglés corriente sobre Sentry) y **no se toca**. Los specs 33 y 36 viven en `docs/` y quedan como registro histórico.
- [ ] Ningún test afirma el acceso de un rol inexistente; la cobertura de camino negativo de las rutas de API **sigue intacta** — solo cambian nombres de test y el texto de error afirmado en `_proxy.test.ts:84`.
- [ ] `/app/table`, `/app/storage` y los ocho métodos de `unified.ts` ya no existen; cero referencias colgantes.
- [ ] Suite completa del frontend en verde con `--pool=forks`.
