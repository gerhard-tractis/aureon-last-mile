import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnroutedOrderRow } from './UnroutedOrderRow';
import type { UnroutedOrderRow as OrderRow } from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import * as useOrderPackagesModule from '@/hooks/dispatch/pre-route/useOrderPackages';

const ORDER: OrderRow = {
  id: 'o1',
  orderNumber: 'ORD-48177',
  comunaName: 'Calera de Tango',
  address: 'Camino Real 123',
  packageCount: 3,
  windowStart: '08:00:00',
  windowEnd: '12:00:00',
  hasSplitDockZone: false,
};

const BASE = {
  order: ORDER,
  selected: false,
  onToggle: () => {},
  operatorId: 'op-1',
};

vi.spyOn(useOrderPackagesModule, 'useOrderPackages').mockReturnValue({
  data: undefined,
  isLoading: false,
  isError: false,
} as ReturnType<typeof useOrderPackagesModule.useOrderPackages>);

describe('UnroutedOrderRow', () => {
  it('shows the order, comuna, address, package count and window', () => {
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.getByText('ORD-48177')).toBeInTheDocument();
    expect(screen.getByText('Calera de Tango')).toBeInTheDocument();
    expect(screen.getByText('Camino Real 123')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('08:00–12:00')).toBeInTheDocument();
  });

  it('makes the whole row the hit target for selection', async () => {
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByText('ORD-48177'));
    expect(onToggle).toHaveBeenCalledWith('o1');
  });

  it('reports selection state through aria-checked', () => {
    render(<UnroutedOrderRow {...BASE} selected />);
    expect(screen.getByTestId('unrouted-order-o1')).toHaveAttribute('aria-checked', 'true');
  });

  it('is collapsed by default and does not fetch packages', () => {
    const spy = vi.spyOn(useOrderPackagesModule, 'useOrderPackages');
    render(<UnroutedOrderRow {...BASE} />);
    expect(screen.queryByTestId('order-packages-loading')).toBeNull();
    expect(spy).toHaveBeenLastCalledWith('o1', 'op-1', false);
  });

  it('expands on chevron click without toggling selection', async () => {
    const onToggle = vi.fn();
    render(<UnroutedOrderRow {...BASE} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /expandir/i }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(useOrderPackagesModule.useOrderPackages).toHaveBeenLastCalledWith('o1', 'op-1', true);
  });

  it('flags an order split across dock zones', () => {
    render(<UnroutedOrderRow {...BASE} order={{ ...ORDER, hasSplitDockZone: true }} />);
    expect(screen.getByLabelText(/varios andenes/i)).toBeInTheDocument();
  });

  it('shows a placeholder window when the order has none', () => {
    render(<UnroutedOrderRow {...BASE} order={{ ...ORDER, windowStart: null, windowEnd: null }} />);
    expect(screen.getByText('Sin ventana')).toBeInTheDocument();
  });
});
