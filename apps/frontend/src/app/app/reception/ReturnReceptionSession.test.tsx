import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReturnReceptionSession } from './ReturnReceptionSession';

const mockScan = vi.fn();
const mockUseReturnReceptionSession = vi.fn();

vi.mock('@/hooks/reception/useReturnReceptionSession', () => ({
  useReturnReceptionSession: (...args: unknown[]) => mockUseReturnReceptionSession(...args),
}));

const mockPackages = [
  { id: 'p1', label: 'PKG-001', order_number: 'ORD-001', return_reason: 'Dirección incorrecta', received: true },
  { id: 'p2', label: 'PKG-002', order_number: 'ORD-002', return_reason: 'Nadie en casa', received: false },
  { id: 'p3', label: 'PKG-003', order_number: 'ORD-003', return_reason: null, received: false },
  { id: 'p4', label: 'PKG-004', order_number: 'ORD-004', return_reason: 'Rechazado', received: false },
  { id: 'p5', label: 'PKG-005', order_number: 'ORD-005', return_reason: 'Daño', received: false },
];

const defaultSession = {
  sessionId: 'sess-1',
  expectedCount: 5,
  receivedCount: 0,
  packages: mockPackages,
  isLoading: false,
  scan: mockScan,
  error: null,
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
    expect(screen.getByText('Retorno: RUTA-042')).toBeInTheDocument();
  });

  it('shows progress "0 / 5 paquetes" initially', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('0 / 5 paquetes')).toBeInTheDocument();
  });

  it('renders a list item for each package', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText('PKG-002')).toBeInTheDocument();
    expect(screen.getByText('PKG-003')).toBeInTheDocument();
    expect(screen.getByText('PKG-004')).toBeInTheDocument();
    expect(screen.getByText('PKG-005')).toBeInTheDocument();
  });

  it('shows package return_reason', () => {
    render(
      <ReturnReceptionSession operatorId="op-1" externalRouteId="RUTA-042" onBack={onBack} />
    );
    expect(screen.getByText('Dirección incorrecta')).toBeInTheDocument();
    expect(screen.getByText('Nadie en casa')).toBeInTheDocument();
    expect(screen.getByText('Rechazado')).toBeInTheDocument();
  });

  it('entering barcode and pressing Enter calls scan()', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /volver/i }));
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
});
