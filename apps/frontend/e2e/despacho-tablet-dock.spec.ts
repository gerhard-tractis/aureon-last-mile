/**
 * spec-78 Fase 4 item 10 — E2E for `3a`, the dock tablet scan loop, at its
 * real device viewport (1024x768 landscape). Same "nothing is mocked" rule
 * as despacho-crew-mobile.spec.ts (spec-76): real RPCs
 * (`create_seeded_route`, the scan endpoint's `validateScan`), real
 * `DispatchRouteScanSessionTablet` tree, no DispatchTrack call (dispatch is
 * never reached in this suite — the route never leaves `planned`, so
 * "Despachar a DispatchTrack" stays disabled throughout, its real
 * precondition, not a mock).
 *
 * Covers `2a`(via the API)/`2d`/`3a` — one crew, one route, one truck, one
 * accepted scan, one rejected scan, at the dock's own viewport, asserting
 * the tablet-specific tree (`isTabletDock` branch of
 * `DispatchRouteSurface.tsx`) rather than despacho-crew-mobile.spec.ts's
 * phone tree. Does not repeat 2a/2b/2c's UI assertions (route list, BORRADOR
 * chip, dock brief tiles) — those are already pinned there against the
 * SAME components (`DispatchRouteBeforeScan` is reused unchanged by `3a`,
 * per spec-78 decision 1's own text); this suite creates the route via the
 * API (openTabletRouteToLoad(), same shortcut despacho-journey.ts takes and
 * documents) and starts from `/app/dispatch/[routeId]?dock=1` directly, to
 * keep its own scope to what is actually new here: the tablet layout and
 * the dock's viewport.
 *
 * The viewport is the DEVICE'S 1024x768, not the app's usable space.
 * Spec-78's own Fase 4 item 11 names the difference: `AppLayout` draws a
 * 56px `TopBar` (`main`'s `h-[calc(100dvh-3.5rem)]`) plus a sidebar fixed
 * at 56px collapsed (default — `useSidebarPin`'s own default is
 * `unpinned`, unset `localStorage`) or 216px pinned, so real usable space
 * is 968x712 in the collapsed state this suite runs in (never 808x712 —
 * that is the pinned case item 11 names as the one to physically verify,
 * left outstanding). This suite asserts against the rendered layout at
 * that real 968x712, not a loosened stand-in for it.
 *
 * Runs only in the `e2e-qa` job — see despacho-crew-mobile.spec.ts's own
 * header for why (self-hosted VPS runner, QA's Postgres on :5433).
 *
 * One hand-managed browser context/page, not the fixture `page` — same
 * reasoning as despacho-crew-mobile.spec.ts's own header: `mode: 'serial'`
 * only orders tests, it does not keep the built-in fixture's page alive
 * across them, and this suite's crew session must survive from the first
 * test to the last.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { closeDb, suppressCookieBanner } from './support/spec52-fixture';
import {
  seed, teardown,
  VEHICLE_EXTERNAL_ID, PACKAGE_SCANNER_LABEL,
  ACCEPTED_PACKAGE, SECOND_ACCEPTED_PACKAGE, UNKNOWN_CODE, PACKAGES_TOTAL,
} from './support/despacho-tablet-fixture';
import { openTabletRouteToLoad } from './support/despacho-tablet-journey';

// The device, not the app's usable space — see this file's own header.
const DOCK_VIEWPORT = { width: 1024, height: 768 };

test.describe.configure({ mode: 'serial' });

test.describe('spec-78 Despacho dock tablet — 3a', () => {
  let ctx: BrowserContext;
  let page: Page;
  let routeId: string;
  let routeCode: string;

  test.beforeAll(async ({ browser }) => {
    await seed();
    ctx = await browser.newContext({ viewport: DOCK_VIEWPORT });
    // Same reasoning as despacho-crew-mobile.spec.ts's own comment: fixed
    // to the same bottom band as this screen's own action bar and would
    // swallow its clicks.
    await suppressCookieBanner(ctx);
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    await ctx?.close();
    await teardown();
    await closeDb();
  });

  test('2d — assigns the seeded truck at the dock viewport, before the flag is set', async () => {
    const route = await openTabletRouteToLoad(page);
    routeId = route.id;
    routeCode = route.code;

    // Deliberately WITHOUT ?dock=1 yet — a manager's shift-lead monitor at
    // this exact width must still get the desktop tree (decision 1's own
    // regression, already pinned by DispatchRouteSurface.test.tsx; this
    // E2E only confirms the real viewport does not accidentally satisfy
    // isTabletDock on its own before the flag exists).
    await page.goto(`/app/dispatch/${routeId}`);
    await expect(page.getByTestId('dispatch-route-scan-session-tablet')).toHaveCount(0);

    await page.getByRole('button', { name: 'Asignar camión y conductor' }).click();
    const radiogroup = page.getByRole('radiogroup', { name: 'Vehículos' });
    await expect(radiogroup).toBeVisible();
    await page.getByRole('radio', { name: new RegExp(`^${VEHICLE_EXTERNAL_ID}`) }).click();
    await page.getByRole('button', { name: 'Asignar y empezar carga' }).click();
    await expect(radiogroup).toBeHidden();
  });

  test('3a — marking this browser as a dock tablet swaps the layout at the same width', async () => {
    // `?dock=1` persists to localStorage (useIsDockDevice.ts) and is read
    // once on mount; a full navigation to the route with the query param
    // set is what a tablet provisioned once, on the wall, does exactly
    // once — same mechanism the hook's own header describes.
    await page.goto(`/app/dispatch/${routeId}?dock=1`);
    await page.getByRole('button', { name: 'Empezar a escanear' }).click();

    const session = page.getByTestId('dispatch-route-scan-session-tablet');
    await expect(session).toBeVisible();
    await expect(session).toContainText(routeCode);

    // Decision 5 — no page scroll: the loop fits inside 968x712 (collapsed
    // sidebar, this suite's default) without the DOCUMENT growing past the
    // viewport. Internal panels (side panel's own scroll region) may still
    // scroll — only the page must not.
    const overflowsPage = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1,
    );
    expect(overflowsPage, 'the dock loop must not force page-level scroll at 1024x768').toBe(false);

    // The scan field is focused ON LOAD, unprompted — decision 4/"LECTOR
    // LISTO" is information of first class because nobody re-focuses this
    // field by hand from three metres away.
    const scanner = page.getByLabel(PACKAGE_SCANNER_LABEL);
    await expect(scanner).toBeFocused();
    await expect(session).toContainText('LISTO');
  });

  test('3a — an accepted scan updates the counter and last read, and keeps the field armed', async () => {
    const counter = page.getByTestId('dispatch-scan-counter');
    await expect(counter).toContainText(`0 de ${PACKAGES_TOTAL}`);

    const scanner = page.getByLabel(PACKAGE_SCANNER_LABEL);
    await scanner.fill(ACCEPTED_PACKAGE);
    await scanner.press('Enter');

    await expect(counter).toContainText(`1 de ${PACKAGES_TOTAL}`);
    await expect(page.getByTestId('dispatch-scan-last-read')).toContainText('Cargado en la ruta');

    // Armed straight after an ACCEPTED read — `refocusPackageField()` /
    // `ScanField`'s own focus retention, verified via real focus and the
    // reader-status label rather than inferred from the next `fill()`
    // silently refocusing it itself (same reasoning
    // despacho-crew-mobile.spec.ts's own comment gives for this exact
    // assertion).
    await expect(scanner).toBeFocused();
    await expect(page.getByTestId('dispatch-route-scan-session-tablet')).toContainText('LISTO');
  });

  test('3a — a rejected scan shows its reason, does not increment the counter, and keeps the field armed', async () => {
    const counter = page.getByTestId('dispatch-scan-counter');
    const scanner = page.getByLabel(PACKAGE_SCANNER_LABEL);

    await scanner.fill(UNKNOWN_CODE);
    await scanner.press('Enter');

    await expect(page.getByTestId('dispatch-scan-last-read')).toContainText('Código no encontrado en este operador');
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('1 RECHAZO');
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('CÓDIGO NO ENCONTRADO');
    // The counter reads the same "N de total" it did before this scan —
    // a rejection is never counted as loaded.
    await expect(counter).toContainText(`1 de ${PACKAGES_TOTAL}`);

    // Armed right after a REJECTED read too — decision 5/refocus-package-
    // field.ts's whole point: the crew keeps moving boxes with both hands,
    // and the next accepted scan below must land with no re-click.
    await expect(scanner).toBeFocused();
    await expect(page.getByTestId('dispatch-route-scan-session-tablet')).toContainText('LISTO');

    await scanner.fill(SECOND_ACCEPTED_PACKAGE);
    await scanner.press('Enter');

    await expect(counter).toContainText(`2 de ${PACKAGES_TOTAL}`);
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('1 RECHAZO');
  });
});
