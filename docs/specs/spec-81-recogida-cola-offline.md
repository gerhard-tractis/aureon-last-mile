# Spec-81: Recogida — cola offline de escaneos, firmas y fotos

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (las pantallas que hacen la promesa que este spec cumple), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`), [spec-54](spec-54-ui-rebrand.md) (fase 2: el chip de sync y `ConnectionStatusBanner`), [spec-62](spec-62-reception-mobile.md) (móvil de andén, mismo problema de conectividad), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (motor de estados de bulto)

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-82-recogida-movil-asignacion-y-ruta.md

_Date: 2026-09-07_

---

## Goal

Hacer verdad el «SIN RED» que el diseño de Recogida promete en cinco pantallas.

`5d`, `5e`, `5f`, `5g` y `5i` se dibujaron todas con el indicador **SIN RED** en la barra de estado, y el texto es una promesa explícita al operario:

- `5d`: «GUARDADO EN EL DISPOSITIVO · SE ENVIARÁ AL VOLVER LA SEÑAL»
- `5f`: «Todo queda en el teléfono y se sube al recuperar señal. **Las fotos también.**»
- `5i`: «Guardado en el teléfono — 6 registros y 2 fotos esperan señal para subir»

**No existe ninguna cola para Recogida — y esa frase necesita matices, corregidos en la ronda 1 de review de fase 1.** El goal original decía que un grep de `outbox|offlineQueue|useOfflineQueue|syncQueue` daba cero resultados; es falso, `hooks/useSyncQueue.ts` es uno de esos nombres. Lo que hay realmente:

- **Una cola viva, sin escritor de Recogida.** `apps/frontend/src/lib/db.ts` (clase `AureonOfflineDB`, base IndexedDB `aureon_offline`, tabla `scan_queue`) + `hooks/useSyncQueue.ts` + `lib/sync-manager.ts` ya implementan lo que la fase 2 de este spec promete: backoff exponencial (`[1000, 2000, 4000]`, `maxRetries = 3`), batching por `manifest_id`, y un guard `isSyncing`. La consumen `components/SyncChip.tsx`, `app/app/reception/route/[routeId]/page.tsx` y **`app/app/pickup/scan/[loadId]/page.tsx`** — la pantalla de escaneo de Recogida ya está cableada a esta cola para el badge "COLA N", pero nada escribe en ella desde esa pantalla hoy. Ese escritor es, en efecto, lo que este spec construye — pero sobre esta base, no sobre una nueva (ver "Decisiones de diseño").
- **Una cola muerta.** `lib/offline/indexedDB.ts` (también una clase `AureonOfflineDB`, distinta base) + `lib/stores/scanStore.ts`. `scanStore` es su único consumidor y nada fuera de su propio test importa `useScanStore`. No se retira en esta fase porque hacerlo no es trivial y no es su alcance; queda escrito aquí para que el próximo lector no la confunda con infraestructura viva ni intente construir sobre ella.

Ese matiz no cambia el diagnóstico de fondo: hoy cada escaneo de Recogida es una escritura sincrónica a Supabase; sin señal, falla y se pierde. Lo que aporta este spec es el escritor y el contrato de idempotencia sobre la cola que ya existe, no una cola nueva.

Esto no es un detalle de pulido. El caso de uso es un operario en el andén de un mall, con el teléfono en una bodega sin cobertura, escaneando 42 bultos. Es **el** entorno de la pantalla, no un caso borde.

## Por qué es su propio spec

Es infraestructura transversal, no una pantalla. La consumen spec-80 (`5d`–`5i`), spec-82 (`5c`) y muy probablemente Recepción móvil (spec-62) y Despacho móvil (spec-76/77), que tienen el mismo problema y hoy lo ignoran igual.

Meterla dentro de spec-80 obligaría a ese PR a tocar el motor de escaneo, el de fotos y el shell de conectividad a la vez — exactamente lo que el plan por fases de spec-54 existe para evitar.

**Orden recomendado:** spec-80 primero (restaura el flujo y es lo que desbloquea QA), este después. Las pantallas de spec-80 se construyen online-first y las leyendas de offline se activan aquí.

## Lo que ya existe y no hay que reinventar

- **`ConnectionStatusBanner`** — hoy `fixed top-0`, ancho completo, en el layout raíz (cubre auth y landing), con tests e i18n propios. spec-54 fase 2 difirió deliberadamente convertirlo en el chip de sync del handoff; esa deuda se paga aquí.
- **El service worker de la PWA** — spec-16c. Ya hay precedente de caché; ver también [[project_qa_stale_bundle_pwa]]: un bundle viejo es la causa habitual de «el arreglo no funcionó en QA».
- **`packages` y `pickup_scans` tienen ids deterministas del cliente** en el generador de seed, pero **no** en la app. La cola necesita idempotencia real (abajo).

## Decisiones de diseño

### Almacenamiento: IndexedDB, no `localStorage` — y **la misma base que ya existe**, no una tercera

Las fotos son blobs de varios MB. `localStorage` es texto y tiene un techo de ~5 MB por origen. IndexedDB almacena blobs nativamente y es lo único que soporta «2 fotos esperan señal».

**Corrección de ronda 1 de review (B1):** la primera versión de esta fase creó `RecogidaOfflineQueueDB`, una base IndexedDB (`AureonRecogidaOfflineQueue`) separada de `aureon_offline` (la que ya usan `useSyncQueue`/`SyncChip`/`PickupFlowHeader`). Eso rompe exactamente lo que el spec promete: 42 bultos escaneados sin señal encolarían en la base nueva, y el badge "COLA N" — que lee `aureon_offline.scan_queue` — mostraría 0 mientras esperan.

La cola de Recogida vive en `apps/frontend/src/lib/db.ts`, la clase `AureonOfflineDB` existente, como una tabla nueva (`pickup_queue`) añadida vía `this.version(2).stores({...})` — Dexie conserva `scan_queue` (versión 1) sin tocarlo. Un origen de almacenamiento, una sola medición de cuota (`checkStorageQuota`), un solo lugar donde pedir `navigator.storage.persist()`.

`apps/frontend/src/lib/offline/indexedDB.ts` + `lib/stores/scanStore.ts` (la base y el store que la primera versión de este spec citaba como "la otra Recogida existente") están muertos — ver "Goal". No se tocan aquí.

**Nota de rollback (ronda 3 de review):** el upgrade Dexie v1→v2 en sí es seguro — un teléfono que abrió la base con la clase v1 y luego reabre con la v2 conserva filas, índices y autoincremento intactos. Lo que **no** es gratis es un rollback del deploy después de que un teléfono ya abrió el bundle nuevo: su base queda en v2, y si el bundle anterior vuelve a servirse pide `open('aureon_offline', 1)` — un navegador real devuelve `VersionError` ahí. `useSyncQueue.ts` ya envuelve su lectura en `try/catch`, pero `sync-manager` no, así que Recepción se quedaría sin cola visible hasta el siguiente deploy hacia adelante. No bloquea esta fase; queda escrito para quien maneje un rollback de este cambio.

### Alcance del contador: device-global vs. por operador (ronda 3 de review)

`getPendingPickupCount()` (badge global del topbar, `SyncChip`/`PickupFlowHeader`/`ReceptionMobileSession`) es deliberadamente device-global — el mismo criterio que ya usa `getUnsynced()` para `scan_queue`. Pero `listPending` y `purgeConfirmed` son por operador (correcto: es el no-negociable del repo, `operator_id` en toda consulta). Esa combinación es internamente consistente en `scan_queue` (lectura y drenado ambos globales) pero **no** en `pickup_queue`: un operador A que encola 3 y cierra sesión, seguido de un operador B en el mismo teléfono de muelle, ve "3 EN COLA" en todas las pantallas, pero ni el drenado de B ni su `purgeConfirmed` tocan esas 3 entradas — quedan huérfanas para siempre y el badge nunca baja a 0 para B.

**Decisión: el lado correcto es por operador, no device-global**, porque el no-negociable del repo (`operator_id` en toda query) no admite excepción para un badge — el hecho de que `scan_queue` ya sea global es una deuda heredada de spec-54, no un precedente a copiar. `getPendingPickupCount` no cambia en esta fase (no tiene consumidor con `operatorId` disponible hoy sin tocar `useSyncQueue`, `SyncChip`, `PickupFlowHeader` y `ReceptionMobileSession` a la vez, que es alcance de fase 2, donde el drenador de todos modos necesita `operatorId` para llamar a `listPending`). **Fase 2 debe:** pasar `operatorId` a `getPendingPickupCount` (o reemplazarla por una suma de `listPending(db, operatorId).length` por operador activo) antes de dar por cerrado el drenado — ver checklist de fase 2 abajo.

### Idempotencia: la clave la genera el cliente

Al reconectar, la cola reintenta. Sin clave estable, un reintento tras un 200 perdido duplica el escaneo y descuadra el conteo del manifiesto — el número sobre el que **el cliente firma** en `5f`.

Cada entrada lleva un `client_operation_id` (UUID v4 del dispositivo). El servidor lo persiste y rechaza el duplicado. Es el mismo patrón que spec-79 necesitó para que un reintento de despacho no creara una segunda ruta en DispatchTrack (`2l`), y conviene mirar cómo se resolvió allí antes de inventar otro.

### Orden: FIFO estricto por manifiesto

Cerrar una carga (`close_manifest`, spec-80 fase 1) no puede llegar antes que los escaneos que produjeron su conteo. La cola drena en orden dentro de cada manifiesto; entre manifiestos distintos puede ir en paralelo.

### Qué NO entra en la cola

Las lecturas. Un manifiesto que nunca se descargó no se puede escanear sin red, y fingir lo contrario es peor que el mensaje honesto de `5c` («DESCARGAR» por carga). La precarga explícita es parte de spec-82.

---

## Fases

| Fase | Qué entrega |
|---|---|
| **1 — Almacén y contrato** | IndexedDB + tipos + `client_operation_id`, sin UI |
| **2 — Drenado y reintento** | El worker que vacía la cola al volver la señal |
| **3 — Idempotencia servidor** | El RPC rechaza el duplicado |
| **4 — Chip de sync** | `ConnectionStatusBanner` pasa a ser el indicador del handoff |
| **5 — Fotos** | Blobs en la cola, subida diferida al bucket `manifests` |

### Fase 1 — Almacén y contrato `[done]`

> Implementado por: `implementer` con TDD, **cinco rondas**. Rama
> `feat/spec-81-fase-1-almacen-cola`, SHA final `d9f03db`, PR #661.
> Review: `reviewer` adversarial, cuatro rondas — la última **post-merge**, porque
> la ronda 5 entró con auto-merge antes de revisarse. Aprobada sin revert.
> Lo que cambiaron los reviews: **convergió sobre `lib/db.ts` con un `version(2)`**
> en vez de crear una tercera base IndexedDB (la premisa del `Goal` de este spec
> era falsa: `hooks/useSyncQueue.ts` ya existía y ya alimentaba el contador de la
> pantalla de escaneo de Recogida); `markFailed` pasó a `.modify()` atómico porque
> dos concurrentes dejaban `retryCount = 1`; el enum ganó `sending` y `dead`, y con
> ellos `reclaimStale` — sin salida, una pestaña muerta a mitad de envío dejaba el
> badge en «COLA 0» con el escaneo sin enviar; y `claimPending` pasó a devolver un
> token de propiedad, porque un drenador zombi liberaba la reclamación de otro con
> la petición en vuelo.
> Verificación por mutación independiente de cada guard: cada mutante mata
> exactamente el test que lo reclama. 42/42 en `queue.test.ts`, suite completa
> 5922 tests, `tsc` y `eslint` limpios.
> QA: **n/a por capa.** Fase 1 es lógica pura sobre IndexedDB — sin UI, sin red y
> sin ningún llamador todavía; no hay nada que un humano pueda ejercitar en QA. El
> equivalente de esta capa es la suite unitaria más el mutation-test de arriba. El
> primer QA real de la cola llega con el drenador de fase 2.
> Downstream: revisado spec-82 — sin cambios. **Sí cambió este mismo spec**: el
> `Goal` se reescribió (su grep de «cero resultados» era falso) y el checklist de
> fase 2 recogió tres ítems nuevos, además del de `mapCloseManifestError` que vino
> de spec-80 fase 1.
> **Tres residuales abiertos, todos sobre superficie sin llamador**, trasladados al
> checklist de fase 2: el token es una marca de milisegundo y no un nonce, así que
> dos reclamaciones sucesivas de la misma entrada en el mismo ms lo repiten;
> `markFailed` sin token pisa `lastError` y `retryCount` de entradas ya terminales;
> y `reclaimStale` no invalida el token al devolver la entrada a `pending`.

**Archivos:** `apps/frontend/src/lib/db.ts` (tabla `pickup_queue`, version 2 — **no** una base separada, ver "Decisiones de diseño"), `apps/frontend/src/lib/offline/queue.ts`, `queue.test.ts`, `apps/frontend/src/hooks/useSyncQueue.ts` (cuenta también `pickup_queue`)

Lógica pura y testeable sin navegador: encolar, listar pendientes, reclamar para envío (`claimPending`), marcar enviado, marcar fallido con contador de reintentos, marcar muerta (`markDead` — rechazo de negocio irrecuperable), purgar lo confirmado.

- [x] Tests primero, con IndexedDB falso en memoria (`fake-indexeddb`). Nada de tocar el DOM.
- [x] Implementar el almacén — converge sobre `AureonOfflineDB` (`lib/db.ts`), no una base propia.
- [x] Un `client_operation_id` por entrada, generado al encolar y **nunca** regenerado en el reintento. Test explícito de eso — es el error que hace duplicar.
- [x] **Ronda 1 de review — B2:** `markFailed` es atómico (`db.pickup_queue.where(":id").equals(id).modify(fn)`, una sola transacción); el `get` + `update` original perdía incrementos bajo dos fallos concurrentes. Test que raza dos `markFailed` sobre la misma entrada y verifica `retryCount === 2`.
- [x] **Ronda 1 de review — B3:** `PickupQueueEntry` ahora tiene `lastAttemptAt`/`nextAttemptAt` (persistidos, para que el backoff de fase 2 sobreviva a que la PWA se cierre a mitad de reintento), un estado in-flight `sending` (con `claimPending`, atómico, para que dos drenados concurrentes no envíen la misma entrada dos veces) y un estado terminal `dead` (con `markDead`, para sacar una entrada envenenada de `listPending` sin mentir "sent" ni borrarla en silencio).
- [x] **Ronda 1 de review — B6:** mutantes cerrados — `enqueue` tiene test explícito de que persiste `blob` (via spy sobre `.add()`, porque `fake-indexeddb` no preserva la identidad de un `Blob` real a través de su structured-clone) y de que `createdAt` usa la hora real (`vi.useFakeTimers({ toFake: ["Date"] })` — fake timers completos cuelgan las transacciones internas de Dexie). `listPending` pasó de un `.sort()` posterior a `orderBy("id")` explícito: el `.sort()` era necesariamente redundante (IndexedDB ya desempata por clave primaria ascendente dentro de un mismo valor de índice) y ningún test legítimo podía discriminar su ausencia sin violar esa garantía del spec de IndexedDB.
- [x] **Ronda 1 de review — B7:** el índice `[manifestId+status]` se quitó — ninguna consulta lo usaba y no empezaba por `operatorId`.
- [x] **Ronda 1 de review — B1, contador real:** `useSyncQueue().queuedCount` ahora suma `db.scan_queue` (sin sincronizar) + `db.pickup_queue` (pendientes), con test. `PickupFlowHeader`/`SyncChip` siguen sin escritor hasta fase 2, pero el conteo ya es correcto — no hace falta tocarlos otra vez cuando fase 2 aterrice.
- [x] **Ronda 1 de review — M4:** `requestPersistentStorage()` (`lib/db.ts`) pide `navigator.storage.persist()`; se invoca desde el mount de `useSyncQueue` (el primer punto que ya toca esta base). Sin esto, "GUARDADO EN EL DISPOSITIVO" (`5d`) no es una garantía real — IndexedDB es best-effort y iOS Safari no instalado purga a los 7 días sin interacción.
- [x] **Ronda 3 de review — H1 (bloqueante, regresión de B3):** `sending` era un estado sin salida — si la pestaña moría justo después de `claimPending` (PWA cerrada en segundo plano en un muelle), la entrada quedaba invisible para `listPending`, `getPendingPickupCount` y `purgeConfirmed` sin haberse enviado. `reclaimStale(db, olderThanMs)` devuelve a `pending` toda `sending` cuyo `lastAttemptAt` supere el umbral, con tests (reclama la vieja, deja intacta la reciente, no toca `pending`/`sent`/`dead`).
- [x] **Ronda 3 de review — H2 (bloqueante):** `SyncQueuePanel` (Recepción) consumía el `queuedCount` combinado (`scan_queue` + `pickup_queue`) de `useSyncQueue`, pero su lista `recent` y su botón "Reintentar ahora" sólo leen/drenan `scan_queue` — en cuanto fase 2 escriba en `pickup_queue`, cabecera y lista se contradicen y el botón deja de poder bajar el número a cero. `useSyncQueue` ahora expone `scanQueueCount` (sólo `scan_queue`) además de `queuedCount` (combinado, para los badges sin botón de drenado: `SyncChip`, `PickupFlowHeader`, `ReceptionMobileSession`); `SyncQueuePanel` recibe `scanQueueCount`.
- [x] **Ronda 3 de review — H3 (mayor):** `markFailed` resucitaba `sent` y `dead` a `pending` incondicionalmente — un 200 tardío tras un timeout local, o un reintento perdido llegando después de un `markDead`, reabría una operación terminal. Ahora sólo libera una reclamación en curso (`sending` → `pending`); `sent` y `dead` quedan intactos. Tests para ambos casos.
- [x] **Ronda 3 de review — H4 (mayor):** sin test, un `purgeConfirmed` ampliado en fase 2 para "limpiar la cola" podía borrar `dead` junto con `sent` y reintroducir la pérdida silenciosa que `markDead` existe para evitar. Test explícito: `purgeConfirmed` no toca una entrada `dead`.
- [x] **Ronda 3 de review — H5 (menor):** `listPending` había pasado a un full table scan (`orderBy("id").filter(...)` sobre toda la tabla) al arreglar B6. Vuelve a `.where("operatorId").equals(operatorId)` — dentro de un mismo valor de índice, IndexedDB ya desempata por clave primaria ascendente, así que el orden FIFO no se pierde y el argumento de B6 sobre el `.sort()` sigue siendo válido. Test con spy sobre `db.pickup_queue.where` para que una regresión futura no pueda volver a un scan sin que un test lo note.
- [x] **Ronda 3 de review — N1/N2 (nitpicks, sin cambio de comportamiento):** test que fija que `requestPersistentStorage` devuelve exactamente lo que el navegador concede (no un `true` fijo); test que fija que `claimPending` estampa `lastAttemptAt` — es lo que hace posible detectar una reclamación huérfana en H1.
- [x] **Ronda 3 de review — decisión de alcance del contador:** documentada arriba, en "Decisiones de diseño" — `getPendingPickupCount` sigue device-global en esta fase; pasa a ser por operador en fase 2 (ver checklist de esa fase).
- [x] **Ronda 4 de review — B1 (bloqueante):** el banner "escaneos aún en cola" de `ReceptionMobileSession` (dentro de la sesión de Recepción) recibía el `queuedCount` combinado de `useSyncQueue` en vez de `scanQueueCount` — el mismo error que H2 arregló en `SyncQueuePanel`, sin arreglar aquí. Un conductor que deja pickups sin enviar por la mañana y abre Recepción por la tarde veía un banner de "escaneos" hablando de una cola que Recepción no tiene. `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx` ahora pasa `sync.scanQueueCount`. Test explícito con `queuedCount`/`scanQueueCount` deliberadamente distintos (4/1), igual que el fixture de H2.
- [x] **Ronda 4 de review — M1 (mayor):** `claimPending` devolvía sólo un `boolean`, así que `markFailed`/`markSent` no podían distinguir "mi reclamación" de "la de otro drenador" — sólo miraban `status`, y `sending` es el mismo valor para cualquiera que lo tenga. `claimPending` ahora devuelve el `lastAttemptAt` (ISO 8601) que acaba de estampar como token de propiedad; `markFailed`/`markSent` reciben ese token opcionalmente (`claimedAt`) y son un no-op completo si ya no coincide con el `lastAttemptAt` actual de la entrada. Tests: el escenario completo del review (claim → reclaim por timeout → reclaim por otro drenador → fallo tardío del zombi con el token viejo) verificando que la reclamación viva no se libera, la variante equivalente con `markSent`, y el camino feliz (token vigente) sigue liberando/confirmando como antes.
- [x] **Ronda 4 de review — M2 (mayor):** `reclaimStale` operaba sobre todo el dispositivo, sin `operatorId`, a diferencia de `listPending`/`purgeConfirmed`. Es una escritura, no una lectura — el no-negociable de `operator_id` no admite la excepción que sí es correcta para el alcance device-global del contador (`getPendingPickupCount`). Ahora `reclaimStale(db, operatorId, olderThanMs)` filtra por `operatorId` con el mismo patrón que `listPending`. Test: dos operadores con entradas `sending` huérfanas, sólo se reclama la del operador pedido.
- [x] **Ronda 4 de review — N3 (menor):** el test de H5 espiaba `db.pickup_queue.where` y afirmaba el argumento exacto (`"operatorId"`), así que un refactor legítimo al índice compuesto `[operatorId+status]` lo habría hecho fallar por la razón equivocada — sigue siendo un lookup indexado, sólo que con otro argumento a `.where()`. Reescrito para afirmar el negativo real: que no corrió ningún método de colección completa (`filter`/`toCollection`/`orderBy`). Verificado con un mutante real (`listPending` reescrito sobre `.filter()` de tabla completa) — el test nuevo lo detecta; el viejo (con el argumento exacto) también lo habría detectado, pero por casualidad, no por diseño.
- [x] **Ronda 4 de review — N5 (menor):** el test "does not touch pending, sent or dead entries" de `reclaimStale` nunca creaba una entrada `dead` — ahora sí, y la afirma intacta.
- [x] **Ronda 4 de review — N4 (menor, decisión documentada, sin cambio de código):** dos mutantes en `reclaimStale` no se cierran a propósito. `<= cutoff` → `<` es una frontera de 1ms que ningún reintento real puede depender de distinguir. La guarda `entry.lastAttemptAt !== null` era código muerto — `claimPending` es la única función que produce `sending` y siempre estampa `lastAttemptAt` en la misma escritura atómica — así que se quitó y se documentó la invariante en su lugar (`Date.parse(entry.lastAttemptAt as string)`), en vez de dejar una rama que ningún test legítimo podía ejercitar.
- [x] **Ronda 5 de review — B1 (bloqueante):** `markDead` era el único de los tres escritores terminales (`markSent`, `markFailed`, `markDead`) sin guard de token. Escenario: drenador A reclama (T1), se cuelga; `reclaimStale` lo libera; drenador B reclama (T2) y envía de verdad; el 422 tardío de A llega y llama `markDead(id, reason)` — sin guard, mataba la reclamación en curso de B. `markDead` ahora acepta `claimedAt` opcional con el mismo contrato que `markSent`/`markFailed`. Test del escenario completo (claim → reclaim → reclaim de otro → rechazo tardío del zombi con token viejo), verificando que la reclamación viva de B queda intacta.
- [x] **Ronda 5 de review — B2 (bloqueante, alcance):** el ítem de `getPendingPickupCount` que sólo contaba `dead` (N6 de la ronda 4) estaba en la fase equivocada — fase 4, "porque ahí vive el chip". Es incorrecto: `useSyncQueue.ts:121` corta el polling cuando `queuedCount === 0`, y una entrada huérfana en `sending` (no sólo `dead`) ya produce ese conteo falso hoy. Movido al checklist de fase 2, junto al ítem hermano de por-operador que toca la misma función.
- [x] **Ronda 5 de review — m3 (menor):** el token no era de un solo uso en `markFailed` — un replay de la misma respuesta de red con el mismo token (frecuente: sin señal, `fetch` rechaza casi al instante, así que claim y fallo caen en el mismo ms) volvía a pasar el guard y quemaba presupuesto de reintentos dos veces por un único fallo real. El guard ahora exige también `status === "sending"`, que el primer uso del token ya invalida. Test: dos `markFailed` con el mismo token, `retryCount` final es 1, no 2.
- [x] **Ronda 5 de review — m4 (menor):** `markSent` devolvía `void` tanto si confirmó como si el token había caducado. Ahora devuelve el `count` real de `.modify()` — un drenador que encadene `markSent` con `purgeConfirmed` puede saber si su 200 se registró antes de purgar. Tests para ambos casos (1 y 0).
- [x] **Ronda 5 de review — m5 (menor):** asimetrías sin equivalente de H3, sin test hasta ahora — `markSent` no tenía guard contra resucitar una entrada `dead`, `markDead` no tenía guard contra sobrescribir una entrada `sent`. Ambas cerradas: `markSent` es un no-op sobre `dead`, `markDead` es un no-op sobre `sent`. Test para cada dirección.
- [x] **Ronda 5 de review — n6 (nitpick):** el docstring de `claimPending` decía que el token era "el único dato que distingue mi reclamación de la de otro drenador" sin acotar el alcance. Corregido: es único por entrada y milisegundo, no globalmente — inerte para este módulo (todo comparador acota primero por `:id`), pero no serviría como clave de un `Map<token, request>` entre entradas distintas.
- [x] **Ronda 5 de review — comentario del test de N3:** el test negativo de H5/N3 también mata una "cuarta vía" (`toArray()` + filtro en memoria) sin un cuarto spy, porque Dexie implementa `Table.toArray()` como `this.toCollection().toArray()`. Documentado en el comentario del test para que no se lea como una enumeración incompleta.

### Fase 2 — Drenado `[in_progress]`

**Archivos:** `apps/frontend/src/hooks/useOfflineQueue.ts`, `+ test`

Drena al recuperar `navigator.onLine` y al montar. Retroceso exponencial con techo. FIFO por manifiesto.

- [x] Test: dos escaneos y un cierre encolados sin red → al reconectar salen en orden y el cierre va último.
- [x] Test: un 500 no descarta la entrada; un 409 idempotente sí la marca resuelta.
- [x] **Requisito (2026-09-07, hallazgo de la ronda 3 de review de spec-80
      fase 1).** `mapCloseManifestError` (spec-80) hoy da al operario **el
      mismo texto** para un `TypeError: Failed to fetch` (fallo de red — el
      caso normal en este muelle, la premisa de este spec) y para un
      `MANIFEST_NOT_CLOSABLE` (rechazo de negocio que reintentar no va a
      arreglar nunca), y en ambos casos re-habilita el mismo botón. Un
      operario sin señal que reintente un `MANIFEST_NOT_CLOSABLE` indefinida-
      mente no tiene forma de saber que su caso es distinto del de red, donde
      sí debe reintentar. Esta fase — que es la que decide cuándo algo entra
      a la cola en vez de fallar en el momento — tiene que distinguir la rama
      "sin conexión" del rechazo de negocio irrecuperable, y presentarle al
      operario mensajes y afordancias distintos para cada una (encolar y
      seguir vs. detenerse y pedir ayuda).
      **Implementado (m11, ronda 2 de review del PR #679 — este párrafo citaba
      la regla ANTERIOR a B1/B2, que la contradice; ver esas dos entradas
      más abajo para la vigente):** `classifyCloseManifestError`
      (`lib/pickup/closeManifestErrors.ts`) devuelve
      `{ kind: 'offline' | 'idempotent' | 'permanent' | 'transient', message }`
      — `offline` para la forma de red/timeout de `postgrest-js` (`code`
      presente pero vacío, o un `TypeError`/`AbortError` nativo sin
      centinela); `idempotent` para `MANIFEST_ALREADY_SIGNED` (el cierre ya
      se aplicó); `permanent` sólo para los cuatro rechazos que
      `close_manifest` declara explícitamente irrecuperables
      (`MANIFEST_NOT_CLOSABLE`, `OPERATOR_SIGNATURE_REQUIRED`, y los dos
      cross-tenant `42501`); todo lo demás, incluido lo desconocido, es
      `transient` — el valor por defecto seguro para un drenador de fondo
      pasó de "detenerse" a "reintentar". `complete/[loadId]/page.tsx`
      encola el cierre (`enqueue(db, { type: 'close_manifest', ... })`) y
      navega fuera en la rama offline; en cualquier otra rama deja el botón
      re-habilitado y no encola nada — el sender (`offlineQueueSender.ts`)
      es quien traduce `idempotent`/`permanent`/`transient` a
      `sent`/`dead`/`retry` para el drenador de fondo.
- [x] Al arrancar el drenado (mount y evento `online`), llamar `reclaimStale(db, operatorId, olderThanMs)` antes de `listPending` — recupera reclamaciones huérfanas de una pestaña muerta a mitad de envío (spec-81, ronda 3 de review, H1). `reclaimStale` ya requiere `operatorId` desde fase 1 (ronda 4 de review, M2). **Restricción del contrato:** `olderThanMs` debe superar `timeout_http`; si no, una petición lenta legítima en 2G se reclama antes de completarse y entra en bucle reclaim → resend → resend, generando el duplicado del que protege M1. **Implementado (ronda 1 de review del PR #679, B4):** `timeout_http` no existía como valor propio — `postgrest-js` no fija ninguno y el sender no pasaba `signal`, así que el límite real era el default de `fetch` del navegador (~300s), muy por encima de los 45s que se afirmaban como margen. `offlineQueueSender.ts` ahora impone `AbortSignal.timeout(60_000)` sobre `close_manifest`, y `RECLAIM_STALE_MS = 90_000` en `useOfflineQueue.ts` — 30s de margen sobre ESE valor, que sí es real.
- [x] **`getPendingPickupCount` pasa a ser por operador** (recibe `operatorId`, o se reemplaza por la longitud de `listPending(db, operatorId)`), y sus consumidores (`useSyncQueue`, `SyncChip`, `PickupFlowHeader`, `ReceptionMobileSession`) pasan a requerir `operatorId` — ver "Alcance del contador" en Decisiones de diseño. Sin esto, un operador que cierra sesión en un teléfono de muelle deja un contador huérfano que el siguiente operador no puede drenar ni purgar.
- [x] **`getPendingPickupCount` cuenta también `sending` y `dead`, no sólo `pending`** (movido aquí desde fase 4 — ronda 5 de review de fase 1, B2). Hoy sólo cuenta `pending`. `useSyncQueue.ts:121` corta el polling cuando `status === 'online' && queuedCount === 0` — con una sola entrada huérfana en `sending` (pestaña muerta a mitad de envío, el escenario que `reclaimStale` existe para cubrir), `queuedCount` cae a 0, el polling se detiene, y la pantalla se congela en «todo subido» hasta un remount, mientras el operario cierra la carga con un conteo falso — el riesgo nº1 declarado del spec. No puede esperar a fase 4: el spec declara que las fases 1–3 van juntas o no va ninguna.
- [x] El drenador pasa el token que `claimPending` devuelve a `markFailed`/`markSent`/`markDead` como `claimedAt` (implementado en fase 1, ronda 4 y 5 de review, M1/B1 — ver checklist de esa fase) — sin esto la protección existe en el contrato pero ningún llamador la usa.
- [x] **El token deja de ser una marca de milisegundo y pasa a ser un nonce** (`crypto.randomUUID()` en un campo `claimToken` propio, o `${now}#${contador}`). Hoy `claimPending` usa `new Date().toISOString()`, así que **dos reclamaciones sucesivas de la misma entrada dentro del mismo ms producen el mismo token** y el guard vuelve a pasar: es el bug M1 otra vez, dentro de una ventana de 1 ms. Y no es hipotético — el docstring de `markFailed` señala que sin señal `fetch` rechaza casi al instante, así que claim y fallo caen en el mismo ms **como caso común**. Verificado: `claim → markFailed(t) → claim → markFailed(t)` deja `retryCount 2` y `pending`, cuando lo correcto es `retryCount 1` y `sending`. Mitigado si el drenador respeta `nextAttemptAt` con retroceso, pero no conviene depender de eso. **Implementado:** `claimToken` propio, `crypto.randomUUID()`.
- [x] **`markFailed` sin token deja de pisar entradas terminales.** H3 protegió `status`, no el resto: sobre una entrada `dead`, un `markFailed(id, "Failed to fetch")` sin token conserva el estado pero **sustituye `lastError`** — y `lastError` es el único registro de por qué ese escaneo se descartó. Convierte un rechazo de negocio diagnosticable en un fallo de red genérico justo antes de que fase 4 se lo enseñe al operario. Mismo efecto sobre `sent` (`retryCount` a 1 en una entrada ya confirmada).
- [x] **`reclaimStale` invalida el token al devolver la entrada a `pending`.** Hoy no refresca `lastAttemptAt`, así que el token del drenador zombi sigue coincidiendo: en esa ventana, `markDead(id, r, tokenViejo)` marca muerta una entrada que `reclaimStale` acababa de devolver a la cola. **Implementado:** `.modify({ status: "pending", claimToken: null })`; combinado con que `matchesClaim` ya exige `status === "sending"`, es defensa en profundidad, no la única barrera.
- [x] **Los tres escritores terminales no tienen el mismo contrato**, aunque sus docstrings lo afirmen. `markSent` no exige `status === "sending"` y bloquea `dead`; `markFailed` sí lo exige y no bloquea ninguno; `markDead` no lo exige y bloquea `sent`. Y sólo `markSent` devuelve `count` — pero un `count === 0` es información que el drenador necesita **más** en `markFailed`/`markDead`, donde significa «tu reclamación fue robada». Unificar el contrato y corregir los docstrings. **Implementado:** helper `matchesClaim(entry, claimedAt)` compartido por los tres; los tres devuelven `Promise<number>`.

