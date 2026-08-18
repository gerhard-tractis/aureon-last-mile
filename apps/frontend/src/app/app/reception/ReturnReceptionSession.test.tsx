import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReturnReceptionSession } from './ReturnReceptionSession';

const mockScan = vi.fn();
const mockUseReturnReceptionSession = vi.fn();

vi.mock('@/hooks/reception/useReturnReceptionSession', () => ({
  useReturnReceptionSession: (...args: unknown[]) => mockUseReturnReceptionSession(...args),
}));

const mockPackages = [
  { id: 'p1', label: 'PKG-001', order_number: 'ORD-001', return_reason: 'Dirección incorrecta', comuna: 'Providencia', received: true },
  { id: 'p2', label: 'PKG-002', order_number: 'ORD-002', return_reason: 'Nadie en casa', comuna: 'Ñuñoa', received: false },
  { id: 'p3', label: 'PKG-003', order_number: 'ORD-003', return_reason: null, comuna: null, received: false },
  { id: 'p4', label: 'PKG-004', order_number: 'ORD-004', return_reason: 'Rechazado', comuna: 'Maipú', received: false },
  { id: 'p5', label: 'PKG-005', order_number: 'ORD-005', return_reason: 'Daño', comuna: 'La Florida', received: false },
];

const defaultSession = {
  sessionId: 'sess-1',
  status: 'in_progress',
  expectedCount: 5,
  receivedCount: 1,
  packages: mockPackages,
  driverName: 'Juan Pérez',
  isLoading: false,
  error: null,
  packagesError: null,
  scan: mockScan,
};

