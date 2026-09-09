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
export const VALID_CONDITIONAL_ENV =
  /\$\{\{\s*needs\.changes\.outputs\.auth_hook\s*==\s*'true'\s*&&\s*'production'\s*\|\|\s*'production-auto'\s*\}\}/;

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

export function checkAutoApproveShape(jobs) {
  const errors = [];
  const gate = jobs['approve-production'];
  if (!gate) return errors; // check-deploy-gating.mjs already reports this

  // ── 1. environment polarity, only when a conditional expression is used ──
  const env = typeof gate.environment === 'object' && gate.environment !== null
    ? gate.environment.name
    : gate.environment;
  if (typeof env === 'string' && env.includes('${{')) {
    if (!VALID_CONDITIONAL_ENV.test(env)) {
      errors.push(
        `approve-production.environment is a conditional expression but not the expected shape ` +
        `(needs.changes.outputs.auth_hook == 'true' ? 'production' : 'production-auto') — found: ` +
        `${env}. An inverted or malformed expression can auto-approve exactly the class of change ` +
        `(auth hook config) that spec-92 says must not auto-approve.`
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
  // with CI green. Only enforced when the fixture declares `outputs:` on
  // `changes` at all (minimal fixtures across this test family often don't).
  const changesJob = jobs['changes'];
  if (changesJob && changesJob.outputs && typeof changesJob.outputs === 'object') {
    const authHookOutput = changesJob.outputs.auth_hook;
    if (!authHookOutput || !/auth_hook/.test(String(authHookOutput))) {
      errors.push(
        'changes.outputs.auth_hook is missing or does not reference an auth_hook step output — ' +
        'needs.changes.outputs.auth_hook then reads as empty, which always resolves ' +
        "approve-production's environment to 'production-auto', silently removing the human pause"
      );
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
