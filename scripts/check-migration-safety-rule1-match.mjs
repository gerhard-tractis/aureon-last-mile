/**
 * check-migration-safety-rule1-match.mjs (spec-87 fase 5, review round 2)
 *
 * Small matching helpers for check-migration-safety-rule1.mjs, split out to
 * keep both files under the repo's 300-line limit — rule1.mjs grew past it
 * once B1 (nearest-match attribution) and M6 (destination-table-created-here
 * downgrade) each needed real logic.
 */

/**
 * Blanks out the contents of every dollar-quoted body ($$...$$, $fn$...$fn$,
 * any tag). Kept for anyone reasoning about the nesting/tag-matching
 * behaviour on its own; `checkDdlBackfillMix` no longer uses it directly
 * (see `stripFunctionBodies` in check-migration-safety-rule1.mjs — review
 * round 1, B1).
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

/** Index of the LAST match of `re` in `text`, or -1 — used to find the match
 * NEAREST to a given point (B1: the nearest CREATE FUNCTION to its `AS $$`,
 * not the first one in a lookback window; M6: the nearest preceding
 * CREATE TABLE). */
export function lastMatchIndex(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  let last = -1;
  while ((m = g.exec(text))) last = m.index;
  return last;
}

/** The name captured by the NEAREST (last) match of `funcDeclRe` in `text`,
 * or null. B1: a short, unrelated function declared earlier in the 400-char
 * lookback window used to steal credit for a body that belongs to a
 * different, later function — this returns the LAST declaration, not the
 * first `exec()` hit. */
export function nearestFuncDeclName(text, funcDeclRe) {
  const idx = lastMatchIndex(text, funcDeclRe);
  if (idx === -1) return null;
  const g = new RegExp(funcDeclRe.source, funcDeclRe.flags.includes('g') ? funcDeclRe.flags : `${funcDeclRe.flags}g`);
  g.lastIndex = idx;
  const m = g.exec(text);
  return m ? m[1] : null;
}

/** F1 (review round 3): every table written by an UPDATE ... SET or
 * INSERT INTO in `text`, in first-seen order, deduplicated. Unlike
 * `extractDestinationTable` below, this does NOT anchor to the start of the
 * string — called against a whole FUNCTION BODY (which starts at the `$$`
 * tag, e.g. `BEGIN\n  UPDATE ...`), a `^`-anchored single-match scan can
 * never see the UPDATE at all and silently falls through to the first
 * INSERT INTO, hiding every OTHER write in the same body. M6 must see ALL
 * of them: a backfill degrades to a warning only if EVERY table it writes
 * was CREATE TABLE'd earlier in the file, not just the one this used to
 * happen to find. */
export function extractAllDestinationTables(text) {
  const tables = [];
  const seen = new Set();
  const add = (name) => {
    if (!seen.has(name)) {
      seen.add(name);
      tables.push(name);
    }
  };
  const updateRe = /\bUPDATE\s+(?:"?public"?\.)?"?(\w+)"?\s+SET\b/gi;
  let m;
  while ((m = updateRe.exec(text))) add(m[1]);
  const insertRe = /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?(\w+)"?/gi;
  while ((m = insertRe.exec(text))) add(m[1]);
  return tables;
}

/** M6: the destination table of an UPDATE or INSERT INTO statement, or
 * null. Used to tell whether a backfill writes into a table CREATE TABLE'd
 * earlier in the same file — that cannot lock anyone out (no OID for
 * another backend to have opened, no readers yet), so it degrades to a
 * warning instead of a hard reject. Only safe to call against a SINGLE
 * statement known to start at the UPDATE/INSERT itself (top-level
 * per-statement violations) — never against a function body; use
 * `extractAllDestinationTables` for that. */
export function extractDestinationTable(stmt) {
  let m = stmt.match(/^\s*UPDATE\s+(?:"?public"?\.)?"?(\w+)"?/i);
  if (m) return m[1];
  m = stmt.match(/INSERT\s+INTO\s+(?:"?public"?\.)?"?(\w+)"?/i);
  return m ? m[1] : null;
}

/** M6: whether `table` was named by a BARE `CREATE TABLE` (no `IF NOT
 * EXISTS`) appearing in `textBefore`. F2 (review round 3): `IF NOT EXISTS`
 * is precisely the syntax whose contract is "may already exist, with rows
 * and with readers" — the opposite of M6's premise ("no OID exists for
 * another backend to have opened, no readers exist yet"). Excluding it
 * deliberately widens what counts as unsafe, not narrows it. */
export function isTableCreatedBefore(table, textBefore) {
  return new RegExp(`CREATE\\s+TABLE\\s+(?:"?public"?\\.)?"?${table}"?\\b`, 'i').test(textBefore);
}

/** Splits `text` on top-level `;`, keeping each statement's start offset
 * within `text` — needed by M6 to know what DDL precedes a given statement. */
export function splitStatementsWithIndex(text) {
  const stmts = [];
  let idx = 0;
  for (const part of text.split(';')) {
    stmts.push({ stmt: part, startIdx: idx });
    idx += part.length + 1;
  }
  return stmts;
}

/**
 * M5: whether `afterBody` (top-level text following a backfill function's
 * declaration) invokes it — as a bare `PERFORM name(`/`SELECT name(`, or as
 * the idiomatic way to call a `RETURNS TABLE(...)` function,
 * `SELECT ... FROM name(`. `[^;]*` keeps the FROM-form scoped to a single
 * statement so it cannot cross into an unrelated, later SELECT.
 */
export function invokesFunction(afterBody, name) {
  const perform = new RegExp(`\\bPERFORM\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`, 'i');
  const selectDirect = new RegExp(`\\bSELECT\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`, 'i');
  const selectFrom = new RegExp(`\\bSELECT\\b[^;]*\\bFROM\\s+(?:"?public"?\\.)?"?${name}"?\\s*\\(`, 'i');
  return perform.test(afterBody) || selectDirect.test(afterBody) || selectFrom.test(afterBody);
}
