/**
 * spec-78 Fase 4 item 10 — the DATA lifecycle for the dock tablet (`3a`)
 * E2E (`e2e/despacho-tablet-dock.spec.ts`). Mirrors `despacho-fixture.ts`
 * (spec-76's own crew-mobile fixture) row-for-row — same split between
 * data genesis here and navigation in `despacho-tablet-journey.ts` — but
 * is its OWN file with its OWN namespace rather than a re-export of that
 * one, for the same reason `despacho-fixture.ts`'s own header gives for
 * not sharing spec-52's: `despacho-crew-mobile.spec.ts` (spec-76) and this
 * suite are both collected by `playwright.qa.config.ts` under
 * `workers: 1`, so they never run concurrently, but each file's own
 * `seed()` opens by calling its own `teardown()` — sharing spec-76's
 * `PREFIX` ('E2E76') would mean this suite's first `seed()` deletes
 * spec-76's rows the moment it runs, and the reverse on the next CI run's
 * ordering. `PREFIX` ('E2E78'), the crew email and the vehicle identifier
 * below are unique to this file — confirmed by grepping the rest of
 * `e2e/` for 'E2E78' and finding only this file.
 *
 * `db()`/`OPERATOR_ID` reused from spec52-fixture.ts (generic infra, not
 * namespaced), matching despacho-fixture.ts's own convention.
 *
 * Packages are seeded directly at `sectorizado`, same reasoning as
 * despacho-fixture.ts's own header: that is the dock-scan trigger's
 * resting state, and driving spec-68's Distribution module UI just to
 * manufacture this fixture's own precondition is out of scope here too.
 */
import { db, OPERATOR_ID } from './spec52-fixture';

export const PREFIX = 'E2E78';

export const CREW = {
  email: 'e2e78-crew@aureon.test',
  password: 'e2e78-crew-pass',
  fullName: 'Cami Andén',
  // loading_crew -> ['distribution','dispatch'] permissions — same role
  // despacho-fixture.ts's CREW uses; see that file's own comment on the
  // migration that is the latest definition of this array today.
  role: 'loading_crew',
};

export const VEHICLE_EXTERNAL_ID = `${PREFIX}-TRK1`;
export const VEHICLE_CAPACITY = 40;

/** `ScanField`'s `ariaLabel` prop in `DispatchRouteScanSessionTablet.tsx`
 *  — the same accessible name `2e`'s field uses (one shared component). */
export const PACKAGE_SCANNER_LABEL = 'Escanear paquete';

/** Two stops, three packages, all seeded `sectorizado` — same shape as
 *  despacho-fixture.ts's STOPS, so both suites exercise an identical
 *  package/order/stop count and their assertions read the same way. */
export const STOPS = [
  {
    orderNumber: `${PREFIX}-ORD-1`,
    address: 'Av. Providencia 1000',
    comuna: 'Providencia',
    packages: [`${PREFIX}-P1A`, `${PREFIX}-P1B`],
  },
  {
    orderNumber: `${PREFIX}-ORD-2`,
    address: 'Av. Apoquindo 2000',
    comuna: 'Las Condes',
    packages: [`${PREFIX}-P2A`],
  },
] as const;

export const PACKAGES_TOTAL = STOPS.reduce((n, s) => n + s.packages.length, 0);
/** The first accepted read the journey's own spec scans. */
export const ACCEPTED_PACKAGE = STOPS[0].packages[0];
/** A second dispatchable package — proves the field stayed armed right
 *  after a rejection, decision 4/5's whole point on a tablet nobody
 *  re-focuses by hand. */
export const SECOND_ACCEPTED_PACKAGE = STOPS[0].packages[1];
/** Never seeded — a genuine NOT_FOUND rejection. */
export const UNKNOWN_CODE = `${PREFIX}-NOPE`;

/** Mirrors `lib/dispatch/mobile/crew-board.ts`'s `routeCode()` — no human
 *  route-code column exists, only this convention. */
export function toRouteCode(routeId: string): string {
  return routeId.slice(0, 8).toUpperCase();
}

async function ensureOperator(): Promise<void> {
  await db().query(
    `INSERT INTO operators (id, name, slug, country_code, is_active)
     VALUES ($1, 'E2E Test Operator', 'e2e-test-operator', 'CL', true)
     ON CONFLICT DO NOTHING`,
    [OPERATOR_ID],
  );
}

/**
 * Same GoTrue-workaround INSERT as despacho-fixture.ts's own
 * `createCrewUser` (private there too) — duplicated for the same reason:
 * that function is module-scoped to its own file, and `handle_new_user`
 * requires `operator_id` in `raw_app_meta_data`, which GoTrue only writes
 * after insert, so the admin API can't be used instead.
 */
