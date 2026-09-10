/**
 * spec-80 fase 6 — la COSTURA entre `enqueueManifestPhoto` (encolar) y
 * `sendManifestPhoto` (drenar): capturar un `File` (exactamente lo que
 * `ManifestCameraSheet`/`PhotoReviewSheet` entregan a `ManifestPhotoStrip`,
 * ver ese componente), encolarlo, y drenarlo, sin perder `externalLoadId` ni
 * el número de hoja.
 *
 * Ronda 2 de review del PR #736 — "de punta a punta" era más fuerte de lo
 * que este archivo mide, y se corrige aquí: la mitad de drenado corre sobre
 * una entrada RECONSTITUIDA a mano (`status: 'sending'`, `claimToken`
 * puesto por el test, ver más abajo) y sin `onManifestDocumentsChanged`, que
 * producción siempre pasa (`offlineQueueSender.ts`, `AppLayout.tsx`). Ese
 * paso completo — reclamar de la cola real y despachar con el callback
 * puesto — ya tiene su propia cobertura en `photos.test.ts`
 * (`sendManifestPhoto` con `onManifestDocumentsChanged`) y en
 * `offlineQueueSender.test.ts`; lo que este archivo prueba es más estrecho:
 * que lo que `enqueueManifestPhoto` persiste es exactamente lo que
 * `sendManifestPhoto` necesita para no perder la foto ni el `externalLoadId`.
 *
 * `enqueueManifestPhoto` y `sendManifestPhoto` ya tienen su propia suite
 * exhaustiva en `photos.test.ts` (spec-81 fase 5) — esta prueba no repite
 * esa cobertura.
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
 *
 * Consecuencia de esa misma pérdida, señalada en ronda 2 de review y no
 * declarada antes — `unconfirmedPhotoBytes` (`photos.ts`) suma
 * `entry.blob?.size ?? 0` sobre lo que YA está en `db`; tras un round-trip
 * real en este suite esa suma siempre da 0 (el `{}` no tiene `.size`), así
 * que el segundo `enqueueManifestPhoto` de la prueba de abajo no ejercita de
 * verdad el tope de 200 MB (`MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR`)
 * contra algo persistido — sólo contra el `Blob` en memoria que se le pasa a
 * esa MISMA llamada. `photos.test.ts` ya declara y trabaja alrededor de esta
 * limitación con su propio `fakeBlob()` (un duck-type con `.size` real, sin
 * pasar por el round-trip) para las pruebas que sí necesitan ejercitar ese
 * tope.
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

  // Verificado en ronda 2 de review del PR #736 y convertido aquí en test
  // permanente — dos capturas seguidas sin drenar, ambas pidiendo el MISMO
  // `sheetNumber` (1: es lo que `ManifestPhotoStrip` calcularía dos veces
  // seguidas contra la misma lista `documents`, sin señal para refrescarla
  // — ver B3 en `photos.ts`). El desempate ocurre DENTRO de
  // `enqueueManifestPhoto`, a través del llamador nuevo de esta fase, no
  // sólo en la suite propia de `photos.ts`.
  it('dos capturas offline seguidas del mismo manifiesto no colisionan: dos filas, hojas [1,2], externalLoadId en ambas', async () => {
    const first = await enqueueManifestPhoto(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      externalLoadId: LOAD_LABEL,
      sheetNumber: 1,
      blob: new File([new Uint8Array(10)], 'sheet-a.jpg', { type: 'image/jpeg' }),
    });
    const second = await enqueueManifestPhoto(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      externalLoadId: LOAD_LABEL,
      sheetNumber: 1,
      blob: new File([new Uint8Array(10)], 'sheet-b.jpg', { type: 'image/jpeg' }),
    });

    const rows = await db.pickup_queue.where('manifestId').equals(MANIFEST_1).toArray();
    expect(rows).toHaveLength(2);
    expect(
      rows.map((r) => (r.payload as ManifestPhotoPayload).sheetNumber).sort()
    ).toEqual([1, 2]);
    expect(rows.every((r) => r.externalLoadId === LOAD_LABEL)).toBe(true);
    expect((first.payload as ManifestPhotoPayload).sheetNumber).toBe(1);
    expect((second.payload as ManifestPhotoPayload).sheetNumber).toBe(2);
  });
});
