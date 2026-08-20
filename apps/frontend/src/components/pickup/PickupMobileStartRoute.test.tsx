import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileStartRoute } from './PickupMobileStartRoute';
import type { ManifestRow } from './ManifestTable';

const mockUseVehicles = vi.fn();
vi.mock('@/hooks/pickup/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/pickup/useVehicles')>(
    '@/hooks/pickup/useVehicles',
  );
  return {
    ...actual,
    useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
    useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

const VEHICLES = [{ id: 'v-1', plate: 'JKLM-42', vehicle_type: 'camion', active: true }];

const pendingRows: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-99814',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 18,
    packageCount: 42,
    verifiedCount: 0,
  },
  {
    id: 'm2',
    externalLoadId: 'CARGA-77001',
    pickupPoint: 'Ripley Costanera',
    retailerName: 'Ripley',
    orderCount: 8,
    packageCount: 25,
    verifiedCount: 0,
  },
];

// A client with three manifests across two pickup points, for the
// tri-state toggle-all and search/selection-desync coverage below —
// `pendingRows` above only has one manifest per client, which can't
// exercise "some" states or a search that hides part of a client.
const falabellaRows: ManifestRow[] = [
  {
    id: 'f1',
    externalLoadId: 'CARGA-1',
    pickupPoint: 'Punto A',
    retailerName: 'Falabella',
    orderCount: 1,
    packageCount: 10,
    verifiedCount: 0,
  },
  {
    id: 'f2',
    externalLoadId: 'CARGA-2',
    pickupPoint: 'Punto A',
    retailerName: 'Falabella',
    orderCount: 1,
    packageCount: 10,
    verifiedCount: 0,
  },
  {
    id: 'f3',
    externalLoadId: 'CARGA-3',
    pickupPoint: 'Punto B',
    retailerName: 'Falabella',
    orderCount: 1,
    packageCount: 10,
    verifiedCount: 0,
  },
];

const FALABELLA_CHECKBOX = 'Seleccionar todos los manifiestos de Falabella';

function baseProps() {
  return {
    operatorId: 'op-1',
    pendingRows,
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    selectedManifests: [],
    onCreateRoute: vi.fn(),
    isCreatingRoute: false,
  };
}

