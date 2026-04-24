import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute, RouteDispatchSummary } from '@/lib/dispatch/types';

const mockUseRouteDispatches = vi.fn();
vi.mock('@/hooks/dispatch/useRouteDispatches', () => ({
  useRouteDispatches: (...args: unknown[]) => mockUseRouteDispatches(...args),
}));

import { RouteActivityRow } from './RouteActivityRow';

const BASE_ROUTE: DispatchRoute = {
  id: 'route-1',
  operator_id: 'op-1',
  external_route_id: 'DT-00A1',
  route_date: '2026-04-24',
  driver_name: 'Juan Pérez',
  vehicle_id: null,
  truck_identifier: 'Camión 01',
  status: 'in_progress',
  planned_stops: 26,
  completed_stops: 24,
  created_at: '2026-04-24T08:00:00Z',
};

describe('RouteActivityRow — collapsed header', () => {
  beforeEach(() => {
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('renders driver name in the header', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('renders truck identifier and external route id', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/Camión 01/)).toBeInTheDocument();
    expect(screen.getByText(/DT-00A1/)).toBeInTheDocument();
  });

  it('falls back to "Sin conductor" when driver_name is null', () => {
    render(
      <RouteActivityRow route={{ ...BASE_ROUTE, driver_name: null }} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/Sin conductor/i)).toBeInTheDocument();
  });

  it('renders planned_stops as Asignadas count', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId('stat-asignadas')).toHaveTextContent('26');
  });

  it('renders cumplimiento percentage (24/26 = 92.3%)', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/92\.3%/)).toBeInTheDocument();
  });

  it('shows green color at ≥90% cumplimiento', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/92\.3%/)).toHaveClass('text-green-500');
  });

  it('shows amber color at 70–89% cumplimiento', () => {
    const amberRoute = { ...BASE_ROUTE, planned_stops: 10, completed_stops: 8 }; // 80%
    render(<RouteActivityRow route={amberRoute} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('80%')).toHaveClass('text-amber-500');
  });

  it('shows red color below 70% cumplimiento', () => {
    const redRoute = { ...BASE_ROUTE, planned_stops: 10, completed_stops: 5 }; // 50%
    render(<RouteActivityRow route={redRoute} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('50%')).toHaveClass('text-red-500');
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Juan Pérez/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('does not show expanded panel when isOpen is false', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.queryByTestId('route-expanded-panel')).not.toBeInTheDocument();
  });
});

const DISPATCHES: RouteDispatchSummary[] = [
  {
    dispatch_id: 'dp-1', order_id: 'ord-1', order_number: 'ORD-4521',
    contact_name: 'María Rodríguez', contact_address: 'Av. Providencia 1234',
    contact_phone: '+56987654321', status: 'failed',
  },
  {
    dispatch_id: 'dp-2', order_id: 'ord-2', order_number: 'ORD-4522',
    contact_name: 'Carlos Méndez', contact_address: 'Las Condes 890',
    contact_phone: null, status: 'delivered',
  },
];

describe('RouteActivityRow — expanded panel', () => {
  beforeEach(() => {
    mockUseRouteDispatches.mockReturnValue({ data: DISPATCHES, isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('shows the expanded panel when isOpen is true', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('route-expanded-panel')).toBeInTheDocument();
  });

  it('renders order numbers in the order list', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    // ORD-4521 is auto-selected so it appears in both the list and the detail pane
    expect(screen.getAllByText('ORD-4521').length).toBeGreaterThan(0);
    expect(screen.getByText('ORD-4522')).toBeInTheDocument();
  });

  it('auto-selects the first order and shows its detail on open', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    // Address appears in both list row and detail pane for the auto-selected order
    expect(screen.getAllByText('Av. Providencia 1234').length).toBeGreaterThan(0);
  });

  it('clicking an order in the list shows its detail', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByText('ORD-4522'));
    expect(screen.getByText('Carlos Méndez')).toBeInTheDocument();
  });

  it('shows "—" for phone when contact_phone is null', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByText('ORD-4522'));
    expect(screen.getByTestId('order-phone')).toHaveTextContent('—');
  });

  it('renders the map placeholder column', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('map-placeholder')).toBeInTheDocument();
  });

  it('shows skeleton rows while dispatches are loading', () => {
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: true, isError: false, refetch: vi.fn() });
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('orders-loading')).toBeInTheDocument();
  });

  it('shows inline error message and retry button on hook error', () => {
    const mockRefetch = vi.fn();
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: false, isError: true, refetch: mockRefetch });
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/No se pudo cargar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it('updates exact Entregadas/Fallidas/Pendientes counts when expanded', () => {
    // DISPATCHES: 1 failed, 1 delivered → Entregadas=1, Fallidas=1, Pendientes=0
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('stat-entregadas')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-fallidas')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-pendientes')).toHaveTextContent('0');
  });
});
