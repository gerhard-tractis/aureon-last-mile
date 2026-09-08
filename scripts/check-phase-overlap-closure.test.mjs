// Tests for check-phase-overlap-closure.mjs (spec-89 fase 1).
// No git, no fs — content comes from an in-memory fixture map, injected via
// a resolveContent(path) callback. Run: node scripts/check-phase-overlap-closure.test.mjs
import assert from 'node:assert/strict';
import { buildClosure, computeOverlap } from './check-phase-overlap-closure.mjs';

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
    console.log(`       ${e.stack}`);
  }
}

// A tiny in-memory "repo": page -> shared component -> deep leaf -> even deeper.
const FILES = {
  'apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx': `
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { AppLayout } from '@/components/AppLayout';
`,
  'apps/frontend/src/hooks/useOfflineQueue.ts': `
import { enqueue } from '@/lib/offline/queue';
`,
  'apps/frontend/src/lib/offline/queue.ts': `
import { db } from '@/lib/db';
`,
  'apps/frontend/src/lib/db.ts': `
import { deepest } from '@/lib/offline/deepest';
`,
  'apps/frontend/src/lib/offline/deepest.ts': `// leaf, no imports`,
  'apps/frontend/src/components/AppLayout.tsx': `
import { TopBar } from '@/components/TopBar';
`,
  'apps/frontend/src/components/TopBar.tsx': `// leaf, no imports`,
  'apps/frontend/src/app/app/pickup/route/active/page.tsx': `
import { Trigger } from '@/components/pickup/DigitalizeManifestTrigger';
`,
  'apps/frontend/src/components/pickup/DigitalizeManifestTrigger.tsx': `// no imports of the queue`,
  'apps/frontend/src/lib/offline/other.ts': `// unrelated leaf`,
};

function resolveContent(path) {
  return Object.prototype.hasOwnProperty.call(FILES, path) ? FILES[path] : null;
}

// ── buildClosure ─────────────────────────────────────────────────────────
test('buildClosure includes the seed at depth 0', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 2 });
  assert.equal(c.get('apps/frontend/src/hooks/useOfflineQueue.ts').depth, 0);
});

test('buildClosure follows an alias import one hop', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 2 });
  assert.ok(c.has('apps/frontend/src/lib/offline/queue.ts'));
  assert.equal(c.get('apps/frontend/src/lib/offline/queue.ts').depth, 1);
});

test('buildClosure records the via-chain (from + specifier)', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 2 });
  const via = c.get('apps/frontend/src/lib/offline/queue.ts').via;
  assert.equal(via.from, 'apps/frontend/src/hooks/useOfflineQueue.ts');
  assert.equal(via.specifier, '@/lib/offline/queue');
});

test('buildClosure stops at maxDepth — a 3rd hop is not reached at depth 2', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 2 });
  // hop1: queue.ts (depth1) -> hop2: db.ts (depth2) -> hop3: deepest.ts (depth3, excluded)
  assert.ok(c.has('apps/frontend/src/lib/db.ts'), 'depth 2 should be included');
  assert.ok(!c.has('apps/frontend/src/lib/offline/deepest.ts'), 'depth 3 must be excluded by the cap');
});

test('buildClosure reaches a 3rd hop when maxDepth is raised — proves the cap, not a resolver bug, excluded it above', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 3 });
  assert.ok(c.has('apps/frontend/src/lib/offline/deepest.ts'));
});

test('buildClosure does not reach an unrelated file', () => {
  const c = buildClosure(['apps/frontend/src/hooks/useOfflineQueue.ts'], { resolveContent, maxDepth: 3 });
  assert.ok(!c.has('apps/frontend/src/lib/offline/other.ts'));
});

test('buildClosure returns just the seed when resolveContent has nothing (new, uncommitted file)', () => {
  const c = buildClosure(['apps/frontend/src/lib/offline/brand-new.ts'], { resolveContent, maxDepth: 2 });
  assert.equal(c.size, 1);
  assert.ok(c.has('apps/frontend/src/lib/offline/brand-new.ts'));
});

// ── Next.js App Router: a page.tsx is wrapped by every ancestor layout.tsx
// via FILE-SYSTEM convention, never via an `import` statement — real code
// in this repo (apps/frontend/src/app/app/layout.tsx imports AppLayout and
// wraps every page under app/app/**). A plain import-graph walk is blind to
// this; buildClosure adds it as a synthetic edge from page.tsx to each
// ancestor layout.tsx, exactly the shape that let spec-81's AppLayout.tsx
// change go unnoticed by spec-80/spec-82's page.tsx closures.
const FILES_WITH_LAYOUT = {
  ...FILES,
  'apps/frontend/src/app/app/layout.tsx': `
import { AppLayout } from '@/components/AppLayout';
`,
  'apps/frontend/src/app/app/pickup/layout.tsx': `// section layout, no imports of its own`,
  // A decoy that only exists to make the "non-page file" test meaningful:
  // without the isNextPageFile guard, the ancestor-walk from
  // DigitalizeManifestTrigger.tsx's OWN directory would climb into this
  // file by pure path arithmetic — even though a layout.tsx here is not
  // valid Next.js (layout.tsx only applies under app/). A test that expects
  // this to stay unreached only proves the guard when a hit is possible.
  'apps/frontend/src/components/pickup/layout.tsx': `// decoy — must never be reached, not a real page`,
};
function resolveWithLayout(path) {
  return Object.prototype.hasOwnProperty.call(FILES_WITH_LAYOUT, path) ? FILES_WITH_LAYOUT[path] : null;
}

