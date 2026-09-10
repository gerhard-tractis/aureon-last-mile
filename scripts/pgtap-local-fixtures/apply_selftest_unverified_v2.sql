-- Self-test fixture for scripts/pgtap-local.sh's `apply` — round 4 review,
-- item 6: a row already marked "unverified:<hash>" that changes AGAIN must
-- say so specifically, not just repeat the generic "still UNVERIFIED"
-- message. Content is irrelevant beyond being different from
-- apply_selftest_unverified.sql.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
CREATE OR REPLACE FUNCTION public.pgtap_apply_selftest_widget2() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 9 $$;
