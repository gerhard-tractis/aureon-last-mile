/**
 * check-deploy-gating-autoapprove.mjs (spec-92)
 *
 * Split out of check-deploy-gating.mjs to keep both files under the repo's
 * 300-line guideline, matching how check-deploy-gating-quarantine.mjs is
 * split — this module is blind to needs:/concurrency/always() and only
 * knows about the shape spec-92 added to `approve-production`:
 *
 *   1. `environment:`, when it is a conditional expression, must map
 *      `needs.changes.outputs.auth_hook == 'true'` to `'production'` and
 *      everything else to `'production-auto'`. Inverted or pointed at the
 *      wrong output, it would auto-approve exactly the class of change
 *      (auth hook config) that QA cannot exercise — see
 *      docs/specs/spec-92-gate-produccion-diferenciado.md for why that
 *      class is exempted from auto-approval at all.
 *
 *      An unconditional literal `'production'` is NOT an error here — it is
 *      strictly more cautious than the auto-approve feature (it just always
 *      pauses, spec-57's original behaviour), so it is left to
 *      check-deploy-gating.mjs's own environment check, which already
 *      requires an environment of some kind to exist.
 *
 *   2. `approve-production` must carry a "run is current" freshness step
 *      that compares this run's commit against main's actual tip and fails
 *      the job on a mismatch — without it, a run superseded by a later
 *      merge can still deploy stale code on top of it, on EITHER path
 *      (auto-approved or humanly approved: approval can be granted after a
 *      newer merge already landed). The step must not be neutralised by
 *      `continue-on-error: true` or a trailing `|| true`.
 *
 *      Only asserted when the fixture defines `steps:` on
 *      `approve-production` at all — the real deploy.yml always does; a
 *      minimal test fixture that omits `steps:` entirely (this family's
 *      convention: "fixtures are minimal on purpose") is simply not
 *      exercising this concern.
 *
 *   3. No PROD_JOBS job may declare its own `environment:` — that would let
 *      it decide independently whether to pause/skip, bypassing whatever
 *      `approve-production` decided.
 *
 * Returns an array of error strings (empty when the shape is fine).
 */

// Kept as its own small list rather than importing PROD_JOBS from
// check-deploy-gating.mjs — this module stays independently readable and
// testable, same as check-deploy-gating-quarantine.mjs's independence from
// the main file's job list.
const PROD_JOBS = [
  'deploy-supabase',
  'deploy-edge-functions',
  'deploy-vercel',
  'deploy-worker',
  'deploy-agents',
  'deploy-solver',
];

// Exported so check-deploy-gating.mjs's own (looser) environment check can
// accept this shape too, without duplicating the regex.
export const VALID_CONDITIONAL_ENV =
  /\$\{\{\s*needs\.changes\.outputs\.auth_hook\s*==\s*'true'\s*&&\s*'production'\s*\|\|\s*'production-auto'\s*\}\}/;

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
    // A literal that isn't 'production' and isn't a conditional at all — e.g.
    // an unconditional 'production-auto', which always skips review.
    errors.push(
      `approve-production.environment is "${env}" — an unconditional value other than ` +
      `'production' bypasses review for every change, including the auth hook class spec-92 ` +
      `says must not auto-approve.`
    );
  }

  // ── 2. the freshness step ────────────────────────────────────────────────
  const steps = Array.isArray(gate.steps) ? gate.steps : null;
  if (steps) {
    const isFreshnessStep = (s) => {
      const run = String(s.run ?? '');
      return run.includes('commits/main') && run.includes('DEPLOY_SHA') && /exit\s+1/.test(run);
    };
    const fresh = steps.find(isFreshnessStep);
    if (!fresh) {
      errors.push(
        'approve-production has no "run is current" freshness step (comparing DEPLOY_SHA against ' +
        'commits/main and exiting 1 on mismatch) — without it a run superseded by a newer merge ' +
        'can still deploy stale code, on either the auto-approved or the humanly-approved path'
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
    }
  }

  // ── 3. no PROD_JOBS job may declare its own environment: ────────────────
  for (const job of PROD_JOBS) {
    if (jobs[job] && jobs[job].environment) {
      errors.push(
        `${job} declares its own environment: — whether to pause or skip must be decided once, ` +
        `by approve-production, not independently by a job downstream of it`
      );
    }
  }

  return errors;
}
