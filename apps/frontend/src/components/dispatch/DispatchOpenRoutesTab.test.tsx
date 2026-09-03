import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute } from '@/lib/dispatch/types';
import { OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';

const mockUseDispatchRoutesByStatus = vi.fn();
vi.mock('@/hooks/dispatch/useDispatchRoutesByStatus', () => ({
  useDispatchRoutesByStatus: (...args: unknown[]) => mockUseDispatchRoutesByStatus(...args),
}));

vi.mock('./RouteListTile', () => ({
  RouteListTile: ({ route, onClick, onDelete }: { route: DispatchRoute; onClick: () => void; onDelete?: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': `tile-${route.id}` },
      React.createElement('button', { onClick, 'data-testid': `open-${route.id}` }, route.external_route_id),
      onDelete && React.createElement('button', { onClick: onDelete, 'data-testid': `delete-${route.id}` }, 'delete'),
    ),
}));

import { DispatchOpenRoutesTab } from './DispatchOpenRoutesTab';

const ROUTES: DispatchRoute[] = [
  { id: 'r1', operator_id: 'op-1', external_route_id: 'DT-1', route_date: '2026-04-24',
    driver_name: 'Juan', vehicle_id: null, truck_identifier: null, status: 'draft',
    planned_stops: 10, completed_stops: 0, created_at: '2026-04-24T08:00:00Z' },
];

describe('DispatchOpenRoutesTab', () => {
  beforeEach(() => {
    mockUseDispatchRoutesByStatus.mockReset();
  });

  it('queries OPEN_ROUTE_STATUSES, not some other status list', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(mockUseDispatchRoutesByStatus).toHaveBeenCalledWith('op-1', [...OPEN_ROUTE_STATUSES]);
  });

  it('shows the shared route skeleton while loading', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: undefined, isLoading: true });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('tile-r1')).not.toBeInTheDocument();
  });

  it('shows an empty state with a create-route action when there are no open routes', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    const onNewRoute = vi.fn();
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={onNewRoute} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Sin rutas en carga')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear ruta' }));
    expect(onNewRoute).toHaveBeenCalled();
  });

  it('renders a tile per open route and wires navigate/delete', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: ROUTES, isLoading: false });
    const onNavigate = vi.fn();
    const onDelete = vi.fn();
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={onNavigate} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('open-r1'));
    expect(onNavigate).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByTestId('delete-r1'));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });
});
