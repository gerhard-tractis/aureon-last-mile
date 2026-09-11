/**
 * check-deploy-gating.mjs (spec-57)
 *
 * Fails if any production-mutating job in deploy.yml can run without passing
 * through the approve-production gate.
 *
 * The gate is the only thing standing between a merge and production. The
 * history of deploy.yml is a history of silent gating bugs (the paths-filter
 * empty-diff bug, the Supabase CLI pin, the path filter that masked DB
 * failures) — every one of them shipped green. So the shape is asserted here
 * and checked on every build rather than trusted to review.
 *
 * Usage: node scripts/check-deploy-gating.mjs [path-to-deploy.yml]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// js-yaml 5's ESM build exports named bindings only — `import yaml from
// 'js-yaml'` fails with "does not provide an export named 'default'". Import
// `load` directly rather than reaching for createRequire.
import { load } from 'js-yaml';
import { checkQuarantineStep } from './check-deploy-gating-quarantine.mjs';
import {
  checkAutoApproveShape,
  computeProdJobs,
  VALID_CONDITIONAL_ENV,
} from './check-deploy-gating-autoapprove.mjs';
import { checkPgNetShape } from './check-deploy-gating-pgnet.mjs';

const GATE = 'approve-production';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = process.argv[2] ?? path.join(here, '..', '.github', 'workflows', 'deploy.yml');

if (!fs.existsSync(workflow)) {
  console.error(`ERROR: no such workflow: ${workflow}`);
  process.exit(2);
}

let doc;
try {
  doc = load(fs.readFileSync(workflow, 'utf8'));
} catch (err) {
  console.error(`ERROR: could not parse ${workflow}: ${err.message}`);
  process.exit(2);
}

const jobs = (doc && doc.jobs) || {};
const errors = [];

// Round-1 mutant (review 2026-09-09): a NEW production job that forgets to
// add itself to a static PROD_JOBS array is invisible to every check below.
// computeProdJobs derives the list from the workflow itself — every job
// except the small, explicit non-production set — so a new job is gated by
// default instead of silently ungated. See check-deploy-gating-autoapprove.mjs.
const PROD_JOBS = computeProdJobs(jobs);

/** `needs:` is legal as a bare string or a list; normalise both. */
const needsOf = (name) => {
  const n = (jobs[name] || {}).needs;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
};

