import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuditLogs, useExportAuditLogs } from './useAuditLogs';

vi.mock('@/lib/api/auditLogs', () => ({
  getAuditLogs: vi.fn(),
  exportAuditLogs: vi.fn(),
}));

import { getAuditLogs, exportAuditLogs } from '@/lib/api/auditLogs';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

// ── useAuditLogs ──────────────────────────────────────────────────────────────

describe('useAuditLogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns audit logs on success', async () => {
    const mockResult = {
      data: [{ id: 'log-1', action: 'INSERT_orders', operator_id: 'op-1', user_id: 'user-1', timestamp: '2026-01-01T00:00:00Z', resource_type: 'orders', resource_id: null, changes_json: null, ip_address: null }],
      total: 1,
      page: 1,
      limit: 50,
    };
    (getAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useAuditLogs({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockResult);
    expect(getAuditLogs).toHaveBeenCalledWith({});
  });

  it('passes filters to getAuditLogs', async () => {
    const filters = { action: 'INSERT_orders', page: 2 };
    (getAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], total: 0, page: 2, limit: 50 });

    const { result } = renderHook(() => useAuditLogs(filters), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAuditLogs).toHaveBeenCalledWith(filters);
  });

  it('exposes isError when getAuditLogs rejects', async () => {
    (getAuditLogs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() => useAuditLogs({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('uses default empty filters when called with no arguments', async () => {
    (getAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });

    const { result } = renderHook(() => useAuditLogs(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAuditLogs).toHaveBeenCalledWith({});
  });
});

// ── useExportAuditLogs ────────────────────────────────────────────────────────

describe('useExportAuditLogs', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls exportAuditLogs with filters on success', async () => {
    const mockBlob = new Blob(['col1,col2'], { type: 'text/csv' });
    (exportAuditLogs as ReturnType<typeof vi.fn>).mockResolvedValue(mockBlob);

    // Stub URL APIs to avoid jsdom limitations (click-download not tested — implementation detail)
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:url'), revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useExportAuditLogs(), { wrapper: wrapper() });

    await act(async () => {
      result.current.mutate({ action: 'INSERT_orders' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(exportAuditLogs).toHaveBeenCalledWith({ action: 'INSERT_orders' });
  });

  it('exposes isError when exportAuditLogs rejects', async () => {
    (exportAuditLogs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Export failed'));

    const { result } = renderHook(() => useExportAuditLogs(), { wrapper: wrapper() });

    await act(async () => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
