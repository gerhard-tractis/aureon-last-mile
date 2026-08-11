/**
 * spec-51 — a realistic tenant: Musan, with the clients and cargas it works.
 *
 * The rest of the seed uses one synthetic operator, which is enough to exercise
 * status logic but says nothing about how the product is actually shaped:
 *
 *   operator (Musan)
 *     └── tenant_clients        Easy, Paris
 *           └── pickup_points   where a carga is collected
 *                 └── manifests THE CARGA (external_load_id)
 *                       └── orders + packages, joined by external_load_id
 *
 * IMPORTANT — this is QA Musan, not production Musan. The production operator
 * id 92dc5797-047d-458d-bbdb-63f18c0dd1e7 is hardcoded in beetrack-webhook and
 * the Easy WMS n8n workflow, and lib/guards.ts refuses to seed any database
 * containing it. QA Musan gets an id from the generator range so the two can
 * never be confused.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertCount } from '../lib/assert';
import { createOperator, createOrderWithPackages, resettleOrderStatus } from '../lib/factories';
import { ScenarioGroup, qaId } from '../lib/ids';

export const MUSAN_QA = {
  operatorId: qaId(ScenarioGroup.MUSAN, 1),
  easyClientId: qaId(ScenarioGroup.MUSAN, 2),
  parisClientId: qaId(ScenarioGroup.MUSAN, 3),
  easyPickupPointId: qaId(ScenarioGroup.MUSAN, 4),
  parisPickupPointId: qaId(ScenarioGroup.MUSAN, 5),
} as const;

interface Carga {
  /** external_load_id — how orders, packages and the manifest are tied together. */
  loadId: string;
  clientId: string;
  clientName: string;
  pickupPointId: string;
  /** manifest_status_enum */
  status: string;
  /** reception_status_enum */
  receptionStatus: string;
  /** One entry per order; each entry lists that order's package statuses. */
  orders: string[][];
}

/**
 * Cargas span the pickup lifecycle so every stage has something to look at:
 * one waiting to be collected, one mid-pickup, one already received at the hub.
 */
const CARGAS: Carga[] = [
  {
    loadId: 'CARGA-EASY-001',
    clientId: MUSAN_QA.easyClientId,
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    status: 'pending',
    receptionStatus: 'awaiting_reception',
    orders: [['ingresado'], ['ingresado', 'ingresado'], ['ingresado']],
  },
  {
    loadId: 'CARGA-EASY-002',
    clientId: MUSAN_QA.easyClientId,
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    status: 'in_progress',
    receptionStatus: 'reception_in_progress',
    orders: [['verificado'], ['verificado', 'ingresado']],
  },
  {
    loadId: 'CARGA-PARIS-001',
    clientId: MUSAN_QA.parisClientId,
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    status: 'completed',
    receptionStatus: 'received',
    orders: [['en_bodega'], ['en_bodega', 'en_bodega'], ['en_bodega'], ['en_bodega']],
  },
  {
    loadId: 'CARGA-PARIS-002',
    clientId: MUSAN_QA.parisClientId,
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    status: 'pending',
    receptionStatus: 'awaiting_reception',
    orders: [['ingresado', 'ingresado']],
  },
];

