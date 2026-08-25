/**
 * spec-52 end-to-end fixture — seeding, teardown and DB probes.
 *
 * Deliberately NO mocking of any kind. Everything here talks to the same
 * Postgres the Next.js dev server talks to through PostgREST/GoTrue, so the
 * test exercises the real RPCs, the real triggers and the real RLS surface.
 * Every defect spec-52 uncovered (a snapshot whose keys the page never read,
 * `pk.id AS package_id`, a dead `driver_name`) survived a green unit suite
 * precisely because the data layer was hand-written in a mock.
 *
 * Requires a local Supabase stack: PostgREST + GoTrue on
 * NEXT_PUBLIC_SUPABASE_URL, and Postgres reachable on E2E_DATABASE_URL.
 */
import { Pool } from 'pg';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * The tenant every seeded row hangs off. Created by `ensureOperator()` below —
 * it used to be assumed to exist, which was only true on a developer laptop
 * (seed.sql). See that function for why.
 */
export const OPERATOR_ID = '00000000-0000-0000-0000-000000000001';

/** Every seeded row carries this prefix so teardown can be exact. */
export const PREFIX = 'E2E52';

/**
 * The driver opens the route, so under spec-61 they must be a `pickup_leader`.
 *
 * This was `pickup_crew` until spec-61 made route creation leader-only
 * ("A leader opens the route and adds the crew. Crew cannot open a route.").
 * Both the UI and the RPC enforce it: `PickupRouteDraftPanel` renders "Solo un
 * líder de ruta puede abrir…" instead of the start button, and
 * `start_pickup_route` refuses the call.
 *
 * Real accounts never broke, because `20260820000003` PART 1 backfilled every
 * existing `pickup_crew` user to `pickup_leader` — and `create-qa-users.sh` was
 * updated in the same commit. This fixture was missed because it does not use
 * either path: it CREATES a fresh user on every run, after the backfill has
 * already happened, so its driver was born as crew and refused.
 *
 * The failure was invisible for days: `e2e-qa` is `continue-on-error`, so three
 * deploys reported success while both suites died here on a 2-minute timeout
 * that surfaced as "Target page, context or browser has been closed".
 */
export const DRIVER = {
  email: 'e2e52-driver@aureon.test',
  password: 'e2e52-driver-pass',
  fullName: 'Rita Conductora',
  role: 'pickup_leader',
};
export const RECEPTIONIST = {
  email: 'e2e52-recep@aureon.test',
  password: 'e2e52-recep-pass',
  fullName: 'Hugo Bodeguero',
  role: 'warehouse_staff',
};

export const PLATE = 'E2E52AA';

/**
 * Accessible names of the two scanner inputs. spec52's own spec still keeps
 * local copies of both (its `PICKUP_SCANNER`/`RECEPTION_SCANNER` consts) —
 * left as-is rather than switched over to these, to avoid touching a passing
 * suite for this task. `PICKUP_SCANNER_LABEL` is used by
 * `reception-mobile-fixture.ts`'s `openRouteForReception`; nothing imports
 * `RECEPTION_SCANNER_LABEL` yet — exported ahead of Task 25's reception spec,
 * which will need it for its own scanning steps.
 */
export const PICKUP_SCANNER_LABEL = 'Barcode scanner input';
export const RECEPTION_SCANNER_LABEL = 'Escáner de recepción';

/** Two clients, three cargas. */
export const LOADS = [
  { loadId: `${PREFIX}-A1`, retailer: 'Alfa Retail', order: `${PREFIX}-ORD-A1` },
  { loadId: `${PREFIX}-A2`, retailer: 'Alfa Retail', order: `${PREFIX}-ORD-A2` },
  { loadId: `${PREFIX}-B1`, retailer: 'Beta Comercial', order: `${PREFIX}-ORD-B1` },
] as const;

