/**
 * check-migration-safety.mjs (spec-87 fase 5)
 *
 * Six days of production being down, ending 2026-09-08, taught two things
 * the hard way (see docs/specs/spec-87-desbloquear-produccion.md, fase 3):
 *
 *   - a `CREATE FUNCTION` whose body contains an `UPDATE` is NOT a backfill
 *     that runs during the deploy, as long as the migration never calls it
 *     at the top level. `20260909000001_spec79_loaded_route_id.sql` is
 *     exactly this pattern, done correctly — this script must not flag it.
 *   - `20260911000003` withdraws the index `20260911000002` (h5c) creates,
 *     unconditionally, one migration later. Retiring an index on purpose is
 *     not a defect.
 *
 * Three rules:
 *
 *   1. REJECT (exit 1) a migration that mixes DDL (CREATE TABLE/TYPE/INDEX,
 *      ALTER TABLE) with a top-level, unbounded backfill (a bare UPDATE ...
 *      SET or INSERT INTO ... SELECT that is NOT inside a dollar-quoted
 *      function body). The two have opposite risk profiles: schema changes
 *      are fast and belong in the deploy; a backfill over a live table is
 *      slow and belongs in its own, measured step (spec-87 fase 3/4).
 *   2. WARN (::warning::, exit 0) on a CREATE INDEX / CREATE UNIQUE INDEX
 *      without CONCURRENTLY over a known-large table (packages, orders,
 *      dispatches, routes).
 *   3. WARN (::warning::, exit 0) on a CREATE UNIQUE INDEX over an
 *      EXISTING table (not one created earlier in the same file) that has
 *      no preceding COUNT(*)-guarded conditional — the h5c pattern
 *      (20260911000002) is the example of doing this correctly and must
 *      not warn.
 *
 * A warning never fails the build. Turning rules 2/3 into rejections would
 * block CI on a legitimate CREATE INDEX and teach someone to disable this
 * guard — see the spec's own warning about that trade.
 *
 * Usage:
 *   node check-migration-safety.mjs <file-or-dir> [<file-or-dir> ...]
 *   node check-migration-safety.mjs --base <sha> <migrations-dir>
 *
 * With --base, only migration files added since <sha> (git diff
 * --diff-filter=A) are checked — the migrations/ directory holds 90+ files
 * that predate this guard and legitimately mix DDL with a top-level
 * backfill; scanning the whole history would reject the build forever.
 *
 * Exit codes:
 *   0  ok — nothing rejected (warnings may still have printed)
 *   1  a migration mixes DDL with an unbounded top-level backfill
 *   2  input error
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const LARGE_TABLES = ['packages', 'orders', 'dispatches', 'routes'];

export function usageError(msg) {
  console.error(`check-migration-safety: ${msg}`);
  process.exit(2);
}

/**
 * Blanks out the contents of every dollar-quoted body ($$...$$, $fn$...$fn$,
 * any tag) so a top-level statement scan never sees what is written inside a
 * function/DO block. Newlines are preserved so line numbers still line up
 * for anyone reading a diagnostic by eye.
 */
export function stripDollarQuotedBodies(sql) {
  const tagRe = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let result = '';
  let i = 0;
  let match;
  while ((match = tagRe.exec(sql))) {
    const tag = match[0];
    const startIdx = match.index;
    const searchFrom = tagRe.lastIndex;
    const closeIdx = sql.indexOf(tag, searchFrom);
    if (closeIdx === -1) {
      result += sql.slice(i);
      i = sql.length;
      break;
    }
    result += sql.slice(i, startIdx);
    const body = sql.slice(startIdx, closeIdx + tag.length);
    result += body.replace(/[^\n]/g, ' ');
    i = closeIdx + tag.length;
    tagRe.lastIndex = i;
  }
  result += sql.slice(i);
  return result;
}

/** Strips `-- ...` line comments so comment text never matches a rule. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const DDL_RE = /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TYPE|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i;
const TOP_LEVEL_UPDATE_RE = /^[ \t]*UPDATE\s+\S+/im;
const TOP_LEVEL_INSERT_SELECT_RE = /^[ \t]*INSERT\s+INTO\s+[\s\S]{0,300}?\bSELECT\b/im;

/**
 * Rule 1. Returns a reason string if this file mixes DDL with a top-level,
 * unbounded backfill; null if it does not.
 */
export function checkDdlBackfillMix(rawSql) {
  const topLevel = stripLineComments(stripDollarQuotedBodies(rawSql));
  if (!DDL_RE.test(topLevel)) return null;
  if (TOP_LEVEL_UPDATE_RE.test(topLevel)) {
    return 'contains DDL and a top-level UPDATE (a backfill outside any function body) in the same file';
  }
  if (TOP_LEVEL_INSERT_SELECT_RE.test(topLevel)) {
    return 'contains DDL and a top-level INSERT ... SELECT (a bulk backfill outside any function body) in the same file';
  }
  return null;
}

