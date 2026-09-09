/**
 * spec-81 fase 5 — Fotos: blob a IndexedDB en captura, subida diferida al
 * bucket `manifests` al drenar. Ver docs/specs/spec-81-recogida-cola-offline.md.
 *
 * `useUploadManifestDocument` (spec-80 fase 3) sube directo al bucket y
 * pierde el archivo si falla sin señal — `complete/[loadId]/page.tsx` lo
 * declara explícitamente como el hueco que esta fase cierra. El contrato de
 * "fila huérfana imposible" es el mismo que ese hook ya cumple del lado
 * online (sube, y sólo si la subida tiene éxito inserta la fila; si el
 * insert falla, borra lo subido) — aquí se repite detrás de la cola offline,
 * más el caso que ese hook no cubre: qué pasa con un reintento de la MISMA
 * foto (mismo `client_operation_id`, nunca regenerado — ver `queue.ts`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import {
  enqueueManifestPhoto,
  manifestPhotoStoragePath,
  sendManifestPhoto,
  unconfirmedPhotoBytes,
  MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR,
  MAX_PHOTO_FILE_BYTES,
} from './photos';
import { PICKUP_QUEUE_WAKE_EVENT } from '@/hooks/useOfflineQueue';
import type { PickupQueueEntry } from '../db';

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';
const USER_A = 'user-a';
const MANIFEST_1 = 'manifest-1';

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

/**
 * fake-indexeddb's structured-clone polyfill does not round-trip a real
 * `Blob`'s identity through `db.pickup_queue.add`/`.toArray()` — it comes
 * back as `{}`, losing `.size` (verified: a real Blob written via Dexie in
 * this suite reads back as `{}`, same limitation `queue.test.ts`'s B6
 * documents for `enqueue`). Tests that SEED an entry directly (bypassing
 * `enqueueManifestPhoto`, to assert on `unconfirmedPhotoBytes`/the byte cap
 * without paying for a real multi-MB blob) use this duck-typed stand-in —
 * `unconfirmedPhotoBytes` only ever reads `.size`, so it can't tell the
 * difference, and a real browser's IndexedDB (unlike the polyfill) does
 * preserve a real Blob's `.size` across the same round trip in production.
 */
function fakeBlob(size: number): Blob {
  return { size } as unknown as Blob;
}