describe('ReturnReceptionSession', () => {
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReturnReceptionSession.mockReturnValue(defaultSession);
    mockScan.mockResolvedValue({ result: 'received' });
  });

  it('renders the route ID in the header', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('Reingreso RUTA-042')).toBeInTheDocument();
  });

  it('shows the "EN CURSO" badge when the session is in_progress', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('EN CURSO')).toBeInTheDocument();
  });

  it('shows the driver name', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('falls back to "Sin conductor" when driverName is null', () => {
    mockUseReturnReceptionSession.mockReturnValue({ ...defaultSession, driverName: null });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('Sin conductor')).toBeInTheDocument();
  });

  it('shows progress "1/5"', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('1/5')).toBeInTheDocument();
  });

  it('renders a list item for each package, with its order number', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('PKG-002')).toBeInTheDocument();
    expect(screen.getByText('PKG-003')).toBeInTheDocument();
    expect(screen.getByText('PKG-004')).toBeInTheDocument();
    expect(screen.getByText('PKG-005')).toBeInTheDocument();
  });

  it('shows package return_reason', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText(/Dirección incorrecta/)).toBeInTheDocument();
    expect(screen.getByText(/Nadie en casa/)).toBeInTheDocument();
    expect(screen.getByText(/Rechazado/)).toBeInTheDocument();
  });

  it('entering a barcode and pressing Enter calls scan()', async () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    const input = screen.getByPlaceholderText(/escanear código/i);
    fireEvent.change(input, { target: { value: 'PKG-002' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(mockScan).toHaveBeenCalledWith('PKG-002');
  });

  it('after "received" result, shows "Recibido" feedback', async () => {
    mockScan.mockResolvedValue({ result: 'received' });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    const input = screen.getByPlaceholderText(/escanear código/i);
    fireEvent.change(input, { target: { value: 'PKG-002' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('Recibido')).toBeInTheDocument();
  });

  it('after "not_found" result, shows "No encontrado"', async () => {
    mockScan.mockResolvedValue({ result: 'not_found' });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    const input = screen.getByPlaceholderText(/escanear código/i);
    fireEvent.change(input, { target: { value: 'UNKNOWN' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('No encontrado')).toBeInTheDocument();
  });

  it('after "route_mismatch" result, shows "Ruta incorrecta"', async () => {
    mockScan.mockResolvedValue({ result: 'route_mismatch' });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    const input = screen.getByPlaceholderText(/escanear código/i);
    fireEvent.change(input, { target: { value: 'WRONG-ROUTE' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('Ruta incorrecta')).toBeInTheDocument();
  });

  it('after "duplicate" result, shows "Ya registrado"', async () => {
    mockScan.mockResolvedValue({ result: 'duplicate' });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    const input = screen.getByPlaceholderText(/escanear código/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(screen.getByText('Ya registrado')).toBeInTheDocument();
  });

  it('back button calls onBack', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('received packages show a checkmark', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    // PKG-001 is received: true — should have checkmark icon aria label or test id
    const checkmarks = screen.getAllByTestId('pkg-received');
    expect(checkmarks.length).toBe(1);
  });

  it('the footer button reads "Volver al listado", not a close/finalize verb', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.queryByRole('button', { name: /cerrar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /finalizar/i })).toBeNull();
    const footerButton = screen.getByRole('button', { name: 'Volver al listado' });
    fireEvent.click(footerButton);
    expect(onBack).toHaveBeenCalledTimes(1);
    // mockScan (the only mutation this hook exposes) is never invoked by leaving.
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('footer note describes leaving, not a close consequence — no faltante/incidencia claim', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText(/progreso queda guardado/i)).toBeInTheDocument();
    expect(screen.queryByText(/faltante/i)).toBeNull();
    expect(screen.queryByText(/incidencia/i)).toBeNull();
    expect(screen.queryByText(/cerrar/i)).toBeNull();
  });

  it('footer pending count matches the progress bar, both derived from expected/received', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      expectedCount: 5,
      receivedCount: 2,
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('2/5')).toBeInTheDocument();
    // 5 - 2 = 3, regardless of how many rows happen to be in `packages`.
    expect(screen.getByText(/3 paquetes sin escanear/)).toBeInTheDocument();
  });

  it('footer shows the all-received message only when nothing is pending', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      expectedCount: 5,
      receivedCount: 5,
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText(/todos los paquetes fueron recibidos/i)).toBeInTheDocument();
  });

  it('does not render a disposición column — no data source for it', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.queryByText(/REINTENTO/)).toBeNull();
    expect(screen.queryByText(/GESTIÓN/)).toBeNull();
  });

  it('while loading, shows a loading state instead of the "all received" footer claim', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      isLoading: true,
      packages: [],
      expectedCount: 0,
      receivedCount: 0,
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByTestId('return-session-loading')).toBeInTheDocument();
    expect(screen.queryByText(/todos los paquetes fueron recibidos/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Volver al listado' })).toBeNull();
  });

  it('surfaces a packages-query error instead of rendering an empty "all received" footer', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      isLoading: false,
      packages: [],
      packagesError: new Error('boom'),
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText(/no se pudieron cargar los paquetes/i)).toBeInTheDocument();
    expect(screen.queryByText(/todos los paquetes fueron recibidos/i)).toBeNull();
  });

  // A failing session RPC and a failing package list send the operator looking
  // in different places, so they must not collapse into one message.
  it('names the session as the failure when the session query is the one that failed', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      isLoading: false,
      packages: [],
      error: new Error('rpc down'),
      packagesError: null,
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText(/no se pudo abrir la sesión/i)).toBeInTheDocument();
    expect(screen.queryByText(/no se pudieron cargar los paquetes/i)).toBeNull();
  });

  // expected_count is recomputed live from retorno_hub, so a route already
  // processed by a colleague opens as a real 0/0 session. Claiming everything
  // was received would be a completion claim about a session that received
  // nothing.
  it('does not claim completion for a session that never expected any package', () => {
    mockUseReturnReceptionSession.mockReturnValue({
      ...defaultSession,
      isLoading: false,
      packages: [],
      expectedCount: 0,
      receivedCount: 0,
    });
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.queryByText(/todos los paquetes fueron recibidos/i)).toBeNull();
    expect(screen.getByText(/no tiene paquetes pendientes de recepción/i)).toBeInTheDocument();
  });
});
