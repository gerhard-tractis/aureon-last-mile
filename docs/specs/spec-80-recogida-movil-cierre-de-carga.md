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

`docs/design/Recogida.dc.html` es la copia versionada en el repo de ese mismo archivo, para
agentes sin acceso al proyecto de Claude Design (ver `docs/design/README.md`). El mock manda en
diseño; este spec manda en comportamiento — si discrepan, se implementa el mock y la
discrepancia se escribe aquí, no se resuelve en silencio. Si el mock no contempla algo que el
código necesita (un estado de error, un caso vacío), es un hallazgo para escalar al usuario, no
licencia para inventarlo. Esta referencia caduca con el diseño: al re-bajar el fichero, comprobar
que `5e`–`5i` siguen siendo las mismas pantallas.

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

### Fase 1b — `close_manifest`: ACL heredado sin revocar y dos `RAISE` sin prefijo `[done]`

**Archivos:** `packages/database/supabase/migrations/20260913000004_spec80_close_manifest_acl_fix.sql`, `packages/database/supabase/tests/spec80_close_manifest_acl.test.sql`, `packages/database/supabase/tests/spec80_close_manifest.sql`, `apps/frontend/src/lib/pickup/closeManifestErrors.ts`

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
> humano pueda ejercitar desde la UI. **Cierre (2026-09-08, orquestador):** la
> migración de esta fase está aplicada en producción — confirmado
> `git merge-base --is-ancestor 78d65df8 32667d0d`, el `headSha` del run
> `34265192142` ("Deploy Production"), cuyo job `Verify Production
> Migrations` cerró en verde.
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

