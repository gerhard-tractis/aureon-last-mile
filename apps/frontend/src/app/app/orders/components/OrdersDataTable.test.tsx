import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrdersDataTable } from './OrdersDataTable';
import type { OrdersListRow } from '@/hooks/useOrdersList';

function makeRow(overrides: Partial<OrdersListRow> = {}): OrdersListRow {
  return {
    id: 'o-1',
    order_number: 'ORD-48213',
    customer_name: 'Camila Fernández Soto',
    leading_status: 'en_ruta',
    comuna: 'La Florida',
    package_count: 3,
    route_label: 'R-2481',
    driver_name: 'M. Rojas',
    sla_status: 'late',
    minutes_remaining: -100,
    last_event_at: '2026-08-22T12:41:00Z',
    last_event_label: 'receptor ausente',
    has_pod: false,
    total_count: 1,
    ...overrides,
  };
}

function renderTable(overrides: Partial<React.ComponentProps<typeof OrdersDataTable>> = {}) {
  const onRowClick = vi.fn();
  const onToggleSelect = vi.fn();
  const onToggleSelectAll = vi.fn();
  const { container } = render(
    <OrdersDataTable
      rows={[makeRow()]}
      isLoading={false}
      selectedIds={[]}
      onRowClick={onRowClick}
      onToggleSelect={onToggleSelect}
      onToggleSelectAll={onToggleSelectAll}
      {...overrides}
    />,
  );
  return { onRowClick, onToggleSelect, onToggleSelectAll, container };
}

describe('OrdersDataTable', () => {
  it('shows a loading skeleton and no rows while isLoading', () => {
    renderTable({ isLoading: true, rows: [] });
    expect(screen.queryByText('ORD-48213')).not.toBeInTheDocument();
    expect(screen.getByTestId('orders-table-skeleton')).toBeInTheDocument();
  });

  it('shows an EmptyState (not an error) when there are zero rows and not loading', () => {
    renderTable({ rows: [], isLoading: false });
    expect(screen.getByText(/sin pedidos/i)).toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('renders the order number in font-mono', () => {
    renderTable();
    const cell = screen.getByText('ORD-48213');
    expect(cell.className).toContain('font-mono');
  });

  it('formats a late SLA with the minus sign and hours+minutes', () => {
    renderTable({ rows: [makeRow({ sla_status: 'late', minutes_remaining: -100 })] });
    expect(screen.getByText('−1h 40m')).toBeInTheDocument();
  });

  it('formats a late SLA under an hour with just minutes, still signed', () => {
    renderTable({ rows: [makeRow({ sla_status: 'late', minutes_remaining: -48 })] });
    expect(screen.getByText('−48m')).toBeInTheDocument();
  });

  it('pads a sub-10-minute remainder when hours are present', () => {
    renderTable({ rows: [makeRow({ sla_status: 'late', minutes_remaining: -65 })] });
    expect(screen.getByText('−1h 05m')).toBeInTheDocument();
  });

  it('formats an ok/at_risk SLA with the plus sign', () => {
    renderTable({ rows: [makeRow({ sla_status: 'at_risk', minutes_remaining: 45 })] });
    expect(screen.getByText('+45m')).toBeInTheDocument();
  });

  it('formats sla_status "none" as an em-dash, never a fabricated verdict', () => {
    renderTable({ rows: [makeRow({ sla_status: 'none', minutes_remaining: 0 })] });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a POD badge on a delivered row with has_pod true', () => {
    renderTable({
      rows: [makeRow({ leading_status: 'entregado', has_pod: true, sla_status: 'none' })],
    });
    expect(screen.getByText('POD')).toBeInTheDocument();
    expect(screen.queryByText('SIN POD')).not.toBeInTheDocument();
  });

  it('shows a SIN POD badge on a delivered row with has_pod false', () => {
    renderTable({
      rows: [makeRow({ leading_status: 'entregado', has_pod: false, sla_status: 'none' })],
    });
    expect(screen.getByText('SIN POD')).toBeInTheDocument();
  });

  it('shows neither POD badge on a non-delivered row, regardless of has_pod', () => {
    renderTable({ rows: [makeRow({ leading_status: 'en_ruta', has_pod: true })] });
    expect(screen.queryByText('POD')).not.toBeInTheDocument();
    expect(screen.queryByText('SIN POD')).not.toBeInTheDocument();
  });

  it('applies a left border coloured by sla_status', () => {
    const { container } = renderTable({
      rows: [makeRow({ sla_status: 'late' })],
    });
    const row = container.querySelector('tbody tr');
    expect(row?.className).toContain('border-l-status-error');
  });

  it('clicking the order-number opens the row via onRowClick, without toggling the checkbox', async () => {
    const user = userEvent.setup();
    const { onRowClick, onToggleSelect } = renderTable();
    await user.click(screen.getByRole('button', { name: /abrir pedido ord-48213/i }));
    expect(onRowClick).toHaveBeenCalledWith('o-1');
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('clicking anywhere else in the row (a non-interactive cell) also opens it — a bigger pointer target than just the order number', async () => {
    const user = userEvent.setup();
    const { onRowClick } = renderTable();
    await user.click(screen.getByText('Camila Fernández Soto'));
    expect(onRowClick).toHaveBeenCalledWith('o-1');
  });

  it('clicking the row checkbox toggles selection, without opening the row (the click must not bubble to the row)', async () => {
    const user = userEvent.setup();
    const { onRowClick, onToggleSelect } = renderTable();
    await user.click(screen.getByRole('checkbox', { name: /seleccionar ord-48213/i }));
    expect(onToggleSelect).toHaveBeenCalledWith('o-1', true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('the row checkbox and the row-open control are two separate tab stops', () => {
    renderTable();
    const checkbox = screen.getByRole('checkbox', { name: /seleccionar ord-48213/i });
    const openButton = screen.getByRole('button', { name: /abrir pedido ord-48213/i });
    expect(checkbox).not.toBe(openButton);
    expect(checkbox.tagName).not.toBe('BUTTON');
  });

  it('the header checkbox is checked only when every row is selected', () => {
    const rows = [makeRow({ id: 'o-1' }), makeRow({ id: 'o-2', order_number: 'ORD-2' })];
    renderTable({ rows, selectedIds: ['o-1', 'o-2'] });
    expect(screen.getByRole('checkbox', { name: /seleccionar todo/i })).toBeChecked();
  });

  it('the header checkbox toggling calls onToggleSelectAll', async () => {
    const user = userEvent.setup();
    const { onToggleSelectAll } = renderTable();
    await user.click(screen.getByRole('checkbox', { name: /seleccionar todo/i }));
    expect(onToggleSelectAll).toHaveBeenCalledWith(true);
  });

  it('formats a missing route/driver as "sin asignar"', () => {
    renderTable({ rows: [makeRow({ route_label: null, driver_name: null })] });
    expect(screen.getByText('sin asignar')).toBeInTheDocument();
  });
});
