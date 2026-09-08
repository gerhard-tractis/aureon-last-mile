#!/usr/bin/env bash
#
# check-migration-safety.sh (spec-87 fase 5) — thin wrapper around
# check-migration-safety.mjs, matching the bash-entrypoint convention of the
# other CI guards in this dir (check-deploy-gating.sh, check-quarantine.sh).
#
# Usage: bash scripts/check-migration-safety.sh <migrations-dir-or-file> [...]
set -euo pipefail

exec node "$(dirname "$0")/check-migration-safety.mjs" "$@"
