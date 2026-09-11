-- =============================================================================
-- spec-94 fase 1 — Recogida: cuatro estados, y manda la ruta cuando hay una
-- =============================================================================
-- Contexto (ver docs/specs/spec-94-recogida-cuatro-estados.md): un manifiesto
-- enganchado a una ruta de recogida pero todavía sin llegar al hub no lo
-- devuelve ninguna de las tres RPC vigentes (`get_pending_manifests`,
-- `get_in_transit_manifests`, `get_completed_manifests`): desaparece de toda
-- la pantalla de escritorio.
--
-- Esta migración re-templa las CUATRO funciones a la vez (`get_routed_
-- manifests` es nueva). Ronda 3 de este spec: la primera versión particionaba
-- sobre `manifests.reception_status`, y resultó estar mal -- ver la sección
-- siguiente.
--
-- EL MODELO (ronda 3, "manda la ruta"): cuando hay una ruta VIVA
-- (`pickup_routes` referenciada por `pickup_route_id`, `deleted_at IS NULL`),
-- la columna que sabe dónde están los bultos es `pickup_routes.status`, NO
-- `manifests.reception_status`. Verificado contra `pg_proc` en QA:
-- `trg_manifest_reception_status` (`20260318000001:295-319`, BEFORE UPDATE,
-- vivo desde spec-08, nunca redefinido) rellena
-- `reception_status='awaiting_reception'` en TODA transición hacia
-- `status='completed'` cuando la columna viene NULL -- sin mirar
-- `pickup_route_id` ni la ruta. Por eso `awaiting_reception` NO distingue
-- "cerrada en el andén, camión parado" de "el camión salió de verdad": las
-- dos lo escriben. Sólo `pickup_routes.status` lo sabe.
--
--   1. Por retirar        sin ruta viva, reception_status IS NULL,
--                          status <> 'completed'         (+ status <> 'cancelled')
--   2. En punto de retiro  ruta viva, pr.status NOT IN ('in_transit','received')
--                          (+ status <> 'cancelled')
--   3. Camino a bodega     ruta viva y pr.status = 'in_transit', O
--                          sin ruta viva y reception_status IN
--                          ('awaiting_reception','reception_in_progress')
--                          (+ status <> 'cancelled')
--   4. En bodega           ruta viva y pr.status = 'received', O
--                          sin ruta viva y (reception_status = 'received' O
--                          (status='completed' AND reception_status IS NULL))
--                          (+ status <> 'cancelled')
--
-- `pr.status NOT IN (...)`, no una lista positiva: el cubo 2 es el
-- complemento, así que un valor nuevo de `pickup_route_status_enum` aterriza
-- ahí en vez de caerse del modelo (el mismo bug que este spec cierra).
--
-- Una ruta soft-deleted ya no esconde nada: no es "ruta viva", así que el
-- manifiesto cae por sus propias columnas (reception_status/status) en el
-- cubo 1, 3 o 4 -- lo resuelve el modelo, no una cláusula del JOIN.
--
-- 'cancelled' no tiene pestaña (ver spec, sección "'cancelled': quién lo
-- escribe"): los cuatro predicados lo excluyen explícitamente.
--
-- TEMPLATES -- CLAUDE.md exige partir de la ÚLTIMA definición viva de cada
-- función, verificado con
-- `git log --oneline -- packages/database/supabase/migrations/ | head -40`
-- y `grep -l <func> *.sql` el 2026-09-10:
--   get_pending_manifests    <- 20261003000001 (spec-83 fase 2: pickup_window_*)
--   get_in_transit_manifests <- 20260813000001 (spec-53: labels_printed_*)
--   get_completed_manifests  <- 20261004000001 (spec-80 fase 2b: signature_operator,
--                                                encima de spec-83 fase 1's missing_count)
--   get_routed_manifests     <- nueva, no existía
-- Partir de cualquier otra definición borraría en silencio labels_printed_*
-- (spec-53), missing_count (spec-83 fase 1) o signature_operator (spec-80
-- fase 2b).
--
-- RUTA VIVA, en las cuatro funciones: `LEFT JOIN public.pickup_routes pr ON
-- pr.id = m.pickup_route_id AND pr.deleted_at IS NULL`, con la condición de
-- soft-delete en el ON, NUNCA en el WHERE. En el WHERE convierte el LEFT JOIN
-- en un INNER de hecho: una ruta soft-deleted no vacía
-- manifests.pickup_route_id, así que ese manifiesto se caería de la RPC que
-- lo busca por tener ruta Y de las que lo buscan por no tenerla -- invisible,
-- exactamente como CARGA-PARIS-001. En el ON, `pr.id` sale NULL, "ruta viva"
-- es falso, y el manifiesto cae por sus propias columnas.
--
-- POSICIÓN DE `status <> 'cancelled'`: en las tres que parten de `manifests`
-- va en el WHERE. En `get_pending_manifests` va DENTRO de la subconsulta
-- NOT IN, NUNCA en el WHERE que compara contra el LEFT JOIN a manifests: ahí
-- `m.status <> 'cancelled'` evaluaría a NULL cuando no hay fila de
-- manifiesto todavía, y NULL no es TRUE -- borraría de "Por retirar" toda
-- carga que aún no tiene fila en manifests.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. get_routed_manifests -- nueva. Cubo 2: "En punto de retiro".
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_routed_manifests();

CREATE OR REPLACE FUNCTION public.get_routed_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  route_code             TEXT,
  route_started_at       TIMESTAMPTZ,
  driver_name            TEXT,
  route_status           TEXT,
  closed_at              TIMESTAMPTZ,
  missing_count          INT,
  verified_count         BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.created_at,
    m.pickup_location AS pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name,
    pr.code AS route_code,
    pr.started_at AS route_started_at,
    drv.full_name AS driver_name,
    pr.status::TEXT AS route_status,
    CASE WHEN m.status = 'completed' THEN m.completed_at ELSE NULL END AS closed_at,
    -- Misma subconsulta que spec-83 fase 1 puso en get_completed_manifests
    -- (COUNT(DISTINCT package_id), no un conteo plano -- ver esa migración
    -- para el porqué de DISTINCT). No es simetría decorativa: sin esto se
    -- apaga la única superficie donde missing_count se pinta para una carga
    -- cerrada en el andén con la ruta todavía in_progress.
    COALESCE((
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to public.get_operator_id(), so a cross-operator d row could
         -- only reach here via a manifest that isn't this operator's in the
         -- first place — which the outer clause already excludes. No
         -- fixture kills this line alone; it stays for the same reason the
         -- rest of this repo re-checks tenant scope on every join.
         AND d.operator_id = m.operator_id
         -- Redundant by discrepancy_source_matches_operation (20260913000001):
         -- that CHECK forces operation_type='reception' rows to have
         -- manifest_id IS NULL, so d.manifest_id = m.id above already
         -- implies operation_type='pickup'. Kept for readability, not as a
         -- second guard — do not go looking for a fixture that kills this
         -- clause alone.
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count,
    -- Guarda 7 de remove_manifest_from_route (20260824000004) rechaza
    -- cualquier manifiesto con un escaneo verified. package_id IS NOT NULL
    -- es lo que hace que este número signifique EXACTAMENTE lo que esa
    -- guarda mira -- 'not_found' siempre tiene package_id NULL, pero no vale
    -- apoyarse en eso quedando implícito.
    COALESCE((
      SELECT COUNT(*)
        FROM public.pickup_scans ps
       WHERE ps.manifest_id = m.id
         AND ps.scan_result = 'verified'
         AND ps.package_id IS NOT NULL
         AND ps.deleted_at IS NULL
    ), 0)::BIGINT AS verified_count
  FROM public.manifests m
  LEFT JOIN public.users u ON u.id = m.labels_printed_by
  LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
  LEFT JOIN public.users drv ON drv.id = pr.driver_id
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.status <> 'cancelled'
    AND pr.id IS NOT NULL                              -- ruta viva
    AND pr.status NOT IN ('in_transit','received')
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_routed_manifests() IS 'spec-94 fase 1 (ronda 3, "manda la ruta"). Cubo 2 ("En punto de retiro"): ruta viva (pickup_routes.deleted_at IS NULL) con pr.status NOT IN (in_transit, received) -- NOT IN, no una lista positiva, para que un valor nuevo del enum aterrice aquí y no se caiga del modelo. Incluye cargas ya cerradas en el andén con el camión todavía parado (status=''completed'', closed_at poblado, ruta in_progress) -- esa mezcla es coste aceptado a propósito, ver spec-94. LEFT JOIN a pickup_routes con deleted_at en el ON: una ruta soft-deleted no debe hacer desaparecer el manifiesto, cae por sus propias columnas en otro cubo. missing_count y verified_count replican exactamente las subconsultas de get_completed_manifests (spec-83 fase 1) y la guarda 7 de remove_manifest_from_route (spec-64) respectivamente.';

-- Patrón de 20260925000001:229-231 / 20261005000001:138-140. Sus tres
-- hermanas (get_pending_manifests/get_in_transit_manifests/get_completed_
-- manifests) nunca tuvieron este bloque -- 20261003000001 documenta por qué
-- eso es seguro igual (SECURITY INVOKER + RLS es el backstop real, no el
-- GRANT) -- pero get_routed_manifests es nueva, sin estado previo que
-- preservar, así que sigue el patrón más explícito en vez de heredar la
-- ausencia por inercia.
REVOKE ALL ON FUNCTION public.get_routed_manifests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_routed_manifests() TO authenticated;
REVOKE ALL ON FUNCTION public.get_routed_manifests() FROM anon;

-- =============================================================================
-- 2. get_pending_manifests -- cubo 1 ("Por retirar") + el brazo UNION ALL
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_pending_manifests();

CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  order_count            BIGINT,
  package_count          BIGINT,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  verified_count         BIGINT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  pickup_window_start    TEXT,
  pickup_window_end      TEXT,
  pickup_cutoff_time     TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH pending AS (
    SELECT
      o.external_load_id,
      o.retailer_name,
      COUNT(DISTINCT o.id) AS order_count,
      COUNT(p.id) AS package_count,
      MIN(o.created_at) AS load_created_at,
      MIN(pp.name)::TEXT AS pickup_point,
      MIN(pp.pickup_locations->0->'operating_hours'->>'start')::TEXT AS pickup_window_start,
      MIN(pp.pickup_locations->0->'operating_hours'->>'end')::TEXT AS pickup_window_end,
      MIN(pp.sla_config->>'pickup_cutoff_time')::TEXT AS pickup_cutoff_time
    FROM orders o
    LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
    LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
    WHERE o.operator_id = public.get_operator_id()
      AND o.external_load_id IS NOT NULL
      AND o.deleted_at IS NULL
      AND o.external_load_id NOT IN (
        -- spec-94 (ronda 3): "ruta viva" via LEFT JOIN, no
        -- m.pickup_route_id IS NOT NULL -- un manifiesto cuya ruta está
        -- soft-deleted YA NO cuenta como "tiene ruta" para excluirlo de
        -- Pendientes; si además reception_status es NULL y no está
        -- completed/cancelled, pertenece al cubo 1.
        SELECT m.external_load_id FROM manifests m
        LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
        WHERE m.operator_id = public.get_operator_id()
          AND m.deleted_at IS NULL
          AND (m.status = 'completed'
               -- spec-94: 'cancelled' va aquí, dentro del NOT IN, nunca en
               -- el WHERE de más abajo que compara contra el LEFT JOIN --
               -- ver la nota de cabecera de este archivo.
               OR m.status = 'cancelled'
               OR m.reception_status IS NOT NULL
               OR pr.id IS NOT NULL)                   -- ruta viva
      )
    GROUP BY o.external_load_id, o.retailer_name
  ),
  with_manifest AS (
    SELECT
      pe.*,
      m.id AS manifest_id,
      m.labels_printed_at,
      u.full_name AS labels_printed_by_name,
      -- Count verified scans on the manifest row matching this load (if it
      -- exists yet — pending loads may not have a manifest row until the
      -- operator opens the scan flow).
      COALESCE((
        SELECT COUNT(*)
        FROM   pickup_scans ps
        WHERE  ps.manifest_id = m.id
          AND  ps.scan_result = 'verified'
          AND  ps.deleted_at IS NULL
      ), 0)::BIGINT AS verified_count
    FROM pending pe
    LEFT JOIN manifests m
      ON m.operator_id = public.get_operator_id()
     AND m.external_load_id = pe.external_load_id
     AND m.deleted_at IS NULL
    LEFT JOIN users u ON u.id = m.labels_printed_by
  ),
  arm1 AS (
    -- Brazo original: arranca en orders, exige AL MENOS una orden viva por
    -- construcción (la CTE `pending` filtra o.deleted_at IS NULL).
    SELECT
      manifest_id AS id,
      external_load_id,
      retailer_name,
      order_count,
      package_count,
      load_created_at AS created_at,
      pickup_point,
      verified_count,
      labels_printed_at,
      labels_printed_by_name,
      pickup_window_start,
      pickup_window_end,
      pickup_cutoff_time
    FROM with_manifest
  ),
  arm2 AS (
    -- spec-94: brazo nuevo. Un manifiesto vivo, cubo-1-shaped (sin ruta
    -- VIVA, sin reception_status, no completed, no cancelled), cuyas
    -- órdenes están TODAS soft-deleted -- arm1 nunca lo ve porque su CTE
    -- `pending` arranca en orders con deleted_at IS NULL. Sin este brazo,
    -- esa carga no la devuelve ninguna de las cuatro RPC.
    -- pickup_point/pickup_window_*/pickup_cutoff_time salen NULL a propósito
    -- (vienen de pickup_points vía orders.pickup_point_id, y aquí no hay
    -- ninguna orden viva) -- NULL significa "sin datos", nunca "sin plazo"
    -- (20261003000001). No rellenar con COALESCE.
    --
    -- order_count/package_count: m.total_orders/total_packages (nullable),
    -- NO un 0::BIGINT fijo. openPendingManifest.ts (docstring, líneas 20-29)
    -- prohíbe explícitamente convertir un "desconocido" en cero: si el
    -- usuario abre esta carga, page.tsx:146-149 pasa estos mismos valores a
    -- openPendingManifest, que hace `UPDATE manifests SET total_orders=...,
    -- total_packages=...` -- PERMANENTE. Un 0 fijo aquí pisaría el total
    -- ORIGINAL de intake (que puede ser un número real, p.ej. 5, de antes de
    -- que todas sus órdenes se soft-borraran) con un cero falso. m.total_
    -- orders/total_packages es la fuente honesta: NULL si nunca se
    -- registraron (ensure_manifest_for_order, 20260814000001, los deja NULL
    -- a propósito), el valor real si alguien los escribió.
    SELECT
      m.id,
      m.external_load_id,
      m.retailer_name,
      m.total_orders::BIGINT AS order_count,
      m.total_packages::BIGINT AS package_count,
      m.created_at,
      NULL::TEXT AS pickup_point,
      COALESCE((
        SELECT COUNT(*)
        FROM   pickup_scans ps
        WHERE  ps.manifest_id = m.id
          AND  ps.scan_result = 'verified'
          AND  ps.deleted_at IS NULL
      ), 0)::BIGINT AS verified_count,
      m.labels_printed_at,
      u.full_name AS labels_printed_by_name,
      NULL::TEXT AS pickup_window_start,
      NULL::TEXT AS pickup_window_end,
      NULL::TEXT AS pickup_cutoff_time
    FROM manifests m
    LEFT JOIN users u ON u.id = m.labels_printed_by
    LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
    WHERE m.operator_id = public.get_operator_id()
      AND m.deleted_at IS NULL
      AND m.status <> 'completed'
      AND m.status <> 'cancelled'
      AND m.reception_status IS NULL
      AND pr.id IS NULL                                -- sin ruta viva
      AND NOT EXISTS (
        SELECT 1 FROM orders o
         WHERE o.operator_id = m.operator_id
           AND o.external_load_id = m.external_load_id
           AND o.deleted_at IS NULL
      )
  )
  -- UNION ALL, no UNION: los brazos son disjuntos por construcción (uno
  -- exige EXISTS una orden viva, el otro lo contrario), así que la
  -- deduplicación sobre trece columnas es un sort regalado.
  --
  -- El ORDER BY hay que envolverlo en un subselect: PostgreSQL sólo admite
  -- nombres de columna de salida u ordinales en el ORDER BY de un UNION, no
  -- expresiones, y load_created_at ni siquiera es un nombre de salida (la
  -- columna se llama created_at).
  SELECT * FROM (
    SELECT * FROM arm1
    UNION ALL
    SELECT * FROM arm2
  ) u
  -- In-progress loads (≥1 verified scan) first, then newest first within each group.
  ORDER BY (u.verified_count > 0) DESC, u.created_at DESC
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'spec-94 fase 1 (ronda 3, "manda la ruta"): cubo 1 ("Por retirar"). Excludes loads that are completed, cancelled, already handed off (reception_status set), or attached to a LIVE pickup route (pickup_routes.deleted_at IS NULL) -- a soft-deleted route no longer counts as "has a route". Also returns pickup_window_start/end and pickup_cutoff_time (spec-83 fase 2) -- NULL until a pickup point has them configured; the frontend must treat NULL as "no data", never as "no deadline". UNION ALL of two disjoint arms: arm1 (an order-rooted CTE, requires ≥1 live order) and arm2 (a manifest with zero live orders -- all soft-deleted -- that arm1''s orders-rooted CTE cannot see). Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

-- =============================================================================
-- 3. get_in_transit_manifests -- cubo 3 ("Camino a bodega")
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_in_transit_manifests();

CREATE OR REPLACE FUNCTION public.get_in_transit_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  reception_status       TEXT,
  updated_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  closed_at              TIMESTAMPTZ,
  missing_count          INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.reception_status::TEXT,
    m.updated_at,
    m.created_at,
    m.pickup_location as pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name,
    -- spec-94 (ronda 4, review de fase 2): "Cierres de hoy" lee TRES cubos,
    -- no dos -- una carga cerrada en el andén (cubo 2) que ve su ruta pasar
    -- a in_transit cae AQUÍ, en cubo 3, y sin closed_at el contador de
    -- trámites del día la pierde hasta que se recibe. Misma forma que
    -- get_routed_manifests.
    CASE WHEN m.status = 'completed' THEN m.completed_at ELSE NULL END AS closed_at,
    -- Misma subconsulta que spec-83 fase 1 puso en get_completed_manifests
    -- (COUNT(DISTINCT package_id), no un conteo plano -- ver esa migración
    -- para el porqué de DISTINCT).
    COALESCE((
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to public.get_operator_id(), so a cross-operator d row could
         -- only reach here via a manifest that isn't this operator's in the
         -- first place — which the outer clause already excludes. No
         -- fixture kills this line alone; it stays for the same reason the
         -- rest of this repo re-checks tenant scope on every join.
         AND d.operator_id = m.operator_id
         -- Redundant by discrepancy_source_matches_operation (20260913000001):
         -- that CHECK forces operation_type='reception' rows to have
         -- manifest_id IS NULL, so d.manifest_id = m.id above already
         -- implies operation_type='pickup'. Kept for readability, not as a
         -- second guard — do not go looking for a fixture that kills this
         -- clause alone.
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.status <> 'cancelled'
    -- spec-94 (ronda 3): con ruta viva, manda pr.status='in_transit' -- el
    -- camión salió de verdad. Sin ruta viva, manda reception_status (el
    -- flujo viejo, pre-spec-47, o una ruta que ya se soltó del manifiesto).
    -- reception_status NO es la señal cuando hay ruta: el mismo valor
    -- 'awaiting_reception' se escribe tanto al cerrar en el andén (ruta
    -- in_progress) como al arrancar la ruta de verdad (ruta in_transit) --
    -- ver spec-94 "Por qué manda la ruta, y no reception_status".
    AND (
      (pr.id IS NOT NULL AND pr.status = 'in_transit')
      OR (pr.id IS NULL AND m.reception_status IN ('awaiting_reception','reception_in_progress'))
    )
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'spec-94 fase 1 (ronda 4, "manda la ruta"): cubo 3 ("Camino a bodega"). Con ruta viva, pr.status=''in_transit''. Sin ruta viva, reception_status IN (awaiting_reception, reception_in_progress) -- el flujo viejo o una ruta ya soltada. reception_status por sí solo no distingue "cerrada en el andén" de "camión en la carretera" cuando hay ruta -- trg_manifest_reception_status (spec-08) escribe awaiting_reception en ambos casos. closed_at/missing_count (ronda 4): "Cierres de hoy" necesita este cubo también -- una carga cerrada en el andén cuya ruta luego arranca cae aquí, y sin estas columnas el panel la pierde entre las 09:00 (cubo 2) y la recepción (cubo 4). Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name.';

-- =============================================================================
-- 4. get_completed_manifests -- cubo 4 ("En bodega")
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_completed_manifests();

CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  missing_count          INT,
  signature_operator     TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.completed_at,
    m.created_at,
    m.pickup_location as pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name,
    -- COUNT(DISTINCT d.package_id), not COUNT(*): uniq_open_discrepancy_per_package
    -- (20260913000001) only blocks two 'open' rows for the same
    -- (package_id, source_id) — it does NOT block an 'open' row coexisting
    -- with a 'lost' or already-'resolved' row for that same package on the
    -- same manifest. spec-83 fase 1's round-2 review first accepted this as
    -- a documented, rare limitation, then reversed that call: the fix is
    -- cheaper than the note justifying skipping it, and the failure mode is
    -- OVERSTATEMENT in a figure that can end up in an indemnity dispute
    -- (never an undercount). Do not simplify this back to a plain row
    -- count without re-reading that round's fixture (CARGA-83-4).
    COALESCE((
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to public.get_operator_id(), so a cross-operator d row could
         -- only reach here via a manifest that isn't this operator's in the
         -- first place — which the outer clause already excludes. No
         -- fixture kills this line alone; it stays for the same reason the
         -- rest of this repo re-checks tenant scope on every join.
         AND d.operator_id = m.operator_id
         -- Redundant by discrepancy_source_matches_operation (20260913000001):
         -- that CHECK forces operation_type='reception' rows to have
         -- manifest_id IS NULL, so d.manifest_id = m.id above already
         -- implies operation_type='pickup'. Kept for readability, not as a
         -- second guard — do not go looking for a fixture that kills this
         -- clause alone.
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count,
    m.signature_operator
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.status <> 'cancelled'
    -- spec-94 (ronda 3): con ruta viva, manda pr.status='received' -- el hub
    -- recibió la ruta completa. Sin ruta viva, manda reception_status=
    -- 'received' (flujo consolidado) O el flujo viejo (completed sin
    -- reception_status, pre-spec-47 o dato histórico).
    AND (
      (pr.id IS NOT NULL AND pr.status = 'received')
      OR (pr.id IS NULL AND (
            m.reception_status = 'received'
            OR (m.status = 'completed' AND m.reception_status IS NULL)
          ))
    )
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'spec-94 fase 1 (ronda 3, "manda la ruta"): cubo 4 ("En bodega"). Con ruta viva, pr.status=''received''. Sin ruta viva, reception_status=''received'' O (status=''completed'' AND reception_status IS NULL) -- flujo viejo. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name. spec-83 fase 1: adds missing_count, a COUNT(DISTINCT package_id) over public.discrepancies (kind=''missing'', operation_type=''pickup'', not soft-deleted, status <> ''resolved''). spec-80 fase 2b: adds signature_operator so callers can tell a genuinely-signed close apart from one trg_route_receptions_status_sync completed without ever reaching Firma (NULL).';

-- =============================================================================
-- Verificación
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_routed_manifests'
  ) THEN
    RAISE EXCEPTION 'get_routed_manifests not found after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_pending_manifests'
  ) THEN
    RAISE EXCEPTION 'get_pending_manifests not found after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_in_transit_manifests'
  ) THEN
    RAISE EXCEPTION 'get_in_transit_manifests not found after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_completed_manifests'
  ) THEN
    RAISE EXCEPTION 'get_completed_manifests not found after migration';
  END IF;
END $$;

DO $$
DECLARE
  v_src  TEXT;
  v_cols TEXT;
BEGIN
  -- ── get_routed_manifests ────────────────────────────────────────────────
  SELECT p.prosrc, array_to_string(p.proargnames, ',') INTO v_src, v_cols
   FROM pg_proc p WHERE p.oid = 'public.get_routed_manifests()'::regprocedure;
  IF v_src NOT LIKE '%LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'get_routed_manifests must LEFT JOIN pickup_routes with deleted_at in the ON clause, not the WHERE';
  END IF;
  IF v_src NOT LIKE '%pr.status NOT IN (%in_transit%received%)%' THEN
    RAISE EXCEPTION 'get_routed_manifests must use pr.status NOT IN (in_transit, received), not a positive list';
  END IF;
  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,total_orders,total_packages,created_at,pickup_point,labels_printed_at,labels_printed_by_name,route_code,route_started_at,driver_name,route_status,closed_at,missing_count,verified_count'
  THEN
    RAISE EXCEPTION 'get_routed_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  -- ── get_pending_manifests ───────────────────────────────────────────────
  SELECT p.prosrc, array_to_string(p.proargnames, ',') INTO v_src, v_cols
   FROM pg_proc p WHERE p.oid = 'public.get_pending_manifests()'::regprocedure;
  IF v_src NOT LIKE '%UNION ALL%' THEN
    RAISE EXCEPTION 'get_pending_manifests lost its UNION ALL arm for manifests with zero live orders';
  END IF;
  IF v_src NOT LIKE '%LEFT JOIN pickup_routes pr%' THEN
    RAISE EXCEPTION 'get_pending_manifests must resolve "ruta viva" via pickup_routes, not pickup_route_id alone';
  END IF;
  -- spec-83 fase 2: the three window columns must still be derived from
  -- pickup_points, not just declared in RETURNS TABLE (round-2 finding on
  -- that migration; the check itself got dropped when this migration
  -- re-templated the function -- restored here).
  IF v_src NOT LIKE '%pickup_locations->0->''operating_hours''->>''start''%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not derive pickup_window_start from pickup_locations';
  END IF;
  IF v_src NOT LIKE '%sla_config->>''pickup_cutoff_time''%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not derive pickup_cutoff_time from sla_config';
  END IF;
  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,order_count,package_count,created_at,pickup_point,verified_count,labels_printed_at,labels_printed_by_name,pickup_window_start,pickup_window_end,pickup_cutoff_time'
  THEN
    RAISE EXCEPTION 'get_pending_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  -- ── get_in_transit_manifests ────────────────────────────────────────────
  SELECT p.prosrc, array_to_string(p.proargnames, ',') INTO v_src, v_cols
   FROM pg_proc p WHERE p.oid = 'public.get_in_transit_manifests()'::regprocedure;
  IF v_src NOT LIKE '%awaiting_reception%' OR v_src NOT LIKE '%reception_in_progress%' THEN
    RAISE EXCEPTION 'get_in_transit_manifests must filter on reception_status IN (awaiting_reception, reception_in_progress) for the no-live-route branch';
  END IF;
  IF v_src NOT LIKE '%pr.status = ''in_transit''%' THEN
    RAISE EXCEPTION 'get_in_transit_manifests must check pr.status = in_transit for the live-route branch';
  END IF;
  -- ronda 4 (review fase 2): "Cierres de hoy" lee tres cubos, no dos -- una
  -- carga cerrada en el andén cuya ruta pasa a in_transit cae aquí, y sin
  -- closed_at/missing_count el panel la pierde entre las 09:00 y la
  -- recepción.
  IF v_src NOT LIKE '%closed_at%' OR v_src NOT LIKE '%missing_count%' THEN
    RAISE EXCEPTION 'get_in_transit_manifests lost closed_at or missing_count (ronda 4) in the re-template';
  END IF;
  -- La misma trampa ON-vs-WHERE que get_routed_manifests: si `AND pr.deleted_
  -- at IS NULL` se cuela en el WHERE (en vez del ON), una ruta soft-deleted
  -- convierte el LEFT JOIN en un INNER de hecho y el manifiesto desaparece
  -- de esta RPC también -- el mismo agujero de CARGA-PARIS-001.
  IF v_src NOT LIKE '%LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'get_in_transit_manifests must LEFT JOIN pickup_routes with deleted_at in the ON clause, not the WHERE';
  END IF;
  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,total_orders,total_packages,reception_status,updated_at,created_at,pickup_point,labels_printed_at,labels_printed_by_name,closed_at,missing_count'
  THEN
    RAISE EXCEPTION 'get_in_transit_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  -- ── get_completed_manifests ─────────────────────────────────────────────
  SELECT p.prosrc, array_to_string(p.proargnames, ',') INTO v_src, v_cols
   FROM pg_proc p WHERE p.oid = 'public.get_completed_manifests()'::regprocedure;
  IF v_src NOT LIKE '%missing_count%' OR v_src NOT LIKE '%signature_operator%' THEN
    RAISE EXCEPTION 'get_completed_manifests lost missing_count (spec-83) or signature_operator (spec-80) in the re-template';
  END IF;
  IF v_src NOT LIKE '%pr.status = ''received''%' THEN
    RAISE EXCEPTION 'get_completed_manifests must check pr.status = received for the live-route branch';
  END IF;
  IF v_src NOT LIKE '%LEFT JOIN pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'get_completed_manifests must LEFT JOIN pickup_routes with deleted_at in the ON clause, not the WHERE';
  END IF;
  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,total_orders,total_packages,completed_at,created_at,pickup_point,labels_printed_at,labels_printed_by_name,missing_count,signature_operator'
  THEN
    RAISE EXCEPTION 'get_completed_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  RAISE NOTICE '✓ spec-94 fase 1 (ronda 3): four pickup RPCs re-templated, route status wins when a live route exists';
END $$;

COMMIT;
