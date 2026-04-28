import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PendingDockList } from './PendingDockList';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

const andenA: DockZone = {
  id: 'zone-a',
  name: 'Andén A',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [],
};
const andenB: DockZone = {
  id: 'zone-b',
  name: 'Andén B',
  code: 'B1',
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

const zones: DockZone[] = [andenA, andenB, consolidationZone];

const groups: ZoneGroup[] = [
  {
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
      {
        id: 'pkg-1',
        label: 'PKG-001',
        order_id: 'ord-1',
        comunaId: 'c-1',
        delivery_date: '2026-04-28',
      },
      {
        id: 'pkg-2',
        label: 'PKG-002',
        order_id: 'ord-2',
        comunaId: 'c-1',
        delivery_date: '2026-04-28',
      },
    ],
  },
];

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

  it('renders one group per suggested zone with package rows', () => {
    render(
      <PendingDockList
        groups={groups}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    expect(screen.getByText(/Andén A/)).toBeInTheDocument();
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText('PKG-002')).toBeInTheDocument();
  });

  it('shows ✓ checkmark on rows whose package id is in verifiedPackageIds', () => {
    render(
      <PendingDockList
        groups={groups}
        verifiedPackageIds={new Set(['pkg-1'])}
        onTapVerify={() => {}}
        activeZones={zones}
      />
    );
    const verifiedRow = screen.getByTestId('pending-row-pkg-1');
    expect(verifiedRow.querySelector('[data-testid="verified-check"]')).toBeTruthy();
    const unverifiedRow = screen.getByTestId('pending-row-pkg-2');
    expect(unverifiedRow.querySelector('[data-testid="verified-check"]')).toBeFalsy();
  });

  it('calls onTapVerify with the package id when a row body is tapped', () => {
    const onTapVerify = vi.fn();
    render(
      <PendingDockList
        groups={groups}
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
        groups={groups}
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
        groups={groups}
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
        groups={groups}
        verifiedPackageIds={new Set()}
        onTapVerify={() => {}}
        onManualAssign={() => {}}
        activeZones={zones}
      />
    );
    const menuButtons = screen.getAllByRole('button', { name: /asignar manualmente/i });
    expect(menuButtons.length).toBe(2);
  });
});
