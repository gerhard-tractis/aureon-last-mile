import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

vi.mock('./DateFilterBar', () => ({ default: () => <div data-testid="date-filter" /> }));
vi.mock('./OtifByRetailerTable', () => ({ default: () => <div data-testid="otif-retailer-table" /> }));
vi.mock('./LateDeliveriesTable', () => ({ default: () => <div data-testid="late-deliveries-table" /> }));
vi.mock('./OrdersDetailTable', () => ({ default: (props: { initialStatus?: string; initialOverdueOnly?: boolean }) => (
  <div data-testid="orders-detail-table" data-status={props.initialStatus ?? ''} data-overdue={String(props.initialOverdueOnly ?? false)} />
)}));
vi.mock('@/hooks/useDatePreset', () => ({
  useDatePreset: () => ({
    startDate: '2026-03-01',
    endDate: '2026-03-09',
    prevStartDate: '2026-02-19',
    prevEndDate: '2026-02-28',
  }),
}));

const mockOtif = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifMetrics: (...args: unknown[]) => mockOtif(...args),
}));

import DeliveryTab from './DeliveryTab';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const OTIF_DATA = {
  total_orders: 530,
  delivered_orders: 505,
  failed_orders: 10,
  in_route_orders: 7,
  pending_orders: 8,
  on_time_deliveries: 480,
  otif_percentage: 90.6,
};

describe('DeliveryTab', () => {
  it('renders all sections when data is loaded', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false, isSuccess: true });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('delivery-tab')).toBeInTheDocument();
    expect(screen.getByTestId('date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('otif-hero')).toBeInTheDocument();
    expect(screen.getByTestId('outcome-strip')).toBeInTheDocument();
  });

  it('shows OTIF percentage with color coding', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero).toHaveTextContent('90.6');
    expect(hero.className).toContain('bg-amber');
  });

  it('shows yellow OTIF when between 85-95%', () => {
    const data = { ...OTIF_DATA, otif_percentage: 90.0 };
    mockOtif.mockReturnValue({ data, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero.className).toContain('bg-amber');
  });

  it('shows red OTIF when below 85%', () => {
    const data = { ...OTIF_DATA, otif_percentage: 80.0 };
    mockOtif.mockReturnValue({ data, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    const hero = screen.getByTestId('otif-hero');
    expect(hero.className).toContain('bg-red');
  });

  it('shows dash when OTIF is null', () => {
    const data = { ...OTIF_DATA, otif_percentage: null };
    mockOtif.mockReturnValue({ data, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero')).toHaveTextContent('—');
  });

  it('renders all 4 outcome cards with correct counts', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('outcome-delivered')).toHaveTextContent('505');
    expect(screen.getByTestId('outcome-failed')).toHaveTextContent('10');
    expect(screen.getByTestId('outcome-in-route')).toHaveTextContent('7');
    expect(screen.getByTestId('outcome-pending')).toHaveTextContent('8');
  });

  it('shows skeletons during loading', () => {
    mockOtif.mockReturnValue({ data: undefined, isLoading: true });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero-skeleton')).toBeInTheDocument();
  });

  it('shows OTIF subtitle with on-time / total counts', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });

    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-hero')).toHaveTextContent(
      '480 de 530 pedidos entregados a tiempo'
    );
  });

  it('renders all detail sections', () => {
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    expect(screen.getByTestId('otif-retailer-table')).toBeInTheDocument();
    expect(screen.getByTestId('late-deliveries-table')).toBeInTheDocument();
    expect(screen.getByTestId('orders-detail-table')).toBeInTheDocument();
  });

  it('clicking outcome card sets status filter on orders table', async () => {
    const user = userEvent.setup();
    mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
    render(<DeliveryTab operatorId="test-op" />, { wrapper });

    await user.click(screen.getByTestId('outcome-failed'));
    const table = screen.getByTestId('orders-detail-table');
    expect(table.getAttribute('data-status')).toBe('failed');
  });
});
