import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingDockListOrderGroup } from './PendingDockListOrderGroup';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type { OrderGroup } from '@/hooks/distribution/usePendingSectorization';

const TODAY = '2026-05-05';

const andenA: DockZone = {
  id: 'zone-a',
  name: 'Andén A',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [],
};
const consolidationZone: DockZone = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  is_active: true,
  comunas: [],
};
const activeZones: DockZone[] = [andenA, consolidationZone];

function makeOrder(overrides: Partial<OrderGroup> = {}): OrderGroup {
  return {
    orderId: 'ord-1',
    orderNumber: '1001',
    deliveryDate: '2026-05-06',
    comunaName: 'La Florida',
    packages: [
      {
        id: 'pkg-1',
        label: 'PKG-0041',
        order_id: 'ord-1',
        orderNumber: '1001',
        comunaId: 'c-1',
        comunaName: 'La Florida',
        delivery_date: '2026-05-06',
        skuItems: [],
      },
      {
        id: 'pkg-2',
        label: 'PKG-0042',
        order_id: 'ord-1',
        orderNumber: '1001',
        comunaId: 'c-1',
        comunaName: 'La Florida',
        delivery_date: '2026-05-06',
        skuItems: [],
      },
    ],
    ...overrides,
  };
}

// No fake timers — `today` is injected as a prop, no real-time dependency in tests

describe('PendingDockListOrderGroup', () => {
  it('renders order number in the header', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    const header = screen.getByTestId('order-group-ord-1');
    expect(header.textContent).toContain('1001');
  });

  it('renders bulto count', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.getByTestId('order-group-ord-1').textContent).toContain('2 bultos');
  });

  it('renders single bulto with singular label', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder({ packages: [makeOrder().packages[0]] })}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.getByTestId('order-group-ord-1').textContent).toContain('1 bulto');
    expect(screen.getByTestId('order-group-ord-1').textContent).not.toContain('bultos');
  });

  it('renders commune name', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.getByTestId('order-group-ord-1').textContent).toContain('La Florida');
  });

  it('renders delivery date badge', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder({ deliveryDate: '2026-05-06' })}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    // TODAY is 2026-05-05, deliveryDate is 2026-05-06 → "mañana"
    expect(screen.getByTestId('order-group-ord-1').textContent).toContain('mañana');
  });

  it('renders a package row for each package', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.getByTestId('pending-row-pkg-1')).toBeInTheDocument();
    expect(screen.getByTestId('pending-row-pkg-2')).toBeInTheDocument();
  });

  it('Asignar todo button is absent when onManualAssignAll is undefined', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.queryByTestId('assign-all-btn')).not.toBeInTheDocument();
  });

  it('Asignar todo button is present when onManualAssignAll is provided', () => {
    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        onManualAssignAll={vi.fn()}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );
    expect(screen.getByTestId('assign-all-btn')).toBeInTheDocument();
  });

  it('selecting a zone in Asignar todo calls onManualAssignAll with all package IDs and selected zoneId', async () => {
    const onManualAssignAll = vi.fn();
    const user = userEvent.setup();

    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        onManualAssignAll={onManualAssignAll}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );

    await user.click(screen.getByTestId('assign-all-btn'));
    await user.click(screen.getByText('Andén A'));

    expect(onManualAssignAll).toHaveBeenCalledOnce();
    expect(onManualAssignAll).toHaveBeenCalledWith(['pkg-1', 'pkg-2'], 'zone-a');
  });

  it('per-package ⋯ button calls onManualAssign with that package ID only', async () => {
    const onManualAssign = vi.fn();
    const user = userEvent.setup();

    render(
      <PendingDockListOrderGroup
        order={makeOrder()}
        zoneId="zone-a"
        zoneCode="A1"
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        onManualAssign={onManualAssign}
        activeZones={activeZones}
        density="detallado"
        today={TODAY}
      />
    );

    // Click the ⋯ button on the first package row and select a zone
    const row1 = screen.getByTestId('pending-row-pkg-1');
    const menuBtn = row1.querySelector('[aria-label="Asignar manualmente"]');
    expect(menuBtn).not.toBeNull();
    await user.click(menuBtn!);
    await user.click(screen.getByText('Andén A'));

    expect(onManualAssign).toHaveBeenCalledOnce();
    expect(onManualAssign).toHaveBeenCalledWith('pkg-1', 'zone-a');
    expect(onManualAssign).not.toHaveBeenCalledWith('pkg-2', expect.anything());
  });
});
