/**
 * spec-78 Fase 4 item 10 — the UI/RPC lifecycle for the dock tablet E2E:
 * drives a signed-in crew session to `3a` itself (route open, vehicle
 * assigned, scanning started) at the dock's real viewport. Mirrors
 * `despacho-journey.ts`'s split (data genesis in the sibling fixture file,
 * navigation here) and its own reasoning for creating the route through
 * the real `POST /api/dispatch/routes` endpoint rather than an `INSERT
 * INTO routes` — see that file's header for the full argument, unchanged
 * here.
 *
 * The one behavioural difference from `despacho-journey.ts`: this drives
 * all the way through 2d (vehicle assignment) and 2c's "Empezar a
 * escanear", and lands on `/app/dispatch/[routeId]?dock=1` — the query
 * param `useIsDockDevice()` reads once and persists to `localStorage`
 * (see that hook's own header). Without it this operator_id-scoped
 * session, at 1024x768, would render `1c` (the desktop tree) instead of
 * `3a` — decision 1's whole point.
 */
import type { Page } from '@playwright/test';
import { db, signIn, OPERATOR_ID } from './spec52-fixture';
import {
  CREW, PREFIX, STOPS, ACCEPTED_PACKAGE, VEHICLE_EXTERNAL_ID, toRouteCode,
} from './despacho-tablet-fixture';

/** `America/Santiago` civil date, `YYYY-MM-DD` — same one-liner
 *  `despacho-journey.ts` keeps local rather than importing app source; see
 *  that file's header for why. */
function santiagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

export interface DespachoTabletRoute { id: string; code: string; }

/**
 * Signs the crew in, creates the seeded route via the real endpoint, and
 * returns it — PRECONDITION check mirrors `openRouteToLoad()`'s own (same
 * three checks: packages seeded, orders seeded, vehicle seeded), so a
 * missing `seed()` call fails here with a clear message instead of an
 * opaque timeout four steps later on the scan session.
 */
export async function openTabletRouteToLoad(page: Page): Promise<DespachoTabletRoute> {
  const { rows: pkgRows } = await db().query(
    `SELECT status FROM packages WHERE label = $1`,
    [ACCEPTED_PACKAGE],
  );
  if (pkgRows[0]?.status !== 'sectorizado') {
    throw new Error(
      'openTabletRouteToLoad() requires seed() to have run first — no \'sectorizado\' ' +
      `package found with label ${ACCEPTED_PACKAGE}`,
    );
  }

  const { rows: orderRows } = await db().query(
    `SELECT id FROM orders WHERE external_load_id LIKE $1 ORDER BY external_load_id`,
    [`${PREFIX}-%`],
  );
  if (orderRows.length !== STOPS.length) {
    throw new Error(
      `openTabletRouteToLoad() expected ${STOPS.length} seeded orders, found ${orderRows.length} — ` +
      'did seed() run for this file\'s namespace?',
    );
  }

  const { rows: vehicleRows } = await db().query(
    `SELECT id FROM fleet_vehicles WHERE external_vehicle_id = $1 AND operator_id = $2 AND deleted_at IS NULL`,
    [VEHICLE_EXTERNAL_ID, OPERATOR_ID],
  );
  if (vehicleRows.length === 0) {
    throw new Error(
      `openTabletRouteToLoad() requires seed() to have run first — no fleet_vehicles ` +
      `row found with external_vehicle_id ${VEHICLE_EXTERNAL_ID}`,
    );
  }

  const { rows: crewRows } = await db().query(
    `SELECT id FROM auth.users WHERE email = $1`,
    [CREW.email],
  );
  if (crewRows.length === 0) {
    throw new Error(
      `openTabletRouteToLoad() requires seed() to have run first — no auth.users row for ${CREW.email}`,
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
      `openTabletRouteToLoad(): POST /api/dispatch/routes returned ${response.status()} — ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { id: string };

  return { id: body.id, code: toRouteCode(body.id) };
}
