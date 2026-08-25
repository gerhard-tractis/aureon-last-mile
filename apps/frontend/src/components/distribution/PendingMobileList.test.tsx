import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingMobileList } from './PendingMobileList';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

// A stable daytime instant, well clear of the Santiago/UTC date-rollover
// window, so every test's "today" is unambiguous: 2026-08-24.
const NOW = new Date('2026-08-24T15:00:00.000Z');

function zone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a1',
    name: 'Zona Norte',
    code: 'A1',
    is_consolidation: false,
    comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
    is_active: true,
    operator_id: 'op-1',
    capacity: null,
    ...overrides,
  };
}

const zoneA = zone();
const zoneCons = zone({
  id: 'zone-cons',
  code: 'CONS',
  name: 'Consolidación',
  is_consolidation: true,
  comunas: [],
});

function singlePkgOrder(id = 'order-1') {
  return {
    orderId: id,
    orderNumber: '1001',
    deliveryDate: '2026-08-24',
    comunaName: 'Quilicura',
    packages: [
      {
        id: 'pkg-1',
        label: 'BULTO-1',
        order_id: id,
        orderNumber: '1001',
        comunaId: 'c-1',
        comunaName: 'Quilicura',
        delivery_date: '2026-08-24',
        skuItems: [],
      },
    ],
  };
}

function multiPkgOrder(id = 'order-2') {
  return {
    orderId: id,
    orderNumber: '1002',
    deliveryDate: '2026-08-24',
    comunaName: 'Quilicura',
    packages: [
      {
        id: 'pkg-2',
        label: 'BULTO-2',
        order_id: id,
        orderNumber: '1002',
        comunaId: 'c-1',
        comunaName: 'Quilicura',
        delivery_date: '2026-08-24',
        skuItems: [],
      },
      {
        id: 'pkg-3',
        label: 'BULTO-3',
        order_id: id,
        orderNumber: '1002',
        comunaId: 'c-1',
        comunaName: 'Quilicura',
        delivery_date: '2026-08-24',
        skuItems: [],
      },
    ],
  };
}

const baseGroup: ZoneGroup = {
  zone: zoneA,
  matchResult: {
    zone_id: 'zone-a1',
    zone_name: 'Zona Norte',
    zone_code: 'A1',
    is_consolidation: false,
    reason: 'matched',
    flagged: false,
  },
  orders: [singlePkgOrder(), multiPkgOrder()],
};

// An order whose comuna ('c-999') matches no configured andén — genuinely
// SIN ANDÉN — delivered today so the date check doesn't short-circuit it.
function unmappedOrder(id = 'order-flagged') {
  return {
    orderId: id,
    orderNumber: '2001',
    deliveryDate: '2026-08-24',
    comunaName: 'Comuna Desconocida',
    packages: [
      {
        id: 'pkg-flagged',
        label: 'BULTO-FLAG',
        order_id: id,
        orderNumber: '2001',
        comunaId: 'c-999',
        comunaName: 'Comuna Desconocida',
        delivery_date: '2026-08-24',
        skuItems: [],
      },
    ],
  };
}

// An order genuinely retained for a future delivery date (two days out from
// NOW's 2026-08-24) — a legitimate consolidation case, NOT "sin andén",
// even though its comuna ('c-1') matches a real andén.
function futureDatedOrder(id = 'order-future') {
  return {
    orderId: id,
    orderNumber: '2002',
    deliveryDate: '2026-08-26',
    comunaName: 'Quilicura',
    packages: [
      {
        id: 'pkg-future',
        label: 'BULTO-FUTURE',
        order_id: id,
        orderNumber: '2002',
        comunaId: 'c-1',
        comunaName: 'Quilicura',
        delivery_date: '2026-08-26',
        skuItems: [],
      },
    ],
  };
}

const flaggedGroup: ZoneGroup = {
  zone: zoneCons,
  matchResult: {
    zone_id: 'zone-cons',
    zone_name: 'Consolidación',
    zone_code: 'CONS',
    is_consolidation: true,
    reason: 'unmapped',
    flagged: true,
  },
  orders: [unmappedOrder()],
};

const allZones = [zoneA, zoneCons];

