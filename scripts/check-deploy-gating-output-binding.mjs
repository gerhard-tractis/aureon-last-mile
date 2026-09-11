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

// review round 2026-09-10, item 3 — `changes.outputs.<outputKey>` (e.g.
// `${{ steps.filter.outputs.auth_hook }}`) names a step by `id:`, but
// nothing verified that id actually resolves to a real step, let alone one
// that computes that field. Renaming `id: filter` to `id: filterX` (the
// step's `run:` untouched) left every presence check green while
// `steps.filter.outputs.auth_hook` — and pg_net alongside it — silently
// went dead.
//
// review round 3 (2026-09-10) hardened this after two more surviving
// mutants against the real deploy.yml:
//
// G1 — the id-match regex had no end anchor, so `outputs.auth_hook_v2`
// satisfied a check for `auth_hook` (it's a substring match, not an exact
// field match). Now anchored with a negative lookahead so a same-prefix
// field name cannot pass. And it now ERRORS on a non-match instead of
// silently returning [] — the caller only invokes this once it already
// knows outputValue is non-empty, so a failed anchored match means the
// value names something other than a real steps.<id>.outputs.<field>
// reference for THIS field.
//
// G2 — the "does this step compute <field>=" check matched the STRING
// "<field>=" anywhere in the step's run:, including inside an unrelated
// diagnostic echo (this same round's own force_db log line mentions both
// `auth_hook=${AUTH_HOOK}` and `pg_net=${PG_NET}` without writing either to
// $GITHUB_OUTPUT). Now requires `echo "<field>=` — anchored to the START of
// an echo's quoted string, which a message that only CONTAINS "<field>="
// further into its own text does not satisfy.
export function checkOutputStepBinding(changesJob, outputValue, outputKey) {
  const errors = [];
  const value = String(outputValue ?? '');
  const idMatch = new RegExp(`steps\\.([A-Za-z0-9_-]+)\\.outputs\\.${outputKey}(?![A-Za-z0-9_])`)
    .exec(value);
  if (!idMatch) {
    errors.push(
      `changes.outputs.${outputKey} ("${value}") does not reference steps.<id>.outputs.${outputKey} ` +
      `exactly — a same-prefix field name (e.g. ${outputKey}_v2) reads as empty just the same, ` +
      `silently resolving approve-production's environment to 'production-auto'`
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
  if (!new RegExp(`echo\\s+"${outputKey}\\s*=`).test(String(boundStep.run ?? ''))) {
    errors.push(
      `changes.outputs.${outputKey} references steps.${stepId}, but that step's run: never writes ` +
      `${outputKey}= to $GITHUB_OUTPUT (mentioning it elsewhere, e.g. in a diagnostic echo, does not ` +
      `count) — the output is bound to a step that doesn't actually produce it`
    );
  }
  return errors;
}
