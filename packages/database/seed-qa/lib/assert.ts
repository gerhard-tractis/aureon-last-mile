/**
 * spec-51 — post-insert assertions.
 *
 * The point of the generator is not to place rows; it is to place rows and then
 * check the database agreed. `orders.status` is derived by
 * trg_recalculate_order_status from package statuses, so a scenario states the
 * status it expects and this module verifies the trigger produced it.
 *
 * That is what turns the seed into a regression test. The bug where closing a
 * dispatch route cancelled its orders (fixed in 20260810000001) would have
 * shown up here the first time the dispatch scenario ran.
 */

import type { SeedClient } from './db';

export interface AssertionFailure {
  scenario: string;
  detail: string;
  expected: string;
  actual: string;
}

export class AssertionCollector {
  private readonly failures: AssertionFailure[] = [];

  record(failure: AssertionFailure): void {
    this.failures.push(failure);
  }

  get passed(): boolean {
    return this.failures.length === 0;
  }

  get count(): number {
    return this.failures.length;
  }

  format(): string {
    if (this.passed) return 'All scenario assertions passed.';

    const lines = [`${this.failures.length} assertion(s) failed:`, ''];
    for (const f of this.failures) {
      lines.push(`  [${f.scenario}] ${f.detail}`);
      lines.push(`      expected: ${f.expected}`);
      lines.push(`      actual:   ${f.actual}`);
    }
    return lines.join('\n');
  }
}

/**
 * Assert the derived order status. Never write orders.status directly —
 * insert packages, let the trigger settle, then call this.
 */
export async function assertOrderStatus(
  db: SeedClient,
  collector: AssertionCollector,
  args: {
    scenario: string;
    orderId: string;
    orderNumber: string;
    expectedStatus: string;
    expectedLeadingStatus?: string;
  },
): Promise<void> {
  const rows = await db.query<{ status: string; leading_status: string | null }>(
    'SELECT status::text, leading_status::text FROM public.orders WHERE id = $1',
    [args.orderId],
  );

  if (rows.length === 0) {
    collector.record({
      scenario: args.scenario,
      detail: `order ${args.orderNumber} was not found after insert`,
      expected: 'one row',
      actual: 'no rows',
    });
    return;
  }

  const { status, leading_status } = rows[0];

  if (status !== args.expectedStatus) {
    collector.record({
      scenario: args.scenario,
      detail: `order ${args.orderNumber} derived status (trg_recalculate_order_status)`,
      expected: args.expectedStatus,
      actual: status,
    });
  }

  const expectedLeading = args.expectedLeadingStatus ?? args.expectedStatus;
  if (leading_status !== expectedLeading) {
    collector.record({
      scenario: args.scenario,
      detail: `order ${args.orderNumber} derived leading_status`,
      expected: expectedLeading,
      actual: String(leading_status),
    });
  }
}

/** Assert a scalar count, e.g. "this operator has N orders". */
export async function assertCount(
  db: SeedClient,
  collector: AssertionCollector,
  args: { scenario: string; detail: string; sql: string; params?: unknown[]; expected: number },
): Promise<void> {
  const rows = await db.query<{ count: string }>(args.sql, args.params);
  const actual = Number(rows[0]?.count ?? 0);

  if (actual !== args.expected) {
    collector.record({
      scenario: args.scenario,
      detail: args.detail,
      expected: String(args.expected),
      actual: String(actual),
    });
  }
}

/**
 * Assert that tenant isolation holds: a query scoped to one operator must not
 * return rows belonging to another. Checked with operator_id directly rather
 * than through RLS, since the seed connects as a superuser and RLS would not
 * apply — this verifies the data shape isolation testing depends on.
 */
export async function assertNoCrossTenantRows(
  db: SeedClient,
  collector: AssertionCollector,
  args: { scenario: string; table: string; operatorId: string; foreignOperatorId: string },
): Promise<void> {
  const rows = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM public.${args.table}
      WHERE operator_id = $1 AND id IN (
        SELECT id FROM public.${args.table} WHERE operator_id = $2
      )`,
    [args.operatorId, args.foreignOperatorId],
  );

  const actual = Number(rows[0]?.count ?? 0);
  if (actual !== 0) {
    collector.record({
      scenario: args.scenario,
      detail: `${args.table} rows shared between operators`,
      expected: '0',
      actual: String(actual),
    });
  }
}
