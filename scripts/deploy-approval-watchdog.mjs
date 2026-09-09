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
 *            { databaseId, headSha, status, conclusion, createdAt } ],
 *          productionGateProtected? }
 *
 * `productionGateProtected` (M3, review 2026-09-09, PR #716) — the auto-
 * approve path (spec-92) depends entirely on the `production` GitHub
 * environment still carrying its required-reviewer rule for auth-hook
 * changes; nothing in deploy.yml or its guards can see that LIVE config —
 * it is a fact about GitHub's settings, not the workflow file. If it is
 * removed (by hand, or by mistake), the auth-hook path silently starts
 * auto-approving too, and no existing check would notice. Optional and
 * additive: when explicitly `false`, it overrides everything else below —
 * an unprotected gate matters independent of any single commit's deploy
 * status. Absent (older callers, or a workflow that hasn't been updated
 * to gather it) leaves prior behaviour unchanged.
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
  // M3 — checked first and unconditionally: an unprotected human gate is a
  // standing security problem, not a per-commit deploy-status question. A
  // clean deploy history must not mask it.
  if (s.productionGateProtected === false) {
    return {
      action: 'alert',
      reason: "the production environment has lost its required-reviewer rule — the auth-hook " +
        'path (spec-92) is no longer gated by a human click, or this could not be confirmed',
    };
  }

  const grace = s.graceMinutes ?? 60;
  const short = `main ${s.mainSha.slice(0, 7)}`;
  const ageMinutes = (new Date(s.now) - new Date(s.mainCommittedAt)) / 60_000;
  const ageOfRun = (r) => (new Date(s.now) - new Date(r.createdAt)) / 60_000;
  const isResolved = (r) => r.status === 'completed' && r.conclusion === 'success';
  const run = s.runs.find((r) => r.headSha === s.mainSha);

  // "Live" unresolved: still actively running/queued/waiting, OR
  // completed-but-failed/cancelled AND still within the grace window of ITS
  // OWN creation. A run that failed hours or days ago is old news, not a
  // live race — B2 (review 2026-09-09, PR #716): the naive "ever unresolved"
  // version alerted permanently against 15 stale cancelled/failed runs from
  // the previous 36h, measured against the real repo state, and never
  // self-healed because completed-but-failed runs never leave the list.
  const liveUnresolved = s.runs.filter(
    (r) => !isResolved(r) && (r.status !== 'completed' || ageOfRun(r) < grace)
  );
  const distinctShas = new Set(liveUnresolved.map((r) => r.headSha));

  // Two or more DIFFERENT commits live-unresolved at once — checked first,
  // before anything else: this is the race spec-57 flagged and never closed
  // (approving/letting an older queued run through after a newer merge
  // landed deploys stale code), and it matters within minutes, not after an
  // hour of silence.
  if (distinctShas.size > 1) {
    const others = liveUnresolved.filter((r) => r.headSha !== s.mainSha);
    const otherIds = others.map((r) => r.databaseId).join(', ');
    return {
      action: 'alert',
      runId: run ? run.databaseId : undefined,
      reason: `${short} — ${liveUnresolved.length} runs are unresolved for different commits at once ` +
        `(other run(s): ${otherIds}); an older one deploying after a newer merge landed would ship ` +
        `stale code — cancel the older run(s), approve only the one for ${short}`,
    };
  }

  if (run && isResolved(run)) {
    // main's tip deployed — but do not close over a still-live unresolved
    // run for a DIFFERENT (older) commit. M4 (review 2026-09-09, PR #716):
    // decide() used to check `run` first and return 'ok' unconditionally,
    // closing the issue even though an earlier commit's run had failed and
    // nobody had looked at it — the run that failed does not become fine
    // just because a later, unrelated commit happened to succeed.
    const otherCommitUnresolved = liveUnresolved.filter((r) => r.headSha !== s.mainSha);
    if (otherCommitUnresolved.length === 0) {
      return { action: 'ok', reason: `${short} deployed successfully (run ${run.databaseId})` };
    }
    const otherIds = otherCommitUnresolved.map((r) => r.databaseId).join(', ');
    return {
      action: 'alert',
      reason: `${short} deployed successfully (run ${run.databaseId}), but run(s) ${otherIds} for ` +
        `other commits are still unresolved and need attention`,
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
