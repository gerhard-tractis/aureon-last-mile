-- =============================================================
-- Hotfix: Recogida stayed empty until the crew pressed "Cerrar ruta y entregar"
-- Template: latest definition from
--   20260821000003_fix_recogida_counts_only_verified_packages.sql
--
-- SYMPTOM (QA, Musan, 2026-09-07): the pickup crew verified every package of
-- CARGA PARIS-002 and the Ops Control "Recogida" panel showed nothing. The
-- orders only appeared once the leader pressed "Cerrar ruta y entregar" on the
-- active-route screen.
--
-- ROOT CAUSE. The manifests key gates on
--     m.reception_status IN ('awaiting_reception','reception_in_progress')
-- and `manifests.reception_status` is NULL for a carga on an open route. Only
-- two writers ever set it, and both are ROUTE-level events at the END of the
-- trip:
--   * close_pickup_route() -> route in_transit -> trg_pickup_routes_set_manifest_
--     reception_status (20260625000001), i.e. the "Cerrar ruta y entregar" button;
--   * open_route_reception() (20260812000005), the receptionist's QR scan.
-- The route flow has NO per-carga completion event at all: /app/pickup/review/
-- [loadId] ends with "Continuar a ruta", and the Firma step
-- (/app/pickup/complete/[loadId], the only writer of manifests.status =
-- 'completed') is unreachable from it. So a finished carga was invisible to the
-- control tower for the rest of the trip — which can be hours.
--
-- FIX. Recogida is "Órdenes en tránsito hacia recepción" (PickupPanel.tsx), and
-- a carga the crew has finished verifying IS in transit toward reception. The
-- manifests key now also admits a carga that is
--   (a) attached to a pickup route still in_progress, and
--   (b) CLOSED OUT — no package of it is still sitting at 'ingresado' without a
--       discrepancy note.
--
-- (b) is the crew's own definition of "done with this carga": the Revisión
-- screen lists every unverified package and disables "Continuar a ruta" until
-- each one carries a discrepancy_notes row. Requiring "every package verified"
-- instead would leave a carga picked up one box short invisible until the route
-- closes — the same bug, one case narrower.
--
-- WHAT APPEARS. Only what was actually collected, per Gerhard: an order needs at
-- least one 'verificado' package to be listed at all (new EXISTS below), and the
-- packages array was already filtered to 'verificado' by the template. An order
-- nobody could find at the pickup point never reaches the tower as picked up.
-- That EXISTS applies to the pre-existing awaiting_reception branch too — an
-- order closed out with every box missing was being listed there with an empty
-- packages array.
--
-- 'in_progress' only, deliberately: 'in_transit'/'received' already carry
-- reception_status, 'cancelled' clears it (20260824000004), and it is the one
-- status trg_pickup_scans_enforce_route_lock (20260812000005) still admits
-- scans in. A carga with NO route is also unchanged — the legacy standalone
-- flow still becomes visible at Firma, via reception_status.
--
-- 'ingresado' (not `<> 'verificado'`) is what counts as unresolved: a package
-- already past pickup is collected, and a terminal one (cancelado / devuelto /
-- dañado / extraviado / retorno_hub — see spec52_may_advance_status) is not
-- waiting to be picked up at all. `<> 'verificado'` would let one cancelled
-- package pin a finished carga out of the tower forever.
--
-- Orders, routes, sla_config and returns keys are unchanged from the template.
-- Test: packages/database/supabase/tests/recogida_visible_when_carga_verified.sql
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
        'retailer_name', o.retailer_name, 'external_load_id', o.external_load_id,
        'status', o.status, 'pickup_point_name', pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna', o.comuna, 'delivery_date', o.delivery_date,
        'delivery_window_start', TO_CHAR(o.delivery_window_start, 'HH24:MI'),
        'delivery_window_end', TO_CHAR(o.delivery_window_end, 'HH24:MI'),
        'rescheduled_delivery_date', o.rescheduled_delivery_date,
        'rescheduled_window_start', TO_CHAR(o.rescheduled_window_start, 'HH24:MI'),
        'rescheduled_window_end', TO_CHAR(o.rescheduled_window_end, 'HH24:MI'),
        'dwell_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'age_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'idle_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'packages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'status', p.status, 'declared_box_count', p.declared_box_count, 'sku_items', p.sku_items))
          FROM packages p WHERE p.order_id = o.id AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id AND o.deleted_at IS NULL AND o.status NOT IN ('entregado', 'cancelado', 'en_retorno', 'parcialmente_entregado')
    ), '[]'::jsonb),
    'routes', COALESCE((
      SELECT jsonb_agg(row_to_json(r)) FROM routes r
      WHERE r.operator_id = p_operator_id AND r.deleted_at IS NULL AND r.status NOT IN ('completed', 'cancelled')
        AND NOT (r.status = 'draft' AND COALESCE(r.planned_stops, 0) = 0)
    ), '[]'::jsonb),
    'manifests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
        'retailer_name', o.retailer_name, 'external_load_id', o.external_load_id,
        'status', o.status, 'pickup_point_name', pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna', o.comuna,
        'packages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'status', p.status, 'declared_box_count', p.declared_box_count, 'sku_items', p.sku_items))
          FROM packages p WHERE p.order_id = o.id AND p.deleted_at IS NULL
            AND p.status = 'verificado'
        ), '[]'::jsonb)
      ))
      FROM orders o LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id AND o.deleted_at IS NULL
        AND o.status IN ('ingresado', 'verificado')
        -- Nothing was collected for this order -> it is not in transit toward
        -- reception and must not be listed. Without this an order closed out
        -- entirely as missing showed up with an empty packages array.
        AND EXISTS (
          SELECT 1 FROM packages p
           WHERE p.order_id = o.id AND p.deleted_at IS NULL
             AND p.status = 'verificado'
        )
        AND o.external_load_id IN (
          SELECT m.external_load_id FROM manifests m
          WHERE m.operator_id = p_operator_id AND m.deleted_at IS NULL
            AND m.status != 'cancelled'
            AND (
              -- Handed off: route closed, or the receptionist opened the batch.
              m.reception_status IN ('awaiting_reception', 'reception_in_progress')
              -- Or: finished on a route that is still out collecting.
              OR (
                EXISTS (
                  SELECT 1 FROM pickup_routes pr
                   WHERE pr.id = m.pickup_route_id
                     AND pr.operator_id = m.operator_id
                     AND pr.deleted_at IS NULL
                     AND pr.status = 'in_progress'
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM orders o2
                    JOIN packages p2 ON p2.order_id = o2.id AND p2.deleted_at IS NULL
                   WHERE o2.operator_id = m.operator_id
                     AND o2.external_load_id = m.external_load_id
                     AND o2.deleted_at IS NULL
                     AND o2.status <> 'cancelado'
                     AND p2.status = 'ingresado'
                     AND NOT EXISTS (
                       SELECT 1 FROM discrepancy_notes dn
                        WHERE dn.manifest_id = m.id
                          AND dn.package_id = p2.id
                          AND dn.deleted_at IS NULL
                     )
                )
              )
            )
        )
    ), '[]'::jsonb),
    'sla_config', COALESCE((
      SELECT jsonb_agg(row_to_json(s)) FROM retailer_return_sla_config s
      WHERE s.operator_id = p_operator_id AND s.deleted_at IS NULL
    ), '[]'::jsonb),
    'returns', COALESCE((
      SELECT jsonb_agg(row)
      FROM (
        SELECT DISTINCT ON (o.id)
          jsonb_build_object(
            'id',                 o.id,
            'order_number',       o.order_number,
            'retailer_name',      o.retailer_name,
            'pickup_point_name',  pp.name,
            'status',             o.status,
            'return_reason',      p.return_reason,
            'return_reason_code', p.return_reason_code,
            'age_minutes',        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'dwell_minutes',      EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'idle_minutes',       EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'packages', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', pk.id, 'label', pk.label, 'status', pk.status,
                'return_reason', pk.return_reason, 'return_reason_code', pk.return_reason_code
              ))
              FROM packages pk
              WHERE pk.order_id = o.id
                AND pk.status = 'retorno_hub'
                AND pk.deleted_at IS NULL
            ), '[]'::jsonb)
          ) AS row
        FROM orders o
        JOIN packages p
          ON p.order_id   = o.id
         AND p.status     = 'retorno_hub'
         AND p.deleted_at IS NULL
        LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
        WHERE o.operator_id = p_operator_id
          AND o.status IN ('en_retorno', 'parcialmente_entregado')
          AND o.deleted_at IS NULL
        ORDER BY o.id, p.updated_at DESC  -- picks the most-recently-updated package reason
      ) sub
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_ops_control_snapshot(UUID) IS
  'Returns a single jsonb snapshot used by the Ops Control dashboard. Keys: orders, routes, manifests, sla_config, returns. The manifests key (Recogida) lists orders still pre-reception (status ingresado/verificado) that have at least one pickup-verified package, from cargas either handed off (reception_status set) or already closed out on a pickup route still in_progress — no package left at ingresado without a discrepancy note. It reports ONLY their pickup-verified packages: a package closed out as a discrepancy never reaches verificado and must not count as collected. The orders key keeps every package. The returns key lists orders in en_retorno or parcialmente_entregado status (excluded from orders) with pickup_point_name, retorno_hub packages array, and failure reason from the most-recently-updated retorno_hub package.';

-- Verification: the manifests key keeps the spec-47 handoff branch, gains the
-- closed-out-on-an-open-route branch, and still filters packages to verificado
-- in the manifests key only (the orders key must keep every package).
DO $$
DECLARE src TEXT;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname = 'get_ops_control_snapshot';
  IF src IS NULL THEN
    RAISE EXCEPTION 'get_ops_control_snapshot not found after migration!';
  END IF;
  IF src NOT LIKE '%reception_in_progress%' THEN
    RAISE EXCEPTION 'get_ops_control_snapshot lost the spec-47 manifests filter!';
  END IF;
  IF src NOT LIKE '%discrepancy_notes%' THEN
    RAISE EXCEPTION 'get_ops_control_snapshot lost the closed-out-on-an-open-route branch!';
  END IF;
  IF (length(src) - length(replace(src, 'p.status = ''verificado''', ''))) / length('p.status = ''verificado''') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two p.status = verificado filters (manifests packages array + the per-order EXISTS)';
  END IF;
  RAISE NOTICE '✓ Recogida now shows a carga as soon as it is verified, not at route close';
END $$;
