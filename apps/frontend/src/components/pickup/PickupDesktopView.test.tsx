import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PickupDesktopView } from './PickupDesktopView';
import type { ManifestRow } from './ManifestTable';

// PickupRouteDraftPanel pulls in StartRouteButton -> VehicleSelect, which
// reads real hooks — stubbed the same way PickupRouteDraftPanel.test.tsx
// stubs them, so this file stays about PickupDesktopView's own layout.
vi.mock('@/hooks/pickup/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/pickup/useVehicles')>(
    '@/hooks/pickup/useVehicles',
  );
  return {
    ...actual,
    useVehicles: () => ({ data: [], isLoading: false }),
    useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

function row(over: Partial<ManifestRow> = {}): ManifestRow {
  return {
    id: over.id === undefined ? 'm1' : over.id,
    externalLoadId: 'CARGA-1',
    pickupPoint: 'Mall Plaza',
    retailerName: 'Falabella',
    orderCount: 5,
    packageCount: 10,
    verifiedCount: 0,
    ...over,
  };
}

function manyRows(n: number): ManifestRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ id: `m${i}`, externalLoadId: `CARGA-${i}` }),
  );
}

function baseProps(over: Partial<React.ComponentProps<typeof PickupDesktopView>> = {}) {
  const rows = over.pendingRows ?? [row()];
  return {
    activeRoute: null,
    activeManifests: [],
    totals: { manifests: rows.length, orders: 5, packages: 10 },
    closures: [],
    clients: [{ name: 'Falabella', count: 1 }],
    selectedClient: null,
    setSelectedClient: vi.fn(),
    searchTerm: '',
    setSearchTerm: vi.fn(),
    pendingRows: rows,
    routedRows: [],
    visibleRoutedRows: [],
    inTransitRows: [],
    completedRows: [],
    visibleRows: rows,
    tab: 'pending' as const,
    setTab: vi.fn(),
    selectedIds: new Set<string>(),
    toggle: vi.fn(),
    labelsEnabled: false,
    onPrintLabels: vi.fn(),
    onOpen: vi.fn(),
    operatorId: 'op-1',
    selectedManifests: [],
    onCreateRoute: vi.fn(),
    isCreatingRoute: false,
    ...over,
  };
}

describe('PickupDesktopView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec-95 fase 8 (mock 5a:82-95) — the module's own search bar sits in
  // its own row ABOVE the client chips, not below them.
  it('places the module search bar above the client chips, not below', () => {
    render(<PickupDesktopView {...baseProps()} />);
    const searchBar = screen.getByPlaceholderText(
      'Buscar carga, punto de recogida o cliente en este módulo',
    );
    const chip = screen.getByText('Falabella · 1');
    // DOCUMENT_POSITION_FOLLOWING on `chip` relative to `searchBar` means
    // searchBar comes first in the DOM — this is the position criterion
    // the fase-8 checklist calls out explicitly, not just presence of both.
    expect(searchBar.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses the mock copy for the module search bar', () => {
    render(<PickupDesktopView {...baseProps()} />);
    expect(
      screen.getByPlaceholderText('Buscar carga, punto de recogida o cliente en este módulo'),
    ).toBeInTheDocument();
  });

  describe('«Mostrando N de M · Cargar más» (mock 5a:216-217)', () => {
    it('shows only a first page of rows, with the count in the footer', () => {
      render(<PickupDesktopView {...baseProps({ pendingRows: manyRows(12), visibleRows: manyRows(12), totals: { manifests: 12, orders: 1, packages: 1 } })} />);
      expect(screen.getAllByTestId('manifest-row')).toHaveLength(7);
      expect(screen.getByText('Mostrando 7 de 12')).toBeInTheDocument();
    });

    it('reveals more rows when "Cargar más" is clicked — the affordance is wired, not decorative', async () => {
      render(<PickupDesktopView {...baseProps({ pendingRows: manyRows(12), visibleRows: manyRows(12), totals: { manifests: 12, orders: 1, packages: 1 } })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
      expect(screen.getAllByTestId('manifest-row')).toHaveLength(12);
    });

    it('hides "Cargar más" once every row is already shown', () => {
      render(<PickupDesktopView {...baseProps({ pendingRows: manyRows(5), visibleRows: manyRows(5), totals: { manifests: 5, orders: 1, packages: 1 } })} />);
      expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
      expect(screen.getByText('Mostrando 5 de 5')).toBeInTheDocument();
    });

    // A "load more" that never resets is a trap for tab 2: click "Cargar
    // más" once on the pending tab (revealing more than PAGE_SIZE), then
    // switch away — without a reset, `Math.min(visibleCount, totalForTab)`
    // hides the bug whenever the new list happens to be shorter than what
    // was already revealed, so both fixtures below stay ABOVE PAGE_SIZE.
    it('resets to the first page when the tab changes', async () => {
      const props = baseProps({
        pendingRows: manyRows(12),
        visibleRows: manyRows(12),
        totals: { manifests: 12, orders: 1, packages: 1 },
      });
      const { rerender } = render(<PickupDesktopView {...props} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
      expect(screen.getByText('Mostrando 12 de 12')).toBeInTheDocument();

      rerender(
        <PickupDesktopView
          {...props}
          tab="in_transit"
          inTransitRows={manyRows(9)}
          visibleRows={manyRows(9)}
        />,
      );
      expect(screen.getByText('Mostrando 7 de 9')).toBeInTheDocument();
    });

    it('resets to the first page when the search term changes', async () => {
      const props = baseProps({
        pendingRows: manyRows(12),
        visibleRows: manyRows(12),
        totals: { manifests: 12, orders: 1, packages: 1 },
      });
      const { rerender } = render(<PickupDesktopView {...props} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
      expect(screen.getByText('Mostrando 12 de 12')).toBeInTheDocument();

      rerender(<PickupDesktopView {...props} searchTerm="CARGA-1" visibleRows={manyRows(9)} />);
      expect(screen.getByText('Mostrando 7 de 9')).toBeInTheDocument();
    });
  });
});
