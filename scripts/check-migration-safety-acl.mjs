/**
 * check-migration-safety-acl.mjs (spec-88 fase 4)
 *
 * Two ACL guardrails, both distilled from real bugs spec-88 found and fixed
 * by hand — see docs/specs/spec-88-anon-security-definer-audit.md:
 *
 *  - findOrphanedOverloadWarnings (rule 4, WARN, exit 0): a migration
 *    CREATEs/CREATE OR REPLACEs a function whose signature does not match
 *    any REVOKE historically issued against a same-named function with a
 *    DIFFERENT signature. Postgres resolves `REVOKE ... ON FUNCTION
 *    name(types)` by exact signature, not by name — a REVOKE scoped to one
 *    overload never covers a sibling overload. This is exactly the
 *    start_pickup_route(text) vs. start_pickup_route(uuid, uuid[]) bug.
 *    A warning, not a rejection: the check cannot tell whether the new
 *    signature already has its OWN correct REVOKE somewhere else in the
 *    same migration (that's fine) versus genuinely relying on the stale
 *    one — flagging it for a human to look at is honest; hard-rejecting a
 *    migration that already revokes its own new signature correctly is not.
 *
 *  - findGrantWithoutRevokeViolations (rule 5, REJECT, exit 1): a migration
 *    CREATEs/CREATE OR REPLACEs a function and GRANTs EXECUTE on it TO
 *    authenticated, but the migration contains NO REVOKE statement at all.
 *    This is the exact bug fase 1 of this spec found and fixed by hand in
 *    four functions (20260913000006), and that spec-80 fase 1b
 *    (20260913000004) already had to fix by hand for close_manifest before
 *    this check existed: `CREATE OR REPLACE FUNCTION` preserves whatever
 *    ACL the function already had, and Supabase's default privileges
 *    re-grant `anon`/PUBLIC on a freshly (re)created function — a GRANT
 *    without an accompanying REVOKE leaves that default exposure standing.
 */
import { readFileSync } from 'node:fs';

/** Strips `-- ...` line comments so comment text never matches a rule
 * (same pattern as check-migration-safety.mjs's rules 2/3). */
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

const CREATE_FN_RE = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
const REVOKE_RE = /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;
const GRANT_RE = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi;

/** Every `CREATE [OR REPLACE] FUNCTION public.name(...)` in `rawSql`, with
 * its normalized signature. */
