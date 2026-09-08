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

    it("H5 — does not do a full table scan (ronda 4 de review, N3)", async () => {
      // A full-table scan deserializes every row (including other operators'
      // and, from fase 5 on, each row's photo Blob) just to discard most of
      // them. `.where("operatorId")` already gives FIFO order for free — see
      // the docstring above — so nothing is gained by scanning.
      //
      // N3 (ronda 4 de review) — the previous version of this test asserted
      // `where` was called with "operatorId" specifically. A legitimate
      // future refactor to the compound index `[operatorId+status]` still
      // calls `.where(...)`, just with a different argument, so that
      // assertion would fail for the WRONG reason on the exact improvement
      // this test exists to allow. What actually distinguishes "indexed
      // lookup" from "table scan" is whether a full-collection method ran
      // at all — assert that negative instead.
      //
      // N3 (ronda 5 de review) — these three are not an enumeration of
      // "the ways someone might scan the table"; they are Dexie's own
      // bottleneck. A fourth path (`toArray()` + an in-memory filter) also
      // dies against this assertion, because Dexie implements
      // `Table.toArray()` as `this.toCollection().toArray()` — so
      // `toCollectionSpy` catches it too, without a fourth spy.
      const filterSpy = vi.spyOn(db.pickup_queue, "filter");
      const toCollectionSpy = vi.spyOn(db.pickup_queue, "toCollection");
      const orderBySpy = vi.spyOn(db.pickup_queue, "orderBy");

      await listPending(db, OPERATOR_A);

      expect(filterSpy).not.toHaveBeenCalled();
      expect(toCollectionSpy).not.toHaveBeenCalled();
      expect(orderBySpy).not.toHaveBeenCalled();

      filterSpy.mockRestore();
      toCollectionSpy.mockRestore();
      orderBySpy.mockRestore();
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
    it("transitions a pending entry to sending and returns the ownership token it stamped (M1)", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      const claimed = await claimPending(db, entry.id!);

      expect(claimed).not.toBeNull();
      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");
      // The returned value IS the claimToken it stamped (fase 2 — a
      // crypto.randomUUID() nonce, not the lastAttemptAt timestamp) — what
      // markFailed/markSent/markDead compare against later to tell "my
      // reclamation" from "someone else's" (M1, ronda 4; nonce, fase 2).
      expect(claimed).toBe(stored?.claimToken);
      expect(stored?.lastAttemptAt).not.toBeNull();
    });

    it("fase 2 — two claims of the same entry within the same millisecond get different tokens (nonce, not a timestamp)", async () => {
      // Verified bug (spec-81 fase 2 checklist): before this fix, claim →
      // markFailed(t) → claim → markFailed(t) left retryCount 2 and
      // `pending` — the second claim, landing in the same millisecond,
      // stamped the SAME token as the first, so a stale token reused by
      // mistake still matched. crypto.randomUUID() makes that impossible.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      const token1 = await claimPending(db, entry.id!);
      await markFailed(db, entry.id!, "network error", token1!);
      // Time never advances — this is the common case offline: fetch
      // rejects almost instantly.
      const token2 = await claimPending(db, entry.id!);

      expect(token2).not.toBeNull();
      expect(token2).not.toBe(token1);

      // A caller that (by mistake) reuses the first, now-stale token must
      // be a complete no-op against the entry's real, current claim.
      await markFailed(db, entry.id!, "reused stale token", token1!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");
      expect(stored?.retryCount).toBe(1);
      expect(stored?.claimToken).toBe(token2);

      vi.useRealTimers();
    });

    it("returns null when the entry was not pending", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await claimPending(db, entry.id!);

      const secondAttempt = await claimPending(db, entry.id!);

      expect(secondAttempt).toBeNull();
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

      const reclaimedCount = await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

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

      const reclaimedCount = await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

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
      // N5 — the promise this title makes ("does not touch dead entries")
      // was never exercised: no `dead` entry existed in this test. Now one
      // does, so a regression that let reclaimStale touch `dead` would
      // actually fail here.
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 1 },
      });
      await markDead(db, dead.id!, "MANIFEST_NOT_CLOSABLE");

      vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));

      const reclaimedCount = await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

      expect(reclaimedCount).toBe(0);
      expect((await db.pickup_queue.get(pending.id!))?.status).toBe("pending");
      expect((await db.pickup_queue.get(sent.id!))?.status).toBe("sent");
      expect((await db.pickup_queue.get(dead.id!))?.status).toBe("dead");

      vi.useRealTimers();
    });

    // M2 (ronda 4 de review) — reclaimStale operaba sobre todo el
    // dispositivo, sin `operatorId`, mientras que listPending y
    // purgeConfirmed sí lo llevan. Sin llamador todavía no hay fuga real,
    // pero es una ESCRITURA, y el spec insiste en que el no-negociable de
    // operator_id no admite excepción "porque es sólo un badge" — eso vale
    // para lecturas, no para esto.
    it("M2 — only reclaims the requesting operator's stale entries, not another operator's", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

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
      await claimPending(db, entryA.id!);
      await claimPending(db, entryB.id!);

      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));

      const reclaimedCount = await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

      expect(reclaimedCount).toBe(1);
      expect((await db.pickup_queue.get(entryA.id!))?.status).toBe("pending");
      expect((await db.pickup_queue.get(entryB.id!))?.status).toBe("sending");

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
      // Fase 2 residual — H3 protected `status`, not the rest of the row.
      // A no-token markFailed on a dead entry used to conserve `status` but
      // still overwrite `lastError`, wiping the only record of *why* that
      // scan was discarded, and `retryCount`, which the operator never
      // needed to know about again.
      expect(stored?.lastError).toBe("MANIFEST_NOT_CLOSABLE");
      expect(stored?.retryCount).toBe(0);
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
      // Same residual as above, the `sent` side: no genuine retry count for
      // a confirmed operation.
      expect(stored?.retryCount).toBe(0);
      expect(stored?.lastError).toBeUndefined();
    });

    // M1 (ronda 4 de review) — claimPending devolvía sólo un boolean, así
    // que markFailed/markSent no podían distinguir "mi reclamación" de "la
    // de otro drenador" — sólo miraban el status, y `sending` es el mismo
    // valor para cualquiera que lo tenga. Ahora claimPending devuelve el
    // `lastAttemptAt` que estampó como token de propiedad, y markFailed lo
    // compara antes de tocar nada.
    it("M1 — a stale claimant's markFailed does not release a live claimant's reclamation", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      // Drainer 1 claims. Its request hangs.
      const staleToken = await claimPending(db, entry.id!);
      expect(staleToken).not.toBeNull();

      // 10 minutes pass; reclaimStale frees it for a second drainer.
      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));
      await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

      // Drainer 2 claims the now-pending entry; its request is genuinely
      // in flight.
      const liveToken = await claimPending(db, entry.id!);
      expect(liveToken).not.toBeNull();
      expect(liveToken).not.toBe(staleToken);

      // Drainer 1's zombie request finally times out and reports failure,
      // still carrying its now-stale token.
      await markFailed(db, entry.id!, "network timeout", staleToken!);

      const stored = await db.pickup_queue.get(entry.id!);
      // Must still be drainer 2's claim, untouched — not bounced back to
      // pending, which would let a third send happen on top of drainer 2's
      // in-flight one.
      expect(stored?.status).toBe("sending");
      expect(stored?.claimToken).toBe(liveToken);

      vi.useRealTimers();
    });

    it("M1 — a matching token still releases the claim as before", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const token = await claimPending(db, entry.id!);

      await markFailed(db, entry.id!, "network error", token!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("pending");
    });

    // m3 (ronda 5 de review) — el token no era de un solo uso: markFailed no
    // lo invalidaba, así que un replay de la misma respuesta de red (mismo
    // token, mismo ms — el caso común: `fetch` sin señal rechaza casi al
    // instante) volvía a pasar el guard y quemaba presupuesto de reintentos
    // dos veces por un único fallo real.
    it("m3 — a replayed token does not increment retryCount twice", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const token = await claimPending(db, entry.id!);

      await markFailed(db, entry.id!, "network error", token!);
      // Replay of the same failure report, still carrying the same token —
      // by now the entry is back to `pending`, not `sending`.
      await markFailed(db, entry.id!, "network error", token!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.retryCount).toBe(1);

      vi.useRealTimers();
    });

    it("fase 2 — persists nextAttemptAt when the drainer computes a backoff", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      await markFailed(db, entry.id!, "500 server error", undefined, "2026-09-07T09:05:00.000Z");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.nextAttemptAt).toBe("2026-09-07T09:05:00.000Z");
    });
  });

  describe("markSent (M1 — a stale claim cannot confirm a live one's in-flight send)", () => {
    it("does not mark sent when the caller's token no longer matches the current claim", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const staleToken = await claimPending(db, entry.id!);

      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));
      await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);
      const liveToken = await claimPending(db, entry.id!);

      // The zombie request's late 200 arrives, still carrying the stale
      // token — it must not confirm an entry whose real send is still in
      // flight under a different claim.
      await markSent(db, entry.id!, staleToken!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");
      expect(stored?.claimToken).toBe(liveToken);

      vi.useRealTimers();
    });

    it("marks sent when the caller's token matches the current claim", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const token = await claimPending(db, entry.id!);

      await markSent(db, entry.id!, token!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sent");
    });

    it("still marks sent with no token given, for backward compatibility with the untracked path", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });

      await markSent(db, entry.id!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sent");
    });

    // m4 (ronda 5 de review) — markSent devolvía void tanto si confirmó como
    // si el token había caducado, así que un drenador no podía saber si su
    // 200 se registró antes de llamar purgeConfirmed. Devuelve el count real
    // de `.modify()`.
    it("m4 — returns 1 when it actually confirmed the entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const token = await claimPending(db, entry.id!);

      const result = await markSent(db, entry.id!, token!);

      expect(result).toBe(1);
    });

    it("m4 — returns 0 when the token no longer matches (nothing confirmed)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const staleToken = await claimPending(db, entry.id!);

      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));
      await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);
      await claimPending(db, entry.id!);

      const result = await markSent(db, entry.id!, staleToken!);

      expect(result).toBe(0);

      vi.useRealTimers();
    });

    // m5 (ronda 5 de review) — asimetría inversa a H3, sin test hasta ahora:
    // markSent no tenía guard contra resucitar una entrada ya `dead`. Un 200
    // tardío que llega después de que la entrada ya se dio por irrecuperable
    // no puede marcarla enviada — reabriría algo que ya se decidió muerto.
    it("m5 — never marks sent an already dead-lettered entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE");

      const result = await markSent(db, entry.id!);

      expect(result).toBe(0);
      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("dead");
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

    // Fase 2 — unifica el contrato: los tres escritores terminales
    // (markSent, markFailed, markDead) devuelven ahora el `count` real de
    // `.modify()`, no sólo markSent (m4, ronda 5). Un `count === 0` en
    // markDead significa "tu reclamación fue robada" — información que el
    // drenador necesita para no seguir tratando el envío como en curso.
    it("fase 2 — returns the real modify() count (1 confirmed, 0 when the claim was stolen)", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      const token = await claimPending(db, entry.id!);

      const confirmed = await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE", token!);
      expect(confirmed).toBe(1);

      const other = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "pickup_scan",
        payload: { barcode: "SCAN-1" },
      });
      const staleToken = await claimPending(db, other.id!);
      await reclaimStale(db, OPERATOR_A, 0);
      await claimPending(db, other.id!);

      const stolen = await markDead(db, other.id!, "late rejection", staleToken!);
      expect(stolen).toBe(0);
    });

    // B1 (ronda 5 de review) — markDead era el único de los tres escritores
    // terminales (markSent, markFailed, markDead) sin guard de token. Mismo
    // escenario que el M1 de markFailed/markSent, con el tercer escritor:
    // drenador A reclama, se cuelga; reclaimStale lo libera; drenador B
    // reclama y está enviando de verdad; el 422 tardío de A llega y no puede
    // matar la reclamación viva de B.
    it("a stale claimant's markDead does not kill a live claimant's reclamation", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-07T09:00:00.000Z"));

      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      const staleToken = await claimPending(db, entry.id!);
      expect(staleToken).not.toBeNull();

      vi.setSystemTime(new Date("2026-09-07T09:10:00.000Z"));
      await reclaimStale(db, OPERATOR_A, 5 * 60 * 1000);

      const liveToken = await claimPending(db, entry.id!);
      expect(liveToken).not.toBeNull();
      expect(liveToken).not.toBe(staleToken);

      await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE", staleToken!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sending");
      expect(stored?.claimToken).toBe(liveToken);

      vi.useRealTimers();
    });

    it("a matching token still marks the entry dead as before", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      const token = await claimPending(db, entry.id!);

      await markDead(db, entry.id!, "MANIFEST_NOT_CLOSABLE", token!);

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("dead");
    });

    // m5 (ronda 5 de review) — asimetría inversa a H3, sin test hasta ahora:
    // markDead no tenía guard contra sobrescribir una entrada ya `sent`. Un
    // rechazo de negocio tardío que llega después de que el envío real ya se
    // confirmó no puede convertir ese éxito en un fallo permanente.
    it("m5 — never dead-letters an already-confirmed (sent) entry", async () => {
      const entry = await enqueue(db, {
        operatorId: OPERATOR_A,
        manifestId: MANIFEST_1,
        type: "close_manifest",
        payload: { manifestId: MANIFEST_1, count: 42 },
      });
      await markSent(db, entry.id!);

      await markDead(db, entry.id!, "late rejection after confirmation");

      const stored = await db.pickup_queue.get(entry.id!);
      expect(stored?.status).toBe("sent");
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
