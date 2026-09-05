/**
 * spec-51 — end-to-end journeys, driven through the real RPCs.
 *
 * The matrix scenario proves resting states derive correctly. It cannot prove
 * TRANSITIONS work, because inserting a package already at retorno_hub never
 * calls process_failed_delivery. The production bug was in a transition — the
 * dispatch-close path — not in a resting state.
 *
 * So these seed a starting state, then call the same functions the application
 * calls, asserting after each hop. Signatures were read from pg_proc on the QA
 * database, not inferred.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertOrderStatus } from '../lib/assert';
import {
  createOrderWithPackages,
  markPackagesLoaded,
  resetOrderPackages,
  resettleOrderStatus,
  resolveUserId,
  QA_USERS,
} from '../lib/factories';
import { ScenarioGroup, FIXED_IDS } from '../lib/ids';

/** DispatchTrack status codes. 3 and 4 are the failed-delivery paths. */
const DT_FAILED = 3;

/**
 * Reverse logistics, the full round trip:
 *   en_ruta -> process_failed_delivery -> retorno_hub  (order en_retorno)
 *           -> complete_return_reception_scan -> en_bodega
 */
async function journeyFailedDeliveryAndReturn(
  db: SeedClient,
  collector: AssertionCollector,
  operatorId: string,
  scannedBy: string,
): Promise<void> {
  const scenario = 'journeys/failed-delivery-return';
  const orderNumber = 'QA-JRN-001';

  const order = await createOrderWithPackages(db, {
    group: ScenarioGroup.JOURNEYS,
    sequence: 1,
    operatorId,
    orderNumber,
    packageStatuses: ['en_ruta', 'en_ruta'],
  });
  // Journeys mutate state, so re-runs must be put back to the start.
  await resetOrderPackages(db, order.orderId, ['en_ruta', 'en_ruta']);
  await resettleOrderStatus(db, order.orderId);

  await assertOrderStatus(db, collector, {
    scenario,
    orderId: order.orderId,
    orderNumber: `${orderNumber} (start: out for delivery)`,
    expectedStatus: 'en_ruta',
  });

  // Hop 1 — DispatchTrack reports a failed delivery.
  await db.query(
    'SELECT public.process_failed_delivery($1, $2, $3, $4, $5)',
    [orderNumber, DT_FAILED, 'Cliente ausente', 'QA_ABSENT', operatorId],
  );

  await assertOrderStatus(db, collector, {
    scenario,
    orderId: order.orderId,
    orderNumber: `${orderNumber} (after process_failed_delivery)`,
    expectedStatus: 'en_retorno',
  });

  // Hop 2 — the packages come back to the hub and are received.
  // The RPC returns a JSON row, not a bare uuid:
  //   {"id": "...", "status": "in_progress", "expected_count": 0, ...}
  type ReturnReception = { id: string } | string;
  const reception = await db.query<{ find_or_create_return_reception: ReturnReception }>(
    'SELECT public.find_or_create_return_reception($1, $2)',
    [operatorId, 'qa-journey-route-001'],
  );

  const returned = reception[0]?.find_or_create_return_reception;
  const parsed = typeof returned === 'string' ? JSON.parse(returned) : returned;
  const receptionId: string | undefined = parsed?.id;

  if (!receptionId) {
    collector.record({
      scenario,
      detail: 'find_or_create_return_reception returned no id',
      expected: 'a return_receptions uuid',
      actual: 'null',
    });
    return;
  }

  const packages = await db.query<{ id: string; label: string }>(
    `SELECT id, label FROM public.packages
      WHERE order_id = $1 AND deleted_at IS NULL ORDER BY label`,
    [order.orderId],
  );

  for (const pkg of packages) {
    await db.query(
      'SELECT public.complete_return_reception_scan($1, $2, $3, $4, $5)',
      [pkg.id, receptionId, scannedBy, pkg.label, operatorId],
    );
  }

  await assertOrderStatus(db, collector, {
    scenario,
    orderId: order.orderId,
    orderNumber: `${orderNumber} (after return reception — back in the warehouse)`,
    expectedStatus: 'en_bodega',
  });
}

/**
 * Partial delivery: one package delivered, one failed. The order must land on
 * parcialmente_entregado — and must NOT be cancelled.
 */