describe('PendingMobileList (4d)', () => {
  it('renders a zone group header with ANDÉN <code>, comuna detail, and the pending count', () => {
    render(
      <PendingMobileList groups={[baseGroup]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    const header = screen.getByTestId('pending-group-header-zone-a1');
    expect(within(header).getByText('ANDÉN A1')).toBeInTheDocument();
    expect(within(header).getByText('Quilicura')).toBeInTheDocument();
    expect(within(header).getByText('03 pendientes')).toBeInTheDocument();
  });

  it('renders the flagged bucket as SIN ANDÉN in the warning palette, not as a normal andén', () => {
    render(
      <PendingMobileList groups={[flaggedGroup]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText('SIN ANDÉN')).toBeInTheDocument();
    expect(screen.queryByText('ANDÉN CONS')).not.toBeInTheDocument();
    const header = screen.getByTestId('pending-group-header-zone-cons-sin-anden');
    expect(header.querySelector('[data-tone="warning"]')).toBeInTheDocument();
  });

  it('renders a single-bulto order as one compact row', () => {
    render(
      <PendingMobileList groups={[baseGroup]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    const row = screen.getByTestId('pending-order-order-1');
    expect(row).toBeInTheDocument();
    expect(within(row).getByText('BULTO-1')).toBeInTheDocument();
    // No nested per-package rows for a single-bulto order.
    expect(screen.queryByTestId('pending-package-pkg-1')).not.toBeInTheDocument();
  });

  it('renders a multi-bulto order expanded: an order line plus one row per package', () => {
    render(
      <PendingMobileList groups={[baseGroup]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    expect(screen.getByTestId('pending-order-order-2')).toBeInTheDocument();
    expect(screen.getByTestId('pending-package-pkg-2')).toBeInTheDocument();
    expect(screen.getByTestId('pending-package-pkg-3')).toBeInTheDocument();
  });

  it('every row and every ⋯ affordance meets the 44px touch floor', () => {
    render(
      <PendingMobileList groups={[baseGroup]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    const rows = [
      screen.getByTestId('pending-order-order-1'),
      screen.getByTestId('pending-order-order-2'),
      screen.getByTestId('pending-package-pkg-2'),
      screen.getByTestId('pending-package-pkg-3'),
    ];
    for (const row of rows) {
      expect(row.className).toMatch(/min-h-\[?(4[4-9]|[5-9]\d)/);
    }
    const affordances = screen.getAllByRole('button', { name: /enviar/i });
    for (const btn of affordances) {
      expect(btn.className).toMatch(/h-11|h-\[44px\]|min-h-\[?(4[4-9]|[5-9]\d)/);
    }
  });

  it('the ⋯ affordance on a single-bulto order requests a full send-to-dock payload, including packageLabels', async () => {
    const user = userEvent.setup();
    const onRequestSend = vi.fn();
    render(
      <PendingMobileList
        groups={[baseGroup]}
        zones={allZones}
        canManualAssign
        onRequestSend={onRequestSend}
        now={NOW}
      />,
    );
    const row = screen.getByTestId('pending-order-order-1');
    await user.click(within(row).getByRole('button', { name: /enviar/i }));
    expect(onRequestSend).toHaveBeenCalledWith({
      packageIds: ['pkg-1'],
      packageLabels: ['BULTO-1'],
      code: 'BULTO-1',
      comunaName: 'Quilicura',
      suggestedZone: zoneA,
    });
  });

  // Regression for finding #1 (Fase 3 review): the per-package ⋯ INSIDE a
  // multi-bulto order is a separate code path from both the single-bulto
  // row and the order-level "enviar todo" ⋯ — it silently dropped
  // packageLabels before. Exact-shape assertion (not objectContaining) so
  // a missing field fails loudly instead of passing by omission.
  it('the ⋯ affordance on ONE package inside a multi-bulto order also includes packageLabels', async () => {
    const user = userEvent.setup();
    const onRequestSend = vi.fn();
    render(
      <PendingMobileList
        groups={[baseGroup]}
        zones={allZones}
        canManualAssign
        onRequestSend={onRequestSend}
        now={NOW}
      />,
    );
    const packageRow = screen.getByTestId('pending-package-pkg-2');
    await user.click(within(packageRow).getByRole('button', { name: /enviar/i }));
    expect(onRequestSend).toHaveBeenCalledWith({
      packageIds: ['pkg-2'],
      packageLabels: ['BULTO-2'],
      code: 'BULTO-2',
      comunaName: 'Quilicura',
      suggestedZone: zoneA,
    });
  });

  it('the order-level ⋯ on a multi-bulto order requests all its package ids and labels', async () => {
    const user = userEvent.setup();
    const onRequestSend = vi.fn();
    render(
      <PendingMobileList
        groups={[baseGroup]}
        zones={allZones}
        canManualAssign
        onRequestSend={onRequestSend}
        now={NOW}
      />,
    );
    const order = screen.getByTestId('pending-order-order-2');
    await user.click(within(order).getByRole('button', { name: /enviar pedido/i }));
    expect(onRequestSend).toHaveBeenCalledWith({
      packageIds: ['pkg-2', 'pkg-3'],
      packageLabels: ['BULTO-2', 'BULTO-3'],
      code: '1002',
      comunaName: 'Quilicura',
      suggestedZone: zoneA,
    });
  });

  it('hides every ⋯ affordance when canManualAssign is false', () => {
    render(
      <PendingMobileList
        groups={[baseGroup]}
        zones={allZones}
        canManualAssign={false}
        onRequestSend={vi.fn()}
        now={NOW}
      />,
    );
    expect(screen.queryAllByRole('button', { name: /enviar/i })).toHaveLength(0);
  });

  it('shows an empty state when there are no pending packages', () => {
    render(
      <PendingMobileList groups={[]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText(/no hay paquetes pendientes/i)).toBeInTheDocument();
  });

  // Finding #5 (Fase 3 review) — usePendingSectorization stores matchResult
  // ONCE PER ZONE BUCKET, from whichever order landed there first. The
  // consolidation bucket mixes a genuinely-unmapped order (SIN ANDÉN) and a
  // genuinely future-dated retention (not SIN ANDÉN) under the SAME zone_id.
  // The component must classify each order independently — regardless of
  // which one the hook happened to key the bucket's matchResult on.
  describe('a mixed consolidation bucket (unmapped comuna + future-dated retention)', () => {
    function mixedGroup(orders: ZoneGroup['orders'], keyedOnFlagged: boolean): ZoneGroup {
      return {
        zone: zoneCons,
        matchResult: keyedOnFlagged
          ? { zone_id: 'zone-cons', zone_name: 'Consolidación', zone_code: 'CONS', is_consolidation: true, reason: 'unmapped', flagged: true }
          : { zone_id: 'zone-cons', zone_name: 'Consolidación', zone_code: 'CONS', is_consolidation: true, reason: 'future_date', flagged: false },
        orders,
      };
    }

    it('splits correctly when the flagged order was inserted first (matchResult keyed on it)', () => {
      const group = mixedGroup([unmappedOrder(), futureDatedOrder()], true);
      render(
        <PendingMobileList groups={[group]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
      );
      const sinAnden = screen.getByTestId('pending-group-zone-cons-sin-anden');
      expect(within(sinAnden).getByTestId('pending-order-order-flagged')).toBeInTheDocument();
      expect(within(sinAnden).queryByTestId('pending-order-order-future')).not.toBeInTheDocument();

      const normal = screen.getByTestId('pending-group-zone-cons');
      expect(within(normal).getByTestId('pending-order-order-future')).toBeInTheDocument();
      expect(within(normal).queryByTestId('pending-order-order-flagged')).not.toBeInTheDocument();
      expect(screen.queryByText('SIN ANDÉN')).toBeInTheDocument();
    });

    it('splits correctly when the future-dated order was inserted first (matchResult keyed on it)', () => {
      const group = mixedGroup([futureDatedOrder(), unmappedOrder()], false);
      render(
        <PendingMobileList groups={[group]} zones={allZones} canManualAssign onRequestSend={vi.fn()} now={NOW} />,
      );
      const sinAnden = screen.getByTestId('pending-group-zone-cons-sin-anden');
      expect(within(sinAnden).getByTestId('pending-order-order-flagged')).toBeInTheDocument();
      expect(within(sinAnden).queryByTestId('pending-order-order-future')).not.toBeInTheDocument();

      const normal = screen.getByTestId('pending-group-zone-cons');
      expect(within(normal).getByTestId('pending-order-order-future')).toBeInTheDocument();
      expect(within(normal).queryByTestId('pending-order-order-flagged')).not.toBeInTheDocument();
    });
  });
});
