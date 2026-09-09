#!/usr/bin/env bash
#
# post-merge-remind.sh (spec-91 fase 1, ronda 2) — thin wrapper around
# post-merge-remind.mjs, matching the bash-entrypoint convention this repo
# already uses for other guards (check-phase-overlap.sh, check-quarantine.sh).
#
# Registered as a PostToolUse hook (matcher: Bash) in .claude/settings.json.
# It's a best-effort shortcut for the manual `gh pr merge` path — the real
# guarantee is spec-91 fase 5 (server-side reconciliation in CI).
#
# Medio (round 1 review): this hook fires on EVERY Bash tool call, not once
# per merge — measured ~950ms/call for the full node startup + JSON parse,
# vs ~220ms for a no-op `exit 0`. The real match (`gh pr merge ...`) is
# rare; the other 99%+ of Bash calls don't even contain the substring "gh".
# A cheap bash-level pre-filter avoids paying node's startup cost for those
# — it only ever SKIPS node when the input can't possibly contain a `gh`
# invocation, never when it might.
set -uo pipefail

INPUT="$(cat)"

case "$INPUT" in
  *gh*) ;;
  *) exit 0 ;;
esac

# Medio (round 1 review), M2: without this, a missing `node` degrades to a
# noisy `exit 127` + stderr on every single Bash call that happens to
# mention "gh" — fails open either way, but silently is strictly better.
command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$INPUT" | exec node "$(dirname "$0")/post-merge-remind.mjs"
