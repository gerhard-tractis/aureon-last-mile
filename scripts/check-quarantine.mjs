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

function parseToday(argv) {
  const idx = argv.indexOf('--today');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return new Date().toISOString().slice(0, 10);
}

function validateQuarantine(quarantine, quarantinePath) {
  if (!Array.isArray(quarantine)) {
    console.error(`ERROR: quarantine file (${quarantinePath}) must be a JSON array`);
    process.exit(2);
  }
  const errors = [];
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
    if (typeof entry.expires === 'string' && !ISO_DATE.test(entry.expires)) {
      errors.push(`quarantine[${i}].expires "${entry.expires}" is not an ISO date (YYYY-MM-DD)`);
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
  const [, , quarantinePath, reportPath, ...rest] = process.argv;
  if (!quarantinePath || !reportPath) {
    usageError('both <quarantine.json> and <playwright-report.json> are required');
  }
  const today = parseToday(rest);

  const quarantine = readJson(quarantinePath, 'quarantine file');
  validateQuarantine(quarantine, quarantinePath);

  const report = readJson(reportPath, 'playwright report');
  const allSpecs = [];
  for (const suite of report.suites ?? []) {
    walkSpecs(suite, allSpecs);
  }
  const failing = allSpecs.filter((s) => s.failed);

  const errors = [];

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

  console.log(
    `quarantine check ok — ${failing.length} declared failure(s), 0 undeclared, 0 expired, 0 stale entries`
  );
}

main();
