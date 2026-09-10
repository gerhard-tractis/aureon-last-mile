/**
 * spec-82 fase 2, revisión (menor) — "escribe el test del upgrade con
 * datos v2 poblados. El revisor lo escribió para verificarlo y lo borró;
 * debería quedar en el repo."
 *
 * `db.pickup-queue.test.ts` sólo prueba que el esquema DECLARA las tablas
 * (`toBeDefined()`), lo que pasaría igual con un upgrade que borrara todas
 * las filas. Este archivo prueba lo que de verdad importa: una base v2 con
 * datos reales sobrevive intacta al `version(3)` que sumó `manifest_cache`
 * (spec-82 fase 2) — Dexie declara un DELTA de esquema por versión, así
 * que las tablas no nombradas en `version(3).stores({...})` deben
 * conservarse tal cual.
 *
 * Nombre de base único (no `aureon_offline`) para no interferir con el
 * singleton real que usan el resto de los tests de este mismo proceso.
 */
import { describe, it, expect } from 'vitest';
import Dexie, { type EntityTable } from 'dexie';
import type { ScanQueue, PickupQueueEntry } from './db';

const TEST_DB_NAME = 'aureon_offline_schema_upgrade_test';

class V2Only extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;
  pickup_queue!: EntityTable<PickupQueueEntry, 'id'>;

  constructor() {
    super(TEST_DB_NAME);
    // Mismas definiciones que db.ts versiones 1 y 2, palabra por palabra —
    // si alguna vez divergen, este test deja de ser representativo, así
    // que cualquier cambio a esos `stores({...})` en db.ts tiene que
    // reflejarse aquí también.
    this.version(1).stores({
      scan_queue:
        '++id, manifest_id, operator_id, synced, [manifest_id+synced], scanned_at',
    });
    this.version(2).stores({
      pickup_queue: '++id, clientOperationId, operatorId, manifestId, status',
    });
  }
}

class V3WithManifestCache extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;
  pickup_queue!: EntityTable<PickupQueueEntry, 'id'>;

  constructor() {
    super(TEST_DB_NAME);
    this.version(1).stores({
      scan_queue:
        '++id, manifest_id, operator_id, synced, [manifest_id+synced], scanned_at',
    });
    this.version(2).stores({
      pickup_queue: '++id, clientOperationId, operatorId, manifestId, status',
    });
    this.version(3).stores({
      manifest_cache:
        '++id, operatorId, externalLoadId, [operatorId+externalLoadId]',
    });
  }
}

describe('schema upgrade v2 -> v3 (manifest_cache, spec-82 fase 2)', () => {
  it('preserves populated scan_queue and pickup_queue rows, payload intact', async () => {
    await Dexie.delete(TEST_DB_NAME);

    const v2 = new V2Only();
    await v2.scan_queue.add({
      manifest_id: 'manifest-1',
      order_id: 'order-1',
      barcode_scanned: 'BC-001',
      scan_status: 'success',
      scanned_at: new Date('2026-01-01T00:00:00Z'),
      synced: false,
      operator_id: 'operator-a',
      user_id: 'user-a',
      created_at: new Date('2026-01-01T00:00:00Z'),
    });
    await v2.pickup_queue.add({
      clientOperationId: 'client-op-1',
      operatorId: 'operator-a',
      userId: 'user-a',
      manifestId: 'manifest-1',
      type: 'pickup_scan',
      payload: { barcode: 'BC-001', extra: { nested: true } },
      status: 'pending',
      retryCount: 0,
      claimToken: null,
      lastAttemptAt: null,
      nextAttemptAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(v2.verno).toBe(2);
    v2.close();

    const v3 = new V3WithManifestCache();
    await v3.open();

    expect(v3.verno).toBe(3);
    expect(v3.manifest_cache).toBeDefined();

    const scanRows = await v3.scan_queue.toArray();
    const pickupRows = await v3.pickup_queue.toArray();

    expect(scanRows).toHaveLength(1);
    expect(scanRows[0].manifest_id).toBe('manifest-1');
    expect(scanRows[0].barcode_scanned).toBe('BC-001');

    expect(pickupRows).toHaveLength(1);
    expect(pickupRows[0].clientOperationId).toBe('client-op-1');
    // El payload es el punto que un upgrade destructivo rompería primero —
    // sobrevive completo, anidado incluido.
    expect(pickupRows[0].payload).toEqual({ barcode: 'BC-001', extra: { nested: true } });

    v3.close();
    await Dexie.delete(TEST_DB_NAME);
  });
});
