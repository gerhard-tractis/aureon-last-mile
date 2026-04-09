import { describe, it, expect } from 'vitest';
import { STAGE_LABELS, STAGE_KEYS, REASON_LABELS, STATUS_LABELS } from './labels.es';

describe('labels.es', () => {
  it('exposes the 7 stages in order', () => {
    expect(STAGE_KEYS).toEqual([
      'pickup','reception','consolidation','docks','delivery','returns','reverse',
    ]);
  });
  it('returns Spanish labels for all stages', () => {
    expect(STAGE_LABELS.pickup).toBe('Recogida');
    expect(STAGE_LABELS.reception).toBe('Recepción');
    expect(STAGE_LABELS.consolidation).toBe('Consolidación');
    expect(STAGE_LABELS.docks).toBe('Andenes');
    expect(STAGE_LABELS.delivery).toBe('Reparto');
    expect(STAGE_LABELS.returns).toBe('Devoluciones');
    expect(STAGE_LABELS.reverse).toBe('Logística Inversa');
  });
  it('exposes reason flags in Spanish', () => {
    expect(REASON_LABELS.no_driver).toBe('Sin conductor');
    expect(REASON_LABELS.stuck_at_reception).toBe('Atascado en recepción');
    expect(REASON_LABELS.inactive_route).toBe('Ruta inactiva');
    expect(REASON_LABELS.unassigned).toBe('Sin asignar');
    expect(REASON_LABELS.pending_return).toBe('Devolución pendiente');
    expect(REASON_LABELS.sla_no_config).toBe('SLA no configurado');
  });
  it('exposes status labels', () => {
    expect(STATUS_LABELS.late).toBe('Atrasado');
    expect(STATUS_LABELS.at_risk).toBe('En riesgo');
    expect(STATUS_LABELS.ok).toBe('En tiempo');
    expect(STATUS_LABELS.none).toBe('—');
  });
});
