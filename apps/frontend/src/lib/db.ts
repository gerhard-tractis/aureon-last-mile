/**
 * IndexedDB Database Definition (Dexie.js)
 * Story 1.5: PWA Enhancement Layer
 *
 * Offline-first storage for pickup scans
 * Task 3.1-3.4: Complete IndexedDB setup
 */

import Dexie, { type EntityTable } from 'dexie';

// Scan Queue Interface (Task 3.1)
export interface ScanQueue {
  id?: number; // Auto-increment primary key
  manifest_id: string; // Indexed for manifest-specific queries
  order_id: string;
  barcode_scanned: string;
  scan_status: 'success' | 'error' | 'duplicate';
  scanned_at: Date;
  synced: boolean; // Indexed for unsync queries
  operator_id: string; // Indexed for tenant isolation
  user_id: string;
  created_at: Date;
  synced_at?: Date | null; // NULL until synced
  error_message?: string | null; // NULL unless error
}

// Dexie Database Class (Task 3.1)
class AureonOfflineDB extends Dexie {
  scan_queue!: EntityTable<ScanQueue, 'id'>;

  constructor() {
    super('aureon_offline');

    // Define schema version 1
    this.version(1).stores({
      scan_queue:
        '++id, manifest_id, operator_id, synced, [manifest_id+synced], scanned_at',
    });
  }
}

// Export database instance (Task 3.2)
export const db = new AureonOfflineDB();

// Helper Functions (Task 3.3)

/**
 * Get all unsynced scans
 */
export async function getUnsynced(): Promise<ScanQueue[]> {
  return await db.scan_queue.filter((scan) => !scan.synced).toArray();
}

/**
 * Get unsynced scans for a specific manifest
 */
export async function getUnsyncedByManifest(
  manifestId: string
): Promise<ScanQueue[]> {
  return await db.scan_queue
    .where('manifest_id')
    .equals(manifestId)
    .filter((scan) => !scan.synced)
    .toArray();
}

/**
 * Mark scans as synced (bulk update)
 */
export async function markSynced(ids: number[]): Promise<void> {
  const now = new Date();
  await db.scan_queue.bulkUpdate(
    ids.map((id) => ({
      key: id,
      changes: {
        synced: true,
        synced_at: now,
      },
    }))
  );
}

/**
 * Clear old synced scans (older than X days)
 */
export async function clearOldSynced(days = 7): Promise<number> {
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return await db.scan_queue
    .filter((scan) => scan.synced && scan.synced_at !== null && scan.synced_at! < cutoffDate)
    .delete();
}

// Quota Management (Task 3.4)

/**
 * Check IndexedDB storage quota
 * Returns percentage used (0-100)
 */
export async function checkStorageQuota(): Promise<{
  percentUsed: number;
  warning: 'none' | 'high' | 'critical' | 'full';
}> {
  if (navigator.storage?.estimate) {
    const quota = await navigator.storage.estimate();
    const usage = quota.usage || 0;
    const limit = quota.quota || 0;
    const percentUsed = limit > 0 ? (usage / limit) * 100 : 0;

    let warning: 'none' | 'high' | 'critical' | 'full' = 'none';

    if (percentUsed > 95) {
      warning = 'full';
      // Aggressive cleanup: synced scans older than 1 day
      await clearOldSynced(1);
      console.warn(`[IndexedDB] Storage >95% (${percentUsed.toFixed(1)}%). Critical cleanup performed.`);
    } else if (percentUsed > 90) {
      warning = 'critical';
      // Cleanup synced scans older than 3 days
      await clearOldSynced(3);
      console.warn(`[IndexedDB] Storage >90% (${percentUsed.toFixed(1)}%). Cleaned up synced scans >3 days.`);
    } else if (percentUsed > 80) {
      warning = 'high';
      // Cleanup synced scans older than 7 days
      const deletedCount = await clearOldSynced(7);
      console.log(`[IndexedDB] Storage >80% (${percentUsed.toFixed(1)}%). Cleaned up ${deletedCount} old scans.`);
    }

    return { percentUsed, warning };
  }

  return { percentUsed: 0, warning: 'none' };
}

/**
 * Get storage usage info (for UI display)
 */
export async function getStorageInfo(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if (navigator.storage?.estimate) {
    const quota = await navigator.storage.estimate();
    const usage = quota.usage || 0;
    const limit = quota.quota || 0;
    const percentUsed = (usage / limit) * 100;

    return {
      usage,
      quota: limit,
      percentUsed,
    };
  }

  return {
    usage: 0,
    quota: 0,
    percentUsed: 0,
  };
}
