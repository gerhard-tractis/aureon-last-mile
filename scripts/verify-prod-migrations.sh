#!/usr/bin/env bash
#
# verify-prod-migrations.sh — prod migration drift gate (spec-51)
#
# Reads the output of `supabase migration list --linked` on stdin and fails if
# the production migration ledger has diverged from the repo.
#
# WHY THIS EXISTS
# ---------------
# The `deploy-supabase` job in .github/workflows/deploy.yml is path-filtered, so
# it only runs when packages/database/supabase/migrations/** actually changes.
# That means a broken migration deploy stays latent until the next migration
# lands. REMEDIATION.md records this biting twice — most visibly a pinned-CLI
# break that "went undetected until PR #214". The QA environment (spec-48)
# replays the full ledger on every merge and so is always correct; production
# has no equivalent check. This is it.
#
# Reading from stdin (rather than invoking the CLI itself) keeps the parser
# testable without network or credentials — see scripts/verify-prod-migrations.test.sh
#
# EXIT CODES
#   0  ledgers match
#   1  drift detected, or the CLI output could not be parsed
#
set -euo pipefail

# Normalise the CLI's box-drawing separators to ASCII pipes, then keep only rows
# that carry a 14-digit migration timestamp in either column. The header row
# ("LOCAL | REMOTE | TIME (UTC)") and the ─── separator row both reduce to empty
# fields and drop out on their own.
parsed=$(sed 's/│/|/g' \
  | awk -F'|' '
      {
        local_col = $1; remote_col = $2
        gsub(/[^0-9]/, "", local_col)
        gsub(/[^0-9]/, "", remote_col)
        if (length(local_col) != 14) local_col = ""
        if (length(remote_col) != 14) remote_col = ""
        if (local_col == "" && remote_col == "") next
        if (local_col != "" && remote_col == "") print "LOCAL_ONLY " local_col
        else if (local_col == "" && remote_col != "") print "REMOTE_ONLY " remote_col
        else print "MATCHED " local_col
      }')

matched=$(  printf '%s\n' "$parsed" | grep -c '^MATCHED '     || true)
local_only=$(printf '%s\n' "$parsed" | grep '^LOCAL_ONLY '  || true)
remote_only=$(printf '%s\n' "$parsed" | grep '^REMOTE_ONLY ' || true)

total=$(printf '%s\n' "$parsed" | grep -c . || true)

# A gate that cannot fail is not a gate. If the CLI output format changes under
# us, parsing silently yields nothing and every run would pass vacuously — which
# is precisely the failure mode this job exists to eliminate. Treat it as drift.
if [ "$total" -eq 0 ]; then
  echo "::error::Could not parse any migration rows from 'supabase migration list' output."
  echo "The CLI output format has probably changed. This gate is not verifying anything — fix the parser."
  exit 1
fi

status=0

if [ -n "$local_only" ]; then
  echo "::error::Production is BEHIND the repo — these migrations exist in packages/database/supabase/migrations/ but are not applied to production:"
  printf '%s\n' "$local_only" | sed 's/^LOCAL_ONLY /  - /'
  echo "Fix: re-run the deploy, or apply manually with 'supabase db push --include-all'."
  status=1
fi

if [ -n "$remote_only" ]; then
  echo "::error::Production has migrations that are NOT in the repo — someone applied them by hand:"
  printf '%s\n' "$remote_only" | sed 's/^REMOTE_ONLY /  - /'
  echo "Fix: commit the missing migration files, or revert the manual change."
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "Production migration ledger matches the repo (${matched} migrations applied)."
else
  echo ""
  echo "Production schema does not match the repo. QA (spec-48) replays every"
  echo "migration on each merge, so QA is the accurate environment here — do not"
  echo "assume production matches what was signed off in QA."
fi

exit "$status"
