#!/usr/bin/env bash
#
# Tests for check-migration-safety.sh (spec-87 fase 5) — review round 2, B3
# and m8: `rejectedAtBase` used to be a boolean ("did THIS file violate
# anything at base?"), so any pre-existing violation exempted the file
# FOREVER — a PR could add a brand-new, unrelated unbounded UPDATE to a file
# that already had one different violation at base, and it would only warn.
# Also m8: a renamed file's git-diff line reports the NEW path in both
# columns for a plain rename, so `git show base:<path>` used to always fail
# and the guard fail-safed to "not exempt" (never crashed CI, but never
# actually compared against base either).
# Run: bash scripts/check-migration-safety-basediff.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-migration-safety.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0
fail=0

echo "check-migration-safety.sh — B3 (per-violation base diff) + m8 (rename)"

# ── B3: base already has ONE unbounded UPDATE. The PR keeps that exact
# statement AND adds two brand-new, different unbounded UPDATEs. A
# boolean/message-text compare sees "violated at base" == "violates now" and
# exempts the whole file forever — the two NEW statements must still reject.
GIT_FIXTURE="$TMP/gitrepo-b3"
mkdir -p "$GIT_FIXTURE/migrations"
(
  cd "$GIT_FIXTURE"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > migrations/0000000001_tenant_reset.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN tenant TEXT;
UPDATE public.packages SET tenant = 'a' WHERE tenant = 'a';
COMMIT;
SQL
  git add -A
  git commit -q -m base

  # Keep the original (still-bad) statement untouched, and add two BRAND
  # NEW unbounded UPDATEs that did not exist at base.
  cat > migrations/0000000001_tenant_reset.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN tenant TEXT;
UPDATE public.packages SET tenant = 'a' WHERE tenant = 'a';
UPDATE public.packages SET status = 'reset';
UPDATE public.dispatches SET stage = 'draft';
COMMIT;
SQL
  git add -A
  git commit -q -m "add two new unbounded UPDATEs alongside the old one"
)
BASE_SHA_B3=$(cd "$GIT_FIXTURE" && git rev-parse HEAD~1)
output=$(cd "$GIT_FIXTURE" && bash "$SCRIPT" --base "$BASE_SHA_B3" migrations 2>&1)
actual=$?
if [ "$actual" -eq 1 ]; then
  pass=$((pass + 1))
  echo "  ok   B3: rejects when an edited file adds NEW unbounded UPDATEs, even though one identical to base remains"
else
  fail=$((fail + 1))
  echo "  FAIL B3: did not reject — expected exit 1, got $actual (statement-identity diffing regressed to boolean/message-text)"
  printf '%s\n' "$output" | sed 's/^/         /'
fi
if printf '%s' "$output" | grep -q "::error::.*tenant_reset"; then
  pass=$((pass + 1))
  echo "  ok   B3: prints ::error:: (not just ::warning::) for the file with a genuinely new violation"
else
  fail=$((fail + 1))
  echo "  FAIL B3: expected an ::error:: naming tenant_reset.sql"
  printf '%s\n' "$output" | sed 's/^/         /'
fi

# ── B3 mirror: base already has an unbounded UPDATE, and the PR touches the
# file WITHOUT introducing any new violating statement (e.g. adds a
# statement_timeout). Must still degrade to ::warning::, not ::error:: —
# this is the "16 real M/R events since June" precedent B4 (round 1) exists
# to protect, and B3 must not regress it while fixing the boolean bug.
GIT_FIXTURE_MIRROR="$TMP/gitrepo-b3-mirror"
mkdir -p "$GIT_FIXTURE_MIRROR/migrations"
(
  cd "$GIT_FIXTURE_MIRROR"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > migrations/0000000001_already_bad.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m base

  cat > migrations/0000000001_already_bad.sql <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30min';
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m "lift statement_timeout, no new violation"
)
BASE_SHA_MIRROR=$(cd "$GIT_FIXTURE_MIRROR" && git rev-parse HEAD~1)
output_mirror=$(cd "$GIT_FIXTURE_MIRROR" && bash "$SCRIPT" --base "$BASE_SHA_MIRROR" migrations 2>&1)
actual_mirror=$?
if [ "$actual_mirror" -eq 0 ]; then
  pass=$((pass + 1))
  echo "  ok   B3 mirror: still exit 0 when the only change is unrelated (statement_timeout), no new violating statement"
