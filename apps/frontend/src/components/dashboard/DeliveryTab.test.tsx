import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

vi.mock('./DateFilterBar', () => ({ default: () => <div data-testid="date-filter" /> }));
vi.mock('@/hooks/useDatePreset', () => ({
  useDatePreset: () => ({
    startDate: '2026-03-01',
    endDate: '2026-03-09',
    prevStartDate: '2026-02-19',
    prevEndDate: '2026-02-28',
  }),
}));

const mockOtif = vi.fn();
const mockPending = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifMetrics: (...args: unknown[]) => mockOtif(...args),
  usePendingOrders: (...args: unknown[]) => mockPending(...args),
}));

import DeliveryTab from './DeliveryTab';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const OTIF_DATA = {
  total_orders: 530,
  delivered_orders: 505,
  failed_orders: 25,
  pending_orders: 0,
  on_time_deliveries: 480,
  otif_percentage: 95.0,
};

const PENDING_DATA = {
  overdue_count: 3,
  due_today_count: 12,
  due_tomorrow_count: 8,
  total_pending: 23,
};

describe('DeliveryTab', () => {
  it('renders all sections when data is loaded', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false, isSuccess: true });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false, isSuccess: true });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('delivery-tab')).toBeInTheDocument();
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('otif-hero')).toBeInTheDocument();
    expect(screen.getByTestId('outcome-strip')).toBeInTheDocument();
    expect(screen.getByTestId('pending-strip')).toBeInTheDocument();
  });

  it('shows OTIF percentage with color coding (green ≥95%)', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero).toHaveTextContent('95.0');
    expect(hero.className).toContain('bg-emerald');
  });

  it('shows yellow OTIF when between 85-95%', () => {
    const data = { ...OTIF_DATA, otif_percentage: 90.0 };
    mockOtif.mockReturnValue({ data, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero.className).toContain('bg-amber');
  });

  it('shows red OTIF when below 85%', () => {
    const data = { ...OTIF_DATA, otif_percentage: 80.0 };
    mockOtif.mockReturnValue({ data, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero.className).toContain('bg-red');
  });

  it('shows dash when OTIF is null', () => {
    const data = { ...OTIF_DATA, otif_percentage: null };
    mockOtif.mockReturnValue({ data, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero')).toHaveTextContent('—');
  });

  it('renders delivery outcome cards with correct counts', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('outcome-delivered')).toHaveTextContent('505');
    expect(screen.getByTestId('outcome-failed')).toHaveTextContent('25');
    expect(screen.getByTestId('outcome-pending')).toHaveTextContent('0');
  });

  it('renders pending alert cards with correct counts', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('pending-overdue')).toHaveTextContent('3');
    expect(screen.getByTestId('pending-today')).toHaveTextContent('12');
    expect(screen.getByTestId('pending-tomorrow')).toHaveTextContent('8');
  });

  it('shows pulsing indicator when overdue > 0', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('overdue-pulse')).toBeInTheDocument();
  });

  it('hides pulse when overdue is 0', () => {
    const noOverdue = { ...PENDING_DATA, overdue_count: 0 };
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: noOverdue, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.queryByTestId('overdue-pulse')).toBeNull();
  });

  it('shows skeletons during loading', () => {
    mockOtif.mockReturnValue({ data: undefined, isLoading: true });
    mockPending.mockReturnValue({ data: undefined, isLoading: true });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero-skeleton')).toBeInTheDocument();
  });

  it('shows OTIF subtitle with on-time / delivered counts', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero')).toHaveTextContent(
      '480 de 505 pedidos entregados a tiempo'
    );
  });
});
