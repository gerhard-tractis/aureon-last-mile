/**
 * check-migration-safety-rule1.mjs (spec-87 fase 5)
 *
 * Rule 1: REJECT (exit 1) a migration that mixes DDL (CREATE TABLE/TYPE/
 * INDEX, ALTER TABLE) with a top-level, unbounded backfill. Split out of
 * check-migration-safety.mjs (review round 1) to keep both files under the
 * repo's 300-line limit — the file grew past it once B1/B2/B3/M5 each
 * needed real logic, not one-line tweaks.
 *
 * Two things production being down for six days, ending 2026-09-08, taught
 * (see docs/specs/spec-87-desbloquear-produccion.md, fase 3):
 *
 *   - a `CREATE FUNCTION` whose body contains an `UPDATE` is NOT a backfill
 *     that runs during the deploy, as long as the migration never calls it
 *     at the top level. `20260909000001_spec79_loaded_route_id.sql` is
 *     exactly this pattern, done correctly — this must not flag it.
 *   - a `DO $$ ... $$` block DOES run at deploy time, unlike a function
 *     body — review round 1, B1. The first version of this rule blanked
 *     every dollar-quoted body alike and missed a bare UPDATE hidden
 *     inside a top-level DO block.
 *
 * Also (review round 1):
 *   - B2: declaring a function is inert, but a migration that ALSO invokes
 *     it at the top level runs the backfill at deploy time — that is the
 *     line the spec-79 false-positive fix overcorrected past.
 *   - B3: comments must be stripped BEFORE dollar-quote parsing, or a `$$`
 *     inside a `-- ...` comment pairs with a real function's opening `$$`
 *     and blanks out the DDL this rule exists to see.
 *   - M5: the rejection message says "unbounded" — a single-row UPDATE by
 *     an `id` literal is not a backfill and must not reject.
 */

// A `CREATE TEMP[ORARY] TABLE` staged for a backfill's own bookkeeping
// (20260810000002's shape: stage matching rows, then UPDATE off it) is
// still schema-definition work sitting next to a live-table backfill in
// the same file, and belongs to the same "split it out" risk profile as a
// permanent `CREATE TABLE`.
const DDL_RE =
  /\b(CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE|ALTER\s+TABLE|CREATE\s+TYPE|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i;
const TOP_LEVEL_UPDATE_RE = /^[ \t]*UPDATE\s+\S+/im;
// SELECT must directly follow the table/column-list — not "SELECT anywhere
// within 300 chars", which used to cross statement boundaries once B1
// stopped blanking DO blocks and matched an unrelated `VALUES (...,
// (SELECT ...), ...)` insert or a nearby, different statement's SELECT.
const INSERT_SELECT_RE = /INSERT\s+INTO\s+\S+\s*(?:\([^)]*\))?\s*SELECT\b/i;
const BODY_UPDATE_RE = /\bUPDATE\s+\S+\s+SET\b/i;
const BODY_INSERT_SELECT_RE = INSERT_SELECT_RE;
const FUNC_DECL_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?[\w]+"?\.)?"?([\w]+)"?\s*\(/gi;

/** Strips `-- ...` line comments so comment text never matches a rule. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Blanks out the contents of every dollar-quoted body ($$...$$, $fn$...$fn$,
 * any tag). Kept for anyone reasoning about the nesting/tag-matching
 * behaviour on its own; `checkDdlBackfillMix` no longer uses it directly
 * (see `stripFunctionBodies` below — review round 1, B1).
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

/**
 * Blanks out only the bodies that do NOT run at deploy time on their own:
 * `CREATE [OR REPLACE] FUNCTION/PROCEDURE ... AS $$ ... $$`. A `DO $$ ...
 * $$` block is left intact, because unlike a function/procedure body it
 * executes immediately when the migration runs.
 *
 * Distinguished by the token immediately preceding the opening tag: a
 * function/procedure body is always introduced by `AS $$`/`AS $tag$`; a DO
 * block is introduced by `DO $$`/`DO $tag$` with no AS. Anything else
 * (unrecognised) is left unblanked too — safer for a guard whose job is to
 * not miss a live backfill, at the cost of possibly over-scanning.
 */
export function stripFunctionBodies(sql) {
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
    const before = sql.slice(0, startIdx);
    const prevTokenMatch = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    const prevToken = prevTokenMatch ? prevTokenMatch[1].toUpperCase() : '';
    result += prevToken === 'AS' ? body.replace(/[^\n]/g, ' ') : body;
    i = closeIdx + tag.length;
    tagRe.lastIndex = i;
  }
  result += sql.slice(i);
  return result;
}

