/**
 * check-migration-safety-acl.mjs (spec-88 fase 4; redesigned rounds 2-3, PR #723 review)
 *
 * Two ACL guardrails, both distilled from real bugs spec-88 found and fixed
 * by hand — see docs/specs/spec-88-anon-security-definer-audit.md. Parsing
 * is in check-migration-safety-acl-parse.mjs (split out to stay under the
 * repo's 300-line limit).
 *
 *  - findOrphanedOverloadWarnings (rule 4, WARN, exit 0): a migration
 *    CREATEs/CREATE OR REPLACEs a SECURITY DEFINER function whose signature
 *    does not match any REVOKE historically issued against a same-named
 *    function with a DIFFERENT signature. SECURITY INVOKER functions and
 *    RETURNS TRIGGER functions are out of scope (see below).
 *
 *  - findGrantWithoutRevokeViolations (rule 5, REJECT, exit 1): a migration
 *    CREATEs/CREATE OR REPLACEs a SECURITY DEFINER function whose PUBLIC
 *    grant is OPEN as of that migration, considering the CUMULATIVE ACL
 *    history of the whole corpus up to and including that file — not just
 *    the text of that one file.
 *
 *    Redesigned twice under adversarial review (PR #723):
 *
 *    Round 2 fixed the original design's false premise ("GRANT EXECUTE ...
 *    TO authenticated present + zero REVOKE in this file" — B1/round-2)
 *    by moving to "no REVOKE ... FROM PUBLIC for this exact signature in
 *    this file", per-function rather than file-global (B2/round-2), with
 *    the full FROM/TO role list rather than just the first (B3/round-2).
 *
 *    Round 3 found that round 2's per-FILE view was itself still wrong:
 *    `CREATE OR REPLACE` PRESERVES the function's existing ACL — it does
 *    NOT reset to the default PUBLIC grant the way a fresh `CREATE` (or a
 *    `DROP FUNCTION; CREATE FUNCTION;`) does. This repo already knows and
 *    asserts this in SQL: `20260913000008` (spec-88 fase 2)'s own migration
 *    comment (:115-117) and a live assertion (:169-175) that ABORTS the
 *    migration if PUBLIC were ever reopened by its own CREATE OR REPLACE —
 *    and that assertion has PASSED, against the live database, since that
 *    migration merged. Round 2's rule rejected that exact, already-correct
 *    migration, and (found live, in CI, on this very PR) an unrelated
 *    TRIGGER function from another spec that was never meant to need a
 *    REVOKE at all (trigger functions are not directly invocable via
 *    PostgREST/RPC the way an ordinary RPC is — fase 0 of this spec already
 *    excluded them from its invocable-functions count for that reason).
 *
 *    The fix is a genuine state machine, not a per-file text scan:
 *    `buildAclTimeline` walks every migration file in the corpus, in
 *    filename (chronological) order, and records every REVOKE/GRANT event
 *    that names PUBLIC — including a schema-wide `GRANT ... ON ALL
 *    FUNCTIONS IN SCHEMA public` reopening every function it covers, even
 *    ones it never names (round 3, point 4b) — plus a bare, no-argument-
 *    list REVOKE (legal Postgres, PG14+, when the name is unambiguous),
 *    which applies to every overload of that name. `isPublicOpenAt` then
 *    asks: as of THIS file (inclusive), what is the LATEST event affecting
 *    this exact function (by name+signature, or a same-name wildcard, or a
 *    schema-wide grant)? No event at all means PUBLIC was never touched —
 *    Postgres's own default grant stands, open. This also closes the
 *    "REVOKE FROM PUBLIC, then GRANT TO PUBLIC, same file" order-sensitivity
 *    gap round 2's rule missed entirely (round 3, point 4a).
 */
import { readFileSync } from 'node:fs';
import {
  findCreateFunctionSignatures,
  findRevokeSignatures,
  findGrantExecuteSignatures,
  findSchemaWideGrants,
} from './check-migration-safety-acl-parse.mjs';

export {
  normalizeSignature,
  findCreateFunctionSignatures,
  findRevokeSignatures,
  findGrantExecuteSignatures,
  findSchemaWideGrants,
  lineNumberAt,
} from './check-migration-safety-acl-parse.mjs';

// Sentinel signature for a bare `ON FUNCTION name` reference with no
// argument list — applies to every overload of `name` (see module doc).
const WILDCARD_SIGNATURE = '*';

