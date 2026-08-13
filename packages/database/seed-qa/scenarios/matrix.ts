/**
 * spec-51 — exhaustive package-status combination matrix.
 *
 * Seeds an order for every multiset of package statuses (all 15 singles, all
 * 120 pairs, plus the triples that exercise a path a smaller combination
 * cannot) and asserts the database derived what lib/derivation.ts predicts.
 *
 * This is a differential test between two independent implementations of the
 * same rules: recalculate_order_status in SQL, and deriveOrderStatus in
 * TypeScript. Either can be wrong; a disagreement says which pair to look at.
 * Hand-picked cases cannot do this — the listo_para_despacho bug survived five
 * months precisely because nobody had picked that case.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertOrderStatus } from '../lib/assert';
import { createOrderWithPackages, resettleOrderStatus } from '../lib/factories';
import { ScenarioGroup, FIXED_IDS } from '../lib/ids';
import {
  combinationsOfSize,
  targetedTripleCombinations,
  deriveOrderStatus,
} from '../lib/derivation';

/** Short, stable, greppable label for a combination. */
function label(index: number): string {
  return `QA-MTX-${String(index).padStart(3, '0')}`;
}

export function matrixCombinations(): string[][] {
  return [...combinationsOfSize(1), ...combinationsOfSize(2), ...targetedTripleCombinations()];
}

export async function seedMatrix(
  db: SeedClient,
  collector: AssertionCollector,
  options: { operatorId?: string } = {},
): Promise<number> {
  const operatorId = options.operatorId ?? FIXED_IDS.BASELINE_OPERATOR;
  const combinations = matrixCombinations();
  let created = 0;

  for (let i = 0; i < combinations.length; i++) {
    const packageStatuses = combinations[i];
    const expected = deriveOrderStatus(packageStatuses);
    if (!expected) continue; // empty multiset — the trigger never sees one

    const orderNumber = label(i + 1);

    const order = await createOrderWithPackages(db, {
      group: ScenarioGroup.MATRIX,
      sequence: i + 1,
      operatorId,
      orderNumber,
      packageStatuses,
    });

    // A re-run inserts nothing (ON CONFLICT DO NOTHING), so no trigger fires
    // and the assertion below would read a stale value.
    await resettleOrderStatus(db, order.orderId);

    await assertOrderStatus(db, collector, {
      scenario: 'matrix',
      orderId: order.orderId,
      orderNumber: `${orderNumber} [${packageStatuses.join(' + ')}]`,
      expectedStatus: expected.status,
      expectedLeadingStatus: expected.leadingStatus,
    });

    created++;
  }

  return created;
}