**Ronda 1 de review del PR #679 (2026-09-08) — cuatro bloqueantes:**

- **B1.** `classifyCloseManifestError` nunca veía el error que la app produce
  de verdad: `supabase.rpc('close_manifest', …)` no rechaza con un
  `TypeError` sin señal — `postgrest-js@1.21.4` captura el fallo de `fetch` y
  RESUELVE con `{ message, details, hint: '', code: '' }`. El check original
  (`'code' in err`) clasificaba esa forma como `business` siempre, cero
  cobertura real de la rama offline. **Implementado:** un `code` presente
  pero vacío es ahora la señal (un `code` de Postgrest real nunca es la
  cadena vacía — siempre un SQLSTATE de 5 caracteres).
- **B2.** `useOfflineQueue` no tenía ningún llamador de producción — la fase
  «Drenado» no drenaba nada. **Implementado:** `lib/pickup/offlineQueueSender.ts`
  (el `OfflineQueueSender` real contra `close_manifest`) montado en
  `AppLayout.tsx`, mismo alcance global que `SyncChip`/`useSyncQueue`.
- **B3.** Un escaneo `dead` no bloqueaba el `close_manifest` detrás de él —
  `listPending` excluye `dead` a propósito, así que en la siguiente pasada el
  cierre pasaba a la cabeza y se enviaba con un bulto menos del que el
  operario contó. **Implementado:** `manifestHasDeadEntry` en `queue.ts`,
  comprobado en cada vuelta de `drainManifest` antes de listar pendientes.
