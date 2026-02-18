/**
 * E2E Test for Order Import Flow
 * Story 2.2: Build CSV/Excel Upload Interface with Validation
 *
 * Prerequisites:
 * - Playwright installed and configured
 * - Running Next.js dev server
 * - Authenticated user with admin or operations_manager role
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const TEST_DATA_DIR = path.join(__dirname, '..', 'test-data');

test.describe('Order Import', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to import page (assumes authenticated session)
    await page.goto('/app/orders/import');
  });

  test('should upload valid CSV and import orders successfully', async ({ page }) => {
    // Upload file
    const uploadInput = page.locator('input[type="file"]');
    await uploadInput.setInputFiles(path.join(TEST_DATA_DIR, 'valid-orders.csv'));

    // Wait for preview table
    await expect(page.locator('table')).toBeVisible();

    // Should show valid row count
    await expect(page.locator('text=2 valid rows')).toBeVisible();

    // Click import button
    await page.click('button:has-text("Import 2 Valid Orders")');

    // Check success message
    await expect(page.locator('text=Imported 2 orders successfully')).toBeVisible({ timeout: 10000 });
  });

  test('should display validation errors for invalid CSV', async ({ page }) => {
    const uploadInput = page.locator('input[type="file"]');
    await uploadInput.setInputFiles(path.join(TEST_DATA_DIR, 'invalid-orders.csv'));

    // Wait for preview
    await expect(page.locator('table')).toBeVisible();

    // Should show errors
    await expect(page.locator('text=Phone must be 9 digits')).toBeVisible();
    await expect(page.locator('text=errors')).toBeVisible();

    // Export failed rows button should be visible
    await expect(page.locator('button:has-text("Export Failed Rows")')).toBeVisible();
  });

  test('should show duplicate order errors from database', async ({ page }) => {
    // First import
    const uploadInput = page.locator('input[type="file"]');
    await uploadInput.setInputFiles(path.join(TEST_DATA_DIR, 'valid-orders.csv'));
    await expect(page.locator('table')).toBeVisible();
    await page.click('button:has-text("Import")');
    await expect(page.locator('text=Imported')).toBeVisible({ timeout: 10000 });

    // Navigate back and re-import same file
    await page.goto('/app/orders/import');
    const uploadInput2 = page.locator('input[type="file"]');
    await uploadInput2.setInputFiles(path.join(TEST_DATA_DIR, 'valid-orders.csv'));
    await expect(page.locator('table')).toBeVisible();

    // Should detect database duplicates after server-side validation
    await page.click('button:has-text("Import")');
    await expect(page.locator('text=already exists')).toBeVisible({ timeout: 10000 });
  });
});
