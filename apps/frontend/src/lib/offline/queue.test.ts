/**
 * spec-81 fase 1 — Almacén y contrato de la cola offline de Recogida
 *
 * Lógica pura sobre IndexedDB (Dexie + fake-indexeddb, sin DOM real).
 * Ver docs/specs/spec-81-recogida-cola-offline.md.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RecogidaOfflineQueueDB } from "./db";
import { enqueue, listPending, markSent, markFailed, purgeConfirmed } from "./queue";

const OPERATOR_A = "operator-a";
const OPERATOR_B = "operator-b";
const MANIFEST_1 = "manifest-1";
const MANIFEST_2 = "manifest-2";

describe("recogida offline queue", () => {
  let db: RecogidaOfflineQueueDB;

  beforeEach(() => {
    db = new RecogidaOfflineQueueDB();
  });

  afterEach(async () => {
    await db.delete();
  });

  describe("enqueue", () => {
    it("assigns a client_operation_id (UUID v4) to every entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "ABC123" },
      });

      expect(entry.clientOperationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("assigns a different client_operation_id to each new entry", async () => {
      const first = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "ABC123" },
      });
      const second = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "DEF456" },
      });

      expect(first.clientOperationId).not.toBe(second.clientOperationId);
    });

    it("starts every entry as pending with zero retries", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "ABC123" },
      });

      expect(entry.status).toBe("pending");
      expect(entry.retryCount).toBe(0);
    });
  });

  describe("client_operation_id survives retry", () => {
    it("NEVER regenerates client_operation_id when an entry is retried after failure", async () => {
      const original = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });

      // Simulate three failed send attempts (e.g. lost network mid-retry).
      await markFailed(db, original.id!, "network error");
      await markFailed(db, original.id!, "network error");
      await markFailed(db, original.id!, "network error");

      const [refetched] = await listPending(db, OPERATOR_A);

      expect(refetched.clientOperationId).toBe(original.clientOperationId);
      expect(refetched.retryCount).toBe(3);
    });
  });

  describe("listPending", () => {
    it("returns entries in strict FIFO order within a manifest", async () => {
      const first = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const second = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-2" },
      });
      const closeManifest = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 2 },
      });

      const pending = await listPending(db, OPERATOR_A, MANIFEST_1);

      expect(pending.map((e) => e.clientOperationId)).toEqual([
        first.clientOperationId,
        second.clientOperationId,
        closeManifest.clientOperationId,
      ]);
    });

    it("only returns entries belonging to the requesting operator", async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-A" },
      });
      await enqueue(db, {
        operatorId: OPERATOR_B,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-B" },
      });

      const pendingForA = await listPending(db, OPERATOR_A);

      expect(pendingForA).toHaveLength(1);
      expect(pendingForA[0].operatorId).toBe(OPERATOR_A);
    });

    it("filters by manifest when a manifestId is given, without disturbing other manifests' order", async () => {
      const m1entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_2,
        type: "pickup_scan",
        payload: { barcode: "SCAN-2" },
      });

      const pendingForManifest1 = await listPending(db, OPERATOR_A, MANIFEST_1);

      expect(pendingForManifest1.map((e) => e.clientOperationId)).toEqual([
        m1entry.clientOperationId,
      ]);
    });

    it("does not return entries already marked sent", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      await markSent(db, entry.id!);

      const pending = await listPending(db, OPERATOR_A);

      expect(pending).toHaveLength(0);
    });
  });

  describe("markFailed", () => {
    it("increments retryCount and records the error without dropping the entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      await markFailed(db, entry.id!, "500 server error");

      const [refetched] = await listPending(db, OPERATOR_A);

      expect(refetched.retryCount).toBe(1);
      expect(refetched.lastError).toBe("500 server error");
      expect(refetched.status).toBe("pending");
    });
  });

  describe("purgeConfirmed", () => {
    it("deletes entries marked sent and leaves pending entries untouched", async () => {
      const sent = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const stillPending = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-2" },
      });
      await markSent(db, sent.id!);

      const purgedCount = await purgeConfirmed(db, OPERATOR_A);

      expect(purgedCount).toBe(1);
      const remaining = await db.queue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].clientOperationId).toBe(stillPending.clientOperationId);
    });

    it("only purges the requesting operator's confirmed entries", async () => {
      const entryA = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-A" },
      });
      const entryB = await enqueue(db, {
        operatorId: OPERATOR_B,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-B" },
      });
      await markSent(db, entryA.id!);
      await markSent(db, entryB.id!);

      await purgeConfirmed(db, OPERATOR_A);

      const remaining = await db.queue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].operatorId).toBe(OPERATOR_B);
    });
  });
});
