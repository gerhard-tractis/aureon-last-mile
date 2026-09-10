-- Self-test fixture for scripts/pgtap-local.sh's `apply` allowlist guard
-- (round 4 review, B1 + item 7). RAISE EXCEPTION with an exact, chosen
-- message rather than relying on a real Postgres syntax/relation error
-- (whose wording could drift across Postgres versions) — the self-test
-- exercises PGTAP_APPLY_TEST_ALLOWLIST_ENTRY (a throwaway, impossible-to-
-- collide "name|expected substring" pair) against THIS exact text.
-- Used only by scripts/pgtap-local-apply.test.sh; not a real migration.
DO $$
BEGIN
  RAISE EXCEPTION 'pgtap apply selftest allowlist marker';
END $$;
