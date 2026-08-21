/**
 * spec-62 Task 24 — scenario setup for the mobile reception E2E (Task 25).
 *
 * Split out of spec52-fixture.ts rather than added to it: that file is
 * already at the repo's 300-line file guideline, and this helper — plus its
 * rationale — does not fit inside that budget. Everything it needs (seed,
 * signIn, scanUntilStatus, the LOADS/COLLECTED/PLATE constants) is re-exported
 * from there; this file adds exactly one function.
 */
import { expect, type Page } from '@playwright/test';
import {
  signIn, scanUntilStatus, activeRoute,
  DRIVER, RECEPTIONIST, LOADS, COLLECTED, PLATE, PREFIX,
  PICKUP_SCANNER_LABEL,
} from './spec52-fixture';

/**
 * Drives the route from nothing to "in the yard, reception open" — the state
 * spec-62's mobile reception journey (Task 25) starts from. It does NOT stop
 * at `in_progress` and hand the rest to the caller: reception is what that
 * spec exercises, so its own fixture setup must clear the driver side first.
 *
 * `seed()` alone does not reach this state. It only rows the tenant, the two
 * users, the vehicle and the packages (all `ingresado`) — nothing seeds a
 * `pickup_routes` row, because in this app a route is not data you insert, it
 * is a sequence of RPCs a signed-in user calls: `open_route_reception`
 * (20260812000005) checks `auth.uid()`'s permissions and stamps
 * `received_by`/`delivered_by` from it, and the pickup-scan trigger
 * (`trg_pickup_scans_enforce_route_lock`) reads the route status live. A raw
 * INSERT into `route_receptions` would skip both, produce a batch nothing
 * else recognizes as legitimately opened, and drift the moment either
 * function's body changes. So this reuses the exact screens spec-52's own
 * suite drives (`e2e/spec52-pickup-reception-end-to-end.spec.ts`, tests 1–4)
 * instead of re-deriving their SQL.
 *
 * Two pages, not one: the driver side needs `lg`-or-above (see the width note
 * in spec52's own beforeAll) or `PickupMobileView` mounts instead of the
 * desktop manifest table this drives; the receptionist page is left to the
 * caller's own viewport so a mobile-width reception spec can hand in the same
 * page it is about to keep testing against, exactly as `signIn` already
 * expects a caller-supplied `Page` rather than opening its own context.
 *
 * Every `COLLECTED` package — including `LEFT_BEHIND` — is scanned into
 * `verificado` here: the driver genuinely picked it up. `LEFT_BEHIND` staying
 * unscanned at reception is the caller's job, not this helper's; scanning it
 * here too would leave nothing to force the discrepancy-notes path Task 25
 * needs. `UNEXPECTED` is left untouched for the same reason — it is a
 * reception-time scan of a package the driver never picked up at all.
 */
export async function openRouteForReception(
  driverPage: Page, receptionistPage: Page,
): Promise<{ id: string; code: string }> {
  await signIn(driverPage, DRIVER);
  await driverPage.goto('/app/pickup');
  for (const load of LOADS) {
    const row = driverPage.getByTestId('manifest-row').filter({ hasText: load.loadId });
    await expect(row).toBeVisible();
    await row.press(' ');
    await expect(row).toHaveAttribute('aria-checked', 'true');
  }
  await driverPage.getByTestId('start-route-button').click();
  const confirm = driverPage.getByRole('button', { name: 'Iniciar', exact: true });
  await driverPage.locator('#vehicle-select').click();
  await driverPage.getByRole('option', { name: new RegExp(PLATE) }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await driverPage.waitForURL('**/app/pickup/route/active');

  for (const load of LOADS) {
    await driverPage.goto(`/app/pickup/scan/${load.loadId}`);
    const suffix = load.loadId.slice(-2);
    const labels = COLLECTED.filter((l) => l.startsWith(`${PREFIX}-${suffix}`));
    for (const label of labels) {
      await scanUntilStatus(driverPage, PICKUP_SCANNER_LABEL, label, 'verificado');
    }
  }

  const route = await activeRoute();

  await signIn(receptionistPage, RECEPTIONIST);
  await receptionistPage.goto('/app/reception');
  await receptionistPage.getByRole('button', { name: 'Escanear QR' }).click();
  await receptionistPage.getByLabel('Código de ruta').fill(route.id);
  await receptionistPage.getByLabel('Buscar ruta').click();
  await receptionistPage.waitForURL(`**/app/reception/route/${route.id}`);

  return { id: route.id, code: route.code };
}
