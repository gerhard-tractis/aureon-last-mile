/**
 * check-quarantine-validate.mjs (spec-87 fase 1)
 *
 * Input handling and structural validation for check-quarantine.mjs, split
 * out to keep both files under the repo's 300-line guideline. Owns: arg
 * parsing, JSON loading with loud failure, and quarantine.json's own shape
 * (required fields, calendar-real dates, the 30-day renewal horizon).
 * Everything here is oblivious to the Playwright report — see
 * check-quarantine.mjs for the report-shaped checks (report.errors,
 * report.stats, the suite walk, and the match/expiry/stale logic).
 */
import fs from 'node:fs';

export const REQUIRED_FIELDS = ['spec', 'test', 'reason', 'owner', 'expires'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// An entry cannot be renewed further out than this without a human looking
// at it again — otherwise "expires" degenerates into a decoration and
// quarantine becomes permanent, which is the failure mode fase 1 exists to
// prevent (review round 1).
const MAX_HORIZON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function usageError(msg) {
  console.error(`ERROR: ${msg}`);
  console.error(
    'Usage: node check-quarantine.mjs <quarantine.json> <playwright-report.json> [--today YYYY-MM-DD]'
  );
  process.exit(2);
}

export function readJson(filePath, label) {
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
export function parseArgs(argv) {
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
    // m7 (spec-87 fase 1, re-review round 4): `toISOString()` reads UTC, not
    // the runner's local clock, and NEITHER ci.yml's `--validate-only` call
    // NOR deploy.yml's e2e-qa invocation passes --today — both rely on this
    // default. In Madrid (UTC+2) that means an entry keeps reading as "not
    // yet expired" for the first two hours of the day AFTER its `expires`
    // date. Direction is permissive only, bounded at two hours, and matches
    // the same UTC boundary `isRealCalendarDate` already uses for parsing —
    // switching just this default to local time would make the two
    // disagree with each other depending on the runner's TZ, which is a
    // worse failure mode than a fixed, documented two-hour grace window.
    // Left as UTC deliberately; not fixed, per m7's own "if not, document it".
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
export function isRealCalendarDate(str) {
  if (!ISO_DATE.test(str)) return false;
  const d = new Date(`${str}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === str;
}

export function validateQuarantine(quarantine, quarantinePath, today) {
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
