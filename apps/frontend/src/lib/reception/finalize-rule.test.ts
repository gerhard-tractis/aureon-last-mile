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

  // El caso que el conteo crudo esconde: cuadra en total, pero un paquete
  // esperado no llegó y uno de otro camión sí. Es exactamente para lo que
  // existe el reporte de discrepancia.
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
  // NO se testea paridad: complete_route_reception conserva el guard de
  // spec-47 (received < expected) y la regla matched/unexpected quedó
  // diferida a spec-56 — ver decisión 5 del spec y la PART 3 de
  // 20260812000006_spec52_unexpected_count.sql. Lo que sí debe cumplirse
  // siempre es la INCLUSIÓN: donde el servidor exige nota, la UI también.
  // Si esto se rompe, la recepción queda sin poder cerrarse: el servidor
  // levanta la excepción y la UI nunca abrió la hoja para escribir la nota.
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
