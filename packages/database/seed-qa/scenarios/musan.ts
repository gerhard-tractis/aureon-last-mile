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
 * NOTE the QA database's Musan is NOT production Musan. Production's operator
 * id 92dc5797-047d-458d-bbdb-63f18c0dd1e7 is hardcoded in beetrack-webhook and
 * the Easy WMS n8n workflow; lib/guards.ts refuses to seed any database
 * containing it. QA gets its own id from migration 20260223000001.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertCount } from '../lib/assert';
import {
  createLoginUser,
  createOrderWithPackages,
  resettleOrderStatus,
} from '../lib/factories';
import { ScenarioGroup, qaId } from '../lib/ids';

/**
 * Logins for Musan. Permissions are in the vocabulary the APPLICATION checks —
 * pickup, reception, distribution, dispatch, customer_service, admin — which
 * migration 20260811000001 made authoritative and handle_new_user now assigns
 * per role (pickup_leader added to that CASE by 20260820000002).
 *
 * These used to carry the database's legacy tokens (warehouse / loading /
 * operations). Nothing in the app reads those, so a user holding them could
 * never see Recepción or Distribución. 20260811000001 translated the rows
 * already in QA, but the values here were left behind — and createLoginUser
 * repairs an existing login by overwriting permissions, so the next seed run
 * would have written the legacy tokens straight back over the translation.
 * Keeping this list in the app's vocabulary is what stops that regression.
 *
 * Password is the shared QA one: QaTest123!
 */
const MUSAN_LOGINS = [
  {
    seq: 20,
    email: 'admin@musan.com',
    role: 'admin',
    fullName: 'Musan Admin',
    permissions: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service', 'admin'],
  },
  {
    seq: 21,
    email: 'operaciones@musan.com',
    role: 'operations_manager',
    fullName: 'Musan Operaciones',
    permissions: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'],
  },
  {
    seq: 22,
    email: 'bodega@musan.com',
    role: 'warehouse_staff',
    fullName: 'Musan Bodega',
    permissions: ['reception', 'distribution'],
  },
  {
    // spec-61 — Musan needs someone who can OPEN a pickup route, not just work
    // one. start_pickup_route gates route creation by ROLE (ROUTE_LEADER_ROLES
    // in lib/permissions.ts), never by a permission token, so the token set is
    // deliberately identical to pickup_crew's: the role is what grants it.
    seq: 23,
    email: 'lider@musan.com',
    role: 'pickup_leader',
    fullName: 'Musan Líder de Recogida',
    permissions: ['pickup'],
  },
] as const;

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

/**
 * Which Pickup tab a carga lands in. The three RPCs behind that screen split on
 * the manifest row, not on the orders:
 *
 *   get_pending_manifests     built FROM ORDERS; excludes any load whose
 *                             manifest has reception_status IS NOT NULL,
 *                             status = 'completed', or (spec-61 Task 7)
 *                             pickup_route_id IS NOT NULL
 *   get_in_transit_manifests  manifest.reception_status IS NOT NULL
 *                             AND status <> 'completed'
 *   get_completed_manifests   manifest.status = 'completed'
 *
 * So a load awaiting collection must have NO manifest row, or one with a NULL
 * reception_status — as the RPC itself notes, "pending loads may not have a
 * manifest row until the operator opens the scan flow". Setting
 * reception_status on every carga hides all of them from the Pickup screen.
 */
type CargaStage = 'pending' | 'scanning' | 'in_transit' | 'completed';

