# Story 1.5: Add PWA Enhancement Layer (Serwist + IndexedDB + Background Sync)

**Epic:** 1 - Platform Foundation & Multi-Tenant SaaS Setup
**Status:** ready-for-dev
**Story ID:** 1.5
**Story Key:** 1-5-add-pwa-enhancement-layer-serwist-indexeddb-background-sync

---

## Story

As a **pickup crew member**,
I want **the mobile app to work offline and automatically sync my scans when connectivity is restored**,
So that **I can continue working in warehouses with unreliable WiFi without losing data or waiting for network connectivity**.

---

## Business Context

This story establishes the **offline-first PWA foundation** for the Aureon Last Mile platform:

**Critical Success Factors:**
- **Zero data loss**: Scans persist in IndexedDB even if app crashes, browser closes, or network fails
- **Background sync**: Automatic uploads when connectivity restored (no user action needed)
- **Instant offline detection**: Connection status banner informs users of network state in real-time
- **Optimistic UI**: Scans appear successful immediately (queued for sync), users never wait for network

**Business Impact:**
- Enables warehouse operations in low-connectivity zones (concrete buildings block cellular, WiFi dropouts common)
- Reduces scan time from 5 seconds/package (wait for API) to <1 second (optimistic save)
- Prevents scan loss: 100% reliability vs 15% failure rate with network-only approach
- Supports 500-1000 scans/shift without network dependency (sync happens in background)

**Dependency Context:**
- **Blocks**: Story 4.5 (Offline Scan Queue), Story 4.6 (Background Sync Implementation) - Cannot build pickup workflow without PWA foundation
- **Depends on**: Story 1.1 (Razikus template provides Next.js 14, Supabase, TypeScript)
- **Enables**: All Epic 4 features (Manifest Pickup Workflow requires offline capability)

---

## Acceptance Criteria

### Given
- ✅ Story 1.1 is COMPLETE (Next.js 14 App Router, Supabase, Vercel deployment)
- ✅ Packages installed: `@serwist/next ^9.5.5`, `serwist ^9.5.5`, `dexie ^4.3.0`
- ✅ User has modern browser with Service Worker support (Chrome 80+, Safari 15+, Firefox 78+)

### When
- App loads for the first time

### Then
- ✅ **Service Worker registers**: Visible in Chrome DevTools > Application > Service Workers
- ✅ **App shell cached**: HTML, CSS, JS bundles use **cache-first strategy** (instant load on repeat visits)
- ✅ **IndexedDB created**: Database "aureon_offline" with table "scan_queue" exists
- ✅ **Manifest installed**: PWA manifest allows "Add to Home Screen" on mobile devices
- ✅ **Connection banner visible**: Displays green "Online" status at top of screen

### When
- User goes offline (Airplane mode, WiFi disconnected, or poor connectivity)

### Then
- ✅ **Connection banner updates**: Displays yellow "Offline - XX scans queued" with scan count
- ✅ **Offline fallback page**: Displays when navigating to uncached routes (clean error message, not broken UI)
- ✅ **API requests cache-fallback**: Network-first strategy with 5-second timeout falls back to cached data
- ✅ **Background Sync registered**: Service worker registers 'pickup-scans-sync' event for auto-sync when online

### When
- User performs scan while offline

### Then
- ✅ **Optimistic UI**: Scan shows as successful immediately (no API call)
- ✅ **IndexedDB write**: Scan saved to scan_queue table with synced = false
- ✅ **Queue count updates**: Connection banner shows "Offline - X scans queued" (increments)
- ✅ **Progress bar updates**: Scan progress calculates from IndexedDB (local source of truth)

### When
- Connectivity restored (offline → online)

### Then
- ✅ **Background Sync triggers**: Service worker 'sync' event fires automatically
- ✅ **Batch upload**: Queued scans batch-uploaded to `/api/scans/sync` (max 100 per request)
- ✅ **Sync state updates**: Successful scans marked synced = true in IndexedDB
- ✅ **Connection banner updates**: Shows "Syncing..." (gray) then "Online" (green) when complete
- ✅ **Retry with backoff**: Failed syncs retry 3 times with exponential backoff (1s, 2s, 4s delays)

