/**
 * Tests for MobileOrderCard component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileOrderCard } from './MobileOrderCard';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';

const makeOrder = (overrides: Partial<OperationsOrder> = {}): OperationsOrder => ({
  id: 'ord-1',
  order_number: 'ORD-12345',
  retailer_name: 'Falabella',
  customer_name: 'Juan Perez',
  comuna: 'Las Condes',
  delivery_date: '2026-03-16',
  delivery_window_start: null,
  delivery_window_end: null,
  status: 'en_bodega',
  leading_status: 'en_bodega',
  status_updated_at: null,
  operator_id: 'op-1',
  deleted_at: null,
  ...overrides,
});

describe('MobileOrderCard', () => {
  describe('Rendering', () => {
    it('renders the order number', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.getByText('ORD-12345')).toBeTruthy();
    });

    it('renders retailer name and comuna', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.getByText('Falabella · Las Condes')).toBeTruthy();
    });

    it('renders retailer as empty string when retailer_name is null', () => {
      render(
        <MobileOrderCard
          order={makeOrder({ retailer_name: null })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.getByText('· Las Condes')).toBeTruthy();
    });

    it('renders status badge', () => {
      render(
        <MobileOrderCard
          order={makeOrder({ status: 'en_bodega' })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.getByTestId('status-badge')).toBeTruthy();
    });
  });

  describe('Ver button', () => {
    it('renders Ver button', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.getByTestId('btn-ver')).toBeTruthy();
    });

    it('calls onView when Ver button clicked', () => {
      const onView = vi.fn();
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="ok"
          onView={onView}
        />,
      );
      fireEvent.click(screen.getByTestId('btn-ver'));
      expect(onView).toHaveBeenCalledOnce();
    });
  });

  describe('Escalar button', () => {
    it('shows Escalar button when priority is late and onEscalar is provided', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="late"
          onView={vi.fn()}
          onEscalar={vi.fn()}
        />,
      );
      expect(screen.getByTestId('btn-escalar')).toBeTruthy();
    });

    it('hides Escalar button when priority is ok', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="ok"
          onView={vi.fn()}
          onEscalar={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('btn-escalar')).toBeNull();
    });

    it('hides Escalar button when priority is urgent', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="urgent"
          onView={vi.fn()}
          onEscalar={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('btn-escalar')).toBeNull();
    });

    it('hides Escalar button when priority is alert', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="alert"
          onView={vi.fn()}
          onEscalar={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('btn-escalar')).toBeNull();
    });

    it('hides Escalar button when priority is late but onEscalar not provided', () => {
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="late"
          onView={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('btn-escalar')).toBeNull();
    });

    it('calls onEscalar when Escalar button clicked', () => {
      const onEscalar = vi.fn();
      render(
        <MobileOrderCard
          order={makeOrder()}
          priority="late"
          onView={vi.fn()}
          onEscalar={onEscalar}
        />,
      );
      fireEvent.click(screen.getByTestId('btn-escalar'));
      expect(onEscalar).toHaveBeenCalledOnce();
    });
  });

  describe('Countdown display', () => {
    it('shows "En Xm" for future delivery_window_end', () => {
      // Set a delivery_window_end 1 hour from now
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      render(
        <MobileOrderCard
          order={makeOrder({ delivery_window_end: future })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      const countdown = screen.getByTestId('countdown');
      expect(countdown.textContent).toMatch(/^En \d+m$/);
    });

    it('shows "Pasado" for past delivery_window_end', () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      render(
        <MobileOrderCard
          order={makeOrder({ delivery_window_end: past })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      const countdown = screen.getByTestId('countdown');
      expect(countdown.textContent).toBe('Pasado');
    });

    it('does not render countdown when delivery_window_end is null', () => {
      render(
        <MobileOrderCard
          order={makeOrder({ delivery_window_end: null })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('countdown')).toBeNull();
    });
  });

  describe('Priority dot colors', () => {
    const priorities: Array<{ priority: OrderPriority; colorClass: string }> = [
      { priority: 'urgent', colorClass: 'bg-red-500' },
      { priority: 'alert', colorClass: 'bg-yellow-500' },
      { priority: 'ok', colorClass: 'bg-green-500' },
      { priority: 'late', colorClass: 'bg-gray-500' },
    ];

    priorities.forEach(({ priority, colorClass }) => {
      it(`shows ${colorClass} dot for ${priority} priority`, () => {
        render(
          <MobileOrderCard
            order={makeOrder()}
            priority={priority}
            onView={vi.fn()}
          />,
        );
        const dot = screen.getByTestId('priority-dot');
        expect(dot.className).toContain(colorClass);
      });
    });
  });

  describe('Pulse animation', () => {
    it('adds animate-pulse to countdown when priority is urgent', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      render(
        <MobileOrderCard
          order={makeOrder({ delivery_window_end: future })}
          priority="urgent"
          onView={vi.fn()}
        />,
      );
      const countdown = screen.getByTestId('countdown');
      expect(countdown.className).toContain('animate-pulse');
    });

    it('does not add animate-pulse when priority is ok', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      render(
        <MobileOrderCard
          order={makeOrder({ delivery_window_end: future })}
          priority="ok"
          onView={vi.fn()}
        />,
      );
      const countdown = screen.getByTestId('countdown');
      expect(countdown.className).not.toContain('animate-pulse');
    });
  });
});
