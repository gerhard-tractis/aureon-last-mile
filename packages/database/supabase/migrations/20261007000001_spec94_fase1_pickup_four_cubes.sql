-- =============================================================================
-- spec-94 fase 1 — Recogida: cuatro estados que particionan por lugar físico
-- =============================================================================
-- Contexto (ver docs/specs/spec-94-recogida-cuatro-estados.md): un manifiesto
-- enganchado a una ruta de recogida pero todavía sin llegar al hub
-- (`pickup_route_id` seteado, `reception_status` NULL) no lo devuelve ninguna
-- de las tres RPC vigentes (`get_pending_manifests`, `get_in_transit_manifests`,
-- `get_completed_manifests`): desaparece de toda la pantalla de escritorio.
--
-- Esta migración re-templa las CUATRO funciones a la vez (`get_routed_
-- manifests` es nueva) porque re-templar sólo la nueva y dejar las otras tres
-- intactas produce un solape real: una carga cerrada en el andén
-- (status='completed', ruta in_progress, reception_status NULL) saldría en
-- get_routed_manifests Y en get_completed_manifests al mismo tiempo, y en
-- cuanto sale el camión la devolvería sólo get_completed_manifests -- el
-- hallazgo original, intacto. Una migración, cuatro funciones.
--
-- El modelo de estados (cubos, no trámites):
--   1. Por retirar        pickup_route_id IS NULL AND reception_status IS NULL
--                          AND status <> 'completed'      (+ status <> 'cancelled')
--   2. En punto de retiro  pickup_route_id IS NOT NULL AND reception_status IS NULL
--                          (+ status <> 'cancelled')
--   3. Camino a bodega     reception_status IN ('awaiting_reception',
--                          'reception_in_progress')        (+ status <> 'cancelled')
--   4. En bodega           reception_status = 'received', O
--                          (status='completed' AND pickup_route_id IS NULL
--                           AND reception_status IS NULL)   (+ status <> 'cancelled')
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
-- POSICIÓN DE `status <> 'cancelled'`: en get_routed_manifests, get_in_
-- transit_manifests y get_completed_manifests va en el WHERE, porque las tres
-- parten de `manifests` directamente. En get_pending_manifests va DENTRO de
-- la subconsulta NOT IN (junto a completed/reception_status/pickup_route_id),
-- NUNCA en el WHERE que compara contra el LEFT JOIN a manifests: ahí
-- `m.status <> 'cancelled'` evaluaría a NULL cuando no hay fila de
-- manifiesto todavía, y NULL no es TRUE -- borraría de "Por retirar" toda
-- carga que aún no tiene fila en manifests, justo el conjunto que ese LEFT
-- JOIN existe para preservar.
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
    -- LEFT, y la condición de deleted_at en el ON, no en el WHERE: una ruta
    -- soft-deleted no vacía manifests.pickup_route_id, así que filtrar la
    -- fila aquí recrea el agujero original (CARGA-PARIS-001) -- el
    -- manifiesto quedaría excluido de esta RPC (por tener ruta) y de las
    -- otras tres (por no tener reception_status), invisible otra vez. Con
    -- LEFT JOIN la fila sobrevive y route_status sale NULL, que es la señal
    -- que la fase 3 necesita.
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
         AND d.operator_id = m.operator_id
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
    AND m.pickup_route_id IS NOT NULL
    AND m.reception_status IS NULL
    AND m.status <> 'cancelled'
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_routed_manifests() IS 'spec-94 fase 1. Cubo 2 ("En punto de retiro"): manifiesto enganchado a una ruta de recogida (pickup_route_id IS NOT NULL) que todavía no llegó al hub (reception_status IS NULL). Incluye cargas ya cerradas en el andén con el camión todavía en el punto de retiro (status=''completed'', closed_at poblado) -- esa mezcla es coste aceptado a propósito, ver spec-94. LEFT JOIN a pickup_routes con la condición deleted_at en el ON: una ruta soft-deleted no debe hacer desaparecer el manifiesto. missing_count y verified_count replican exactamente las subconsultas de get_completed_manifests (spec-83 fase 1) y la guarda 7 de remove_manifest_from_route (spec-64) respectivamente.';

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
        SELECT m.external_load_id FROM manifests m
        WHERE m.operator_id = public.get_operator_id()
          AND m.deleted_at IS NULL
          AND (m.status = 'completed'
               -- spec-94: 'cancelled' va aquí, dentro del NOT IN, nunca en
               -- el WHERE de más abajo que compara contra el LEFT JOIN --
               -- ver la nota de cabecera de este archivo.
               OR m.status = 'cancelled'
               OR m.reception_status IS NOT NULL
               OR m.pickup_route_id IS NOT NULL)
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
    -- spec-94: brazo nuevo. Un manifiesto vivo, cubo-1-shaped (sin ruta, sin
    -- reception_status, no completed, no cancelled), cuyas órdenes están
    -- TODAS soft-deleted -- arm1 nunca lo ve porque su CTE `pending` arranca
    -- en orders con deleted_at IS NULL. Sin este brazo, esa carga no la
    -- devuelve ninguna de las cuatro RPC.
    -- pickup_point/pickup_window_*/pickup_cutoff_time salen NULL a propósito
    -- (vienen de pickup_points vía orders.pickup_point_id, y aquí no hay
    -- ninguna orden viva) -- NULL significa "sin datos", nunca "sin plazo"
    -- (20261003000001). No rellenar con COALESCE.
    SELECT
      m.id,
      m.external_load_id,
      m.retailer_name,
      0::BIGINT AS order_count,
      0::BIGINT AS package_count,
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
    WHERE m.operator_id = public.get_operator_id()
      AND m.deleted_at IS NULL
      AND m.status <> 'completed'
      AND m.status <> 'cancelled'
      AND m.reception_status IS NULL
      AND m.pickup_route_id IS NULL
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

