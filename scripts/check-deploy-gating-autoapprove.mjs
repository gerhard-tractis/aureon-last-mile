/**
 * check-deploy-gating-autoapprove.mjs (spec-92)
 *
 * Split out of check-deploy-gating.mjs to keep both files under the repo's
 * 300-line guideline, matching how check-deploy-gating-quarantine.mjs is
 * split. Round 2 (review 2026-09-09) hardened every check here after six
 * mutants survived the round-1 version — see each check's comment for which
 * mutant it now kills. Kept independent of the main file's job list: see
 * `computeProdJobs` below, which BOTH files now use instead of maintaining
 * two copies of a fixed array (round-1 mutant: a brand-new production job
 * that forgets to add itself to that list was invisible to either file).
 *
 * Returns an array of error strings (empty when the shape is fine).
 */

// A fixed allowlist of "production jobs" is exactly the kind of thing a new
// job silently skips being added to — round-1 mutant "new prod job, no
// gate" survived because PROD_JOBS was a static array duplicated in two
// files. Inverted instead: name the handful of jobs that are NOT production
// jobs, and treat every other job in the workflow as one. A new job now has
// to prove it doesn't need gating (by being named here) rather than being
// silently ungated by default.
const NON_PROD_JOBS = new Set([
  'changes',
  'deploy-qa',
  'e2e-qa',
  'approve-production',
  'verify-prod-migrations',
]);

export function computeProdJobs(jobs) {
  return Object.keys(jobs || {}).filter((name) => !NON_PROD_JOBS.has(name));
}

// Exported so check-deploy-gating.mjs's own (looser) environment check can
// accept this shape too, without duplicating the regex.
//
// spec-92 fase 1b / spec-93: widened from a single auth_hook check to an OR
// of both auto-approve-exempt classes — auth_hook (spec-92) and pg_net
// (spec-93, check-deploy-gating-pgnet.mjs). Either one being 'true' must
// route to 'production'; only when BOTH are false does it auto-approve to
// 'production-auto'. The parenthesised OR is required (not just written for
// style) — without it `&&` binds tighter than the bare `||`, so
// `a == 'true' || b == 'true' && 'production' || 'production-auto'` would
// auto-approve on `a` alone and require a human click to route it back.
export const VALID_CONDITIONAL_ENV =
  /\$\{\{\s*\(\s*needs\.changes\.outputs\.auth_hook\s*==\s*'true'\s*\|\|\s*needs\.changes\.outputs\.pg_net\s*==\s*'true'\s*\)\s*&&\s*'production'\s*\|\|\s*'production-auto'\s*\}\}/;

/**
 * Round-1 version matched three substrings ANYWHERE in the step's `run:` —
 * `commits/main`, `DEPLOY_SHA`, `exit 1`. Mutant: neutralise the actual
 * comparison (e.g. `if [ "1" = "1" ]`) while leaving all three tokens
 * present elsewhere (a comment, an unrelated echo) — survived, guard stayed
 * green. This version requires the tokens to be WIRED TOGETHER: a variable
 * assigned from a `commits/main …. sha` call, THEN compared with `!=`
 * against `DEPLOY_SHA` using that SAME variable name, THEN `exit 1`
 * appearing AFTER that comparison in the script — not merely present
 * somewhere in the step.
 */
function findFreshnessStep(steps) {
  return steps.find((s) => {
    const run = String(s.run ?? '');
    const assign = run.match(/(\w+)\s*=\s*"?\$\(\s*gh api[^\n]*commits\/main[^\n]*\.sha[^\n]*\)"?/);
    if (!assign) return false;
    const varName = assign[1];
    const cmpRe = new RegExp(`\\[\\s*"\\$\\{?${varName}\\}?"\\s*!=\\s*"\\$\\{?DEPLOY_SHA\\}?"\\s*\\]`);
    const cmpMatch = run.match(cmpRe);
    if (!cmpMatch) return false;
    const afterCmp = run.slice(run.indexOf(cmpMatch[0]) + cmpMatch[0].length);
    return /exit\s+1/.test(afterCmp);
  });
}