### Fase 2 — `5e` cerrar con faltantes `[done]`

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
> pgTAP: `spec80_fase2_close_manifest_discrepancies.test.sql`, 11/11 vía `pgtap-local.sh` (esta
> cifra es de la ronda 1 — ver la nota de la ronda de review de PR #686 más abajo: los fixtures de
> la ronda de review cambiaron el resultado esperado de una aserción vieja, `(1,2,1)` →
> `(1,3,1)`, así que este 11/11 **ya no cubre el fichero actual**; el fichero entero está sin
> verificar, no sólo las aserciones nuevas — pendiente de que alguien con Docker vivo corra
> `pgtap-local.sh sync && apply && run spec80_fase2_close_manifest_discrepancies` y grepee la
> salida cruda de `psql` por `not ok`, no el resumen del script).
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
>   guardada — igual que el mock. **Corrección (ronda de review PR #686, 2026-09-08):** la
>   decisión de dejar `DiscrepancyItem.tsx` sin usar "por si otro spec lo retoma" no se cumplió —
>   `git grep` confirmó que ningún archivo de producción lo importaba, sólo su propio test (6
>   casos). Borrado, junto con `DiscrepancyItem.test.tsx`: 60+ líneas y 6 tests corriendo en cada
>   CI por un componente inalcanzable, sin ningún spec declarándolo como suyo.
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
> y todo `app/app/pickup/route/active/**`, estuvo explícitamente fuera de alcance para esta ronda
> de corrección (instrucción del orquestador, para no pisar el PR #682 mientras seguía en vuelo) —
> no porque spec-82 fase 1 editara el mismo archivo que este spec necesitaría, sino porque la
> familia de componentes donde encajaría la entrada de rescate era la misma familia que #682
> estaba tocando en ese momento, y tocarla desde dos ramas a la vez era exactamente el conflicto
> que la coordinación de esta sesión pidió evitar.
>
> **Actualización:** el PR #682 ya mergeó a `main` (`2026-09-08T17:16:39Z`) — verificado con
> `gh pr view 682 --json state,mergedAt`. El conflicto que motivaba el aplazamiento ya no existe,
> pero esta ronda de corrección sigue sin poder tocar esos archivos (siguen fuera del alcance que
> el orquestador fijó para esta tarea específica). Sigue sin construirse. Queda declarado, con
> dueño: fase 2b de este spec (`spec-80`), ahora sin ningún bloqueo de coordinación — no absorbida
> en spec-82 fase 1, porque el "rescate sin firma" es un flujo de `close_manifest`/discrepancias
> (spec-80/spec-85), no de asignación de ruta (el alcance real de spec-82 fase 1).
>
> **Ronda 3 de review (PR #686, 2026-09-08):** dos bloqueantes más, los dos medidos con sonda
> (no deducidos) — la ronda 2 arregló 2 de los 3 estados y dejó el que le da nombre a la fase sin
> cubrir. `page.tsx` gateaba con `isLoading`, y en TanStack Query v5 `isLoading === isPending &&
> isFetching` — **falso** mientras una query está `paused` por `networkMode:'online'` (el default
> del repo; `Providers.tsx` llama `onlineManager.setOnline(false)` en el evento `offline` del
> navegador, pero nunca sobreescribe `networkMode`). Camino real: la cuadrilla llega desde
> `scan/[loadId]` con `['pickup','scans',manifestId]` ya caliente en caché, la señal cae mientras
> `['pickup','missing',manifestId]` sigue en vuelo → `isLoading`/`isError` de ambos hooks leen
> `false`, `data` queda `undefined`, y el `= []` de la desestructuración lo convertía en
> `missingCount = 0` → CTA dorado único «Continuar a firma» con bultos sin verificar. Arreglo:
> quitar los `= []`, gatear por **ausencia de datos** (`scans === undefined || missingPackages
> === undefined`) en vez de por fase del fetch — cubre `pending`, `paused` y `error sin caché` a
> la vez, con el orden correcto (error primero, porque un error también deja `data` en
> `undefined`). Segundo hallazgo: los dos tests de la ronda 2 ponían AMBOS hooks en el mismo
> estado a la vez, así que no distinguían cuál mitad del `||` hacía el trabajo — reemplazados por
> tests por-hook (uno `undefined`, el otro resuelto) más un test dedicado a la forma exacta del
> estado `paused`. Mutado a mano: quitar `|| missingError` mató 1 test; quitar
> `|| missingPackages === undefined` mató 2 (con un crash aguas abajo en
> `UnverifiedPackagesBlock`, confirmando que `missingPackages` sí llega `undefined` a producción);
> ambos revertidos tras confirmar rojo. Seguimiento declarado, no bloqueante, sin resolver en esta
> ronda: (1) guardar una nota sin red deja «Guardando…» indefinido — `mutateAsync` tampoco
> resuelve/rechaza bajo `networkMode:'online'` pausado, aunque el borrador sí sobrevive (el fallo
> original ya está cerrado); (2) el skeleton de `!manifestId` puede quedar permanente si la
> búsqueda del manifiesto falla por red (sin rama `else`/`catch`, forma preexistente); (3) el
> estado de error no ofrece «Reintentar» ni salida.
>
> Cierre (2026-09-08, orquestador). Rama `feat/spec-80-fase-2-bloqueo-faltantes`,
> SHA `632b505e`, PR #686 (merge `4e59c6cc`, 2026-09-08T19:28:53Z).
> Review: tres rondas adversariales, todas cerradas en la misma rama — ronda 1
> encontró que el arreglo P0 de los CTAs no lo sujetaba ningún test (invertirlos
> dejaba 8/8 en verde); ronda 2 encontró que el bloqueo se evaporaba sin red
> porque TanStack Query **pausa** las queries (`isLoading` false, `data`
> undefined) y el `= []` lo convertía en `missingCount = 0`; ronda 3 (arriba)
> gateó por ausencia de datos — la mutación que quita `|| missingPackages ===
> undefined` produce un crash real aguas abajo (`Cannot read properties of
> undefined (reading 'length')`), prueba de que el bug llegaba al JSX de
> producción.
> QA: `gh pr checks 686` verde (Lint/Type-Check/Test/Build en ambos jobs,
> Vercel deploy). **Hueco declarado, no maquillado:** el `push` a `main` que
> trae este merge (`Deploy Production`, run `34270192606`) falló en el gate
> `E2E against QA` por un test en cuarentena no declarado
> (`despacho-close-dispatch.spec.ts`, Ruta H — ajeno a Recogida) y por eso
> nunca llegó a `Verify Production Migrations`; las dos ejecuciones
> posteriores del pipeline (`439e7f9`, `e23690e`) siguen `waiting` sobre la
> aprobación manual de producción al momento de este cierre. La migración
> `20260916000001` **no** está confirmada como aplicada en producción —
> a diferencia de la fase 1b, aquí no hay un run verde posterior que la
> incluya. Verificado vía pgTAP local (`spec80_fase2_close_manifest_discrepancies.test.sql`,
> 11/11 tras la ronda de review, según el PR) y vía `vitest` (83 archivos /
> 679 tests en `src/lib/pickup src/components/pickup src/app/app/pickup
> src/hooks/pickup`), ambos citados en el PR.
> Downstream: revisado spec-81 (cola offline, en su fase 3/2 en paralelo) —
> sin cambios; esta fase no toca ningún fichero de la cola ni de
> `PickupFlowHeader`. Revisado spec-82 (confirmado sin solape de archivos,
> arriba), spec-83, spec-84, spec-86 — sin cambios de contrato que les
> afecte.
> Seguimiento de prioridad alta, no cerrado aquí: `useDiscrepancies.ts:31-56`
> se traga los errores de red y resuelve con `[]` — el mismo patrón que la
> ronda 3 de review acaba de blindar del lado del gate, pero sin corregir en
> origen. Queda para una fase nueva o para spec-85/86; no se abre número aquí
> por decisión del orquestador — anotado para que no se pierda.

### Fase 2b — entrada de rescate para móvil (Completados sin escritorio) `[pending]`

**Archivos:** `apps/frontend/src/components/pickup/PickupMobileActiveRoute.tsx`, `+ test` (el diseño exacto de dónde vive la entrada está sin decidir — ver el primer punto de abajo; puede sumar un fichero de pantalla hermana no nombrado aquí)

> El PR #682 (spec-82 fase 1) ya mergeó (`2026-09-08T17:16:39Z`) — la única dependencia que
> tenía esta fase ya no bloquea. Toca la misma familia de componentes (`PickupMobileActiveRoute.tsx`
> y lo que importa de `RouteManifestList.tsx`). Ver el "Aplazamiento declarado" de la fase 2,
> arriba, para la razón completa de por qué no se construyó ahí.

Dale a la cuadrilla, en móvil, una forma de llegar a un manifiesto que `trg_route_receptions_status_sync`
ya cerró sin firma (rescate de H1, fase 1) — sin escritorio y sin teclear la URL a mano. En
escritorio esa entrada ya existe (Completados → escanear → revisión → firma); en móvil no hay
pestaña Completados en absoluto.

- [ ] Diseñar dónde vive la entrada: ¿una pestaña/filtro dentro de `PickupMobileActiveRoute.tsx`,
      o una pantalla hermana fuera de la ruta activa? El mock de Recogida no dibuja este estado —
      es un hallazgo a escalar antes de construir, no licencia para inventar el diseño aquí.
- [ ] Tests primero.
- [ ] Cablear a `review/[loadId]` (fase 2, ya construida) como destino final.

### Fase 3 — `5f` firma y fotos `[done]`

> **Corrección (2026-09-08) a la nota de abajo sobre la leyenda offline.**
> El checklist original decía que «Todo queda en el teléfono y se sube al
> recuperar señal» **no se muestra hasta spec-81**, para no prometer una cola
> que no existía. Eso ya no es cierto: **spec-81 fase 2 mergeó** y añadió
> exactamente esa cola sobre esta misma pantalla — clasificación de errores
> (`classifyCloseManifestError`), la rama `idempotent`, la línea estática
> literal del mock, y el disparo de `PICKUP_QUEUE_WAKE_EVENT` tras encolar.
> El revisor de esa fase midió **750 segundos sin señal con la firma
> sobreviviendo y subiendo** — la promesa de la leyenda es verdad hoy, no
> aspiracional. Esta fase **preserva** todo ese comportamiento (no se tocó
> ninguna rama de `handleComplete`); sólo reordena el layout alrededor de él.

**Archivos:** migración `manifest_documents`, `app/app/pickup/complete/[loadId]/page.tsx` (cambio quirúrgico contra `5f` — no una reescritura, ver nota de ronda 2 abajo), `components/pickup/ManifestPhotoStrip.tsx`, `components/pickup/ClientSignatureSection.tsx` y `components/pickup/OperatorSignatureSection.tsx` (extraídos de `page.tsx` en ronda 2, seguimiento de tamaño de archivo)

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

> **Corrección (ronda 2 de review del PR #706) — el `UNIQUE` de arriba es literal
> del spec y está mal para borrado suave.** `UNIQUE(manifest_id, sheet_number)` como
> constraint de tabla sobrevive al `deleted_at`: borrar la hoja 1 de 2 no libera el
> número 1, así que una futura hoja "1" colisiona para siempre contra la fila
> muerta. Implementado en su lugar (y no corregido aquí arriba, para no reescribir
> historia) como **índice único parcial**:
> ```sql
> CREATE UNIQUE INDEX uniq_manifest_documents_manifest_sheet
>   ON public.manifest_documents (manifest_id, sheet_number)
>   WHERE deleted_at IS NULL;
> ```
> Consecuencia en el código: el "siguiente número de hoja" no puede ser
> `documents.length + 1` (con un hueco por borrado, colisiona) — es
> `MAX(sheet_number) + 1` sobre las filas vivas. `ManifestPhotoStrip.tsx` ya lo
> hace así. **Quien copie este patrón (spec-84 fase 3 antes de quedar `[parked]`,
> o cualquier spec futuro) debe copiar el índice parcial, no el `UNIQUE` de
> arriba.**

- [x] Migración + test pgTAP de aislamiento por operador.
- [x] Bloque de fotos arriba, `FIRMA DEL LOCAL` y `TU FIRMA` debajo, CTA
      **«Confirmar y cerrar carga»**. `SignaturePad` se conserva; es lo único de
      spec-19 que el mock mantiene. **Precisión de ronda 2:** no es una
      "reescritura" de `complete/[loadId]/page.tsx` — el diff real es quirúrgico
      (inserción del photo strip, reordenado de dos bloques existentes, un
      renombrado de CTA), lo que el reviewer de ronda 2 verificó línea por línea
      contra `origin/main` para confirmar que la cola offline de spec-81 fase 2
      seguía intacta. "Reescritura" en la primera versión de esta nota
      exageraba el alcance real del cambio.
- [x] ~~La leyenda … no se muestra hasta spec-81~~ — ya la muestra desde spec-81 fase 2 (ver corrección arriba); esta fase la deja donde estaba y sólo la reordena bajo el bloque de fotos.

> Implementado por: implementer — rama `feat/spec-80-fase-3-firma-y-fotos`, PR #706 (mergeado como `2f80d83`).
> `manifest_documents` (migración `20260918000001`, mismo patrón que
> `discrepancy_notes` — `FOR ALL`/`WITH CHECK` sobre `operator_id`, GRANT a
> `authenticated`, REVOKE de `anon` — **client-writable**, no un RPC
> `SECURITY DEFINER` como `discrepancies`/spec-85, porque el móvil sube cada
> foto directamente al capturarla). `useManifestDocuments.ts` (lista +
> mutación de subida, mismo patrón que `useCameraIntake.ts`: sube al bucket
> `manifests` primero, sólo inserta la fila si la subida no falló).
> `ManifestPhotoStrip.tsx` — grid de 3 columnas, tile «hoja N» por foto
> capturada + tile «Agregar» con borde discontinuo, literal del mock.
>
> **Hallazgo declarado, no inventado:** el mock `5f` no dibuja la captura en
> sí — sólo el resultado final (2 hojas ya subidas). La captura real con
> encuadre de cámara y paso de revisión (`5g`/`5h`) es fase 4. Para que esta
> fase entregue un botón "Agregar" funcional sin adelantar ese trabajo, usa
> el mismo patrón ya existente en el repo (`useCameraIntake.ts`/
> `CameraIntake.tsx`): un `<input type="file" accept="image/*"
> capture="environment">` oculto que sube directo, sin paso de revisión
> intermedio. Fase 4 sustituye ese disparo por la hoja de cámara + revisión
> sin tocar `useUploadManifestDocument` (la subida en sí).
>
> `complete/[loadId]/page.tsx`: `<ManifestPhotoStrip>` montado antes de la
> línea de seguridad offline (bloque de fotos arriba, per mock). Las dos
> secciones de firma se reordenaron a FIRMA DEL LOCAL (opcional, con el
> checkbox existente) primero, TU FIRMA (operador, obligatoria) segunda —
> el mock las dibuja en ese orden; el código las tenía al revés (operador
> primero). El CTA cambió de «Completar y generar recibo» a **«Confirmar y
> cerrar carga»**, literal del mock. Ninguna rama de `handleComplete` se
> tocó: la cola offline de spec-81 fase 2 (clasificación de errores, rama
> `idempotent`, `PICKUP_QUEUE_WAKE_EVENT`) queda intacta — se leyó el
> archivo entero antes de tocarlo, como pedía el encargo.
>
> `apps/frontend/src/lib/types.ts`: añadida la entrada `manifest_documents`
> a los tipos generados de Supabase (Row/Insert/Update/Relationships) — sin
> esto `tsc` rechaza `.from('manifest_documents')` porque el nombre de tabla
> no está en la unión de tablas conocidas.
>
> **Ronda 2 de review del PR #706 (2026-09-09) — dos bloqueantes, un mayor, tres
> tests sin cobertura, corregidos todos en la misma rama:**
>
> - **Bloqueante 1 (la leyenda offline mentía sobre fotos):** `ManifestPhotoStrip`
>   se monta en la misma pantalla que promete «Las fotos también» sobreviven sin
>   señal, pero `useUploadManifestDocument` no tenía ninguna ruta offline — si
>   `upload` fallaba, la foto se perdía con un `toast.error(err.message)` en
>   inglés crudo (la misma lección de F3, ronda 2 de PR #679, sobre esta misma
>   pantalla). Corregido: mensaje fijo en español («Esta foto no se guardó.
>   Reintenta con señal.», nunca el texto crudo del error) y un comentario
>   explícito en `page.tsx` y en este spec documentando que la promesa completa
>   depende de `lib/offline/photos.ts` (spec-81 fase 5, `[pending]`) — declarado,
>   no resuelto en silencio ni prometido de más.
> - **Bloqueante 2 (huérfano en el bucket por doble toque):** `isPending` vuelve
>   a `false` en cuanto la mutación resuelve, un round-trip ANTES de que el
>   refetch de `documents` llegue — un segundo toque en esa ventana recalculaba
>   el mismo `sheetNumber`, el `upload` tenía éxito, y el `insert` reventaba con
>   23505, dejando el archivo huérfano para siempre (sin `storage.remove()` en
>   ninguna rama de error). Corregido: `useUploadManifestDocument` borra el
>   objeto recién subido si el `insert` falla; `ManifestPhotoStrip` deshabilita
>   "Agregar" también mientras `isFetching` (no sólo `isPending`).
> - **Mayor 1 (patrón de discrepancy_notes copiado a medias):** faltaban el
>   trigger de auditoría y el `REVOKE DELETE` — sobre una tabla cuyo propio
>   `COMMENT` dice "no se borra físicamente". Verificado con sonda real antes
>   del fix: un `authenticated` normal podía `DELETE` físico y reescribir
>   `storage_path`/`uploaded_by`/`captured_at` sin dejar rastro. Corregido en la
>   MISMA migración (aún no mergeada, no hace falta una nueva): `REVOKE DELETE
>   … FROM authenticated`, trigger `audit_manifest_documents_changes` idéntico
>   al de `discrepancy_notes`, y `WITH CHECK` atando `uploaded_by = auth.uid()`
>   (impersonación de fotógrafo rechazada). De paso, el `UNIQUE` de tabla pasó a
>   índice único parcial `WHERE deleted_at IS NULL` (ver nota arriba).
> - **M2:** TEST 2/3 sólo ejercitaban `WITH CHECK`; con la policy mutada a
>   `USING(true)` (WITH CHECK intacto) seguían en verde mientras un
>   `UPDATE`/`DELETE` en bloque sí tocaba filas ajenas — verificado con sonda
>   real. TEST 6 nuevo: `UPDATE` en bloque (sin `WHERE`) por el operador A debe
>   afectar 0 filas del operador B.
> - **M3:** el reordenado de firmas (uno de los tres ítems del checklist) no
>   tenía ningún test — intercambiar `ClientSignatureSection`/
>   `OperatorSignatureSection` dejaba los 21 tests en verde. Test nuevo:
>   `FIRMA DEL LOCAL` antes que `TU FIRMA` en orden de documento.
> - **M4:** `useManifestDocuments.test.ts` nunca aseveraba sobre
>   `eq.mock.calls` — borrar `.eq('operator_id', ...)` del hook dejaba los 6
>   tests en verde. Test nuevo: `chain.eq` llamado con `'operator_id'` Y con
>   `'manifest_id'`.
> - **Seguimiento:** `page.tsx` (411 líneas) se partió en
>   `ClientSignatureSection.tsx`/`OperatorSignatureSection.tsx` antes de fase 4,
>   no después. `nextSheetNumber` pasó de `documents.length + 1` a
>   `MAX(sheet_number) + 1` (test dedicado con un hueco simulado). El toast de
>   error de `ManifestPhotoStrip` ahora tiene test propio. El botón "Agregar"
>   (no sólo el `<input>` oculto) se verifica deshabilitado cuando falta
>   `manifestId` o mientras se refetchea la lista.
>
> Tests finales: `useManifestDocuments.test.ts` (8, +2: eq scoping, orphan
> cleanup), `ManifestPhotoStrip.test.tsx` (8, +3: MAX(sheet_number), gate por
> isFetching, mensaje de error fijo), `ClientSignatureSection.test.tsx` (4,
> nuevo), `OperatorSignatureSection.test.tsx` (3, nuevo),
> `complete/[loadId]/page.test.tsx` (22, +1: orden FIRMA DEL LOCAL/TU FIRMA) —
> **no es una "reescritura"**: ~6 sustituciones del texto del CTA en asserts ya
> existentes más 2 tests nuevos en la ronda 1, +1 en la ronda 2. pgTAP
> (`spec80_fase3_manifest_documents.test.sql`): 10 tests, +4 en ronda 2 (TEST
> 6 USING, TEST 7 ACL DELETE, TEST 8 DELETE sobre fila propia, TEST 9
> auditoría, TEST 10 impersonación de uploaded_by — son 5 nuevos, TEST 3 ya
> traía dos partes). `tsc --noEmit` y `eslint` limpios sobre todos los
> archivos tocados, incluidos los nuevos.
>
> Mutation-testeado, ronda 2 incluida: (SQL, todo dentro de `\i` + `ROLLBACK`,
> nunca persistido en el contenedor compartido) policy a `USING(true)` mata
> TEST 1 y TEST 6 (WITH CHECK del insert ya no basta, el UPDATE en bloque pasa);
> `GRANT DELETE` de vuelta a `authenticated` mata TEST 7 y TEST 8; quitar el
> trigger de auditoría mata TEST 9; quitar la cláusula `uploaded_by` del `WITH
> CHECK` mata TEST 10; `GRANT SELECT` a `anon` mata TEST 5. (Frontend) revertir
> el CTA mata 8/22; mover `<ManifestPhotoStrip>` tras la línea offline mata el
> test de orden dedicado; intercambiar las dos secciones de firma mata el test
> de orden FIRMA DEL LOCAL/TU FIRMA; quitar `.eq('operator_id', …)` mata el
> test de scoping; revertir `storage.remove()` en la rama de error del insert
> mata el test de huérfano; volver a `documents.length + 1` mata el test de
> hueco por borrado; volver a gatear sólo por `isPending` (sin `isFetching`)
> mata el test de doble toque; volver al `err.message` crudo mata el test del
> mensaje fijo en español.
>
> Review: reviewer — tres rondas sobre PR #706. Ronda 1: dos bloqueantes (la
> leyenda offline prometía supervivencia de fotos que el código no tenía; doble
> toque en "Agregar" dejaba un huérfano garantizado en el bucket + 23505 en el
> insert). Ronda 2: patrón `discrepancy_notes` copiado a medias — faltaba el
> trigger de auditoría, y sin él un `authenticated` normal podía reescribir
> `storage_path`/`uploaded_by`/`captured_at` y borrar físicamente evidencia
> (corregido con `REVOKE DELETE` + trigger + `WITH CHECK` de `uploaded_by`).
> Ronda 3: aprobado ("¿Mergeable? Sí") con tres seguimientos exigidos antes de
> mergear — el test que decía cubrir el `USING` lo ejercitaba sólo por
> accidente (la policy de SELECT tapaba el hueco antes de que el `FOR ALL`
> se evaluara), sustituido por una aserción estructural sobre
> `pg_get_expr(polqual, polrelid)`; y al verificar el `DROP CONSTRAINT` se
> encontró un segundo hueco: `CREATE POLICY ... EXCEPTION WHEN
> duplicate_object` se traga el choque y deja viva la policy vieja. Los tres
> corregidos en la misma rama, detalle completo arriba.
> QA: PR #706 merged 2026-09-09T05:23:35Z — `gh pr checks 706` verde (Lint,
> Type-Check, Test, Build x2; Vercel). Suite completa de frontend: 637
> archivos / 6205 tests, 1 fallo (flake preexistente en
> `useOfflineQueue.test.ts`, no tocado por este PR). pgTAP mutation-testeado
> según el detalle de la nota de implementación arriba. **No se pudo
> verificar el despliegue a producción de la migración `20260918000001`**: el
> run de `Deploy Production` sobre el merge commit quedó parado en el gate
> manual `Approve Production Deploy` (`run 34314908665`, "E2E against QA"
> verde, sin avanzar a `Deploy Supabase Migrations`) — no es un fallo, es una
> aprobación pendiente que no depende de este spec.
> Downstream: revisado spec-81, spec-82, spec-83, spec-86 sin cambios; spec-84
> corregido arriba tras #703 (fase 3 quedó `[parked]`, no depende de este
> patrón) — ver "Impacto downstream de la fase 3" más abajo, también
> actualizada.
>
> **Ronda 3 de review del PR #706 (aprobado: "¿Mergeable? Sí", con tres
> seguimientos exigidos antes de mergear porque el spec instruye copiar esta
> migración como plantilla en f4):**
>
> 1. **TEST 6 no probaba lo que decía.** Postgres aplica siempre las policies de
>    `SELECT` a las filas que un `UPDATE` necesita leer — así que
>    `manifest_documents_tenant_select` tapaba el agujero antes de que el
>    `USING` del `FOR ALL` llegara a evaluarse, y re-aplicar la mutación de
>    ronda 1 (`USING(true)` en el `FOR ALL`, `WITH CHECK` intacto) daba 10/10
>    en verde. Corregido con una aserción ESTRUCTURAL sobre `pg_policy`
>    (`pg_get_expr(polqual, polrelid)` no puede ser `'true'` ni dejar de
>    mencionar `get_operator_id()`) — lee el catálogo, no depende de qué otra
>    policy tape el hueco en runtime. El test de runtime se conservó como
>    TEST 6b, documental, con el crédito puesto donde es real (la policy de
>    SELECT, no el FOR ALL).
> 2. **La propia corrección de índice parcial no tenía test.** TEST 11 nuevo:
>    borrado suave de la hoja 1, reinsertar hoja 1 → debe tener éxito. Revertir
>    a un `UNIQUE` de tabla normal mata este test (verificado por mutación:
>    `duplicate key value violates unique constraint`).
> 3. **La migración no era re-aplicable sobre una base que ya corrió ronda 1.**
>    Dos huecos, no uno — el segundo lo encontró el propio proceso de arreglar
>    el primero: (a) faltaba `DROP CONSTRAINT IF EXISTS
>    manifest_documents_manifest_id_sheet_number_key` antes de crear el índice
>    parcial (`CREATE TABLE IF NOT EXISTS` nunca toca una tabla existente); (b)
>    la policy `manifest_documents_tenant_isolation` seguía en el patrón
>    `CREATE POLICY ... EXCEPTION WHEN duplicate_object THEN NULL`, que es
>    correcto para una policy que nunca cambia pero **no** para ésta — su
>    `WITH CHECK` sí cambió entre ronda 1 y ronda 2 (se le añadió la cláusula
>    de `uploaded_by`), así que sobre una base en la forma de ronda 1 la
>    excepción tragaba el choque de nombre y la policy vieja (sin protección
>    de `uploaded_by`) seguía vigente. **No se dedujo — se verificó**: simulé
>    la forma exacta de ronda 1 en el contenedor pgTAP, forcé esta migración
>    encima con `\i`, y TEST 10 falló de verdad (`operator A inserted a row
>    claiming a different user uploaded it`) antes del fix, y pasó después.
>    Corregido a `DROP POLICY IF EXISTS` + `CREATE POLICY` sin captura de
>    excepción.
>
> Spec: añadido "Riesgo aceptado" en la sección de Riesgos documentando que
> `manifest_documents` es auditada pero no inmutable frente a su propio
> dueño (un `authenticated` con `uploaded_by = auth.uid()` puede seguir
> reescribiendo `storage_path`/`captured_at` de su propia fila) — quien
> copie el patrón en un spec futuro hereda esa misma decisión.
>
> Verificado, los tres arreglos, contra el contenedor pgTAP compartido:
> aplicación limpia desde cero (13 aserciones, 0 error), aplicación forzada
> sobre la forma simulada de ronda 1 (13 aserciones, 0 error, sin el
> `UNIQUE` viejo coexistiendo), y mutación de TEST 6 (`ALTER POLICY ...
> USING (true)` → falla con el mensaje correcto) y TEST 11 (revertir al
> `UNIQUE` de tabla → falla con `duplicate key value violates unique
> constraint`) — las tres corridas dentro de transacciones con `ROLLBACK`,
> nunca persistidas en el contenedor compartido.
>
> **Downstream (2026-09-09, spec-81 fase 5 aterrizó):** el riesgo que esta
> fase dejó declarado — `useUploadManifestDocument` sube directo al bucket
> sin ruta offline, y si `upload` falla el archivo se pierde — queda cerrado
> **a nivel de infraestructura**: `lib/offline/photos.ts`
> (`enqueueManifestPhoto`/`sendManifestPhoto`) da a las fotos la misma cola
> IndexedDB + drenado con reintento que ya tiene `close_manifest`, con el
> mismo contrato de "fila huérfana imposible" que este hook ya cumplía del
> lado online. **No cerrado todavía en esta pantalla:** `ManifestPhotoStrip`
> sigue llamando a `useUploadManifestDocument` directo — spec-81 fase 5 no
> tocó ese fichero a propósito (coordinación explícita con esta fase 4, en
> vuelo en paralelo). «Las fotos también» (`5f`) es verdad para quien
> conecte la captura real a `enqueueManifestPhoto`, pero **no lo es todavía
> en el código que corre hoy** — sigue siendo el mismo hueco declarado aquí
> hasta que esa conexión se haga, en esta fase o en la que toque después
> `ManifestPhotoStrip.tsx`.

