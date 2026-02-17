/**
 * Background Sync Manager
 * Story 1.5: PWA Enhancement Layer
 *
 * Handles offline scan queue synchronization with retry logic
 * Task 4.1-4.5: Complete sync manager implementation
 */

import { getUnsynced, markSynced, type ScanQueue } from './db';

// SyncManager Class (Task 4.1)
export class SyncManager {
  private maxRetries = 3;
  private retryDelays = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s
  private isSyncing = false;

  // Register Background Sync (Task 4.2)
  async registerSync(): Promise<void> {
    if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('pickup-scans-sync');
        console.log('[Sync Manager] Background sync registered');
      } catch (error) {
        console.error('[Sync Manager] Background sync registration failed:', error);
        // Fallback: Listen for 'online' event if Background Sync not supported
        this.setupOnlineFallback();
      }
    } else {
      console.warn('[Sync Manager] Background Sync API not supported, using fallback');
      this.setupOnlineFallback();
    }
  }

  // Fallback for browsers without Background Sync API
  private setupOnlineFallback(): void {
    window.addEventListener('online', () => {
      console.log('[Sync Manager] Online event detected, starting manual sync');
      this.manualSync();
    });
  }

  // Manual Sync (Task 4.3)
  async manualSync(): Promise<void> {
    if (this.isSyncing) {
      console.log('[Sync Manager] Sync already in progress, skipping');
      return;
    }

    this.isSyncing = true;

    try {
      // Query IndexedDB for unsynced scans
      const unsyncedScans = await getUnsynced();

      if (unsyncedScans.length === 0) {
        console.log('[Sync Manager] No scans to sync');
        return;
      }

      console.log(`[Sync Manager] Syncing ${unsyncedScans.length} scans`);

      // Batch scans by manifest_id (max 100 per batch)
      const batches = this.createBatches(unsyncedScans, 100);

      // Sync each batch
      for (const batch of batches) {
        await this.syncBatch(batch);
      }

      console.log('[Sync Manager] Sync completed successfully');
    } catch (error) {
      console.error('[Sync Manager] Manual sync failed:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  // Create batches grouped by manifest_id (max size per batch)
  private createBatches(scans: ScanQueue[], maxSize: number): ScanQueue[][] {
    // Group by manifest_id first
    const byManifest = new Map<string, ScanQueue[]>();
    for (const scan of scans) {
      const group = byManifest.get(scan.manifest_id) || [];
      group.push(scan);
      byManifest.set(scan.manifest_id, group);
    }

    // Split each manifest group into chunks of maxSize
    const batches: ScanQueue[][] = [];
    for (const group of byManifest.values()) {
      for (let i = 0; i < group.length; i += maxSize) {
        batches.push(group.slice(i, i + maxSize));
      }
    }

    return batches;
  }

  // Sync Batch with Retry Logic (Task 4.4)
  private async syncBatch(batch: ScanQueue[], attempt = 0): Promise<void> {
    try {
      // POST to API endpoint
      const response = await fetch('/api/pickup/scans/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scans: batch.map((scan) => ({
            manifest_id: scan.manifest_id,
            order_id: scan.order_id,
            barcode_scanned: scan.barcode_scanned,
            scan_status: scan.scan_status,
            scanned_at: scan.scanned_at instanceof Date
              ? scan.scanned_at.toISOString()
              : new Date(scan.scanned_at).toISOString(),
            operator_id: scan.operator_id,
            user_id: scan.user_id,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Success: Mark scans as synced
      const ids = batch.map((scan) => scan.id!).filter((id) => id !== undefined);
      await markSynced(ids);

      console.log(`[Sync Manager] Batch of ${batch.length} scans synced successfully`);
    } catch (error) {
      // Retry with exponential backoff
      if (attempt < this.maxRetries) {
        const delay = this.retryDelays[attempt];
        console.warn(
          `[Sync Manager] Batch sync failed (attempt ${attempt + 1}/${this.maxRetries}), retrying in ${delay}ms...`,
          error
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.syncBatch(batch, attempt + 1);
      }

      // Max retries exceeded: Log error and display notification
      console.error(
        `[Sync Manager] Failed to sync batch after ${this.maxRetries} attempts`,
        error
      );
      this.showSyncErrorNotification();
      throw new Error(`Failed to sync after ${this.maxRetries} attempts: ${error}`);
    }
  }

  // Show persistent error notification
  private showSyncErrorNotification(): void {
    // In a real app, this would use a toast/notification library (e.g., sonner)
    // For now, we'll just log it
    console.error(
      '[Sync Manager] Unable to sync. Check connection and try again'
    );

    // Dispatch custom event that UI can listen to
    window.dispatchEvent(
      new CustomEvent('sync-error', {
        detail: { message: 'Unable to sync. Check connection and try again' },
      })
    );
  }

  // Get sync status (for UI)
  getSyncStatus(): boolean {
    return this.isSyncing;
  }
}

// Export singleton instance (Task 4.5)
export const syncManager = new SyncManager();
