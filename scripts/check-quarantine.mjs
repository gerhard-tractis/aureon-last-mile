/**
 * check-quarantine.mjs (spec-87 fase 1)
 *
 * Reads apps/frontend/e2e/quarantine.json and a Playwright JSON-reporter
 * report, and decides whether the e2e-qa job may report success.
 *
 * The gate still vetoes production. Only DECLARED failures are absorbed —
 * everything else still fails the job, exactly as before. Two rules keep the
 * list from becoming a permanent basement for red tests:
 *
 *   1. Any failure NOT covered by an active quarantine entry fails the gate.
 *   2. Any quarantine entry that has EXPIRED fails the gate — whether or not
 *      its test still fails. Without an expiry, quarantine is forever and
 *      stops meaning anything.
 *
 * A third check protects the second one from rotting the other way: an entry
 * whose test now PASSES also fails the gate, asking for it to be retired.
 * An obsolete quarantine entry hides a future regression of the same test.
 *
 * This is NOT continue-on-error, which deploy.yml forbids explicitly (see
 * check-deploy-gating.mjs) — the suite still vetoes; only declared, dated,
 * owned failures are discounted.
 *
 * Usage:
 *   node check-quarantine.mjs <quarantine.json> <playwright-report.json> [--today YYYY-MM-DD]
 *
 * Exit codes:
 *   0  ok — every failure is declared and current, no stale/expired entries
 *   1  gate failure — undeclared failure, expired entry, or stale entry
 *   2  input error — missing/unreadable/malformed file, or a bad entry shape
 */
import { usageError, readJson, parseArgs, validateQuarantine } from './check-quarantine-validate.mjs';

/**
 * Walks the Playwright JSON reporter's suite tree (suites nest suites and
 * specs; a spec carries one or more tests, each with one result per attempt)
 * and flattens it to one entry per spec: { file, title, failed }.
 *
 * Prefers `spec.ok` (the reporter's own rollup) when present, and falls back
 * to scanning test results for anything other than passed/skipped — the two
 * shapes a hand-built fixture or a future reporter version might use.
 */
function walkSpecs(suite, acc) {
  for (const spec of suite.specs ?? []) {
    const tests = spec.tests ?? [];
    let failed;
    if (typeof spec.ok === 'boolean') {
      failed = !spec.ok;
    } else {
      failed = tests.some((t) =>
        (t.results ?? []).some((r) => r.status && r.status !== 'passed' && r.status !== 'skipped')
      );
    }
    acc.push({ file: spec.file, title: spec.title, failed });
  }
  for (const child of suite.suites ?? []) {
    walkSpecs(child, acc);
  }
  return acc;
}

function matches(entry, spec) {
  return entry.spec === spec.file && typeof spec.title === 'string' && spec.title.includes(entry.test);
}

