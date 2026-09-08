/**
 * check-migration-safety.mjs (spec-87 fase 5)
 *
 * Three rules:
 *
 *   1. REJECT (exit 1) a migration that mixes DDL (CREATE TABLE/TYPE/INDEX,
 *      ALTER TABLE) with a top-level, unbounded backfill. See
 *      check-migration-safety-rule1.mjs — split out (review round 1) to
 *      keep both files under the repo's 300-line limit.
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
 * With --base, only migration files added/modified/renamed since <sha>
 * (git diff --diff-filter=AMR) are checked — the migrations/ directory
 * holds 90+ files that predate this guard and legitimately mix DDL with a
 * top-level backfill; scanning the whole history would reject the build
 * forever. A pre-existing rule-1 violation on a MODIFIED file is
 * downgraded to a warning (review round 1, B4) — only a NEW violation
 * hard-rejects.
 *
 * Exit codes:
 *   0  ok — nothing rejected (warnings may still have printed)
 *   1  a migration mixes DDL with an unbounded top-level backfill
 *   2  input error
 */
import { readFileSync } from 'node:fs';
import { checkDdlBackfillMix } from './check-migration-safety-rule1.mjs';
import { listSqlFiles, changedFilesSince, rejectedAtBase } from './check-migration-safety-git.mjs';

export { checkDdlBackfillMix } from './check-migration-safety-rule1.mjs';
export { stripDollarQuotedBodies, stripFunctionBodies } from './check-migration-safety-rule1.mjs';

const LARGE_TABLES = ['packages', 'orders', 'dispatches', 'routes'];

export function usageError(msg) {
  console.error(`check-migration-safety: ${msg}`);
  process.exit(2);
}

/** Strips `-- ...` line comments so comment text never matches a rule. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

// m8: matches an optionally-quoted schema prefix (`public.` or `"public".`)
// followed by an optionally-quoted table name, so `ON "public"."packages"`
// resolves to table "packages", not "public".
const ON_TABLE_RE = /\bON\s+(?:"?public"?\.)?"?(\w+)"?/i;

/**
 * Rule 2. Returns a list of warning strings for CREATE INDEX / CREATE
 * UNIQUE INDEX statements without CONCURRENTLY over a known-large table.
 * Runs against comment-stripped text (m9: a `-- ...` comment mentioning
 * "CREATE INDEX" in prose used to produce a false warning) but NOT
 * dollar-stripped, so an index built via `EXECUTE '...'` inside a DO block
 * (h5c's own pattern) is still caught. The statement may end in `;` or at
 * end-of-file (m8: a regex requiring `;` made a semicolon-less final
 * statement invisible).
 */
export function checkIndexConcurrency(rawSql) {
  const sql = stripLineComments(rawSql);
  const warnings = [];
  const stmtRe = /CREATE\s+(UNIQUE\s+)?INDEX\b[\s\S]*?(?:;|$)/gi;
  let m;
  while ((m = stmtRe.exec(sql))) {
    const stmt = m[0];
    if (/CONCURRENTLY/i.test(stmt)) continue;
    const onMatch = stmt.match(ON_TABLE_RE);
    const table = onMatch ? onMatch[1] : null;
    if (table && LARGE_TABLES.includes(table)) {
      warnings.push(
        `CREATE ${m[1] ? 'UNIQUE ' : ''}INDEX on "${table}" (known-large table) without CONCURRENTLY`
      );
    }
  }
  return warnings;
}

/** Index of the LAST match of `re` in `text` before `re` stops matching, or -1. */
function lastMatchIndex(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  let last = -1;
  while ((m = g.exec(text))) last = m.index;
  return last;
}

/**
 * Rule 3. Returns a list of warning strings for a CREATE UNIQUE INDEX over
 * an existing (not created-in-this-file) table that has no preceding
 * COUNT(*) + IF conditional guard.
 */
export function checkUniqueIndexGuard(rawSql) {
  const sql = stripLineComments(rawSql); // m9: a mention in a comment must not count
  const warnings = [];
  const stmtRe = /CREATE\s+UNIQUE\s+INDEX\b[\s\S]*?(?:;|$)/gi; // m8: allow EOF, not just ';'
  let m;
  while ((m = stmtRe.exec(sql))) {
    const stmt = m[0];
    const idxStart = m.index;
    const onMatch = stmt.match(ON_TABLE_RE); // m8: handle a quoted schema prefix
    const table = onMatch ? onMatch[1] : null;
    if (!table) continue;

    // m7: match the table CREATE TABLE actually names, not "any word within
    // 80 chars" — a column or a REFERENCES target sharing the table's name
    // used to falsely count as "created in this file".
    const createdHere = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?${table}"?\\b`,
      'i'
    ).test(sql.slice(0, idxStart));
    if (createdHere) continue; // brand-new table, no live rows possible

    // M6: the NEAREST preceding COUNT(*), not just "any earlier one" — an
    // unrelated function's own, unconnected COUNT(*)+IF used to "guard" an
    // index it has nothing to do with. The guard only counts if that IF
    // has not already closed (no END IF yet) by the time we reach the
    // index — i.e. the index sits inside the guarded branch.
    const before = sql.slice(0, idxStart);
    const countIdx = lastMatchIndex(before, /SELECT\s+COUNT\s*\(\s*\*\s*\)/i);
    let guarded = false;
    if (countIdx !== -1) {
      const between = before.slice(countIdx);
      // Exclude the "IF" inside "END IF" itself — otherwise the closing
      // token of an already-closed guard is mistaken for the opening one.
      const lastIfIdx = lastMatchIndex(between, /(?<!END\s)\bIF\b/i);
      if (lastIfIdx !== -1) {
        // Guarded only if that IF has not already closed (no END IF yet)
        // by the time we reach the index — i.e. the index still sits
        // inside the guarded branch, not after it.
        guarded = !/\bEND\s+IF\b/i.test(between.slice(lastIfIdx));
      }
    }
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
  let fileStatus = new Map();
  if (base) {
    if (positional.length !== 1) usageError('--base takes exactly one migrations directory');
    const changed = changedFilesSince(base, positional[0], usageError);
    files = changed.map((f) => f.filePath);
    fileStatus = new Map(changed.map((f) => [f.filePath, f.status]));
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
      const status = fileStatus.get(f);
      // B4: a pre-existing violation merely being touched (M/R) does not
      // hard-reject the build — only a NEW violation does. Added files
      // always reject; there is no "before" for them to have been safe at.
      if (base && (status === 'M' || status === 'R') && rejectedAtBase(base, f)) {
        console.log(
          `::warning::${f} — ${result.rejectReason} (already present before this PR at ${base}; not blocking, but worth fixing while the file is being touched)`
        );
      } else {
        rejected = true;
        console.error(`::error::${f} — ${result.rejectReason}`);
      }
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
