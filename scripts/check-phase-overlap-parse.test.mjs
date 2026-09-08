// Tests for check-phase-overlap-parse.mjs (spec-89 fase 1).
// Pure parsing, no git, no fs — run: node scripts/check-phase-overlap-parse.test.mjs
import assert from 'node:assert/strict';
import {
  parseTarget,
  extractArchivosFiles,
  normalizeFrontendPath,
  resolveArchivosEntries,
  parseImportSpecifiers,
} from './check-phase-overlap-parse.mjs';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
  }
}

// ── parseTarget ──────────────────────────────────────────────────────────
test('parseTarget splits spec#fase@branch', () => {
  const t = parseTarget('docs/specs/spec-81-x.md#Fase 2@feat/spec-81-fase-2-drenado');
  assert.equal(t.specPath, 'docs/specs/spec-81-x.md');
  assert.equal(t.faseMatch, 'Fase 2');
  assert.equal(t.branch, 'feat/spec-81-fase-2-drenado');
});

test('parseTarget allows no branch', () => {
  const t = parseTarget('docs/specs/spec-81-x.md#Fase 2');
  assert.equal(t.specPath, 'docs/specs/spec-81-x.md');
  assert.equal(t.faseMatch, 'Fase 2');
  assert.equal(t.branch, null);
});

test('parseTarget throws without a # separator', () => {
  assert.throws(() => parseTarget('docs/specs/spec-81-x.md'));
});

// ── extractArchivosFiles ─────────────────────────────────────────────────
const SPEC_MD = `
### Fase 1 — algo \`[done]\`

**Archivos:** \`apps/frontend/src/lib/a.ts\`

### Fase 2 — Drenado \`[pending]\`

**Archivos:** \`apps/frontend/src/hooks/useOfflineQueue.ts\`, \`+ test\`

Prosa que no cuenta.

### Fase 3 — Idempotencia \`[in_progress]\`

**Archivos:** \`packages/database/supabase/migrations/x.sql\`,
\`packages/database/supabase/tests/x.test.sql\`,
\`packages/database/supabase/tests/y.test.sql\`

- [x] algo
`;

test('extractArchivosFiles finds the single-line block for its own fase', () => {
  const r = extractArchivosFiles(SPEC_MD, 'Fase 2');
  assert.equal(r.headingFound, true);
  assert.deepEqual(r.files, ['apps/frontend/src/hooks/useOfflineQueue.ts']);
});

test('extractArchivosFiles collects a multi-line wrapped block until the blank line', () => {
  const r = extractArchivosFiles(SPEC_MD, 'Fase 3');
  assert.equal(r.headingFound, true);
  assert.deepEqual(r.files, [
    'packages/database/supabase/migrations/x.sql',
    'packages/database/supabase/tests/x.test.sql',
    'packages/database/supabase/tests/y.test.sql',
  ]);
});

test('extractArchivosFiles does not bleed into the next fase', () => {
  const r = extractArchivosFiles(SPEC_MD, 'Fase 1');
  assert.deepEqual(r.files, ['apps/frontend/src/lib/a.ts']);
});

test('extractArchivosFiles reports headingFound=false for an unmatched fase', () => {
  const r = extractArchivosFiles(SPEC_MD, 'Fase 99');
  assert.equal(r.headingFound, false);
  assert.deepEqual(r.files, []);
  // review round 2: buildTarget destructures {directories, warnings} on
  // EVERY return shape — a caller crashes (TypeError, not a clean usage
  // error) if either early-return path omits them. Real fases hit this
  // exact path: spec-82 fase 2 and spec-83 fase 3 have no **Archivos:** at
  // all by design (genuinely ambiguous — the backfill refused to guess).
  assert.deepEqual(r.directories, []);
  assert.deepEqual(r.warnings, []);
});

test('extractArchivosFiles reports no Archivos line as an empty, found phase', () => {
  const md = '### Fase 1 — sin archivos `[pending]`\n\nSolo prosa.\n';
  const r = extractArchivosFiles(md, 'Fase 1');
  assert.equal(r.headingFound, true);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.directories, []);
  assert.deepEqual(r.warnings, []);
});

test('extractArchivosFiles works with CRLF line endings (git on Windows checks specs out this way)', () => {
  const crlf = SPEC_MD.replace(/\n/g, '\r\n');
  const r = extractArchivosFiles(crlf, 'Fase 2');
  assert.equal(r.headingFound, true);
  assert.deepEqual(r.files, ['apps/frontend/src/hooks/useOfflineQueue.ts']);
});

// ── normalizeFrontendPath ────────────────────────────────────────────────
test('normalizeFrontendPath prefixes a bare app/ shorthand', () => {
  assert.equal(
    normalizeFrontendPath('app/app/pickup/route/active/page.tsx'),
    'apps/frontend/src/app/app/pickup/route/active/page.tsx'
  );
});

test('normalizeFrontendPath prefixes a bare components/ shorthand', () => {
  assert.equal(
    normalizeFrontendPath('components/pickup/UnverifiedPackagesBlock.tsx'),
    'apps/frontend/src/components/pickup/UnverifiedPackagesBlock.tsx'
  );
});

