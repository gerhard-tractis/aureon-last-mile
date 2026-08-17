/**
 * spec-52 Task 13 — the whole trip, driven through the real screens against a
 * real database. Nothing is mocked: no hook, no Supabase client, no snapshot.
 *
 * Every regression spec-52 uncovered had passed a green unit suite because
 * `page.test.tsx` hand-wrote the data the hook was supposed to return. This
 * test exists so the next one cannot.
 *
 * Needs a local Supabase (PostgREST + GoTrue + Postgres) with this branch's
 * migrations applied, and the Next dev server on :3000. See support/spec52-fixture.ts.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  seed, teardown, closeDb, db, signIn, scanUntilStatus,
  activeRoute, packageStatus, packageId, routeReception, manifestStates,
  DRIVER, RECEPTIONIST, PLATE, LOADS, COLLECTED, UNEXPECTED, LEFT_BEHIND,
  OPERATOR_ID,
} from './support/spec52-fixture';

const PICKUP_SCANNER = 'Barcode scanner input';
const RECEPTION_SCANNER = 'Escáner de recepción';

/** Deliberately flat and out of carga order — the receptionist never picks one. */
const RECEPTION_ORDER = [
  'E2E52-B1-P2', 'E2E52-A2-P1', 'E2E52-A1-P1',
  'E2E52-B1-P1', 'E2E52-A2-P2', UNEXPECTED,
];

test.describe.configure({ mode: 'serial' });

