/**
 * spec-77 Fase 5 / spec-79 Fase 5 — the DATA lifecycle for
 * `e2e/despacho-close-dispatch.spec.ts`: cerrar → despachar, the two
 * irreversible screens spec-77 built (`2i`-`2l`) over the two server fixes
 * spec-79 made safe to test (H2's `DT_ACCEPTED_LOCAL_FAILED` retry, H3's
 * per-bulto `en_ruta`). Modeled directly on `despacho-fixture.ts`
 * (spec-76's own header explains the row-genesis conventions this file
 * reuses) but NOT built on top of it: this suite dispatches routes for
 * real (against the QA-only DispatchTrack mock,
 * `infra/supabase-qa/dispatchtrack-mock/`), so it needs its OWN seed
 * namespace — reusing spec-76's would let this suite's teardown race
 * spec-76's still-loading route, exactly the trap `playwright.qa.config.ts`
 * already documents for spec-52 vs spec-76.
 *
 * OWN NAMESPACE, verified non-colliding: `PREFIX` ('E2E77') was grepped
 * against the rest of `e2e/` before use and found nowhere else. `db()`/
 * `signIn()`/`OPERATOR_ID`/`suppressCookieBanner` are reused from
 * spec52-fixture.ts (generic infra, not namespaced), matching how every
 * other despacho fixture in this tree already does.
 *
 * Three routes, one crew, two vehicles:
 *  - Route H — happy path (item 20) with one split order (item 23, H3):
 *    stop A fully scanned, stop B only partially scanned, forcing `2i`'s
 *    force-close path before `2j`/`2l`.
 *  - Route R — DT rejects (item 21, path 1): assigned to VEHICLE_REJECT,
 *    whose `external_vehicle_id` carries the mock's own reject marker.
 *  - Route L — DT accepts, the local write is made to fail, then retried
 *    (item 21 path 3 / item 22): assigned to VEHICLE_NORMAL, same as H.
 *
 * All packages start `sectorizado`, same convention and same reasoning as
 * despacho-fixture.ts's own header (the dock-scan trigger's resting state
 * — driving spec-68's own module just to reach it is out of scope here).
 */
import { db, OPERATOR_ID } from './spec52-fixture';

export const PREFIX = 'E2E77';

export const CREW = {
  email: 'e2e77-crew@aureon.test',
  password: 'e2e77-crew-pass',
  fullName: 'Cami Despacho',
  role: 'loading_crew',
};

export const VEHICLE_NORMAL_ID = `${PREFIX}-TRK-NORMAL`;
/** The DT mock's own reject marker (`server.mjs`'s `REJECT_MARKER`) —
 *  embedding it in the external_vehicle_id is what routes the resulting
 *  `truck_identifier` into the mock's rejection branch. */
export const VEHICLE_REJECT_ID = `${PREFIX}-DT-REJECT`;
export const VEHICLE_CAPACITY = 20;

export const PACKAGE_SCANNER_LABEL = 'Escanear paquete';

/** Route H — one fully-scanned stop, one partially-scanned stop (H3's split
 *  order). `H_STOP_B_UNLOADED` packages are deliberately never scanned. */
export const H_STOP_A_ORDER = `${PREFIX}-H-ORD-A`;
export const H_STOP_A_PACKAGES = [`${PREFIX}-H-A1`, `${PREFIX}-H-A2`];
export const H_STOP_B_ORDER = `${PREFIX}-H-ORD-B`;
export const H_STOP_B_LOADED = `${PREFIX}-H-B1`;
export const H_STOP_B_UNLOADED = `${PREFIX}-H-B2`;

/** Route R — DT rejects. */
export const R_ORDER = `${PREFIX}-R-ORD`;
export const R_PACKAGE = `${PREFIX}-R-P1`;

/** Route L — DT accepts, local write simulated to fail, then retried. */
export const L_ORDER = `${PREFIX}-L-ORD`;
export const L_PACKAGE = `${PREFIX}-L-P1`;

/** Mirrors `lib/dispatch/mobile/crew-board.ts`'s `routeCode()` — see
 *  despacho-fixture.ts's own copy of this same helper. */
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

/** Same GoTrue-workaround INSERT as despacho-fixture.ts's own
 *  `createCrewUser` — duplicated for the same reason that file's header
 *  gives (module-scoped in each fixture, `handle_new_user` needs
 *  `operator_id` in `raw_app_meta_data` which only exists post-insert). */
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

interface OrderSpec { orderNumber: string; address: string; comuna: string; packages: string[]; }

async function seedOrder(spec: OrderSpec): Promise<void> {
  const { rows } = await db().query(
    `INSERT INTO orders (operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
       external_load_id, retailer_name)
     VALUES ($1, $2, 'Cliente E2E77', '+56900000077', $3, $4, CURRENT_DATE,
             '{}'::jsonb, 'MANUAL', now(), $2, 'Retail E2E77')
     RETURNING id`,
    [OPERATOR_ID, spec.orderNumber, spec.address, spec.comuna],
  );
  const orderId = rows[0].id as string;
  for (const label of spec.packages) {
    await db().query(
      `INSERT INTO packages (operator_id, order_id, label, raw_data, status)
       VALUES ($1, $2, $3, '{}'::jsonb, 'sectorizado')`,
      [OPERATOR_ID, orderId, label],
    );
  }
}

export interface DespachoCloseSeeded { crewId: string; }

export async function seed(): Promise<DespachoCloseSeeded> {
  await teardown();
  await ensureOperator();
  const crewId = await createCrewUser();

  await db().query(
    `INSERT INTO operator_enabled_modules (operator_id, module_key, enabled_by)
     VALUES ($1, 'dispatch', $2) ON CONFLICT DO NOTHING`,
    [OPERATOR_ID, crewId],
  );

  for (const [externalId] of [[VEHICLE_NORMAL_ID], [VEHICLE_REJECT_ID]]) {
    await db().query(
      `INSERT INTO fleet_vehicles (operator_id, provider, external_vehicle_id, vehicle_type, capacity_packages)
       VALUES ($1, 'dispatchtrack', $2, 'Camión', $3)`,
      [OPERATOR_ID, externalId, VEHICLE_CAPACITY],
    );
  }

  await seedOrder({
    orderNumber: H_STOP_A_ORDER,
    address: 'Av. Providencia 1000',
    comuna: 'Providencia',
    packages: H_STOP_A_PACKAGES,
  });
  await seedOrder({
    orderNumber: H_STOP_B_ORDER,
    address: 'Av. Apoquindo 2000',
    comuna: 'Las Condes',
    packages: [H_STOP_B_LOADED, H_STOP_B_UNLOADED],
  });
  await seedOrder({
    orderNumber: R_ORDER,
    address: 'Av. Kennedy 3000',
    comuna: 'Vitacura',
    packages: [R_PACKAGE],
  });
  await seedOrder({
    orderNumber: L_ORDER,
    address: 'Av. Grecia 4000',
    comuna: 'Ñuñoa',
    packages: [L_PACKAGE],
  });

  return { crewId };
}

export async function teardown(): Promise<void> {
  const like = `${PREFIX}-%`;

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
