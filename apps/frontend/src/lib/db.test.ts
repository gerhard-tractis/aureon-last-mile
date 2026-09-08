/**
 * spec-81 fase 2, ronda 4 de review del PR #679 (M-2) — "mientras esté
 * bloqueada, esa entrada cuenta como bloqueada, no como en cola". Antes de
 * esta ronda, `getPendingPickupCount` contaba TODO `pending`/`sending` sin
 * mirar si el manifiesto podía avanzar de verdad: una entrada atascada
 * detrás del `pending` fresco de otro usuario (`manifestBlockedForUser`, M3)
 * se mostraba en el badge verde "COLA N" — la misma mentira que B3 corrigió
 * para `dead` en la ronda 2, reintroducida por otra vía. `getBlockedPickupCount`
 * sólo contaba `dead`, así que el badge "N REQUIERE AYUDA" nunca se
 * encendía para este caso.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, getPendingPickupCount, getBlockedPickupCount } from './db';
import { enqueue } from './offline/queue';

const OPERATOR_A = 'operator-a';
const USER_A = 'user-a';
const USER_B = 'user-b';
const MANIFEST_1 = 'manifest-1';
const MANIFEST_2 = 'manifest-2';

describe('getPendingPickupCount / getBlockedPickupCount', () => {
  beforeEach(async () => {
    await db.pickup_queue.clear();
  });

  afterEach(async () => {
    await db.pickup_queue.clear();
  });

  it('counts an ordinary pending entry as pending, not blocked', async () => {
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });

    expect(await getPendingPickupCount(OPERATOR_A)).toBe(1);
    expect(await getBlockedPickupCount(OPERATOR_A)).toBe(0);
  });

  it('still counts dead entries as blocked, not pending', async () => {
    const entry = await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await db.pickup_queue.update(entry.id!, { status: 'dead' });

    expect(await getPendingPickupCount(OPERATOR_A)).toBe(0);
    expect(await getBlockedPickupCount(OPERATOR_A)).toBe(1);
  });

  // M-2 — el caso nuevo de esta ronda: una entrada `pending` cuyo manifiesto
  // está bloqueado por la entrada `pending` fresca de OTRO usuario por
  // delante en el FIFO cuenta como bloqueada, no como en cola.
  it('counts a pending entry behind a fresh cross-user pending head as blocked, not queued', async () => {
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_B,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });

    // Both entries are pending, but the manifest can't advance for either
    // owner right now: USER_B's own entry IS the (unblocked, for itself)
    // head; USER_A's entry is blocked behind it.
    expect(await getPendingPickupCount(OPERATOR_A)).toBe(1);
    expect(await getBlockedPickupCount(OPERATOR_A)).toBe(1);
  });

  it('does not let one blocked manifest affect the count of an unrelated one', async () => {
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_B,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_1,
      type: 'pickup_scan',
      payload: {},
    });
    await enqueue(db, {
      operatorId: OPERATOR_A,
      userId: USER_A,
      manifestId: MANIFEST_2,
      type: 'pickup_scan',
      payload: {},
    });

    expect(await getPendingPickupCount(OPERATOR_A)).toBe(2);
    expect(await getBlockedPickupCount(OPERATOR_A)).toBe(1);
  });
});
