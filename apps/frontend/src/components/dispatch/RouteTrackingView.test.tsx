import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteTrackingView } from './RouteTrackingView';
import type { RouteTrackingBrief } from '@/hooks/dispatch/useRouteTrackingBrief';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

let mockData: RouteTrackingBrief | undefined;
let mockIsLoading = false;
let mockIsError = false;
const refetchMock = vi.fn();

vi.mock('@/hooks/dispatch/useRouteTrackingBrief', () => ({
  useRouteTrackingBrief: () => ({ data: mockData, isLoading: mockIsLoading, isError: mockIsError, refetch: refetchMock }),
}));

function brief(overrides: Partial<RouteTrackingBrief> = {}): RouteTrackingBrief {
  return {
    scans: [
      {
        packageId: 'p2', label: 'LBL-2', orderNumber: 'ORD-2', comuna: 'Providencia',
        address: 'Av. 2', customerName: 'Beto', loadedAtIso: '2026-09-04T10:05:00-04:00',
        loadedBy: 'u1', stopNumber: 2, boxIndexInOrder: 1, boxesTotalInOrder: 1,
      },
      {
        packageId: 'p1', label: 'LBL-1', orderNumber: 'ORD-1', comuna: 'Ñuñoa',
        address: 'Av. 1', customerName: 'Ana', loadedAtIso: '2026-09-04T10:00:00-04:00',
        loadedBy: 'u1', stopNumber: 1, boxIndexInOrder: 1, boxesTotalInOrder: 2,
      },
    ],
    packagesLoadedCount: 148,
    packagesExpectedCount: 172,
    packagesUnscannedCount: 24,
    pendingOrders: [{ orderId: 'o9', orderNumber: 'ORD-9', comuna: 'Maipú' }],
    routeDate: '2026-09-04',
    loadPositionLabel: 'A3',
    scannerName: 'Juan Pérez',
    vehicleExternalId: 'RTHK-72',
    driverName: 'Mario González',
    vehicleCapacityPackages: 160,
    ...overrides,
  };
}

describe('RouteTrackingView', () => {
  beforeEach(() => {
    mockData = brief();
    mockIsLoading = false;
    mockIsError = false;
    refetchMock.mockReset();
  });

  it('shows a skeleton while loading', () => {
    mockIsLoading = true;
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByTestId('route-tracking-skeleton')).toBeInTheDocument();
  });

  it('shows a retry affordance on error', async () => {
    mockIsError = true;
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByText(/no pudimos cargar el seguimiento/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders the SOLO LECTURA badge and the EN CARGA status, and mounts no scan or seal/close action', () => {
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByTestId('read-only-badge')).toHaveTextContent('SOLO LECTURA');
    expect(screen.getByText('EN CARGA')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/escane/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar ruta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /despachar/i })).not.toBeInTheDocument();
  });

  it('renders "Último cargado · Parada 01" with order, comuna, client, box count and running total', () => {
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByText(/Último cargado · Parada 02/)).toBeInTheDocument();
    expect(screen.getAllByText(/ORD-2 · Providencia/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beto').length).toBeGreaterThan(0);
    expect(screen.getByText(/paquete 1 de 1 · 148 en la ruta/)).toBeInTheDocument();
  });

  it('renders the "148 de 172 esperados en el andén · 24 sin escanear" summary and reveals pending orders on demand', async () => {
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText(/de 172 esperados en el andén · 24 sin escanear/)).toBeInTheDocument();

    expect(screen.queryByText('ORD-9 · Maipú')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /ver los 1 pendientes/i }));
    expect(screen.getByText('ORD-9 · Maipú')).toBeInTheDocument();
  });

  it('renders the vehicle panel and the scan list', () => {
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByText('RTHK-72')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
    expect(screen.getAllByText('LBL-2').length).toBeGreaterThan(0);
    expect(screen.getByText('LBL-1')).toBeInTheDocument();
  });

  it('shows an honest empty state when nothing has been scanned yet, with no fabricated last-loaded card', () => {
    mockData = brief({ scans: [], packagesLoadedCount: 0, packagesUnscannedCount: 172, pendingOrders: [] });
    render(<RouteTrackingView routeId="11111111-2222-3333-4444-555555555555" operatorId="op-1" />);
    expect(screen.getByText(/todavía no hay paquetes cargados en esta ruta/i)).toBeInTheDocument();
    expect(screen.queryByText(/último cargado/i)).not.toBeInTheDocument();
  });
});
