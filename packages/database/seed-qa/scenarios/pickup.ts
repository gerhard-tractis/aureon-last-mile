/**
 * spec-51 — pickup scenarios (tenant warehouse -> hub), covering §2 of
 * docs/qa-test-scope.md.
 *
 * Column shapes were read from the live QA database rather than inferred.
 * The trap worth naming: `pickup_routes.driver_id` references **public.users**,
 * not public.drivers. A driver here is a login, not a fleet record.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertCount } from '../lib/assert';
import { QA_USERS, resolveUserId } from '../lib/factories';
import { ScenarioGroup, FIXED_IDS, qaId, groupLikePattern } from '../lib/ids';

/** scan_result_enum: verified | not_found | duplicate */
const SCAN_RESULTS = ['verified', 'not_found', 'duplicate'] as const;

export async function seedPickup(
  db: SeedClient,
  collector: AssertionCollector,
): Promise<number> {
  const operatorId = FIXED_IDS.BASELINE_OPERATOR;

  const driverUserId = await resolveUserId(db, QA_USERS.PICKUP_CREW);
  if (!driverUserId) {
    collector.record({
      scenario: 'pickup',
      detail: 'QA login users are missing — run infra/supabase-qa/create-qa-users.sh',
      expected: `a public.users row for ${QA_USERS.PICKUP_CREW}`,
      actual: 'none',
    });
    return 0;
  }

  let created = 0;

  // ── Manifests, one per reception_status_enum value ────────────────────────
  const manifests = [
    { seq: 1, load: 'QA-LOAD-001', reception: 'awaiting_reception', status: 'pending' },
    { seq: 2, load: 'QA-LOAD-002', reception: 'reception_in_progress', status: 'in_progress' },
    { seq: 3, load: 'QA-LOAD-003', reception: 'received', status: 'completed' },
    { seq: 4, load: 'QA-LOAD-004', reception: 'awaiting_reception', status: 'cancelled' },
  ];

  for (const m of manifests) {
    await db.query(
      `INSERT INTO public.manifests (id, operator_id, external_load_id, status, reception_status)
       VALUES ($1, $2, $3, $4::manifest_status_enum, $5::reception_status_enum)
       ON CONFLICT (id) DO NOTHING`,
      [qaId(ScenarioGroup.PICKUP, m.seq), operatorId, m.load, m.status, m.reception],
    );
    created++;
  }

  // ── Scans across every scan_result_enum value ─────────────────────────────
  const manifestId = qaId(ScenarioGroup.PICKUP, 2);
  for (let i = 0; i < SCAN_RESULTS.length; i++) {
    await db.query(
      `INSERT INTO public.pickup_scans (
         id, operator_id, manifest_id, barcode_scanned, scan_result, scanned_at,
         scanned_by_user_id
       ) VALUES ($1, $2, $3, $4, $5::scan_result_enum, NOW(), $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        qaId(ScenarioGroup.PICKUP, 20 + i),
        operatorId,
        manifestId,
        `QA-LOAD-002-CTN-${i + 1}`,
        SCAN_RESULTS[i],
        driverUserId,
      ],
    );
  }

  // ── A discrepancy note, which close_pickup_route requires on a shortfall ──
  const shortPackage = await db.query<{ id: string }>(
    `SELECT id FROM public.packages
      WHERE operator_id = $1 AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [operatorId],
  );
  if (shortPackage[0]) {
    await db.query(
      `INSERT INTO public.discrepancy_notes (
         id, operator_id, manifest_id, package_id, note, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        qaId(ScenarioGroup.PICKUP, 30),
        operatorId,
        manifestId,
        shortPackage[0].id,
        'QA: package missing at pickup verification',
        driverUserId,
      ],
    );
  }

  // ── Pickup routes across pickup_route_status_enum ─────────────────────────
  // Only ONE active route per driver is allowed (partial unique index from
  // spec-47), so the non-terminal route uses the pickup crew login and the rest
  // are terminal states that the index ignores.
  const routes = [
    { seq: 40, code: 'QA-PR-001', status: 'in_transit' },
    { seq: 41, code: 'QA-PR-002', status: 'received' },
    { seq: 42, code: 'QA-PR-003', status: 'cancelled' },
  ];

  // pickup_routes.vehicle_id has been NOT NULL since spec-52
  // (20260812000003:59-89). This scenario predates that and inserted routes
  // without one, so every run since 2026-08-12 has aborted here -- after the
  // manifests above were written and before the attach block below could pair
  // them with a route. That is exactly how QA ended up with four manifests
  // carrying a reception_status and no pickup_route_id, failing
  // spec47_migration_invariants.sql on every deploy. Nothing runs this seeder
  // in CI, so the breakage was invisible until someone ran it by hand.
  //
  // Conflict target is (operator_id, plate), not id: uniq_vehicles_operator_plate
  // (20260812000001:24) is a partial unique index, so a vehicle already carrying
  // this plate under a different id would make an ON CONFLICT (id) clause miss
  // and the insert would die -- the same mistake this scenario's manifest insert
  // made against unique_manifest_per_operator. The id is then read back rather
  // than assumed, so the routes below point at whichever row actually exists.
  await db.query(
    `INSERT INTO public.vehicles (id, operator_id, plate, active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (operator_id, plate) WHERE deleted_at IS NULL DO NOTHING`,
    [qaId(ScenarioGroup.PICKUP, 39), operatorId, 'QA-PK-01'],
  );
  const vehicleRows = await db.query<{ id: string }>(
    `SELECT id FROM public.vehicles
      WHERE operator_id = $1 AND plate = $2 AND deleted_at IS NULL`,
    [operatorId, 'QA-PK-01'],
  );
  const vehicleId = vehicleRows[0]?.id;
  if (!vehicleId) throw new Error('pickup scenario: QA-PK-01 vehicle missing after upsert');
  created++;

  for (const r of routes) {
    await db.query(
      `INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
       VALUES ($1, $2, $3, $4, $5, $6::pickup_route_status_enum)
       ON CONFLICT (id) DO NOTHING`,
      [
        qaId(ScenarioGroup.PICKUP, r.seq),
        operatorId,
        r.code,
        driverUserId,
        vehicleId,
        r.status,
      ],
    );
    created++;
  }

  // ── Attach the manifests to their routes ──────────────────────────────────
  // A manifest carrying a reception_status must also carry a pickup_route_id:
  // reception happens against a route, and spec47_migration_invariants.sql
  // asserts the pair. Inserting these four with a reception_status and no route
  // left QA permanently violating that invariant -- the SQL suite reported it
  // on every deploy as a bare count, with no way to identify the rows.
  //
  // This runs as an UPDATE rather than folding pickup_route_id into the INSERT
  // above for two reasons: the routes do not exist yet at that point, and the
  // INSERT is ON CONFLICT DO NOTHING, so it would never repair the rows already
  // sitting in QA from earlier runs. The UPDATE is idempotent and does both.
  const manifestRoute: Record<number, number> = {
    1: 40, // awaiting_reception  -> QA-PR-001 (in_transit)
    2: 40, // reception_in_progress -> QA-PR-001 (in_transit)
    3: 41, // received            -> QA-PR-002 (received)
    4: 42, // cancelled           -> QA-PR-003 (cancelled)
  };

  for (const m of manifests) {
    await db.query(
      `UPDATE public.manifests SET pickup_route_id = $2
        WHERE id = $1 AND pickup_route_id IS DISTINCT FROM $2`,
      [qaId(ScenarioGroup.PICKUP, m.seq), qaId(ScenarioGroup.PICKUP, manifestRoute[m.seq])],
    );
  }

  // ── Assertions ────────────────────────────────────────────────────────────
  // Guards the invariant this scenario used to break. Without it, a future edit
  // that adds a fifth reception_status manifest and forgets the route mapping
  // reintroduces the same silent QA breakage.
  await assertCount(db, collector, {
    scenario: 'pickup/manifest-route-pairing',
    detail: 'no scenario manifest carries a reception_status without a route',
    sql: `SELECT count(*) AS count FROM public.manifests
           WHERE id::text LIKE $1
             AND reception_status IS NOT NULL
             AND pickup_route_id IS NULL
             AND deleted_at IS NULL`,
    params: [groupLikePattern(ScenarioGroup.PICKUP)],
    expected: 0,
  });

  await assertCount(db, collector, {
    scenario: 'pickup/manifests',
    detail: 'manifests seeded for the baseline operator',
    sql: `SELECT count(*) AS count FROM public.manifests WHERE id::text LIKE $1`,
    params: [groupLikePattern(ScenarioGroup.PICKUP)],
    expected: manifests.length,
  });

  await assertCount(db, collector, {
    scenario: 'pickup/scans',
    detail: 'pickup scans covering every scan_result_enum value',
    sql: `SELECT count(DISTINCT scan_result) AS count FROM public.pickup_scans
           WHERE id::text LIKE $1`,
    params: [groupLikePattern(ScenarioGroup.PICKUP)],
    expected: SCAN_RESULTS.length,
  });

  await assertCount(db, collector, {
    scenario: 'pickup/routes',
    detail: 'pickup routes seeded',
    sql: `SELECT count(*) AS count FROM public.pickup_routes WHERE id::text LIKE $1`,
    params: [groupLikePattern(ScenarioGroup.PICKUP)],
    expected: routes.length,
  });

  return created;
}
