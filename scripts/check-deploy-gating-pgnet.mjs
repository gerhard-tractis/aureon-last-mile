/**
 * check-deploy-gating-pgnet.mjs (spec-92 fase 1b / spec-93)
 *
 * Second class of change exempt from auto-approve, alongside the auth-hook
 * class in check-deploy-gating-autoapprove.mjs: a migration that calls
 * `net.http_post()` or `net.http_get()`. spec-93's inventory measured that
 * `pg_net` is installed in QA and NOT in production (run 34539233402 vs QA
 * live) — the dangerous direction, because a migration using it applies green
 * against QA and then fails to apply in production with `schema "net" does
 * not exist`. That is the one case where QA passing would say nothing about
 * whether production can even run the migration, so it must not auto-approve
 * either.
 *
 * Kept as its own output (`pg_net`, not folded into `auth_hook`) because the
 * reason the gate paused is different and the runbook has to be able to say
 * which one it was — see approve-production's "Record what is being
 * approved" step. Split into its own file for the same reason
 * check-deploy-gating-autoapprove.mjs and check-deploy-gating-quarantine.mjs
 * are split out: keeps every file under the repo's 300-line guideline.
 *
 * The environment-expression polarity itself (does `pg_net == 'true'` route
 * to `production`?) is asserted by VALID_CONDITIONAL_ENV in
 * check-deploy-gating-autoapprove.mjs, which both classes now share in one
 * combined expression — not duplicated here.
 *
 * Returns an array of error strings (empty when the shape is fine).
 */

export function checkPgNetShape(jobs) {
  const errors = [];
  const changesJob = jobs['changes'];
  if (!changesJob) return errors; // check-deploy-gating.mjs already reports this

  // ── changes.outputs.pg_net must exist and be wired to a real step ────────
  // Mirrors autoapprove check 4 for auth_hook: deleting the output makes
  // needs.changes.outputs.pg_net read as '', which never equals 'true', so
  // the pg_net half of the combined environment expression silently goes
  // dead even though the expression's shape still looks correct.
  if (changesJob.outputs && typeof changesJob.outputs === 'object') {
    const pgNetOutput = changesJob.outputs.pg_net;
    if (!pgNetOutput || !/pg_net/.test(String(pgNetOutput))) {
      errors.push(
        'changes.outputs.pg_net is missing or does not reference a pg_net step output — ' +
        'needs.changes.outputs.pg_net then reads as empty, which silently removes the ' +
        'pg_net class from the combined auto-approve condition'
      );
    }

    // ── the detection signal itself must still be present ──────────────────
    // Mirrors autoapprove check 5: the output existing is not enough if the
    // step computing it no longer looks for net.http_post/net.http_get.
    if (Array.isArray(changesJob.steps)) {
      const filterStep = changesJob.steps.find((s) => /pg_net\s*=/.test(String(s.run ?? '')));
      if (!filterStep) {
        errors.push('changes has no step computing pg_net= — the output cannot be produced');
      } else {
        const run = String(filterStep.run ?? '');
        // Requires the escaped dot (net\.http_...), not just "net.http_..." —
        // an unescaped dot in the actual grep pattern would also match
        // things like "netXhttp_post", which is not the signal spec-93 asked
        // for. Written this verbosely because the pattern itself lives
        // inside a YAML block scalar inside a JS string: the regex source
        // below matches the literal text net\.http_(post|get).
        if (!/net\\\.http_\(post\|get\)/.test(run)) {
          errors.push(
            "changes' path-filter step no longer references net\\.http_(post|get) — the pg_net " +
            'detection signal was removed, so pg_net can never observe that class of migration'
          );
        }
      }
    }
  }

  return errors;
}
