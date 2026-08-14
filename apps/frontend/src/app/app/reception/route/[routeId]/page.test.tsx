import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteReceptionPage from './page';
import { routeReceptionSnapshotFixture } from '@/test/fixtures/routeReceptionSnapshot';

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

const mockReopenMutate = vi.fn();
vi.mock('@/hooks/reception/useReopenRouteReception', () => ({
  useReopenRouteReception: () => ({ mutate: mockReopenMutate, isPending: false }),
}));

// NOT a hand-written literal any more. The previous inline `baseSnapshot` was
// untyped, so it silently used keys the RPC did not return — these tests were
// green for six months while the page threw TypeError on render in production.
// The shared fixture is `satisfies RouteReceptionSnapshot`, so it can no longer
// drift from the interface without type-check failing. See the fixture header.
const baseSnapshot = routeReceptionSnapshotFixture;

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

  // Regression guards for the spec-47 contract defect. Both of these read
  // fields the RPC was not returning: `route_reception.*` (read in JSX, so it
  // threw on render) and `expected_packages[].id` (emitted as `package_id`, so
  // no package could ever tick received).
  it('renders the reception progress from route_reception counts', () => {
    render(<RouteReceptionPage />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });

  it('marks a package received by matching expected_packages[].id to scans[].package_id', () => {
    const { container } = render(<RouteReceptionPage />);
    const scanned = container.querySelector('[data-package-id="pkg-1"]');
    expect(scanned).toHaveAttribute('data-received', 'true');
    expect(container.querySelector('[data-package-id="pkg-2"]')).toHaveAttribute(
      'data-received',
      'false',
    );
  });

  it('renders the scanner input', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByLabelText('Escáner de recepción')).toBeInTheDocument();
  });

  it('renders the finalize button', () => {
    render(<RouteReceptionPage />);
    expect(screen.getByRole('button', { name: /finalizar recepción/i })).toBeInTheDocument();
  });

  it('hides the reopen button once packages have been received', () => {
    render(<RouteReceptionPage />);
    expect(screen.queryByRole('button', { name: /reabrir ruta/i })).not.toBeInTheDocument();
  });

  it('mounts the reopen button while the batch is still empty', () => {
    mockSnapshot.mockReturnValue({
      data: {
        ...baseSnapshot,
        route_reception: { ...baseSnapshot.route_reception, received_count: 0 },
      },
      isLoading: false,
      error: null,
    });
    render(<RouteReceptionPage />);
    expect(screen.getByRole('button', { name: /reabrir ruta/i })).toBeInTheDocument();
    expect(mockReopenMutate).not.toHaveBeenCalled();
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
