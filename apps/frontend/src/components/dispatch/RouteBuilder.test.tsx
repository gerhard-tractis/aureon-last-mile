import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBuilder } from './RouteBuilder';
import type { RouteStatus, RoutePackage, DispatchRoute, FleetVehicle } from '@/lib/dispatch/types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const refetchMock = vi.fn();
let mockPackages: RoutePackage[] = [];
// Phase-4c review item 1. The real hook reports whether the read actually
// succeeded; `data` alone cannot tell "empty route" from "query failed" or
// "still loading", both of which leave `packages` defaulting to []. Defaults
// to a successful read so every pre-existing test here is unaffected.
let mockPackagesLoaded = true;
vi.mock('@/hooks/dispatch/useRoutePackages', () => ({
  useRoutePackages: () => ({
    data: mockPackagesLoaded ? mockPackages : undefined,
    isSuccess: mockPackagesLoaded,
    refetch: refetchMock,
  }),
}));

// The route row changes underneath every mutation here, so the builder has to
// re-read it. Key alignment between this refresher and the query it targets is
// covered for real in useRefreshRouteStatus.test.tsx — mounting a QueryClient
// here would test react-query, not the builder.
const refreshRouteStatusMock = vi.fn();
vi.mock('@/hooks/dispatch/useRefreshRouteStatus', () => ({
  useRefreshRouteStatus: () => refreshRouteStatusMock,
}));

// spec-70 phase 4, breakage #3: RouteBuilder derives everything from the
// route's real status now, fetched through useDispatchRoute — not a
// `useState` a page reload wiped.
let mockRouteStatus: RouteStatus | undefined = 'draft';
// QA finding #1: the header date used to come from `new Date()`, not this
// route's own `route_date` — default undefined so most tests (which don't
// care about the date) render nothing rather than assert a stray value.
let mockRouteDate: string | undefined;
vi.mock('@/hooks/dispatch/useDispatchRoute', () => ({
  useDispatchRoute: () => ({
    data: mockRouteStatus
      ? ({ status: mockRouteStatus, route_date: mockRouteDate } as DispatchRoute)
      : undefined,
  }),
}));

// spec-72 phase 3: RouteBlockList (and its own useRouteBlocks read/derive
// logic) is covered on its own in RouteBlockList.test.tsx /
// useRouteBlocks.test.ts. RouteBuilder itself also reads this hook now
// (spec-72 phase 4) purely for the orphan count it feeds into
// TerritoryStability — mockable per-test via mockRouteBlocksData, defaulting
// to empty so most tests here stay about RouteBuilder's own behaviour.
let mockRouteBlocksData: { blocks: unknown[]; unblocked: { orderId?: string; reason: string }[] } = { blocks: [], unblocked: [] };
// Phase-4 review item 4 (HIGH) — a failed blocks read must surface as
// "orphan count unknown", not silently as 0. Defaults to false so most
// tests here are unaffected.
let mockRouteBlocksError = false;
vi.mock('@/hooks/dispatch/useRouteBlocks', () => ({
  useRouteBlocks: () => ({
    data: mockRouteBlocksError ? undefined : mockRouteBlocksData,
    isLoading: false,
    isError: mockRouteBlocksError,
    refetch: vi.fn(),
  }),
}));

// spec-72 phase 4 (Decision 6) — territory stability. Mockable per-test via
// mockTerritoryData, defaulting to empty so most tests here are unaffected.
let mockTerritoryData: { comunaId: string; comunaName: string; driverName: string; runCount: number; lastRouteDate: string }[] = [];
vi.mock('@/hooks/dispatch/useRouteTerritoryHistory', () => ({
  useRouteTerritoryHistory: () => ({ data: mockTerritoryData, isLoading: false }),
}));

