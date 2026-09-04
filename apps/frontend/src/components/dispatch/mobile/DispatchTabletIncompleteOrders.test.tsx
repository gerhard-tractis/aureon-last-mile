import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchTabletIncompleteOrders } from './DispatchTabletIncompleteOrders';

describe('DispatchTabletIncompleteOrders', () => {
  it('renders nothing when there are no incomplete orders', () => {
    const { container } = render(<DispatchTabletIncompleteOrders orders={[]} boxCounts={new Map()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each order with its "loaded de total" fraction', () => {
    render(
      <DispatchTabletIncompleteOrders
        orders={[{ orderId: 'o1', orderNumber: 'ORD-48177' }]}
        boxCounts={new Map([['o1', { loaded: 2, total: 3 }]])}
      />,
    );
    expect(screen.getByText('ORD-48177')).toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
  });

  it('omits the fraction (never fabricates one) when box counts are missing for an order', () => {
    render(
      <DispatchTabletIncompleteOrders
        orders={[{ orderId: 'o1', orderNumber: 'ORD-48177' }]}
        boxCounts={new Map()}
      />,
    );
    expect(screen.getByText('ORD-48177')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ de \d+$/)).not.toBeInTheDocument();
  });
});
