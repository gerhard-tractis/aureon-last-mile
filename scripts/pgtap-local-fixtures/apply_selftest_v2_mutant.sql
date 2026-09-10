-- Self-test fixture for scripts/pgtap-local.sh's `apply` content-hash guard.
-- "Mutant" version, same migration VERSION prefix, different content: the
-- function returns 999 instead of 42. `apply` must never apply this
-- silently under the already-applied version — it should WARN and skip,
-- and only land via `apply --force <version>`.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_widget() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 999 $$;
