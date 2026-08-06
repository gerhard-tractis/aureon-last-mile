-- =============================================================================
-- spec-49 Story 2: orders.dispatch_guide_url column + null-overwrite guard
-- Purpose: Verify the column shape and the BEFORE UPDATE trigger that stops
--          an incoming NULL dispatch_guide_url from wiping a stored URL —
--          both for the webhook re-delivery case and (per the spec's
--          accepted trade-off) any other plain UPDATE on the table.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
--
-- All tests execute inside a transaction that is rolled back at the end so
-- the database is left clean. Each test raises NOTICE on pass and EXCEPTION
-- (which aborts the current sub-transaction) on fail. The surrounding
-- SAVEPOINT/ROLLBACK TO pattern lets subsequent tests continue even when one
-- fails.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared test fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000049', 'Test Op 49', 'test-op-49', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: column exists, type text, nullable
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_data_type TEXT;
  v_is_nullable TEXT;
BEGIN
  SELECT data_type, is_nullable
    INTO v_data_type, v_is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'orders'
     AND column_name = 'dispatch_guide_url';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'TEST 1 FAILED: orders.dispatch_guide_url column does not exist';
  END IF;

  IF v_data_type != 'text' OR v_is_nullable != 'YES' THEN
    RAISE EXCEPTION 'TEST 1 FAILED: expected type=text nullable=YES, got type=% nullable=%',
      v_data_type, v_is_nullable;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: dispatch_guide_url is a nullable text column';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: UPDATE with dispatch_guide_url = NULL preserves a stored URL
--         (the webhook re-delivery-without-url_guia case)
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_after TEXT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
    dispatch_guide_url)
  VALUES ('eeee0001-0000-0000-0000-000000000049', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000049',
    'T49-ORD-001', 'Cliente Uno', '+56900000001', 'Calle Norte 1', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'API', now(),
    'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=abc123');

  -- Simulate a webhook re-delivery that maps despacho.url_guia || null → NULL
  UPDATE public.orders
     SET dispatch_guide_url = NULL
   WHERE id = 'eeee0001-0000-0000-0000-000000000049';

  SELECT dispatch_guide_url INTO v_after
    FROM public.orders WHERE id = 'eeee0001-0000-0000-0000-000000000049';

  IF v_after IS DISTINCT FROM 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=abc123' THEN
    RAISE EXCEPTION 'TEST 2 FAILED: expected stored URL preserved, got %', v_after;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: UPDATE with NULL dispatch_guide_url preserves the stored value';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a later non-null URL overwrites normally
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_after TEXT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
    dispatch_guide_url)
  VALUES ('eeee0002-0000-0000-0000-000000000049', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000049',
    'T49-ORD-002', 'Cliente Dos', '+56900000002', 'Calle Norte 2', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'API', now(),
    'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=old');

  UPDATE public.orders
     SET dispatch_guide_url = 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=new'
   WHERE id = 'eeee0002-0000-0000-0000-000000000049';

  SELECT dispatch_guide_url INTO v_after
    FROM public.orders WHERE id = 'eeee0002-0000-0000-0000-000000000049';

  IF v_after IS DISTINCT FROM 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=new' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: expected new URL to overwrite old one, got %', v_after;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: a later non-null URL overwrites the stored value';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: non-webhook UPDATE (any plain UPDATE that nulls the column, even
--         one also touching unrelated columns) cannot clear a stored URL —
--         pins the table-wide behavior called out as an accepted trade-off
--         in the spec.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_after_url  TEXT;
  v_after_name TEXT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
    dispatch_guide_url)
  VALUES ('eeee0003-0000-0000-0000-000000000049', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000049',
    'T49-ORD-003', 'Cliente Tres', '+56900000003', 'Calle Norte 3', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(),
    'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=keepme');

  -- An unrelated admin-UI style UPDATE that (incorrectly, or via a blanket
  -- upsert) also sets dispatch_guide_url = NULL alongside another column.
  UPDATE public.orders
     SET customer_name = 'Cliente Tres Editado',
         dispatch_guide_url = NULL
   WHERE id = 'eeee0003-0000-0000-0000-000000000049';

  SELECT dispatch_guide_url, customer_name INTO v_after_url, v_after_name
    FROM public.orders WHERE id = 'eeee0003-0000-0000-0000-000000000049';

  IF v_after_url IS DISTINCT FROM 'http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=keepme' THEN
    RAISE EXCEPTION 'TEST 4 FAILED: expected stored URL preserved across non-webhook UPDATE, got %', v_after_url;
  END IF;

  IF v_after_name IS DISTINCT FROM 'Cliente Tres Editado' THEN
    RAISE EXCEPTION 'TEST 4 FAILED: unrelated column update should still apply, got %', v_after_name;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: a plain UPDATE cannot null out a stored dispatch_guide_url (table-wide guard)';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- Summary
-- =============================================================================
DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec-49 dispatch_guide_url tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
