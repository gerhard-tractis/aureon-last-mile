/**
 * check-migration-safety-rule23.mjs (spec-87 fase 5)
 *
 * Rules 2/3, split out of check-migration-safety.mjs (spec-88 fase 4 review)
 * to keep the main file under the repo's 300-line limit — the same reason
 * rule 1 was already split into check-migration-safety-rule1.mjs.
 *
 *   2. WARN (::warning::, exit 0) on a CREATE INDEX / CREATE UNIQUE INDEX
 *      without CONCURRENTLY over a known-large table (packages, orders,
 *      dispatches, routes).
 *   3. WARN (::warning::, exit 0) on a CREATE UNIQUE INDEX over an
 *      EXISTING table (not one created earlier in the same file) that has
 *      no preceding COUNT(*)-guarded conditional — the h5c pattern
 *      (20260911000002) is the example of doing this correctly and must
 *      not warn.
 */

const LARGE_TABLES = ['packages', 'orders', 'dispatches', 'routes'];

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
    // F2 (review round 3): a BARE CREATE TABLE only — `IF NOT EXISTS` is
    // precisely the syntax whose contract is "may already exist, with rows
    // and readers", the opposite of "brand-new table, no live rows
    // possible" this exemption exists for.
    const createdHere = new RegExp(
      `CREATE\\s+TABLE\\s+(?:"?public"?\\.)?"?${table}"?\\b`,
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
      // m9 (review round 2): `(?<!END\s)` only excludes a SINGLE space/
      // newline between END and IF — `END  IF` or `END\nIF` still matched
      // as if it were the opening IF. `(?<!END\s+)` is a variable-width
      // lookbehind, which V8 supports.
      const lastIfIdx = lastMatchIndex(between, /(?<!END\s+)\bIF\b/i);
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
