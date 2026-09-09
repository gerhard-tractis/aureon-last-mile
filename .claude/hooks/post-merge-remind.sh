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
# per merge — measured (three times, same window, to make the numbers
# comparable — round-1's timing comparison across separate runs on a loaded
# machine wasn't): with a payload containing no "gh pr merge" substring, this
# hook costs THE SAME as a bare `exit 0`. The pre-filter below is what makes
# that true — it only ever SKIPS node when the input can't possibly contain
# a real merge invocation, never when it might.
#
# H-3 (round 3 review): narrowed from `*gh*` to `*'gh pr merge'*`. The looser
# version paid node's startup cost for ANY payload containing the bigram
# "gh" ANYWHERE — including `tool_response` text, which this hook also
# receives on stdin: "through", "right", a git hash, all match `*gh*`. This
# is free to tighten and stays correct: the `.mjs` still requires a SEGMENT
# to literally START WITH `gh pr merge` (extractMergeSegment), so narrowing
# the cheap pre-filter to the same substring can't reject anything the `.mjs`
# would have accepted.
set -uo pipefail

INPUT="$(cat)"

case "$INPUT" in
  *'gh pr merge'*) ;;
  *) exit 0 ;;
esac

# Medio (round 1 review), M2: without this, a missing `node` degrades to a
# noisy `exit 127` + stderr on every single Bash call that happens to
# mention "gh" — fails open either way, but silently is strictly better.
command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$INPUT" | exec node "$(dirname "$0")/post-merge-remind.mjs"
