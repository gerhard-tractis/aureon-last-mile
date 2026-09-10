/**
 * spec-80 fase 6 — el camino sin señal DE PUNTA A PUNTA: capturar (un
 * `File`, exactamente lo que `ManifestCameraSheet`/`PhotoReviewSheet`
 * entregan a `ManifestPhotoStrip`, ver ese componente) → encolar
 * (`enqueueManifestPhoto`) → drenar (`sendManifestPhoto`), sin que la foto
 * se pierda ni se desprenda de la carga a la que pertenece.
 *
 * `enqueueManifestPhoto` y `sendManifestPhoto` ya tienen su propia suite
 * exhaustiva en `photos.test.ts` (spec-81 fase 5) — esta prueba no repite
 * esa cobertura, existe para demostrar la COSTURA entre ambas que spec-80
 * fase 6 declara: lo que sale de una entra en la otra sin perder
 * `externalLoadId` ni el número de hoja.
 *
 * Limitación declarada, no escondida — `fake-indexeddb` no hace round-trip
 * de un `Blob`/`File` real a través de `db.pickup_queue.add()`/`.get()`: la
 * entrada que devuelve `enqueueManifestPhoto` (que sí pasa por ese
 * round-trip, ver `queue.ts#enqueue`) vuelve con `blob` convertido en `{}`
 * (pierde `.size` y cualquier otra propiedad de `Blob`) — mismo límite que
 * `photos.test.ts` ya documenta para `fakeBlob()`. Un navegador real sí
 * preserva el `Blob`. Para probar el resto del camino (que la fila drena, y
 * con los metadatos correctos) sin ese artefacto del polyfill, este test
 * reconstituye la entrada con el `File` real antes de drenar — exactamente
 * lo que `db.pickup_queue.get()` devolvería en un navegador real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import type { PickupQueueEntry } from '../db';
import { enqueueManifestPhoto, sendManifestPhoto, manifestPhotoStoragePath } from './photos';
import type { ManifestPhotoPayload } from './photos-types';

const OPERATOR_A = 'operator-a';
const USER_A = 'user-a';
const MANIFEST_1 = 'manifest-1';
const LOAD_LABEL = 'CARGA-99814';

function storageStub() {
  const upload = vi.fn(async () => ({ data: { path: 'x' }, error: null }));
  const insert = vi.fn(async () => ({ data: [{}], error: null }));
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: USER_A } } }, error: null }));
  const select = vi.fn(() => {
    const chain = {
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    return chain;
  });

  const supabase = {
    auth: { getSession },
    storage: { from: vi.fn(() => ({ upload, remove: vi.fn(async () => ({ data: [], error: null })) })) },
    from: vi.fn(() => ({ insert, select })),
  };

  return { supabase: supabase as unknown as Parameters<typeof sendManifestPhoto>[1], upload, insert };
}

describe('captura → encolar → drenar (spec-80 fase 6, costura con spec-81 fase 5)', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
  });

  it('una foto capturada offline llega a manifest_documents con el mismo sheetNumber y sin perder externalLoadId', async () => {
    const capturedFile = new File([new Uint8Array(10)], 'sheet-1.jpg', { type: 'image/jpeg' });

    const queued = await enqueueManifestPhoto(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      externalLoadId: LOAD_LABEL,
      sheetNumber: 1,
      blob: capturedFile,
    });

    // "Encolar" — sobrevive el round-trip real de IndexedDB con los
    // metadatos que el chip de sync necesita para identificar la carga.
    expect(queued.status).toBe('pending');
    expect(queued.type).toBe('manifest_photo');
    expect(queued.externalLoadId).toBe(LOAD_LABEL);
    expect((queued.payload as ManifestPhotoPayload).sheetNumber).toBe(1);

    // Ver el docstring de este fichero — `queued.blob` perdió su identidad
    // de Blob real en el polyfill; se reconstituye con el File original
    // capturado, tal como lo devolvería un navegador real.
    const entryForDrain: PickupQueueEntry = {
      ...queued,
      blob: capturedFile,
      status: 'sending',
      claimToken: 'token-drain-1',
    };

    const { supabase, upload, insert } = storageStub();

    const result = await sendManifestPhoto(supabase, db, entryForDrain);

    // "Drenar" — la foto no se pierde: llega al bucket y a la tabla con el
    // mismo número de hoja que se capturó, en la ruta determinista de esta
    // entrada.
    expect(result).toEqual({ outcome: 'sent' });
    expect(upload).toHaveBeenCalledWith(
      manifestPhotoStoragePath(entryForDrain),
      capturedFile,
      expect.objectContaining({ upsert: true, contentType: 'image/jpeg' })
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: OPERATOR_A,
        manifest_id: MANIFEST_1,
        storage_path: manifestPhotoStoragePath(entryForDrain),
        sheet_number: 1,
      })
    );
  });
});
