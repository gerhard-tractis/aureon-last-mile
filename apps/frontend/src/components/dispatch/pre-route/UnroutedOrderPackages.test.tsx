import { render, screen } from '@testing-library/react';
import { UnroutedOrderPackages } from './UnroutedOrderPackages';
import * as useOrderPackagesModule from '@/hooks/dispatch/pre-route/useOrderPackages';
import type { OrderPackage } from '@/hooks/dispatch/pre-route/useOrderPackages';

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

const PACKAGES: OrderPackage[] = [
  {
    id: 'pkg-1',
    label: 'PKG-001',
    isHeld: false,
    skuItems: [{ sku: 'SKU-A', description: 'Silla plegable', quantity: 2 }],
  },
  {
    id: 'pkg-2',
    label: 'PKG-002',
    isHeld: true,
    skuItems: [{ sku: 'SKU-B', description: 'Mesa auxiliar', quantity: 1 }],
  },
];

function mockUseOrderPackages(result: Partial<ReturnType<typeof useOrderPackagesModule.useOrderPackages>>) {
  vi.spyOn(useOrderPackagesModule, 'useOrderPackages').mockReturnValue(
    result as ReturnType<typeof useOrderPackagesModule.useOrderPackages>,
  );
}

describe('UnroutedOrderPackages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading skeleton while fetching', () => {
    mockUseOrderPackages({ data: undefined, isLoading: true, isError: false });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByTestId('order-packages-loading')).toBeInTheDocument();
  });

  it('shows an error message if the fetch failed', () => {
    mockUseOrderPackages({ data: undefined, isLoading: false, isError: true });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByText(/No se pudieron cargar los paquetes/)).toBeInTheDocument();
  });

  it('lists each package with label, sku, description and quantity', () => {
    mockUseOrderPackages({ data: PACKAGES, isLoading: false, isError: false });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText(/SKU-A/)).toBeInTheDocument();
    expect(screen.getByText(/Silla plegable/)).toBeInTheDocument();
    expect(screen.getByText(/x2/)).toBeInTheDocument();
  });

  it('marks a package held in consolidation', () => {
    mockUseOrderPackages({ data: PACKAGES, isLoading: false, isError: false });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByTestId('package-held-pkg-2')).toBeInTheDocument();
    expect(screen.queryByTestId('package-held-pkg-1')).toBeNull();
  });

  it('prefixes package row testids so they cannot collide with OrderPackageList', () => {
    mockUseOrderPackages({ data: PACKAGES, isLoading: false, isError: false });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByTestId('pre-route-package-row-pkg-1')).toBeInTheDocument();
  });

  it('shows an empty state when the order has no packages', () => {
    mockUseOrderPackages({ data: [], isLoading: false, isError: false });
    render(<UnroutedOrderPackages orderId="o1" />);
    expect(screen.getByText(/Sin paquetes/)).toBeInTheDocument();
  });
});
