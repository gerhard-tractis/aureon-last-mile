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
  ScannerInput: (props: { disabled?: boolean }) => (
    <div data-testid="scanner-input" data-disabled={String(!!props.disabled)} />
  ),
}));
vi.mock('@/components/pickup/ScanHistoryList', () => ({
  ScanHistoryList: () => <div data-testid="scan-history" />,
}));
vi.mock('@/components/pickup/ScanResultPopup', () => ({ ScanResultPopup: () => null }));
vi.mock('@/components/pickup/ScanResultCard', () => ({
  ScanResultCard: () => <div data-testid="scan-result-card" />,
}));
vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: (props: { orders: unknown[]; isError: boolean }) => (
    <div
      data-testid="manifest-detail"
      data-order-count={props.orders.length}
      data-error={String(props.isError)}
    />
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

  // M1, revisión de fase 2 — antes de este fix, un fallo de IndexedDB
  // (modo privado, upgrade bloqueado, cuota agotada) era indistinguible de
  // "todavía cargando": la pantalla se congelaba en un spinner sin texto,
  // sin botón, sin salida.
  it('shows a retry, not an endless spinner, when the local read errors (M1)', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    const retry = vi.fn();
    mockOfflineScanSource.mockReturnValue({
      unknown: false,
      blocked: false,
      error: true,
      retry,
      snapshot: null,
    });
    render(<ScanningPage />);
    expect(screen.queryByTestId('scanner-input')).toBeNull();
    const retryButton = screen.getByRole('button', { name: /reintentar/i });
    retryButton.click();
    expect(retry).toHaveBeenCalled();
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

  // spec-82 fase 2, revisión B1 — antes de este fix, la pantalla se veía
  // "perfecta" sin red (cabecera, punto de retiro, lista) y dejaba
  // escanear igual: useScanMutation queda pausada por TanStack Query
  // (`networkMode: 'online'` por defecto) sin avisar, ScannerInput sigue
  // habilitado, y un "escaneo" que el operario cree registrado desaparece
  // sin rastro si cierra la pestaña antes de recuperar señal. Un
  // manifiesto descargado sin red debe dejar VER, nunca escanear.
  it('disables the scanner and explains why when downloaded but offline (B1)', () => {
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
        orders: [],
        downloadedAt: new Date().toISOString(),
      },
    });

    render(<ScanningPage />);

    expect(screen.getByTestId('scanner-input')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
  });

  // spec-82 fase 2, revisión B2 — sin este aviso, un operario que verificó
  // 18/25 con señal y vuelve a abrir `5d` sin red ve "0/25" y una lista sin
  // ningún check verde: exactamente lo mismo que "nada verificado todavía",
  // sin decir en ningún sitio que es porque no hay red para confirmarlo.
  it('warns that verified progress cannot be confirmed offline (B2)', () => {
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
        orders: [],
        downloadedAt: new Date().toISOString(),
      },
    });

    render(<ScanningPage />);

    expect(
      screen.getByText(/no se puede (confirmar|mostrar) (lo|cuántos)/i),
    ).toBeInTheDocument();
  });

  // Menor, revisión de fase 2 — `downloadedAt` se escribía y nunca se leía:
  // una carga descargada ayer con bultos cambiados hoy se mostraba como si
  // fuera actual, sin marca de tiempo ni aviso. Mostrarla no resuelve la
  // desactualización (eso sigue siendo "sin invalidación automática", ver
  // el spec) pero al menos el operario sabe DE CUÁNDO son los datos.
  it('shows when the snapshot was downloaded', () => {
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
        orders: [],
        downloadedAt: '2026-09-08T14:30:00.000Z',
      },
    });

    render(<ScanningPage />);

    expect(screen.getByText(/descargad[oa].*08\/09|08\/09.*descargad[oa]/i)).toBeInTheDocument();
  });

  // spec-82 fase 2, revisión M6 — un fallo de red ANTERIOR (mientras había
  // señal) deja `ordersError` pegado en la caché de React Query; al perder
  // señal después, con un snapshot válido, ese error viejo no puede seguir
  // tapando las órdenes ya descargadas con un cartel rojo y un Retry inútil.
  it('does not show the network error card when a valid snapshot exists, even if a stale ordersError lingers (M6)', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    mockUseManifestOrders.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
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
        orders: [{
          id: 'order-1',
          order_number: 'ORD-1',
          customer_name: 'Juan',
          comuna: 'Ñuñoa',
          delivery_address: 'Calle 123',
          packages: [],
        }],
        downloadedAt: new Date().toISOString(),
      },
    });

    render(<ScanningPage />);

    expect(screen.getByTestId('manifest-detail')).toHaveAttribute('data-order-count', '1');
    expect(screen.getByTestId('manifest-detail')).toHaveAttribute('data-error', 'false');
  });

  // M4, revisión de fase 2 — el seam real: `page.tsx` tiene que pasar
  // `sync.status === 'offline'` de verdad como tercer argumento, no un
  // valor fijo. Un mutante que pasara `false` ahí desactivaría la fase
  // entera (siempre "en línea" para el hook) sin romper ningún test de
  // este archivo, porque el mock respondía igual sin mirar qué le llegó.
  it('passes operatorId, loadId and the real offline flag to useOfflineScanSource (M4)', () => {
    mockUseSyncQueue.mockReturnValue(offlineSync());
    mockOfflineScanSource.mockReturnValue({ unknown: true, blocked: false, snapshot: null });
    render(<ScanningPage />);
    expect(mockOfflineScanSource).toHaveBeenCalledWith('op-1', 'CARGA-99817', true);
  });

  it('passes offline: false to useOfflineScanSource while online (M4)', () => {
    mockUseSyncQueue.mockReturnValue({
      status: 'online',
      queuedCount: 0,
      blockedCount: 0,
      recent: [],
      retryNow: vi.fn(),
      isRetrying: false,
    });
    // Online, page.tsx's own network effect fires — give it a chain that
    // resolves instead of throwing on an un-mocked `.select()`.
    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({ single: () => Promise.resolve({ data: null }) }),
          }),
        }),
      }),
    });
    mockOfflineScanSource.mockReturnValue({ unknown: false, blocked: false, snapshot: null });
    render(<ScanningPage />);
    expect(mockOfflineScanSource).toHaveBeenCalledWith('op-1', 'CARGA-99817', false);
  });
});
