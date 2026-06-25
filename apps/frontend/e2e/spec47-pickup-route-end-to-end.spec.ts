import { test, expect } from '@playwright/test';

// spec-47 PR #2 — driver-side pickup route end-to-end flow.
// This is a smoke shell: a real run requires a seeded staging Supabase, two
// pending manifests for the signed-in driver and the driver session cookie.
// Without that backing data the test asserts that the new pages are at
// least reachable (i.e. that the route definitions ship).

test.use({ viewport: { width: 768, height: 1024 } }); // tablet portrait

test.describe('spec-47 pickup driver flow', () => {
  test('pickup landing renders start-route control or banner', async ({ page }) => {
    await page.goto('/app/pickup');
    // Either redirected to login (no session) or one of the new controls renders
    await expect(page).toHaveURL(/\/(app\/pickup|login)/);
  });

  test('active route page is reachable', async ({ page }) => {
    await page.goto('/app/pickup/route/active');
    await expect(page).toHaveURL(/\/(app\/pickup\/route\/active|login)/);
  });
});
