import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// spec-82 fase 2 — inerte por defecto (todo este archivo prueba el flujo
// EN LÍNEA; el offline vive en page.offline.test.tsx). Sin este mock, el
// hook real llama a useQuery y este archivo no monta un QueryClientProvider.
vi.mock('@/hooks/pickup/useOfflineScanSource', () => ({
  useOfflineScanSource: () => ({ unknown: false, blocked: false, snapshot: null }),
}));

const mockRetryBlockedManifest = vi.fn();
vi.mock('@/hooks/useOfflineQueue', () => ({
  retryBlockedManifest: (...args: unknown[]) => mockRetryBlockedManifest(...args),
}));

// Ampliación de alcance, fase 5 (coordinación 2026-09-10) — esta pantalla es
// el único punto de entrada real de la cuadrilla al escaneo, y
// `manifests.started_at` no tenía escritor en ese camino (sólo lo escribe
// `openPendingManifest`, llamado hoy sólo desde el escritorio). Se mockea el
// módulo entero para no tener que extender la cadena de Supabase mockeada
// arriba con el segundo `select`/`update` que hace `openPendingManifest`.
const mockOpenPendingManifest = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/pickup/openPendingManifest', () => ({
  openPendingManifest: (...args: unknown[]) => mockOpenPendingManifest(...args),
}));