function main() {
  const { quarantinePath, reportPath, today, validateOnly } = parseArgs(process.argv.slice(2));
  if (!quarantinePath) {
    usageError('<quarantine.json> is required');
  }

  const quarantine = readJson(quarantinePath, 'quarantine file');
  validateQuarantine(quarantine, quarantinePath, today);

  if (validateOnly) {
    // review round 2, H3 — this mode never sees a report, so it CANNOT know
    // whether an expired entry's test still fails (that needs the report),
    // which is why it does not fail the build over expiry. What it CAN do
    // without one is warn: without this, the day an entry's expiry passes,
    // every PR stays green right up until the next e2e-qa run on the VPS
    // catches it — by which point production is already re-blocked.
    for (const entry of quarantine) {
      if (entry.expires < today) {
        console.log(
          `::warning::quarantine entry for ${entry.spec} :: "${entry.test}" expired on ` +
            `${entry.expires} (owner: ${entry.owner}) — e2e-qa will fail until it is fixed or renewed.`
        );
      }
    }
    console.log(`quarantine file ok — ${quarantine.length} entr${quarantine.length === 1 ? 'y' : 'ies'}, structurally valid`);
    return;
  }

  if (!reportPath) {
    usageError('<playwright-report.json> is required unless --validate-only');
  }

  const report = readJson(reportPath, 'playwright report');
  const errors = [];

  // ── A file that fails to LOAD produces no failing specs at all ──────────
  // (review round 1, blocker 1, demonstrated against a real Playwright 1.58.2
  // run: a broken `import` never reaches report.suites — it lands ONLY in
  // report.errors, with report.stats.unexpected left at 0). Reading only
  // report.suites, as this script did before, means a file that never ran
  // ships as an invisible pass instead of the veto it used to be.
  const reportErrors = Array.isArray(report.errors) ? report.errors : [];
  if (reportErrors.length) {
    errors.push(
      `report.errors is not empty — the report itself is broken, not just red. A file that ` +
        `failed to load produces no failing spec for this script to see, so a stale exit code ` +
        `would ship an untested suite as green:`
    );
    for (const e of reportErrors) {
      errors.push(`  ${(e && e.message) || JSON.stringify(e)}`);
    }
  }

  // ── H2 (review round 2): an empty report must not be green ──────────────
  // Nothing above checks that a test actually RAN. Before this, the only
  // thing standing between an empty report and a green gate was
  // quarantine.json itself having active entries that then fail to match
  // anything in an empty suites[] — coverage that disappears the day fase 2
  // empties the file, which is the day production actually unblocks. A
  // test.describe.skip, or a rename that breaks testMatch, would leave
  // e2e-qa green forever with zero tests executed. Demonstrated with
  // {"suites":[],"errors":[],"stats":{expected:0,unexpected:0,flaky:0}},
  // with `{}`, and with every result "skipped" (allSpecs non-empty, stats
  // still all zero) — all three passed before this check existed.
  // H5 (review round 2) — `flaky` is folded into "something executed" here,
  // but nothing gates on it being NONZERO. That is fine only because
  // playwright.qa.config.ts sets `retries: 0`: a test cannot be reported
  // "flaky" (failed, then passed on retry) without a retry to do the passing
  // on. If retries is ever raised above 0, a flaky pass can hide a real
  // intermittent failure behind a green gate, and this script would need an
  // explicit check on stats.flaky > 0 — it does not have one today.
  const stats = report.stats || {};
  const executed = (stats.expected || 0) + (stats.unexpected || 0) + (stats.flaky || 0);
  if (executed === 0) {
    errors.push(
      'report.stats shows no test executed (expected=0, unexpected=0, flaky=0) — an empty ' +
        'report, a testMatch that matched nothing, or every test skipped must not pass as green.'
    );
  }

  const allSpecs = [];
  for (const suite of report.suites ?? []) {
    walkSpecs(suite, allSpecs);
  }
  const failing = allSpecs.filter((s) => s.failed);

  // A second, independent cross-check on the same failure class: Playwright's
  // own rollup (report.stats.unexpected) counting more than the failing specs
  // this walk found means something did not surface as a spec — a crashed
  // file among others that DID load, a global-setup failure, anything this
  // script's own tree-walk cannot see by construction.
  //
  // review round 2, H4 — stats.unexpected counts TESTS, failing.length counts
  // SPECS; they only line up one-to-one because playwright.qa.config.ts runs
  // a single project (`projects: [{ name: 'chromium', ... }]`). Add a second
  // project and one failing spec produces stats.unexpected: 2 against
  // failing.length: 1, tripping this check on a perfectly healthy report.
  // Re-check this the day that config gains a second project.
  const statsUnexpected = report.stats && report.stats.unexpected;
  if (typeof statsUnexpected === 'number' && statsUnexpected > failing.length) {
    errors.push(
      `report.stats.unexpected (${statsUnexpected}) is greater than the ${failing.length} failing ` +
        'spec(s) found in report.suites — some failure did not surface as a spec. Investigate before ' +
        'trusting this report.'
    );
  }

  // An entry whose "test" text is loose enough to match more than one real
  // test can silently absorb a second, unrelated regression under the same
  // quarantine entry.
  for (const entry of quarantine) {
    const matched = allSpecs.filter((s) => matches(entry, s));
    if (matched.length > 1) {
      errors.push(
        `quarantine entry for ${entry.spec} :: "${entry.test}" matches ${matched.length} tests ` +
          `(${matched.map((s) => `"${s.title}"`).join(', ')}) — its "test" text is too broad and could ` +
          `swallow an unrelated regression silently. Make it more specific (owner: ${entry.owner}).`
      );
    }
  }

  const expired = quarantine.filter((e) => e.expires < today);
  for (const e of expired) {
    errors.push(
      `quarantine entry for ${e.spec} :: "${e.test}" expired on ${e.expires} (owner: ${e.owner}) — ` +
        'it must be fixed or its expiry renewed with a reason, not left to rot'
    );
  }

  const active = quarantine.filter((e) => !(e.expires < today));
  for (const entry of active) {
    const stillFailing = failing.some((s) => matches(entry, s));
    if (stillFailing) continue;
    const matchedAnySpec = allSpecs.some((s) => matches(entry, s));
    if (matchedAnySpec) {
      errors.push(
        `quarantine entry for ${entry.spec} :: "${entry.test}" is stale — that test now PASSES. ` +
          `Retire it from quarantine.json (owner: ${entry.owner}).`
      );
    } else {
      errors.push(
        `quarantine entry for ${entry.spec} :: "${entry.test}" does not match any test in the ` +
          `report — check the spec/test text (owner: ${entry.owner}).`
      );
    }
  }

  for (const spec of failing) {
    const covered = quarantine.some((entry) => matches(entry, spec));
    if (!covered) {
      errors.push(`undeclared failure: ${spec.file} :: "${spec.title}" is red and not in quarantine.json`);
    }
  }

  if (errors.length) {
    console.error('quarantine check FAILED:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const forgiven = failing.map((s) => `${s.file} :: "${s.title}"`);
  console.log(
    `quarantine check ok — ${failing.length} declared failure(s), 0 undeclared, 0 expired, 0 stale entries` +
      (forgiven.length ? `\n  forgiven: ${forgiven.join('; ')}` : '')
  );
}

main();
