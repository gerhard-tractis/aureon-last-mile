import { describe, it, expect } from 'vitest';
import { missingOrders, closeButtonLabel, paginateMissing, buildForceSealNote } from './route-close';
import type { RoutePackage } from '@/lib/dispatch/types';
import type { MissingOrder } from './route-close';

function pkg(overrides: Partial<RoutePackage>): RoutePackage {
  return {
    dispatch_id: 'd1',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Juan',
    contact_address: 'Calle 1',
    contact_phone: null,
    status: 'pending',
    stage: 'staged',
    boxesTotal: 2,
    boxesLoaded: 2,
    ...overrides,
  };
}

describe('missingOrders', () => {
  it('excludes orders where every box already loaded', () => {
    const result = missingOrders([pkg({ order_id: 'o1', boxesTotal: 2, boxesLoaded: 2 })]);
    expect(result).toEqual([]);
  });

  it('includes an order with any unloaded box, with the missing count', () => {
    const result = missingOrders([
      pkg({ order_id: 'o1', order_number: 'ORD-1', boxesTotal: 3, boxesLoaded: 1 }),
    ]);
    expect(result).toEqual([
      { orderId: 'o1', orderNumber: 'ORD-1', contactName: 'Juan', missingCount: 2 },
    ]);
  });

  it('sums the total missing count across several orders (item 3/8)', () => {
    const result = missingOrders([
      pkg({ order_id: 'o1', boxesTotal: 3, boxesLoaded: 1 }),
      pkg({ order_id: 'o2', boxesTotal: 1, boxesLoaded: 0 }),
      pkg({ order_id: 'o3', boxesTotal: 4, boxesLoaded: 4 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.reduce((sum, r) => sum + r.missingCount, 0)).toBe(3);
  });
});

describe('closeButtonLabel', () => {
  it('names the exact figure — item 5', () => {
    expect(closeButtonLabel(24)).toBe('Cerrar con 24 sin cargar');
  });

  it('plain "Cerrar ruta" with nothing missing', () => {
    expect(closeButtonLabel(0)).toBe('Cerrar ruta');
  });
});

describe('paginateMissing', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({
    orderId: `o${i}`,
    orderNumber: `ORD-${i}`,
    contactName: null,
    missingCount: 1,
  }));

  it('shows only the first N and reports the remaining count — item 6', () => {
    const { visible, remaining } = paginateMissing(rows, 4);
    expect(visible).toHaveLength(4);
    expect(remaining).toBe(20);
  });

  it('remaining is 0 once everything is visible', () => {
    const { visible, remaining } = paginateMissing(rows, 24);
    expect(visible).toHaveLength(24);
    expect(remaining).toBe(0);
  });

  it('never shows more than the list has', () => {
    const { visible, remaining } = paginateMissing(rows.slice(0, 2), 4);
    expect(visible).toHaveLength(2);
    expect(remaining).toBe(0);
  });
});

// decision 4 — nota por fila (item 7). The endpoint only carries ONE `note`
// string per force call (`force-seal-reasons.ts`/`resolvePendingStops`
// never per-package) — there is no per-order note column and this UI
// phase carries no migration (spec's own no-goals). Per-row notes are
// folded into that single string, tagged by order number, so they still
// reach `audit_logs.changes_json.note` — "persisted", just not as a
// separate per-package fact. Risk 4 in the spec stays open for whoever
// eventually gives notes a real per-package home.
describe('buildForceSealNote', () => {
  const orders: MissingOrder[] = [
    { orderId: 'o1', orderNumber: 'ORD-1', contactName: null, missingCount: 1 },
    { orderId: 'o2', orderNumber: 'ORD-2', contactName: null, missingCount: 2 },
  ];

  it('is undefined when nothing was typed and the reason does not require one', () => {
    expect(buildForceSealNote('turno_terminado', '', new Map(), orders)).toBeUndefined();
  });

  it('an absent note never blocks — item 7 (unless reason is "otro")', () => {
    expect(buildForceSealNote('paquete_no_ubicado', '', new Map(), orders)).toBeUndefined();
  });

  it('combines the global note first, then one line per row note', () => {
    const rowNotes = new Map([['o2', 'Encontrado dañado bajo el pallet']]);
    const result = buildForceSealNote('vehiculo_lleno', 'Salió lleno a las 22:00', rowNotes, orders);
    expect(result).toBe('Salió lleno a las 22:00\nORD-2: Encontrado dañado bajo el pallet');
  });

  it('row notes alone, no global note', () => {
    const rowNotes = new Map([['o1', 'No estaba en el andén A3']]);
    const result = buildForceSealNote('paquete_no_ubicado', '', rowNotes, orders);
    expect(result).toBe('ORD-1: No estaba en el andén A3');
  });

  it('blank row notes are ignored, not persisted as empty lines', () => {
    const rowNotes = new Map([['o1', '   ']]);
    expect(buildForceSealNote('paquete_no_ubicado', '', rowNotes, orders)).toBeUndefined();
  });
});
