import { describe, it, expect } from 'vitest';
import { missingOrders, closeButtonLabel, paginateMissing, buildForceSealNote, missingBoxesLine, loadedBoxesLine } from './route-close';
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
  it('excludes an order that is fully staged, nothing pending server-side', () => {
    const result = missingOrders([pkg({ order_id: 'o1', stage: 'staged', boxesTotal: 2, boxesLoaded: 2 })]);
    expect(result).toEqual([]);
  });

  it('includes a planned order with the box shortfall as its missing count', () => {
    const result = missingOrders([
      pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'planned', boxesTotal: 3, boxesLoaded: 1 }),
    ]);
    expect(result).toEqual([
      { orderId: 'o1', orderNumber: 'ORD-1', contactName: 'Juan', missingCount: 2 },
    ]);
  });

  it('sums the total missing count across several pending orders (item 3/8)', () => {
    const result = missingOrders([
      pkg({ order_id: 'o1', stage: 'planned', boxesTotal: 3, boxesLoaded: 1 }),
      pkg({ order_id: 'o2', stage: 'partially_staged', boxesTotal: 1, boxesLoaded: 0 }),
      pkg({ order_id: 'o3', stage: 'staged', boxesTotal: 4, boxesLoaded: 4 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.reduce((sum, r) => sum + r.missingCount, 0)).toBe(3);
  });

  // B3 (adversarial review) — the screen must agree with the server's own
  // pending definition (`route_stop_counts.pending_stops +
  // partially_staged_stops`, i.e. `dispatches.stage IN ('planned',
  // 'partially_staged')`), not a box-count comparison that drifts from it
  // in both directions.
  it('flags a partially_staged order even when its OWN counted boxes look complete (en_bodega sibling)', () => {
    // The order's second bulto sits at en_bodega — not in
    // DISPATCHABLE_STATUSES, so useRoutePackages never counts it into
    // boxesTotal at all; boxesLoaded/boxesTotal alone say "1 of 1", but the
    // server's recompute_dispatch_stage (a wider status set) still holds
    // this dispatch at partially_staged. The screen must not offer a
    // direct, unforced close here — the server would refuse it.
    const result = missingOrders([
      pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'partially_staged', boxesTotal: 1, boxesLoaded: 1 }),
    ]);
    expect(result).toEqual([
      { orderId: 'o1', orderNumber: 'ORD-1', contactName: 'Juan', missingCount: 1 },
    ]);
  });

  it('never counts an adopted or force_split row as missing, even with a phantom-floored box count', () => {
    // useRoutePackages floors boxesTotal to 1 whenever stage !== 'staged'
    // and it found no live countable package (adopted/force_split rows with
    // every package already resolved land exactly here) — that floor is not
    // this module's to fix, but this module must not let an `adopted`/
    // `force_split` stage reach the "missing" list at all: the server's
    // pending definition never includes either.
    const result = missingOrders([
      pkg({ order_id: 'o1', stage: 'adopted', boxesTotal: 1, boxesLoaded: 0 }),
      pkg({ order_id: 'o2', stage: 'force_split', boxesTotal: 1, boxesLoaded: 0 }),
    ]);
    expect(result).toEqual([]);
  });

  it('floors the missing count at 1 for a pending stage whose box arithmetic says zero', () => {
    // Mirrors the en_bodega-sibling case above but with the count itself:
    // if the stage says pending, "0 sin cargar" would be a lie.
    const result = missingOrders([
      pkg({ order_id: 'o1', order_number: 'ORD-1', stage: 'partially_staged', boxesTotal: 0, boxesLoaded: 0 }),
    ]);
    expect(result).toEqual([
      { orderId: 'o1', orderNumber: 'ORD-1', contactName: 'Juan', missingCount: 1 },
    ]);
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

// MEDIUM (adversarial review) — singular Spanish, and the dock phrase built
// once instead of interpolated into a literal that already says "el andén".
describe('missingBoxesLine', () => {
  it('plural with a load position', () => {
    expect(missingBoxesLine(24, 'A3')).toBe(
      'Los 24 paquetes se quedan en el andén A3 y hay que meterlos en otra ruta.',
    );
  });

  it('singular — never "Los 1 paquetes"', () => {
    expect(missingBoxesLine(1, 'A3')).toBe(
      'El paquete se queda en el andén A3 y hay que meterlo en otra ruta.',
    );
  });

  it('no load position never doubles "el andén"', () => {
    expect(missingBoxesLine(24, null)).toBe(
      'Los 24 paquetes se quedan en el andén y hay que meterlos en otra ruta.',
    );
    expect(missingBoxesLine(24, null)).not.toMatch(/andén el andén/);
  });
});

describe('loadedBoxesLine', () => {
  it('plural', () => {
    expect(loadedBoxesLine(148)).toBe('Los 148 cargados pasan a listo para despacho.');
  });

  it('singular — never "Los 1 cargados"', () => {
    expect(loadedBoxesLine(1)).toBe('El paquete cargado pasa a listo para despacho.');
  });
});
