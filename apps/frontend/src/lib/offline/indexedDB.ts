/**
 * IndexedDB Schema for Offline-First Operations
 * Using Dexie.js for type-safe IndexedDB access
 */

import Dexie, { type EntityTable } from "dexie";

// Offline scan queue item
export interface OfflineScan {
  id?: number; // Auto-incremented primary key
  barcode: string;
  manifestId: string;
  scannedAt: string; // ISO 8601 timestamp
  operatorId: string; // For multi-tenant isolation
  userId: string;
  latitude?: number;
  longitude?: number;
  syncStatus: "pending" | "syncing" | "synced" | "failed";
  syncAttempts: number;
  lastSyncAttempt?: string; // ISO 8601 timestamp
  errorMessage?: string;
}

// Offline manifest data (for working offline)
export interface OfflineManifest {
  id: string; // Manifest UUID
  manifestNumber: string;
  operatorId: string;
  status: string;
  expectedPackages: number;
  scannedPackages: number;
  createdAt: string;
  cachedAt: string; // When cached locally
}

// Offline orders cache
export interface OfflineOrder {
  id: string; // Order UUID
  orderNumber: string;
  operatorId: string;
  status: string;
  customerName: string;
  address: string;
  barcode: string;
  cachedAt: string;
}

// Database class
export class AureonOfflineDB extends Dexie {
  // Typed tables
  scans!: EntityTable<OfflineScan, "id">;
  manifests!: EntityTable<OfflineManifest, "id">;
  orders!: EntityTable<OfflineOrder, "id">;

  constructor() {
    super("AureonOfflineDB");

    // Schema version 1
    this.version(1).stores({
      // Indexes: Primary key first, then indexed fields
      scans: "++id, barcode, manifestId, operatorId, syncStatus, scannedAt",
      manifests: "id, manifestNumber, operatorId, cachedAt",
      orders: "id, orderNumber, barcode, operatorId, cachedAt",
    });
  }

  /**
   * Add a scan to the offline queue
   */
  async addScan(scan: Omit<OfflineScan, "id" | "syncStatus" | "syncAttempts">) {
    return await this.scans.add({
      ...scan,
      syncStatus: "pending",
      syncAttempts: 0,
    });
  }

  /**
   * Get all pending scans for sync
   */
  async getPendingScans(operatorId: string): Promise<OfflineScan[]> {
    return await this.scans
      .where("operatorId")
      .equals(operatorId)
      .and((scan) => scan.syncStatus === "pending" || scan.syncStatus === "failed")
      .sortBy("scannedAt");
  }

  /**
   * Mark scan as synced
   */
  async markScanSynced(scanId: number) {
    return await this.scans.update(scanId, {
      syncStatus: "synced",
      lastSyncAttempt: new Date().toISOString(),
    });
  }

  /**
   * Mark scan as failed
   */
  async markScanFailed(scanId: number, errorMessage: string) {
    const scan = await this.scans.get(scanId);
    if (!scan) return;

    return await this.scans.update(scanId, {
      syncStatus: "failed",
      syncAttempts: (scan.syncAttempts || 0) + 1,
      lastSyncAttempt: new Date().toISOString(),
      errorMessage,
    });
  }

  /**
   * Cache manifest for offline use
   */
  async cacheManifest(manifest: Omit<OfflineManifest, "cachedAt">) {
    return await this.manifests.put({
      ...manifest,
      cachedAt: new Date().toISOString(),
    });
  }

  /**
   * Cache order for offline use
   */
  async cacheOrder(order: Omit<OfflineOrder, "cachedAt">) {
    return await this.orders.put({
      ...order,
      cachedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear old cached data (older than X days)
   */
  async clearOldCache(daysOld: number = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    // Clear old manifests
    await this.manifests.where("cachedAt").below(cutoffISO).delete();

    // Clear old orders
    await this.orders.where("cachedAt").below(cutoffISO).delete();

    // Clear synced scans older than cutoff
    await this.scans
      .where("syncStatus")
      .equals("synced")
      .and((scan) => scan.scannedAt < cutoffISO)
      .delete();
  }
}

// Export singleton instance
export const db = new AureonOfflineDB();
