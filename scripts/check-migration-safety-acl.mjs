/**
 * check-migration-safety-acl.mjs (spec-88 fase 4; redesigned round 2, PR #723 review)
 *
 * Two ACL guardrails, both distilled from real bugs spec-88 found and fixed
 * by hand — see docs/specs/spec-88-anon-security-definer-audit.md. Parsing
 * is in check-migration-safety-acl-parse.mjs (split out to stay under the
 * repo's 300-line limit).
 *
 *  - findOrphanedOverloadWarnings (rule 4, WARN, exit 0): a migration
 *    CREATEs/CREATE OR REPLACEs a SECURITY DEFINER function whose signature
 *    does not match any REVOKE historically issued against a same-named
 *    function with a DIFFERENT signature. Postgres resolves `REVOKE ... ON
 *    FUNCTION name(types)` by exact signature, not by name — a REVOKE
 *    scoped to one overload never covers a sibling overload. SECURITY
 *    INVOKER functions are out of scope: they run with the CALLER's own
 *    privileges, so a same-named-different-signature REVOKE gap is not a
 *    privilege-escalation risk for them.
 *
 *  - findGrantWithoutRevokeViolations (rule 5, REJECT, exit 1): a migration
 *    CREATEs/CREATE OR REPLACEs a SECURITY DEFINER function with no REVOKE
 *    (ALL or EXECUTE) ... FROM PUBLIC for that EXACT signature anywhere in
 *    the same migration.
 *
 *    Redesigned in review round 2 (PR #723) after the reviewer proved,
 *    against the live database, that the original design (trigger on
 *    "GRANT EXECUTE ... TO authenticated present, zero REVOKE anywhere in
 *    the file") was built on a false premise: Postgres grants EXECUTE to
 *    PUBLIC on every newly (re)created function BY DEFAULT, independent of
 *    whether the migration ever writes a GRANT statement at all. A fresh
 *    `CREATE FUNCTION ... SECURITY DEFINER` with zero GRANT and zero REVOKE
 *    is just as exposed to `anon` (which inherits PUBLIC) as one with an
 *    explicit `GRANT ... TO authenticated` — the old rule missed that
 *    entirely (B1). The only statement that actually closes the exposure
 *    is a REVOKE targeting PUBLIC BY NAME, for that exact function — a
 *    `REVOKE ... FROM anon` alone leaves the PUBLIC grant standing (this is
 *    the exact "ACL that lies" bug fase 1 of this spec fixed by hand in
 *    four functions, and spec-80 fase 1b fixed for close_manifest before
 *    this check existed).
 *
 *    Also fixed here: the old design's `hasAnyRevoke` was computed once for
 *    the WHOLE FILE, so a REVOKE on any OTHER function silenced the rule
 *    for every function in that migration (B2, real precedent:
 *    20260616000004 creates five functions in one file). The check is now
 *    per function signature.
 */
import { readFileSync } from 'node:fs';
import { findCreateFunctionSignatures, findRevokeSignatures } from './check-migration-safety-acl-parse.mjs';

export {
  normalizeSignature,
  findCreateFunctionSignatures,
  findRevokeSignatures,
  findGrantExecuteSignatures,
  lineNumberAt,
} from './check-migration-safety-acl-parse.mjs';

/**
 * Rule 4. `revokeIndex` maps function name -> Set of normalized signatures
 * REVOKEd anywhere in the corpus (built once by the caller across every
 * migration file, not just the one being checked — the REVOKE this rule
 * warns about living in an EARLIER migration is the whole point). Returns a
 * list of `{ message, index }` for each new CREATE/CREATE OR REPLACE
 * SECURITY DEFINER FUNCTION in `rawSql` whose signature does not exactly
 * match any REVOKEd signature for that name, when at least one REVOKE for
 * that name exists (no REVOKE history at all means nothing to compare
 * against). SECURITY INVOKER functions are skipped — see module doc.
 */
export function findOrphanedOverloadWarnings(rawSql, revokeIndex) {
  const warnings = [];
  for (const fn of findCreateFunctionSignatures(rawSql)) {
    if (!fn.isSecurityDefiner) continue;
    const revokedSignatures = revokeIndex.get(fn.name);
    if (!revokedSignatures || revokedSignatures.size === 0) continue; // nothing to compare against
    if (revokedSignatures.has(fn.signature)) continue; // this exact overload already has a REVOKE
    const known = [...revokedSignatures].map((s) => `(${s})`).join(', ');
    warnings.push({
      message: `CREATE FUNCTION public.${fn.name}(${fn.signature}) — an earlier REVOKE exists for ${fn.name} but only for a different signature (${known}); it does not cover this overload`,
      index: fn.index,
    });
  }
  return warnings;
}

/**
 * Rule 5 (redesigned, review round 2 — see module doc for why). Returns a
 * list of rejection messages: for each CREATE/CREATE OR REPLACE SECURITY
 * DEFINER FUNCTION in `rawSql`, if the SAME file contains no `REVOKE {ALL|
 * EXECUTE} ON FUNCTION` for that EXACT name+signature with `PUBLIC` in its
 * role list, that is the bug — Postgres grants EXECUTE to PUBLIC on every
 * (re)created function by default, GRANT statement or not, and `anon`
 * inherits PUBLIC. GRANT statements are irrelevant to this check now (B1):
 * their presence or absence never changes whether PUBLIC was actually
 * revoked. SECURITY INVOKER functions are out of scope (see module doc).
 */
export function findGrantWithoutRevokeViolations(rawSql) {
  const createdFns = findCreateFunctionSignatures(rawSql).filter((fn) => fn.isSecurityDefiner);
  if (createdFns.length === 0) return [];
  const revokes = findRevokeSignatures(rawSql);

  const violations = [];
  for (const fn of createdFns) {
    // B2: matched PER FUNCTION (name + signature), not "does the file
    // contain ANY REVOKE at all" — a REVOKE on a sibling function must not
    // silence this one.
    const hasPublicRevoke = revokes.some(
      (r) => r.name === fn.name && r.signature === fn.signature && r.roles.includes('public')
    );
    if (!hasPublicRevoke) {
      violations.push(
        `CREATE FUNCTION public.${fn.name}(${fn.signature}) is SECURITY DEFINER with no REVOKE {ALL|EXECUTE} ... FROM PUBLIC for this exact signature anywhere in the migration — Postgres grants EXECUTE to PUBLIC (which anon inherits) on every (re)created function by default, regardless of any GRANT statement; add REVOKE ALL ON FUNCTION public.${fn.name}(${fn.signature}) FROM PUBLIC (see spec-80 fase 1b, 20260913000004)`
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
