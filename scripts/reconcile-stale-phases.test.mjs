// Tests for reconcile-stale-phases.mjs's orchestration (spec-91 fase 5).
// Injects fake I/O — no real `gh`, no real fs, no real network. See the
// module's own header comment for why a faked `gh` binary on PATH was
// rejected for this script (it needs to pass ARBITRARY text — issue
// bodies — as an argument, unlike the fase-1 hook's single validated
// numeric PR id; faking that safely hit the same `.cmd`/EINVAL wall
// documented in post-merge-remind.mjs, for no benefit over DI here).
//
// Run: node scripts/reconcile-stale-phases.test.mjs
import assert from 'node:assert/strict';
import { runReconciliation } from './reconcile-stale-phases.mjs';

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
    console.log(`       ${e.stack || e.message}`);
  }
}

function fakeDeps(overrides = {}) {
  const calls = { createIssue: [], updateIssue: [], reopenIssue: [], closeIssue: [] };
  const deps = {
    specFiles: [],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => null,
    createIssue: (body) => {
      calls.createIssue.push(body);
      return 999;
    },
    updateIssue: (number, body) => calls.updateIssue.push({ number, body }),
    reopenIssue: (number) => calls.reopenIssue.push(number),
    closeIssue: (number) => calls.closeIssue.push(number),
    today: '2026-09-08',
    log: () => {},
    ...overrides,
  };
  return { deps, calls };
}

// ── No stale phases at all: never touches the issue API ───────────────────

test('no in_progress phases, no existing issue: does nothing', () => {
  const { deps, calls } = fakeDeps();
  const result = runReconciliation(deps);
  assert.equal(result.action, 'none');
  assert.equal(calls.createIssue.length, 0);
});

// ── A genuinely stale phase (in_progress, no open PR): creates the issue ──

test('a stale phase with no existing issue: creates one', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'created');
  assert.equal(result.staleCount, 1);
  assert.equal(calls.createIssue.length, 1);
  assert.match(calls.createIssue[0], /spec-89/);
});

// ── Real acceptance shape: spec-89 fase 1 stayed [in_progress] with its PR
// (#691) already merged — no open PR for spec-89 today, spec-91's own PR
// stays open. Must be reported.
test('real acceptance shape: spec-89 fase 1 in_progress + PR #691 merged (no open PR left) -> stale, reported', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [
      { filename: 'spec-89-guardarrail-de-paralelismo.md', content: '### Fase 1 — check-phase-overlap `[in_progress]`\n' },
      { filename: 'spec-91-cerrar-huecos-harness-orquestacion.md', content: '### Fase 1 — hook `[in_progress]`\n' },
    ],
    listOpenPrBranches: () => ['feat/spec-91-harness-cierre-y-dependencias'], // spec-91 sigue abierto; spec-89 no
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'created');
  assert.equal(result.staleCount, 1);
  assert.match(calls.createIssue[0], /spec-89/);
  // El boilerplate del cuerpo menciona "spec-91" (este mismo spec) en la
  // explicación — comprobar que NO hay una FILA de tabla para spec-91, no
  // que el texto no lo mencione en absoluto.
  assert.doesNotMatch(calls.createIssue[0], /\| spec-91 \|/);
});

// ── A phase backed by an open PR: not stale, nothing created ───────────────

test('an in_progress phase WITH an open PR naming its spec: not stale, does nothing', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-80-x.md', content: '### Fase 2 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => ['feat/spec-80-fase-2-bloqueo-faltantes'],
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'none');
  assert.equal(calls.createIssue.length, 0);
});

// ── Existing OPEN issue, still stale: updates, preserves firstSeen ────────

