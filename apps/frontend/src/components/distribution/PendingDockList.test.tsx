import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingDockList } from './PendingDockList';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type {
  ZoneGroup,
  PendingPackage,
} from '@/hooks/distribution/usePendingSectorization';

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
const zones: DockZone[] = [andenA, consolidationZone];

const today = '2026-04-29';

function makePkg(overrides: Partial<PendingPackage> = {}): PendingPackage {
  return {
    id: 'pkg-1',
    label: 'PKG-OP82-1834',
    order_id: 'ord-1',
    orderNumber: 'ORD-2026-04-2841',
    comunaId: 'c-1',
    comunaName: 'Las Condes',
    delivery_date: '2026-04-29',
    skuItems: [
      { sku: 'SKU-44831', description: 'Audífonos Bluetooth Pro', quantity: 2 },
    ],
    ...overrides,
  };
}

const baseGroup: ZoneGroup = {
  zone: andenA,
  matchResult: {
    zone_id: andenA.id,
    zone_name: andenA.name,
    zone_code: andenA.code,
    is_consolidation: false,
    reason: 'matched',
    flagged: false,
  },
  packages: [
    makePkg(),
    makePkg({
      id: 'pkg-2',
      label: 'PKG-OP82-1835',
      orderNumber: 'ORD-2026-04-2842',
      delivery_date: '2026-04-30',
      skuItems: [
        { sku: 'SKU-A', description: 'Item A', quantity: 1 },
        { sku: 'SKU-B', description: 'Item B', quantity: 1 },
        { sku: 'SKU-C', description: 'Item C', quantity: 1 },
        { sku: 'SKU-D', description: 'Item D', quantity: 1 },
      ],
    }),
  ],
};

beforeEach(() => {
  // Reset density preference between tests
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(today + 'T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

import { afterEach } from 'vitest';

describe('PendingDockList', () => {
  it('renders the empty state when there are no groups', () => {
    render(
      <PendingDockList
        groups={[]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    expect(screen.getByText(/no hay paquetes pendientes/i)).toBeInTheDocument();
  });

  it('renders the group banner with name, code, and pending count', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const banner = screen.getByTestId('pending-group-zone-a');
    // Name is uppercased via CSS — DOM keeps the original casing
    expect(banner.textContent).toContain('Andén A');
    expect(banner.textContent).toContain('A1');
    expect(banner.textContent).toContain('02 pendientes');
  });

  it('shows package label, order number, comuna name, and relative delivery date in the head line', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const row = screen.getByTestId('pending-row-pkg-1');
    expect(row.textContent).toContain('PKG-OP82-1834');
    expect(row.textContent).toContain('#ORD-2026-04-2841');
    expect(row.textContent).toContain('Las Condes');
    // delivery_date 2026-04-29 with today 2026-04-29 → "hoy"
    expect(row.textContent).toMatch(/hoy/i);
  });

  it('renders SKU lines with quantity, description, and code, capped at 3 with "+N más"', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const row = screen.getByTestId('pending-row-pkg-2');
    // First three SKUs visible
    expect(row.textContent).toContain('Item A');
    expect(row.textContent).toContain('SKU-A');
    expect(row.textContent).toContain('Item C');
    // Fourth hidden
    expect(row.textContent).not.toContain('Item D');
    // Collapse indicator
    expect(row.textContent).toMatch(/\+1\s*más/i);
  });

  it('marks verified rows with a verified data-state and no center checkmark icon', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set(['pkg-1'])}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const row = screen.getByTestId('pending-row-pkg-1');
    expect(row.getAttribute('data-state')).toBe('verified');
  });

  it('calls onTapVerify with the package id when a row body is tapped', () => {
    const onTapVerify = vi.fn();
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={onTapVerify}
        activeZones={zones}
      />
    );
    fireEvent.click(screen.getByTestId('pending-row-pkg-1'));
    expect(onTapVerify).toHaveBeenCalledWith('pkg-1');
  });

  it('does not call onTapVerify again when the row is already verified (idempotent)', () => {
    const onTapVerify = vi.fn();
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set(['pkg-1'])}
        onTapVerify={onTapVerify}
        activeZones={zones}
      />
    );
    fireEvent.click(screen.getByTestId('pending-row-pkg-1'));
    expect(onTapVerify).not.toHaveBeenCalled();
  });

  it('hides the ⋯ menu when onManualAssign is not provided', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    expect(
      screen.queryByRole('button', { name: /asignar manualmente/i })
    ).not.toBeInTheDocument();
  });

  it('shows the ⋯ menu on every row when onManualAssign is provided', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        onManualAssign={() => {}}
        activeZones={zones}
      />
    );
    expect(
      screen.getAllByRole('button', { name: /asignar manualmente/i }).length
    ).toBe(2);
  });

  it('starts in detallado mode by default and switches to compacto via the toggle', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    // Detallado default — SKU lines visible
    expect(screen.getByTestId('pending-row-pkg-1').textContent).toContain('Audífonos');
    // Click compacto (icon-only button, accessed by aria-label)
    fireEvent.click(screen.getByRole('button', { name: /vista compacta/i }));
    // SKU lines hidden in compacto
    expect(screen.getByTestId('pending-row-pkg-1').textContent).not.toContain('Audífonos');
    // Persisted
    expect(window.localStorage.getItem('aureon-pending-density')).toBe('compacto');
  });

  it('reads density preference from localStorage on first render', () => {
    window.localStorage.setItem('aureon-pending-density', 'compacto');
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    expect(screen.getByTestId('pending-row-pkg-1').textContent).not.toContain('Audífonos');
  });

  it('lays out rows in a 2-column grid at the lg breakpoint inside each group', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const list = screen.getByTestId('pending-rows-zone-a');
    const className = list.className;
    expect(className).toMatch(/grid-cols-1/);
    expect(className).toMatch(/lg:grid-cols-2/);
  });

  it('uses an icon-only density toggle (no Detallado/Compacto labels visible)', () => {
    render(
      <PendingDockList
        groups={[baseGroup]}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    // No visible "Detallado" or "Compacto" text — toggle is now compact icons
    expect(screen.queryByText(/^detallado$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^compacto$/i)).not.toBeInTheDocument();
    // But the toggle is still reachable by accessible name
    expect(
      screen.getByRole('button', { name: /vista detallada/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /vista compacta/i })
    ).toBeInTheDocument();
  });
});