// spec-73 phase 4b — TopupSuggestions is covered on its own in
// TopupSuggestions.test.tsx / useTopupCandidates.test.ts. RouteBuilder
// itself only needs a role to pass through (GlobalContext, not the
// operatorId prop) and a non-eligible/empty result so the widget renders
// nothing and stays out of every assertion below that isn't about it.
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ role: 'admin' }),
}));
vi.mock('@/hooks/dispatch/useTopupCandidates', () => ({
  useTopupCandidates: () => ({ data: { eligible: false, reason: null, candidates: [] }, isLoading: false }),
  useAcceptTopup: () => ({ mutate: vi.fn(), isPending: false }),
}));

function pkg(overrides: Partial<RoutePackage> = {}): RoutePackage {
  return {
    dispatch_id: 'd1',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Mario',
    contact_address: 'Calle 1',
    contact_phone: null,
    status: 'pending',
    stage: 'staged',
    // spec-74 phase 4: default to a single-bulto order (1 box, none loaded
    // yet) so every pre-existing fixture keeps behaving like "one order =
    // one outstanding stop" unless a test overrides boxesTotal/boxesLoaded.
    boxesTotal: 1,
    boxesLoaded: 0,
    ...overrides,
  };
}

function vehicle(overrides: Partial<FleetVehicle> = {}): FleetVehicle {
  return {
    id: 'v1',
    external_vehicle_id: 'CAM-1',
    plate_number: null,
    driver_name: null,
    vehicle_type: null,
    capacity_packages: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPackages = [];
  mockPackagesLoaded = true;
  mockRouteStatus = 'draft';
  mockRouteDate = undefined;
  mockRouteBlocksData = { blocks: [], unblocked: [] };
  mockRouteBlocksError = false;
  mockTerritoryData = [];
  global.fetch = vi.fn();
});

/**
 * QA finding #1: live QA showed "jue, 27 ago" (today) in the header for a
 * route whose `routes.route_date` is 2026-08-26 (a Wednesday) — the header
 * asserted the browser's clock instead of the row's own date.
 */
