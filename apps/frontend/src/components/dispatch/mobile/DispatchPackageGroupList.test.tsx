import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchPackageGroupList, type PackageGroupSection } from './DispatchPackageGroupList';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

function pkg(overrides: Partial<StopPackageRow> = {}): StopPackageRow {
  return {
    packageId: 'p1',
    dispatchId: 'd1',
    orderId: 'o1',
    orderNumber: 'ORD-1',
    barcode: 'CL1',
    packageNumber: null,
    clientName: null,
    loaded: true,
    loadedAtIso: '2026-09-03T14:00:00Z',
    notEmbarked: false,
    ...overrides,
  };
}

describe('DispatchPackageGroupList', () => {
  it('spec-76 2h #18 — renders stop index, address and package count', () => {
    const sections: PackageGroupSection[] = [
      { key: '1', title: 'Parada 01', subtitle: 'Av. Kennedy 5001', count: 2, packages: [pkg({ packageId: 'p1' }), pkg({ packageId: 'p2' })] },
    ];
    render(<DispatchPackageGroupList sections={sections} emptyMessage="—" />);
    expect(screen.getByText('Parada 01')).toBeInTheDocument();
    expect(screen.getByText('Av. Kennedy 5001')).toBeInTheDocument();
    expect(screen.getByText('2 paquetes')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-package-row-p1')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-package-row-p2')).toBeInTheDocument();
  });

  it('shows the empty message when there are no sections (e.g. Incompletas filter with nothing matching)', () => {
    render(<DispatchPackageGroupList sections={[]} emptyMessage="Sin órdenes incompletas" />);
    expect(screen.getByText('Sin órdenes incompletas')).toBeInTheDocument();
  });

  it('spec-76 review — no remove control reaches the crew path via this list', () => {
    render(
      <DispatchPackageGroupList
        sections={[{ key: '1', title: 'Parada 01', subtitle: 'X', count: 1, packages: [pkg({ packageId: 'p9' })] }]}
        emptyMessage="—"
      />,
    );
    expect(screen.queryByRole('button', { name: /quitar/i })).not.toBeInTheDocument();
  });

  it('renders without a subtitle for the "por hora" grouping (no address for an hour bucket)', () => {
    render(
      <DispatchPackageGroupList
        sections={[{ key: '11:00', title: '11:00', subtitle: null, count: 1, packages: [pkg()] }]}
        emptyMessage="—"
      />,
    );
    expect(screen.getByText('11:00')).toBeInTheDocument();
  });
});