test('buildClosure reaches the App Router layout ancestor of a page.tsx without an import statement', () => {
  const c = buildClosure(
    ['apps/frontend/src/app/app/pickup/route/active/page.tsx'],
    { resolveContent: resolveWithLayout, maxDepth: 1 }
  );
  assert.ok(c.has('apps/frontend/src/app/app/pickup/layout.tsx'), 'nearest section layout');
  assert.ok(c.has('apps/frontend/src/app/app/layout.tsx'), 'router-root layout');
});

test('buildClosure reaches AppLayout.tsx two hops from a page.tsx: page -> layout.tsx (convention) -> AppLayout (import)', () => {
  const c = buildClosure(
    ['apps/frontend/src/app/app/pickup/route/active/page.tsx'],
    { resolveContent: resolveWithLayout, maxDepth: 2 }
  );
  assert.ok(c.has('apps/frontend/src/components/AppLayout.tsx'));
});

test('buildClosure does not apply the layout-ancestor rule to a non-page file', () => {
  const c = buildClosure(
    ['apps/frontend/src/components/pickup/DigitalizeManifestTrigger.tsx'],
    { resolveContent: resolveWithLayout, maxDepth: 2 }
  );
  assert.ok(!c.has('apps/frontend/src/app/app/layout.tsx'));
  assert.ok(!c.has('apps/frontend/src/components/pickup/layout.tsx'), 'decoy layout.tsx outside app/ must never be reached');
});

// ── computeOverlap ───────────────────────────────────────────────────────
function target(name, writeFiles, seedForClosure = writeFiles, maxDepth = 2) {
  return {
    name,
    writeSet: new Set(writeFiles),
    closure: buildClosure(seedForClosure, { resolveContent, maxDepth }),
  };
}

test('computeOverlap: two targets writing the same file is a hard conflict', () => {
  const a = target('A', ['apps/frontend/src/lib/db.ts']);
  const b = target('B', ['apps/frontend/src/lib/db.ts']);
  const r = computeOverlap([a, b]);
  assert.equal(r.hard.length, 1);
  assert.equal(r.hard[0].file, 'apps/frontend/src/lib/db.ts');
  assert.deepEqual(r.hard[0].targets.sort(), ['A', 'B']);
});

test('computeOverlap: disjoint write sets with no shared closure is clean', () => {
  const a = target('A', ['apps/frontend/src/lib/offline/other.ts']);
  const b = target('B', ['apps/frontend/src/components/pickup/DigitalizeManifestTrigger.tsx']);
  const r = computeOverlap([a, b]);
  assert.equal(r.hard.length, 0);
  assert.equal(r.soft.length, 0);
});

test('computeOverlap: A writes a file that is only in B\'s transitive closure — soft coupling, not hard', () => {
  // A writes AppLayout.tsx directly; B's page imports it transitively via useOfflineQueue? no —
  // use the page/AppLayout pair: A writes AppLayout.tsx, B's page.tsx reaches it via import.
  const a = target('A', ['apps/frontend/src/components/AppLayout.tsx']);
  const b = target('B', ['apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx']);
  const r = computeOverlap([a, b]);
  assert.equal(r.hard.length, 0, 'B does not WRITE AppLayout.tsx, so this must not be a hard conflict');
  assert.equal(r.soft.length, 1);
  assert.equal(r.soft[0].file, 'apps/frontend/src/components/AppLayout.tsx');
  assert.equal(r.soft[0].writer, 'A');
  assert.equal(r.soft[0].reacher, 'B');
});

test('computeOverlap: three real Recogida targets — two share surface, one (SQL) is disjoint', () => {
  const a = target('spec-81-fase-2', [
    'apps/frontend/src/hooks/useOfflineQueue.ts',
    'apps/frontend/src/components/AppLayout.tsx',
  ]);
  const b = target('spec-82-fase-1', [
    'apps/frontend/src/app/app/pickup/route/active/page.tsx',
  ]);
  const c = target('spec-88-fase-2', ['packages/database/supabase/migrations/x.sql'], [], 2);
  const r = computeOverlap([a, b, c]);
  assert.equal(r.hard.length, 0);
  // b's page.tsx doesn't reach AppLayout.tsx in this fixture graph (it imports
  // DigitalizeManifestTrigger, not AppLayout) — so no soft overlap either here;
  // the point of this test is that the disjoint SQL target produces NOTHING.
  const touchesC = [...r.hard, ...r.soft].some((x) => x.file && x.file.includes('.sql'));
  assert.equal(touchesC, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
