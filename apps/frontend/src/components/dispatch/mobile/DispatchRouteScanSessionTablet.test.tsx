import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchRouteScanSessionTablet } from './DispatchRouteScanSessionTablet';
import { buildAcceptedEntry } from '@/lib/dispatch/mobile/scan-session';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const submitScanMock = vi.fn();
let mockSession: ReturnType<typeof baseSession>;

function baseSession() {
  return {
    submitScan: submitScanMock,
    lastEntry: null as ReturnType<typeof buildAcceptedEntry> | null,
    history: [] as unknown[],
    rejectionCount: 0,
    rejectionTally: [] as { code: string; label: string; count: number }[],
    packagesLoaded: 148,
    packagesTotal: 172,
    percent: 86,
  };
}

vi.mock('@/hooks/dispatch/mobile/useRouteScanSession', () => ({
  useRouteScanSession: () => mockSession,
}));

vi.mock('./DispatchRouteCameraViewfinder', () => ({
  DispatchRouteCameraViewfinder: () => <div data-testid="camera-stub" />,
}));

const baseProps = {
  routeId: 'route-12345678',
  operatorId: 'op-1',
  routeCode: 'ROUTE-12',
  loadPositionLabel: 'A3',
  driverName: 'Mario González',
  vehicleExternalId: 'RTHK-72',
  vehicleCapacityPackages: 200,
  ordersCount: 42,
  stopsCount: 30,
  pendingOnDock: 24,
  incompleteOrders: [],
  orderBoxCounts: new Map(),
  comunas: [],
  routeStatus: 'loading' as string | undefined,
  onViewPackages: vi.fn(),
};

describe('DispatchRouteScanSessionTablet (3a)', () => {
  beforeEach(() => {
    mockSession = baseSession();
    submitScanMock.mockClear();
    pushMock.mockClear();
    global.fetch = vi.fn();
  });

  it('mounts the counter, last-read region, side panel and both terminal actions all at once — no navigation (fase 2 test 4)', () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} />);
    expect(screen.getByTestId('dispatch-scan-counter')).toBeInTheDocument();
    expect(screen.getByText('148 de 172')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar ruta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Despachar a DispatchTrack/ })).toBeInTheDocument();
    // Vehicle panel (reused from 1c) renders in the same tree — no tab/route change needed.
    expect(screen.getByText('RTHK-72')).toBeInTheDocument();
  });

  it('shows the reader-armed state, driven by the real ScanField focus event (decision 4)', () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} />);
    // ScanField autoFocuses on mount, so the field starts armed.
    const field = screen.getByRole('textbox', { name: 'Escanear paquete' });
    const readerStatus = (text: string) =>
      screen.getByText((_, node) => node?.tagName === 'P' && !!node.textContent?.includes(text));
    expect(readerStatus('LISTO')).toBeInTheDocument();

    fireEvent.blur(field);
    expect(readerStatus('TOCA PARA REACTIVAR')).toBeInTheDocument();
  });

  it('renders the top comuna only when the route has exactly one, and a count otherwise — never names one falsely', () => {
    const { rerender } = render(
      <DispatchRouteScanSessionTablet {...baseProps} comunas={[{ comuna: 'Maipú', count: 5 }]} />,
    );
    expect(screen.getByText('Maipú')).toBeInTheDocument();

    rerender(
      <DispatchRouteScanSessionTablet
        {...baseProps}
        comunas={[{ comuna: 'Maipú', count: 5 }, { comuna: 'Ñuñoa', count: 3 }]}
      />,
    );
    expect(screen.getByText('2 comunas')).toBeInTheDocument();
    expect(screen.queryByText('Maipú')).not.toBeInTheDocument();
  });

  it('shows "sin conductor" (the person, never a shift) when no driver is assigned', () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} driverName={null} />);
    // Renders both in the header and in the reused RouteTrackingVehiclePanel.
    expect(screen.getAllByText('Sin conductor').length).toBeGreaterThanOrEqual(1);
  });

  it('Despachar is disabled with a reason while the route is not yet loaded — its real precondition, not a guess', () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} routeStatus="loading" />);
    expect(screen.getByRole('button', { name: /Despachar a DispatchTrack/ })).toBeDisabled();
    expect(screen.getByText('Disponible cuando la ruta esté cerrada')).toBeInTheDocument();
  });

  it('Despachar becomes clickable once the route is loaded and a vehicle is assigned, and calls the real endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    render(<DispatchRouteScanSessionTablet {...baseProps} routeStatus="loaded" />);
    const trigger = screen.getByRole('button', { name: /Despachar a DispatchTrack/ });
    expect(trigger).toBeEnabled();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Despachar' }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-12345678/dispatch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ truck_identifier: 'RTHK-72', driver_identifier: 'Mario González' }),
      }),
    );
  });

  it('toggles to camera mode and back, mirroring 2e (fase 3 test 7 — same behaviour, same components)', async () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usar cámara' }));
    expect(screen.getByTestId('camera-stub')).toBeInTheDocument();
    expect(screen.getByText('MODO CÁMARA')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Volver al lector' }));
    expect(screen.queryByTestId('camera-stub')).not.toBeInTheDocument();
  });

  it('"Ver los N" hands control to the caller instead of navigating', async () => {
    const onViewPackages = vi.fn();
    render(<DispatchRouteScanSessionTablet {...baseProps} onViewPackages={onViewPackages} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver los 148' }));
    expect(onViewPackages).toHaveBeenCalledTimes(1);
  });

  it('the page itself has no scroll container — only the side panel does (decision 5)', () => {
    render(<DispatchRouteScanSessionTablet {...baseProps} />);
    const root = screen.getByTestId('dispatch-route-scan-session-tablet');
    expect(root).toHaveClass('overflow-hidden');
    expect(root.className).not.toMatch(/overflow-y-auto/);
  });
});
