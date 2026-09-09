/**
 * check-migration-safety.mjs (spec-87 fase 5; rules 4/5 added spec-88 fase 4)
 *
 * Five rules:
 *
 *   1. REJECT (exit 1) a migration that mixes DDL (CREATE TABLE/TYPE/INDEX,
 *      ALTER TABLE) with a top-level, unbounded backfill. See
 *      check-migration-safety-rule1.mjs — split out (review round 1) to
 *      keep both files under the repo's 300-line limit.
 *   2. WARN (::warning::, exit 0) on a CREATE INDEX / CREATE UNIQUE INDEX
 *      without CONCURRENTLY over a known-large table (packages, orders,
 *      dispatches, routes).
 *   3. WARN (::warning::, exit 0) on a CREATE UNIQUE INDEX over an
 *      EXISTING table (not one created earlier in the same file) that has
 *      no preceding COUNT(*)-guarded conditional — the h5c pattern
 *      (20260911000002) is the example of doing this correctly and must
 *      not warn.
 *   4. WARN (::warning::, exit 0) on a CREATE/CREATE OR REPLACE SECURITY
 *      DEFINER FUNCTION whose signature does not match any REVOKE issued
 *      anywhere in the migrations corpus against a same-named function
 *      with a DIFFERENT signature — the start_pickup_route(text) vs.
 *      start_pickup_route(uuid, uuid[]) bug (spec-88). See
 *      check-migration-safety-acl.mjs.
 *   5. REJECT (exit 1) a migration that CREATEs/CREATE OR REPLACEs a
 *      SECURITY DEFINER function with no REVOKE {ALL|EXECUTE} ... FROM
 *      PUBLIC for that exact signature anywhere in the same migration —
 *      the close_manifest / add_dock_zone_adjacency_pair bug (spec-80 fase
 *      1b, spec-88 fase 1). Redesigned in review round 2 (PR #723, B1/B2) —
 *      GRANT statements are irrelevant to this rule; only a REVOKE
 *      targeting PUBLIC closes Postgres's default EXECUTE-to-PUBLIC grant.
 *      See check-migration-safety-acl.mjs.
 *
 * A warning never fails the build. Turning rules 2/3/4 into rejections
 * would block CI on a legitimate CREATE INDEX / overload and teach someone
 * to disable this guard — see the spec's own warning about that trade. Rule
 * 5 is different: it rejects, because unlike rules 2-4 it detects the exact
 * shape of a bug this repo has shipped and had to fix by hand more than
 * once, with no legitimate use for the pattern it flags.
 *
 * Usage:
 *   node check-migration-safety.mjs <file-or-dir> [<file-or-dir> ...]
 *   node check-migration-safety.mjs --base <sha> <migrations-dir>
 *
 * With --base, only migration files added/modified/renamed since <sha>
 * (git diff --diff-filter=AMR) are checked — the migrations/ directory
 * holds 90+ files that predate this guard and legitimately mix DDL with a
 * top-level backfill; scanning the whole history would reject the build
 * forever. A pre-existing rule-1 violation on a MODIFIED file is
 * downgraded to a warning (review round 1, B4) — only a NEW violation
 * hard-rejects.
 *
 * Exit codes:
 *   0  ok — nothing rejected (warnings may still have printed)
 *   1  a migration mixes DDL with an unbounded top-level backfill
 *   2  input error
 */
import { readFileSync } from 'node:fs';
import {
  checkDdlBackfillMix,
  findRule1Violations,
  findRule1Warnings,
} from './check-migration-safety-rule1.mjs';
import { listSqlFiles, changedFilesSince, newViolationsSinceBase } from './check-migration-safety-git.mjs';
import {
  buildRevokeIndex,
  findOrphanedOverloadWarnings,
  findGrantWithoutRevokeViolations,
  lineNumberAt,
} from './check-migration-safety-acl.mjs';
import { checkIndexConcurrency, checkUniqueIndexGuard } from './check-migration-safety-rule23.mjs';

export { checkDdlBackfillMix } from './check-migration-safety-rule1.mjs';
export { stripDollarQuotedBodies, stripFunctionBodies } from './check-migration-safety-rule1.mjs';
export { checkIndexConcurrency, checkUniqueIndexGuard } from './check-migration-safety-rule23.mjs';

export function usageError(msg) {
  console.error(`check-migration-safety: ${msg}`);
  process.exit(2);
}

function checkFile(filePath, revokeIndex) {
  const rawSql = readFileSync(filePath, 'utf8');
  const rejectReason = checkDdlBackfillMix(rawSql);
  // B3: the BLOCKING (not M6-downgraded) violations, kept per-statement so
  // --base scoping can diff against base by statement identity, not by the
  // generic reject-reason string every UPDATE-shaped violation shares.
  const blockingViolations = findRule1Violations(rawSql).filter((v) => !v.destinationCreatedHere);
  // Rule 5 (spec-88 fase 4): its own reject list, separate from rule 1's —
  // it has no base-diff pre-existing-violation downgrade (a migration that
  // newly enters the diff with this shape is never "pre-existing" for it).
  const aclRejections = findGrantWithoutRevokeViolations(rawSql);
  const warnings = [...findRule1Warnings(rawSql), ...checkIndexConcurrency(rawSql), ...checkUniqueIndexGuard(rawSql)];
  // Rule 4's warnings carry a character offset so main() can annotate them
  // with file=/line= (review round 2, low finding) — kept separate from the
  // plain-string `warnings` above rather than retrofitting line numbers
  // onto rules 1-3's warnings, which is out of scope for this fase.
  const lineWarnings = findOrphanedOverloadWarnings(rawSql, revokeIndex).map((w) => ({
    message: w.message,
    line: lineNumberAt(rawSql, w.index),
  }));
  return { filePath, rejectReason, blockingViolations, aclRejections, warnings, lineWarnings };
}