### Fase 4 — `5g`/`5h` cámara y revisión `[in_progress]`

**Archivos:** `components/pickup/ManifestCameraSheet.tsx`, `components/pickup/PhotoReviewSheet.tsx`

El mock dice «expo-camera», que es la app Expo dormida (`apps/mobile`, ver `ls apps/`). **Esta implementación es la PWA**, así que la captura va con `getUserMedia` / `<input capture>`, no con expo-camera. Comprobar contra `useCameraIntake.ts`, que ya resuelve captura y subida en este mismo bucket.

`5g`: encuadre a pantalla completa, «Encuadra la hoja completa, con la firma visible», tira de `YA CAPTURADAS`, botón **Listo**.
`5h`: revisión con la pregunta del mock — «¿Se lee la firma? Una foto borrosa no sirve como respaldo» — y **Repetir** / **Usar foto**.

- [x] Tests con `getUserMedia` mockeado.
- [ ] Verificación en dispositivo real: `awaiting_user_test`, la cierra una persona con el teléfono.

> **M4 (accesibilidad, seguimiento no bloqueante, PR #713) — no gatea el cierre de esta fase.** Trampa de foco y manejo de `Escape`/atrás de Android en `5g`/`5h`; `role="dialog"`/`aria-modal` ya están. Ronda 4 de review: vivía como `- [ ]` de esta checklist, lo que bloqueaba `[done]` de fase 4 por un cableado (5g/5h → `ManifestPhotoStrip`) que pertenece a una fase todavía sin número — movido a prosa sin checkbox precisamente para no atarlo a esa dependencia inexistente. Se retoma cuando se cree la fase que hace ese cableado.

**Pendiente aparte del checklist de arriba — con dueño: lo cierra quien cablee `5g`/`5h` a `ManifestPhotoStrip.tsx` (M3, review del PR #712; nota de coordinación: este párrafo vive separado de la lista de checkboxes a propósito, para no chocar con la línea que #713 modifica).** `#713` entrega `5g`/`5h` **sin cablear**: `onUsePhoto` le pasa el `File` capturado al caller, y `ManifestPhotoStrip.tsx` queda intacto, con su `<input>` oculto — a propósito, para que la decisión de subir-o-encolar la tome quien una las dos piezas, no quien construyó la cámara. Esa unión debe llamar a `enqueueManifestPhoto` (`lib/offline/photos.ts`, spec-81 fase 5 — blob a IndexedDB, subida diferida con reintento, huérfano imposible), no a `useUploadManifestDocument` directo (la ruta ONLINE, sin salida sin señal): es lo que hace verdad «Las fotos también» (`5f`) en el código que corre, no sólo en la infraestructura que exista para recibirla.

> **Ronda 2 de review del PR #713 — bloqueante cerrado, más seguimientos.**
> B1 (bloqueante): el obturador estaba habilitado desde el primer render, antes
> de que `getUserMedia` resolviera — un toque durante el diálogo de permiso del
> sistema producía un canvas 1080×1440 sin señal (negro sólido, ~1.5MB, `File`
> "válido") entregado como si fuera el respaldo fotográfico. Corregido: el
> obturador se gatea con `videoReady` (derivado de `loadedmetadata` +
> `videoWidth/videoHeight > 0`), y `handleShutter` rechaza defensivamente
> `videoWidth === 0` en vez de sustituirlo por un tamaño por defecto.
> M2: `PhotoReviewSheet.onUsePhoto`/`photo` se estrechó de `File | Blob` a
> `File` — es lo único que `ManifestCameraSheet` produce, y `File | Blob` no
> compilaba contra `useUploadManifestDocument`.
> M3: el fallback (`<input capture>`) ahora valida tamaño (10MiB) y mime
> contra la lista del bucket `manifests`
> (`20260430000001_create_manifests_storage_bucket.sql`) **en la captura**,
> no al drenar la cola de spec-81 horas después sin nadie para repetir la foto.
> M1 (seguimiento, no bloqueante): `ManifestCameraSheet` acepta `open` para
> quien siga la convención local de Radix (montado siempre); documentado que
> `5g`/`5h` nunca deben montarse/abrirse a la vez.
> M4 (seguimiento, no bloqueante): ambas pantallas llevan `role="dialog"`/
> `aria-modal`, pero siguen sin trampa de foco ni manejo de `Escape`/atrás de
> Android — queda declarado como hueco, no resuelto aquí.
> El icono `Zap` decorativo del header de `5g` (parecía un control sin
> función) se quitó en vez de implementarse.
> Mutation-testing repetido tras los arreglos, incluidos los 5 mutantes que la
> ronda 2 señaló como sobrevivientes (calidad JPEG, `capture`, bytes del
> `File`, mime derivado del blob real, y los nuevos guards de B1/M1/M3) —
> todos mueren contra su test.
>
> **Ronda 3 de review del PR #713 — B2 cerrado (bloqueante), M-A y M-B
> cerrados, menores cerrados.** B1/M3/`capture="environment"` verificados
> vivos por mutación en esta ronda (dos correcciones del reviewer a su
> propia ronda 2, a favor de la implementación: el mutante de `capture`
> **sí** moría, y la lista de MIME de `manifestPhotoValidation.ts` es la
> segunda copia del bucket, no la tercera — `photos.ts` de spec-81 sólo
> tiene el tope de bytes).
> B2 (bloqueante): `open` paraba el stream pero el JSX nunca lo consultaba —
> `open={false}` dejaba un overlay `fixed inset-0 z-50` negro, con
> `aria-modal="true"`, tapando la PWA entera. Arreglado con
> `if (!open) return null` después de todos los hooks.
> M-A: el chequeo de dimensiones no detecta una pista muerta a mitad de
> sesión (un navegador real no pone `videoWidth`/`videoHeight` a 0 cuando la
> pista termina — se queda congelado en el último frame, lo que producía una
> foto PLAUSIBLE pero de la hoja equivocada, no una foto negra obvia).
> Arreglado escuchando `ended`/`mute` en las pistas y `visibilitychange` en
> el documento para devolver `videoReady` a `false`; el chequeo de
> dimensiones queda como defensa en profundidad, no como detector principal.
> M-B: un `file.type` vacío (varios WebViews de Android, para el resultado
> de `capture`) se trataba como formato rechazado sin salida posible.
> Arreglado infiriendo el mime por la extensión antes de rechazar
> (`lib/pickup/manifestPhotoValidation.ts`, extraído de
> `ManifestCameraSheet.tsx` para poder testear la validación sin DOM y
> mantener el componente bajo 300 líneas).
> Menores cerrados: `>`→`>=` en el tope de 10MiB, `accept="image/*"`,
> `setVideoReady(false)` en la limpieza del efecto (el estado de React
> sobrevive a que el JSX devuelva `null`, no es un desmontaje),
> `role="dialog"`/`aria-modal` sin test en ambas pantallas,
> `useEffect(..., [photo]) → []` en `PhotoReviewSheet.tsx`, el solapamiento
> de la leyenda de encuadre con el mensaje de error del fallback (ambos
> `absolute ... bottom-[26px]`, la leyenda vivía fuera del ternario), y el
> JSDoc de `PhotoReviewSheet.tsx` que afirmaba "sin `role=dialog`" tres
> líneas por encima del `role="dialog"` ya añadido en la ronda 2.
> El hueco M4 pasó de prosa suelta dentro de este blockquote a un `- [ ]`
> (ronda 4: movido otra vez, ver más abajo — no tenía fase de destino real).
> Mutation-testing repetido sobre cada guard nuevo de esta ronda (B2, los
> tres detectores de M-A, M-B, y los 6 menores señalados) — verificado uno a
> uno que cada uno muere contra su test; no leído como "no queda ningún
> mutante vivo en el fichero" (la ronda 4 encontró más).
>
> **Ronda 4 de review del PR #713 — el único bloqueante era que los dos
> detectores reversibles no tenían su contrario.** `visibilitychange` sólo
> tenía la rama `hidden`: al volver de segundo plano el obturador quedaba
> deshabilitado para siempre, porque `loadedmetadata` no vuelve a disparar
> (es de una vez por carga). Igual con `mute` sin `unmute` — iOS silencia la
> pista en una interrupción (llamada, bloqueo de pantalla) y la devuelve
> viva con `unmute`; sin el listener, el visor se movía de nuevo pero el
> botón quedaba gris permanentemente. Ambos casos tenían salida hoy (cerrar
> y reabrir), por eso no bloqueaban, pero eran indescubribles.
> Arreglado con `isVideoReady(video, track)` (extraído a
> `lib/pickup/cameraReadiness.ts`, 7 tests propios): deriva de dimensiones +
> `track.readyState === 'live'` + `!track.muted`, y es la misma función que
> usan las tres rutas de habilitación (`loadedmetadata`, `unmute`, `visible`)
> y las tres de deshabilitación (`ended`, `mute`, `hidden`) — ninguna rama
> tiene ida sin vuelta.
> M-B: un fichero con `type` vacío y sin extensión resoluble (algunos
> DocumentsProvider de Android) ya no es un callejón sin salida — se asume
> JPEG, válido porque esta función sólo se llama desde el fallback de
> captura. Documentado y no resuelto (alcanzabilidad baja, sin magic-byte
> sniffing a propósito): un `File` con `type` vacío, nombre de imagen y
> contenido real distinto se reetiqueta igual — Supabase Storage valida el
> Content-Type declarado, no los bytes.
> Menores cerrados: spies sobre `document.addEventListener`/
> `removeEventListener` y sobre `track.removeEventListener` confirmando que
> la limpieza del efecto hace exactamente lo que dice (antes la suite
> quedaba verde sin ellos); `getVideoTracks()` vs `getTracks()` distinguido
> con streams que devuelven tracks distintos por cada método; el eje del
> alto del guard defensivo de `handleShutter` cubierto por separado; el
> título del test de dimensiones del canvas corregido para no afirmar que
> prueba el default `|| 1080` (sigue siendo equivalente-por-diseño: el guard
> de arriba ya lo hace inalcanzable, y eso es correcto, no un hueco).
> El hueco M4 se sacó de la checklist de fase 4 (no debía gatear su cierre
> por una dependencia — el cableado a `ManifestPhotoStrip` — que vive en una
> fase todavía sin número) y quedó como nota sin checkbox más arriba.
> Mutation-testing repetido sobre los cinco arreglos de esta ronda — todos
> mueren contra su test correspondiente.
>
> **Ronda 4 aprobada — mergeable sin condiciones.** Verificado por el
> reviewer: las dos transiciones de vuelta (`mute → unmute`, `hidden →
> visible`) dan `true`; el mutante que delató el bug original muere; y tres
> sondas de falso positivo salen limpias (`visible` tras `ended` no
> rehabilita, `unmute` de la pista del ciclo anterior tampoco, `visible`
> antes de que `getUserMedia` resuelva tampoco). Extraer `isVideoReady`
> como fuente única para habilitar y deshabilitar cerró la clase entera de
> bug, no sólo los dos casos reportados.
>
> **Tres lagunas de cobertura anotadas, no perseguidas — código hoy
> correcto, test que no lo distingue de una versión rota:**
> - `handleTrackUp` puesto a `setVideoReady(true)` a pelo (sin re-derivar)
>   pasa la suite completa: el test de `unmute` sólo cubre el camino feliz
>   (dimensiones ya válidas), no distingue "re-deriva con `isVideoReady`"
>   de "pone `true` sin más".
> - `trackRef.current = null` en la limpieza del efecto no está cubierto —
>   misma laguna: falta el caso "evento disparado por una pista que ya no
>   es la actual" (p.ej. tras un ciclo `open` cerrar/reabrir).
> - `resolveMimeForEmptyType` (`lib/pickup/manifestPhotoValidation.ts`) es
>   más ancha que su JSDoc: `factura.pdf`/`VID_001.mp4` con `type` vacío
>   también se aceptan como `image/jpeg`, no sólo `IMG_0042` sin extensión
>   — un `null` por extensión desconocida es indistinguible de un `null`
>   por no tener extensión. El `type` explícito sigue mandando (alcanzabilidad
>   baja), pero la documentación promete menos de lo que el código hace.
>   Cierre si algún día importa: `?? (tieneExtensión ? null : 'image/jpeg')`.

### Fase 5 — `5i` carga cerrada `[in_progress]`

> **Decisión del usuario (2026-09-09) sobre «Ver resumen de la carga».** El
> mock dibuja ese texto pero no dice a dónde lleva, y no existe ninguna
> pantalla de resumen de carga en el código. El PR #726 lo entregó como
> `<span>` no interactivo — literal del mock — en vez de inventar una ruta.
>
> **Respuesta textual: «podría quererlo sí, pero por ahora anótalo como un
> nice to have, no se evalúa siquiera antes de terminar todos los specs
> abiertos».**
>
> **Consecuencia: nada que hacer, y nada que abrir.** No es una fase, no es un
> `[ ]`, y no bloquea el cierre de nada. Si algún día se evalúa, el punto de
> partida es que **el `<span>` actual es correcto**: un control que parece
> llevar a algún sitio y no lleva es peor que un texto, y así lo midió el
> review del #726.


**Archivos:** `app/app/pickup/complete/[loadId]/page.tsx` (estado post-cierre), o ruta hermana

Resumen del mock: Verificados / Faltantes / Ajenos a la carga / Respaldo «N fotos · N firmas». **Vuelve a `5c`** (`/app/pickup/route/active`), no a `/app/pickup` como hoy, y ofrece «Sigue en PR-…, N cargas pendientes».

El bloque «Guardado en el teléfono — N registros y N fotos esperan señal» es de spec-81; hasta entonces se omite.

> **Ronda 2 de review del PR #726 (2026-09-09) — cuatro correcciones al código, tres notas
> declaradas para quien construya el resto de esta fase o el bloque de spec-81 arriba
> descrito.**
>
> **B1 (cerrado):** las cuatro filas del acta (`ManifestClosedSummary.tsx`) no tenían ni un
> test que las anclara a su propia fila — `getByText('39')`/`getByText('3')`/`getByText('1')`
> son consultas globales; intercambiar los *bindings* de `Faltantes` y `Ajenos a la carga`
> dejaba 8/8 en verde. Corregido con `data-testid` por fila + `within(row)`, y una aserción de
> cifras reales añadida también a nivel de página (una de las tres rutas de cierre).
>
> **B2 (cerrado):** `verifiedCount` contaba filas de `pickup_scans`, no paquetes distintos —
> `close_manifest` usa `COUNT(DISTINCT ps.package_id)` a propósito, porque el único índice
> único de la tabla es sobre `client_operation_id`, no sobre `(manifest_id, package_id)`: dos
> miembros de la cuadrilla del mismo manifiesto, ambos sin señal, escaneando el mismo bulto,
> producen dos filas `verified` para el mismo paquete. Corregido a `new Set(...).size`, la
> misma regla que `useRouteManifests.ts` ya aplicaba.
>
> **B3 (cerrado, quitado en vez de defendido):** una primera versión sí construyó el bloque
> «Guardado en el teléfono» contra la instrucción explícita de arriba, y encima
> `pickupPhotoCount` era **estructuralmente siempre 0** — `enqueueManifestPhoto` (spec-81 fase
> 5) no tiene ningún llamador en producción todavía; `ManifestPhotoStrip`/
> `useManifestDocuments.ts` siguen subiendo directo al bucket. Un cierre offline justo después
> de fotografiar el papel firmado habría mostrado «0 fotos esperan señal» cuando en realidad
> esas fotos ya subieron o se perdieron en la ventana que `complete/[loadId]/page.tsx` ya
> documenta — la pantalla afirmando tranquilidad sobre la evidencia justo donde no la hay.
> Quitado por completo (componente, página, y el soporte que se había añadido en `lib/db.ts`/
> `useSyncQueue.ts` para separar registros de fotos). **Nota para quien lo construya de verdad
> en spec-81:** los contadores que ya existen (`getPendingPickupCount`/`blockedCount`) son por
> operador/dispositivo, no por carga — coherente con el badge global "REQUIERE AYUDA" de esta
> misma pantalla, pero **no** coherente con una tarjeta titulada con un `loadId` concreto:
> cerrar la carga A con 6 escaneos de la carga B todavía en cola mostraría «6 registros esperan
> señal» bajo «Carga cerrada · CARGA-A», atribuyéndole a la carga equivocada un backlog que no
> es suyo. Ese bloque necesita un conteo con ámbito de manifiesto, no el mismo que ya usa
> `sync.blockedCount`.
>
> **B4 (cerrado):** «Ver resumen de la carga» era un `<Button variant="outline">` con
> `onClick` que hacía `scrollIntoView` sobre la propia tarjeta, ya visible y ya en el tope de
> la pantalla — efecto visible cero, indistinguible de un control vivo que no hace nada al
> pulsarlo. El mock (`Recogida.dc.html`) dibuja este elemento como un `<span>`, no como un
> botón, y no define ningún destino. Convertido a un `<span>` no interactivo, literal del mock,
> sin `onClick` ni rol de botón. Ningún destino real existe hoy en el código para ese texto;
> si el usuario quiere una pantalla de resumen real detrás, es una decisión de producto nueva,
> no una que esta fase deba inventar.
>
> **Declarado, no resuelto en esta ronda — `5i` y `5c` usan definiciones distintas de
> "pendiente".** `summarizePendingRouteManifests` (esta fase) filtra por
> `status !== 'completed'`; `/app/pickup/route/active` (`isManifestComplete`,
> `lib/pickup/manifestProgress.ts`) filtra por `verified_count >= total_packages`. Una carga
> ya escaneada pero sin firmar hace que `5i` diga «1 carga pendiente» y, un toque después,
> `5c` diga «Todo verificado» — dos pantallas consecutivas del mismo flujo contradiciéndose
> sobre el mismo dato. No se unifica aquí porque tocaría la definición que usa la pantalla
> activa de ruta (fuera del alcance de esta fase); queda como hallazgo para quien toque
> cualquiera de las dos definiciones a continuación.

> **Seguimiento (2026-09-09, PR corto tras la ronda 2) — tres puntos más, dos en código, uno
> declarado.**
>
> **En código:** `unexpectedCount`, `photosCount` y `signaturesCount` no tenían ninguna
> aserción anclada a nivel de página — sólo `verified`/`missing` la ganaron en la ronda 2 (B1).
> Sustituir los tres por constantes en `page.tsx` dejaba las 24/24 pruebas del archivo en
> verde. Test nuevo con valores todos distintos entre sí (1 ajeno, 3 fotos, 2 firmas —
> firma del cliente incluida, para no confundir el default de 1 firma con una constante).
> Mutado uno por uno: cada constante muere contra su propia aserción.
>
> Además, `verifiedCount` (B2, ronda 2) tenía una divergencia de paridad con el `RPC`: SQL's
> `COUNT(DISTINCT ps.package_id)` descarta los `NULL`; el `Set` de JS de la ronda 2 los cuenta
> como miembro propio. No alcanzable hoy (`pickup_scans` sólo escribe `package_id` sobre un
> match real), pero el propio precedente que ese código cita —`useRouteManifests.ts:139`—
> filtra `!s.package_id` antes de sumarlo, y la versión de la ronda 2 no. Igualado.
>
> **Declarado, no resuelto — la consecuencia de producto de la nota sobre la caché sin
> invalidar (ronda 2, corrección del comentario en `manifestCloseSummary.ts`).** El comentario
> ya no miente, pero no decía la consecuencia real: `useRouteManifests` (`routeManifests`,
> consumida tanto por `summarizePendingRouteManifests` en `5i` como por `/app/pickup/route/
> active`) tiene `staleTime: 10_000`. Nada en `close_manifest` ni en `page.tsx` invalida esa
> query al cerrar. Si el operario pulsa «Volver a mis recogidas» y vuelve a `5c` en menos de
> 10 segundos, esa pantalla puede seguir viendo la carga recién cerrada como si no lo estuviera
> — «Siguiente manifiesto · Verificar» sobre una carga que el mismo operario acaba de firmar.
> Pasados los 10 segundos, el síntoma se cura solo (la próxima lectura de la query ya no está
> "stale" y refleja el estado real). No es un bug de esta fase por sí solo — es el mismo
> `staleTime` que ya gobierna esa pantalla para cualquier otro escritor — pero esta fase es la
> primera que hace plausible volver a `5c` en ese margen (antes se navegaba a `/app/pickup`,
> una pantalla distinta). Candidato de arreglo si algún día importa:
> `queryClient.invalidateQueries(['pickup', 'route-manifests', routeId])` en `onClosed`.

---

## Impacto downstream de la fase 3

Releído cada spec downstream contra lo que **realmente** se mergeó en esta fase, no contra lo planeado:

- **spec-81 (cola offline).** Su fase 5 (`Fotos`, `[pending]`) ya declara explícitamente
  que integrará con `ManifestPhotoStrip` (spec-80 fase 3) y exige "`manifest_documents`
  se inserta **después** de que la subida confirme, nunca antes". Verificado: es
  exactamente lo que `useUploadManifestDocument` hace hoy — `supabase.storage...upload()`
  primero, `throw` si falla, `insert` en `manifest_documents` sólo si la subida tuvo
  éxito. **Sin cambios de contrato de datos** para esa fase futura: puede envolver la
  llamada a `mutateAsync` con la cola de IndexedDB sin que cambie la forma de
  `ManifestPhotoStrip` ni de `useManifestDocuments.ts`.
  **Corrección (ronda 2 de review del PR #706) — esto miraba el contrato de datos y
  omitía la costura de producto.** Mientras spec-81 fase 5 siga `[pending]`, esta
  pantalla **ya** monta `ManifestPhotoStrip` y **ya** produce exactamente el fallo que
  esa fase existe para cerrar: sin señal, una foto que falla al subir se pierde (no
  hay ruta offline para fotos hoy). No es "sin cambios" sin más — es una ventana real
  entre que esta fase aterriza y que spec-81 fase 5 cierra el hueco. Mitigado, no
  cerrado, en esta misma ronda: el error ahora es explícito y en español («Esta foto
  no se guardó. Reintenta con señal.») en vez de perder la foto en silencio con un
  toast en inglés crudo; y tanto `page.tsx` como este spec documentan la ventana en
  vez de callarla. La leyenda «Todo queda en el teléfono…» (fase 2 de spec-81, ya
  `[done]`) tampoco cambió de código: esta fase no tocó ninguna rama de
  `handleComplete`, sólo reordenó JSX alrededor de él — pero su alcance semántico
  ("las fotos también") es ahora una promesa a medias mientras fase 5 siga pendiente.
- **spec-82 (asignación y ruta).** Cero menciones a `manifest_documents`, `5f`, `close_manifest`
  o `ManifestPhotoStrip` en su spec, y superficie de archivos disjunta (confirmado antes
  de empezar con `check-phase-overlap.mjs`, per el encargo). Sin cambios.
- **spec-83 (escritorio, datos faltantes).** Su única mención relacionada es sobre el
  alcance de `close_manifest` fase 1 (qué persiste `record_discrepancies` vs qué
  devuelve el RPC) — esta fase no tocó `close_manifest` en absoluto, sólo el layout de
  `5f` y la tabla `manifest_documents`. Sin cambios.
- **spec-84 (conductor home y prueba de entrega).** Corrección sobre lo que yo mismo
  había escrito aquí en la ronda 1: mi rama sale de `f9110b4`; **PR #703 aterrizó
  después** (`121ab3e`, 2026-09-09) y cambió el terreno. En `origin/main` hoy,
  `spec-84` está **`closed`** — decisión del usuario: *"Con respecto a Reparto,
  déjalo, todo reparto usará la app DispatchTrack por parte del tenant."* Su fase 3
  (la que iba a "reusar el patrón de `manifest_documents`") quedó **`[parked]`**: no
  hay patrón que copiar porque no hay pantalla que construir — la prueba de entrega
  la genera DispatchTrack y llega por webhook, no por una pantalla de esta
  plataforma. **No es culpa de esta fase** (yo no tenía #703 al escribir la ronda 1),
  pero afirmar downstream sin corregirlo lo dejaría leyéndose como instrucción viva
  sobre trabajo que el usuario decidió que nunca se construye. El patrón de
  `manifest_documents` (migración `20260918000001`, mismo patrón que
  `discrepancy_notes`: `FOR ALL`/`WITH CHECK` sobre `operator_id`, GRANT/REVOKE,
  auditoría, client-writable sin RPC) queda documentado aquí igualmente, por si algún
  spec *nombrado* futuro sí necesita copiarlo — pero spec-84 no es ese spec.
- **spec-86 (discrepancias de recepción).** Cero menciones a `manifest_documents`, `5f`
  o `ManifestPhotoStrip`. Su superficie es `complete_route_reception` y lo que cuelgue
  de recepción — ningún archivo tocado por esta fase. Sin cambios.

## Riesgos

- **La fase 0 cambia el flujo bajo los pies de quien esté probando en QA.** Es el objetivo, pero conviene avisar antes de mergear.
- **La fase 2 depende de spec-85.** Se decidió no tocar `package_status_enum`: la discrepancia es una fila resoluble, no un estado. Empezar la fase 2 antes de que exista `record_discrepancies` obliga a inventar un registro provisional que habría que migrar después.
- **`5a`–`5d` se construyeron contra los mocks viejos** (`1l`, `1h`, `1i`, `3j`). Este spec no los revalida; eso es spec-82 y spec-83.
- **Riesgo aceptado, fase 3 (ronda 3 de review del PR #706) — `manifest_documents` no
  es inmutable frente a su propio dueño.** Un `authenticated` con `uploaded_by =
  auth.uid()` en la fila puede seguir reescribiendo `storage_path` y `captured_at` de
  su propia evidencia vía PostgREST (`UPDATE` sigue concedido, per el patrón
  client-writable — no un RPC `SECURITY DEFINER`). Ya no es invisible: el trigger de
  auditoría (Mayor 1) deja rastro de quién lo hizo y cuándo, en `audit_logs`. Pero
  "auditado" no es "impedido" — es lo que separa esta tabla de una tabla verdaderamente
  inmutable como la construiría un RPC. **Aceptado conscientemente**, no un descuido:
  la razón de no usar RPC sigue siendo válida (el móvil sube foto a foto, y un RPC no
  ayuda con la subida al bucket en sí). **Quien copie este patrón en un spec futuro
  hereda esta misma decisión** — si la evidencia necesita ser literalmente inmutable
  (no sólo auditada), ese spec necesita un RPC, no este patrón.

### Fase 6 — cablear `5g`/`5h` a `ManifestPhotoStrip` (que «Las fotos también» sea verdad) `[in_progress]`

**Por qué existe esta fase y no un párrafo suelto (2026-09-09).** Esto llevaba
tres PRs viviendo como «pendiente con dueño» en prosa, fuera de todo checklist
— o sea, sin fase, sin token, y por tanto **invisible para el hook que reparte
trabajo**. Nadie iba a tropezar con ello nunca. Se le preguntó al usuario y
delegó: «haz lo que creas que debas hacer». Le doy número.

**El problema, en una frase: `5f` promete en pantalla «Todo queda en el
teléfono y se sube al recuperar señal. **Las fotos también.**» y eso es falso
hoy en el código que corre.**

Lo que sí es verdad: la infraestructura existe y está mergeada
(`enqueueManifestPhoto`, `lib/offline/photos.ts`, spec-81 fase 5 — blob a
IndexedDB, subida diferida con reintento, renumerado ante colisión, huérfano
imposible). Lo que falta es **que alguien la llame**: `ManifestPhotoStrip.tsx`
sigue usando `useUploadManifestDocument` directo, la ruta online, sin salida
sin señal.

Y `5g`/`5h` (fase 4, mergeada en #713) entregan la captura **sin cablear** a
propósito: `onUsePhoto` devuelve el `File` al llamante para que la decisión de
subir-o-encolar la tomara quien uniera las dos piezas. Esta fase es esa unión.

**Es exactamente la clase de fallo que esta sesión pasó el día cazando:** una
pantalla que promete al operario algo que el código no hace. Aquí es peor que
en otros casos, porque lo que se pierde es la evidencia fotográfica del
traspaso de custodia — el respaldo de una eventual indemnización.

- [x] `ManifestPhotoStrip` llama a `enqueueManifestPhoto`, **no** a
      `useUploadManifestDocument`.
- [x] La captura entra por `5g`/`5h` (`onUsePhoto` entrega un `File`, que **es**
      un `Blob`: encaja sin reconversión).
- [x] `externalLoadId` se pasa al encolar — sin él, el chip de sync (spec-81
      fase 4) no puede decirle al operario **qué carga** abrir cuando una foto
      queda muerta.
- [x] Test que ejercite el camino sin señal de punta a punta: capturar →
      encolar → drenar, sin que la foto se pierda (`photos-capture-flow.test.ts`).
- [x] Verificado: con el cableado hecho, la leyenda de `5f` («Las fotos
      también») ya es verdad — no hizo falta cambiarla.

**Archivos:** `apps/frontend/src/components/pickup/ManifestPhotoStrip.tsx` (+ test),
`apps/frontend/src/app/app/pickup/complete/[loadId]/page.tsx` (montaje de `5g`/`5h`).

**Depende de:** ninguna — spec-81 fase 5 (`enqueueManifestPhoto`) y spec-80
fase 4 (`5g`/`5h`) están **mergeadas**. Se puede tomar hoy.

**Ronda 2 de review del PR #736 (2026-09-10) — decisiones y hallazgos.**

- **Decisión de producto: `toast.success` al encolar una foto, no un
  contador de cola en la tira.** Sin señal, `manifest-photo-count`
  (`documents.length`) sólo cuenta lo que el SERVIDOR ya confirmó — tras
  encolar la primera hoja sigue en "0", sin ningún otro aviso, y un operario
  puede leer eso como "no se guardó" y repetir la foto (filas duplicadas de
  2-4 MB contra el tope de 200 MB, `MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR`).
  Se añadió un `toast.success(...)` en `handleUsePhoto`, mismo precedente
  que `useCloseManifest.ts` (`toast.success` cuando el cierre queda
  encolado, no sólo online). Deliberadamente NO se cuenta la cola local en
  la tira: eso exigiría leer `pickup_queue` desde este componente, con
  riesgo de que ese contador y el del servidor discreparan — el mismo
  problema que costó una ronda de review en spec-81 fase 5. Ningún criterio
  de aceptación de esta fase pedía un indicador — la desviación es de este
  spec, no un hallazgo de código sin resolver.
- **Ronda 3 de review — el texto del toast, y por qué ya no se gatea por
  conectividad.** El pedido inicial (ronda 2, del usuario) fue que el
  mensaje saliera SÓLO sin señal. La implementación no lo hizo, y el
  revisor lo marcó como hallazgo — con razón, según el código: `:95` no
  consultaba `navigator.onLine` ni nada equivalente. Pero el usuario retiró
  su propio pedido al verlo señalado, por una razón que no había pesado al
  pedirlo: desde esta fase, `enqueueManifestPhoto` es la ÚNICA ruta — ya no
  existe la subida online directa que `useUploadManifestDocument` ofrecía.
  El encolado ocurre siempre, con o sin señal, así que "la foto se guardó"
  nunca es falso en ningún camino; lo único que podía mentir era la
  SEGUNDA mitad ("se sube al recuperar señal" — con señal, el drenador la
  sube un segundo después, no "al recuperar" nada). Gatear el texto con
  `navigator.onLine`/`onlineManager` habría sido dos redacciones que
  mantener sincronizadas y una rama más que probar, por una diferencia que
  al operario no le importa. Se cambió el texto a **"Foto guardada. Se sube
  sola."** — cierto en los dos caminos, sin prometer una espera que online
  no existe, y sin negar el encolado que sí ocurre siempre.
- **`loadLabel` cae al `manifestId` (un UUID) cuando `externalLoadId` no se
  pasa** (`ManifestPhotoStrip.tsx`, props de `5g`/`5h`). Es el mismo
  fallback que el PR #725 (spec-81 fase 4) descartó por decisión del
  usuario para el chip de sync. Hoy inalcanzable en producción —
  `complete/[loadId]/page.tsx` siempre pasa `externalLoadId={loadId}` — pero
  el prop sigue siendo opcional en el tipo; si algún día se monta
  `ManifestPhotoStrip` sin él, `5g`/`5h` mostrarían un UUID en vez de
  "CARGA-99814".
  - [ ] Decidir si `loadLabel` debe dejar de tener fallback a `manifestId`
        (mismo criterio que el chip de sync, PR #725) o si es aceptable
        para una pantalla presentacional — hoy inalcanzable, sin llamador
        real que lo dispare.
- **`useUploadManifestDocument` (`hooks/pickup/useManifestDocuments.ts`) es
  código muerto** desde esta fase — sin llamadores de producción, con su
  propia suite de tests que sigue pasando. Borrarlo excedía el alcance
  declarado de esta fase (`**Archivos:**` arriba no lo incluye), pero
  "fuera de alcance" caduca: sin un ítem que lo diga, el próximo que lo lea
  lo toma como una ruta de subida legítima.
  - [ ] Borrar `useUploadManifestDocument` y su test de
        `hooks/pickup/useManifestDocuments.ts`/`.test.ts` — verificar antes
        que sigue sin llamadores (`grep -rn useUploadManifestDocument
        apps/frontend/src`).
- **Un tercer mensaje sin limpiar, mismo defecto que el de M-menor de la
  ronda 2 (prefijo `"recogida offline queue: "` mostrado crudo en un
  `toast.error` del conductor).** `enqueueManifestPhoto` delega en
  `enqueue` (`lib/offline/queue.ts:75`) para el tope de 500 filas sin
  confirmar, y ESE mensaje sigue llevando el prefijo — llega igual de crudo
  al mismo `toast.error` de `ManifestPhotoStrip.tsx`. No se toca en esta
  fase porque `queue.ts` también lo usa desde `useCloseManifest.ts`
  (`close_manifest`), fuera del alcance de esta fase.
  - [ ] Limpiar el prefijo de `queue.ts:75` (o decidir mantenerlo) — afecta
        tanto a `ManifestPhotoStrip` como a la firma del manifiesto.

