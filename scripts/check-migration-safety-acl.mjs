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
  findDropFunctionSignatures,
} from './check-migration-safety-acl-parse.mjs';

export {
  normalizeSignature,
  findCreateFunctionSignatures,
  findRevokeSignatures,
  findGrantExecuteSignatures,
  findSchemaWideGrants,
  findDropFunctionSignatures,
  lineNumberAt,
} from './check-migration-safety-acl-parse.mjs';

// Rule 4 (findOrphanedOverloadWarnings/buildRevokeIndex) split out to
// check-migration-safety-acl-rule4.mjs (review round 5) — this file is
// rule 5's timeline machinery only.
export { findOrphanedOverloadWarnings, buildRevokeIndex } from './check-migration-safety-acl-rule4.mjs';

// Sentinel signature for a bare `ON FUNCTION name` reference with no
// argument list — applies to every overload of `name` (see module doc).
const WILDCARD_SIGNATURE = '*';

function pushEvent(map, key, event) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(event);
}

/**
 * Builds the cumulative PUBLIC-grant timeline across every migration file
 * in `filePaths`, in the given (filename/chronological) order. `perKey`
 * only records events that name PUBLIC in their role list — rule 5 cares
 * exclusively about whether PUBLIC (which `anon` inherits) is open, not
 * about `authenticated`/`service_role`/other roles.
 *
 * `anonPerKey` (round 4) tracks a SEPARATE timeline: every GRANT/REVOKE that
 * names `anon` explicitly, regardless of PUBLIC. `anon` does not need
 * PUBLIC's inherited grant when it has its own explicit one — a migration
 * that REVOKEs FROM PUBLIC and then `GRANT ... TO anon` directly is still
 * wide open, and a per-PUBLIC-only view of the world would miss it (real
 * shape found in review, PR #723 rebase).
 *
 * A `DROP FUNCTION` event (round 4) resets BOTH timelines for its exact
 * name+signature — unlike `CREATE OR REPLACE`, which PRESERVES the existing
 * ACL (round 3), a `DROP` destroys the function object entirely, and
 * whatever `CREATE` follows gets Postgres's default EXECUTE-to-PUBLIC grant
 * fresh, with no explicit anon grant either. It is recorded as a 'grant' in
 * `perKey` (the state becomes open, same effect as an explicit GRANT TO
 * PUBLIC for this rule's purposes) and as a 'revoke' in `anonPerKey` (any
 * earlier explicit anon grant is gone along with the dropped function — the
 * state becomes "no explicit anon grant", which `isAnonOpenDirectly` reads
 * as closed, same as if anon had never been touched).
 *
 * `contentOverrides` (B10, round 5): optional `Map<filePath, content|null>`.
 * When a path is present, its OVERRIDE content is scanned instead of the
 * file on disk — `null` means "did not exist at this point", i.e. the file
 * contributes no events at all. Used to build a SECOND timeline reflecting
 * corpus state AT `--base`, so rule 5 can tell a violation that already
 * existed before this PR (degrade to warning) from one this PR introduces
 * (reject) — the same distinction rule 1 already makes, extended to rule 5.
 */
