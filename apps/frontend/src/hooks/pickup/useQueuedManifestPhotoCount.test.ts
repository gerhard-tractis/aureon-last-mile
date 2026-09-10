import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQueuedManifestPhotoCount } from './useQueuedManifestPhotoCount';

/**
 * Ronda 4 de review del PR #736 (bloqueante 2) — `complete/[loadId]/page.tsx`
 * necesita cuántas fotos de ESTE manifiesto siguen en la cola local sin
 * confirmar, para sumarlas a `documents.length` (lo que el servidor ya
 * confirmó) en el "Respaldo: N fotos" de `5i`. Este hook es el lado de
 * LECTURA reactiva de `queuedManifestPhotoCount` (`lib/offline/photos.ts`) —
 * un `useState`/poll, no una query de TanStack (la cola vive en IndexedDB,
 * no en el servidor; mismo patrón que `useSyncQueue`).
 */

const mockQueuedManifestPhotoCount = vi.fn();
vi.mock('@/lib/offline/photos', () => ({
  queuedManifestPhotoCount: (...args: unknown[]) => mockQueuedManifestPhotoCount(...args),
}));
vi.mock('@/lib/db', () => ({ db: {} }));

describe('useQueuedManifestPhotoCount', () => {
  beforeEach(() => {
    mockQueuedManifestPhotoCount.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads queuedManifestPhotoCount for the given operator/manifest and returns it', async () => {
    mockQueuedManifestPhotoCount.mockResolvedValue(2);

    const { result } = renderHook(() => useQueuedManifestPhotoCount('op-1', 'manifest-1'));

    await waitFor(() => expect(result.current).toBe(2));
    expect(mockQueuedManifestPhotoCount).toHaveBeenCalledWith(expect.anything(), 'op-1', 'manifest-1');
  });

  it('is 0 without reading anything when operatorId or manifestId is missing', async () => {
    const { result, rerender } = renderHook(
      ({ operatorId, manifestId }: { operatorId: string | null; manifestId: string | null }) =>
        useQueuedManifestPhotoCount(operatorId, manifestId),
      { initialProps: { operatorId: null, manifestId: 'manifest-1' } }
    );

    expect(result.current).toBe(0);
    expect(mockQueuedManifestPhotoCount).not.toHaveBeenCalled();

    rerender({ operatorId: 'op-1', manifestId: null });
    expect(result.current).toBe(0);
    expect(mockQueuedManifestPhotoCount).not.toHaveBeenCalled();
  });

  it('re-reads on a poll interval so a photo enqueued after mount is reflected', async () => {
    vi.useFakeTimers();
    mockQueuedManifestPhotoCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const { result } = renderHook(() => useQueuedManifestPhotoCount('op-1', 'manifest-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current).toBe(1);
  });
});
