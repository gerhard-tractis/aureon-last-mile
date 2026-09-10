-- Self-test fixture for scripts/pgtap-local.sh's `apply` content-hash guard.
-- "Original" version: the function returns 42.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_widget() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 42 $$;