describe('recogida offline queue — fotos (spec-81 fase 5)', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
  });

  describe('enqueueManifestPhoto', () => {
    // Mismo criterio que B6 en `queue.test.ts` — fake-indexeddb no
    // round-tripea la identidad de un `Blob` real (vuelve como `{}`), así
    // que afirmar sobre una relectura probaría el polyfill, no este código.
    // Se afirma sobre la escritura misma: el objeto que llega a
    // `db.pickup_queue.add` debe llevar el blob y el `sheetNumber` en el
    // payload.
    it('persists the blob and the sheet number on the entry', async () => {
      const addSpy = vi.spyOn(db.pickup_queue, 'add');
      const blob = blobOfSize(1024);

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob,
      });

      expect(entry.type).toBe('manifest_photo');
      expect(addSpy).toHaveBeenCalledWith(
        expect.objectContaining({ blob, payload: { sheetNumber: 1 } }),
      );
      addSpy.mockRestore();
    });

    it('rejects when the operator would exceed the declared byte cap for unconfirmed photos', async () => {
      // Semilla directa (no vía enqueue, para no pagar el coste de blobs
      // reales de 200 MB en el test) de una entrada `pending` cuyo blob ya
      // ocupa el tope completo.
      await db.pickup_queue.add({
        clientOperationId: 'seed-1',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      await expect(
        enqueueManifestPhoto(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_1,
          sheetNumber: 2,
          blob: blobOfSize(1),
        }),
      ).rejects.toThrow(/cola de fotos llena|bytes|MB/i);
    });

    it('does not count a sent photo (already uploaded) against the byte cap', async () => {
      await db.pickup_queue.add({
        clientOperationId: 'seed-sent',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR),
        status: 'sent',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 2,
        blob: blobOfSize(1024),
      });

      expect(entry.status).toBe('pending');
    });

    it('does not count another operator\'s queued photos against this operator\'s cap', async () => {
      await db.pickup_queue.add({
        clientOperationId: 'seed-other-operator',
        operatorId: OPERATOR_B,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(1024),
      });

      expect(entry.status).toBe('pending');
    });

    // Mutante superviviente (menor, review del PR #712): `>` frente a `>=`
    // en el guard del tope. En el borde exacto (currentBytes + blob.size ===
    // CAP) debe encolar, no rechazar — el tope es "no superar", no "llegar
    // a". Semilla con `fakeBlob` (no vía `enqueueManifestPhoto` con un Blob
    // real): un segundo encolado real perdería el tamaño del primero al
    // releer (fake-indexeddb, ver el docstring de `fakeBlob`), lo que
    // falsearía el conteo del segundo intento.
    it('allows enqueueing exactly up to the byte cap (boundary)', async () => {
      const remaining = 100;
      await db.pickup_queue.add({
        clientOperationId: 'seed-boundary',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR - remaining),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      await expect(
        enqueueManifestPhoto(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_1,
          sheetNumber: 2,
          blob: blobOfSize(remaining),
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    });

    it('rejects a single byte past the exact byte cap boundary', async () => {
      const remaining = 100;
      await db.pickup_queue.add({
        clientOperationId: 'seed-boundary-plus-one',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(MAX_UNCONFIRMED_PHOTO_BYTES_PER_OPERATOR - remaining),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      await expect(
        enqueueManifestPhoto(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_1,
          sheetNumber: 2,
          blob: blobOfSize(remaining + 1),
        }),
      ).rejects.toThrow(/cola de fotos llena|bytes|MB/i);
    });

    // M2, review del PR #712 (mayor) — el bucket `manifests` tiene
    // `file_size_limit = 10485760` (10 MiB); sin este tope, una foto por
    // encima de ese límite sube en cada intento, el bucket la rechaza con un
    // error no reconocido → `retry` × `MAX_RETRY_ATTEMPTS` → `dead` →
    // manifiesto bloqueado sin salida. Rechazarla AQUÍ, en el momento de
    // capturar, es donde el operario todavía puede repetir la foto (más
    // comprimida, o recortada) en vez de perder la sesión entera contra un
    // límite del bucket que el drenador de fondo no puede negociar.
    it('rejects a single photo above the bucket file_size_limit before it ever reaches the queue', async () => {
      const addSpy = vi.spyOn(db.pickup_queue, 'add');

      await expect(
        enqueueManifestPhoto(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_1,
          sheetNumber: 1,
          blob: blobOfSize(MAX_PHOTO_FILE_BYTES + 1),
        }),
      ).rejects.toThrow(/10\s*MiB|tamaño|MB/i);

      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });

    it('allows a single photo exactly at the bucket file_size_limit', async () => {
      await expect(
        enqueueManifestPhoto(db, {
          operatorId: OPERATOR_A,
          userId: USER_A,
          manifestId: MANIFEST_1,
          sheetNumber: 1,
          blob: blobOfSize(MAX_PHOTO_FILE_BYTES),
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    });

    // M1, review del PR #712 (mayor) — `complete/[loadId]/page.tsx:228`
    // dispara este evento tras encolar un `close_manifest` offline; sin el
    // equivalente aquí, una foto encolada mientras la PWA sigue montada
    // (el caso normal: el operario sigue en la pantalla de captura) espera
    // al próximo `online` real o al próximo montaje de `AppLayout` — que,
    // para una sesión que nunca perdió `navigator.onLine` de verdad (sólo
    // falló el upload puntual, o el operario está offline desde antes de
    // abrir la cámara), puede no llegar nunca hasta cerrar y reabrir la PWA.
    it('wakes the drainer (PICKUP_QUEUE_WAKE_EVENT) after a successful enqueue', async () => {
      const handler = vi.fn();
      window.addEventListener(PICKUP_QUEUE_WAKE_EVENT, handler);

      await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(1024),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      window.removeEventListener(PICKUP_QUEUE_WAKE_EVENT, handler);
    });

    it('does not wake the drainer when enqueueing is rejected by a cap', async () => {
      const handler = vi.fn();
      window.addEventListener(PICKUP_QUEUE_WAKE_EVENT, handler);

      await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(MAX_PHOTO_FILE_BYTES + 1),
      }).catch(() => undefined);

      expect(handler).not.toHaveBeenCalled();
      window.removeEventListener(PICKUP_QUEUE_WAKE_EVENT, handler);
    });

    // B3, review del PR #712 (bloqueante) — `ManifestPhotoStrip.tsx` calcula
    // `nextSheetNumber` contra `useManifestDocuments` (una query al
    // servidor), que sin señal queda CONGELADA. Dos hojas capturadas offline
    // en el MISMO dispositivo reciben el mismo número propuesto — no es una
    // carrera rara, es el caso normal del flujo que esta fase existe para
    // cubrir. Sin este guard, la segunda choca en el drenador con un
    // `storage_path` distinto (`sheet-N-<otro client_operation_id>`) → 23505
    // "colisión real" → `dead` → `manifestHasDeadEntry` bloquea también el
    // `close_manifest` de la carga, sin salida (`retryDead` repite la misma
    // colisión). `enqueueManifestPhoto` desambigua contra lo que SÍ es
    // consultable offline — la cola local — antes de que el número llegue al
    // servidor.
    it('B3: renumbers past a sheetNumber already queued locally for the same manifest, so two offline captures never collide', async () => {
      const first = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 3,
        blob: blobOfSize(10),
      });
      // La UI offline propone el MISMO número para la segunda captura —
      // `useManifestDocuments` está congelada sin señal.
      const second = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 3,
        blob: blobOfSize(10),
      });

      expect((first.payload as { sheetNumber: number }).sheetNumber).toBe(3);
      expect((second.payload as { sheetNumber: number }).sheetNumber).toBe(4);
    });

    it('B3: skips past every number already taken, not just the first collision', async () => {
      await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });
      await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      const third = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      expect((third.payload as { sheetNumber: number }).sheetNumber).toBe(3);
    });

    it('B3: does not renumber past a collision with a DIFFERENT manifest', async () => {
      await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: 'manifest-other',
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      expect((entry.payload as { sheetNumber: number }).sheetNumber).toBe(1);
    });

    it('B3: a sheet number already sent (uploaded, cleared from the local queue) is available again', async () => {
      await db.pickup_queue.add({
        clientOperationId: 'seed-sent',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(10),
        status: 'sent',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      // `sent` ya se subió con su propio storage_path — el servidor es la
      // fuente de verdad para ese número; renumerar aquí sólo importa contra
      // lo que la cola LOCAL todavía no confirmó.
      expect((entry.payload as { sheetNumber: number }).sheetNumber).toBe(1);
    });

    // M-1, ronda 3 de review del PR #712 (mayor) — el mutante superviviente:
    // restringir la consulta a `status === 'pending'` no rompía ningún test,
    // porque los tres de arriba sólo siembran `pending`. El CÓDIGO ya mira
    // toda la cola (`status !== 'sent'`, sin filtro de `userId`); estos dos
    // tests fijan que la SUITE también lo exige — una entrada `sending`
    // puede ya haber insertado su fila en el servidor con ese número, y una
    // `dead` sigue ocupando ese número hasta que un humano la resuelva.
    it('B3/M-1: a sheetNumber taken by a sending entry still counts (not just pending)', async () => {
      await db.pickup_queue.add({
        clientOperationId: 'seed-sending',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(10),
        status: 'sending',
        retryCount: 0,
        claimToken: 'token-x',
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      expect((entry.payload as { sheetNumber: number }).sheetNumber).toBe(2);
    });

    it('B3/M-1: a sheetNumber taken by a dead entry from a different user still counts', async () => {
      await db.pickup_queue.add({
        clientOperationId: 'seed-dead-other-user',
        operatorId: OPERATOR_A,
        userId: 'a-different-user',
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(10),
        status: 'dead',
        retryCount: 10,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });

      const entry = await enqueueManifestPhoto(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        sheetNumber: 1,
        blob: blobOfSize(10),
      });

      expect((entry.payload as { sheetNumber: number }).sheetNumber).toBe(2);
    });
  });

  describe('unconfirmedPhotoBytes', () => {
    async function seed(overrides: Partial<PickupQueueEntry>) {
      await db.pickup_queue.add({
        clientOperationId: `seed-${Math.random()}`,
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: fakeBlob(0),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
        ...overrides,
      });
    }

    it('sums pending, sending and dead manifest_photo blobs for the given operator', async () => {
      await seed({ status: 'pending', blob: fakeBlob(2000) });
      await seed({ status: 'sending', blob: fakeBlob(3000) });
      await seed({ status: 'dead', blob: fakeBlob(500) });

      await expect(unconfirmedPhotoBytes(db, OPERATOR_A)).resolves.toBe(5500);
    });

    it('does not count a sent photo', async () => {
      await seed({ status: 'sent', blob: fakeBlob(2000) });

      await expect(unconfirmedPhotoBytes(db, OPERATOR_A)).resolves.toBe(0);
    });

    it('does not count an entry of another type even if it carries a blob', async () => {
      await seed({ type: 'close_manifest', blob: fakeBlob(2000) });

      await expect(unconfirmedPhotoBytes(db, OPERATOR_A)).resolves.toBe(0);
    });

    it('does not count another operator\'s photos', async () => {
      await seed({ operatorId: OPERATOR_B, blob: fakeBlob(2000) });

      await expect(unconfirmedPhotoBytes(db, OPERATOR_A)).resolves.toBe(0);
    });
  });

  describe('manifestPhotoStoragePath', () => {
    it('is deterministic for the same entry — stable across retries', () => {
      const entry: PickupQueueEntry = {
        id: 1,
        clientOperationId: 'client-op-1',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 3 },
        blob: blobOfSize(10),
        status: 'sending',
        retryCount: 2,
        claimToken: 'token-x',
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      };

      const first = manifestPhotoStoragePath(entry);
      const second = manifestPhotoStoragePath(entry);

      expect(first).toBe(second);
      expect(first).toBe(`${OPERATOR_A}/${MANIFEST_1}/sheet-3-client-op-1.jpg`);
    });
  });

  describe('sendManifestPhoto', () => {
    function photoEntry(overrides: Partial<PickupQueueEntry> = {}): PickupQueueEntry {
      return {
        id: 1,
        clientOperationId: 'client-op-1',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 3 },
        blob: blobOfSize(10),
        status: 'sending',
        retryCount: 0,
        claimToken: 'token-1',
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
        ...overrides,
      };
    }

    /**
     * `select()` puede pedirse por DOS motivos distintos aquí — verificar si
     * un 23505 es la MISMA foto (`.eq().eq().eq().is().maybeSingle()`) o
     * encontrar el siguiente `sheet_number` libre al renumerar tras una
     * colisión real (`.eq().eq().is().order().limit().maybeSingle()`, B-1
     * ronda 3). Cada llamada a `select()` construye una cadena nueva; si esa
     * cadena ve `.order()`, es la consulta de renumerado — el resultado que
     * da su `maybeSingle()` se controla por separado del de verificación de
     * 23505.
     */
    function storageStub({
      uploadError = null as { name?: string; message: string } | null,
      insertError = null as { code?: string; message: string } | null,
      existingRow = null as { storage_path: string } | null,
      selectError = null as { code?: string; message: string } | null,
      maxSheetRow = null as { sheet_number: number } | null,
      maxSheetError = null as { code?: string; message: string } | null,
      authUserId = null as string | null,
      getSessionThrows = false,
    } = {}) {
      const upload = vi.fn(async () => (uploadError ? { data: null, error: uploadError } : { data: { path: 'x' }, error: null }));
      const remove = vi.fn(async () => ({ data: [], error: null }));
      const insert = vi.fn(async () => (insertError ? { data: null, error: insertError } : { data: [{}], error: null }));
      // Ronda 4 de review del PR #712 (bloqueante) — `getSession()`, no
      // `getUser()`: medido contra `@supabase/auth-js@2.72.0` — `getUser()`
      // es una llamada de red real con `_acquireLock(-1, …)` (espera de lock
      // SIN timeout) y puede disparar `_removeSession()` en su `catch`.
      // `getSession()` da el mismo `user.id`, es local.
      const getSession = vi.fn(async () => {
        if (getSessionThrows) throw new Error('getSession failed');
        return {
          data: { session: authUserId ? { user: { id: authUserId } } : null },
          error: null,
        };
      });

      const select = vi.fn(() => {
        let usedOrder = false;
        const chain = {
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          order: vi.fn(() => {
            usedOrder = true;
            return chain;
          }),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(async () =>
            usedOrder
              ? maxSheetError
                ? { data: null, error: maxSheetError }
                : { data: maxSheetRow, error: null }
              : selectError
                ? { data: null, error: selectError }
                : { data: existingRow, error: null },
          ),
        };
        return chain;
      });

      const supabase = {
        auth: { getSession },
        storage: {
          from: vi.fn(() => ({ upload, remove })),
        },
        from: vi.fn(() => ({ insert, select })),
      };

      return {
        supabase: supabase as unknown as Parameters<typeof sendManifestPhoto>[1],
        upload,
        remove,
        insert,
        select,
        getSession,
      };
    }

    it('reports dead without any network call when the entry carries no blob', async () => {
      const { supabase, upload, insert } = storageStub();

      const result = await sendManifestPhoto(supabase, db, photoEntry({ blob: undefined }));

      expect(result.outcome).toBe('dead');
      expect(upload).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('reports dead without any network call when the entry has no id', async () => {
      const { supabase, upload } = storageStub();

      const result = await sendManifestPhoto(supabase, db, photoEntry({ id: undefined }));

      expect(result.outcome).toBe('dead');
      expect(upload).not.toHaveBeenCalled();
    });

    it('uploads to the deterministic path, inserts the row, and reports sent on the happy path', async () => {
      const { supabase, upload, insert } = storageStub();
      const entry = photoEntry();

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(upload).toHaveBeenCalledWith(
        manifestPhotoStoragePath(entry),
        entry.blob,
        expect.objectContaining({ upsert: true, contentType: entry.blob!.type }),
      );
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          operator_id: OPERATOR_A,
          manifest_id: MANIFEST_1,
          storage_path: manifestPhotoStoragePath(entry),
          sheet_number: 3,
        }),
      );
      expect(result).toEqual({ outcome: 'sent' });
    });

    // B-2, ronda 3 de review del PR #712 (bloqueante) — `sendManifestPhoto`
    // dispara `onManifestDocumentsChanged` cuando el envío SÍ se aplicó, no
    // sólo cuando el llamador (`offlineQueueSender.ts`) lo inspecciona desde
    // fuera — el llamador de la ronda 4 ya no distingue por `outcome`.
    it('calls onManifestDocumentsChanged on a successful send', async () => {
      const { supabase } = storageStub();
      const entry = photoEntry();
      const onManifestDocumentsChanged = vi.fn();

      await sendManifestPhoto(supabase, db, entry, { onManifestDocumentsChanged });

      expect(onManifestDocumentsChanged).toHaveBeenCalledTimes(1);
      expect(onManifestDocumentsChanged).toHaveBeenCalledWith(entry);
    });

    it('does not call onManifestDocumentsChanged when the upload fails', async () => {
      const { supabase } = storageStub({
        uploadError: { name: 'StorageApiError', message: 'nope' },
      });
      const onManifestDocumentsChanged = vi.fn();

      await sendManifestPhoto(supabase, db, photoEntry(), { onManifestDocumentsChanged });

      expect(onManifestDocumentsChanged).not.toHaveBeenCalled();
    });

    // M-4, ronda 3 de review del PR #712 (mayor) — `uploaded_by` NO puede
    // venir de `entry.userId` (B2, ronda 1: rompe la policy cross-user) NI
    // ser `null` fijo (M-4: sobre una tabla cuyo COMMENT dice "es el
    // respaldo si después falta un paquete", `null` fijo dejaba la columna
    // medio poblada — no-nula online, siempre nula offline). Se resuelve de
    // la sesión que DRENA, en el momento del envío — la misma fuente que
    // compara la policy, nunca del payload. Registra quién SUBIÓ, no quién
    // CAPTURÓ (corrección de la ronda 4: en el escenario cross-user son
    // personas distintas, y "quién capturó" no se persiste en ningún sitio).
    it('resolves uploaded_by from the draining session, never from the queued entry', async () => {
      const { supabase, insert } = storageStub({ authUserId: 'draining-session-user' });
      const entry = photoEntry({ userId: 'a-different-user-than-the-draining-session' });

      await sendManifestPhoto(supabase, db, entry);

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({ uploaded_by: 'draining-session-user' }),
      );
    });

    it('falls back to null uploaded_by when no session is resolvable, instead of failing the upload', async () => {
      const { supabase, insert } = storageStub({ authUserId: null });

      await sendManifestPhoto(supabase, db, photoEntry());

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ uploaded_by: null }));
    });

    // Bloqueante, ronda 4 de review del PR #712 — sin `try/catch`, una
    // excepción de `getSession()` escapaba de `sendManifestPhoto` DESPUÉS de
    // una subida ya exitosa, sin limpiar el objeto — el único camino
    // post-subida que rompía "fila huérfana imposible". Con el `catch`, cae
    // a `uploaded_by: null` y sigue hasta el insert con normalidad.
    it('falls back to null uploaded_by (and still inserts) when getSession itself throws', async () => {
      const { supabase, insert, remove } = storageStub({ getSessionThrows: true });

      const result = await sendManifestPhoto(supabase, db, photoEntry());

      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ uploaded_by: null }));
      expect(result).toEqual({ outcome: 'sent' });
      expect(remove).not.toHaveBeenCalled();
    });

    // M2, review del PR #712 — el bucket `manifests` sólo acepta
    // image/jpeg|png|webp|heic|heif (`20260430000001_create_manifests_storage_bucket.sql`);
    // sin `contentType` explícito, storage-js infiere el MIME del NOMBRE del
    // objeto (`.jpg`, forzado por `manifestPhotoStoragePath` sin importar el
    // tipo real del blob) en vez del blob real — un HEIC de iOS subido con
    // nombre `.jpg` puede acabar con un content-type equivocado. Se pasa el
    // `.type` real del blob capturado.
    it('passes the real blob content type to upload, not inferred from the .jpg path', async () => {
      const { supabase, upload } = storageStub();
      const entry = photoEntry({ blob: new Blob(['x'], { type: 'image/heic' }) });

      await sendManifestPhoto(supabase, db, entry);

      expect(upload).toHaveBeenCalledWith(
        manifestPhotoStoragePath(entry),
        entry.blob,
        expect.objectContaining({ contentType: 'image/heic' }),
      );
    });

    // Menor, ronda 3 de review del PR #712 — un `Blob`/`File` sin MIME
    // (medido: algunos `<input capture>` en Android lo dejan vacío) manda
    // `contentType: ''`, que un bucket con lista blanca de MIME rechaza de
    // forma PERMANENTE — un rechazo que reintentar nunca arregla.
    it('falls back to image/jpeg when the blob has no MIME type', async () => {
      const { supabase, upload } = storageStub();
      const entry = photoEntry({ blob: new Blob(['x'], { type: '' }) });

      await sendManifestPhoto(supabase, db, entry);

      expect(upload).toHaveBeenCalledWith(
        manifestPhotoStoragePath(entry),
        entry.blob,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
    });

    it('reports offline when the upload fails on a network error, and never attempts the insert', async () => {
      const { supabase, insert } = storageStub({
        uploadError: { name: 'StorageUnknownError', message: 'Failed to fetch' },
      });

      const result = await sendManifestPhoto(supabase, db, photoEntry());

      expect(result.outcome).toBe('offline');
      expect(insert).not.toHaveBeenCalled();
    });

    it('reports retry when the upload fails on a non-network storage error', async () => {
      const { supabase } = storageStub({
        uploadError: { name: 'StorageApiError', message: 'The resource already exists' },
      });

      const result = await sendManifestPhoto(supabase, db, photoEntry());

      expect(result.outcome).toBe('retry');
    });

    // "Test: fila huérfana imposible" (checklist de la fase) — si la subida
    // tiene éxito pero el insert falla por una razón que NO sea "esta misma
    // foto ya se aplicó", el objeto subido se borra: ninguna fila puede
    // quedar sin insertarse mientras el objeto sigue huérfano en el bucket,
    // y ningún objeto puede quedar en el bucket sin una fila que lo respalde
    // tras un fallo de insert no idempotente.
    it('orphan impossible: removes the uploaded object when the insert fails for a non-idempotent reason', async () => {
      const { supabase, remove, upload } = storageStub({
        insertError: { code: '42501', message: 'permission denied' },
      });
      const entry = photoEntry();

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(upload).toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith([manifestPhotoStoragePath(entry)]);
      expect(result.outcome).toBe('retry');
    });

    // Reintento de la MISMA foto: la subida (mismo path determinista,
    // `upsert: true`) es idempotente por construcción; el insert choca
    // contra la fila que su intento anterior sí aplicó (la respuesta se
    // perdió en el camino). No es un huérfano — la fila referencia
    // exactamente el objeto que acabamos de volver a subir — así que se
    // reporta `sent`, no se borra nada, y no se crea una segunda fila.
    it('reports sent (not dead, no cleanup) when a 23505 on insert is this same retried photo', async () => {
      const entry = photoEntry();
      const { supabase, remove } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: manifestPhotoStoragePath(entry) },
      });

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(result).toEqual({ outcome: 'sent' });
      expect(remove).not.toHaveBeenCalled();
    });

    // B-1, ronda 3 de review del PR #712 (bloqueante, parte 1) — decisión
    // del usuario: una colisión de `sheet_number` NO muere. Una foto es
    // respaldo, no conteo — su pérdida no falsea la cifra que el cliente
    // firma en `close_manifest` — y el número es sólo una etiqueta de
    // presentación ("hoja N"), no una identidad. Se limpia el objeto subido
    // bajo el número viejo, se calcula el siguiente número libre CONTRA EL
    // SERVIDOR (la fuente real del conflicto) y se reintenta con ese número
    // nuevo — nunca `dead`.
    it('B-1: renumbers and retries (never dead) when a 23505 on insert is a genuine sheet_number collision', async () => {
      const entry = photoEntry();
      const { supabase, remove } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetRow: { sheet_number: 5 },
      });
      const updateSpy = vi.spyOn(db.pickup_queue, 'update');

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(result.outcome).toBe('retry');
      expect(remove).toHaveBeenCalledWith([manifestPhotoStoragePath(entry)]);
      expect(updateSpy).toHaveBeenCalledWith(entry.id, { payload: { sheetNumber: 6 } });
      updateSpy.mockRestore();
    });

    // Menor, ronda 4 de review del PR #712 — este 23505 acaba de revelar una
    // fila del servidor que la tira puede no conocer todavía (la que causó
    // la colisión); invalidar aquí, no sólo en `sent`, cierra el círculo que
    // B-2 abrió.
    it('calls onManifestDocumentsChanged when a collision is discovered and renumbered', async () => {
      const entry = photoEntry();
      const { supabase } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetRow: { sheet_number: 5 },
      });
      const onManifestDocumentsChanged = vi.fn();

      await sendManifestPhoto(supabase, db, entry, { onManifestDocumentsChanged });

      expect(onManifestDocumentsChanged).toHaveBeenCalledTimes(1);
      expect(onManifestDocumentsChanged).toHaveBeenCalledWith(entry);
    });

    it('does not call onManifestDocumentsChanged when the renumber query itself fails', async () => {
      const entry = photoEntry();
      const { supabase } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetError: { message: 'permission denied' },
      });
      const onManifestDocumentsChanged = vi.fn();

      await sendManifestPhoto(supabase, db, entry, { onManifestDocumentsChanged });

      expect(onManifestDocumentsChanged).not.toHaveBeenCalled();
    });

    it('B-1: renumbers starting at 1 when the manifest has no manifest_documents rows yet', async () => {
      const entry = photoEntry();
      const { supabase } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetRow: null,
      });
      const updateSpy = vi.spyOn(db.pickup_queue, 'update');

      await sendManifestPhoto(supabase, db, entry);

      expect(updateSpy).toHaveBeenCalledWith(entry.id, { payload: { sheetNumber: 1 } });
      updateSpy.mockRestore();
    });

    // Menor, ronda 4 de review del PR #712 — medido por el reviewer: con dos
    // fotos locales (una ya en la hoja 8) y el servidor en `MAX=7`,
    // renumerar SIN mirar la cola local proponía 8 de nuevo, chocando con la
    // otra entrada local (converge en la vuelta siguiente, pero cada choque
    // consume una unidad de `MAX_RETRY_ATTEMPTS`). El siguiente número libre
    // debe evitar TAMBIÉN lo que la cola local ya está usando.
    it('B-1: renumbering also avoids a sheetNumber another local queue entry already has', async () => {
      const entry = photoEntry();
      await db.pickup_queue.add({
        clientOperationId: 'local-sheet-8',
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 8 },
        blob: blobOfSize(10),
        status: 'pending',
        retryCount: 0,
        claimToken: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        createdAt: new Date().toISOString(),
      });
      const { supabase } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetRow: { sheet_number: 7 },
      });
      const updateSpy = vi.spyOn(db.pickup_queue, 'update');

      await sendManifestPhoto(supabase, db, entry);

      // Servidor propone 8 (MAX 7 + 1), pero 8 ya está tomado localmente —
      // salta a 9.
      expect(updateSpy).toHaveBeenCalledWith(entry.id, { payload: { sheetNumber: 9 } });
      updateSpy.mockRestore();
    });

    // Si la consulta que busca el siguiente número libre falla (sin red, sin
    // permiso…), no se renumera todavía — se reintenta más tarde con el
    // MISMO número; la próxima pasada repetirá el mismo 23505 y volverá a
    // intentar renumerar. Nunca `dead` por esto.
    it('B-1: retries with the same number (no db update) when the renumber query itself fails', async () => {
      const entry = photoEntry();
      const { supabase } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
        maxSheetError: { message: 'permission denied' },
      });
      const updateSpy = vi.spyOn(db.pickup_queue, 'update');

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(result.outcome).toBe('retry');
      expect(updateSpy).not.toHaveBeenCalled();
      updateSpy.mockRestore();
    });

    // Fallo de red DURANTE el insert (tras una subida que sí tuvo éxito): no
    // se sabe si el insert se aplicó o no — no se borra el objeto (mismo
    // path determinista, el próximo reintento lo reutiliza sin coste) y se
    // reporta `offline`, no `retry`, para no consumir presupuesto de
    // reintentos por una caída de señal (mismo contrato que
    // `classifyCloseManifestError`/costura 1 de fase 2).
    it('reports offline (not retry) and does not remove the object when the insert itself fails on a network error', async () => {
      const { supabase, remove } = storageStub({
        insertError: { code: '', message: 'TypeError: Failed to fetch' },
      });

      const result = await sendManifestPhoto(supabase, db, photoEntry());

      expect(result.outcome).toBe('offline');
      expect(remove).not.toHaveBeenCalled();
    });

    // B1, review del PR #712 (bloqueante) — un reintento NORMAL de esta cola
    // (el insert anterior SÍ se aplicó, sólo se perdió la respuesta) choca
    // con 23505; si la señal cae DE NUEVO justo entre ese 23505 y la SELECT
    // que verifica si la fila existente es la nuestra, `existing` era `null`
    // y el código anterior lo confundía con "no es la misma foto, hay que
    // limpiar" — borrando el objeto que la fila VIVA en `manifest_documents`
    // referencia. Evidencia legal apuntando a un objeto inexistente, y
    // `retryDead` no lo salva: revive, repite el mismo 23505, vuelve a
    // fallar la misma SELECT (sin señal), vuelve a morir. La SELECT que
    // falla por red no es evidencia de nada — se reporta `offline`, sin
    // tocar el bucket, igual que un fallo de red en el insert mismo.
    it('B1: does not remove the object when the 23505-verification SELECT itself fails on a network error', async () => {
      const entry = photoEntry();
      const { supabase, remove } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        selectError: { code: '', message: 'TypeError: Failed to fetch' },
      });

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(result.outcome).toBe('offline');
      expect(remove).not.toHaveBeenCalled();
    });

    // Residual de B1 — una SELECT que falla por una razón NO de red (RLS
    // mal configurada, lo que sea) tampoco es evidencia de colisión real;
    // valor por defecto seguro de esta cola para lo no reconocido: `retry`,
    // sin borrar nada, hasta que una SELECT que sí resuelva pueda decidir.
    it('does not remove the object when the 23505-verification SELECT fails for a non-network reason', async () => {
      const entry = photoEntry();
      const { supabase, remove } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        selectError: { code: '42501', message: 'permission denied' },
      });

      const result = await sendManifestPhoto(supabase, db, entry);

      expect(result.outcome).toBe('retry');
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
