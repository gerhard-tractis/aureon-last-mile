import { render, screen } from '@testing-library/react';
import { UnroutedOrderPackages } from './UnroutedOrderPackages';
import type { OrderPackage } from '@/hooks/dispatch/pre-route/useOrderPackages';

const PACKAGES: OrderPackage[] = [
  {
    id: 'pkg-1',
    label: 'PKG-001',
    status: 'en_bodega',
    isHeld: false,
    skuItems: [{ sku: 'SKU-A', description: 'Silla plegable', quantity: 2 }],
  },
  {
    id: 'pkg-2',
    label: 'PKG-002',
    status: 'retenido',
    isHeld: true,
    skuItems: [{ sku: 'SKU-B', description: 'Mesa auxiliar', quantity: 1 }],
  },
];

describe('UnroutedOrderPackages', () => {
  it('shows a loading skeleton while fetching', () => {
    render(<UnroutedOrderPackages packages={undefined} isLoading isError={false} />);
    expect(screen.getByTestId('order-packages-loading')).toBeInTheDocument();
  });

  it('shows an error message if the fetch failed', () => {
    render(<UnroutedOrderPackages packages={undefined} isLoading={false} isError />);
    expect(screen.getByText(/No se pudieron cargar los paquetes/)).toBeInTheDocument();
  });

  it('lists each package with label, sku, description and quantity', () => {
    render(<UnroutedOrderPackages packages={PACKAGES} isLoading={false} isError={false} />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText(/SKU-A/)).toBeInTheDocument();
    expect(screen.getByText(/Silla plegable/)).toBeInTheDocument();
    expect(screen.getByText(/x2/)).toBeInTheDocument();
  });

  it('marks a package held in consolidation', () => {
    render(<UnroutedOrderPackages packages={PACKAGES} isLoading={false} isError={false} />);
    expect(screen.getByTestId('package-held-pkg-2')).toBeInTheDocument();
    expect(screen.queryByTestId('package-held-pkg-1')).toBeNull();
  });

  it('shows an empty state when the order has no packages', () => {
    render(<UnroutedOrderPackages packages={[]} isLoading={false} isError={false} />);
    expect(screen.getByText(/Sin paquetes/)).toBeInTheDocument();
  });
});
