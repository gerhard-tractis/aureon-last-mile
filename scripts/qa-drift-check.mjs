/**
 * qa-drift-check.mjs — the decision half of the QA drift watchdog.
 *
 * QA is meant to track main on every merge. Three different ways it stopped
 * doing so on 2026-08-16/17, none of which announced itself:
 *
 *   1. a workflow-level concurrency group let a run paused at the production
 *      approval block every later QA sync (fixed in the same PR as this file)
 *   2. GitHub's own infrastructure failed a sync at "Set up job" — actions/checkout
 *      returned 502 then 429 — and nothing retried it
 *   3. a run was cancelled to clear a queue, taking its QA sync with it
 *
 * Each time, main moved on and QA silently stayed put. Green PR checks say
 * nothing about whether the deploy ran; only QA's actual checked-out SHA does.
 *
 * This script is pure — state in as JSON, one decision out — so every branch is
 * testable without GitHub or the VPS. The workflow gathers the state, runs this,
 * and carries out the verdict.
 *
 * Usage: node scripts/qa-drift-check.mjs <state.json>
 *
 * State: { now, qaSha, mainSha, mainCommittedAt, graceMinutes, runs: [
 *            { databaseId, headSha, status, conclusion, attempt } ] }
 *
 * Prints GITHUB_OUTPUT-shaped lines:
 *   action=ok|in_flight|rerun|alert
 *   run_id=<id>            (rerun only)
 *   rerun_mode=failed|full (rerun only)
 *   reason=<one line>
 */
import fs from 'node:fs';

/** Re-running more than once means the failure is not transient. */
const MAX_ATTEMPTS = 1;

const stateFile = process.argv[2];
if (!stateFile || !fs.existsSync(stateFile)) {
  console.error(`ERROR: no such state file: ${stateFile}`);
  process.exit(2);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (err) {
  console.error(`ERROR: could not parse ${stateFile}: ${err.message}`);
  process.exit(2);
}

for (const key of ['now', 'qaSha', 'mainSha', 'mainCommittedAt']) {
  if (!state[key]) {
    console.error(`ERROR: state is missing "${key}" — refusing to guess`);
    process.exit(2);
  }
}

const decide = (s) => {
  if (s.qaSha === s.mainSha) {
    return { action: 'ok', reason: `QA is on main (${s.mainSha.slice(0, 7)})` };
  }

  const short = `QA ${s.qaSha.slice(0, 7)} vs main ${s.mainSha.slice(0, 7)}`;
  const ageMinutes = (new Date(s.now) - new Date(s.mainCommittedAt)) / 60_000;
  const grace = s.graceMinutes ?? 20;

  // A merge that landed moments ago has not had time to deploy. Alerting here
  // would make the watchdog cry on every single merge.
  if (ageMinutes < grace) {
    return { action: 'in_flight', reason: `${short} — main is ${Math.round(ageMinutes)}m old, inside the ${grace}m grace window` };
  }

  const runs = Array.isArray(s.runs) ? s.runs : [];
  const run = runs.find((r) => r.headSha === s.mainSha);

  if (!run) {
    return { action: 'alert', reason: `${short} — no deploy run exists for main's tip, so nothing will ever sync it` };
  }

  if (run.status !== 'completed') {
    // spec-57 puts deploy-qa BEFORE approve-production, so a run paused at the
    // gate has already finished with QA. If QA is still behind, the pause is
    // not the explanation and a human needs to look.
    if (run.status === 'waiting') {
      return { action: 'alert', reason: `${short} — run ${run.databaseId} is paused at the production gate but QA is still behind; its sync did not take` };
    }
    return { action: 'in_flight', reason: `${short} — run ${run.databaseId} is ${run.status}` };
  }

  if (run.conclusion === 'success') {
    return { action: 'alert', reason: `${short} — run ${run.databaseId} reports success but QA did not move; the sync is lying or was skipped` };
  }

  if ((run.attempt ?? 1) > MAX_ATTEMPTS) {
    return { action: 'alert', reason: `${short} — run ${run.databaseId} ${run.conclusion} after ${run.attempt} attempts; not transient` };
  }

  // `gh run rerun --failed` needs failed jobs to re-run. A run cancelled before
  // anything failed has none, and the command errors out — so a cancelled run
  // goes again whole.
  const mode = run.conclusion === 'cancelled' ? 'full' : 'failed';

  return {
    action: 'rerun',
    runId: run.databaseId,
    rerunMode: mode,
    reason: `${short} — run ${run.databaseId} ${run.conclusion}; re-running ${mode === 'full' ? 'it' : 'its failed jobs'}`,
  };
};

const verdict = decide(state);

console.log(`action=${verdict.action}`);
if (verdict.runId) console.log(`run_id=${verdict.runId}`);
if (verdict.rerunMode) console.log(`rerun_mode=${verdict.rerunMode}`);
console.log(`reason=${verdict.reason}`);
