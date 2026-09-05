/**
 * spec-51 — row factories shared by scenarios.
 *
 * Rule 1 of the seed: never write orders.status. It defaults to 'ingresado'
 * (20260313000001) and is thereafter owned by trg_recalculate_order_status.
 * Scenarios insert packages and let the trigger settle, then assert.
 */

import type { SeedClient } from './db';
import { qaId, type ScenarioGroup } from './ids';

// spec-79 review L-4: the QA login-user machinery moved to seed-users.ts —
// re-exported here so no existing import site (journeys.ts, musan.ts,
// pickup.ts) has to change its path.
export { resolveUserId, QA_USERS, QA_PASSWORD, createLoginUser } from './seed-users';

export interface OrderSpec {
  group: ScenarioGroup;
  sequence: number;
  operatorId: string;
  orderNumber: string;
  /** Package statuses to create. The order's status is derived from these. */
  packageStatuses: string[];
  customerName?: string;
  comuna?: string;
  deliveryDate?: string;
  importedVia?: string;
  dispatchGuideUrl?: string | null;
  /** The CARGA this order belongs to — matches manifests.external_load_id. */
  externalLoadId?: string | null;
  /** Which client of the operator the order belongs to (Easy, Paris, …). */
  tenantClientId?: string | null;
  /** Where the order is collected from. */
  pickupPointId?: string | null;
  retailerName?: string;
}

export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  packageIds: string[];
}

/**
 * Insert an operator. Idempotent on the primary key so a re-run is a no-op.
 */
export async function createOperator(
  db: SeedClient,
  args: { id: string; name: string; slug: string; countryCode?: string },
): Promise<string> {
  await db.query(
    `INSERT INTO public.operators (id, name, slug, country_code, is_active, settings)
     VALUES ($1, $2, $3, $4, TRUE, $5::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      args.id,
      args.name,
      args.slug,
      args.countryCode ?? 'CL',
      JSON.stringify({ branding: { company_name: args.name } }),
    ],
  );
  return args.id;
}

/**
 * Insert an order plus its packages, letting the status trigger derive
 * orders.status. Package ids are allocated from the order's sequence so they
 * stay stable across runs.
 */
/*
 * DO UPDATE, not DO NOTHING, on the identifying columns.
 *
 * Order ids are deterministic -- qaId(group, sequence) -- and the sequence is
 * allocated by walking a scenario's cargas in order. So editing a scenario's
 * composition (moving one order from one carga to the next) re-points a
 * sequence at a different load id, while the row already in the database keeps
 * the old one. With DO NOTHING the edit never propagated and the scenario's own
 * assertions failed against data they could not correct: Musan's PARIS cargas
 * sat at a 3/2 split for weeks while the definition said 4/1.
 *
 * Only the fields a scenario definition owns are updated. Status is left alone
 * -- it is derived from packages by trigger, and resettleOrderStatus() below is
 * what re-derives it -- and so is anything a tester may have changed by using
 * the app, which is the whole reason this seeder is idempotent rather than
 * destructive.
 */
export async function createOrderWithPackages(
  db: SeedClient,
  spec: OrderSpec,
): Promise<CreatedOrder> {
  const orderId = qaId(spec.group, spec.sequence);

  await db.query(
    `INSERT INTO public.orders (
       id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, retailer_name,
       raw_data, imported_via, imported_at, dispatch_guide_url,
       external_load_id, tenant_client_id, pickup_point_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::imported_via_enum, NOW(), $12,
       $13, $14, $15
     )
     ON CONFLICT (id) DO UPDATE SET
       order_number     = EXCLUDED.order_number,
       external_load_id = EXCLUDED.external_load_id,
       retailer_name    = EXCLUDED.retailer_name,
       tenant_client_id = EXCLUDED.tenant_client_id,
       pickup_point_id  = EXCLUDED.pickup_point_id,
       comuna           = EXCLUDED.comuna`,
    [
      orderId,
      spec.operatorId,
      spec.orderNumber,
      spec.customerName ?? `Cliente ${spec.orderNumber}`,
      '+56900000000',
      `Calle QA ${spec.sequence}`,
      spec.comuna ?? 'Maipú',
      spec.deliveryDate ?? new Date().toISOString().slice(0, 10),
      spec.retailerName ?? 'QA Retail',
      JSON.stringify({ source: 'seed-qa-generator' }),
      spec.importedVia ?? 'MANUAL',
      spec.dispatchGuideUrl ?? null,
      spec.externalLoadId ?? null,
      spec.tenantClientId ?? null,
      spec.pickupPointId ?? null,
    ],
  );

  const packageIds: string[] = [];

  for (let i = 0; i < spec.packageStatuses.length; i++) {
    // Package sequence is derived from the order's so ids stay deterministic
    // and cannot collide with another order in the same group.
    const packageId = qaId(spec.group, spec.sequence * 100 + i + 1);
    packageIds.push(packageId);

    await db.query(
      `INSERT INTO public.packages (
         id, operator_id, order_id, label, status, sku_items, raw_data
       ) VALUES ($1, $2, $3, $4, $5::package_status_enum, $6::jsonb, $7::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        packageId,
        spec.operatorId,
        orderId,
        `${spec.orderNumber}-CTN-${i + 1}`,
        spec.packageStatuses[i],
        JSON.stringify([{ sku: `QA-SKU-${i + 1}`, description: 'Caja QA', quantity: 1 }]),
        JSON.stringify({ source: 'seed-qa-generator' }),
      ],
    );
  }

  return { orderId, orderNumber: spec.orderNumber, packageIds };
}

