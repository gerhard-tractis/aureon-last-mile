#!/usr/bin/env bash
#
# check-phase-overlap.sh (spec-89 fase 1) — thin wrapper around
# check-phase-overlap.mjs, matching the bash-entrypoint convention of the
# other guards in this dir (check-quarantine.sh, check-deploy-gating.sh).
#
# Usage: bash scripts/check-phase-overlap.sh <specPath#fase[@branch]>... [--base <ref>] [--repo <path>] [--max-depth N]
set -euo pipefail

exec node "$(dirname "$0")/check-phase-overlap.mjs" "$@"
