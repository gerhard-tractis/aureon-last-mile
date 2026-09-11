import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PickupPage from './page';
import type { RouteCrewMember } from '@/hooks/pickup/useActivePickupRoute';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockPending = [
  {
    id: 'm1',
    external_load_id: 'CARGA-001',
    retailer_name: 'Easy',
    order_count: 5,
    package_count: 12,
    created_at: '2026-04-09T10:00:00Z',
    pickup_point: 'Easy Vespucio',
    verified_count: 0,
  },
  {
    id: 'm2',
    external_load_id: 'CARGA-002',
    retailer_name: 'Sodimac',
    order_count: 3,
    package_count: 8,
    created_at: '2026-04-09T11:00:00Z',
    pickup_point: 'Sodimac Puente Alto',
    verified_count: 0,
  },
];
const mockCompleted = [
  {
    id: 'c1',
    external_load_id: 'CARGA-000',
    retailer_name: 'Easy',
    total_orders: 2,
    total_packages: 4,
    completed_at: new Date().toISOString(),
  },
];
const mockInTransit = [
  {
    id: 'i1',
    external_load_id: 'CARGA-INT-1',
    retailer_name: 'Falabella',
    total_orders: 7,
    total_packages: 14,
    reception_status: 'awaiting_reception',
    updated_at: new Date().toISOString(),
    // ronda 4 (review fase 2) — get_in_transit_manifests now returns these
    // too (a load closed at the dock whose route then moved to in_transit
    // still needs "Cierres de hoy"). Null/0 here: this default fixture
    // load hasn't closed.
    closed_at: null,
    missing_count: 0,
  },
];
// spec-94 fase 2 — the routed tab's fixture (cubo 2). Empty by default so
// every pre-existing test (none of which cares about it) is unaffected.
const mockRouted: unknown[] = [];

const mockUsePendingManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
const mockUseInTransitManifests = vi.fn();
// spec-80 fase 2b (ronda 3) — the rescue banner's real, SEPARATE data
// source (get_signature_rescue_manifests, scoped to this user + 30 days),
// not useCompletedManifests (operator-wide, unbounded — desktop's history
// tab). Defaults to an empty, resolved state so every pre-existing test in
// this file (none of which cares about the rescue banner) is unaffected.
const mockUseSignatureRescueManifests = vi.fn();
const mockRefetchRescue = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
  useInTransitManifests: (...args: unknown[]) => mockUseInTransitManifests(...args),
  useSignatureRescueManifests: (...args: unknown[]) => mockUseSignatureRescueManifests(...args),
}));

// spec-94 fase 1/2 — the fourth query, get_routed_manifests (cubo 2).
// Mocked at the module boundary like its siblings above, so the real
// useRoutedManifests.ts (which imports PICKUP_QUERY_OPTIONS from
// useManifests.ts, itself mocked without that export) never actually runs.
const mockUseRoutedManifests = vi.fn();
vi.mock('@/hooks/pickup/useRoutedManifests', () => ({
  useRoutedManifests: (...args: unknown[]) => mockUseRoutedManifests(...args),
}));

// spec-61 Task 5: this page now reads `role` (3j vs the crew screen, and
// `1l`'s start affordance) and `userId` (whose route is this).
const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

// spec-94 fase 3 — RoutedManifestTable now calls this hook itself (for
// "Quitar de la ruta"), which calls useQueryClient() internally. This page
// test never wraps in QueryClientProvider (every other query-backed hook on
// this page is mocked the same way), so the real hook would throw "No
// QueryClient set" the moment the routed tab renders a row.
vi.mock('@/hooks/pickup/useRemoveManifestFromRoute', () => ({
  useRemoveManifestFromRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));

// 3j's crew picker.
vi.mock('@/hooks/pickup/useCrewCandidates', () => ({
  useCrewCandidates: () => ({ data: [], isLoading: false }),
}));

let mockLabelsEnabled = false;
vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: () => mockLabelsEnabled,
}));

// `crew` is REQUIRED on ActivePickupRoute (spec-61 Task 4) and is read
// unguarded by PickupRouteCrewStrip, so it belongs in this fixture's type
// rather than being optional: the vi.mock factory's return is `any`, so
// leaving it off means tsc stays silent and the omission only surfaces as a
// render-time TypeError. Naming it here makes the compiler enforce every
// assignment below.
let mockActiveRoute: {
  id: string;
  code: string;
  started_at: string;
  crew: RouteCrewMember[];
} | null = null;
let mockActiveRouteError = false;
const mockRefetchActiveRoute = vi.fn();
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => ({
    data: mockActiveRoute,
    isLoading: false,
    isError: mockActiveRouteError,
    refetch: mockRefetchActiveRoute,
  }),
}));
// spec-61 Task 5: `mutate` is a hoisted spy rather than an inline vi.fn() so
// a test can DRIVE its onSuccess callback. Everything the success path does
// -- the partial-attach toast, clearing the selection, the navigation --
// lives inside that callback, and with a bare vi.fn() it never ran, so none
// of it was covered.
const mockStartMutate = vi.fn();
vi.mock('@/hooks/pickup/useStartPickupRoute', () => ({
  useStartPickupRoute: () => ({ mutate: mockStartMutate, isPending: false, error: null }),
}));
const mockAddMutateAsync = vi.fn();
vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutateAsync: mockAddMutateAsync, isPending: false }),
}));
const mockUseRouteManifests = vi.fn();
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: (...args: unknown[]) => mockUseRouteManifests(...args),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) },
}));

