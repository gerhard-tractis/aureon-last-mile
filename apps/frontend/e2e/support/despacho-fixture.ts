/**
 * spec-76 phase 7 — the DATA lifecycle for the Despacho crew-mobile E2E
 * (`e2e/despacho-crew-mobile.spec.ts`, 2a-2f): namespace constants, row
 * genesis (`seed()`), and cleanup (`teardown()`). Driving screens/RPCs to
 * reach the journey's starting state is `despacho-journey.ts`'s job — split
 * out so this file stays under the repo's 300-line guideline and because it
 * is a real seam: this file owns rows, that one owns navigation, and the
 * `2g`/`2h` suite on `feat/spec-76-camera-and-packages` will import both
 * independently.
 *
 * OWN NAMESPACE — the trap `playwright.qa.config.ts` documents. Every suite
 * that config's `testMatch` already collects (spec52-*, reception-mobile)
 * shares spec-52's `PREFIX`/plate/two emails, and `seed()` there opens by
 * calling `teardown()`. A despacho fixture built on that namespace would
 * delete spec-52's still-running route the moment it seeded. `PREFIX`
 * ('E2E76'), the crew email and the vehicle identifier below are unique to
 * this file — confirmed by grepping the rest of `e2e/` for 'E2E76' and
 * finding only this file. `db()`/`signIn()`/`OPERATOR_ID` ARE reused from
 * spec52-fixture.ts (generic infra: a pg pool and the login flow, neither
 * namespaced), matching how reception-mobile-fixture.ts reuses them too.
 *
 * Why the PACKAGES start life directly INSERTed at `sectorizado` (not
 * driven through a screen, unlike the route in despacho-journey.ts): that
 * is the dock-scan trigger's resting state
 * (`trg_dock_scan_advance_package_status`, 20260319000001), reached in
 * production by scanning a package at a dock zone through spec-68's
 * Distribution module. Driving that whole separate module's UI just to
 * manufacture Despacho's own precondition is out of scope for this fixture
 * and would only be re-deriving spec-68's own fixture. This is the same
 * convention spec52-fixture.ts already uses for ITS packages (seeded
 * straight at `ingresado`, never driven from nothing) — only the transition
 * the journey under test actually drives (picking the route, assigning the
 * truck, scanning it loaded) goes through real screens/RPCs, not the
 * packages' genesis state.
 */
import { db, OPERATOR_ID } from './spec52-fixture';

export const PREFIX = 'E2E76';

export const CREW = {
  email: 'e2e76-crew@aureon.test',
  password: 'e2e76-crew-pass',
  fullName: 'Cami Cuadrilla',
  // loading_crew -> ['distribution','dispatch'] permissions (latest def,
  // 20260824000002_spec66_ops_leader_defaults.sql — same array value as
  // 20260811000001, but that migration is no longer the newest one that
  // touches this function; the latest-migration-as-template rule applies
  // to citations too) — the role Despacho's `_client-gate.tsx` admits.
  role: 'loading_crew',
};

export const VEHICLE_EXTERNAL_ID = `${PREFIX}-TRK1`;
export const VEHICLE_CAPACITY = 40;

/** `ScanField`'s `ariaLabel` prop in `DispatchRouteScanSession.tsx`. */
export const PACKAGE_SCANNER_LABEL = 'Escanear paquete';

/** Two stops (distinct delivery addresses), three packages, all seeded
 *  `sectorizado` — see header comment. */
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
/** The package `openRouteToLoad`'s precondition check looks for, and the
 *  first one the journey's own spec scans as an accepted read. */
export const ACCEPTED_PACKAGE = STOPS[0].packages[0];
/** A second genuinely dispatchable package — proves the scan field kept
 *  working right after a rejection, rather than merely not crashing. */
export const SECOND_ACCEPTED_PACKAGE = STOPS[0].packages[1];
/** Never seeded anywhere — a real `NOT_FOUND` rejection, decision 5. */
export const UNKNOWN_CODE = `${PREFIX}-NOPE`;

/** Mirrors `lib/dispatch/mobile/crew-board.ts`'s `routeCode()` — there is
 *  no human route-code column, only this convention. Exported from here
 *  (not despacho-journey.ts) since it is pure row-shaping, not navigation. */
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
 * Same GoTrue-workaround INSERT as spec52-fixture.ts's own (private,
 * unexported) `createUser` — duplicated rather than imported because that
 * function is module-scoped there. See that file's doc comment for why the
 * admin API can't be used instead: `handle_new_user` requires
 * `operator_id` in `raw_app_meta_data`, which GoTrue only writes after
 * insert.
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

export interface DespachoSeeded { crewId: string; }

export async function seed(): Promise<DespachoSeeded> {
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

  // Package ids captured BEFORE the DELETE below — an `audit_packages_changes`
  // row's `resource_id` (20260217000003 / 20260218220000's trigger func,
  // `TG_TABLE_NAME` + the row's own id) is the package id, which cannot be
  // recovered once the row is gone.
  const { rows: pkgRows } = await db().query(`SELECT id FROM packages WHERE label LIKE $1`, [like]);
  const packageIds = pkgRows.map((r) => r.id as string);

  // Routes created via POST /api/dispatch/routes carry a random
  // `draft_<uuid>` external_route_id, not our PREFIX — found instead via
  // the dispatches they hold for our (prefixed) orders.
  const { rows: routeRows } = await db().query(
    `SELECT DISTINCT d.route_id FROM dispatches d
       JOIN orders o ON o.id = d.order_id
      WHERE o.external_load_id LIKE $1 AND d.route_id IS NOT NULL`,
    [like],
  );
  const routeIds = routeRows.map((r) => r.route_id as string);

  // audit_logs carries no FK to either table (confirmed against the audit
  // trigger's own INSERT) — an incomplete cleanup here blocks nothing, but
  // a half-cleaned resource_type reads as a finished cleanup that isn't.
  // Both resource types this fixture's own writes actually generate are
  // cleaned: `routes` (route creation, vehicle assignment) and `packages`
  // (every package UPDATE the trigger sees, e.g. the seed INSERT itself).
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

  // No scan table is cleaned here. Correct TODAY only: the despacho scan
  // endpoint (`POST /api/dispatch/routes/[id]/scan`) writes no row on
  // either an accepted or a rejected scan (route.ts, verified — see
  // despacho-crew-mobile.spec.ts's own comment on the same fact), unlike
  // spec-68's `dock_scans` or spec-62's `reception_scans`. If a future spec
  // adds one keyed on `package_id REFERENCES packages(id)` with the
  // schema's default `ON DELETE NO ACTION`/`RESTRICT` (every existing FK to
  // `packages(id)` in this repo is one of those two — checked against
  // `dock_scans`/`reception_scans`/`pickup_scans`, none of which CASCADE),
  // the `DELETE FROM packages` below starts failing hard on a foreign-key
  // violation, and because `seed()` opens with `teardown()`, that failure
  // poisons every subsequent run in this namespace rather than just this
  // one. Whoever adds that table must add its cleanup here first.
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
