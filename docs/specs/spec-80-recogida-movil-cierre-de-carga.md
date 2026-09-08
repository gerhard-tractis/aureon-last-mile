# Spec-80: Recogida en móvil — cerrar la carga (5e–5i)

> **Related:** [spec-81](spec-81-recogida-cola-offline.md) (la cola que cumple el «SIN RED» que estas pantallas prometen), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`, lo que precede a este cierre), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (escritorio `5a`), [spec-54](spec-54-ui-rebrand.md) (rebranding; su fase 4.4 cubrió sólo el escritorio de Recogida), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (**introdujo la regresión que este spec cierra**), [spec-19](spec-19-pickup-visual-polish.md) (dueño actual de la pantalla de Firma), [spec-55](spec-55-carton-expansion.md) (bultos generados que cuentan como verificables)

**Status:** in progress
**Verify:** unit, e2e-qa
**Downstream:** spec-81-recogida-cola-offline.md, spec-82-recogida-movil-asignacion-y-ruta.md, spec-83-recogida-escritorio-datos-faltantes.md, spec-84-movil-conductor-home-y-prueba-de-entrega.md, spec-86-discrepancias-de-recepcion.md

> **Nota (2026-09-07).** La decisión de enum que la fase 1 tenía abierta
> (`faltante_en_origen` vs `extraviado` vs sólo `discrepancy_notes`) **ya no se
> toma aquí**: spec-85 crea una tabla única de discrepancias con un campo
> `operation_type` (`discrepancy_operation_enum`) que distingue `pickup` de
> `reception`. Esta fase pasa a escribir en ella con `operation_type =
> 'pickup'` vía el RPC `record_discrepancies` (spec-85 fase 2), y spec-86
> escribe el lado recepción. Motivo: el mismo faltante se registraba en dos
> sitios distintos
> según la etapa que lo detectara. Ver spec-86 para el hueco medido en QA que
> lo motivó.

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

**Decidido (2026-09-07): no es un estado de bulto, es una fila con ciclo de vida.**
Va a la tabla `discrepancies` de [spec-85](spec-85-discrepancias.md), no a un valor
nuevo de `package_status_enum`. Las tres opciones que este spec barajaba —
`discrepancy_notes` a secas, reusar `extraviado`, o añadir `faltante_en_origen` —
quedan descartadas: ninguna permite **resolver** la discrepancia, que es lo que el
negocio necesita. Un bulto que falta en Recepción puede aparecer físicamente y
recibirse; uno que no aparece pasa a `lost` y dispara la indemnización.

Recogida y Recepción producen exactamente la misma discrepancia, así que el
registro es compartido y su esquema lo posee spec-85. **Esta fase lo consume, no
lo define.**

Al cerrar, `close_manifest` llama a `record_discrepancies` con:
- una `missing` por cada bulto declarado y no verificado (con su nota),
- una `unexpected` por cada `pickup_scans.scan_result = 'not_found'`.

`discrepancy_notes` sigue existiendo mientras la pantalla de Revisión la lea;
se retira en un contract phase posterior.

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
| **2 — `5e` bloqueo por faltantes** | No se cierra a ciegas | 1, **spec-85 fase 2** |
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

### Fase 1 — `close_manifest(p_manifest_id, p_signatures)` `[done]`

> Implementado por: `implementer` con TDD. Rama `feat/spec-80-fase-1-close-manifest`,
> SHA final `c4249c8`, PR #657 (merge `20782d2`, 2026-09-08T00:59:41Z).
> Review: `reviewer` adversarial, **tres rondas**. Ronda 1 y 2 devolvieron
> bloqueantes; la 3 aprobó el código y dejó un único bloqueante documental.
> Hallazgos que cambiaron el código: `P0002` → `23505` para «ya firmado»
> (`P0002` es `no_data_found`, PostgREST lo mapea a 404 y el repo ya lo gasta en
> «no existe» en 8 sitios), prefijos centinela en los tres errores que compartían
> `P0001`, y eliminación de una rama muerta (`full_name` es `NOT NULL` sin
> `DROP NOT NULL` posterior). Guardas H1/H4 verificadas por mutación **en las dos
> direcciones**: desactivar cada una mata tests, y endurecerla de más también.
> QA: `qa-e2e` contra la base real de QA, no contra el color del PR.
> `20260913000002` aplicada; `pg_proc.prosrc` byte-idéntico a la migración; las
> cuatro guardas probadas en transacciones con `ROLLBACK` sin tocar Musan (H1 →
> `23505` con centinela, H4 → `P0001`, firma ausente → `P0001`, cross-tenant →
> `42501`); y el chunk servido en `qa.aureon.tractis.ai` contiene el mensaje en
> español, así que no es un bundle rancio. `spec52-pickup-reception-end-to-end`
> pasa. **`e2e-qa` en conjunto sigue rojo** por `despacho-close-dispatch` y
> `despacho-tablet-dock`, ajenas a este cambio — por eso esto está en QA pero
> **no en producción**; lo desbloquea spec-87 fase 1.
> Downstream: revisado spec-81 — **sí cambió**: se le añadió a su fase 2 el
> requisito de distinguir la rama «sin conexión» del rechazo de negocio
> irrecuperable, porque `mapCloseManifestError` da hoy el mismo texto a un
> `TypeError: Failed to fetch` y a un `MANIFEST_NOT_CLOSABLE`, y rehabilita el
> mismo botón para ambos. Revisado spec-82, spec-83 y spec-84 — sin cambios.
> **Deuda abierta sobre esta misma migración**, detectada al revisar spec-85
> fase 2: `close_manifest` sólo hace `GRANT … TO authenticated` sin ningún
> `REVOKE`, así que su ACL real es `PUBLIC` **y** `anon` con `EXECUTE`; y sus dos
> `RAISE` de `42501` (`:53`, `:92`) no llevan prefijo centinela. Necesita su
> propia fase y su propio PR.

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

`SECURITY DEFINER`, `operator_id` desde `public.get_operator_id()` y nunca desde un argumento del cliente — el patrón de `expand_carton` (`20260814000002`) es la plantilla.

Hace, en una transacción: fija `status='completed'` y `completed_at`, escribe las
cuatro columnas de firma, y devuelve el resumen que consume `5i`.

> **Alcance corregido (2026-09-07).** Este párrafo decía «marca los bultos sin
> verificar según la decisión del enum; inserta las `discrepancy_notes`». Las dos
> cosas quedaron obsoletas cuando se decidió que una discrepancia es una **fila
> con ciclo de vida** ([spec-85](spec-85-discrepancias.md)), no un estado de bulto
> ni una nota suelta.
>
> **Los faltantes NO se manejan en esta fase.** Van en la fase 2, que es donde
> vive `5e`, y se registran llamando a `record_discrepancies` (spec-85 fase 2).
> Por eso la firma del RPC pierde `p_missing` y `p_notes`.
>
> El beneficio de partirlo así es real: **la fase 1 deja de depender de spec-85**
> y se puede construir en paralelo. Cerrar un manifiesto sin faltantes es un
> cierre válido y completo por sí solo.

Rechaza: manifiesto de otro operador, manifiesto **ya firmado** (`signature_operator IS NOT NULL` — no `status = 'completed'`: ver la nota de "fix round 1" abajo, que es la que manda), manifiesto `pending` sin trabajar todavía, y firma del operario ausente (`5f` la exige; la del local es opcional — el mock permite cerrar sin ella).

> **Fix round 1 (2026-09-07) — el guard de "ya cerrado" cambió de eje.**
> `trg_route_receptions_status_sync` (`20260812000006`) es un **segundo
> cerrador**: cuando la recepción del hub termina, marca `status='completed'`
> y `completed_at` en todos los manifiestos de la ruta **sin ninguna firma** —
> existe justamente porque durante meses la cuadrilla se saltaba esta
> pantalla. Rechazar por `status='completed'` (como hacía la primera versión
> de esta fase) deja esa firma **inalcanzable para siempre**: es la evidencia
> contra una indemnización, perdida sin vuelta atrás.
>
> El guard real es `signature_operator IS NOT NULL` — eso sigue impidiendo el
> doble cierre (el camino feliz escribe la firma en el mismo `UPDATE`) sin
> bloquear el rescate de un manifiesto que el otro cerrador ya completó sin
> firma. Se añadió además un guard de estado separado
> (`status NOT IN ('in_progress', 'completed')`) para rechazar un manifiesto
> `pending` — el que `remove_manifest_from_route` (`20260824000004`) deja sin
> `started_at`, que nunca se trabajó de verdad.
>
> `signature_operator_name` también dejó de venir de `p_signatures`: se
> deriva server-side desde `public.users` por el actor del JWT — es evidencia
> de transferencia de custodia, y un nombre que controla el cliente no sirve
> como tal.
>
> **Deuda declarada, no resuelta en esta fase:** `manifests` sigue con
> `GRANT UPDATE` a `authenticated` (heredado de `20260310100000`, lo usa
> `openPendingManifest.ts` para transiciones `pending → in_progress` fuera
> del alcance de este RPC). Un conductor autenticado puede seguir escribiendo
> `PATCH /rest/v1/manifests` directamente y saltarse `close_manifest` por
> completo, incluyendo las firmas. El cierre real sería acotar ese grant por
> columna (`GRANT UPDATE (status, started_at, total_orders, total_packages)`)
> una vez `openPendingManifest.ts` sea la única vía de escritura fuera del
> RPC. No se hizo aquí para no tocar ese flujo, fuera de alcance de esta fase.
>
> **Deuda declarada, no resuelta en esta fase (costura preexistente):**
> `close_manifest` no comprueba `pickup_route_crew` ni
> `assigned_to_user_id` — cualquier usuario del operador puede firmar la
> carga de cualquier cuadrilla, no sólo la propia. Es preexistente (el
> `.update()` crudo que este RPC reemplaza permitía exactamente lo mismo,
> sin ningún guard), pero al pasar el cierre a `SECURITY DEFINER` server-side
> esa falta de comprobación se vuelve más creíble como "correcta" de lo que
> era. No se cierra aquí porque no era parte del alcance original de esta
> fase — queda para cuando se defina la relación entre RPC y cuadrilla
> asignada.

> **Fix round 2 (2026-09-07) — tres correcciones más al RPC, un hueco de
> alcance en el spec, y un candidato de columna para más adelante.**
>
> 1. **`ERRCODE` de "ya firmado" corregido de `P0002` a `23505`.** `P0002`
>    es el `no_data_found` estándar de Postgres, y este repo ya lo usa en 8
>    sitios (`20260812000005`, `20260827000003`) para «no encontrado» —
>    PostgREST lo mapea a HTTP 404, no a 409. Un handler que siguiera el
>    patrón del repo (`rpcError.code === 'P0002' && message.startsWith(...)`,
>    como `app/api/dispatch/routes/[id]/blocks/route.ts`) habría leído «ya
>    firmado» como «no existe». El idioma correcto para «esto ya pasó» en
>    este repo es `23505` (`20260820000003`, `20260824000003`), que PostgREST
>    mapea a 409.
> 2. **Prefijos centinela añadidos a los tres mensajes de error**
>    (`MANIFEST_ALREADY_SIGNED`, `MANIFEST_NOT_CLOSABLE`,
>    `OPERATOR_SIGNATURE_REQUIRED`), siguiendo el patrón `ROUTE_NOT_FOUND`/
>    `ROUTE_SEALED` del repo — un consumidor discrimina por
>    `message.startsWith(...)`, no por prosa en inglés. `complete/[loadId]/
>    page.tsx` los mapea a castellano vía
>    `lib/pickup/closeManifestErrors.ts`.
> 3. **`signing user not found` (rama muerta) eliminada.**
>    `get_operator_id()` ya resuelve `v_operator` desde `public.users` por
>    `auth.uid()` con `deleted_at IS NULL`, y `full_name` es `NOT NULL` en el
>    esquema — esa comprobación nunca podía dispararse. `close_manifest`
>    ahora usa `auth.uid()` directamente para el nombre, sin duplicar la
>    fuente vía `auth.jwt()->>'sub'`.
>
> **Corrección a la nota anterior (2026-09-07, ronda 3 de review).** Esa
> nota decía que no había ninguna forma de llegar a `complete/[loadId]` para
> un manifiesto que el hub ya cerró. Es falso en escritorio — verificado
> leyendo la cadena completa, no de oído:
>
> 1. `trg_route_receptions_status_sync` cierra la carga sin firma →
>    `status='completed'`.
> 2. `get_completed_manifests` la devuelve: el único filtro es
>    `m.status = 'completed'` (`20260813000001_spec53_package_labels.sql`),
>    no mira las columnas de firma.
> 3. `PickupDesktopView.tsx` pasa `onOpen={onOpen}` a `ManifestTable` **sin
>    condicionar por `tab`** — sólo `selectedIds`/`onToggle` están gateados a
>    `pending`. El `external_load_id` es un `<button>` en cualquier pestaña,
>    incluida Completados.
> 4. Click → `handleRowOpen` → `openPendingManifest` (no-op porque el
>    status ya no es `pending`) → `router.push('/app/pickup/scan/<loadId>')`
>    de todas formas — la navegación no depende del resultado del no-op.
> 5. Scan → «Continuar a revisión» → sin bultos pendientes de nota
>    `allNotesComplete` es `true` → «Continuar a firma» → `complete/[loadId]`.
>
> Es decir: **alcanzable en escritorio**, vía Completados → escanear →
> revisión → firma. **No alcanzable en móvil** — `PickupMobileView` no
> renderiza la pestaña Completados en absoluto — y móvil es el dispositivo
> de la cuadrilla, que es exactamente el hueco que la fase 2 de este spec
> resuelve. La fase 2 no "construye la entrada de UI" desde cero, como decía
> antes esta nota: en escritorio esa entrada **ya existe** (aunque sin
> ningún indicio visual de que ese manifiesto necesita firma de rescate);
> lo que falta y es trabajo real de fase 2 es la ruta equivalente en móvil.
>
> **Candidato para una fase posterior:** `completed_at` se preserva
> correctamente vía `COALESCE` en el rescate (es "cuándo terminó la carga",
> no "cuándo se firmó" — sobreescribirlo pondría el día de la firma sobre
> una carga recibida el día anterior, rompiendo métricas de duración). Pero
> eso deja el momento real de la firma sin ninguna columna consultable —
> sólo en `updated_at` (sobreescribible por cualquier otro `UPDATE`) y en el
> trigger de auditoría. Justo en el caso de rescate, que es cuando esa fecha
> importa para un reclamo de indemnización, es recuperable pero no
> consultable directamente. Un `signed_at TIMESTAMPTZ` es candidato de una
> fase futura.

- [ ] Test pgTAP primero, incluyendo el rechazo cross-tenant. Correr con `scripts/pgtap-local.sh` (los tests SQL **no** corren en CI; ver spec-51).
- [ ] Implementar. Migración con prefijo de versión único.
- [ ] Repuntar `complete/[loadId]` al RPC, borrando el `.update()` crudo.
- [ ] Verificar con `--only=musan` reseteado que un cierre completo deja el manifiesto consistente.
- [ ] **Plan de QA — el rescate de H1 sí es testeable hoy en `qa.aureon.tractis.ai`,
      por la ruta de escritorio**: cerrar una ruta desde el hub sin pasar por
      Firma (dispara `trg_route_receptions_status_sync`), luego en escritorio ir
      a Completados, abrir el manifiesto, escanear (o confirmar que ya está
      escaneado), Continuar a revisión, Continuar a firma, y verificar que
      `close_manifest` acepta el rescate y escribe la firma. No requiere esperar
      a la fase 2 — esa fase sólo añade el mismo camino en móvil.

### Fase 1b — `close_manifest`: ACL heredado sin revocar y dos `RAISE` sin prefijo `[in_progress]`

> Implementado por: sesión en solitario, TDD manual (test pgTAP escrito y
> corrido en rojo antes de la migración). Rama
> `feat/spec-80-fase-1b-close-manifest-acl`, SHA `f11ea7a`, PR #669
> (merge `78d65df8`, 2026-09-08T09:02:14Z).
> Review: **no se hizo** — no había `reviewer` disponible en esta sesión para
> lanzar una ronda adversarial separada. Queda declarado como hueco, no como
> aprobado.
> QA: `gh pr checks 669` verde (Lint/Type-Check/Test/Build en ambos jobs,
> Vercel deploy). `e2e-qa` no aplica — este spec declara `unit, e2e-qa` como
> jueces, y esta fase es puramente de esquema/RPC sin pantalla nueva que
> tocar; verificado en su lugar con `scripts/pgtap-local.sh` (contenedor
> compartido `spec52-pg`): `spec80_close_manifest_acl.test.sql` 2/2, y los
> 21/21 de `spec80_close_manifest.sql` siguen en verde con los dos mensajes
> reprefijados. Mutation-testeado quitando cada `REVOKE` por separado —
> ambos matan su test correspondiente. No se probó contra la base de QA real
> (a diferencia de la fase 1): el cambio es sólo ACL + prefijo de mensaje
> sobre una función ya viva en QA/producción, sin nueva superficie que un
> humano pueda ejercitar desde la UI.
> Downstream: revisado spec-81, spec-82, spec-83, spec-84, spec-86 — sin
> cambios. Ninguno depende del texto exacto de estos dos mensajes de error
> (ambos seguían cayendo al fallback genérico antes del prefijo, y lo siguen
> haciendo después — ver test nuevo en `closeManifestErrors.test.ts`), ni del
> ACL, que no era parte de ningún contrato que otro spec asumiera.

Hallado por el re-review de spec-85 fase 2, ronda de arreglos 3 (C3), al
comparar el "patrón de `close_manifest`" que esa migración dice seguir contra
lo que `close_manifest` (esta fase, ya mergeado en `main`, PR #657,
`20260913000002_spec80_close_manifest.sql`) realmente hace. Dos huecos, sin
tocar aquí — sólo documentados para que otra fase los tome:

1. **ACL: `PUBLIC` y `anon` conservan `EXECUTE`.** `:229` sólo hace
   `GRANT EXECUTE ON FUNCTION public.close_manifest(UUID, JSONB) TO
   authenticated;` — sin ningún `REVOKE`. La imagen base de Supabase otorga
   `EXECUTE` por defecto a `PUBLIC` **y** a `anon` directamente (no por
   herencia de `PUBLIC`) en toda función nueva — es el mismo hallazgo que
   M-5 de spec-85 fase 2 cerró para `record_discrepancies`/
   `resolve_discrepancy`/`get_discrepancies` (`REVOKE ALL ... FROM PUBLIC` +
   `REVOKE ALL ... FROM anon`, explícito, porque el segundo no se
   desprende del primero). El resultado real hoy es
   `=X/postgres | postgres=X | anon=X | authenticated=X | service_role=X`:
   un llamador sin JWT válido puede invocar `close_manifest` — no hay
   explotación viva porque el guard `NO_OPERATOR_IN_JWT`-equivalente de
   dentro (`:53`) rechaza a cualquier caller sin operador resoluble, pero
   dejar el grant así es la exposición que la convención del repo existe
   para cerrar antes de que se convierta en una.
2. **Dos `RAISE` de `42501` sin prefijo centinela.** `:53`
   (`'no operator in JWT'`) y `:92` (`'manifest not found'`) no llevan el
   prefijo `PREFIJO:` que los otros tres `RAISE` de esta misma función sí
   tienen (`MANIFEST_ALREADY_SIGNED`, `MANIFEST_NOT_CLOSABLE`,
   `OPERATOR_SIGNATURE_REQUIRED`, ver "Fix round 2" arriba). Sin prefijo,
   `message.startsWith('...')` no puede distinguir "sin operador" de
   "manifiesto no encontrado" — exactamente el problema que el contrato de
   errores de spec-85 fase 2 (B-3, tabla en `spec-85-discrepancias.md`)
   documentó y cerró para sus propios RPCs, tomando `close_manifest` como
   plantilla. La plantilla, resulta, sólo cumple el patrón a medias.

**Para quien tome esta fase:** una migración nueva (nunca editar
`20260913000002`), `CREATE OR REPLACE FUNCTION public.close_manifest(...)`
copiando el cuerpo íntegro de la definición vigente en la migración más
reciente que la define (hoy, `20260913000002` — comprobar si algo posterior
la reemplazó antes de usarla como base), con:
- `RAISE EXCEPTION 'NO_OPERATOR_IN_JWT: no operator in JWT' USING ERRCODE = '42501';` en `:53`.
- `RAISE EXCEPTION 'MANIFEST_NOT_FOUND: manifest not found' USING ERRCODE = '42501';` en `:92`.
- `REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM PUBLIC;` y
  `REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM anon;`
  después del `GRANT ... TO authenticated` existente.
- Tests pgTAP nuevos: ACL (mismo patrón que TEST 15/15b de
  `spec85_discrepancies_rpcs.test.sql`, `aclexplode` contra grantee 0 y
  contra el rol `anon`) y prefijo (mismo patrón que TEST 10b/10c — pinear
  `SQLERRM LIKE 'NO_OPERATOR_IN_JWT:%'` / `'MANIFEST_NOT_FOUND:%'`), y
  confirmarlos por mutación, no sólo por lectura.
- Revisar si algún consumidor de frontend (`lib/pickup/closeManifestErrors.ts`)
  ya hace matching sobre el texto viejo sin prefijo — si es así, actualizarlo
  en el mismo cambio.

### Fase 2 — `5e` cerrar con faltantes `[in_progress]`

> **No empezar hasta que [spec-85](spec-85-discrepancias.md) fase 2 esté en `[done]`.**
> Esta fase escribe en `discrepancies` mediante `record_discrepancies`; sin ese RPC
> no hay dónde registrar la merma.

> **Alcance corregido (2026-09-07, ronda 3 de review) — el rescate de H1 en
> móvil, no una entrada de UI que ya existe.** En escritorio, un manifiesto
> que `trg_route_receptions_status_sync` cerró sin firma **ya es alcanzable**
> hoy vía Completados → escanear → revisión → firma (ver la nota de fase 1
> arriba) — nada de eso lo construye esta fase. Lo que falta y sí es trabajo
> de fase 2 es el equivalente en móvil: `PickupMobileView` no renderiza la
> pestaña Completados en absoluto, y móvil es el dispositivo de la
> cuadrilla. Esta fase debe darle a la cuadrilla una forma de llegar a un
> manifiesto de rescate sin escritorio y sin teclear la URL a mano.

**Archivos:** `apps/frontend/src/app/app/pickup/review/[loadId]/page.tsx` (sustituye a la pantalla de revisión actual), componente nuevo `components/pickup/UnverifiedPackagesBlock.tsx`

`5e` reemplaza a la pantalla de revisión de spec-47: mismo lugar en el flujo, contenido del mock. Cabecera «Faltan 3 paquetes / 39 de 42 verificados», la advertencia literal del diseño, lista `SIN VERIFICAR` con botón **Nota** por bulto, bloque `NO ESTABAN EN LA CARGA` desde `pickup_scans.scan_result = 'not_found'`, y dos salidas: **Seguir escaneando** y **Cerrar con N faltantes**.

Con 0 faltantes la pantalla no bloquea: pasa directo a `5f`.

- [x] Tests de la lógica pura de conteo en `lib/pickup/` — verificados, faltantes, ajenos — antes de la UI.
- [x] Componente + tests, incluyendo el caso 0 faltantes.
- [x] Cablear al RPC de la fase 1.

> Implementado por: sesión de agente, rama `feat/spec-80-fase-2-bloqueo-faltantes`.
> `lib/pickup/reviewCloseGate.ts` (conteo puro), `components/pickup/UnverifiedPackagesBlock.tsx`
> (advertencia + `SIN VERIFICAR` + `NO ESTABAN EN LA CARGA`), `components/pickup/MissingPackageRow.tsx`
> (fila por bulto), y `review/[loadId]/page.tsx` reescrito contra `5e`. El "cablear al RPC de la
> fase 1" resultó ser cambio de SQL, no de frontend: `close_manifest` (migración `20260916000001`,
> `CREATE OR REPLACE` sobre la última, `20260913000004`) ahora construye `p_items` desde los
> paquetes declarados-y-no-verificados (con su nota de `discrepancy_notes` si la hay) y los
> barcodes `not_found` deduplicados, y llama a `record_discrepancies('pickup', manifest_id, items)`
> en la MISMA transacción que fija status/firmas. `complete/[loadId]/page.tsx` (5f, fase 3) no se
> tocó. No se tocó ningún fichero de la cola offline (spec-81) ni `PickupFlowHeader`.
> pgTAP: `spec80_fase2_close_manifest_discrepancies.test.sql`, 11/11 vía `pgtap-local.sh`.
>
> **Validado contra el mock real** (`docs/design/Recogida.dc.html`, `5e Cierre con faltantes`)
> después de una primera ronda construida sólo contra la prosa del spec — sin acceso al diseño en
> ese momento. Correcciones de esa auditoría:
> - Los dos CTAs estaban invertidos: `Seguir escaneando` es el primario dorado de 60px a ancho
>   completo (empuja a seguir buscando bultos); `Cerrar con N faltantes` es el secundario, contorno
>   rojo (`status-error`). Estaban al revés en la primera versión, y el test lo fijaba como
>   intencional — corregido, con el test reescrito.
> - «Faltan N paquetes» / «X de Y verificados» viven DENTRO de la tarjeta de alarma roja, junto
>   con la frase literal — no en una cabecera dorada aparte. La cabecera dorada (heredada de
>   spec-19) se quitó de esta pantalla.
> - `SIN VERIFICAR · N` y `NO ESTABAN EN LA CARGA · N` usan separador `·`, no `(N)`.
> - `NO ESTABAN EN LA CARGA` es `status-error` (rojo), con la sublínea `escaneado HH:MM · no
>   pertenece a este manifiesto` — antes usaba `status-warning` (ámbar) sin timestamp.
> - «Faltan 1 paquetes» → «Falta 1 paquete» (concordancia singular). Con 0 faltantes la tarjeta de
>   alarma no se renderiza en absoluto (ya era así), así que nunca sale «Faltan 0 paquetes».
> - El botón **Nota** por bulto es literal: `MissingPackageRow.tsx` reemplaza el textarea
>   siempre-abierto de la primera ronda (reutilizaba `DiscrepancyItem`) por un chip `Nota` de 44px
>   que abre un campo inline, y un chip `CON NOTA` + la nota entrecomillada de sólo lectura una vez
>   guardada — igual que el mock. `DiscrepancyItem.tsx` queda sin usar (comentario añadido; no se
>   borra por si otro spec lo retoma).
>
> **Decisión del usuario (2026-09-08) sobre si la nota es obligatoria:** *"Es opcional, y la
> dejaría editable en el futuro."* El mock ya lo mostraba así (CTA de cierre totalmente opaco con
> bultos sin nota, sin estado deshabilitado en ningún caso) y ni el spec ni el mock pedían lo
> contrario — la obligatoriedad se había inventado en la primera ronda de implementación y luego
> se citaba a sí misma como premisa en el comentario de la migración SQL. Revertido: se quitó
> `allMissingNotesComplete` de `reviewCloseGate.ts` (y sus tests) y el CTA de cierre ya no se
> deshabilita nunca por falta de notas. Los placeholders «(obligatorio)» de `MissingPackageRow.tsx`
> y `DiscrepancyItem.tsx` pasan a «(opcional)». El comentario de la migración `20260916000001` que
> afirmaba la premisa falsa quedó corregido — **no cambió ningún comportamiento SQL**:
> `discrepancies.note` nunca tuvo `NOT NULL`, así que la fila que ese bloque insertaba con
> `note=NULL` antes de la nota corregida es exactamente la misma que inserta ahora.
>
> **Hallazgo (no implementado, sólo declarado, por instrucción explícita del usuario):** hoy no
> existe ningún camino para EDITAR la nota de una discrepancia ya registrada. Verificado leyendo
> `20260913000001` (esquema: `discrepancies.note`, sin trigger de escritura) y `20260913000003`
> (`record_discrepancies` sólo INSERTa; `resolve_discrepancy` hace `UPDATE ... SET status,
> resolution, resolved_at, resolved_by_user_id` — nunca toca `note`). Ningún otro archivo tiene un
> `UPDATE` sobre `discrepancies.note`. Consecuencia sobre lo que ya se puede crear hoy en
> producción: ninguna — la nota opcional en captura no rompe ni migra nada existente, sólo permite
> que una fila `missing` nueva se inserte con `note=NULL` cuando antes (con la puerta indebida)
> nunca habría llegado a insertarse sin nota. Este spec **no** decide dónde vive la edición futura
> — candidatos razonables son spec-86 fase 3 (panel de resolución de discrepancias) o una fase
> nueva de spec-85; la decisión de cuál es del orquestador, no de esta fase.
>
> **Aplazamiento declarado — nota "Alcance corregido" (2026-09-07, ronda 3), corregido en la
> ronda de review de PR #686 (2026-09-08):** esa nota pide que la cuadrilla gane una forma de
> llegar a un manifiesto de rescate (uno que `trg_route_receptions_status_sync` completó sin
> firma) sin escritorio y sin teclear la URL — una pestaña Completados en móvil. **No se
> construyó en esta fase.**
>
> La razón que se había escrito antes aquí — "`PickupMobileView.tsx` es, por lo visto en los
> tests existentes, el mismo fichero que spec-82 fase 1 está editando en paralelo" — era
> **falsa**, y se afirmaba sin comprobarla (`gh pr view` la habría descartado en un comando).
> Verificado ahora: el PR #682 (spec-82 fase 1) toca `app/app/pickup/route/active/page.{tsx,test.tsx}`,
> `CloseRouteButton`, `DigitalizeManifestTrigger`, `NextManifestCard`, `RouteManifestList` y dos
> specs — **no** `PickupMobileView.tsx`. `git log -- PickupMobileView.tsx` da `e0eaf97` (spec-61)
> como último commit; nada de spec-82 lo toca.
>
> La razón real: `PickupMobileView.tsx` en sí mismo está libre, pero una pestaña Completados no
> vive ahí sola — la pantalla que de verdad tendría que crecer es `PickupMobileActiveRoute.tsx`
> (o un hermano suyo), que ya importa `RouteManifestRow` de `./RouteManifestList` (`:15`). Ese
> fichero, junto con `CloseRouteButton.tsx`, `DigitalizeManifestTrigger.tsx`, `NextManifestCard.tsx`
> y todo `app/app/pickup/route/active/**`, está explícitamente fuera de alcance para esta ronda de
> corrección (instrucción del orquestador, para no pisar el PR #682 en vuelo) — no porque
> spec-82 fase 1 edite el mismo archivo que este spec necesitaría, sino porque la familia de
> componentes donde encajaría la entrada de rescate es la misma familia que #682 está tocando
> ahora mismo, y tocarla desde dos ramas a la vez es exactamente el conflicto que la coordinación
> de esta sesión pidió evitar.
>
> Sigue sin construirse. Queda declarado, con dueño: se retoma después de que #682 mergee, como
> fase 2b de este spec (`spec-80`) — no absorbida en spec-82 fase 1, porque el "rescate sin firma"
> es un flujo de `close_manifest`/discrepancias (spec-80/spec-85), no de asignación de ruta
> (el alcance real de spec-82 fase 1).
>
> Review y QA pendientes — no se marca `[done]` aquí.

### Fase 2b — entrada de rescate para móvil (Completados sin escritorio) `[pending]`

> Depende de que el PR #682 (spec-82 fase 1) mergee primero — toca la misma familia de
> componentes (`PickupMobileActiveRoute.tsx` y lo que importa de `RouteManifestList.tsx`).
> Ver el "Aplazamiento declarado" de la fase 2, arriba, para la razón completa de por qué no se
> construyó ahí.

Dale a la cuadrilla, en móvil, una forma de llegar a un manifiesto que `trg_route_receptions_status_sync`
ya cerró sin firma (rescate de H1, fase 1) — sin escritorio y sin teclear la URL a mano. En
escritorio esa entrada ya existe (Completados → escanear → revisión → firma); en móvil no hay
pestaña Completados en absoluto.

- [ ] Diseñar dónde vive la entrada: ¿una pestaña/filtro dentro de `PickupMobileActiveRoute.tsx`,
      o una pantalla hermana fuera de la ruta activa? El mock de Recogida no dibuja este estado —
      es un hallazgo a escalar antes de construir, no licencia para inventar el diseño aquí.
- [ ] Tests primero.
- [ ] Cablear a `review/[loadId]` (fase 2, ya construida) como destino final.

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
- **La fase 2 depende de spec-85.** Se decidió no tocar `package_status_enum`: la discrepancia es una fila resoluble, no un estado. Empezar la fase 2 antes de que exista `record_discrepancies` obliga a inventar un registro provisional que habría que migrar después.
- **`5a`–`5d` se construyeron contra los mocks viejos** (`1l`, `1h`, `1i`, `3j`). Este spec no los revalida; eso es spec-82 y spec-83.
