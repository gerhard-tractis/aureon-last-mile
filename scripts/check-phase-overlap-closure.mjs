/**
 * check-phase-overlap-closure.mjs (spec-89 fase 1)
 *
 * Transitive import closure and the hard/soft overlap verdict. No git, no
 * fs — `resolveContent(path) -> string|null` is injected so this is
 * testable with an in-memory fixture and, in the real CLI, backed by
 * `git show <ref>:<path>` (see check-phase-overlap.mjs).
 */
import { parseImportSpecifiers } from './check-phase-overlap-parse.mjs';

const CANDIDATE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx'];
const BARREL_SUFFIXES = ['/index.ts', '/index.tsx'];

function posixJoin(dir, rel) {
  const parts = `${dir}/${rel}`.split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/**
 * Resolves an import specifier found in `fromFile` to a repo-relative file
 * path, or null if it's a bare package specifier (node_modules — out of
 * scope by construction, see the spec's "dónde cortar" decision) or
 * resolves to nothing `resolveContent` recognizes.
 */
function resolveSpecifier(specifier, fromFile, resolveContent) {
  let base;
  if (specifier.startsWith('@/')) {
    base = `apps/frontend/src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    const dir = fromFile.split('/').slice(0, -1).join('/');
    base = posixJoin(dir, specifier);
  } else {
    return null; // bare package specifier — node_modules, not this repo
  }

  for (const ext of CANDIDATE_EXTS) {
    const candidate = base + ext;
    if (resolveContent(candidate) !== null) return candidate;
  }
  for (const suffix of BARREL_SUFFIXES) {
    const candidate = base + suffix;
    if (resolveContent(candidate) !== null) return candidate;
  }
  return null;
}

const APP_ROUTER_ROOT = 'apps/frontend/src/app';

function isNextPageFile(file) {
  return file.startsWith(`${APP_ROUTER_ROOT}/`) && /\/page\.(tsx|ts|jsx|js)$/.test(file);
}

/**
 * Next.js App Router applies a `layout.tsx` to every route beneath it by
 * FILE-SYSTEM CONVENTION, never by an `import` statement — real code in
 * this repo: `apps/frontend/src/app/app/layout.tsx` imports `AppLayout` and
 * wraps every page under `app/app/**`, but no `page.tsx` ever imports that
 * layout file. A plain import-graph walk is structurally blind to this
 * edge, which is exactly the shape of the coupling this guard exists to
 * catch (a page depends on a shared shell it never names). Returns every
 * `layout.{tsx,ts}` from the page's own directory up to (and including)
 * the app-router root.
 */
function nextLayoutAncestors(file, resolveContent) {
  if (!isNextPageFile(file)) return [];
  const results = [];
  let dir = file.split('/').slice(0, -1).join('/');
  while (dir.length >= APP_ROUTER_ROOT.length) {
    for (const ext of ['.tsx', '.ts']) {
      const candidate = `${dir}/layout${ext}`;
      if (resolveContent(candidate) !== null) {
        results.push(candidate);
        break;
      }
    }
    if (dir === APP_ROUTER_ROOT) break;
    dir = dir.split('/').slice(0, -1).join('/');
  }
  return results;
}

/**
 * BFS import closure from `seedFiles`, capped at `maxDepth` hops.
 *
 * Why a depth cap and not full closure: a page imports a shared layout,
 * which imports a shared hook, which imports a shared lib — by 3-4 hops
 * that reaches design-system atoms and utility leaves that virtually every
 * screen in the app imports. Past that point "shares a file" stops meaning
 * "these two phases can break each other" and starts meaning "this is
 * Next.js" — a guard that flags that is noise no one reads. maxDepth
 * defaults to 2: seed (the phase's own files, depth 0) -> what it imports
 * directly (depth 1, e.g. a page importing AppLayout) -> what THOSE import
 * (depth 2, e.g. AppLayout importing a shared hook). That is exactly deep
 * enough to have caught today's incident (spec-82's page importing
 * spec-81's queue infra was 1-2 hops) without walking into node_modules —
 * which resolveSpecifier already excludes structurally, not by depth.
 */
export function buildClosure(seedFiles, { resolveContent, maxDepth = 2 }) {
  const visited = new Map();
  for (const f of seedFiles) {
    visited.set(f, { depth: 0, via: null });
  }
  let frontier = [...seedFiles];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const file of frontier) {
      const content = resolveContent(file);
      if (content !== null) {
        for (const imp of parseImportSpecifiers(content)) {
          const resolved = resolveSpecifier(imp.specifier, file, resolveContent);
          if (!resolved || visited.has(resolved)) continue;
          visited.set(resolved, {
            depth,
            via: { from: file, specifier: imp.specifier, isType: imp.isType },
          });
          next.push(resolved);
        }
      }
      // Convention edge, independent of whether `file` itself has content
      // (resolveContent may be null for a brand-new page with no commit yet
      // — its ancestor layouts still exist and still apply to it).
      for (const layoutFile of nextLayoutAncestors(file, resolveContent)) {
        if (visited.has(layoutFile)) continue;
        visited.set(layoutFile, {
          depth,
          via: { from: file, specifier: '(Next.js layout ancestor, no import statement)', isType: false },
        });
        next.push(layoutFile);
      }
    }
    frontier = next;
  }
  return visited;
}

/**
 * Pairwise overlap across N targets. Two tiers, deliberately not one:
 *
 *   HARD  — two targets both WRITE the same file. A merge-order accident:
 *           whichever lands second silently overwrites or conflicts with
 *           the first. This blocks.
 *
 *   SOFT  — one target writes a file that the other only REACHES by
 *           import (directly or transitively) but does not itself write.
 *           This is the "ni indirectamente" case from the spec: B's page
 *           imports A's queue module, so if A changes that module's
 *           contract mid-flight, B silently breaks even though B's own
 *           diff never touches the file. Real (today's spec-81/spec-82
 *           incident was exactly this shape) but not a blocker — nearly
 *           everything imports AppLayout, and a guard that blocks on that
 *           is a guard nobody keeps enabled.
 *
 * Two targets that merely reach the same file through import, with NEITHER
 * writing it, are not reported at all — that is "this app has a design
 * system", not a parallelism risk.
 */
// review round 1, blocker 1: every phase edits its OWN spec's markdown as
// routine narration (the `[x]` checkboxes, review notes, the token itself).
// Two sibling phases of the SAME spec both touch that one `.md` in their
// real `git diff`, which reported a hard conflict on the spec's own prose
// for the single most common parallel-dispatch pattern in this repo — two
// phases of one spec. `docs/**` carries no runtime contract to break, so it
// is excluded from BOTH tiers, not just softened: there is nothing here for
// "soft coupling" to mean either.
function isIgnoredForOverlap(file) {
  return file.startsWith('docs/');
}

/**
 * A directory declaration ("`packages/database/supabase/tests/`" — a phase
 * will write SOME new file under here, name unknown) vs another target's
 * CONCRETE files. Two directory declarations — even the identical string —
 * never collide with each other: this exact phrase is how the corpus
 * declares "a new pgTAP test", every phase's file is uniquely named, and a
 * false hard conflict here would permanently block the most common
 * pgTAP-authoring parallel-dispatch pattern in this repo (coordinator
 * escalation, review round 2: spec-86 fase 1 vs fase 2a, both declaring
 * `packages/database/supabase/tests/`).
 *
 * A directory declaration DOES collide with a concrete file the other
 * target actually writes under it — that real file's name might turn out to
 * be exactly the one the open-ended phase eventually picks (real risk for
 * timestamp-named migrations dispatched close together), and unlike two
 * bare directory strings, one side here has REAL information to compare
 * against.
 */
function directoryConflicts(a, b, hard) {
  for (const dir of a.directories ?? []) {
    if (isIgnoredForOverlap(dir)) continue;
    for (const file of b.writeSet) {
      if (isIgnoredForOverlap(file)) continue;
      if (file.startsWith(dir)) {
        hard.push({ file, targets: [a.name, b.name], kind: 'directory', declaredDir: dir, declaredBy: a.name });
      }
    }
  }
}

export function computeOverlap(targets) {
  const hard = [];
  const soft = [];

  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];

      for (const file of a.writeSet) {
        if (isIgnoredForOverlap(file)) continue;
        if (b.writeSet.has(file)) {
          hard.push({ file, targets: [a.name, b.name] });
        }
      }

      directoryConflicts(a, b, hard);
      directoryConflicts(b, a, hard);

      for (const [file, info] of a.closure) {
        if (isIgnoredForOverlap(file)) continue;
        if (a.writeSet.has(file)) continue; // already handled as a's own write
        if (b.writeSet.has(file) && !a.writeSet.has(file)) {
          soft.push({ file, writer: b.name, reacher: a.name, via: info.via });
        }
      }
      for (const [file, info] of b.closure) {
        if (isIgnoredForOverlap(file)) continue;
        if (b.writeSet.has(file)) continue;
        if (a.writeSet.has(file) && !b.writeSet.has(file)) {
          soft.push({ file, writer: a.name, reacher: b.name, via: info.via });
        }
      }
    }
  }

  return { hard, soft };
}