test.describe('spec-52 pickup route and consolidated reception', () => {
  let driverCtx: BrowserContext;
  let recepCtx: BrowserContext;
  let driver: Page;
  let recep: Page;
  let driverId: string;

  test.beforeAll(async ({ browser }) => {
    ({ driverId } = await seed());
    driverCtx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    recepCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    driver = await driverCtx.newPage();
    recep = await recepCtx.newPage();
  });

  test.afterAll(async () => {
    await driverCtx?.close();
    await recepCtx?.close();
    await teardown();
    await closeDb();
  });

  test('driver departs the hub — the vehicle is required', async () => {
    test.setTimeout(120_000);
    await signIn(driver, DRIVER);
    await driver.goto('/app/pickup');

    // spec-54 (#425) rebuilt Recogida: PickupRouteDraftPanel renders the
    // "Iniciar ruta" control only once manifests are ticked — until then the
    // panel shows "Marca los manifiestos de la tabla y agrégalos a una ruta".
    // The old test clicked a button that no longer exists in the empty state
    // and spent its whole timeout waiting for it. Tick the rows first, which
    // is what that empty state instructs a driver to do.
    //
    // Space rather than click: the row is role=checkbox with tabIndex 0, and
    // the load id inside it is a separate button that stopPropagation()s to
    // open the scan screen. A plain .click() lands on the row's centre and can
    // hit that button instead, navigating away rather than selecting.
    for (const load of LOADS) {
      const row = driver.getByTestId('manifest-row').filter({ hasText: load.loadId });
      await expect(row).toBeVisible();
      await row.press(' ');
      await expect(row).toHaveAttribute('aria-checked', 'true');
    }

    await driver.getByTestId('start-route-button').click();
    const confirm = driver.getByRole('button', { name: 'Iniciar', exact: true });
    // The field is required: no vehicle selected, nothing submittable.
    await expect(confirm).toBeDisabled();

    await driver.locator('#vehicle-select').click();
    await driver.getByRole('option', { name: new RegExp(PLATE) }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await driver.waitForURL('**/app/pickup/route/active');
    // The plate, not the legacy free-text vehicle_label.
    await expect(driver.getByText(PLATE, { exact: false })).toBeVisible();

    const route = await activeRoute();
    expect(route.status).toBe('in_progress');
  });

  test('collects from two clients, three cargas — packages reach verificado', async () => {
    test.setTimeout(240_000);
    // spec-54 (#425) inverted this. The cargas are attached when the ROUTE is
    // created — ticking them in the table is what creates and attaches their
    // manifests — so there is nothing left to add here. The old flow (create an
    // empty route, then add manifests one by one from the active-route screen)
    // no longer exists: "Agregar manifiesto" now reports "Sin manifiestos
    // disponibles", because the previous test already attached all three.
    //
    // So attachment is asserted rather than performed, and each scan screen is
    // opened directly. Navigating beats tapping the row: after attachment the
    // carga no longer sits in the pending tab, and the scan URL is the same
    // place the tap resolved to anyway.
    const route = await activeRoute();
    for (const load of LOADS) {
      await driver.goto(`/app/pickup/scan/${load.loadId}`);
      await expect(driver.getByLabel(PICKUP_SCANNER)).toBeVisible();
    }
    await expect.poll(async () => {
      const { rows } = await db().query(
        `SELECT count(*)::int AS n FROM manifests WHERE pickup_route_id = $1`, [route.id]);
      return rows[0].n;
    }, { timeout: 15_000 }).toBe(3);

    // Scan every collected package. `verificado` is set by a DB trigger — the
    // client-side write was deliberately removed, so if the trigger is gone
    // this fails even though the scan itself "succeeded".
    for (const load of LOADS) {
      await driver.goto(`/app/pickup/scan/${load.loadId}`);
      const labels = COLLECTED.filter((l) => l.startsWith(`E2E52-${load.loadId.slice(-2)}`));
      for (const label of labels) {
        await scanUntilStatus(driver, PICKUP_SCANNER, label, 'verificado');
      }
    }
    expect(await packageStatus(UNEXPECTED)).toBe('ingresado');
  });

  test('the route QR is reachable while the route is still in_progress', async () => {
    await driver.goto('/app/pickup');
    const banner = driver.getByTestId('active-route-banner');
    await expect(banner).toBeVisible();
    await banner.getByLabel('Mostrar QR de la ruta').click();

    await expect(driver.getByTestId('route-qr')).toBeVisible({ timeout: 30_000 });
    const route = await activeRoute();
    await expect(driver.getByTestId('route-code')).toHaveText(route.code);
    // Not gated behind closing the route.
    expect(route.status).toBe('in_progress');
  });

  test('the receptionist scans the QR — the route locks and moves to in_transit', async () => {
    test.setTimeout(120_000);
    const route = await activeRoute();
    await signIn(recep, RECEPTIONIST);
    await recep.goto('/app/reception');
    await recep.getByRole('button', { name: 'Escanear QR' }).click();

    // The QR payload is the route UUID; the manual field takes the same value,
    // so this is the QR path, camera aside.
    const before = Date.now();
    await recep.getByLabel('Código de ruta').fill(route.id);
    await recep.getByLabel('Buscar ruta').click();
    await recep.waitForURL(`**/app/reception/route/${route.id}`);
    const after = Date.now();

    const arrived = await activeRoute();
    expect(arrived.status).toBe('in_transit');
    const stamp = arrived.in_transit_at!.getTime();
    expect(stamp).toBeGreaterThanOrEqual(before - 2000);
    expect(stamp).toBeLessThanOrEqual(after + 2000);

    const rr = await routeReception(route.id);
    expect(rr.expected_count).toBe(COLLECTED.length);

    // Further pickup scans are rejected — the route lock is a BEFORE INSERT
    // trigger, so this drives the same guard the driver's screen would hit.
    const { rows: m } = await db().query(
      `SELECT id FROM manifests WHERE external_load_id = $1`, [LOADS[0].loadId]);
    await expect(
      db().query(
        `INSERT INTO pickup_scans (operator_id, manifest_id, package_id,
           barcode_scanned, scan_result, scanned_by_user_id, scanned_at)
         VALUES ($1, $2, $3, $4, 'verified', $5, now())`,
        [OPERATOR_ID, m[0].id, await packageId(UNEXPECTED), UNEXPECTED, driverId]),
    ).rejects.toThrow(/ya fue cerrada/);
  });

  test('the reception page renders from the real snapshot', async () => {
    const route = await activeRoute();
    // Rendering at all is the assertion: for six months this page threw
    // because the RPC returned `reception`/`packages` and it read
    // `route_reception`/`expected_packages`.
    // spec-54 phase 4.5 replaced the single `reception-counts` block with four
    // StatTiles (Esperados / Verificados / Faltantes / Sobrantes). Assert the
    // number rather than mere presence — "expected" is exactly what the RPC
    // alias bug got wrong, so a visibility-only check would not have caught it.
    const expectedTile = recep.getByTestId('stat-tile').filter({ hasText: 'Esperados' });
    await expect(expectedTile).toBeVisible();
    await expect(expectedTile).toContainText(String(COLLECTED.length));
    // Assert against the h1 rather than a bare getByText: the heading is
    // "Ruta {code} · conteo en recepción", so a containment check on the
    // heading proves the snapshot's route header rendered, and a failure
    // reports the text it actually found instead of just "not visible".
    await expect(recep.getByRole('heading', { level: 1 })).toContainText(route.code);
    // Containment on <main> rather than getByText: the subheader is one text
    // node built from three interpolations ("{driver} · {plate} · N
    // manifiestos"), and a failure here needs to distinguish "not rendered"
    // from "rendered as Sin conductor" — the latter would mean the snapshot's
    // users join broke again, which is the defect 20260813000005 exists to
    // prevent. toBeVisible() cannot tell those apart; this prints the text.
    const main = recep.locator('main');
    await expect(main).toContainText(DRIVER.fullName);
    await expect(main).toContainText(PLATE);
    await expect(recep.getByTestId('package-row')).toHaveCount(COLLECTED.length);
  });

  test('packages are scanned flat, out of carga order, and the checklist ticks', async () => {
    test.setTimeout(180_000);
    for (const label of RECEPTION_ORDER) {
      await scanUntilStatus(recep, RECEPTION_SCANNER, label, 'en_bodega');

      if (label === UNEXPECTED) continue;
      // Assert the TICK, keyed by package id — a count assertion would have
      // sailed straight past the `pk.id AS package_id` alias bug that made it
      // impossible for any row to ever go green.
      const row = recep.locator(
        `[data-testid="package-row"][data-package-id="${await packageId(label)}"]`);
      await expect(row).toHaveAttribute('data-received', 'true', { timeout: 15_000 });
      await expect(row.getByTestId('received-icon')).toBeVisible();
    }

    // The one left at the client never ticks.
    const missing = recep.locator(
      `[data-testid="package-row"][data-package-id="${await packageId(LEFT_BEHIND)}"]`);
    await expect(missing).toHaveAttribute('data-received', 'false');
    expect(await packageStatus(LEFT_BEHIND)).toBe('verificado');

    const route = await activeRoute();
    const rr = await routeReception(route.id);
    expect(rr.received_count).toBe(6);
    expect(rr.unexpected_count).toBe(1);
    // Same spec-54 4.5 rebuild: the "N inesperado" line is now the SOBRANTES tile.
    await expect(
      recep.getByTestId('stat-tile').filter({ hasText: 'Sobrantes' }),
    ).toContainText('1');
  });

  test('finalizing still demands notes when the counts offset, then closes the trip',
    async () => {
      test.setTimeout(120_000);
      const route = await activeRoute();

      // 6 received === 6 expected, yet one expected package never arrived and
      // one that was never picked up did. Raw counts would wave this through.
      await recep.getByRole('button', { name: /Finalizar recepción/ }).click();
      const notes = recep.getByTestId('discrepancy-notes-input');
      await expect(notes).toBeVisible();
      await notes.fill('Falta E2E52-A1-P2; llegó E2E52-A1-X sin retiro.');

      const before = Date.now();
      await recep.getByTestId('confirm-finalize').click();
      await recep.waitForURL('**/app/reception');
      const after = Date.now();

      const closed = await activeRoute();
      expect(closed.status).toBe('received');
      const stamp = closed.received_at!.getTime();
      expect(stamp).toBeGreaterThanOrEqual(before - 2000);
      expect(stamp).toBeLessThanOrEqual(after + 5000);

      const manifests = await manifestStates();
      expect(manifests).toHaveLength(3);
      for (const m of manifests) {
        expect(m.status).toBe('completed');
        expect(m.completed_at).not.toBeNull();
      }

      const rr = await routeReception(route.id);
      expect(rr.status).toBe('completed');
      expect(rr.discrepancy_notes).toContain('E2E52-A1-X');
    });
});