export function findCreateFunctionSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(CREATE_FN_RE.source, CREATE_FN_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    results.push({ name: m[2], signature: normalizeSignature(group.params), index: m.index });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** Every `REVOKE ALL ON FUNCTION public.name(...) FROM <role>` in `rawSql`. */
export function findRevokeSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(REVOKE_RE.source, REVOKE_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    const after = sql.slice(group.endIdx + 1, group.endIdx + 60);
    const fromMatch = after.match(/FROM\s+(\w+)/i);
    results.push({
      name: m[1],
      signature: normalizeSignature(group.params),
      role: fromMatch ? fromMatch[1].toLowerCase() : null,
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/** Every `GRANT EXECUTE ON FUNCTION public.name(...) TO <role>` in `rawSql`. */
export function findGrantExecuteSignatures(rawSql) {
  const sql = stripLineComments(rawSql);
  const results = [];
  const re = new RegExp(GRANT_RE.source, GRANT_RE.flags);
  let m;
  while ((m = re.exec(sql))) {
    const openParenIdx = m.index + m[0].length - 1;
    const group = extractParenGroup(sql, openParenIdx);
    if (!group) continue;
    const after = sql.slice(group.endIdx + 1, group.endIdx + 60);
    const toMatch = after.match(/TO\s+(\w+)/i);
    results.push({
      name: m[1],
      signature: normalizeSignature(group.params),
      role: toMatch ? toMatch[1].toLowerCase() : null,
      index: m.index,
    });
    re.lastIndex = group.endIdx + 1;
  }
  return results;
}

/**
 * Rule 4. `revokeIndex` maps function name -> Set of normalized signatures
 * REVOKEd anywhere in the corpus (built once by the caller across every
 * migration file, not just the one being checked — the REVOKE this rule
 * warns about living in an EARLIER migration is the whole point). Returns a
 * list of warning strings for each new CREATE/CREATE OR REPLACE FUNCTION in
 * `rawSql` whose signature does not exactly match any REVOKEd signature for
 * that name, when at least one REVOKE for that name exists (no REVOKE
 * history at all means nothing to compare against — rule 5 governs that
 * case instead).
 */
export function findOrphanedOverloadWarnings(rawSql, revokeIndex) {
  const warnings = [];
  for (const fn of findCreateFunctionSignatures(rawSql)) {
    const revokedSignatures = revokeIndex.get(fn.name);
    if (!revokedSignatures || revokedSignatures.size === 0) continue; // nothing to compare against
    if (revokedSignatures.has(fn.signature)) continue; // this exact overload already has a REVOKE
    const known = [...revokedSignatures].map((s) => `(${s})`).join(', ');
    warnings.push(
      `CREATE FUNCTION public.${fn.name}(${fn.signature}) — an earlier REVOKE exists for ${fn.name} but only for a different signature (${known}); it does not cover this overload`
    );
  }
  return warnings;
}

/**
 * Rule 5. Returns a list of rejection messages: for each CREATE/CREATE OR
 * REPLACE FUNCTION in `rawSql` that also has a `GRANT EXECUTE ... TO
 * authenticated` for that exact signature in the SAME file, if the file
 * contains NO `REVOKE ALL ON FUNCTION` statement at all (for any function),
 * that is the bug — `CREATE OR REPLACE` preserves the function's existing
 * ACL, and Supabase's default privileges re-grant `anon`/PUBLIC on a
 * (re)created function, so a GRANT with no REVOKE anywhere leaves that
 * default exposure standing. A GRANT to `service_role` alone, or a CREATE
 * FUNCTION with no GRANT at all, does not trigger this — both are ordinary,
 * safe patterns in this repo.
 */
export function findGrantWithoutRevokeViolations(rawSql) {
  const createdFns = findCreateFunctionSignatures(rawSql);
  if (createdFns.length === 0) return [];
  const grants = findGrantExecuteSignatures(rawSql);
  const hasAnyRevoke = findRevokeSignatures(rawSql).length > 0;
  if (hasAnyRevoke) return [];

  const violations = [];
  for (const fn of createdFns) {
    const grantedToAuthenticated = grants.some(
      (g) => g.name === fn.name && g.signature === fn.signature && g.role === 'authenticated'
    );
    if (grantedToAuthenticated) {
      violations.push(
        `CREATE FUNCTION public.${fn.name}(${fn.signature}) GRANTs EXECUTE TO authenticated but the migration has no REVOKE at all — CREATE OR REPLACE preserves the existing ACL and Supabase's default privileges re-grant anon/PUBLIC on a (re)created function; add REVOKE ALL ... FROM PUBLIC / FROM anon (see spec-80 fase 1b, 20260913000004)`
      );
    }
  }
  return violations;
}

/**
 * Builds { name -> Set(normalized signature) } across every migration file
 * in `filePaths` — rule 4 needs the WHOLE corpus, not just the file being
 * checked, because the REVOKE it looks for typically lives in an earlier
 * migration than the CREATE FUNCTION it's warning about.
 */
export function buildRevokeIndex(filePaths) {
  const index = new Map();
  for (const f of filePaths) {
    let rawSql;
    try {
      rawSql = readFileSync(f, 'utf8');
    } catch {
      continue; // unreadable file — skip it for index purposes, checkFile() will report the real error
    }
    for (const r of findRevokeSignatures(rawSql)) {
      if (!index.has(r.name)) index.set(r.name, new Set());
      index.get(r.name).add(r.signature);
    }
  }
  return index;
}