describe('PickupMobileStartRoute', () => {
  it('the "Iniciar ruta de recogida" button starts disabled until a vehicle is chosen', async () => {
    mockUseVehicles.mockReturnValue({ data: VEHICLES, isLoading: false });
    render(<PickupMobileStartRoute {...baseProps()} />);
    const button = screen.getByRole('button', { name: /iniciar ruta de recogida/i });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/Vehículo/i));
    await userEvent.click(screen.getByRole('option', { name: /JKLM-42/ }));
    expect(button).not.toBeDisabled();
  });

  it('calls onCreateRoute with the chosen vehicle id', async () => {
    mockUseVehicles.mockReturnValue({ data: VEHICLES, isLoading: false });
    const onCreateRoute = vi.fn();
    render(<PickupMobileStartRoute {...baseProps()} onCreateRoute={onCreateRoute} />);

    await userEvent.click(screen.getByLabelText(/Vehículo/i));
    await userEvent.click(screen.getByRole('option', { name: /JKLM-42/ }));
    await userEvent.click(screen.getByRole('button', { name: /iniciar ruta de recogida/i }));

    expect(onCreateRoute).toHaveBeenCalledWith('v-1');
  });

  it('surfaces the one-active-route error readably', () => {
    mockUseVehicles.mockReturnValue({ data: VEHICLES, isLoading: false });
    render(
      <PickupMobileStartRoute
        {...baseProps()}
        createRouteError="El conductor ya tiene una ruta de retiro activa"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'El conductor ya tiene una ruta de retiro activa',
    );
  });

  it('shows the "MANIFIESTOS POR RETIRAR" eyebrow with the real count — never "asignados a ti"', () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    render(<PickupMobileStartRoute {...baseProps()} />);
    expect(screen.getByText('MANIFIESTOS POR RETIRAR · 2')).toBeInTheDocument();
    expect(screen.queryByText(/asignados a ti/i)).not.toBeInTheDocument();
  });

  it('the footer totals match the current selection, summing real (non-nullable) package counts', () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    render(
      <PickupMobileStartRoute
        {...baseProps()}
        selectedIds={new Set(['m1', 'm2'])}
        selectedManifests={pendingRows}
      />,
    );
    expect(screen.getByTestId('start-route-footer-totals')).toHaveTextContent(
      '2 manifiestos · 67 paq.',
    );
  });

  it('the footer shows zero when nothing is selected yet', () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    render(<PickupMobileStartRoute {...baseProps()} />);
    expect(screen.getByTestId('start-route-footer-totals')).toHaveTextContent(
      '0 manifiestos · 0 paq.',
    );
  });

  it('"Buscar carga" reveals a search field that filters the grouped list', async () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    render(<PickupMobileStartRoute {...baseProps()} />);
    expect(screen.getByText('Ripley')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /buscar carga/i }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar carga' }), 'Falabella');

    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.queryByText('Ripley')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no pending manifests at all', () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    render(<PickupMobileStartRoute {...baseProps()} pendingRows={[]} />);
    expect(screen.getByText('Sin recogidas pendientes')).toBeInTheDocument();
  });

  // Review fix, item 3 — handleToggleClient was untested. Falabella here
  // has three manifests (f1, f2, f3) so all three tri-state transitions are
  // real, not degenerate single-manifest cases.
  describe('the client checkbox toggles ALL of that client\'s manifests', () => {
    it('none→all: selects every manifest for the client', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileStartRoute
          {...baseProps()}
          pendingRows={falabellaRows}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getByRole('checkbox', { name: FALABELLA_CHECKBOX }));
      expect(onToggleSelect.mock.calls.map((c) => c[0]).sort()).toEqual(['f1', 'f2', 'f3']);
    });

    it('all→none: deselects every manifest for the client', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileStartRoute
          {...baseProps()}
          pendingRows={falabellaRows}
          selectedIds={new Set(['f1', 'f2', 'f3'])}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getByRole('checkbox', { name: FALABELLA_CHECKBOX }));
      expect(onToggleSelect.mock.calls.map((c) => c[0]).sort()).toEqual(['f1', 'f2', 'f3']);
    });

    it('partial→all: only flips the manifests that were not yet selected', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileStartRoute
          {...baseProps()}
          pendingRows={falabellaRows}
          selectedIds={new Set(['f1'])}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getByRole('checkbox', { name: FALABELLA_CHECKBOX }));
      expect(onToggleSelect.mock.calls.map((c) => c[0]).sort()).toEqual(['f2', 'f3']);
    });
  });

  // Review fix, item 4 — both halves of the desync bug.
  describe('search does not desynchronise counts or selection state', () => {
    it('the eyebrow count matches the filtered list, not the unfiltered total', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      render(<PickupMobileStartRoute {...baseProps()} pendingRows={falabellaRows} />);
      expect(screen.getByText('MANIFIESTOS POR RETIRAR · 3')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /buscar carga/i }));
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar carga' }), 'CARGA-1');

      expect(screen.getByText('MANIFIESTOS POR RETIRAR · 1')).toBeInTheDocument();
    });

    it('the client checkbox reflects FULL membership, not just what a search leaves visible', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      render(
        <PickupMobileStartRoute
          {...baseProps()}
          pendingRows={falabellaRows}
          selectedIds={new Set(['f1', 'f2'])}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /buscar carga/i }));
      // Narrows to f1/f2 only (both selected) — a filtered-only calculation
      // would read "all", hiding that f3 is real and unselected.
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar carga' }), 'Punto A');

      expect(screen.getByRole('checkbox', { name: FALABELLA_CHECKBOX })).toHaveAttribute(
        'aria-checked',
        'mixed',
      );
    });

    it('toggling the client checkbox while filtered still acts on the full membership', async () => {
      mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileStartRoute
          {...baseProps()}
          pendingRows={falabellaRows}
          selectedIds={new Set(['f1', 'f2'])}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /buscar carga/i }));
      await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar carga' }), 'Punto A');
      await userEvent.click(screen.getByRole('checkbox', { name: FALABELLA_CHECKBOX }));

      // f3 is hidden by the search but still gets flipped — the real state
      // was "some" (2 of 3), so tapping completes the selection to "all".
      expect(onToggleSelect).toHaveBeenCalledWith('f3');
      expect(onToggleSelect).toHaveBeenCalledTimes(1);
    });
  });
});