interface Carga {
  /** external_load_id — how orders, packages and the manifest are tied together. */
  loadId: string;
  /** tenant_clients.slug, resolved against the migration-seeded clients. */
  clientSlug: string;
  clientName: string;
  pickupPointId: string;
  stage: CargaStage;
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
    clientSlug: 'easy',
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    // Awaiting collection — no manifest row at all.
    stage: 'pending',
    orders: [['ingresado'], ['ingresado', 'ingresado'], ['ingresado']],
  },
  {
    loadId: 'CARGA-EASY-002',
    clientSlug: 'easy',
    clientName: 'Easy',
    pickupPointId: MUSAN_QA.easyPickupPointId,
    // Scan flow opened: manifest exists, reception_status still NULL, so it
    // stays on the pending tab with a partial verified count.
    stage: 'scanning',
    orders: [['verificado'], ['verificado', 'ingresado']],
  },
  {
    loadId: 'CARGA-PARIS-001',
    clientSlug: 'paris',
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    stage: 'completed',
    orders: [['en_bodega'], ['en_bodega', 'en_bodega'], ['en_bodega'], ['en_bodega']],
  },
  {
    loadId: 'CARGA-PARIS-002',
    clientSlug: 'paris',
    clientName: 'Paris',
    pickupPointId: MUSAN_QA.parisPickupPointId,
    // Collected and on its way to the hub.
    stage: 'in_transit',
    orders: [['verificado', 'verificado']],
  },
];

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

  for (const login of MUSAN_LOGINS) {
    await createLoginUser(db, {
      id: qaId(ScenarioGroup.MUSAN, login.seq),
      operatorId,
      email: login.email,
      role: login.role,
      fullName: login.fullName,
      permissions: [...login.permissions],
    });
  }

  let orderSequence = 100;
  let orderCount = 0;

  for (let c = 0; c < CARGAS.length; c++) {
    const carga = CARGAS[c];
    const totalPackages = carga.orders.reduce((sum, pkgs) => sum + pkgs.length, 0);

    // 'pending' deliberately gets no manifest row — that is what puts a load
    // on the pending tab.
    if (carga.stage !== 'pending') {
      const manifestStatus =
        carga.stage === 'completed' ? 'completed'
        : carga.stage === 'in_transit' ? 'in_progress'
        : 'in_progress';
      const receptionStatus =
        carga.stage === 'completed' ? 'received'
        : carga.stage === 'in_transit' ? 'awaiting_reception'
        : null; // 'scanning' keeps it NULL so the load stays pending

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
          manifestStatus,
          receptionStatus,
        ],
      );
    }

    for (const packageStatuses of carga.orders) {
      orderSequence++;
      const order = await createOrderWithPackages(db, {
        group: ScenarioGroup.MUSAN,
        sequence: orderSequence,
        operatorId,
        orderNumber: `${carga.loadId}-ORD-${orderSequence}`,
        packageStatuses,
        externalLoadId: carga.loadId,
        tenantClientId: clientIdBySlug.get(carga.clientSlug) ?? null,
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
    detail: 'Easy and Paris both present (migrations also add easy-webhook)',
    sql: `SELECT count(*) AS count FROM public.tenant_clients
           WHERE operator_id = $1 AND slug IN ('easy','paris') AND deleted_at IS NULL`,
    params: [operatorId],
    expected: 2,
  });

  // The empty-sidebar symptom: a tenant with no enabled modules shows only the
  // ungated pages. Musan's nine come from migration 20260709000001.
  await assertCount(db, collector, {
    scenario: 'musan/modules',
    detail: 'modules enabled for Musan (drives the sidebar)',
    sql: `SELECT count(*) AS count FROM public.operator_enabled_modules
           WHERE operator_id = $1 AND disabled_at IS NULL`,
    params: [operatorId],
    expected: 9,
  });

  // Only non-pending cargas have a manifest row — a load awaiting collection
  // deliberately has none, which is what puts it on the pending tab.
  await assertCount(db, collector, {
    scenario: 'musan/cargas',
    detail: 'manifest rows for Musan (pending cargas have none)',
    sql: `SELECT count(*) AS count FROM public.manifests
           WHERE operator_id = $1 AND deleted_at IS NULL`,
    params: [operatorId],
    expected: CARGAS.filter((c) => c.stage !== 'pending').length,
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
    scenario: 'musan/logins',
    detail: 'Musan logins able to sign in',
    sql: `SELECT count(*) AS count FROM public.users
           WHERE operator_id = $1 AND deleted_at IS NULL`,
    params: [operatorId],
    expected: MUSAN_LOGINS.length,
  });

  await assertCount(db, collector, {
    scenario: 'musan/admin-permissions',
    detail: 'admin@musan.com carries the admin permission',
    sql: `SELECT count(*) AS count FROM public.users
           WHERE email = 'admin@musan.com'
             AND role = 'admin'::user_role
             AND 'admin' = ANY(permissions)
             AND deleted_at IS NULL`,
    expected: 1,
  });

  // spec-61 — the leader is only useful if the ROLE landed: start_pickup_route
  // reads users.role, so a row carrying 'pickup' but the wrong role can open
  // Recogida and still be unable to start a route.
  await assertCount(db, collector, {
    scenario: 'musan/pickup-leader',
    detail: 'lider@musan.com can lead a pickup route',
    sql: `SELECT count(*) AS count FROM public.users
           WHERE email = 'lider@musan.com'
             AND role = 'pickup_leader'::user_role
             AND 'pickup' = ANY(permissions)
             AND deleted_at IS NULL`,
    expected: 1,
  });

  // A login is unusable without its auth.identities row — GoTrue v2 matches
  // the password against the identity, not auth.users alone.
  await assertCount(db, collector, {
    scenario: 'musan/pickup-leader-identity',
    detail: 'lider@musan.com has the email identity password login needs',
    sql: `SELECT count(*) AS count FROM auth.identities i
            JOIN auth.users au ON au.id = i.user_id
           WHERE au.email = 'lider@musan.com' AND i.provider = 'email'`,
    expected: 1,
  });

  // Mirror the three Pickup RPCs' predicates. The screen showed zeros because
  // every carga carried a reception_status, so none reached the pending tab —
  // assert each tab has something rather than only that rows exist.
  await assertCount(db, collector, {
    scenario: 'musan/pickup-pending',
    detail: 'loads on the Pickup PENDING tab (get_pending_manifests)',
    sql: `SELECT count(DISTINCT o.external_load_id) AS count
            FROM orders o
           WHERE o.operator_id = $1
             AND o.external_load_id IS NOT NULL
             AND o.deleted_at IS NULL
             AND o.external_load_id NOT IN (
               SELECT m.external_load_id FROM manifests m
                WHERE m.operator_id = $1 AND m.deleted_at IS NULL
                  AND (m.status = 'completed'
                       OR m.reception_status IS NOT NULL
                       OR m.pickup_route_id IS NOT NULL)
             )`,
    params: [operatorId],
    expected: 2,
  });

  await assertCount(db, collector, {
    scenario: 'musan/pickup-in-transit',
    detail: 'loads on the Pickup IN TRANSIT tab (get_in_transit_manifests)',
    sql: `SELECT count(*) AS count FROM manifests m
           WHERE m.operator_id = $1 AND m.deleted_at IS NULL
             AND m.reception_status IS NOT NULL AND m.status <> 'completed'`,
    params: [operatorId],
    expected: 1,
  });

  await assertCount(db, collector, {
    scenario: 'musan/pickup-completed',
    detail: 'loads on the Pickup COMPLETED tab (get_completed_manifests)',
    sql: `SELECT count(*) AS count FROM manifests m
           WHERE m.operator_id = $1 AND m.deleted_at IS NULL AND m.status = 'completed'`,
    params: [operatorId],
    expected: 1,
  });

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
