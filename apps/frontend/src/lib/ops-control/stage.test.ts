import { describe, it, expect } from 'vitest';
import { deriveOrderStage, deriveRouteStage } from './stage';

/**
 * A package as it arrives inside get_ops_control_snapshot's orders[] rows.
 */
function pkg(status: string) {
  return { id: `pkg-${status}`, label: 'LBL', status };
}

describe('deriveOrderStage', () => {
  it('stages an order in docks (Andenes) when its packages are sectorizado', () => {
    // A dock scan into a normal zone sets packages.status = 'sectorizado'
    // while the order rolls up to en_bodega (positions 4/5 are package-only).
    const order = { status: 'en_bodega', packages: [pkg('sectorizado'), pkg('sectorizado')] };

    expect(deriveOrderStage(order)).toBe('docks');
  });

  it('stages an order in consolidation when its packages are retenido', () => {
    // A dock scan into a zone with is_consolidation = true sets 'retenido'.
    const order = { status: 'en_bodega', packages: [pkg('retenido')] };

    expect(deriveOrderStage(order)).toBe('consolidation');
  });

  it('keeps an order in reception while any package is still en_bodega', () => {
    // MIN pipeline position wins, matching recalculate_order_status's roll-up.
    const order = { status: 'en_bodega', packages: [pkg('en_bodega'), pkg('sectorizado')] };

    expect(deriveOrderStage(order)).toBe('reception');
  });

  it('uses the lowest position when packages are split across andén and consolidación', () => {
    const order = { status: 'en_bodega', packages: [pkg('retenido'), pkg('sectorizado')] };

    expect(deriveOrderStage(order)).toBe('docks');
  });

  it('ignores terminal packages when deriving the stage', () => {
    const order = {
      status: 'en_bodega',
      packages: [pkg('cancelado'), pkg('retorno_hub'), pkg('sectorizado')],
    };

    expect(deriveOrderStage(order)).toBe('docks');
  });

  it('falls back to the order status when the order carries no packages', () => {
    expect(deriveOrderStage({ status: 'en_bodega' })).toBe('reception');
    expect(deriveOrderStage({ status: 'en_bodega', packages: [] })).toBe('reception');
  });

  it('falls back to the order status when no package sits in a dock position', () => {
    expect(deriveOrderStage({ status: 'asignado', packages: [pkg('asignado')] })).toBe('docks');
    expect(deriveOrderStage({ status: 'en_ruta', packages: [pkg('en_ruta')] })).toBe('delivery');
    expect(deriveOrderStage({ status: 'verificado', packages: [pkg('verificado')] })).toBeNull();
  });
});

describe('deriveRouteStage', () => {
  it('maps route statuses to stages', () => {
    expect(deriveRouteStage('draft')).toBe('docks');
    expect(deriveRouteStage('planned')).toBe('docks');
    expect(deriveRouteStage('in_progress')).toBe('delivery');
    expect(deriveRouteStage('completed')).toBeNull();
  });
});
