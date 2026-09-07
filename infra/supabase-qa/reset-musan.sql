-- =============================================================================
-- reset-musan.sql — wipe Transportes Musan's QA data back to an empty tenant
-- =============================================================================
-- A one-time, by-hand operation, NOT part of any deploy. `npm run seed:qa` is
-- deliberately idempotent-and-non-destructive (it never resets a carga a tester
-- is halfway through collecting — see PR #491), so there is no path through the
-- generator back to a clean tenant. This is that path.
--
--   psql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 \
--        -f infra/supabase-qa/reset-musan.sql
--
-- Then re-seed:
--   psql ... -f packages/database/supabase/seed-qa.sql          (master data)
--   node node_modules/tsx/dist/cli.mjs seed-qa/index.ts --only=musan
--
-- WHAT IS DELETED
--   Every transactional row Musan owns: orders, packages, manifests, routes,
--   dispatches, pickup routes and their scans, receptions, returns,
--   settlements, conversations, exceptions, metrics and audit_logs. Also
--   pickup_points, which the generator re-creates.
--
-- WHAT IS KEPT, and why
--   users / auth.users        Logins keep working; a rebuilt carga set is no
--                             reason for anyone's saved password to change.
--   operators, tenant_clients Created by migrations, not by any seed.
--   operator_enabled_modules  Deleting these gives Musan an empty sidebar and
--   operator_module_audit     nothing re-creates them.
--   fleet_vehicles            28 of Musan's 29 trucks arrived via DispatchTrack
--   dock_zones                webhooks QA no longer receives, and seed-qa.sql
--   drivers, vehicles         re-creates only one plate. Deleting them is not
--   retailer_* config         reversible in QA, and none of it is carga data.
--
-- Hard deletes, not soft. The repo's soft-delete rule protects business
-- records; this is a QA fixture teardown, and rows carrying deleted_at would
-- still collide with unique_label_per_operator (which is not partial) and
-- unique_manifest_per_operator on the next seed.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Refuse to run anywhere that looks like production
-- -----------------------------------------------------------------------------
-- The same check lib/guards.ts makes before the generator writes anything: a
-- tunnel can make production look local, so the connected DATABASE is what gets
-- inspected, not the connection string.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.operators
     WHERE id = '92dc5797-047d-458d-bbdb-63f18c0dd1e7'
  ) THEN
    RAISE EXCEPTION 'refusing to run: this database contains the PRODUCTION Musan operator';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.operators
     WHERE slug = 'transportes-musan' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'operator transportes-musan not found — nothing to reset';
  END IF;
END $$;

-- Resolved by slug, never hardcoded: Musan's id is gen_random_uuid() in
-- migration 20260223000001 and differs per environment.
CREATE TEMP TABLE musan_target ON COMMIT DROP AS
SELECT id FROM public.operators
 WHERE slug = 'transportes-musan' AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Child-first, in an order derived from the live foreign-key graph
-- -----------------------------------------------------------------------------
DELETE FROM public.carton_expansion_audit  WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.discrepancy_notes       WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.dock_scans              WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.dock_verifications      WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.dock_batches            WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.reception_scans         WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.return_reception_scans  WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.return_receptions       WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.pickup_scans            WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.route_receptions        WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.pickup_route_crew       WHERE operator_id IN (SELECT id FROM musan_target);

-- exceptions before settlement_periods: exceptions.settlement_id references it.
DELETE FROM public.exceptions              WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.settlement_line_items   WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.settlement_documents    WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.settlement_periods      WHERE operator_id IN (SELECT id FROM musan_target);

DELETE FROM public.customer_session_messages WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.customer_sessions       WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.conversation_messages   WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.wismo_notifications     WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.conversations           WHERE operator_id IN (SELECT id FROM musan_target);

DELETE FROM public.order_reschedules       WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.assignments             WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.dispatches              WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.route_blocks            WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.vehicle_load_samples    WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.route_stop_counts       WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.load_positions          WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.driver_availabilities   WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.capacity_alerts         WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.performance_metrics     WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.dashboard_monthly_rollup WHERE operator_id IN (SELECT id FROM musan_target);

-- manifests.pickup_route_id is the one FK pointing back UP from a manifest;
-- clear it so the pickup_routes below can go.
UPDATE public.manifests SET pickup_route_id = NULL
 WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.pickup_routes           WHERE operator_id IN (SELECT id FROM musan_target);

-- packages before routes (packages.loaded_route_id), and before orders.
DELETE FROM public.packages                WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.orders                  WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.manifests               WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.routes                  WHERE operator_id IN (SELECT id FROM musan_target);

DELETE FROM public.intake_submissions      WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.pickup_points           WHERE operator_id IN (SELECT id FROM musan_target);
DELETE FROM public.audit_logs              WHERE operator_id IN (SELECT id FROM musan_target);

-- -----------------------------------------------------------------------------
-- Prove it
-- -----------------------------------------------------------------------------
-- A DELETE that silently matched nothing looks identical to one that worked, so
-- the script asserts the end state rather than trusting its own row counts.
DO $$
DECLARE
  v_operator UUID := (SELECT id FROM musan_target);
  v_left     BIGINT;
  v_table    TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'orders', 'packages', 'manifests', 'routes', 'dispatches', 'pickup_routes',
    'pickup_scans', 'reception_scans', 'pickup_points', 'audit_logs'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE operator_id = $1', v_table)
       INTO v_left USING v_operator;
    IF v_left <> 0 THEN
      RAISE EXCEPTION '% still holds % Musan row(s) after reset', v_table, v_left;
    END IF;
  END LOOP;

  -- The things this script promises NOT to touch.
  SELECT count(*) INTO v_left FROM public.users WHERE operator_id = v_operator AND deleted_at IS NULL;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'reset removed Musan''s logins — it must never do that';
  END IF;

  SELECT count(*) INTO v_left FROM public.tenant_clients WHERE operator_id = v_operator AND deleted_at IS NULL;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'reset removed Musan''s tenant_clients — it must never do that';
  END IF;

  RAISE NOTICE 'Musan reset complete. Logins and tenant config intact.';
END $$;

COMMIT;
