/**
 * check-deploy-gating-quarantine.mjs (spec-87 fase 1)
 *
 * The quarantine-veto STEP shape checks for e2e-qa, split out of
 * check-deploy-gating.mjs to keep both files under the repo's 300-line
 * guideline. check-deploy-gating.mjs asserts needs:/continue-on-error/if: at
 * JOB granularity; this module is blind to all of that and only knows about
 * the one step inside e2e-qa that actually vetoes production.
 *
 * Returns an array of error strings (empty when the shape is fine) so the
 * caller can fold them into its own `errors` list without this module
 * knowing how errors are reported.
 */

const QUARANTINE_STEP_IF = "steps.qa.outputs.provisioned == 'true'";

// The one invocation this guard accepts, canonicalised: no flags (in
// particular no `--validate-only`, which reads no report and exits 0 having
// checked nothing against it), the two positional args in this order, and
// nothing else on the same logical line.
const EXPECTED_QUARANTINE_INVOCATION =
  'bash scripts/check-quarantine.sh apps/frontend/e2e/quarantine.json apps/frontend/playwright-report-qa/results.json';

/**
 * A YAML block scalar keeps every physical line of a `run:` script. A
 * backslash-continued command (the real deploy.yml wraps its two args across
 * three lines) is one shell statement split across several of those lines —
 * this joins them back into one "logical line" per shell statement before any
 * shape is asserted, and collapses whitespace so re-indentation cannot change
 * whether a line matches.
 *
 * Round 6 (B1) replaced a laxer join rule with bash's actual one, live-tested
 * against `bash --noprofile --norc -e -o pipefail` (how GitHub runs a step):
 * bash only splices a physical line into the next when it ends in an ODD
 * number of `\` immediately adjacent to the newline — nothing trimmed first.
 * The old rule trimmed the line, then asked `endsWith('\\')`, which is a
 * strictly laxer test than bash's: it joined on an EVEN backslash count
 * (`# nota \\`, verified live to run as a normal, non-continuing comment)
 * and joined across a trailing space after the backslash (`# nota \ `,
 * verified live the same way) because trim() silently ate the space bash
 * treats as significant. Both let a whitelisted `#` line absorb an
 * arbitrary next line — trap, set, or a decoy `npm run e2e:qa` that moves
 * the H2 anchor — while this guard still saw one inert comment.
 *
 * A comment is additionally immune to continuation altogether, at any
 * backslash count: verified live that `# note \` (a single, odd,
 * newline-adjacent backslash — bash's own continuation trigger everywhere
 * else) still does NOT splice into the next physical line when it starts a
 * comment. Bash discards a comment to the next raw newline outright; only a
 * non-comment line's trailing-backslash parity decides continuation.
 */
function logicalLines(run) {
  const lines = [];
  let buf = '';
  for (const raw of run.split('\n')) {
    const withoutCr = raw.replace(/\r$/, '');
    if (buf === '' && /^\s*#/.test(withoutCr)) {
      // A comment consumes the rest of ITS OWN physical line, full stop —
      // no amount of trailing backslash splices it into the next line.
      lines.push(withoutCr.trim().replace(/\s+/g, ' '));
      continue;
    }
    const trailingBackslashes = (withoutCr.match(/(\\+)$/) || [''])[0].length;
    const continues = trailingBackslashes % 2 === 1;
    const content = continues ? withoutCr.slice(0, -1) : withoutCr;
    buf = buf ? `${buf} ${content.trim()}` : content.trim();
    if (continues) continue;
    lines.push(buf.replace(/\s+/g, ' ').trim());
    buf = '';
  }
  if (buf) lines.push(buf.replace(/\s+/g, ' ').trim());
  return lines.filter((l) => l.length > 0);
}

// A logical line is tolerated alongside the invocation only if it CANNOT
// itself neutralise anything: a `#` comment. `#` makes bash ignore the rest
// of that physical line outright, so nothing after it — `;`, `&&`, a
// redirection — can execute.
//
// Round 4 also allowed `echo`, on the theory that a log line before the
// invocation is harmless. It is not: `logicalLines()` splits only on `\n`
// and joined `\`-continuations, never on `;`/`&&`/`||`/backticks/`$(`, so
// only the FIRST token of a logical line was ever inspected. Re-review round
// 5 (H1) found and executed live bypasses that pass this whitelist under
// `bash --noprofile --norc -e -o pipefail` (how GitHub actually runs a
// step): `echo pre; trap 'exit 0' EXIT`, `echo hi; set +e`, and
// `echo '{"suites":[]}' > apps/frontend/playwright-report-qa/results.json`
// all start with `echo` and were accepted, and all three neutralise the
// invocation exactly like the vectors this file already rejects when they
// appear on their own. The real deploy.yml step never logs before invoking
// the script (see deploy.yml's "Check quarantine" step), so dropping `echo`
// costs nothing there.
const ALLOWED_EXTRA_LINE = /^#/;

