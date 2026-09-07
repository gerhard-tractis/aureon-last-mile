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
import fs from 'node:fs';

const REQUIRED_FIELDS = ['spec', 'test', 'reason', 'owner', 'expires'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// An entry cannot be renewed further out than this without a human looking
// at it again — otherwise "expires" degenerates into a decoration and
// quarantine becomes permanent, which is the failure mode fase 1 exists to
// prevent (review round 1).
const MAX_HORIZON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function usageError(msg) {
  console.error(`ERROR: ${msg}`);
  console.error(
    'Usage: node check-quarantine.mjs <quarantine.json> <playwright-report.json> [--today YYYY-MM-DD]'
  );
  process.exit(2);
}

function readJson(filePath, label) {
  if (!filePath) usageError(`missing ${label} path`);
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: ${label} not found: ${filePath}`);
    process.exit(2);
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`ERROR: could not read ${label} (${filePath}): ${err.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: ${label} (${filePath}) is not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Extracts --today and --validate-only from argv (either position, order
 * irrelevant) and returns the remaining positional args alongside them.
 */
function parseArgs(argv) {
  const rest = [...argv];
  let today = null;
  const todayIdx = rest.indexOf('--today');
  if (todayIdx !== -1) {
    today = rest[todayIdx + 1];
    rest.splice(todayIdx, 2);
  }
  const validateOnlyIdx = rest.indexOf('--validate-only');
  const validateOnly = validateOnlyIdx !== -1;
  if (validateOnly) rest.splice(validateOnlyIdx, 1);
  return {
    quarantinePath: rest[0],
    reportPath: rest[1],
    today: today ?? new Date().toISOString().slice(0, 10),
    validateOnly,
  };
}

/**
 * `YYYY-MM-DD` matches ISO_DATE's shape but says nothing about whether it is
 * a real calendar date — "2026-99-99" matches the regex, and "2026-02-30"
 * parses (rolling forward to March 2nd) without ever throwing. Round-tripping
 * through Date and comparing the formatted result back to the original
 * string catches both.
 */
function isRealCalendarDate(str) {
  if (!ISO_DATE.test(str)) return false;
  const d = new Date(`${str}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === str;
}

function validateQuarantine(quarantine, quarantinePath, today) {
  if (!Array.isArray(quarantine)) {
    console.error(`ERROR: quarantine file (${quarantinePath}) must be a JSON array`);
    process.exit(2);
  }
  const errors = [];
  const horizon = new Date(`${today}T00:00:00.000Z`).getTime() + MAX_HORIZON_DAYS * DAY_MS;
  quarantine.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`quarantine[${i}] is not an object`);
      return;
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        errors.push(`quarantine[${i}] is missing required string field "${field}"`);
      }
    }
    if (typeof entry.expires === 'string') {
      if (!isRealCalendarDate(entry.expires)) {
        errors.push(
          `quarantine[${i}].expires "${entry.expires}" is not a real date (YYYY-MM-DD, and it ` +
            'must exist on the calendar)'
        );
      } else if (new Date(`${entry.expires}T00:00:00.000Z`).getTime() > horizon) {
        errors.push(
          `quarantine[${i}].expires "${entry.expires}" is more than ${MAX_HORIZON_DAYS} days past ` +
            `--today (${today}) — quarantine cannot be renewed into the far future; a distant date is ` +
            'how it stops meaning anything'
        );
      }
    }
  });
  if (errors.length) {
    console.error(`quarantine check FAILED (${quarantinePath} malformed):`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(2);
  }
}

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
