/**
 * check-phase-overlap-parse.mjs (spec-89 fase 1)
 *
 * Pure text parsing for the parallelism guardrail: no git, no fs. Kept
 * separate from check-phase-overlap.mjs so the parsing rules — the part most
 * likely to drift from real spec/source syntax — can be unit-tested without
 * a repo checkout.
 */

/**
 * `<specPath>#<faseMatch>[@<branch>]`
 *
 * faseMatch is matched as a substring against the phase's heading line
 * (`### Fase 2 — Drenado \`[pending]\``), not an exact match — phase
 * headings carry a title after the number ("Fase 1b — ACL heredado…") and
 * pinning the exact text would make every caller quote the whole heading.
 */
export function parseTarget(str) {
  const at = str.lastIndexOf('@');
  const hash = str.indexOf('#');
  if (hash === -1) {
    throw new Error(`target sin '#<fase>': ${str}`);
  }
  // '@' only counts as the branch separator if it comes after the '#' —
  // a branch name itself never legitimately contains '#', but guard order
  // matters so a spec path with no branch doesn't misparse.
  const hasBranch = at > hash;
  const specPath = str.slice(0, hash);
  const faseMatch = hasBranch ? str.slice(hash + 1, at) : str.slice(hash + 1);
  const branch = hasBranch ? str.slice(at + 1) : null;
  if (!specPath || !faseMatch) {
    throw new Error(`target mal formado: ${str}`);
  }
  return { specPath, faseMatch, branch };
}

const HEADING_RE = /^#{2,4}\s+.*$/;

/**
 * Finds the phase whose heading line contains `faseMatch`, and reads its
 * `**Archivos:**` field: the field's own line plus any immediately
 * following non-blank lines (specs wrap long file lists across lines — see
 * spec-81 fase 3), stopping at the first blank line or the next heading.
 *
 * Returns every backtick-quoted span that looks like a file path (has a
 * slash or a recognized extension) — filters out prose asides like
 * `` `+ test` `` or a bare identifier quoted for emphasis.
 */
export function extractArchivosFiles(mdContent, faseMatch) {
  // Normalize CRLF first: `$` in HEADING_RE anchors to end-of-string, and
  // `.` never matches `\r` — on a Windows checkout (CRLF line endings) the
  // trailing `\r` sits between the last real character and `$`, so the
  // anchor never lines up and every heading silently fails to match.
  const lines = mdContent.replace(/\r\n/g, '\n').split('\n');
  let phaseStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) && lines[i].includes(faseMatch)) {
      phaseStart = i;
      break;
    }
  }
  if (phaseStart === -1) {
    return { headingFound: false, files: [] };
  }

  let phaseEnd = lines.length;
  for (let i = phaseStart + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      phaseEnd = i;
      break;
    }
  }

  let archivosStart = -1;
  for (let i = phaseStart + 1; i < phaseEnd; i++) {
    if (/^\*\*Archivos:\*\*/.test(lines[i])) {
      archivosStart = i;
      break;
    }
  }
  if (archivosStart === -1) {
    return { headingFound: true, files: [] };
  }

  let archivosEnd = archivosStart + 1;
  while (archivosEnd < phaseEnd && lines[archivosEnd].trim() !== '') {
    archivosEnd++;
  }
  const block = lines.slice(archivosStart, archivosEnd).join('\n');

  const files = [];
  const spanRe = /`([^`]+)`/g;
  let m;
  while ((m = spanRe.exec(block))) {
    const span = m[1];
    const looksLikePath = span.includes('/') || /\.[A-Za-z]{2,5}$/.test(span);
    if (looksLikePath && !span.startsWith('+')) {
      files.push(span);
    }
  }
  return { headingFound: true, files };
}

const FRONTEND_SHORTHAND_ROOTS = ['app/', 'components/', 'hooks/', 'lib/'];
const KNOWN_REPO_ROOTS = ['apps/', 'packages/', 'docs/', 'scripts/', 'infra/', '.claude/'];

/**
 * Specs write shorthand paths relative to `apps/frontend/src/` (e.g.
 * `components/pickup/Foo.tsx`) rather than the full repo path. Only
 * qualifies a path that starts with a known frontend-source root AND isn't
 * already rooted under a known top-level repo directory — a SQL path under
 * `packages/database/...` must pass through untouched.
 */
export function normalizeFrontendPath(p) {
  if (KNOWN_REPO_ROOTS.some((root) => p.startsWith(root))) {
    return p;
  }
  if (FRONTEND_SHORTHAND_ROOTS.some((root) => p.startsWith(root))) {
    return `apps/frontend/src/${p}`;
  }
  return p;
}

// One pass, three capturing groups so `import type {...} from '...'` is
// distinguished from a plain `import {...} from '...'` without a second
// regex that would double-count the same statement.
const IMPORT_RE =
  /import\s+type\s+[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+(?!type\s)[\s\S]*?from\s+['"]([^'"]+)['"]|export\s+(?:\*|type\s+\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Returns `{ specifier, isType }` for every static import, type-only
 * import, barrel re-export, and `require()` in `content`. Callers filter
 * out bare package specifiers (`react`, `next/navigation`) — this module
 * only recognizes the syntax, resolution to a repo file happens elsewhere.
 */
export function parseImportSpecifiers(content) {
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content))) {
    const [, typeSpec, valueSpec, reExportSpec, requireSpec] = m;
    if (typeSpec) out.push({ specifier: typeSpec, isType: true });
    else if (valueSpec) out.push({ specifier: valueSpec, isType: false });
    else if (reExportSpec) out.push({ specifier: reExportSpec, isType: false });
    else if (requireSpec) out.push({ specifier: requireSpec, isType: false });
  }
  return out;
}
