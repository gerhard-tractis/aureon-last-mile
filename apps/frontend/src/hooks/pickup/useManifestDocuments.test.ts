import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useManifestDocuments, useUploadManifestDocument } from './useManifestDocuments';

const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockStorage = { from: vi.fn().mockReturnValue({ upload: mockUpload }) };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom, storage: mockStorage }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

const makeFile = (name = 'sheet-1.jpg') => new File(['data'], name, { type: 'image/jpeg' });

// ── useManifestDocuments ─────────────────────────────────────────────────────

describe('useManifestDocuments', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when manifestId is null', () => {
    const { result } = renderHook(() => useManifestDocuments('op-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useManifestDocuments(null, 'manifest-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns documents ordered by sheet_number', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 'doc-1', storage_path: 'op-1/manifest-1/sheet-1.jpg', sheet_number: 1, captured_at: '2026-09-08T09:00:00Z' },
          { id: 'doc-2', storage_path: 'op-1/manifest-1/sheet-2.jpg', sheet_number: 2, captured_at: '2026-09-08T09:01:00Z' },
        ],
        error: null,
      }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useManifestDocuments('op-1', 'manifest-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[1].sheet_number).toBe(2);
  });

  it('exposes isError on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useManifestDocuments('op-1', 'manifest-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useUploadManifestDocument ────────────────────────────────────────────────

describe('useUploadManifestDocument', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockUpload.mockReset();
    mockStorage.from.mockClear();
  });

  it('uploads the file to the manifests bucket, prefixed by operator/manifest, then inserts the row', async () => {
    mockUpload.mockResolvedValue({ error: null });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    const { result } = renderHook(() => useUploadManifestDocument(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        operatorId: 'op-1',
        manifestId: 'manifest-1',
        userId: 'user-1',
        sheetNumber: 3,
        file: makeFile(),
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockStorage.from).toHaveBeenCalledWith('manifests');
    const uploadPath = mockUpload.mock.calls[0][0] as string;
    expect(uploadPath.startsWith('op-1/manifest-1/')).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        manifest_id: 'manifest-1',
        sheet_number: 3,
        uploaded_by: 'user-1',
        storage_path: uploadPath,
      })
    );
  });

  it('surfaces a storage upload error without inserting a row', async () => {
    mockUpload.mockResolvedValue({ error: new Error('quota exceeded') });
    const insertMock = vi.fn();
    mockFrom.mockReturnValue({ insert: insertMock });

    const { result } = renderHook(() => useUploadManifestDocument(), { wrapper: wrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          operatorId: 'op-1',
          manifestId: 'manifest-1',
          userId: 'user-1',
          sheetNumber: 1,
          file: makeFile(),
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(insertMock).not.toHaveBeenCalled();
  });
});
