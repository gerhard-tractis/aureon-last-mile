import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceptionPage from './page';

const incoming = [
  { id: 'r1', code: 'PR-2026-0001', driver_id: 'd1', driver_name: 'Ana Ruiz',
    vehicle_label: 'AAA-111', in_transit_at: '2026-06-25T08:00:00Z',
    manifest_count: 2, expected_packages: 15 },
];
const completed = [
  { id: 'r2', code: 'PR-2026-0000', driver_id: 'd2', driver_name: 'Pedro Lopez',
    vehicle_label: null, in_transit_at: '2026-06-24T08:00:00Z',
    manifest_count: 1, expected_packages: 10 },
];

const mockUseIncomingRoutes = vi.fn();

vi.mock('@/hooks/reception/useIncomingRoutes', () => ({
  useIncomingRoutes: (...args: unknown[]) => mockUseIncomingRoutes(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/components/reception/RouteQRScannerEntry', () => ({
  RouteQRScannerEntry: () => <div data-testid="route-qr-scanner" />,
}));
vi.mock('./ReturnRouteList', () => ({
  ReturnRouteList: () => <div data-testid="return-route-list" />,
}));
vi.mock('./ReturnReceptionSession', () => ({
  ReturnReceptionSession: () => <div data-testid="return-reception-session" />,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('ReceptionPage', () => {
  beforeEach(() => {
    mockUseIncomingRoutes.mockImplementation((_op: string, status: string) => {
      if (status === 'in_transit') return { data: incoming, isLoading: false };
      if (status === 'received') return { data: completed, isLoading: false };
      return { data: [], isLoading: false };
    });
  });

  it('renders the three tabs from spec', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('tab', { name: 'Rutas entrantes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completadas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Retornos' })).toBeInTheDocument();
  });

  it('renders incoming routes in default tab', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
  });

  it('shows route QR scanner when QR button clicked', async () => {
    const user = userEvent.setup();
    render(<ReceptionPage />);
    await user.click(screen.getByRole('button', { name: /escanear qr/i }));
    expect(screen.getByTestId('route-qr-scanner')).toBeInTheDocument();
  });

  it('renders KPI labels in Spanish', () => {
    render(<ReceptionPage />);
    expect(screen.getByText('Paquetes esperados')).toBeInTheDocument();
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });
});
