/**
 * spec-95 ronda 2 — the E2E coverage every phase of that spec declared
 * missing: "`e2e-qa` no se leyó por separado en esta fase" repeats on every
 * `[done]` phase because no spec52-shaped suite ever drove the nine
 * screens it rebuilt. This file is that suite for the driver-facing mobile
 * surfaces (`5a` client chips, `5c` group chip + footer, `5d` scan screen).
 *
 * It reuses spec-52's own seed/teardown namespace (`PREFIX 'E2E52'`, same
 * `DRIVER`), exactly like `reception-mobile.spec.ts` already does — the two
 * suites never run concurrently under `playwright.qa.config.ts`'s
 * `workers: 1` + serial execution, so sharing the namespace is safe and
 * avoids yet another fixture file for the same tenant/user shape.
 *
 * The single browser context switches viewport mid-suite
 * (`page.setViewportSize`) rather than opening a fresh context per screen
 * width: `/app/pickup` and `/app/pickup/route/active` both branch on the
 * `lg` breakpoint inside ONE React tree, and resizing preserves the
 * driver's session and the route already created, which two separate
 * contexts would not.
 *
 * PREREQUISITE this suite depends on and does not itself verify: PR #772
 * (`fix/recogida-escaneo-viewport-movil`) must be merged, or the scan
 * screen's own known 672px-on-375px bug will fail this suite's overflow
 * checks for a DIFFERENT reason than the one this file exists to catch.
 * spec-95 fase 5's heading records it merged before fase 5 landed.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  seed, teardown, closeDb, signIn, scanUntilStatus, activeRoute,
  suppressCookieBanner, DRIVER, PLATE, LOADS, PREFIX,
  PICKUP_SCANNER_LABEL,
} from './support/spec52-fixture';
import { assertNoHorizontalOverflow, assertNoEnglishLeftovers } from './support/viewportChecks';

const MOBILE = { width: 390, height: 844 };
const MOBILE_FLOOR = { width: 320, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** `LOADS[0]` is Alfa Retail's first carga — used throughout as "the one
 *  the driver actually touches", so the group-chip test and the custody
 *  test share one real scan instead of each fabricating its own state. */
const ALFA_LOAD = LOADS[0];
const ALFA_LOAD_FIRST_PACKAGE = `${PREFIX}-A1-P1`;

test.describe.configure({ mode: 'serial' });

