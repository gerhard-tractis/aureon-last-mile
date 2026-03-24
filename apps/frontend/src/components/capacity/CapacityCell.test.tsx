import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CapacityCell from './CapacityCell';

const mockMutate = vi.fn();

vi.mock('@/hooks/useCapacityMutations', () => ({
  useUpdateCapacity: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const today = new Date().toISOString().split('T')[0];
const pastDate = '2020-01-01';
const futureDate = '2099-12-31';

describe('CapacityCell', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('renders capacity and actual orders for a past date with data', () => {
    render(
      <CapacityCell
        date={pastDate}
        capacity={300}
        actualOrders={278}
        utilizationPct={92.7}
        rowId="row-1"
      />
    );
    expect(screen.getByText('300')).toBeDefined();
    expect(screen.getByText('278')).toBeDefined();
    expect(screen.getByText(/93%/)).toBeDefined();
  });

  it('shows success token class for utilization < 80%', () => {
    const { container } = render(
      <CapacityCell
        date={pastDate}
        capacity={300}
        actualOrders={200}
        utilizationPct={66.7}
        rowId="row-2"
      />
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('color-status-success');
  });

  it('shows warning token class for utilization 80–95%', () => {
    const { container } = render(
      <CapacityCell
        date={pastDate}
        capacity={300}
        actualOrders={270}
        utilizationPct={90}
        rowId="row-3"
      />
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('color-status-warning');
  });

  it('shows error token class for utilization 95–120%', () => {
    const { container } = render(
      <CapacityCell
        date={pastDate}
        capacity={300}
        actualOrders={330}
        utilizationPct={110}
        rowId="row-4"
      />
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('color-status-error');
  });

  it('shows error token class for utilization > 120%', () => {
    const { container } = render(
      <CapacityCell
        date={pastDate}
        capacity={300}
        actualOrders={400}
        utilizationPct={133}
        rowId="row-5"
      />
    );
    const cell = container.firstChild as HTMLElement;
    expect(cell.className).toContain('color-status-error');
  });

  it('shows N/A for past date with no capacity', () => {
    render(
      <CapacityCell
        date={pastDate}
        capacity={null}
        actualOrders={null}
        utilizationPct={null}
        rowId={null}
      />
    );
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('shows dash for future date with no capacity', () => {
    render(
      <CapacityCell
        date={futureDate}
        capacity={null}
        actualOrders={null}
        utilizationPct={null}
        rowId={null}
      />
    );
    expect(screen.getByText('—')).toBeDefined();
  });

  it('enters edit mode when capacity is clicked', () => {
    render(
      <CapacityCell
        date={today}
        capacity={300}
        actualOrders={null}
        utilizationPct={null}
        rowId="row-6"
      />
    );
    fireEvent.click(screen.getByText('300'));
    expect(screen.getByRole('spinbutton')).toBeDefined();
  });

  it('saves on Enter key', () => {
    render(
      <CapacityCell
        date={today}
        capacity={300}
        actualOrders={null}
        utilizationPct={null}
        rowId="row-7"
      />
    );
    fireEvent.click(screen.getByText('300'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '350' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'row-7', daily_capacity: 350 },
      expect.any(Object)
    );
  });

  it('cancels on Escape key', () => {
    render(
      <CapacityCell
        date={today}
        capacity={300}
        actualOrders={null}
        utilizationPct={null}
        rowId="row-8"
      />
    );
    fireEvent.click(screen.getByText('300'));
    const input = screen.getByRole('spinbutton');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('300')).toBeDefined();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
