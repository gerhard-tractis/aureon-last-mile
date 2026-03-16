/**
 * Tests for OrderDetailModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderDetailModal } from './OrderDetailModal';
import type { OrderDetailData } from '@/hooks/useOrderDetail';

// --- Mock useOrderDetail ---
vi.mock('@/hooks/useOrderDetail', () => ({
  useOrderDetail: vi.fn(() => ({ data: null, isLoading: true, isError: false })),
}));

import { useOrderDetail } from '@/hooks/useOrderDetail';

// --- Mock child components to simplify assertions ---
vi.mock('./PackageStatusBreakdown', () => ({
  PackageStatusBreakdown: ({ packages }: { packages: unknown[] }) => (
    <div data-testid="pkg-breakdown">packages:{packages.length}</div>
  ),
}));

vi.mock('./StatusTimeline', () => ({
  StatusTimeline: ({ auditLogs }: { auditLogs: unknown[] }) => (
    <div data-testid="status-timeline">logs:{auditLogs.length}</div>
  ),
}));

function makeOrderDetail(overrides: Partial<OrderDetailData> = {}): OrderDetailData {
  return {
    id: 'order-1',
    order_number: 'ORD-001',
    retailer_name: 'Retailer SA',
    customer_name: 'Juan Pérez',
    customer_phone: '+56912345678',
    delivery_address: 'Calle Falsa 123',
    comuna: 'Providencia',
    delivery_date: '2026-03-16',
    delivery_window_start: null,
    delivery_window_end: null,
    status: 'en_ruta',
    leading_status: 'en_ruta',
    packages: [],
    auditLogs: [],
    ...overrides,
  };
}

describe('OrderDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Closed state', () => {
    it('renders nothing when orderId is null', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      const { container } = render(<OrderDetailModal orderId={null} onClose={vi.fn()} />);
      // Modal should not be open — no dialog content visible
      expect(screen.queryByTestId('order-detail-modal')).toBeNull();
    });
  });

  describe('Loading state', () => {
    it('shows loading text when isLoading is true', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByText('Cargando detalles...')).toBeTruthy();
    });
  });

  describe('Error state', () => {
    it('shows error text when isError is true', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByText('Error al cargar detalles del pedido')).toBeTruthy();
    });
  });

  describe('Data loaded', () => {
    it('shows order number in header', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail({ order_number: 'ORD-999' }),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByText(/ORD-999/)).toBeTruthy();
    });

    it('shows customer name', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail({ customer_name: 'María González' }),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByText(/María González/)).toBeTruthy();
    });

    it('shows delivery address and comuna', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail({ delivery_address: 'Av. Libertador 456', comuna: 'Las Condes' }),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByText(/Av\. Libertador 456/)).toBeTruthy();
      expect(screen.getByText(/Las Condes/)).toBeTruthy();
    });

    it('renders PackageStatusBreakdown', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail({ packages: [] }),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByTestId('pkg-breakdown')).toBeTruthy();
    });

    it('renders StatusTimeline', () => {
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail({ auditLogs: [] }),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByTestId('status-timeline')).toBeTruthy();
    });
  });

  describe('Close button', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      vi.mocked(useOrderDetail).mockReturnValue({
        data: makeOrderDetail(),
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useOrderDetail>);
      render(<OrderDetailModal orderId="order-1" onClose={onClose} />);
      fireEvent.click(screen.getByTestId('modal-close-btn'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Escape key handling is delegated to Radix Dialog and covered by its own test suite.
  // We do not test third-party dialog behavior here.
});
