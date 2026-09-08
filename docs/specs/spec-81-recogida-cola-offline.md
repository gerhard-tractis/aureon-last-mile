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

### Fase 1 — Almacén y contrato `[in_progress]`

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

### Fase 2 — Drenado `[pending]`

**Archivos:** `apps/frontend/src/hooks/useOfflineQueue.ts`, `+ test`

Drena al recuperar `navigator.onLine` y al montar. Retroceso exponencial con techo. FIFO por manifiesto.

- [ ] Test: dos escaneos y un cierre encolados sin red → al reconectar salen en orden y el cierre va último.
- [ ] Test: un 500 no descarta la entrada; un 409 idempotente sí la marca resuelta.
- [ ] **Requisito (2026-09-07, hallazgo de la ronda 3 de review de spec-80
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
- [ ] Al arrancar el drenado (mount y evento `online`), llamar `reclaimStale(db, operatorId, olderThanMs)` antes de `listPending` — recupera reclamaciones huérfanas de una pestaña muerta a mitad de envío (spec-81, ronda 3 de review, H1). `reclaimStale` ya requiere `operatorId` desde fase 1 (ronda 4 de review, M2). **Restricción del contrato:** `olderThanMs` debe superar `timeout_http`; si no, una petición lenta legítima en 2G se reclama antes de completarse y entra en bucle reclaim → resend → resend, generando el duplicado del que protege M1.
- [ ] **`getPendingPickupCount` pasa a ser por operador** (recibe `operatorId`, o se reemplaza por la longitud de `listPending(db, operatorId)`), y sus consumidores (`useSyncQueue`, `SyncChip`, `PickupFlowHeader`, `ReceptionMobileSession`) pasan a requerir `operatorId` — ver "Alcance del contador" en Decisiones de diseño. Sin esto, un operador que cierra sesión en un teléfono de muelle deja un contador huérfano que el siguiente operador no puede drenar ni purgar.
- [ ] **`getPendingPickupCount` cuenta también `sending` y `dead`, no sólo `pending`** (movido aquí desde fase 4 — ronda 5 de review de fase 1, B2). Hoy sólo cuenta `pending`. `useSyncQueue.ts:121` corta el polling cuando `status === 'online' && queuedCount === 0` — con una sola entrada huérfana en `sending` (pestaña muerta a mitad de envío, el escenario que `reclaimStale` existe para cubrir), `queuedCount` cae a 0, el polling se detiene, y la pantalla se congela en «todo subido» hasta un remount, mientras el operario cierra la carga con un conteo falso — el riesgo nº1 declarado del spec. No puede esperar a fase 4: el spec declara que las fases 1–3 van juntas o no va ninguna.
- [ ] El drenador pasa el token que `claimPending` devuelve a `markFailed`/`markSent`/`markDead` como `claimedAt` (implementado en fase 1, ronda 4 y 5 de review, M1/B1 — ver checklist de esa fase) — sin esto la protección existe en el contrato pero ningún llamador la usa.

### Fase 3 — Idempotencia en el servidor `[pending]`

**Archivos:** migración nueva; afecta a `close_manifest` (spec-80 fase 1) y a la escritura de `pickup_scans`

- [ ] Columna `client_operation_id` con índice único parcial por operador.
- [ ] Test pgTAP: la misma operación dos veces deja una fila y no altera conteos. Correr con `scripts/pgtap-local.sh`.

### Fase 4 — Chip de sync `[pending]`

**Archivos:** `components/ConnectionStatusBanner.tsx` → chip; su test e i18n

Redacción del handoff: «se guardan en el dispositivo y se envían solos…». Cuenta pendientes, como pide `5i`.

- [ ] Desmontar el `fixed top-0` sin romper auth ni landing, que hoy también lo montan.

### Fase 5 — Fotos `[pending]`

**Archivos:** `lib/offline/photos.ts`, integración con `ManifestPhotoStrip` (spec-80 fase 3)

- [ ] Blob a IndexedDB en captura; subida al bucket `manifests` al drenar; `manifest_documents` se inserta **después** de que la subida confirme, nunca antes.
- [ ] Test: fila huérfana imposible — si la subida falla, no hay registro apuntando a un objeto inexistente.

---

## Riesgos

- **Una cola a medias es peor que ninguna.** Si `5d` dice «guardado en el dispositivo» y la entrada se pierde, el operario cierra una carga con un conteo falso y el cliente firma sobre esa cifra. Las fases 1–3 van juntas o no va ninguna; sólo la 4 y la 5 son separables.
- **Cuota de IndexedDB.** Varias hojas por carga y varias cargas por ruta llenan el disco del teléfono. Hace falta política de purga de lo ya subido y un tope declarado. **Tope declarado (fase 1, no aplicado todavía):** `purgeConfirmed` borra las entradas `sent` de un operador tras cada drenado exitoso (fase 2 la invoca ahí); el tope duro para entradas `pending`/`failed` sin confirmar se fija en **500 por operador** — a partir de fase 2, encolar por encima de ese número debe rechazarse con un error explícito en vez de fallar en silencio contra la cuota real del navegador. Con blobs de fotos (fase 5) el límite relevante deja de ser el conteo y pasa a ser bytes; esa fase redefine el tope en tamaño, no en número de filas.
- **El alcance puede tentar a crecer** a Recepción y Despacho. Este spec entrega la infraestructura y **sólo** conecta Recogida; adoptarla en otros módulos es trabajo posterior con sus propios specs.
