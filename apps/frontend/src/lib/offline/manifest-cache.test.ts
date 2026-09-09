/**
 * spec-82 fase 2 — Caché de LECTURA offline por manifiesto ("DESCARGAR").
 *
 * Lógica pura sobre IndexedDB (Dexie + fake-indexeddb, sin DOM real), mismo
 * patrón que `lib/offline/queue.ts` (spec-81). Ver
 * docs/specs/spec-82-recogida-movil-asignacion-y-ruta.md, fase 2.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../db';
import {
  saveManifestSnapshot,
  getManifestSnapshot,
  listDownloadedExternalLoadIds,
  type ManifestCacheSnapshot,
} from './manifest-cache';

const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

function makeSnapshot(
  overrides: Partial<ManifestCacheSnapshot> = {},
): ManifestCacheSnapshot {
  return {
    operatorId: OPERATOR_A,
    externalLoadId: 'CARGA-99817',
    manifestId: 'manifest-1',
    totalPackages: 25,
    pickupRouteId: 'route-1',
    retailerName: 'Ripley',
    pickupLocation: 'Parque Arauco',
    orders: [
      {
        id: 'order-1',
        order_number: 'ORD-1',
        customer_name: 'Juan Pérez',
        comuna: 'Ñuñoa',
        delivery_address: 'Calle Falsa 123',
        packages: [
          {
            id: 'pkg-1',
            label: 'PKG-1',
            package_number: '1/1',
            sku_items: [{ sku: 'SKU-1', description: 'Caja', quantity: 1 }],
            declared_weight_kg: 2.5,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('manifest-cache (offline read store)', () => {
  beforeEach(async () => {
    await db.manifest_cache.clear();
  });

  afterEach(async () => {
    await db.manifest_cache.clear();
  });

  describe('saveManifestSnapshot / getManifestSnapshot', () => {
    it('persists a snapshot retrievable by operator + externalLoadId', async () => {
      await saveManifestSnapshot(db, makeSnapshot());

      const found = await getManifestSnapshot(db, OPERATOR_A, 'CARGA-99817');

      expect(found).toBeDefined();
      expect(found?.retailerName).toBe('Ripley');
      expect(found?.orders).toHaveLength(1);
      expect(found?.orders[0].packages[0].label).toBe('PKG-1');
    });

    it('stamps downloadedAt on save', async () => {
      const before = Date.now();
      await saveManifestSnapshot(db, makeSnapshot());
      const found = await getManifestSnapshot(db, OPERATOR_A, 'CARGA-99817');

      expect(found?.downloadedAt).toBeDefined();
      expect(Date.parse(found!.downloadedAt)).toBeGreaterThanOrEqual(before);
    });

    it('re-downloading the same carga overwrites the previous snapshot instead of duplicating it', async () => {
      await saveManifestSnapshot(db, makeSnapshot({ retailerName: 'Ripley (viejo)' }));
      await saveManifestSnapshot(db, makeSnapshot({ retailerName: 'Ripley (nuevo)' }));

      const rows = await db.manifest_cache
        .where('[operatorId+externalLoadId]')
        .equals([OPERATOR_A, 'CARGA-99817'])
        .toArray();

      expect(rows).toHaveLength(1);
      expect(rows[0].retailerName).toBe('Ripley (nuevo)');
    });

    it('returns undefined for a carga never downloaded', async () => {
      const found = await getManifestSnapshot(db, OPERATOR_A, 'CARGA-NUNCA');
      expect(found).toBeUndefined();
    });

    it('never mixes snapshots of two operators sharing the same externalLoadId', async () => {
      await saveManifestSnapshot(
        db,
        makeSnapshot({ operatorId: OPERATOR_A, retailerName: 'Operador A' }),
      );
      await saveManifestSnapshot(
        db,
        makeSnapshot({ operatorId: OPERATOR_B, retailerName: 'Operador B' }),
      );

      const foundA = await getManifestSnapshot(db, OPERATOR_A, 'CARGA-99817');
      const foundB = await getManifestSnapshot(db, OPERATOR_B, 'CARGA-99817');

      expect(foundA?.retailerName).toBe('Operador A');
      expect(foundB?.retailerName).toBe('Operador B');
    });
  });

  describe('listDownloadedExternalLoadIds', () => {
    it('lists only the externalLoadIds downloaded by that operator', async () => {
      await saveManifestSnapshot(
        db,
        makeSnapshot({ operatorId: OPERATOR_A, externalLoadId: 'CARGA-A1' }),
      );
      await saveManifestSnapshot(
        db,
        makeSnapshot({ operatorId: OPERATOR_A, externalLoadId: 'CARGA-A2' }),
      );
      await saveManifestSnapshot(
        db,
        makeSnapshot({ operatorId: OPERATOR_B, externalLoadId: 'CARGA-B1' }),
      );

      const ids = await listDownloadedExternalLoadIds(db, OPERATOR_A);

      expect(ids.sort()).toEqual(['CARGA-A1', 'CARGA-A2']);
    });

    it('returns an empty list, not undefined, when nothing was downloaded', async () => {
      const ids = await listDownloadedExternalLoadIds(db, OPERATOR_A);
      expect(ids).toEqual([]);
    });
  });
});
