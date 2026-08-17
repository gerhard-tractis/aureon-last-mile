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

const GATE = 'approve-production';

// Every job that mutates production. Deliberately excluded:
//   deploy-qa               — runs BEFORE the gate; it is the precondition.
//   verify-prod-migrations  — read-only; its output is what you read before
//                             deciding whether to approve.
//   changes                 — pure path detection, touches nothing.
const PROD_JOBS = [
  'deploy-supabase',
  'deploy-edge-functions',
  'deploy-vercel',
  'deploy-worker',
  'deploy-agents',
  'deploy-solver',
];

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

/** `needs:` is legal as a bare string or a list; normalise both. */
const needsOf = (name) => {
  const n = (jobs[name] || {}).needs;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
};

const gate = jobs[GATE];
if (!gate) {
  errors.push(`missing job: ${GATE}`);
} else {
  // `environment:` also accepts an object form ({ name: production, url: ... }).
  const env = typeof gate.environment === 'object' && gate.environment !== null
    ? gate.environment.name
    : gate.environment;
  if (env !== 'production') {
    errors.push(
      `${GATE} must declare "environment: production" — without it the job never ` +
      `pauses and the gate is decorative (found: ${JSON.stringify(gate.environment)})`
    );
  }
  if (!needsOf(GATE).includes('deploy-qa')) {
    errors.push(`${GATE} must depend on deploy-qa — QA green is the gate's precondition`);
  }
}

for (const job of PROD_JOBS) {
  // A job legitimately removed from the workflow is not this guard's problem.
  if (!jobs[job]) continue;
  if (!needsOf(job).includes(GATE)) {
    errors.push(`${job} does not depend on ${GATE} — it can reach production ungated`);
  }
}

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

const USES_ALWAYS = /\balways\s*\(\s*\)/;
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
