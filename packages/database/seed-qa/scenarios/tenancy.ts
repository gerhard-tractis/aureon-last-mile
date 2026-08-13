/**
 * spec-51 — tenant operation scenarios.
 *
 * The spec-48 baseline seeds a single operator, which makes cross-tenant
 * isolation untestable: with nothing to leak from, a passing isolation check
 * proves nothing. This adds a second operator with its own orders, plus a
 * third with no modules enabled for the Phase 0 exit criterion in
 * docs/architecture/phased-rollout-strategy.md.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertCount, assertNoCrossTenantRows } from '../lib/assert';
import { createOperator, createOrderWithPackages, resettleOrderStatus } from '../lib/factories';
import { ScenarioGroup, FIXED_IDS } from '../lib/ids';

/** Seeded by 20260616000002. Satisfies operator_enabled_modules.enabled_by NOT NULL. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000055';

/** Module keys from apps/frontend/src/lib/modules/registry.ts. */
export const ALL_MODULE_KEYS = [
  'ops_control', 'late_order_alerts', 'pickup', 'reception', 'distribution',
  'pre_route', 'dispatch', 'returns', 'conversations',
] as const;

/**
 * The second operator gets a partial module set so the activation matrix has
 * something to compare against the baseline operator.
 */
const SECOND_OPERATOR_MODULES = ['ops_control', 'pickup', 'reception'] as const;

async function enableModules(
  db: SeedClient,
  operatorId: string,
  moduleKeys: readonly string[],
): Promise<void> {
  for (const moduleKey of moduleKeys) {
    await db.query(
      `INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (operator_id, module_key) WHERE disabled_at IS NULL DO NOTHING`,
      [operatorId, moduleKey, SYSTEM_USER_ID],
    );
  }
}

export async function seedTenancy(
  db: SeedClient,
  collector: AssertionCollector,
): Promise<number> {
  let created = 0;

  // The baseline operator ships with NO modules enabled, so every qa-*@qa.test
  // user sees a sidebar containing only the ungated pages (Capacidad,
  // Auditoría, Admin) and none of the operational modules. Enable all nine so
  // the six QA logins can actually reach the workflows under test.
  //
  // Together with the two operators below this forms the activation matrix:
  //   baseline  -> all nine       (everything visible)
  //   second    -> three          (partial)
  //   blank     -> none           (Phase 0 exit criterion)
  await enableModules(db, FIXED_IDS.BASELINE_OPERATOR, ALL_MODULE_KEYS);

  // ── Second operator: real data, so isolation checks have something to find ─
  await createOperator(db, {
    id: FIXED_IDS.SECOND_OPERATOR,
    name: 'QA Segundo Operador',
    slug: 'qa-segundo-operador',
  });
  await enableModules(db, FIXED_IDS.SECOND_OPERATOR, SECOND_OPERATOR_MODULES);

  for (let i = 1; i <= 3; i++) {
    const order = await createOrderWithPackages(db, {
      group: ScenarioGroup.TENANCY,
      sequence: 100 + i,
      operatorId: FIXED_IDS.SECOND_OPERATOR,
      orderNumber: `QA-T2-${String(i).padStart(3, '0')}`,
      packageStatuses: ['en_bodega'],
      comuna: 'Providencia',
    });
    await resettleOrderStatus(db, order.orderId);
    created++;
  }

  // ── Blank operator: no modules at all (Phase 0 exit criterion) ─────────────
  await createOperator(db, {
    id: FIXED_IDS.BLANK_OPERATOR,
    name: 'QA Operador Sin Modulos',
    slug: 'qa-operador-sin-modulos',
  });

  // ── Assertions ────────────────────────────────────────────────────────────
  await assertCount(db, collector, {
    scenario: 'tenancy/second-operator',
    detail: 'orders belonging to the second operator',
    sql: 'SELECT count(*) AS count FROM public.orders WHERE operator_id = $1 AND deleted_at IS NULL',
    params: [FIXED_IDS.SECOND_OPERATOR],
    expected: 3,
  });

  await assertCount(db, collector, {
    scenario: 'tenancy/module-activation',
    detail: 'modules enabled for the second operator',
    sql: `SELECT count(*) AS count FROM public.operator_enabled_modules
           WHERE operator_id = $1 AND disabled_at IS NULL`,
    params: [FIXED_IDS.SECOND_OPERATOR],
    expected: SECOND_OPERATOR_MODULES.length,
  });

  await assertCount(db, collector, {
    scenario: 'tenancy/baseline-modules',
    detail: 'modules enabled for the baseline operator (drives the sidebar)',
    sql: `SELECT count(*) AS count FROM public.operator_enabled_modules
           WHERE operator_id = $1 AND disabled_at IS NULL`,
    params: [FIXED_IDS.BASELINE_OPERATOR],
    expected: ALL_MODULE_KEYS.length,
  });

  await assertCount(db, collector, {
    scenario: 'tenancy/blank-operator',
    detail: 'modules enabled for the blank operator',
    sql: `SELECT count(*) AS count FROM public.operator_enabled_modules
           WHERE operator_id = $1 AND disabled_at IS NULL`,
    params: [FIXED_IDS.BLANK_OPERATOR],
    expected: 0,
  });

  // Not an RLS test — the seed connects as superuser, so RLS does not apply.
  // This verifies the data shape that makes an RLS test meaningful.
  for (const table of ['orders', 'packages']) {
    await assertNoCrossTenantRows(db, collector, {
      scenario: 'tenancy/isolation',
      table,
      operatorId: FIXED_IDS.BASELINE_OPERATOR,
      foreignOperatorId: FIXED_IDS.SECOND_OPERATOR,
    });
  }

  return created;
}
