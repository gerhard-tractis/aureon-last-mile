#!/usr/bin/env bash
#
# post-merge-remind.sh (spec-91 fase 1) — thin wrapper around
# post-merge-remind.mjs, matching the bash-entrypoint convention this repo
# already uses for other guards (check-phase-overlap.sh, check-quarantine.sh)
# and for the two Stop/SessionStart hooks registered in .claude/settings.json.
#
# Registered as a PostToolUse hook (matcher: Bash) in .claude/settings.json.
set -uo pipefail

exec node "$(dirname "$0")/post-merge-remind.mjs"
