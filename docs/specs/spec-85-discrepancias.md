# Spec-85: Discrepancias — un registro resoluble de lo que faltó o sobró

> **Related:** [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (**su fase 2 consume esta tabla en vez de decidir un estado de bulto**), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (la merma de «Cierres de hoy» se lee de aquí), [spec-62](spec-62-reception-mobile.md) (recepción móvil, el otro productor), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (recepción consolidada por ruta), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-55](spec-55-carton-expansion.md) (bultos minteados que también pueden faltar)

**Status:** backlog
**Verify:** unit, sql, e2e-qa
**Downstream:** spec-80-recogida-movil-cierre-de-carga.md, spec-83-recogida-escritorio-datos-faltantes.md

_Date: 2026-09-07_

---

## Goal

Una tabla `discrepancies` con ciclo de vida propio: qué bulto faltó o sobró, **en qué operación**, quién lo detectó, y cómo se resolvió.

Hoy no existe nada equivalente. Lo más cercano es `discrepancy_notes` — `(operator_id, manifest_id, package_id, note, created_by_user_id)` — que es **sólo texto**: no tiene tipo, ni operación, ni estado, ni resolución. Cinco filas vivas en QA, así que migrarla es trivial.

## Por qué esto va primero

**Recogida y Recepción tienen el mismo problema y lo van a resolver en paralelo, en sesiones distintas.** Si cada una inventa su propio registro acabamos con dos tablas que responden la misma pregunta y ninguna que sirva de evidencia consolidada.

Esta spec entrega **el contrato compartido**: tabla, enums y RPCs. Luego cada módulo la consume:

| Quién | Cuándo | Qué escribe |
|---|---|---|
| **spec-85** (esta) | primero | tabla, enums, RPCs, migración de `discrepancy_notes` |
| **spec-80 fase 2** | después | al cerrar una carga, una fila por bulto sin verificar y por bulto ajeno |
| **Recepción** (sesión paralela) | después | lo mismo al cerrar una recepción |

**Nadie más toca el esquema de `discrepancies`.** Si al consumirla falta un campo, se pide aquí y se añade aquí — dos migraciones paralelas sobre la misma tabla es exactamente el choque que esta spec existe para evitar.

## Para qué sirve realmente

**Es la evidencia contra una indemnización.** El generador de carga reclama que entregó N bultos; la operación sostiene que recibió N-3. Lo que decide esa conversación es el registro de quién declaró qué, cuándo, y con qué firma detrás — no la memoria de nadie.

Por eso la fila apunta al respaldo firmado: en Recogida, el manifiesto que el local firmó (`manifest_documents`, spec-80 fase 3) es la prueba de que la cifra se aceptó en el momento. Una discrepancia sin ese vínculo vale mucho menos.

Y por eso **se resuelve, no se borra**: en Recepción el bulto puede aparecer físicamente, recibirse, y la discrepancia queda `resolved` con su historia. Si no aparece, pasa a `lost` — y eso es lo que en el futuro dispara el flujo de indemnización.

## Por qué no `exceptions`

`exceptions` ya existe y se le parece: `status` (`open, auto_resolving, auto_resolved, escalated, human_resolved, dismissed`), `resolved_by`, `resolved_at`, `resolution_notes`, y hasta `settlement_id`. Aun así no es el sitio:

- **La granularidad es otra.** `exceptions` cuelga de `order_id`. Una discrepancia es de **un bulto** — una carga puede quedar corta 3 bultos repartidos en 3 órdenes distintas, y el bulto es contra lo que el cliente firma. Mezclar grano de orden y grano de bulto en una tabla es de donde salen los bugs de «cuál id manda».
- **`exception_category_enum` no tiene nada parecido** — `late_delivery, driver_no_show, missing_pod, wrong_address, data_quality, customer_complaint, safety_incident, duplicate_submission, amount_mismatch, other`.
- **El ciclo de vida es distinto.** El de `exceptions` está pensado para agentes (`detected_by_agent`, `auto_resolution_strategy`, `escalated_at`). El de una discrepancia es físico: el bulto aparece o no aparece.

**Sí se referencia, no se duplica.** Cuando una discrepancia pasa a `lost`, el flujo de indemnización futuro cuelga de `exceptions`/`settlements` — que ya tienen esa maquinaria. Esta tabla no reimplementa liquidaciones.

---

## El modelo

### Las dos formas

`5e` las dibuja separadas y **no son simétricas en el esquema**:

- **`missing`** — declarado en el manifiesto y nunca escaneado. Hay `package_id`; no hay código leído.
- **`unexpected`** — escaneado y no pertenece a esta carga/recepción. **No hay `package_id`** — el bulto es ajeno, sólo existe el código de barras leído.

Un `CHECK` obliga a esa asimetría en vez de dejarla a la convención:

```sql
CONSTRAINT discrepancy_shape CHECK (
  (kind = 'missing'    AND package_id IS NOT NULL) OR
  (kind = 'unexpected' AND barcode    IS NOT NULL)
)
```

### Tabla

