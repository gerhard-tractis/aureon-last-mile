import { test, expect } from '@playwright/test';

test.describe('Auth Pages Visual Test', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');

    // Screenshot full page
    await page.screenshot({
      path: 'e2e/screenshots/login-full.png',
      fullPage: true
    });

    // Check key elements exist
    await expect(page.locator('h2')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');

    await page.screenshot({
      path: 'e2e/screenshots/register-full.png',
      fullPage: true
    });

    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('forgot-password page renders correctly', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.waitForLoadState('networkidle');

    await page.screenshot({
      path: 'e2e/screenshots/forgot-password-full.png',
      fullPage: true
    });

    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('login page - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');

    await page.screenshot({
      path: 'e2e/screenshots/login-mobile.png',
      fullPage: true
    });
  });
});
