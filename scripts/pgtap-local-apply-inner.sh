#!/bin/bash
# Runs INSIDE the pgtap-local.sh docker container (copied there by the
# `apply` case of scripts/pgtap-local.sh — not meant to be run directly on
# the host). Applies each not-yet-applied migration exactly once, tracked
# in supabase_migrations.schema_migrations by version AND content hash —
# see scripts/pgtap-local.sh's header comment and
# docs/runbooks/pgtap-mutation-testing.md for why.
set -uo pipefail
PSQL=(psql -U postgres -d postgres)

# A failed ledger query (psql itself erroring — connection drop, bad
# state) must not be silently read as "no hash recorded" / unverified.
# Check $? in the CALLING shell right after each command substitution (a
# helper function's own `exit` would only kill the subshell the
# substitution creates, not this script).

# These three migrations fail on the stock supabase/postgres image for
# base-image fidelity gaps unrelated to this repo (a buckets.public
# column the image never creates), not fixable by `apply`. Each entry is
# "filename|expected error substring", matched with `test`/`grep -F` (no
# globbing) — filename narrows WHICH file may fail, substring narrows
# WHAT failure is allowed; a real new failure in either file, or a
# different error in the same file, is never silently waved through. A
# fourth entry lived here for spec30_dashboard_rpcs.sql (its error text
# depended on migration-application order — see git history / the round
# 5 PR review for the full story); fixed at the cause (`-1`, below) and
# removed, not patched.
KNOWN_BASE_IMAGE_FAILURES=(
  '20250130165844_example_storage.sql|column "public" of relation "buckets" does not exist'
  '20260430000001_create_manifests_storage_bucket.sql|column "public" of relation "buckets" does not exist'
  '20261007000001_spec93_fase3b_create_raw_files_bucket.sql|column "public" of relation "buckets" does not exist'
)
# PGTAP_APPLY_TEST_ALLOWLIST_ENTRY: the self-test's own throwaway
# "name|substring" entry, never touching the real list above. Restricted
# BY CONSTRUCTION, not just a warning: every real migration filename
# starts with a 20YYMMDDHHMMSS timestamp; every self-test fixture that
# uses this variable is in the 9999999999xx sentinel range instead. A
# name outside that range is refused outright — checked on the NAME'S
# SHAPE, not disk presence, because the self-test's own fixtures DO exist
# on disk (that's how they exercise real error-text matching).
if [ -n "${PGTAP_APPLY_TEST_ALLOWLIST_ENTRY:-}" ]; then
  test_entry_name="${PGTAP_APPLY_TEST_ALLOWLIST_ENTRY%%|*}"
  test_entry_ver="${test_entry_name%%_*}"
  case "$test_entry_ver" in
    9999999999*) : ;;
    *)
      echo "ERROR: PGTAP_APPLY_TEST_ALLOWLIST_ENTRY names '$test_entry_name' — its version ($test_entry_ver) is outside the 9999999999xx test-only sentinel range, so it could be (or become) a real migration filename. Refusing." >&2
      exit 1
      ;;
  esac
  echo "WARNING: PGTAP_APPLY_TEST_ALLOWLIST_ENTRY is set — appending a throwaway allowlist entry: $PGTAP_APPLY_TEST_ALLOWLIST_ENTRY" >&2
  KNOWN_BASE_IMAGE_FAILURES+=("$PGTAP_APPLY_TEST_ALLOWLIST_ENTRY")
fi
# Round 5 review (medium): a malformed entry — no '|' separator, or an
# empty expected-error text — silently degrades this whole guard back to
# filename-only matching. `expect="${entry#*|}"` with no '|' in $entry
# leaves $expect equal to $entry itself (the filename, with its .sql
# extension) — and the line `apply` greps that against ALWAYS contains the
# full path, so it always matches. Reject any malformed entry loudly, up
# front, rather than let it match everything.
for entry in "${KNOWN_BASE_IMAGE_FAILURES[@]}"; do
  case "$entry" in
    *'|'*) ;;
    *)
      echo "ERROR: malformed KNOWN_BASE_IMAGE_FAILURES entry (no '|' separator between filename and expected error text): $entry" >&2
      exit 1
      ;;
  esac
  if [ -z "${entry#*|}" ]; then
    echo "ERROR: malformed KNOWN_BASE_IMAGE_FAILURES entry (empty expected error text): $entry" >&2
    exit 1
  fi