async function createClient(
  db: SeedClient,
  args: { id: string; operatorId: string; name: string; slug: string; connectorType: string },
): Promise<void> {
  await db.query(
    `INSERT INTO public.tenant_clients
       (id, operator_id, name, slug, connector_type, connector_config, is_active)
     VALUES ($1, $2, $3, $4, $5::connector_type_enum, $6::jsonb, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [args.id, args.operatorId, args.name, args.slug, args.connectorType, JSON.stringify({})],
  );
}

async function createPickupPoint(
  db: SeedClient,
  args: {
    id: string;
    operatorId: string;
    tenantClientId: string;
    name: string;
    code: string;
    comuna: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO public.pickup_points
       (id, operator_id, tenant_client_id, name, code, intake_method, is_active, pickup_locations)
     VALUES ($1, $2, $3, $4, $5, 'manual'::intake_method_enum, TRUE, $6::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      args.id,
      args.operatorId,
      args.tenantClientId,
      args.name,
      args.code,
      JSON.stringify([{ name: args.name, address: `Av. ${args.name} 100`, comuna: args.comuna }]),
    ],
  );
}

export async function seedMusan(
  db: SeedClient,
  collector: AssertionCollector,
): Promise<number> {
  const operatorId = MUSAN_QA.operatorId;

  await createOperator(db, {
    id: operatorId,
    name: 'Transportes Musan (QA)',
    slug: 'musan-qa',
  });

  // Easy pushes via the WMS webhook; Paris arrives as emailed spreadsheets.
  await createClient(db, {
    id: MUSAN_QA.easyClientId,
    operatorId,
    name: 'Easy',
    slug: 'easy',
    connectorType: 'api',
  });
  await createClient(db, {
    id: MUSAN_QA.parisClientId,
    operatorId,
    name: 'Paris',
    slug: 'paris',
    connectorType: 'csv_email',
  });

  await createPickupPoint(db, {
    id: MUSAN_QA.easyPickupPointId,
    operatorId,
    tenantClientId: MUSAN_QA.easyClientId,
    name: 'Easy Bodega Central',
    code: 'EASY-BC-01',
    comuna: 'Pudahuel',
  });
  await createPickupPoint(db, {
    id: MUSAN_QA.parisPickupPointId,
    operatorId,
    tenantClientId: MUSAN_QA.parisClientId,
    name: 'Paris CD Norte',
    code: 'PARIS-CD-01',
    comuna: 'Quilicura',
  });

  let orderSequence = 100;
  let orderCount = 0;

  for (let c = 0; c < CARGAS.length; c++) {
    const carga = CARGAS[c];
    const totalPackages = carga.orders.reduce((sum, pkgs) => sum + pkgs.length, 0);

    await db.query(
      `INSERT INTO public.manifests
         (id, operator_id, external_load_id, retailer_name, pickup_location,
          total_orders, total_packages, status, reception_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::manifest_status_enum, $9::reception_status_enum)
       ON CONFLICT (id) DO NOTHING`,
      [
        qaId(ScenarioGroup.MUSAN, 10 + c),
        operatorId,
        carga.loadId,
        carga.clientName,
        carga.clientName === 'Easy' ? 'Easy Bodega Central' : 'Paris CD Norte',
        carga.orders.length,
        totalPackages,
        carga.status,
        carga.receptionStatus,
      ],
    );

    for (const packageStatuses of carga.orders) {
      orderSequence++;
      const order = await createOrderWithPackages(db, {
        group: ScenarioGroup.MUSAN,
        sequence: orderSequence,
        operatorId,
        orderNumber: `${carga.loadId}-ORD-${orderSequence}`,
        packageStatuses,
        externalLoadId: carga.loadId,
        tenantClientId: carga.clientId,
        pickupPointId: carga.pickupPointId,
        retailerName: carga.clientName,
        comuna: carga.clientName === 'Easy' ? 'Pudahuel' : 'Quilicura',
      });
      await resettleOrderStatus(db, order.orderId);
      orderCount++;
    }
  }

  // ── Assertions ────────────────────────────────────────────────────────────
  await assertCount(db, collector, {
    scenario: 'musan/clients',
    detail: 'clients belonging to Musan (Easy, Paris)',
    sql: `SELECT count(*) AS count FROM public.tenant_clients
           WHERE operator_id = $1 AND deleted_at IS NULL`,
    params: [operatorId],
    expected: 2,
  });

  await assertCount(db, collector, {
    scenario: 'musan/cargas',
    detail: 'cargas (manifests) for Musan',
    sql: `SELECT count(*) AS count FROM public.manifests
           WHERE operator_id = $1 AND deleted_at IS NULL`,
    params: [operatorId],
    expected: CARGAS.length,
  });

  // The point of a carga: every order in it carries the same external_load_id,
  // so the manifest and its orders can actually be joined.
  for (const carga of CARGAS) {
    await assertCount(db, collector, {
      scenario: `musan/carga/${carga.loadId}`,
      detail: `orders aggregated under ${carga.loadId}`,
      sql: `SELECT count(*) AS count FROM public.orders
             WHERE operator_id = $1 AND external_load_id = $2 AND deleted_at IS NULL`,
      params: [operatorId, carga.loadId],
      expected: carga.orders.length,
    });
  }

  await assertCount(db, collector, {
    scenario: 'musan/isolation',
    detail: 'Musan orders that leaked onto another operator',
    sql: `SELECT count(*) AS count FROM public.orders
           WHERE external_load_id LIKE 'CARGA-%' AND operator_id <> $1`,
    params: [operatorId],
    expected: 0,
  });

  return orderCount;
}