describe('RouteBuilder — header date', () => {
  it("renders the route's own route_date, not today", () => {
    mockRouteDate = '2026-08-26';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('mié, 26 ago')).toBeInTheDocument();
  });

  it('shows nothing while the route is still loading, rather than a wrong date', () => {
    // Pinned to a Wednesday (2026-08-26 — same date the other test in this
    // block uses) on purpose: two of the seven es-CL short weekdays are
    // accented ("mié", "sáb"), and this is one of them. A regex that can't
    // match an accented weekday would silently pass against a regression
    // back to `new Date()` on exactly the days that render one — see the
    // comment on the pattern below.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00'));
    mockRouteStatus = undefined; // useDispatchRoute mock returns data: undefined
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    // formatRouteHeaderDate's output always has this shape — "wkd, D mon" —
    // so this pattern only matches the header date, not incidental text
    // elsewhere on the page. `\S{3}`, not `\w{3}`: `\w` is [A-Za-z0-9_], so
    // `\w{3}` doesn't match "mié" or "sáb" — a regression back to `new
    // Date()` on one of those two days would render a real date this
    // assertion couldn't see, and the test would pass against the broken
    // implementation.
    expect(
      screen.queryByText(/^\S{3}, \d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/),
    ).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

/**
 * spec-70 decision 4: the plan/load gap has to be visible during loading, not
 * discovered only when the seal refuses.
 */
describe('RouteBuilder — pending-to-stage visibility', () => {
  it('shows a live "faltan N bulto(s) por estibar" count when stops are still planned', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' }), pkg({ dispatch_id: 'd2', stage: 'staged' })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText(/faltan 1 bulto por estibar/i)).toBeInTheDocument();
  });

  it('shows nothing pending once every stop is staged', () => {
    mockPackages = [pkg({ stage: 'staged' })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.queryByText(/por estibar/i)).not.toBeInTheDocument();
  });

  /**
   * spec-74 phase 3: a partially_staged order (some bultos loaded, some
   * still on the andén) must count toward "faltan por estibar" exactly like
   * a fully-planned one — it is not safe to seal either.
   */
  it('counts a partially_staged stop toward "faltan N bulto(s) por estibar" too', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'partially_staged' }), pkg({ dispatch_id: 'd2', stage: 'staged' })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText(/faltan 1 bulto por estibar/i)).toBeInTheDocument();
  });

  /**
   * spec-74 phase 4. The count must be outstanding BOXES, not outstanding
   * ORDERS — a 3-bulto order with one box scanned has 2 boxes left on the
   * andén, not 0 (dispatches.stage alone) and not 1 (one order = one stop,
   * the phase-3 order-level widening this phase replaces).
   */
  it('counts outstanding boxes within a partially_staged order, not just 1 per order', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'partially_staged', boxesTotal: 3, boxesLoaded: 1 })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText(/faltan 2 bultos por estibar/i)).toBeInTheDocument();
  });

  it('sums outstanding boxes across multiple planned/partially_staged orders', () => {
    mockPackages = [
      pkg({ dispatch_id: 'd1', stage: 'planned', boxesTotal: 2, boxesLoaded: 0 }),
      pkg({ dispatch_id: 'd2', stage: 'partially_staged', boxesTotal: 3, boxesLoaded: 2 }),
      pkg({ dispatch_id: 'd3', stage: 'staged', boxesTotal: 1, boxesLoaded: 1 }),
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    // 2 outstanding from d1 + 1 outstanding from d2 = 3.
    expect(screen.getByText(/faltan 3 bultos por estibar/i)).toBeInTheDocument();
  });

  /**
   * spec-74 phase 4 review item 1 (BLOCKER). An `adopted` order used to be
   * missing from the filter entirely, contributing 0 regardless of how many
   * of its boxes were still on the andén — the screen showed the route as
   * fully staged while seal-route.ts refuses it (an adopted row's `stage`
   * is never rewritten as its packages load).
   */
  it('counts outstanding boxes on an adopted order toward "faltan N bulto(s) por estibar"', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'adopted', boxesTotal: 3, boxesLoaded: 1 })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText(/faltan 2 bultos por estibar/i)).toBeInTheDocument();
  });

  it('does not count a fully-loaded adopted order as pending', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'adopted', boxesTotal: 2, boxesLoaded: 2 })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.queryByText(/por estibar/i)).not.toBeInTheDocument();
  });
});

/**
 * spec-70 phase 4, breakage #3: the header badge and every button in
 * RoutePanel used to answer to a local `routeClosed` boolean that
 * defaulted to `false` on every mount — reload the page and a sealed route
 * looked open again. They now read the fetched route status.
 *
 * spec-75 phase 4 — the scan-input tests that used to live here are gone,
 * not adapted: RouteBuilder never renders a scan field any more, at any
 * status. Desktop scanning is removed entirely (decision 4) — a `loading`
 * route is never routed to RouteBuilder in the first place any more
 * (`DispatchRouteSurface` sends it to the read-only `RouteTrackingView`
 * instead), so there is no real status at which RouteBuilder could ever
 * need one.
 */
describe('RouteBuilder — route status is the source of truth', () => {
  it('shows the real route status label in the header, not a hardcoded Borrador/Listo pair', () => {
    mockRouteStatus = 'loaded';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('Cargada')).toBeInTheDocument();
  });

  it('never renders a scan input, at any route status', () => {
    mockRouteStatus = 'loading';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.queryByPlaceholderText(/Escanea barcode/i)).not.toBeInTheDocument();
  });

  it('survives a "reload": a route already loaded stays loaded without any local click', () => {
    // The old bug: routeClosed always started false, so a mid-session
    // remount (what a page reload does) showed a sealed route as open again.
    mockRouteStatus = 'loaded';
    const { unmount } = render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    unmount();
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('Cargada')).toBeInTheDocument();
  });
});

/**
 * spec-75 phase 4, decision 4 — "Cerrar Ruta" (seal, POST /seal) is REMOVED
 * from RouteBuilder entirely. Closing a route is crew-mobile only (`2i`,
 * spec-77). The `describe('RouteBuilder — seal', ...)` block that used to
 * live here (POSTs to /seal not /close, surfaces UNSEALED_STOPS) is deleted,
 * not adapted — there is no seal action left on this screen to test.
 */

