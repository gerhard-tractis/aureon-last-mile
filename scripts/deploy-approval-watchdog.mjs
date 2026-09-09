/**
 * deploy-approval-watchdog.mjs — the decision half of the parked-deploy
 * watchdog (spec-92 fase 3).
 *
 * Auto-approving the green path (spec-92) removes most of the "four runs
 * sat unapproved for hours" incident, but not all of it: a run can still
 * fail to reach production without anyone noticing — e2e-qa red, a run
 * superseded by a newer one, or (narrower now) a run waiting on the one
 * class of change that still needs a human click (the auth hook). This
 * script decides whether that has gone unnoticed too long.
 *
 * Pure, same shape as qa-drift-check.mjs (spec-57/61): state in as JSON,
 * one decision out. Everything that talks to GitHub lives in the workflow
 * that gathers this state; every branch here is testable without it.
 *
 * Usage: node scripts/deploy-approval-watchdog.mjs <state.json>
 *
 * State: { now, mainSha, mainCommittedAt, graceMinutes, runs: [
 *            { databaseId, headSha, status, conclusion, createdAt } ] }
 *
 * Prints GITHUB_OUTPUT-shaped lines:
 *   action=ok|in_flight|alert
 *   run_id=<id>     (alert only, when a specific run is implicated)
 *   reason=<one line>
 *
 * Exit codes: 0 = decided (see action= above). 2 = the state itself could
 * not be trusted (missing file, invalid JSON, missing required field, or
 * `runs` not an array) — fails closed rather than guessing "ok" or
 * "alert" from data that was never actually read.
 */
import fs from 'node:fs';

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

for (const key of ['now', 'mainSha', 'mainCommittedAt']) {
  if (!state[key]) {
    console.error(`ERROR: state is missing "${key}" — refusing to guess`);
    process.exit(2);
  }
}
if (!Array.isArray(state.runs)) {
  console.error('ERROR: state.runs is not an array — refusing to guess');
  process.exit(2);
}

const decide = (s) => {
  const grace = s.graceMinutes ?? 60;
  const short = `main ${s.mainSha.slice(0, 7)}`;
  const ageMinutes = (new Date(s.now) - new Date(s.mainCommittedAt)) / 60_000;
  const run = s.runs.find((r) => r.headSha === s.mainSha);

  const isResolved = (r) => r.status === 'completed' && r.conclusion === 'success';

  if (run && isResolved(run)) {
    return { action: 'ok', reason: `${short} deployed successfully (run ${run.databaseId})` };
  }

  // Two or more runs unresolved at once, for DIFFERENT commits, is checked
  // BEFORE the grace window — this is the race spec-57 flagged and never
  // closed (approving/letting an older queued run through after a newer
  // one landed deploys stale code), and it matters within minutes, not
  // after an hour of silence.
  const unresolved = s.runs.filter((r) => !isResolved(r));
  const distinctUnresolvedShas = new Set(unresolved.map((r) => r.headSha));
  if (distinctUnresolvedShas.size > 1) {
    const others = unresolved.filter((r) => r.headSha !== s.mainSha);
    const otherIds = others.map((r) => r.databaseId).join(', ');
    return {
      action: 'alert',
      runId: run ? run.databaseId : undefined,
      reason: `${short} — ${unresolved.length} runs are unresolved for different commits at once ` +
        `(other run(s): ${otherIds}); an older one deploying after a newer merge landed would ship ` +
        `stale code — cancel the older run(s), approve only the one for ${short}`,
    };
  }

  if (ageMinutes < grace) {
    return { action: 'in_flight', reason: `${short} is ${Math.round(ageMinutes)}m old, inside the ${grace}m grace window` };
  }

  if (!run) {
    return {
      action: 'alert',
      reason: `${short} — no deploy run exists for it after ${Math.round(ageMinutes)}m; nothing is deploying it`,
    };
  }

  return {
    action: 'alert',
    runId: run.databaseId,
    reason: `${short} — run ${run.databaseId} is ${run.status}` +
      `${run.conclusion ? `/${run.conclusion}` : ''} after ${Math.round(ageMinutes)}m; not resolved`,
  };
};

const verdict = decide(state);

console.log(`action=${verdict.action}`);
if (verdict.runId) console.log(`run_id=${verdict.runId}`);
console.log(`reason=${verdict.reason}`);
