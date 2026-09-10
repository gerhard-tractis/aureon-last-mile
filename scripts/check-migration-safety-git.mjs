/**
 * check-migration-safety-git.mjs (spec-87 fase 5)
 *
 * File-listing and git-diff helpers for check-migration-safety.mjs, split
 * out (review round 1) to keep the main file under the repo's 300-line
 * limit.
 */
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRule1Violations } from './check-migration-safety-rule1.mjs';
import { buildAclTimeline } from './check-migration-safety-acl.mjs';
import { findCreateFunctionSignatures } from './check-migration-safety-acl-parse.mjs';

export function listSqlFiles(target) {
  const st = statSync(target);
  if (st.isDirectory()) {
    return readdirSync(target)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => path.join(target, f));
  }
  return [target];
}

/**
 * B4: files ADDED, MODIFIED or RENAMED since baseSha. `--diff-filter=A`
 * alone missed a PR that only EDITS an existing migration's backfill —
 * real precedent in this repo: 20260908000001 (added in #613, modified in
 * #615) and 20260901000001 (modified in #583, "lift statement_timeout on
 * the two migration-time backfills"). Editing an existing migration to
 * touch its backfill is ordinary practice here, not a hypothetical.
 *
 * Deliberately a single two-dot diff against baseSha, not a three-dot
 * attempt with a two-dot fallback (review round 1, m11): with
 * `actions/checkout@v4` at depth 1 plus a shallow `git fetch --depth=1`
 * (see ci.yml), there is never enough history for a three-dot merge-base
 * diff to succeed, so that path was dead code that only made the fallback
 * untested — the live path in CI was always the untested one. One method,
 * matching the fallback check-spec-fields.sh already uses for the same
 * shallow-fetch reason.
 *
 * m8 (review round 2): a plain rename's `--name-status` line is
 * `R100\t<old path>\t<new path>` — three columns, not two. The OLD `oldPath`
 * (`parts[1]`) is what existed at `baseSha`; the NEW path
 * (`parts[parts.length - 1]`) is what exists now and is what gets checked.
 * Using the new path for BOTH used to make `git show base:<new path>`
 * always fail (the new path never existed under that name at base), which
 * fail-safed to "not exempt" instead of ever actually comparing.
 */
export function changedFilesSince(baseSha, dir, onError) {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['diff', '--name-status', '--diff-filter=AMR', baseSha, '--', dir],
      { encoding: 'utf8' }
    );
  } catch (e) {
    onError(`git diff against ${baseSha} failed: ${e.message}`);
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const status = parts[0][0]; // e.g. "R100" -> "R"
      const filePath = parts[parts.length - 1]; // renames: NEW path is last column
      const oldPath = status === 'R' && parts.length >= 3 ? parts[1] : filePath;
      return { status, filePath, oldPath };
    })
    .filter((f) => f.filePath.endsWith('.sql'));
}

/**
 * B3: the list of rule-1 violations `filePath` (as it existed at `baseSha`,
 * under `oldPathAtBase` — see m8) already had. Used to tell a genuinely NEW
 * violation an edit introduces from one that predates this PR.
 *
 * Deliberately returns the full violation LIST, not a boolean. A boolean
 * (or a bare rejection-message compare — the message text is the same
 * generic string for every unbounded UPDATE, regardless of which statement
 * caused it) exempts a file FOREVER the moment it had ANY violation at
 * base, even if the PR adds a brand-new, unrelated one alongside it.
 */
export function violationsAtBase(baseSha, filePath, oldPathAtBase) {
  try {
    const content = execFileSync('git', ['show', `${baseSha}:${oldPathAtBase ?? filePath}`], {
      encoding: 'utf8',
    });
    return findRule1Violations(content);
  } catch {
    return []; // file did not exist at base under that path -> nothing pre-existed
  }
}

/**
 * B10 (review round 5, PR #723): the raw content of `filePath` (as it
 * existed at `baseSha`, under `oldPathAtBase` — see m8) or `null` if it did
 * not exist there. Used by rule 5's `--base` degradation (a violation that
 * ALSO held at base is pre-existing — warn; one that only holds now is
 * genuinely new — reject) — the same "measure against base" shape as
 * `violationsAtBase` above, but returning raw content rather than a parsed
 * violation list, because rule 5's "pre-existing" test needs a whole
 * second `buildAclTimeline` corpus, not a per-statement diff.
 */