/**
 * Rule 4. `revokeIndex` maps function name -> Set of normalized signatures
 * REVOKEd anywhere in the corpus (built once by the caller across every
 * migration file, not just the one being checked). Returns a list of
 * `{ message, index }` for each new CREATE/CREATE OR REPLACE SECURITY
 * DEFINER FUNCTION (not RETURNS TRIGGER — see module doc) in `rawSql` whose
 * signature does not exactly match any REVOKEd signature for that name
 * (a bare, no-argument-list REVOKE counts as covering every overload),
 * when at least one non-wildcard REVOKE for that name exists.
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

function pushEvent(map, key, event) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(event);
}

/**
 * Builds the cumulative PUBLIC-grant timeline across every migration file
 * in `filePaths`, in the given (filename/chronological) order. Only events
 * that name PUBLIC in their role list are recorded — rule 5 cares
 * exclusively about whether PUBLIC (which `anon` inherits) is open, not
 * about `authenticated`/`service_role`/other roles.
 */
export function buildAclTimeline(filePaths) {
  const perKey = new Map(); // `${name}::${signature|'*'}` -> [{fileIdx, charIdx, type}]
  const schemaWide = []; // [{fileIdx, charIdx, type: 'grant'}]
  filePaths.forEach((f, fileIdx) => {
    let rawSql;
    try {
      rawSql = readFileSync(f, 'utf8');
    } catch {
      return;
    }
    for (const r of findRevokeSignatures(rawSql)) {
      if (!r.roles.includes('public')) continue;
      pushEvent(perKey, `${r.name}::${r.signature ?? WILDCARD_SIGNATURE}`, {
        fileIdx,
        charIdx: r.index,
        type: 'revoke',
      });
    }
    for (const g of findGrantExecuteSignatures(rawSql)) {
      if (!g.roles.includes('public')) continue;
      pushEvent(perKey, `${g.name}::${g.signature ?? WILDCARD_SIGNATURE}`, {
        fileIdx,
        charIdx: g.index,
        type: 'grant',
      });
    }
    for (const sw of findSchemaWideGrants(rawSql)) {
      if (!sw.roles.includes('public')) continue;
      schemaWide.push({ fileIdx, charIdx: sw.index, type: 'grant' });
    }
  });
  return { perKey, schemaWide };
}

function comparePos(a, b) {
  return a.fileIdx !== b.fileIdx ? a.fileIdx - b.fileIdx : a.charIdx - b.charIdx;
}

/**
 * Whether PUBLIC's EXECUTE grant is open for `name`(`signature`) as of and
 * including `uptoFileIdx` in the corpus order `timeline` was built from —
 * i.e. the cumulative effect of every migration applied so far. No event at
 * all means PUBLIC was never touched, and Postgres's own default (EXECUTE
 * granted to PUBLIC on every new function) stands: open.
 */
export function isPublicOpenAt(timeline, name, signature, uptoFileIdx) {
  const events = [
    ...(timeline.perKey.get(`${name}::${signature}`) || []),
    ...(timeline.perKey.get(`${name}::${WILDCARD_SIGNATURE}`) || []),
    ...timeline.schemaWide,
  ].filter((e) => e.fileIdx <= uptoFileIdx);
  if (events.length === 0) return true;
  events.sort(comparePos);
  return events[events.length - 1].type === 'grant';
}

/**
 * Rule 5 (redesigned rounds 2-3 — see module doc for why). Returns a list
 * of rejection messages: for each CREATE/CREATE OR REPLACE SECURITY
 * DEFINER FUNCTION (not RETURNS TRIGGER) in `rawSql`, whether PUBLIC is
 * open for that exact signature as of `fileIdx` in `timeline`'s corpus
 * order. `fileIdx` is the position of the file currently being checked
 * within the SAME corpus `timeline` was built from — see
 * check-migration-safety.mjs for how that's computed.
 */
export function findGrantWithoutRevokeViolations(rawSql, timeline, fileIdx) {
  const createdFns = findCreateFunctionSignatures(rawSql).filter(
    (fn) => fn.isSecurityDefiner && !fn.returnsTrigger
  );
  if (createdFns.length === 0) return [];

  const violations = [];
  for (const fn of createdFns) {
    if (isPublicOpenAt(timeline, fn.name, fn.signature, fileIdx)) {
      violations.push(
        `CREATE FUNCTION public.${fn.name}(${fn.signature}) is SECURITY DEFINER and PUBLIC's EXECUTE grant is open for this exact signature, considering the cumulative REVOKE/GRANT history of the whole migrations corpus up to and including this file — add REVOKE ALL ON FUNCTION public.${fn.name}(${fn.signature}) FROM PUBLIC (see spec-80 fase 1b, 20260913000004)`
      );
    }
  }
  return violations;
}
