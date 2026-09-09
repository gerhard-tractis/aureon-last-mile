// Tests for check-phase-overlap-depends.mjs (spec-91 fase 3/4).
// Pure parsing, no git, no fs — run: node scripts/check-phase-overlap-depends.test.mjs
import assert from 'node:assert/strict';
import {
  extractDependsField,
  findPhaseTokenByNumber,
  scanUndeclaredReferences,
} from './check-phase-overlap-depends.mjs';

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

// ── extractDependsField ──────────────────────────────────────────────────

test('extractDependsField: field absent -> fieldPresent false, no entries', () => {
  const md = '### Fase 1 — algo `[pending]`\n\nSolo prosa.\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.equal(r.headingFound, true);
  assert.equal(r.fieldPresent, false);
  assert.equal(r.explicitNone, false);
  assert.equal(r.indeterminate, false);
  assert.deepEqual(r.entries, []);
});

test('extractDependsField: "ninguna" is explicit no-dependency, not absence', () => {
  const md = '### Fase 1 — algo `[pending]`\n\n**Depende de:** ninguna\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.equal(r.fieldPresent, true);
  assert.equal(r.explicitNone, true);
  assert.equal(r.indeterminate, false);
  assert.deepEqual(r.entries, []);
});

test('extractDependsField: "ninguna" is case-insensitive', () => {
  const md = '### Fase 1 — algo `[pending]`\n\n**Depende de:** Ninguna\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.equal(r.explicitNone, true);
});

test('extractDependsField: "(indeterminado — ...)" is its own state, not absence and not none', () => {
  const md =
    '### Fase 2 — algo `[pending]`\n\n**Depende de:** (indeterminado — no se pudo determinar todavía, ver nota)\n';
  const r = extractDependsField(md, 'Fase 2');
  assert.equal(r.fieldPresent, true);
  assert.equal(r.explicitNone, false);
  assert.equal(r.indeterminate, true);
  assert.deepEqual(r.entries, []);
});

test('extractDependsField: a single "spec-N fase M" entry', () => {
  const md = '### Fase 3 — algo `[pending]`\n\n**Depende de:** spec-80 fase 3\n';
  const r = extractDependsField(md, 'Fase 3');
  assert.equal(r.fieldPresent, true);
  assert.deepEqual(r.entries, [{ specId: '80', faseNum: '3' }]);
});

test('extractDependsField: multiple comma-separated entries', () => {
  const md =
    '### Fase 1 — algo `[pending]`\n\n**Depende de:** spec-80 fase 3, spec-81 fase 2\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.deepEqual(r.entries, [
    { specId: '80', faseNum: '3' },
    { specId: '81', faseNum: '2' },
  ]);
});

test('extractDependsField: tolerates backticks around the reference', () => {
  const md = '### Fase 1 — algo `[pending]`\n\n**Depende de:** `spec-80 fase 3`\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.deepEqual(r.entries, [{ specId: '80', faseNum: '3' }]);
});

test('extractDependsField: fase number with a letter suffix', () => {
  const md = '### Fase 1 — algo `[pending]`\n\n**Depende de:** spec-80 fase 1b\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.deepEqual(r.entries, [{ specId: '80', faseNum: '1b' }]);
});

test('extractDependsField: headingFound false for an unmatched fase', () => {
  const md = '### Fase 1 — algo `[pending]`\n';
  const r = extractDependsField(md, 'Fase 99');
  assert.equal(r.headingFound, false);
  assert.equal(r.fieldPresent, false);
});

test('extractDependsField: does not bleed into the next fase', () => {
  const md = [
    '### Fase 1 — a `[pending]`',
    '',
    '**Depende de:** ninguna',
    '',
    '### Fase 2 — b `[pending]`',
    '',
    '**Depende de:** spec-80 fase 3',
    '',
  ].join('\n');
  const r1 = extractDependsField(md, 'Fase 1');
  assert.equal(r1.explicitNone, true);
  const r2 = extractDependsField(md, 'Fase 2');
  assert.deepEqual(r2.entries, [{ specId: '80', faseNum: '3' }]);
});