### Edge Cases Handled
- ❌ **Service Worker installation failure** → Log error to console, app works without offline capability (graceful degradation)
- ❌ **IndexedDB quota exceeded (>50MB)** → Clear synced scans older than 7 days, show warning toast "Storage limit reached"
- ❌ **Sync fails after 3 retries** → Show persistent error notification "Unable to sync. Check connection and try again"
- ❌ **User clears browser cache** → IndexedDB persists separately, queued scans remain safe
- ❌ **Browser doesn't support Background Sync API** → Fallback to manual sync on 'online' event listener

---

## Tasks / Subtasks

### Task 1: Install and Configure Serwist (Service Worker Management)
- [ ] **1.1** Verify packages installed (already in package.json)
  - `@serwist/next: ^9.5.5`
  - `serwist: ^9.5.5`
  - `dexie: ^4.3.0`
  - `fake-indexeddb: ^6.2.5` (for testing)
- [ ] **1.2** Configure Serwist in `next.config.js`
  - Import `withSerwist from '@serwist/next'`
  - Set `disable: process.env.NODE_ENV === 'development'` (disable in dev for easier debugging)
  - Set `swDest: 'public/sw.js'` (output path)
  - Set `swSrc: 'src/lib/sw.ts'` (custom service worker source)
  - Set `skipWaiting: true`, `clientsClaim: true` (immediate activation on update)
- [ ] **1.3** Define runtime caching strategies
  - API routes (`/api/*`): NetworkFirst with 5-second timeout, 1-hour expiration
  - Static assets (`/_next/static/*`): CacheFirst, cache forever
  - Google Fonts: CacheFirst, 1-year expiration
  - Images: StaleWhileRevalidate, 7-day expiration

### Task 2: Create Custom Service Worker for Background Sync
- [ ] **2.1** Create `src/lib/sw.ts` (custom service worker)
  - Import Serwist precaching utilities
  - Call `cleanupOutdatedCaches()` to remove old caches
  - Call `precacheAndRoute(self.__WB_MANIFEST)` to cache app shell
- [ ] **2.2** Implement Background Sync event handler
  - Listen for 'sync' event with tag 'pickup-scans-sync'
  - Call `syncPickupScans()` function on sync event
  - Use `event.waitUntil()` to keep service worker alive during sync
- [ ] **2.3** Implement message passing for UI <-> SW communication
  - Listen for 'message' event from clients
  - Handle 'SKIP_WAITING' message to force service worker update
- [ ] **2.4** Register service worker in `app/layout.tsx`
  - Check `'serviceWorker' in navigator`
  - Call `navigator.serviceWorker.register('/sw.js')`
  - Add error handling with console logging

### Task 3: Set Up IndexedDB with Dexie.js
- [ ] **3.1** Create `src/lib/db.ts` (Dexie database definition)
  - Extend `Dexie` class to create `AureonOfflineDB`
  - Define `scan_queue` table with schema:
    - `id` (primary key, auto-increment)
    - `manifest_id` (string, indexed)
    - `order_id` (string)
    - `barcode_scanned` (string)
    - `scan_status` ('success' | 'error' | 'duplicate')
    - `scanned_at` (Date)
    - `synced` (boolean, indexed)
    - `operator_id` (string, indexed)
    - `user_id` (string)
    - `created_at` (Date)
    - `synced_at` (Date, nullable)
    - `error_message` (string, nullable)
  - Define compound indexes: `[manifest_id+synced]`, `scanned_at`
- [ ] **3.2** Export database instance
  - `export const db = new AureonOfflineDB()`
  - Single global instance (Dexie handles connection pooling)