export function buildAclTimeline(filePaths, contentOverrides) {
  const perKey = new Map(); // `${name}::${signature|'*'}` -> [{fileIdx, charIdx, type}]
  const anonPerKey = new Map(); // same shape, 'anon'-named events only
  const schemaWide = []; // [{fileIdx, charIdx, type: 'grant'}]
  // B3 (round 5): a schema-wide grant naming `anon` (not `PUBLIC`) reopens
  // every function it covers to `anon` directly in one statement — the
  // round-3 schema-wide tracking only ever checked for PUBLIC in the role
  // list, so this axis (schema-wide) and the anon axis (per-function) never
  // crossed.
  const anonSchemaWide = [];
  filePaths.forEach((f, fileIdx) => {
    let rawSql;
    if (contentOverrides && contentOverrides.has(f)) {
      const override = contentOverrides.get(f);
      if (override === null) return; // did not exist at this point in history
      rawSql = override;
    } else {
      try {
        rawSql = readFileSync(f, 'utf8');
      } catch {
        return;
      }
    }
    for (const r of findRevokeSignatures(rawSql)) {
      const key = `${r.name}::${r.signature ?? WILDCARD_SIGNATURE}`;
      if (r.roles.includes('public')) {
        pushEvent(perKey, key, { fileIdx, charIdx: r.index, type: 'revoke' });
      }
      if (r.roles.includes('anon')) {
        pushEvent(anonPerKey, key, { fileIdx, charIdx: r.index, type: 'revoke' });
      }
    }
    for (const g of findGrantExecuteSignatures(rawSql)) {
      const key = `${g.name}::${g.signature ?? WILDCARD_SIGNATURE}`;
      if (g.roles.includes('public')) {
        pushEvent(perKey, key, { fileIdx, charIdx: g.index, type: 'grant' });
      }
      if (g.roles.includes('anon')) {
        pushEvent(anonPerKey, key, { fileIdx, charIdx: g.index, type: 'grant' });
      }
    }
    for (const sw of findSchemaWideGrants(rawSql)) {
      if (sw.roles.includes('public')) {
        schemaWide.push({ fileIdx, charIdx: sw.index, type: 'grant' });
      }
      if (sw.roles.includes('anon')) {
        anonSchemaWide.push({ fileIdx, charIdx: sw.index, type: 'grant' });
      }
    }
    for (const d of findDropFunctionSignatures(rawSql)) {
      const key = `${d.name}::${d.signature ?? WILDCARD_SIGNATURE}`;
      pushEvent(perKey, key, { fileIdx, charIdx: d.index, type: 'grant' });
      pushEvent(anonPerKey, key, { fileIdx, charIdx: d.index, type: 'revoke' });
    }
  });
  return { perKey, anonPerKey, schemaWide, anonSchemaWide };
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
 * Round 4. Whether `anon` has been explicitly GRANTed EXECUTE for
 * `name`(`signature`), directly (not via inherited PUBLIC), as of and
 * including `uptoFileIdx`. Unlike `isPublicOpenAt`, no event at all means
 * anon was never explicitly touched — false, i.e. "rely on
 * `isPublicOpenAt` instead" — there is no Postgres default grant to `anon`
 * specifically the way there is to PUBLIC.
 */
export function isAnonOpenDirectly(timeline, name, signature, uptoFileIdx) {
  const events = [
    ...(timeline.anonPerKey.get(`${name}::${signature}`) || []),
    ...(timeline.anonPerKey.get(`${name}::${WILDCARD_SIGNATURE}`) || []),
    ...timeline.anonSchemaWide,
  ].filter((e) => e.fileIdx <= uptoFileIdx);
  if (events.length === 0) return false;
  events.sort(comparePos);
  return events[events.length - 1].type === 'grant';
}

/**
 * Rule 5 (redesigned rounds 2-3, extended rounds 4-5 — see module doc for
 * why). Returns a list of `{ message, name, signature }` — structured
 * rather than a plain message string (B10, round 5) so
 * check-migration-safety.mjs can re-run `isPublicOpenAt`/`isAnonOpenDirectly`
 * for the SAME name+signature against a SECOND timeline built from corpus
 * state at `--base`, to decide whether a violation is pre-existing (degrade
 * to warning) or newly introduced by this PR (reject) — the same
 * distinction rule 1 already makes. For each CREATE/CREATE OR REPLACE
 * SECURITY DEFINER FUNCTION (not RETURNS TRIGGER) in `rawSql`, whether
 * PUBLIC is open for that exact signature, OR `anon` has been explicitly
 * granted EXECUTE directly (round 4 — `anon` does not need PUBLIC's
 * inherited grant when it has its own), as of `fileIdx` in `timeline`'s
 * corpus order. `fileIdx` is the position of the file currently being
 * checked within the SAME corpus `timeline` was built from — see
 * check-migration-safety.mjs for how that's computed.
 */
export function findGrantWithoutRevokeViolations(rawSql, timeline, fileIdx) {
  const createdFns = findCreateFunctionSignatures(rawSql).filter(
    (fn) => fn.isSecurityDefiner && !fn.returnsTrigger
  );
  if (createdFns.length === 0) return [];

  const violations = [];
  for (const fn of createdFns) {
    const publicOpen = isPublicOpenAt(timeline, fn.name, fn.signature, fileIdx);
    const anonOpen = isAnonOpenDirectly(timeline, fn.name, fn.signature, fileIdx);
    if (publicOpen || anonOpen) {
      const reason = publicOpen
        ? `PUBLIC's EXECUTE grant is open for this exact signature`
        : `anon has been explicitly GRANTed EXECUTE directly for this exact signature (PUBLIC itself is closed)`;
      violations.push({
        message: `CREATE FUNCTION public.${fn.name}(${fn.signature}) is SECURITY DEFINER and ${reason}, considering the cumulative REVOKE/GRANT history of the whole migrations corpus up to and including this file — add REVOKE ALL ON FUNCTION public.${fn.name}(${fn.signature}) FROM PUBLIC${anonOpen ? ', anon' : ''} (see spec-80 fase 1b, 20260913000004)`,
        name: fn.name,
        signature: fn.signature,
      });
    }
  }
  return violations;
}