/**
 * spec-70 phase 3 review fix: the DELETE handler now requires `{ reason }`
 * (400 without one), but this button sent no body at all, so every click
 * 400'd and the trash icon silently did nothing — the one escape hatch the
 * seal refusal points people at. Regression coverage: nothing exercised
 * handleRemove at all before this.
 */
describe('RouteBuilder — remove from plan', () => {
  it('re-reads the route status after a successful removal, so a since-changed status becomes visible', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'planned';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() => expect(refreshRouteStatusMock).toHaveBeenCalled());
  });

  it('prompts for a reason and sends it in the DELETE body', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/r1/packages/d1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ reason: 'Cliente canceló' }),
      }),
    ));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('does nothing when the reason prompt is cancelled', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a refusal (e.g. FORBIDDEN or ROUTE_SEALED) instead of silently doing nothing', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'FORBIDDEN',
        message: 'Solo un responsable puede quitar paradas de la planificación.',
      }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() =>
      expect(screen.getByText(/Solo un responsable puede quitar paradas/)).toBeInTheDocument(),
    );
  });
});

/**
 * spec-72 phase 4 (Decision 6) — territory stability wired end-to-end
 * through RouteBuilder into RoutePanel/TerritoryStability.
 */
describe('RouteBuilder — territory stability', () => {
  it('pre-fills the driver field from a single-driver territory match', async () => {
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 2, lastRouteDate: '2026-08-20' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Nombre o RUT…')).toHaveValue('Juan Pérez'),
    );
  });

  it('does not pre-fill when the territory history is ambiguous across comunas', () => {
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 2, lastRouteDate: '2026-08-20' },
      { comunaId: 'c-2', comunaName: 'Providencia', driverName: 'Ana Soto', runCount: 1, lastRouteDate: '2026-08-19' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toHaveValue('');
  });

  it('warns when the manager types a driver that diverges from the territory history', async () => {
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 3, lastRouteDate: '2026-08-20' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    await userEvent.clear(screen.getByPlaceholderText('Nombre o RUT…'));
    await userEvent.type(screen.getByPlaceholderText('Nombre o RUT…'), 'Otro Conductor');
    await waitFor(() => {
      const warning = screen.getByText(/Cambiando de conductor en/);
      expect(warning.textContent).toContain('Ñuñoa');
    });
  });

  it('surfaces the orphan count next to the territory check, since orphan comunas are invisible to it', () => {
    mockRouteBlocksData = {
      blocks: [],
      unblocked: [
        { orderId: 'o-1', reason: 'orphan' },
        { orderId: 'o-2', reason: 'orphan' },
        { orderId: 'o-3', reason: 'noComuna' },
      ],
    };
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    // Only the 2 'orphan' rows count toward this caveat, not the noComuna one.
    expect(screen.getByText(/2 paradas aún sin secuencia asignada/)).toBeInTheDocument();
  });

  // Review item 1 (HIGH): a single prior run is not a territory.
  it('does not pre-fill the driver from a territory match with run_count 1 (thin evidence)', () => {
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Pedro Cobertura', runCount: 1, lastRouteDate: '2026-08-30' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toHaveValue('');
  });

  it('marks a pre-filled driver as suggested, and clears the marker once the manager edits it', async () => {
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 2, lastRouteDate: '2026-08-20' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Nombre o RUT…')).toHaveValue('Juan Pérez'),
    );
    expect(screen.getByText('sugerido por historial')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Nombre o RUT…'), 'z');
    await waitFor(() =>
      expect(screen.queryByText('sugerido por historial')).not.toBeInTheDocument(),
    );
  });

  // Review item 4 (HIGH): a failed blocks read must not present a
  // complete-looking territory answer — the orphan count is unknown, and
  // that must show as an explicit incompleteness caveat, not silence.
  it('surfaces an incompleteness caveat, not a false "0 orphans", when the blocks read fails', () => {
    mockRouteBlocksError = true;
    mockTerritoryData = [
      { comunaId: 'c-1', comunaName: 'Ñuñoa', driverName: 'Juan Pérez', runCount: 3, lastRouteDate: '2026-08-20' },
    ];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.queryByText(/paradas aún sin secuencia asignada/)).not.toBeInTheDocument();
    expect(screen.getByText(/No se pudo verificar si faltan paradas/)).toBeInTheDocument();
  });
});

