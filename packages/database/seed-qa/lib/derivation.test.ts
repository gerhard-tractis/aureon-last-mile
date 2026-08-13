import { describe, it, expect } from 'vitest';
import {
  deriveOrderStatus,
  pipelinePosition,
  combinationsOfSize,
  targetedTripleCombinations,
  PACKAGE_STATUSES,
} from './derivation';

describe('pipelinePosition', () => {
  it('places the active pipeline in order', () => {
    const active = [
      'ingresado', 'verificado', 'en_bodega', 'sectorizado', 'retenido',
      'asignado', 'en_carga', 'listo_para_despacho', 'en_ruta', 'entregado',
    ];
    const positions = active.map(pipelinePosition);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // The regression: this returned 0 for five months, so orders staged for
  // dispatch counted as having no live packages and were cancelled.
  it('gives listo_para_despacho a live position, and listo none', () => {
    expect(pipelinePosition('listo_para_despacho')).toBe(8);
    expect(pipelinePosition('listo')).toBe(0);
  });

  it.each(['retorno_hub', 'cancelado', 'devuelto', 'dañado', 'extraviado'])(
    'treats %s as terminal',
    (status) => expect(pipelinePosition(status)).toBe(0),
  );
});

describe('deriveOrderStatus', () => {
  it('returns null for an order with no packages', () => {
    expect(deriveOrderStatus([])).toBeNull();
  });

  // Rule 1 & 2 — a return short-circuits everything.
  it('reports parcialmente_entregado when a return sits beside a delivery', () => {
    expect(deriveOrderStatus(['retorno_hub', 'entregado'])).toEqual({
      status: 'parcialmente_entregado',
      leadingStatus: 'parcialmente_entregado',
    });
  });

  it('reports en_retorno when returns exist without deliveries', () => {
    expect(deriveOrderStatus(['retorno_hub', 'en_ruta'])).toEqual({
      status: 'en_retorno',
      leadingStatus: 'en_retorno',
    });
  });

  // Rule 3
  it('cancels when nothing is live and nothing was delivered', () => {
    expect(deriveOrderStatus(['cancelado', 'dañado'])).toEqual({
      status: 'cancelado',
      leadingStatus: 'cancelado',
    });
  });

  it('does NOT cancel when a delivery exists among terminals', () => {
    expect(deriveOrderStatus(['entregado', 'cancelado'])).toEqual({
      status: 'entregado',
      leadingStatus: 'entregado',
    });
  });

  // Rule 4
  it('uses min for status and max for leading_status', () => {
    expect(deriveOrderStatus(['en_bodega', 'en_ruta'])).toEqual({
      status: 'en_bodega',
      leadingStatus: 'en_ruta',
    });
  });

  it('collapses sectorizado and retenido to en_bodega', () => {
    expect(deriveOrderStatus(['sectorizado', 'retenido'])).toEqual({
      status: 'en_bodega',
      leadingStatus: 'en_bodega',
    });
  });

  it('ignores terminal packages when computing min and max', () => {
    expect(deriveOrderStatus(['cancelado', 'en_carga'])).toEqual({
      status: 'en_carga',
      leadingStatus: 'en_carga',
    });
  });

  it('keeps an order staged for dispatch out of cancelado', () => {
    expect(deriveOrderStatus(['listo_para_despacho', 'listo_para_despacho'])).toEqual({
      status: 'listo_para_despacho',
      leadingStatus: 'listo_para_despacho',
    });
  });

  it('never returns an empty status for any single package', () => {
    for (const status of PACKAGE_STATUSES) {
      const derived = deriveOrderStatus([status]);
      expect(derived, `single ${status}`).not.toBeNull();
      expect(derived!.status, `single ${status}`).not.toBe('');
    }
  });

  it('never returns an empty status across every two-package combination', () => {
    for (const combo of combinationsOfSize(2)) {
      const derived = deriveOrderStatus(combo);
      expect(derived, combo.join('+')).not.toBeNull();
      expect(derived!.status, combo.join('+')).not.toBe('');
      expect(derived!.leadingStatus, combo.join('+')).not.toBe('');
    }
  });

  it('is order-insensitive', () => {
    expect(deriveOrderStatus(['en_ruta', 'ingresado'])).toEqual(
      deriveOrderStatus(['ingresado', 'en_ruta']),
    );
  });
});

describe('combinationsOfSize', () => {
  it('produces one entry per package status at size 1', () => {
    expect(combinationsOfSize(1)).toHaveLength(15);
  });

  // Multisets, not permutations: C(15+2-1, 2) = 120, not 225.
  it('produces 120 order-insensitive pairs at size 2', () => {
    expect(combinationsOfSize(2)).toHaveLength(120);
  });

  it('never emits the same multiset twice', () => {
    const keys = combinationsOfSize(2).map((c) => [...c].sort().join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns nothing for a non-positive size', () => {
    expect(combinationsOfSize(0)).toEqual([]);
  });
});

describe('targetedTripleCombinations', () => {
  it('covers the mixed return-plus-delivery-plus-live case', () => {
    const keys = targetedTripleCombinations().map((c) => [...c].sort().join('|'));
    expect(keys).toContain(['retorno_hub', 'entregado', 'en_ruta'].sort().join('|'));
  });

  it('derives a status for every triple it emits', () => {
    for (const combo of targetedTripleCombinations()) {
      expect(deriveOrderStatus(combo), combo.join('+')).not.toBeNull();
    }
  });
});