COMMENT ON FUNCTION public.get_pending_manifests() IS 'spec-94 fase 1: cubo 1 ("Por retirar"). Excludes loads that are completed, cancelled, already handed off (reception_status set), or already attached to a pickup route (spec-61). Also returns pickup_window_start/end and pickup_cutoff_time (spec-83 fase 2) -- NULL until a pickup point has them configured; the frontend must treat NULL as "no data", never as "no deadline". UNION ALL of two disjoint arms: arm1 (an order-rooted CTE, requires ≥1 live order) and arm2 (a manifest with zero live orders -- all soft-deleted -- that arm1''s orders-rooted CTE cannot see). Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

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
  labels_printed_by_name TEXT
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
    u.full_name AS labels_printed_by_name
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    -- spec-94: predicado sobre reception_status, no sobre status. El enum
    -- reception_status_enum tiene exactamente tres valores
    -- (awaiting_reception/reception_in_progress/received) -- excluir
    -- 'received' aquí es lo que separa este cubo del cubo 4 sin tocar
    -- status en absoluto.
    AND m.reception_status IN ('awaiting_reception','reception_in_progress')
    AND m.status <> 'cancelled'
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'spec-94 fase 1: cubo 3 ("Camino a bodega"). reception_status IN (awaiting_reception, reception_in_progress) -- ya no depende de status != completed; ver spec-94 "Por qué los cubos no miran status". Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name.';

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
         AND d.operator_id = m.operator_id
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count,
    m.signature_operator
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    -- spec-94: cubo 4 ahora mira reception_status='received' primero (el
    -- brazo alcanzable en la práctica -- ver spec-94 "El modelo de estados",
    -- reception_status='received' con status<>'completed' no es alcanzable,
    -- 20260812000006 escribe ambas columnas en el mismo UPDATE). El segundo
    -- brazo (status='completed' AND pickup_route_id IS NULL AND
    -- reception_status IS NULL) cubre el flujo viejo, cerrado sin ruta.
    AND (
      m.reception_status = 'received'
      OR (m.status = 'completed' AND m.pickup_route_id IS NULL AND m.reception_status IS NULL)
    )
    AND m.status <> 'cancelled'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'spec-94 fase 1: cubo 4 ("En bodega"). reception_status=''received'', o status=''completed'' AND pickup_route_id IS NULL AND reception_status IS NULL (flujo viejo, cerrado sin ruta) -- ya no un simple status=''completed''. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name. spec-83 fase 1: adds missing_count, a COUNT(DISTINCT package_id) over public.discrepancies (kind=''missing'', operation_type=''pickup'', not soft-deleted, status <> ''resolved''). spec-80 fase 2b: adds signature_operator so callers can tell a genuinely-signed close apart from one trg_route_receptions_status_sync completed without ever reaching Firma (NULL).';

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
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.get_routed_manifests()'::regprocedure;
  IF v_src NOT LIKE '%LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'get_routed_manifests must LEFT JOIN pickup_routes with deleted_at in the ON clause, not the WHERE';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.get_pending_manifests()'::regprocedure;
  IF v_src NOT LIKE '%UNION ALL%' THEN
    RAISE EXCEPTION 'get_pending_manifests lost its UNION ALL arm for manifests with zero live orders';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.get_in_transit_manifests()'::regprocedure;
  IF v_src NOT LIKE '%awaiting_reception%' OR v_src NOT LIKE '%reception_in_progress%' THEN
    RAISE EXCEPTION 'get_in_transit_manifests must filter on reception_status IN (awaiting_reception, reception_in_progress)';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.get_completed_manifests()'::regprocedure;
  IF v_src NOT LIKE '%missing_count%' OR v_src NOT LIKE '%signature_operator%' THEN
    RAISE EXCEPTION 'get_completed_manifests lost missing_count (spec-83) or signature_operator (spec-80) in the re-template';
  END IF;

  RAISE NOTICE '✓ spec-94 fase 1: four pickup RPCs re-templated onto the disjoint physical-location cubes';
END $$;

COMMIT;
