/**
 * check-migration-safety-acl-parse.mjs (spec-88 fase 4, review round 2)
 *
 * Low-level SQL parsing shared by check-migration-safety-acl.mjs's two ACL
 * rules — split out to keep both files under the repo's 300-line limit,
 * same reason rule 1 was already split into check-migration-safety-rule1.mjs.
 *
 * Extracts, from raw migration SQL: every `CREATE [OR REPLACE] FUNCTION`
 * (name, normalized signature, SECURITY DEFINER/INVOKER), every `REVOKE
 * {ALL|EXECUTE} ON FUNCTION` (name, signature, full role list), and every
 * `GRANT EXECUTE ON FUNCTION` (name, signature, full role list).
 */

/** Strips `-- ...` line comments so comment text never matches a rule
 * (same pattern as check-migration-safety.mjs's rules 2/3) — otherwise a
 * commented-out `-- REVOKE ALL ON FUNCTION ... FROM PUBLIC;` would count as
 * a real REVOKE and silence rule 5 for a function that has none. */
function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Returns { params, endIdx } for the parenthesized group starting at
 * `text[openParenIdx] === '('`, matching nested parens (e.g. `numeric(10,2)`
 * inside a parameter type) — a plain `[^)]*` would stop at the FIRST `)`,
 * inside the nested group. Returns null on unbalanced input (malformed SQL;
 * callers skip it rather than throw, matching the rest of this guard). */
function extractParenGroup(text, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return { params: text.slice(openParenIdx + 1, i), endIdx: i };
    }
  }
  return null;
}

/** Splits a parameter list on top-level commas only — a comma inside a
 * nested `(...)` (e.g. `numeric(10,2)`) must not split the parameter. */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Multi-word Postgres type names whose first word must NOT be mistaken for
// a parameter name (`double precision`, `timestamp with time zone`,
// `character varying`, `bit varying`). None of this repo's audited
// functions use one, but a false "this is the param name" strip would
// silently corrupt the signature rather than just miss a match.
const MULTIWORD_TYPE_STARTS = new Set(['double', 'timestamp', 'time', 'character', 'bit']);

/** Normalizes a single CREATE-FUNCTION-style parameter (`p_manifest_id
 * UUID`, or a bare REVOKE-style type `UUID`) down to just its type, so a
 * CREATE FUNCTION signature and a REVOKE signature can be compared. */
function extractTypeToken(param) {
  let p = param
    .replace(/\bDEFAULT\b[\s\S]*$/i, '')
    .replace(/=[\s\S]*$/, '')
    .trim();
  p = p.replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, '');
  const tokens = p.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (
    tokens.length > 1 &&
    /^[a-z_][a-z0-9_]*$/i.test(tokens[0]) &&
    !MULTIWORD_TYPE_STARTS.has(tokens[0].toLowerCase())
  ) {
    tokens.shift(); // drop the parameter name — REVOKE's list has none to drop
  }
  return tokens.join(' ').toLowerCase();
}

/** A comma-joined, type-only, lower-cased signature — the shared key both
 * CREATE FUNCTION and REVOKE/GRANT ON FUNCTION are normalized to. */
export function normalizeSignature(paramsRaw) {
  return splitTopLevelCommas(paramsRaw).map(extractTypeToken).join(',');
}

/** Splits a `FROM ...`/`TO ...` role list on commas into lowercase role
 * names — B3 (review round 2): a naive `\s+(\w+)` capture only grabs the
 * FIRST role in `FROM anon, PUBLIC` / `TO anon, authenticated`, silently
 * missing every role after the first comma. */
function splitRoleList(roleListRaw) {
  return roleListRaw
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

const CREATE_FN_RE = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
// REVOKE ALL [PRIVILEGES] or REVOKE EXECUTE — both close the default PUBLIC
// grant equally; requiring only "ALL" (medium finding, review round 2)
// rejected a migration that correctly used the narrower, equally valid form.
const REVOKE_RE = /REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
const GRANT_RE = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;

// Marks the start of a dollar-quoted function body ($$, $function$, etc.) —
// used to bound the search window for SECURITY DEFINER/INVOKER so it never
// reads into the body itself (a body that happens to mention the words
// would otherwise produce a false match).
const DOLLAR_TAG_RE = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Whether the CREATE FUNCTION whose parameter list ends at `afterParensIdx`
 * declares SECURITY DEFINER. Searches only the option-clause window between
 * the closing `)` of the parameter list and the start of the function body
 * (or a 1000-char cap, for the rare body that isn't dollar-quoted) — never
 * the body itself. Defaults to INVOKER (Postgres's own default when the
 * clause is omitted) when neither keyword appears. */
function isSecurityDefinerClause(sql, afterParensIdx) {
  const dollarMatch = DOLLAR_TAG_RE.exec(sql.slice(afterParensIdx));
  const windowEnd = dollarMatch
    ? afterParensIdx + dollarMatch.index
    : Math.min(sql.length, afterParensIdx + 1000);
  const window = sql.slice(afterParensIdx, windowEnd);
  return /\bSECURITY\s+DEFINER\b/i.test(window);
}

/** Every `CREATE [OR REPLACE] FUNCTION public.name(...)` in `rawSql`, with
 * its normalized signature and whether it is SECURITY DEFINER. */
export function findCreateFunctionSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(CREATE_FN_RE.source, CREATE_FN_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    results.push({
      name: m[2],
      signature: normalizeSignature(group.params),
      isSecurityDefiner: isSecurityDefinerClause(sql, group.endIdx + 1),
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** Every `REVOKE {ALL|EXECUTE} ON FUNCTION public.name(...) FROM <roles>`
 * in `rawSql`, `roles` being the FULL comma-split role list (B3). */
export function findRevokeSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(REVOKE_RE.source, REVOKE_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    const after = sql.slice(group.endIdx + 1, group.endIdx + 200);
    const fromMatch = after.match(/FROM\s+([^;]+)/i);
    results.push({
      name: m[1],
      signature: normalizeSignature(group.params),
      roles: fromMatch ? splitRoleList(fromMatch[1]) : [],
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** Every `GRANT EXECUTE ON FUNCTION public.name(...) TO <roles>` in
 * `rawSql`, `roles` being the FULL comma-split role list (B3). */
export function findGrantExecuteSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(GRANT_RE.source, GRANT_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    const after = sql.slice(group.endIdx + 1, group.endIdx + 200);
    const toMatch = after.match(/TO\s+([^;]+)/i);
    results.push({
      name: m[1],
      signature: normalizeSignature(group.params),
      roles: toMatch ? splitRoleList(toMatch[1]) : [],
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** 1-based line number of character offset `index` within `text`. */
export function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}
