/**
 * Unit Tests for Sync Manager
 * Story 1.5: PWA Enhancement Layer
 * Task 7.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncManager } from '@/lib/sync-manager';
import * as dbModule from '@/lib/db';

// Mock the db module
vi.mock('@/lib/db', () => ({
  db: {},
  getUnsynced: vi.fn(),
  markSynced: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

describe('Sync Manager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    syncManager = new SyncManager();
    vi.clearAllMocks();
  });

  it('should create batches with max 100 scans per batch', async () => {
    const scans = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      manifest_id: 'm1',
      order_id: `o${i + 1}`,
      barcode_scanned: `${i + 1}`,
      scan_status: 'success' as const,
      scanned_at: new Date(),
      synced: false,
      operator_id: 'op1',
      user_id: 'u1',
      created_at: new Date(),
    }));

    vi.mocked(dbModule.getUnsynced).mockResolvedValue(scans);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await syncManager.manualSync();

    // Should have made 3 fetch calls (250 scans / 100 per batch = 3 batches)
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(dbModule.markSynced).toHaveBeenCalledTimes(3);
  });

  it('should retry failed batches with exponential backoff', async () => {
    const scans = [
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '123',
        scan_status: 'success' as const,
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ];

    vi.mocked(dbModule.getUnsynced).mockResolvedValue(scans);

    // Fail first 2 attempts, succeed on 3rd
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

    await syncManager.manualSync();

    // Should have retried 3 times total (initial + 2 retries)
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(dbModule.markSynced).toHaveBeenCalledTimes(1);
  });

  it('should throw error after max retries exceeded', async () => {
    const scans = [
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '123',
        scan_status: 'success' as const,
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ];

    vi.mocked(dbModule.getUnsynced).mockResolvedValue(scans);

    // Fail all attempts
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await expect(syncManager.manualSync()).rejects.toThrow();

    // Should have tried 4 times (1 initial + 3 retries)
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(dbModule.markSynced).not.toHaveBeenCalled();
  });

  it('should handle empty queue gracefully', async () => {
    vi.mocked(dbModule.getUnsynced).mockResolvedValue([]);

    await syncManager.manualSync();

    expect(fetch).not.toHaveBeenCalled();
    expect(dbModule.markSynced).not.toHaveBeenCalled();
  });

  it('should prevent concurrent syncs', async () => {
    const scans = [
      {
        id: 1,
        manifest_id: 'm1',
        order_id: 'o1',
        barcode_scanned: '123',
        scan_status: 'success' as const,
        scanned_at: new Date(),
        synced: false,
        operator_id: 'op1',
        user_id: 'u1',
        created_at: new Date(),
      },
    ];

    vi.mocked(dbModule.getUnsynced).mockResolvedValue(scans);
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ success: true }), { status: 200 })
              ),
            100
          );
        })
    );

    // Start two syncs simultaneously
    const sync1 = syncManager.manualSync();
    const sync2 = syncManager.manualSync();

    await Promise.all([sync1, sync2]);

    // Should only sync once (second call skipped due to isSyncing flag)
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
