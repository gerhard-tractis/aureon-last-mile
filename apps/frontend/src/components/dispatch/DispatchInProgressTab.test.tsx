import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute } from '@/lib/dispatch/types';

const mockUseDispatchRoutesByStatus = vi.fn();
vi.mock('@/hooks/dispatch/useDispatchRoutesByStatus', () => ({
  useDispatchRoutesByStatus: (...args: unknown[]) => mockUseDispatchRoutesByStatus(...args),
}));

vi.mock('./RouteActivityRow', () => ({
  RouteActivityRow: ({ route, isOpen, onToggle }: { route: DispatchRoute; isOpen: boolean; onToggle: () => void }) =>
    React.createElement('div', { 'data-testid': `row-${route.id}`, 'data-open': String(isOpen), onClick: onToggle }, route.driver_name),
}));

import { DispatchInProgressTab } from './DispatchInProgressTab';

const ROUTES: DispatchRoute[] = [
  { id: 'r1', operator_id: 'op-1', external_route_id: 'DT-1', route_date: '2026-04-24',
    driver_name: 'Juan', vehicle_id: null, truck_identifier: null, status: 'in_progress',
    planned_stops: 10, completed_stops: 9, created_at: '2026-04-24T08:00:00Z' },
  { id: 'r2', operator_id: 'op-1', external_route_id: 'DT-2', route_date: '2026-04-24',
    driver_name: 'Ana', vehicle_id: null, truck_identifier: null, status: 'in_progress',
    planned_stops: 8, completed_stops: 4, created_at: '2026-04-24T08:00:00Z' },
];

describe('DispatchInProgressTab', () => {
  beforeEach(() => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: ROUTES, isLoading: false });
  });

  it('renders a RouteActivityRow for each in-progress route', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('row-r2')).toBeInTheDocument();
  });

  it('only one row is open at a time (accordion)', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    fireEvent.click(screen.getByTestId('row-r1'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('row-r2')).toHaveAttribute('data-open', 'false');
    fireEvent.click(screen.getByTestId('row-r2'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('row-r2')).toHaveAttribute('data-open', 'true');
  });

  it('clicking the open row again closes it', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    fireEvent.click(screen.getByTestId('row-r1'));
    fireEvent.click(screen.getByTestId('row-r1'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'false');
  });

  it('renders the fleet summary strip', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('fleet-summary')).toBeInTheDocument();
  });

  it('fleet summary shows weighted cumplimiento promedio', () => {
    // r1: 9/10, r2: 4/8 → (9+4)/(10+8) = 13/18 = 72.2%
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('fleet-cumplimiento')).toHaveTextContent('72.2%');
  });

  it('shows EmptyState when there are no in-progress routes', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByText(/Sin rutas en camino/i)).toBeInTheDocument();
  });
});
