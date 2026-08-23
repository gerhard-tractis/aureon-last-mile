import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderPackageList } from './OrderPackageList';
import type { DossierPackage } from '@/hooks/useOrderDossier';

function pkg(overrides: Partial<DossierPackage> = {}): DossierPackage {
  return {
    id: 'pkg-1',
    label: 'CL7742891003',
    package_number: 'CL7742891003',
    status: 'en_ruta',
    status_updated_at: '2026-08-13T06:55:00',
    dock_zone_name: null,
    declared_weight_kg: null,
    verified_weight_kg: null,
    ...overrides,
  };
}

describe('OrderPackageList', () => {
  it('renders the package label in mono and a status badge', () => {
    render(<OrderPackageList packages={[pkg()]} />);
    expect(screen.getByText('CL7742891003')).toHaveClass('font-mono');
    expect(screen.getByText('En reparto')).toBeInTheDocument();
  });

  it('renders location and weight when present', () => {
    render(
      <OrderPackageList
        packages={[pkg({ dock_zone_name: 'Andén A3', verified_weight_kg: 2.4 })]}
      />,
    );
    expect(screen.getByText(/Andén A3/)).toBeInTheDocument();
    expect(screen.getByText(/2[.,]4\s*kg/)).toBeInTheDocument();
  });

  it('omits location/weight text entirely when both are absent — no dash, no zero', () => {
    render(<OrderPackageList packages={[pkg({ dock_zone_name: null, declared_weight_kg: null, verified_weight_kg: null })]} />);
    expect(screen.queryByTestId('package-meta-pkg-1')).not.toBeInTheDocument();
  });

  it('prefers verified weight over declared weight when both are present', () => {
    render(
      <OrderPackageList
        packages={[pkg({ declared_weight_kg: 5, verified_weight_kg: 4.8 })]}
      />,
    );
    expect(screen.getByText(/4[.,]8\s*kg/)).toBeInTheDocument();
    expect(screen.queryByText(/5\s*kg/)).not.toBeInTheDocument();
  });

  it('renders a blocking package (retenido) in the warning palette with its held duration', () => {
    const now = new Date('2026-08-13T10:12:00');
    render(
      <OrderPackageList
        packages={[pkg({ status: 'retenido', status_updated_at: '2026-08-13T07:00:00' })]}
        now={now}
      />,
    );
    const row = screen.getByTestId('package-row-pkg-1');
    expect(row.className).toMatch(/status-warning/);
    expect(screen.getByText(/retenido 3h 12m/)).toBeInTheDocument();
  });

  it('does not show a held duration for a non-blocking package', () => {
    render(<OrderPackageList packages={[pkg({ status: 'en_ruta' })]} />);
    expect(screen.queryByText(/retenido/)).not.toBeInTheDocument();
  });
});
