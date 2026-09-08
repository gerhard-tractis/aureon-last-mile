# Spec-81: Recogida — cola offline de escaneos, firmas y fotos

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (las pantallas que hacen la promesa que este spec cumple), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`), [spec-54](spec-54-ui-rebrand.md) (fase 2: el chip de sync y `ConnectionStatusBanner`), [spec-62](spec-62-reception-mobile.md) (móvil de andén, mismo problema de conectividad), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (motor de estados de bulto)

**Status:** backlog
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

**No existe ninguna cola.** Búsqueda en `apps/frontend/src` de `outbox`, `offlineQueue`, `useOfflineQueue` y `syncQueue`: cero resultados. Hoy cada escaneo es una escritura sincrónica a Supabase; sin señal, falla y se pierde.

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

### Almacenamiento: IndexedDB, no `localStorage`

Las fotos son blobs de varios MB. `localStorage` es texto y tiene un techo de ~5 MB por origen. IndexedDB almacena blobs nativamente y es lo único que soporta «2 fotos esperan señal».

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

**Archivos:** `apps/frontend/src/lib/offline/queue.ts`, `queue.test.ts`, `apps/frontend/src/lib/offline/db.ts`

Lógica pura y testeable sin navegador: encolar, listar pendientes, marcar enviado, marcar fallido con contador de reintentos, purgar lo confirmado.

- [ ] Tests primero, con IndexedDB falso en memoria. Nada de tocar el DOM.
- [ ] Implementar el almacén.
- [ ] Un `client_operation_id` por entrada, generado al encolar y **nunca** regenerado en el reintento. Test explícito de eso — es el error que hace duplicar.

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
