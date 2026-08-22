-- =============================================================================
-- spec-65 Task 1: public.order_sla_status test suite
--
-- The SQL half of the SLA parity check. Every case here matches, by name, a
-- case in apps/frontend/src/lib/orders/sla-cases.ts, which drives the
-- TypeScript authority (`classifyRisk`) over the same inputs. Adding a case
-- means adding it to BOTH files — that duplication is deliberate: it is the
-- guard against the two implementations of the SLA rule drifting apart.
--
-- NOT run by CI (.github/workflows/ci.yml runs lint, type-check, vitest and
-- build only — no local Postgres). Run on demand from packages/database/:
--
--   npx supabase test db
--
-- order_sla_status takes plain scalar columns, not a row, so this file needs
-- no orders/packages fixtures — each test is a single query against a fixed
-- "now" of 2026-08-22T12:00:00 (TIMESTAMP, no timezone — see the migration's
-- header comment), matching NOW_ISO in sla-cases.ts.
--
-- All tests run inside a transaction rolled back at the end, so nothing is
-- left behind. Each test uses SAVEPOINT / ROLLBACK TO so a failing assertion
-- (RAISE EXCEPTION) does not abort the tests that follow it.
-- =============================================================================

BEGIN;

-- TEST: no_window — no delivery window at all → none
SAVEPOINT test_no_window;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, NULL, NULL,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'none' AND v_minutes = 0 THEN
    RAISE NOTICE '✓ no_window PASSED';
  ELSE
    RAISE EXCEPTION 'no_window FAILED: expected (none, 0), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_no_window;

-- TEST: already_delivered — delivered, even with a long-past window → none
SAVEPOINT test_already_delivered;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    NULL, NULL, NULL,
    '2020-01-01 09:30:00'::timestamp, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'none' AND v_minutes = 0 THEN
    RAISE NOTICE '✓ already_delivered PASSED';
  ELSE
    RAISE EXCEPTION 'already_delivered FAILED: expected (none, 0), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_already_delivered;

-- TEST: late_by_one_minute
SAVEPOINT test_late_by_one_minute;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '11:00:00'::time, '11:59:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'late' AND v_minutes = -1 THEN
    RAISE NOTICE '✓ late_by_one_minute PASSED';
  ELSE
    RAISE EXCEPTION 'late_by_one_minute FAILED: expected (late, -1), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_late_by_one_minute;

-- TEST: late_by_large_margin
SAVEPOINT test_late_by_large_margin;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '00:00:00'::time, '00:00:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'late' AND v_minutes = -720 THEN
    RAISE NOTICE '✓ late_by_large_margin PASSED';
  ELSE
    RAISE EXCEPTION 'late_by_large_margin FAILED: expected (late, -720), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_late_by_large_margin;

-- TEST: late_from_previous_day
SAVEPOINT test_late_from_previous_day;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-21'::date, '19:00:00'::time, '20:00:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'late' AND v_minutes = -960 THEN
    RAISE NOTICE '✓ late_from_previous_day PASSED';
  ELSE
    RAISE EXCEPTION 'late_from_previous_day FAILED: expected (late, -960), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_late_from_previous_day;

-- TEST: at_risk_boundary_exactly — exactly 360 minutes remaining → at_risk
-- (the case that matters most: classifyRisk uses <=, not <)
SAVEPOINT test_at_risk_boundary_exactly;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '17:00:00'::time, '18:00:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'at_risk' AND v_minutes = 360 THEN
    RAISE NOTICE '✓ at_risk_boundary_exactly PASSED';
  ELSE
    RAISE EXCEPTION 'at_risk_boundary_exactly FAILED: expected (at_risk, 360), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_at_risk_boundary_exactly;

-- TEST: one_minute_past_boundary — 361 minutes remaining → ok
SAVEPOINT test_one_minute_past_boundary;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '17:01:00'::time, '18:01:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'ok' AND v_minutes = 361 THEN
    RAISE NOTICE '✓ one_minute_past_boundary PASSED';
  ELSE
    RAISE EXCEPTION 'one_minute_past_boundary FAILED: expected (ok, 361), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_one_minute_past_boundary;

-- TEST: comfortably_at_risk
SAVEPOINT test_comfortably_at_risk;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '13:30:00'::time, '14:00:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'at_risk' AND v_minutes = 120 THEN
    RAISE NOTICE '✓ comfortably_at_risk PASSED';
  ELSE
    RAISE EXCEPTION 'comfortably_at_risk FAILED: expected (at_risk, 120), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_comfortably_at_risk;

-- TEST: comfortably_ok_tomorrow
SAVEPOINT test_comfortably_ok_tomorrow;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-23'::date, '11:00:00'::time, '12:00:00'::time,
    NULL, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'ok' AND v_minutes = 1440 THEN
    RAISE NOTICE '✓ comfortably_ok_tomorrow PASSED';
  ELSE
    RAISE EXCEPTION 'comfortably_ok_tomorrow FAILED: expected (ok, 1440), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_comfortably_ok_tomorrow;

-- TEST: complete_reschedule_overrides_original — a badly-late original
-- window is overridden by a complete reschedule
SAVEPOINT test_complete_reschedule_overrides_original;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-20'::date, '07:00:00'::time, '08:00:00'::time,
    '2026-08-22'::date, '13:00:00'::time, '14:00:00'::time,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'at_risk' AND v_minutes = 120 THEN
    RAISE NOTICE '✓ complete_reschedule_overrides_original PASSED';
  ELSE
    RAISE EXCEPTION 'complete_reschedule_overrides_original FAILED: expected (at_risk, 120), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_complete_reschedule_overrides_original;

-- TEST: partial_reschedule_ignored — only rescheduled_delivery_date is set;
-- the other two reschedule columns are NULL, so the original window applies
SAVEPOINT test_partial_reschedule_ignored;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-22'::date, '13:30:00'::time, '14:00:00'::time,
    '2026-08-25'::date, NULL, NULL,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'at_risk' AND v_minutes = 120 THEN
    RAISE NOTICE '✓ partial_reschedule_ignored PASSED';
  ELSE
    RAISE EXCEPTION 'partial_reschedule_ignored FAILED: expected (at_risk, 120), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_partial_reschedule_ignored;

-- TEST: reschedule_itself_late — a complete reschedule whose new window is
-- itself already in the past
SAVEPOINT test_reschedule_itself_late;
DO $$
DECLARE v_status TEXT; v_minutes INT;
BEGIN
  SELECT sla_status, minutes_remaining INTO v_status, v_minutes
  FROM public.order_sla_status(
    '2026-08-23'::date, '11:00:00'::time, '12:00:00'::time,
    '2026-08-21'::date, '08:00:00'::time, '09:00:00'::time,
    NULL, '2026-08-22 12:00:00'::timestamp
  );

  IF v_status = 'late' AND v_minutes = -1620 THEN
    RAISE NOTICE '✓ reschedule_itself_late PASSED';
  ELSE
    RAISE EXCEPTION 'reschedule_itself_late FAILED: expected (late, -1620), got (%, %)', v_status, v_minutes;
  END IF;
END $$;
ROLLBACK TO test_reschedule_itself_late;

-- =============================================================================
-- Summary
-- =============================================================================
DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All order_sla_status tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
