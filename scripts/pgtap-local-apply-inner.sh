#!/bin/bash
# Runs INSIDE the pgtap-local.sh docker container (copied there by the
# `apply` case of scripts/pgtap-local.sh — not meant to be run directly on
# the host). Applies each not-yet-applied migration exactly once, tracked
# in supabase_migrations.schema_migrations by version AND content hash —
# see scripts/pgtap-local.sh's header comment and
# docs/runbooks/pgtap-mutation-testing.md for why.
set -uo pipefail
PSQL=(psql -U postgres -d postgres)

# Round 3 review (item 7): a failed ledger query (psql itself erroring —
# connection drop, bad state) must not be silently read as "no hash
# recorded" / unverified — that would report "all fine" on a database that
# isn't even answering. Check $? in the CALLING shell right after each
# command substitution (a helper function's own `exit` would only kill the
# subshell command substitution creates, not this script — deliberately
# inlined, not wrapped, for that reason).

# Round 3 review (B1): these three migrations fail on the stock
# supabase/postgres image for base-image fidelity gaps unrelated to this
# repo (a buckets.public column the image never creates; a
# dashboard_monthly_rollup relation this local harness never creates) — not
# introduced by this PR, not something `apply` can fix, and not new. Only
# literal filenames, never a pattern: a real NEW failure must never
# silently match this list and get waved through.
KNOWN_BASE_IMAGE_FAILURES=(
  "20250130165844_example_storage.sql"                   # buckets.public column absent from the stock image
  "20260409000003_spec30_dashboard_rpcs.sql"              # depends on dashboard_monthly_rollup, never created by this harness
  "20260430000001_create_manifests_storage_bucket.sql"    # same buckets.public gap as above
)
is_known_failure() {
  local b="$1" k
  for k in "${KNOWN_BASE_IMAGE_FAILURES[@]}"; do
    [ "$b" = "$k" ] && return 0
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
        echo "WARNING: $base has no recorded content hash (pre-existing row, applied before this guard existed) — cannot verify the live database matches this file. Marked UNVERIFIED, persistently: this keeps warning on every future run, it does not go quiet after one backfill. The only fully trustworthy baseline is './scripts/pgtap-local.sh up' (rebuild the container from scratch)." >&2
        unverified=$((unverified+1)); continue
        ;;
      unverified:*)
        echo "WARNING: $base is still UNVERIFIED (marked by a previous run, no confirmed baseline exists) — run './scripts/pgtap-local.sh up' to get a trustworthy baseline. Not treated as a match just because a run has gone by." >&2
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
    if "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/o.log 2>&1; then
      "${PSQL[@]}" -q -c \
        "insert into supabase_migrations.schema_migrations(version,name,content_sha256) values ('$ver', '$base', '$hash')
         on conflict (version) do update set name = excluded.name, content_sha256 = excluded.content_sha256"
      applied=$((applied+1))
    else
      fail=$((fail+1))
      if is_known_failure "$base"; then
        echo "FAIL (known base-image gap, not blocking — see KNOWN_BASE_IMAGE_FAILURES) $base"
      else
        fail_unexpected=$((fail_unexpected+1))
        echo "FAIL $base"
      fi
      grep -m1 "ERROR:" /tmp/o.log | sed "s/^/     /"
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
