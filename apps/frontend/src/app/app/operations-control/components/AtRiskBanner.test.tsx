import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtRiskBanner } from './AtRiskBanner';

const ORDERS = [
  { id: 'ORD-001', customer: 'A', address: '123 St', stage: 'delivery', retailer: 'R1', status: 'late' as const, label: '-2h', minutesRemaining: -120, reasonFlag: 'sla_breach' },
  { id: 'ORD-002', customer: 'B', address: '456 St', stage: 'pickup', retailer: 'R2', status: 'at_risk' as const, label: '45m', minutesRemaining: 45, reasonFlag: 'approaching_sla' },
  { id: 'ORD-003', customer: 'C', address: '789 St', stage: 'docks', retailer: 'R3', status: 'at_risk' as const, label: '1h', minutesRemaining: 60, reasonFlag: 'approaching_sla' },
];

describe('AtRiskBanner', () => {
  it('renders total count and role=alert', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows up to 3 inline order IDs', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('shows overflow count', () => {
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={() => {}} />);
    expect(screen.getByText(/\+ 2 más/i)).toBeInTheDocument();
  });

  it('calls onViewAll when clicked', async () => {
    const fn = vi.fn();
    render(<AtRiskBanner orders={ORDERS} total={5} onViewAll={fn} />);
    await userEvent.click(screen.getByRole('button', { name: /ver todas/i }));
    expect(fn).toHaveBeenCalled();
  });
});
