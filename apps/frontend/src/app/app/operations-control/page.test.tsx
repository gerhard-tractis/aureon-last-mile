import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpsControlPage from './page';
import { useIsMobile } from '@/hooks/useIsMobile';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-1', role: 'admin', permissions: [] })),
}));

vi.mock('@/hooks/useRealtimeOrders', () => ({
  useRealtimeOrders: vi.fn(),
}));

vi.mock('@/hooks/useRealtimeStatus', () => ({
  useRealtimeStatus: vi.fn(() => 'connected'),
}));

vi.mock('@/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: vi.fn(() => ({
    statusFilter: 'all',
    setStatusFilter: vi.fn(),
  })),
}));

vi.mock('@/components/PageShell', () => ({
  PageShell: ({ children, title, actions }: { children: React.ReactNode; title: string; actions?: React.ReactNode }) => (
    <div data-testid="page-shell">
      <h1>{title}</h1>
      {actions && <div data-testid="page-shell-actions">{actions}</div>}
      {children}
    </div>
  ),
}));

vi.mock('@/components/operations-control/RealtimeStatusIndicator', () => ({
  RealtimeStatusIndicator: () => <div data-testid="realtime-status-indicator">En vivo</div>,
}));

vi.mock('@/components/operations-control/PipelineOverview', () => ({
  PipelineOverview: () => <div data-testid="pipeline-overview">Pipeline</div>,
}));

vi.mock('@/components/operations-control/UrgentOrdersBanner', () => ({
  UrgentOrdersBanner: () => <div data-testid="urgent-orders-banner" />,
}));

vi.mock('@/components/operations-control/OrdersTable', () => ({
  OrdersTable: ({ onOpenDetail }: { onOpenDetail: (id: string) => void }) => (
    <div data-testid="orders-table">
      <button onClick={() => onOpenDetail('order-1')}>Open Order</button>
    </div>
  ),
}));

vi.mock('@/components/operations-control/OrderDetailSheet', () => ({
  OrderDetailSheet: ({
    orderId,
    onClose,
  }: {
    orderId: string | null;
    onClose: () => void;
  }) =>
    orderId ? (
      <div data-testid="order-detail-sheet">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

vi.mock('@/components/operations-control/mobile/MobileOCC', () => ({
  MobileOCC: ({ operatorId }: { operatorId: string }) => (
    <div data-testid="mobile-occ" data-operator-id={operatorId}>
      MobileOCC
    </div>
  ),
}));

describe('OpsControlPage', () => {
  it('shows loading when operatorId is null', async () => {
    const { useOperatorId } = await import('@/hooks/useOperatorId');
    vi.mocked(useOperatorId).mockReturnValueOnce({
      operatorId: null,
      role: null,
      permissions: [],
    } as never);

    render(<OpsControlPage />);
    expect(screen.getByText('Cargando...')).toBeDefined();
  });

  it('renders desktop layout when useIsMobile returns false', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.getByTestId('pipeline-overview')).toBeDefined();
    expect(screen.queryByTestId('mobile-occ')).toBeNull();
  });

  it('renders MobileOCC when useIsMobile returns true', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<OpsControlPage />);
    expect(screen.getByTestId('mobile-occ')).toBeDefined();
    expect(screen.queryByTestId('pipeline-overview')).toBeNull();
  });

  it('renders PipelineOverview when operatorId is present', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.getByTestId('pipeline-overview')).toBeDefined();
  });

  it('renders UrgentOrdersBanner', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.getByTestId('urgent-orders-banner')).toBeDefined();
  });

  it('renders RealtimeStatusIndicator in PageShell actions', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.getByTestId('realtime-status-indicator')).toBeDefined();
  });

  it('renders OrdersTable', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.getByTestId('orders-table')).toBeDefined();
  });

  it('opens OrderDetailSheet when order is selected', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);
    expect(screen.queryByTestId('order-detail-sheet')).toBeNull();

    fireEvent.click(screen.getByText('Open Order'));
    expect(screen.getByTestId('order-detail-sheet')).toBeDefined();
  });

  it('closes sheet when onClose is called', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OpsControlPage />);

    fireEvent.click(screen.getByText('Open Order'));
    expect(screen.getByTestId('order-detail-sheet')).toBeDefined();

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('order-detail-sheet')).toBeNull();
  });
});
