/**
 * Tests for IndexedDB Layer (Dexie)
 * Target: 80% coverage (20 tests)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AureonOfflineDB, type OfflineScan } from './indexedDB';

describe('AureonOfflineDB', () => {
  let db: AureonOfflineDB;

  beforeEach(async () => {
    // Reset database before each test
    db = new AureonOfflineDB();
    await db.delete();
    db = new AureonOfflineDB();
  });

  describe('Database Initialization', () => {
    it('creates database with correct schema', async () => {
      expect(db.scans).toBeDefined();
      expect(db.manifests).toBeDefined();
      expect(db.orders).toBeDefined();
    });

    it('has correct version number', () => {
      expect(db.verno).toBe(1);
    });
  });

  describe('addScan', () => {
    it('adds scan with default values', async () => {
      const scanId = await db.addScan({
        barcode: 'TEST123',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      const scan = await db.scans.get(scanId);

      expect(scan).toBeDefined();
      expect(scan?.syncStatus).toBe('pending');
      expect(scan?.syncAttempts).toBe(0);
      expect(scan?.barcode).toBe('TEST123');
    });

    it('auto-increments ID', async () => {
      const id1 = await db.addScan({
        barcode: 'SCAN-1',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      const id2 = await db.addScan({
        barcode: 'SCAN-2',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      expect(id2).toBeGreaterThan(id1);
    });

    it('stores geolocation data when provided', async () => {
      const scanId = await db.addScan({
        barcode: 'GEO123',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
        latitude: 40.7128,
        longitude: -74.0060,
      });

      const scan = await db.scans.get(scanId);

      expect(scan?.latitude).toBe(40.7128);
      expect(scan?.longitude).toBe(-74.0060);
    });
  });

  describe('getPendingScans', () => {
    beforeEach(async () => {
      // Add test data
      await db.addScan({
        barcode: 'OP1-PENDING',
        manifestId: 'manifest-1',
        scannedAt: '2026-01-01T10:00:00Z',
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.addScan({
        barcode: 'OP1-FAILED',
        manifestId: 'manifest-1',
        scannedAt: '2026-01-01T11:00:00Z',
        operatorId: 'op-1',
        userId: 'user-1',
      });
      const failedId = await db.scans.where('barcode').equals('OP1-FAILED').first();
      if (failedId) await db.markScanFailed(failedId.id!, 'Network error');

      await db.addScan({
        barcode: 'OP1-SYNCED',
        manifestId: 'manifest-1',
        scannedAt: '2026-01-01T12:00:00Z',
        operatorId: 'op-1',
        userId: 'user-1',
      });
      const syncedId = await db.scans.where('barcode').equals('OP1-SYNCED').first();
      if (syncedId) await db.markScanSynced(syncedId.id!);

      await db.addScan({
        barcode: 'OP2-PENDING',
        manifestId: 'manifest-2',
        scannedAt: '2026-01-01T13:00:00Z',
        operatorId: 'op-2',
        userId: 'user-2',
      });
    });

    it('returns only pending and failed scans (multi-tenant isolation)', async () => {
      const scans = await db.getPendingScans('op-1');

      expect(scans).toHaveLength(2);
      expect(scans.map(s => s.barcode)).toContain('OP1-PENDING');
      expect(scans.map(s => s.barcode)).toContain('OP1-FAILED');
      expect(scans.map(s => s.barcode)).not.toContain('OP1-SYNCED');
      expect(scans.map(s => s.barcode)).not.toContain('OP2-PENDING');
    });

    it('filters by operatorId (multi-tenant isolation)', async () => {
      const op1Scans = await db.getPendingScans('op-1');
      const op2Scans = await db.getPendingScans('op-2');

      expect(op1Scans).toHaveLength(2);
      expect(op2Scans).toHaveLength(1);
      expect(op2Scans[0].barcode).toBe('OP2-PENDING');
    });

    it('returns empty array when no pending scans', async () => {
      const scans = await db.getPendingScans('op-3');
      expect(scans).toEqual([]);
    });

    it('sorts scans by scannedAt timestamp', async () => {
      const scans = await db.getPendingScans('op-1');

      expect(scans[0].scannedAt).toBe('2026-01-01T10:00:00Z');
      expect(scans[1].scannedAt).toBe('2026-01-01T11:00:00Z');
    });
  });

  describe('markScanSynced', () => {
    it('updates syncStatus to "synced"', async () => {
      const scanId = await db.addScan({
        barcode: 'SYNC-TEST',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.markScanSynced(scanId);
      const scan = await db.scans.get(scanId);

      expect(scan?.syncStatus).toBe('synced');
    });

    it('sets lastSyncAttempt timestamp', async () => {
      const scanId = await db.addScan({
        barcode: 'SYNC-TEST',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      const beforeSync = new Date().toISOString();
      await db.markScanSynced(scanId);
      const scan = await db.scans.get(scanId);

      expect(scan?.lastSyncAttempt).toBeDefined();
      expect(scan?.lastSyncAttempt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('handles non-existent scan ID gracefully', async () => {
      await expect(db.markScanSynced(99999)).resolves.not.toThrow();
    });
  });

  describe('markScanFailed', () => {
    it('updates syncStatus to "failed"', async () => {
      const scanId = await db.addScan({
        barcode: 'FAIL-TEST',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.markScanFailed(scanId, 'Network timeout');
      const scan = await db.scans.get(scanId);

      expect(scan?.syncStatus).toBe('failed');
    });

    it('increments syncAttempts counter', async () => {
      const scanId = await db.addScan({
        barcode: 'RETRY-TEST',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.markScanFailed(scanId, 'Error 1');
      let scan = await db.scans.get(scanId);
      expect(scan?.syncAttempts).toBe(1);

      await db.markScanFailed(scanId, 'Error 2');
      scan = await db.scans.get(scanId);
      expect(scan?.syncAttempts).toBe(2);
    });

    it('stores error message', async () => {
      const scanId = await db.addScan({
        barcode: 'ERROR-TEST',
        manifestId: 'manifest-1',
        scannedAt: new Date().toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.markScanFailed(scanId, 'Connection refused');
      const scan = await db.scans.get(scanId);

      expect(scan?.errorMessage).toBe('Connection refused');
    });

    it('handles non-existent scan ID gracefully', async () => {
      await expect(db.markScanFailed(99999, 'Error')).resolves.not.toThrow();
    });
  });

  describe('cacheManifest', () => {
    it('caches manifest with timestamp', async () => {
      const manifestId = await db.cacheManifest({
        id: 'manifest-1',
        manifestNumber: 'MAN-001',
        operatorId: 'op-1',
        status: 'active',
        expectedPackages: 10,
        scannedPackages: 5,
        createdAt: '2026-01-01T00:00:00Z',
      });

      const manifest = await db.manifests.get('manifest-1');

      expect(manifest).toBeDefined();
      expect(manifest?.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(manifest?.manifestNumber).toBe('MAN-001');
    });

    it('upserts manifest (replaces existing)', async () => {
      await db.cacheManifest({
        id: 'manifest-1',
        manifestNumber: 'MAN-001',
        operatorId: 'op-1',
        status: 'active',
        expectedPackages: 10,
        scannedPackages: 5,
        createdAt: '2026-01-01T00:00:00Z',
      });

      await db.cacheManifest({
        id: 'manifest-1',
        manifestNumber: 'MAN-001',
        operatorId: 'op-1',
        status: 'active',
        expectedPackages: 10,
        scannedPackages: 8, // Updated
        createdAt: '2026-01-01T00:00:00Z',
      });

      const manifests = await db.manifests.toArray();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].scannedPackages).toBe(8);
    });
  });

  describe('cacheOrder', () => {
    it('caches order with timestamp', async () => {
      await db.cacheOrder({
        id: 'order-1',
        orderNumber: 'ORD-001',
        operatorId: 'op-1',
        status: 'pending',
        customerName: 'John Doe',
        address: '123 Main St',
        barcode: 'ORDER123',
      });

      const order = await db.orders.get('order-1');

      expect(order).toBeDefined();
      expect(order?.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(order?.customerName).toBe('John Doe');
    });

    it('upserts order (replaces existing)', async () => {
      await db.cacheOrder({
        id: 'order-1',
        orderNumber: 'ORD-001',
        operatorId: 'op-1',
        status: 'pending',
        customerName: 'John Doe',
        address: '123 Main St',
        barcode: 'ORDER123',
      });

      await db.cacheOrder({
        id: 'order-1',
        orderNumber: 'ORD-001',
        operatorId: 'op-1',
        status: 'delivered', // Updated
        customerName: 'John Doe',
        address: '123 Main St',
        barcode: 'ORDER123',
      });

      const orders = await db.orders.toArray();
      expect(orders).toHaveLength(1);
      expect(orders[0].status).toBe('delivered');
    });
  });

  describe('clearOldCache', () => {
    beforeEach(async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const oldISO = oldDate.toISOString();

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      const recentISO = recentDate.toISOString();

      // Add old synced scan
      const oldScanId = await db.addScan({
        barcode: 'OLD-SCAN',
        manifestId: 'manifest-1',
        scannedAt: oldISO,
        operatorId: 'op-1',
        userId: 'user-1',
      });
      await db.markScanSynced(oldScanId);

      // Add recent synced scan
      const recentScanId = await db.addScan({
        barcode: 'RECENT-SCAN',
        manifestId: 'manifest-1',
        scannedAt: recentISO,
        operatorId: 'op-1',
        userId: 'user-1',
      });
      await db.markScanSynced(recentScanId);

      // Add old manifest
      await db.manifests.add({
        id: 'old-manifest',
        manifestNumber: 'OLD-MAN',
        operatorId: 'op-1',
        status: 'completed',
        expectedPackages: 10,
        scannedPackages: 10,
        createdAt: oldISO,
        cachedAt: oldISO,
      });

      // Add recent manifest
      await db.manifests.add({
        id: 'recent-manifest',
        manifestNumber: 'RECENT-MAN',
        operatorId: 'op-1',
        status: 'active',
        expectedPackages: 10,
        scannedPackages: 5,
        createdAt: recentISO,
        cachedAt: recentISO,
      });

      // Add old order
      await db.orders.add({
        id: 'old-order',
        orderNumber: 'OLD-ORD',
        operatorId: 'op-1',
        status: 'delivered',
        customerName: 'Old Customer',
        address: '456 Old St',
        barcode: 'OLD123',
        cachedAt: oldISO,
      });

      // Add recent order
      await db.orders.add({
        id: 'recent-order',
        orderNumber: 'RECENT-ORD',
        operatorId: 'op-1',
        status: 'pending',
        customerName: 'Recent Customer',
        address: '789 New St',
        barcode: 'RECENT123',
        cachedAt: recentISO,
      });
    });

    it('deletes scans older than specified days', async () => {
      await db.clearOldCache(7);

      const scans = await db.scans.toArray();
      expect(scans).toHaveLength(1);
      expect(scans[0].barcode).toBe('RECENT-SCAN');
    });

    it('deletes manifests older than specified days', async () => {
      await db.clearOldCache(7);

      const manifests = await db.manifests.toArray();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].id).toBe('recent-manifest');
    });

    it('deletes orders older than specified days', async () => {
      await db.clearOldCache(7);

      const orders = await db.orders.toArray();
      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe('recent-order');
    });

    it('preserves all data when days=30', async () => {
      await db.clearOldCache(30);

      const scans = await db.scans.toArray();
      const manifests = await db.manifests.toArray();
      const orders = await db.orders.toArray();

      expect(scans).toHaveLength(2);
      expect(manifests).toHaveLength(2);
      expect(orders).toHaveLength(2);
    });

    it('only deletes synced scans (not pending)', async () => {
      // Add old pending scan
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      await db.addScan({
        barcode: 'OLD-PENDING',
        manifestId: 'manifest-1',
        scannedAt: oldDate.toISOString(),
        operatorId: 'op-1',
        userId: 'user-1',
      });

      await db.clearOldCache(7);

      const scans = await db.scans.toArray();
      const pendingScan = scans.find(s => s.barcode === 'OLD-PENDING');

      expect(pendingScan).toBeDefined(); // Pending scan preserved
      expect(scans.find(s => s.barcode === 'OLD-SCAN')).toBeUndefined(); // Synced scan deleted
    });
  });
});
