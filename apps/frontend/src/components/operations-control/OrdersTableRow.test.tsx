/**
 * Tests for OrdersTableRow component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrdersTableRow } from './OrdersTableRow';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';

const TODAY = new Date().toISOString().split('T')[0];
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0];
// A date in the past for "DD/MM" formatting
const PAST_DATE = '2025-06-15';

function makeOrder(overrides: Partial<OperationsOrder> = {}): OperationsOrder {
  return {
    id: 'order-1',
    order_number: 'ORD-001',
    retailer_name: 'Retailer SA',
    customer_name: 'Juan Pérez',
    comuna: 'Providencia',
    delivery_date: TODAY,
    delivery_window_start: null,
    delivery_window_end: null,
    status: 'en_bodega',
    leading_status: 'en_bodega',
    status_updated_at: null,
    operator_id: 'op-1',
    deleted_at: null,
    ...overrides,
  };
}

// Wrap in table/tbody so <tr> renders correctly
function renderRow(order: OperationsOrder, priority: OrderPriority, onOpenDetail = vi.fn()) {
  return render(
    <table>
      <tbody>
        <OrdersTableRow order={order} priority={priority} onOpenDetail={onOpenDetail} />
      </tbody>
    </table>,
  );
}

describe('OrdersTableRow', () => {
  describe('Order number', () => {
    it('renders order_number', () => {
      renderRow(makeOrder({ order_number: 'ORD-999' }), 'ok');
      expect(screen.getByText('ORD-999')).toBeTruthy();
    });
  });

  describe('Priority dot', () => {
    it('renders red dot for urgent priority', () => {
      renderRow(makeOrder(), 'urgent');
      const dot = screen.getByTestId('priority-dot');
      expect(dot.className).toContain('bg-status-error');
    });

    it('renders yellow dot for alert priority', () => {
      renderRow(makeOrder(), 'alert');
      const dot = screen.getByTestId('priority-dot');
      expect(dot.className).toContain('bg-status-warning');
    });

    it('renders green dot for ok priority', () => {
      renderRow(makeOrder(), 'ok');
      const dot = screen.getByTestId('priority-dot');
      expect(dot.className).toContain('bg-status-success');
    });

    it('renders gray dot for late priority', () => {
      renderRow(makeOrder(), 'late');
      const dot = screen.getByTestId('priority-dot');
      expect(dot.className).toContain('bg-text-muted');
    });
  });

  describe('"Ver" button calls onOpenDetail', () => {
    it('calls onOpenDetail with correct id when "Ver" is clicked', () => {
      const onOpenDetail = vi.fn();
      renderRow(makeOrder({ id: 'order-abc' }), 'ok', onOpenDetail);
      fireEvent.click(screen.getByText('Ver'));
      expect(onOpenDetail).toHaveBeenCalledWith('order-abc');
    });
  });

  describe('Order number button calls onOpenDetail', () => {
    it('calls onOpenDetail when order number button is clicked', () => {
      const onOpenDetail = vi.fn();
      renderRow(makeOrder({ id: 'order-xyz', order_number: 'ORD-555' }), 'ok', onOpenDetail);
      fireEvent.click(screen.getByText('ORD-555'));
      expect(onOpenDetail).toHaveBeenCalledWith('order-xyz');
    });
  });

  describe('"Reasignar" button', () => {
    it('shows "Reasignar" for alert priority', () => {
      renderRow(makeOrder(), 'alert');
      expect(screen.getByText('Reasignar')).toBeTruthy();
    });

    it('shows "Reasignar" for urgent priority', () => {
      renderRow(makeOrder(), 'urgent');
      expect(screen.getByText('Reasignar')).toBeTruthy();
    });

    it('does not show "Reasignar" for ok priority', () => {
      renderRow(makeOrder(), 'ok');
      expect(screen.queryByText('Reasignar')).toBeNull();
    });

    it('does not show "Reasignar" for late priority', () => {
      renderRow(makeOrder(), 'late');
      expect(screen.queryByText('Reasignar')).toBeNull();
    });
  });

  describe('"Escalar" button', () => {
    it('shows "Escalar" for late priority', () => {
      renderRow(makeOrder(), 'late');
      expect(screen.getByText('Escalar')).toBeTruthy();
    });

    it('does not show "Escalar" for ok priority', () => {
      renderRow(makeOrder(), 'ok');
      expect(screen.queryByText('Escalar')).toBeNull();
    });

    it('does not show "Escalar" for urgent priority', () => {
      renderRow(makeOrder(), 'urgent');
      expect(screen.queryByText('Escalar')).toBeNull();
    });

    it('does not show "Escalar" for alert priority', () => {
      renderRow(makeOrder(), 'alert');
      expect(screen.queryByText('Escalar')).toBeNull();
    });
  });

  describe('Delivery date formatting', () => {
    it('shows "Hoy" when delivery_date is today', () => {
      renderRow(makeOrder({ delivery_date: TODAY }), 'ok');
      expect(screen.getByTestId('delivery-date')).toHaveTextContent('Hoy');
    });

    it('shows "Mañana" when delivery_date is tomorrow', () => {
      renderRow(makeOrder({ delivery_date: TOMORROW }), 'ok');
      expect(screen.getByTestId('delivery-date')).toHaveTextContent('Mañana');
    });

    it('shows DD/MM format for other dates', () => {
      renderRow(makeOrder({ delivery_date: PAST_DATE }), 'ok');
      // 2025-06-15 → 15/06
      expect(screen.getByTestId('delivery-date')).toHaveTextContent('15/06');
    });
  });

  describe('Parcial column', () => {
    it('shows "~" when status !== leading_status', () => {
      renderRow(makeOrder({ status: 'en_bodega', leading_status: 'en_ruta' }), 'ok');
      expect(screen.getByTestId('parcial-cell')).toHaveTextContent('~');
    });

    it('shows "—" when status === leading_status', () => {
      renderRow(makeOrder({ status: 'en_bodega', leading_status: 'en_bodega' }), 'ok');
      expect(screen.getByTestId('parcial-cell')).toHaveTextContent('—');
    });
  });

  describe('Cliente column', () => {
    it('shows retailer_name when available', () => {
      renderRow(makeOrder({ retailer_name: 'Falabella', customer_name: 'Carlos' }), 'ok');
      expect(screen.getByTestId('cliente-cell')).toHaveTextContent('Falabella');
    });

    it('shows customer_name when retailer_name is null', () => {
      renderRow(makeOrder({ retailer_name: null, customer_name: 'María' }), 'ok');
      expect(screen.getByTestId('cliente-cell')).toHaveTextContent('María');
    });
  });

  describe('Destino column', () => {
    it('shows comuna', () => {
      renderRow(makeOrder({ comuna: 'Las Condes' }), 'ok');
      expect(screen.getByTestId('destino-cell')).toHaveTextContent('Las Condes');
    });
  });

  describe('Status badge', () => {
    it('shows status text', () => {
      renderRow(makeOrder({ status: 'en_ruta' }), 'ok');
      expect(screen.getByTestId('status-badge')).toHaveTextContent('en_ruta');
    });
  });

  describe('Time window column', () => {
    it('shows "—" when no window', () => {
      renderRow(makeOrder({ delivery_window_start: null, delivery_window_end: null }), 'ok');
      expect(screen.getByTestId('ventana-cell')).toHaveTextContent('—');
    });

    it('shows "Pasado Xh Xm" when window is in the past', () => {
      const pastStart = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
      const pastEnd = new Date(Date.now() - 3600000).toISOString();   // 1 hour ago
      renderRow(
        makeOrder({ delivery_window_start: pastStart, delivery_window_end: pastEnd }),
        'ok',
      );
      const cell = screen.getByTestId('ventana-cell');
      expect(cell.textContent).toMatch(/^Pasado/);
    });

    it('shows "En Xh Xm" when window is in the future', () => {
      const futureStart = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const futureEnd = new Date(Date.now() + 7200000).toISOString();   // 2 hours from now
      renderRow(
        makeOrder({ delivery_window_start: futureStart, delivery_window_end: futureEnd }),
        'ok',
      );
      const cell = screen.getByTestId('ventana-cell');
      expect(cell.textContent).toMatch(/^En/);
    });
  });
});
