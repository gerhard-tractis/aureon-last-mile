/**
 * spec-81 fase 2, ronda 4 de review del PR #679 — costura 2.
 *
 * `manifestIsBlocked` es el único predicado que decide si un manifiesto
 * puede avanzar: unifica lo que antes eran dos guardas independientes
 * (`manifestHasDeadEntry` en `queue.ts`, `manifestBlockedForUser` — que
 * vivía dentro de `useOfflineQueue.ts`, sin test propio). El bug medido por
 * el reviewer (E1: ~45 pasadas/s, 0 envíos) era exactamente que
 * `drainManifest` usaba las dos guardas juntas pero `drain()` sólo usaba la
 * primera para filtrar `remaining` antes de programar el próximo reintento
 * — dos fuentes de verdad que podían divergir. Con un único predicado
 * consumido en ambos sitios, esa clase de bug no puede volver por un tercer
 * flanco.
 *
 * También cubre la decisión del usuario, 2026-09-08, ronda 4: el bloqueo
 * cross-user deja de ser permanente — una entrada `pending` ajena que lleva
 * más de `CROSS_USER_RECLAIM_MS` sin que su dueño la mueva deja de bloquear;
 * cualquier sesión de este operador puede reclamarla y drenarla.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../db';
import { enqueue } from './queue';
import {
  CROSS_USER_RECLAIM_MS,
  manifestBlockedForUser,
  manifestIsBlocked,
  manifestHead,
  manifestRetryEta,
} from './queue-blocking';

const RECLAIM_STALE_MS = 90_000;

const OPERATOR_A = 'operator-a';
const USER_A = 'user-a';
const USER_B = 'user-b';
const MANIFEST_1 = 'manifest-1';

describe('queue-blocking', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
  });

  describe('manifestBlockedForUser', () => {
    it('is false when there is no pending entry at all', async () => {
      expect(await manifestBlockedForUser(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(false);
    });

    it('is false when the FIFO head belongs to this same user', async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      expect(await manifestBlockedForUser(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(false);
    });

    it('is true when a fresh pending entry from another user is the FIFO head', async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      expect(await manifestBlockedForUser(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(true);
    });

    // Decisión del usuario, ronda 4 — el bloqueo cross-user deja de ser
    // permanente: pasado CROSS_USER_RECLAIM_MS desde que se encoló (y nunca
    // se tocó desde entonces), cualquiera puede reclamarla.
    it('stops blocking once the other user\'s entry is older than CROSS_USER_RECLAIM_MS', async () => {
      const stale = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      await db.pickup_queue.update(stale.id!, {
        createdAt: new Date(Date.now() - CROSS_USER_RECLAIM_MS - 1_000).toISOString(),
      });
      expect(await manifestBlockedForUser(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(false);
    });

    it('a sending entry from another user blocks regardless of age — reclaimStale, not this timer, resolves it', async () => {
      const inFlight = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      await db.pickup_queue.update(inFlight.id!, {
        status: 'sending',
        claimToken: 'some-token',
        lastAttemptAt: new Date(Date.now() - CROSS_USER_RECLAIM_MS - 1_000).toISOString(),
      });
      expect(await manifestBlockedForUser(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(true);
    });
  });

  describe('manifestHead', () => {
    it('returns the earliest pending-or-sending entry regardless of owner', async () => {
      const first = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      const head = await manifestHead(db, OPERATOR_A, MANIFEST_1);
      expect(head?.id).toBe(first.id);
    });
  });

  describe('manifestIsBlocked', () => {
    it('is true when the manifest has a dead entry, regardless of owner', async () => {
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      await db.pickup_queue.update(dead.id!, { status: 'dead' });
      expect(await manifestIsBlocked(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(true);
    });

    // B-1, ronda 3 de review del PR #712 (spec-81 fase 5), decisión del
    // usuario — una foto es respaldo, no conteo; su pérdida no falsea la
    // cifra que el cliente firma en `close_manifest`. A diferencia de
    // `pickup_scan` (arriba), una entrada `manifest_photo` muerta NO
    // envenena el manifiesto.
    it('is false when the only dead entry is a manifest_photo — a lost photo does not block close_manifest', async () => {
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
      });
      await db.pickup_queue.update(dead.id!, { status: 'dead' });
      expect(await manifestIsBlocked(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(false);
    });

    it('is true when a fresh cross-user pending entry is the head', async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      expect(await manifestIsBlocked(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(true);
    });

    it('is false once neither guard applies', async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      expect(await manifestIsBlocked(db, OPERATOR_A, MANIFEST_1, USER_A)).toBe(false);
    });
  });

  // Residual de la ronda 5 de review del PR #679 — "¿quién vuelve?" tras
  // costura 3. `drainManifest` sale correctamente cuando la cabeza no es
  // reclamable, pero `soonest` (`useOfflineQueue.ts`) nunca veía ninguno de
  // los dos plazos reales de recuperación (`RECLAIM_STALE_MS`,
  // `CROSS_USER_RECLAIM_MS`) — sólo miraba `nextAttemptAt` de entradas
  // `pending` no bloqueadas. `manifestRetryEta` es la pieza que le da a
  // `drain()` el instante correcto para programar el siguiente intento en
  // los dos casos que antes no tenían ninguno.
  describe('manifestRetryEta', () => {
    it('returns null when nothing is pending or sending in the manifest', async () => {
      expect(
        await manifestRetryEta(db, OPERATOR_A, MANIFEST_1, USER_A, RECLAIM_STALE_MS),
      ).toBeNull();
    });

    it('returns null when the manifest is permanently blocked by a dead entry — no timer can help', async () => {
      const dead = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      await db.pickup_queue.update(dead.id!, { status: 'dead' });

      expect(
        await manifestRetryEta(db, OPERATOR_A, MANIFEST_1, USER_A, RECLAIM_STALE_MS),
      ).toBeNull();
    });

    it('returns null when the head is directly actionable by this session (own pending)', async () => {
      await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });

      expect(
        await manifestRetryEta(db, OPERATOR_A, MANIFEST_1, USER_A, RECLAIM_STALE_MS),
      ).toBeNull();
    });

    // S1 — la cabeza es una `sending` PROPIA huérfana: el único plazo real
    // es `reclaimStaleMs` desde su último toque.
    it('S1 — returns lastAttemptAt + reclaimStaleMs when the head is an orphaned sending row (own or not)', async () => {
      const stuck = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_A,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      const lastAttemptAt = new Date('2026-09-08T10:00:00.000Z');
      await db.pickup_queue.update(stuck.id!, {
        status: 'sending',
        claimToken: 'orphan',
        lastAttemptAt: lastAttemptAt.toISOString(),
      });

      const eta = await manifestRetryEta(db, OPERATOR_A, MANIFEST_1, USER_A, RECLAIM_STALE_MS);

      expect(eta).toBe(lastAttemptAt.getTime() + RECLAIM_STALE_MS);
    });

    // S2 — la cabeza es una `pending` fresca de OTRO usuario: el único
    // plazo real es `CROSS_USER_RECLAIM_MS` desde su último toque.
    it('S2 — returns lastTouchedAt + CROSS_USER_RECLAIM_MS when the head is a fresh cross-user pending entry', async () => {
      const otherUsers = await enqueue(db, {
        operatorId: OPERATOR_A,
        userId: USER_B,
        manifestId: MANIFEST_1,
        type: 'pickup_scan',
        payload: {},
      });
      const createdAt = new Date('2026-09-08T10:00:00.000Z');
      await db.pickup_queue.update(otherUsers.id!, { createdAt: createdAt.toISOString() });

      const eta = await manifestRetryEta(db, OPERATOR_A, MANIFEST_1, USER_A, RECLAIM_STALE_MS);

      expect(eta).toBe(createdAt.getTime() + CROSS_USER_RECLAIM_MS);
    });
  });
});
