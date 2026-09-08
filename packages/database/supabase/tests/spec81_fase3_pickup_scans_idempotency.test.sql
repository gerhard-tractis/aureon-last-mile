-- pgTAP: spec-81 fase 3 — pickup_scans.client_operation_id idempotency.
--
-- The offline queue (fase 1) stamps every entry with a client-generated
-- UUID at enqueue time and never regenerates it on retry. Fase 2's drainer
-- resends an entry whose 200 response was lost. Without a server-side
-- unique key on that id, the resend inserts a SECOND pickup_scans row for
-- the same physical scan and the manifest's verified/missing/unexpected
-- counts — the numbers 5f puts in front of the client for signature —
-- go wrong.
--
-- pickup_scans is written by a plain client `.insert()` (usePickupScans.ts),
-- not through a SECURITY DEFINER RPC — unlike close_manifest/
-- record_discrepancies. So idempotency here is a bare unique constraint:
-- Postgres raises 23505 (unique_violation) on the retried INSERT with no
-- RPC-side RAISE needed, and PostgREST maps 23505 -> HTTP 409 the same way
-- it does for close_manifest's MANIFEST_ALREADY_SIGNED (20260913000004) —
-- an idempotent conflict, never P0002/404, which the offline queue would
-- misread as "doesn't exist" and discard the entry instead of resolving it.
--
-- Partial (client_operation_id IS NOT NULL AND deleted_at IS NULL), same
-- shape as spec-85's uniq_open_discrepancy_per_package/_per_barcode
-- (20260913000001): existing rows and any future write that omits the id
-- (there is none today, but nothing forces one) must not collide on NULL,
-- and a soft-deleted scan must not permanently block reuse of its id.

BEGIN;
SELECT plan(9);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('00000000-0000-4000-8000-000000008100', 'Spec81 Op A', 'spec81-op-a'),
  ('00000000-0000-4000-8000-000000008101', 'Spec81 Op B', 'spec81-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-000000008120','00000000-0000-4000-8000-000000008100',
   'ORD-81-1','Cliente 81','+56911111111','Calle 81','Santiago', CURRENT_DATE,
   'CARGA-81-1','Retailer 81','{}'::jsonb,'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- 20260814000001's trg_ensure_manifest_for_order already created the
-- manifests row for this load the moment the order above was inserted.
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data, status)
VALUES
  ('00000000-0000-4000-8000-000000008140','00000000-0000-4000-8000-000000008100',
   '00000000-0000-4000-8000-000000008120','CTN81-1','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1 — the column exists and is nullable (no backfill required, no
-- NOT NULL — existing rows predate this migration).
-- =============================================================================
DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pickup_scans'
     AND column_name = 'client_operation_id';

  IF v_nullable IS NULL THEN
    RAISE EXCEPTION 'TEST 1 FAILED: public.pickup_scans.client_operation_id does not exist';
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'TEST 1 FAILED: client_operation_id must be nullable (no backfill of pre-existing rows)';
  END IF;
END $$;
SELECT pass('TEST 1 PASSED: pickup_scans.client_operation_id exists and is nullable');

-- =============================================================================
-- TEST 2 — a UNIQUE index covers (operator_id, client_operation_id),
-- partial on client_operation_id IS NOT NULL AND deleted_at IS NULL.
-- Read from pg_index directly (not just "an insert fails") so a mutation
-- that widens/narrows the predicate is caught even before TEST 3-9 run.
-- =============================================================================
DO $$
DECLARE
  v_indexdef TEXT;
BEGIN
  SELECT indexdef INTO v_indexdef
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'pickup_scans'
     AND indexdef ILIKE '%UNIQUE%client_operation_id%';

  IF v_indexdef IS NULL THEN
    RAISE EXCEPTION 'TEST 2 FAILED: no unique index on pickup_scans covers client_operation_id';
  END IF;
  IF v_indexdef NOT ILIKE '%operator_id%' THEN
    RAISE EXCEPTION 'TEST 2 FAILED: unique index on client_operation_id does not include operator_id — % ', v_indexdef;
  END IF;
  IF v_indexdef NOT ILIKE '%WHERE%client_operation_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST 2 FAILED: unique index is not partial on client_operation_id IS NOT NULL — %', v_indexdef;
  END IF;
  IF v_indexdef NOT ILIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'TEST 2 FAILED: unique index does not exclude soft-deleted rows — %', v_indexdef;
  END IF;
