/**
 * check-deploy-gating-field-refs.mjs (spec-92/spec-93)
 *
 * Split out of check-deploy-gating.mjs (review round 2026-09-10, round 5 /
 * size) to keep that file under the repo's 300-line guideline.
 *
 * G2 (round 4) — every needs.changes.outputs.<field> a production job's
 * if: reads must exist in changes.outputs. This guard already checks that
 * PROD_JOBS depend on the gate and that always() doesn't bypass it, but
 * never that the path-filter FIELDS those jobs' if: conditions read are
 * real. `needs.changes.outputs.workerz == 'true'` (a typo, or a field
 * renamed on one side and not the other) reads as '' forever —
 * deploy-worker never runs, on EVERY push, with the rest of this guard
 * green. Same failure shape as the auto-approve-environment checks in
 * check-deploy-gating-autoapprove.mjs (item 2's needs: check, and the
 * id:/field-name binding checks in check-deploy-gating-output-binding.mjs)
 * but on the OTHER side of the file: those protect the human-pause
 * decision, this protects whether a production job runs AT ALL.
 *
 * round 5 — `if:` isn't the only place a job reads
 * needs.changes.outputs.<field>: deploy-qa's "Sync QA environment" STEP has
 * its own env: block passing the same fields to deploy-qa.sh
 * (CHANGED_WORKER, CHANGED_FRONTEND, ...) to decide what to rebuild in QA
 * before e2e-qa runs. A typo there reads as '' just the same, deploy-qa.sh
 * silently skips rebuilding the worker, e2e-qa runs green against a STALE
 * worker — and a green e2e-qa is the precondition approve-production
 * trusts to skip the human click. `env:` is legal at JOB level and at STEP
 * level (this repo's real reference lives at step level); both are
 * scanned, across every job — deploy-qa itself is excluded from PROD_JOBS
 * (it isn't a production job) but is exactly where this class of
 * reference lives.
 *
 * Only enforced when `changes` declares `outputs:` as an object (minimal
 * fixtures across this test family often don't — same convention as
 * elsewhere in this file).
 */
export function checkChangesOutputFieldRefs(jobs, PROD_JOBS, ifOf) {
  const errors = [];
  const changesJob = jobs['changes'];
  if (!changesJob || !changesJob.outputs || typeof changesJob.outputs !== 'object') return errors;
  const changesOutputKeys = new Set(Object.keys(changesJob.outputs));

  for (const job of PROD_JOBS) {
    if (!jobs[job]) continue;
    const cond = ifOf(job);
    const referenced = new Set(
      [...cond.matchAll(/needs\.changes\.outputs\.([A-Za-z0-9_-]+)/g)].map((m) => m[1])
    );
    for (const field of referenced) {
      if (!changesOutputKeys.has(field)) {
        errors.push(
          `${job}'s if: reads needs.changes.outputs.${field}, but changes.outputs has no ` +
          `${field} key — it always evaluates as empty (never 'true'), so ${job} never runs, ` +
          `on every push, with this guard green`
        );
      }
    }
  }

  const checkEnvBlock = (job, label, env) => {
    if (!env || typeof env !== 'object') return;
    for (const [envKey, envValue] of Object.entries(env)) {
      const referenced = new Set(
        [...String(envValue ?? '').matchAll(/needs\.changes\.outputs\.([A-Za-z0-9_-]+)/g)]
          .map((m) => m[1])
      );
      for (const field of referenced) {
        if (!changesOutputKeys.has(field)) {
          errors.push(
            `${job}'s ${label}.${envKey} reads needs.changes.outputs.${field}, but changes.outputs ` +
            `has no ${field} key — it always evaluates as empty, silently passing an empty value ` +
            `downstream instead of the intended path filter`
          );
        }
      }
    }
  };
  for (const job of Object.keys(jobs)) {
    checkEnvBlock(job, 'env', jobs[job] && jobs[job].env);
    const steps = Array.isArray(jobs[job] && jobs[job].steps) ? jobs[job].steps : [];
    steps.forEach((s, i) => checkEnvBlock(job, `steps[${i}].env`, s && s.env));
  }

  return errors;
}
