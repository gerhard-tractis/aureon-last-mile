/**
 * spec-76 phase 7 — the first Despacho E2E in the whole module. Despacho had
 * no fixture at all before this file, which is why `playwright.qa.config.ts`
 * used to exclude it (its own comment said so). Nothing is mocked, same rule
 * as spec52's and spec-62's own suites: this proves the real RPCs
 * (`create_seeded_route`, the scan endpoint's `validateScan`) and the mobile
 * tree actually cooperate, not a hand-written snapshot in a unit test.
 *
 * Covers `2a` -> `2b` -> `2c` -> `2d` -> `2e`/`2f` only — one crew, one
 * route, one truck, one accepted scan, one rejected scan. `2g` (camera) and
 * `2h` (packages by stop) are NOT here: they ship on
 * `feat/spec-76-camera-and-packages`, a branch stacked on top of this one.
 * That branch's own E2E should extend `despacho-fixture.ts`'s
 * `openRouteToLoad()` rather than duplicate its setup — see that file's own
 * header for why the route and the packages each reach their state the way
 * they do.
 *
 * Runs only in the `e2e-qa` job (`continue-on-error: true`) on the VPS
 * self-hosted runner — see `playwright.qa.config.ts` for why it cannot run
 * from a developer laptop or a GitHub-hosted runner. Read that job's log; a
 * green PR does not mean this suite passed, or even that it was collected.
 *
 * One hand-managed browser context/page, not the built-in `page` fixture:
 * that fixture is torn down and recreated between tests even under
 * `mode: 'serial'` (serial only guarantees order, not fixture reuse), which
 * would drop the crew's signed-in session at every `test()` boundary —
 * same reasoning reception-mobile.spec.ts's own header gives for its two
 * contexts.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { closeDb, suppressCookieBanner } from './support/spec52-fixture';
import {
  seed, teardown, openRouteToLoad,
  VEHICLE_EXTERNAL_ID, PACKAGE_SCANNER_LABEL,
  ACCEPTED_PACKAGE, SECOND_ACCEPTED_PACKAGE, UNKNOWN_CODE, PACKAGES_TOTAL,
} from './support/despacho-fixture';

test.describe.configure({ mode: 'serial' });

test.describe('spec-76 Despacho crew mobile — 2a a 2f', () => {
  let ctx: BrowserContext;
  let page: Page;
  let routeId: string;
  let routeCode: string;

  test.beforeAll(async ({ browser }) => {
    await seed();
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // Before anything navigates — the cookie banner is fixed to the same
    // bottom band as the mobile screens' action bars and swallows their
    // clicks (spec52-fixture.ts's own comment on this helper).
    await suppressCookieBanner(ctx);
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    await ctx?.close();
    await teardown();
    await closeDb();
  });

  test('2a/2b — crew signs in, sees the route and picks it', async () => {
    const route = await openRouteToLoad(page);
    routeId = route.id;
    routeCode = route.code;

    // openRouteToLoad() signed in and created the route via the API; land
    // on the crew home (2a) to assert what the mobile tree itself renders,
    // not the setup call that produced the route.
    await page.goto('/app/dispatch');
    await expect(page.getByTestId('dispatch-crew-mobile-root')).toBeVisible();

    // No myTask yet (the route is `planned`, not `loading` for this
    // crew) — 2a offers "Elegir ruta" rather than a dark task card, decision
    // from spec-76 Fase 1 test 3. Asserted via the button role only — the
    // sentence above it is design copy, and the button already covers the
    // same branch without coupling to its wording.
    await page.getByRole('button', { name: 'Elegir ruta' }).click();

    // 2b — the seeded route shows up BORRADOR (chip fallback for `planned`)
    // with the day's package count in its subtitle.
    await expect(page.getByTestId('dispatch-crew-route-list')).toBeVisible();
    const card = page.getByTestId('dispatch-crew-route-card').filter({ hasText: routeCode });
    await expect(card, `route card for ${routeCode} on 2b`).toBeVisible();
    await expect(card).toContainText('BORRADOR');
    await expect(card).toContainText(`0/${PACKAGES_TOTAL} paquetes`);

    await card.getByRole('button', { name: 'Abrir y asignar vehículo' }).click();
    await page.waitForURL(`**/app/dispatch/${routeId}`);
  });

  test('2c — the dock brief renders what is on the andén', async () => {
    const before = page.getByTestId('dispatch-route-before-scan');
    await expect(before).toBeVisible();
    await expect(before).toContainText(routeCode);
    // Three grid tiles: EN EL ANDÉN, ÓRDENES, PARADAS — spec-76 Fase 3 test 8.
    // Both STOPS below produce 2 orders and 2 distinct addresses (stops).
    // `data-testid`s on the tiles (DispatchRouteBeforeScan.tsx), not a
    // substring/xpath match: `toContainText(String(PACKAGES_TOTAL))` would
    // pass on the digit appearing anywhere in the container, including
    // inside `routeCode`'s own hex digits, and `getByText(label)
    // .locator('xpath=preceding-sibling::p[1]')` breaks the moment the
    // number is wrapped in another element or a second `retenido`/order-
    // count sibling makes the text match ambiguous.
    await expect(before.getByTestId('dispatch-brief-anden').locator('p').first()).toHaveText(String(PACKAGES_TOTAL));
    await expect(before.getByTestId('dispatch-brief-orders').locator('p').first()).toHaveText('2');
    await expect(before.getByTestId('dispatch-brief-stops').locator('p').first()).toHaveText('2');
    await expect(before).toContainText('Sin asignar');
    // No `startScanningDisabledReason` is ever passed by DispatchRouteSurface
    // — decision 6, a missing vehicle never disables the scan CTA.
    await expect(page.getByRole('button', { name: 'Empezar a escanear' })).toBeEnabled();
  });

  test('2d — assigns the seeded truck', async () => {
    await page.getByRole('button', { name: 'Asignar camión y conductor' }).click();

    const radiogroup = page.getByRole('radiogroup', { name: 'Vehículos' });
    await expect(radiogroup).toBeVisible();
    const vehicleRow = page.getByRole('radio', { name: new RegExp(`^${VEHICLE_EXTERNAL_ID}`) });
    await expect(vehicleRow, 'the seeded fleet_vehicles row, assignable (capacity configured)').toBeVisible();
    await vehicleRow.click();

    await page.getByRole('button', { name: 'Asignar y empezar carga' }).click();

    // Sheet closes and 2c's block stops reading "Sin asignar" — proves the
    // PATCH actually persisted (useRouteLoadBrief refetch), not just that
    // the sheet's own local state changed.
    await expect(page.getByRole('radiogroup', { name: 'Vehículos' })).toBeHidden();
    await expect(page.getByTestId('dispatch-route-before-scan')).toContainText(VEHICLE_EXTERNAL_ID);
  });

  test('2e/2f — scans an accepted package, then a rejected one that keeps the field armed', async () => {
    await page.getByRole('button', { name: 'Empezar a escanear' }).click();
    const session = page.getByTestId('dispatch-route-scan-session');
    await expect(session).toBeVisible();

    const counter = page.getByTestId('dispatch-scan-counter');
    await expect(counter).toContainText(`0 de ${PACKAGES_TOTAL} paquetes`);

    const scanner = page.getByLabel(PACKAGE_SCANNER_LABEL);
    await scanner.click();
    await scanner.fill(ACCEPTED_PACKAGE);
    await scanner.press('Enter');

    await expect(counter).toContainText(`1 de ${PACKAGES_TOTAL} paquetes`);
    await expect(page.getByTestId('dispatch-scan-last-read')).toContainText('Cargado en la ruta');

    // 2f — a code that was never seeded is a genuine NOT_FOUND, decision 5's
    // "código no encontrado en este operador" (never gesturing at another
    // operator). Rejections are not persisted anywhere (route.ts's scan
    // handler), so this is asserted purely from the UI.
    await scanner.click();
    await scanner.fill(UNKNOWN_CODE);
    await scanner.press('Enter');

    await expect(page.getByTestId('dispatch-scan-last-read')).toContainText('Código no encontrado en este operador');
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('1 RECHAZO');
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('CÓDIGO NO ENCONTRADO');

    // The field stays ARMED (decision 5 — a rejection is a state of 2e, not
    // a blocking modal), not merely enabled: `toBeEnabled()` alone would
    // still pass on a field that lost focus entirely, and `fill()` below
    // would silently refocus it itself before typing — masking the exact
    // floor failure this exists to catch (refocus-package-field.ts's own
    // header: a scanner gun's next burst goes into whatever holds focus,
    // and if that is a button instead, the scan is dropped with no error).
    // `toBeFocused()` and the reader-status label are both driven by
    // `ScanField`'s real `onFocusStateChange` (refocusPackageField() calls
    // `.focus()` on this exact input after every scan, accepted or
    // rejected) — real observables, not an inference from the next scan
    // landing.
    await expect(scanner).toBeFocused();
    await expect(session).toContainText('LISTO');

    // Only now: a second accepted scan right after the rejection — with no
    // re-click, no manual refocus step, no screen change — actually lands.
    await scanner.fill(SECOND_ACCEPTED_PACKAGE);
    await scanner.press('Enter');

    await expect(counter).toContainText(`2 de ${PACKAGES_TOTAL} paquetes`);
    // The rejection tally from 2f does not reset just because a later scan
    // succeeded — it is this session's running memory, not a "last result".
    await expect(page.getByTestId('dispatch-scan-rejection-summary')).toContainText('1 RECHAZO');
  });
});