/**
 * Rule 2. Returns a list of warning strings for CREATE INDEX / CREATE
 * UNIQUE INDEX statements without CONCURRENTLY over a known-large table.
 * Runs against the raw text (not comment-stripped, not dollar-stripped) so
 * an index built via `EXECUTE '...'` inside a DO block (h5c's own pattern)
 * is still caught.
 */
export function checkIndexConcurrency(rawSql) {
  const warnings = [];
  const stmtRe = /CREATE\s+(UNIQUE\s+)?INDEX\b[\s\S]*?;/gi;
  let m;
  while ((m = stmtRe.exec(rawSql))) {
    const stmt = m[0];
    if (/CONCURRENTLY/i.test(stmt)) continue;
    const onMatch = stmt.match(/\bON\s+(?:public\.)?['"]?(\w+)['"]?/i);
    const table = onMatch ? onMatch[1] : null;
    if (table && LARGE_TABLES.includes(table)) {
      warnings.push(
        `CREATE ${m[1] ? 'UNIQUE ' : ''}INDEX on "${table}" (known-large table) without CONCURRENTLY`
      );
    }
  }
  return warnings;
}

/**
 * Rule 3. Returns a list of warning strings for a CREATE UNIQUE INDEX over
 * an existing (not created-in-this-file) table that has no preceding
 * COUNT(*) + IF conditional guard.
 */
export function checkUniqueIndexGuard(rawSql) {
  const warnings = [];
  const stmtRe = /CREATE\s+UNIQUE\s+INDEX\b[\s\S]*?;/gi;
  let m;
  while ((m = stmtRe.exec(rawSql))) {
    const stmt = m[0];
    const idxStart = m.index;
    const onMatch = stmt.match(/\bON\s+(?:public\.)?['"]?(\w+)['"]?/i);
    const table = onMatch ? onMatch[1] : null;
    if (!table) continue;

    const createdHere = new RegExp(
      `CREATE\\s+TABLE\\b[\\s\\S]{0,80}\\b${table}\\b`,
      'i'
    ).test(rawSql.slice(0, idxStart));
    if (createdHere) continue; // brand-new table, no live rows possible

    const before = rawSql.slice(0, idxStart);
    const countIdx = before.search(/SELECT\s+COUNT\s*\(\s*\*\s*\)/i);
    const guarded = countIdx !== -1 && /\bIF\b/i.test(before.slice(countIdx));
    if (!guarded) {
      warnings.push(
        `CREATE UNIQUE INDEX on "${table}" (existing table) with no preceding COUNT(*)-guarded conditional`
      );
    }
  }
  return warnings;
}

function checkFile(filePath) {
  const rawSql = readFileSync(filePath, 'utf8');
  const rejectReason = checkDdlBackfillMix(rawSql);
  const warnings = [
    ...checkIndexConcurrency(rawSql),
    ...checkUniqueIndexGuard(rawSql),
  ];
  return { filePath, rejectReason, warnings };
}

function listSqlFiles(target) {
  const st = statSync(target);
  if (st.isDirectory()) {
    return readdirSync(target)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(target, f));
  }
  return [target];
}

function addedFilesSince(baseSha, dir) {
  // Three-dot diff (merge-base) first — the right answer on a normal clone.
  // A shallow `git fetch --depth=1 origin <base>` (see ci.yml) may not give
  // git enough history to compute a merge-base, in which case this comes
  // back empty; fall back to a plain two-dot diff against baseSha, same
  // fallback check-spec-fields.sh already uses for the same reason.
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=A', `${baseSha}...HEAD`, '--', dir],
      { encoding: 'utf8' }
    );
  } catch {
    out = '';
  }
  if (!out.trim()) {
    try {
      out = execFileSync(
        'git',
        ['diff', '--name-only', '--diff-filter=A', baseSha, '--', dir],
        { encoding: 'utf8' }
      );
    } catch (e) {
      usageError(`git diff against ${baseSha} failed: ${e.message}`);
    }
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.sql'));
}

function main(argv) {
  const args = [...argv];
  let base = null;
  const positional = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--base') {
      base = args.shift();
      if (!base) usageError('--base requires a value');
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) usageError('no file or directory given');

  let files;
  if (base) {
    if (positional.length !== 1) usageError('--base takes exactly one migrations directory');
    files = addedFilesSince(base, positional[0]);
  } else {
    files = positional.flatMap(listSqlFiles);
  }

  if (files.length === 0) {
    console.log('check-migration-safety: no migration files to check');
    return 0;
  }

  let rejected = false;
  for (const f of files) {
    let result;
    try {
      result = checkFile(f);
    } catch (e) {
      usageError(`could not read ${f}: ${e.message}`);
    }
    if (result.rejectReason) {
      rejected = true;
      console.error(`::error::${f} — ${result.rejectReason}`);
    }
    for (const w of result.warnings) {
      console.log(`::warning::${f} — ${w}`);
    }
  }

  if (rejected) {
    console.error(
      'check-migration-safety: at least one migration mixes DDL with an unbounded top-level backfill. ' +
        'Split the backfill into its own function, and call it by hand after measuring — see spec-87 fase 3/4.'
    );
    return 1;
  }
  console.log(`check-migration-safety: OK — checked ${files.length} migration(s)`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
