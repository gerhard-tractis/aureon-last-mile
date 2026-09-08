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
--
-- Round 1 of review (B1): an order-number scan
-- (apps/frontend/src/lib/pickup/scan-validator.ts's packageIds[]) writes N
-- rows — one per bulto — in a SINGLE `.insert(rows)` call
-- (usePickupScans.ts), all sharing the ONE client_operation_id fase 1 stamps
-- per queue entry (lib/offline/queue.ts). A key of
-- (operator_id, client_operation_id) alone collides with ITSELF inside that
-- one statement, on the FIRST attempt, not the retry. The key is
-- (operator_id, client_operation_id, package_id) NULLS NOT DISTINCT — the
-- modifier because package_id is NULL on a not_found/duplicate scan, and a
-- retry of THAT scan must still collide on (operator_id, coid, NULL); without
-- NULLS NOT DISTINCT, Postgres treats NULL <> NULL and the retry would
-- silently insert a second row for the same not_found/duplicate scan,
-- defeating idempotency exactly where a barcode does not resolve to a
-- package.

BEGIN;
SELECT plan(20);

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
   '00000000-0000-4000-8000-000000008120','CTN81-1','[]'::jsonb,'{}'::jsonb,'ingresado'),
  ('00000000-0000-4000-8000-000000008141','00000000-0000-4000-8000-000000008100',
   '00000000-0000-4000-8000-000000008120','CTN81-2','[]'::jsonb,'{}'::jsonb,'ingresado')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1 — the column exists and is nullable (no backfill required, no
-- NOT NULL — existing rows predate this migration).
--
-- M-6/m4 (round 2 of review): these used to be a `DO $$ … RAISE EXCEPTION
-- $$` block. A RAISE aborts the whole transaction — no `not ok` is printed,
-- `plan()` never closes, and every assertion after it (TEST 3-19 as
-- renumbered) never runs, so a mutation-test run that only mutates TEST 1/2
-- and sees the transaction abort has NOT exercised anything past them.
-- Plain pgTAP assertions (`ok`/`is`) report `not ok` on failure and let the
-- rest of the file keep running, same as every other test below.
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pickup_scans'
       AND column_name = 'client_operation_id'
  ),
  'TEST 1a: public.pickup_scans.client_operation_id exists'
);

SELECT is(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pickup_scans'
      AND column_name = 'client_operation_id'),
  'YES',
  'TEST 1b: client_operation_id is nullable (no backfill of pre-existing rows)'
);

-- =============================================================================
-- TEST 2 — a UNIQUE index covers (operator_id, client_operation_id,
-- package_id) NULLS NOT DISTINCT, partial on client_operation_id IS NOT NULL
-- AND deleted_at IS NULL. Read from pg_index directly (not just "an insert
-- fails") so a mutation that widens/narrows the predicate, drops a column,
-- or drops the NULLS NOT DISTINCT modifier is caught even before TEST 3-19
-- run.
-- =============================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'pickup_scans'
       AND indexdef ILIKE '%UNIQUE%client_operation_id%'
  ),
  'TEST 2a: a unique index on pickup_scans covers client_operation_id'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'pickup_scans'
      AND indexdef ILIKE '%UNIQUE%client_operation_id%') ILIKE '%operator_id%',
  'TEST 2b: the unique index includes operator_id'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'pickup_scans'
      AND indexdef ILIKE '%UNIQUE%client_operation_id%') ILIKE '%package_id%',
  'TEST 2c: the unique index includes package_id — a batch insert of N rows sharing one client_operation_id (order-number scan) collides with itself without it'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'pickup_scans'
      AND indexdef ILIKE '%UNIQUE%client_operation_id%') ILIKE '%NULLS NOT DISTINCT%',
  'TEST 2d: the unique index has NULLS NOT DISTINCT — a retried not_found/duplicate scan (package_id IS NULL) would not collide with itself without it'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'pickup_scans'
      AND indexdef ILIKE '%UNIQUE%client_operation_id%') ILIKE '%WHERE%client_operation_id IS NOT NULL%',
  'TEST 2e: the unique index is partial on client_operation_id IS NOT NULL'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'pickup_scans'
      AND indexdef ILIKE '%UNIQUE%client_operation_id%') ILIKE '%deleted_at IS NULL%',
  'TEST 2f: the unique index excludes soft-deleted rows'
);

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
-- M-1 (round 2 of review): package_id must be the SAME as op_A's live row
-- (…8140) — with package_id in the key, two DIFFERENT package_ids already
-- discriminate the tuples regardless of operator_id, so this assertion would
-- pass even if operator_id were dropped from the index entirely (verified:
-- mutating the index to (client_operation_id, package_id) NULLS NOT
-- DISTINCT left zero behavioral `not ok` across all 12 assertions in this
-- file — only TEST 2's textual ILIKE check on the index definition caught
-- it). Matching package_id makes operator_id the ONLY column that still
-- discriminates op_A's row from this insert, so a mutant dropping
-- operator_id from the index now fails this assertion, not just TEST 2's
-- string check.
SELECT lives_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES (
       '00000000-0000-4000-8000-000000008101',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1' LIMIT 1),
       '00000000-0000-4000-8000-000000008140', 'CTN-OTRO', 'verified', NOW(),
       '00000000-0000-4000-8000-000000008199'
     ) $$,
  'the same (client_operation_id, package_id) under a DIFFERENT operator_id does not collide — the unique key is per-operator'
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