/**
 * True when `run:`, once its logical lines are computed, is EXACTLY the
 * expected invocation plus only comment/echo lines — nothing else. This is a
 * WHITELIST of the one accepted shape, not a list of forbidden ones: `trap`,
 * any spelling of `set`, `if`, `while`, or anything else fails simply by not
 * being on the list, with no vector anyone had to have predicted first.
 */
function hasValidQuarantineInvocation(run) {
  // B2 (round 6): this guard parses the YAML TEMPLATE; GitHub substitutes
  // `${{ ... }}` BEFORE bash ever reads the line, so a value the guard never
  // sees (e.g. a multi-line commit message) can turn a tolerated `# ...`
  // line into comment + statement at runtime. Reject the whole run: outright
  // if it contains `${{` anywhere, whitelist or not — the guard cannot
  // reason about what GitHub will substitute there.
  if (run.includes('${{')) return false;
  const lines = logicalLines(run);
  const invocationCount = lines.filter((l) => l === EXPECTED_QUARANTINE_INVOCATION).length;
  if (invocationCount !== 1) return false;
  return lines.every((l) => l === EXPECTED_QUARANTINE_INVOCATION || ALLOWED_EXTRA_LINE.test(l));
}

/**
 * Resolves the shell a step actually runs under, following the same
 * precedence `actions/runner` does: the step's own `shell:`, then the job's
 * `defaults.run.shell`, then the workflow's `defaults.run.shell`. Round 3
 * only ever read `step.shell` — a job- or workflow-level `defaults:` block
 * (deploy.yml already has one, for `working-directory`) silently overrides
 * the step's shell with no way for that check to see it.
 */
function effectiveShell(step, job, doc) {
  if (step.shell != null) return step.shell;
  const jobShell = job && job.defaults && job.defaults.run && job.defaults.run.shell;
  if (jobShell != null) return jobShell;
  const wfShell = doc && doc.defaults && doc.defaults.run && doc.defaults.run.shell;
  if (wfShell != null) return wfShell;
  return 'bash';
}

/**
 * Same step → job → workflow resolution chain as effectiveShell, now applied
 * to working-directory (round 6, M4). The real step pins
 * `working-directory: .` explicitly (deploy.yml:655) — its own author
 * treated it as load-bearing — but until now this guard had no equivalent
 * chain for it, so a job- or workflow-level `defaults.run.working-directory`
 * could move the step's cwd with nothing here to notice. GitHub's own
 * default, absent any of the three, is the repo root — `.`.
 */
function effectiveWorkingDirectory(step, job, doc) {
  if (step['working-directory'] != null) return step['working-directory'];
  const jobWd = job && job.defaults && job.defaults.run && job.defaults.run['working-directory'];
  if (jobWd != null) return jobWd;
  const wfWd = doc && doc.defaults && doc.defaults.run && doc.defaults.run['working-directory'];
  if (wfWd != null) return wfWd;
  return '.';
}

/**
 * ── The quarantine veto (spec-87 fase 1) lives inside a STEP, not a job ────
 * e2e-qa no longer fails on npm run e2e:qa's raw exit code (`|| true` —
 * deliberately not the job-level continue-on-error). Instead a
 * "Check quarantine" step runs scripts/check-quarantine.sh against the JSON
 * report and IS what passes or fails the job. Deleting that step, or giving
 * it its own continue-on-error, leaves e2e-qa green regardless of what
 * actually failed.
 */
