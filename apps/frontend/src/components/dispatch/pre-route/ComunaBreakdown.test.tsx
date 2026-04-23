import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComunaBreakdown } from './ComunaBreakdown';
import type { PreRouteComuna, PreRouteOrder } from '@/lib/types';

function makeOrder(id: string): PreRouteOrder {
  return {
    id,
    order_number: `ORD-${id}`,
    customer_name: 'Cliente',
    delivery_address: 'Calle 1',
    delivery_window_start: null,
    delivery_window_end: null,
    package_count: 1,
    has_split_dock_zone: false,
  };
}

function makeComuna(overrides: Partial<PreRouteComuna> = {}): PreRouteComuna {
  return {
    id: 'com-1',
    name: 'Santiago',
    order_count: 2,
    package_count: 3,
    orders: [makeOrder('ord-1'), makeOrder('ord-2')],
    ...overrides,
  };
}

describe('ComunaBreakdown', () => {
  it('renders each commune name', () => {
    render(
      <ComunaBreakdown
        comunas={[makeComuna({ name: 'Santiago' }), makeComuna({ id: 'com-2', name: 'Providencia' })]}
      />,
    );
    expect(screen.getByText('Santiago')).toBeInTheDocument();
    expect(screen.getByText('Providencia')).toBeInTheDocument();
  });

  it('renders order_count for each commune', () => {
    render(<ComunaBreakdown comunas={[makeComuna({ order_count: 5 })]} />);
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('does not render orders by default (collapsed)', () => {
    render(<ComunaBreakdown comunas={[makeComuna()]} />);
    expect(screen.queryByText('ORD-ord-1')).not.toBeInTheDocument();
  });

  it('reveals order list when commune row is clicked', () => {
    render(<ComunaBreakdown comunas={[makeComuna()]} />);
    fireEvent.click(screen.getByText('Santiago'));
    expect(screen.getByText('ORD-ord-1')).toBeInTheDocument();
  });

  it('collapses commune row on second click', () => {
    render(<ComunaBreakdown comunas={[makeComuna()]} />);
    const row = screen.getByText('Santiago');
    fireEvent.click(row);
    expect(screen.getByText('ORD-ord-1')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByText('ORD-ord-1')).not.toBeInTheDocument();
  });

  it('renders package_count', () => {
    render(<ComunaBreakdown comunas={[makeComuna({ package_count: 7 })]} />);
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });
});
