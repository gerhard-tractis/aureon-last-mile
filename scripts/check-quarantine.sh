#!/usr/bin/env bash
#
# check-quarantine.sh (spec-87 fase 1) — thin wrapper around
# check-quarantine.mjs, matching the bash-entrypoint convention of the other
# CI guards in this dir (check-deploy-gating.sh, verify-prod-migrations.sh).
#
# Usage: bash scripts/check-quarantine.sh <quarantine.json> <playwright-report.json> [--today YYYY-MM-DD]
set -euo pipefail

exec node "$(dirname "$0")/check-quarantine.mjs" "$@"
