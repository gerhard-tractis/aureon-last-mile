import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useManifestDocuments, useUploadManifestDocument } from './useManifestDocuments';

const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockStorage = { from: vi.fn().mockReturnValue({ upload: mockUpload, remove: mockRemove }) };

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

  // M4, ronda 2 de review del PR #706 — el mock anterior nunca aseveraba
  // sobre `eq.mock.calls`; borrar la línea `.eq('operator_id', ...)` del
  // hook dejaba los 6 tests en verde. `operator_id` en toda query es el
  // no-negociable número uno del repo.
  it('scopes the query by operator_id AND manifest_id (not just manifest_id)', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useManifestDocuments('op-1', 'manifest-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.eq).toHaveBeenCalledWith('manifest_id', 'manifest-1');
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
    mockRemove.mockReset();
    mockRemove.mockResolvedValue({ error: null });
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

  // Bloqueante 2, ronda 2 de review del PR #706 — un doble toque en
  // "Agregar" (el refetch de la lista todavía no había resuelto cuando el
  // insert corría con el mismo sheet_number) hacía que el `upload` tuviera
  // éxito pero el `insert` reventara con 23505 (UNIQUE(manifest_id,
  // sheet_number)), dejando el objeto huérfano en el bucket para siempre —
  // nada lo referenciaba ni lo limpiaba. Sin `storage.remove()` en la rama
  // de error del insert, ese huérfano es permanente.
  it('removes the just-uploaded object from storage when the insert fails (no orphan left behind)', async () => {
    mockUpload.mockResolvedValue({ error: null });
    const insertMock = vi.fn().mockResolvedValue({
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    });
    mockFrom.mockReturnValue({ insert: insertMock });

    const { result } = renderHook(() => useUploadManifestDocument(), { wrapper: wrapper() });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          operatorId: 'op-1',
          manifestId: 'manifest-1',
          userId: 'user-1',
          sheetNumber: 2,
          file: makeFile(),
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockRemove).toHaveBeenCalledOnce();
    const removedPath = mockRemove.mock.calls[0][0] as string[];
    const uploadedPath = mockUpload.mock.calls[0][0] as string;
    expect(removedPath).toEqual([uploadedPath]);
  });
});
