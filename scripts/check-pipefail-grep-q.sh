#!/usr/bin/env bash
# check-pipefail-grep-q.sh — rejects a pipe into `grep`/`egrep`/`fgrep` with
# an early-exit flag (`-q`/`--quiet`, in any position, any flag order,
# split across separate tokens, or on a continuation line after a trailing
# `|`) in infra/supabase-qa/*.sh and .github/workflows/*.yml.
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
# One fix per instance is whack-a-mole; this guard is the mechanism fix.
#
# round 6 (M1): the first version of this guard matched a single regex
# against one line — `\|\s*grep\s+(-[A-Za-z]*q[A-Za-z]*|--quiet)`. That
# missed three shapes a reviewer found within minutes of reading the
# guard's own error message, the most dangerous being the one anyone would
# type IMMEDIATELY AFTER reading "use -qE, -Eq, ..." and reasonably
# guessing flags can also be separate tokens:
#   - `grep -E -q foo`        (flags as separate tokens, not one cluster)
#   - `egrep -q` / `fgrep -q` (the alias commands, not just `grep`)
#   - a trailing `|` at end of line, with `grep -q` starting the NEXT line
# This version tokenizes each (continuation-joined) line instead of
# pattern-matching it whole, and recognizes egrep/fgrep as grep-family
# commands.
#
# Safe alternatives: a herestring (`<<<`, no subprocess to SIGPIPE),
# `[[ $var =~ $re ]]` (in-process, no pipe at all), a `case` statement, or
# plain `grep`/`grep -c` without `-q` (reads its input to EOF regardless of
# whether it already found a match, so it cannot SIGPIPE its writer).
#
# Escape hatch, deliberately narrow: a matched line ending in the literal
# marker `# pipefail-safe: <reason>` is skipped — the marker must be the
# line's trailing comment (not a substring anywhere, e.g. inside a quoted
# string being grepped for), and the reason must justify why THIS input is
# bounded, not just assert safety in the same words every other line uses
# (round 6, M2 — see check-pipefail-grep-q.test.sh for what that rules out).
#
# Usage:
#   check-pipefail-grep-q.sh                 scans the default file set
#   check-pipefail-grep-q.sh file1 file2 ...  scans only the given files
#     (used by check-pipefail-grep-q.test.sh to point at throwaway fixtures)
set -uo pipefail

is_qflag() { # $1 = one token (already known to start with "-"). True if
             # it is a short-cluster flag containing q (-q, -qE, -Eq, ...)
             # or the long form --quiet.
  case "$1" in
    --quiet) return 0 ;;
    --*) return 1 ;;
    -*q*) return 0 ;;
    *) return 1 ;;
  esac
}

# round 6 (M2): returns (via echo) the text after the LAST `#` that is a
# real comment start — preceded by whitespace, or the very first character
# of the line — not just the last `#` byte anywhere. `${content##*#}`
# (the previous version) could not tell a real trailing comment from a `#`
# sitting inside a quoted grep PATTERN on the same line: a line grepping
# FOR the literal string '# pipefail-safe: x' would have matched its own
# escape hatch without ever having justified anything. This still is not
# full shell parsing (a `#` after a non-whitespace, non-quote character —
# e.g. inside an unquoted glob — could theoretically still fool it), but
# it closes the concrete case a reviewer demonstrated.
trailing_comment() {
  local s="$1" n=${#1} i c prev pos=-1
  for ((i = 0; i < n; i++)); do
    c="${s:i:1}"
    [ "$c" = "#" ] || continue
    if [ "$i" -eq 0 ]; then
      pos=$i
    else
      prev="${s:i-1:1}"
      case "$prev" in
        ' '|$'\t') pos=$i ;;
      esac
    fi
  done
  if [ "$pos" -ge 0 ]; then
    printf '%s' "${s:pos+1}"
  fi
}

