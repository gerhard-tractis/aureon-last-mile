import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileView } from './PickupMobileView';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

vi.mock('@/components/pickup/PickupRouteDraftPanel', () => ({
  PickupRouteDraftPanel: ({ selected }: { selected: ManifestRow[] }) => (
    <div data-testid="draft-panel">{selected.length} seleccionados</div>
  ),
}));

const noop = () => {};

const pendingRows: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-001',
    pickupPoint: 'Easy Vespucio',
    retailerName: 'Easy',
    orderCount: 5,
    packageCount: 12,
    verifiedCount: 0,
  },
  {
    id: 'm2',
    externalLoadId: 'CARGA-002',
    pickupPoint: 'Sodimac Puente Alto',
    retailerName: 'Sodimac',
    orderCount: 3,
    packageCount: 8,
    verifiedCount: 2,
  },
];

const activeRoute: ActivePickupRoute = {
  id: 'route-1',
  code: 'PR-2026-0042',
  operator_id: 'op-1',
  driver_id: 'driver-1',
  status: 'in_progress',
  started_at: new Date().toISOString(),
  vehicle: { plate: 'AB-CD-12' },
  driver: { full_name: 'M. Rojas' },
} as unknown as ActivePickupRoute;

function byFullText(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

const activeManifests: RouteManifestRow[] = [
  {
    id: 'rm1',
    external_load_id: 'CARGA-A',
    retailer_name: 'Easy',
    pickup_location: 'Bodega Central',
    total_orders: 4,
    total_packages: 8,
    verified_count: 8,
    status: 'completed',
  },
  {
    id: 'rm2',
    external_load_id: 'CARGA-B',
    retailer_name: 'Falabella',
    pickup_location: 'Bodega Norte',
    total_orders: 2,
    total_packages: null,
    verified_count: 0,
    status: 'pending',
  },
];

function baseProps() {
  return {
    activeRoute: null,
    activeManifests: [],
    pendingRows,
    closuresCount: 1,
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    selectedManifests: [],
    onOpenPending: vi.fn(),
    onOpenRouteManifest: vi.fn(),
    operatorId: 'op-1',
    onCreateRoute: vi.fn(),
    isCreatingRoute: false,
  };
}

describe('PickupMobileView', () => {
  describe('no active route — pending manifests', () => {
    it('renders a card per pending manifest', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByText('CARGA-001')).toBeInTheDocument();
      expect(screen.getByText('CARGA-002')).toBeInTheDocument();
    });

    it('reports the real closed-today count, not a client-cache figure', () => {
      render(<PickupMobileView {...baseProps()} closuresCount={3} />);
      expect(screen.getByText(/3 cerradas hoy/)).toBeInTheDocument();
    });

    it('badges a card with verified scans as "En progreso", others as "Pendiente"', () => {
      render(<PickupMobileView {...baseProps()} />);
      const badges = screen.getAllByTestId('card-status-badge');
      expect(badges[0]).toHaveTextContent('Pendiente');
      expect(badges[1]).toHaveTextContent('En progreso');
    });

    it('tapping the checkbox toggles selection', async () => {
      const onToggleSelect = vi.fn();
      render(<PickupMobileView {...baseProps()} onToggleSelect={onToggleSelect} />);
      await userEvent.click(screen.getAllByRole('checkbox')[0]);
      expect(onToggleSelect).toHaveBeenCalledWith('m1');
    });

    it('tapping the load id opens the manifest instead of toggling selection', async () => {
      const onOpenPending = vi.fn();
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileView
          {...baseProps()}
          onOpenPending={onOpenPending}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getAllByTestId('mobile-manifest-open')[0]);
      expect(onOpenPending).toHaveBeenCalledWith(pendingRows[0]);
      expect(onToggleSelect).not.toHaveBeenCalled();
    });

    it('renders the route draft panel so a route can still be assembled from a phone', () => {
      render(<PickupMobileView {...baseProps()} selectedManifests={[pendingRows[0]]} />);
      expect(screen.getByTestId('draft-panel')).toHaveTextContent('1 seleccionados');
    });

    it('shows an empty state when there are no pending manifests', () => {
      render(<PickupMobileView {...baseProps()} pendingRows={[]} />);
      expect(screen.getByText('Sin recogidas pendientes')).toBeInTheDocument();
    });

    it('never renders a "guardadas"/downloaded-cache summary or a SIN DESCARGAR chip', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.queryByText(/guardad/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/SIN DESCARGAR/i)).not.toBeInTheDocument();
    });
  });

  // spec-54 3h redesign — the mock's real layout: header with driver +
  // route code, three KPI tiles, one dominant "next load" hero card, then
  // the rest as compact rows.
  describe('active route — 3h redesign', () => {
    it('shows the driver, route code and KPI tiles (CARGAS/PAQUETES/CERRADAS)', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.getByTestId('mobile-header-subtitle')).toHaveTextContent('M. Rojas');
      expect(screen.getByTestId('mobile-header-subtitle')).toHaveTextContent('PR-2026-0042');

      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;
      // activeManifests: CARGA-A (completed, 8 pkg) + CARGA-B (pending, null pkg)
      expect(tile('CARGAS')).toHaveTextContent('2');
      expect(tile('CERRADAS')).toHaveTextContent('1');
    });

    // manifestProgress.ts's sumExpected(): "Partial by definition when
    // hasUnknownExpected is true — never present it alone as 'the route's
    // total' in that case." CARGA-B has total_packages: null, so summing
    // only CARGA-A's 8 and presenting it as PAQUETES would understate the
    // route — the same rule RouteProgressHeader.tsx already applies.
    it('shows PAQUETES as unknown (—), not a partial sum, when any load has an unknown total', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;
      expect(tile('PAQUETES')).toHaveTextContent('—');
    });

    it('shows the real PAQUETES sum once every load has a known total', () => {
      const allKnown: RouteManifestRow[] = activeManifests.map((m) => ({
        ...m,
        total_packages: m.total_packages ?? 5,
      }));
      render(
        <PickupMobileView {...baseProps()} activeRoute={activeRoute} activeManifests={allKnown} />,
      );
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;
      // CARGA-A (8) + CARGA-B (now 5) = 13
      expect(tile('PAQUETES')).toHaveTextContent('13');
    });

    it('promotes the first unfinished load to the hero "next" card, never a completed one', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      // activeManifests[0] is CARGA-A (completed), [1] is CARGA-B (pending)
      // — CARGA-B must be the hero card, not CARGA-A.
      expect(screen.getByText('SIGUIENTE')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
    });

    it('renders the remaining unfinished load as a compact row, not another hero card', () => {
      const third: RouteManifestRow = {
        id: 'rm3',
        external_load_id: 'CARGA-C',
        retailer_name: 'Falabella',
        pickup_location: 'Bodega Sur',
        total_orders: 2,
        total_packages: 4,
        verified_count: 0,
        status: 'pending',
      };
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={[...activeManifests, third]}
        />,
      );
      expect(
        screen.getByText(byFullText('CARGA-C · 4 paquetes · 2 órdenes')),
      ).toBeInTheDocument();
    });

    it('renders the completed load as a compact row with COMPLETADA', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
    });

    it('shows a finished state instead of promoting a completed load when every load is done', () => {
      const onlyCompleted: RouteManifestRow[] = [
        { ...activeManifests[0], id: 'x1', external_load_id: 'CARGA-X', status: 'completed' },
      ];
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={onlyCompleted}
        />,
      );
      expect(screen.queryByText('SIGUIENTE')).not.toBeInTheDocument();
      expect(screen.getByText('Ruta completa')).toBeInTheDocument();
    });

    it('starts the pickup flow for the next load from the hero card button', async () => {
      const onOpenRouteManifest = vi.fn();
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
          onOpenRouteManifest={onOpenRouteManifest}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /iniciar recogida/i }));
      expect(onOpenRouteManifest).toHaveBeenCalledWith('CARGA-B');
    });

    it('opens a remaining compact row on tap', async () => {
      const onOpenRouteManifest = vi.fn();
      const third: RouteManifestRow = {
        id: 'rm3',
        external_load_id: 'CARGA-C',
        retailer_name: 'Falabella',
        pickup_location: 'Bodega Sur',
        total_orders: 2,
        total_packages: 4,
        verified_count: 0,
        status: 'pending',
      };
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={[...activeManifests, third]}
          onOpenRouteManifest={onOpenRouteManifest}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /Bodega Sur/ }));
      expect(onOpenRouteManifest).toHaveBeenCalledWith('CARGA-C');
    });

    it('does not render the route draft panel while a route is already active', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.queryByTestId('draft-panel')).not.toBeInTheDocument();
    });

    // Review round 2 item 3 — a route with zero manifests is not the same
    // as a route where every manifest is done. Conflating them told a
    // driver whose route hasn't been loaded yet that his day was over.
    it('shows a distinct "no manifests yet" state (not "Ruta completa") when the active route has none', () => {
      render(<PickupMobileView {...baseProps()} activeRoute={activeRoute} activeManifests={[]} />);
      expect(screen.getByText('Sin manifiestos en la ruta')).toBeInTheDocument();
      expect(screen.queryByText('Ruta completa')).not.toBeInTheDocument();
      expect(screen.queryByText('SIGUIENTE')).not.toBeInTheDocument();
    });

    it('never renders the omitted download-cache banner, SIN DESCARGAR badge, or Reportar problema', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.queryByText(/guardad/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/SIN DESCARGAR/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Reportar problema/i)).not.toBeInTheDocument();
    });

    // Review round 2 judgement call — search is non-destructive: it filters
    // the remaining/completed compact-row lists IN PLACE. It must never
    // replace the header, KPI tiles or hero "next" card, which is not what
    // the artboard shows (a footer button that tears down the screen).
    it('offers "Buscar carga" which filters the compact-row lists without hiding the header, KPIs or hero card', async () => {
      const third: RouteManifestRow = {
        id: 'rm3',
        external_load_id: 'CARGA-C',
        retailer_name: 'Falabella',
        pickup_location: 'Bodega Sur',
        total_orders: 2,
        total_packages: 4,
        verified_count: 0,
        status: 'pending',
      };
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={[...activeManifests, third]}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Buscar carga' }));
      const input = screen.getByRole('searchbox', { name: 'Buscar carga' });
      await userEvent.type(input, 'CARGA-C');

      // Header, KPI tiles and hero card (CARGA-B / "Bodega Norte") survive
      // the search — this is the non-destructive design, not a takeover.
      expect(screen.getByTestId('mobile-header-subtitle')).toBeInTheDocument();
      expect(screen.getAllByTestId('stat-tile').length).toBe(3);
      expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();

      // The remaining/completed lists are filtered: CARGA-C (a match)
      // stays, CARGA-A (completed, no match) is filtered out.
      expect(screen.getByText('Bodega Sur')).toBeInTheDocument();
      expect(screen.queryByText('COMPLETADA')).not.toBeInTheDocument();

      // There is an obvious way back.
      await userEvent.click(screen.getByRole('button', { name: 'Cerrar búsqueda' }));
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
    });

    // Review round 3 (N1) — the hero card is exempt from filtering, but it
    // was NOT exempt from the "no results" check: searching for exactly
    // the hero load showed the hero card AND "Sin resultados" at the same
    // time, even though the hero was on screen the whole time.
    describe('"Sin resultados" — hero exemption', () => {
      it('never shows "Sin resultados" when the query matches only the hero load', async () => {
        render(
          <PickupMobileView
            {...baseProps()}
            activeRoute={activeRoute}
            activeManifests={activeManifests}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Buscar carga' }));
        // CARGA-B / "Bodega Norte" is the hero; nothing else matches it.
        await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar carga' }), 'Bodega Norte');

        expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
        expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument();
      });

      it('never shows "Sin resultados" when the query matches only a compact row', async () => {
        render(
          <PickupMobileView
            {...baseProps()}
            activeRoute={activeRoute}
            activeManifests={activeManifests}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Buscar carga' }));
        // CARGA-A / "Bodega Central" is completed — a compact row, not the hero.
        await userEvent.type(
          screen.getByRole('searchbox', { name: 'Buscar carga' }),
          'Bodega Central',
        );

        expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
        expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument();
      });

      it('shows "Sin resultados" when the query matches neither the hero nor any compact row', async () => {
        render(
          <PickupMobileView
            {...baseProps()}
            activeRoute={activeRoute}
            activeManifests={activeManifests}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Buscar carga' }));
        await userEvent.type(
          screen.getByRole('searchbox', { name: 'Buscar carga' }),
          'no-existe-esta-carga',
        );

        expect(screen.getByText('Sin resultados')).toBeInTheDocument();
        // The hero stays exempt from filtering even in the no-results case.
        expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
      });
    });
  });
});
