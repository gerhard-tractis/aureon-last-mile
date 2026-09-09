import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCloseManifest } from './useCloseManifest';

/**
 * Ronda 2 de review del PR #726 — `useCloseManifest` is `handleComplete`
 * moved verbatim out of `complete/[loadId]/page.tsx`. These tests mirror
 * the ones that already covered it at the page level (PR #679's six
 * rounds), scoped to the hook in isolation.
 */
const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockEnqueue = vi.fn();
vi.mock('@/lib/offline/queue', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
}));

vi.mock('@/hooks/useOfflineQueue', () => ({
  PICKUP_QUEUE_WAKE_EVENT: 'aureon:pickup-queue-wake',
}));

const baseParams = {
  manifestId: 'm1',
  operatorId: 'op-1',
  userId: 'user-1',
  operatorSignature: 'data:image/png;base64,FAKE',
  clientSignature: null,
  clientName: '',
};

describe('useCloseManifest', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockEnqueue.mockReset();
  });

  it('calls close_manifest and onClosed on success', async () => {
    mockRpc.mockResolvedValue({ data: [{}], error: null });
    const onClosed = vi.fn();
    const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed }));

    await act(() => result.current.handleComplete());

    expect(mockRpc).toHaveBeenCalledWith('close_manifest', {
      p_manifest_id: 'm1',
      p_signatures: {
        operator_signature: baseParams.operatorSignature,
        client_signature: null,
        client_name: null,
      },
    });
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('treats MANIFEST_ALREADY_SIGNED (idempotent 409) as success and calls onClosed', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature' },
    });
    const { toast } = await import('sonner');
    const onClosed = vi.fn();
    const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed }));

    await act(() => result.current.handleComplete());

    expect(onClosed).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/ya fue firmado/i));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('queues offline on a real network-fallback error shape and calls onClosed', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
    });
    const { toast } = await import('sonner');
    const onClosed = vi.fn();
    const wakeListener = vi.fn();
    window.addEventListener('aureon:pickup-queue-wake', wakeListener);

    try {
      const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed }));
      await act(() => result.current.handleComplete());

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          operatorId: 'op-1',
          userId: 'user-1',
          manifestId: 'm1',
          type: 'close_manifest',
        }),
      );
      expect(wakeListener).toHaveBeenCalledOnce();
      expect(onClosed).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/sin conexión|sin señal/i));
    } finally {
      window.removeEventListener('aureon:pickup-queue-wake', wakeListener);
    }
  });

  it('surfaces an error and re-enables the button when enqueue itself throws', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
    });
    mockEnqueue.mockRejectedValue(new Error('cola llena'));
    const { toast } = await import('sonner');
    const onClosed = vi.fn();
    const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed }));

    await act(() => result.current.handleComplete());

    expect(onClosed).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('cola llena');
    expect(result.current.isSubmitting).toBe(false);
  });

  it('does not call onClosed for a permanent business rejection', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)' },
    });
    const { toast } = await import('sonner');
    const onClosed = vi.fn();
    const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed }));

    await act(() => result.current.handleComplete());

    expect(onClosed).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it('does nothing without an operator signature', async () => {
    const onClosed = vi.fn();
    const { result } = renderHook(() =>
      useCloseManifest({ ...baseParams, operatorSignature: null, onClosed }),
    );

    await act(() => result.current.handleComplete());

    expect(mockRpc).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('isSubmitting is true while the RPC is in flight', async () => {
    let resolveRpc!: (v: unknown) => void;
    mockRpc.mockReturnValue(new Promise((resolve) => (resolveRpc = resolve)));
    const { result } = renderHook(() => useCloseManifest({ ...baseParams, onClosed: vi.fn() }));

    let completion!: Promise<void>;
    act(() => {
      completion = result.current.handleComplete();
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    resolveRpc({ data: [{}], error: null });
    await act(() => completion);
  });
});