is_grep_cmd() { # $1 = one token, possibly with a leading "(" or trailing
                # ";"/"&&"-glued punctuation stripped by the caller already.
  case "$1" in
    grep|egrep|fgrep) return 0 ;;
    *) return 1 ;;
  esac
}

# Scans ONE logical (continuation-already-joined) line's tokens. Echoes
# "1" if it finds `grep`-family preceded by a pipe (tracked via
# $prev_line_pipe, a caller-scoped variable this function reads) with a
# -q/--quiet flag anywhere in that invocation's flag run.
scan_line() {
  local line="$1"
  local -a words
  # shellcheck disable=SC2206 — deliberate whitespace tokenizing; this
  # scans shell/YAML source lines, not arbitrary user data.
  words=($line)
  local saw_pipe=$prev_line_pipe
  local in_flags=0
  local hit=0
  local w tok
  for w in "${words[@]}"; do
    tok="$w"
    # Strip common glue punctuation so `(grep` / `grep;` / `grep)` still
    # match the bare command word.
    tok="${tok#(}"; tok="${tok%;}"; tok="${tok%)}"
    if [ "$in_flags" -eq 1 ]; then
      case "$tok" in
        -*)
          if is_qflag "$tok"; then hit=1; fi
          continue
          ;;
        *) in_flags=0 ;;
      esac
    fi
    if [ "$w" = "|" ]; then
      saw_pipe=1
      continue
    fi
    if is_grep_cmd "$tok" && [ "$saw_pipe" -eq 1 ]; then
      in_flags=1
    fi
    saw_pipe=0
  done
  # A trailing `|` as the line's last token means the NEXT line continues
  # this pipeline — remembered for the next call via the caller's variable.
  local last_idx=$((${#words[@]} - 1))
  if [ "$last_idx" -ge 0 ] && [ "${words[$last_idx]}" = "|" ]; then
    prev_line_pipe=1
  else
    prev_line_pipe=0
  fi
  [ "$hit" -eq 1 ]
}

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  shopt -s nullglob
  files=(infra/supabase-qa/*.sh .github/workflows/*.yml)
  shopt -u nullglob
fi

violations=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  prev_line_pipe=0
  lineno=0
  while IFS= read -r content || [ -n "$content" ]; do
    lineno=$((lineno + 1))

    # A full-line comment cannot SIGPIPE anything, and the `|`/`grep`
    # tokens inside a code comment describing the bug (this file's own
    # header, or a past-fix explanation) must not count. Only a LEADING
    # `#` after arbitrary indentation qualifies as a full-line comment.
    trimmed="${content#"${content%%[![:space:]]*}"}"
    is_comment=0
    case "$trimmed" in '#'*) is_comment=1 ;; esac

    if [ "$is_comment" -eq 1 ]; then
      # A comment line cannot carry a live trailing pipe into the next
      # line either.
      prev_line_pipe=0
      continue
    fi

    if scan_line "$content"; then
      # round 6 (M2): the marker must be this line's OWN trailing comment
      # — see trailing_comment() above for what "trailing comment" means
      # here and the exact bug this closes.
      after_hash="$(trailing_comment "$content")"
      case "$after_hash" in
        ' pipefail-safe:'*|'pipefail-safe:'*) continue ;;
      esac
      violations=$((violations + 1))
      echo "::error file=${f},line=${lineno}::pipefail-unsafe grep-family call with an early-exit flag (spec-92 round 5/6) — grep -q/egrep -q/fgrep -q exits on its first match and can SIGPIPE the writer under pipefail, silently flipping the result to \"no match\". Use a herestring, [[ \$var =~ \$re ]], or case; or end the line with \"# pipefail-safe: <reason>\" only if the input is provably bounded, with a reason specific to THIS line."
      echo "  ${f}:${lineno}: ${content}"
    fi
  done < "$f"
done

echo ""
if [ "$violations" -gt 0 ]; then
  echo "check-pipefail-grep-q: ${violations} violation(s) — see above."
  exit 1
fi
echo "check-pipefail-grep-q: clean."
exit 0