done
ALLOWLIST_MATCHED=()  # round 4 review, item 5: which entries actually fired this run
is_known_failure() { # $1 = basename, $2 = the captured ERROR: line
  local b="$1" errline="$2" entry name expect
  local i=0
  for entry in "${KNOWN_BASE_IMAGE_FAILURES[@]}"; do
    name="${entry%%|*}"
    expect="${entry#*|}"
    if [ "$b" = "$name" ]; then
      if printf '%s' "$errline" | grep -qF -- "$expect"; then
        ALLOWLIST_MATCHED+=("$i")
        return 0
      fi
      return 1  # filename matches, error text doesn't — NOT known, real failure
    fi
    i=$((i+1))
  done
  return 1
}

applied=0; skipped=0; changed=0; unverified=0; fail=0; fail_unexpected=0
KNOWN="/tmp/pgtap-apply-known-versions.$$"
: > "$KNOWN"
for f in $(ls /supabase/migrations/*.sql | sort); do
  base=$(basename "$f"); ver="${base%%_*}"
  echo "$ver" >> "$KNOWN"
  hash=$(sha256sum "$f" | awk '{print $1}')
  # Note: -c doesn't do psql's :'var' interpolation (that's -f/stdin only) —
  # plain shell interpolation instead, matching this file's existing style.
  # Values are filename-derived (digits/letters/underscores) or a hex hash,
  # never arbitrary input.
  exists=$("${PSQL[@]}" -tAc "select count(*) from supabase_migrations.schema_migrations where version = '$ver'")
  if [ $? -ne 0 ]; then
    echo "ERROR: ledger query failed for version $ver (psql did not exit 0) — aborting, not guessing what state the database is in." >&2
    exit 1
  fi
  do_apply=0
  if [ "$exists" = "0" ]; then
    do_apply=1
  elif [ -n "${FORCE_VERSION:-}" ] && [ "$ver" = "$FORCE_VERSION" ]; then
    echo "forcing:     $base (already applied — re-applying by request)"
    do_apply=1
  else
    stored=$("${PSQL[@]}" -tAc "select coalesce(content_sha256,'') from supabase_migrations.schema_migrations where version = '$ver'")
    if [ $? -ne 0 ]; then
      echo "ERROR: ledger query failed for version $ver (psql did not exit 0) — aborting, not guessing what state the database is in." >&2
      exit 1
    fi
    case "$stored" in
      "")
        # Round 2 review (B1) + round 3 review (B2): a NULL/absent hash is
        # an UNVERIFIED baseline, not a "matches, skip". Round 2 backfilled
        # it as a plain hash, which silently became "verified" on the VERY
        # NEXT run — the false-green moved one step later, still reachable
        # in exactly two `apply` invocations. Mark it with a persistent
        # "unverified:" prefix instead: it stays noisy on every future run
        # until `up` gives it a real baseline (see the elif right below).
        "${PSQL[@]}" -q -c "update supabase_migrations.schema_migrations set content_sha256 = 'unverified:$hash' where version = '$ver'" >/dev/null
        # Round 4 review (B2, documentation): DON'T claim there's no local
        # fix — 'apply --force <version>' genuinely resolves one row (it
        # re-runs the file and records a real, non-prefixed hash), verified
        # against a live object. 'up' resolves the whole container at once
        # but is NOT free on a container others share — see the runbook.
        echo "WARNING: $base has no recorded content hash (pre-existing row, applied before this guard existed) — cannot verify the live database matches this file. Marked UNVERIFIED, persistently: this keeps warning on every future run, it does not go quiet after one backfill. Resolve THIS row with 'apply --force $ver' (re-applies and re-verifies just this migration — see docs/runbooks/pgtap-mutation-testing.md on why that isn't free), or rebuild everything with 'bash ./scripts/pgtap-local.sh up' if you're the only one using this container." >&2
        unverified=$((unverified+1)); continue
        ;;
      unverified:*)
        # Round 4 review, item 6: a plain "still unverified" message loses
        # the more specific "and it ALSO changed" signal — compare the
        # hash recorded alongside the marker, not just detect the prefix.
        prior_hash="${stored#unverified:}"
        if [ "$prior_hash" != "$hash" ]; then
          echo "WARNING: $base is still UNVERIFIED, AND changed again since being marked unverified — run 'bash ./scripts/pgtap-local.sh apply --force $ver' to resolve it, or 'up' if you're the only user of this container." >&2
        else
          echo "WARNING: $base is still UNVERIFIED (marked by a previous run, no confirmed baseline exists) — run 'bash ./scripts/pgtap-local.sh apply --force $ver' to resolve it, or 'up' if you're the only user of this container. Not treated as a match just because a run has gone by." >&2
        fi
        unverified=$((unverified+1)); continue
        ;;
      "$hash")
        skipped=$((skipped+1)); continue
        ;;
      *)
        echo "WARNING: $base changed since it was applied (content hash differs) — SKIPPING. Use 'apply --force $ver' to re-apply." >&2
        changed=$((changed+1)); continue
        ;;
    esac
  fi
  if [ "$do_apply" = "1" ]; then
    # -1: one transaction per file, matching the Supabase CLI and
    # infra/supabase-qa/apply-migrations.sh — without it, a file that
    # relies on transaction-scoped behavior (e.g. `SET LOCAL
    # check_function_bodies = off;`, a no-op outside an explicit
    # transaction) runs as a bare sequence of statements instead. Round 5
    # review measured this: spec30_dashboard_rpcs.sql only "failed" for
    # that reason, not a real base-image gap. Same exception
    # apply-migrations.sh already carries: a file with its OWN top-level
    # BEGIN manages its own transaction — nesting psql's implicit one
    # around it is the wrong move, not the fix.
    txn_flags=(-1)
    if grep -Eqi '^[[:space:]]*BEGIN[[:space:]]*;' "$f"; then
      txn_flags=()
      # Round 6 review (medium): apply-migrations.sh carries this exact
      # warning three lines from where the BEGIN exception above was
      # copied from — a file with its own BEGIN and no matching COMMIT
      # leaves that transaction open; psql disconnects, Postgres rolls it
      # back, and this harness (like its sibling) would otherwise record
      # the version as applied with a real hash while the database holds
      # NOTHING from that file. Reproduced: CREATE TABLE inside an
      # unclosed BEGIN -> applied=1, hash recorded, to_regclass() on the
      # table -> NULL.
      if ! grep -Eqi '^[[:space:]]*COMMIT[[:space:]]*;' "$f"; then
        echo "WARNING: $base has a top-level BEGIN; but no matching top-level COMMIT;" >&2
        echo "         — its final transaction may be left open/rolled back by psql." >&2
        echo "         Review the file before trusting this migration." >&2
      fi
    fi
    if "${PSQL[@]}" -v ON_ERROR_STOP=1 -q "${txn_flags[@]}" -f "$f" >/tmp/o.log 2>&1; then
      "${PSQL[@]}" -q -c \
        "insert into supabase_migrations.schema_migrations(version,name,content_sha256) values ('$ver', '$base', '$hash')
         on conflict (version) do update set name = excluded.name, content_sha256 = excluded.content_sha256"
      applied=$((applied+1))
    else
      fail=$((fail+1))
      errline=$(grep -m1 "ERROR:" /tmp/o.log)
      if is_known_failure "$base" "$errline"; then
        echo "FAIL (known base-image gap, not blocking — see KNOWN_BASE_IMAGE_FAILURES) $base"
      else
        fail_unexpected=$((fail_unexpected+1))
        echo "FAIL $base"
      fi
      printf '%s\n' "$errline" | sed "s/^/     /"
      # Round 6 review (low, documentation): CREATE INDEX CONCURRENTLY
      # cannot run inside a transaction block, and `-1` (round 5) puts
      # every file in one. This is not a harness artifact — the Supabase
      # CLI and QA's apply-migrations.sh apply the exact same way, so a
      # CONCURRENTLY failure here means the SAME migration would fail at
      # deploy time too. Say so, since check-migration-safety.mjs rule 2
      # nudges authors toward CONCURRENTLY on large tables without saying
      # this pipeline can't run it in any environment.
      if printf '%s' "$errline" | grep -qF "cannot run inside a transaction block"; then
        echo "      (this would fail the same way via the Supabase CLI or QA's apply-migrations.sh — CONCURRENTLY cannot run inside a transaction in any environment this repo deploys through; see docs/runbooks/pgtap-mutation-testing.md)"
      fi
    fi
  fi
done

# Round 2 review (C-3): the loop above only ever looks file -> ledger. A
# ledger row whose migration file was renamed or deleted is invisible to it
# — the ledger keeps asserting a version was applied with nothing left to
# cross-check it against. Surface that explicitly, the other direction.
# Read into a variable first, not a `< <(...)` process substitution — that
# runs in its own subshell too, same trap as the helper-function issue
# above: a failed query there would go unnoticed by this script's exit code.
orphaned=0
ledger_dump=$("${PSQL[@]}" -tAc "select version||'|'||coalesce(name,'') from supabase_migrations.schema_migrations")
if [ $? -ne 0 ]; then
  echo "ERROR: ledger dump query failed (psql did not exit 0) — aborting, not guessing." >&2
  exit 1
fi
while IFS='|' read -r ov on; do
  [ -z "$ov" ] && continue
  if ! grep -Fxq -- "$ov" "$KNOWN"; then
    echo "WARNING: ledger has version $ov ($on) recorded as applied, but no matching file exists in /supabase/migrations now — renamed or deleted migration. The ledger cannot be re-verified against it." >&2
    orphaned=$((orphaned+1))
  fi
done <<< "$ledger_dump"
rm -f "$KNOWN"

# Round 4 review (item 5): an allowlist entry nobody's SEEN fire this run is
# either fixed upstream (remove it) or the error text drifted (update it) —
# either way it's silently still covering that filename, and with the B1
# fix above, a wrong/stale entry means a real new failure in that exact
# file would be waved through. Say so every time one goes unused, not just
# when it's convenient to notice.
i=0
for entry in "${KNOWN_BASE_IMAGE_FAILURES[@]}"; do
  if ! printf '%s\n' "${ALLOWLIST_MATCHED[@]:-}" | grep -qFx -- "$i"; then
    echo "NOTE: KNOWN_BASE_IMAGE_FAILURES entry never matched this run: ${entry%%|*} — either the underlying gap is gone (remove the entry) or its error text drifted (update it). It is still silently covering that filename." >&2
  fi
  i=$((i+1))
done

echo "migrations: applied=$applied skipped=$skipped changed=$changed unverified=$unverified orphaned=$orphaned failed=$fail"
# Round 2/3 review (B1/B2): the three exit codes are not equal in risk.
#   - changed > 0:    drift DETECTED — the mutant/edit did NOT reach the
#                      database, and the warning above names the fix
#                      (apply --force). Safe outcome, still non-zero so a
#                      caller checking only the exit code notices.
#   - unverified > 0: the DANGEROUS one — nothing here could be verified at
#                      all, and round 2's silent-after-one-run backfill was
#                      exactly the false-green this whole fix exists to
#                      close. Also non-zero.
#   - failed > 0:     only migrations NOT on the known-base-image-gap
#                      allowlist above make this non-zero. The repro that
#                      motivated this whole PR was literally
#                      "applied=0 skipped=203 failed=3" with rc=0 — but
#                      three OF those three failures are this harness's own
#                      known gaps, not new breakage, and forcing `up` (which
#                      ends with `apply`) to fail on every machine, forever,
#                      teaches everyone to bolt on `|| true` — which quietly
#                      cancels this entire guard.
if [ "$fail_unexpected" -gt 0 ] || [ "$changed" -gt 0 ] || [ "$unverified" -gt 0 ]; then
  exit 1
fi