/**
 * M5: a top-level UPDATE statement (semicolon-delimited) is bounded when
 * its WHERE clause is exactly a single equality against an `id` literal,
 * with no AND/OR/IN/IS [NOT] NULL widening it back out to many rows. No
 * WHERE clause at all is always unbounded.
 */
function isBoundedUpdateStatement(stmt) {
  const whereMatch = stmt.match(/\bWHERE\b([\s\S]*)$/i);
  if (!whereMatch) return false;
  const whereClause = whereMatch[1].trim();
  if (/\b(AND|OR|IN\s*\(|IS\s+NULL|IS\s+NOT\s+NULL)\b/i.test(whereClause)) return false;
  return /^id\s*=\s*'[^']+'\s*$/i.test(whereClause);
}

/** Any top-level (semicolon-delimited) UPDATE statement that isn't bounded. */
function hasUnboundedTopLevelUpdate(topLevel) {
  return topLevel
    .split(';')
    .some((stmt) => TOP_LEVEL_UPDATE_RE.test(stmt) && !isBoundedUpdateStatement(stmt));
}

/**
 * Any top-level (semicolon-delimited) statement that is a bulk
 * `INSERT INTO ... SELECT ...` backfill — scoped per-statement so it
 * cannot match across a `;` boundary into an unrelated later statement.
 */
function hasTopLevelInsertSelect(topLevel) {
  return topLevel.split(';').some((stmt) => INSERT_SELECT_RE.test(stmt));
}

/**
 * B2: declaring a function is inert (spec-79's pattern, which must not be
 * flagged), but a migration that ALSO invokes it at the top level runs its
 * body at deploy time — that's exactly equivalent to inlining the
 * backfill. Returns the function name if one is both declared (with a
 * backfill-shaped body) and invoked later in the same file, else null.
 * Runs on comment-stripped, NOT function-body-blanked text, so it can see
 * inside the body it's inspecting.
 */
function findInvokedBackfillFunction(commentsStripped) {
  const tagRe = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let match;
  while ((match = tagRe.exec(commentsStripped))) {
    const tag = match[0];
    const startIdx = match.index;
    const searchFrom = tagRe.lastIndex;
    const closeIdx = commentsStripped.indexOf(tag, searchFrom);
    if (closeIdx === -1) break;
    const before = commentsStripped.slice(0, startIdx);
    const prevTokenMatch = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    const prevToken = prevTokenMatch ? prevTokenMatch[1].toUpperCase() : '';
    if (prevToken === 'AS') {
      const header = before.slice(Math.max(0, before.length - 400));
      FUNC_DECL_RE.lastIndex = 0;
      const nameMatch = FUNC_DECL_RE.exec(header);
      const body = commentsStripped.slice(startIdx, closeIdx + tag.length);
      if (nameMatch && (BODY_UPDATE_RE.test(body) || BODY_INSERT_SELECT_RE.test(body))) {
        const name = nameMatch[1];
        const afterBody = commentsStripped.slice(closeIdx + tag.length);
        const callRe = new RegExp(`\\b(SELECT|PERFORM)\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`, 'i');
        if (callRe.test(afterBody)) return name;
      }
    }
    tagRe.lastIndex = closeIdx + tag.length;
  }
  return null;
}

/**
 * Rule 1. Returns a reason string if this file mixes DDL with a top-level,
 * unbounded backfill; null if it does not.
 */
export function checkDdlBackfillMix(rawSql) {
  // B3: comments are stripped BEFORE dollar-quote parsing.
  const commentsStripped = stripLineComments(rawSql);
  // B1: only CREATE FUNCTION/PROCEDURE bodies are blanked; a DO $$ ... $$
  // block runs at deploy time and must stay visible to the scans below.
  const topLevel = stripFunctionBodies(commentsStripped);
  if (!DDL_RE.test(topLevel)) return null;
  if (hasUnboundedTopLevelUpdate(topLevel)) {
    return 'contains DDL and a top-level, unbounded UPDATE (a backfill outside any function body) in the same file';
  }
  if (hasTopLevelInsertSelect(topLevel)) {
    return 'contains DDL and a top-level INSERT ... SELECT (a bulk backfill outside any function body) in the same file';
  }
  const invokedFn = findInvokedBackfillFunction(commentsStripped);
  if (invokedFn) {
    return `contains DDL and both declares AND invokes "${invokedFn}", whose body performs a backfill — declaring alone is inert, but calling it runs the backfill at deploy time`;
  }
  return null;
}