- [ ] **3.3** Create helper functions for common queries
  - `getUnsynced()`: Return all scans where synced = false
  - `getUnsyncedByManifest(manifestId)`: Return unsynced scans for specific manifest
  - `markSynced(ids)`: Bulk update scans to synced = true
  - `clearOldSynced(days = 7)`: Delete synced scans older than X days
- [ ] **3.4** Implement quota monitoring
  - `checkStorageQuota()`: Check IndexedDB usage vs quota
  - If usage >80%, auto-cleanup synced scans older than 7 days
  - Return percentage used for UI display

### Task 4: Implement Background Sync Manager
- [ ] **4.1** Create `src/lib/sync-manager.ts`
  - Define `SyncManager` class with retry logic
  - Set `maxRetries = 3`, `retryDelays = [1000, 2000, 4000]` (exponential backoff)
- [ ] **4.2** Implement `registerSync()` method
  - Check for Background Sync API support
  - Call `navigator.serviceWorker.ready.then(reg => reg.sync.register('pickup-scans-sync'))`
  - Fallback: Listen for 'online' event if Background Sync not supported
- [ ] **4.3** Implement `manualSync()` method
  - Query IndexedDB for unsynced scans
  - Batch scans by manifest_id (max 100 per batch)
  - Call `syncBatch()` for each batch
- [ ] **4.4** Implement `syncBatch()` with retry logic
  - POST to `/api/pickup/scans/bulk` with batch data
  - On success: Mark scans as synced in IndexedDB
  - On failure: Retry with exponential backoff (up to 3 attempts)
  - After max retries: Log error and display notification
- [ ] **4.5** Export singleton instance
  - `export const syncManager = new SyncManager()`

### Task 5: Create Connection Status UI Component
- [ ] **5.1** Create `src/components/ConnectionStatusBanner.tsx`
  - Use `'use client'` directive (client component)
  - Track state: `status: 'online' | 'offline' | 'syncing'`
  - Track state: `queueCount: number` (unsynced scan count)
- [ ] **5.2** Add online/offline event listeners
  - Listen for 'online' event → trigger sync, set status to 'syncing'
  - Listen for 'offline' event → set status to 'offline'
  - Poll IndexedDB every 2 seconds to update queue count
- [ ] **5.3** Render connection banner
  - Green background + "Online - Syncing" when online
  - Yellow background + "Offline - X scans queued" when offline
  - Gray background + "Syncing..." during sync
  - Sticky position at top of screen (z-index 50)
- [ ] **5.4** Add to root layout
  - Import `<ConnectionStatusBanner />` in `app/layout.tsx`
  - Render above main content (sticky top)

### Task 6: Create PWA Manifest
- [ ] **6.1** Create `public/manifest.json`
  - Set `name: "Aureon Last Mile"`
  - Set `short_name: "Aureon"`
  - Set `theme_color: "#e6c15c"` (Tractis gold)
  - Set `background_color: "#5e6b7b"` (Tractis slate)
  - Set `display: "standalone"` (fullscreen PWA)
  - Set `start_url: "/"`
  - Add icons: 192x192, 512x512 (required for installability)
- [ ] **6.2** Link manifest in `app/layout.tsx`
  - Add `<link rel="manifest" href="/manifest.json" />`
  - Add `<meta name="theme-color" content="#e6c15c" />`
  - Add `<meta name="apple-mobile-web-app-capable" content="yes" />`
- [ ] **6.3** Create app icons
  - Generate 192x192px icon: `public/icon-192.png`
  - Generate 512x512px icon: `public/icon-512.png`
  - Generate Apple Touch Icon: `public/apple-touch-icon.png` (180x180px)

### Task 7: Write Tests for PWA Features
- [ ] **7.1** Unit tests for IndexedDB operations (`db.test.ts`)
  - Test scan creation, retrieval, update
  - Test query unsynced scans
  - Test mark scans as synced
  - Test quota monitoring and cleanup
  - Use `fake-indexeddb` for test environment
- [ ] **7.2** Unit tests for Sync Manager (`sync-manager.test.ts`)
  - Test batch creation (max 100 per batch)
  - Test retry with exponential backoff
  - Test max retries exceeded error handling
  - Mock fetch API
