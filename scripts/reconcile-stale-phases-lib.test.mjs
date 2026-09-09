// Tests for reconcile-stale-phases-lib.mjs (spec-91 fase 5).
// Pure logic, no fs/git/gh — run: node scripts/reconcile-stale-phases-lib.test.mjs
import assert from 'node:assert/strict';
import {
  findInProgressPhases,
  extractSpecIdsFromBranches,
  computeStalePhases,
  parseIssueBody,
  renderIssueBody,
  mergeStaleEntries,
} from './reconcile-stale-phases-lib.mjs';

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

// ── findInProgressPhases ─────────────────────────────────────────────────

test('findInProgressPhases: finds an [in_progress] heading and its spec id from the filename', () => {
  const files = [
    {
      filename: 'spec-80-recogida-movil-cierre-de-carga.md',
      content: '### Fase 2 — `5e` cerrar con faltantes `[in_progress]`\n',
    },
  ];
  const phases = findInProgressPhases(files);
  assert.deepEqual(phases, [
    { specId: '80', faseText: 'Fase 2 — `5e` cerrar con faltantes', file: 'spec-80-recogida-movil-cierre-de-carga.md' },
  ]);
});

test('findInProgressPhases: ignores [done]/[pending]/[blocked] headings', () => {
  const files = [
    {
      filename: 'spec-89-x.md',
      content: [
        '### Fase 1 — algo `[done]`',
        '### Fase 2 — otro `[pending]`',
        '### Fase 3 — bloqueada `[blocked]`',
      ].join('\n'),
    },
  ];
  assert.deepEqual(findInProgressPhases(files), []);
});

test('findInProgressPhases: multiple phases across multiple specs', () => {
  const files = [
    { filename: 'spec-80-x.md', content: '### Fase 1 — a `[in_progress]`\n' },
    { filename: 'spec-89-y.md', content: '### Fase 1 — b `[in_progress]`\n### Fase 2 — c `[done]`\n' },
  ];
  const phases = findInProgressPhases(files);
  assert.equal(phases.length, 2);
  assert.equal(phases[0].specId, '80');
  assert.equal(phases[1].specId, '89');
});

test('findInProgressPhases: spec id with a letter suffix in the filename', () => {
  const files = [{ filename: 'spec-77a-x.md', content: '### Fase 1 — a `[in_progress]`\n' }];
  assert.equal(findInProgressPhases(files)[0].specId, '77a');
});

// ── extractSpecIdsFromBranches ───────────────────────────────────────────

test('extractSpecIdsFromBranches: extracts spec ids from a list of open PR branch names', () => {
  const ids = extractSpecIdsFromBranches(['feat/spec-80-fase-2-bloqueo-faltantes', 'docs/spec-89-cierre-fase-1']);
  assert.deepEqual([...ids].sort(), ['80', '89']);
});

test('extractSpecIdsFromBranches: a branch with no spec id contributes nothing', () => {
  const ids = extractSpecIdsFromBranches(['chore/bump-deps']);
  assert.deepEqual([...ids], []);
});

// ── computeStalePhases ───────────────────────────────────────────────────

test('computeStalePhases: a phase whose spec has no open PR is stale', () => {
  const phases = [{ specId: '80', faseText: 'Fase 2', file: 'spec-80-x.md' }];
  const stale = computeStalePhases(phases, new Set());
  assert.deepEqual(stale, phases);
});

test('computeStalePhases: a phase whose spec DOES have an open PR is not stale', () => {
  const phases = [{ specId: '80', faseText: 'Fase 2', file: 'spec-80-x.md' }];
  const stale = computeStalePhases(phases, new Set(['80']));
  assert.deepEqual(stale, []);
});

test('computeStalePhases: real acceptance shape — spec-89 fase 1 is in_progress, PR #691 already merged (no open PR left) — stale', () => {
  // Reproduce del caso real que motivó el spec: spec-89 fase 1 quedó
  // [in_progress] con su PR (#691) ya mergeado — cero PRs abiertos para
  // spec-89 hoy.
  const phases = [{ specId: '89', faseText: 'Fase 1 — check-phase-overlap', file: 'spec-89-x.md' }];
  const stale = computeStalePhases(phases, new Set(['91'])); // sólo spec-91 (este PR) sigue abierto
  assert.deepEqual(stale, phases);
});

// ── parseIssueBody / renderIssueBody ─────────────────────────────────────

test('renderIssueBody -> parseIssueBody round-trips firstSeen dates', () => {
  const entries = [
    { specId: '80', faseText: 'Fase 2 — algo', firstSeen: '2026-09-01' },
    { specId: '89', faseText: 'Fase 1 — otro', firstSeen: '2026-09-08' },
  ];
  const body = renderIssueBody(entries);
  const parsed = parseIssueBody(body);
  assert.deepEqual(parsed, entries);
});

test('parseIssueBody: empty/unrelated body parses to no entries', () => {
  assert.deepEqual(parseIssueBody('cualquier otra cosa'), []);
});

test('renderIssueBody: empty list still renders valid markdown (used only pre-close, not asserted elsewhere)', () => {
  const body = renderIssueBody([]);
  assert.equal(typeof body, 'string');
  assert.deepEqual(parseIssueBody(body), []);
});

// ── mergeStaleEntries ─────────────────────────────────────────────────────

test('mergeStaleEntries: a NEW stale phase gets firstSeen = today', () => {
  const staleNow = [{ specId: '80', faseText: 'Fase 2', file: 'spec-80-x.md' }];
  const merged = mergeStaleEntries(staleNow, [], '2026-09-08');
  assert.deepEqual(merged, [{ specId: '80', faseText: 'Fase 2', firstSeen: '2026-09-08' }]);
});

test('mergeStaleEntries: a phase already tracked KEEPS its original firstSeen, not today', () => {
  const staleNow = [{ specId: '80', faseText: 'Fase 2', file: 'spec-80-x.md' }];
  const previous = [{ specId: '80', faseText: 'Fase 2', firstSeen: '2026-09-01' }];
  const merged = mergeStaleEntries(staleNow, previous, '2026-09-08');
  assert.deepEqual(merged, [{ specId: '80', faseText: 'Fase 2', firstSeen: '2026-09-01' }]);
});

test('mergeStaleEntries: a previously-tracked phase that is no longer stale is DROPPED', () => {
  const staleNow = []; // se cerró el token, o apareció un PR abierto
  const previous = [{ specId: '80', faseText: 'Fase 2', firstSeen: '2026-09-01' }];
  const merged = mergeStaleEntries(staleNow, previous, '2026-09-08');
  assert.deepEqual(merged, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