function main(argv) {
  const args = [...argv];
  let base = null;
  const positional = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--base') {
      base = args.shift();
      if (!base) usageError('--base requires a value');
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) usageError('no file or directory given');

  let files;
  let fileStatus = new Map();
  let fileOldPath = new Map();
  if (base) {
    if (positional.length !== 1) usageError('--base takes exactly one migrations directory');
    const changed = changedFilesSince(base, positional[0], usageError);
    files = changed.map((f) => f.filePath);
    fileStatus = new Map(changed.map((f) => [f.filePath, f.status]));
    // m8: the OLD path (pre-rename) is what `git show base:<path>` needs —
    // the new path never existed under that name at base.
    fileOldPath = new Map(changed.map((f) => [f.filePath, f.oldPath]));
  } else {
    files = positional.flatMap(listSqlFiles);
  }

  if (files.length === 0) {
    console.log('check-migration-safety: no migration files to check');
    return 0;
  }

  // Rule 4 needs the REVOKE history of the WHOLE corpus, not just the files
  // changed by this PR — with --base, `positional[0]` is still the full
  // migrations directory, so `listSqlFiles` there returns every migration,
  // exactly like the non---base path already does via `files`.
  const corpusFiles = base ? listSqlFiles(positional[0]) : files;
  const revokeIndex = buildRevokeIndex(corpusFiles);

  let rejected = false;
  // Tracked separately (review round 2, medium finding) so the rule-1
  // summary message ("mixes DDL with an unbounded backfill") does not print
  // — and send the reader chasing a backfill that does not exist — when the
  // ONLY thing that rejected was an ACL violation (rule 5).
  let rule1Rejected = false;
  let aclRejected = false;
  for (const f of files) {
    let result;
    try {
      result = checkFile(f, revokeIndex);
    } catch (e) {
      usageError(`could not read ${f}: ${e.message}`);
    }
    if (result.rejectReason) {
      const status = fileStatus.get(f);
      // B4: a pre-existing violation merely being touched (M/R) does not
      // hard-reject the build — only a NEW violation does. Added files
      // always reject; there is no "before" for them to have been safe at.
      // B3: "pre-existing" is decided per VIOLATING STATEMENT (statement
      // identity), not by whether the file rejected at all at base — two
      // different unbounded UPDATEs produce the identical generic reason
      // string, so a message-text or boolean compare would exempt a
      // brand-new violation forever just because SOME violation predates
      // the PR.
      const newOnes =
        base && (status === 'M' || status === 'R')
          ? newViolationsSinceBase(base, f, fileOldPath.get(f), result.blockingViolations)
          : result.blockingViolations;
      if (base && (status === 'M' || status === 'R') && newOnes.length === 0) {
        console.log(
          `::warning::${f} — ${result.rejectReason} (already present before this PR at ${base}; not blocking, but worth fixing while the file is being touched)`
        );
      } else {
        rejected = true;
        rule1Rejected = true;
        const reason = newOnes.length ? newOnes[0].message : result.rejectReason;
        console.error(`::error::${f} — ${reason}`);
      }
    }
    for (const violation of result.aclRejections) {
      rejected = true;
      aclRejected = true;
      console.error(`::error::${f} — ${violation}`);
    }
    for (const w of result.warnings) {
      console.log(`::warning::${f} — ${w}`);
    }
    for (const lw of result.lineWarnings) {
      // Low finding (review round 2): findCreateFunctionSignatures already
      // computes the character offset — annotate the diff with file=/line=
      // (the spec-90 lesson: a ::warning:: with neither is invisible in
      // `gh pr checks`/the PR diff, where it's most useful).
      console.log(`::warning file=${f},line=${lw.line}::${lw.message}`);
    }
  }

  if (rejected) {
    if (rule1Rejected) {
      console.error(
        'check-migration-safety: at least one migration mixes DDL with an unbounded top-level backfill. ' +
          'Split the backfill into its own function, and call it by hand after measuring — see spec-87 fase 3/4.'
      );
    }
    if (aclRejected) {
      console.error(
        'check-migration-safety: at least one migration CREATEs/CREATE OR REPLACEs a SECURITY DEFINER function ' +
          'with no REVOKE {ALL|EXECUTE} ... FROM PUBLIC for that exact signature. Postgres grants EXECUTE to ' +
          'PUBLIC (which anon inherits) on every (re)created function by default, GRANT statement or not — ' +
          'see spec-88 fase 1/4 and spec-80 fase 1b (20260913000004).'
      );
    }
    return 1;
  }
  console.log(`check-migration-safety: OK — checked ${files.length} migration(s)`);
  return 0;
}

// m12 (review round 1/2): this used to call `process.exit(main(...))`
// unconditionally at module scope, so merely IMPORTING this file (e.g. to
// reuse `checkIndexConcurrency`/`checkUniqueIndexGuard` elsewhere) aborted
// the whole process — the exported functions were effectively unimportable.
// Only run (and exit) when this file is the CLI entrypoint.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
