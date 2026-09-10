/**
 * check-migration-safety-acl-parse.mjs (spec-88 fase 4, review rounds 2-3)
 *
 * Low-level SQL parsing shared by check-migration-safety-acl.mjs's two ACL
 * rules — split out to keep both files under the repo's 300-line limit,
 * same reason rule 1 was already split into check-migration-safety-rule1.mjs.
 *
 * Extracts, from raw migration SQL: every `CREATE [OR REPLACE] FUNCTION`
 * (name, normalized signature, SECURITY DEFINER/INVOKER, RETURNS TRIGGER),
 * every `REVOKE {ALL|EXECUTE} ON FUNCTION` (name, signature or null for a
 * bare no-arg-list statement, full role list), every `GRANT EXECUTE ON
 * FUNCTION` (same shape), and every schema-wide `GRANT EXECUTE ON ALL
 * FUNCTIONS IN SCHEMA` (role list only — it has no single function name).
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

/**
 * Splits a `FROM ...`/`TO ...` role list on commas into lowercase role
 * names. Two fixes from review round 2/3:
 *  - B3 (round 2): a naive `\s+(\w+)` capture only grabs the FIRST role in
 *    `FROM anon, PUBLIC` / `TO anon, authenticated`, silently missing
 *    every role after the first comma.
 *  - CASCADE/RESTRICT (round 3, menor): `REVOKE ... FROM PUBLIC CASCADE` is
 *    valid Postgres — CASCADE/RESTRICT is a trailing keyword of the REVOKE
 *    statement, not a role name, and must be stripped before splitting or
 *    it corrupts the last role into the literal string "public cascade".
 */
function splitRoleList(roleListRaw) {
  const withoutTrailingKeyword = roleListRaw.replace(/\s+(CASCADE|RESTRICT)\s*$/i, '');
  return withoutTrailingKeyword
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

const CREATE_FN_RE = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
// REVOKE ALL [PRIVILEGES] or REVOKE EXECUTE — both close the default PUBLIC
// grant equally; requiring only "ALL" (medium finding, review round 2)
// rejected a migration that correctly used the narrower, equally valid form.
// No trailing `\(` requirement (round 3, menor): `REVOKE ... ON FUNCTION
// name FROM role` with NO argument list is legal Postgres (PG14+) when the
// name is unambiguous — the paren group, if present, is parsed separately
// below.
const REVOKE_HEADER_RE = /REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?/gi;
const GRANT_HEADER_RE = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?/gi;
const SCHEMA_WIDE_GRANT_RE =
  /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+(?:"?public"?)\s+TO\s+([^;]+)/gi;

// Marks the start of a dollar-quoted function body ($$, $function$, etc.) —
// used to bound the search window for SECURITY DEFINER/INVOKER and RETURNS
// TRIGGER so it never reads into the body itself (a body that happens to
// mention those words in a string literal would otherwise produce a false
// match — see the window-bound test in check-migration-safety-acl.test.sh).
const DOLLAR_TAG_RE = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Returns { isSecurityDefiner, returnsTrigger } for the CREATE FUNCTION
 * whose parameter list ends at `afterParensIdx`. Searches only the
 * option-clause window between the closing `)` of the parameter list and
 * the start of the function body (or a 1000-char cap, for the rare body
 * that isn't dollar-quoted) — never the body itself. Defaults
 * isSecurityDefiner to false (INVOKER, Postgres's own default) when neither
 * keyword appears. */
function parseFunctionOptionsWindow(sql, afterParensIdx) {
  const dollarMatch = DOLLAR_TAG_RE.exec(sql.slice(afterParensIdx));
  const windowEnd = dollarMatch
    ? afterParensIdx + dollarMatch.index
    : Math.min(sql.length, afterParensIdx + 1000);
  const window = sql.slice(afterParensIdx, windowEnd);
  return {
    isSecurityDefiner: /\bSECURITY\s+DEFINER\b/i.test(window),
    returnsTrigger: /\bRETURNS\s+TRIGGER\b/i.test(window),
  };
}

/** Every `CREATE [OR REPLACE] FUNCTION public.name(...)` in `rawSql`, with
 * its normalized signature, whether it is SECURITY DEFINER, and whether it
 * `RETURNS TRIGGER` (trigger functions are never directly invocable via
 * PostgREST/RPC the way an ordinary RPC is — fase 0 of this spec excluded
 * them from the invocable-functions count for the same reason; real
 * precedent for the exclusion mattering: 20261001000001, whose own comment
 * says "no REVOKE/GRANT needed" for exactly this class of function). */
export function findCreateFunctionSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(CREATE_FN_RE.source, CREATE_FN_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    const opts = parseFunctionOptionsWindow(sql, group.endIdx + 1);
    results.push({
      name: m[2],
      signature: normalizeSignature(group.params),
      isSecurityDefiner: opts.isSecurityDefiner,
      returnsTrigger: opts.returnsTrigger,
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** Shared by findRevokeSignatures/findGrantExecuteSignatures: given a
 * regex matching up through `ON FUNCTION name` (name captured), parses the
 * optional `(...)` argument list (or null when absent — a bare, unambiguous
 * reference, PG14+) and the `FROM`/`TO` role list that follows. */
function findOnFunctionStatements(rawSql, headerRe, roleKeyword) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(headerRe.source, headerRe.flags);
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    let i = m.index + m[0].length;
    while (i < sql.length && /\s/.test(sql[i])) i++;
    let signature = null;
    let nextIdx = i;
    if (sql[i] === '(') {
      const group = extractParenGroup(sql, i);
      if (!group) continue;
      signature = normalizeSignature(group.params);
      nextIdx = group.endIdx + 1;
    }
    const roleRe = new RegExp(`${roleKeyword}\\s+([^;]+)`, 'i');
    const roleMatch = sql.slice(nextIdx, nextIdx + 200).match(roleRe);
    results.push({
      name,
      signature, // null = bare reference, applies to every overload of `name`
      roles: roleMatch ? splitRoleList(roleMatch[1]) : [],
      index: m.index,
    });
    re.lastIndex = nextIdx;
  }
  return results;
}

/** Every `REVOKE {ALL|EXECUTE} ON FUNCTION public.name[(...)] FROM <roles>`
 * in `rawSql`. `signature` is `null` for a bare (no argument list)
 * reference — legal Postgres (PG14+) when the name is unambiguous. */
export function findRevokeSignatures(rawSql) {
  return findOnFunctionStatements(rawSql, REVOKE_HEADER_RE, 'FROM');
}

/** Every `GRANT EXECUTE ON FUNCTION public.name[(...)] TO <roles>` in
 * `rawSql`. Same `signature: null` convention as findRevokeSignatures. */
export function findGrantExecuteSignatures(rawSql) {
  return findOnFunctionStatements(rawSql, GRANT_HEADER_RE, 'TO');
}

/** Every `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO <roles>` in
 * `rawSql` — a schema-wide grant that reopens PUBLIC for every function it
 * covers, even ones the statement never names by function name (round 3,
 * point 4b). */
export function findSchemaWideGrants(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(SCHEMA_WIDE_GRANT_RE.source, SCHEMA_WIDE_GRANT_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    results.push({ roles: splitRoleList(m[1]), index: m.index });
  }
  return results;
}

/** 1-based line number of character offset `index` within `text`. */
export function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}
