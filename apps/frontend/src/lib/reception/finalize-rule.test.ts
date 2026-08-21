import { describe, it, expect } from 'vitest';
import { finalizeRule, serverRequiresNote } from './finalize-rule';

describe('finalizeRule', () => {
  it('no pide nota cuando todo lo esperado llegó y nada ajeno entró', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 10, unexpectedCount: 0 });
    expect(r).toEqual({ matched: 10, missing: 0, needsNote: false });
  });

  it('pide nota cuando faltan paquetes', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 8, unexpectedCount: 0 });
    expect(r).toEqual({ matched: 8, missing: 2, needsNote: true });
  });

  // The case the raw count hides: it checks out in total, but one expected
  // package never arrived and one from another truck did. This is exactly
  // what the discrepancy report exists to catch.
  it('pide nota cuando las cifras se compensan entre sí', () => {
    const r = finalizeRule({ expectedCount: 10, receivedCount: 10, unexpectedCount: 1 });
    expect(r.matched).toBe(9);
    expect(r.missing).toBe(1);
    expect(r.needsNote).toBe(true);
  });

  it('nunca reporta faltantes negativos', () => {
    const r = finalizeRule({ expectedCount: 5, receivedCount: 9, unexpectedCount: 0 });
    expect(r.missing).toBe(0);
    expect(r.needsNote).toBe(true);
  });
});

describe('la relación con el guard del servidor', () => {
  // Parity is NOT what's under test here: complete_route_reception keeps the
  // spec-47 guard (received < expected) and the matched/unexpected rule was
  // deferred to spec-56 — see decision 5 of the spec and PART 3 of
  // 20260812000006_spec52_unexpected_count.sql. What must always hold is
  // INCLUSION: wherever the server requires a note, the UI does too. If this
  // breaks, the reception can never close: the server raises the exception
  // and the UI never opened the sheet to write the note.
  it('exige nota en todos los casos en que el servidor la exigiría', () => {
    for (let expectedCount = 0; expectedCount <= 6; expectedCount++) {
      for (let receivedCount = 0; receivedCount <= 6; receivedCount++) {
        for (let unexpectedCount = 0; unexpectedCount <= receivedCount; unexpectedCount++) {
          const counts = { expectedCount, receivedCount, unexpectedCount };
          if (serverRequiresNote(counts)) {
            expect(finalizeRule(counts).needsNote).toBe(true);
          }
        }
      }
    }
  });
});
