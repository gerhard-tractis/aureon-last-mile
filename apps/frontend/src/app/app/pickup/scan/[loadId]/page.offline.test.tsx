/**
 * spec-82 fase 2 — `5d` sin red: una carga descargada se abre desde el
 * caché; una no descargada bloquea la entrada con el mensaje del mock.
 * Fichero separado de `page.test.tsx` sólo por tamaño (regla de 300
 * líneas; ese archivo ya está en 296) — mismos mocks base, mismo patrón.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScanningPage from './page';

vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: () => ({ data: [] }),
  useScanMutation: () => ({ mutate: vi.fn(), isPending: false }),
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

vi.mock('@/hooks/useOfflineQueue', () => ({
  retryBlockedManifest: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: () => false,
}));

// This screen must never reach for the network while blocked/unknown — a
// call here would mean it tried anyway.
const mockSupabaseFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));

const mockOfflineScanSource = vi.fn();
vi.mock('@/hooks/pickup/useOfflineScanSource', () => ({
  useOfflineScanSource: (...args: unknown[]) => mockOfflineScanSource(...args),
}));

vi.mock('@/components/pickup/ScannerInput', () => ({
  ScannerInput: () => <div data-testid="scanner-input" />,
}));
vi.mock('@/components/pickup/ScanHistoryList', () => ({
  ScanHistoryList: () => <div data-testid="scan-history" />,
}));
vi.mock('@/components/pickup/ScanResultPopup', () => ({ ScanResultPopup: () => null }));
vi.mock('@/components/pickup/ScanResultCard', () => ({
  ScanResultCard: () => <div data-testid="scan-result-card" />,
}));
vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: (props: { orders: unknown[] }) => (
    <div data-testid="manifest-detail" data-order-count={props.orders.length} />
  ),
}));
vi.mock('@/components/pickup/PickupFlowHeader', () => ({
  PickupFlowHeader: (props: { retailerName: string | null; total: number }) => (
    <div
      data-testid="flow-header"
      data-retailer={props.retailerName ?? ''}
      data-total={props.total}
    />
  ),
}));
vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-99817' }),
  useRouter: () => ({ push: mockPush }),
}));

function offlineSync() {
  return { status: 'offline', queuedCount: 0, blockedCount: 0, recent: [], retryNow: vi.fn(), isRetrying: false };
}

describe('ScanningPage offline (spec-82 fase 2)', () => {
  beforeEach(() => {
    mockUseManifestOrders.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockSupabaseFrom.mockReset();
    mockPush.mockReset();
  });

  it('shows nothing definitive while the local download check is still resolving (unknown)', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    mockOfflineScanSource.mockReturnValue({ unknown: true, blocked: false, snapshot: null });
    render(<ScanningPage />);
    expect(screen.queryByTestId('scanner-input')).toBeNull();
    expect(screen.queryByText(/no está descargada/i)).toBeNull();
  });

  it('blocks entry and never touches the network when the carga was never downloaded', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    mockOfflineScanSource.mockReturnValue({ unknown: false, blocked: true, snapshot: null });
    render(<ScanningPage />);
    expect(screen.getByText(/CARGA-99817 no está descargada/i)).toBeInTheDocument();
    expect(screen.queryByTestId('scanner-input')).toBeNull();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('renders from the cached snapshot (not the network) when downloaded and offline', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    mockOfflineScanSource.mockReturnValue({
      unknown: false,
      blocked: false,
      snapshot: {
        operatorId: 'op-1',
        externalLoadId: 'CARGA-99817',
        manifestId: 'manifest-1',
        totalPackages: 25,
        pickupRouteId: 'route-1',
        retailerName: 'Ripley',
        pickupLocation: 'Parque Arauco',
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-1',
            customer_name: 'Juan',
            comuna: 'Ñuñoa',
            delivery_address: 'Calle 123',
            packages: [],
          },
        ],
        downloadedAt: new Date().toISOString(),
      },
    });

    render(<ScanningPage />);

    expect(screen.getByTestId('scanner-input')).toBeInTheDocument();
    expect(screen.getByTestId('flow-header')).toHaveAttribute('data-retailer', 'Ripley');
    expect(screen.getByTestId('flow-header')).toHaveAttribute('data-total', '25');
    expect(screen.getByTestId('manifest-detail')).toHaveAttribute('data-order-count', '1');
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });
});
