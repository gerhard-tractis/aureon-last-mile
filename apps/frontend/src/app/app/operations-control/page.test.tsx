import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/app/operations-control',
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-1', role: 'admin', permissions: [] })),
}));
vi.mock('@/hooks/useRealtimeStatus', () => ({
  useRealtimeStatus: vi.fn(() => 'connected' as const),
}));

const mockPromise = {
  total: 1284,
  delivered: 823,
  inFlight: 261,
  atRisk: 117,
  late: 83,
  segments: [],
  isLoading: false,
};
vi.mock('@/hooks/ops-control/useDayPromise', () => ({
  useDayPromise: () => mockPromise,
}));

vi.mock('@/components/operations-control/RealtimeStatusIndicator', () => ({
  RealtimeStatusIndicator: ({ status }: { status: string }) => (
    <span data-testid="realtime-indicator">{status}</span>
  ),
}));
vi.mock('./components/OpsControlDesktop', () => ({
  OpsControlDesktop: () => <div data-testid="ops-desktop" />,
}));
vi.mock('@/components/inspector/OrderInspector', () => ({
  OrderInspector: ({ orderId }: { orderId: string | null }) =>
    orderId ? <div data-testid="order-inspector" /> : null,
}));

import OpsControlPage from './page';
import { useOperatorId } from '@/hooks/useOperatorId';

describe('OpsControlPage', () => {
  beforeEach(() => {
    vi.mocked(useOperatorId).mockReturnValue({
      operatorId: 'op-1',
    } as ReturnType<typeof useOperatorId>);
  });

  it('renders the tower heading, not the old PageShell title', () => {
    render(<OpsControlPage />);
    expect(screen.getByRole('heading', { name: 'Torre de control' })).toBeInTheDocument();
    expect(screen.queryByText('Control de Operaciones')).toBeNull();
    expect(screen.getByTestId('ops-desktop')).toBeInTheDocument();
  });

  it('summarises the day in the subtitle from live counts', () => {
    render(<OpsControlPage />);
    expect(screen.getByText('1.284')).toBeInTheDocument();
    expect(screen.getByText('83')).toBeInTheDocument();
  });

  it('keeps the realtime indicator', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('realtime-indicator')).toBeInTheDocument();
  });

  it('offers a route-creation entry point', () => {
    render(<OpsControlPage />);
    const link = screen.getByRole('link', { name: /nueva ruta/i });
    expect(link.getAttribute('href')).toBe('/app/dispatch');
  });

  it('renders loading when no operatorId', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: null } as ReturnType<typeof useOperatorId>);
    render(<OpsControlPage />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });
});