const USES_ALWAYS = /\balways\s*\(\s*\)/;
const gate = jobs[GATE];
if (!gate) {
  errors.push(`missing job: ${GATE}`);
} else {
  // `environment:` also accepts an object form ({ name: production, url: ... }).
  const env = typeof gate.environment === 'object' && gate.environment !== null
    ? gate.environment.name
    : gate.environment;
  // spec-92: an unconditional 'production' (spec-57's original, still safe —
  // it just always pauses) OR the correct-polarity auto-approve expression
  // are both valid here. check-deploy-gating-autoapprove.mjs is the one that
  // rejects a malformed/inverted conditional; this check only rejects
  // "no environment at all", which still means the job never pauses.
  if (env !== 'production' && !(typeof env === 'string' && VALID_CONDITIONAL_ENV.test(env))) {
    errors.push(
      `${GATE} must declare "environment: production" (or spec-92's conditional form) — ` +
      `without it the job never pauses and the gate is decorative (found: ${JSON.stringify(gate.environment)})`
    );
  }
  if (!needsOf(GATE).includes('deploy-qa')) {
    errors.push(`${GATE} must depend on deploy-qa — QA green is the gate's precondition`);
  }

  // Un workflow sin job e2e-qa no es problema de este guard — misma regla que
  // PROD_JOBS más abajo. Los fixtures de los tests son mínimos a propósito.
  //
  // e2e-qa became blocking on 2026-09-03. Before that it ran with
  // continue-on-error and was absent from this gate, so a red suite shipped
  // green. Both halves are asserted: dropping the `needs:` entry OR letting
  // always() swallow the result would silently restore the old behaviour.
  if (jobs['e2e-qa'] && !needsOf(GATE).includes('e2e-qa')) {
    errors.push(
      `${GATE} must depend on e2e-qa — without it a red E2E against QA cannot ` +
      `stop a production deploy`
    );
  }
  // `continue-on-error: true` en un job hace que sus dependientes lean
  // `needs.<job>.result == 'success'` aunque haya fallado. Sin esta comprobación
  // las dos de arriba se pueden dejar intactas y seguir enviando a producción
  // con el E2E rojo — que es exactamente el estado previo a 2026-09-03.
  if (jobs['e2e-qa'] && jobs['e2e-qa']['continue-on-error']) {
    errors.push(
      `e2e-qa must not set continue-on-error — a job with it reports ` +
      `result == 'success' to ${GATE} even when it failed, so the E2E gate ` +
      `silently stops gating`
    );
  }

  const gateIf = String(gate.if ?? '');
  const ASSERTS_E2E =
    /needs\s*(?:\.\s*e2e-qa|\[\s*['"]e2e-qa['"]\s*\])\s*\.\s*result\s*==\s*'success'/;
  if (jobs['e2e-qa'] && USES_ALWAYS.test(gateIf) && !ASSERTS_E2E.test(gateIf)) {
    errors.push(
      `${GATE}'s if: uses always() but does not assert ` +
      `needs.e2e-qa.result == 'success' — always() runs the job even when e2e-qa failed`
    );
  }
}

for (const job of PROD_JOBS) {
  // A job legitimately removed from the workflow is not this guard's problem.
  if (!jobs[job]) continue;
  if (!needsOf(job).includes(GATE)) {
    errors.push(`${job} does not depend on ${GATE} — it can reach production ungated`);
  }
}

// ── The quarantine veto (spec-87 fase 1) lives inside a STEP, not a job ──────
// e2e-qa no longer fails on npm run e2e:qa's raw exit code (`|| true` —
// deliberately not the job-level continue-on-error checked above). Instead a
// "Check quarantine" step runs scripts/check-quarantine.sh against the JSON
// report and IS what passes or fails the job. The needs:/continue-on-error/
// if: checks above are blind to this: they only see the job as a whole.
// See check-deploy-gating-quarantine.mjs for the step-shape checks
// themselves — split out to keep both files under the repo's 300-line
// guideline.
errors.push(...checkQuarantineStep(jobs, doc));

// ── Auto-approve shape (spec-92) — environment polarity, the freshness
// step, and no PROD_JOBS job bypassing approve-production with its own
// environment:. Split out for the same reason as the quarantine checks —
// keeps both files under the repo's 300-line guideline.
errors.push(...checkAutoApproveShape(jobs));

// ── pg_net shape (spec-92 fase 1b / spec-93) — the second auto-approve-
// exempt class, alongside auth_hook. Split out for the same 300-line reason.
errors.push(...checkPgNetShape(jobs));

// ── needs: is not enough once if: opts into always() ─────────────────────────
// Normally a skipped dependency skips the dependent job, which is what makes
// `needs: [approve-production]` a gate at all. `always()` throws that away: it
// runs the job whatever the needs did, and the usual companions !failure() and
// !cancelled() do not catch a SKIPPED gate, because skipped is neither.
//
// These jobs need always() for a real reason — deploy-supabase and
// deploy-edge-functions are skipped by the path filters on most merges, and
// plain success() semantics would then skip everything downstream of them. So
// the fix is not to drop always() but to name the gate explicitly.
//
// Observed 2026-08-17 in run 32066950544: approve-production was skipped (its
// own needs had been cancelled) and deploy-vercel ran `vercel --prod` anyway.
// Every check was green and the guard above was satisfied.
const ifOf = (name) => {
  const v = (jobs[name] || {}).if;
  return v == null ? '' : String(v);
};

// Accept both `needs.approve-production.result` and the bracket form.
const ASSERTS_GATE = new RegExp(
  String.raw`needs\s*(?:\.\s*${GATE}|\[\s*['"]${GATE}['"]\s*\])\s*\.\s*result\s*==\s*['"]success['"]`
);

for (const job of PROD_JOBS) {
  if (!jobs[job]) continue;
  const cond = ifOf(job);
  if (!USES_ALWAYS.test(cond)) continue;
  if (!ASSERTS_GATE.test(cond)) {
    errors.push(
      `${job} uses always() without checking the gate — a SKIPPED ${GATE} is ` +
      `neither failure() nor cancelled(), so this job deploys to production ` +
      `unapproved. Add: needs.${GATE}.result == 'success'`
    );
  }
}

// ── deploy-supabase must not be path-filtered ────────────────────────────────
// Whether production needs migrations is a fact about PRODUCTION, not about the
// diff of whichever commit reaches the gate. Those come apart whenever a
// migration's run waits for approval while docs-only merges land behind it: the
// run someone finally approves has no migration in its diff, the job skips, and
// production silently drifts while every check stays green. It sat 13
// migrations behind for 5 days this way (2026-08-17 → 2026-08-22).
// `db push --include-all` is idempotent, so there is nothing to save by
// guessing.
if (jobs['deploy-supabase']) {
  const cond = String(jobs['deploy-supabase'].if ?? '');
  if (cond.includes('changes.outputs.database')) {
    errors.push(
      'deploy-supabase is path-filtered on changes.outputs.database — that filter ' +
      'is the production-drift bug, not a safeguard. A migration approved behind ' +
      'docs-only merges never deploys. db push --include-all is a no-op when ' +
      'nothing is pending; let it run on every approved production deploy.'
    );
  }
}

// ── Concurrency: serialise production, never the QA sync ─────────────────────
// A workflow-level concurrency group covers every job in the run, deploy-qa
// included. A run paused at the gate keeps holding that group, so the NEXT
// merge's QA sync cannot start — QA falls behind main for as long as nobody
// clicks approve, which is exactly what deploy-qa's "QA is the backstop, so it
// always runs" comment says must not happen. Observed 2026-08-16: the run for
// 9d2a0f3 sat pending with zero jobs while an earlier run waited on approval.
// Serialisation therefore lives on the jobs, one group each, so production is
// still never deployed twice at once and QA is never blocked by a human.
if (doc && doc.concurrency) {
  errors.push(
    'workflow-level concurrency starves deploy-qa: a run paused at the gate holds ' +
    'the group, so later merges cannot sync QA. Put the group on each production ' +
    `job instead (found: ${JSON.stringify(doc.concurrency)})`
  );
}

/** `concurrency:` is legal as a bare string or an object with `group`. */
const concurrencyGroupOf = (name) => {
  const c = (jobs[name] || {}).concurrency;
  if (!c) return null;
  return typeof c === 'string' ? c : (c.group ?? null);
};

for (const job of [...PROD_JOBS, 'deploy-qa']) {
  if (!jobs[job]) continue;
  if (!concurrencyGroupOf(job)) {
    errors.push(
      job === 'deploy-qa'
        ? 'deploy-qa needs its own concurrency group — two QA syncs at once would ' +
          'race on the same checkout and build directory on the VPS'
        : `${job} needs its own concurrency group — without it two approved runs ` +
          'can mutate production simultaneously'
    );
  }
}

if (errors.length) {
  console.error(`deploy gating check FAILED (${workflow}):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  console.error('See docs/specs/spec-57-qa-gate-before-production.md.');
  process.exit(1);
}

console.log(`deploy gating check ok — all production jobs pass through ${GATE}`);