-- =============================================================================
-- TEST 10-12 — B1: the order-number scan batch. usePickupScans.ts inserts N
-- rows (one per bulto) in a SINGLE `.insert(rows)` call, all sharing the ONE
-- client_operation_id fase 1 stamps per queue entry. That batch must succeed
-- on the FIRST attempt (package_id differentiates the rows), and the retry
-- of the SAME batch (queue resend after a lost 200) must be rejected without
-- creating any of its rows twice.
-- =============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      '00000000-0000-4000-8000-000000008140', 'ORD-81-1', 'verified', NOW(),
      '00000000-0000-4000-8000-000000008299'),
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      '00000000-0000-4000-8000-000000008141', 'ORD-81-1', 'verified', NOW(),
      '00000000-0000-4000-8000-000000008299')
  $$,
  'TEST 10: an order-number scan of 2 bultos — one client_operation_id, two rows, one INSERT — succeeds on the first attempt (package_id differentiates)'
);

SELECT throws_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      '00000000-0000-4000-8000-000000008140', 'ORD-81-1', 'verified', NOW(),
      '00000000-0000-4000-8000-000000008299'),
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      '00000000-0000-4000-8000-000000008141', 'ORD-81-1', 'verified', NOW(),
      '00000000-0000-4000-8000-000000008299')
  $$,
  '23505',
  NULL,
  'TEST 11: the queue resending the SAME order-number batch (same client_operation_id, same package_ids) is rejected as unique_violation — 409, never a silent second insert'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.pickup_scans
    WHERE operator_id = '00000000-0000-4000-8000-000000008100'
      AND client_operation_id = '00000000-0000-4000-8000-000000008299'
      AND deleted_at IS NULL),
  2,
  'TEST 12: the rejected batch retry leaves exactly the original two rows, not four'
);

-- =============================================================================
-- TEST 13 — the other half of B1: a retried not_found/duplicate scan has
-- package_id IS NULL. Without NULLS NOT DISTINCT, Postgres treats NULL <>
-- NULL and this retry would insert a second row instead of colliding.
-- =============================================================================
INSERT INTO public.pickup_scans (
  operator_id, manifest_id, package_id, barcode_scanned, scan_result,
  scanned_at, client_operation_id
) VALUES (
  '00000000-0000-4000-8000-000000008100',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
  NULL, 'CTN-NOT-FOUND', 'not_found', NOW(),
  '00000000-0000-4000-8000-000000008300'
);

SELECT throws_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES (
       '00000000-0000-4000-8000-000000008100',
       (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
       NULL, 'CTN-NOT-FOUND', 'not_found', NOW(),
       '00000000-0000-4000-8000-000000008300'
     ) $$,
  '23505',
  NULL,
  'TEST 13: a retried not_found scan (package_id IS NULL) collides with itself thanks to NULLS NOT DISTINCT — without it this insert would silently succeed'
);

-- =============================================================================
-- TEST 14 — M-3 (round 2 of review): the auto-collision that B1 fixed for
-- package_id does NOT go away in general once NULLS NOT DISTINCT is active
-- — it moves to the NULL lane. A single statement inserting TWO rows that
-- share the same client_operation_id AND both have package_id IS NULL
-- collides with ITSELF on the first attempt, exactly like the pre-B1 batch
-- did. This is real at the SQL layer (verified against the base: a 2-row
-- batch, one client_operation_id, both not_found, throws 23505 on its own
-- first INSERT). It is NOT reachable through usePickupScans.ts today:
-- scan-validator.ts's packageIds only has length > 1 on the order-number
-- branch, whose ids all come from packages.id (NOT NULL) — see
-- scan-validator.test.ts's "freezes the M-3 premise" test — and no write
-- path ever batches two not_found/duplicate results (each of those is a
-- single-row insert) under one client_operation_id. The migration header
-- and this fase's spec document this as a scoped, not general, invariant —
-- a future writer that batches not_found results (e.g. a bulk not_found
-- report) would need to generate a distinct client_operation_id per row,
-- or this collides on its own first attempt.
-- =============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.pickup_scans (
       operator_id, manifest_id, package_id, barcode_scanned, scan_result,
       scanned_at, client_operation_id
     ) VALUES
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      NULL, 'CTN-NF-A', 'not_found', NOW(),
      '00000000-0000-4000-8000-000000008400'),
     ('00000000-0000-4000-8000-000000008100',
      (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000008100' AND external_load_id = 'CARGA-81-1'),
      NULL, 'CTN-NF-B', 'not_found', NOW(),
      '00000000-0000-4000-8000-000000008400')
  $$,
  '23505',
  NULL,
  'TEST 14: a same-statement batch of two rows sharing one client_operation_id, BOTH package_id IS NULL, auto-collides on its own first attempt under NULLS NOT DISTINCT — real at the SQL layer, not reachable via usePickupScans.ts today (M-3)'
);

SELECT * FROM finish();
ROLLBACK;