- [ ] **7.3** Integration test for service worker registration
  - Test service worker registers on app load
  - Test Background Sync API registration
  - Test fallback for browsers without Background Sync
- [ ] **7.4** E2E test for offline workflow (Playwright)
  - Navigate to app
  - Go offline (Playwright context.setOffline(true))
  - Perform scan
  - Verify optimistic UI update (scan appears successful)
  - Verify connection banner shows "Offline - 1 scans queued"
  - Go online (context.setOffline(false))
  - Verify banner shows "Syncing..." then "Online"
  - Verify scan uploaded to API

### Task 8: Update Documentation and Sprint Status
- [ ] **8.1** Document PWA architecture
  - Service worker lifecycle
  - Caching strategies (cache-first, network-first, stale-while-revalidate)
  - IndexedDB schema
  - Background sync flow
- [ ] **8.2** Update sprint-status.yaml
  - Update story status: `backlog` → `ready-for-dev` (at completion)
  - Mark all tasks 1-8 complete in this story file
- [ ] **8.3** Verify all acceptance criteria checked off
  - All "Then" section items validated
  - Edge cases tested and documented

---

## Dev Notes

### 🏗️ Architecture Patterns and Constraints

**CRITICAL: Follow these patterns to prevent offline data loss and sync failures!**

#### 1. Service Worker Lifecycle (2026 Serwist Best Practices)

**Install → Activate → Fetch:**
```typescript
// src/lib/sw.ts
declare const self: ServiceWorkerGlobalScope;
import { precacheAndRoute, cleanupOutdatedCaches } from 'serwist';

// INSTALL: Cache app shell
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Activate immediately (don't wait for old SW to unload)
  event.waitUntil(
    caches.open('app-shell-v1').then(cache => {
      return cache.addAll([
        '/',
        '/_next/static/...',
        '/manifest.json'
      ]);
    })
  );
});

// ACTIVATE: Clean old caches
self.addEventListener('activate', (event) => {
  self.clients.claim(); // Take control of all clients immediately
  event.waitUntil(cleanupOutdatedCaches());
});

// FETCH: Network-first with cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request, { timeout: 5000 })
        .catch(() => caches.match(event.request))
    );
  }
});

// BACKGROUND SYNC: Auto-sync when online
self.addEventListener('sync', (event) => {
  if (event.tag === 'pickup-scans-sync') {
    event.waitUntil(syncPickupScans());
  }
});
```

