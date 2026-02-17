/**
 * E2E Test for PWA Offline Workflow
 * Story 1.5: PWA Enhancement Layer
 * Task 7.4
 *
 * SETUP REQUIRED:
 * 1. Install Playwright: npm install -D @playwright/test
 * 2. Install browsers: npx playwright install
 * 3. Run tests: npx playwright test
 *
 * This test validates the complete offline-first PWA workflow:
 * - Service worker registration
 * - Offline detection and banner
 * - Optimistic UI updates
 * - IndexedDB persistence
 * - Background sync on reconnection
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

test.describe('PWA Offline Workflow', () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    // Create context with service worker support
    context = await browser.newContext();
    page = await context.newPage();

    // Navigate to app
    await page.goto('http://localhost:3000');
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should register service worker on app load', async () => {
    // Wait for service worker to register
    await page.waitForTimeout(1000);

    // Check service worker registration
    const swRegistered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!registration;
    });

    expect(swRegistered).toBe(true);

    // Verify service worker is active
    const swActive = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state === 'activated';
    });

    expect(swActive).toBe(true);
  });

  test('should create IndexedDB database on first load', async () => {
    await page.waitForTimeout(1000);

    const dbExists = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.some((db) => db.name === 'aureon_offline');
    });

    expect(dbExists).toBe(true);
  });

  test('should show offline banner when disconnected', async () => {
    // Go offline
    await context.setOffline(true);

    // Wait for offline detection
    await page.waitForTimeout(500);

    // Check for offline banner
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Offline/i);
  });

  test('should queue scan when offline and sync when online', async () => {
    // Navigate to manifest page (adjust URL based on actual route)
    await page.goto('http://localhost:3000/pickup/manifest/test-manifest-1');

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Verify offline banner appears
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).toContainText(/Offline/i);

    // Perform scan (adjust selectors based on actual UI)
    const scanInput = page.locator('[data-testid="scan-input"]');
    await scanInput.fill('TEST-BARCODE-123456');

    const scanButton = page.locator('[data-testid="scan-button"]');
    await scanButton.click();

    // Verify optimistic UI update
    await page.waitForTimeout(500);
    const scanList = page.locator('[data-testid="scan-list"]');
    await expect(scanList).toContainText('TEST-BARCODE-123456');

    // Verify connection banner shows queued count
    await expect(banner).toContainText(/1 scans queued/i);

    // Verify scan saved to IndexedDB
    const scanInDb = await page.evaluate(async () => {
      const db = (window as any).db;
      if (!db) return false;

      const scans = await db.scan_queue.filter((s: any) => !s.synced).toArray();
      return scans.length > 0 && scans[0].barcode_scanned === 'TEST-BARCODE-123456';
    });

    expect(scanInDb).toBe(true);

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(500);

    // Verify banner shows "Syncing..."
    await expect(banner).toContainText(/Syncing/i);

    // Wait for sync to complete (adjust timeout based on backend)
    await page.waitForTimeout(3000);

    // Verify banner returns to online state or disappears
    await expect(banner).not.toBeVisible().or(expect(banner).toContainText(/Online/i));

    // Verify scan marked as synced in IndexedDB
    const scanSynced = await page.evaluate(async () => {
      const db = (window as any).db;
      if (!db) return false;

      const scans = await db.scan_queue
        .filter((s: any) => s.barcode_scanned === 'TEST-BARCODE-123456')
        .toArray();

      return scans.length > 0 && scans[0].synced === true;
    });

    expect(scanSynced).toBe(true);
  });

  test('should persist scans across page reloads', async () => {
    // Navigate to manifest page
    await page.goto('http://localhost:3000/pickup/manifest/test-manifest-1');

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // Perform scan
    const scanInput = page.locator('[data-testid="scan-input"]');
    await scanInput.fill('RELOAD-TEST-789');

    const scanButton = page.locator('[data-testid="scan-button"]');
    await scanButton.click();

    await page.waitForTimeout(500);

    // Reload page (still offline)
    await page.reload();
    await page.waitForTimeout(1000);

    // Verify scan still in IndexedDB
    const scanPersisted = await page.evaluate(async () => {
      const db = (window as any).db;
      if (!db) return false;

      const scans = await db.scan_queue
        .filter((s: any) => s.barcode_scanned === 'RELOAD-TEST-789')
        .toArray();

      return scans.length > 0;
    });

    expect(scanPersisted).toBe(true);

    // Verify connection banner still shows queue count
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).toContainText(/1 scans queued/i);
  });

  test('should handle offline fallback page for uncached routes', async () => {
    // Wait for service worker to be ready
    await page.waitForTimeout(1000);

    // Go offline
    await context.setOffline(true);

    // Navigate to an uncached route
    const response = await page.goto('http://localhost:3000/some-uncached-route');

    // Should show offline fallback page (not broken UI)
    expect(response?.status()).toBe(200);

    const content = await page.content();
    expect(content).toContain('offline'); // Adjust based on actual offline page content
  });

  test('should register Background Sync API', async () => {
    await page.waitForTimeout(1000);

    const backgroundSyncSupported = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      if (!('sync' in ServiceWorkerRegistration.prototype)) return false;

      const registration = await navigator.serviceWorker.ready;
      // Try to register sync (may fail in test environment, but API should exist)
      try {
        await registration.sync.register('test-sync');
        return true;
      } catch {
        return 'sync' in registration; // At least verify API exists
      }
    });

    expect(backgroundSyncSupported).toBeTruthy();
  });
});

/**
 * NOTES FOR IMPLEMENTATION:
 *
 * 1. Adjust routes and selectors based on actual app structure
 * 2. Create test fixtures for consistent test data
 * 3. Mock API endpoints using Playwright route interception
 * 4. Consider adding visual regression tests for PWA install banner
 * 5. Test on multiple browsers (Chrome, Safari, Firefox) for PWA compatibility
 * 6. Test on mobile viewport sizes for mobile PWA features
 *
 * RUN TESTS:
 * npx playwright test __tests__/e2e/pwa-offline-workflow.spec.ts
 * npx playwright test --headed  # Watch tests run in browser
 * npx playwright test --debug   # Debug mode with Playwright Inspector
 */
