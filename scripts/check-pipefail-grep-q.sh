#!/usr/bin/env bash
# check-pipefail-grep-q.sh — rejects `| grep -q` (in any flag order/combo)
# in infra/supabase-qa/*.sh and .github/workflows/*.yml.
#
# Why: `grep -q` exits on its FIRST match and closes its read end of the
# pipe. Under `pipefail` — deploy-qa.sh's own `set -Eeuo pipefail`, and
# GitHub Actions' default shell for every `run:` step, which is
# `bash -eo pipefail` — the upstream writer can still be mid-write when
# grep quits. SIGPIPE kills that writer, the pipeline's exit status becomes
# 141, and 141 is nonzero: an `if pipeline; then` reads it as false. That
# is not a crash a human notices — it is the CONDITION SILENTLY FLIPPING,
# always toward "nothing matched", which for every guard that decides
# "does this look dangerous / did this change / did this fail" is the
# unsafe direction.
#
# spec-92 review round 5 found FIVE live instances of this exact signature
# across two files, all failing open:
#   - .github/workflows/deploy.yml — pg_net detection
#   - .github/workflows/deploy.yml — auth_hook detection over MIGRATIONS_DIFF
#   - .github/workflows/deploy.yml:183 — matches(), which decides what deploys
#   - infra/supabase-qa/deploy-qa.sh — sql_tests_check's pgTAP content check
#   - infra/supabase-qa/deploy-qa.sh — widen_changed_flags' widen()
# One fix per instance is whack-a-mole; this guard is the mechanism fix —
# a sixth instance cannot land in either file without CI catching it here.
#
# Safe alternatives: a herestring (`<<<`, no subprocess to SIGPIPE),
# `[[ $var =~ $re ]]` (in-process, no pipe at all), a `case` statement, or
# plain `grep`/`grep -c` without `-q` (reads its input to EOF regardless of
# whether it already found a match, so it cannot SIGPIPE its writer).
#
# Escape hatch, deliberately narrow: a matched line ending in the literal
# marker `# pipefail-safe: <reason>` is skipped. Use it only when the
# input is PROVABLY bounded (e.g. grepping a short, hardcoded string) —
# and the reason has to justify that boundedness, not just assert safety.
# As of this guard's introduction, zero lines in either target use it.
#
# Usage:
#   check-pipefail-grep-q.sh                 scans the default file set
#   check-pipefail-grep-q.sh file1 file2 ...  scans only the given files
#     (used by check-pipefail-grep-q.test.sh to point at throwaway fixtures)
set -uo pipefail

# Matches a pipe into `grep` with a flag cluster containing `q` in any
# position (-q, -qE, -Eq, -qi, -iq, ...) or the long form `--quiet`.
# Requires the `q`-bearing token to be immediately preceded by `-` (a
# proper flag), not just any word containing the letter q.
PATTERN='\|[[:space:]]*grep[[:space:]]+(-[A-Za-z]*q[A-Za-z]*|--quiet)([[:space:]]|$)'

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  shopt -s nullglob
  files=(infra/supabase-qa/*.sh .github/workflows/*.yml)
  shopt -u nullglob
fi

violations=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  # `grep -nE` here is deliberately NOT `-q`: it reads to EOF and is never
  # piped into another `grep -q` — this script must not itself commit the
  # bug it exists to catch.
  while IFS=: read -r lineno content; do
    case "$content" in
      *'# pipefail-safe:'*) continue ;;
    esac
    # A full-line comment (the pattern's `|` inside a backtick describing
    # the bug in prose, e.g. this very script's own header, or a code
    # comment explaining a past fix) is not executable code and cannot
    # SIGPIPE anything. Only a LEADING `#` (after arbitrary indentation)
    # counts — a trailing comment on an otherwise-live line must still be
    # caught, so this strips leading whitespace first rather than matching
    # a single space/tab.
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      '#'*) continue ;;
    esac
    violations=$((violations + 1))
    echo "::error file=${f},line=${lineno}::pipefail-unsafe \`| grep -q\` (spec-92 round 5) — grep -q exits on its first match and can SIGPIPE the writer under pipefail, silently flipping the result to \"no match\". Use a herestring, [[ \$var =~ \$re ]], or case; or mark the line \"# pipefail-safe: <reason>\" only if the input is provably bounded."
    echo "  ${f}:${lineno}: ${content}"
  done < <(grep -nE "$PATTERN" "$f" 2>/dev/null || true)
done

echo ""
if [ "$violations" -gt 0 ]; then
  echo "check-pipefail-grep-q: ${violations} violation(s) — see above."
  exit 1
fi
echo "check-pipefail-grep-q: clean."
exit 0
