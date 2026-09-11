/**
 * check-deploy-gating-pgnet.mjs (spec-92 fase 1b / spec-93)
 *
 * Second class of change exempt from auto-approve, alongside the auth-hook
 * class in check-deploy-gating-autoapprove.mjs: a migration that touches
 * `pg_net` (a `net.http_post/get/delete/...` call, a schema-qualified call,
 * or an install/grant). spec-93's inventory measured that `pg_net` is
 * installed in QA and NOT in production (run 34539233402 vs QA live) — the
 * dangerous direction, because a migration using it applies green against QA
 * and then fails to apply in production with `schema "net" does not exist`.
 * That is the one case where QA passing would say nothing about whether
 * production can even run the migration, so it must not auto-approve either.
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
 * review round 2026-09-10 (B3): this file only ever checked that the
 * detection pattern's TEXT appears somewhere in the step — it cannot tell
 * whether that text is wired to `PG_NET=true` (vs `=false`), has the right
 * polarity (`if` vs `if !`), keeps the fail-closed branch, or uses the
 * cumulative range (`RANGE_BASE`) instead of the single-commit `BASE`. Four
 * one-line mutants of exactly that kind survived here against the real
 * deploy.yml. Those are now caught by
 * check-deploy-gating-pgnet-differential.test.sh instead, which runs the
 * REAL "Filter paths" run: text under real bash against synthetic diffs and
 * asserts on the GITHUB_OUTPUT it actually produces — the only way to tell
 * behavior apart from a string that merely looks right. This file is left
 * to what a presence check CAN honestly guarantee: the output exists and is
 * wired to a step, and that step has not had its detection line deleted
 * outright (as opposed to broken in place).
 *
 * Returns an array of error strings (empty when the shape is fine).
 */

import { resolveGateEnv, checkOutputStepBinding } from './check-deploy-gating-output-binding.mjs';

export function checkPgNetShape(jobs) {
  const errors = [];
  const changesJob = jobs['changes'];
  if (!changesJob) return errors; // check-deploy-gating.mjs already reports this

  // ── changes.outputs.pg_net must exist and be wired to a real step ────────
  // Mirrors autoapprove check 4 for auth_hook: deleting the output makes
  // needs.changes.outputs.pg_net read as '', which never equals 'true', so
  // the pg_net half of the combined environment expression silently goes
  // dead even though the expression's shape still looks correct.
  //
  // review round 2026-09-10 (B3, mutant 5): gated on `changesJob.outputs`
  // being truthy would skip this whole check when the ENTIRE `outputs:`
  // block is deleted from `changes` — exactly the surviving mutant against
  // the real deploy.yml. Gate on whether approve-production's environment is
  // the conditional form instead (mirrors the same fix in
  // check-deploy-gating-autoapprove.mjs): if the auto-approve feature is in
  // play at all, its outputs must genuinely exist, missing entirely or not.
  const gate = jobs['approve-production'];
  const gateEnv = resolveGateEnv(gate);
  const usesConditionalEnv = typeof gateEnv === 'string' && gateEnv.includes('${{');
  if (usesConditionalEnv) {
    const pgNetOutput = changesJob.outputs && typeof changesJob.outputs === 'object'
      ? changesJob.outputs.pg_net
      : undefined;
    if (!pgNetOutput) {
      errors.push(
        'changes.outputs.pg_net is missing — needs.changes.outputs.pg_net then reads as empty, ' +
        'which silently removes the pg_net class from the combined auto-approve condition'
      );
    } else {
      // ── item 3, hardened G1/G2 (round 3): checkOutputStepBinding now owns
      // the full check — an unanchored field name (pg_net_v2) or a step
      // that only MENTIONS pg_net= without writing it to $GITHUB_OUTPUT
      // both used to pass silently. See its own comment.
      errors.push(...checkOutputStepBinding(changesJob, pgNetOutput, 'pg_net'));
    }

    // ── the detection signal itself must still be present ──────────────────
    // Mirrors autoapprove check 5: the output existing is not enough if the
    // step computing it has had its detection line deleted outright. This is
    // deliberately a coarse "the code wasn't wholesale removed" check, not a
    // behavior check — see the file header (B3): whether the signal is
    // actually WIRED to PG_NET=true, with the right polarity, survives the
    // fail-closed branch, and uses the cumulative range is asserted by
    // check-deploy-gating-pgnet-differential.test.sh instead, against real
    // bash. G1 (2026-09-10 review) widened the actual grep past a bare
    // net\.http_(post|get) — the case-insensitive flag and the `net\s*\.\s*
    // http` fragment are what changing the signal's WIDTH (not just deleting
    // it) would have to touch, so require both.
    if (Array.isArray(changesJob.steps)) {
      const filterStep = changesJob.steps.find((s) => /pg_net\s*=/.test(String(s.run ?? '')));
      if (!filterStep) {
        errors.push('changes has no step computing pg_net= — the output cannot be produced');
      } else {
        const run = String(filterStep.run ?? '');
        // Written this verbosely because the pattern itself lives inside a
        // YAML block scalar inside a JS string: the regex source below
        // matches the literal text net\s*\.\s*http (the widened, escaped
        // grep fragment) case-insensitively, and requires grep's -i flag on
        // the same line so a case-sensitivity regression is also caught.
        if (!/net\\s\*\\\.\\s\*http/.test(run)) {
          errors.push(
            "changes' path-filter step no longer references the widened net\\s*\\.\\s*http " +
            'pg_net detection fragment — the signal was removed or narrowed back down'
          );
        }
        if (!/grep\s+-qiE/.test(run)) {
          errors.push(
            "changes' path-filter step's pg_net detection no longer uses grep -qiE (case-" +
            'insensitive) — SQL identifiers are case-insensitive and NET.HTTP_POST would stop matching'
          );
        }
      }
    }
  }

  return errors;
}