// PickupMobileStartRoute (3j) renders VehicleSelect, which needs a real
// QueryClientProvider unless the vehicle hooks are mocked — same pattern
// used by VehicleSelect.test.tsx / PickupMobileView.test.tsx.
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

vi.mock('@/hooks/useCurrentUserName', () => ({
  useCurrentUserName: () => ({ data: 'Marcela R.' }),
}));

vi.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A spy, not `{}` — item 1's regression test needs to positively assert
// that tapping a mobile route-manifest card never touches Supabase at all
// (the fix for the total_orders/total_packages corruption bug is to make
// that tap navigation-only).
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockSupabaseFrom }),
}));

vi.mock('@/components/pickup/CameraIntake', () => ({
  CameraIntake: () => <div data-testid="camera-intake" />,
}));

vi.mock('@/components/pickup/ClientFilter', () => ({
  ClientFilter: () => null,
}));

// Now actually wired: the real button pops a vehicle dialog, which this
// file has no business driving, but a stub that never calls `onStart` made
// the whole create-route path unreachable from here.
vi.mock('@/components/pickup/StartRouteButton', () => ({
  StartRouteButton: ({ onStart }: { onStart: (vehicleId: string) => void }) => (
    <button type="button" onClick={() => onStart('veh-1')}>
      Crear ruta
    </button>
  ),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/pickup',
}));

