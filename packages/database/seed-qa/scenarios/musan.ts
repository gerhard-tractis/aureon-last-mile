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
 * The operator and its clients already exist — the migrations create them.
 * This adds only what they do not: pickup points, cargas, and logins.
 *
 * Four cargas — two Easy, two Paris — each holding the same ten orders, two of
 * each of the five package shapes in lib/composition.ts. All four are seeded
 * PENDING, so every one of them can be collected from scratch; the shapes are
 * what make the four cargas worth having rather than one.
 *
 * NOTE the QA database's Musan is NOT production Musan. Production's operator
 * id 92dc5797-047d-458d-bbdb-63f18c0dd1e7 is hardcoded in beetrack-webhook and
 * the Easy WMS n8n workflow; lib/guards.ts refuses to seed any database
 * containing it. QA gets its own id from migration 20260223000001.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector } from '../lib/assert';
import { createOrderWithPackages, resettleOrderStatus } from '../lib/factories';
import { COMPOSITION_LABELS, buildCargaOrders, toPackageRows } from '../lib/composition';
import { ScenarioGroup, qaId } from '../lib/ids';
import { seedMusanLogins } from './musan-logins';
import { assertMusan, type CargaSummary } from './musan-assertions';

/**
 * Musan is NOT created here — the migrations already create it:
 *   20260223000001  operator 'transportes-musan' + its tenant_clients
 *   20260227000001  Paris connector config
 *   20260304000003  the Easy WMS webhook client
 *   20260709000001  enables all nine modules for it
 *
 * An earlier version of this file created a second "Transportes Musan (QA)"
 * operator alongside it. That was a duplicate tenant with no modules enabled,
 * which is why its users saw an empty sidebar. This resolves the real one by
 * slug — its id is gen_random_uuid() in the migration, so it differs per
 * environment and must never be hardcoded.
 */
const MUSAN_SLUG = 'transportes-musan';

/** Only the rows the migrations do NOT provide get generated ids. */
export const MUSAN_QA = {
  easyPickupPointId: qaId(ScenarioGroup.MUSAN, 4),
  parisPickupPointId: qaId(ScenarioGroup.MUSAN, 5),
} as const;

interface Carga {
  /** external_load_id — how orders, packages and the manifest are tied together. */
  loadId: string;
  /** tenant_clients.slug, resolved against the migration-seeded clients. */
  clientSlug: string;
  clientName: string;
  pickupPointId: string;
  pickupLocation: string;
  comuna: string;
}

const CARGAS: Carga[] = [
  {
    loadId: 'CARGA-EASY-001',
    clientSlug: 'easy',
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    pickupLocation: 'Easy Bodega Central',
    comuna: 'Pudahuel',
  },
  {
    loadId: 'CARGA-EASY-002',
    clientSlug: 'easy',
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    pickupLocation: 'Easy Bodega Central',
    comuna: 'Pudahuel',
  },
  {
    loadId: 'CARGA-PARIS-001',
    clientSlug: 'paris',
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    pickupLocation: 'Paris CD Norte',
    comuna: 'Quilicura',
  },
  {
    loadId: 'CARGA-PARIS-002',
    clientSlug: 'paris',
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    pickupLocation: 'Paris CD Norte',
    comuna: 'Quilicura',
  },
];

/** Ten order sequences per carga, so a carga's rows sit in one contiguous block. */
const SEQUENCES_PER_CARGA = 10;
const FIRST_ORDER_SEQUENCE = 100;

