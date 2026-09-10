/**
 * spec-82 fase 2, revisión (bloqueante, ronda 3) — "escribe el test del
 * upgrade con datos v2 poblados", y que sea contra `db.ts` de verdad, no
 * contra una fotocopia.
 *
 * Ronda 2 de este mismo hallazgo declaraba dos clases Dexie locales que
 * copiaban a mano los `stores({...})` de `db.ts` — nunca importaba
 * `AureonOfflineDB`. Medido: un `.upgrade()` en `version(3)` que BORRA LAS
 * FILAS de `pickup_queue`/`scan_queue` (en vez de las tablas) pasaba verde
 * contra esa fotocopia, porque la fotocopia no tenía upgrade que ejecutar.
 * Es exactamente el escenario que este test existe para prevenir: cada
 * escaneo y cada cierre sin subir, de cada dispositivo que actualice la
 * PWA, borrado en silencio.
 *
 * Arreglo: `AureonOfflineDB` ahora acepta un `name` opcional (default
 * `'aureon_offline'`, sin cambiar nada para producción). La fase "abrir en
 * v3" de este test usa la clase REAL — cualquier mutación en su
 * `version(3)` (tabla borrada, `.upgrade()` destructivo) se ejecuta de
 * verdad aquí. La fase "sembrar v2" sigue necesitando una clase aparte
 * (Dexie no permite "detener" una clase en una versión anterior a la que
 * declara), pero usa las MISMAS constantes de índice exportadas por
 * `db.ts` (`SCAN_QUEUE_V1_STORES`/`PICKUP_QUEUE_V2_STORES`) — no hay nada
 * que copiar a mano ni que pueda divergir en silencio.
 */
import { describe, it, expect } from 'vitest';
import Dexie, { type EntityTable } from 'dexie';
import {
  AureonOfflineDB,
  SCAN_QUEUE_V1_STORES,
  PICKUP_QUEUE_V2_STORES,
  type ScanQueue,
  type PickupQueueEntry,
} from './db';

const TEST_DB_NAME = 'aureon_offline_schema_upgrade_test';

/** Sólo para sembrar el estado "antes" — ver el docstring de arriba sobre
 * por qué esta parte, y sólo esta parte, no puede evitar declarar sus
 * propias versiones. Las cadenas de índice vienen de `db.ts`, no de aquí. */
class V2Only extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;
  pickup_queue!: EntityTable<PickupQueueEntry, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ scan_queue: SCAN_QUEUE_V1_STORES });
    this.version(2).stores({ pickup_queue: PICKUP_QUEUE_V2_STORES });
  }
}

describe('schema upgrade v2 -> v3 (manifest_cache, spec-82 fase 2)', () => {
  it('preserves populated scan_queue and pickup_queue rows, payload intact, opening the REAL AureonOfflineDB', async () => {
    await Dexie.delete(TEST_DB_NAME);

    const v2 = new V2Only(TEST_DB_NAME);
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

    // La pieza real: la clase de PRODUCCIÓN, mismo código que usa
    // `lib/db.ts` en runtime — no una reconstrucción.
    const v3 = new AureonOfflineDB(TEST_DB_NAME);
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
