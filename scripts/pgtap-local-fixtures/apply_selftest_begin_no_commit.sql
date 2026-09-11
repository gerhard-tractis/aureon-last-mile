-- Self-test fixture for scripts/pgtap-local.sh's `apply` — round 6 review,
-- item 1. A top-level BEGIN; with no matching top-level COMMIT; leaves
-- that transaction open; psql disconnects, Postgres rolls it back. This
-- migration is recorded as "applied" with a real hash anyway (same
-- accepted-risk behavior as infra/supabase-qa/apply-migrations.sh, which
-- this fixture's expected WARNING text is copied from verbatim) — the
-- fix here is the WARNING, not preventing the false-green.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_widget3() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 11 $$;
