import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute } from '@/lib/dispatch/types';
import { FINISHED_ROUTE_STATUSES } from '@/lib/dispatch/types';

const mockUseDispatchRoutesByStatus = vi.fn();
vi.mock('@/hooks/dispatch/useDispatchRoutesByStatus', () => ({
  useDispatchRoutesByStatus: (...args: unknown[]) => mockUseDispatchRoutesByStatus(...args),
}));

vi.mock('./RouteListTile', () => ({
  RouteListTile: ({ route, onClick }: { route: DispatchRoute; onClick: () => void }) =>
    React.createElement('button', { onClick, 'data-testid': `open-${route.id}` }, route.external_route_id),
}));

import { DispatchCompletedRoutesTab } from './DispatchCompletedRoutesTab';

const ROUTES: DispatchRoute[] = [
  { id: 'r1', operator_id: 'op-1', external_route_id: 'DT-1', route_date: '2026-04-24',
    driver_name: 'Juan', vehicle_id: null, truck_identifier: null, status: 'completed',
    planned_stops: 10, completed_stops: 10, created_at: '2026-04-24T08:00:00Z' },
];

describe('DispatchCompletedRoutesTab', () => {
  beforeEach(() => {
    mockUseDispatchRoutesByStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Fixed clock — via daysAgoISO, resolved fresh at render time, not a
  // module-load snapshot — so this can't flake on a run straddling midnight.
  it('queries FINISHED_ROUTE_STATUSES since 7 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T10:00:00Z'));
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    render(<DispatchCompletedRoutesTab operatorId="op-1" onNavigate={vi.fn()} />);
    expect(mockUseDispatchRoutesByStatus).toHaveBeenCalledWith(
      'op-1',
      [...FINISHED_ROUTE_STATUSES],
      '2026-04-17',
    );
  });

  it('shows the shared route skeleton while loading', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: undefined, isLoading: true });
    render(<DispatchCompletedRoutesTab operatorId="op-1" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('open-r1')).not.toBeInTheDocument();
  });

  it('shows an empty state with no action when there are no completed routes', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    render(<DispatchCompletedRoutesTab operatorId="op-1" onNavigate={vi.fn()} />);
    expect(screen.getByText('Sin rutas completadas')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a tile per completed route and wires navigate', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: ROUTES, isLoading: false });
    const onNavigate = vi.fn();
    render(<DispatchCompletedRoutesTab operatorId="op-1" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('open-r1'));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });
});