test.describe('spec-95 ronda 2 — Recogida mobile (5a, 5c, 5d)', () => {
  let driverCtx: BrowserContext;
  let driver: Page;

  test.beforeAll(async ({ browser }) => {
    await seed();
    driverCtx = await browser.newContext({ viewport: DESKTOP });
    await suppressCookieBanner(driverCtx);
    driver = await driverCtx.newPage();
    await signIn(driver, DRIVER);
  });

  // Every test below that opens a pickup route does so through this ONE
  // context/page, so a single teardown() here is what closes it — same
  // guarantee `spec52-pickup-reception-end-to-end.spec.ts` and
  // `reception-mobile.spec.ts` give: teardown() hard-deletes the route (and
  // everything hanging off it) by vehicle plate, regardless of which test
  // in this file last touched it or whether an assertion above failed.
  // `afterAll` runs even when a `test()` in this describe block fails, so
  // this is this suite's `finally` for the route it opens.
  test.afterAll(async () => {
    await driverCtx?.close();
    await teardown();
    await closeDb();
  });

  test('5a — desktop client chips count the visible bucket, not the union', async () => {
    test.setTimeout(60_000);
    await driver.goto('/app/pickup');

    // QA is a shared environment — other sessions/operators can leave rows
    // for a retailer of the same name in the same bucket, so the fixture's
    // absolute counts ("Alfa Retail · 2") are not guaranteed. Read each
    // chip's own count from its label instead of asserting a number, then
    // check the invariant the fase 8 review actually found broken: a
    // chip's count used to be the union across all four tabs, so pressing
    // it could open a table showing more or fewer rows than the label
    // claimed. Assert the number on the chip MATCHES what the table
    // actually renders when the chip is pressed.
    const alfaChip = driver.getByRole('button', { name: /^Alfa Retail · \d+$/ });
    await expect(alfaChip).toBeVisible();
    const alfaLabel = (await alfaChip.textContent()) ?? '';
    const alfaCount = Number(alfaLabel.match(/· (\d+)$/)?.[1]);
    expect(alfaCount, `chip label was "${alfaLabel}"`).toBeGreaterThan(0);
    await alfaChip.click();
    await expect(driver.getByTestId('manifest-row')).toHaveCount(alfaCount);

    const betaChip = driver.getByRole('button', { name: /^Beta Comercial · \d+$/ });
    await expect(betaChip).toBeVisible();
    const betaLabel = (await betaChip.textContent()) ?? '';
    const betaCount = Number(betaLabel.match(/· (\d+)$/)?.[1]);
    expect(betaCount, `chip label was "${betaLabel}"`).toBeGreaterThan(0);
    await betaChip.click();
    await expect(driver.getByTestId('manifest-row')).toHaveCount(betaCount);
  });

  test('opens the route from the mobile screen at 390px', async () => {
    test.setTimeout(120_000);
    await driver.setViewportSize(MOBILE);
    await driver.goto('/app/pickup');
    await expect(driver.getByTestId('pickup-mobile-start-route')).toBeVisible();

    for (const load of LOADS) {
      const checkbox = driver.getByRole('checkbox', { name: `Seleccionar ${load.loadId}` });
      await expect(checkbox).toBeVisible();
      await checkbox.click();
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    }

    await driver.locator('#vehicle-select').click();
    await driver.getByRole('option', { name: new RegExp(PLATE) }).click();
    await driver.getByRole('button', { name: 'Iniciar ruta de recogida' }).click();

    await driver.waitForURL('**/app/pickup/route/active', { timeout: 30_000 });
    const route = await activeRoute();
    expect(route.status).toBe('in_progress');
  });

  test('no element overflows /app/pickup (mobile) at 390px or 320px', async () => {
    test.setTimeout(60_000);
    await driver.setViewportSize(MOBILE);
    await driver.goto('/app/pickup');
    // 3h — the active-route tree, not 3j: proves this is genuinely the
    // screen under test, not an empty/error state that trivially has
    // nothing to overflow.
    await expect(driver.getByTestId('pickup-mobile-view')).toBeVisible();
    await assertNoHorizontalOverflow(driver, '/app/pickup at 390px');

    await driver.setViewportSize(MOBILE_FLOOR);
    await assertNoHorizontalOverflow(driver, '/app/pickup at 320px');
  });

  test('no element overflows route/active at 390px or 320px, including the footer "+"',
    async () => {
      test.setTimeout(60_000);
      await driver.setViewportSize(MOBILE);
      await driver.goto('/app/pickup/route/active');
      await expect(driver.getByTestId('active-route-page')).toBeVisible();

      // Reveals the two-row footer AND the manifest list/group chips — the
      // exact state the reported bug lived in (`RouteFooterTopRow`'s `+`
      // clipped 108px past the right edge at 390px).
      await driver
        .getByRole('button', { name: /Ver los \d+ manifiestos|Ver el manifiesto/ })
        .click();
      await expect(driver.getByTestId('route-manifest-list')).toBeVisible();

      await assertNoHorizontalOverflow(driver, '/app/pickup/route/active at 390px');
      // The exact control the bug report named, checked directly: entirely
      // clipped fails `toBeInViewport()`'s default (any-pixel-visible) check.
      await expect(driver.getByTestId('open-add-manifest')).toBeInViewport();

      await driver.setViewportSize(MOBILE_FLOOR);
      await assertNoHorizontalOverflow(driver, '/app/pickup/route/active at 320px');
      await expect(driver.getByTestId('open-add-manifest')).toBeInViewport();
    });

  test('group chip: a carga with an open scan reads EN RUTA, an untouched one PENDIENTE',
    async () => {
      test.setTimeout(120_000);
      await driver.setViewportSize(MOBILE);
      await driver.goto(`/app/pickup/scan/${ALFA_LOAD.loadId}`);
      await expect(driver.getByLabel(PICKUP_SCANNER_LABEL)).toBeVisible();
      // ONE of Alfa's two packages — verified_count > 0 but the carga stays
      // open (1 of 2), which is exactly the "started, unclosed" branch of
      // the rule spec-95 fase 1 fixed.
      await scanUntilStatus(driver, PICKUP_SCANNER_LABEL, ALFA_LOAD_FIRST_PACKAGE, 'verificado');

      await driver.goto('/app/pickup/route/active');
      await driver
        .getByRole('button', { name: /Ver los \d+ manifiestos|Ver el manifiesto/ })
        .click();

      const groups = driver.getByTestId('route-manifest-group');
      const alfaGroup = groups.filter({ hasText: 'Alfa Retail' });
      const betaGroup = groups.filter({ hasText: 'Beta Comercial' });
      await expect(alfaGroup.getByTestId('route-manifest-group-status'), 'Alfa: started, unclosed')
        .toHaveText('EN RUTA', { timeout: 15_000 });
      await expect(betaGroup.getByTestId('route-manifest-group-status'), 'Beta: never touched')
        .toHaveText('PENDIENTE', { timeout: 15_000 });
    });

  test('no overflow and no English leftovers on the scan screen at 390px or 320px',
    async () => {
      test.setTimeout(60_000);
      await driver.setViewportSize(MOBILE);
      await driver.goto(`/app/pickup/scan/${ALFA_LOAD.loadId}`);
      await expect(driver.getByLabel(PICKUP_SCANNER_LABEL)).toBeVisible();
      // Settled state, not the loading skeleton — `toHaveCount(0)` passes
      // whether the loading block ever mounted or already unmounted.
      await expect(driver.getByTestId('manifest-detail-loading')).toHaveCount(0);

      await assertNoHorizontalOverflow(driver, '/app/pickup/scan/[loadId] at 390px');
      await assertNoEnglishLeftovers(driver, '/app/pickup/scan/[loadId] at 390px');

      await driver.setViewportSize(MOBILE_FLOOR);
      await assertNoHorizontalOverflow(driver, '/app/pickup/scan/[loadId] at 320px');
    });

  test('the custody notice never says "0 paquetes" once a package is verified', async () => {
    test.setTimeout(60_000);
    await driver.goto(`/app/pickup/complete/${ALFA_LOAD.loadId}`);

    // `custodyNoticeCopy()` — the sentence built from real counts, not the
    // static heading above it. Gated on presence of scan data (spec-95
    // fase 6's own fix for exactly this lie), so this can take a moment to
    // settle from the skeleton.
    const custodyLine = driver.locator('p', { hasText: 'custodia de Aureon' });
    await expect(custodyLine).toBeVisible({ timeout: 15_000 });
    await expect(custodyLine).not.toContainText('0 paquetes');
    await expect(custodyLine).toContainText('1 paquete verificado');
  });
});
