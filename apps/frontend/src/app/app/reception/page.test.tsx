import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceptionPage from './page';

const onTheRoad = [
  { id: 'r0', code: 'PR-2026-0002', driver_id: 'd0', driver_name: 'Luis Soto',
    vehicle_label: null, in_transit_at: null, started_at: '2026-06-25T06:00:00Z',
    manifest_count: 3, expected_packages: 21 },
];
const unloading = [
  { id: 'r1', code: 'PR-2026-0001', driver_id: 'd1', driver_name: 'Ana Ruiz',
    vehicle_label: 'AAA-111', in_transit_at: '2026-06-25T08:00:00Z',
    started_at: '2026-06-25T05:00:00Z',
    manifest_count: 2, expected_packages: 15 },
];
const completed = [
  { id: 'r2', code: 'PR-2026-0000', driver_id: 'd2', driver_name: 'Pedro Lopez',
    vehicle_label: null, in_transit_at: '2026-06-24T08:00:00Z',
    started_at: '2026-06-24T05:00:00Z',
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

/** Reads the numeric value out of the MetricCard carrying the given label. */
function kpiValue(label: string): string | null {
  for (const node of screen.getAllByText(label)) {
    const value = node.closest('.bg-surface')?.querySelector('[data-value]');
    if (value) return value.textContent;
  }
  return null;
}

describe('ReceptionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIncomingRoutes.mockImplementation((_op: string, status: string) => {
      if (status === 'in_progress') return { data: onTheRoad, isLoading: false };
      if (status === 'in_transit') return { data: unloading, isLoading: false };
      if (status === 'received') return { data: completed, isLoading: false };
      return { data: [], isLoading: false };
    });
  });

  it('renders the four tabs from spec-52', () => {
    render(<ReceptionPage />);
    expect(screen.getByRole('tab', { name: 'Rutas entrantes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'En descarga' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completadas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Retornos' })).toBeInTheDocument();
  });

  it('lists in_progress routes — trucks still out collecting — in "Rutas entrantes"', () => {
    render(<ReceptionPage />);
    expect(mockUseIncomingRoutes).toHaveBeenCalledWith('op-1', 'in_progress');
    expect(screen.getByText('PR-2026-0002')).toBeInTheDocument();
    expect(screen.queryByText('PR-2026-0001')).not.toBeInTheDocument();
  });

  it('lists in_transit routes in "En descarga"', async () => {
    const user = userEvent.setup();
    render(<ReceptionPage />);
    await user.click(screen.getByRole('tab', { name: 'En descarga' }));
    expect(mockUseIncomingRoutes).toHaveBeenCalledWith('op-1', 'in_transit');
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
  });

  it('lists received routes in "Completadas"', async () => {
    const user = userEvent.setup();
    render(<ReceptionPage />);
    await user.click(screen.getByRole('tab', { name: 'Completadas' }));
    expect(screen.getByText('PR-2026-0000')).toBeInTheDocument();
  });

  it('counts in_progress routes in the "Rutas entrantes" KPI', () => {
    mockUseIncomingRoutes.mockImplementation((_op: string, status: string) => {
      if (status === 'in_progress') return { data: [...onTheRoad, ...onTheRoad], isLoading: false };
      if (status === 'in_transit') return { data: unloading, isLoading: false };
      return { data: completed, isLoading: false };
    });
    render(<ReceptionPage />);
    expect(kpiValue('Rutas entrantes')).toBe('2');
  });

  it('sums expected packages from the open in_transit batches only', () => {
    render(<ReceptionPage />);
    expect(kpiValue('Paquetes esperados')).toBe('15');
    expect(kpiValue('En descarga')).toBe('1');
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
    expect(screen.getAllByText('En descarga').length).toBeGreaterThan(0);
  });
});
