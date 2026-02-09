/**
 * Scan Queue Store (Zustand)
 * Manages offline barcode scanning queue with immutable state updates
 */

import { create } from "zustand";
import { db } from "../offline/indexedDB";

interface ScanItem {
  id?: number;
  barcode: string;
  manifestId: string;
  scannedAt: string;
  operatorId: string;
  userId: string;
  latitude?: number;
  longitude?: number;
  syncStatus: "pending" | "syncing" | "synced" | "failed";
}

interface ScanStoreState {
  // State
  scans: ScanItem[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;

  // Actions
  addScan: (scan: Omit<ScanItem, "id" | "scannedAt" | "syncStatus">) => Promise<void>;
  loadPendingScans: (operatorId: string) => Promise<void>;
  syncScans: () => Promise<void>;
  setOnlineStatus: (online: boolean) => void;
  clearSyncedScans: () => void;
}

export const useScanStore = create<ScanStoreState>((set, get) => ({
  // Initial state
  scans: [],
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  isSyncing: false,
  lastSyncTime: null,

  // Add scan to queue (IMMUTABLE - uses spread operator)
  addScan: async (scan: Omit<ScanItem, "id" | "scannedAt" | "syncStatus">) => {
    const newScan: ScanItem = {
      ...scan,
      scannedAt: new Date().toISOString(),
      syncStatus: "pending",
    };

    // Save to IndexedDB
    const id = await db.addScan({
      barcode: newScan.barcode,
      manifestId: newScan.manifestId,
      scannedAt: newScan.scannedAt,
      operatorId: newScan.operatorId,
      userId: newScan.userId,
      latitude: newScan.latitude,
      longitude: newScan.longitude,
    });

    // Update Zustand state IMMUTABLY
    set((state) => ({
      scans: [...state.scans, { ...newScan, id }], // ✅ Spread operator
    }));

    // Auto-sync if online
    if (get().isOnline && !get().isSyncing) {
      await get().syncScans();
    }
  },

  // Load pending scans from IndexedDB
  loadPendingScans: async (operatorId: string) => {
    const pendingScans = await db.getPendingScans(operatorId);
    set({ scans: pendingScans });
  },

  // Sync scans to server
  syncScans: async () => {
    const { scans, isOnline } = get();

    if (!isOnline) {
      console.log("[ScanStore] Offline - skipping sync");
      return;
    }

    const pendingScans = scans.filter((s) => s.syncStatus === "pending" || s.syncStatus === "failed");

    if (pendingScans.length === 0) {
      return;
    }

    set({ isSyncing: true });

    try {
      // Sync each scan to the server
      for (const scan of pendingScans) {
        try {
          // Update UI to show syncing
          set((state) => ({
            scans: state.scans.map((s) => (s.id === scan.id ? { ...s, syncStatus: "syncing" } : s)),
          }));

          // TODO: Replace with actual API call
          const response = await fetch("/api/scans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              barcode: scan.barcode,
              manifestId: scan.manifestId,
              scannedAt: scan.scannedAt,
              operatorId: scan.operatorId,
              userId: scan.userId,
              latitude: scan.latitude,
              longitude: scan.longitude,
            }),
          });

          if (!response.ok) {
            throw new Error(`Sync failed: ${response.statusText}`);
          }

          // Mark as synced in IndexedDB
          if (scan.id) {
            await db.markScanSynced(scan.id);
          }

          // Update UI to show synced
          set((state) => ({
            scans: state.scans.map((s) => (s.id === scan.id ? { ...s, syncStatus: "synced" } : s)),
          }));
        } catch (error) {
          console.error(`[ScanStore] Failed to sync scan ${scan.id}:`, error);

          // Mark as failed in IndexedDB
          if (scan.id) {
            await db.markScanFailed(scan.id, error instanceof Error ? error.message : "Unknown error");
          }

          // Update UI to show failed
          set((state) => ({
            scans: state.scans.map((s) => (s.id === scan.id ? { ...s, syncStatus: "failed" } : s)),
          }));
        }
      }

      set({
        isSyncing: false,
        lastSyncTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[ScanStore] Sync error:", error);
      set({ isSyncing: false });
    }
  },

  // Update online status
  setOnlineStatus: (online: boolean) => {
    set({ isOnline: online });

    // Auto-sync when coming back online
    if (online && get().scans.some((s) => s.syncStatus === "pending")) {
      // Trigger sync (requires operatorId from context)
      console.log("[ScanStore] Back online - trigger sync via service worker");
      if ("serviceWorker" in navigator && "sync" in navigator.serviceWorker) {
        navigator.serviceWorker.ready.then((registration) => {
          // @ts-expect-error - Background Sync API not in TypeScript types yet
          return registration.sync.register("sync-scans");
        });
      }
    }
  },

  // Clear synced scans from UI (keep in IndexedDB for audit)
  clearSyncedScans: () => {
    set((state) => ({
      scans: state.scans.filter((s) => s.syncStatus !== "synced"), // ✅ Immutable filter
    }));
  },
}));

// Set up network status listeners (client-side only)
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    useScanStore.getState().setOnlineStatus(true);
  });

  window.addEventListener("offline", () => {
    useScanStore.getState().setOnlineStatus(false);
  });
}
