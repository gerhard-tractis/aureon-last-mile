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
} from './photos';
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

    function storageStub({
      uploadError = null as { name?: string; message: string } | null,
      insertError = null as { code?: string; message: string } | null,
      existingRow = null as { storage_path: string } | null,
    } = {}) {
      const upload = vi.fn(async () => (uploadError ? { data: null, error: uploadError } : { data: { path: 'x' }, error: null }));
      const remove = vi.fn(async () => ({ data: [], error: null }));
      const insert = vi.fn(async () => (insertError ? { data: null, error: insertError } : { data: [{}], error: null }));
      const maybeSingle = vi.fn(async () => ({ data: existingRow, error: null }));
      const selectChain = {
        eq: vi.fn(() => selectChain),
        is: vi.fn(() => selectChain),
        maybeSingle,
      };
      const select = vi.fn(() => selectChain);

      const supabase = {
        storage: {
          from: vi.fn(() => ({ upload, remove })),
        },
        from: vi.fn(() => ({ insert, select })),
      };

      return { supabase: supabase as unknown as Parameters<typeof sendManifestPhoto>[0], upload, remove, insert, select, maybeSingle };
    }

    it('reports dead without any network call when the entry carries no blob', async () => {
      const { supabase, upload, insert } = storageStub();

      const result = await sendManifestPhoto(supabase, photoEntry({ blob: undefined }));

      expect(result.outcome).toBe('dead');
      expect(upload).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('uploads to the deterministic path, inserts the row, and reports sent on the happy path', async () => {
      const { supabase, upload, insert } = storageStub();
      const entry = photoEntry();

      const result = await sendManifestPhoto(supabase, entry);

      expect(upload).toHaveBeenCalledWith(
        manifestPhotoStoragePath(entry),
        entry.blob,
        expect.objectContaining({ upsert: true }),
      );
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          operator_id: OPERATOR_A,
          manifest_id: MANIFEST_1,
          storage_path: manifestPhotoStoragePath(entry),
          sheet_number: 3,
          uploaded_by: USER_A,
        }),
      );
      expect(result).toEqual({ outcome: 'sent' });
    });

    it('reports offline when the upload fails on a network error, and never attempts the insert', async () => {
      const { supabase, insert } = storageStub({
        uploadError: { name: 'StorageUnknownError', message: 'Failed to fetch' },
      });

      const result = await sendManifestPhoto(supabase, photoEntry());

      expect(result.outcome).toBe('offline');
      expect(insert).not.toHaveBeenCalled();
    });

    it('reports retry when the upload fails on a non-network storage error', async () => {
      const { supabase } = storageStub({
        uploadError: { name: 'StorageApiError', message: 'The resource already exists' },
      });

      const result = await sendManifestPhoto(supabase, photoEntry());

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

      const result = await sendManifestPhoto(supabase, entry);

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

      const result = await sendManifestPhoto(supabase, entry);

      expect(result).toEqual({ outcome: 'sent' });
      expect(remove).not.toHaveBeenCalled();
    });

    // Colisión real: otra foto ya ocupa este sheet_number (una carrera entre
    // dos capturas). Reintentar nunca va a resolver un número ya ocupado por
    // OTRO objeto — se limpia lo que acabamos de subir (huérfano evitable) y
    // se da por muerta, con la misma afordancia humana que cualquier otro
    // `dead` de esta cola.
    it('reports dead and removes the uploaded object when a 23505 on insert is a genuine sheet_number collision', async () => {
      const entry = photoEntry();
      const { supabase, remove } = storageStub({
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
        existingRow: { storage_path: 'someone-else/other-manifest/sheet-3-different-client-op.jpg' },
      });

      const result = await sendManifestPhoto(supabase, entry);

      expect(result.outcome).toBe('dead');
      expect(remove).toHaveBeenCalledWith([manifestPhotoStoragePath(entry)]);
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

      const result = await sendManifestPhoto(supabase, photoEntry());

      expect(result.outcome).toBe('offline');
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
