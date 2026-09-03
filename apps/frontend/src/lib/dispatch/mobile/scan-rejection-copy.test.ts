import { describe, it, expect } from 'vitest';
import { rejectionCopy, ALL_REJECTION_CODES } from './scan-rejection-copy';

describe('rejectionCopy', () => {
  it('spec-76 decision 5 — ALREADY_IN_ROUTE names the conflicting route when known', () => {
    const copy = rejectionCopy({ code: 'ALREADY_IN_ROUTE', message: 'Paquete ya asignado a otra ruta activa', conflictingRouteCode: 'RUT-0087' });
    expect(copy.title).toContain('RUT-0087');
    expect(copy.tallyLabel).toBe('YA EN OTRA RUTA');
    expect(copy.historyLabel).toBe('YA EN RUT-0087');
    expect(copy.canViewConflictingRoute).toBe(true);
  });

  it('ALREADY_IN_ROUTE without a resolvable route code still names the reason honestly, without inventing a code', () => {
    const copy = rejectionCopy({ code: 'ALREADY_IN_ROUTE', message: 'Paquete ya asignado a otra ruta activa', conflictingRouteCode: null });
    expect(copy.title).toBe('Ya está en otra ruta');
    expect(copy.canViewConflictingRoute).toBe(false);
  });

  it('IN_CONSOLIDATION — retenido en consolidación', () => {
    const copy = rejectionCopy({ code: 'IN_CONSOLIDATION', message: 'Paquete en andén de consolidación: reasígnalo a un andén de reparto antes de cargarlo' });
    expect(copy.title).toBe('Retenido en consolidación');
    expect(copy.tallyLabel).toBe('RETENIDO EN CONSOLIDACIÓN');
  });

  it('NOT_FOUND — never implies the code exists for another operator', () => {
    const copy = rejectionCopy({ code: 'NOT_FOUND', message: 'Código no encontrado' });
    expect(copy.title).toBe('Código no encontrado en este operador');
    expect(copy.title).not.toMatch(/otro operador/i);
  });

  it('WRONG_STATUS carries the server message verbatim rather than a fabricated en_bodega reason', () => {
    // spec-76 review — DISPATCHABLE_STATUSES (scan-validator.ts) already
    // includes 'en_bodega' (migration 20260817000003's Pre-Ruta fix), so
    // the validator never actually rejects that status; anden-status.ts's
    // own I4 comment documents the same gap against decision 5. Faking an
    // EN_BODEGA-specific rejection copy here would be a proxy shown under
    // a label asserting a fact (Lecciones aplicadas, "proxy" rule)  —  so
    // this renders the server's real WRONG_STATUS message instead.
    const copy = rejectionCopy({ code: 'WRONG_STATUS', message: 'Paquete en estado incorrecto (estado: entregado)' });
    expect(copy.title).toBe('Paquete en estado incorrecto (estado: entregado)');
    expect(copy.tallyLabel).toBe('ESTADO NO VÁLIDO');
  });

  it('ALREADY_STAGED — ya cargado en esta ruta', () => {
    const copy = rejectionCopy({ code: 'ALREADY_STAGED', message: 'Paquete ya cargado en esta ruta' });
    expect(copy.title).toBe('Paquete ya cargado en esta ruta');
    expect(copy.tallyLabel).toBe('YA CARGADO');
  });

  it('QUERY_FAILED — surfaces a failure, never a fabricated NOT_FOUND', () => {
    const copy = rejectionCopy({ code: 'QUERY_FAILED', message: 'No se pudo validar el código: timeout' });
    expect(copy.title).toBe('No se pudo validar el código: timeout');
    expect(copy.tallyLabel).toBe('FALLO DE RED');
  });

  it('every code the validator can produce has copy — no silent fallback to a blank card', () => {
    for (const code of ALL_REJECTION_CODES) {
      const copy = rejectionCopy({ code, message: 'algo' });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.tallyLabel.length).toBeGreaterThan(0);
    }
  });
});
