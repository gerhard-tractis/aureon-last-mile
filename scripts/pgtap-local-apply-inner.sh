#!/bin/bash
# Runs INSIDE the pgtap-local.sh docker container (copied there by the
# `apply` case of scripts/pgtap-local.sh — not meant to be run directly on
# the host). Applies each not-yet-applied migration exactly once, tracked
# in supabase_migrations.schema_migrations by version AND content hash —
# see scripts/pgtap-local.sh's header comment for why the hash exists.
set -uo pipefail
PSQL=(psql -U postgres -d postgres)
applied=0; skipped=0; changed=0; unverified=0; fail=0
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
  do_apply=0
  if [ "$exists" = "0" ]; then
    do_apply=1
  elif [ -n "${FORCE_VERSION:-}" ] && [ "$ver" = "$FORCE_VERSION" ]; then
    echo "forcing:     $base (already applied — re-applying by request)"
    do_apply=1
  else
    stored=$("${PSQL[@]}" -tAc "select coalesce(content_sha256,'') from supabase_migrations.schema_migrations where version = '$ver'")
    if [ -z "$stored" ]; then
      # Round 2 review (B1): a NULL/absent hash is an UNVERIFIED baseline,
      # not a "matches, skip" — silently trusting whatever is on disk right
      # now as "the original" is exactly the false-green this PR exists to
      # close, just moved one step earlier: it would canonize a mutant
      # forever the very first time apply runs against a pre-existing
      # container. Warn loudly, backfill the hash so FUTURE runs CAN detect
      # drift, but count it apart from a real verified match.
      echo "WARNING: $base has no recorded content hash (pre-existing row, applied before this guard existed) — cannot verify the live database matches this file. Backfilling the hash now so future runs detect drift, but THIS run does not prove it. The only fully trustworthy baseline is './scripts/pgtap-local.sh up' (rebuild the container from scratch) before mutation-testing against it." >&2
      "${PSQL[@]}" -q -c "update supabase_migrations.schema_migrations set content_sha256 = '$hash' where version = '$ver'" >/dev/null
      unverified=$((unverified+1)); continue
    elif [ "$stored" = "$hash" ]; then
      skipped=$((skipped+1)); continue
    else
      echo "WARNING: $base changed since it was applied (content hash differs) — SKIPPING. Use 'apply --force $ver' to re-apply." >&2
      changed=$((changed+1)); continue
    fi
  fi
  if [ "$do_apply" = "1" ]; then
    if "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/o.log 2>&1; then
      "${PSQL[@]}" -q -c \
        "insert into supabase_migrations.schema_migrations(version,name,content_sha256) values ('$ver', '$base', '$hash')
         on conflict (version) do update set name = excluded.name, content_sha256 = excluded.content_sha256"
      applied=$((applied+1))
    else
      fail=$((fail+1)); echo "FAIL $base"; grep -m1 "ERROR:" /tmp/o.log | sed "s/^/     /"
    fi
  fi
done

# Round 2 review (C-3): the loop above only ever looks file -> ledger. A
# ledger row whose migration file was renamed or deleted is invisible to it
# — the ledger keeps asserting a version was applied with nothing left to
# cross-check it against. Surface that explicitly, the other direction.
orphaned=0
while IFS='|' read -r ov on; do
  [ -z "$ov" ] && continue
  if ! grep -Fxq -- "$ov" "$KNOWN"; then
    echo "WARNING: ledger has version $ov ($on) recorded as applied, but no matching file exists in /supabase/migrations now — renamed or deleted migration. The ledger cannot be re-verified against it." >&2
    orphaned=$((orphaned+1))
  fi
done < <("${PSQL[@]}" -tAc "select version||'|'||coalesce(name,'') from supabase_migrations.schema_migrations")
rm -f "$KNOWN"

echo "migrations: applied=$applied skipped=$skipped changed=$changed unverified=$unverified orphaned=$orphaned failed=$fail"
# Round 2 review (B2): the repro that motivated this whole fix was
# literally "applied=0 skipped=203 failed=3" with a silent rc=0 — a
# migration that fails to apply, or a version whose file changed underneath
# it and got skipped, must not look identical to a clean run to anything
# checking the EXIT CODE (not grepping stderr, which most callers don't).
if [ "$fail" -gt 0 ] || [ "$changed" -gt 0 ]; then
  exit 1
fi