// `resolveGateEnv`/`checkOutputStepBinding` live in
// check-deploy-gating-output-binding.mjs, shared with
// check-deploy-gating-pgnet.mjs — split out to stay under the repo's
// 300-line guideline (review round 2026-09-10, item 5 / size). Re-exported
// here too: check-deploy-gating.mjs and existing tests already import
// VALID_CONDITIONAL_ENV etc. from this file, and other code may still
// expect resolveGateEnv to live here.
import { resolveGateEnv, checkOutputStepBinding } from './check-deploy-gating-output-binding.mjs';
export { resolveGateEnv, checkOutputStepBinding };

export function checkAutoApproveShape(jobs) {
  const errors = [];
  const gate = jobs['approve-production'];
  if (!gate) return errors; // check-deploy-gating.mjs already reports this

  // ── 1. environment polarity, only when a conditional expression is used ──
  const env = resolveGateEnv(gate);
  if (typeof env === 'string' && env.includes('${{')) {
    if (!VALID_CONDITIONAL_ENV.test(env)) {
      errors.push(
        `approve-production.environment is a conditional expression but not the expected shape ` +
        `((auth_hook == 'true' || pg_net == 'true') ? 'production' : 'production-auto') — found: ` +
        `${env}. An inverted or malformed expression can auto-approve exactly the classes of change ` +
        `(auth hook config, or a migration using pg_net) that spec-92/spec-93 say must not auto-approve.`
      );
    }
  } else if (typeof env === 'string' && env !== 'production') {
    errors.push(
      `approve-production.environment is "${env}" — an unconditional value other than ` +
      `'production' bypasses review for every change, including the auth hook class spec-92 ` +
      `says must not auto-approve.`
    );
  }

  // ── 1b. the gate job itself must not neutralise its own result ──────────
  // Round-1 mutant: `continue-on-error: true` on approve-production ITSELF
  // (not on the freshness step, which was already checked) — survived,
  // because at JOB level that makes `needs.approve-production.result`
  // report 'success' regardless of what happened inside, and every
  // production job's `if:` only ever asked for `result == 'success'`.
  if (gate['continue-on-error'] === true) {
    errors.push(
      'approve-production has continue-on-error: true at JOB level — a failed freshness check ' +
      '(or anything else in the job) would still report success to every production job downstream, ' +
      'which only checks needs.approve-production.result == \'success\''
    );
  }

  // ── 2. the freshness step ────────────────────────────────────────────────
  const steps = Array.isArray(gate.steps) ? gate.steps : null;
  if (steps) {
    const fresh = findFreshnessStep(steps);
    if (!fresh) {
      errors.push(
        'approve-production has no "run is current" freshness step (a variable assigned from a ' +
        'commits/main …sha call, compared with != against DEPLOY_SHA, followed by exit 1) — without ' +
        'it a run superseded by a newer merge can still deploy stale code, on either path'
      );
    } else {
      if (fresh['continue-on-error'] === true) {
        errors.push(
          'the "run is current" freshness step has continue-on-error: true — a failed freshness ' +
          'check must stop the job, not be swallowed'
        );
      }
      if (/\|\|\s*true\b/.test(String(fresh.run ?? ''))) {
        errors.push(
          'the "run is current" freshness step ends with "|| true" — a stale run would still ' +
          'report success and deploy'
        );
      }
      // Round-1 mutant not yet covered: `if: false` on the step itself —
      // survived because the guard never read a step's own `if:`. The step
      // must run unconditionally on BOTH paths (auto-approved and humanly
      // approved); there is no legitimate reason for it to be conditional.
      if (fresh.if !== undefined) {
        errors.push(
          `the "run is current" freshness step declares if: ${JSON.stringify(fresh.if)} — it must ` +
          'run unconditionally on every path, or a false/skipped condition silently removes the check'
        );
      }
    }
  }

  // ── 3. no production job may declare its own environment: ───────────────
  for (const job of computeProdJobs(jobs)) {
    if (jobs[job] && jobs[job].environment) {
      errors.push(
        `${job} declares its own environment: — whether to pause or skip must be decided once, ` +
        `by approve-production, not independently by a job downstream of it`
      );
    }
  }

  // ── 4. changes.outputs.auth_hook must exist and be wired to a real step ──
  // Round-1 mutant: delete `auth_hook` from changes.outputs entirely.
  // needs.changes.outputs.auth_hook then evaluates to '', '' == 'true' is
  // false, approve-production's environment ALWAYS resolves to
  // 'production-auto' — the human pause silently disappears from the repo
  // with CI green.
  //
  // review round 2026-09-10 (B3, mutant 5): this used to gate on
  // `changesJob.outputs` being a truthy object — meaning deleting the ENTIRE
  // `outputs:` block from `changes` (not just the `auth_hook` key inside it)
  // skipped this check altogether, against the REAL deploy.yml. Gating on
  // the environment expression instead (does approve-production's
  // environment actually READ needs.changes.outputs.* at all?) cannot be
  // sidestepped that way: if the conditional form is in play, its inputs
  // must genuinely exist, whether `outputs:` is missing entirely or merely
  // incomplete. Minimal fixtures elsewhere in this family that use the
  // conditional env now need real outputs backing it — see
  // check-deploy-gating-autoapprove.test.sh's base_wf.
  const changesJob = jobs['changes'];
  const usesConditionalEnv = typeof env === 'string' && env.includes('${{');

  // ── 4b. every needs.<job>.outputs.* the environment reads must actually
  // be in approve-production's own needs: ──────────────────────────────────
  // review round 2026-09-10, item 2: removing 'changes' from
  // approve-production.needs doesn't touch the environment EXPRESSION at
  // all — `needs.changes.outputs.auth_hook` still parses fine, but
  // `needs.changes` doesn't exist in the job's context without 'changes' in
  // needs:, so it evaluates to '' and the whole condition silently and
  // permanently resolves to 'production-auto'. Same failure as mutant 5
  // (deleting the outputs: block) reached from the needs: end of the wire
  // instead of the outputs: end — and just as plausible an edit, since
  // approve-production doesn't visibly use `changes` for anything else.
  if (usesConditionalEnv) {
    const referencedJobs = new Set(
      [...env.matchAll(/needs\.([A-Za-z0-9_-]+)\.outputs\./g)].map((m) => m[1])
    );
    const gateNeeds = Array.isArray(gate.needs) ? gate.needs : gate.needs ? [gate.needs] : [];
    for (const job of referencedJobs) {
      if (!gateNeeds.includes(job)) {
        errors.push(
          `approve-production.environment reads needs.${job}.outputs.* but '${job}' is not in ` +
          `approve-production's own needs: — needs.${job} does not exist in that context, so the ` +
          `expression always resolves to 'production-auto' no matter what ${job} actually computed`
        );
      }
    }
  }

  if (changesJob && usesConditionalEnv) {
    const authHookOutput = changesJob.outputs && typeof changesJob.outputs === 'object'
      ? changesJob.outputs.auth_hook
      : undefined;
    if (!authHookOutput) {
      errors.push(
        'changes.outputs.auth_hook is missing — needs.changes.outputs.auth_hook then reads as ' +
        "empty, which always resolves approve-production's environment to 'production-auto', " +
        'silently removing the human pause'
      );
    } else {
      // ── item 3, hardened G1/G2 (round 3): checkOutputStepBinding now owns
      // the full check — an unanchored field name (auth_hook_v2) or a
      // step that only MENTIONS auth_hook= without writing it to
      // $GITHUB_OUTPUT both used to pass silently. See its own comment.
      errors.push(...checkOutputStepBinding(changesJob, authHookOutput, 'auth_hook'));
    }

    // ── 5. the detection signals themselves must still be present ─────────
    // Round-1 mutant: delete the `custom_access_token_hook` string from the
    // filter step's computation while leaving the output wiring intact —
    // survived, because nothing checked *how* auth_hook gets computed, only
    // that it exists. Only enforced when `changes` declares `steps:`.
    if (Array.isArray(changesJob.steps)) {
      const filterStep = changesJob.steps.find((s) => /auth_hook\s*=/.test(String(s.run ?? '')));
      if (!filterStep) {
        errors.push('changes has no step computing auth_hook= — the output cannot be produced');
      } else {
        const run = String(filterStep.run ?? '');
        if (!/custom_access_token_hook/.test(run)) {
          errors.push(
            "changes' path-filter step no longer references custom_access_token_hook — the " +
            'path/content detection signal was removed, so auth_hook can never observe that class of change'
          );
        }
        if (!/supabase_auth_admin/.test(run)) {
          errors.push(
            "changes' path-filter step no longer references supabase_auth_admin — the migration-" +
            'content detection signal was removed'
          );
        }
      }
    }
  }

  return errors;
}