```sql
CREATE TYPE public.discrepancy_kind_enum      AS ENUM ('missing', 'unexpected');
CREATE TYPE public.discrepancy_operation_enum AS ENUM ('pickup', 'reception');
CREATE TYPE public.discrepancy_status_enum    AS ENUM ('open', 'resolved', 'lost');

CREATE TABLE public.discrepancies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  kind           public.discrepancy_kind_enum      NOT NULL,
  operation_type public.discrepancy_operation_enum NOT NULL,
  status         public.discrepancy_status_enum    NOT NULL DEFAULT 'open',

  package_id     UUID REFERENCES public.packages(id),
  barcode        VARCHAR(100),

  -- Dónde ocurrió. Explícito y anulable por operación, NO polimórfico:
  -- un (source_type, source_id) sin FK real se corrompe en silencio y no se
  -- puede usar en RLS ni en un join.
  manifest_id        UUID REFERENCES public.manifests(id),
  route_reception_id UUID REFERENCES public.route_receptions(id),

  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_user_id UUID REFERENCES public.users(id),
  note                TEXT,

  resolution       TEXT,
  resolved_at      TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES public.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT discrepancy_shape CHECK (
    (kind = 'missing'    AND package_id IS NOT NULL) OR
    (kind = 'unexpected' AND barcode    IS NOT NULL)
  ),
  CONSTRAINT discrepancy_resolved_has_when CHECK (
    (status = 'open') OR (resolved_at IS NOT NULL)
  )
);
```

`operator_id` en la tabla y en la RLS, como toda tabla del repo. Borrado suave.

**Un bulto no puede tener dos discrepancias abiertas en la misma operación** — si no, cerrar dos veces duplica la merma y el cliente firma dos veces sobre lo mismo:

```sql
CREATE UNIQUE INDEX uniq_open_discrepancy_per_package
  ON public.discrepancies (operator_id, package_id, operation_type)
  WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL;
```

### El estado del bulto

**Deliberadamente NO se añade `faltante` a `package_status_enum`.** La discrepancia es la fila autoritativa; duplicar el hecho en el estado del bulto crea dos fuentes que se desincronizan.

Lo que sí puede pasar: cuando una discrepancia se marca `lost`, el bulto pase a `extraviado` (valor que ya existe). Esa transición se decide en la fase 3, con el flujo de indemnización a la vista — no antes.

---

## Fases

| Fase | Qué entrega |
|---|---|
| **1 — Esquema** | tipos, tabla, RLS, constraints, migración de `discrepancy_notes` |
| **2 — RPCs** | `record_discrepancies`, `resolve_discrepancy`, lectura |
| **3 — `lost` e indemnización** | qué pasa con el bulto y con `exceptions` |

### Fase 1 — Esquema `[in_progress]`

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP en `packages/database/supabase/tests/`

- [ ] Test pgTAP primero: aislamiento por operador, el `CHECK` de forma (un `missing` sin `package_id` y un `unexpected` sin `barcode` deben fallar), y el índice único de abiertas.
- [ ] Migración con prefijo de versión único (`scripts/check-migration-versions.sh`).
- [ ] Migrar las 5 filas vivas de `discrepancy_notes` → `discrepancies` con `kind='missing'`, `operation_type='pickup'`, `status='open'`, conservando `note`, `manifest_id`, `package_id` y `created_by_user_id`.
- [ ] **No borrar `discrepancy_notes` todavía.** Queda leída por la pantalla de Revisión hasta que spec-80 fase 2 la sustituya; borrarla ahora rompe Recogida. Se elimina en un contract phase posterior, como spec-56 hizo con spec-52.
- [ ] Correr con `scripts/pgtap-local.sh` — los tests SQL **no** corren en CI, y el contenedor es **compartido entre worktrees**: no correr dos fases SQL en paralelo.

### Fase 2 — RPCs `[pending]`

**Archivos:** migración nueva, test pgTAP

`SECURITY DEFINER`, `operator_id` desde `public.get_operator_id()` y nunca de un argumento del cliente — plantilla: `expand_carton` (`20260814000002`).

- `record_discrepancies(p_operation_type, p_source_id, p_items jsonb)` — idempotente por el índice único de arriba; la llama `close_manifest` (spec-80) y su equivalente de recepción.
- `resolve_discrepancy(p_id, p_status, p_resolution)` — sólo `open → resolved | lost`. Rechaza reabrir: una discrepancia cerrada es evidencia, y editarla después destruye su valor.
- Lectura por operación y por estado, para la pantalla de resolución.

- [ ] Tests pgTAP primero, incluyendo el rechazo cross-tenant y el rechazo de reapertura.
- [ ] Implementar.

### Fase 3 — `lost` e indemnización `[blocked]`

Bloqueada por una decisión del usuario: qué dispara exactamente un `lost` — si el bulto pasa a `extraviado`, si se abre una `exceptions` con `settlement_id`, y quién puede marcarlo.

- [ ] Decidir con el usuario antes de tocar nada.

---

## Riesgos

- **Dos sesiones sobre la misma tabla.** El esquema lo posee esta spec. Un consumidor al que le falte un campo lo pide aquí; dos migraciones paralelas sobre `discrepancies` es el choque que esto evita.
- **Borrar `discrepancy_notes` antes de tiempo** rompe la pantalla de Revisión de Recogida, que todavía la lee.
- **Reabrir una discrepancia** parece cómodo y destruye su valor probatorio. El RPC lo rechaza a propósito.
