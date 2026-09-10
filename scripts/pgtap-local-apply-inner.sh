#!/bin/bash
# Runs INSIDE the pgtap-local.sh docker container (copied there by the
# `apply` case of scripts/pgtap-local.sh — not meant to be run directly on
# the host). Applies each not-yet-applied migration exactly once, tracked
# in supabase_migrations.schema_migrations by version AND content hash —
# see scripts/pgtap-local.sh's header comment for why the hash exists.
set -uo pipefail
PSQL=(psql -U postgres -d postgres)
applied=0; skipped=0; changed=0; fail=0
for f in $(ls /supabase/migrations/*.sql | sort); do
  base=$(basename "$f"); ver="${base%%_*}"
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
      # Pre-existing row from before content_sha256 existed: backfill
      # silently rather than treat every already-applied migration as
      # "changed" the first time this runs.
      "${PSQL[@]}" -q -c "update supabase_migrations.schema_migrations set content_sha256 = '$hash' where version = '$ver'" >/dev/null
      skipped=$((skipped+1)); continue
    elif [ "$stored" = "$hash" ]; then
      skipped=$((skipped+1)); continue
    else
      echo "WARNING: $base changed since it was applied (content hash differs) — SKIPPING. Use 'apply --force $ver' to re-apply." >&2
      changed=$((changed+1)); skipped=$((skipped+1)); continue
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
echo "migrations: applied=$applied skipped=$skipped changed=$changed failed=$fail"