/**
 * Put an order's packages back to a known starting state.
 *
 * Journeys mutate what they touch, so unlike the other scenarios they are not
 * idempotent by construction: a second run would begin wherever the first one
 * finished. Re-running a failed-delivery journey without this finds its order
 * already at retorno_hub and asserts the wrong starting state.
 *
 * Statuses are applied in label order so package N always gets statuses[N].
 */
export async function resetOrderPackages(
  db: SeedClient,
  orderId: string,
  statuses: string[],
): Promise<void> {
  const packages = await db.query<{ id: string }>(
    `SELECT id FROM public.packages
      WHERE order_id = $1 AND deleted_at IS NULL
      ORDER BY label`,
    [orderId],
  );

  for (let i = 0; i < packages.length && i < statuses.length; i++) {
    await db.query(
      `UPDATE public.packages
          SET status = $2::package_status_enum
        WHERE id = $1`,
      [packages[i].id, statuses[i]],
    );
  }
}

/**
 * spec-79 review F3: stamp the same per-box load fact a real scan does
 * (`loaded_at`/`loaded_by` set, `load_inferred = false`) — see
 * `stage-dispatch.ts`'s `advancePackagesToEnCarga`, which is the only
 * writer of these columns in production. This seed generator has no HTTP
 * server to drive that endpoint through, so it replicates the columns that
 * write leaves behind directly, the same way it already replicates the
 * `/close` endpoint's raw UPDATE elsewhere in this file — but scoped to
 * `en_carga` only, mirroring the one status the real write ever targets.
 *
 * Without this, `dispatch-local-completion.ts`'s `loadedPackageIds`
 * (spec-79 H3/F1) finds `loaded_at IS NULL` on every package this generator
 * creates, so dispatching a route built from these packages in QA always
 * writes zero `en_ruta` rows — the exact code path spec-79 exists to fix
 * would show a green 200 in QA whether or not it actually worked.
 *
 * spec-79 review L-2: `operator_id` added to the WHERE clause, matching the
 * `/close` simulation eleven lines below this one — every other write in
 * this generator scopes by operator_id; this one silently didn't.
 *
 * spec-79 BLOCKER: also stamps `loaded_route_id`, mirroring
 * `advancePackagesToEnCarga`'s own write (stage-dispatch.ts) now that the
 * per-box load fact carries route linkage. Pair with
 * `createStagedRouteForOrder` below so the route this id points at actually
 * exists — a scan-derived fixture with a dangling FK is not a fixture of a
 * real scan.
 */
export async function markPackagesLoaded(
  db: SeedClient,
  orderId: string,
  scannedBy: string,
  operatorId: string,
  routeId: string,
): Promise<void> {
  await db.query(
    `UPDATE public.packages
        SET loaded_at = NOW(), loaded_by = $2, load_inferred = false, loaded_route_id = $3
      WHERE order_id = $1 AND operator_id = $4 AND deleted_at IS NULL
        AND status = 'en_carga'::package_status_enum`,
    [orderId, scannedBy, routeId, operatorId],
  );
}

/**
 * spec-79 review L-1. A real scan always leaves TWO things behind: the
 * per-box load fact (`markPackagesLoaded` above) AND a `dispatches` row
 * tying the order to the route the scan happened against
 * (`advancePackagesToEnCarga` is only ever called from inside a route scan —
 * `stage-dispatch.ts`). Before this, `markPackagesLoaded` stamped only the
 * first, so a route built from its output had no `dispatches` row at all.
 * Scanning one of these boxes in QA then took the 'adopt' branch
 * ([id]/scan/route.ts — no existing dispatch row to update), which INSERTs
 * one and calls `advancePackagesToEnCarga` itself; its guard
 * (`loaded_at IS NULL OR load_inferred = true`) matched neither an already-
 * loaded row (this seed already set `loaded_at`) nor an inferred one
 * (`load_inferred` already false), so it THREW — 500, with the just-adopted
 * `dispatches` row left behind, never rolled back. There was no path from
 * this seeded state to a dispatchable route: spec-79 phase 5 item 20 (QA
 * verification of the three DT paths) was unreachable, not merely
 * unstarted.
 *
 * Creates the route and `staged` dispatch a real scan would have left, so a
 * rescan instead hits `scan-validator.ts`'s `ALREADY_STAGED` refusal — the
 * correct outcome for a box already loaded — and the route can reach
 * `loaded` and actually be dispatched.
 */
export async function createStagedRouteForOrder(
  db: SeedClient,
  args: { routeId: string; dispatchId: string; operatorId: string; orderId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
     VALUES ($1, $2, 'dispatchtrack', $3, CURRENT_DATE, 'loading')
     ON CONFLICT (id) DO NOTHING`,
    [args.routeId, args.operatorId, `QA-${args.routeId}`],
  );
  await db.query(
    `INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
     VALUES ($1, $2, $3, $4, 'dispatchtrack', 'staged', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [args.dispatchId, args.operatorId, args.routeId, args.orderId],
  );
}

/**
 * Force the trigger to re-derive an order's status.
 *
 * Needed when packages were inserted by an earlier run (ON CONFLICT DO NOTHING
 * means no trigger fires the second time) but we still want to assert the
 * derived state. Touching status with its current value is enough — the
 * trigger fires on UPDATE OF status regardless of whether the value changed.
 */
export async function resettleOrderStatus(db: SeedClient, orderId: string): Promise<void> {
  await db.query(
    `UPDATE public.packages SET status = status
      WHERE order_id = $1 AND deleted_at IS NULL`,
    [orderId],
  );
}
