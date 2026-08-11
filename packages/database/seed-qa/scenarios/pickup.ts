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

  for (const r of routes) {
    await db.query(
      `INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
       VALUES ($1, $2, $3, $4, $5::pickup_route_status_enum)
       ON CONFLICT (id) DO NOTHING`,
      [qaId(ScenarioGroup.PICKUP, r.seq), operatorId, r.code, driverUserId, r.status],
    );
    created++;
  }

  // ── Assertions ────────────────────────────────────────────────────────────
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
