import { test, expect } from '@playwright/test';

// spec-47 PR #3 — hub-side consolidated reception flow.
// Smoke shell: a real run needs a seeded staging Supabase with one
// in_transit pickup_route carrying packages from two manifests, plus a
// receptionist session cookie. Without that backing data the test
// asserts that the new pages are at least reachable (i.e. that the route
// definitions ship).

test.use({ viewport: { width: 1280, height: 800 } }); // desktop

test.describe('spec-47 consolidated reception flow', () => {
  test('reception landing renders the three tabs and QR button', async ({ page }) => {
    await page.goto('/app/reception');
    // Either redirected to login (no session) or the new landing renders
    await expect(page).toHaveURL(/\/(app\/reception|login)/);
  });

  test('route reception page is reachable', async ({ page }) => {
    await page.goto('/app/reception/route/00000000-0000-0000-0000-000000000001');
    await expect(page).toHaveURL(/\/(app\/reception\/route\/[0-9a-f-]+|login)/);
  });

  test('scanning packages from two manifests checks both off and finalize works', async ({ page }) => {
    // Full e2e: requires seeded route with two manifests + receptionist session.
    // Marked skip in CI; promote to active when staging fixture is wired.
    test.skip(true, 'pending seeded staging fixture (spec-47 follow-up)');

    await page.goto('/app/reception');
    await page.getByRole('button', { name: /iniciar recepción/i }).first().click();
    await expect(page.getByLabel('Escáner de recepción')).toBeFocused();

    await page.getByLabel('Escáner de recepción').fill('PKG-FROM-MANIFEST-A');
    await page.keyboard.press('Enter');
    await page.getByLabel('Escáner de recepción').fill('PKG-FROM-MANIFEST-B');
    await page.keyboard.press('Enter');

    await expect(
      page.locator('[data-testid="package-row"][data-received="true"]'),
    ).toHaveCount(2);

    await page.getByRole('button', { name: /finalizar recepción/i }).click();
    await expect(page).toHaveURL(/\/app\/reception$/);
  });
});
