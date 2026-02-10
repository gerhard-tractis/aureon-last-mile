/**
 * Mock for IndexedDB (Dexie)
 * Used by scanStore tests
 */

import { vi } from 'vitest';

export const mockDb = {
  addScan: vi.fn(),
  getPendingScans: vi.fn(),
  markScanSynced: vi.fn(),
  markScanFailed: vi.fn(),
  cacheManifest: vi.fn(),
  cacheOrder: vi.fn(),
  clearOldCache: vi.fn(),
};

// Mock the default export
vi.mock('@/lib/offline/indexedDB', () => ({
  db: mockDb,
}));
