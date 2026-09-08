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
 * B3: which of `currentViolations` are genuinely NEW relative to `baseSha`
 * — i.e. no violation at base has the same `statement` identity. A
 * violation identical (by statement text) to one already at base is not
 * new; anything else is, even when the file already had a DIFFERENT
 * violation at base.
 */
export function newViolationsSinceBase(baseSha, filePath, oldPathAtBase, currentViolations) {
  const baseStatements = new Set(violationsAtBase(baseSha, filePath, oldPathAtBase).map((v) => v.statement));
  return currentViolations.filter((v) => !baseStatements.has(v.statement));
}