test('extractDependsField: works with CRLF line endings', () => {
  const md = '### Fase 1 — algo `[pending]`\r\n\r\n**Depende de:** spec-80 fase 3\r\n';
  const r = extractDependsField(md, 'Fase 1');
  assert.deepEqual(r.entries, [{ specId: '80', faseNum: '3' }]);
});

// ── findPhaseTokenByNumber ────────────────────────────────────────────────

test('findPhaseTokenByNumber: finds the token of a matching "Fase N" heading', () => {
  const md = '### Fase 3 — `5f` firma y fotos `[pending]`\n';
  const r = findPhaseTokenByNumber(md, '3');
  assert.equal(r.found, true);
  assert.equal(r.token, 'pending');
});

test('findPhaseTokenByNumber: does not confuse fase 1 with fase 1b', () => {
  const md = '### Fase 1b — ACL heredado `[in_progress]`\n';
  const r = findPhaseTokenByNumber(md, '1');
  assert.equal(r.found, false);
});

test('findPhaseTokenByNumber: matches fase 1b exactly when asked for 1b', () => {
  const md = '### Fase 1b — ACL heredado `[in_progress]`\n';
  const r = findPhaseTokenByNumber(md, '1b');
  assert.equal(r.found, true);
  assert.equal(r.token, 'in_progress');
});

test('findPhaseTokenByNumber: not found when no heading matches', () => {
  const md = '### Fase 1 — algo `[done]`\n';
  const r = findPhaseTokenByNumber(md, '99');
  assert.equal(r.found, false);
});

// ── Bloqueante 1 (review ronda 2): un heading intermedio que MENCIONA
// "fase N" en prosa (no un heading de fase real, sin token) gana sobre el
// heading de fase real que aparece DESPUÉS — reproducido literalmente con
// spec-85-discrepancias.md: "### La costura entre esta fase y spec-80 fase 2"
// (línea 222, sin token) casa `fase 2` antes que "### Fase 2 — RPCs `[done]`"
// (línea 338, el heading real). spec-85 fase 2 es la dependencia más citada
// del corpus (spec-86 fases 1/2a/2b/3, spec-80 fases 1/1b, spec-88 fase 1) —
// este bug bloquearía el primer backfill de lleno.
test('findPhaseTokenByNumber: a prose heading mentioning "fase N" with no token does not win over the real phase heading', () => {
  const md = [
    '### La costura entre esta fase y spec-80 fase 2',
    '',
    'Prosa que menciona "fase 2" pero no es un heading de fase — no lleva token.',
    '',
    '### Fase 2 — RPCs `[done]`',
    '',
    '> Implementado por: ...',
  ].join('\n');
  const r = findPhaseTokenByNumber(md, '2');
  assert.equal(r.found, true);
  assert.equal(r.token, 'done');
});

test('findPhaseTokenByNumber: real acceptance case — spec-85 fase 2 resolves to [done], not the unrelated prose heading', () => {
  // Reproduce del texto real de docs/specs/spec-85-discrepancias.md, no una
  // versión simplificada: el heading de la línea 222 no lleva token en
  // absoluto (termina en prosa), y el heading real está más abajo.
  const md = [
    '### La costura entre esta fase y spec-80 fase 2',
    '',
    'Entre este merge y spec-80 fase 2, el frontend de Recogida sigue',
    'escribiendo en `discrepancy_notes`, no en `discrepancies`.',
    '',
    '### Fase 2 — RPCs `[done]`',
    '',
    '> Implementado por: `implementer` con TDD, tres rondas.',
  ].join('\n');
  const r = findPhaseTokenByNumber(md, '2');
  assert.equal(r.found, true);
  assert.equal(r.token, 'done');
});

