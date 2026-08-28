import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MoveTaskPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1', role: 'ops_leader' }),
}));

const SNAPSHOT = {
  generated_at: '2026-08-28T12:00:00Z',
  routes: [
    {
      route_id: 'route-1',
      external_route_id: 'R-042',
      driver_name: 'Juan',
      load_position_id: 'pos-1',
      load_position_code: 'POS-02',
      load_position_label: 'Frente a Andén A2',
      total_packages: 37,
      remaining_packages: 14,
      offset_conflict: false,
      groups: [
        { dock_zone_id: 'z1', dock_zone_code: 'A1', dock_zone_name: 'Andén A1', is_retired: false, remaining_count: 6 },
        { dock_zone_id: 'z3', dock_zone_code: 'A3', dock_zone_name: 'Andén A3', is_retired: false, remaining_count: 8 },
      ],
    },
  ],
  unassigned_routes: [],
};

let mockSnapshotResult: {
  snapshot: typeof SNAPSHOT | null;
  isLoading: boolean;
  isError: boolean;
  fetchStatus: string;
  isSuccess: boolean;
} = { snapshot: SNAPSHOT, isLoading: false, isError: false, fetchStatus: 'idle', isSuccess: true };

vi.mock('@/hooks/distribution/useMoveTaskSnapshot', () => ({
  useMoveTaskSnapshot: () => mockSnapshotResult,
}));

describe('MoveTaskPage', () => {
  it('renders the snapshot routes once loaded', () => {
    mockSnapshotResult = { snapshot: SNAPSHOT, isLoading: false, isError: false, fetchStatus: 'idle', isSuccess: true };
    render(<MoveTaskPage />);
    expect(screen.getByText(/Ruta R-042/)).toBeInTheDocument();
    expect(screen.getByText('Faltan 14 de 37')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the snapshot is loading', () => {
    mockSnapshotResult = { snapshot: null, isLoading: true, isError: false, fetchStatus: 'fetching', isSuccess: false };
    render(<MoveTaskPage />);
    expect(screen.getByTestId('move-task-page-skeleton')).toBeInTheDocument();
  });

  it('renders the footer Escanear link to quicksort', () => {
    mockSnapshotResult = { snapshot: SNAPSHOT, isLoading: false, isError: false, fetchStatus: 'idle', isSuccess: true };
    render(<MoveTaskPage />);
    const link = screen.getByRole('link', { name: /Escanear/i });
    expect(link).toHaveAttribute('href', '/app/distribution/quicksort');
  });

  // Review fix (item 5) — a failed RPC used to fall through to the same
  // confident empty state as "nothing to move" ('Nada por mover'). Those
  // are different facts and must render differently.
  it('renders a distinct error state when the snapshot query fails, not the empty state', () => {
    mockSnapshotResult = { snapshot: null, isLoading: false, isError: true, fetchStatus: 'idle', isSuccess: false };
    render(<MoveTaskPage />);
    expect(screen.getByText('No pudimos cargar el listado')).toBeInTheDocument();
    expect(screen.queryByText('Nada por mover')).not.toBeInTheDocument();
    expect(screen.queryByTestId('move-task-page-skeleton')).not.toBeInTheDocument();
  });

  // Review fix (item 5) — before useOperatorId() resolves, the query is
  // `enabled: false` and reports isLoading:false too. That pre-auth frame
  // must render as loading, not as "Nada por mover".
  it('treats the pre-auth frame (no operatorId yet) as loading, not empty', () => {
    mockSnapshotResult = { snapshot: null, isLoading: false, isError: false, fetchStatus: 'idle', isSuccess: false };
    render(<MoveTaskPage />);
    expect(screen.getByTestId('move-task-page-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Nada por mover')).not.toBeInTheDocument();
  });
});
