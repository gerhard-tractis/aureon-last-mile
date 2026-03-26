import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteListTile } from './RouteListTile';
import type { DispatchRoute } from '@/lib/dispatch/types';

// Mock StatusBadge to verify it receives correct props
vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status, variant }: { status: string; variant?: string }) => (
    <span data-testid="status-badge" data-variant={variant}>{status}</span>
  ),
}));

function makeRoute(overrides: Partial<DispatchRoute> = {}): DispatchRoute {
  return {
    id: 'abcd1234-5678-9012-3456-789012345678',
    operator_id: 'op-1',
    external_route_id: 'RUTA-2830',
    route_date: '2026-03-25',
    driver_name: 'Juan Perez',
    vehicle_id: 'v-1',
    truck_identifier: 'KL-4521',
    status: 'draft',
    planned_stops: 18,
    completed_stops: 12,
    created_at: '2026-03-25T09:41:00Z',
    ...overrides,
  };
}

describe('RouteListTile', () => {
  let onClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClick = vi.fn();
  });

  it('renders external_route_id when available', () => {
    render(<RouteListTile route={makeRoute()} onClick={onClick} />);
    expect(screen.getByText('RUTA-2830')).toBeInTheDocument();
  });

  it('falls back to short ID when external_route_id is null', () => {
    render(
      <RouteListTile
        route={makeRoute({ external_route_id: null })}
        onClick={onClick}
      />,
    );
    expect(screen.getByText('ABCD1234')).toBeInTheDocument();
  });

  it('shows Spanish status label via StatusBadge for draft status', () => {
    render(<RouteListTile route={makeRoute({ status: 'draft' })} onClick={onClick} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('Borrador');
    expect(badge).toHaveAttribute('data-variant', 'neutral');
  });

  it('shows Spanish status label via StatusBadge for planned status', () => {
    render(<RouteListTile route={makeRoute({ status: 'planned' })} onClick={onClick} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('Planificada');
    expect(badge).toHaveAttribute('data-variant', 'info');
  });

  it('shows Spanish status label via StatusBadge for in_progress status', () => {
    render(<RouteListTile route={makeRoute({ status: 'in_progress' })} onClick={onClick} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('En ruta');
    expect(badge).toHaveAttribute('data-variant', 'warning');
  });

  it('shows Spanish status label via StatusBadge for completed status', () => {
    render(<RouteListTile route={makeRoute({ status: 'completed' })} onClick={onClick} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('Completada');
    expect(badge).toHaveAttribute('data-variant', 'success');
  });

  it('shows Spanish status label via StatusBadge for cancelled status', () => {
    render(<RouteListTile route={makeRoute({ status: 'cancelled' })} onClick={onClick} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('Cancelada');
    expect(badge).toHaveAttribute('data-variant', 'error');
  });

  it('shows driver name', () => {
    render(<RouteListTile route={makeRoute()} onClick={onClick} />);
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument();
  });

  it('shows "Sin conductor" when driver_name is null', () => {
    render(
      <RouteListTile
        route={makeRoute({ driver_name: null })}
        onClick={onClick}
      />,
    );
    expect(screen.getByText(/Sin conductor/)).toBeInTheDocument();
  });

  it('shows truck identifier when available', () => {
    render(<RouteListTile route={makeRoute()} onClick={onClick} />);
    expect(screen.getByText(/KL-4521/)).toBeInTheDocument();
  });

  it('shows progress bar with correct width', () => {
    render(<RouteListTile route={makeRoute({ completed_stops: 12, planned_stops: 18 })} onClick={onClick} />);
    const progressBar = screen.getByRole('progressbar');
    // 12/18 = 66.67%
    const fill = progressBar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('66.67%');
  });

  it('shows progress text with completed/planned stops', () => {
    render(<RouteListTile route={makeRoute({ completed_stops: 12, planned_stops: 18 })} onClick={onClick} />);
    expect(screen.getByText(/12\/18/)).toBeInTheDocument();
    expect(screen.getByText(/paquetes/)).toBeInTheDocument();
  });

  it('shows route date in Spanish format', () => {
    render(<RouteListTile route={makeRoute({ route_date: '2026-03-25' })} onClick={onClick} />);
    // Should display formatted Spanish date — at minimum the day number should appear
    expect(screen.getByText(/25/)).toBeInTheDocument();
    expect(screen.getByText(/mar/i)).toBeInTheDocument();
  });

  it('adds overdue styling when route_date < today and status is draft', () => {
    const pastDate = '2020-01-01';
    const { container } = render(
      <RouteListTile
        route={makeRoute({ route_date: pastDate, status: 'draft' })}
        onClick={onClick}
      />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.className).toMatch(/border-status-warning-border/);
    expect(tile.className).toMatch(/bg-status-warning-bg/);
  });

  it('adds overdue styling when route_date < today and status is planned', () => {
    const pastDate = '2020-01-01';
    const { container } = render(
      <RouteListTile
        route={makeRoute({ route_date: pastDate, status: 'planned' })}
        onClick={onClick}
      />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.className).toMatch(/border-status-warning-border/);
    expect(tile.className).toMatch(/bg-status-warning-bg/);
  });

  it('does NOT add overdue styling when status is in_progress even if past date', () => {
    const pastDate = '2020-01-01';
    const { container } = render(
      <RouteListTile
        route={makeRoute({ route_date: pastDate, status: 'in_progress' })}
        onClick={onClick}
      />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.className).not.toMatch(/border-status-warning-border/);
  });

  it('calls onClick when clicked', () => {
    render(<RouteListTile route={makeRoute()} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter key', () => {
    render(<RouteListTile route={makeRoute()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