const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
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
  PickupFlowHeader: (props: { queuedCount: number; onRetryBlocked?: () => void }) => (
    <div data-testid="flow-header" data-queued-count={props.queuedCount}>
      {props.onRetryBlocked && (
        <button data-testid="retry-blocked" onClick={props.onRetryBlocked}>
          retry
        </button>
      )}
    </div>
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
    mockOpenPendingManifest.mockClear();
    manifestFixture.data = { id: 'm1', total_packages: 10, pickup_route_id: null };
    mockUsePickupScans.mockReturnValue({ data: [
      { id: 's1', scan_result: 'verified', package_id: 'p1', barcode_scanned: 'BC001' },
      { id: 's2', scan_result: 'not_found', package_id: null, barcode_scanned: 'BC999' },
    ] });
    mockUseScanMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseManifestOrders.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    // M-3, ronda 5 de review del PR #679 (mayor) — el valor por defecto
    // simula "sí había algo que revivir"; el test dedicado abajo lo
    // sobreescribe con 0 para probar el feedback cuando no hay nada.
    mockRetryBlockedManifest.mockResolvedValue(1);
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

  // Hotfix móvil 2026-09-10 — este wrapper es hijo directo de
  // `<main className="flex min-h-0 flex-1 flex-col">` (AppLayout). En un
  // contenedor flex, un item con márgenes AUTO en el eje transversal
  // (`mx-auto`) deja de estirarse y pasa a medir su tamaño intrínseco,
  // que `max-w-2xl` fija en 672px. En un teléfono de 375px eso maquetaba
  // la pantalla entera a 672px: el contenido se salía y aparecía scroll
  // horizontal. `w-full` devuelve el ancho al 100% del contenedor y
  // `max-w-2xl` vuelve a ser sólo un techo en escritorio.
  //
  // Se comprueba la clase, no la geometría: jsdom no calcula layout, así
  // que la única forma honesta de fijar este contrato en un test unitario
  // es sobre la clase que lo produce. La medición real se hizo en un
  // navegador (375px → 672px antes, 375px después).
  it('la envoltura de la página ocupa el ancho disponible, no su tamaño intrínseco', () => {
    const { container } = render(<ScanningPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('max-w-2xl');
    expect(wrapper?.className).toContain('w-full');
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

    // Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679, B-1)
    // — "el operario puede reintentar desde la app".
    it('calls retryBlockedManifest with the loaded manifest when the header requests a retry', async () => {
      render(<ScanningPage />);
      (await screen.findByTestId('retry-blocked')).click();
      expect(mockRetryBlockedManifest).toHaveBeenCalledWith('op-1', 'm1');
    });

    // M-3, ronda 5 de review del PR #679 (mayor) — `blockedCount` incluye
    // bloqueos cross-user que `retryBlockedManifest` no puede resolver (sólo
    // revive `dead`). Sin feedback, el operario toca "REQUIERE AYUDA" y no
    // ve ningún cambio — ni éxito ni error.
    it('shows an info toast when retryBlockedManifest revives nothing (a cross-user block, not a dead entry)', async () => {
      mockRetryBlockedManifest.mockResolvedValueOnce(0);
      render(<ScanningPage />);
      (await screen.findByTestId('retry-blocked')).click();

      await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith(expect.any(String)));
    });
  });

  describe('spec-47 guard', () => {
    it('blocks the scan and tells the driver to start a route, without touching the mutation', async () => {
      // The manifests fixture mocked above never returns a pickup_route_id,
      // so pickupRouteId is null — exactly the "no active route" state.
      //
      // handleScan also bails out early when `manifestId` or `userId` is
      // still null (see page.tsx), and both are only populated once the
      // manifest-lookup effect's promise chain resolves. Firing the scan
      // right after `findByTestId('fire-scan')` races that effect: the
      // scanner button is present on the very first render regardless of
      // whether the effect has settled, so an unlucky microtask ordering
      // makes handleScan return before ever reaching the pickup_route_id
      // guard — and neither `mutate` nor `toast.error` gets called. Reuse
      // the labels-enabled gate (manifestId-dependent, already exercised
      // above) purely as a wait condition, the same way the "scan failure
      // feedback" test below does, so the click is guaranteed to happen
      // after the effect has set manifestId/userId.
      const mutate = vi.fn();
      mockUseScanMutation.mockReturnValue({ mutate, isPending: false });
      mockUseModuleEnabled.mockReturnValue(true);

      render(<ScanningPage />);
      await screen.findByTestId('print-labels-scan');
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

  // fase 5 (ronda 2 del mock) — 5d dibuja "ÓRDENES Y BULTOS" ENCIMA de
  // "HISTORIAL DE ESCANEOS", al revés del orden que tenía la pantalla.
  describe('orden del mock: lista de órdenes y bultos antes del historial', () => {
    it('monta manifest-detail antes que el encabezado de Escaneos recientes', () => {
      render(<ScanningPage />);
      const manifestDetail = screen.getByTestId('manifest-detail');
      const historyHeading = screen.getByText('Escaneos recientes');
      // DOCUMENT_POSITION_FOLLOWING en el resultado de compareDocumentPosition
      // significa que el nodo argumento (historyHeading) va DESPUÉS del nodo
      // que llama al método (manifestDetail) en el documento.
      const position = manifestDetail.compareDocumentPosition(historyHeading);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  // fase 5 — el pie del mock lleva, además del botón primario, la entrada
  // manual de código. `ScannerInput` ya es la superficie de entrada manual
  // (el operario puede teclear en vez de escanear); este control secundario
  // le devuelve el foco en vez de abrir un segundo campo que duplicaría la
  // única fuente de verdad del código.
  describe('entrada manual de código en el pie', () => {
    it('muestra "Ingresar código a mano" junto al botón primario', () => {
      render(<ScanningPage />);
      expect(screen.getByText('Ingresar código a mano')).toBeInTheDocument();
    });
  });

  // Ampliación de alcance, fase 5 — `manifests.started_at` no tiene escritor
  // en el camino real de la cuadrilla (abre ruta → toca manifiesto → llega
  // aquí sin pasar por `openPendingManifest`, que sólo llama el escritorio).
  // Esta pantalla es el punto honesto para marcarlo: aquí empieza el escaneo.
  describe('fija manifests.started_at al abrir la pantalla de escaneo (ampliación de alcance)', () => {
    it('llama a openPendingManifest con el operador y la carga cuando hay señal', async () => {
      render(<ScanningPage />);
      await waitFor(() =>
        expect(mockOpenPendingManifest).toHaveBeenCalledWith(
          expect.anything(),
          'op-1',
          'CARGA-001',
        )
      );
    });

    it('no llama a openPendingManifest sin conexión (no hay a qué escribir)', async () => {
      mockUseSyncQueue.mockReturnValue({
        status: 'offline',
        queuedCount: 0,
        recent: [],
        retryNow: vi.fn(),
        isRetrying: false,
      });
      render(<ScanningPage />);
      // Deja correr los microtasks pendientes: si el guard estuviera roto,
      // la llamada ocurriría igual durante este await.
      await Promise.resolve();
      expect(mockOpenPendingManifest).not.toHaveBeenCalled();
    });
  });
});
