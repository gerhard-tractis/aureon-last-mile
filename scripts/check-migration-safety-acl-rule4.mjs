/**
 * check-migration-safety-acl-rule4.mjs (spec-88 fase 4; split out review
 * round 5 to keep check-migration-safety-acl.mjs under the repo's 300-line
 * limit)
 *
 * Rule 4 (WARN, exit 0): a migration CREATEs/CREATE OR REPLACEs a SECURITY
 * DEFINER function whose signature does not match any REVOKE historically
 * issued against a same-named function with a DIFFERENT signature — the
 * start_pickup_route(text) vs. start_pickup_route(uuid, uuid[]) bug. See
 * check-migration-safety-acl.mjs for rule 5 and the shared parsing.
 */
import { readFileSync } from 'node:fs';
import { findCreateFunctionSignatures, findRevokeSignatures } from './check-migration-safety-acl-parse.mjs';

// Sentinel signature for a bare `ON FUNCTION name` reference with no
// argument list — applies to every overload of `name`.
const WILDCARD_SIGNATURE = '*';

/**
 * `revokeIndex` maps function name -> Set of normalized signatures REVOKEd
 * anywhere in the corpus (built once by the caller across every migration
 * file, not just the one being checked). Returns a list of `{ message,
 * index }` for each new CREATE/CREATE OR REPLACE SECURITY DEFINER FUNCTION
 * (not RETURNS TRIGGER — trigger functions are never directly invocable via
 * PostgREST/RPC) in `rawSql` whose signature does not exactly match any
 * REVOKEd signature for that name (a bare, no-argument-list REVOKE counts
 * as covering every overload), when at least one non-wildcard REVOKE for
 * that name exists.
 */
export function findOrphanedOverloadWarnings(rawSql, revokeIndex) {
  const warnings = [];
  for (const fn of findCreateFunctionSignatures(rawSql)) {
    if (!fn.isSecurityDefiner || fn.returnsTrigger) continue;
    const revokedSignatures = revokeIndex.get(fn.name);
    if (!revokedSignatures || revokedSignatures.size === 0) continue; // nothing to compare against
    if (revokedSignatures.has(WILDCARD_SIGNATURE) || revokedSignatures.has(fn.signature)) continue; // covered
    const known = [...revokedSignatures]
      .filter((s) => s !== WILDCARD_SIGNATURE)
      .map((s) => `(${s})`)
      .join(', ');
    if (!known) continue; // only ever a wildcard reference — already handled above
    warnings.push({
      message: `CREATE FUNCTION public.${fn.name}(${fn.signature}) — an earlier REVOKE exists for ${fn.name} but only for a different signature (${known}); it does not cover this overload`,
      index: fn.index,
    });
  }
  return warnings;
}

/**
 * Builds { name -> Set(normalized signature | '*') } across every migration
 * file in `filePaths` — rule 4 needs the WHOLE corpus, not just the file
 * being checked, because the REVOKE it looks for typically lives in an
 * earlier migration than the CREATE FUNCTION it's warning about.
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
      index.get(r.name).add(r.signature ?? WILDCARD_SIGNATURE);
    }
  }
  return index;
}
