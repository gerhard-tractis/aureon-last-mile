import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import RouteReceptionPage from './page';
import { routeReceptionSnapshotFixture } from '@/test/fixtures/routeReceptionSnapshot';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ routeId: 'r1' }),
  useRouter: () => ({ push: mockPush }),
}));

const mockSnapshot = vi.fn();
const mockScanMutate = vi.fn();
const mockCompleteMutate = vi.fn();

vi.mock('@/hooks/reception/useIncomingRoutes', () => ({
  // Only the in_transit list carries the route being counted; the switcher
  // renders its progress bar, which is where reception progress now lives.
  useIncomingRoutes: (_op: string | null, status: string) => ({
    data:
      status === 'in_transit'
        ? [
            {
              id: 'r1',
              code: 'PR-2026-0001',
              driver_id: 'd1',
              driver_name: 'Ana',
              plate: 'ABCD-12',
              in_transit_at: null,
              started_at: null,
              manifest_count: 2,
              expected_packages: 3,
            },
          ]
        : [],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: () => ({
    status: 'online',
    queuedCount: 0,
    recent: [],
    retryNow: vi.fn(),
    isRetrying: false,
  }),
}));

vi.mock('@/hooks/reception/useRouteReceptionSnapshot', () => ({
  useRouteReceptionSnapshot: () => mockSnapshot(),
}));
vi.mock('@/hooks/reception/useReceptionScan', () => ({
  useReceptionScan: () => ({ mutate: mockScanMutate, isPending: false }),
}));
vi.mock('@/hooks/reception/useCompleteRouteReception', () => ({
  useCompleteRouteReception: () => ({ mutate: mockCompleteMutate, isPending: false }),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockReopenMutate = vi.fn();
vi.mock('@/hooks/reception/useReopenRouteReception', () => ({
  useReopenRouteReception: () => ({ mutate: mockReopenMutate, isPending: false }),
}));

// spec-62 task 19 — the page branches its whole tree on this hook, exactly
// like /app/reception/page.tsx already does. The global setup mocks
// `window.matchMedia` with `matches: false` for every query (src/test/setup.ts),
// so `useIsBelowLg()` is `false` unless stubbed here — that default is what
// keeps every pre-existing test above rendering the desktop tree unmodified.
const mockUseIsBelowLg = vi.fn(() => false);
vi.mock('@/hooks/useViewport', () => ({
  useIsBelowLg: () => mockUseIsBelowLg(),
}));

// NOT a hand-written literal any more. The previous inline `baseSnapshot` was
// untyped, so it silently used keys the RPC did not return — these tests were
// green for six months while the page threw TypeError on render in production.
// The shared fixture is `satisfies RouteReceptionSnapshot`, so it can no longer
// drift from the interface without type-check failing. See the fixture header.
const baseSnapshot = routeReceptionSnapshotFixture;

describe('RouteReceptionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshot.mockReturnValue({ data: baseSnapshot, isLoading: false, error: null });
    mockUseIsBelowLg.mockReturnValue(false);
  });

  // Guards against fake timers leaking into later tests: if either
  // assertion in the timer test below throws, a `vi.useRealTimers()` as
  // that test's own last statement would never run.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the route header with code', () => {
    render(<RouteReceptionPage />);
    // The code now sits inside the page heading rather than a separate header.
    expect(
      screen.getByRole('heading', { name: /Ruta PR-2026-0001 · conteo en recepción/ }),
    ).toBeInTheDocument();
  });

  it('renders the consolidated order-grouped list', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByText('Pedido #101')).toBeInTheDocument();
    expect(screen.getByText('Pedido #202')).toBeInTheDocument();
  });

  // Regression guards for the spec-47 contract defect. Both of these read
  // fields the RPC was not returning: `route_reception.*` (read in JSX, so it
  // threw on render) and `expected_packages[].id` (emitted as `package_id`, so
  // no package could ever tick received).
  it('renders the reception progress from route_reception counts', () => {
    render(<RouteReceptionPage />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });

  it('marks a package received by matching expected_packages[].id to scans[].package_id', () => {
    const { container } = render(<RouteReceptionPage />);
    const scanned = container.querySelector('[data-package-id="pkg-1"]');
    expect(scanned).toHaveAttribute('data-received', 'true');
    expect(container.querySelector('[data-package-id="pkg-2"]')).toHaveAttribute(
      'data-received',
      'false',
    );
  });

  it('renders the scanner input', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByLabelText('Escáner de recepción')).toBeInTheDocument();
  });

  it('renders the finalize button', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByRole('button', { name: /finalizar recepción/i })).toBeInTheDocument();
  });

  it('hides the reopen button once packages have been received', () => {
    render(<RouteReceptionPage />);
    expect(screen.queryByRole('button', { name: /reabrir ruta/i })).not.toBeInTheDocument();
  });

  it('mounts the reopen button while the batch is still empty', () => {
    mockSnapshot.mockReturnValue({
      data: {
        ...baseSnapshot,
        route_reception: { ...baseSnapshot.route_reception, received_count: 0 },
      },
      isLoading: false,
      error: null,
    });
    render(<RouteReceptionPage />);
    expect(screen.getByRole('button', { name: /reabrir ruta/i })).toBeInTheDocument();
    expect(mockReopenMutate).not.toHaveBeenCalled();
  });

  it('renders skeletons while loading', () => {
    mockSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<RouteReceptionPage />);
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    mockSnapshot.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Ruta no encontrada'),
    });
    render(<RouteReceptionPage />);
    expect(screen.getByText('Ruta no encontrada')).toBeInTheDocument();
  });

  // Task 19 — the 3s auto-hide setTimeout in handleScan's onSuccess is gone.
  // An operator who looks at the box and back at the screen must still see
  // where the last read landed; the only way to prove that genuinely is fake
  // timers advanced well past the old 3000ms window.
  it('keeps the scan result on screen long past the old 3s auto-hide window', async () => {
    vi.useFakeTimers();
    mockScanMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess({ scanResult: 'received', packageId: 'p1', packageLabel: 'CL123' });
    });
    render(<RouteReceptionPage />);
    // Flush the `supabase.auth.getUser()` microtask that resolves `userId`
    // before scanning — `handleScan` no-ops silently while it is still null.
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByLabelText('Escáner de recepción');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'CL123' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('Paquete recibido')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('Paquete recibido')).toBeInTheDocument();
  });

  describe('below lg', () => {
    beforeEach(() => {
      mockUseIsBelowLg.mockReturnValue(true);
    });

    it('renders the mobile session tree instead of the desktop tree', async () => {
      render(<RouteReceptionPage />);
      await act(async () => {
        await Promise.resolve();
      });
      // Only ReceptionMobileSession renders the "Confirmar" footer button —
      // the desktop tree's equivalent is FinalizeReceptionButton, whose
      // label reads "finalizar recepción" (asserted absent below).
      expect(screen.getByRole('button', { name: /^Confirmar/ })).toBeInTheDocument();
    });

    it('does not mount any of the desktop-only components', async () => {
      render(<RouteReceptionPage />);
      await act(async () => {
        await Promise.resolve();
      });
      // RouteSwitcherColumn, SyncQueuePanel, ReceptionCounts,
      // ConsolidatedScanList, ReceptionScanner, FinalizeReceptionButton and
      // ReopenRouteButton all hang off the desktop tree only.
      expect(screen.queryByRole('button', { name: /Entrantes/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Cola de sincronización')).not.toBeInTheDocument();
      expect(screen.queryByText('Esperados')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Escáner de recepción')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /finalizar recepción/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reabrir ruta/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Pedido #101')).not.toBeInTheDocument();
    });
  });
});
