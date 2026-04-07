import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AtRiskList } from './AtRiskList';
import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';

function makeOrder(id: string, label = '30m'): AtRiskOrder {
  return {
    id,
    status: 'at_risk',
    minutesRemaining: 30,
    label,
    stage: 'delivery',
    retailer: 'Retailer SA',
    customer: 'Juan Pérez',
    address: 'Av. Siempre Viva 123',
    reasonFlag: '',
  };
}

describe('AtRiskList', () => {
  const defaultProps = {
    orders: [],
    total: 0,
    page: 1,
    pageCount: 1,
    onPageChange: vi.fn(),
  };

  it('renders table headers: Pedido, Cliente, Dirección, Etapa, Retailer, Tiempo, Estado', () => {
    render(<AtRiskList {...defaultProps} />);
    expect(screen.getByText('Pedido')).toBeDefined();
    expect(screen.getByText('Cliente')).toBeDefined();
    expect(screen.getByText('Dirección')).toBeDefined();
    expect(screen.getByText('Etapa')).toBeDefined();
    expect(screen.getByText('Retailer')).toBeDefined();
    expect(screen.getByText('Tiempo')).toBeDefined();
    expect(screen.getByText('Estado')).toBeDefined();
  });

  it('renders each order row with its label in the Tiempo column', () => {
    const orders = [makeOrder('ORD-001', '45m'), makeOrder('ORD-002', '10m')];
    render(<AtRiskList {...defaultProps} orders={orders} total={2} />);
    expect(screen.getByText('ORD-001')).toBeDefined();
    expect(screen.getByText('45m')).toBeDefined();
    expect(screen.getByText('ORD-002')).toBeDefined();
    expect(screen.getByText('10m')).toBeDefined();
  });

  it('shows "Sin órdenes en riesgo" when orders array is empty', () => {
    render(<AtRiskList {...defaultProps} />);
    expect(screen.getByText('Sin órdenes en riesgo')).toBeDefined();
  });

  it('renders pagination controls when pageCount > 1', () => {
    const orders = [makeOrder('ORD-001')];
    render(
      <AtRiskList
        orders={orders}
        total={30}
        page={1}
        pageCount={2}
        onPageChange={vi.fn()}
      />
    );
    expect(screen.getByText('Siguiente')).toBeDefined();
    expect(screen.getByText('Anterior')).toBeDefined();
  });

  it('"Siguiente" button calls onPageChange(page + 1)', () => {
    const onPageChange = vi.fn();
    const orders = [makeOrder('ORD-001')];
    render(
      <AtRiskList
        orders={orders}
        total={30}
        page={1}
        pageCount={2}
        onPageChange={onPageChange}
      />
    );
    fireEvent.click(screen.getByText('Siguiente'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('"Anterior" button calls onPageChange(page - 1)', () => {
    const onPageChange = vi.fn();
    const orders = [makeOrder('ORD-001')];
    render(
      <AtRiskList
        orders={orders}
        total={30}
        page={2}
        pageCount={2}
        onPageChange={onPageChange}
      />
    );
    fireEvent.click(screen.getByText('Anterior'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