- **B4.** Ver la nota sobre `RECLAIM_STALE_MS` arriba.

Cuatro mayores (mutantes que sobrevivían 7/7, cerrados con tests que se
verificaron contra el mutante real, no sólo escritos): M1 (el camino de
éxito — `markSent`, `purgeConfirmed`, y el `claimToken` en `markFailed`/
`markDead` — no tenía ninguna aserción que lo exigiera), M2 (el retroceso
exponencial no tenía ningún test, ni la puerta que lo honra), M3 (el test
del 409 tenía las dos ramas devolviendo `'sent'`, no discriminaba nada —
dividido en dos tests reales), M4 (integration test nuevo en
`complete/[loadId]/page.test.tsx` con la forma real de postgrest-js —
verificado a mano que habría atrapado B1).

m3 (menor): el tope de 500 entradas sin confirmar por operador que
"Riesgos" declaraba vigente desde esta fase no estaba implementado.
**Implementado:** `enqueue` lo comprueba y rechaza con error explícito.

m4 (menor, sin cerrar — alcance documentado, no arreglado): la rama offline
de `complete/[loadId]/page.tsx` es casi inalcanzable en la práctica.
`manifestId` se pide con un `supabase.from('manifests')` crudo en un
`useEffect` sin caché (líneas ~52-66) y la página muestra un skeleton
mientras `!manifestId`. Sin señal, recargar la página deja el skeleton
permanente — nunca llega a mostrar el botón de completar. La única ventana
real en la que la rama offline dispara es «la pantalla cargó con señal →
la señal se cae → el operario pulsa Completar». No bloqueante para esta
ronda; queda anotado para que una fase futura decida si cachear
`manifestId` en IndexedDB vale la pena.