/** Packages the driver collects — two per carga. */
export const COLLECTED = [
  `${PREFIX}-A1-P1`, `${PREFIX}-A1-P2`,
  `${PREFIX}-A2-P1`, `${PREFIX}-A2-P2`,
  `${PREFIX}-B1-P1`, `${PREFIX}-B1-P2`,
];

/** Never picked up, yet turns up on the dock: the unexpected-package case. */
export const UNEXPECTED = `${PREFIX}-A1-X`;

/** Loaded at the client, never handed over: stays unticked at reception. */
export const LEFT_BEHIND = `${PREFIX}-A1-P2`;

let pool: Pool | null = null;
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  return pool;
}
export async function closeDb(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

/**
 * GoTrue's admin API cannot create these users: `handle_new_user` demands an
 * `operator_id` in `raw_app_meta_data`, and GoTrue writes app_metadata only
 * *after* the row lands. So the row is inserted directly — including the
 * empty-string token columns GoTrue scans into non-nullable Go strings.
 * `handle_new_user` then creates public.users, whose sync trigger writes the
 * claims the real JWT (and therefore GlobalContext) reads.
 */
async function createUser(u: typeof DRIVER): Promise<string> {
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
    [u.email, u.password, OPERATOR_ID, u.role, u.fullName],
  );
  return rows[0].id as string;
}

/**
 * Guarantees the tenant exists before anything references it.
 *
 * This fixture used to take the operator for granted, which held only on a
 * developer laptop: `seed.sql` creates it, but `seed.sql` is dev-only. The one
 * migration that ever inserted it is `20260209_multi_tenant_rls.sql.bak` — a
 * `.bak`, so `supabase db push` never applies it. Any environment built purely
 * from the migration ledger (QA, and production) therefore has no such row, and
 * the suite died on a foreign key at the first user insert, before a browser
 * ever opened.
 *
 * Deliberately NOT dropped in teardown: it is shared scaffolding rather than
 * test data, and on a dev machine it is the operator the rest of `seed.sql`
 * hangs off — deleting it would cascade well beyond this suite.
 *
 * `ON CONFLICT DO NOTHING` with no target on purpose: on a laptop the id
 * already exists (as "Demo Logistics Chile"/`demo-chile`), in QA neither the id
 * nor the slug does. Both cases must be silent.
 */
async function ensureOperator(): Promise<void> {
  await db().query(
    `INSERT INTO operators (id, name, slug, country_code, is_active)
     VALUES ($1, 'E2E Test Operator', 'e2e-test-operator', 'CL', true)
     ON CONFLICT DO NOTHING`,
    [OPERATOR_ID],
  );
}

export interface Seeded { driverId: string; receptionistId: string; }

export async function seed(): Promise<Seeded> {
  await teardown();
  await ensureOperator();
  const driverId = await createUser(DRIVER);
  const receptionistId = await createUser(RECEPTIONIST);

  // The pickup/reception layouts are server-gated on module enablement.
  await db().query(
    `INSERT INTO operator_enabled_modules (operator_id, module_key, enabled_by)
     SELECT $1, k, $2 FROM unnest(ARRAY['pickup','reception']) k
     ON CONFLICT DO NOTHING`,
    [OPERATOR_ID, driverId],
  );

  // The one truck the driver may pick. Nothing else is seeded active, so the
  // combobox offering it proves the required-vehicle field reads real rows.
  await db().query(
    `INSERT INTO vehicles (operator_id, plate, vehicle_type, active)
     VALUES ($1, $2, 'Camión', true)`,
    [OPERATOR_ID, PLATE],
  );

  for (const load of LOADS) {
    const { rows } = await db().query(
      `INSERT INTO orders (operator_id, order_number, customer_name, customer_phone,
         delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
         external_load_id, retailer_name)
       VALUES ($1, $2, 'Cliente E2E', '+56900000000', 'Av. Siempre Viva 742',
               'Santiago', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), $3, $4)
       RETURNING id`,
      [OPERATOR_ID, load.order, load.loadId, load.retailer],
    );
    const orderId = rows[0].id as string;
    const suffix = load.loadId.slice(-2);
    const labels = [`${PREFIX}-${suffix}-P1`, `${PREFIX}-${suffix}-P2`];
    if (load.loadId === `${PREFIX}-A1`) labels.push(UNEXPECTED);
    for (const label of labels) {
      await db().query(
        `INSERT INTO packages (operator_id, order_id, label, raw_data, status)
         VALUES ($1, $2, $3, '{}'::jsonb, 'ingresado')`,
        [OPERATOR_ID, orderId, label],
      );
    }
  }
  return { driverId, receptionistId };
}

