import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtRiskTable } from './AtRiskTable';

const ORDERS = [
  { id: 'ORD-001', customer: 'Alice', address: 'Av. Providencia 123', stage: 'delivery', retailer: 'Falabella', status: 'late' as const, label: '-2h', minutesRemaining: -120, reasonFlag: 'sla_breach' },
  { id: 'ORD-002', customer: 'Bob', address: 'Los Leones 456', stage: 'pickup', retailer: 'Ripley', status: 'at_risk' as const, label: '45m', minutesRemaining: 45, reasonFlag: 'approaching_sla' },
];

describe('AtRiskTable', () => {
  it('renders Spanish column headers', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('Pedido')).toBeInTheDocument();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Dirección')).toBeInTheDocument();
    expect(screen.getByText('Etapa')).toBeInTheDocument();
  });

  it('renders order rows', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('-2h')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<AtRiskTable orders={[]} total={0} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.getByText('Sin órdenes en riesgo')).toBeInTheDocument();
  });

  it('shows pagination when pageCount > 1', () => {
    render(<AtRiskTable orders={ORDERS} total={50} page={2} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('hides pagination when pageCount = 1', () => {
    render(<AtRiskTable orders={ORDERS} total={2} page={1} pageCount={1} onPageChange={() => {}} />);
    expect(screen.queryByText(/Página/)).not.toBeInTheDocument();
  });

  it('calls onPageChange for next/prev', async () => {
    const fn = vi.fn();
    render(<AtRiskTable orders={ORDERS} total={50} page={2} pageCount={3} onPageChange={fn} />);
    await userEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(fn).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('disables prev on first page', () => {
    render(<AtRiskTable orders={ORDERS} total={50} page={1} pageCount={3} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
  });
});