async function journeyPartialDelivery(
  db: SeedClient,
  collector: AssertionCollector,
  operatorId: string,
): Promise<void> {
  const scenario = 'journeys/partial-delivery';
  const orderNumber = 'QA-JRN-002';

  const order = await createOrderWithPackages(db, {
    group: ScenarioGroup.JOURNEYS,
    sequence: 2,
    operatorId,
    orderNumber,
    packageStatuses: ['en_ruta', 'en_ruta'],
  });
  await resetOrderPackages(db, order.orderId, ['en_ruta', 'en_ruta']);
  await resettleOrderStatus(db, order.orderId);

  // One package is delivered by the courier...
  const packages = await db.query<{ id: string }>(
    `SELECT id FROM public.packages
      WHERE order_id = $1 AND deleted_at IS NULL ORDER BY label LIMIT 1`,
    [order.orderId],
  );
  await db.query(
    `UPDATE public.packages SET status = 'entregado'::package_status_enum WHERE id = $1`,
    [packages[0].id],
  );

  // ...and the rest of the order fails.
  await db.query(
    'SELECT public.process_failed_delivery($1, $2, $3, $4, $5)',
    [orderNumber, DT_FAILED, 'Parcial', 'QA_PARTIAL', operatorId],
  );

  await assertOrderStatus(db, collector, {
    scenario,
    orderId: order.orderId,
    orderNumber: `${orderNumber} (one delivered, one returned)`,
    expectedStatus: 'parcialmente_entregado',
  });
}

/**
 * The production regression, driven the way the application drives it:
 * closing a dispatch route stages every en_carga package for dispatch. Before
 * 20260810000001 this cancelled the order.
 *
 * spec-79 review F3: `markPackagesLoaded` stamps the same per-box load fact
 * (`loaded_at`/`loaded_by` set, `load_inferred = false`) a real scan leaves
 * on an `en_carga` package, BEFORE the raw close-simulation moves it to
 * listo_para_despacho — mirroring the real order of writes (scan first,
 * seal/close second, seal never touches loaded_at). Without this, a route
 * built from QA-JRN-003 and dispatched in QA always found zero genuinely
 * loaded packages (loaded_at IS NULL), so `en_ruta` was never written and a
 * green 200 in QA proved nothing about spec-79's fix.
 */
async function journeyDispatchClose(
  db: SeedClient,
  collector: AssertionCollector,
  operatorId: string,
  scannedBy: string,
): Promise<void> {
  const scenario = 'journeys/dispatch-close';
  const orderNumber = 'QA-JRN-003';

  const order = await createOrderWithPackages(db, {
    group: ScenarioGroup.JOURNEYS,
    sequence: 3,
    operatorId,
    orderNumber,
    packageStatuses: ['en_carga', 'en_carga'],
  });
  await resetOrderPackages(db, order.orderId, ['en_carga', 'en_carga']);
  await markPackagesLoaded(db, order.orderId, scannedBy);
  await resettleOrderStatus(db, order.orderId);

  // Exactly what POST /api/dispatch/routes/[id]/close does.
  await db.query(
    `UPDATE public.packages
        SET status = 'listo_para_despacho'::package_status_enum
      WHERE operator_id = $1 AND order_id = $2 AND status = 'en_carga'`,
    [operatorId, order.orderId],
  );

  await assertOrderStatus(db, collector, {
    scenario,
    orderId: order.orderId,
    orderNumber: `${orderNumber} (route closed — must NOT be cancelado)`,
    expectedStatus: 'listo_para_despacho',
  });
}

export async function seedJourneys(
  db: SeedClient,
  collector: AssertionCollector,
): Promise<number> {
  const operatorId = FIXED_IDS.BASELINE_OPERATOR;

  const scannedBy = await resolveUserId(db, QA_USERS.WAREHOUSE_STAFF);
  if (!scannedBy) {
    collector.record({
      scenario: 'journeys',
      detail: 'QA login users missing — run infra/supabase-qa/create-qa-users.sh',
      expected: `a public.users row for ${QA_USERS.WAREHOUSE_STAFF}`,
      actual: 'none',
    });
    return 0;
  }

  await journeyFailedDeliveryAndReturn(db, collector, operatorId, scannedBy);
  await journeyPartialDelivery(db, collector, operatorId);
  await journeyDispatchClose(db, collector, operatorId, scannedBy);

  return 3;
}
