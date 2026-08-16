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

if (errors.length) {
  console.error(`deploy gating check FAILED (${workflow}):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  console.error('See docs/specs/spec-57-qa-gate-before-production.md.');
  process.exit(1);
}

console.log(`deploy gating check ok — all production jobs pass through ${GATE}`);
