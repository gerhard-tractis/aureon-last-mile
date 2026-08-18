import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScanningPage from './page';

// Mock all dependencies
const mockUsePickupScans = vi.fn();
const mockUseScanMutation = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
  useScanMutation: (...args: unknown[]) => mockUseScanMutation(...args),
}));

const mockUseManifestOrders = vi.fn();
vi.mock('@/hooks/pickup/useManifestOrders', () => ({
  useManifestOrders: (...args: unknown[]) => mockUseManifestOrders(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

const mockUseSyncQueue = vi.fn();
vi.mock('@/hooks/useSyncQueue', () => ({
  useSyncQueue: (...args: unknown[]) => mockUseSyncQueue(...args),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: vi.fn() },
}));

// spec-53 — the real hook goes through react-query, which needs a provider
// this suite does not mount. Default OFF so existing assertions are unaffected.
const mockUseModuleEnabled = vi.fn(() => false);
vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: (...args: unknown[]) => mockUseModuleEnabled(...(args as [])),
}));

// `vi.hoisted` so the mock factory below (itself hoisted above these
// imports by vitest) can close over a value tests can still mutate —
// mostly the manifest fixture stays route-less; the scan-failure test
// below needs an active `pickup_route_id` so the spec-47 guard doesn't
// short-circuit before the mutation is ever attempted.
const manifestFixture = vi.hoisted(() => ({
  data: { id: 'm1', total_packages: 10, pickup_route_id: null as string | null },
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              single: () => Promise.resolve(manifestFixture),
            }),
          }),
        }),
      }),
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  }),
}));

vi.mock('@/components/pickup/ScannerInput', () => ({
  ScannerInput: (props: { onScan: (barcode: string) => void }) => (
    <div data-testid="scanner-input">
      <button data-testid="fire-scan" onClick={() => props.onScan('CTN001')}>
        Scan
      </button>
    </div>
  ),
}));

vi.mock('@/components/pickup/ScanHistoryList', () => ({
  ScanHistoryList: () => <div data-testid="scan-history" />,
}));

vi.mock('@/components/pickup/ScanResultPopup', () => ({
  ScanResultPopup: () => null,
}));

vi.mock('@/components/pickup/ScanResultCard', () => ({
  ScanResultCard: () => <div data-testid="scan-result-card" />,
}));

vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: () => <div data-testid="manifest-detail" />,
}));

vi.mock('@/components/pickup/PickupFlowHeader', () => ({
  PickupFlowHeader: (props: { queuedCount: number }) => (
    <div data-testid="flow-header" data-queued-count={props.queuedCount} />
  ),
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('ScanningPage', () => {
  beforeEach(() => {
    manifestFixture.data = { id: 'm1', total_packages: 10, pickup_route_id: null };
    mockUsePickupScans.mockReturnValue({ data: [
      { id: 's1', scan_result: 'verified', package_id: 'p1', barcode_scanned: 'BC001' },
      { id: 's2', scan_result: 'not_found', package_id: null, barcode_scanned: 'BC999' },
    ] });
    mockUseScanMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseManifestOrders.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    mockUseSyncQueue.mockReturnValue({
      status: 'online',
      queuedCount: 0,
      recent: [],
      retryNow: vi.fn(),
      isRetrying: false,
    });
  });

  it('renders Spanish text for "not in manifest" counter', () => {
    render(<ScanningPage />);
    expect(screen.getByText(/no encontrados? en manifiesto/i)).toBeInTheDocument();
  });

  it('renders "Escaneos recientes" section header', () => {
    render(<ScanningPage />);
    expect(screen.getByText('Escaneos recientes')).toBeInTheDocument();
  });

  it('renders "Continuar a revisión" button', () => {
    render(<ScanningPage />);
    expect(screen.getByRole('button', { name: /continuar a revisión/i })).toBeInTheDocument();
  });

  it('renders back button with Spanish aria-label', () => {
    render(<ScanningPage />);
    expect(screen.getByRole('button', { name: /volver a manifiestos/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ScanningPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });

  describe('spec-53 print labels button', () => {
    it('is absent when the PACKAGE_LABELS module is disabled', () => {
      mockUseModuleEnabled.mockReturnValue(false);
      render(<ScanningPage />);
      expect(screen.queryByTestId('print-labels-scan')).not.toBeInTheDocument();
    });

    it('is shown once the module is enabled and the manifest has loaded', async () => {
      mockUseModuleEnabled.mockReturnValue(true);
      render(<ScanningPage />);
      expect(await screen.findByTestId('print-labels-scan')).toBeInTheDocument();
      expect(screen.getByText(/imprimir etiquetas/i)).toBeInTheDocument();
    });

    it('opens the print route for the loaded manifest in a new tab', async () => {
      mockUseModuleEnabled.mockReturnValue(true);
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<ScanningPage />);
      (await screen.findByTestId('print-labels-scan')).click();
      expect(openSpy).toHaveBeenCalledWith(
        '/app/pickup/manifests/m1/labels/print',
        '_blank',
        'noopener',
      );
      openSpy.mockRestore();
    });
  });

  describe('spec-54 mock 1h — offline queue wiring', () => {
    it('forwards the real queued count from useSyncQueue to the header badge', () => {
      mockUseSyncQueue.mockReturnValue({
        status: 'offline',
        queuedCount: 27,
        recent: [],
        retryNow: vi.fn(),
        isRetrying: false,
      });
      render(<ScanningPage />);
      expect(screen.getByTestId('flow-header')).toHaveAttribute('data-queued-count', '27');
    });
  });

  describe('spec-47 guard', () => {
    it('blocks the scan and tells the driver to start a route, without touching the mutation', async () => {
      // The manifests fixture mocked above never returns a pickup_route_id,
      // so pickupRouteId is null — exactly the "no active route" state.
      const mutate = vi.fn();
      mockUseScanMutation.mockReturnValue({ mutate, isPending: false });
      render(<ScanningPage />);

      (await screen.findByTestId('fire-scan')).click();

      expect(mutate).not.toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(
        'Inicia una ruta de retiro primero',
        expect.objectContaining({ action: expect.any(Object) })
      );
    });
  });

  describe('scan failure feedback', () => {
    it('tells the operator the scan did not register when the mutation fails', async () => {
      // Give this scenario an active route so the spec-47 guard doesn't
      // short-circuit before the mutation is ever attempted.
      manifestFixture.data = { id: 'm1', total_packages: 10, pickup_route_id: 'pr-1' };
      mockUseScanMutation.mockReturnValue({
        mutate: (
          _input: unknown,
          handlers?: { onError?: (error: Error) => void }
        ) => handlers?.onError?.(new Error('network down')),
        isPending: false,
      });
      // The manifest lookup that sets pickupRouteId is async. Reuse the
      // labels-enabled gate (manifestId-dependent, already exercised above)
      // purely as a wait condition: once it's visible, the same effect has
      // also finished setting pickupRouteId, so the click below is
      // guaranteed to exercise the mutation path rather than race the guard.
      mockUseModuleEnabled.mockReturnValue(true);

      render(<ScanningPage />);
      await screen.findByTestId('print-labels-scan');
      (await screen.findByTestId('fire-scan')).click();

      expect(mockToastError).toHaveBeenCalledWith(
        'El escaneo no se registró. Verifica tu conexión e inténtalo de nuevo.'
      );
    });
  });
});