test('normalizeFrontendPath leaves an already-rooted path alone', () => {
  assert.equal(
    normalizeFrontendPath('apps/frontend/src/lib/db.ts'),
    'apps/frontend/src/lib/db.ts'
  );
});

test('normalizeFrontendPath leaves a packages/ SQL path alone', () => {
  assert.equal(
    normalizeFrontendPath('packages/database/supabase/migrations/x.sql'),
    'packages/database/supabase/migrations/x.sql'
  );
});

// ── resolveArchivosEntries (Blocker 5, review round 1) ──────────────────────
// Specs write the directory ONCE and then list bare filenames — real text
// from spec-82 fase 1: `components/pickup/PickupMobileNoRoute.tsx`,
// `PickupMobileStartRoute.tsx`, `PickupMobileClientGroup.tsx`,
// `PickupMobileCompactRow.tsx`, `app/app/pickup/route/active/page.tsx`. Three
// of those five entries had no directory of their own — silently useless
// against `git diff --name-only` and against `resolveContent`.
test('resolveArchivosEntries carries the last directory forward onto bare filenames', () => {
  const r = resolveArchivosEntries([
    'components/pickup/PickupMobileNoRoute.tsx',
    'PickupMobileStartRoute.tsx',
    'PickupMobileClientGroup.tsx',
    'PickupMobileCompactRow.tsx',
    'app/app/pickup/route/active/page.tsx',
  ]);
  assert.deepEqual(r.files, [
    'components/pickup/PickupMobileNoRoute.tsx',
    'components/pickup/PickupMobileStartRoute.tsx',
    'components/pickup/PickupMobileClientGroup.tsx',
    'components/pickup/PickupMobileCompactRow.tsx',
    'app/app/pickup/route/active/page.tsx',
  ]);
});

test('resolveArchivosEntries drops (with a warning) a bare filename with no prior directory context', () => {
  const r = resolveArchivosEntries(['PickupMobileNoRoute.tsx']);
  assert.deepEqual(r.files, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /sin directorio/);
});

// real text from spec-80:145 — a line-number suffix appended to an otherwise
// real, resolvable path.
test('resolveArchivosEntries strips a trailing line-number suffix and warns', () => {
  const r = resolveArchivosEntries(['apps/frontend/src/app/app/pickup/review/[loadId]/page.tsx:176']);
  assert.deepEqual(r.files, ['apps/frontend/src/app/app/pickup/review/[loadId]/page.tsx']);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /sufijo de línea/);
});

// real text from spec-80:188 — a directory declaration ("a new file goes
// somewhere under here"), not a resolvable file.
test('resolveArchivosEntries separates a directory declaration (trailing /) from files, with a warning', () => {
  const r = resolveArchivosEntries(['packages/database/supabase/migrations/']);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.directories, ['packages/database/supabase/migrations/']);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /directorio/);
});

test('resolveArchivosEntries: a directory entry does not become the carry-forward context for a later bare filename', () => {
  const r = resolveArchivosEntries(['packages/database/supabase/migrations/', 'foo.sql']);
  // foo.sql has no real file directory before it (only a directory
  // declaration) — must be rejected, not silently resolved to
  // packages/database/supabase/migrations/foo.sql (which may not exist).
  assert.deepEqual(r.files, []);
  assert.ok(r.warnings.some((w) => /sin directorio/.test(w)));
});

test('resolveArchivosEntries passes an already-complete list through unchanged', () => {
  const r = resolveArchivosEntries(['apps/frontend/src/lib/db.ts', 'apps/frontend/src/lib/queue.ts']);
  assert.deepEqual(r.files, ['apps/frontend/src/lib/db.ts', 'apps/frontend/src/lib/queue.ts']);
  assert.deepEqual(r.warnings, []);
});

// ── parseImportSpecifiers ────────────────────────────────────────────────
test('parseImportSpecifiers finds a relative and an alias import', () => {
  const src = `
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { helper } from './helper';
`;
  const specs = parseImportSpecifiers(src).map((s) => s.specifier);
  assert.ok(specs.includes('@/components/ui/button'));
  assert.ok(specs.includes('./helper'));
  assert.ok(specs.includes('react'), 'bare package specifiers ARE returned — resolution/filtering is the caller\'s job');
});

test('parseImportSpecifiers marks a type-only import as isType', () => {
  const src = `import type { Foo } from '@/lib/types';\nimport { bar } from '@/lib/bar';\n`;
  const specs = parseImportSpecifiers(src);
  const foo = specs.find((s) => s.specifier === '@/lib/types');
  const bar = specs.find((s) => s.specifier === '@/lib/bar');
  assert.equal(foo.isType, true);
  assert.equal(bar.isType, false);
});

test('parseImportSpecifiers finds a barrel re-export', () => {
  const src = `export * from './queue';\nexport { markSent } from './queue-writers';\n`;
  const specs = parseImportSpecifiers(src).map((s) => s.specifier);
  assert.ok(specs.includes('./queue'));
  assert.ok(specs.includes('./queue-writers'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