async function createCrewUser(): Promise<string> {
  const { rows } = await db().query(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change,
       email_change_token_current, phone_change, phone_change_token,
       reauthentication_token)
     VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', $1, crypt($2, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',ARRAY['email'],
                          'operator_id',$3::text,'role',$4::text),
       jsonb_build_object('full_name',$5::text), now(), now(),
       '', '', '', '', '', '', '', '')
     RETURNING id`,
    [CREW.email, CREW.password, OPERATOR_ID, CREW.role, CREW.fullName],
  );
  return rows[0].id as string;
}

export interface DespachoTabletSeeded { crewId: string; }

export async function seed(): Promise<DespachoTabletSeeded> {
  await teardown();
  await ensureOperator();
  const crewId = await createCrewUser();

  await db().query(
    `INSERT INTO operator_enabled_modules (operator_id, module_key, enabled_by)
     VALUES ($1, 'dispatch', $2) ON CONFLICT DO NOTHING`,
    [OPERATOR_ID, crewId],
  );

  await db().query(
    `INSERT INTO fleet_vehicles (operator_id, provider, external_vehicle_id, vehicle_type, capacity_packages)
     VALUES ($1, 'dispatchtrack', $2, 'Camión', $3)`,
    [OPERATOR_ID, VEHICLE_EXTERNAL_ID, VEHICLE_CAPACITY],
  );

  for (const stop of STOPS) {
    const { rows } = await db().query(
      `INSERT INTO orders (operator_id, order_number, customer_name, customer_phone,
         delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
         external_load_id, retailer_name)
       VALUES ($1, $2, 'Cliente E2E', '+56900000000', $3, $4, CURRENT_DATE,
               '{}'::jsonb, 'MANUAL', now(), $2, 'Retail E2E')
       RETURNING id`,
      [OPERATOR_ID, stop.orderNumber, stop.address, stop.comuna],
    );
    const orderId = rows[0].id as string;
    for (const label of stop.packages) {
      await db().query(
        `INSERT INTO packages (operator_id, order_id, label, raw_data, status)
         VALUES ($1, $2, $3, '{}'::jsonb, 'sectorizado')`,
        [OPERATOR_ID, orderId, label],
      );
    }
  }

  return { crewId };
}

export async function teardown(): Promise<void> {
  const like = `${PREFIX}-%`;

  // Same ordering rationale as despacho-fixture.ts's own teardown(): package
  // ids captured before the DELETE (audit_logs has no FK, so recovering
  // resource_id after the row is gone is impossible), routes found via
  // their dispatches (POST /api/dispatch/routes stamps a random
  // `draft_<uuid>` external_route_id, not our PREFIX).
  const { rows: pkgRows } = await db().query(`SELECT id FROM packages WHERE label LIKE $1`, [like]);
  const packageIds = pkgRows.map((r) => r.id as string);

  const { rows: routeRows } = await db().query(
    `SELECT DISTINCT d.route_id FROM dispatches d
       JOIN orders o ON o.id = d.order_id
      WHERE o.external_load_id LIKE $1 AND d.route_id IS NOT NULL`,
    [like],
  );
  const routeIds = routeRows.map((r) => r.route_id as string);

  if (routeIds.length > 0) {
    await db().query(
      `DELETE FROM audit_logs WHERE resource_type = 'routes' AND resource_id = ANY($1::uuid[])`,
      [routeIds],
    );
  }
  if (packageIds.length > 0) {
    await db().query(
      `DELETE FROM audit_logs WHERE resource_type = 'packages' AND resource_id = ANY($1::uuid[])`,
      [packageIds],
    );
  }

  // No scan table to clean — see despacho-fixture.ts's own teardown()
  // comment on `POST /api/dispatch/routes/[id]/scan` writing no row on
  // either an accepted or a rejected scan. Same warning applies here: a
  // future scan table keyed on `package_id` must add its cleanup before
  // this DELETE.
  await db().query(`DELETE FROM packages WHERE label LIKE $1`, [like]);

  await db().query(
    `DELETE FROM dispatches WHERE order_id IN (SELECT id FROM orders WHERE external_load_id LIKE $1)`,
    [like],
  );
  if (routeIds.length > 0) {
    await db().query(`DELETE FROM routes WHERE id = ANY($1::uuid[])`, [routeIds]);
  }
  await db().query(`DELETE FROM orders WHERE external_load_id LIKE $1`, [like]);
  await db().query(`DELETE FROM fleet_vehicles WHERE external_vehicle_id LIKE $1`, [like]);
  await db().query(
    `DELETE FROM operator_enabled_modules WHERE enabled_by IN
       (SELECT id FROM auth.users WHERE email = $1)`,
    [CREW.email],
  );
  await db().query(`DELETE FROM auth.users WHERE email = $1`, [CREW.email]);
}
