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
import { checkDdlBackfillMix } from './check-migration-safety-rule1.mjs';

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
      return { status, filePath };
    })
    .filter((f) => f.filePath.endsWith('.sql'));
}

/**
 * B4: whether `filePath`, as it existed at `baseSha`, already rejected
 * under rule 1. Used to downgrade a rejection on a MODIFIED/RENAMED file
 * to a non-blocking warning when the violation predates this PR — the
 * guard should catch a NEW violation an edit introduces, not punish
 * touching a migration that was already unsafe before this guard existed.
 */
export function rejectedAtBase(baseSha, filePath) {
  try {
    const content = execFileSync('git', ['show', `${baseSha}:${filePath}`], {
      encoding: 'utf8',
    });
    return checkDdlBackfillMix(content) !== null;
  } catch {
    return false; // file did not exist at base -> nothing to have been "already rejecting"
  }
}
