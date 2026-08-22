/**
 * spec-62 Task 25 — the mobile reception journey, yard to acta, driven at
 * phone size against a real database. Nothing is mocked, same rule as
 * spec52-pickup-reception-end-to-end.spec.ts: this is what proves the RPCs,
 * triggers and RLS surface actually cooperate with the mobile tree, not
 * just with a hand-written snapshot in a unit test.
 *
 * Runs only in the `e2e-qa` job (`continue-on-error: true`) on the VPS
 * self-hosted runner, after this branch's PR merges — see
 * playwright.qa.config.ts for why it cannot run from a developer laptop or a
 * GitHub-hosted runner. Read that job's log; a green PR does not mean this
 * suite passed, or even that it was collected.
 *
 * Two hand-managed browser contexts, not the built-in `page` fixture: that
 * fixture is torn down and recreated between tests even under
 * `mode: 'serial'` (serial only guarantees order, not fixture reuse), which
 * would drop the receptionist's session at every `test()` boundary. spec52's
 * own suite hits the same requirement the same way — see its
 * `driverCtx`/`recepCtx` — so this mirrors that pattern rather than fighting
 * the fixture.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  seed, teardown, closeDb, packageStatus, routeReception, activeRoute,
  scanBarcode, scanUntilStatus, COLLECTED, UNEXPECTED, LEFT_BEHIND, suppressCookieBanner,
} from './support/spec52-fixture';
import { openRouteForReception } from './support/reception-mobile-fixture';

// LOAD-BEARING, kept even though the two contexts below set their own
// viewport explicitly (manual `browser.newContext()` calls do not inherit
// this — same reason spec52's own suite repeats its viewports per context).
// This declares the file's intent up front and is the value that matters if
// anything here is ever changed to use the built-in `page` fixture instead:
// the config-wide default (playwright.qa.config.ts) is 1440×900, and without
// a phone-sized context somewhere, useIsBelowLg() reads false and the mobile
// tree this whole file exists to test never mounts.
test.use({ viewport: { width: 390, height: 844 } });

/**
 * ScanField's own default is `ariaLabel="Código de barras"`
 * (src/components/scan/ScanField.tsx), and ReceptionMobileSession passes
 * that same literal rather than the desktop's `RECEPTION_SCANNER_LABEL`
 * ('Escáner de recepción') — the two scan screens have different accessible
 * names by design, not by drift. Naming it here, once, so a future change to
 * either screen's `ariaLabel` prop fails this test with a legible diff
 * instead of a silent `getByLabel` timeout on CI.
 */
const MOBILE_SCANNER_LABEL = 'Código de barras';

/**
 * Same act-then-check pattern as `scanUntilStatus` (spec52-fixture.ts), for
 * the one case that can't key off a package's DB status: re-scanning a
 * package that is already `en_bodega` needs its `scanResult` to flip to
 * `duplicate`, not its status to change — status is a poor proxy here
 * because it's already at the target value before the duplicate scan even
 * happens, so `scanUntilStatus` would return without ever exercising the
 * duplicate path. Polls the visible result block instead, retrying the scan
 * on each iteration that hasn't shown it yet — covering the same dropped-scan
 * window (ids not yet resolved) `scanUntilStatus` guards against.
 */
async function scanUntilFeedback(
  page: Page, label: string, code: string, want: string,
): Promise<void> {
  await expect.poll(async () => {
    const text = (await page.getByTestId('scan-feedback').textContent()) ?? '';
    if (text.includes(want)) return true;
    await scanBarcode(page, label, code);
    return false;
  }, { timeout: 20_000, intervals: [500, 1000, 2000, 3000, 3000] }).toBe(true);
}

/**
 * The five expected packages a receptionist actually gets handed: every
 * `COLLECTED` label except `LEFT_BEHIND`, which stays on the truck at the
 * client on purpose so the finalize step below has a real discrepancy to
 * react to — not one the test manufactures.
 */
