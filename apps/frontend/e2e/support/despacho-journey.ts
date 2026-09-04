/**
 * spec-76 phase 7 — the UI/RPC lifecycle for the Despacho crew-mobile E2E:
 * drives a signed-in session to the state `2a`/`2b` starts the journey from.
 * Split out of despacho-fixture.ts (which keeps the namespace constants,
 * `seed()` and `teardown()`) because the two are a real seam — that file
 * owns rows, this one owns navigation — not an arbitrary line-count cut;
 * the `2g`/`2h` suite on `feat/spec-76-camera-and-packages` is expected to
 * import both independently.
 *
 * The ROUTE here is created through the real `POST /api/dispatch/routes`
 * endpoint (`page.request`, so it rides the signed-in crew's own session
 * cookies) rather than an `INSERT INTO routes`. That endpoint calls
 * `create_seeded_route` (stamps `planned`, opens the `dispatches` rows) and
 * best-effort `assign_load_position` — inserting those rows by hand would
 * drift the moment either RPC's shape changes, exactly the reasoning
 * reception-mobile-fixture.ts's header gives for `open_route_reception`.
 * (The packages this route is built from are seeded directly, in
 * despacho-fixture.ts — see that file's header for why.)
 *
 * Two known deviations from production, left as-is for this phase:
 *
 * - `openRouteToLoad()` hardcodes `signIn(page, CREW)` — there is only one
 *   crew persona in this fixture. Decision 9's "a route another crew is
 *   loading is visible but does not open" needs a SECOND crew signed in on
 *   a second route; whoever writes that scenario should add a `user`
 *   parameter to `openRouteToLoad()` (or a sibling function) rather than a
 *   second hardcoded persona.
 * - The CREW session itself calls `POST /api/dispatch/routes` to create the
 *   route. No production crew does this — planning a route is a manager
 *   action (Pre-Ruta, spec-75), and a crew member only ever picks an
 *   already-planned one in `2b`. It works here because that endpoint's
 *   only real gate is tenant RLS (`operator_id`), which any signed-in user
 *   of this operator satisfies — but it is a shortcut this fixture takes
 *   deliberately to avoid driving spec-75's own desktop planning UI, not a
 *   claim that crews create routes.
 */
import type { Page } from '@playwright/test';
import { db, signIn, OPERATOR_ID } from './spec52-fixture';
import {
  CREW, PREFIX, STOPS, ACCEPTED_PACKAGE, VEHICLE_EXTERNAL_ID, toRouteCode,
} from './despacho-fixture';

/** `America/Santiago` civil date, `YYYY-MM-DD` — the same format
 *  `todayISOInTimezone()` (`@/lib/utils/dateFormat.ts`) produces and
 *  `POST /api/dispatch/routes`'s `route_date` validates against.
 *  `tsconfig.json`'s `**\/*.ts` + the `@/*` alias mean that function DOES
 *  resolve from here — the boundary is not the reason this is a separate
 *  one-liner instead. It is kept local because `e2e/support` importing app
 *  source (rather than the reverse) is not a precedent this file wants to
 *  set for a duplicate of one `Intl.DateTimeFormat` call (Lecciones
 *  aplicadas #3 — do not compute "today" naively; `en-CA` already formats
 *  as `YYYY-MM-DD`).
 */
function santiagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

export interface DespachoRoute { id: string; code: string; }

/**
 * Drives the crew's session to "signed in, one route open at `planned`
 * (2b's BORRADOR chip), packages sitting `sectorizado` on the andén" — the
 * state `2a`/`2b` starts the journey from. See this file's header for why
 * the route itself goes through the real endpoint while the packages
 * (despacho-fixture.ts) are seeded directly.
 *
 * PRECONDITION: `seed()` (despacho-fixture.ts) must already have run.
 * Checked explicitly, not assumed — without this, a missing `seed()` call
 * fails as an opaque timeout on `2a`'s empty state, or four tests later on
 * a radio-button that never renders, instead of here, at the setup step
 * that actually broke (same reasoning as `openRouteForReception`'s own
 * check).
 */
export async function openRouteToLoad(page: Page): Promise<DespachoRoute> {
  const { rows: pkgRows } = await db().query(
    `SELECT status FROM packages WHERE label = $1`,
    [ACCEPTED_PACKAGE],
  );
  if (pkgRows[0]?.status !== 'sectorizado') {
    throw new Error(
      'openRouteToLoad() requires seed() to have run first — no \'sectorizado\' ' +
      `package found with label ${ACCEPTED_PACKAGE}`,
    );
  }

  const { rows: orderRows } = await db().query(
    `SELECT id FROM orders WHERE external_load_id LIKE $1 ORDER BY external_load_id`,
    [`${PREFIX}-%`],
  );
  if (orderRows.length !== STOPS.length) {
    throw new Error(
      `openRouteToLoad() expected ${STOPS.length} seeded orders, found ${orderRows.length} — ` +
      'did seed() run for this file\'s namespace?',
    );
  }

  // `2d`'s own precondition, not just `2a`-`2c`'s: without this, a missing
  // fleet_vehicles row surfaces 4 tests later as a bare timeout on
  // `getByRole('radio', { name: VEHICLE_EXTERNAL_ID })` in the spec's own
  // 2d test — exactly the opaque failure this whole check exists to avoid.
  const { rows: vehicleRows } = await db().query(
    `SELECT id FROM fleet_vehicles WHERE external_vehicle_id = $1 AND operator_id = $2 AND deleted_at IS NULL`,
    [VEHICLE_EXTERNAL_ID, OPERATOR_ID],
  );
  if (vehicleRows.length === 0) {
    throw new Error(
      `openRouteToLoad() requires seed() to have run first — no fleet_vehicles ` +
      `row found with external_vehicle_id ${VEHICLE_EXTERNAL_ID}`,
    );
  }

  const { rows: crewRows } = await db().query(
    `SELECT id FROM auth.users WHERE email = $1`,
    [CREW.email],
  );
  if (crewRows.length === 0) {
    throw new Error(
      `openRouteToLoad() requires seed() to have run first — no auth.users row for ${CREW.email}`,
    );
  }

  await signIn(page, CREW);

  const response = await page.request.post('/api/dispatch/routes', {
    data: {
      order_ids: orderRows.map((r) => r.id as string),
      route_date: santiagoToday(),
    },
  });
  if (!response.ok()) {
    throw new Error(
      `openRouteToLoad(): POST /api/dispatch/routes returned ${response.status()} — ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { id: string };

  return { id: body.id, code: toRouteCode(body.id) };
}
