-- Self-test fixture for scripts/pgtap-local.sh's `apply` unverified-backfill
-- guard (round 2 review, B1). Content is irrelevant to the test itself — the
-- scenario is a ledger row inserted directly with content_sha256 = NULL,
-- simulating a migration "applied" before the content-hash guard existed.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_widget2() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 8 $$;
