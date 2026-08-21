import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileView } from './PickupMobileView';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

// PickupMobileStartRoute (3j) renders VehicleSelect, which reads real hooks.
// Mocked the same way VehicleSelect.test.tsx mocks them, so this file stays
// a pure wiring test for PickupMobileView's branch choice + prop threading.
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

// 3j's crew picker (spec-61 Task 5) reads the operator directory.
const mockUseCrewCandidates = vi.fn();
vi.mock('@/hooks/pickup/useCrewCandidates', () => ({
  useCrewCandidates: (...args: unknown[]) => mockUseCrewCandidates(...args),
}));

// 3h can now offer the route's leader a cancel (spec-61 Task 5). The hook
// behind it is mocked: this file renders without a QueryClientProvider.
const mockCancelMutateAsync = vi.fn();
vi.mock('@/hooks/pickup/useCancelPickupRoute', () => ({
  useCancelPickupRoute: () => ({ mutateAsync: mockCancelMutateAsync, isPending: false }),
}));

const mockUseCurrentUserName = vi.fn();
vi.mock('@/hooks/useCurrentUserName', () => ({
  useCurrentUserName: () => mockUseCurrentUserName(),
}));

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
  // spec-61 Task 4 made `crew` a required field on every active route;
  // solo routes carry an empty array, not undefined.
  crew: [],
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
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    selectedManifests: [],
    onOpenRouteManifest: vi.fn(),
    operatorId: 'op-1',
    // spec-61 Task 5: 3j is the LEADER's screen, so every pre-existing test
    // in this file (all of which expect 3j) is a leader by default.
    role: 'pickup_leader',
    currentUserId: 'user-me',
    onCreateRoute: vi.fn(),
    isCreatingRoute: false,
  };
}

