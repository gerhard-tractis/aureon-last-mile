import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteReceptionPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ routeId: 'r1' }),
  useRouter: () => ({ push: mockPush }),
}));

const mockSnapshot = vi.fn();
const mockScanMutate = vi.fn();
const mockCompleteMutate = vi.fn();

vi.mock('@/hooks/reception/useRouteReceptionSnapshot', () => ({
  useRouteReceptionSnapshot: () => mockSnapshot(),
}));
vi.mock('@/hooks/reception/useReceptionScan', () => ({
  useReceptionScan: () => ({ mutate: mockScanMutate, isPending: false }),
}));
vi.mock('@/hooks/reception/useCompleteRouteReception', () => ({
  useCompleteRouteReception: () => ({ mutate: mockCompleteMutate, isPending: false }),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseSnapshot = {
  route: {
    id: 'r1', code: 'PR-2026-0001', driver_id: 'd1', driver_name: 'Ana Ruiz',
    vehicle_label: 'AAA-111', status: 'in_transit', in_transit_at: null,
  },
  route_reception: {
    id: 'rr1', status: 'in_progress', expected_count: 3, received_count: 1,
    started_at: null, completed_at: null, discrepancy_notes: null,
  },
  manifests: [
    { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
    { id: 'm2', external_load_id: 'CARGA-002', retailer_name: 'Sodimac' },
  ],
  expected_packages: [
    { id: 'pkg-1', label: 'PKG-A', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
    { id: 'pkg-2', label: 'PKG-B', order_id: 'o1', order_number: '101', manifest_id: 'm1', status: 'verificado' },
    { id: 'pkg-3', label: 'PKG-C', order_id: 'o2', order_number: '202', manifest_id: 'm2', status: 'verificado' },
  ],
  scans: [
    { id: 's1', barcode: 'PKG-A', scan_result: 'received', package_id: 'pkg-1', scanned_at: '2026-06-25T10:00:00Z' },
  ],
  discrepancies: [],
};

describe('RouteReceptionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshot.mockReturnValue({ data: baseSnapshot, isLoading: false, error: null });
  });

  it('renders the route header with code', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
  });

  it('renders the consolidated order-grouped list', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByText('Pedido #101')).toBeInTheDocument();
    expect(screen.getByText('Pedido #202')).toBeInTheDocument();
  });

  it('renders the scanner input', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByLabelText('Escáner de recepción')).toBeInTheDocument();
  });

  it('renders the finalize button', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByRole('button', { name: /finalizar recepción/i })).toBeInTheDocument();
  });

  it('renders skeletons while loading', () => {
    mockSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<RouteReceptionPage />);
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    mockSnapshot.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Ruta no encontrada'),
    });
    render(<RouteReceptionPage />);
    expect(screen.getByText('Ruta no encontrada')).toBeInTheDocument();
  });
});
