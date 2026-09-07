/**
 * spec-51 — what the Musan fixture claims to be true after seeding.
 *
 * Split out of musan.ts for the 300-line rule. Two things changed in the move,
 * both because all four cargas are now seeded PENDING:
 *
 *   - The fixed per-tab counts ("1 load in transit", "1 completed") are gone.
 *     They asserted a snapshot of a SHARED database, so they went red the
 *     moment a tester did the very thing the fixture exists to let them do.
 *     What is asserted instead are invariants that survive use.
 *   - The composition matrix is asserted: box counts, SKU cardinality, and the
 *     spec-55 parent/sibling columns. Those are the point of the fixture, and
 *     nothing checked them before.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertCount } from '../lib/assert';
import { MUSAN_LOGINS } from './musan-logins';

export interface CargaSummary {
  loadId: string;
  orderCount: number;
  packageCount: number;
}

export async function assertMusan(
  db: SeedClient,
  collector: AssertionCollector,
  operatorId: string,
  cargas: CargaSummary[],
): Promise<void> {
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
           WHERE operator_id = $1 AND disabled_at IS NULL
             AND module_key IN ('ops_control','late_order_alerts','pickup','reception',
                                'distribution','pre_route','dispatch','returns','conversations')`,
    params: [operatorId],
    expected: 9,
  });

  // EVERY carga has a manifest row, pending included — 20260814000001's
  // trg_ensure_manifest_for_order creates one the moment an order carrying a
  // new external_load_id is inserted. What puts a load on the pending tab is
  // its manifest's status / reception_status / pickup_route_id, never the
  // absence of the row.
  await assertCount(db, collector, {
    scenario: 'musan/cargas',
    detail: 'one manifest row per carga',
    sql: `SELECT count(*) AS count FROM public.manifests
           WHERE operator_id = $1 AND deleted_at IS NULL`,
    params: [operatorId],
    expected: cargas.length,
  });

  for (const carga of cargas) {
    // The point of a carga: every order in it carries the same
    // external_load_id, so the manifest and its orders can actually be joined.
    await assertCount(db, collector, {
      scenario: `musan/carga/${carga.loadId}`,
      detail: `orders aggregated under ${carga.loadId}`,
      sql: `SELECT count(*) AS count FROM public.orders
             WHERE operator_id = $1 AND external_load_id = $2 AND deleted_at IS NULL`,
      params: [operatorId, carga.loadId],
      expected: carga.orderCount,
    });

    await assertCount(db, collector, {
      scenario: `musan/carga/${carga.loadId}/boxes`,
      detail: `boxes under ${carga.loadId} (the scan denominator)`,
      sql: `SELECT count(*) AS count FROM public.packages p
              JOIN public.orders o ON o.id = p.order_id
             WHERE o.operator_id = $1 AND o.external_load_id = $2
               AND o.deleted_at IS NULL AND p.deleted_at IS NULL`,
      params: [operatorId, carga.loadId],
      expected: carga.packageCount,
    });
  }

  // ── The composition matrix ────────────────────────────────────────────────
  // Two orders per carga are a single SKU spread across three boxes, modelled
  // as expand_carton leaves a family: a parent plus two generated siblings.
  const families = cargas.length * 4; // multi_box_sku + multi_box_sku_plus_mono
  await assertCount(db, collector, {
    scenario: 'musan/composition/multi-box-skus',
    detail: 'multi-box SKU families (parent carton declaring 3 boxes)',
    sql: `SELECT count(*) AS count FROM public.packages
           WHERE operator_id = $1 AND deleted_at IS NULL
             AND is_generated_label = FALSE AND declared_box_count = 3`,
    params: [operatorId],
    expected: families,
  });

  await assertCount(db, collector, {
    scenario: 'musan/composition/minted-siblings',
    detail: 'generated sibling cartons (two per multi-box family)',
    sql: `SELECT count(*) AS count FROM public.packages
           WHERE operator_id = $1 AND deleted_at IS NULL
             AND is_generated_label = TRUE`,
    params: [operatorId],
    expected: families * 2,
  });

  // A sibling whose parent_label matches no live package is a family the
  // label printer and expand_carton both fail on ("parent carton not found").
  await assertCount(db, collector, {
    scenario: 'musan/composition/orphan-siblings',
    detail: 'generated siblings whose parent carton is missing',
    sql: `SELECT count(*) AS count FROM public.packages s
           WHERE s.operator_id = $1 AND s.deleted_at IS NULL
             AND s.is_generated_label = TRUE
             AND NOT EXISTS (
               SELECT 1 FROM public.packages p
                WHERE p.operator_id = s.operator_id
                  AND p.label = s.parent_label
                  AND p.deleted_at IS NULL
             )`,
    params: [operatorId],
    expected: 0,
  });

  // Two orders per carga carry three DIFFERENT SKUs; the rest carry one. This
  // counts orders by distinct SKU code across their boxes, which is what
  // separates three_distinct_skus from repeated_sku_three_boxes — both are
  // three rows, and only the SKU cardinality tells them apart.
  await assertCount(db, collector, {
    scenario: 'musan/composition/three-sku-orders',
    detail: 'orders carrying three distinct SKUs',
    sql: `SELECT count(*) AS count FROM (
            SELECT o.id
              FROM public.orders o
              JOIN public.packages p ON p.order_id = o.id AND p.deleted_at IS NULL
              CROSS JOIN LATERAL jsonb_array_elements(p.sku_items) AS item
             WHERE o.operator_id = $1 AND o.deleted_at IS NULL
               AND o.external_load_id LIKE 'CARGA-%'
             GROUP BY o.id
            HAVING count(DISTINCT item ->> 'sku') = 3
          ) AS multi_sku_orders`,
    params: [operatorId],
    expected: cargas.length * 2,
  });

  // ── Logins ────────────────────────────────────────────────────────────────
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

  // The leader needs someone to take. This mirrors useCrewCandidates' OWN
  // predicate rather than counting logins: that hook reads `users` directly
  // and filters on ROLE, so a rider carrying the 'pickup' permission under
  // the wrong role exists in the database and is still invisible in the
  // ACOMPAÑANTES sheet. Counting rows the picker would actually offer is the
  // only version of this assertion that can fail for the real reason.
  const crewRiders = MUSAN_LOGINS.filter((l) => l.role === 'pickup_crew').length;
  await assertCount(db, collector, {
    scenario: 'musan/crew-candidates',
    detail: 'riders the leader can put on a route (useCrewCandidates predicate)',
    sql: `SELECT count(*) AS count FROM public.users
           WHERE operator_id = $1
             AND role IN ('pickup_crew'::user_role, 'pickup_leader'::user_role,
                          'ops_leader'::user_role)
             AND deleted_at IS NULL`,
    params: [operatorId],
    // The leader is in this list too, but CrewSelect filters the signed-in
    // user out client-side, so the sheet shows exactly the riders.
    expected: crewRiders + 1,
  });

  // Both riders must be able to sign in, for the same identity reason as the
  // leader above — the whole point is watching what each of them sees.
  await assertCount(db, collector, {
    scenario: 'musan/crew-identities',
    detail: 'pickup1/pickup2@musan.com can actually log in',
    sql: `SELECT count(*) AS count FROM auth.identities i
            JOIN auth.users au ON au.id = i.user_id
           WHERE au.email IN ('pickup1@musan.com', 'pickup2@musan.com')
             AND i.provider = 'email'`,
    expected: crewRiders,
  });

  // ── Invariants that survive a tester using the data ───────────────────────
  // spec-61 Task 7: a load already on a route must never be offered on the
  // pending tab, or two crews collect it. Mirrors get_pending_manifests'
  // exclusion; keep the two in step. This holds no matter how much testing has
  // happened, which is why it replaced the old fixed per-tab counts.
  await assertCount(db, collector, {
    scenario: 'musan/pickup-pending',
    detail: 'nothing already being collected shows on the Pickup PENDING tab',
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
             )
             AND EXISTS (
               SELECT 1 FROM manifests m2
                WHERE m2.operator_id = $1 AND m2.deleted_at IS NULL
                  AND m2.external_load_id = o.external_load_id
                  AND m2.pickup_route_id IS NOT NULL
             )`,
    params: [operatorId],
    expected: 0,
  });

  // Every carga must be reachable on exactly one tab. A manifest marked
  // completed while still awaiting reception is on none of them and simply
  // disappears from Recogida.
  await assertCount(db, collector, {
    scenario: 'musan/pickup-tabs',
    detail: 'cargas in a state no Pickup tab shows',
    sql: `SELECT count(*) AS count FROM manifests m
           WHERE m.operator_id = $1 AND m.deleted_at IS NULL
             AND m.status = 'completed' AND m.reception_status = 'awaiting_reception'`,
    params: [operatorId],
    expected: 0,
  });

  await assertCount(db, collector, {
    scenario: 'musan/isolation',
    detail: 'Musan orders that leaked onto another operator',
    sql: `SELECT count(*) AS count FROM public.orders
           WHERE external_load_id LIKE 'CARGA-%' AND operator_id <> $1`,
    params: [operatorId],
    expected: 0,
  });
}