test('existing open issue, still stale: updates the body, preserves the original firstSeen date', () => {
  const existingBody = ['| Spec | Fase | Detectado por primera vez |', '|---|---|---|', '| spec-89 | Fase 1 — check-phase-overlap | 2026-09-01 |'].join(
    '\n',
  );
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — check-phase-overlap `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ number: 42, body: existingBody, state: 'OPEN' }),
    today: '2026-09-08', // ocho días después
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'updated');
  assert.equal(calls.updateIssue.length, 1);
  assert.equal(calls.updateIssue[0].number, 42);
  assert.match(calls.updateIssue[0].body, /2026-09-01/); // NO "2026-09-08" — la fecha original se conserva
  assert.equal(calls.reopenIssue.length, 0); // ya estaba abierto, no hace falta reabrir
});

// ── Existing issue, no longer stale: closes it ─────────────────────────────

test('existing open issue, no longer stale (phase closed or PR opened): closes it', () => {
  const existingBody = ['| Spec | Fase | Detectado por primera vez |', '|---|---|---|', '| spec-89 | Fase 1 — check-phase-overlap | 2026-09-01 |'].join(
    '\n',
  );
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — check-phase-overlap `[done]`\n' }], // se cerró
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ number: 42, body: existingBody, state: 'OPEN' }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'closed');
  assert.equal(calls.closeIssue.length, 1);
  assert.equal(calls.closeIssue[0], 42);
  assert.equal(calls.updateIssue.length, 0);
});

// ── Already-closed issue, no longer stale: does nothing (no double-close) ──

test('existing CLOSED issue, still nothing stale: no-op, does not re-close', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [],
    findTrackingIssue: () => ({ number: 42, body: '', state: 'CLOSED' }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'none');
  assert.equal(calls.closeIssue.length, 0);
});

// ── Already-closed issue, a NEW stale phase appears: reopens it ───────────

test('existing CLOSED issue, a new stale phase appears: updates AND reopens', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ number: 42, body: '', state: 'CLOSED' }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'updated');
  assert.equal(calls.updateIssue.length, 1);
  assert.equal(calls.reopenIssue.length, 1);
  assert.equal(calls.reopenIssue[0], 42);
});

// ── F5-1 (review ronda 3, BLOQUEANTE): un blip de la API de gh no debe
// crear un issue duplicado. `findTrackingIssue` que no puede determinar si
// ya existe un issue (fallo de red/parseo) DEBE ser distinguible de "no hay
// issue" — `null` es indistinguible de "no existe" para `runReconciliation`,
// y ese blip inyectado con el issue #42 ya abierto reprodujo exactamente el
// bug reportado: creaba un segundo issue en vez de abortar. Mismo tratamiento
// que `listOpenPrBranches` ya tenía: fail open, abortar sin tocar nada.
test('F5-1: findTrackingIssue reporting an error aborts WITHOUT creating a duplicate issue', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ error: true }), // #42 ya existe, pero gh falló al buscarlo
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'error');
  assert.equal(calls.createIssue.length, 0);
  assert.equal(calls.updateIssue.length, 0);
  assert.equal(calls.closeIssue.length, 0);
});

test('F5-1: findTrackingIssue error aborts even when there is nothing stale (would have been a no-op anyway)', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [],
    findTrackingIssue: () => ({ error: true }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'error');
  assert.equal(calls.closeIssue.length, 0);
});

// ── F5-2 (seguimiento, ronda 3): el label `wontfix` es una escotilla que el
// script respeta — cerrar el issue a mano no sirve (la corrida siguiente lo
// reabre si sigue rancio), pero un label sí, porque el script lo lee antes
// de decidir nada.
test('F5-2: an issue labeled "wontfix" is left untouched, even with stale phases pending', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ number: 42, body: '', state: 'CLOSED', labels: ['wontfix'] }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'skipped-wontfix');
  assert.equal(calls.updateIssue.length, 0);
  assert.equal(calls.reopenIssue.length, 0);
  assert.equal(calls.closeIssue.length, 0);
  assert.equal(calls.createIssue.length, 0);
});

test('F5-2: an issue WITHOUT "wontfix" behaves normally (labels array present, doesn\'t include it)', () => {
  const { deps, calls } = fakeDeps({
    specFiles: [{ filename: 'spec-89-x.md', content: '### Fase 1 — algo `[in_progress]`\n' }],
    listOpenPrBranches: () => [],
    findTrackingIssue: () => ({ number: 42, body: '', state: 'CLOSED', labels: ['stale-phase-reconciliation'] }),
  });
  const result = runReconciliation(deps);
  assert.equal(result.action, 'updated');
  assert.equal(calls.reopenIssue.length, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
