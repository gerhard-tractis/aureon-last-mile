#!/usr/bin/env bash
#
# check-deploy-gating.sh (spec-57) — thin wrapper around check-deploy-gating.mjs,
# matching the bash-entrypoint convention of the other CI guards in this dir
# (check-migration-versions.sh, verify-prod-migrations.sh).
#
# Usage: bash scripts/check-deploy-gating.sh [path-to-deploy.yml]
set -euo pipefail

exec node "$(dirname "$0")/check-deploy-gating.mjs" "$@"