else
  fail=$((fail + 1))
  echo "  FAIL B3 mirror: expected exit 0, got $actual_mirror — the per-statement diff must not over-reject"
  printf '%s\n' "$output_mirror" | sed 's/^/         /'
fi

# ── m8: a plain rename (status R, no content change) reports the NEW path in
# both the status-detail column stripping and the final column. `git show
# base:<NEW path>` always fails because the new path did not exist at base
# under that name — this used to fail-safe silently (never hard-crash, never
# actually compare) instead of resolving the OLD path via the rename record.
GIT_FIXTURE_RENAME="$TMP/gitrepo-rename"
mkdir -p "$GIT_FIXTURE_RENAME/migrations"
(
  cd "$GIT_FIXTURE_RENAME"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > migrations/0000000001_old_name.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m base

  git mv migrations/0000000001_old_name.sql migrations/0000000001_new_name.sql
  git commit -q -m "rename only, same violation"
)
BASE_SHA_RENAME=$(cd "$GIT_FIXTURE_RENAME" && git rev-parse HEAD~1)
output_rename=$(cd "$GIT_FIXTURE_RENAME" && bash "$SCRIPT" --base "$BASE_SHA_RENAME" migrations 2>&1)
actual_rename=$?
if [ "$actual_rename" -eq 0 ]; then
  pass=$((pass + 1))
  echo "  ok   m8: a pure rename (no new violating statement) does not reject — old content resolved via the OLD path"
else
  fail=$((fail + 1))
  echo "  FAIL m8: expected exit 0 for a pure rename with no new violation, got $actual_rename"
  printf '%s\n' "$output_rename" | sed 's/^/         /'
fi
if printf '%s' "$output_rename" | grep -qF "fatal:"; then
  fail=$((fail + 1))
  echo "  FAIL m8: git show against the new path under the old ref printed a fatal error — old path was not resolved"
  printf '%s\n' "$output_rename" | sed 's/^/         /'
else
  pass=$((pass + 1))
  echo "  ok   m8: no 'git show ... fatal' noise for the renamed file"
fi

# ── F4 (round 3): the base-diff Set compares `v.statement` by EXACT string
# equality. `.trim()` absorbs leading/trailing whitespace, but NOT internal
# spacing — reformatting an existing backfill (e.g. wrapping it across
# three indented lines, no semantic change) changes the trimmed string byte-
# for-byte, so the Set lookup misses and a pure reformat looks like a
# BRAND NEW violation. Real precedent this could break: 20260901000001,
# "lift statement_timeout on the two migration-time backfills" — wrapping an
# existing backfill in a SET LOCAL while reformatting it must not reject.
GIT_FIXTURE_F4="$TMP/gitrepo-f4-reformat"
mkdir -p "$GIT_FIXTURE_F4/migrations"
(
  cd "$GIT_FIXTURE_F4"
  git init -q
  git config user.email test@example.com
  git config user.name test

  cat > migrations/0000000001_reformat.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages SET foo = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m base

  # Same statement, reformatted across three indented lines — no semantic
  # change, but the trimmed text differs byte-for-byte from base.
  cat > migrations/0000000001_reformat.sql <<'SQL'
BEGIN;
ALTER TABLE public.packages ADD COLUMN foo TEXT;
UPDATE public.packages
  SET foo
    = 'bar';
COMMIT;
SQL
  git add -A
  git commit -q -m "reformat the existing backfill, no semantic change"
)
BASE_SHA_F4=$(cd "$GIT_FIXTURE_F4" && git rev-parse HEAD~1)
output_f4=$(cd "$GIT_FIXTURE_F4" && bash "$SCRIPT" --base "$BASE_SHA_F4" migrations 2>&1)
actual_f4=$?
if [ "$actual_f4" -eq 0 ]; then
  pass=$((pass + 1))
  echo "  ok   F4: a pure reformat of an existing backfill (whitespace only) does not hard-reject"
else
  fail=$((fail + 1))
  echo "  FAIL F4: expected exit 0 for a whitespace-only reformat, got $actual_f4 — statement identity is not whitespace-normalized"
  printf '%s\n' "$output_f4" | sed 's/^/         /'
fi

echo ""
echo "check-migration-safety.sh (B3 base-diff + m8 rename + F4): $pass passed, $fail failed"
[ "$fail" -eq 0 ]
