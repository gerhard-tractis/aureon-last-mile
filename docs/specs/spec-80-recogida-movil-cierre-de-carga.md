# Spec-80: Recogida en móvil — cerrar la carga (5e–5i)

> **Related:** [spec-81](spec-81-recogida-cola-offline.md) (la cola que cumple el «SIN RED» que estas pantallas prometen), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`, lo que precede a este cierre), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (escritorio `5a`), [spec-54](spec-54-ui-rebrand.md) (rebranding; su fase 4.4 cubrió sólo el escritorio de Recogida), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (**introdujo la regresión que este spec cierra**), [spec-19](spec-19-pickup-visual-polish.md) (dueño actual de la pantalla de Firma), [spec-55](spec-55-carton-expansion.md) (bultos generados que cuentan como verificables)

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-81-recogida-cola-offline.md, spec-82-recogida-movil-asignacion-y-ruta.md, spec-83-recogida-escritorio-datos-faltantes.md, spec-84-movil-conductor-home-y-prueba-de-entrega.md

_Date: 2026-09-07_

---

## Goal

Cerrar el flujo de recogida en móvil contra las pantallas `5e`–`5i` del archivo de diseño **Recogida** (Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, archivo `Recogida.dc.html`, turno `R`).

Hoy el flujo no tiene final. La cuadrilla escanea (`5d`, ya implementada contra el mock `1h`), pasa a revisión, y la revisión la devuelve a la ruta. **La firma nunca ocurre.**

## El bug que motiva el spec

`/app/pickup/complete/[loadId]` existe, está construida y es la única pantalla que escribe firmas. **Nada navega hacia ella.** Las únicas referencias a esa ruta en el código son comentarios en otros archivos.

La regresión es de `spec-47` (`3a61572`, PR #349). El flujo era `Revisión → Entrega → Firma`; ese PR introdujo el modelo centrado en ruta, borró la pantalla `handoff` y repuntó la revisión al listado de ruta:

```diff
- router.push(`/app/pickup/handoff/${encodeURIComponent(loadId)}`)
- Continuar a entrega
+ router.push('/app/pickup/route/active')
+ Continuar a ruta
```

`complete/[loadId]` quedó huérfana. `PickupStepBreadcrumb` sigue anunciando `Entrega › Firma` porque es un archivo de spec-19 que nadie actualizó — el operario ve en pantalla dos pasos que no puede alcanzar.

**Verificado en QA el 2026-09-07** sobre `CARGA-PARIS-002`: 28/28 bultos `verificado`, 30 `pickup_scans`, y el manifiesto en `status=in_progress`, `completed_at` NULL, `signature_operator` y `signature_client` NULL. El escaneo funciona; el manifiesto nunca se cierra.

**Corrección a una lectura anterior:** la pantalla de Firma **no** escribe `reception_status`. Escribe `status='completed'`, `completed_at` y las cuatro columnas de firma. `reception_status` lo pone un trigger sobre `pickup_routes` (`trg_pickup_routes_set_manifest_reception_status`, migración `20260625000001`). Saltarse la Firma significa entonces: sin respaldo firmado, y el manifiesto **nunca llega a la pestaña Completados** — no que se quede fuera de En tránsito.

## Fuente de verdad

| Archivo | Qué aporta |
|---|---|
| `Recogida.dc.html`, turno `R`, opciones `5e`–`5i` | Las cinco pantallas de este spec |
| `Aureon Rebrand.dc.html` | Tokens y tipografía (ya implementados, fase 1 de spec-54) |

Las etiquetas de `5b` y `5e` en el propio diseño dicen «el paso que faltaba» y «el bloqueo que faltaba en `5d`». **Este no es un restyle: es la ronda de diseño que documenta los huecos funcionales del rebrand anterior.** Tratarlo como cosmético es repetir el error.

## Las pantallas

| Mock | Pantalla | Estado hoy |
|---|---|---|
| `5e` | Cerrar carga con paquetes sin verificar | ❌ no existe — hoy se cierra sin aviso |
| `5f` | Confirmar recepción: firma del local + tu firma + **fotos del manifiesto firmado** | ⚠️ existe sin fotos. Alcanzable desde la fase 0; sigue siendo la pantalla de spec-19 |
| `5g` | Cámara para el manifiesto firmado | ❌ no existe |
| `5h` | Revisión de la foto antes de guardarla | ❌ no existe |
| `5i` | Carga cerrada, resumen y vuelta a `5c` | ❌ hoy hace `router.push('/app/pickup')` |

## Cambios de flujo de datos

Tres, y ninguno es cosmético.

### 1. Los faltantes se registran al cerrar, a nombre de quien cierra

`5e` es explícito: *«Si cierras ahora, los 3 quedan registrados como faltantes a tu nombre y el cliente firma sobre esa cifra.»*

**`package_status_enum` no tiene `faltante`.** Sus valores son `ingresado, verificado, en_bodega, asignado, en_carga, listo_para_despacho, en_ruta, entregado, retorno_hub, cancelado, devuelto, dañado, extraviado, sectorizado, retenido`.

**Decisión requerida antes de la fase 2** — tres opciones, con lo que cuesta cada una:

- **(a) Dejar el estado en `ingresado` y registrar el faltante sólo en `discrepancy_notes`.** Cero migración. Pero entonces «faltante» no es consultable como estado y los tableros no lo ven; la merma sólo existe como texto libre.
- **(b) Usar `extraviado`.** Ya existe y ya significa «no aparece». Riesgo: hoy lo escribe el flujo de devoluciones, así que un `extraviado` dejaría de identificar unívocamente su origen sin mirar el historial.
- **(c) Añadir `faltante_en_origen` al enum.** Es lo más honesto semánticamente — el bulto nunca entró a la red, que no es lo mismo que perderse dentro de ella. Coste: `ALTER TYPE ... ADD VALUE`, actualizar `EXPECTED_ENUMS` en `seed-qa/lib/enums.ts` (**omitirlo deja inservible el generador entero**, ver spec-51), y revisar cada `CASE` sobre el enum.

**Recomendación: (c).** La distinción origen/red es real y aparece en facturación. Pero es una decisión de producto y va al usuario antes de migrar.

`discrepancy_notes` ya soporta la nota por bulto de `5e` sin cambios: `(operator_id, manifest_id, package_id, note, created_by_user_id)`.

### 2. Fotos del manifiesto firmado — falta dónde apuntarlas

`5f`: *«Fotografía el papel firmado por el local. Es el respaldo si después falta un paquete.»* Varias hojas («hoja 1», «hoja 2», «Agregar»), y `5i` resume «2 fotos · 2 firmas».

**Lo que ya existe:** un bucket privado `manifests` en Supabase Storage, con precedente de subida funcionando — `useCameraIntake.ts` hace `supabase.storage.from('manifests').upload(path, file)` y el agente de intake lee de ahí.

**Lo que falta:** ninguna columna liga una foto a un manifiesto. La única columna de foto del esquema es `assignments.pod_photo_url`, que es prueba de entrega y otra cosa. Se necesita tabla nueva (fase 3).

**Esto es distinto del bloqueo de `1j` en spec-54** («no hay dónde guardar la prueba»). Aquí el almacenamiento existe; falta el vínculo.

### 3. No hay RPC de cierre por manifiesto

Sólo existe `close_pickup_route`, que es de ruta. La pantalla de Firma hace un `.update()` crudo sobre `manifests` desde el cliente. El propio código de spec-54 lo anota: *«A per-manifest "finish this load" RPC would unblock adding it.»*

Cerrar una carga pasa a ser una transacción de cuatro escrituras — estado + firmas, faltantes, notas, y el registro de fotos. Hacerlas por separado desde el cliente deja cierres a medias en cuanto se corta la señal, que es el caso normal de esta pantalla. Va en un RPC (fase 1).

---

## Fases

Cada fase es un PR revisable por separado.

| Fase | Qué entrega | Depende de |
|---|---|---|
| **0 — Reconectar la Firma** | La revisión vuelve a llevar a Firma. Sin diseño nuevo. | — |
| **1 — `close_manifest` RPC** | El cierre pasa a ser atómico y servidor-side | — |
| **2 — `5e` bloqueo por faltantes** | No se cierra a ciegas | 1, decisión del enum |
| **3 — `5f` firma + fotos** | Respaldo fotográfico | 1, 2 |
| **4 — `5g`/`5h` cámara y revisión** | Captura y control de calidad de la foto | 3 |
| **5 — `5i` carga cerrada** | Cierre del proceso, vuelve a `5c` | 3 |

### Fase 0 — Reconectar la Firma (hotfix) `[done]`

> Implementado por: **el orquestador en sesión, no `implementer`** — los tres
> subagentes estaban caídos ese día (ver `scripts/check-harness-present.sh`).
> Rama `feat/spec-80-fase-0-reconectar-firma`, SHA `bfb98e2`, PR #642.
> Review: **no se hizo.** Se lanzó un `reviewer` adversarial y el usuario lo
> detuvo antes de que devolviera hallazgos; el PR se mergeó igual. Queda
> declarado como hueco, no como aprobado.
> QA: PR #642 merged 2026-09-07T19:33:27Z. `e2e-qa` **no leído** para este PR —
> el job venía rojo por tres specs de Despacho ajenas a este cambio.
> Downstream: revisado spec-81, spec-82, spec-83 y spec-84 — **sin cambios**. Esta
> fase sólo repunta una navegación y quita un paso fantasma del breadcrumb; no
> toca ni el esquema, ni un RPC, ni ninguna firma que esos specs asuman.
> **Sí cambió una afirmación de ESTE spec**: `5f` ya no es inalcanzable, y la
> tabla de pantallas de arriba está corregida.


**Se despliega sola y antes que todo lo demás.** Hoy QA no puede completar una carga; esto lo desbloquea sin esperar al rediseño.

**Archivos:** `apps/frontend/src/app/app/pickup/review/[loadId]/page.tsx:176`, `apps/frontend/src/components/pickup/PickupStepBreadcrumb.tsx`

- [ ] Test que falla: `review/[loadId]/page.test.tsx` — el CTA principal navega a `/app/pickup/complete/<loadId>`.
- [ ] Correr y ver el fallo (hoy navega a `/app/pickup/route/active`).
- [ ] Cambiar el `router.push` y la etiqueta a **«Continuar a firma»**.
- [ ] Quitar `handoff` de `PickupStep` y de `STEPS` en `PickupStepBreadcrumb`: la pantalla de Entrega no existe desde spec-47 y anunciarla es mentirle al operario. Ajustar su test.
- [ ] Verificar en QA con `lider@musan.com` sobre una carga escaneada: la firma se guarda y el manifiesto llega a `completed`.
- [ ] Commit + PR.

**No** se toca `complete/[loadId]` en esta fase. Sigue siendo la pantalla de spec-19, sin fotos. Es deuda declarada que la fase 3 sustituye.

### Fase 1 — `close_manifest(p_manifest_id, p_signatures, p_missing, p_notes)` `[pending]`

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

`SECURITY DEFINER`, `operator_id` desde `public.get_operator_id()` y nunca desde un argumento del cliente — el patrón de `expand_carton` (`20260814000002`) es la plantilla.

Hace, en una transacción: fija `status='completed'` y `completed_at`; escribe las cuatro columnas de firma; marca los bultos sin verificar según la decisión del enum; inserta las `discrepancy_notes`; devuelve el resumen que consume `5i`.

Rechaza: manifiesto de otro operador, manifiesto ya `completed`, y firma del operario ausente (`5f` la exige; la del local es opcional — el mock permite cerrar sin ella).

- [ ] Test pgTAP primero, incluyendo el rechazo cross-tenant. Correr con `scripts/pgtap-local.sh` (los tests SQL **no** corren en CI; ver spec-51).
- [ ] Implementar. Migración con prefijo de versión único.
- [ ] Repuntar `complete/[loadId]` al RPC, borrando el `.update()` crudo.
- [ ] Verificar con `--only=musan` reseteado que un cierre completo deja el manifiesto consistente.

### Fase 2 — `5e` cerrar con faltantes `[blocked]`

**Archivos:** `apps/frontend/src/app/app/pickup/review/[loadId]/page.tsx` (sustituye a la pantalla de revisión actual), componente nuevo `components/pickup/UnverifiedPackagesBlock.tsx`

`5e` reemplaza a la pantalla de revisión de spec-47: mismo lugar en el flujo, contenido del mock. Cabecera «Faltan 3 paquetes / 39 de 42 verificados», la advertencia literal del diseño, lista `SIN VERIFICAR` con botón **Nota** por bulto, bloque `NO ESTABAN EN LA CARGA` desde `pickup_scans.scan_result = 'not_found'`, y dos salidas: **Seguir escaneando** y **Cerrar con N faltantes**.

Con 0 faltantes la pantalla no bloquea: pasa directo a `5f`.

- [ ] Tests de la lógica pura de conteo en `lib/pickup/` — verificados, faltantes, ajenos — antes de la UI.
- [ ] Componente + tests, incluyendo el caso 0 faltantes.
- [ ] Cablear al RPC de la fase 1.

### Fase 3 — `5f` firma y fotos `[pending]`

**Archivos:** migración `manifest_documents`, `app/app/pickup/complete/[loadId]/page.tsx` (reescritura contra `5f`), `components/pickup/ManifestPhotoStrip.tsx`

Tabla nueva:

```sql
CREATE TABLE public.manifest_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id   UUID NOT NULL REFERENCES public.manifests(id),
  storage_path  TEXT NOT NULL,
  sheet_number  INT  NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by   UUID REFERENCES public.users(id),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (manifest_id, sheet_number)
);
```

`operator_id` en la tabla y en la RLS, como toda tabla del repo. Borrado suave. Ruta en el bucket `manifests`, prefijada por `operator_id/manifest_id/`.

- [ ] Migración + test pgTAP de aislamiento por operador.
- [ ] Reescritura de la pantalla contra `5f`: bloque de fotos arriba, `FIRMA DEL LOCAL` y `TU FIRMA` debajo, CTA **«Confirmar y cerrar carga»**. `SignaturePad` se conserva; es lo único de spec-19 que el mock mantiene.
- [ ] La leyenda «Todo queda en el teléfono y se sube al recuperar señal» **no se muestra hasta spec-81**. Prometer una cola que no existe es peor que no prometerla.

### Fase 4 — `5g`/`5h` cámara y revisión `[pending]`

**Archivos:** `components/pickup/ManifestCameraSheet.tsx`, `components/pickup/PhotoReviewSheet.tsx`

El mock dice «expo-camera», que es la app Expo dormida (`apps/mobile`, ver `ls apps/`). **Esta implementación es la PWA**, así que la captura va con `getUserMedia` / `<input capture>`, no con expo-camera. Comprobar contra `useCameraIntake.ts`, que ya resuelve captura y subida en este mismo bucket.

`5g`: encuadre a pantalla completa, «Encuadra la hoja completa, con la firma visible», tira de `YA CAPTURADAS`, botón **Listo**.
`5h`: revisión con la pregunta del mock — «¿Se lee la firma? Una foto borrosa no sirve como respaldo» — y **Repetir** / **Usar foto**.

- [ ] Tests con `getUserMedia` mockeado.
- [ ] Verificación en dispositivo real: `awaiting_user_test`, la cierra una persona con el teléfono.

### Fase 5 — `5i` carga cerrada `[pending]`

**Archivos:** `app/app/pickup/complete/[loadId]/page.tsx` (estado post-cierre), o ruta hermana

Resumen del mock: Verificados / Faltantes / Ajenos a la carga / Respaldo «N fotos · N firmas». **Vuelve a `5c`** (`/app/pickup/route/active`), no a `/app/pickup` como hoy, y ofrece «Sigue en PR-…, N cargas pendientes».

El bloque «Guardado en el teléfono — N registros y N fotos esperan señal» es de spec-81; hasta entonces se omite.

---

## Riesgos

- **La fase 0 cambia el flujo bajo los pies de quien esté probando en QA.** Es el objetivo, pero conviene avisar antes de mergear.
- **La decisión del enum bloquea la fase 2.** Si se elige (c), el PR de la migración y el de `EXPECTED_ENUMS` van juntos o el generador de seed queda inservible para todos.
- **`5a`–`5d` se construyeron contra los mocks viejos** (`1l`, `1h`, `1i`, `3j`). Este spec no los revalida; eso es spec-82 y spec-83.
