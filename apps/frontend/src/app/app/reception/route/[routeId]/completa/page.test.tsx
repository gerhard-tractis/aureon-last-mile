import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceptionCompletePage from './page';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ routeId: 'r1' }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

const mockSnapshot = vi.fn();
vi.mock('@/hooks/reception/useRouteReceptionSnapshot', () => ({
  useRouteReceptionSnapshot: (...args: unknown[]) => mockSnapshot(...args),
}));

const mockIncoming = vi.fn();
vi.mock('@/hooks/reception/useIncomingRoutes', () => ({
  useIncomingRoutes: (...args: unknown[]) => mockIncoming(...args),
}));

const snapshot: RouteReceptionSnapshot = {
  route: {
    id: 'r1',
    code: 'PR-2026-0148',
    driver_id: 'd1',
    driver_name: 'Marcela Rojas',
    plate: 'JKLM-42',
    status: 'received',
    in_transit_at: '2026-08-20T12:00:00Z',
  },
  route_reception: {
    id: 'rr1',
    status: 'completed',
    expected_count: 10,
    received_count: 10,
    unexpected_count: 0,
    started_at: '2026-08-20T12:05:00Z',
    completed_at: '2026-08-20T12:40:00Z',
    discrepancy_notes: null,
  },
  manifests: [{ id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' }],
  expected_packages: [],
  scans: [],
  discrepancies: [],
};

function yardRoute(overrides: Partial<IncomingRoute>): IncomingRoute {
  return {
    id: 'r2',
    code: 'PR-2026-0149',
    driver_id: 'd2',
    driver_name: 'Luis Paredes',
    plate: 'ZZZZ-99',
    in_transit_at: '2026-08-20T13:00:00Z',
    started_at: null,
    manifest_count: 1,
    expected_packages: 20,
    ...overrides,
  };
}

describe('ReceptionCompletePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshot.mockReturnValue({ data: snapshot, isLoading: false, error: null });
    mockIncoming.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it('renders the acta from the snapshot', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText('Recepción cerrada')).toBeInTheDocument();
    expect(screen.getByText(/PR-2026-0148/)).toBeInTheDocument();
  });

  it('fetches the snapshot for the routeId in the URL', () => {
    render(<ReceptionCompletePage />);
    expect(mockSnapshot).toHaveBeenCalledWith('r1');
  });

  it('shows a skeleton while loading, not a centred spinner', () => {
    mockSnapshot.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<ReceptionCompletePage />);
    expect(
      container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Recepción cerrada')).not.toBeInTheDocument();
  });

  it('shows an error message with a way back when the snapshot fails to load', async () => {
    mockSnapshot.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('boom'),
    });
    const user = userEvent.setup();
    render(<ReceptionCompletePage />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('Recepción cerrada')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception');
  });

  it('shows a plain message with a way back when the snapshot is null, without a thrown error', async () => {
    mockSnapshot.mockReturnValue({ data: null, isLoading: false, error: null });
    const user = userEvent.setup();
    render(<ReceptionCompletePage />);
    expect(screen.getByText('No se pudo cargar el acta de recepción')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception');
  });

  it('"Volver a recepción" navigates back to the reception hub', async () => {
    const user = userEvent.setup();
    render(<ReceptionCompletePage />);
    await user.click(screen.getByRole('button', { name: /Volver a recepción/ }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception');
  });

  it('"Ver detalle de la ruta" navigates to this route\'s preview', async () => {
    const user = userEvent.setup();
    render(<ReceptionCompletePage />);
    await user.click(screen.getByRole('button', { name: /Ver detalle de la ruta/ }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception/route/r1/preview');
  });

  it('excludes the route just closed from the next-yard-route candidates', () => {
    // Only candidate left in the yard is the route that was just closed
    // (id r1) — the acta must not point at the truck it is itself the
    // receipt for.
    mockIncoming.mockReturnValue({
      data: [yardRoute({ id: 'r1', code: 'PR-2026-0148' })],
      isLoading: false,
      error: null,
    });
    render(<ReceptionCompletePage />);
    expect(screen.queryByText(/QUEDA 1 RUTA EN PATIO/)).not.toBeInTheDocument();
  });

  it('picks the route that has waited longest when several are in the yard', () => {
    const oldest = yardRoute({
      id: 'r3',
      code: 'PR-2026-OLDEST',
      in_transit_at: '2026-08-20T09:00:00Z',
    });
    const middle = yardRoute({
      id: 'r4',
      code: 'PR-2026-MIDDLE',
      in_transit_at: '2026-08-20T11:00:00Z',
    });
    const newest = yardRoute({
      id: 'r5',
      code: 'PR-2026-NEWEST',
      in_transit_at: '2026-08-20T13:00:00Z',
    });
    mockIncoming.mockReturnValue({
      data: [newest, oldest, middle],
      isLoading: false,
      error: null,
    });
    render(<ReceptionCompletePage />);
    expect(screen.getByText('PR-2026-OLDEST')).toBeInTheDocument();
    expect(screen.queryByText('PR-2026-MIDDLE')).not.toBeInTheDocument();
    expect(screen.queryByText('PR-2026-NEWEST')).not.toBeInTheDocument();
  });

  it('passes null when no other route waits in the yard', () => {
    mockIncoming.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<ReceptionCompletePage />);
    expect(screen.queryByText(/QUEDA 1 RUTA EN PATIO/)).not.toBeInTheDocument();
  });

  it('requests in_transit yard routes for the current operator', () => {
    render(<ReceptionCompletePage />);
    expect(mockIncoming).toHaveBeenCalledWith('op-1', 'in_transit');
  });
});