END $$;
SELECT pass('TEST 2 PASSED: unique partial index on (operator_id, client_operation_id) WHERE client_operation_id IS NOT NULL AND deleted_at IS NULL');

-- =============================================================================
-- TEST 3-5 — the retry itself: same client_operation_id, second insert
-- rejected with 23505 (not P0002 — a plain unique_violation, no custom
-- ERRCODE needed since this is a bare INSERT, not an RPC), exactly one row
-- survives, and the manifest's verified count (what close_manifest computes
-- for 5f/5i) is unaffected by the rejected retry.
-- =============================================================================
INSERT INTO public.pickup_scans (
  operator_id, manifest_id, package_id, barcode_scanned, scan_result,
  scanned_at, client_operation_id
) VALUES (
  '00000000-0000-4000-8000-000000008100',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
  '00000000-0000-4000-8000-000000008140', 'CTN81-1', 'verified', NOW(),
  '00000000-0000-4000-8000-000000008199'
);

SELECT throws_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES (
       '00000000-0000-4000-8000-000000008100',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
       '00000000-0000-4000-8000-000000008140', 'CTN81-1', 'verified', NOW(),
       '00000000-0000-4000-8000-000000008199'
     ) $$,
  '23505',
  NULL, -- Postgres's own constraint-violation text, not a sentinel this
        -- migration controls (this INSERT is not behind an RPC) — only
        -- the ERRCODE is the contract the offline queue relies on.
  'a retried scan (same client_operation_id) is rejected as a unique_violation — 409 under PostgREST, never P0002/404'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.pickup_scans
    WHERE operator_id = '00000000-0000-4000-8000-000000008100'
      AND client_operation_id = '00000000-0000-4000-8000-000000008199'
      AND deleted_at IS NULL),
  1,
  'the retried scan leaves exactly one row, not two'
);

SELECT is(
  (SELECT COUNT(DISTINCT ps.package_id)::int
     FROM public.pickup_scans ps
    WHERE ps.manifest_id = (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1')
      AND ps.scan_result = 'verified'
      AND ps.deleted_at IS NULL),
  1,
  'the manifest''s verified-package count (what close_manifest reports for 5f/5i) is not inflated by the rejected retry'
);

-- =============================================================================
-- TEST 6 — the same client_operation_id is NOT globally unique: it is
-- scoped by operator_id (repo non-negotiable: operator_id in every key),
-- so two different operators legitimately generating the same UUID (or one
-- operator's device colliding with another's by construction of a test)
-- must not block each other.
-- =============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES (
       '00000000-0000-4000-8000-000000008101',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1' LIMIT 1),
       NULL, 'CTN-OTRO', 'not_found', NOW(),
       '00000000-0000-4000-8000-000000008199'
     ) $$,
  'the same client_operation_id under a DIFFERENT operator_id does not collide — the unique key is per-operator'
);

-- =============================================================================
-- TEST 7 — multiple NULL client_operation_id values (pre-existing rows, or
-- any write path that does not set it) never collide with each other.
-- =============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at
     ) VALUES
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      NULL, 'CTN-SIN-ID-1', 'not_found', NOW()),
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      NULL, 'CTN-SIN-ID-2', 'not_found', NOW())
  $$,
  'two rows with client_operation_id IS NULL do not collide with each other'
);

-- =============================================================================
-- TEST 8-9 — a soft-deleted scan's id can be reused; the deleted row itself
-- stays untouched (it is evidence, soft-deleted not erased).
-- =============================================================================
UPDATE public.pickup_scans
   SET deleted_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000008100'
   AND client_operation_id = '00000000-0000-4000-8000-000000008199';

SELECT lives_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES (
       '00000000-0000-4000-8000-000000008100',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
       '00000000-0000-4000-8000-000000008140', 'CTN81-1', 'verified', NOW(),
       '00000000-0000-4000-8000-000000008199'
     ) $$,
  'a client_operation_id freed by a soft-delete can be reused'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.pickup_scans
    WHERE operator_id = '00000000-0000-4000-8000-000000008100'
      AND client_operation_id = '00000000-0000-4000-8000-000000008199'),
  2,
  'the soft-deleted row is preserved as evidence, not erased — two rows total, one live'
);

SELECT * FROM finish();
ROLLBACK;