**Ronda 2 de review del PR #679 (2026-09-08) — cuatro bloqueantes más:**

- **B1.** `MANIFEST_ALREADY_SIGNED` (23505) se clasificaba `business` →
  `dead` en el sender. La migración lo llama explícitamente "an idempotent
  409": el reintento de un cierre que SÍ se aplicó (respuesta perdida en un
  túnel, o abortada por el propio `AbortSignal.timeout` de B4 de la ronda
  1) volvía a chocar con `signature_operator IS NOT NULL` y mataba el
  manifiesto para siempre — un envío exitoso convertido en bloqueo
  permanente. **Implementado:** `classifyCloseManifestError` gana un kind
  `idempotent`, separado de `permanent`; el sender lo reporta `sent`.
- **B2.** Todo lo no-offline caía a `dead` sin distinguir. Verificado
  contra el sender real: un JWT expirado (`PGRST301`), un 502 de Kong sin
  `code`, un `statement timeout` (`57014`) y un deadlock (`40P01`) — los
  cuatro recuperables reintentando, los cuatro mataban el manifiesto.
  **Implementado:** `permanent` se reserva a los cuatro rechazos que
  `close_manifest` declara explícitamente irrecuperables
  (`MANIFEST_NOT_CLOSABLE`, `OPERATOR_SIGNATURE_REQUIRED`, los dos
  cross-tenant `42501`); todo lo demás, `transient` (retry).
- **B3.** `getPendingPickupCount` sumaba `dead` a `queuedCount`, y
  `SyncChip` pinta `queuedCount > 0` en verde de éxito — un rechazo
  irrecuperable se mostraba, para siempre, como "todo va bien, está en
  cola". **Implementado:** `dead` deja de contar en `queuedCount`;
  `getBlockedPickupCount`/`useSyncQueue().blockedCount` es su propio
  contador, y `SyncChip` anuncia "N REQUIERE AYUDA" con tono de aviso, no
  de éxito. `dead` sigue siendo permanente por decisión explícita del
  reviewer (soltar el cierre detrás de un escaneo muerto es el riesgo nº1);
  la afordancia humana completa (a dónde lleva el bloqueo, cómo se
  resuelve) queda como ítem nuevo en el checklist de fase 4, con su razón
  — no existía en ninguna fase antes de esta ronda.
- **B4.** La cola estaba acotada por inquilino (`operatorId`), no por
  persona — dos conductores de la MISMA empresa en un teléfono de muelle
  compartido, en sesiones sucesivas, comparten `operatorId`. El drenador de
  quien inicia sesión después enviaba (y firmaba con su propio nombre, vía
  `auth.uid()` en el servidor) lo que el conductor anterior había encolado.
  **Implementado:** `PickupQueueEntry` gana `userId`; `useOfflineQueue`
  recibe `(operatorId, userId, send)` y filtra por `userId` antes de
  reclamar o enviar cualquier entrada — nunca toca una que la sesión actual
  no encoló, aunque comparta manifiesto. `manifestHasDeadEntry`/
  `reclaimStale`/`purgeConfirmed` siguen sin filtrar por usuario a
  propósito (documentado en el código de `useOfflineQueue.ts`): o son una
  protección conservadora que debe aplicar a cualquiera, o no tocan datos
  de negocio.

Dos mayores: **M5** — `enqueue` corría dentro del `catch` de
`handleComplete` sin un `try` propio; si lanzaba (el tope de 500, o un
`DOMException` de IndexedDB), la excepción escapaba sin capturar y el botón
quedaba colgado en "Completando…" para siempre. Capturado, con toast y
botón re-habilitado. **M6** — un reintento programado o un evento `online`
que llegaba mientras un `drain()` ya corría se perdía sin dejar rastro; el
guard `drainingRef.current` no reprogramaba nada. Ahora marca "hace falta
otra pasada" y la ejecuta al terminar la que está en curso.

m7-m12 (menores): timeout del sender fijado a un valor exacto en vez de
sólo `toBeInstanceOf` (m7); detección de característica para
`AbortSignal.timeout` en WebViews sin soporte (m8); test de estabilidad de
identidad del `useMemo` de `AppLayout` (m9); `timersRef` ya no crece sin
límite (m10); esta cabecera del checklist citaba la regla de clasificación
ANTERIOR a B1/B2 (m11); una aserción vacua en
`useOfflineQueue.test.ts` que el drenado del mount ya satisfacía, corregida
para discriminar sobre el escaneo encolado después del mount (m12).

