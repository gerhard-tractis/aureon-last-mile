/**
 * spec-81 fase 1 — Almacén y contrato de la cola offline de Recogida
 *
 * Lógica pura sobre IndexedDB (Dexie + fake-indexeddb, sin DOM real).
 * Ver docs/specs/spec-81-recogida-cola-offline.md.
 *
 * Ronda 1 de review: la cola vive en `AureonOfflineDB` (`@/lib/db`), la
 * misma base que ya usa `useSyncQueue` — no una base separada (B1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db";
import {
  enqueue,
  listPending,
  markSent,
  markFailed,
  purgeConfirmed,
  claimPending,
  markDead,
  reclaimStale,
} from "./queue";

const OPERATOR_A = "operator-a";
const OPERATOR_B = "operator-b";
const MANIFEST_1 = "manifest-1";
const MANIFEST_2 = "manifest-2";

describe("recogida offline queue", () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
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
      expect(entry.lastAttemptAt).toBeNull();
      expect(entry.nextAttemptAt).toBeNull();
    });

    it("persists the payload's blob (B6 — a mutant dropping it must fail)", async () => {
      // fake-indexeddb's structured-clone polyfill does not round-trip a
      // real Blob's identity (it comes back as `{}`), so asserting on a
      // re-read would test the polyfill, not our code. Assert on the write
      // itself: the object hitting `db.pickup_queue.add` must carry `blob`.
      const addSpy = vi.spyOn(db.pickup_queue, "add");
      const blob = new Blob(["fake photo bytes"], { type: "image/jpeg" });

      await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "ABC123" },
        blob,
      });

      expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ blob }));
      addSpy.mockRestore();
    });

    it("stamps createdAt with the real current time (B6 — a fixed-value mutant must fail)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T12:34:56.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "ABC123" },
      });

      expect(entry.createdAt).toBe("2026-09-07T12:34:56.000Z");

      vi.useRealTimers();
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

    it("H5 — queries the operatorId index instead of scanning the whole table", async () => {
      // A full-table scan deserializes every row (including other operators'
      // and, from fase 5 on, each row's photo Blob) just to discard most of
      // them. `.where("operatorId")` already gives FIFO order for free — see
      // the docstring above — so nothing is gained by scanning.
      const whereSpy = vi.spyOn(db.pickup_queue, "where");

      await listPending(db, OPERATOR_A);

      expect(whereSpy).toHaveBeenCalledWith("operatorId");
      whereSpy.mockRestore();
    });

    it("does not return entries claimed in-flight (sending) or dead-lettered", async () => {
      const sending = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-2" },
      });

      await claimPending(db, sending.id!);
      await markDead(db, dead.id!, "MANIFEST_NOT_CLOSABLE");

      const pending = await listPending(db, OPERATOR_A);

      expect(pending).toHaveLength(0);
    });
  });

  describe("claimPending (B3 — in-flight guard)", () => {
    it("transitions a pending entry to sending and returns true", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      const claimed = await claimPending(db, entry.id!);

      expect(claimed).toBe(true);
      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");
    });

    it("refuses a second concurrent claim of the same entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      const [firstClaim, secondClaim] = await Promise.all([
        claimPending(db, entry.id!),
        claimPending(db, entry.id!),
      ]);

      // Exactly one of the two concurrent claims may win — never both, and
      // never neither (Dexie's `.modify()` serialises this in one txn).
      expect([firstClaim, secondClaim].filter(Boolean)).toHaveLength(1);
    });

    it("stamps lastAttemptAt so a stale claim can be detected later (N2)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await claimPending(db, entry.id!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.lastAttemptAt).toBe("2026-09-07T09:00:00.000Z");

      vi.useRealTimers();
    });
  });

  describe("reclaimStale (H1 — sending is not a dead end)", () => {
    it("returns a sending entry whose lastAttemptAt is older than the threshold back to pending", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await claimPending(db, entry.id!);

      // The tab that claimed it died right there — never called markSent or
      // markFailed. 10 minutes pass before anyone looks again.
      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));

      const reclaimedCount = await reclaimStale(db, 5 * 60 * 1000);

      expect(reclaimedCount).toBe(1);
      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("pending");

      vi.useRealTimers();
    });

    it("leaves a sending entry alone when its lastAttemptAt is still within the threshold", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await claimPending(db, entry.id!);

      vi.setSystemTime(new Date("2026-09-07T09:01:00.000Z"));

      const reclaimedCount = await reclaimStale(db, 5 * 60 * 1000);

      expect(reclaimedCount).toBe(0);
      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");

      vi.useRealTimers();
    });

    it("does not touch pending, sent or dead entries", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const pending = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const sent = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-2" },
      });
      await markSent(db, sent.id!);

      vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));

      const reclaimedCount = await reclaimStale(db, 5 * 60 * 1000);

      expect(reclaimedCount).toBe(0);
      expect((await db.pickup_queue.get(pending.id!))?.status).toBe("pending");
      expect((await db.pickup_queue.get(sent.id!))?.status).toBe("sent");

      vi.useRealTimers();
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

    it("stamps lastAttemptAt so a reload can rebuild backoff instead of retrying everything at once", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T08:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await markFailed(db, entry.id!, "network error");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.lastAttemptAt).toBe("2026-09-07T08:00:00.000Z");

      vi.useRealTimers();
    });

    it("releases an in-flight (sending) claim back to pending on failure", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await claimPending(db, entry.id!);

      await markFailed(db, entry.id!, "network error");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("pending");
    });

    it("B2 — never loses an increment under two concurrent failures on the same entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      // Both drain passes read the stale entry and race to write — this is
      // exactly what happens when the `online` event and the mount-time
      // drain both fire coming out of a tunnel (spec-81, ronda 1, B2).
      await Promise.all([
        markFailed(db, entry.id!, "network error A"),
        markFailed(db, entry.id!, "network error B"),
      ]);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.retryCount).toBe(2);
    });

    it("H3 — never resurrects a dead-lettered entry back to pending", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE");

      await markFailed(db, entry.id!, "late retry after dead-lettering");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("dead");
    });

    it("H3 — never resurrects an already-confirmed (sent) entry back to pending", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await markSent(db, entry.id!);

      // A late 500 arriving after a local timeout already marked this sent.
      await markFailed(db, entry.id!, "late 500 after local timeout");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sent");
    });
  });

  describe("markDead (B3 — terminal state, no lying and no silent loss)", () => {
    it("moves an entry out of listPending without deleting it or marking it sent", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });

      await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored).toBeDefined();
      expect(stored?.status).toBe("dead");
      expect(stored?.lastError).toBe("MANIFEST_NOT_CLOSABLE");

      const pending = await listPending(db, OPERATOR_A);
      expect(pending).toHaveLength(0);
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
      const remaining = await db.pickup_queue.toArray();
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

      const remaining = await db.pickup_queue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].operatorId).toBe(OPERATOR_B);
    });

    it("H4 — never deletes a dead-lettered entry (silent loss is the spec's risk nº1)", async () => {
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      await markDead(db, dead.id!, "MANIFEST_NOT_CLOSABLE");

      const purgedCount = await purgeConfirmed(db, OPERATOR_A);

      expect(purgedCount).toBe(0);
      const stored = await db.pickup_queue.get(dead.id!);
      expect(stored).toBeDefined();
      expect(stored?.status).toBe("dead");
    });
  });
});