describe('PickupMobileView', () => {
  beforeEach(() => {
    mockUseCurrentUserName.mockReturnValue({ data: 'Marcela R.' });
    mockUseCrewCandidates.mockReturnValue({ data: [], isLoading: false });
  });

  // spec-61 Task 5 — 3j used to be the only no-route screen, so a
  // pickup_crew member landed on a vehicle picker and an "Iniciar ruta"
  // button that start_pickup_route refuses by role. They opened a SECOND
  // route for the same van instead of joining their leader's.
  describe('spec-61 — who may open a route', () => {
    it('shows 3j to a leader with no active route', () => {
      render(<PickupMobileView {...baseProps()} role="pickup_leader" />);
      expect(screen.getByTestId('pickup-mobile-start-route')).toBeInTheDocument();
      expect(screen.queryByTestId('pickup-mobile-no-route')).toBeNull();
    });

    it('shows crew with no route the ask-your-leader screen, not 3j', () => {
      render(<PickupMobileView {...baseProps()} role="pickup_crew" />);
      expect(screen.getByText(/no hay una ruta abierta/i)).toBeInTheDocument();
      expect(screen.queryByTestId('pickup-mobile-start-route')).toBeNull();
      // The point of the branch: no control the RPC would refuse.
      expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
    });

    it('shows 3h, not the ask-your-leader screen, to a crew member who IS on a route', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          role="pickup_crew"
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      // "Bodega Norte" is 3h's hero card — it renders on no other branch.
      expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
      expect(screen.queryByTestId('pickup-mobile-no-route')).toBeNull();
    });
  });

  // spec-61 Task 5 — page.tsx used to read only `data` from
  // useActivePickupRoute. After React Query exhausts its retries a FAILED
  // lookup is indistinguishable from "no route": `data` is undefined. A
  // leader who already has a route open was then shown 3j and invited to
  // open a second one. Same fix Task 4 made on route/active/page.tsx.
  describe('spec-61 — a failed lookup is not an empty one', () => {
    it('offers a retry instead of 3j when the active-route lookup failed', async () => {
      const onRetryRoute = vi.fn();
      render(
        <PickupMobileView {...baseProps()} routeUnknown onRetryRoute={onRetryRoute} />,
      );
      expect(screen.queryByTestId('pickup-mobile-start-route')).toBeNull();
      expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      expect(onRetryRoute).toHaveBeenCalled();
    });

    it('does not send a leader to the ask-your-leader screen on a failed lookup', () => {
      render(<PickupMobileView {...baseProps()} routeUnknown onRetryRoute={vi.fn()} />);
      expect(screen.queryByTestId('pickup-mobile-no-route')).toBeNull();
      expect(screen.getByText(/no pudimos cargar tu ruta/i)).toBeInTheDocument();
    });

    it('still shows the route it DID load, even if a later refetch failed', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          routeUnknown
          onRetryRoute={vi.fn()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
    });
  });

  // spec-54 mock 3j — "Sin ruta activa: iniciar ruta y sumarle
  // manifiestos". Deep coverage of the grouping/selection/vehicle-required
  // behaviour lives in PickupMobileStartRoute.test.tsx and
  // pickupStartRouteGrouping.test.ts; this file stays a wiring test for
  // which branch renders and that props reach PickupMobileStartRoute.
  describe('no active route — 3j start-route screen', () => {
    it('renders 3j (not 3h) when there is no active route', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByTestId('pickup-mobile-start-route')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /iniciar ruta de recogida/i })).toBeInTheDocument();
    });

    it('renders the shared PickupMobileHeader with no route code (no route exists yet)', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByRole('heading', { name: 'Recogidas de hoy' })).toBeInTheDocument();
      const subtitle = screen.getByTestId('mobile-header-subtitle');
      expect(subtitle.textContent?.trim().endsWith('·')).toBe(false);
    });

    // Review fix, item 8 — the header's driver name now comes from
    // `useCurrentUserName` (there is no route yet to join a driver name
    // from), not a hardcoded `null`.
    it('wires the signed-in user\'s name into the header, driver-first', () => {
      mockUseCurrentUserName.mockReturnValue({ data: 'Marcela R.' });
      render(<PickupMobileView {...baseProps()} />);
      const subtitle = screen.getByTestId('mobile-header-subtitle');
      expect(subtitle.textContent?.startsWith('Marcela R. ·')).toBe(true);
      expect(screen.getByTestId('mobile-header-avatar')).toHaveTextContent('MR');
    });

    it('never fabricates a driver name while the query is still resolving', () => {
      mockUseCurrentUserName.mockReturnValue({ data: undefined });
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByTestId('mobile-header-avatar')).toHaveTextContent('··');
    });

    it('groups pending manifests by client under the "MANIFIESTOS POR RETIRAR" eyebrow', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByText(/MANIFIESTOS POR RETIRAR/)).toBeInTheDocument();
      expect(screen.getByText('Easy')).toBeInTheDocument();
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
      expect(screen.getByText('CARGA-001')).toBeInTheDocument();
      expect(screen.getByText('CARGA-002')).toBeInTheDocument();
    });

    it('tapping a manifest checkbox toggles selection', async () => {
      const onToggleSelect = vi.fn();
      render(<PickupMobileView {...baseProps()} onToggleSelect={onToggleSelect} />);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar CARGA-001' }));
      expect(onToggleSelect).toHaveBeenCalledWith('m1');
    });

    it('the footer totals reflect the current selection', () => {
      render(<PickupMobileView {...baseProps()} selectedManifests={[pendingRows[0]]} />);
      expect(screen.getByTestId('start-route-footer-totals')).toHaveTextContent(
        '1 manifiesto · 12 paq.',
      );
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

    it('surfaces the one-active-route-per-driver error readably, not as a raw Postgres message', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          createRouteError="El conductor ya tiene una ruta de retiro activa"
        />,
      );
      expect(
        screen.getByText('El conductor ya tiene una ruta de retiro activa'),
      ).toBeInTheDocument();
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

    // spec-61 Task 6 — 3h used to name only the driver, so a crew member
    // riding the leader's route saw a screen that never acknowledged them.
    it('names the crew riding along, not just the driver', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={{ ...activeRoute, crew: [{ user_id: 'u1', full_name: 'Ana Pérez' }] }}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    });

    // Guards the wiring specifically: the strip must read the route's own
    // crew, so a solo route shows no team strip at all.
    it('shows no team strip on a solo route', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.queryByText(/^EQUIPO/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('crew-member')).not.toBeInTheDocument();
    });

    /**
     * spec-61 Task 5 — below `lg` there is no link to route/active at all
     * (ActiveRouteBanner lives in PickupDesktopView), so 3h is the only
     * screen a phone can reach once the route exists. A leader whose
     * manifests all failed to attach was stuck here with an empty route and
     * no way back to 3j.
     */
    it('offers the route leader a cancel', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
          canCancelRoute
        />,
      );
      expect(screen.getByRole('button', { name: /cancelar ruta/i })).toBeInTheDocument();
    });

    it('offers no cancel to someone who is not the route leader', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.queryByRole('button', { name: /cancelar ruta/i })).toBeNull();
      // 3h is otherwise whole — a missing control, not a blocked screen.
      expect(screen.getByRole('heading', { name: 'Bodega Norte' })).toBeInTheDocument();
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