**Nota de coordinación con fase 3 (review del PR #678, 2026-09-08):**
`usePickupScans.ts` inserta N filas (una por bulto) bajo un único
`clientOperationId` cuando el escaneo es a nivel de pedido — con el índice
único simple que fase 3 tenía planeado, ese lote choca **consigo mismo** en
el primer envío, no en un reintento, y un drenador que trate ciegamente
"409 = ya aplicado" marcaría `sent` un escaneo que nunca se guardó. Decisión
tomada en fase 3 (no tocada aquí): la clave pasa a
`(operator_id, client_operation_id, package_id)` con `NULLS NOT DISTINCT`.
Del lado de esta fase: `OfflineQueueSender.outcome === 'sent'` está
documentado explícitamente (docstring en `useOfflineQueue.ts`) como "el
servidor confirma que la operación COMPLETA está aplicada", no "recibí un
409" — el hook no inspecciona códigos HTTP, confía en lo que el sender le
diga, y el sender es responsabilidad de quien lo inyecte (aún sin escritor
real para `pickup_scans` en esta fase; ver más abajo). Esta fase **no**
escribe `client_operation_id` en ninguna tabla de Supabase — el único
camino de red que añade (`close_manifest` en la rama offline) sigue sin
tocar; se limita a encolar localmente — así que no depende de la columna ni
de los tipos que fase 3 añade, y no hay nada que coordinar en el merge más
allá de lo ya escrito arriba.

**Alcance decidido en esta fase — sin escritor de `pickup_scan` real.** El
`Goal` del spec señala que "no existe ningún escritor" para Recogida; esta
fase entrega el **drenador** (`useOfflineQueue`, genérico sobre un
`OfflineQueueSender` inyectado) y lo conecta a un único productor real:
`complete/[loadId]/page.tsx` encola `close_manifest` cuando `close_manifest`
falla por causa offline. Conectar `pickup/scan/[loadId]/page.tsx` (el
escritor de escaneos individuales) al mismo drenador — decidir cuándo un
escaneo se intenta en línea vs. se encola directamente sin intentarlo, y
escribir el `OfflineQueueSender` real contra `pickup_scans` — no estaba en
el checklist de esta fase (que lista sólo `useOfflineQueue.ts` como
archivo) y además queda bloqueado por la columna `client_operation_id` de
fase 3. Queda para cuando fase 3 mergee, como trabajo de conexión, no de
diseño nuevo: la forma del `OfflineQueueSender` ya existe y está pensada
para eso.

**Ronda 3 de review del PR #679 (2026-09-08) — dos bloqueantes, ambos en
`useOfflineQueue.ts`, y el segundo introducido por un arreglo menor de la
ronda 2 (m10):**

- **B1.** m10 (ronda 2) evitaba que `timersRef` creciera sin límite quitando
  cada timer del array en cuanto disparaba — pero lo hacía **reasignando**
  `timersRef.current` a un array nuevo (`.filter(...)`), y la limpieza del
  efecto de montaje capturaba `timersRef.current` en una variable local AL
  MONTAR, no al desmontar. En cuanto el primer timer disparaba, esa variable
  quedaba apuntando al array viejo — cualquier reintento programado
  DESPUÉS quedaba en el array nuevo, invisible para el `clearTimeout` del
  desmontaje. Escenario: A cierra sesión entre el primer y el segundo
  reintento de su propio `close_manifest`; B entra; el timer huérfano de A
  dispara igual, ejecutando el closure viejo de `drain` (operatorId/userId
  de A) contra el cliente Supabase actual (sesión de B) — `close_manifest`
  deriva `signature_operator_name` de `auth.uid()`, así que el cierre de A
  queda firmado con el nombre de B. **Implementado:** la limpieza lee
  `timersRef.current` en el momento en que se ejecuta, no una variable
  capturada al montar. **Seguimiento descubierto durante el mutation-test de
  este arreglo, no en el review original:** un `drain()` en vuelo en el
  momento exacto del desmontaje puede llamar a `scheduleRetry` DESPUÉS de
  que la limpieza ya corrió — la limpieza no puede cancelar un timer que
  todavía no existe. Cerrado con `mountedRef`: `scheduleRetry` es un no-op
  si el componente ya se desmontó, sin importar cuándo dentro del `drain()`
  en vuelo se intente llamar. Test dedicado
  (`useOfflineQueue.test.ts`, "B1 (seguimiento)") gatea `send()` para
  desmontar mientras sigue pendiente y confirma que ningún reintento llega
  a programarse.
- **B2.** `drainManifest` sale por `manifestHasDeadEntry` ANTES de mirar
  `nextAttemptAt`, pero el `remaining` que `drain()` usaba para reprogramar
  el próximo intento seguía incluyendo esa entrada. Si su backoff ya había
  vencido, `delay === 0` en cada pasada — `drain()` se reprogramaba
  inmediato, repetía el mismo estado bloqueado, y volvía a dar 0. Sin
  techo, sin salida: medido en el review, ~49 pasadas por segundo, cero
  envíos, alcanzable tanto cross-user (el `dead` de un usuario bloquea el
  manifiesto para otro) como con dos pestañas del mismo usuario.
  **Implementado:** antes de calcular `soonest`, se excluyen las entradas
  cuyo manifiesto está bloqueado por un `dead` (`manifestHasDeadEntry`) —
  nada que este drenador no vaya a poder avanzar debe alimentar el
  temporizador de reintento.

Dos mayores que el review pidió arreglar, no sólo anotar:

- **M3.** `ownEntries` rompía el FIFO entre usuarios: `drainManifest`
  filtraba por `userId` ANTES de mirar si había una entrada `pending` de
  OTRO usuario por delante en el mismo manifiesto — el propio docstring de
  `manifestHasDeadEntry` da el argumento que lo contradice ("un `dead` en un
  manifiesto es un problema del MANIFIESTO, no de quién lo encoló"); un
  `pending` por delante es lo mismo, sólo temporal. Y había un test
  (`useOfflineQueue.test.ts`) que **consagraba** el bug como comportamiento
  correcto. Escenario: A escanea 5 bultos sin red y cierra sesión; B entra,
  escanea 3 y firma; el drenador de B se saltaba los 5 de A — el manifiesto
  se cerraba corto de lo que el cliente firmó. Hoy no es explotable
  (`pickup_scan` no tiene productor real todavía), pero el test bloqueaba el
  arreglo correcto para cuando lo tenga. **Implementado:** guarda hermana de
  `manifestHasDeadEntry` (`manifestBlockedForUser`) — la cabeza real del
  FIFO del manifiesto (sin filtrar por usuario) tiene que ser de esta sesión
  antes de tocar nada en él. Test corregido para afirmar el comportamiento
  correcto.
- **M4.** `useOfflineQueue.test.ts` ("a 500 (retry) does not discard the
  entry") no desmontaba ni congelaba el reloj, y `drain()` deja un
  reintento real a +1000ms tras la primera respuesta 'retry'; el mock de
  `send` devuelve `'sent'` en su segunda llamada. Bajo un stall de reloj
  real (contención de CPU con el resto de la suite, GC) ese timer podía
  disparar para real entre el fin del test y la limpieza automática,
  enviando y purgando una fila que el test asumía seguía `pending`. No es
  la carrera de M6 ni contención de recursos sin mecanismo — es un test con
  deadline de reloj real, y el review pidió arreglarlo, no etiquetarlo
  "flaky". **Implementado:** el test desmonta explícitamente antes de leer
  el estado final — con B1 corregido, eso cancela el timer de forma
  determinista sin depender de cuándo llegue el runner a su `afterEach`.

Un mayor nuevo, del checklist original de esta fase (nunca implementado):

- **M5.** El techo de `retryCount` seguía sin existir — `spec-81`
  (fase 3, M-4) ya declaraba este residual "pendiente de la fase 2". `dead`
  sólo se alcanzaba vía `outcome: 'dead'` del sender (los centinelas
  `permanent`/`idempotent`); nada más agotaba reintentos nunca. Con
  `MAX_BACKOFF_MS` topado en 30s, un error `transient` desconocido (un
  42501 sin reconocer, o el 409 de lote de fase 3 que el sender nunca puede
  confirmar completo) reintentaba cada 30s para siempre, y
  `getPendingPickupCount` lo contaba como `pending` — `SyncChip` pintaba
  verde de éxito "1 EN COLA" indefinidamente. Mismo síntoma que B3 (ronda
  2) corrigió para `dead`. **Implementado:** `MAX_RETRY_ATTEMPTS = 10`
  (~3 minutos de reintentos con el backoff topado antes de dar por muerta
  una entrada) — al agotarse, `markDead` en vez de otro `markFailed`.

Bloqueante nuevo, hallado por el usuario auditando contra el mock de diseño
(no del review de mutación):

- **P0.** El camino interactivo de `complete/[loadId]/page.tsx` trataba
  `classifyCloseManifestError`'s `kind: 'idempotent'` como un rechazo de
  negocio genérico — caía al mismo `toast.error` + botón re-habilitado que
  un `permanent` de verdad, en vez de a la rama de éxito. Escenario: la
  cuadrilla firma y tapea "Confirmar y completar"; `close_manifest`
  COMMITEA — manifiesto cerrado, firmas escritas — y la respuesta se pierde
  en un túnel; el operario tapea otra vez, choca con `MANIFEST_ALREADY_SIGNED`
  (23505, "an idempotent 409" según la propia migración), ve un toast rojo,
  y queda atrapado en `5f` para siempre (refrescar no ayuda, el `useEffect`
  recarga el mismo manifiesto ya firmado). El drenador de fondo
  (`offlineQueueSender.ts`) ya mapeaba `idempotent -> 'sent'` correctamente
  — era la otra costura sobre la misma función de clasificación, escrita en
  el mismo PR, que no se había alineado. **Implementado:** `kind ===
  'idempotent'` navega fuera con un toast de éxito, igual que la rama
  offline.

**Decisión del usuario, 2026-09-08 — la línea estática del mock de `5f`.**
El mock (`docs/design/Recogida.dc.html`, PR #685, mergeado a `main`) tiene
una línea **estática, siempre visible, antes de que el operario firme**:
*"Todo queda en el teléfono y se sube al recuperar señal. Las fotos
también."* Hasta esta ronda, la pantalla sólo explicaba el offline
**después** de un fallo (un toast tras el error del RPC) — afordancias
opuestas: el mock tranquiliza antes de decidir firmar, el código mostraba
un error y luego decía que en realidad había ido bien. Razón por la que
esto se había inventado en tres rondas de review en vez de estar decidido
desde el principio: **el mock nunca cubrió el camino de fallo en
absoluto** — cero coincidencias de "error"/"reintentar"/"no se pudo" en
todo el fichero. El usuario tomó la recomendación del review tal cual:
**añadir la línea del mock, texto literal, antes de firmar — el toast se
queda, como confirmación de que el cierre se encoló, no como reemplazo**.
Implementado en `complete/[loadId]/page.tsx`, antes de la sección de firma
del operador (mismo orden que el mock, justo antes de "FIRMA DEL LOCAL").

**Hueco de diseño declarado, no decidido:** el mock de `5f` **sigue sin
cubrir** qué ve el operario ante un rechazo de negocio irrecuperable
(`MANIFEST_NOT_CLOSABLE`, `OPERATOR_SIGNATURE_REQUIRED`, los dos
cross-tenant `42501`) — esa pantalla (toast de error + botón re-habilitado,
sin más afordancia sobre a dónde ir o qué hacer) sigue siendo invención de
review, no una decisión de diseño. Queda anotado para que no se lea como
resuelto.

**Ronda 4 de review del PR #679 (2026-09-08) — BLOQUEADA por segunda vez, con
mediciones (E1-E4), no lectura.** El patrón de las tres rondas anteriores era
que cada arreglo correcto abría el siguiente agujero por un flanco
adyacente — "la costura entre ellos", en palabras del reviewer. Esta ronda
cerró las dos costuras de diseño, no otra tanda de parches sueltos.

**Costura 1 (offline no debe consumir presupuesto de reintentos) — cerrada
estructuralmente.** `offlineQueueSender.ts` colapsaba `case 'offline'` y
`case 'transient'` en el mismo `outcome: 'retry'` — el hook no podía
distinguir "el servidor devolvió algo raro" de "el operario está en un
sótano". Medido por el reviewer: 149s de backoff real (~10 intentos) bastan
para que una caída de señal de unos minutos en el muelle agote
`MAX_RETRY_ATTEMPTS`, `markDead` bloquee el manifiesto entero
(`manifestHasDeadEntry`, "deliberadamente permanente"), y la promesa de `5f`
("se sube al recuperar señal") se vuelva falsa — verificado con
`retryCount: 9`, `lastError: "retries exhausted..."`, `sent: 0` tras volver
la señal. **Implementado:** `OfflineQueueOutcome` gana `{ outcome: 'offline';
reason }`, distinto de `'retry'`; el sender lo reporta por separado
(`classifyCloseManifestError` ya lo clasificaba así — el colapso ocurría al
cruzar hacia el hook). `drainManifest` trata `'offline'` con el mismo
retroceso exponencial que `'retry'` pero **nunca** lo cuenta contra
`MAX_RETRY_ATTEMPTS` ni lo deja llegar a `dead` por agotarlo. La línea de
`5f` vuelve a ser verdad porque ahora lo es: reproducido en un test
determinista (`E4`, `useOfflineQueue.test.ts`) que conduce 14 fallos
`'offline'` seguidos y afirma que la entrada sigue `pending` — verificado en
rojo contra el código de la ronda 3 antes de arreglar.

**Costura 2 (el filtro de B2 no cubre lo que M3 bloquea) — cerrada
estructuralmente.** `manifestHasDeadEntry` y `manifestBlockedForUser` (M3,
ronda 3) eran dos predicados independientes: `drainManifest` los comprobaba
juntos, pero el cómputo de `remaining`/`soonest` de `drain()` (el que decide
cuándo reprogramar el próximo intento) sólo miraba el primero. Un manifiesto
bloqueado únicamente por M3 con un backoff ya vencido detrás alimentaba
`soonest` con `delay === 0` en cada pasada — spin sin techo. Medido por el
reviewer: ~45 pasadas/s, 0 envíos, sin salida hasta desmontar. **Implementado:**
nuevo módulo `lib/offline/queue-blocking.ts` con `manifestIsBlocked`, el
ÚNICO predicado que decide si un manifiesto puede avanzar — lo consumen
`drainManifest` (gating) y `drain()` (filtro de `remaining` antes de
`soonest`) por igual. Con una sola fuente de verdad, esta clase de bug no
puede volver a divergir por un tercer flanco. Reproducido en `E1`
(`useOfflineQueue.test.ts`, spía sobre `listPending`) — bajo el código de la
ronda 3 el conteo de pasadas llegó a 105 en 1s; con la costura cerrada, se
mantiene por debajo de 15.

**Decisión del usuario, 2026-09-08 — el bloqueo cross-user deja de ser
permanente.** Hasta esta ronda, `manifestBlockedForUser` bloqueaba para
siempre a cualquier sesión distinta del dueño de la entrada `pending` que
encabeza el FIFO — sin límite temporal, y `reclaimStale` no toca `pending`
(sólo `sending` huérfanas). Un turno de recogida dura horas; 15 minutos sin
que el dueño mueva su entrada significa que ya no está, y el trabajo tiene
que seguir sin intervención humana. **Implementado:** `CROSS_USER_RECLAIM_MS`
(15 min, `lib/offline/queue-blocking.ts`) — deliberadamente **distinta** de
`RECLAIM_STALE_MS` (90s, `useOfflineQueue.ts`): esa recupera una reclamación
`sending` huérfana **de la misma sesión** (pestaña muerta a mitad de envío);
ésta reclama una entrada `pending` **de otra persona** que nunca llegó a
intentarse. Pasado ese tiempo desde el último toque de la entrada
(`lastAttemptAt` o, si nunca se intentó, `createdAt`), cualquier sesión de
este operador puede procesarla — `drainManifest` ya no filtra `next` por
`ownEntries`, usa `manifestHead` (la cabeza real del FIFO, de cualquier
dueño) una vez que `manifestIsBlocked` confirma que el manifiesto no está
bloqueado. **Riesgo asumido explícitamente por el usuario:** si los dos
operarios están activos a la vez, uno puede enviar lo que encoló el otro —
aceptable porque el envío es idempotente (`client_operation_id`, spec-81
fase 3) y `close_manifest` deriva el firmante de `auth.uid()` en el
servidor, no del payload; nada se pierde ni se duplica, aunque el nombre del
firmante en el registro de custodia puede no ser el que dibujó la firma si
la reclamación ocurre. Una entrada `sending` de otro usuario sigue
bloqueando siempre (sin temporizador propio) — `reclaimStale` (90s, no
filtra por usuario a propósito) es quien la devuelve a `pending`, momento en
el que el temporizador de 15 min empieza a aplicar.

**Decisión del usuario, 2026-09-08 — B-1, el operario puede reintentar desde
la app.** El badge "REQUIERE AYUDA" de `PickupFlowHeader` se vuelve pulsable
cuando la pantalla que lo monta pasa `onRetryBlocked`; al tocarlo, devuelve
todas las entradas `dead` de ESE manifiesto a `pending`, reseteando
`retryCount` a 0 y limpiando `nextAttemptAt`/`claimToken`. **Implementado:**
`retryDead` (`lib/offline/queue-claims.ts`, acotado por `manifestId` — nunca
por todo el operador, para no reabrir un manifiesto que el operario no tiene
delante) + `retryBlockedManifest` (`hooks/useOfflineQueue.ts`), que llama a
`retryDead` y dispara un `window.dispatchEvent(new Event('online'))` para
que el drenador ya montado en `AppLayout` (que no expone su `drainNow` a
ninguna pantalla, y `AppLayout.tsx` está fuera de alcance esta ronda) recoja
la pasada de inmediato — el mismo mecanismo al que ya está suscrito, no uno
nuevo. Es la afordancia mínima que convierte "muerto" en "atascado", y lo
que hace defendible el techo de `MAX_RETRY_ATTEMPTS` — sin ella, agotarlo
sería sólo otro callejón sin salida. **Menor 5 cerrado en la misma pasada:**
`5f` (`complete/[loadId]/page.tsx`) no montaba `PickupFlowHeader` ni ningún
indicador de bloqueo — era la única pantalla del flujo que hace la promesa
"se sube al recuperar señal" sin forma de saber si algo estaba, de hecho,
bloqueado. En vez de montar el header completo (pide `total`/`retailerName`/
`pickupPoint` que esta pantalla no carga), se añadió un indicador ligero
propio con el mismo `onRetryBlocked`, y color `status-error-*` (no
`status-warning-*`, que ya usa el badge "COLA N" — dos severidades opuestas
no pueden compartir color, la otra mitad del menor 5).

**M-2, el badge no puede pintar "COLA N" sobre algo bloqueado — cerrado.**
`getPendingPickupCount`/`getBlockedPickupCount` (`lib/db.ts`) contaban por
`status` solamente, sin mirar si el manifiesto de cada entrada podía avanzar
de verdad — la misma mentira que B3 (ronda 2) corrigió para `dead`,
reintroducida por el bloqueo cross-user. **Implementado:** ambos contadores
recorren sus entradas candidatas y consultan `manifestIsBlocked` por cada
una (excepto `sending`, siempre activa, nunca bloqueada); una entrada
bloqueada resta de `getPendingPickupCount` y suma en `getBlockedPickupCount`.
Cubierto en `lib/db.test.ts` (nuevo).

**M-1, `mountedRef` sólo protegía los timers — cerrado.** `drainManifest`
seguía enviando tras el desmontaje por dos vías que `mountedRef` no cubría:
el bucle `for(;;)` no lo consultaba (E2 medido: `sends after unmount: [S1,
S2, close]`), y `rerunRequestedRef` disparaba una pasada nueva en el
`finally` de `drain()` sin mirarlo (E3 medido: 2 envíos tras el desmontaje,
incluyendo una entrada encolada DESPUÉS de desmontar). Riesgo real, no
cosmético: `pickupQueueSender` (`AppLayout.tsx`) resuelve la sesión en el
momento de la petición — una pasada que sobrevive al desmontaje (cerrar
sesión) envía con el JWT que haya entonces. **Implementado:** `drainManifest`
recibe `isMounted: () => boolean` y lo comprueba al inicio de cada vuelta y
antes/después de `send()`, abandonando sin escribir el resultado si ya se
desmontó (la entrada queda `sending`, huérfana; `reclaimStale` en un futuro
montaje la recupera — el mismo mecanismo que ya existe para una pestaña que
muere a mitad de envío). El `finally` de `drain()` sólo ejecuta el rerun si
`mountedRef.current` sigue `true`. Reproducido en `E2`/`E3`
(`useOfflineQueue.test.ts`), verificados en rojo contra el código de la
ronda 3.

**M-3, la suite era inestable en frío — diagnosticado, no etiquetado
"flaky".** Con los 10 ficheros del área juntos y caché fría, 4 tests fallaban
intermitentemente (2/5 ejecuciones en la medición del reviewer). Causa real,
no "contención genérica": tres de los cuatro (`useSyncQueue` H2, "drains two
scans...", "a dead scan blocks...") usaban `waitFor` con el timeout por
defecto (1000ms) contra trabajo que, bajo la contención de CPU real de 10
ficheros de test corriendo en paralelo (`--pool=forks`), puede tardar más
que eso sin que el mecanismo bajo prueba esté roto — el mismo patrón que M6
(ronda 3) ya había tenido que ensanchar. Ensanchados a 5s. El cuarto (M5,
nuevo de la ronda 3) tenía una causa distinta y más concreta: la primera
falla de mount deja un `setTimeout` real de 1000ms vivo
(`nextBackoffAt(0)`), y el bucle manual de 20 vueltas que conduce el resto
de los reintentos podía, bajo esa misma contención, tardar más que eso —
permitiendo que ese timer disparara A MITAD del bucle y compitiera por
`drainingRef` con la vuelta manual en curso, convirtiéndola en un no-op.
**Implementado:** en vez de conducir las 9 vueltas reales necesarias para
llegar al techo (que es lo que abría la ventana de colisión), el test siembra
`retryCount` a `MAX_RETRY_ATTEMPTS - 1` directamente y sólo necesita UNA
pasada real que sí se ejecute — el bucle de 20 vueltas queda como red de
seguridad idempotente, no como el mecanismo principal. Verificado: 191/191
en 3 de 5 ejecuciones de los 10 ficheros juntos con caché fría; las otras 2
no fallaron en absoluto (el propio M5 se reprodujo una vez más y quedó
corregido con el fix de arriba).

**Menores cerrados en esta ronda:** 1 (el test de la línea estática de `5f`
sólo hacía `findByText`, sin comprobar el orden respecto a `SignaturePad` —
anclado con `compareDocumentPosition`); 2 (`manifestBlockedForUser` usaba
`listPending`, que excluye `sending` — una entrada ajena atascada en
`sending` no bloqueaba, ventana de hasta 90s de salto de FIFO entre
usuarios; `manifestHead`, el reemplazo, incluye `sending` a propósito); 6
(el checklist de esta fase no registraba que M5 llega a `dead`, que `dead`
es el bloqueo permanente de B3, ni que `offline` contaba para el techo antes
de esta ronda — corregido arriba; el docstring de `MAX_RETRY_ATTEMPTS` decía
"~3 minutos", medido son 149s).

**Menor 3, declarado, no arreglado — fuera de alcance esta ronda.**
`MANIFEST_ALREADY_SIGNED` lo levanta la migración
(`20260913000004_spec80_close_manifest_acl_fix.sql:140`) con `IF
v_manifest.signature_operator IS NOT NULL`, sin mirar QUIÉN firmó. Si otro
operario cerró el manifiesto antes, este operario ve `toast.success` verde y
sale, con la firma del cliente que acaba de capturar descartada en silencio
— el texto es honesto, el canal (éxito + navegar fuera) no. Arreglarlo exige
que la migración devuelva (o el RPC exponga) quién firmó, para que el
cliente pueda distinguir "mi propio reintento aterrizó" de "alguien más ya
cerró esto" — y las migraciones SQL están fuera de alcance de esta ronda
(lista de "no tocar" del encargo). Queda anotado para una fase futura que sí
toque `close_manifest`.

**Qué se cerró estructuralmente y qué se parchó, tal como pidió el
usuario:** las DOS costuras (1 y 2) se cerraron estructuralmente —
`queue-blocking.ts` es la única fuente de verdad para "¿puede avanzar este
manifiesto?", y `OfflineQueueOutcome` distingue `offline` de `transient` en
el tipo, no sólo en un comentario. Nada de esta ronda es un parche sobre las
mismas dos costuras. M-3 (la inestabilidad de tests) sí tiene un componente
de parche honesto: ensanchar `waitFor` a 5s en tres de los cuatro tests no
cambia el código bajo prueba, sólo el margen de la aserción — la causa raíz
ahí es contención de CI, no un bug del drenador, así que no había una
"costura" que cerrar del lado de producción. El cuarto (M5) sí tuvo un
arreglo estructural del lado del TEST (reducir de 9 pasadas reales
necesarias a 1), no del código de producción.

**Ronda 5 de review del PR #679 (2026-09-08) — un bloqueante (el cuarto
flanco de la cola de reintentos), tres mayores acotados, y el arreglo de
Vercel del coordinador (fuera de la cola, en `AppLayout.tsx`).** El review
confirmó primero que las costuras 1 y 2 de la ronda 4 estaban genuinamente
cerradas (9 mutantes probados, todos muertos) y que E4 corrió de punta a
punta con el sender real (750s de outage simulada, 30 intentos reales,
`retryCount: 30`, la fila sobrevive y sube al volver la señal) — el riesgo
de producto nº1 quedó confirmado cerrado, no sólo con el sender de prueba.

**Bloqueante — costura 3 ("¿es reclamable esta fila?"), cerrada
estructuralmente.** `manifestHead` (`queue-blocking.ts`) incluye `sending`
a propósito desde la ronda 4 (menor 2, cierra el bloqueo cross-user), pero
`claimPending` sólo reclama `status === 'pending'`. Una cabeza `sending`
PROPIA — huérfana, abandonada por el guard `isMounted` del M-1 de la ronda
4 tras un desmontaje a mitad de envío, o por una pestaña muerta que
`reclaimStale` aún no alcanzó — no está bloqueada por `manifestIsBlocked`
(las entradas de un usuario nunca lo bloquean a él mismo), así que
`manifestHead` la seguía devolviendo, seguía sin ser reclamable, y el
bucle de `drainManifest` volvía a pedirla en la vuelta siguiente sin salir
jamás — `drainingRef.current` se quedaba `true` para siempre, así que ni
`drainNow()` ni un futuro evento `online` volvían a hacer nada. Medido por
el reviewer: 1446 iteraciones/segundo, 0 envíos (E5b); y la consecuencia
—cambio de turno en el muelle: el siguiente conductor entra, y la cola no
vuelve a moverse mientras la app siga abierta, ni siquiera pasado
`RECLAIM_STALE_MS`— medida aparte (E8). **Implementado:** `isClaimable`
(`queue-blocking.ts`) es el único predicado para "¿puedo reclamar esta
fila ahora?" (hoy: `status === 'pending'`); `drainManifest` lo comprueba
justo después de `manifestHead` y `return`s (no `continue`) si es falso —
nada que este drenador pueda hacer con esta cabeza en esta pasada; la
siguiente pasada de `drain()` (que sí corre `reclaimStale` primero) es
quien puede liberarla. Reproducido en `E5b` (conteo de iteraciones,
verificado en rojo contra el código de la ronda 4 antes de arreglar: 1269
iteraciones/s) y `E8` (la cadena completa: la reclamación se libera tras
`RECLAIM_STALE_MS` y un `drainNow()` posterior sí reanuda). Mutation-
testeado: quitar el guard revive el mismo síntoma medido.

**M-1, ronda 5 — el evento `online` sintético dejó de mentirle al resto de
la app.** `retryBlockedManifest` despertaba al drenador con
`window.dispatchEvent(new Event('online'))` — un evento GLOBAL con siete
suscriptores reales (`Providers.tsx`: React Query's `onlineManager`;
`useSyncQueue.ts`; `scanStore.ts`; entre otros). Tocar "REQUIERE AYUDA"
sin señal de verdad les mentía a todos a la vez, y nada se autocorregía
porque el estado de red real nunca cambiaba. Medido: `navigator.onLine
=== false` pero `SyncChip.status === 'online'` y
`onlineManager.isOnline() === true` tras un solo tap. **Implementado:**
`PICKUP_QUEUE_WAKE_EVENT` (`'aureon:pickup-queue-wake'`), un evento propio
con un solo suscriptor (el propio `useOfflineQueue`) — "hay trabajo nuevo,
no esperes al backoff" sin fingir que la red volvió. `window.addEventListener`
sigue escuchando `online` TAMBIÉN (la reconexión real sigue disparando una
pasada), sólo `retryBlockedManifest` cambió qué dispara.

**M-2, ronda 5 — los contadores dejaron de ser O(N²).**
`getPendingPickupCount`/`getBlockedPickupCount` (`db.ts`) llamaban
`manifestIsBlocked` una vez POR ENTRADA, y cada llamada hace 2 escaneos
completos del índice. `useSyncQueue` invoca ambos cada `POLL_MS` (2s).
Medido: N=200 (dentro del tope de 500 que declara `enqueue`, el escenario
normal de una carga escaneada sin red) tardaba 21 SEGUNDOS por contador.
**Implementado:** `createBlockedChecker` (`db.ts`) memoiza
`manifestIsBlocked` por `(manifestId, userId)` — el resultado sólo depende
de ese par, nunca de la entrada en sí — reduciendo el coste al número de
pares distintos realmente presentes (unos pocos manifiestos), no al número
de entradas. Test dedicado con 200 entradas en un mismo manifiesto:
`manifestIsBlocked` pasa de 200 llamadas a ≤1.

**M-3, ronda 5 — el badge cuenta bloqueos que el botón no podía
desbloquear.** `blockedCount` incluye desde la ronda 4 los `pending`
bloqueados cross-user, pero `retryBlockedManifest` sólo revive `dead` (un
bloqueo cross-user se resuelve solo, con `CROSS_USER_RECLAIM_MS`, no con
un botón). El operario leía "1 REQUIERE AYUDA / Toca para reintentar",
tocaba, y no pasaba nada — sin cambio, sin feedback. **Implementado:**
`retryBlockedManifest` devuelve cuántas entradas `dead` revivió de verdad
(antes `void`); `PickupFlowHeader`'s dos pantallas (`scan/[loadId]` y
`complete/[loadId]`) muestran `toast.info('Nada que reintentar
todavía. Puede que otro operario lo esté procesando.')` cuando el conteo
es 0. No se amplió el alcance del botón (revivir un bloqueo cross-user
sigue siendo automático, por tiempo) — se cerró el hueco de feedback.

**Menores cerrados:** 1 (`db.pickup-queue.test.ts:66` remitía a
`db.test.ts`, borrado en `98e941f` al consolidar — corregido a apuntar al
test real en el mismo fichero); 2 (se perdió `does not let one blocked
manifest affect the count of an unrelated one` al consolidar — recuperada);
3 (`queue-blocking.ts` re-exportaba `listPending` "porque `db.ts` lo
necesita" — `db.ts` no lo importa; código muerto con comentario falso,
eliminado).

**Fuera de la cola — el arreglo de Vercel del coordinador.** `AppLayout.tsx`
montaba el sender con `useMemo(() => createPickupQueueSender(createSPAClient()),
[])`; Next.js ejecuta el cuerpo de un componente `"use client"` durante el
prerender/SSR, y `createSPAClient()` exige las env vars de Supabase en ese
momento — sin ellas (el deploy preview de este PR), rompía el build entero
en `/admin`, `/admin/audit-logs` y `/admin/tools/wismo`. **Implementado:**
`createLazyPickupQueueSender` (`offlineQueueSender.ts`) — identidad
estable desde el primer render (lo que `useMemo` memoiza), pero el cliente
Supabase se construye perezosamente en el primer envío real, cacheado
después; en SSR nunca se envía nada, así que `createSPAClient` nunca se
llama. Verificado con el criterio falsable pedido: `next build` sin
`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` en el entorno compila las tres rutas
sin error (antes: `Error occurred prerendering page...`, reproducido
primero contra el código sin arreglar). `AppLayout.tsx` no estaba en
alcance de esta fase hasta este hallazgo — la instrucción de tocarlo vino
del coordinador, no de una decisión propia de esta ronda.

**Qué se cerró estructuralmente y qué se parchó, otra vez:** la costura 3
se cerró estructuralmente — `isClaimable` es la única fuente de verdad
para "¿es reclamable esta fila?", igual que `manifestIsBlocked` lo es para
"¿puede avanzar el manifiesto?". M-1, M-2 y M-3 son arreglos estructurales
del lado de producción (un evento propio, una memoización real, un valor
de retorno que antes no existía), no parches sobre sus síntomas.

**Ronda 6 de review del PR #679 (2026-09-08) — un residual, "la otra mitad
del mismo agujero de la ronda 4", y una nota menor.** El review confirmó
primero el veredicto de fondo sobre las cinco rondas: la ronda 5 **no abrió
un quinto flanco** — convirtió un bucle infinito con la cola muerta para
toda la sesión en una parada que se cura con cualquier reconexión o
recarga, "estrictamente mejor". Y la cola **no necesita rediseño**: las
rondas 1–4 sí mostraban el patrón "cada arreglo abre un estado nuevo"; la
5 y la 6 no — el residual se enuncia en una frase y se cierra donde ya
está escrito el cálculo. Ese cambio de forma es la señal de que converge.

**El residual — "¿quién vuelve?".** `drainManifest` sale por `return`
cuando la cabeza no es reclamable (costura 3) — correcto, no se puede
saltar la cabeza. Pero eso sólo mueve la pregunta: los cuatro disparadores
reales de una pasada son el montaje, `online` real,
`PICKUP_QUEUE_WAKE_EVENT`, y los timers de `scheduleRetry` — y ese último
sólo se programaba sobre `nextAttemptAt` de entradas `pending` NO
bloqueadas. Una `sending` huérfana no tiene `nextAttemptAt` y `listPending`
la excluye; una entrada detrás de un bloqueo cross-user queda excluida de
`remaining` por completo. Sin ver ninguno de los dos plazos reales
(`RECLAIM_STALE_MS`, `CROSS_USER_RECLAIM_MS`), `soonest` nunca programaba
nada — y `reclaimStale`, quien de verdad libera la cabeza, sólo corre al
INICIO de una pasada que ya nunca volvía a empezar. Medido por el
reviewer: `pending = 2, blocked = 0` en el badge (verde), un
`close_manifest` firmado que nunca sube, sin botón que tocar (S1 no tiene
ni siquiera la vía de escape del badge que S2 sí tiene).

**Implementado:** `manifestRetryEta` (`lib/offline/queue-blocking.ts`)
devuelve el instante en el que un manifiesto podría dejar de estar
atascado — `lastAttemptAt(cabeza) + RECLAIM_STALE_MS` si la cabeza es
`sending` (huérfana propia, o de otra sesión en vuelo), `lastTouchedAt(cabeza)
+ CROSS_USER_RECLAIM_MS` si es `pending` de otro usuario, o `null` si es
directamente accionable por esta sesión (nada que programar, `drainManifest`
ya la habrá tomado en esta misma pasada) o si el manifiesto está bloqueado
de forma permanente (`dead`, ningún temporizador ayuda). `drain()` mezcla
este valor con los `nextAttemptAt` de las entradas propias al calcular
`soonest` — el MISMO mecanismo de programación que ya existía, cerrando
los tres plazos con el mecanismo que ya existe, tal como pidió el reviewer.

**La lección del review, sobre el propio E8 de la ronda 5:** ese test
llamaba a `result.current.drainNow()` a mano tras simular el paso del
tiempo — demuestra que `drainingRef` ya no se atasca (una propiedad real y
necesaria), pero EN PRODUCCIÓN nadie llama a `drainNow()`. Cuando un test
necesita un empujón manual para llegar al estado bueno, esa muleta es una
pregunta abierta sin responder, no parte del arnés. `S1`/`S2`
(`useOfflineQueue.test.ts`) reproducen el residual sin ningún `drainNow()`
manual — sólo tiempo real, sembrando los timestamps a ~200ms de volverse
reclamables (no un atajo a los valores de producción, un margen real corto
para no esperar 90s/15min de verdad en un test). Verificados en rojo
contra el código de la ronda 5 antes de arreglar. Mutation-testeados.

**Nota menor — encolar offline en `5f` ahora despierta al drenador.**
`complete/[loadId]/page.tsx` encolaba la entrada offline y navegaba fuera
sin disparar ninguna señal — descansaba en el mismo supuesto de "ya vendrá
un `online`" que el residual mostró que no basta por sí solo. Ahora
dispara `PICKUP_QUEUE_WAKE_EVENT` justo tras encolar, la misma señal que
`retryBlockedManifest` ya usa, para que el envío se intente de inmediato
en vez de esperar la próxima reconexión real.

### Fase 3 — Idempotencia en el servidor `[in_progress]`

**Archivos:** `packages/database/supabase/migrations/20260913000007_spec81_fase3_pickup_scans_idempotency.sql`,
`packages/database/supabase/tests/spec81_fase3_pickup_scans_idempotency.test.sql`,
`packages/database/supabase/tests/spec81_fase3_close_manifest_idempotency.test.sql`

- [x] Columna `client_operation_id` con índice único parcial por operador.
- [x] Test pgTAP: la misma operación dos veces deja una fila y no altera conteos. Corrido con `scripts/pgtap-local.sh`.
- [x] **Ronda 1 de review — B1:** test pgTAP para el caso de LOTE (un escaneo por
  número de pedido inserta N filas, un `client_operation_id`, un solo
  `.insert()`) — el lote debe sobrevivir su propio primer intento y su
  reintento debe rechazarse sin duplicar ninguna fila. Corrido con
  `scripts/pgtap-local.sh`, mutación verificada (ver decisión 3 revisada).
- [x] **Ronda 1 de review — B2:** `client_operation_id` añadido a
  `apps/frontend/src/lib/types.ts` y `packages/database/src/database.types.ts`
  (`Row`/`Insert`/`Update` de `pickup_scans`) — sin esto, la fase 2 no puede
  compilar un `.insert({ …, client_operation_id })` contra el cliente tipado.
- [x] **Ronda 2 de review — M-1 (bloqueante):** TEST 6 corregido (mismo
  `package_id` en ambas filas) para que vuelva a tener poder sobre
  `operator_id`. Mutación re-verificada.
- [x] **Ronda 2 de review — M-6/m4:** TEST 1/2 convertidos de
  `DO $$ … RAISE EXCEPTION $$` a aserciones pgTAP; plan de 13 a 20.
  Mutación de B1 re-corrida tras la conversión — ahora sí ejercita TEST 3-20
  bajo una mutación de TEST 1/2.
- [x] **Ronda 2 de review — M-2/M-3/M-4/m-5/n-8:** cabecera de la migración
  corregida en los cinco puntos; TEST 14 nuevo (SQL) y
  `scan-validator.test.ts`'s "freezes the M-3 premise" (frontend) congelan
  el alcance real de M-3. Residual de M-4 (bucle de reintento sin techo de
  `retryCount`) documentado, no resuelto — pendiente de la fase 2.

**Decisiones tomadas:**

1. **Qué tablas llevan la columna: sólo `pickup_scans`.** `manifests`
   (close_manifest) y `discrepancies` ya tienen su propia idempotencia por
   llave de negocio — un manifiesto se firma una vez en su vida
   (`signature_operator IS NOT NULL` → 23505 `MANIFEST_ALREADY_SIGNED`,
   20260913000004), y `discrepancies` ya usa los dos índices únicos
   parciales de spec-85 fase 1 + `ON CONFLICT DO NOTHING` — ese comentario
   cita a spec-81 por nombre como el motivo. Añadir `client_operation_id`
   ahí sería un segundo mecanismo sobre una llave que ya existe y ya está
   probada. `pickup_scans` es distinta: se escribe con un `.insert()` directo
   del cliente (no hay RPC de por medio) y no tiene ninguna llave de negocio
   natural — un rescan legítimo del mismo barcode es una fila nueva a
   propósito. Ver el header de la migración para el argumento completo, y
   `spec81_fase3_close_manifest_idempotency.test.sql`, que prueba la
   idempotencia de `close_manifest` **sin tocar su cuerpo**.

   **Residual conocido (M1, ronda 1 de review):** esta decisión cubre los
   CONTEOS de `close_manifest` (verified/missing/unexpected), no que «esta
   operación concreta se aplicó». `signature_operator IS NOT NULL` es «no
   puedo firmar dos veces», no «tu operación ya se aplicó» — un reintento con
   `p_signatures` **distinto** también da 23505, pero la firma original queda
   intacta sin que el cliente lo sepa. Escenario real bajo
   `20260913000004` (cualquier usuario autenticado del operador puede firmar
   cualquier manifiesto suyo): el operario A firma en su teléfono y se pierde
   el 200; el operario B cierra el MISMO manifiesto desde otro teléfono con
   **su** firma y su `client_name`; la cola de A reintenta → 23505 → la fase 2
   lo marca resuelto → A ve «subido, todo bien», pero la evidencia de custodia
   almacenada es la de B. No se añade una columna a `manifests` para esto — el
   checklist literal de esta fase está cumplido — pero es un límite conocido,
   no un caso cubierto. `spec81_fase3_close_manifest_idempotency.test.sql`
   TEST 3/5 lo documenta: el reintento lleva una firma deliberadamente
   distinta (`BBB` contra la `AAA` original) precisamente para que el test
   tenga poder de detectar esta clase de bug si el guard se debilitara.
2. **Duplicado = error 23505 (409), nunca éxito silencioso ni P0002/404.**
   Mismo idioma que `close_manifest`/`record_discrepancies`. La fase 2
   (otra rama) decide tratar ese 409 como resuelto desde el cliente — las
   dos mitades están de acuerdo en el código (23505) y en desacuerdo a
   propósito en la interpretación (servidor: conflicto; cliente: éxito ya
   cumplido). `pickup_scans` no pasa por RPC, así que el 23505 es el
   `unique_violation` crudo de Postgres, sin prefijo centinela — el único
   discriminador que la cola necesita es el ERRCODE, no un mensaje (a
   diferencia de `close_manifest`, que comparte 42501 entre tres causas).

   Nota (n8, ronda 1 de review): el header de la migración argumenta que un
   200 silencioso «escondería» el duplicado y por eso es malo — eso es
   correcto para `pickup_scans`, pero el `ON CONFLICT DO NOTHING` que
   spec-85 usa para `discrepancies` es exactamente esa forma. Ambas son
   correctas en su contexto (RPC con llave de negocio propia vs. INSERT
   directo sin ninguna), pero quien lea sólo el header de esta migración
   puede leerlo como una regla general — no lo es. La fase 2 maneja las dos
   formas de «éxito»: 23505 aquí, 200 con fila vacía en discrepancies.
3. **Índice:** `UNIQUE (operator_id, client_operation_id, package_id) NULLS
   NOT DISTINCT WHERE client_operation_id IS NOT NULL AND deleted_at IS
   NULL` — mismo patrón que `uniq_open_discrepancy_per_package`/`_per_barcode`
   (spec-85 fase 1), con `package_id` añadido y `NULLS NOT DISTINCT` (ronda 1
   de review, B1 bloqueante). La clave original de dos columnas
   `(operator_id, client_operation_id)` colisionaba consigo misma en el
   PRIMER intento de un escaneo por número de pedido: `usePickupScans.ts`
   inserta N filas — una por bulto — en un único `.insert(rows)`, y las N
   comparten el mismo `client_operation_id` (fase 1 estampa uno por entrada
   de cola, no uno por fila física). `package_id` en la clave arregla el
   lote; `NULLS NOT DISTINCT` es necesario porque `package_id` es `NULL` en
   un escaneo `not_found`/`duplicate` — sin el modificador, el reintento de
   ESE escaneo no colisionaría consigo mismo (Postgres trata `NULL <> NULL`
   por defecto) y se perdería la idempotencia justo donde el barcode no
   resolvió a un paquete. `operator_id` en la clave por la regla no
   negociable del repo. Ver el header de la migración para el detalle
   completo, incluida la razón por la que `client_operation_id IS NOT NULL`
   pasa de ser honesto-pero-redundante a necesario una vez que `NULLS NOT
   DISTINCT` aplica a todo el índice, no columna por columna (m3).

**Límites conocidos, documentados y no resueltos aquí (menores, ronda 1 de
review):**

- **m5 — TEST 6 (cross-tenant) inserta una fila de un manifiesto del
  operador A bajo el `operator_id` del operador B.** Corre como `postgres`,
  así que RLS no aplica y la fixture entra; un manifiesto propio de B
  costaría cuatro líneas más. Ninguno de los dos ficheros de esta fase
  ejercita el camino bajo el rol `authenticated` — «el cliente recibe 23505»
  está probado como superusuario, no como el actor real.
- **m6 — la ventana de `deleted_at IS NULL` es real y hoy sin explotador.**
  Un escaneo soft-borrado libera su `client_operation_id`, y una entrada de
  cola aún `pending` con ese id lo reinsertaría. No hay ningún camino de
  soft-delete de `pickup_scans` en el frontend hoy — sólo aplicaría a una
  corrección manual por SQL de soporte. Trade-off aceptado, no un cambio.
  **Ronda 2 (M-2):** con un lote de N filas bajo un único
  `client_operation_id`, esta ventana es peor de lo descrito arriba —
  soft-deletear sólo UNA fila del lote y dejar que la cola reintente el LOTE
  ENTERO (un único statement atómico) hace que el reintento choque contra
  las N-1 filas vivas y se rechace completo: la fila borrada nunca se
  reinserta, y el manifiesto queda corto en el bulto exacto que el cliente
  firma. Sigue mitigado por lo mismo que m6 — no hay soft-delete de
  `pickup_scans` desde el frontend hoy — pero la cabecera de la migración
  quedaba corregida: ver `20260913000007:157-170`.
- **n7 — el header de la migración (`20260913000007:206-213`, corregido en
  ronda 2 de review del PR #679 — citaba `104-109`, obsoleto tras
  reordenarse la migración) desmonta la
  regla 2 de `check-migration-safety.mjs` pero no la 3**, y el warning que
  CI emite sobre este archivo es de la regla 3. Es un falso positivo
  legítimo — el predicado parcial excluye todas las filas existentes, así
  que no hace falta backfill — pero el header no lo dice explícitamente.
- **Dos operarios del mismo operador generando por azar el mismo UUID v4**
  → el segundo recibe 409 y la fase 2 lo da por resuelto, perdiendo un
  escaneo real. Probabilidad ~0 con 122 bits de entropía por UUID v4,
  aceptado explícitamente.

**Ronda 2 de review — correcciones y residuales nuevos:**

- **M-1 (bloqueante):** TEST 6 de `spec81_fase3_pickup_scans_idempotency.test.sql`
  se volvió vacuo al añadir `package_id` a la clave — con `package_id` NULL en
  la fila de op_B contra `package_id` real en la de op_A, las dos ternas ya
  discriminaban por `package_id`, así que el test pasaba aunque `operator_id`
  no estuviera en el índice (verificado por mutación: cero `not ok` mutando
  el índice a `(client_operation_id, package_id)`). Corregido dándole a la
  fila de op_B el MISMO `package_id` que la de op_A — ahora `operator_id` es
  la única columna que sigue discriminando, y un mutante que lo quite falla
  el test por comportamiento, no sólo por el `ILIKE` textual de TEST 2.
- **M-6/m4 — TEST 1/2 pasaron de `DO $$ … RAISE EXCEPTION $$` a aserciones
  pgTAP (`ok`/`is`).** Una `RAISE` aborta la transacción entera: los TEST 3+
  nunca corrían bajo una mutación de TEST 1/2, así que la evidencia de
  mutación de B1 nunca había ejercitado el comportamiento real hasta que el
  reviewer quitó TEST 2 a mano. Re-verificado tras la conversión: mutando el
  índice, ahora se ven `not ok` reales y el resto del archivo sigue
  corriendo.
- **M-2 — la justificación de `deleted_at IS NULL` en la cabecera era falsa
  para lotes N>1.** Corregido en `20260913000007:157-170`; ver bullet de m6
  arriba.
- **M-3 — «la auto-colisión ya no ocurre» estaba sobre-afirmado.** Bajo
  `NULLS NOT DISTINCT`, un lote de 2+ filas con el MISMO
  `client_operation_id` y `package_id IS NULL` en todas vuelve a
  auto-colisionar en el primer intento — es B1 otra vez, en el carril NULL.
  No alcanzable hoy vía `usePickupScans.ts` (`scan-validator.ts` sólo produce
  `packageIds.length > 1` con ids reales de `packages.id`, nunca NULL), pero
  es una propiedad de las escrituras de HOY, no del índice en general.
  Corregido en `20260913000007:178-192`; congelado con
  `spec81_fase3_pickup_scans_idempotency.test.sql` TEST 14 (SQL, general) y
  `scan-validator.test.ts`'s "freezes the M-3 premise" (frontend, la premisa
  de hoy).

  **Seguimiento cerrado (fase 2, ronda 2 de review del PR #679):** el test
  de arriba sólo congelaba la mitad de la premisa — que la rama de número de
  pedido nunca devuelve ids nulos, no que sea la ÚNICA rama que puede
  devolver más de uno. Mutar la rama 1:1 (`scan-validator.ts:72`) o la de
  duplicado (`:66`) para devolver dos ids sobrevivía. Cerrado con
  `expect(result.packageIds).toEqual([])` en el test de duplicado y un test
  nuevo de la rama 1:1 con `toHaveLength(1)`; ambos mutation-verificados.
- **M-4 — la cabecera citaba el contrato de la fase 2 al revés.** Decía que
  la fase 2 trata todo 409 idempotente como éxito ya resuelto; el docstring
  real de `OfflineQueueSender` (`useOfflineQueue.ts`, PR #679) dice lo
  contrario — un sender debe releer el conteo real antes de devolver
  `'sent'`. Corregido en `20260913000007:56-76`.

  **Residual nuevo (M-4):** un 409 causado por un lote incompleto (el
  escenario de M-2/m6) hace que un sender correcto nunca vea el conteo
  esperado y siga devolviendo `'retry'` indefinidamente —
  `drainManifest` (`useOfflineQueue.ts`, fase 2) no tiene transición a
  `'dead'` por `retryCount`, sólo el sender puede devolver `'dead'`. Sin que
  el sender implemente ese corte, la entrada queda en bucle con retroceso
  exponencial topado en 30s, para siempre. No resuelto en esta fase ni en la
  2 — decisión pendiente de quien escriba el sender real (fase 2 o una fase
  futura).
- **m-5 — la cabecera afirmaba PG 15.8 como la versión de producción.** Falso:
  producción y QA corren PG 17
  (`packages/database/supabase/config.toml`'s `major_version = 17`,
  `infra/supabase-qa/docker-compose.yml`'s `supabase/postgres:17.6.1.136`);
  15.8 es sólo la imagen de `scripts/pgtap-local.sh`. Sin impacto funcional
  — verificado también contra `postgres:17.10` — pero la única prueba de
  esta migración corre en un major distinto al de destino. Corregido en
  `20260913000007:124-133`.
- **n-8 — la cabecera daba la razón equivocada para omitir `CONCURRENTLY`.**
  Decía «no hay backfill»; la razón real es que `pickup_scans` es pequeña
  hoy, así que el lock `SHARE` que `CREATE UNIQUE INDEX` sí toma dentro de
  `BEGIN` (bloqueando escrituras mientras escanea la tabla) es breve. La
  ausencia de backfill es la razón de otra cosa (por qué no hace falta el
  patrón COUNT(*)-guard). Corregido en `20260913000007:194-204`.

> Implementación en curso en `feat/spec-81-fase-3-idempotencia-servidor`. Ronda 2
> de review corregida (M-1 bloqueante, M-2/M-3/M-4/m-5/n-8, TEST 1/2
> convertidos a pgTAP). Falta PR y QA antes de poder marcar esta fase `[done]`.

### Fase 4 — Chip de sync `[pending]`

**Archivos:** `components/ConnectionStatusBanner.tsx` → chip; su test e i18n

Redacción del handoff: «se guardan en el dispositivo y se envían solos…». Cuenta pendientes, como pide `5i`.

- [ ] Desmontar el `fixed top-0` sin romper auth ni landing, que hoy también lo montan.
- [ ] **Afordancia humana para `dead` (B3, ronda 2 de review del PR #679 —
      bloqueante en fase 2, no cerrado del todo ahí).** `dead` es
      deliberadamente permanente — ver el docstring de `manifestHasDeadEntry`
      y la decisión de no revertirlo tomada en la ronda 2: soltar el cierre
      detrás de un escaneo muerto cierra la carga con un bulto de menos, que
      es el riesgo nº1 del spec. Pero hoy, tras la ronda 2, `dead` sólo dejó
      de mentir (`getBlockedPickupCount`, separado de `queuedCount`;
      `SyncChip` ya no lo pinta en verde de éxito) — no tiene ninguna salida.
      Grep de `'dead'` en todo `apps/frontend/src`: sólo aparece en el tipo,
      en los guards de `queue-claims.ts`, en `manifestHasDeadEntry` y en
      `getBlockedPickupCount` (para contarlo). Ninguna pantalla, botón,
      `markAlive` ni purga manual. Sin esto el operario recibió el toast
      «tu firma se guardó y el cierre se enviará solo» y nada se lo
      desmiente nunca — el chip ahora dice «requiere ayuda» pero no dice a
      quién pedírsela ni qué hacer. Esta fase, que ya toca `SyncChip` y su
      pantalla, debe: mostrar qué manifiesto está bloqueado y por qué
      (`lastError`), y dar una vía para que un humano lo resuelva (contactar
      soporte/operaciones — no necesariamente reintentar solo, dado que
      `dead` es un rechazo de negocio, no de red).

### Fase 5 — Fotos `[pending]`

**Archivos:** `lib/offline/photos.ts`, integración con `ManifestPhotoStrip` (spec-80 fase 3)

- [ ] Blob a IndexedDB en captura; subida al bucket `manifests` al drenar; `manifest_documents` se inserta **después** de que la subida confirme, nunca antes.
- [ ] Test: fila huérfana imposible — si la subida falla, no hay registro apuntando a un objeto inexistente.

---

## Riesgos

- **Una cola a medias es peor que ninguna.** Si `5d` dice «guardado en el dispositivo» y la entrada se pierde, el operario cierra una carga con un conteo falso y el cliente firma sobre esa cifra. Las fases 1–3 van juntas o no va ninguna; sólo la 4 y la 5 son separables.
- **Cuota de IndexedDB.** Varias hojas por carga y varias cargas por ruta llenan el disco del teléfono. Hace falta política de purga de lo ya subido y un tope declarado. **Tope declarado y aplicado (fase 2, ronda 1 de review del PR #679, m3):** `purgeConfirmed` borra las entradas `sent` de un operador tras cada drenado exitoso; el tope duro para entradas sin confirmar (`status !== 'sent'`) se fija en **500 por operador** y `enqueue` lo comprueba, rechazando con un error explícito en vez de fallar en silencio contra la cuota real del navegador. Con blobs de fotos (fase 5) el límite relevante deja de ser el conteo y pasa a ser bytes; esa fase redefine el tope en tamaño, no en número de filas.
- **El alcance puede tentar a crecer** a Recepción y Despacho. Este spec entrega la infraestructura y **sólo** conecta Recogida; adoptarla en otros módulos es trabajo posterior con sus propios specs.
