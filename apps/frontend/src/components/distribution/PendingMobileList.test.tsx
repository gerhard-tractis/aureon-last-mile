import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingMobileList } from './PendingMobileList';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

function zone(overrides: Partial<DockZone> = {}): DockZone {
  return {
    id: 'zone-a1',
    name: 'Zona Norte',
    code: 'A1',
    is_consolidation: false,
    comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
    is_active: true,
    ...overrides,
  };
}

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
  zone: zone(),
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

const flaggedGroup: ZoneGroup = {
  zone: zone({ id: 'zone-cons', code: 'CONS', name: 'Consolidación', is_consolidation: true }),
  matchResult: {
    zone_id: 'zone-cons',
    zone_name: 'Consolidación',
    zone_code: 'CONS',
    is_consolidation: true,
    reason: 'unmapped',
    flagged: true,
  },
  orders: [singlePkgOrder('order-flagged')],
};

describe('PendingMobileList (4d)', () => {
  it('renders a zone group header with ANDÉN <code>, comuna detail, and the pending count', () => {
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={vi.fn()} />);
    const header = screen.getByTestId('pending-group-header-zone-a1');
    expect(within(header).getByText('ANDÉN A1')).toBeInTheDocument();
    expect(within(header).getByText('Quilicura')).toBeInTheDocument();
    expect(within(header).getByText('03 pendientes')).toBeInTheDocument();
  });

  it('renders the flagged bucket as SIN ANDÉN in the warning palette, not as a normal andén', () => {
    render(<PendingMobileList groups={[flaggedGroup]} canManualAssign onRequestSend={vi.fn()} />);
    expect(screen.getByText('SIN ANDÉN')).toBeInTheDocument();
    expect(screen.queryByText('ANDÉN CONS')).not.toBeInTheDocument();
    const header = screen.getByTestId('pending-group-zone-cons');
    expect(header.querySelector('[data-tone="warning"]')).toBeInTheDocument();
  });

  it('renders a single-bulto order as one compact row', () => {
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={vi.fn()} />);
    const row = screen.getByTestId('pending-order-order-1');
    expect(row).toBeInTheDocument();
    expect(within(row).getByText('BULTO-1')).toBeInTheDocument();
    // No nested per-package rows for a single-bulto order.
    expect(screen.queryByTestId('pending-package-pkg-1')).not.toBeInTheDocument();
  });

  it('renders a multi-bulto order expanded: an order line plus one row per package', () => {
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={vi.fn()} />);
    expect(screen.getByTestId('pending-order-order-2')).toBeInTheDocument();
    expect(screen.getByTestId('pending-package-pkg-2')).toBeInTheDocument();
    expect(screen.getByTestId('pending-package-pkg-3')).toBeInTheDocument();
  });

  it('every row and every ⋯ affordance meets the 44px touch floor', () => {
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={vi.fn()} />);
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

  it('the ⋯ affordance requests a send-to-dock sheet for a single package with the suggested zone', async () => {
    const user = userEvent.setup();
    const onRequestSend = vi.fn();
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={onRequestSend} />);
    const row = screen.getByTestId('pending-order-order-1');
    await user.click(within(row).getByRole('button', { name: /enviar/i }));
    expect(onRequestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        packageIds: ['pkg-1'],
        code: 'BULTO-1',
        comunaName: 'Quilicura',
        suggestedZone: baseGroup.zone,
      }),
    );
  });

  it('the order-level ⋯ on a multi-bulto order requests all its package ids', async () => {
    const user = userEvent.setup();
    const onRequestSend = vi.fn();
    render(<PendingMobileList groups={[baseGroup]} canManualAssign onRequestSend={onRequestSend} />);
    const order = screen.getByTestId('pending-order-order-2');
    await user.click(within(order).getByRole('button', { name: /enviar pedido/i }));
    expect(onRequestSend).toHaveBeenCalledWith(
      expect.objectContaining({ packageIds: ['pkg-2', 'pkg-3'], code: '1002' }),
    );
  });

  it('hides every ⋯ affordance when canManualAssign is false', () => {
    render(<PendingMobileList groups={[baseGroup]} canManualAssign={false} onRequestSend={vi.fn()} />);
    expect(screen.queryAllByRole('button', { name: /enviar/i })).toHaveLength(0);
  });

  it('shows an empty state when there are no pending packages', () => {
    render(<PendingMobileList groups={[]} canManualAssign onRequestSend={vi.fn()} />);
    expect(screen.getByText(/no hay paquetes pendientes/i)).toBeInTheDocument();
  });
});
