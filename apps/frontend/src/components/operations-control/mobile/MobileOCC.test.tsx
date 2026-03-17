import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileOCC } from './MobileOCC';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const pushMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock('@/hooks/usePipelineCounts', () => ({
  usePipelineCounts: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/usePriorityCounts', () => ({
  usePriorityCounts: () => ({
    urgent: 3,
    alert: 1,
    ok: 10,
    late: 2,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useOperationsOrders', () => ({
  useOperationsOrders: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/stores/useOpsControlFilterStore', () => ({
  useOpsControlFilterStore: () => ({
    stageFilter: null,
    datePreset: 'today',
    dateRange: null,
    statusFilter: 'all',
  }),
}));

vi.mock('./MobileStatusCards', () => ({
  MobileStatusCards: ({ counts }: { counts: { urgent: number } }) => (
    <div data-testid="mobile-status-cards">urgent={counts.urgent}</div>
  ),
}));

vi.mock('./MobileOrdersList', () => ({
  MobileOrdersList: ({ orders }: { orders: unknown[] }) => (
    <div data-testid="mobile-orders-list">orders={orders.length}</div>
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MobileOCC', () => {
  beforeEach(() => {
    pushMock.mockClear();
    searchParams = new URLSearchParams();
  });

  it('renders without crashing when given an operatorId', () => {
    const { container } = render(<MobileOCC operatorId="op-123" />);
    expect(container).toBeDefined();
  });

  it('renders the header with "Ops Control" text', () => {
    render(<MobileOCC operatorId="op-123" />);
    expect(screen.getByText('Ops Control')).toBeDefined();
  });

  it('renders MobileTabBar with tab buttons', () => {
    render(<MobileOCC operatorId="op-123" />);
    expect(screen.getByTestId('tab-ops')).toBeDefined();
    expect(screen.getByTestId('tab-dashboard')).toBeDefined();
    expect(screen.getByTestId('tab-orders')).toBeDefined();
    expect(screen.getByTestId('tab-reports')).toBeDefined();
    expect(screen.getByTestId('tab-mas')).toBeDefined();
  });

  it('defaults to ops tab when no search param is set', () => {
    render(<MobileOCC operatorId="op-123" />);
    const opsTab = screen.getByTestId('tab-ops');
    expect(opsTab.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders MobileStatusCards on ops tab', () => {
    render(<MobileOCC operatorId="op-123" />);
    expect(screen.getByTestId('mobile-status-cards')).toBeDefined();
  });

  it('renders MobileOrdersList on ops tab', () => {
    render(<MobileOCC operatorId="op-123" />);
    expect(screen.getByTestId('mobile-orders-list')).toBeDefined();
  });

  it('renders "Próximamente" on reports tab', () => {
    searchParams = new URLSearchParams('tab=reports');
    render(<MobileOCC operatorId="op-123" />);
    expect(screen.getByText('Próximamente')).toBeDefined();
  });

  it('calls router.push with correct ?tab= param on tab change', () => {
    render(<MobileOCC operatorId="op-123" />);
    fireEvent.click(screen.getByTestId('tab-reports'));
    expect(pushMock).toHaveBeenCalledWith('?tab=reports', { scroll: false });
  });

  it('navigates to /app/dashboard when dashboard tab is clicked', () => {
    render(<MobileOCC operatorId="op-123" />);
    fireEvent.click(screen.getByTestId('tab-dashboard'));
    expect(pushMock).toHaveBeenCalledWith('/app/dashboard');
  });

  it('navigates to /app/orders when orders tab is clicked', () => {
    render(<MobileOCC operatorId="op-123" />);
    fireEvent.click(screen.getByTestId('tab-orders'));
    expect(pushMock).toHaveBeenCalledWith('/app/orders');
  });
});
