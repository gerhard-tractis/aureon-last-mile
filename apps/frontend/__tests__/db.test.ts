/**
 * Unit Tests for IndexedDB Operations
 * Story 1.5: PWA Enhancement Layer
 * Task 7.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  db,
  getUnsynced,
  getUnsyncedByManifest,
  markSynced,
  clearOldSynced,
  checkStorageQuota,
  type ScanQueue,
} from '@/lib/db';
import { IDBFactory } from 'fake-indexeddb';

// Mock IndexedDB with fake-indexeddb
let originalIndexedDB: IDBFactory;

beforeEach(async () => {
  originalIndexedDB = global.indexedDB;
  global.indexedDB = new IDBFactory();
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
  global.indexedDB = originalIndexedDB;
});

describe('IndexedDB Operations', () => {
  it('should save and retrieve scan', async () => {
    const scan: ScanQueue = {
      manifest_id: 'm1',
      order_id: 'o1',
      barcode_scanned: '123456',
      scan_status: 'success',
      scanned_at: new Date(),
      synced: false,
      operator_id: 'op1',
      user_id: 'u1',
      created_at: new Date(),
    };

    const id = await db.scan_queue.add(scan);
    const retrieved = await db.scan_queue.get(id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.manifest_id).toBe('m1');
    expect(retrieved?.barcode_scanned).toBe('123456');
  });

  it('should query unsynced scans', async () => {
    // Add synced and unsynced scans
    await db.scan_queue.bulkAdd([
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '111',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
      {
        id: 2,
        manifest_id: 'm1',
        order_id: 'o2',
        barcode_scanned: '222',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: true,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
        synced_at: new Date(),
      },
      {
        id: 3,
        manifest_id: 'm1',
        order_id: 'o3',
        barcode_scanned: '333',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ]);

    const unsynced = await getUnsynced();
    expect(unsynced.length).toBe(2);
    expect(unsynced.every((s) => !s.synced)).toBe(true);
  });

  it('should query unsynced scans by manifest', async () => {
    await db.scan_queue.bulkAdd([
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '111',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
      {
        id: 2,
        manifest_id: 'm2',
        order_id: 'o2',
        barcode_scanned: '222',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ]);

    const unsynced = await getUnsyncedByManifest('m1');
    expect(unsynced.length).toBe(1);
    expect(unsynced[0].manifest_id).toBe('m1');
  });

  it('should mark scans as synced', async () => {
    await db.scan_queue.bulkAdd([
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '111',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
      {
        id: 2,
        manifest_id: 'm1',
        order_id: 'o2',
        barcode_scanned: '222',
        scan_status: 'success',
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ]);

    await markSynced([1, 2]);

    const allScans = await db.scan_queue.toArray();
    expect(allScans.every((s) => s.synced)).toBe(true);
    expect(allScans.every((s) => s.synced_at !== null)).toBe(true);
  });

  it('should cleanup old synced scans', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const today = new Date();

    await db.scan_queue.bulkAdd([
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '111',
        scan_status: 'success',
        scanned_at: eightDaysAgo,
        synced: true,
        synced_at: eightDaysAgo,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: eightDaysAgo,
      },
      {
        id: 2,
        manifest_id: 'm1',
        order_id: 'o2',
        barcode_scanned: '222',
        scan_status: 'success',
        scanned_at: today,
        synced: true,
        synced_at: today,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: today,
      },
    ]);

    const deletedCount = await clearOldSynced(7);
    expect(deletedCount).toBe(1);

    const remaining = await db.scan_queue.toArray();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(2);
  });

  it('should check storage quota and return warning level', async () => {
    // Mock navigator.storage.estimate
    const mockEstimate = vi.fn().mockResolvedValue({
      usage: 1000000,
      quota: 10000000,
    });

    global.navigator.storage = {
      estimate: mockEstimate,
    } as unknown as StorageManager;

    const result = await checkStorageQuota();
    expect(result.percentUsed).toBe(10);
    expect(result.warning).toBe('none');
    expect(mockEstimate).toHaveBeenCalled();
  });
});
