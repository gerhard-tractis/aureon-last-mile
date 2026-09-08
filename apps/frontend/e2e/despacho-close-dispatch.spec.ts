/**
 * spec-77 Fase 5 / spec-79 Fase 5 — the closing loop: cerrar → despachar,
 * the four irreversible mobile screens (`2i`-`2l`) over the two server
 * fixes (`spec-79`) that made them honest. Continues where
 * `despacho-crew-mobile.spec.ts` (spec-76, `2a`-`2f`) leaves off, but on
 * its own seed namespace (`despacho-close-fixture.ts`, `PREFIX` 'E2E77') —
 * see that file's header for why.
 *
 * DispatchTrack is mocked at the NETWORK level, but not from this file
 * (spec-77 item 21): the dispatch call happens server-side
 * (`POST /api/dispatch/routes/[id]/dispatch` → `createDTRoute`), so a
 * Playwright `context.route()` (which only intercepts the BROWSER's own
 * requests) cannot reach it — `e2e/dispatch-route.spec.ts`'s existing mock
 * of `**\/activationcode.dispatchtrack.com/**` was never actually exercised
 * for this reason (that spec never triggers a real dispatch, and even if
 * it did, browser-level interception cannot intercept a Node-side `fetch`).
 * The real mechanism here is `infra/supabase-qa/dispatchtrack-mock/`, a
 * standalone HTTP server QA's own `DISPATCHTRACK_BASE_URL` points at
 * instead of the real tenant — see that file's own header for the
 * pre-existing safety gap this closes. `DT_MOCK_URL` (below) is that same
 * server, reached directly by this test to control/assert its behaviour.
 *
 * Three routes cover the three paths spec-77 item 22 names:
 *  - Route H: DT accepts, straight through — the full cargar→cerrar→
 *    despachar path (item 20), with a split order that pins H3 (item 23):
 *    the box that was never scanned must NOT end up `en_ruta`.
 *  - Route R: DT rejects (`DT_API_ERROR`) — `2k`'s first state.
 *  - Route L: DT accepts AND the local write is made to fail
 *    (`DT_ACCEPTED_LOCAL_FAILED`, via the QA-only `dispatch-test-hooks.ts`
 *    seam — see that file's own header for why no legitimate data seeding
 *    reaches this window deterministically) — `2k`'s second state, then a
 *    retry that must NOT create a second DispatchTrack route (item 22's
 *    whole point, asserted against the mock's own call log).
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { closeDb, suppressCookieBanner, db } from './support/spec52-fixture';
import {
  seed, teardown,
  VEHICLE_NORMAL_ID, VEHICLE_REJECT_ID, PACKAGE_SCANNER_LABEL,
  H_STOP_A_ORDER, H_STOP_A_PACKAGES, H_STOP_B_ORDER, H_STOP_B_LOADED, H_STOP_B_UNLOADED,
  R_ORDER, R_PACKAGE, L_ORDER, L_PACKAGE,
} from './support/despacho-close-fixture';
import { openRouteForOrders } from './support/despacho-close-journey';

test.describe.configure({ mode: 'serial' });

const DT_MOCK_URL = process.env.DT_MOCK_URL ?? 'http://127.0.0.1:4477';

async function createRouteCallCount(identifier: string): Promise<number> {
  const res = await fetch(`${DT_MOCK_URL}/__test__/create-calls?identifier=${encodeURIComponent(identifier)}`);
  const body = (await res.json()) as { count: number };
  return body.count;
}

async function scanAll(page: Page, codes: string[]) {
  const scanner = page.getByLabel(PACKAGE_SCANNER_LABEL);
  for (const code of codes) {
    await scanner.click();
    await scanner.fill(code);
    await scanner.press('Enter');
  }
}

async function assignVehicle(page: Page, externalId: string) {
  await page.getByRole('button', { name: 'Asignar camión y conductor' }).click();
  const radiogroup = page.getByRole('radiogroup', { name: 'Vehículos' });
  await expect(radiogroup).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(`^${externalId}`) }).click();
  await page.getByRole('button', { name: 'Asignar y empezar carga' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Vehículos' })).toBeHidden();
}

test.describe('spec-77/79 Despacho móvil — cerrar y despachar (2i-2l)', () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await seed();
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await suppressCookieBanner(ctx);
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    await ctx?.close();
    await teardown();
    await closeDb();
  });

  test('Route H — load, force-close a split order, dispatch: full path + H3', async () => {
    const route = await openRouteForOrders(page, [H_STOP_A_ORDER, H_STOP_B_ORDER]);
    await page.goto(`/app/dispatch/${route.id}`);
    await assignVehicle(page, VEHICLE_NORMAL_ID);

    await page.getByRole('button', { name: 'Empezar a escanear' }).click();
    await expect(page.getByTestId('dispatch-route-scan-session')).toBeVisible();

    // Stop A fully scanned; stop B only ONE of two — the split H3 pins.
    await scanAll(page, [...H_STOP_A_PACKAGES, H_STOP_B_LOADED]);
    await expect(page.getByTestId('dispatch-scan-counter')).toContainText('3 de 4 paquetes');

    // Something is still missing (stop B) — the close button names the
    // figure and opens 2i's force sheet rather than closing directly.
    await page.getByRole('button', { name: /^Cerrar con \d+ sin cargar$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('close-sheet-missing-row')).toHaveCount(1);

    await dialog.getByRole('radio', { name: 'Terminó el turno' }).click();
    await dialog.getByRole('button', { name: /^Cerrar con \d+ sin cargar$/ }).click();
    await expect(dialog).toBeHidden();

    // 2j — the review screen, straight through with the normal vehicle.
    await expect(page.getByTestId('dispatch-route-dispatch-review')).toBeVisible();
    await page.getByRole('button', { name: 'Despachar' }).click();

    // 2l — the acta. No 2k for this route: DT accepts on the first call.
    await expect(page.getByTestId('dispatch-route-acceptance')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('acta-paquetes')).toContainText('3');
    // Item 16 — the one box left at the dock, from the force outcome, not
    // re-derived: `dockLeftLine`'s own words, never "asignado".
    await expect(page.getByText(/vuelve[n]? a sectorizado/)).toBeVisible();

    // H3 (item 23) — the box that was NEVER scanned must not be en_ruta.
    const { rows } = await db().query(`SELECT label, status FROM packages WHERE label = ANY($1::text[])`, [
      [...H_STOP_A_PACKAGES, H_STOP_B_LOADED, H_STOP_B_UNLOADED],
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label as string, r.status as string]));
    for (const label of [...H_STOP_A_PACKAGES, H_STOP_B_LOADED]) {
      expect(byLabel[label], `${label} should be en_ruta`).toBe('en_ruta');
    }
    expect(byLabel[H_STOP_B_UNLOADED], 'the never-scanned box must NOT be en_ruta').not.toBe('en_ruta');
  });

  test('Route R — DispatchTrack rejects: 2k names what did NOT change, Reintentar is primary', async () => {
    const route = await openRouteForOrders(page, [R_ORDER]);
    await page.goto(`/app/dispatch/${route.id}`);
    await assignVehicle(page, VEHICLE_REJECT_ID);

    await page.getByRole('button', { name: 'Empezar a escanear' }).click();
    await scanAll(page, [R_PACKAGE]);
    await expect(page.getByTestId('dispatch-scan-counter')).toContainText('1 de 1 paquetes');

    // Nothing missing — closes directly, no sheet.
    await page.getByRole('button', { name: 'Cerrar ruta' }).click();
    await expect(page.getByTestId('dispatch-route-dispatch-review')).toBeVisible();
    await page.getByRole('button', { name: 'Despachar' }).click();

    const errorScreen = page.getByTestId('dispatch-route-error');
    await expect(errorScreen).toBeVisible({ timeout: 15_000 });
    await expect(errorScreen).toContainText('DispatchTrack rechazó el despacho. No se creó nada.');
    await expect(errorScreen.getByRole('button', { name: 'Reintentar' })).toBeVisible();

    // Ruta stays loaded, package stays listo_para_despacho — decision 6.
    const { rows } = await db().query(`SELECT status FROM routes WHERE id = $1`, [route.id]);
    expect(rows[0].status).toBe('loaded');
  });

  test('Route L — DT accepts, local write fails, retry completes WITHOUT a second DT route', async () => {
    // spec-87 fase 2 — baseline BEFORE either dispatch attempt, not an
    // absolute `toBe(1)`. `L_ORDER` (`E2E77-L-ORD`) is a fixed constant and
    // the DT mock (infra/supabase-qa/dispatchtrack-mock/server.mjs) is a
    // long-lived systemd process whose `createdRoutes` accumulate across
    // every run of this suite — nothing calls its `/__test__/reset`, and it
    // is a live, shared QA fixture (an n8n poll also reads it), so this test
    // must not reset it out from under that. `handleCreateCallCount` counts
    // ALL historical routes carrying this identifier, so an absolute count
    // grows by exactly +1 per run and eventually fails no matter how
    // correct the retry logic is. The delta is what item 22 actually
    // claims: this run's retry created no second route.
    const baselineCount = await createRouteCallCount(L_ORDER);

    const route = await openRouteForOrders(page, [L_ORDER]);
    await page.goto(`/app/dispatch/${route.id}`);
    await assignVehicle(page, VEHICLE_NORMAL_ID);

    await page.getByRole('button', { name: 'Empezar a escanear' }).click();
    await scanAll(page, [L_PACKAGE]);
    await expect(page.getByTestId('dispatch-scan-counter')).toContainText('1 de 1 paquetes');
    await page.getByRole('button', { name: 'Cerrar ruta' }).click();
    await expect(page.getByTestId('dispatch-route-dispatch-review')).toBeVisible();

    // spec-79 Fase 5 test hook — inject the header on the FIRST dispatch
    // POST only, so DT genuinely confirms and the SECOND (retry) call goes
    // out clean. Never touches DT itself — this only talks to Aureon's own
    // API route, browser-side, which IS reachable via context.route().
    let hookArmed = true;
    await page.route('**/api/dispatch/routes/*/dispatch', async (route2) => {
      const headers = { ...route2.request().headers() };
      if (hookArmed) {
        headers['x-e2e-simulate-local-failure'] = 'true';
        hookArmed = false;
      }
      await route2.continue({ headers });
    });

    await page.getByRole('button', { name: 'Despachar' }).click();

    const errorScreen = page.getByTestId('dispatch-route-error');
    await expect(errorScreen).toBeVisible({ timeout: 15_000 });
    await expect(errorScreen).toContainText('DispatchTrack ya recibió la ruta');
    const completarButton = errorScreen.getByRole('button', { name: 'Completar' });
    await expect(completarButton).toBeVisible();

    await completarButton.click();

    await expect(page.getByTestId('dispatch-route-acceptance')).toBeVisible({ timeout: 15_000 });

    // Item 22 — the whole point: exactly ONE route was created at DT for
    // this guide DURING THIS RUN, across both the failed attempt and the
    // retry — measured against the baseline captured above, not an
    // absolute count (see that comment).
    const count = await createRouteCallCount(L_ORDER);
    expect(count - baselineCount).toBe(1);

    const { rows } = await db().query(`SELECT status FROM packages WHERE label = $1`, [L_PACKAGE]);
    expect(rows[0].status).toBe('en_ruta');
  });
});
