#!/usr/bin/env bash
# Fail if two migration files share a version prefix.
#
# Why this exists: on 2026-08-13 two branches each added a migration numbered
# 20260813000001 (spec-53 package labels #397, and the reception snapshot fix
# #398). Each was the highest number on its own branch when written, so neither
# author saw a conflict. `supabase_migrations.schema_migrations.version` is the
# PRIMARY KEY and is derived from that prefix, so once both were on main every
# `supabase db push --include-all` aborted with
#
#   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
#
# rolling back the whole push. Two production deploys failed and nothing shipped
# until the file was renumbered (#400).
#
# `ls | tail` tells you the highest number on YOUR branch, not the highest that
# is about to exist. Only CI, seeing the merged tree, can catch that — which is
# what this does.
set -uo pipefail

DIR="${1:-packages/database/supabase/migrations}"

[ -d "$DIR" ] || { echo "check-migration-versions: no such directory: $DIR" >&2; exit 1; }

dupes=$(ls "$DIR"/*.sql 2>/dev/null | xargs -n1 basename | sed 's/_.*//' | sort | uniq -d)

if [ -n "$dupes" ]; then
  echo "::error::Duplicate migration version prefixes found. schema_migrations.version is a PRIMARY KEY — every deploy will abort until this is fixed."
  echo ""
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    echo "  version $v is claimed by:"
    ls "$DIR"/"$v"_*.sql 2>/dev/null | xargs -n1 basename | sed 's/^/    /'
  done <<< "$dupes"
  echo ""
  echo "Fix: renumber the migration that has NOT yet been applied to production."
  echo "Check which one that is before renaming — renaming an applied migration"
  echo "makes it re-run, and the ledger will not know it already ran."
  exit 1
fi

count=$(ls "$DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')
echo "check-migration-versions: OK — $count migrations, all version prefixes unique"