const HANDED_OVER = COLLECTED.filter((label) => label !== LEFT_BEHIND);

test.describe.configure({ mode: 'serial' });

test.describe('spec-62 mobile reception — yard to acta', () => {
  let driverCtx: BrowserContext;
  let recepCtx: BrowserContext;
  let driver: Page;
  let recep: Page;
  let routeId: string;
  let routeCode: string;

  test.beforeAll(async ({ browser }) => {
    await seed();
    // Driver side needs `lg`-or-above or PickupMobileView mounts instead of
    // the desktop manifest table `openRouteForReception` drives — see that
    // helper's own docstring. Receptionist side is the phone viewport this
    // whole file exists to exercise.
    driverCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    recepCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // Before anything navigates: the cookie banner is fixed to the same
    // bottom band as the screens' action bars and swallows their clicks.
    await suppressCookieBanner(driverCtx);
    await suppressCookieBanner(recepCtx);
    driver = await driverCtx.newPage();
    recep = await recepCtx.newPage();
  });

  test.afterAll(async () => {
    await driverCtx?.close();
    await recepCtx?.close();
    await teardown();
    await closeDb();
  });

  test('a truck reaches the yard and the mobile tree renders it', async () => {
    test.setTimeout(240_000);
    // Drives the driver's collection and the receptionist's QR scan, landing
    // `recep` on the counting session for the route it just opened.
    const route = await openRouteForReception(driver, recep);
    routeId = route.id;
    routeCode = route.code;

    // Back out to the yard screen — the screen a receptionist actually lands
    // on between counts — to assert the mobile tree, not the session it just
    // walked through as setup.
    await recep.goto('/app/reception');

    // A marker only ReceptionMobileHeader ever renders (the desktop tree's
    // header is a plain h1, no avatar chip) — proof the below-`lg` branch,
    // not the desktop one, is what mounted.
    await expect(recep.getByTestId('reception-mobile-avatar')).toBeVisible();

    const hero = recep.getByTestId('reception-yard-hero');
    await expect(hero, `hero card for route ${routeCode} on the yard screen`).toBeVisible();
    await expect(hero).toContainText('EN PATIO ESPERANDO');
    await expect(hero).toContainText(routeCode);
    await expect(hero).toContainText(`${HANDED_OVER.length + 1} paquetes esperados`);
  });

  test('starting the count lands on the scanning session', async () => {
    await recep.goto('/app/reception');
    await recep.getByRole('button', { name: 'Iniciar conteo' }).click();
    await recep.waitForURL(`**/app/reception/route/${routeId}`, { timeout: 30_000 });
    await expect(
      recep.getByLabel(MOBILE_SCANNER_LABEL),
      'the scanner input on the mobile counting session',
    ).toBeVisible();
  });

  test('scanning moves the count; a repeat and an unexpected box do not block it',
    async () => {
      test.setTimeout(180_000);
      // Not the page's own <header> — that's TopBar, rendered unconditionally
      // above <main> with no `lg:` gating (AppLayout.tsx), so it exists at
      // 390px too and would resolve first. The session's own counter header
      // lives inside <main> (ReceptionMobileSession.tsx).
      const header = recep.locator('main header');

      for (const label of HANDED_OVER) {
        await scanUntilStatus(recep, MOBILE_SCANNER_LABEL, label, 'en_bodega');
      }
      // Five expected boxes handed over — the running counter has moved.
      await expect(header, 'the received/expected counter after five scans')
        .toContainText(`${HANDED_OVER.length}/`);

      // Re-scan a box already counted: the result block must say so, and the
      // counter must NOT move, but scanning must keep working afterward.
      await scanUntilFeedback(recep, MOBILE_SCANNER_LABEL, HANDED_OVER[0], 'YA ESCANEADO');
      await expect(recep.getByTestId('scan-feedback')).toContainText('YA ESCANEADO');
      await expect(header, 'counter unchanged after a duplicate scan')
        .toContainText(`${HANDED_OVER.length}/`);

      // A box that arrived on this truck but was never verified at pickup —
      // recorded, and it does move the counter, but tagged as "ajeno".
      await scanUntilStatus(recep, MOBILE_SCANNER_LABEL, UNEXPECTED, 'en_bodega');
      await expect(recep.getByTestId('scan-feedback')).toContainText('AJENO');
      await expect(header, 'counter after the unexpected scan')
        .toContainText(`${HANDED_OVER.length + 1}/`);

      // Ground truth from the DB, not just the UI: five expected matched,
      // one unexpected, `LEFT_BEHIND` never scanned.
      const rr = await routeReception(routeId);
      expect(rr.received_count).toBe(HANDED_OVER.length + 1);
      expect(rr.unexpected_count).toBe(1);
      expect(await packageStatus(LEFT_BEHIND)).toBe('verificado');
    });

  test('confirming with a package missing opens the note, not the acta', async () => {
    await recep.getByRole('button', { name: 'Confirmar' }).click();

    // The reconciliation is what should have opened this sheet — a missing
    // package (`LEFT_BEHIND`), not a click the test forced through a
    // testid. Asserting the sheet's own reconciliation summary proves that:
    // it names the same "1 falta" this test's setup produced independently.
    const notesField = recep.getByLabel('Notas de discrepancia');
    await expect(
      notesField,
      'the discrepancy note sheet should open because a package is missing',
    ).toBeVisible();
    await expect(recep.getByText(/falta 1 paquete/)).toBeVisible();

    // Still on the session — Confirmar did NOT close the reception.
    await expect(recep).toHaveURL(new RegExp(`/app/reception/route/${routeId}$`));
    const stillOpen = await activeRoute();
    expect(stillOpen.status).toBe('in_transit');
  });

  test('writing the note closes the reception and lands on the acta', async () => {
    test.setTimeout(60_000);
    const note = `Falta ${LEFT_BEHIND}; llegó ${UNEXPECTED} sin retiro.`;
    await recep.getByLabel('Notas de discrepancia').fill(note);
    await recep.getByRole('button', { name: 'Cerrar recepción' }).click();

    await recep.waitForURL(`**/app/reception/route/${routeId}/completa`, { timeout: 30_000 });

    const closed = await activeRoute();
    expect(closed.status).toBe('received');
    const rr = await routeReception(routeId);
    expect(rr.status).toBe('completed');
    expect(rr.discrepancy_notes).toBe(note);

    // The four figures on the acta (mock 3p): esperados, recibidos,
    // faltantes, ajenos. Real route_receptions columns, not a UI recount —
    // see ReceptionReceipt's own docstring for why a raw subtraction would
    // be wrong here (the unexpected package double-counts if you try).
    // Value is the last text node in each row (label span, then value span,
    // e.g. "Faltantes1") — anchor on the end so this can't pass on the wrong
    // digit if another row's number happened to be a substring.
    await expect(recep.getByTestId('acta-esperados'))
      .toContainText(new RegExp(`${HANDED_OVER.length + 1}$`));
    await expect(recep.getByTestId('acta-recibidos'))
      .toContainText(new RegExp(`${HANDED_OVER.length + 1}$`));
    await expect(recep.getByTestId('acta-faltantes')).toContainText(/1$/);
    await expect(recep.getByTestId('acta-ajenos')).toContainText(/1$/);

    // The note just written is on the acta, verbatim — not merely present.
    await expect(recep.getByTestId('acta-nota'), 'the discrepancy note on the acta')
      .toContainText(note);

    // Package-level ground truth: the missing one never left `verificado`,
    // every handed-over one (including the unexpected) reached `en_bodega`.
    expect(await packageStatus(LEFT_BEHIND)).toBe('verificado');
    for (const label of [...HANDED_OVER, UNEXPECTED]) {
      expect(await packageStatus(label)).toBe('en_bodega');
    }
  });
});