// ── Tests ────────────────────────────────────────────────────────────────────
describe('PickupPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockStartMutate.mockReset();
    mockAddMutateAsync.mockReset();
    mockAddMutateAsync.mockResolvedValue(undefined);
    mockToastError.mockClear();
    mockSupabaseFrom.mockClear();
    mockActiveRoute = null;
    mockActiveRouteError = false;
    mockRefetchActiveRoute.mockClear();
    mockLabelsEnabled = false;
    mockUseOperatorId.mockReturnValue({
      operatorId: 'op-1',
      // Every pre-spec-61 test in this file expects the start affordances,
      // which are now leader-only on both surfaces.
      role: 'pickup_leader',
      permissions: [],
      userId: 'user-me',
    });
    mockUsePendingManifests.mockReturnValue({ data: mockPending, isLoading: false });
    mockUseCompletedManifests.mockReturnValue({ data: mockCompleted, isLoading: false });
    mockUseInTransitManifests.mockReturnValue({ data: mockInTransit, isLoading: false });
    mockUseRoutedManifests.mockReturnValue({ data: mockRouted, isLoading: false });
    mockUseRouteManifests.mockReturnValue({ data: [], isLoading: false });
    mockRefetchRescue.mockClear();
    mockUseSignatureRescueManifests.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
      refetch: mockRefetchRescue,
    });
  });

  describe('Header', () => {
    it('renders the Recogida heading and a live subtitle', () => {
      render(<PickupPage />);
      expect(screen.getByRole('heading', { name: 'Recogida' })).toBeInTheDocument();
      expect(screen.getByText(/manifiestos por retirar/)).toBeInTheDocument();
    });
  });

  describe('Active route banner', () => {
    it('does not render a QR link when there is no active route', () => {
      render(<PickupPage />);
      expect(screen.queryByRole('link', { name: /qr/i })).not.toBeInTheDocument();
    });

    it('passes the active route id through so the QR link points at that route', () => {
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString(), crew: [] };
      render(<PickupPage />);
      // The code shows in the banner and again in the draft panel's
      // "already have a route open" notice.
      expect(screen.getAllByText('R-2492').length).toBeGreaterThan(0);
    });
  });

  describe('KPI tiles', () => {
    it('reports manifests, orders, packages and today closures', () => {
      render(<PickupPage />);
      // 2 manifests, 5+3 orders, 12+8 packages, 1 completed today.
      // "Órdenes" is also a table header, so scope to the tiles.
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;

      expect(tile('Manifiestos pendientes')).toHaveTextContent('2');
      expect(tile('Órdenes')).toHaveTextContent('8');
      expect(tile('Paquetes totales')).toHaveTextContent('20');
      expect(tile('Completados hoy')).toHaveTextContent('1');
    });
  });

  describe('Tabs', () => {
    // spec-94 fase 2 — renamed to match "El modelo de estados": Por retirar
    // / En punto de retiro / Camino a bodega / En bodega. Internal TabKeys
    // (pending/routed/in_transit/completed) are unchanged — only these
    // Spanish literals moved.
    it('renders the four tabs in Spanish with counts', () => {
      render(<PickupPage />);
      expect(screen.getByRole('button', { name: 'Por retirar · 2' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'En punto de retiro · 0' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Camino a bodega · 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'En bodega · 1' })).toBeInTheDocument();
    });

    it('shows in-transit manifests when that tab is selected', async () => {
      render(<PickupPage />);
      expect(screen.queryByText('CARGA-INT-1')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Camino a bodega · 1' }));
      expect(screen.getByText('CARGA-INT-1')).toBeInTheDocument();
    });

    it('offers selection only on the pending tab', async () => {
      render(<PickupPage />);
      expect(screen.getAllByTestId('manifest-row')[0]).toHaveAttribute('aria-checked');
      await userEvent.click(screen.getByRole('button', { name: 'En bodega · 1' }));
      expect(screen.getAllByTestId('manifest-row')[0]).not.toHaveAttribute('aria-checked');
    });

    // spec-94 fase 2 — the routed tab renders through RoutedManifestTable,
    // not ManifestTable, and shows its own row shape (route code, driver,
    // "abierta hace").
    //
    // Review ronda 2 (fase 3) — RoutedManifestTable now calls
    // useQueryClient() directly (for the stale-error refetch, decisión B),
    // so this render needs a real QueryClient — the only test in this file
    // that reaches RoutedManifestTable.
    it('shows the routed table, not ManifestTable, on the routed tab', async () => {
      mockUseRoutedManifests.mockReturnValue({
        data: [
          {
            id: 'r1',
            external_load_id: 'CARGA-ROUTED-1',
            retailer_name: 'Ripley',
            total_orders: 2,
            total_packages: 6,
            created_at: new Date().toISOString(),
            pickup_point: 'Ripley Costanera',
            labels_printed_at: null,
            labels_printed_by_name: null,
            route_code: 'PR-2026-0099',
            route_started_at: new Date().toISOString(),
            driver_name: 'Marcela R.',
            route_status: 'in_progress',
            closed_at: null,
            missing_count: 0,
            verified_count: 1,
            // Ronda 2 de review — hallazgo real: sin este campo, la fila
            // renderiza href="/app/pickup/route/undefined/qr" y nada lo
            // afirmaba. route-99 elegido para que la aserción de abajo no
            // pueda confundirse con un accidente de otro campo del fixture.
            pickup_route_id: 'route-99',
          },
        ],
        isLoading: false,
      });
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <PickupPage />
        </QueryClientProvider>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'En punto de retiro · 1' }));
      expect(screen.getByText('CARGA-ROUTED-1')).toBeInTheDocument();
      expect(screen.getByText('PR-2026-0099')).toBeInTheDocument();
      expect(screen.queryAllByTestId('manifest-row')).toHaveLength(0);
      expect(screen.getByRole('link', { name: 'QR de entrega' })).toHaveAttribute(
        'href',
        '/app/pickup/route/route-99/qr',
      );
    });
  });

  describe('Route assembly', () => {
    it('prompts for a selection before anything is ticked', () => {
      render(<PickupPage />);
      expect(screen.getByText(/Marca los manifiestos de la tabla/)).toBeInTheDocument();
    });

    it('moves a ticked manifest into the draft panel', async () => {
      render(<PickupPage />);
      await userEvent.click(screen.getByText('Easy Vespucio'));
      expect(screen.getByTestId('draft-manifest')).toBeInTheDocument();
      expect(screen.getByText(/5 órdenes · 12 paquetes/)).toBeInTheDocument();
    });

    it('refuses to assemble a second route while one is open', () => {
      // start_pickup_route enforces one active route per driver, so offering
      // to create another is offering an error.
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString(), crew: [] };
      render(<PickupPage />);
      expect(screen.getByText(/Ciérrala antes de armar otra/)).toBeInTheDocument();
    });
  });

  describe('Label printing (spec-53)', () => {
    it('is absent when the module is off', () => {
      render(<PickupPage />);
      expect(screen.queryByRole('button', { name: /imprimir etiquetas/i })).not.toBeInTheDocument();
    });

    it('is reachable per row when the module is on', () => {
      mockLabelsEnabled = true;
      render(<PickupPage />);
      expect(
        screen.getByRole('button', { name: 'Imprimir etiquetas de CARGA-001' }),
      ).toBeInTheDocument();
    });
  });

  describe("Today's closures", () => {
    it('lists what closed today', () => {
      render(<PickupPage />);
      const panel = screen.getByText('Cierres de hoy').closest('section')!;
      expect(within(panel).getByText('CARGA-000')).toBeInTheDocument();
    });

    // ronda 4 (review fase 2) — this is the wiring test the reviewer named
    // explicitly: with mockRouted empty by default, dropping the second
    // argument to completedToday(completed, routed, inTransit) at page.tsx
    // stayed green everywhere else. Assert the StatTile AND the panel
    // content, not just that a function got called with something.
    it('includes a load closed at the dock (routed, cubo 2) in the StatTile and the panel, with its missing_count', () => {
      mockUseRoutedManifests.mockReturnValue({
        data: [
          {
            id: 'r-dock',
            external_load_id: 'CARGA-DOCK-CLOSED',
            retailer_name: 'Ripley',
            total_orders: 3,
            total_packages: 6,
            created_at: new Date().toISOString(),
            pickup_point: 'Ripley Costanera',
            labels_printed_at: null,
            labels_printed_by_name: null,
            route_code: 'PR-2026-0011',
            route_started_at: new Date().toISOString(),
            driver_name: 'Marcela R.',
            route_status: 'in_progress',
            closed_at: new Date().toISOString(),
            missing_count: 3,
            verified_count: 6,
          },
        ],
        isLoading: false,
      });
      render(<PickupPage />);
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;
      // 1 (mockCompleted's CARGA-000) + 1 (the routed closure just added).
      expect(tile('Completados hoy')).toHaveTextContent('2');
      const panel = screen.getByText('Cierres de hoy').closest('section')!;
      expect(within(panel).getByText('CARGA-DOCK-CLOSED')).toBeInTheDocument();
      expect(within(panel).getByText(/3 faltantes/)).toBeInTheDocument();
    });

    // Same wiring test for the third source (cubo 3) — the one the review
    // found missing entirely on the first pass of this fase.
    it('includes a load closed at the dock whose route moved to in_transit (cubo 3) in the StatTile and the panel', () => {
      mockUseInTransitManifests.mockReturnValue({
        data: [
          {
            ...mockInTransit[0],
            id: 't-dock',
            external_load_id: 'CARGA-TRANSIT-CLOSED',
            closed_at: new Date().toISOString(),
            missing_count: 2,
          },
        ],
        isLoading: false,
      });
      render(<PickupPage />);
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;
      expect(tile('Completados hoy')).toHaveTextContent('2');
      const panel = screen.getByText('Cierres de hoy').closest('section')!;
      expect(within(panel).getByText('CARGA-TRANSIT-CLOSED')).toBeInTheDocument();
      expect(within(panel).getByText(/2 faltantes/)).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('explains an empty pending tab', () => {
      mockUsePendingManifests.mockReturnValue({ data: [], isLoading: false });
      render(<PickupPage />);
      expect(screen.getByText('No hay manifiestos pendientes de retiro.')).toBeInTheDocument();
    });
  });

  // spec-54 3h review fix — the responsive switch itself was previously
  // untested; the desktop guarantee rested entirely on the global
  // `matches: false` matchMedia stub in src/test/setup.ts. These tests would
  // fail if that global stub ever flipped to `matches: true`.
  describe('Responsive layout switch (mobile 3h vs desktop 1l)', () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });

    function mockBelowLg(isBelowLg: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('1023px') ? isBelowLg : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    it('mounts the mobile card view below the lg breakpoint, and not the desktop table', () => {
      mockBelowLg(true);
      render(<PickupPage />);
      expect(screen.getByTestId('pickup-mobile-view')).toBeInTheDocument();
      expect(screen.queryAllByTestId('manifest-row')).toHaveLength(0);
    });

    it('mounts the desktop table at/above the lg breakpoint, and not the mobile view', () => {
      mockBelowLg(false);
      render(<PickupPage />);
      expect(screen.queryByTestId('pickup-mobile-view')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('manifest-row').length).toBeGreaterThan(0);
    });

    // item 8 — mobile has no "en tránsito" tab and never reads this data,
    // so the query is skipped entirely on a phone instead of fetched and
    // discarded.
    it('skips the in-transit query on mobile but keeps it on desktop', () => {
      mockBelowLg(true);
      render(<PickupPage />);
      expect(mockUseInTransitManifests).toHaveBeenLastCalledWith('op-1', false);

      mockBelowLg(false);
      render(<PickupPage />);
      expect(mockUseInTransitManifests).toHaveBeenLastCalledWith('op-1', true);
    });

    it('defaults to the desktop table when matchMedia is unmocked (matches the global test stub)', () => {
      render(<PickupPage />);
      expect(screen.queryByTestId('pickup-mobile-view')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('manifest-row').length).toBeGreaterThan(0);
    });

    // spec-54 3h redesign — "Nuevo Manifiesto" is a dispatcher/intake
    // action, dropped from the mobile screen (not in the mock; that screen
    // is for a driver starting a route). Regression test for review round
    // 2 item 5: mutation testing flipped `!isBelowLg` to `isBelowLg` in
    // page.tsx and every other test still passed 19/19.
    it('shows "Nuevo Manifiesto" on desktop and hides it on mobile', () => {
      mockBelowLg(false);
      render(<PickupPage />);
      expect(
        screen.getByRole('button', { name: 'pickup.nuevo_manifiesto' }),
      ).toBeInTheDocument();
      cleanup();

      mockBelowLg(true);
      render(<PickupPage />);
      expect(
        screen.queryByRole('button', { name: 'pickup.nuevo_manifiesto' }),
      ).not.toBeInTheDocument();
    });

    // Coordinator fix, found live in QA at 390px: the page-level
    // `<h1>Recogida</h1>` + "N manifiestos por retirar" subtitle stacked on
    // top of PickupMobileView's own PickupMobileHeader ("Recogidas de hoy").
    // Only one heading may render on mobile; the desktop header must still
    // render at `lg`+.
    it('renders exactly one heading on mobile, and the desktop page header at lg+', () => {
      mockBelowLg(true);
      render(<PickupPage />);
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'Recogida' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recogidas de hoy' })).toBeInTheDocument();
      cleanup();

      mockBelowLg(false);
      render(<PickupPage />);
      expect(screen.getByRole('heading', { name: 'Recogida' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Recogidas de hoy' })).not.toBeInTheDocument();
    });
  });

  // spec-54 3h review fix (round 2, critical #1) — tapping a mobile card
  // for a manifest already on the active route must still flip
  // status/started_at (same as the desktop path — started_at drives the
  // pickup/complete duration figure and has no other writer), but must
  // NEVER write total_orders/total_packages: the old code reused
  // handleRowOpen wholesale, which would coerce a genuine NULL (unknown
  // total, e.g. QA-CARGA-C) into 0 — permanently. Round 2 over-corrected by
  // dropping the write entirely; round 3 restores status/started_at only.
  describe('Mobile — opening a route manifest (regression, item 1)', () => {
    const originalMatchMedia = window.matchMedia;

    function chainResolving(data: unknown[]) {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['select', 'eq', 'is', 'update']) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.limit = vi.fn().mockResolvedValue({ data, error: null });
      return chain;
    }

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });

    beforeEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('1023px'),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
      mockActiveRoute = { id: 'route-9', code: 'PR-2026-0042', started_at: new Date().toISOString(), crew: [] };
      mockUseRouteManifests.mockReturnValue({
        data: [
          {
            id: 'rm1',
            external_load_id: 'CARGA-NULL-TOTAL',
            retailer_name: 'Easy',
            pickup_location: 'Bodega Central',
            total_orders: 3,
            // The exact case that was getting corrupted: intake never
            // recorded a package count.
            total_packages: null,
            verified_count: 0,
            status: 'pending',
          },
        ],
        isLoading: false,
      });
    });

    it('tapping the hero card with an unknown total_packages writes status/started_at only, then navigates', async () => {
      const manifestsChain = chainResolving([{ id: 'db-id-1', status: 'pending' }]);
      mockSupabaseFrom.mockReturnValue(manifestsChain);

      render(<PickupPage />);
      await userEvent.click(screen.getByRole('button', { name: /iniciar recogida/i }));

      expect(mockPush).toHaveBeenCalledWith('/app/pickup/scan/CARGA-NULL-TOTAL');
      expect(manifestsChain.update).toHaveBeenCalledTimes(1);
      const written = manifestsChain.update.mock.calls[0][0];
      expect(written).toMatchObject({ status: 'in_progress' });
      expect(written.started_at).toEqual(expect.any(String));
      // The regression this round fixes: total_packages must never be
      // coerced from null to 0 by this write.
      expect(written).not.toHaveProperty('total_orders');
      expect(written).not.toHaveProperty('total_packages');
    });
  });

  // ronda 4 (review fase 2), bloqueante 2 — this exact regression had NO
  // test before this round: `page.tsx`'s handleRowOpen guard
  // (`row.orderCount !== null && row.packageCount !== null`) could be
  // reverted to `row.orderCount!`/`row.packageCount!` and all 6634 tests
  // stayed green, because nothing here exercised handleRowOpen's write at
  // all. Desktop equivalent of the mobile regression test above — clicking
  // a row's load id (not the row itself, which only toggles selection)
  // opens the scan flow and writes through openPendingManifest.
  describe('Desktop — opening a manifest never writes a fabricated total (ronda 4 review, bloqueante 2)', () => {
    const originalMatchMedia = window.matchMedia;

    function chainResolving(data: unknown[]) {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['select', 'eq', 'is', 'update']) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.limit = vi.fn().mockResolvedValue({ data, error: null });
      return chain;
    }

    function mockDesktop() {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });

    it('does not include total_orders/total_packages when order_count is null (pending tab)', async () => {
      mockDesktop();
      mockUsePendingManifests.mockReturnValue({
        data: [{ ...mockPending[0], order_count: null, package_count: null }],
        isLoading: false,
      });
      const manifestsChain = chainResolving([{ id: 'db-id-1', status: 'pending' }]);
      mockSupabaseFrom.mockReturnValue(manifestsChain);

      render(<PickupPage />);
      await userEvent.click(screen.getByRole('button', { name: 'CARGA-001' }));

      expect(mockPush).toHaveBeenCalledWith('/app/pickup/scan/CARGA-001');
      expect(manifestsChain.update).toHaveBeenCalledTimes(1);
      const written = manifestsChain.update.mock.calls[0][0];
      expect(written).toMatchObject({ status: 'in_progress' });
      expect(written).not.toHaveProperty('total_orders');
      expect(written).not.toHaveProperty('total_packages');
    });

    it('includes total_orders/total_packages when order_count is a real number (pending tab)', async () => {
      mockDesktop();
      // mockPending[0] carries order_count: 5, package_count: 12.
      const manifestsChain = chainResolving([{ id: 'db-id-1', status: 'pending' }]);
      mockSupabaseFrom.mockReturnValue(manifestsChain);

      render(<PickupPage />);
      await userEvent.click(screen.getByRole('button', { name: 'CARGA-001' }));

      expect(manifestsChain.update).toHaveBeenCalledTimes(1);
      const written = manifestsChain.update.mock.calls[0][0];
      expect(written).toMatchObject({ total_orders: 5, total_packages: 12 });
    });

    // The actual bloqueante: a load NEVER opened (still 'pending' in the
    // DB) that shows up on the in_transit tab because its route moved on
    // without it ever being scanned. Before this round's fix,
    // totalsToRows coalesced its NULL totals to 0 before handleRowOpen's
    // guard ever saw them.
    it('does not include total_orders/total_packages for a never-opened load shown on the in_transit tab', async () => {
      mockDesktop();
      mockUseInTransitManifests.mockReturnValue({
        data: [{ ...mockInTransit[0], total_orders: null, total_packages: null }],
        isLoading: false,
      });
      const manifestsChain = chainResolving([{ id: 'db-id-2', status: 'pending' }]);
      mockSupabaseFrom.mockReturnValue(manifestsChain);

      render(<PickupPage />);
      await userEvent.click(screen.getByRole('button', { name: 'Camino a bodega · 1' }));
      await userEvent.click(screen.getByRole('button', { name: 'CARGA-INT-1' }));

      expect(manifestsChain.update).toHaveBeenCalledTimes(1);
      const written = manifestsChain.update.mock.calls[0][0];
      expect(written).not.toHaveProperty('total_orders');
      expect(written).not.toHaveProperty('total_packages');
    });
  });

  /**
   * spec-61 Task 5 — the two start affordances (`3j` on a phone, the `1l`
   * draft panel on a laptop) both came off one unconditional branch, so a
   * pickup_crew user was invited to open a route `start_pickup_route`
   * refuses by role. They opened a SECOND route for the same van instead of
   * joining their leader's.
   */
  describe('spec-61 — only a leader is offered a route', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });
    function mockBelowLg(isBelowLg: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('1023px') ? isBelowLg : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    function asCrew() {
      mockUseOperatorId.mockReturnValue({
        operatorId: 'op-1',
        role: 'pickup_crew',
        permissions: [],
        userId: 'user-me',
      });
    }

    it('gives a crew member on a phone the ask-your-leader screen, not 3j', () => {
      asCrew();
      mockBelowLg(true);
      render(<PickupPage />);
      expect(screen.getByText(/no tienes una ruta activa/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /iniciar ruta de recogida/i }),
      ).toBeNull();
    });

    it('gives a crew member on a laptop the same answer in the draft panel', async () => {
      asCrew();
      mockBelowLg(false);
      render(<PickupPage />);
      // Tick a manifest — before this gate, a selection was all it took to
      // put the start button on screen. Clicking the ROW, not a checkbox:
      // the desktop table has no checkbox role (ManifestTable.tsx:95), which
      // is how the existing "moves a ticked manifest into the draft panel"
      // test does it too.
      await userEvent.click(screen.getByText('Easy Vespucio'));
      expect(screen.getByText(/solo un líder de ruta puede abrir una ruta/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Crear ruta' })).toBeNull();
    });

    it('still offers a leader the start affordance on both surfaces', async () => {
      mockBelowLg(true);
      render(<PickupPage />);
      expect(
        screen.getByRole('button', { name: /iniciar ruta de recogida/i }),
      ).toBeInTheDocument();
      cleanup();

      mockBelowLg(false);
      render(<PickupPage />);
      await userEvent.click(screen.getByText('Easy Vespucio'));
      expect(screen.getByRole('button', { name: 'Crear ruta' })).toBeInTheDocument();
    });
  });

  /**
   * spec-61 Task 5 — this page read only `data` from useActivePickupRoute.
   * Once React Query exhausts its retries a FAILED lookup is
   * indistinguishable from "no route", so a leader who already had one open
   * was shown 3j and invited to open a second. Task 4 fixed the same hole on
   * route/active/page.tsx.
   */
  describe('spec-61 — a failed route lookup is not an empty one', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });
    function mockBelowLg(isBelowLg: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('1023px') ? isBelowLg : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    it('offers a retry instead of 3j on a phone', async () => {
      mockActiveRouteError = true;
      mockBelowLg(true);
      render(<PickupPage />);
      expect(
        screen.queryByRole('button', { name: /iniciar ruta de recogida/i }),
      ).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      expect(mockRefetchActiveRoute).toHaveBeenCalled();
    });

    it('refuses to offer the draft panel start button on a laptop', async () => {
      mockActiveRouteError = true;
      mockBelowLg(false);
      render(<PickupPage />);
      await userEvent.click(screen.getByText('Easy Vespucio'));
      expect(screen.getByText(/no pudimos cargar tu ruta/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Crear ruta' })).toBeNull();
    });
  });

  /**
   * spec-61 Task 5 — everything the create-route success path does lives in
   * `startMut.mutate`'s onSuccess callback, and this file mocked `mutate` as
   * a bare vi.fn(), so the callback never ran and none of it was covered:
   * not the partial-attach toast, not clearing the selection, not the
   * navigation. attachManifestsToRoute was unit-tested thoroughly and its
   * only consumer was not.
   */
  describe('spec-61 — after the route is created', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });
    function mockDesktop() {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    /** Ticks both pending manifests and fires the (stubbed) start button. */
    async function createRouteWith(onSuccessRoute = { id: 'route-1' }) {
      mockStartMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess: (r: unknown) => Promise<void> }) =>
          opts.onSuccess(onSuccessRoute),
      );
      mockDesktop();
      render(<PickupPage />);
      // Row clicks: the desktop table has no checkbox role
      // (ManifestTable.tsx:95). These are m1 (CARGA-001) and m2 (CARGA-002).
      await userEvent.click(screen.getByText('Easy Vespucio'));
      await userEvent.click(screen.getByText('Sodimac Puente Alto'));
      await userEvent.click(screen.getByRole('button', { name: 'Crear ruta' }));
    }

    it('sends the ticked manifests to the new route, then navigates to it', async () => {
      await createRouteWith();
      // waitFor throughout this block: onSuccess is async and handleCreateRoute
      // does not await it, so the attach round-trip resolves after the click.
      await waitFor(() =>
        expect(mockAddMutateAsync).toHaveBeenCalledWith({ routeId: 'route-1', manifestId: 'm1' }),
      );
      expect(mockAddMutateAsync).toHaveBeenCalledWith({ routeId: 'route-1', manifestId: 'm2' });
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app/pickup/route/active'));
    });

    it('says nothing when every manifest attached', async () => {
      await createRouteWith();
      await waitFor(() => expect(mockPush).toHaveBeenCalled());
      expect(mockToastError).not.toHaveBeenCalled();
    });

    // The defect the review found: a bare count. The selection is cleared and
    // the screen navigates away immediately after, so "1 de 2" left the
    // driver with no way to find out WHICH load they were short.
    it('names the load that did not make it, not just how many', async () => {
      mockAddMutateAsync.mockImplementation(({ manifestId }: { manifestId: string }) =>
        manifestId === 'm2' ? Promise.reject(new Error('ya está en otra ruta')) : Promise.resolve(),
      );
      await createRouteWith();
      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      const msg = String(mockToastError.mock.calls[0][0]);
      expect(msg).toContain('CARGA-002');
      expect(msg).toContain('1 de 2');
      // The route still exists — the message must not read as a total failure.
      expect(mockPush).toHaveBeenCalledWith('/app/pickup/route/active');
    });

    it('clears the selection so the next route does not inherit it', async () => {
      await createRouteWith();
      // The draft panel counts the selection; back at zero it shows the
      // prompt again rather than listing the manifests just consumed.
      await waitFor(() =>
        expect(screen.getByText(/marca los manifiestos de la tabla/i)).toBeInTheDocument(),
      );
      expect(screen.queryAllByTestId('draft-manifest')).toHaveLength(0);
    });
  });

  /**
   * spec-80 fase 2b (ronda 2) — M3 from the review: three mutants survived
   * against this file because nothing here exercised the rescue wiring at
   * the `app` layer (destination, and the loading/unknown/error passthrough)
   * — every prior test for this fase lived in lib/components only. The
   * scenario is deliberately the one B1 proved is the REAL one: no active
   * route (trg_route_receptions_status_sync already flipped it to
   * 'received'), rescue-shaped rows coming from useCompletedManifests
   * (operator-wide), rendered on mobile in the no-route branch.
   */
  describe('spec-80 fase 2b (ronda 2) — el destino real de la entrada de rescate', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    });
    function mockBelowLg(isBelowLg: boolean) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('1023px') ? isBelowLg : false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    const rescueRow = {
      id: 'c-rescue',
      external_load_id: 'CARGA-RESCUE',
      retailer_name: 'Falabella',
      total_orders: 4,
      total_packages: 8,
      completed_at: new Date().toISOString(),
      pickup_point: 'Bodega Norte',
      signature_operator: null,
    };

    beforeEach(() => {
      mockBelowLg(true);
      mockUseOperatorId.mockReturnValue({
        operatorId: 'op-1',
        role: 'pickup_crew',
        permissions: [],
        userId: 'user-me',
      });
      // No active route — B1's real scenario. get_my_active_pickup_route
      // does not return a route once trg_route_receptions_status_sync has
      // flipped it to 'received'.
      mockActiveRoute = null;
    });

    it('navigates to review/[loadId], NOT scan/[loadId], on tap', async () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: [rescueRow],
        isPending: false,
        isError: false,
        fetchStatus: 'idle',
      });
      render(<PickupPage />);
      await userEvent.click(screen.getByText('FALTA FIRMA').closest('button')!);
      expect(mockPush).toHaveBeenCalledWith('/app/pickup/review/CARGA-RESCUE');
      expect(mockPush).not.toHaveBeenCalledWith('/app/pickup/scan/CARGA-RESCUE');
    });

    it('shows the network-pause notice, not the rescue list, while genuinely paused with no signal', () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: [rescueRow],
        isPending: true,
        isError: false,
        fetchStatus: 'paused',
      });
      render(<PickupPage />);
      expect(screen.getByText(/no pudimos comprobar/i)).toBeInTheDocument();
      expect(screen.queryByText('FALTA FIRMA')).toBeNull();
    });

    it('does not show the connection warning during an ordinary initial load', () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: undefined,
        isPending: true,
        isError: false,
        fetchStatus: 'fetching',
      });
      render(<PickupPage />);
      expect(screen.queryByText(/no pudimos comprobar/i)).toBeNull();
    });

    it('shows a distinct error notice once retries are exhausted, not "known, nothing to rescue"', () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: undefined,
        isPending: false,
        isError: true,
        fetchStatus: 'idle',
      });
      render(<PickupPage />);
      expect(screen.getByText(/no pudimos cargar/i)).toBeInTheDocument();
      expect(screen.queryByText('FALTA FIRMA')).toBeNull();
    });

    it('shows nothing extra once resolved with no rescue-shaped manifest', () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: [{ ...rescueRow, signature_operator: 'M. Rojas' }],
        isPending: false,
        isError: false,
        fetchStatus: 'idle',
      });
      render(<PickupPage />);
      expect(screen.queryByText('FALTA FIRMA')).toBeNull();
      expect(screen.queryByText(/no pudimos/i)).toBeNull();
    });

    // A3 (ronda 3) — the retry button must actually call refetch() on the
    // scoped rescue query, not on some other one.
    it('wires "Reintentar" to refetch the rescue query, once retries are exhausted', async () => {
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: undefined,
        isPending: false,
        isError: true,
        fetchStatus: 'idle',
      });
      render(<PickupPage />);
      await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
      expect(mockRefetchRescue).toHaveBeenCalledTimes(1);
    });

    // A2 (ronda 3) — DECIDED: the rescue banner shows even with an active
    // route open. A rescue from a PREVIOUS route does not stop mattering
    // just because today has a new one.
    it('shows the rescue banner even while a different route is active (A2)', () => {
      mockActiveRoute = { id: 'route-today', code: 'PR-2026-0099', started_at: new Date().toISOString(), crew: [] };
      mockUseRouteManifests.mockReturnValue({ data: [], isLoading: false });
      mockUseSignatureRescueManifests.mockReturnValue({
        refetch: mockRefetchRescue,
        data: [rescueRow],
        isPending: false,
        isError: false,
        fetchStatus: 'idle',
      });
      render(<PickupPage />);
      expect(screen.getByText('FALTA FIRMA')).toBeInTheDocument();
    });
  });
});
