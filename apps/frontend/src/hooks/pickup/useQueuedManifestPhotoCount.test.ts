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

  // Seguimiento de spec-80 fase 6 (PR #736) — `return () => clearInterval(id)`
  // ya estaba en el código, pero ningún test afirmaba que el intervalo
  // parara al desmontar. El antecedente concreto: trabajo que sobrevive al
  // desmontaje acaba enviando con el JWT del SIGUIENTE conductor, porque el
  // cliente resuelve la sesión al momento de la petición y `AppLayout` se
  // desmonta al cerrar sesión. Mutar `return () => clearInterval(id)` a
  // `return;` no debe dejar ningún test en verde.
  it('stops polling after unmount — no read survives for the next driver', async () => {
    vi.useFakeTimers();
    mockQueuedManifestPhotoCount.mockResolvedValue(0);

    const { unmount } = renderHook(() => useQueuedManifestPhotoCount('op-1', 'manifest-1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    mockQueuedManifestPhotoCount.mockClear();

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(mockQueuedManifestPhotoCount).not.toHaveBeenCalled();
  });

  // Seguimiento de spec-80 fase 6 (PR #736) — `5i` lleva "Sigue en PR-…" al
  // siguiente manifiesto de la misma ruta dentro del MISMO segmento de
  // Next, así que `manifestId` cambia sin remontar este hook. Sin bandera
  // de cancelación, una lectura en vuelo del manifiesto VIEJO que resuelve
  // después de la del nuevo puede pisar el count correcto con el de la
  // cola de otro manifiesto — se autocorrige en el siguiente tick de 2s,
  // pero mientras tanto la pantalla miente.
  it('ignores a stale read from the previous manifestId if it resolves after the new one, without remounting', async () => {
    let resolveOld!: (value: number) => void;
    const oldRead = new Promise<number>((resolve) => {
      resolveOld = resolve;
    });
    mockQueuedManifestPhotoCount.mockImplementationOnce(() => oldRead);
    mockQueuedManifestPhotoCount.mockResolvedValueOnce(5);

    const { result, rerender } = renderHook(
      ({ manifestId }: { manifestId: string }) => useQueuedManifestPhotoCount('op-1', manifestId),
      { initialProps: { manifestId: 'manifest-old' } }
    );

    rerender({ manifestId: 'manifest-new' });
    await waitFor(() => expect(result.current).toBe(5));

    await act(async () => {
      resolveOld(1);
      await oldRead;
    });

    expect(result.current).toBe(5);
  });
});
