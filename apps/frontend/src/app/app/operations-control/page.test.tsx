import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpsControlPage from './page';

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

vi.mock('@/components/operations-control/PipelineOverview', () => ({
  PipelineOverview: () => <div data-testid="pipeline-overview">Pipeline</div>,
}));

vi.mock('@/components/operations-control/UrgentOrdersBanner', () => ({
  UrgentOrdersBanner: () => null,
}));

vi.mock('@/components/operations-control/OrdersFilterToolbar', () => ({
  OrdersFilterToolbar: () => <div data-testid="orders-filter-toolbar">Toolbar</div>,
}));

vi.mock('@/components/operations-control/OrdersTable', () => ({
  OrdersTable: ({ onOpenDetail }: { onOpenDetail: (id: string) => void }) => (
    <div data-testid="orders-table">
      <button onClick={() => onOpenDetail('order-1')}>Open Order</button>
    </div>
  ),
}));

vi.mock('@/components/operations-control/OrderDetailModal', () => ({
  OrderDetailModal: ({
    orderId,
    onClose,
  }: {
    orderId: string | null;
    onClose: () => void;
  }) =>
    orderId ? (
      <div data-testid="order-detail-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
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

  it('renders PipelineOverview when operatorId is present', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('pipeline-overview')).toBeDefined();
  });

  it('renders OrdersFilterToolbar', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('orders-filter-toolbar')).toBeDefined();
  });

  it('renders OrdersTable', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('orders-table')).toBeDefined();
  });

  it('opens OrderDetailModal when order is selected', () => {
    render(<OpsControlPage />);
    expect(screen.queryByTestId('order-detail-modal')).toBeNull();

    fireEvent.click(screen.getByText('Open Order'));
    expect(screen.getByTestId('order-detail-modal')).toBeDefined();
  });

  it('closes modal when onClose is called', () => {
    render(<OpsControlPage />);

    fireEvent.click(screen.getByText('Open Order'));
    expect(screen.getByTestId('order-detail-modal')).toBeDefined();

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('order-detail-modal')).toBeNull();
  });
});