export function readFileAtBase(baseSha, filePath, oldPathAtBase) {
  try {
    return execFileSync('git', ['show', `${baseSha}:${oldPathAtBase ?? filePath}`], {
      encoding: 'utf8',
    });
  } catch {
    return null; // did not exist at base under that path
  }
}

/**
 * B10 (review round 5): the full `buildAclTimeline` corpus AS OF `baseSha`
 * — split out of check-migration-safety.mjs's `main()` (review round 5) to
 * keep that file under the repo's 300-line limit, same reason this file
 * already exists. `corpusPath = corpusFiles[fileIdxOf(f)]` is the exact
 * string `buildAclTimeline` iterates over for that file — overrides must be
 * keyed by that, not by `f` (which under `--base` is a forward-slash
 * git-diff path that may differ from `corpusFiles`'s platform separator).
 * Unchanged files get no override (read from disk — identical at base,
 * since base is an ancestor and the file wasn't touched); `M`/`R` files
 * read via `git show base:<oldPath>`; `A`(dded) files get an explicit
 * `null` override — they did not exist at base, so nothing they contain
 * should count as having applied before this PR.
 */
/**
 * B1 (review round 6, CRITICAL): whether the violating `CREATE FUNCTION
 * public.name(signature)` already existed AT `baseSha` — i.e. whether
 * there is a "before" this violation could genuinely be pre-existing at.
 * `isPublicOpenAt`/`isAnonOpenDirectly` alone are not enough: they default
 * to "open" when a key has NO events at all (Postgres's own default grant
 * — see check-migration-safety-acl.mjs), which is exactly the state of a
 * function that never existed in `baseTimeline` in the first place. A
 * brand-new function added by editing an existing (M-status) file reads,
 * under that lone test, as "open at base" — false: it wasn't there to be
 * open OR closed. `ci.yml` invokes this checker with `--base` on every
 * PR, so this was not an edge case — it was the only path rule 5 actually
 * took in CI, and it silently passed until the file's OWN new CREATE
 * happened to also carry its own closing REVOKE (round 5's "genuinely
 * introduced" fixture only ever exercised that lucky half).
 */
export function functionExistedAtBase(baseSha, filePath, oldPathAtBase, name, signature) {
  const content = readFileAtBase(baseSha, filePath, oldPathAtBase);
  if (content === null) return false; // file itself did not exist at base
  return findCreateFunctionSignatures(content).some((fn) => fn.name === name && fn.signature === signature);
}

export function buildBaseAclTimeline(baseSha, files, fileStatus, fileOldPath, corpusFiles, fileIdxOf) {
  const overrides = new Map();
  for (const f of files) {
    const status = fileStatus.get(f);
    const corpusPath = corpusFiles[fileIdxOf(f)];
    if (corpusPath === undefined) continue; // should not happen — checked file is always in corpusFiles
    if (status === 'A') {
      overrides.set(corpusPath, null);
    } else if (status === 'M' || status === 'R') {
      overrides.set(corpusPath, readFileAtBase(baseSha, f, fileOldPath.get(f)));
    }
  }
  return buildAclTimeline(corpusFiles, overrides);
}

/**
 * F4 (review round 3): collapses all whitespace runs to a single space, so
 * a statement's IDENTITY for base-diffing purposes is insensitive to pure
 * reformatting (re-indenting, wrapping across lines). `.trim()` alone only
 * absorbs leading/trailing whitespace — it left a whitespace-only edit
 * (e.g. wrapping an existing backfill across three indented lines with no
 * semantic change) looking like a brand-new violation, because the Set
 * comparison in `newViolationsSinceBase` is exact-string. Real precedent
 * this protects: 20260901000001, "lift statement_timeout on the two
 * migration-time backfills" — reformatting a backfill while touching it
 * must not reject.
 */
function normalizeStatementWhitespace(stmt) {
  return stmt.replace(/\s+/g, ' ').trim();
}

/**
 * B3: which of `currentViolations` are genuinely NEW relative to `baseSha`
 * — i.e. no violation at base has the same `statement` identity. A
 * violation identical (by statement text, whitespace-normalized — F4) to
 * one already at base is not new; anything else is, even when the file
 * already had a DIFFERENT violation at base.
 */
export function newViolationsSinceBase(baseSha, filePath, oldPathAtBase, currentViolations) {
  const baseStatements = new Set(
    violationsAtBase(baseSha, filePath, oldPathAtBase).map((v) => normalizeStatementWhitespace(v.statement))
  );
  return currentViolations.filter((v) => !baseStatements.has(normalizeStatementWhitespace(v.statement)));
}