async function createPickupPoint(
  db: SeedClient,
  args: {
    id: string;
    operatorId: string;
    tenantClientId: string | null;
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

/**
 * The carga's manifest row, created PENDING so the load shows on the Recogida
 * pending tab and can be collected.
 *
 * Conflict on (operator_id, external_load_id), NOT on id: since 20260814000001
 * trg_ensure_manifest_for_order creates a manifest the moment an order carrying
 * a new external_load_id is inserted — with gen_random_uuid(), not this
 * scenario's fixed qaId — so an ON CONFLICT (id) clause never fires and the
 * insert dies on unique_manifest_per_operator instead.
 *
 * The DO UPDATE deliberately touches only the descriptive and denormalised
 * columns. `status`, `reception_status` and `pickup_route_id` are what a tester
 * changes by USING the carga, and a re-run that reset them would throw away a
 * half-finished collection — the reason PR #491 was closed. Only the one-time
 * purge (infra/supabase-qa/reset-musan.sql) puts a carga back to pending.
 */
async function upsertPendingManifest(
  db: SeedClient,
  args: {
    id: string;
    operatorId: string;
    carga: Carga;
    totalOrders: number;
    totalPackages: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO public.manifests
       (id, operator_id, external_load_id, retailer_name, pickup_location,
        total_orders, total_packages, status, reception_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending'::manifest_status_enum, NULL)
     ON CONFLICT ON CONSTRAINT unique_manifest_per_operator DO UPDATE
        SET retailer_name   = EXCLUDED.retailer_name,
            pickup_location = EXCLUDED.pickup_location,
            total_orders    = EXCLUDED.total_orders,
            total_packages  = EXCLUDED.total_packages`,
    [
      args.id,
      args.operatorId,
      args.carga.loadId,
      args.carga.clientName,
      args.carga.pickupLocation,
      args.totalOrders,
      args.totalPackages,
    ],
  );
}

export async function seedMusan(
  db: SeedClient,
  collector: AssertionCollector,
): Promise<number> {
  const operator = await db.query<{ id: string }>(
    'SELECT id FROM public.operators WHERE slug = $1 AND deleted_at IS NULL',
    [MUSAN_SLUG],
  );
  const operatorId = operator[0]?.id;

  if (!operatorId) {
    collector.record({
      scenario: 'musan',
      detail: `operator '${MUSAN_SLUG}' not found — it is created by migration 20260223000001`,
      expected: 'one operators row',
      actual: 'none',
    });
    return 0;
  }

  // Clients come from the migrations too; resolve rather than re-create.
  const clientRows = await db.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM public.tenant_clients WHERE operator_id = $1 AND deleted_at IS NULL',
    [operatorId],
  );
  const clientIdBySlug = new Map(clientRows.map((c) => [c.slug, c.id]));

  for (const slug of ['easy', 'paris']) {
    if (!clientIdBySlug.has(slug)) {
      collector.record({
        scenario: 'musan/clients',
        detail: `tenant_client '${slug}' missing for Musan`,
        expected: 'seeded by migration',
        actual: 'absent',
      });
    }
  }

  await createPickupPoint(db, {
    id: MUSAN_QA.easyPickupPointId,
    operatorId,
    tenantClientId: clientIdBySlug.get('easy') ?? null,
    name: 'Easy Bodega Central',
    code: 'EASY-BC-01',
    comuna: 'Pudahuel',
  });
  await createPickupPoint(db, {
    id: MUSAN_QA.parisPickupPointId,
    operatorId,
    tenantClientId: clientIdBySlug.get('paris') ?? null,
    name: 'Paris CD Norte',
    code: 'PARIS-CD-01',
    comuna: 'Quilicura',
  });

  await seedMusanLogins(db, operatorId);

  const cargaOrders = buildCargaOrders();
  const packagesPerCarga = cargaOrders.reduce((n, o) => n + o.packages.length, 0);
  const summaries: CargaSummary[] = [];
  let orderCount = 0;

  for (let c = 0; c < CARGAS.length; c++) {
    const carga = CARGAS[c];

    // Before the orders: on a clean database this INSERT wins and sets the
    // carga pending. Let an order go first and the trigger's bare row takes
    // the load id, leaving totals NULL and the scan denominator blank.
    await upsertPendingManifest(db, {
      id: qaId(ScenarioGroup.MUSAN, 10 + c),
      operatorId,
      carga,
      totalOrders: cargaOrders.length,
      totalPackages: packagesPerCarga,
    });

    for (const cargaOrder of cargaOrders) {
      const sequence = FIRST_ORDER_SEQUENCE + c * SEQUENCES_PER_CARGA + cargaOrder.ordinal;
      const orderNumber = `${carga.loadId}-ORD-${String(cargaOrder.ordinal).padStart(2, '0')}`;

      const order = await createOrderWithPackages(db, {
        group: ScenarioGroup.MUSAN,
        sequence,
        operatorId,
        orderNumber,
        // The shape is what this scenario is for, so it describes every box.
        packageStatuses: [],
        packageRows: toPackageRows(orderNumber, cargaOrder.packages),
        // The composition is named on the row a tester actually sees, so the
        // shape under test is identifiable without opening the database.
        customerName: `${carga.clientName} — ${COMPOSITION_LABELS[cargaOrder.composition]}`,
        externalLoadId: carga.loadId,
        tenantClientId: clientIdBySlug.get(carga.clientSlug) ?? null,
        pickupPointId: carga.pickupPointId,
        retailerName: carga.clientName,
        comuna: carga.comuna,
      });

      await resettleOrderStatus(db, order.orderId);
      orderCount++;
    }

    summaries.push({
      loadId: carga.loadId,
      orderCount: cargaOrders.length,
      packageCount: packagesPerCarga,
    });
  }

  await assertMusan(db, collector, operatorId, summaries);

  return orderCount;
}
