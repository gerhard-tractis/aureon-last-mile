-- spec-70 phase 1 (1 of 2) — new route_status_enum values.
--
-- This file adds enum labels and does NOTHING else, on purpose. PostgreSQL
-- refuses to *use* an enum value in the same transaction that added it:
--
--   ERROR: unsafe use of new value "dispatched" of enum type route_status_enum
--
-- The Supabase CLI wraps each migration file in its own transaction, so the
-- remap of existing rows onto these labels has to live in a separate file that
-- runs afterwards — 20260825000002. Merging the two back into one file will
-- fail at deploy time, not at review time.
--
-- Ordering note, carried forward from 20260324000001: that migration added
-- 'draft' with a bare ADD VALUE and no BEFORE clause, so 'draft' sorts *last*
-- in pg_enum despite spec-15's text claiming otherwise. These four labels
-- inherit the same property. Nothing may ORDER BY a route_status_enum column
-- and expect lifecycle order; sort with an explicit CASE. The test suite
-- asserts this is not relied upon.

ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'loading';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'loaded';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'dispatched';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'in_transit';
