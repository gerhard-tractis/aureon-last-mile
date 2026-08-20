import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PickupPage from './page';

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
  },
];

const mockUsePendingManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
const mockUseInTransitManifests = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
  useInTransitManifests: (...args: unknown[]) => mockUseInTransitManifests(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

let mockLabelsEnabled = false;
vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: () => mockLabelsEnabled,
}));

let mockActiveRoute: { id: string; code: string; started_at: string } | null = null;
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => ({ data: mockActiveRoute, isLoading: false }),
}));
vi.mock('@/hooks/pickup/useStartPickupRoute', () => ({
  useStartPickupRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const mockUseRouteManifests = vi.fn();
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: (...args: unknown[]) => mockUseRouteManifests(...args),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

vi.mock('@/components/pickup/StartRouteButton', () => ({
  StartRouteButton: () => <button type="button">Crear ruta</button>,
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
    mockSupabaseFrom.mockClear();
    mockActiveRoute = null;
    mockLabelsEnabled = false;
    mockUsePendingManifests.mockReturnValue({ data: mockPending, isLoading: false });
    mockUseCompletedManifests.mockReturnValue({ data: mockCompleted, isLoading: false });
    mockUseInTransitManifests.mockReturnValue({ data: mockInTransit, isLoading: false });
    mockUseRouteManifests.mockReturnValue({ data: [], isLoading: false });
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
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString() };
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
    it('renders the three tabs in Spanish with counts', () => {
      render(<PickupPage />);
      expect(screen.getByRole('button', { name: 'Pendientes · 2' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'En tránsito · 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Completados · 1' })).toBeInTheDocument();
    });

    it('shows in-transit manifests when that tab is selected', async () => {
      render(<PickupPage />);
      expect(screen.queryByText('CARGA-INT-1')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'En tránsito · 1' }));
      expect(screen.getByText('CARGA-INT-1')).toBeInTheDocument();
    });

    it('offers selection only on the pending tab', async () => {
      render(<PickupPage />);
      expect(screen.getAllByTestId('manifest-row')[0]).toHaveAttribute('aria-checked');
      await userEvent.click(screen.getByRole('button', { name: 'Completados · 1' }));
      expect(screen.getAllByTestId('manifest-row')[0]).not.toHaveAttribute('aria-checked');
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
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString() };
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
      mockActiveRoute = { id: 'route-9', code: 'PR-2026-0042', started_at: new Date().toISOString() };
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
});