/**
 * spec-73 phase 4c — wiring VehicleCapacityBar into RouteBuilder, fed by
 * the selected vehicle's `capacity_packages` (the only vehicle identity
 * available pre-dispatch — `routes.vehicle_id` is NULL until DispatchTrack's
 * webhook back-fills it after the fact, per the spec's phase-2 dependency
 * note) and the route's total package (bulto) count.
 */
describe('RouteBuilder — vehicle capacity fill bar', () => {
  it('renders nothing before any vehicle is selected, even when vehicles carry capacity', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', boxesTotal: 5 })];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 40 })]}
      />,
    );
    expect(screen.queryByTestId('vehicle-capacity-fill')).not.toBeInTheDocument();
  });

  it('renders nothing once a vehicle with NULL capacity is selected — never a bar pinned at 0%', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', boxesTotal: 5 })];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: null })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    expect(screen.queryByTestId('vehicle-capacity-fill')).not.toBeInTheDocument();
  });

  it('renders the bar sized by the route\'s total package count once a vehicle with real capacity is selected', async () => {
    mockPackages = [
      pkg({ dispatch_id: 'd1', boxesTotal: 3, boxesLoaded: 1 }),
      pkg({ dispatch_id: 'd2', boxesTotal: 2, boxesLoaded: 0 }),
    ];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 10 })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    // Total bultos across the route (3 + 2 = 5), not order count (2).
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
  });

  it('shows the over-capacity marker once the route\'s package count exceeds the selected vehicle\'s capacity', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', boxesTotal: 12 })];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 10 })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    expect(screen.getByTestId('vehicle-capacity-overcapacity')).toBeInTheDocument();
  });

  it('switches back to rendering nothing when the manager clears the vehicle selection', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', boxesTotal: 5 })];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 10 })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    expect(screen.getByTestId('vehicle-capacity-fill')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox'), '');
    expect(screen.queryByTestId('vehicle-capacity-fill')).not.toBeInTheDocument();
  });
});

/**
 * spec-73 phase 4c review — findings 1 and 2.
 */
describe('RouteBuilder — vehicle capacity fill bar, review findings', () => {
  it('renders nothing while the packages read has not succeeded — never a fabricated 0% on a truck whose load is unknown', async () => {
    // A failed or still-loading useRoutePackages leaves `packages` at [],
    // which sums to a package count of 0 that is indistinguishable from a
    // genuinely empty route. Painting "0 / 40 · Bajo cupo · 0%" there tells
    // the manager an unknown — possibly full — truck is empty, directly
    // above TopupSuggestions urging them to add more to it.
    mockPackagesLoaded = false;
    mockPackages = [];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 40 })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    expect(screen.queryByTestId('vehicle-capacity-fill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-capacity-underfilled')).not.toBeInTheDocument();
  });

  it('names the bar’s unit, so it cannot be read as the order count directly above it', async () => {
    // Two bultos-worth of a single order: the "Órdenes en la ruta" row says
    // 1, the bar says 5 — different units, adjacent on screen.
    mockPackages = [pkg({ dispatch_id: 'd1', boxesTotal: 5 })];
    render(
      <RouteBuilder
        routeId="r1"
        operatorId="op-1"
        vehicles={[vehicle({ id: 'v1', external_vehicle_id: 'CAM-1', capacity_packages: 10 })]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'CAM-1');
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-capacity-unit')).toHaveTextContent('bultos');
  });
});
