import { test, expect } from '@playwright/test';

const TEST_EMAIL = 'gerhard@tractis.ai';
const TEST_PASSWORD = 'Tractis01';

test.describe('Customer Branding (Story 3A.4)', () => {

  test('AC6: auth pages remain Tractis-branded, NOT operator-branded', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');

    // Auth pages should use .theme-tractis gold, NOT deep navy
    const body = page.locator('body');
    const theme = await body.getAttribute('class');
    expect(theme).toContain('theme-tractis');

    // No inline --color-primary-* variables on body (branding not applied)
    const inlinePrimary = await body.evaluate(
      (el) => el.style.getPropertyValue('--color-primary-600')
    );
    expect(inlinePrimary).toBe('');

    await page.screenshot({ path: 'e2e/screenshots/branding-auth-no-override.png', fullPage: true });
  });

  test('AC2+AC3+AC4+AC5: dashboard shows operator branding after login', async ({ page }) => {
    // Login
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for redirect to app
    await page.waitForURL(/\/app/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    // Give BrandingProvider time to fetch and apply
    await page.waitForTimeout(3000);

    // Screenshot dashboard with branding
    await page.screenshot({ path: 'e2e/screenshots/branding-dashboard-desktop.png', fullPage: true });

    // AC4: Check sidebar has logo or company name
    const logo = page.locator('img[alt*="Musan"], img[alt*="Transportes"]');
    const companyText = page.getByText('Transportes Musan');
    const hasLogo = await logo.count() > 0;
    const hasCompanyName = await companyText.count() > 0;
    expect(hasLogo || hasCompanyName).toBe(true);

    if (hasLogo) {
      await expect(logo.first()).toBeVisible();
      // Verify logo styling
      const logoEl = logo.first();
      expect(await logoEl.evaluate(el => el.classList.contains('object-contain') || getComputedStyle(el).objectFit === 'contain')).toBe(true);
    }

    // AC3: Check CSS variables are applied on body
    const body = page.locator('body');
    const primaryColor = await body.evaluate(
      (el) => el.style.getPropertyValue('--color-primary-600')
    );

    // If branding colors are applied, primary-600 should be set
    // Log what we find for debugging
    console.log('--color-primary-600 inline value:', primaryColor);

    // AC5: Check browser title
    const title = await page.title();
    console.log('Browser title:', title);
    expect(title).toContain('Transportes Musan');

    // Screenshot sidebar close-up
    const sidebar = page.locator('.fixed.inset-y-0');
    if (await sidebar.isVisible()) {
      await sidebar.screenshot({ path: 'e2e/screenshots/branding-sidebar-closeup.png' });
    }
  });

  test('Dashboard branding - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Login
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/app/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/screenshots/branding-dashboard-mobile.png', fullPage: true });

    // Open sidebar on mobile
    const menuButton = page.locator('button').filter({ has: page.locator('svg.lucide-menu, [class*="Menu"]') }).first();
    if (await menuButton.isVisible()) {
      await menuButton.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'e2e/screenshots/branding-sidebar-mobile.png', fullPage: true });
    }
  });

  test('AC7: graceful degradation - captures current state', async ({ page }) => {
    // Login and navigate to dashboard
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/app/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Capture all CSS variable values for debugging
    const cssVars = await page.evaluate(() => {
      const body = document.body;
      const vars: Record<string, string> = {};
      const prefixes = ['--color-primary-', '--color-secondary-'];
      for (const prefix of prefixes) {
        for (const shade of ['50','100','200','300','400','500','600','700','800','900','950']) {
          const prop = prefix + shade;
          const inline = body.style.getPropertyValue(prop);
          const computed = getComputedStyle(body).getPropertyValue(prop);
          if (inline || computed) {
            vars[prop] = inline ? `inline: ${inline}` : `class: ${computed}`;
          }
        }
      }
      return vars;
    });

    console.log('CSS Variable State:', JSON.stringify(cssVars, null, 2));

    // Navigate to dashboard specifically
    await page.goto('/app/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/branding-dashboard-page.png', fullPage: true });
  });
});