export async function teardown(): Promise<void> {
  const like = `${PREFIX}-%`;
  await db().query(
    `DELETE FROM reception_scans WHERE package_id IN
       (SELECT id FROM packages WHERE label LIKE $1)
     OR reception_id IN (SELECT rr.id FROM route_receptions rr
       JOIN pickup_routes pr ON pr.id = rr.pickup_route_id
       WHERE pr.vehicle_id IN (SELECT id FROM vehicles WHERE plate = $2))`,
    [like, PLATE],
  );
  await db().query(
    // package_id is nullable — a 'not_found' scan (barcode matched no
    // package) still carries manifest_id, so matching on package_id alone
    // leaves it behind. That orphan then blocks the `DELETE FROM manifests`
    // below with `pickup_scans_manifest_id_fkey`, and stays stuck forever
    // because nothing else ever revisits it. Mirror the manifest_id fallback
    // already used for reception_scans below.
    `DELETE FROM pickup_scans WHERE package_id IN
       (SELECT id FROM packages WHERE label LIKE $1)
     OR manifest_id IN
       (SELECT id FROM manifests WHERE external_load_id LIKE $1)`, [like]);
  await db().query(
    `DELETE FROM route_receptions WHERE pickup_route_id IN
       (SELECT id FROM pickup_routes WHERE vehicle_id IN
         (SELECT id FROM vehicles WHERE plate = $1))`, [PLATE]);
  await db().query(`DELETE FROM manifests WHERE external_load_id LIKE $1`, [like]);
  await db().query(`DELETE FROM packages WHERE label LIKE $1`, [like]);
  await db().query(`DELETE FROM orders WHERE external_load_id LIKE $1`, [like]);
  await db().query(
    `DELETE FROM pickup_routes WHERE vehicle_id IN
       (SELECT id FROM vehicles WHERE plate = $1)`, [PLATE]);
  await db().query(`DELETE FROM vehicles WHERE plate = $1`, [PLATE]);
  await db().query(
    `DELETE FROM operator_enabled_modules WHERE enabled_by IN
       (SELECT id FROM auth.users WHERE email = ANY($1))`,
    [[DRIVER.email, RECEPTIONIST.email]]);
  await db().query(`DELETE FROM auth.users WHERE email = ANY($1)`,
    [[DRIVER.email, RECEPTIONIST.email]]);
}

// ── DB probes ───────────────────────────────────────────────────────────────

export async function activeRoute(): Promise<{
  id: string; code: string; status: string;
  in_transit_at: Date | null; received_at: Date | null;
}> {
  const { rows } = await db().query(
    `SELECT pr.id, pr.code, pr.status::text, pr.in_transit_at, pr.received_at
       FROM pickup_routes pr JOIN vehicles v ON v.id = pr.vehicle_id
      WHERE v.plate = $1 ORDER BY pr.started_at DESC LIMIT 1`, [PLATE]);
  if (!rows[0]) throw new Error('no pickup route on the E2E vehicle');
  return rows[0];
}

export async function packageStatus(label: string): Promise<string> {
  const { rows } = await db().query(
    `SELECT status::text FROM packages WHERE label = $1`, [label]);
  return rows[0]?.status;
}