test('findPhaseTokenByNumber: a heading matching "fase N" with NO valid token anywhere in the doc is unresolved, not [null]', () => {
  const md = [
    '### La costura entre esta fase y spec-80 fase 2',
    '',
    'Nunca hay un heading real de "Fase 2" en este documento.',
  ].join('\n');
  const r = findPhaseTokenByNumber(md, '2');
  assert.equal(r.found, false);
  assert.equal(r.token, null);
});

test('findPhaseTokenByNumber: real acceptance case — spec-80 fase 3 is [pending] in the real repo file', () => {
  // Not a fixture: reads the actual spec-80 heading text inline, so this
  // test breaks (loudly) the day someone closes that phase without
  // updating this fixture — which is the point, it's the same text a
  // dependent phase is trusting.
  const md = '### Fase 3 — `5f` firma y fotos `[pending]`\n';
  const r = findPhaseTokenByNumber(md, '3');
  assert.equal(r.token, 'pending');
});

// ── scanUndeclaredReferences ─────────────────────────────────────────────

test('scanUndeclaredReferences: finds a "spec-N fase M" mention not in Depende de', () => {
  const md = [
    '### Fase 3 — algo `[pending]`',
    '',
    '**Depende de:** ninguna',
    '',
    'Esto en realidad depende de que aterrice spec-80 fase 3 primero.',
    '',
  ].join('\n');
  const refs = scanUndeclaredReferences(md, 'Fase 3', '84');
  assert.deepEqual(refs, [{ specId: '80', faseNum: '3' }]);
});

test('scanUndeclaredReferences: a declared reference is not reported again', () => {
  const md = [
    '### Fase 3 — algo `[pending]`',
    '',
    '**Depende de:** spec-80 fase 3',
    '',
    'Depende de que aterrice spec-80 fase 3.',
    '',
  ].join('\n');
  const refs = scanUndeclaredReferences(md, 'Fase 3', '84');
  assert.deepEqual(refs, []);
});

test('scanUndeclaredReferences: excludes a self-reference (own spec + own fase)', () => {
  const md = [
    '### Fase 1 — algo `[done]`',
    '',
    '> Implementado por: rama feat/spec-84-fase-1-x, SHA abc123',
    '',
  ].join('\n');
  const refs = scanUndeclaredReferences(md, 'Fase 1', '84');
  assert.deepEqual(refs, []);
});

test('scanUndeclaredReferences: does NOT exclude a reference to a DIFFERENT fase of the SAME spec', () => {
  const md = [
    '### Fase 3 — algo `[pending]`',
    '',
    'Ver también spec-84 fase 1, ya resuelta.',
    '',
  ].join('\n');
  const refs = scanUndeclaredReferences(md, 'Fase 3', '84');
  assert.deepEqual(refs, [{ specId: '84', faseNum: '1' }]);
});

test('scanUndeclaredReferences: tolerates the real corpus punctuation variants', () => {
  const cases = [
    'spec-80` fase 3',
    'spec-85): fase 2',
    'spec-79, Fase 4i',
    'spec-87-fase1', // no separator, no space
  ];
  for (const c of cases) {
    const md = `### Fase 9 — algo \`[pending]\`\n\n${c}\n`;
    const refs = scanUndeclaredReferences(md, 'Fase 9', '999');
    assert.ok(refs.length >= 1, `expected a match for: ${c}`);
  }
});

test('scanUndeclaredReferences: real acceptance case — spec-84 fase 3 prose names spec-80 fase 3', () => {
  const md = [
    '### Fase 3 — Prueba de entrega multi-archivo `[pending]`',
    '',
    '> queda es orden: depende de que aterrice spec-80 fase 3',
    '> (`manifest_documents`, `[pending]`), no de una persona.',
    '',
  ].join('\n');
  const refs = scanUndeclaredReferences(md, 'Fase 3', '84');
  assert.deepEqual(refs, [{ specId: '80', faseNum: '3' }]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