export function checkQuarantineStep(jobs, doc) {
  const errors = [];
  const e2eQa = jobs['e2e-qa'];
  if (!e2eQa) return errors;

  const steps = e2eQa.steps || [];
  // Look at every step that mentions the script, not just the first — an
  // earlier, unrelated step (a "dry run", a comment) can mention it too, and
  // picking the first match let that decoy stand in for a real step that had
  // been deleted (review round 3, V11).
  const mentionsScript = steps.filter(
    (s) => typeof s.run === 'string' && s.run.includes('check-quarantine.sh')
  );

  // Round 7: B2's `${{` rejection used to fall through into the generic
  // "no step whose run: is exactly ..." error below, quoting the invocation
  // byte-for-byte identical to what's already in the step. Name it instead.
  const templatedSteps = mentionsScript.filter((s) => s.run.includes('${{'));
  if (templatedSteps.length > 0) {
    errors.push(
      'e2e-qa has a step invoking check-quarantine.sh whose run: contains `${{ ... }}` — ' +
        'GitHub substitutes that BEFORE bash ever reads the line, so this guard cannot reason ' +
        'about what will actually run there (see spec-87 fase 1, round 6 B2); remove the ' +
        'template expression from that step\'s run:'
    );
    return errors;
  }

  const realSteps = mentionsScript.filter((s) => hasValidQuarantineInvocation(s.run));

  if (realSteps.length === 0) {
    errors.push(
      'e2e-qa has no step whose run: is exactly `' + EXPECTED_QUARANTINE_INVOCATION + '` ' +
        '(as a logical line, once any backslash continuations are joined) — without it a failure ' +
        'outside the quarantine list, an expired entry, a stale entry, or a neutralised invocation ' +
        '(a flag, a control operator, `set +e`, an explicit exit) cannot fail the job'
    );
    return errors;
  }
  if (realSteps.length > 1) {
    errors.push(
      `e2e-qa has ${realSteps.length} steps whose run: is the quarantine invocation — there must ` +
        'be exactly one, so it is unambiguous which step is the veto'
    );
    return errors;
  }

  const quarantineStep = realSteps[0];
  if (quarantineStep['continue-on-error']) {
    errors.push(
      'the "Check quarantine" step in e2e-qa must not set continue-on-error — that ' +
        'reports success to the job even when the quarantine check failed, the exact ' +
        'silent-pass this step exists to prevent'
    );
  }
  if (quarantineStep.if != null && String(quarantineStep.if).trim() !== QUARANTINE_STEP_IF) {
    errors.push(
      `the "Check quarantine" step's if: must be exactly "${QUARANTINE_STEP_IF}" when present ` +
        `(found: ${JSON.stringify(quarantineStep.if)}) — any other condition, including false or ` +
        'one that merely looks unrelated, can skip the veto on a run where it matters'
    );
  }

  const shell = effectiveShell(quarantineStep, e2eQa, doc);
  if (shell !== 'bash') {
    errors.push(
      `the "Check quarantine" step's effective shell: must be "bash" (found: ${JSON.stringify(shell)}, ` +
        'resolved from step.shell, then e2e-qa\'s defaults.run.shell, then the workflow\'s ' +
        'defaults.run.shell) — any other shell, set at any of those three levels, can drop the ' +
        'default -e/pipefail that makes a failing invocation actually fail the step'
    );
  }

  // ── Round 6, M4: working-directory now has the same resolution chain as
  // shell (effectiveShell above) — see effectiveWorkingDirectory's comment.
  const workingDirectory = effectiveWorkingDirectory(quarantineStep, e2eQa, doc);
  if (workingDirectory !== '.') {
    errors.push(
      `the "Check quarantine" step's effective working-directory: must be "." (found: ` +
        `${JSON.stringify(workingDirectory)}, resolved from step['working-directory'], then ` +
        "e2e-qa's defaults.run.working-directory, then the workflow's defaults.run.working-directory) " +
        '— any other value, set at any of those three levels, can point the two report-relative ' +
        'arguments the script reads (apps/frontend/e2e/quarantine.json, ' +
        'apps/frontend/playwright-report-qa/results.json) somewhere else entirely'
    );
  }

  // ── M4 (round 3): order, not just presence ──────────────────────────────
  // steps.filter (round 3) proved a decoy step could not stand in for a
  // deleted real one, but it never looked at WHERE the real step sits.
  // Moving "Check quarantine" before the step that runs Playwright leaves
  // this guard green while the step reads whatever results.json a
  // PREVIOUS run left on the self-hosted runner's disk — a perpetual pass
  // that never executes the current commit's tests at all.
  //
  // Round 5 (H2) found this anchor passed in EMPTY: `findIndex` returning -1
  // when no step runs `npm run e2e:qa` was read as "no anchor to check
  // against" and silently approved — proved live by renaming the Playwright
  // step, or deleting it outright, with "Check quarantine" as the only step
  // left; both accepted. `.includes` also took the first textual mention,
  // a `#` comment included (the same V11 shape this file already fixed once
  // for the quarantine invocation itself, here recurring in the anchor);
  // proved by putting `# npm run e2e:qa is below` ahead of the real step and
  // watching the guard anchor on the comment. `stepRunsE2eSuite` below
  // requires a genuine, non-comment mention, and the anchor is now the LAST
  // such step (mutation-killed: `findIndex` → `findLastIndex` used to
  // survive with two `npm run e2e:qa` steps and the quarantine step between
  // them — the first-match anchor let the veto pass by only outrunning the
  // EARLIER of the two).
  function stepRunsE2eSuite(step) {
    if (typeof step.run !== 'string') return false;
    return logicalLines(step.run)
      .filter((l) => !l.startsWith('#'))
      .some((l) => l.includes('npm run e2e:qa'));
  }

  let e2eRunIdx = -1;
  steps.forEach((s, i) => {
    if (stepRunsE2eSuite(s)) e2eRunIdx = i;
  });

  if (e2eRunIdx === -1) {
    errors.push(
      'e2e-qa must contain a step whose run: actually invokes `npm run e2e:qa` (a `#` comment ' +
        'mentioning it does not count) — without that anchor the "Check quarantine" step could ' +
        'sit anywhere, including before a renamed or deleted Playwright step, and this guard ' +
        'would have nothing to check its position against'
    );
  } else {
    const quarantineIdx = steps.indexOf(quarantineStep);
    if (quarantineIdx < e2eRunIdx) {
      errors.push(
        'the "Check quarantine" step must run AFTER the step that runs `npm run e2e:qa`, not ' +
          'before it — otherwise it reads a stale results.json left over from a previous run ' +
          'instead of the one this run just produced'
      );
    }
  }

  return errors;
}
