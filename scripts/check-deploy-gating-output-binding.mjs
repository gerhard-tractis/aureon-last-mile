/**
 * check-deploy-gating-output-binding.mjs (spec-92/spec-93)
 *
 * Split out of check-deploy-gating-autoapprove.mjs (review round 2026-09-10,
 * item 5 / size) to keep that file under the repo's 300-line guideline.
 * Shared by check-deploy-gating-autoapprove.mjs (auth_hook) and
 * check-deploy-gating-pgnet.mjs (pg_net) — a single implementation instead
 * of two copies that can drift.
 */

// `environment:` is legal as a bare string or an object with `name:`.
export function resolveGateEnv(gate) {
  if (!gate) return undefined;
  return typeof gate.environment === 'object' && gate.environment !== null
    ? gate.environment.name
    : gate.environment;
}

// round 4 (2026-09-10) review diagnosis: rounds 3 and 4 each enumerated by
// NEGATION the set of bad characters ((?![A-Za-z0-9_]), then discovering
// `.` and `-` weren't excluded either) instead of requiring the good shape
// POSITIVELY. That loop doesn't end on its own — round 5 finds the next
// character. Fixed here by requiring a positive terminator: whatever comes
// right after `outputs.<field>` must be one of the tokens that legally
// follow it inside a GitHub Actions `${{ }}` expression (closing braces, a
// comparison/boolean operator, a closing paren, or end of string) — not
// "not a word character", which `.` and `-` both satisfy without being
// valid there.
const TERMINATOR = String.raw`(?:\s*\}\}|\s*==|\s*\|\||\s*&&|\s*\)|$)`;

// review round 2026-09-10, item 3 — `changes.outputs.<outputKey>` (e.g.
// `${{ steps.filter.outputs.auth_hook }}`) names a step by `id:`, but
// nothing verified that id actually resolves to a real step, let alone one
// that computes that field. Renaming `id: filter` to `id: filterX` (the
// step's `run:` untouched) left every presence check green while
// `steps.filter.outputs.auth_hook` — and pg_net alongside it — silently
// went dead.
//
// round 3 hardened the id-match with a negative-character-class end anchor
// (rejected an unanchored substring match like `auth_hook_v2`); round 4
// found the class was incomplete (`.x`, `-v2` both survived) and replaced
// it with the positive TERMINATOR above instead of patching the class
// again. It now ERRORS on a non-match instead of silently returning [] —
// the caller only invokes this once it already knows outputValue is
// non-empty, so a failed match means the value doesn't name a real
// steps.<id>.outputs.<field> reference for THIS field.
//
// round 4 ALSO found `githubOutputSinks`' original block regex
// (`/\{([\s\S]*?)\}\s*>>.../`) treated the FIRST `{` anywhere in the run —
// including the inline `matches() { ... }` helper's own braces — as a
// block opener, then non-greedily searched all the way to the real output
// block's closer, silently swallowing everything in between (including a
// field's write line moved OUTSIDE the real block, which is exactly the
// mutation this was meant to catch). Anchored `{`/`}` to standalone lines
// (own line, only whitespace besides the brace) instead — the shape this
// repo's real deploy.yml uses for its output block, and NOT the shape of
// an inline one-liner function definition.
export function checkOutputStepBinding(changesJob, outputValue, outputKey) {
  const errors = [];
  const value = String(outputValue ?? '');
  const idMatch = new RegExp(`steps\\.([A-Za-z0-9_-]+)\\.outputs\\.${outputKey}${TERMINATOR}`)
    .exec(value);
  if (!idMatch) {
    errors.push(
      `changes.outputs.${outputKey} ("${value}") does not reference steps.<id>.outputs.${outputKey} ` +
      `exactly — a longer/different field name (e.g. ${outputKey}_v2, ${outputKey}.x) reads as empty ` +
      `just the same, silently resolving approve-production's environment to 'production-auto'`
    );
    return errors;
  }
  if (!changesJob || !Array.isArray(changesJob.steps)) return errors;
  const stepId = idMatch[1];
  const boundStep = changesJob.steps.find((s) => s.id === stepId);
  if (!boundStep) {
    errors.push(
      `changes.outputs.${outputKey} references steps.${stepId}, but no step in changes declares ` +
      `id: ${stepId} — the output can never resolve and always reads as empty`
    );
    return errors;
  }
  if (!writesFieldToGithubOutput(String(boundStep.run ?? ''), outputKey)) {
    errors.push(
      `changes.outputs.${outputKey} references steps.${stepId}, but that step's run: never writes ` +
      `${outputKey}= to $GITHUB_OUTPUT (mentioning it elsewhere, e.g. in a diagnostic echo, does not ` +
      `count) — the output is bound to a step that doesn't actually produce it`
    );
  }
  return errors;
}

// round 4 review, M2/M3 — the round-3 predicate (`echo "<field>=` anywhere
// in the step) was satisfied by a diagnostic echo that never reaches
// $GITHUB_OUTPUT at all (M2: moving the real write OUTSIDE the redirected
// block still "mentions" the field), and rejected the legitimate
// `printf '%s\n' "<field>=$X" >> "$GITHUB_OUTPUT"` form GitHub's own docs
// recommend for multiline values (M3). Fixed by finding the actual spans of
// text that get redirected into $GITHUB_OUTPUT — either a `{ ... }` block
// closed with `} >> "$GITHUB_OUTPUT"` (the shape this repo's real
// deploy.yml uses today) or a single `echo`/`printf` line ending in
// `>> "$GITHUB_OUTPUT"` — and only then checking for the field inside those
// spans. A heredoc (`cat <<EOF >> "$GITHUB_OUTPUT"`) is NOT recognised; a
// step that needs one for these fields should say so in a comment, since
// this guard can't see it.
function githubOutputSinks(run) {
  const sinks = [];
  // `{`/`}` each alone on their own line (whitespace aside) — not
  // `matches() { ... }`, an inline one-liner whose braces are not this
  // shape and must not be mistaken for it (see the comment above).
  const blockRe = /^[ \t]*\{[ \t]*$\n([\s\S]*?)^[ \t]*\}\s*>>\s*"?\$GITHUB_OUTPUT"?[ \t]*$/gm;
  let m;
  while ((m = blockRe.exec(run))) sinks.push(m[1]);
  const lineRe = /^[ \t]*((?:echo|printf)\b.*)>>\s*"?\$GITHUB_OUTPUT"?\s*$/gm;
  while ((m = lineRe.exec(run))) sinks.push(m[1]);
  return sinks;
}

function writesFieldToGithubOutput(run, outputKey) {
  const writeRe = new RegExp(`(?:echo\\s+"|printf\\s+(?:'[^']*'\\s+)?")${outputKey}\\s*=`);
  return githubOutputSinks(run).some((sink) => writeRe.test(sink));
}