**Why skipWaiting + clientsClaim?**
- **skipWaiting**: New service worker activates immediately on update (user doesn't need to close all tabs)
- **clientsClaim**: New service worker takes control of existing pages immediately (no reload needed)
- **Trade-off**: Breaks tab isolation (all tabs use new SW immediately), but better UX for production PWA

**Alternative (wait for all tabs to close):**
- Remove `skipWaiting()` → service worker waits until all tabs closed
- Better for apps with complex state (prevent version mismatch)
- Worse UX: Users must close all tabs to get updates

#### 2. Caching Strategies (Multi-Layer Defense)

**Strategy Selection Guide:**
| Content Type | Strategy | Rationale |
|--------------|----------|-----------|
| **App Shell** (HTML, CSS, JS) | **Cache-First** | Never stale, always use cached version (updates via SW update) |
| **API Responses** (/api/*) | **Network-First** | Try network first (5s timeout), fall back to cache if offline |
| **Static Assets** (images, fonts) | **Stale-While-Revalidate** | Serve cache immediately, update in background |
| **External APIs** | **Network-Only** | Never cache (auth tokens expire, data changes) |

**Network-First with Timeout (Recommended for API):**
```typescript
// next.config.js
runtimeCaching: [
  {
    urlPattern: /^https:\/\/api\.aureon\.com\/api\//,
    handler: 'NetworkFirst',
    options: {
      networkTimeoutSeconds: 5, // Fallback to cache after 5s
      cacheName: 'api-cache',
      expiration: {
        maxEntries: 100,
        maxAgeSeconds: 3600 // 1 hour
      }
    }
  }
]
```

**Why 5-second timeout?**
- Warehouse WiFi often slow (3-10 Mbps), 5s allows time for slow connections
- User perception: <5s feels responsive, >5s feels broken
- Fallback to cache after 5s prevents UI blocking

#### 3. IndexedDB Schema Design (Dexie.js Patterns)

**Primary Table: scan_queue**
```typescript
export interface ScanQueue {
  id: string;                    // Auto-increment primary key
  manifest_id: string;           // Indexed for manifest-specific queries
  order_id: string;
  barcode_scanned: string;
  scan_status: 'success' | 'error' | 'duplicate';
  scanned_at: Date;
  synced: boolean;               // Indexed for unsync queries
  operator_id: string;           // Indexed for tenant isolation
  user_id: string;
  created_at: Date;
  synced_at?: Date;              // NULL until synced
  error_message?: string;        // NULL unless error
}

// Dexie schema definition
this.version(1).stores({
  scan_queue: '++id, manifest_id, operator_id, [manifest_id+synced], scanned_at'
});
```

**Index Strategy:**
- `++id`: Auto-increment primary key
- `manifest_id`: Fast lookups for manifest-specific scans
- `operator_id`: Tenant isolation queries
- `[manifest_id+synced]`: Compound index for "get unsynced scans for manifest X"
- `scanned_at`: Time-based queries (newest first, cleanup old synced)

**Why Compound Index `[manifest_id+synced]`?**
- Enables fast query: `db.scan_queue.where('[manifest_id+synced]').equals(['m1', false])`
- Single index lookup instead of filtering two separate indexes
- Critical for performance: Warehouse workers scan 500-1000 items/shift

#### 4. Background Sync with Retry Logic (Exponential Backoff)

**Sync Flow:**
1. **Offline → Online**: Network change triggers 'online' event
2. **Register Sync**: `navigator.serviceWorker.ready.then(reg => reg.sync.register('pickup-scans-sync'))`
3. **Service Worker Wakes**: 'sync' event fires in service worker
4. **Sync Handler**: Query IndexedDB → batch scans → POST to API
5. **Update State**: Mark synced scans as synced = true

**Retry with Exponential Backoff:**
```typescript
private async syncBatch(batch: ScanQueue[], attempt = 0): Promise<void> {
  try {
    const response = await fetch('/api/pickup/scans/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scans: batch })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Success: Mark as synced
    await markSynced(batch.map(s => s.id));
    return;
  } catch (error) {
    if (attempt < this.maxRetries) {
      const delay = this.retryDelays[attempt]; // [1000, 2000, 4000]
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.syncBatch(batch, attempt + 1);
    }
    // Max retries exceeded: Show persistent error
    throw new Error(`Failed to sync after ${this.maxRetries} attempts`);
  }
}
```

**Why Exponential Backoff?**
- **1st retry (1s)**: Quick retry for transient errors (DNS hiccup)
- **2nd retry (2s)**: Give network time to stabilize
- **3rd retry (4s)**: Last chance before giving up
- **Prevents**: Infinite retry loops that drain battery and spam API

#### 5. Offline UI Patterns (Optimistic Updates)

**Optimistic UI Flow:**
1. **User scans barcode** → Immediately show success (don't wait for API)
2. **Write to IndexedDB** → `db.scan_queue.add({ ..., synced: false })`
3. **Update progress bar** → Calculate from IndexedDB (local source of truth)
4. **Queue for sync** → Background sync handles upload asynchronously

**Connection Status Banner:**
```typescript
// Real-time connection monitoring
useEffect(() => {
  const handleOnline = async () => {
    setStatus('syncing');
    await syncManager.manualSync();
    setStatus('online');
  };

  const handleOffline = () => setStatus('offline');

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Poll IndexedDB for queue count
  const interval = setInterval(async () => {
    const count = await db.scan_queue.where('synced').equals(false).count();
    setQueueCount(count);
  }, 2000);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    clearInterval(interval);
  };
}, []);
```

**Why Poll Every 2 Seconds?**
- Balance between responsiveness and performance
- 1-second polling: Too aggressive (battery drain)
- 5-second polling: Too slow (stale UI)
- 2-second polling: Sweet spot for real-time feel without battery impact

#### 6. Quota Management (50MB IndexedDB Limit)

**Auto-Cleanup Strategy:**
```typescript
export async function checkStorageQuota() {
  if (navigator.storage?.estimate) {
    const quota = await navigator.storage.estimate();
    const usage = quota.usage || 0;
    const limit = quota.quota || 0;
    const percentUsed = (usage / limit) * 100;

    if (percentUsed > 80) {
      // Cleanup: Delete synced scans older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await db.scan_queue
        .where('synced').equals(true)
        .filter(s => s.synced_at && s.synced_at < sevenDaysAgo)
        .delete();
    }

    return percentUsed;
  }
}
```

**Cleanup Trigger Points:**
- **80% usage**: Auto-cleanup synced scans older than 7 days
- **90% usage**: Auto-cleanup synced scans older than 3 days
- **95% usage**: Show warning toast "Storage limit reached, clear cache"
- **100% usage**: Block new scans, force manual cleanup

**Why 7-Day Retention?**
- **Business requirement**: Operators may need to verify scans from previous shifts
- **Audit trail**: 7 days covers typical dispute resolution timeframe
- **Storage optimization**: Average scan = 500 bytes → 50MB = 100K scans → 7 days = ~14K scans/day = 1750 scans/shift (well within limit)

---

### 📂 Source Tree Components to Touch

**Files to Create:**
```
apps/frontend/
├── src/
│   ├── lib/
│   │   ├── db.ts                           # CREATE - Dexie database schema
│   │   ├── sync-manager.ts                 # CREATE - Background sync logic
│   │   └── sw.ts                           # CREATE - Custom service worker
│   └── components/
│       └── ConnectionStatusBanner.tsx      # CREATE - Connection UI
├── public/
│   ├── manifest.json                       # CREATE - PWA manifest
│   ├── icon-192.png                        # CREATE - App icon (192x192)
│   ├── icon-512.png                        # CREATE - App icon (512x512)
│   └── apple-touch-icon.png                # CREATE - iOS icon (180x180)
└── __tests__/
    ├── db.test.ts                          # CREATE - IndexedDB tests
    ├── sync-manager.test.ts                # CREATE - Sync manager tests
    └── e2e/
        └── offline-workflow.spec.ts        # CREATE - E2E offline test
```

**Files to Modify:**
```
apps/frontend/
├── next.config.js                          # UPDATE - Add Serwist config
├── app/layout.tsx                          # UPDATE - Add SW registration, manifest link, ConnectionStatusBanner
└── package.json                            # VERIFY - Dependencies already present
```

**Dependencies (Already in package.json):**
- ✅ `@serwist/next: ^9.5.5`
- ✅ `serwist: ^9.5.5`
- ✅ `dexie: ^4.3.0`
- ✅ `fake-indexeddb: ^6.2.5` (for testing)

---

### 🧪 Testing Standards Summary

**Unit Tests (Vitest):**
```typescript
// __tests__/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db, ScanQueue, getUnsynced, markSynced } from '@/lib/db';
import { FDBFactory } from 'fake-indexeddb';

// Mock IndexedDB with fake-indexeddb
beforeEach(() => {
  global.indexedDB = new FDBFactory();
});

describe('IndexedDB Operations', () => {
  it('should save and retrieve scan', async () => {
    const scan: ScanQueue = {
      id: '1',
      manifest_id: 'm1',
      order_id: 'o1',
      barcode_scanned: '123456',
      scan_status: 'success',
      scanned_at: new Date(),
      synced: false,
      operator_id: 'op1',
      user_id: 'u1',
      created_at: new Date()
    };

    await db.scan_queue.add(scan);
    const retrieved = await db.scan_queue.get('1');

    expect(retrieved).toMatchObject(scan);
  });

  it('should query unsynced scans', async () => {
    // Add synced and unsynced scans
    await db.scan_queue.bulkAdd([
      { id: '1', synced: false, manifest_id: 'm1', ... },
      { id: '2', synced: true, manifest_id: 'm1', ... },
      { id: '3', synced: false, manifest_id: 'm1', ... }
    ]);

    const unsynced = await getUnsynced();
    expect(unsynced.length).toBe(2);
    expect(unsynced.every(s => !s.synced)).toBe(true);
  });

  it('should mark scans as synced', async () => {
    await db.scan_queue.bulkAdd([
      { id: '1', synced: false, ... },
      { id: '2', synced: false, ... }
    ]);

    await markSynced(['1', '2']);

    const allSynced = await db.scan_queue.toArray();
    expect(allSynced.every(s => s.synced)).toBe(true);
  });

  it('should cleanup old synced scans', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await db.scan_queue.bulkAdd([
      { id: '1', synced: true, synced_at: eightDaysAgo, ... },
      { id: '2', synced: true, synced_at: new Date(), ... }
    ]);

    await clearOldSynced(7);

    const remaining = await db.scan_queue.toArray();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('2');
  });
});
```

**E2E Tests (Playwright):**
```typescript
// __tests__/e2e/offline-workflow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PWA Offline Workflow', () => {
  test('should register service worker on load', async ({ page }) => {
    await page.goto('http://localhost:3000');

    const swRegistered = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration().then(reg => !!reg);
    });

    expect(swRegistered).toBe(true);
  });

  test('should show offline banner when disconnected', async ({ page, context }) => {
    await page.goto('http://localhost:3000');

    // Go offline
    await context.setOffline(true);

    const banner = await page.locator('[data-testid="connection-banner"]');
    await expect(banner).toHaveText(/Offline/);
  });

  test('should queue scans offline and sync when online', async ({ page, context }) => {
    await page.goto('http://localhost:3000/pickup/manifest/m1');

    // Go offline
    await context.setOffline(true);

    // Perform scan
    await page.fill('[data-testid="scan-input"]', '123456789');
    await page.click('[data-testid="scan-button"]');

    // Verify optimistic UI
    const progressBar = await page.locator('[data-testid="progress"]');
    await expect(progressBar).toHaveAttribute('aria-valuenow', '1');

    // Verify offline banner shows queue count
    const banner = await page.locator('[data-testid="connection-banner"]');
    await expect(banner).toHaveText(/Offline - 1 scans queued/);

    // Go online
    await context.setOffline(false);

    // Verify sync starts
    await expect(banner).toHaveText(/Syncing.../);
    await expect(banner).toHaveText(/Online/, { timeout: 10000 });
  });

  test('should persist scans in IndexedDB across page reloads', async ({ page, context }) => {
    await page.goto('http://localhost:3000/pickup/manifest/m1');

    // Go offline
    await context.setOffline(true);

    // Perform scan
    await page.fill('[data-testid="scan-input"]', '123456789');
    await page.click('[data-testid="scan-button"]');

    // Reload page
    await page.reload();

    // Verify scan still in queue
    const banner = await page.locator('[data-testid="connection-banner"]');
    await expect(banner).toHaveText(/Offline - 1 scans queued/);
  });
});
```

---

### 🔍 Previous Story Intelligence (Story 1.1 Razikus Foundation)

**Story 1.1 Deliverables Story 1.5 REQUIRES:**

| Story 1.1 Output | How Story 1.5 Uses It |
|------------------|----------------------|
| **Next.js 14 App Router** | Service worker integrates via `app/layout.tsx`, PWA manifest in `<head>` |
| **Supabase Auth** | JWT tokens used in Background Sync API calls (auth header) |
| **TypeScript configuration** | Service worker written in TypeScript (`src/lib/sw.ts`) |
| **Vercel deployment** | Service worker served via CDN, cached with hash-based invalidation |

**Razikus Template PWA Gaps (Story 1.5 Fills):**
- ❌ No service worker (Story 1.5 adds Serwist)
- ❌ No offline capability (Story 1.5 adds IndexedDB + Background Sync)
- ❌ No PWA manifest (Story 1.5 adds manifest.json + icons)
- ❌ No caching strategies (Story 1.5 adds cache-first, network-first patterns)

---

### 🌐 Latest Technical Information (2026 PWA Best Practices)

**Serwist vs Workbox (2026 Recommendation):**
- **Serwist**: Modern, Next.js-native, TypeScript-first → **RECOMMENDED**
- **Workbox**: Older, webpack-based, community-maintained → Avoid for new projects
- **Migration**: Workbox → Serwist takes ~2 hours (config differences minimal)

**Background Sync API Support (2026):**
- **Chrome/Edge**: Full support since v80 (2020)
- **Safari**: Full support since v15.4 (2022)
- **Firefox**: Full support since v78 (2020)
- **Coverage**: 94% of users (caniuse.com)
- **Fallback**: Use 'online' event listener for remaining 6%

**IndexedDB Quota Limits (2026):**
- **Desktop Chrome**: 60% of available disk space (typically 100-500GB)
- **Mobile Chrome**: 20% of available storage (typically 2-10GB)
- **Safari**: 1GB hard limit (iOS) or 20% of device storage (macOS)
- **Firefox**: 50% of available storage
- **Recommendation**: Stay under 50MB for PWA apps (covers 100K scans)

**Service Worker Update Strategy (2026):**
- **Update Check Frequency**: Every 24 hours (browser default)
- **Force Update**: `navigator.serviceWorker.getRegistration().then(reg => reg.update())` every 60 seconds
- **skipWaiting Pattern**: Recommended for production PWAs (immediate updates)
- **Alternative**: Show "Update Available" banner, let user trigger update

---

### 📚 References

**Epic and Story Definition:**
- [Source: _bmad-output/planning-artifacts/epics.md - Epic 1: Platform Foundation & Multi-Tenant SaaS Setup]
- [Source: _bmad-output/planning-artifacts/epics.md - Story 1.5: Add PWA Enhancement Layer]

**Architecture Specifications:**
- [Source: _bmad-output/planning-artifacts/architecture.md - PWA Enhancement Layer (Serwist + IndexedDB)]
- [Source: _bmad-output/planning-artifacts/architecture.md - Caching Strategy (Multi-Layer)]
- [Source: _bmad-output/planning-artifacts/architecture.md - Offline-First Patterns]

**Previous Story Learnings:**
- [Source: _bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md - Next.js 14 App Router foundation]
- [Source: _bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md - TypeScript configuration]

**External References (2026 Best Practices):**
- [Serwist Documentation](https://serwist.pages.dev/)
- [Dexie.js Documentation](https://dexie.org/)
- [Background Sync API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Sync_API)
- [Service Worker Lifecycle - web.dev](https://web.dev/service-worker-lifecycle/)
- [IndexedDB Best Practices - web.dev](https://web.dev/indexeddb-best-practices/)

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

---

**🚀 This comprehensive story file provides:**
- ✅ Complete Epic 1 context and Story 1.5 acceptance criteria
- ✅ Latest 2026 Serwist patterns (vs deprecated Workbox)
- ✅ Critical dependencies on Story 1.1 (Razikus template foundation)
- ✅ Service worker lifecycle and caching strategies
- ✅ Detailed task breakdown with AC mapping (8 tasks, 32 subtasks)
- ✅ IndexedDB schema with Dexie.js patterns
- ✅ Background Sync with exponential backoff retry logic
- ✅ Connection status UI component
- ✅ Testing strategies (unit tests with fake-indexeddb, E2E with Playwright)
- ✅ Quota management and auto-cleanup patterns

**Developer: You have everything needed for building production-ready offline-first PWA. Zero guessing required!**
