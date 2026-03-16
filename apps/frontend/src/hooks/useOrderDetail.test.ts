import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useOrderDetail,
  type OrderDetailData,
  type PackageDetail,
  type AuditEntry,
} from './useOrderDetail';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

const MOCK_PACKAGES: PackageDetail[] = [
  {
    id: 'pkg-1',
    label: 'PKG-001',
    package_number: 'PKG001',
    status: 'en_ruta',
    status_updated_at: '2026-03-16T09:00:00',
  },
];

const MOCK_AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: 'audit-1',
    action: 'status_changed',
    timestamp: '2026-03-16T08:00:00',
    changes_json: { from: 'ingresado', to: 'en_ruta' },
  },
];

const MOCK_ORDER_ROW = {
  id: 'order-1',
  order_number: 'ORD-001',
  retailer_name: 'Retailer A',
  customer_name: 'John Doe',
  customer_phone: '+56912345678',
  delivery_address: '123 Main St',
  comuna: 'Las Condes',
  delivery_date: '2026-03-16',
  delivery_window_start: '2026-03-16T10:00:00',
  delivery_window_end: '2026-03-16T12:00:00',
  status: 'en_ruta',
  leading_status: 'en_ruta',
  packages: MOCK_PACKAGES,
};

describe('useOrderDetail', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('returns order detail with packages and audit logs', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: MOCK_AUDIT_ENTRIES, error: null }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDetail('order-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).not.toBeNull();
    expect(result.current.data!.order_number).toBe('ORD-001');
    expect(result.current.data!.packages).toHaveLength(1);
    expect(result.current.data!.packages[0].label).toBe('PKG-001');
    expect(result.current.data!.auditLogs).toHaveLength(1);
    expect(result.current.data!.auditLogs[0].action).toBe('status_changed');
  });

  it('is disabled when orderId is null', () => {
    const { result } = renderHook(() => useOrderDetail(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('throws when order query returns error', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDetail('order-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('throws when audit_logs query returns error', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Audit error' } }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDetail('order-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns empty audit logs when none exist', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDetail('order-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.auditLogs).toEqual([]);
  });

  it('queries orders and audit_logs tables', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_ORDER_ROW, error: null }),
        };
      }
      if (table === 'audit_logs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useOrderDetail('order-1'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(mockFrom).toHaveBeenCalledWith('audit_logs');
  });
});
