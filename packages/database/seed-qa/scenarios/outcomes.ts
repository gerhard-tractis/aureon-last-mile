/**
 * spec-51 — delivery outcome scenarios.
 *
 * These exercise every branch of recalculate_order_status (latest definition
 * 20260810000001). Each case states the status the trigger should derive and
 * asserts it, so this file doubles as a regression suite for the most
 * load-bearing status logic in the product.
 *
 * The `staged for dispatch` case is the one that was broken in production:
 * pipeline_position() never learned 'listo_para_despacho', so an order whose
 * packages were all staged counted as having none and was set to 'cancelado'.
 */

import type { SeedClient } from '../lib/db';
import { AssertionCollector, assertOrderStatus } from '../lib/assert';
import { createOrderWithPackages, resettleOrderStatus } from '../lib/factories';
import { ScenarioGroup, FIXED_IDS } from '../lib/ids';

interface OutcomeCase {
  sequence: number;
  orderNumber: string;
  description: string;
  packageStatuses: string[];
  expectedStatus: string;
  /** Defaults to expectedStatus when the derivation collapses min and max. */
  expectedLeadingStatus?: string;
}

/**
 * Derivation rules, in the order recalculate_order_status applies them:
 *   1. any retorno_hub + any entregado -> parcialmente_entregado
 *   2. any retorno_hub, none entregado -> en_retorno
 *   3. zero active + zero entregado    -> cancelado
 *   4. otherwise status = MIN position, leading_status = MAX position
 *      (positions 4 and 5, sectorizado and retenido, collapse to en_bodega)
 */
export const OUTCOME_CASES: OutcomeCase[] = [
  {
    sequence: 1,
    orderNumber: 'QA-OUT-001',
    description: 'every package delivered',
    packageStatuses: ['entregado', 'entregado'],
    expectedStatus: 'entregado',
  },
  {
    sequence: 2,
    orderNumber: 'QA-OUT-002',
    description: 'failed delivery, nothing delivered',
    packageStatuses: ['retorno_hub', 'retorno_hub'],
    expectedStatus: 'en_retorno',
  },
  {
    sequence: 3,
    orderNumber: 'QA-OUT-003',
    description: 'some delivered, some returned',
    packageStatuses: ['entregado', 'retorno_hub'],
    expectedStatus: 'parcialmente_entregado',
  },
  {
    sequence: 4,
    orderNumber: 'QA-OUT-004',
    description: 'no active packages left',
    packageStatuses: ['cancelado', 'cancelado'],
    expectedStatus: 'cancelado',
  },
  {
    // The production regression. Must NOT be cancelado.
    sequence: 5,
    orderNumber: 'QA-OUT-005',
    description: 'all packages staged for dispatch',
    packageStatuses: ['listo_para_despacho', 'listo_para_despacho'],
    expectedStatus: 'listo_para_despacho',
  },
  {
    sequence: 6,
    orderNumber: 'QA-OUT-006',
    description: 'split across the pipeline — min drives status, max drives leading',
    packageStatuses: ['en_bodega', 'en_ruta'],
    expectedStatus: 'en_bodega',
    expectedLeadingStatus: 'en_ruta',
  },
  {
    sequence: 7,
    orderNumber: 'QA-OUT-007',
    description: 'sectorizado and retenido collapse to en_bodega',
    packageStatuses: ['sectorizado', 'retenido'],
    expectedStatus: 'en_bodega',
    expectedLeadingStatus: 'en_bodega',
  },
  {
    sequence: 8,
    orderNumber: 'QA-OUT-008',
    description: 'terminal package states with one still moving',
    packageStatuses: ['dañado', 'extraviado', 'en_ruta'],
    expectedStatus: 'en_ruta',
  },
  {
    sequence: 9,
    orderNumber: 'QA-OUT-009',
    description: 'devuelto alongside a delivered package',
    packageStatuses: ['devuelto', 'entregado'],
    expectedStatus: 'entregado',
  },
  {
    sequence: 10,
    orderNumber: 'QA-OUT-010',
    description: 'single package mid-pipeline',
    packageStatuses: ['en_carga'],
    expectedStatus: 'en_carga',
  },
];

export async function seedOutcomes(
  db: SeedClient,
  collector: AssertionCollector,
  options: { operatorId?: string } = {},
): Promise<number> {
  const operatorId = options.operatorId ?? FIXED_IDS.BASELINE_OPERATOR;
  let created = 0;

  for (const testCase of OUTCOME_CASES) {
    const order = await createOrderWithPackages(db, {
      group: ScenarioGroup.OUTCOMES,
      sequence: testCase.sequence,
      operatorId,
      orderNumber: testCase.orderNumber,
      packageStatuses: testCase.packageStatuses,
    });

    // Re-runs insert nothing (ON CONFLICT DO NOTHING), so no trigger fires and
    // the assertion below would read a stale value. Touch the packages to make
    // the derivation run again.
    await resettleOrderStatus(db, order.orderId);

    await assertOrderStatus(db, collector, {
      scenario: `outcomes/${testCase.orderNumber}`,
      orderId: order.orderId,
      orderNumber: `${testCase.orderNumber} (${testCase.description})`,
      expectedStatus: testCase.expectedStatus,
      expectedLeadingStatus: testCase.expectedLeadingStatus,
    });

    created++;
  }

  return created;
}