export async function packageId(label: string): Promise<string> {
  const { rows } = await db().query(
    `SELECT id FROM packages WHERE label = $1`, [label]);
  return rows[0].id as string;
}

export async function routeReception(routeId: string): Promise<{
  id: string; status: string;
  expected_count: number; received_count: number; unexpected_count: number;
  discrepancy_notes: string | null;
}> {
  const { rows } = await db().query(
    `SELECT id, status::text, expected_count, received_count, unexpected_count,
            discrepancy_notes
       FROM route_receptions WHERE pickup_route_id = $1 AND deleted_at IS NULL`,
    [routeId]);
  return rows[0];
}

export async function manifestStates(): Promise<
  { external_load_id: string; status: string; completed_at: Date | null }[]
> {
  const { rows } = await db().query(
    `SELECT external_load_id, status::text, completed_at FROM manifests
      WHERE external_load_id LIKE $1 ORDER BY external_load_id`, [`${PREFIX}-%`]);
  return rows;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

/**
 * Suppress the cookie banner for a whole context, before anything navigates.
 *
 * `CookieConsent` renders `fixed bottom-0 … z-50` — the same band as the
 * mobile screens' fixed footer — so while it is up it swallows clicks on the
 * primary action. On QA it cost us a 5-minute timeout whose call log ended in
 * "CookieConsent subtree intercepts pointer events".
 *
 * `signIn` used to dismiss it by clicking Accept, which races and usually
 * loses: the banner is shown by a `setTimeout(…, 1000)` (`Cookies.tsx:17`), so
 * an immediate `isVisible()` on `/auth/login` sees nothing, skips the click,
 * and the banner then appears over the app a second later. Setting the cookie
 * the component reads means it never renders at all — no timer, no race.
 */
// Still required after spec-69, for a DIFFERENT reason than it was written for.
// spec-69 stopped the banner rendering on /app/*, so it no longer covers the
// mobile action bar. But signIn() below goes through /auth/login, and `auth` is
// a PUBLIC route where the banner still appears on its 1s timer — the race this
// helper exists to avoid. Do not delete it as "no longer needed".
export async function suppressCookieBanner(context: BrowserContext): Promise<void> {
  await context.addCookies([{
    name: 'cookie-accept',
    value: 'accepted',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3200',
  }]);
}

export async function signIn(
  page: Page, user: { email: string; password: string },
): Promise<void> {
  await page.goto('/auth/login');
  // Belt and braces: contexts should call suppressCookieBanner() first, but a
  // context that did not still gets a chance here. This click races the
  // banner's 1s timer and often finds nothing — which is exactly why it is a
  // fallback and not the mechanism.
  const accept = page.getByRole('button', { name: 'Accept' });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  // Generous: on a cold dev server this is the first compile of /app.
  await page.waitForURL(/\/app(\/|$)/, { timeout: 90_000 });
}

/** Types a barcode into a focused scanner input and submits it. */
export async function scanBarcode(page: Page, label: string, code: string) {
  const input = page.getByLabel(label);
  await input.click();
  await input.fill(code);
  await input.press('Enter');
}

/**
 * Scans until the package reaches `want`.
 *
 * Both scan screens resolve their manifest/reception id and the signed-in user
 * id in effects, and drop a scan on the floor until both have landed — exactly
 * what a driver hitting the trigger too early would see. Re-scanning is safe:
 * a second scan of the same barcode is classified `duplicate` and changes no
 * count, so this retries the input without perturbing the assertions.
 */
export async function scanUntilStatus(
  page: Page, scannerLabel: string, code: string, want: string,
): Promise<void> {
  await expect.poll(async () => {
    if (await packageStatus(code) === want) return want;
    await scanBarcode(page, scannerLabel, code);
    return packageStatus(code);
  }, { timeout: 40_000, intervals: [500, 1000, 2000, 3000, 3000] }).toBe(want);
}
