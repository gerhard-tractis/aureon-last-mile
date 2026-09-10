-- Self-test fixture for scripts/pgtap-local.sh's `apply` exit-code guard
-- (round 2 review, B2) — deliberately invalid SQL so `apply` records a real
-- failed=1. Used only by scripts/pgtap-local-apply.test.sh; not a real
-- migration.
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_broken() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ THIS IS NOT VALID SQL $$;
